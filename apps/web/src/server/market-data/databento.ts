import { RESOLUTIONS, aggregateCandles, type MarketBar } from "@/lib/market-data";
import { MarketDataError, type MarketDataProvider } from "./provider";
import { resolveProviderSymbol } from "@/lib/symbol-mapping";
import {
  getCachedCandles,
  saveCachedCandles,
} from "./candle-db";

const DATABENTO_API_BASE = "https://hist.databento.com/v0";
const MIN_LAG_MS = 20 * 60_000; // 20m safety buffer for Databento historical ingestion

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
 * Calculates how many milliseconds between [t1, t2] fall during open CME/FX market hours
 * (excludes Friday 21:00 UTC -> Sunday 22:00 UTC weekend closure).
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
    if (!isWeekendClosed) {
      openMs += Math.min(step, t2 - t);
    }
  }
  return openMs;
}

function hasInternalWeekdayGaps(bars: MarketBar[], maxOpenGapMs: number): boolean {
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1]!.time;
    const curr = bars[i]!.time;
    if (curr - prev > maxOpenGapMs) {
      if (getOpenMarketMsBetween(prev, curr) > maxOpenGapMs) {
        return true;
      }
    }
  }
  return false;
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
  const safeEndMs = Math.min(toMs, Date.now() - MIN_LAG_MS);
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

  // Automatic recovery if Databento reports 422 data_end_after_available_end
  if (res.status === 422) {
    const errorText = await res.text();
    try {
      const errJson = JSON.parse(errorText);
      const errCase = errJson?.detail?.case;
      const availEndStr = errJson?.detail?.payload?.available_end;
      if (errCase === "data_end_after_available_end" && typeof availEndStr === "string") {
        const availEndMs = Date.parse(availEndStr);
        if (Number.isFinite(availEndMs)) {
          if (fromMs >= availEndMs - 60_000) {
            // The requested delta is entirely after Databento's available_end; return empty delta cleanly
            return [];
          }
          res = await executeRequest(fromMs, availEndMs);
        }
      } else {
        throw new MarketDataError(`Databento API Error (422): ${errorText}`);
      }
    } catch (e) {
      if (e instanceof MarketDataError) throw e;
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

    const nowAvailableMs = Date.now() - MIN_LAG_MS;
    const clampedTo = Math.min(request.to, nowAvailableMs);

    // 1. Daily Path
    if (isDaily) {
      const step = RESOLUTIONS["1d"];
      const firstBar = Math.floor(request.from / step) * step;
      const lastBar = Math.max(firstBar, Math.floor((clampedTo - 1) / step) * step);

      const existing = getCachedCandles(providerKey, normSymbol, "1d", firstBar, lastBar);
      const startCovered =
        existing.length > 0 && getOpenMarketMsBetween(firstBar, existing[0]!.time) <= 2 * step;
      const endCovered =
        existing.length > 0 &&
        getOpenMarketMsBetween(existing[existing.length - 1]!.time, clampedTo) <= 2 * step;

      if (startCovered && endCovered && !hasInternalWeekdayGaps(existing, 4 * step)) {
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
        const fetched = await fetchDatabentoRange(
          dataset,
          normSymbol,
          "ohlcv-1d",
          firstBar,
          lastBar + step,
          cleanKey,
          request.signal,
        );
        if (fetched.length > 0) {
          saveCachedCandles(providerKey, normSymbol, "1d", fetched);
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

    // 2. Intraday Path: Store 1m base candles in SQLite, aggregate to requested resolution
    const targetStep = RESOLUTIONS[request.resolution as keyof typeof RESOLUTIONS] ?? 60_000;
    const windowStart = Math.floor(request.from / targetStep) * targetStep;
    const windowEnd = Math.max(windowStart + targetStep, Math.ceil(clampedTo / targetStep) * targetStep);

    const step1m = RESOLUTIONS["1m"];
    const first1m = windowStart;
    const last1m = Math.max(first1m, Math.min(windowEnd - step1m, nowAvailableMs));

    const existing1m = getCachedCandles(providerKey, normSymbol, "1m", first1m, last1m);
    const maxAllowedGapMs = 3 * 3600_000; // 3 hours of open-market time
    const startCovered =
      existing1m.length > 0 &&
      getOpenMarketMsBetween(first1m, existing1m[0]!.time) <= maxAllowedGapMs;
    const endCovered =
      existing1m.length > 0 &&
      getOpenMarketMsBetween(existing1m[existing1m.length - 1]!.time, last1m) <= 45 * 60_000;
    const hasGaps = hasInternalWeekdayGaps(existing1m, maxAllowedGapMs);

    if (startCovered && endCovered && !hasGaps) {
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

    const newBars: MarketBar[] = [];
    try {
      if (existing1m.length === 0 || hasGaps) {
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
        if (!startCovered) {
          const fetched = await fetchDatabentoRange(
            dataset,
            normSymbol,
            "ohlcv-1m",
            first1m,
            existing1m[0]!.time,
            cleanKey,
            request.signal,
          );
          newBars.push(...fetched);
        }
        if (!endCovered) {
          const fetched = await fetchDatabentoRange(
            dataset,
            normSymbol,
            "ohlcv-1m",
            existing1m[existing1m.length - 1]!.time,
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
      if (existing1m.length > 0) {
        const resampled =
          request.resolution === "1m" ? existing1m : aggregateCandles(existing1m, request.resolution);
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
