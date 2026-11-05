import { RESOLUTIONS, aggregateCandles, type MarketBar } from "@/lib/market-data";
import { MarketDataError, type MarketDataProvider } from "./provider";
import { resolveProviderSymbol } from "@/lib/symbol-mapping";
import {
  getCachedCandles,
  saveCachedCandles,
} from "./candle-db";

const DATABENTO_API_BASE = "https://hist.databento.com/v0";
const ONE_HOUR_MS = 3600_000;

// Remember Databento's reported available_end ceiling in-memory so subsequent requests don't hit 422 first
let cachedDatasetAvailableEndMs: number | null = null;

function getSafeDatabentoCeilingMs(): number {
  const oneHourAgo = Date.now() - ONE_HOUR_MS;
  if (cachedDatasetAvailableEndMs !== null && cachedDatasetAvailableEndMs < oneHourAgo) {
    return cachedDatasetAvailableEndMs;
  }
  return oneHourAgo;
}

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
      } catch {}
    }
    return trimmed.replace(/^["']|["']$/g, "");
  }
  return String(raw);
}

/**
 * Calculates how many milliseconds between [t1, t2] fall during open CME Globex hours
 * (excludes Friday 21:00 UTC -> Sunday 22:00 UTC weekend closure and daily 21:00-22:00 UTC maintenance).
 */
export function getOpenMarketMsBetween(t1: number, t2: number): number {
  if (t2 <= t1) return 0;
  const step = 15 * 60_000;
  let openMs = 0;
  for (let t = t1; t < t2; t += step) {
    const d = new Date(t);
    const day = d.getUTCDay(); // 0 = Sun, 5 = Fri, 6 = Sat
    const hr = d.getUTCHours();
    const isWeekendClosed =
      day === 6 ||
      (day === 5 && hr >= 21) ||
      (day === 0 && hr < 22);
    const isDailyMaintenance = hr === 21;
    if (!isWeekendClosed && !isDailyMaintenance) {
      openMs += Math.min(step, t2 - t);
    }
  }
  return openMs;
}

/**
 * Computes ONLY the uncached [startMs, endMs] sub-intervals inside [firstBar, lastBar]
 * so we NEVER re-download candles that are already in market_candles.db.
 */
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

  // 1. Missing Head (before first cached bar)
  const firstCached = existingBars[0]!.time;
  if (firstBar < firstCached && getOpenMarketMsBetween(firstBar, firstCached) > maxOpenGapMs) {
    missing.push({ from: firstBar, to: firstCached });
  }

  // 2. Missing Internal Gaps (only if gap during open market hours exceeds threshold)
  for (let i = 1; i < existingBars.length; i++) {
    const prev = existingBars[i - 1]!.time;
    const curr = existingBars[i]!.time;
    if (curr - prev > maxOpenGapMs && getOpenMarketMsBetween(prev, curr) > maxOpenGapMs) {
      missing.push({ from: prev + stepMs, to: curr });
    }
  }

  // 3. Missing Tail (after last cached bar up to lastBar)
  const lastCached = existingBars[existingBars.length - 1]!.time;
  if (lastBar > lastCached && getOpenMarketMsBetween(lastCached, lastBar) > maxOpenGapMs) {
    missing.push({ from: lastCached + stepMs, to: lastBar + stepMs });
  }

  return missing;
}

function parseDatabentoNdjson(rawText: string): MarketBar[] {
  if (!rawText.trim()) return [];
  const lines = rawText
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const unique = new Map<number, MarketBar>();
  for (const line of lines) {
    try {
      const rec = JSON.parse(line);
      const timeMs = Math.floor(Number(rec.hd?.ts_event ?? rec.ts_event) / 1_000_000);
      const open = typeof rec.open === "number" ? rec.open / 1e9 : Number(rec.open) / 1e9;
      const high = typeof rec.high === "number" ? rec.high / 1e9 : Number(rec.high) / 1e9;
      const low = typeof rec.low === "number" ? rec.low / 1e9 : Number(rec.low) / 1e9;
      const close = typeof rec.close === "number" ? rec.close / 1e9 : Number(rec.close) / 1e9;
      const volume = Number(rec.volume ?? 0);

      if (Number.isFinite(timeMs) && Number.isFinite(open) && Number.isFinite(close)) {
        unique.set(timeMs, {
          time: timeMs,
          open,
          high: Number.isFinite(high) ? Math.max(open, close, high) : Math.max(open, close),
          low: Number.isFinite(low) ? Math.min(open, close, low) : Math.min(open, close),
          close,
          volume: Number.isFinite(volume) ? Math.max(0, volume) : 0,
        });
      }
    } catch {}
  }
  return [...unique.values()].sort((a, b) => a.time - b.time);
}

