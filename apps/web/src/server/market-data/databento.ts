import { RESOLUTIONS, type MarketBar, type Resolution } from "@/lib/market-data";
import { MarketDataError, type MarketDataProvider } from "./provider";
import {
  getCachedBounds,
  getCachedCandles,
  saveCachedCandles,
} from "./candle-db";

const DATABENTO_API_BASE = "https://hist.databento.com/v0";

// Helper to extract bare token from plain string, quoted string, or JSON payload
function resolveDatabentoKey(raw: unknown): string {
  if (!raw) return "";
  if (typeof raw === "object" && raw !== null) {
    const obj = raw as Record<string, unknown>;
    return String(obj.apiKey ?? obj.key ?? obj.token ?? "");
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed);
        return String(parsed.apiKey ?? parsed.key ?? parsed.token ?? trimmed);
      } catch {
        // Fall back to string handling if JSON parsing fails
      }
    }
    return trimmed.replace(/^["']|["']$/g, "");
  }
  return String(raw);
}

// Resamples 1-minute candles into higher intraday intervals (5m, 15m, 1h, 4h)
function resampleCandles(bars: MarketBar[], targetStepMs: number): MarketBar[] {
  if (targetStepMs <= 60_000 || bars.length === 0) return bars;

  const buckets = new Map<number, MarketBar[]>();

  for (const bar of bars) {
    const bucketTime = Math.floor(bar.time / targetStepMs) * targetStepMs;
    let bucket = buckets.get(bucketTime);
    if (!bucket) {
      bucket = [];
      buckets.set(bucketTime, bucket);
    }
    bucket.push(bar);
  }

  const resampled: MarketBar[] = [];

  for (const [time, bucketBars] of buckets.entries()) {
    if (bucketBars.length === 0) continue;
    bucketBars.sort((a, b) => a.time - b.time);

    const first = bucketBars[0];
    const last = bucketBars[bucketBars.length - 1];
    if (!first || !last) continue;

    let high = first.high;
    let low = first.low;
    let volume = 0;

    for (const b of bucketBars) {
      if (b.high > high) high = b.high;
      if (b.low < low) low = b.low;
      volume += b.volume || 0;
    }

    resampled.push({
      time,
      open: first.open,
      high,
      low,
      close: last.close,
      volume,
    });
  }

  return resampled.sort((a, b) => a.time - b.time);
}

// Normalize symbols for Databento futures / CME (GLBX.MDP3)
function normalizeDatabentoSymbol(rawSymbol: string): { symbol: string; defaultDataset: string } {
  const clean = rawSymbol
    .trim()
    .toUpperCase()
    .replace(/\.(RAW|PRO|ECN|STD)$/i, "")
    .replace(/_SB$/i, "");

  const map: Record<string, { symbol: string; defaultDataset: string }> = {
    "US500": { symbol: "ES.c.0", defaultDataset: "GLBX.MDP3" },
    "SPX500": { symbol: "ES.c.0", defaultDataset: "GLBX.MDP3" },
    "ES": { symbol: "ES.c.0", defaultDataset: "GLBX.MDP3" },
    "NAS100": { symbol: "NQ.c.0", defaultDataset: "GLBX.MDP3" },
    "USTEC": { symbol: "NQ.c.0", defaultDataset: "GLBX.MDP3" },
    "NQ": { symbol: "NQ.c.0", defaultDataset: "GLBX.MDP3" },
    "XAUUSD": { symbol: "GC.c.0", defaultDataset: "GLBX.MDP3" },
    "GOLD": { symbol: "GC.c.0", defaultDataset: "GLBX.MDP3" },
  };

  return map[clean] || { symbol: clean, defaultDataset: "GLBX.MDP3" };
}

