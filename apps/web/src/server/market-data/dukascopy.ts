import { getHistoricalRates, type Instrument } from "dukascopy-node";
import { RESOLUTIONS, type MarketBar } from "@/lib/market-data";
import { MarketDataError, type MarketDataProvider } from "./provider";
import { result } from "./http";

const DUKASCOPY_TIMEFRAME_MAP: Record<string, "m1" | "m5" | "m15" | "h1" | "d1"> = {
  "1m": "m1",
  "5m": "m5",
  "15m": "m15",
  "1h": "h1",
  "1d": "d1",
};

function normalizeDukascopySymbol(raw: string): { instrument: string; quote: string } {
  const clean = raw.trim().toUpperCase().replace(/\.(RAW|PRO|ECN|CASH|STD)$/i, "");

  // Indices
  if (["US500", "SPX500", "SPX", "USA500"].includes(clean)) return { instrument: "usa500idx", quote: "USD" };
  if (["US100", "NAS100", "USTECH", "USATECH", "NDX"].includes(clean)) return { instrument: "usatechidx", quote: "USD" };
  if (["US30", "DJI", "USA30"].includes(clean)) return { instrument: "usa30idx", quote: "USD" };
  if (["GER40", "DAX40", "DAX"].includes(clean)) return { instrument: "deuidx", quote: "EUR" };

  // Metals & Commodities
  if (["XAUUSD", "GOLD"].includes(clean)) return { instrument: "xauusd", quote: "USD" };
  if (["XAGUSD", "SILVER"].includes(clean)) return { instrument: "xagusd", quote: "USD" };
  if (["BRENT", "OIL", "USOIL"].includes(clean)) return { instrument: "brentcmdusd", quote: "USD" };

  // Standard Forex (EURUSD, GBPUSD, etc.)
  if (/^[A-Z]{6}$/.test(clean)) {
    return { instrument: clean.toLowerCase(), quote: clean.slice(3) };
  }

  return { instrument: clean.toLowerCase(), quote: "USD" };
}

export const dukascopy: MarketDataProvider = {
  id: "dukascopy",
  name: "Dukascopy",
  environmentKey: "",
  async test() {
    const res = await fetch("https://datafeed.dukascopy.com/datafeed/metadata/json", { method: "HEAD" });
    if (!res.ok && res.status !== 404) {
      throw new MarketDataError("Dukascopy public CDN unreachable.");
    }
  },
  async history(request) {
    const { instrument, quote } = normalizeDukascopySymbol(request.symbol);
    const timeframe = DUKASCOPY_TIMEFRAME_MAP[request.resolution];
    if (!timeframe) throw new MarketDataError(`Dukascopy does not support ${request.resolution} resolution.`);

    const step = RESOLUTIONS[request.resolution];
    const fromDate = new Date(Math.floor(request.from / step) * step);
    const toDate = new Date(Math.ceil(request.to / step) * step);

    let rates;
    try {
      rates = await getHistoricalRates({
        instrument: instrument as Instrument,
        dates: { from: fromDate, to: toDate },
        timeframe,
        format: "json",
        priceType: "bid",
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new MarketDataError(`Dukascopy download failed for ${instrument}: ${msg}`);
    }

    const bars: MarketBar[] = (rates || []).map((b) => ({
      time: Math.floor(b.timestamp / step) * step,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume ?? 0,
    }));

    return result(
      this.name,
      request,
      bars,
      false,
      [
        `Dukascopy public feed (${instrument}). Spot bid quotes, UTC-aligned. Reflects CFD cash price levels.`,
      ],
      quote,
    );
  },
};