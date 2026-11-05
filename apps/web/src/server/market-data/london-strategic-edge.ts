// apps/web/src/server/market-data/london-strategic-edge.ts
import { RESOLUTIONS, aggregateCandles, type MarketBar } from "@/lib/market-data";
import { MarketDataError, type MarketDataProvider } from "./provider";
import { readJson } from "./http";
import { resolveProviderSymbol, isUsIndexSymbol } from "@/lib/symbol-mapping";
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
  // CRITICAL: Only send single lowercase "x-api-key" header so Node Undici never doubles the key!
  return readJson(
    `${VAULT_BASE}${path}`,
    {
      "x-api-key": key.trim(),
      "User-Agent": "LuxAlgo-Trade-Journal/market-data",
    },
    signal,
    { timeoutMs: 60_000, cache: path !== "/usage" },
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

/**
 * Fetches candles from `/vault/candles` using optimal 5,000-bar chunks
 * (3 days per request for 1m, 16 days per request for 5m, 50 days for 15m).
 */
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
  // 4,800 bars per window fits comfortably inside limit=5000 with a single `order=asc` call!
  const windowDays = Math.max(1, Math.min(60, Math.floor((4800 * step) / DAY)));
  const fetchedBars: MarketBar[] = [];
  let clipped = false;

  const reqSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(90_000)])
    : AbortSignal.timeout(90_000);

  for (let page = 0; page < MAX_PAGES && cursor < end && fetchedBars.length < MAX_BARS; page++) {
    const windowEnd = Math.min(end, cursor + windowDays * DAY);
    const params = new URLSearchParams({
      symbol,
      timeframe: resolution === "1M" ? "1mo" : resolution,
      start: utcDate(cursor),
      end: utcDate(windowEnd),
      order: "asc",
      limit: "5000",
    });
    const rawPage = await readVault(`/candles?${params}`, key, reqSignal);
    const rows = parseLseBars(rawPage);
    if (rows.length >= 5000) {
      clipped = true;
    }
    fetchedBars.push(...rows);
    cursor = windowEnd;
  }

  const unique = new Map<number, MarketBar>();
  for (const b of fetchedBars) {
    unique.set(b.time, b);
  }
  return {
    bars: [...unique.values()].sort((a, b) => a.time - b.time),
    clipped,
  };
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
    if (res.status === 202) {
      const jobData = (await res.json().catch(() => ({}))) as Record<string, any>;
      const jobId = jobData.id || jobData.job_id || jobData.job?.id;
      if (jobId) {
        for (let poll = 0; poll < 20; poll++) {
          await new Promise((r) => setTimeout(r, 1200));
          const jobRes = await fetch(`${V3_BASE}/jobs/${encodeURIComponent(String(jobId))}`, {
            headers,
            cache: "no-store",
          });
          if (!jobRes.ok) break;
          const statusObj = (await jobRes.json().catch(() => ({}))) as Record<string, any>;
          const state = String(statusObj.state || statusObj.status || "").toLowerCase();
          if (["ready", "completed", "done", "finished", "succeeded"].includes(state)) {
            const fileRes = await fetch(`${V3_BASE}/jobs/${encodeURIComponent(String(jobId))}/file`, {
              headers,
              cache: "no-store",
            });
            if (fileRes.ok) {
              const text = await fileRes.text();
              return parseLseCsvBars(text);
            }
            break;
          }
          if (["failed", "error", "cancelled", "refused"].includes(state)) break;
        }
      }
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
  let lastErr: unknown = null;

  // 1. For FX & Metals (EUR/USD, GBP/USD, XAU/USD): /vault/candles is live up to the current minute
  if (!isIndex) {
    try {
      const vaultRes = await fetchLseVaultRangeSingle(symbol, resolution, fromMs, toMs, step, key, signal);
      if (vaultRes.bars.length > 0) return vaultRes;
    } catch (err) {
      lastErr = err;
    }

    // If higher timeframe had 0 bars on /vault/candles, check or fetch 1m and resample
    if (resolution !== "1m") {
      const cached1m = getCachedCandles(PROVIDER_ID, symbol, "1m", fromMs, toMs);
      if (cached1m.length > 0 && getOpenMarketMsBetween(cached1m[cached1m.length - 1]!.time, toMs) <= 2 * step) {
        return {
          bars: aggregateCandles(cached1m, resolution),
          clipped: false,
        };
      }
      try {
        const vault1m = await fetchLseVaultRangeSingle(symbol, "1m", fromMs, toMs, 60_000, key, signal);
        if (vault1m.bars.length > 0) {
          saveCachedCandles(PROVIDER_ID, symbol, "1m", vault1m.bars);
          return {
            bars: aggregateCandles(vault1m.bars, resolution),
            clipped: vault1m.clipped,
          };
        }
      } catch (err) {
        if (!lastErr) lastErr = err;
      }
    }
  }

  // 2. Fallback to LSE Data 3.0 (/v3/export)
  const v3Market = isIndex ? "indices" : symbol.startsWith("XAU/") || symbol.startsWith("XAG/") ? "commodities" : "forex";
  const v3Sym = isIndex ? symbol.replace(/\.IDX$/i, "") : symbol;
  const v3Bars = await fetchLseV3Export(v3Market, v3Sym, resolution, fromMs, toMs, key, signal);
  if (v3Bars.length > 0) {
    return { bars: v3Bars, clipped: false };
  }

  if (lastErr) throw lastErr;
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

    if (isUsIndexSymbol(request.symbol)) {
      throw new MarketDataError("US Indices exclusively use Databento (23/5 Globex) to prevent mixing RTH-only LSE data.");
    }
    const mapped = resolveProviderSymbol(PROVIDER_ID, request.symbol);
    const symbol = mapped.symbol;
    const dataset = mapped.dataset || request.dataset || undefined;

    let existingWindowBars = getCachedCandles(PROVIDER_ID, symbol, request.resolution, firstBar, lastBar);

    // If native resolution cache is empty for this window but 1m cache exists in SQLite, seed from 1m!
    if (existingWindowBars.length === 0 && request.resolution !== "1m") {
      const cached1m = getCachedCandles(PROVIDER_ID, symbol, "1m", firstBar, lastBar);
      if (cached1m.length > 0) {
        const resampled = aggregateCandles(cached1m, request.resolution);
        if (resampled.length > 0) {
          saveCachedCandles(PROVIDER_ID, symbol, request.resolution, resampled);
          existingWindowBars = getCachedCandles(PROVIDER_ID, symbol, request.resolution, firstBar, lastBar);
        }
      }
    }

    const maxOpenGapMs = Math.max(3 * step, 30 * 60_000);
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
