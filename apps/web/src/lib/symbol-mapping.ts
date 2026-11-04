export interface MappedInstrument {
  symbol: string;
  dataset: string;
}

export const PRESET_TRADING_SYMBOLS = [
  { value: "NAS100", label: "NAS100 (Nasdaq 100 · LSE: NAS100/USD)" },
  { value: "US500", label: "US500 (S&P 500 · LSE: SPX500/USD)" },
  { value: "XAUUSD", label: "XAUUSD (Gold · LSE: XAU/USD)" },
  { value: "EURUSD", label: "EURUSD (Euro / USD · LSE: EUR/USD)" },
  { value: "GBPUSD", label: "GBPUSD (British Pound / USD · LSE: GBP/USD)" },
] as const;

/** Clean MT5 broker suffixes (.raw, .pro, .ecn, _SB, micro, etc.) */
export function cleanBrokerSymbol(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/\.(RAW|PRO|ECN|STD|MICRO|M|CASH)$/i, "")
    .replace(/(_SB|[\+\#\.\-])$/i, "")
    .trim();
}

/**
 * Resolves the provider's exact catalog symbol and dataset.
 * Handles both unslashed ("NAS100", "EURUSD") and already-slashed ("NAS100/USD", "EUR/USD") inputs.
 */
export function resolveProviderSymbol(providerId: string, rawTradeSymbol: string): MappedInstrument {
  const clean = cleanBrokerSymbol(rawTradeSymbol);
  const noSlash = clean.replace("/", "");

  // 1. London Strategic Edge Mapping (OANDA / Slash currency standard)
  if (providerId === "london-strategic-edge") {
    const indices: Record<string, string> = {
      "US500": "SPX500/USD",
      "SPX500": "SPX500/USD",
      "SPX500USD": "SPX500/USD",
      "US500USD": "SPX500/USD",
      "SPX": "SPX500/USD",
      "ES": "SPX500/USD",
      "MES": "SPX500/USD",
      "NAS100": "NAS100/USD",
      "NAS100USD": "NAS100/USD",
      "USTEC": "NAS100/USD",
      "USTECUSD": "NAS100/USD",
      "NDX": "NAS100/USD",
      "NQ": "NAS100/USD",
      "MNQ": "NAS100/USD",
      "US30": "US30/USD",
      "US30USD": "US30/USD",
      "DJ30": "US30/USD",
      "YM": "US30/USD",
      "MYM": "US30/USD",
      "US2000": "US2000/USD",
      "US2000USD": "US2000/USD",
      "RUT": "US2000/USD",
      "RTY": "US2000/USD",
      "UK100": "UK100/GBP",
      "UK100GBP": "UK100/GBP",
      "FTSE": "UK100/GBP",
      "DE30": "DE30/EUR",
      "DE30EUR": "DE30/EUR",
      "DE40": "DE30/EUR",
      "DE40EUR": "DE30/EUR",
      "DAX": "DE30/EUR",
      "EU50": "EU50/EUR",
      "EU50EUR": "EU50/EUR",
      "JP225": "JP225/USD",
      "JP225USD": "JP225/USD",
      "AU200": "AU200/AUD",
      "AU200AUD": "AU200/AUD",
      "HK33": "HK33/HKD",
      "HK33HKD": "HK33/HKD",
      "CN50": "CN50/USD",
      "CN50USD": "CN50/USD",
      "VIX": "VIX",
    };

    if (indices[clean]) {
      return { symbol: indices[clean], dataset: clean === "VIX" ? "volatility" : "index" };
    }
    if (indices[noSlash]) {
      return { symbol: indices[noSlash], dataset: noSlash === "VIX" ? "volatility" : "index" };
    }

    if (["XAUUSD", "GOLD", "GC"].includes(noSlash)) {
      return { symbol: "XAU/USD", dataset: "commodity" };
    }
    if (["XAGUSD", "SILVER", "SI"].includes(noSlash)) {
      return { symbol: "XAG/USD", dataset: "commodity" };
    }
    if (["USOIL", "WTI", "CL", "WTICOUSD"].includes(noSlash)) {
      return { symbol: "WTICO/USD", dataset: "commodity" };
    }
    if (["UKOIL", "BRENT", "BCO", "BCOUSD"].includes(noSlash)) {
      return { symbol: "BCO/USD", dataset: "commodity" };
    }

    if (noSlash.endsWith("USD") && ["BTCUSD", "ETHUSD", "SOLUSD"].includes(noSlash)) {
      const coin = noSlash.replace(/USD$/, "");
      return { symbol: `${coin}/USD`, dataset: "crypto" };
    }

    if (/^[A-Z]{6}$/.test(noSlash)) {
      const base = noSlash.slice(0, 3);
      const quote = noSlash.slice(3, 6);
      return { symbol: `${base}/${quote}`, dataset: "forex" };
    }

    if (/^[A-Z0-9]+\/[A-Z0-9]+$/.test(clean)) {
      return { symbol: clean, dataset: "index" };
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
      "XAUUSD": "GC.c.0",
      "GOLD": "GC.c.0",
      "CL": "CL.c.0",
    };
    return {
      symbol: futuresMap[noSlash] || futuresMap[clean] || clean,
      dataset: "GLBX.MDP3",
    };
  }

  return { symbol: clean, dataset: "" };
}