function extractAvailableEndMsFrom422(errorText: string): number | null {
  try {
    const errJson = JSON.parse(errorText);
    const availEndStr =
      errJson?.detail?.payload?.available_end ??
      errJson?.payload?.available_end;
    if (typeof availEndStr === "string") {
      const ms = Date.parse(availEndStr);
      if (Number.isFinite(ms)) return ms - 60_000;
    }
  } catch {}
  const match = errorText.match(/before\s+(\d{4}-\d{2}-\d{2}T[0-9:.]+Z)/i);
  if (match && match[1]) {
    const ms = Date.parse(match[1]);
    if (Number.isFinite(ms)) return ms - 60_000;
  }
  return null;
}

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
  const safeEndMs = Math.min(toMs, getSafeDatabentoCeilingMs());
  if (fromMs >= safeEndMs - 60_000) {
    return [];
  }

  const executeRequest = async (startMs: number, endMs: number): Promise<Response> => {
    const body = new URLSearchParams();
    body.set("dataset", dataset);
    body.set("symbols", symbol);
    body.set("schema", schema);
    body.set("start", new Date(startMs).toISOString());
    body.set("end", new Date(endMs).toISOString());
    body.set("encoding", "json");

    if (/\.[a-z]\.\d+$/i.test(symbol)) {
      body.set("stype_in", "continuous");
    }

    const authHeader = `Basic ${Buffer.from(`${cleanKey}:`).toString("base64")}`;
    return fetch(`${DATABENTO_API_BASE}/timeseries.get_range`, {
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
  };

  let res = await executeRequest(fromMs, safeEndMs);

  // Foolproof recovery for ANY 422 license/range embargo (`dataset_unavailable_range` or `data_end_after_available_end`)
  if (res.status === 422) {
    const errorText = await res.text();
    const availEndMs = extractAvailableEndMsFrom422(errorText);
    if (availEndMs !== null) {
      cachedDatasetAvailableEndMs = availEndMs;
      if (fromMs >= availEndMs - 60_000) {
        return [];
      }
      res = await executeRequest(fromMs, availEndMs);
    } else {
      throw new MarketDataError(`Databento API Error (422): ${errorText}`);
    }
  }

  if (!res.ok) {
    const errorText = await res.text();
    throw new MarketDataError(`Databento API Error (${res.status}): ${errorText}`);
  }

  const rawText = await res.text();
  return parseDatabentoNdjson(rawText);
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
    const mapped = resolveProviderSymbol("databento", request.symbol);
    const normSymbol = mapped.symbol;
    const dataset = request.dataset || mapped.dataset || "GLBX.MDP3";
    const providerKey = `databento:${dataset}`;
    const isDaily = request.resolution === "1d";

    // Clamp `to` to at least 1 hour before current time (or Databento's known license ceiling)
    const ceilingMs = getSafeDatabentoCeilingMs();
    const clampedTo = Math.min(request.to, ceilingMs);

    // 1. Daily Path
    if (isDaily) {
      const step = RESOLUTIONS["1d"];
      const firstBar = Math.floor(request.from / step) * step;
      const lastBar = Math.max(firstBar, Math.floor((clampedTo - 1) / step) * step);

      const existing = getCachedCandles(providerKey, normSymbol, "1d", firstBar, lastBar);
      const missingRanges = computeMissingIntervals(existing, firstBar, lastBar, step, 2 * step);

      if (missingRanges.length === 0) {
        return {
          provider: this.name,
          symbol: normSymbol,
          resolution: "1d",
          bars: existing,
          fetchedAt: new Date().toISOString(),
          truncated: false,
          warnings: [],
        };
      }

      try {
        for (const range of missingRanges) {
          const fetched = await fetchDatabentoRange(
            dataset,
            normSymbol,
            "ohlcv-1d",
            range.from,
            range.to,
            cleanKey,
            request.signal,
          );
          if (fetched.length > 0) {
            saveCachedCandles(providerKey, normSymbol, "1d", fetched);
          }
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
        if (existing.length > 0) {
          return {
            provider: this.name,
            symbol: normSymbol,
            resolution: "1d",
            bars: existing,
            fetchedAt: new Date().toISOString(),
            truncated: true,
            warnings: ["Showing cached daily candles from Databento."],
          };
        }
        throw err;
      }
    }

    // 2. Intraday Path: Check 1m SQLite cache first and ONLY fetch missing sub-intervals
    const targetStep = RESOLUTIONS[request.resolution as keyof typeof RESOLUTIONS] ?? 60_000;
    const windowStart = Math.floor(request.from / targetStep) * targetStep;
    const windowEnd = Math.max(windowStart + targetStep, Math.ceil(clampedTo / targetStep) * targetStep);

    const step1m = RESOLUTIONS["1m"];
    const first1m = windowStart;
    const last1m = Math.max(first1m, Math.min(windowEnd - step1m, getSafeDatabentoCeilingMs()));

    const existing1m = getCachedCandles(providerKey, normSymbol, "1m", first1m, last1m);
    const missingRanges = computeMissingIntervals(
      existing1m,
      first1m,
      last1m,
      step1m,
      2 * 3600_000 // Only fetch if > 2 hours of open-market data is missing
    );

    if (missingRanges.length === 0) {
      const resampled =
        request.resolution === "1m" ? existing1m : aggregateCandles(existing1m, request.resolution);
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

    try {
      for (const range of missingRanges) {
        const effectiveTo = Math.min(range.to, getSafeDatabentoCeilingMs());
        if (range.from >= effectiveTo - 60_000) continue;
        const fetched = await fetchDatabentoRange(
          dataset,
          normSymbol,
          "ohlcv-1m",
          range.from,
          effectiveTo,
          cleanKey,
          request.signal,
        );
        if (fetched.length > 0) {
          saveCachedCandles(providerKey, normSymbol, "1m", fetched);
        }
      }

      const final1m = getCachedCandles(providerKey, normSymbol, "1m", first1m, last1m);
      const resampled =
        request.resolution === "1m" ? final1m : aggregateCandles(final1m, request.resolution);

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
      const fallback1m = getCachedCandles(providerKey, normSymbol, "1m", first1m, last1m);
      if (fallback1m.length > 0) {
        const resampled =
          request.resolution === "1m" ? fallback1m : aggregateCandles(fallback1m, request.resolution);
        return {
          provider: this.name,
          symbol: normSymbol,
          resolution: request.resolution,
          bars: resampled,
          fetchedAt: new Date().toISOString(),
          truncated: true,
          warnings: [`Showing cached Databento candles (${err?.message || "offline"}).`],
        };
      }
      throw err;
    }
  },
};
