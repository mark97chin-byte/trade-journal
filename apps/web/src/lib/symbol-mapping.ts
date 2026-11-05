export interface MappedInstrument {
  symbol: string;
  dataset: string;
}

export const PRESET_TRADING_SYMBOLS = [
  { value: "NAS100", label: "NAS100 (Databento: NQ.c.0 · 23/5 Globex)" },
  { value: "US500", label: "US500 (Databento: ES.c.0 · 23/5 Globex)" },
  { value: "XAUUSD", label: "XAUUSD (Gold · LSE: XAU/USD)" },
  { value: "EURUSD", label: "EURUSD (Euro / USD · LSE: EUR/USD)" },
  { value: "GBPUSD", label: "GBPUSD (British Pound / USD · LSE: GBP/USD)" },
] as const;

const US_INDEX_BASE_KEYS = new Set([
  "US500",
  "SPX500",
  "SPX500USD",
  "US500USD",
  "SP500",
  "MICROSP500",
  "SPX",
  "ES",
  "MES",
  "NAS100",
  "NAS100USD",
  "NASDAQ100",
  "MICRONASDAQ100",
  "USTEC",
  "USTECUSD",
  "USTECH100",
  "NDX",
  "NQ",
  "MNQ",
  "US30",
  "US30USD",
  "DJ30",
  "DJI",
  "DOW",
  "YM",
  "MYM",
  "US2000",
  "US2000USD",
  "RUSSELL2000",
  "RUT",
  "RTY",
  "M2K",
]);

