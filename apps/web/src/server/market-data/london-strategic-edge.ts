// apps/web/src/server/market-data/london-strategic-edge.ts
import { RESOLUTIONS, aggregateCandles, type MarketBar } from "@/lib/market-data";
import { MarketDataError, type MarketDataProvider } from "./provider";
import { readJson } from "./http";
import { resolveProviderSymbol } from "@/lib/symbol-mapping";
import {
  getCachedCandles,
  saveCachedCandles,
} from "./candle-db";

const BASE = "https://api.londonstrategicedge.com/vault";
const PROVIDER_ID = "london-strategic-edge";
const MAX_PAGES = 80;
const MAX_BARS = 100_000;
const DAY = 86_400_000;
const utcDate = (time: number) => new Date(time).toISOString().slice(0, 10);

export function normalizeLSESymbol(raw: string): { symbol: string; dataset?: string } {
  const mapped = resolveProviderSymbol("london-strategic-edge", raw);
  return { symbol: mapped.symbol, dataset: mapped.dataset || undefined };
}

async function read(path: string, key: string, signal?: AbortSignal): Promise<unknown> {
  return readJson(
    `${BASE}${path}`,
    {
      "x-api-key": key,
      "User-Agent": "LuxAlgo-Trade-Journal/market-data",
    },
    signal,
    { timeoutMs: 60_000, cache: path !== "/usage" },
  );
}

export function parseLseBars(value: unknown): MarketBar[] {
  if (!Array.isArray(value)) throw new MarketDataError("Unexpected market data response.");
  const unique = new Map<number, MarketBar>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const raw = row.ts ?? row.timestamp ?? row.minute ?? row.time;
    let time = NaN;
    if (typeof raw === "number") {
      time = raw > 1e11 ? raw : raw * 1000;
    } else if (typeof raw === "string" && raw.trim()) {
      const stamp = raw.trim().replace(" ", "T");
      time = Date.parse(/[zZ]$|[+-]\d{2}:\d{2}$/.test(stamp) ? stamp : `${stamp}Z`);
    }
    const number = (v: unknown) =>
      typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
    const open = number(row.open ?? row.o);
    const rawHigh = number(row.high ?? row.h);
    const rawLow = number(row.low ?? row.l);
    const close = number(row.close ?? row.c);
    const volume = row.volume == null ? 0 : Math.max(0, number(row.volume ?? row.v) || 0);

    if (!Number.isFinite(time) || !Number.isFinite(open) || !Number.isFinite(close)) {
      continue;
    }
    const high = Number.isFinite(rawHigh) ? Math.max(open, close, rawHigh, rawLow || open) : Math.max(open, close);
    const low = Number.isFinite(rawLow) ? Math.min(open, close, rawLow, rawHigh || open) : Math.min(open, close);
    unique.set(time, { time, open, high, low, close, volume });
  }
  return [...unique.values()].sort((a, b) => a.time - b.time);
}

async function fetchLseRangeSingle(
  symbol: string,
  dataset: string | undefined,
  resolution: string,
  fromMs: number,
  toMs: number,
  step: number,
  key: string,
  signal?: AbortSignal,
): Promise<{ bars: MarketBar[]; clipped: boolean }> {
  const nowCeiling = Date.now() + DAY;
  const clampedToMs = Math.min(toMs, nowCeiling);
  let cursor = Math.floor(fromMs / DAY) * DAY;
  const end = Math.max(cursor + DAY, (Math.floor((clampedToMs - 1) / DAY) + 1) * DAY);
  const windowDays = Math.max(1, Math.floor((1000 * step) / DAY));
  const fetchedBars: MarketBar[] = [];
  let clipped = false;

  const reqSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(90_000)])
    : AbortSignal.timeout(90_000);

  for (let page = 0; page < MAX_PAGES / 2 && cursor < end && fetchedBars.length < MAX_BARS; page++) {
    const windowEnd = Math.min(end, cursor + windowDays * DAY);
    const params = new URLSearchParams({
      symbol,
      timeframe: resolution === "1M" ? "1mo" : resolution,
      start: utcDate(cursor),
      end: utcDate(windowEnd),
      order: "asc",
      limit: "5000",
    });
    if (dataset) params.set("dataset", dataset);
    const headPath = `/candles?${params}`;
    params.set("order", "desc");
    const pair = new AbortController();
    const pageSignal = AbortSignal.any([reqSignal, pair.signal]);
    let pages: unknown[];
    try {
      pages = await Promise.all([
        read(headPath, key, pageSignal),
        read(`/candles?${params}`, key, pageSignal),
      ]);
    } finally {
      pair.abort();
    }
    const [head, tail] = pages.map(parseLseBars) as [MarketBar[], MarketBar[]];
    const headTimes = new Set(head.map((b) => b.time));
    if (
      head.length !== tail.length ||
      (head.length > 0 && !tail.some((b) => headTimes.has(b.time)))
    ) {
      clipped = true;
    }

    const unique = new Map<number, MarketBar>();
    for (const b of [...head, ...tail]) {
      unique.set(b.time, b);
    }
    const rows = [...unique.values()].sort((a, b) => a.time - b.time);
    fetchedBars.push(...rows);
    cursor = windowEnd;
  }

  return { bars: fetchedBars, clipped };
}

