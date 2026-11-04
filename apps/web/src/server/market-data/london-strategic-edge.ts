// apps/web/src/server/market-data/london-strategic-edge.ts
import { RESOLUTIONS, aggregateCandles, type MarketBar } from "@/lib/market-data";
import { MarketDataError, type MarketDataProvider } from "./provider";
import { readJson } from "./http";
import { resolveProviderSymbol } from "@/lib/symbol-mapping";
import {
  getCachedCandles,
  saveCachedCandles,
} from "./candle-db";

const V3_BASE = "https://download.londonstrategicedge.com/v3";
const VAULT_BASE = "https://api.londonstrategicedge.com/vault";
const PROVIDER_ID = "london-strategic-edge";
const MAX_PAGES = 80;
const MAX_BARS = 100_000;
const DAY = 86_400_000;
const utcDate = (time: number) => new Date(time).toISOString().slice(0, 10);

// LSE Data 3.0 enforces "One download at a time" per API key (429 exports-busy if concurrent).
// Queue v3 export requests sequentially in-process so parallel calls never collide!
let v3ExportQueue: Promise<any> = Promise.resolve();
function runSerializedV3Export<T>(task: () => Promise<T>): Promise<T> {
  const next = v3ExportQueue.then(task, task);
  v3ExportQueue = next.catch(() => {});
  return next;
}

export function normalizeLSESymbol(raw: string): { symbol: string; dataset?: string } {
  const mapped = resolveProviderSymbol("london-strategic-edge", raw);
  return { symbol: mapped.symbol, dataset: mapped.dataset || undefined };
}

function resolveV3MarketAndSymbol(dataset: string | undefined, rawSymbol: string): { market: string; v3Symbol: string } {
  const cleanSym = rawSymbol.trim().toUpperCase().replace(/\.IDX$/i, "");
  const d = (dataset || "").toLowerCase().trim();

  if (["SPX", "NDX", "DJI", "RUT", "VIX", "BUK100P", "BDE40P"].includes(cleanSym) || d === "indices" || d === "index") {
    return { market: "indices", v3Symbol: cleanSym };
  }
  if (cleanSym.startsWith("XAU/") || cleanSym.startsWith("XAG/") || cleanSym.includes("WTI") || cleanSym.includes("BCO") || d === "commodities" || d === "commodity") {
    return { market: "commodities", v3Symbol: cleanSym.replace("/", "_") };
  }
  if (/^[A-Z]{3}\/[A-Z]{3}$/.test(cleanSym) || d === "forex" || d === "fx") {
    return { market: "forex", v3Symbol: cleanSym.replace("/", "_") };
  }
  if (d === "crypto" || cleanSym.endsWith("USDT")) {
    return { market: "crypto", v3Symbol: cleanSym.replace("/", "") };
  }
  return { market: d || "indices", v3Symbol: cleanSym };
}

async function readVault(path: string, key: string, signal?: AbortSignal): Promise<unknown> {
  return readJson(
    `${VAULT_BASE}${path}`,
    {
      "X-API-Key": key,
      "x-api-key": key,
      "User-Agent": "lse-data/3.0",
    },
    signal,
    { timeoutMs: 60_000, cache: path !== "/usage" },
  );
}

export function parseLseBars(value: unknown): MarketBar[] {
  // Handle /v3/preview tabular format: { columns: ["ts", "open", ...], rows: [[...], [...]] }
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Array.isArray((value as any).columns) &&
    Array.isArray((value as any).rows) &&
    Array.isArray((value as any).rows[0])
  ) {
    const cols = ((value as any).columns as string[]).map((c) => String(c).toLowerCase().trim());
    const rawRows = (value as any).rows as unknown[][];
    const asObjects = rawRows.map((arr) => {
      const obj: Record<string, unknown> = {};
      cols.forEach((c, i) => {
        obj[c] = arr[i];
      });
      return obj;
    });
    return parseLseBars(asObjects);
  }

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
    const volume = (idxVol >= 0 ? Math.max(0, Number(cols[idxVol]) || 0) : 0) || (idxTrades >= 0 ? Math.max(0, Number(cols[idxTrades]) || 0) : 0);

    if (!Number.isFinite(time) || !Number.isFinite(open) || !Number.isFinite(close)) continue;
    const high = Number.isFinite(rawHigh) ? Math.max(open, close, rawHigh, rawLow) : Math.max(open, close);
    const low = Number.isFinite(rawLow) ? Math.min(open, close, rawLow, rawHigh) : Math.min(open, close);
    unique.set(time, { time, open, high, low, close, volume });
  }
  return [...unique.values()].sort((a, b) => a.time - b.time);
}

function decodeBodyToBars(text: string, contentType: string): MarketBar[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (contentType.includes("json") || trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const json = JSON.parse(trimmed);
      return parseLseBars(json);
    } catch {
      return [];
    }
  }
  return parseLseCsvBars(trimmed);
}

