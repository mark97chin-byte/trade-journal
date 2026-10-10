// apps/web/src/app/api/trades/[key]/market-data/route.ts
import { accounts, db } from "@/db";
import { eq } from "drizzle-orm";
import { bad, handler, ok, requireValue } from "@/server/api";
import { connectionKey, providerFor } from "@/server/market-data/connections";
import { MarketDataError } from "@/server/market-data/provider";
import { getTradeByKey, rowToTrade } from "@/server/trades-query";
import { listExecutions } from "@/server/executions";
import { isResolution } from "@/lib/market-data";
import { estimateExcursions } from "@/lib/excursions";
import { estimateFingerprint, saveEstimate, savedEstimates } from "@/server/market-data/estimates";

const DAY_MS = 86_400_000;

export const GET = handler(
  async (_request: Request, { params }: { params: Promise<{ key: string }> }) => {
    const { key } = await params;
    const row = getTradeByKey(key);
    if (!row) return bad("Trade not found", 404);
    return ok({ saved: savedEstimates([rowToTrade(row)]).get(key) ?? null });
  },
);

export const POST = handler(
  async (request: Request, { params }: { params: Promise<{ key: string }> }) => {
    const { key } = await params;
    const row = getTradeByKey(key);
    if (!row) return bad("Trade not found", 404);
    const body = await request.json();
    requireValue(body && typeof body.provider === "string", "Choose a market data provider.");
    requireValue(
      typeof body.symbol === "string" &&
        body.symbol.trim().length > 0 &&
        body.symbol.length <= 100 &&
        !/[\x00-\x1f]/.test(body.symbol),
      "Enter the provider's exact instrument symbol.",
    );
    requireValue(isResolution(body.resolution), "Choose a supported candle resolution.");
    requireValue(Boolean(row.closedAt), "Market replay is available for closed trades only.");

    const tradeOpen = Date.parse(row.openedAt);
    const tradeClose = Date.parse(row.closedAt!);
    requireValue(
      Number.isFinite(tradeOpen) && Number.isFinite(tradeClose) && tradeClose > tradeOpen && tradeClose <= Date.now(),
      "Trade must have valid past entry and exit timestamps.",
    );

    // Padding: default 5 days pre-trade, 12 hours post-exit
    const paddingDays =
      typeof body.paddingDays === "number" && Number.isFinite(body.paddingDays)
        ? Math.max(0, Math.min(60, body.paddingDays))
        : 5;
    const from = tradeOpen - paddingDays * DAY_MS;
    const to = tradeClose + 12 * 3600_000;

    try {
      const provider = providerFor(body.provider);
      const trade = rowToTrade(row);
      const fingerprint = estimateFingerprint(trade);

      const history = await provider.history(
        {
          symbol: body.symbol.trim(),
          dataset: body.dataset || undefined,
          resolution: body.resolution,
          from,
          to,
          signal: request.signal,
        },
        connectionKey(provider.id),
      );

      const accountCurrency = db
        .select({ currency: accounts.currency })
        .from(accounts)
        .where(eq(accounts.id, row.accountId))
        .get()?.currency;
      const currencyMatches = !history.quoteCurrency || history.quoteCurrency === accountCurrency;

      // MAE/MFE must strictly evaluate candles during the active trade window
      const tradeOnlyHistory = {
        ...history,
        bars: history.bars.filter((b) => b.time >= tradeOpen && b.time <= tradeClose),
      };

      const estimate = estimateExcursions(
        trade,
        listExecutions(row.accountId, trade.executionIds),
        tradeOnlyHistory,
        body.basisConfirmed === true && currencyMatches,
      );

      if (!currencyMatches)
        estimate.warnings.unshift(
          `The candle quote currency (${history.quoteCurrency}) differs from this account (${accountCurrency}). Monetary estimates are unavailable; no FX conversion is applied.`,
        );

      const current = getTradeByKey(key);
      if (current && estimateFingerprint(rowToTrade(current)) === fingerprint)
        saveEstimate(trade, { ...history, estimate }, fingerprint);

      if (body.estimateOnly) {
        const { bars: _bars, ...metadata } = history;
        return ok({ ...metadata, estimate, paddingDays });
      }

      return ok({ ...history, estimate, paddingDays });
    } catch (error) {
      if (error instanceof MarketDataError) return bad(error.message, 502);
      throw error;
    }
  },
);