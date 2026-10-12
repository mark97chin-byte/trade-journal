import { dayKeyOf, readFilters } from "@luxalgo/journal-core";
import { accounts, db } from "@/db";
import { handler, ok, requireValue } from "@/server/api";
import { getTimeZone, getCurrencyConversion } from "@/server/settings";
import { currencyProjection } from "@/server/currency-conversion";
import { queryTrades } from "@/server/trades-query";

export const GET = handler(async (request: Request) => {
  const params = new URL(request.url).searchParams;
  const timeZone = getTimeZone();
  const today = dayKeyOf(new Date().toISOString(), timeZone);
  const year = Number(params.get("year") ?? today.slice(0, 4));

  requireValue(
    Number.isInteger(year) && year >= 1900 && year <= 9999,
    "Choose a valid calendar year.",
  );

  const filters = readFilters(params);
  const scope = {
    ...filters,
    from: `${year}-01-01`,
    to: `${year}-12-31`,
  };

  const { trades: originalTrades } = queryTrades(scope);
  const selectedIds = scope.accounts?.split(",").map((id) => id.trim());
  const accountRows = db
    .select()
    .from(accounts)
    .all()
    .filter((account) => !selectedIds || selectedIds.includes(account.id));

  const { trades, scope: currencyScope } = currencyProjection(
    originalTrades,
    accountRows,
    getCurrencyConversion(),
  );

  const months = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    pnl: 0,
    trades: 0,
    wins: 0,
    winRate: null as number | null,
  }));

  for (const trade of trades) {
    const rawDate =
      (trade as any).closedAt ??
      (trade as any).closeTime ??
      (trade as any).exitTime ??
      (trade as any).openedAt;
    if (!rawDate) continue;

    const dateStr =
      typeof rawDate === "string"
        ? rawDate.length === 10
          ? rawDate
          : dayKeyOf(rawDate, timeZone)
        : dayKeyOf(new Date(rawDate).toISOString(), timeZone);

    if (!dateStr || !dateStr.startsWith(String(year))) continue;
    const m = Number(dateStr.slice(5, 7));
    if (m >= 1 && m <= 12) {
      const item = months[m - 1];
      if (!item) continue;

      const pnl = Number((trade as any).netPnl ?? (trade as any).pnl ?? 0);
      item.pnl += pnl;
      item.trades += 1;
      if (pnl > 0 || (trade as any).status === "win") {
        item.wins += 1;
      }
    }
  }

  for (const m of months) {
    if (m.trades > 0) {
      m.winRate = (m.wins / m.trades) * 100;
    }
  }

  const currency = currencyScope.monetary ? currencyScope.currency ?? "USD" : "USD";

  return ok({
    year,
    currency,
    months,
  });
});
