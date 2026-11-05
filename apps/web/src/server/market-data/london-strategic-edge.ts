// apps/web/src/server/market-data/london-strategic-edge.ts
import { RESOLUTIONS, aggregateCandles, type MarketBar } from "@/lib/market-data";
import { MarketDataError, type MarketDataProvider } from "./provider";
import { readJson } from "./http";
import { resolveProviderSymbol } from "@/lib/symbol-mapping";
import {
  getCachedCandles,
  saveCachedCandles,
} from "./candle-db";

const VAULT_BASE = "https://api.londonstrategicedge.com/vault";
const V3_BASE = "https://download.londonstrategicedge.com/v3";
const PROVIDER_ID = "london-strategic-edge";
const MAX_PAGES = 80;
const MAX_BARS = 100_000;
const DAY = 86_400_000;
const utcDate = (time: number) => new Date(time).toISOString().slice(0, 10);

export function normalizeLSESymbol(raw: string): { symbol: string; dataset?: string } {
  const mapped = resolveProviderSymbol("london-strategic-edge", raw);
  return { symbol: mapped.symbol, dataset: mapped.dataset || undefined };
}

function getOpenMarketMsBetween(t1: number, t2: number): number {
  if (t2 <= t1) return 0;
  const step = 15 * 60_000;
  let openMs = 0;
  for (let t = t1; t < t2; t += step) {
    const d = new Date(t);
    const day = d.getUTCDay();
    const hr = d.getUTCHours();
    const isWeekendClosed =
      day === 6 ||
      (day === 5 && hr >= 21) ||
      (day === 0 && hr < 22);
    if (!isWeekendClosed) {
      openMs += Math.min(step, t2 - t);
    }
  }
  return openMs;
}

function computeMissingIntervals(
  existingBars: MarketBar[],
  firstBar: number,
  lastBar: number,
  stepMs: number,
  maxOpenGapMs: number
): Array<{ from: number; to: number }> {
  if (lastBar <= firstBar) return [];
  if (existingBars.length === 0) {
    return [{ from: firstBar, to: lastBar + stepMs }];
  }

  const missing: Array<{ from: number; to: number }> = [];
  const firstCached = existingBars[0]!.time;
  if (firstBar < firstCached && getOpenMarketMsBetween(firstBar, firstCached) > maxOpenGapMs) {
    missing.push({ from: firstBar, to: firstCached + stepMs });
  }

  for (let i = 1; i < existingBars.length; i++) {
    const prev = existingBars[i - 1]!.time;
    const curr = existingBars[i]!.time;
    if (curr - prev > 4 * 3600_000 && getOpenMarketMsBetween(prev, curr) > 4 * 3600_000) {
      missing.push({ from: prev, to: curr + stepMs });
    }
  }

  const lastCached = existingBars[existingBars.length - 1]!.time;
  if (lastBar > lastCached && getOpenMarketMsBetween(lastCached, lastBar) > maxOpenGapMs) {
    missing.push({ from: lastCached, to: lastBar + stepMs });
  }

  return missing;
}

async function readVault(path: string, key: string, signal?: AbortSignal): Promise<unknown> {
  return readJson(
    `${VAULT_BASE}${path}`,
    {
      "X-API-Key": key,
      "x-api-key": key,
      "User-Agent": "LuxAlgo-Trade-Journal/market-data",
    },
    signal,
    { timeoutMs: 60_000, cache: false },
  );
}

export function parseLseBars(value: unknown): MarketBar[] {
  const rows = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as any).rows)
    ? (value as any).rows
    : value && typeof value === "object" && Array.isArray((value as any).data)
    ? (value as any).data
    : value && typeof value === "object" && Array.isArray((value as any).candles)
    ? (value as any).candles
    : null;
  if (!rows) throw new MarketDataError("Unexpected market data response.");

  const unique = new Map<number, MarketBar>();
  for (const item of rows) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const raw = row.ts ?? row.timestamp ?? row.minute ?? row.time ?? row.t ?? row.date ?? row.datetime;
    let time = NaN;
    if (typeof raw === "number") {
      time = raw > 1e11 ? raw : raw * 1000;
    } else if (typeof raw === "string" && raw.trim()) {
      const stamp = raw.trim().replace(" ", "T");
      time = Date.parse(/[zZ]$|[+-]\d{2}:\d{2}$/.test(stamp) ? stamp : `${stamp}Z`);
    }
    const number = (v: unknown) =>
      typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
    const open = number(row.open ?? row.o ?? row.bid_open ?? row.mid_open ?? row.price);
    const close = number(row.close ?? row.c ?? row.bid_close ?? row.mid_close ?? row.value ?? row.price);
    const rawHigh = number(row.high ?? row.h ?? row.bid_high ?? row.mid_high ?? Math.max(open, close));
    const rawLow = number(row.low ?? row.l ?? row.bid_low ?? row.mid_low ?? Math.min(open, close));
    const volume = row.volume == null ? 0 : Math.max(0, number(row.volume ?? row.v ?? row.ticks) || 0);

    if (!Number.isFinite(time) || !Number.isFinite(open) || !Number.isFinite(close)) {
      continue;
    }
    const high = Number.isFinite(rawHigh) ? Math.max(open, close, rawHigh, rawLow || open) : Math.max(open, close);
    const low = Number.isFinite(rawLow) ? Math.min(open, close, rawLow, rawHigh || open) : Math.min(open, close);
    unique.set(time, { time, open, high, low, close, volume });
  }
  return [...unique.values()].sort((a, b) => a.time - b.time);
}

