import fs from "node:fs";
import path from "node:path";
import { RESOLUTIONS, type MarketBar } from "@/lib/market-data";
import { MarketDataError, type MarketDataProvider } from "./provider";
import { boundedSignal, credentials, result } from "./http";

function normalizeDatabentoSymbol(raw: string): string {
  const clean = raw.trim().toUpperCase().replace(/\.(RAW|PRO|ECN|CASH|STD)$/i, "");

  // Continuous front-month contracts by volume roll rule
  if (["US500", "SPX500", "SPX", "ES", "USA500"].includes(clean)) return "ES.c.0";
  if (["US100", "NAS100", "USTECH", "NQ", "NDX"].includes(clean)) return "NQ.c.0";
  if (["US30", "DJI", "YM"].includes(clean)) return "YM.c.0";
  if (["RTY", "US2000", "RUSSELL"].includes(clean)) return "RTY.c.0";
  if (["GC", "GOLD", "XAUUSD"].includes(clean)) return "GC.c.0";
  if (["CL", "CRUDE", "OIL"].includes(clean)) return "CL.c.0";

  return raw.trim();
}

function parsePrice(val: unknown): number {
  const num = typeof val === "number" ? val : Number(val);
  // If price is an unscaled fixed-precision integer (> 1e9), convert from nanounits
  return num > 1_000_000_000 ? num / 1_000_000_000 : num;
}

export const databento: MarketDataProvider = {
  id: "databento",
  name: "Databento",
  environmentKey: "DATABENTO_API_KEY",
  async test(key) {
    const apiKey = key.startsWith("{") ? (credentials(key).apiKey ?? "") : key;
    if (!apiKey) throw new MarketDataError("Enter a Databento API key.");

    const res = await fetch("https://hist.databento.com/v0/metadata.list_datasets", {
      headers: {
        Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`,
      },
    });

    if (!res.ok) {
      if (res.status === 401) throw new MarketDataError("Invalid Databento API key.");
      throw new MarketDataError(`Databento connection test failed (HTTP ${res.status}).`);
    }
  },
  async history(request, key) {
    const apiKey = key.startsWith("{") ? (credentials(key).apiKey ?? "") : key;
    if (!apiKey) throw new MarketDataError("Databento API key is required.");

    if (request.resolution !== "1m" && request.resolution !== "1h" && request.resolution !== "1d") {
      throw new MarketDataError("Databento historical endpoint supports 1m, 1h, or 1d resolutions.");
    }

    const schema = request.resolution === "1m" ? "ohlcv-1m" : request.resolution === "1h" ? "ohlcv-1h" : "ohlcv-1d";
    const symbol = normalizeDatabentoSymbol(request.symbol);
    const step = RESOLUTIONS[request.resolution];

    const startIso = new Date(Math.floor(request.from / step) * step).toISOString();
    const endIso = new Date(Math.ceil(request.to / step) * step).toISOString();

    // Normalize dataset identifier
    let dataset = (request.dataset || "GLBX.MDP3").trim();
    if (dataset.includes("GLBX.MDP3")) dataset = "GLBX.MDP3";
    if (dataset.includes("OPRA.PILLAR")) dataset = "OPRA.PILLAR";
    if (dataset.includes("XNAS.ITCH")) dataset = "XNAS.ITCH";

    // Prepare disk cache
    const cacheDir = path.resolve(process.cwd(), "data/cache/databento");
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    const safeStart = startIso.replace(/[:.]/g, "-");
    const safeEnd = endIso.replace(/[:.]/g, "-");
    const cacheKey = `${dataset}_${symbol}_${schema}_${safeStart}_${safeEnd}.json`;
    const cachePath = path.join(cacheDir, cacheKey);

    let rawText = "";

    if (fs.existsSync(cachePath)) {
      rawText = fs.readFileSync(cachePath, "utf8");
    } else {
      const url = new URL("https://hist.databento.com/v0/timeseries.get_range");
      url.searchParams.set("dataset", dataset);
      url.searchParams.set("symbols", symbol);
      url.searchParams.set("schema", schema);
      url.searchParams.set("stype_in", symbol.includes(".c.") || symbol.includes(".v.") ? "continuous" : "raw_symbol");
      url.searchParams.set("encoding", "json");
      url.searchParams.set("pretty_px", "true");
      url.searchParams.set("start", startIso);
      url.searchParams.set("end", endIso);

      const signal = boundedSignal(request.signal);
      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`,
        },
        signal,
      });

      if (!response.ok) {
        const errText = await response.text();
        if (response.status === 401) throw new MarketDataError("Databento authentication failed.");
        if (response.status === 404) throw new MarketDataError(`Symbol ${symbol} not found in Databento dataset.`);
        throw new MarketDataError(`Databento API error (${response.status}): ${errText.slice(0, 150)}`);
      }

      rawText = await response.text();
      fs.writeFileSync(cachePath, rawText, "utf8");
    }

    const lines = rawText.trim().split("\n");
    const bars: MarketBar[] = [];

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const item = JSON.parse(line);
        const tsNano = item.hd?.ts_event ?? item.ts_event;
        const timeMs = Math.floor(Number(tsNano) / 1_000_000);

        bars.push({
          time: Math.floor(timeMs / step) * step,
          open: parsePrice(item.open),
          high: parsePrice(item.high),
          low: parsePrice(item.low),
          close: parsePrice(item.close),
          volume: Number(item.volume ?? 0),
        });
      } catch {
        // Skip malformed records
      }
    }

    return result(
      this.name,
      request,
      bars,
      false,
      [
        `Databento CME Globex feed (${symbol}). Unadjusted continuous futures prices, UTC timestamps.`,
      ],
      "USD",
    );
  },
};