/**
 * LSE Data 3.0 Fetcher (`https://download.londonstrategicedge.com/v3`)
 * Supports:
 *  - Immediate 200 CSV/JSON stream from `/v3/export` or `/v3/slice`
 *  - Asynchronous 202 Job Polling (`/v3/jobs/{id}` -> `/v3/jobs/{id}/file`)
 */
async function fetchLseV3Range(
  market: string,
  v3Symbol: string,
  resolution: string,
  fromMs: number,
  toMs: number,
  key: string,
  signal?: AbortSignal,
): Promise<MarketBar[]> {
  return runSerializedV3Export(async () => {
    const tf = resolution === "1M" ? "1mo" : resolution;
    // In LSE Data 3.0, `to` (YYYY-MM-DD) is exclusive, so round up to the next UTC day boundary (up to tomorrow UTC)
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

    const symbolVariants = Array.from(
      new Set([
        v3Symbol,
        v3Symbol.replace(/\.IDX$/i, ""),
        `${v3Symbol.replace(/\.IDX$/i, "")}.IDX`,
      ])
    );

    for (const sym of symbolVariants) {
      for (const endpoint of ["/export", "/slice"]) {
        const params = new URLSearchParams({
          market,
          symbol: sym,
          timeframe: tf,
          from: fromStr,
          to: toStr,
          format: "csv",
        });

        try {
          const res = await fetch(`${V3_BASE}${endpoint}?${params}`, {
            headers,
            signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(45_000)]) : AbortSignal.timeout(45_000),
            cache: "no-store",
          });

          if (res.status === 200) {
            const ctype = res.headers.get("content-type") || "";
            const text = await res.text();
            const bars = decodeBodyToBars(text, ctype);
            if (bars.length > 0) return bars;
          } else if (res.status === 202) {
            // LSE Data 3.0 queued a background builder job -> poll /v3/jobs/{id} then download /v3/jobs/{id}/file
            const jobData = (await res.json().catch(() => ({}))) as Record<string, any>;
            const jobId = jobData.id || jobData.job_id || jobData.job?.id;
            if (jobId) {
              for (let poll = 0; poll < 25; poll++) {
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
                    const ctype = fileRes.headers.get("content-type") || "";
                    const text = await fileRes.text();
                    const bars = decodeBodyToBars(text, ctype);
                    if (bars.length > 0) return bars;
                  }
                  break;
                }
                if (["failed", "error", "cancelled", "refused"].includes(state)) {
                  break;
                }
              }
            }
          }
        } catch {}
      }
    }

    return [];
  });
}

async function fetchLseVaultRangeSingle(
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
  const { market, v3Symbol } = resolveV3MarketAndSymbol(dataset, symbol);

  // 1. For Indices / Stocks / Futures: Query LSE Data 3.0 (/v3/export & /v3/slice with 202 Job Polling) first!
  if (market === "indices" || market === "us_stocks" || market === "futures") {
    const v3Bars = await fetchLseV3Range(market, v3Symbol, resolution, fromMs, toMs, key, signal);
    if (v3Bars.length > 0) {
      return { bars: v3Bars, clipped: false };
    }
    if (resolution !== "1m") {
      const v3Bars1m = await fetchLseV3Range(market, v3Symbol, "1m", fromMs, toMs, key, signal);
      if (v3Bars1m.length > 0) {
        saveCachedCandles(PROVIDER_ID, symbol, "1m", v3Bars1m);
        return { bars: aggregateCandles(v3Bars1m, resolution), clipped: false };
      }
    }
  }

  // 2. For FX / Commodities (or fallback): Query /vault/candles
  const vaultCandidates =
    market === "indices"
      ? [`${v3Symbol}.IDX`, v3Symbol, `${v3Symbol}/USD`]
      : [symbol, v3Symbol];

  for (const cand of vaultCandidates) {
    try {
      const vaultRes = await fetchLseVaultRangeSingle(cand, undefined, resolution, fromMs, toMs, step, key, signal);
      if (vaultRes.bars.length > 0) return vaultRes;
    } catch {}
  }

  // 3. Fallback to /v3 for FX / Commodities if /vault was empty
  if (market !== "indices") {
    const v3Bars = await fetchLseV3Range(market, v3Symbol, resolution, fromMs, toMs, key, signal);
    if (v3Bars.length > 0) return { bars: v3Bars, clipped: false };
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
    const clampedTo = Math.min(request.to, nowMs + step);
    const lastBar = Math.max(firstBar + step, Math.floor((clampedTo - 1) / step) * step);

    const mapped = resolveProviderSymbol(PROVIDER_ID, request.symbol);
    const symbol = mapped.symbol;
    const dataset = mapped.dataset || request.dataset || undefined;

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
