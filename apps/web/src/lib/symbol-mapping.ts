export interface MappedInstrument {
  symbol: string;
  dataset: string;
}

export const PRESET_TRADING_SYMBOLS = [
  { value: "NAS100", label: "NAS100 (US Tech 100 · LSE: NDX)" },
  { value: "US500", label: "US500 (US 500 · LSE: SPX)" },
  { value: "XAUUSD", label: "XAUUSD (Gold · LSE: XAU/USD)" },
  { value: "EURUSD", label: "EURUSD (Euro / USD · LSE: EUR/USD)" },
  { value: "GBPUSD", label: "GBPUSD (British Pound / USD · LSE: GBP/USD)" },
] as const;

/** Clean MT5 broker suffixes (.raw, .pro, .ecn, _SB, micro, .IDX, etc.) */
export function cleanBrokerSymbol(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/\.(RAW|PRO|ECN|STD|MICRO|M|CASH|IDX)$/i, "")
    .replace(/(_SB|[\+\#\.\-])$/i, "")
    .trim();
}

/**
 * Resolves the provider's exact catalog symbol and dataset (market folder).
 */
export function resolveProviderSymbol(providerId: string, rawTradeSymbol: string): MappedInstrument {
  const clean = cleanBrokerSymbol(rawTradeSymbol);
  const baseKey = clean.replace(/\.IDX$/i, "").replace(/[\s\/\_]/g, "");

  // 1. London Strategic Edge Data 3.0 Mapping
  if (providerId === "london-strategic-edge") {
    const indices: Record<string, string> = {
      // S&P 500 -> market: indices, symbol: SPX
      "US500": "SPX",
      "SPX500": "SPX",
      "SPX500USD": "SPX",
      "US500USD": "SPX",
      "SPX": "SPX",
      "ES": "SPX",
      "MES": "SPX",
      // Nasdaq 100 -> market: indices, symbol: NDX
      "NAS100": "NDX",
      "NAS100USD": "NDX",
      "USTEC": "NDX",
      "USTECUSD": "NDX",
      "USTECH100": "NDX",
      "NDX": "NDX",
      "NQ": "NDX",
      "MNQ": "NDX",
      // Dow Jones 30 -> market: indices, symbol: DJI
      "US30": "DJI",
      "US30USD": "DJI",
      "DJ30": "DJI",
      "DJI": "DJI",
      "YM": "DJI",
      "MYM": "DJI",
      // Russell 2000 -> market: indices, symbol: RUT
      "US2000": "RUT",
      "US2000USD": "RUT",
      "RUT": "RUT",
      "RTY": "RUT",
      // Global Indices
      "UK100": "BUK100P",
      "UK100GBP": "BUK100P",
      "FTSE": "BUK100P",
      "BUK100P": "BUK100P",
      "DE30": "BDE40P",
      "DE30EUR": "BDE40P",
      "DE40": "BDE40P",
      "DE40EUR": "BDE40P",
      "DAX": "BDE40P",
      "BDE40P": "BDE40P",
      "VIX": "VIX",
    };

    if (indices[clean]) {
      return { symbol: indices[clean], dataset: "indices" };
    }
    if (indices[baseKey]) {
      return { symbol: indices[baseKey], dataset: "indices" };
    }

    if (["XAUUSD", "GOLD", "GC"].includes(baseKey)) {
      return { symbol: "XAU/USD", dataset: "commodities" };
    }
    if (["XAGUSD", "SILVER", "SI"].includes(baseKey)) {
      return { symbol: "XAG/USD", dataset: "commodities" };
    }
    if (["USOIL", "WTI", "CL", "WTICOUSD"].includes(baseKey)) {
      return { symbol: "WTICO/USD", dataset: "commodities" };
    }
    if (["UKOIL", "BRENT", "BCO", "BCOUSD"].includes(baseKey)) {
      return { symbol: "BCO/USD", dataset: "commodities" };
    }

    if (
      baseKey.endsWith("USD") &&
      ["BTCUSD", "ETHUSD", "SOLUSD", "XRPUSD", "DOGEUSD", "ADAUSD", "BNBUSD", "AVAXUSD"].includes(baseKey)
    ) {
      const coin = baseKey.replace(/USD$/, "");
      return { symbol: `${coin}USDT`, dataset: "crypto" };
    }

    if (/^[A-Z]{6}$/.test(baseKey)) {
      const base = baseKey.slice(0, 3);
      const quote = baseKey.slice(3, 6);
      return { symbol: `${base}/${quote}`, dataset: "forex" };
    }

    return { symbol: clean, dataset: "" };
  }

  // 2. Databento Mapping (CME Globex Futures)
  if (providerId === "databento") {
    const futuresMap: Record<string, string> = {
      "US500": "ES.c.0",
      "SPX500": "ES.c.0",
      "SPX500USD": "ES.c.0",
      "SPX": "ES.c.0",
      "ES": "ES.c.0",
      "NAS100": "NQ.c.0",
      "NAS100USD": "NQ.c.0",
      "USTEC": "NQ.c.0",
      "NDX": "NQ.c.0",
      "NQ": "NQ.c.0",
      "US30": "YM.c.0",
      "US30USD": "YM.c.0",
      "DJI": "YM.c.0",
      "XAUUSD": "GC.c.0",
      "GOLD": "GC.c.0",
      "CL": "CL.c.0",
    };
    return {
      symbol: futuresMap[baseKey] || futuresMap[clean] || clean,
      dataset: "GLBX.MDP3",
    };
  }

  return { symbol: clean, dataset: "" };
}