/** Clean MT5 broker suffixes (.raw, .pro, .ecn, _SB, micro, .IDX, etc.) */
export function cleanBrokerSymbol(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/\.(RAW|PRO|ECN|STD|MICRO|M|CASH|IDX)$/i, "")
    .replace(/(_SB|[\+\#\.\-])$/i, "")
    .trim();
}

/** Returns true if the symbol is a US Index / CME Equity Index Future */
export function isUsIndexSymbol(rawTradeSymbol: string): boolean {
  const clean = cleanBrokerSymbol(rawTradeSymbol);
  const baseKey = clean.replace(/\.[A-Z]\.\d+$/i, "").replace(/[\s\/\_]/g, "");
  if (US_INDEX_BASE_KEYS.has(clean) || US_INDEX_BASE_KEYS.has(baseKey)) return true;
  if (/^(ES|MES|NQ|MNQ|YM|MYM|RTY|M2K)\.[A-Z]\.\d+$/i.test(rawTradeSymbol.trim())) return true;
  return false;
}

/**
 * Selects the default provider based on asset class:
 *  - US Indices (NAS100, US500, US30, ES, NQ, YM) -> "databento" (23/5 CME Globex Futures)
 *  - FX, Metals & Commodities (XAUUSD, EURUSD, GBPUSD) -> "london-strategic-edge"
 */
export function resolvePreferredProviderForSymbol(
  rawTradeSymbol: string,
  availableProviderIds?: string[]
): string {
  const wantsDatabento = isUsIndexSymbol(rawTradeSymbol);
  if (!availableProviderIds || availableProviderIds.length === 0) {
    return wantsDatabento ? "databento" : "london-strategic-edge";
  }
  if (wantsDatabento && availableProviderIds.includes("databento")) {
    return "databento";
  }
  if (!wantsDatabento && availableProviderIds.includes("london-strategic-edge")) {
    return "london-strategic-edge";
  }
  if (availableProviderIds.includes("london-strategic-edge")) return "london-strategic-edge";
  if (availableProviderIds.includes("databento")) return "databento";
  return availableProviderIds[0] || "london-strategic-edge";
}

/**
 * Resolves the provider's exact catalog symbol and dataset.
 */
export function resolveProviderSymbol(providerId: string, rawTradeSymbol: string): MappedInstrument {
  const clean = cleanBrokerSymbol(rawTradeSymbol);
  const baseKey = clean.replace(/\.IDX$/i, "").replace(/[\s\/\_]/g, "");

  // 1. Databento Mapping (23/5 CME Globex Futures)
  if (providerId === "databento") {
    const futuresMap: Record<string, string> = {
      "US500": "ES.c.0",
      "SPX500": "ES.c.0",
      "SPX500USD": "ES.c.0",
      "US500USD": "ES.c.0",
      "SP500": "ES.c.0",
      "MICROSP500": "MES.c.0",
      "SPX": "ES.c.0",
      "ES": "ES.c.0",
      "MES": "MES.c.0",
      "NAS100": "NQ.c.0",
      "NAS100USD": "NQ.c.0",
      "NASDAQ100": "NQ.c.0",
      "MICRONASDAQ100": "MNQ.c.0",
      "USTEC": "NQ.c.0",
      "USTECUSD": "NQ.c.0",
      "USTECH100": "NQ.c.0",
      "NDX": "NQ.c.0",
      "NQ": "NQ.c.0",
      "MNQ": "MNQ.c.0",
      "US30": "YM.c.0",
      "US30USD": "YM.c.0",
      "DJ30": "YM.c.0",
      "DJI": "YM.c.0",
      "DOW": "YM.c.0",
      "YM": "YM.c.0",
      "MYM": "MYM.c.0",
      "US2000": "RTY.c.0",
      "US2000USD": "RTY.c.0",
      "RUSSELL2000": "RTY.c.0",
      "RUT": "RTY.c.0",
      "RTY": "RTY.c.0",
      "XAUUSD": "GC.c.0",
      "GOLD": "GC.c.0",
      "GC": "GC.c.0",
      "CL": "CL.c.0",
      "USOIL": "CL.c.0",
    };
    if (/^[A-Z0-9]+\.[a-z]\.\d+$/i.test(rawTradeSymbol.trim())) {
      const [root, stype, num] = rawTradeSymbol.trim().split(".");
      return {
        symbol: `${root!.toUpperCase()}.${stype!.toLowerCase()}.${num}`,
        dataset: "GLBX.MDP3",
      };
    }
    return {
      symbol: futuresMap[baseKey] || futuresMap[clean] || clean,
      dataset: "GLBX.MDP3",
    };
  }

  // 2. London Strategic Edge Mapping (Primary for FX, Metals & Commodities)
  if (providerId === "london-strategic-edge") {
    const indices: Record<string, string> = {
      "US500": "SPX",
      "SPX500": "SPX",
      "SPX500USD": "SPX",
      "US500USD": "SPX",
      "SP500": "SPX",
      "SPX": "SPX",
      "ES": "SPX",
      "MES": "SPX",
      "NAS100": "NDX",
      "NAS100USD": "NDX",
      "NASDAQ100": "NDX",
      "USTEC": "NDX",
      "USTECUSD": "NDX",
      "USTECH100": "NDX",
      "NDX": "NDX",
      "NQ": "NDX",
      "MNQ": "NDX",
      "US30": "DJI",
      "US30USD": "DJI",
      "DJ30": "DJI",
      "DJI": "DJI",
      "DOW": "DJI",
      "YM": "DJI",
      "MYM": "DJI",
      "US2000": "RUT",
      "US2000USD": "RUT",
      "RUSSELL2000": "RUT",
      "RUT": "RUT",
      "RTY": "RUT",
      "UK100": "BUK100P",
      "FTSE": "BUK100P",
      "DE30": "BDE40P",
      "DE40": "BDE40P",
      "DAX": "BDE40P",
      "VIX": "VIX",
    };

    if (indices[clean]) return { symbol: indices[clean], dataset: "indices" };
    if (indices[baseKey]) return { symbol: indices[baseKey], dataset: "indices" };

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
    if (["NATGAS", "NG"].includes(baseKey)) {
      return { symbol: "NATGAS/USD", dataset: "commodities" };
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

  return { symbol: clean, dataset: "" };
}

/**
 * Returns the exact decimal precision for a symbol or price level:
 *  - Standard FX pairs (EUR/USD, GBP/USD, AUD/USD, etc. or price < 10) -> 5 decimals (0.00001)
 *  - JPY FX pairs (USD/JPY, EUR/JPY, GBP/JPY, etc.) -> 3 decimals (0.001)
 *  - Indices, Metals & Crypto (NAS100, US500, XAU/USD) -> 2 decimals (0.01)
 */
export function getSymbolPriceDecimals(rawSymbol: string, samplePrice?: number): number {
  const clean = cleanBrokerSymbol(rawSymbol);
  const noSlash = clean.replace(/[\s\/\_]/g, "");

  if (/^[A-Z]{6}$/.test(noSlash) && !isUsIndexSymbol(clean) && !["XAUUSD", "XAGUSD", "BTCUSD", "ETHUSD", "SOLUSD"].includes(noSlash)) {
    if (noSlash.endsWith("JPY")) return 3;
    return 5;
  }
  if (typeof samplePrice === "number" && Number.isFinite(samplePrice) && samplePrice > 0) {
    if (samplePrice < 10) return 5;
    if (samplePrice < 250 && clean.includes("JPY")) return 3;
  }
  return 2;
}

export function roundSymbolPrice(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return 0;
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}
