/** Provider-neutral candles. Time is the UTC bar-open timestamp in milliseconds. */
export interface MarketBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export const RESOLUTIONS = {
  "1m": 60_000,
  "3m": 180_000,
  "4m": 240_000,
  "5m": 300_000,
  "15m": 900_000,
  "30m": 1_800_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "7h": 25_200_000,
  "1d": 86_400_000,
  "1w": 604_800_000,
  "1M": 2_592_000_000,
} as const;

export type StandardResolution = keyof typeof RESOLUTIONS;
export type Resolution = StandardResolution;

export const isResolution = (value: unknown): value is Resolution =>
  typeof value === "string" && (Object.hasOwn(RESOLUTIONS, value) || /^\d+[mhdDwWM]$/.test(value));

export function getResolutionMs(res: string): number {
  if (res in RESOLUTIONS) return RESOLUTIONS[res as StandardResolution];
  const match = res.match(/^(\d+)([mhdDwWM])$/);
  if (!match) return 60_000;
  const num = parseInt(match[1]!, 10);
  const unit = match[2]!.toLowerCase();
  if (unit === "m") return num * 60_000;
  if (unit === "h") return num * 3_600_000;
  if (unit === "d") return num * 86_400_000;
  if (unit === "w") return num * 604_800_000;
  return num * 60_000;
}

export const parseCustomResolutionMs = getResolutionMs;

/**
 * Resamples granular 1m/5m/1h bars into any target timeframe (3m, 4m, 30m, 7h, etc.)
 */
export function aggregateCandles(bars: MarketBar[], targetResolution: string): MarketBar[] {
  const stepMs = getResolutionMs(targetResolution);
  if (!bars.length || stepMs <= 60_000) return bars;

  const buckets = new Map<number, MarketBar[]>();
  for (const bar of bars) {
    const bucketTime = Math.floor(bar.time / stepMs) * stepMs;
    const existing = buckets.get(bucketTime);
    if (existing) existing.push(bar);
    else buckets.set(bucketTime, [bar]);
  }

  const aggregated: MarketBar[] = [];
  for (const [time, bucket] of buckets.entries()) {
    if (!bucket.length) continue;
    bucket.sort((a, b) => a.time - b.time);
    const open = bucket[0]!.open;
    const close = bucket[bucket.length - 1]!.close;
    let high = -Infinity;
    let low = Infinity;
    let volume = 0;
    for (const b of bucket) {
      if (b.high > high) high = b.high;
      if (b.low < low) low = b.low;
      volume += b.volume || 0;
    }
    aggregated.push({ time, open, high, low, close, volume });
  }

  return aggregated.sort((a, b) => a.time - b.time);
}

export interface MarketConnection {
  id: string;
  name: string;
  configured: boolean;
  source: "environment" | "saved" | "public" | "uploaded" | null;
}

export interface MarketHistory {
  quoteCurrency?: string;
  datasetId?: string;
  provider: string;
  symbol: string;
  resolution: Resolution;
  bars: MarketBar[];
  fetchedAt: string;
  truncated: boolean;
  warnings: string[];
}

export interface ExcursionEstimate {
  priceBasisMismatch?: boolean;
  mae: number | null;
  mfe: number | null;
  sampledBars: number;
  excludedBars: number;
  warnings: string[];
}

export interface TradeMarketResult extends MarketHistory {
  estimate: ExcursionEstimate;
}
