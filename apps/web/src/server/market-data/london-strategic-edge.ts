// apps/web/src/server/market-data/london-strategic-edge.ts
import { RESOLUTIONS, type MarketBar } from "@/lib/market-data";
import { MarketDataError, type MarketDataProvider } from "./provider";
import { readJson } from "./http";
import { resolveProviderSymbol } from "@/lib/symbol-mapping";
import {
  getCachedBounds,
  getCachedCandles,
  saveCachedCandles,
} from "./candle-db";

const BASE = "https://api.londonstrategicedge.com/vault";
const PROVIDER_ID = "london-strategic-edge";
const MAX_PAGES = 80;
const MAX_BARS = 100_000;
const DAY = 86_400_000;
const utcDate = (time: number) => new Date(time).toISOString().slice(0, 10);

// --- Symbol Normalization ---
export function normalizeLSESymbol(raw: string): { symbol: string; dataset?: string } {
  const clean = raw
    .trim()
    .toUpperCase()
    .replace(/\.(RAW|PRO|ECN|STD)$/i, "")
    .replace(/_SB$/i, "")
    .replace(/\.M$/i, "");

  const map: Record<string, { symbol: string; dataset?: string }> = {
    "US500": { symbol: "US500", dataset: "indices" },
    "SPX500": { symbol: "US500", dataset: "indices" },
    "SPX": { symbol: "US500", dataset: "indices" },
    "ES": { symbol: "ES", dataset: "futures" },
    "NAS100": { symbol: "NAS100", dataset: "indices" },
    "USTEC": { symbol: "NAS100", dataset: "indices" },
    "NDX": { symbol: "NAS100", dataset: "indices" },
    "NQ": { symbol: "NQ", dataset: "futures" },
    "EURUSD": { symbol: "EUR/USD", dataset: "forex" },
    "GBPUSD": { symbol: "GBP/USD", dataset: "forex" },
    "USDJPY": { symbol: "USD/JPY", dataset: "forex" },
    "AUDUSD": { symbol: "AUD/USD", dataset: "forex" },
    "USDCAD": { symbol: "USD/CAD", dataset: "forex" },
    "USDCHF": { symbol: "USD/CHF", dataset: "forex" },
    "NZDUSD": { symbol: "NZD/USD", dataset: "forex" },
    "XAUUSD": { symbol: "XAU/USD", dataset: "commodities" },
    "GOLD": { symbol: "XAU/USD", dataset: "commodities" },
    "BTCUSD": { symbol: "BTC/USD", dataset: "crypto" },
    "ETHUSD": { symbol: "ETH/USD", dataset: "crypto" },
  };

  return map[clean] || { symbol: clean };
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
  const bars = value.map((item: unknown) => {
    if (!item || typeof item !== "object") throw new MarketDataError("Invalid market data candle.");
    const row = item as Record<string, unknown>;
    const raw = row.ts ?? row.timestamp ?? row.minute;
    const stamp = typeof raw === "string" ? raw.replace(" ", "T") : "";
    const time = Date.parse(/[zZ]$\vert{}[+-]\d{2}:\d{2}$/.test(stamp) ? stamp : `${stamp}Z`);
    const number = (v: unknown) =>
      typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
    const bar = {
      time,
      open: number(row.open),
      high: number(row.high),
      low: number(row.low),
      close: number(row.close),
      volume: row.volume == null ? 0 : number(row.volume),
    };
    if (
      !Object.values(bar).every(Number.isFinite) ||
      bar.volume < 0 ||
      bar.low > Math.min(bar.open, bar.close) ||
      bar.high < Math.max(bar.open, bar.close) ||
      bar.low > bar.high
    ) {
      throw new MarketDataError("Invalid market data candle. Estimates were not calculated.");
    }
    return bar;
  });
  const unique = new Map<number, MarketBar>();
  for (const bar of bars) {
    unique.set(bar.time, bar);
  }
  return [...unique.values()].sort((a, b) => a.time - b.time);
}

// Fetch a range directly from LSE API with pagination and dual-order verification
async function fetchLseRange(
  symbol: string,
  dataset: string | undefined,
  resolution: string,
  fromMs: number,
  toMs: number,
  step: number,
  key: string,
  signal?: AbortSignal,
): Promise<{ bars: MarketBar[]; clipped: boolean }> {
  let cursor = Math.floor(fromMs / DAY) * DAY;
  const end = (Math.floor((toMs - 1) / DAY) + 1) * DAY;
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
      timeframe: resolution,
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

export const londonStrategicEdge: MarketDataProvider = {
  id: "london-strategic-edge",
  name: "London Strategic Edge",
  environmentKey: "LSE_API_KEY",
  async test(key) {
    await read("/usage", key);
  },
  async history(request, key) {
    const step = RESOLUTIONS[request.resolution];
    const firstBar = Math.floor(request.from / step) * step;
    const lastBar = Math.floor((request.to - 1) / step) * step;

    // 1. Auto-normalize symbol and dataset
    const mapped = resolveProviderSymbol(PROVIDER_ID, request.symbol);
    const symbol = mapped.symbol;
    const dataset = request.dataset || mapped.dataset || undefined;

    // 2. Query SQLite cache boundaries
    const { minTime, maxTime } = getCachedBounds(PROVIDER_ID, symbol, request.resolution);
    const hasCache = minTime !== null && maxTime !== null;

    // 3. Complete Cache Hit: return directly from SQLite
    if (hasCache && minTime <= firstBar && maxTime >= lastBar) {
      const eligible = getCachedCandles(PROVIDER_ID, symbol, request.resolution, firstBar, lastBar);
      return {
        provider: this.name,
        symbol,
        resolution: request.resolution,
        bars: eligible,
        fetchedAt: new Date().toISOString(),
        truncated: false,
        warnings: [],
      };
    }

    // 4. Incremental Download for missing ranges
    const newBars: MarketBar[] = [];
    let clipped = false;

    try {
      if (!hasCache) {
        const res = await fetchLseRange(symbol, dataset, request.resolution, firstBar, lastBar + step, step, key, request.signal);
        newBars.push(...res.bars);
        clipped = res.clipped;
      } else {
        // Earlier range missing (e.g. +5d context expansion)
        if (firstBar < minTime) {
          const res = await fetchLseRange(symbol, dataset, request.resolution, firstBar, minTime, step, key, request.signal);
          newBars.push(...res.bars);
          if (res.clipped) clipped = true;
        }
        // Later range missing
        if (lastBar > maxTime) {
          const res = await fetchLseRange(symbol, dataset, request.resolution, maxTime, lastBar + step, step, key, request.signal);
          newBars.push(...res.bars);
          if (res.clipped) clipped = true;
        }
      }

      // 5. Save delta rows into SQLite
      if (newBars.length > 0) {
        saveCachedCandles(PROVIDER_ID, symbol, request.resolution, newBars);
      }

      // 6. Query final bounded result from SQLite
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
      // Offline fallback: if network fails, return whatever is already cached in SQLite
      if (hasCache) {
        const eligible = getCachedCandles(PROVIDER_ID, symbol, request.resolution, firstBar, lastBar);
        return {
          provider: this.name,
          symbol,
          resolution: request.resolution,
          bars: eligible,
          fetchedAt: new Date().toISOString(),
          truncated: true,
          warnings: ["Network unavailable: Showing offline cached candles from SQLite."],
        };
      }
      throw err;
    }
  },
};