// Fetch raw JSON range from Databento Historical HTTP API
async function fetchDatabentoRange(
  dataset: string,
  symbol: string,
  schema: string,
  fromMs: number,
  toMs: number,
  apiKey: string,
  signal?: AbortSignal,
): Promise<MarketBar[]> {
  const cleanKey = resolveDatabentoKey(apiKey);
  const startIso = new Date(fromMs).toISOString();
  const endIso = new Date(toMs).toISOString();

  const body = new URLSearchParams();
  body.set("dataset", dataset);
  body.set("symbols", symbol);
  body.set("schema", schema);
  body.set("start", startIso);
  body.set("end", endIso);
  body.set("encoding", "json");

  if (/\.[a-z]\.\d+$/i.test(symbol)) {
    body.set("stype_in", "continuous");
  }

  const authHeader = `Basic ${Buffer.from(`${cleanKey}:`).toString("base64")}`;

  const res = await fetch(`${DATABENTO_API_BASE}/timeseries.get_range`, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "LuxAlgo-Trade-Journal/market-data",
    },
    body: body.toString(),
    signal,
    cache: "no-store",
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new MarketDataError(`Databento API Error (${res.status}): ${errorText}`);
  }

  const rawText = await res.text();
  if (!rawText.trim()) return [];

  const lines = rawText
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const bars: MarketBar[] = [];

  for (const line of lines) {
    try {
      const rec = JSON.parse(line);
      const timeMs = Math.floor(Number(rec.hd?.ts_event ?? rec.ts_event) / 1_000_000);
      const open = typeof rec.open === "number" ? rec.open / 1e9 : Number(rec.open) / 1e9;
      const high = typeof rec.high === "number" ? rec.high / 1e9 : Number(rec.high) / 1e9;
      const low = typeof rec.low === "number" ? rec.low / 1e9 : Number(rec.low) / 1e9;
      const close = typeof rec.close === "number" ? rec.close / 1e9 : Number(rec.close) / 1e9;
      const volume = Number(rec.volume ?? 0);

      if (Number.isFinite(timeMs) && Number.isFinite(open)) {
        bars.push({
          time: timeMs,
          open,
          high,
          low,
          close,
          volume,
        });
      }
    } catch {
      // Ignore metadata headers
    }
  }

  return bars.sort((a, b) => a.time - b.time);
}

