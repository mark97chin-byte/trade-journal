import { NextRequest, NextResponse } from "next/server";
import { aggregateCandles, type Resolution } from "@/lib/market-data";
import { connectionKey, providerFor } from "@/server/market-data/connections";
import { getCandleDb } from "@/server/market-data/candle-db";
import { resolveProviderSymbol, resolvePreferredProviderForSymbol } from "@/lib/symbol-mapping";

export const dynamic = "force-dynamic";

const NATIVE_PROVIDER_RESOLUTIONS = new Set(["1m", "5m", "15m", "1h", "4h", "1d"]);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const rawSymbol = String(body.symbol || "NAS100").trim();
    const providerId = String(body.provider || resolvePreferredProviderForSymbol(rawSymbol));
    const mapped = resolveProviderSymbol(providerId, rawSymbol);
    const normSymbol = mapped.symbol;
    const dataset = body.dataset ? String(body.dataset) : mapped.dataset || undefined;
    const requestedResolution = String(body.resolution || "15m") as Resolution;

    const nowMs = Date.now();
    const fromMs = body.fromMs
      ? Number(body.fromMs)
      : body.fromDate
      ? Date.parse(String(body.fromDate))
      : nowMs - 5 * 86_400_000;
    const rawToMs = body.toMs
      ? Number(body.toMs)
      : body.toDate
      ? Date.parse(String(body.toDate))
      : nowMs;
    const toMs = Math.max(fromMs + 3600_000, Math.min(rawToMs, nowMs + 3600_000));

    const isNative = NATIVE_PROVIDER_RESOLUTIONS.has(requestedResolution);
    const baseResolution: Resolution = isNative
      ? requestedResolution
      : requestedResolution.endsWith("h")
      ? "1h"
      : requestedResolution.endsWith("d") || requestedResolution.endsWith("w") || requestedResolution.endsWith("M")
      ? "1d"
      : "1m";

    const provider = providerFor(providerId);
    const key = connectionKey(providerId);

    try {
      const rawHistory = await provider.history(
        {
          symbol: normSymbol,
          dataset,
          resolution: baseResolution,
          from: fromMs,
          to: toMs,
          signal: req.signal,
        },
        key
      );

      const bars = isNative
        ? rawHistory.bars
        : aggregateCandles(rawHistory.bars || [], requestedResolution);

      return NextResponse.json({
        ...rawHistory,
        symbol: normSymbol,
        resolution: requestedResolution,
        bars,
        from: fromMs,
        to: toMs,
      });
    } catch (providerErr: any) {
      const cdb = getCandleDb();
      const cachedRows = cdb
        .prepare(
          `SELECT time, open, high, low, close, volume
           FROM candles
           WHERE provider LIKE ? AND UPPER(symbol) = UPPER(?) AND timeframe = ? AND time BETWEEN ? AND ?
           ORDER BY time ASC`
        )
        .all(`%${providerId}%`, normSymbol, providerId === "databento" && baseResolution !== "1d" ? "1m" : baseResolution, fromMs, toMs) as any[];

      if (cachedRows.length > 0) {
        const bars =
          (providerId === "databento" && requestedResolution !== "1m" && requestedResolution !== "1d") || !isNative
            ? aggregateCandles(cachedRows, requestedResolution)
            : cachedRows;
        return NextResponse.json({
          provider: provider.name,
          symbol: normSymbol,
          resolution: requestedResolution,
          bars,
          fetchedAt: new Date().toISOString(),
          truncated: false,
          warnings: [`Offline cache used: ${providerErr?.message || "Provider unreachable"}`],
        });
      }
      throw providerErr;
    }
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to load market candles for range." },
      { status: 500 }
    );
  }
}
