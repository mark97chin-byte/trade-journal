import { NextRequest, NextResponse } from "next/server";
import { RESOLUTIONS, type Resolution } from "@/lib/market-data";
import { connectionKey, providerFor } from "@/server/market-data/connections";
import { getCandleDb, getCachedBounds, getCachedCandles } from "@/server/market-data/candle-db";
import { resolveProviderSymbol } from "@/lib/symbol-mapping";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const providerId = String(body.provider || "london-strategic-edge");
    const rawSymbol = String(body.symbol || "NAS100").trim();
    const dataset = body.dataset ? String(body.dataset) : undefined;
    const resolution = (body.resolution || "5m") as Resolution;

    const nowMs = Date.now();
    const fromMs = body.fromMs
      ? Number(body.fromMs)
      : body.fromDate
      ? Date.parse(String(body.fromDate))
      : nowMs - 5 * 86_400_000;
    const toMs = body.toMs
      ? Number(body.toMs)
      : body.toDate
      ? Date.parse(String(body.toDate))
      : nowMs;

    const provider = providerFor(providerId);
    const key = connectionKey(providerId);

    try {
      const history = await provider.history(
        {
          symbol: rawSymbol,
          dataset,
          resolution: resolution in RESOLUTIONS ? resolution : "5m",
          from: fromMs,
          to: toMs,
          signal: req.signal,
        },
        key
      );

      // If the requested date is in the future or market was closed and returned 0 bars,
      // fall back to the most recent cached window in market_candles.db for this symbol!
      if (!history.bars || history.bars.length === 0) {
        const mapped = resolveProviderSymbol(providerId, rawSymbol);
        const normSymbol = mapped.symbol;
        const cdb = getCandleDb();
        const latestRow = cdb
          .prepare(
            `SELECT MAX(time) as maxT FROM candles WHERE provider LIKE ? AND symbol = ?`
          )
          .get(`%${providerId}%`, normSymbol) as { maxT: number | null } | undefined;

        if (latestRow?.maxT) {
          const span = Math.max(toMs - fromMs, 3 * 86_400_000);
          const fallbackBars = cdb
            .prepare(
              `SELECT time, open, high, low, close, volume
               FROM candles
               WHERE provider LIKE ? AND symbol = ? AND timeframe = ? AND time BETWEEN ? AND ?
               ORDER BY time ASC`
            )
            .all(
              `%${providerId}%`,
              normSymbol,
              resolution,
              latestRow.maxT - span,
              latestRow.maxT
            ) as any[];

          if (fallbackBars.length > 0) {
            return NextResponse.json({
              ...history,
              bars: fallbackBars,
              from: fallbackBars[0].time,
              to: fallbackBars[fallbackBars.length - 1].time,
              warnings: [
                "Requested date had no new market bars; showing latest cached candles from market_candles.db.",
              ],
            });
          }
        }
      }

      return NextResponse.json({
        ...history,
        from: fromMs,
        to: toMs,
      });
    } catch (providerErr: any) {
      // Offline / API error fallback: read directly from market_candles.db!
      const mapped = resolveProviderSymbol(providerId, rawSymbol);
      const normSymbol = mapped.symbol;
      const cdb = getCandleDb();
      const cachedRows = cdb
        .prepare(
          `SELECT time, open, high, low, close, volume
           FROM candles
           WHERE provider LIKE ? AND symbol = ?
           ORDER BY time DESC
           LIMIT 5000`
        )
        .all(`%${providerId}%`, normSymbol) as any[];

      if (cachedRows.length > 0) {
        const sorted = cachedRows.reverse();
        return NextResponse.json({
          provider: provider.name,
          symbol: normSymbol,
          resolution,
          bars: sorted,
          fetchedAt: new Date().toISOString(),
          truncated: false,
          warnings: ["Showing cached candles from market_candles.db."],
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