function parseLseCsvBars(csvText: string): MarketBar[] {
  const lines = csvText
    .trim()
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];

  const delim = lines[0]!.includes("\t") ? "\t" : ",";
  const headers = lines[0]!.split(delim).map((h) => h.trim().replace(/^["']|["']$/g, "").toLowerCase());
  const idxTime = headers.findIndex((h) =>
    ["ts", "timestamp", "time", "datetime", "date", "minute", "open_time"].includes(h)
  );
  const idxOpen = headers.findIndex((h) => ["open", "o", "mid_open", "bid_open", "price"].includes(h));
  const idxHigh = headers.findIndex((h) => ["high", "h", "mid_high", "bid_high"].includes(h));
  const idxLow = headers.findIndex((h) => ["low", "l", "mid_low", "bid_low"].includes(h));
  const idxClose = headers.findIndex((h) => ["close", "c", "mid_close", "bid_close", "value", "price"].includes(h));
  const idxVol = headers.findIndex((h) => ["volume", "v", "vol", "ticks", "tick_count"].includes(h));
  const idxTrades = headers.findIndex((h) => ["trades", "trade_count"].includes(h));

  if (idxTime === -1 || idxOpen === -1 || idxClose === -1) return [];

  const unique = new Map<number, MarketBar>();
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i]!.split(delim);
    const rawT = (cols[idxTime] || "").trim().replace(/^["']|["']$/g, "");
    if (!rawT) continue;
    let time = NaN;
    if (/^\d+(\.\d+)?$/.test(rawT)) {
      const n = Number(rawT);
      time = n > 1e14 ? Math.floor(n / 1_000_000) : n > 1e11 ? Math.floor(n) : Math.floor(n * 1000);
    } else {
      const stamp = rawT.replace(" ", "T");
      time = Date.parse(/[zZ]$|[+-]\d{2}:\d{2}$/.test(stamp) ? stamp : `${stamp}Z`);
    }
    const open = Number(cols[idxOpen]);
    const close = Number(cols[idxClose]);
    const rawHigh = idxHigh >= 0 ? Number(cols[idxHigh]) : Math.max(open, close);
    const rawLow = idxLow >= 0 ? Number(cols[idxLow]) : Math.min(open, close);
    const volume =
      (idxVol >= 0 ? Math.max(0, Number(cols[idxVol]) || 0) : 0) ||
      (idxTrades >= 0 ? Math.max(0, Number(cols[idxTrades]) || 0) : 0);

    if (!Number.isFinite(time) || !Number.isFinite(open) || !Number.isFinite(close)) continue;
    const high = Number.isFinite(rawHigh) ? Math.max(open, close, rawHigh, rawLow) : Math.max(open, close);
    const low = Number.isFinite(rawLow) ? Math.min(open, close, rawLow, rawHigh) : Math.min(open, close);
    unique.set(time, { time, open, high, low, close, volume });
  }
  return [...unique.values()].sort((a, b) => a.time - b.time);
}

async function fetchLseVaultRangeSingle(
  symbol: string,
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
    // Do NOT pass `dataset` to /vault/candles so XAU/USD and EUR/USD are never filtered out!
    const params = new URLSearchParams({
      symbol,
      timeframe: resolution === "1M" ? "1mo" : resolution,
      start: utcDate(cursor),
      end: utcDate(windowEnd),
      order: "asc",
      limit: "5000",
    });
    const headPath = `/candles?${params}`;
    params.set("order", "desc");
    const pair = new AbortController();
    const pageSignal = AbortSignal.any([reqSignal, pair.signal]);
    let pages: unknown[];
    try {
      pages = await Promise.all([
        readVault(headPath, key, pageSignal),
        readVault(`/candles?${params}`, key, pageSignal),
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

async function fetchLseV3Export(
  market: string,
  v3Symbol: string,
  resolution: string,
  fromMs: number,
  toMs: number,
  key: string,
  signal?: AbortSignal,
): Promise<MarketBar[]> {
  const tf = resolution === "1M" ? "1mo" : resolution;
  const maxExclusiveMs = Math.floor(Date.now() / DAY) * DAY + DAY;
  const roundedToMs = Math.min(maxExclusiveMs, (Math.floor((toMs - 1) / DAY) + 1) * DAY);
  const fromStr = utcDate(Math.floor(fromMs / DAY) * DAY);
  let toStr = utcDate(roundedToMs);
  if (toStr <= fromStr) {
    toStr = utcDate(Math.floor(fromMs / DAY) * DAY + DAY);
  }

  const headers: Record<string, string> = {
    "X-API-Key": key.trim(),
    "User-Agent": "lse-data/3.0",
  };

  const params = new URLSearchParams({
    market,
    symbol: v3Symbol,
    timeframe: tf,
    from: fromStr,
    to: toStr,
    format: "csv",
  });

  try {
    const res = await fetch(`${V3_BASE}/export?${params}`, {
      headers,
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(45_000)]) : AbortSignal.timeout(45_000),
      cache: "no-store",
    });
    if (res.status === 200) {
      const text = await res.text();
      return parseLseCsvBars(text);
    }
  } catch {}
  return [];
}

async function fetchLseSegment(
  symbol: string,
  dataset: string | undefined,
  resolution: string,
  fromMs: number,
  toMs: number,
  step: number,
  key: string,
  signal?: AbortSignal,
): Promise<{ bars: MarketBar[]; clipped: boolean }> {
  const isIndex = dataset === "indices" || ["SPX", "NDX", "DJI", "RUT", "VIX"].includes(symbol);

  // 1. For FX & Metals (XAU/USD, EUR/USD, GBP/USD): /vault/candles is live up to the current minute
  if (!isIndex) {
    try {
      const vaultRes = await fetchLseVaultRangeSingle(symbol, resolution, fromMs, toMs, step, key, signal);
      if (vaultRes.bars.length > 0) return vaultRes;
    } catch {}

    // If 15m/5m/1h returned 0 bars for recent window, pull 1m from /vault/candles and resample
    if (resolution !== "1m") {
      try {
        const vault1m = await fetchLseVaultRangeSingle(symbol, "1m", fromMs, toMs, 60_000, key, signal);
        if (vault1m.bars.length > 0) {
          saveCachedCandles(PROVIDER_ID, symbol, "1m", vault1m.bars);
          return {
            bars: aggregateCandles(vault1m.bars, resolution),
            clipped: vault1m.clipped,
          };
        }
      } catch {}
    }
  }

  // 2. For Indices (or fallback): /v3/export
  const v3Market = isIndex ? "indices" : symbol.startsWith("XAU/") || symbol.startsWith("XAG/") ? "commodities" : "forex";
  const v3Sym = isIndex ? symbol.replace(/\.IDX$/i, "") : symbol;
  const v3Bars = await fetchLseV3Export(v3Market, v3Sym, resolution, fromMs, toMs, key, signal);
  if (v3Bars.length > 0) {
    return { bars: v3Bars, clipped: false };
  }

  return { bars: [], clipped: false };
}

export const londonStrategicEdge: MarketDataProvider = {
  id: "london-strategic-edge",
  name: "London Strategic Edge",
  environmentKey: "LSE_API_KEY",
  async test(key) {
    await readVault("/usage", key);
  },
  async history(request, key) {
    const step = RESOLUTIONS[request.resolution as keyof typeof RESOLUTIONS] ?? 60_000;
    const nowMs = Date.now();
    const firstBar = Math.floor(request.from / step) * step;
    const clampedTo = Math.min(request.to, nowMs);
    const lastBar = Math.max(firstBar + step, Math.floor((clampedTo - 1) / step) * step);

    const mapped = resolveProviderSymbol(PROVIDER_ID, request.symbol);
    const symbol = mapped.symbol;
    const dataset = mapped.dataset || request.dataset || undefined;

    const existingWindowBars = getCachedCandles(PROVIDER_ID, symbol, request.resolution, firstBar, lastBar);
    const maxOpenGapMs = Math.max(3 * step, 45 * 60_000);
    const missingRanges = computeMissingIntervals(
      existingWindowBars,
      firstBar,
       Math.min(lastBar, nowMs - step),
      step,
      maxOpenGapMs
    );

    if (missingRanges.length === 0) {
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

    try {
      let clipped = false;
      for (const range of missingRanges) {
        const res = await fetchLseSegment(
          symbol,
          dataset,
          request.resolution,
          range.from,
          range.to,
          step,
          key,
          request.signal
        );
        if (res.bars.length > 0) {
          saveCachedCandles(PROVIDER_ID, symbol, request.resolution, res.bars);
        }
        if (res.clipped) clipped = true;
      }

      const eligible = getCachedCandles(PROVIDER_ID, symbol, request.resolution, firstBar, lastBar);
      return {
        provider: this.name,
        symbol,
        resolution: request.resolution,
        bars: eligible,
        fetchedAt: new Date().toISOString(),
        truncated: clipped,
        warnings: clipped ? ["Candle history reached provider limit for this window."] : [],
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