async function fetchLseRangeWithFallback(
  symbol: string,
  dataset: string | undefined,
  resolution: string,
  fromMs: number,
  toMs: number,
  step: number,
  key: string,
  signal?: AbortSignal,
): Promise<{ bars: MarketBar[]; clipped: boolean }> {
  // Normalize legacy singular dataset names if passed from client cache
  const normDataset =
    dataset === "index"
      ? "indices"
      : dataset === "forex"
      ? "fx"
      : dataset === "commodity"
      ? ""
      : dataset;

  // 1. Try primary symbol + dataset
  try {
    const primary = await fetchLseRangeSingle(symbol, normDataset, resolution, fromMs, toMs, step, key, signal);
    if (primary.bars.length > 0) return primary;
  } catch (err) {
    if (!normDataset) throw err;
  }

  // 2. Retry without dataset parameter in case symbol is unique across LSE classes
  if (normDataset) {
    try {
      const noDs = await fetchLseRangeSingle(symbol, undefined, resolution, fromMs, toMs, step, key, signal);
      if (noDs.bars.length > 0) return noDs;
    } catch {}
  }

  // 3. If higher timeframe returned 0 bars, pull 1m bars and aggregate locally
  if (resolution !== "1m") {
    try {
      const base1m = await fetchLseRangeSingle(symbol, normDataset, "1m", fromMs, toMs, 60_000, key, signal);
      if (base1m.bars.length > 0) {
        saveCachedCandles(PROVIDER_ID, symbol, "1m", base1m.bars);
        return {
          bars: aggregateCandles(base1m.bars, resolution),
          clipped: base1m.clipped,
        };
      }
    } catch {}
  }

  return { bars: [], clipped: false };
}

export const londonStrategicEdge: MarketDataProvider = {
  id: "london-strategic-edge",
  name: "London Strategic Edge",
  environmentKey: "LSE_API_KEY",
  async test(key) {
    await read("/usage", key);
  },
  async history(request, key) {
    const step = RESOLUTIONS[request.resolution as keyof typeof RESOLUTIONS] ?? 60_000;
    const nowMs = Date.now();
    const firstBar = Math.floor(request.from / step) * step;
    const clampedTo = Math.min(request.to, nowMs + step);
    const lastBar = Math.max(firstBar + step, Math.floor((clampedTo - 1) / step) * step);

    // 1. Auto-normalize symbol and dataset (e.g. US500 -> SPX + indices, NAS100 -> NDX + indices)
    const mapped = resolveProviderSymbol(PROVIDER_ID, request.symbol);
    const symbol = mapped.symbol;
    const dataset = mapped.dataset || request.dataset || undefined;

    // 2. Check actual cached bars inside [firstBar, lastBar]
    const existingWindowBars = getCachedCandles(PROVIDER_ID, symbol, request.resolution, firstBar, lastBar);
    const maxWeekendGapMs = 68 * 3600_000;
    const windowStartCovered =
      existingWindowBars.length > 0 && existingWindowBars[0]!.time <= firstBar + maxWeekendGapMs;
    const windowEndCovered =
      existingWindowBars.length > 0 &&
      existingWindowBars[existingWindowBars.length - 1]!.time >= Math.min(lastBar, nowMs) - maxWeekendGapMs;

    if (windowStartCovered && windowEndCovered) {
      return {
        provider: this.name,
        symbol,
        resolution: request.resolution,
        bars: existingWindowBars,
        fetchedAt: new Date().toISOString(),
        truncated: false,
        warnings: [],
      };
    }

    // 3. Fetch missing range from LSE
    try {
      const fetchStart = windowStartCovered && existingWindowBars.length > 0
        ? existingWindowBars[existingWindowBars.length - 1]!.time
        : firstBar;
      const fetchEnd = windowEndCovered && existingWindowBars.length > 0
        ? existingWindowBars[0]!.time + step
        : lastBar + step;

      const res = await fetchLseRangeWithFallback(
        symbol,
        dataset,
        request.resolution,
        fetchStart,
        fetchEnd,
        step,
        key,
        request.signal
      );

      if (res.bars.length > 0) {
        saveCachedCandles(PROVIDER_ID, symbol, request.resolution, res.bars);
      }

      const eligible = getCachedCandles(PROVIDER_ID, symbol, request.resolution, firstBar, lastBar);
      return {
        provider: this.name,
        symbol,
        resolution: request.resolution,
        bars: eligible,
        fetchedAt: new Date().toISOString(),
        truncated: res.clipped,
        warnings: res.clipped ? ["Candle history reached provider limit for this window."] : [],
      };
    } catch (err: any) {
      if (existingWindowBars.length > 0) {
        return {
          provider: this.name,
          symbol,
          resolution: request.resolution,
          bars: existingWindowBars,
          fetchedAt: new Date().toISOString(),
          truncated: true,
          warnings: [`Network notice (${err?.message || "offline"}): Showing cached candles in range.`],
        };
      }
      throw err;
    }
  },
};