export const databento: MarketDataProvider = {
  id: "databento",
  name: "Databento",
  environmentKey: "DATABENTO_API_KEY",

  async test(key: string) {
    const cleanKey = resolveDatabentoKey(key);
    const authHeader = `Basic ${Buffer.from(`${cleanKey}:`).toString("base64")}`;
    const res = await fetch(`${DATABENTO_API_BASE}/metadata.list_datasets`, {
      headers: {
        Authorization: authHeader,
        "User-Agent": "LuxAlgo-Trade-Journal/market-data",
      },
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new MarketDataError(`Databento (${res.status}): ${errText || res.statusText}`);
    }
  },

  async history(request, key) {
    const cleanKey = resolveDatabentoKey(key);
    const { symbol: normSymbol, defaultDataset } = normalizeDatabentoSymbol(request.symbol);
    const dataset = request.dataset || defaultDataset;
    const providerKey = `databento:${dataset}`;
    const isDaily = request.resolution === "1d";

    // -------------------------------------------------------------------------
    // 1. Daily Path: Pull official ohlcv-1d directly from Databento
    // -------------------------------------------------------------------------
    if (isDaily) {
      const step = RESOLUTIONS["1d"];
      const firstBar = Math.floor(request.from / step) * step;
      const lastBar = Math.floor((request.to - 1) / step) * step;

      const { minTime, maxTime } = getCachedBounds(providerKey, normSymbol, "1d");
      const hasCache = minTime !== null && maxTime !== null;

      if (hasCache && minTime <= firstBar && maxTime >= lastBar) {
        const eligible = getCachedCandles(providerKey, normSymbol, "1d", firstBar, lastBar);
        return {
          provider: this.name,
          symbol: normSymbol,
          resolution: "1d",
          bars: eligible,
          fetchedAt: new Date().toISOString(),
          truncated: false,
          warnings: [],
        };
      }

      const newBars: MarketBar[] = [];

      try {
        if (!hasCache) {
          const fetched = await fetchDatabentoRange(
            dataset,
            normSymbol,
            "ohlcv-1d",
            firstBar,
            lastBar + step,
            cleanKey,
            request.signal,
          );
          newBars.push(...fetched);
        } else {
          if (firstBar < minTime) {
            const fetched = await fetchDatabentoRange(
              dataset,
              normSymbol,
              "ohlcv-1d",
              firstBar,
              minTime,
              cleanKey,
              request.signal,
            );
            newBars.push(...fetched);
          }
          if (lastBar > maxTime) {
            const fetched = await fetchDatabentoRange(
              dataset,
              normSymbol,
              "ohlcv-1d",
              maxTime,
              lastBar + step,
              cleanKey,
              request.signal,
            );
            newBars.push(...fetched);
          }
        }

        if (newBars.length > 0) {
          saveCachedCandles(providerKey, normSymbol, "1d", newBars);
        }

        const eligible = getCachedCandles(providerKey, normSymbol, "1d", firstBar, lastBar);
        return {
          provider: this.name,
          symbol: normSymbol,
          resolution: "1d",
          bars: eligible,
          fetchedAt: new Date().toISOString(),
          truncated: false,
          warnings: [],
        };
      } catch (err: any) {
        if (hasCache) {
          const eligible = getCachedCandles(providerKey, normSymbol, "1d", firstBar, lastBar);
          return {
            provider: this.name,
            symbol: normSymbol,
            resolution: "1d",
            bars: eligible,
            fetchedAt: new Date().toISOString(),
            truncated: true,
            warnings: ["Network unavailable: Showing offline cached daily candles from Databento."],
          };
        }
        throw err;
      }
    }

    // -------------------------------------------------------------------------
    // 2. Intraday Path: Use 1m cache as base, resample for 5m, 15m, 1h, 4h
    // -------------------------------------------------------------------------
    const targetStep = RESOLUTIONS[request.resolution];
    const windowStart = Math.floor(request.from / targetStep) * targetStep;
    const windowEnd = Math.ceil(request.to / targetStep) * targetStep;

    const step1m = RESOLUTIONS["1m"];
    const first1m = windowStart;
    const last1m = windowEnd - step1m;

    const { minTime, maxTime } = getCachedBounds(providerKey, normSymbol, "1m");
    const hasCache = minTime !== null && maxTime !== null;

    if (hasCache && minTime <= first1m && maxTime >= last1m) {
      const cached1m = getCachedCandles(providerKey, normSymbol, "1m", first1m, last1m);
      const resampled = request.resolution === "1m" ? cached1m : resampleCandles(cached1m, targetStep);
      return {
        provider: this.name,
        symbol: normSymbol,
        resolution: request.resolution,
        bars: resampled,
        fetchedAt: new Date().toISOString(),
        truncated: false,
        warnings: [],
      };
    }

    const newBars: MarketBar[] = [];

    try {
      if (!hasCache) {
        const fetched = await fetchDatabentoRange(
          dataset,
          normSymbol,
          "ohlcv-1m",
          first1m,
          last1m + step1m,
          cleanKey,
          request.signal,
        );
        newBars.push(...fetched);
      } else {
        if (first1m < minTime) {
          const fetched = await fetchDatabentoRange(
            dataset,
            normSymbol,
            "ohlcv-1m",
            first1m,
            minTime,
            cleanKey,
            request.signal,
          );
          newBars.push(...fetched);
        }
        if (last1m > maxTime) {
          const fetched = await fetchDatabentoRange(
            dataset,
            normSymbol,
            "ohlcv-1m",
            maxTime,
            last1m + step1m,
            cleanKey,
            request.signal,
          );
          newBars.push(...fetched);
        }
      }

      if (newBars.length > 0) {
        saveCachedCandles(providerKey, normSymbol, "1m", newBars);
      }

      const cached1m = getCachedCandles(providerKey, normSymbol, "1m", first1m, last1m);
      const resampled = request.resolution === "1m" ? cached1m : resampleCandles(cached1m, targetStep);

      return {
        provider: this.name,
        symbol: normSymbol,
        resolution: request.resolution,
        bars: resampled,
        fetchedAt: new Date().toISOString(),
        truncated: false,
        warnings: [],
      };
    } catch (err: any) {
      if (hasCache) {
        const cached1m = getCachedCandles(providerKey, normSymbol, "1m", first1m, last1m);
        const resampled = request.resolution === "1m" ? cached1m : resampleCandles(cached1m, targetStep);
        return {
          provider: this.name,
          symbol: normSymbol,
          resolution: request.resolution,
          bars: resampled,
          fetchedAt: new Date().toISOString(),
          truncated: true,
          warnings: ["Network unavailable: Showing offline cached candles from Databento."],
        };
      }
      throw err;
    }
  },
};