export interface MappedInstrument {
  symbol: string;
  dataset: string;
}

/** Clean MT5 broker suffixes (.raw, .pro, .ecn, _SB, micro, etc.) */
export function cleanBrokerSymbol(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/\.(RAW|PRO|ECN|STD|MICRO|M)$/i, "")
    .replace(/(_SB|[\+\#\.\-])$/i, "")
    .trim();
}

/**
 * Resolves the provider's exact catalog symbol and dataset.
 */
export function resolveProviderSymbol(providerId: string, rawTradeSymbol: string): MappedInstrument {
  const clean = cleanBrokerSymbol(rawTradeSymbol);

  // 1. London Strategic Edge Mapping
  if (providerId === "london-strategic-edge") {
    // Indices
    const indices: Record<string, string> = {
      "US500": "SPX500",
      "SPX500": "SPX500",
      "SPX": "SPX500",
      "ES": "SPX500",
      "NAS100": "NAS100",
      "USTEC": "NAS100",
      "NDX": "NAS100",
      "NQ": "NAS100",
      "US30": "US30",
      "DJ30": "US30",
      "YM": "US30",
      "US2000": "US2000",
      "RUT": "US2000",
      "UK100": "UK100",
      "FTSE": "UK100",
      "DE30": "DE30",
      "DE40": "DE30",
      "DAX": "DE30",
      "EU50": "EU50",
      "JP225": "JP225",
      "AU200": "AU200",
      "HK33": "HK33",
      "CN50": "CN50",
      "VIX": "VIX",
    };
    if (indices[clean]) {
      return { symbol: indices[clean], dataset: clean === "VIX" ? "volatility" : "index" };
    }

    // Commodities / Gold
    if (["XAUUSD", "GOLD"].includes(clean)) {
      return { symbol: "XAU/USD", dataset: "commodity" };
    }
    if (["XAGUSD", "SILVER"].includes(clean)) {
      return { symbol: "XAG/USD", dataset: "commodity" };
    }
    if (["USOIL", "WTI", "CL"].includes(clean)) {
      return { symbol: "CL", dataset: "futures" };
    }

    // Crypto
    if (clean.endsWith("USD") && ["BTCUSD", "ETHUSD", "SOLUSD"].includes(clean)) {
      const coin = clean.replace(/USD$/, "");
      return { symbol: `${coin}/USD`, dataset: "crypto" };
    }

    // Standard 6-character Forex pairs (EURUSD -> EUR/USD)
    if (/^[A-Z]{6}$/.test(clean)) {
      const base = clean.slice(0, 3);
      const quote = clean.slice(3, 6);
      return { symbol: `${base}/${quote}`, dataset: "fx" };
    }

    return { symbol: clean, dataset: "" };
  }

  // 2. Databento Mapping (CME Globex Futures)
  if (providerId === "databento") {
    const futuresMap: Record<string, string> = {
      "US500": "ES.c.0",
      "SPX500": "ES.c.0",
      "SPX": "ES.c.0",
      "ES": "ES.c.0",
      "NAS100": "NQ.c.0",
      "USTEC": "NQ.c.0",
      "NDX": "NQ.c.0",
      "NQ": "NQ.c.0",
      "XAUUSD": "GC.c.0",
      "GOLD": "GC.c.0",
      "CL": "CL.c.0",
    };
    return {
      symbol: futuresMap[clean] || clean,
      dataset: "GLBX.MDP3",
    };
  }

  return { symbol: clean, dataset: "" };
}