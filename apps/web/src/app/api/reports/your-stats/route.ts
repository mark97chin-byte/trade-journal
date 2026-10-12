import { dailyStats, dayKeyOf, readFilters } from "@luxalgo/journal-core";
import { accounts, db } from "@/db";
import { handler, ok } from "@/server/api";
import { getTimeZone, getCurrencyConversion } from "@/server/settings";
import { currencyProjection } from "@/server/currency-conversion";
import { queryTrades } from "@/server/trades-query";

export const GET = handler(async (request: Request) => {
  const params = new URL(request.url).searchParams;
  const timeZone = getTimeZone();
  const filters = readFilters(params);

  const { trades: originalTrades } = queryTrades(filters);
  const selectedIds = filters.accounts?.split(",").map((id) => id.trim());
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

  const currency = currencyScope.monetary ? currencyScope.currency ?? "USD" : "USD";

  // Separate closed trades from open trades
  const closedTrades: any[] = [];
  let openTradesCount = 0;

  for (const t of trades as any[]) {
    const isClosed = Boolean(t.closedAt ?? t.closeTime ?? t.exitTime);
    if (isClosed) {
      closedTrades.push(t);
    } else {
      openTradesCount++;
    }
  }

  // Sort closed trades chronologically
  closedTrades.sort((a, b) => {
    const tA = new Date(a.closedAt ?? a.closeTime ?? a.openedAt).getTime();
    const tB = new Date(b.closedAt ?? b.closeTime ?? b.openedAt).getTime();
    return tA - tB;
  });

  // 1. Group by month for Best / Lowest / Average Month
  const monthMap = new Map<string, { pnl: number; count: number }>();
  for (const t of closedTrades) {
    const rawDate = t.closedAt ?? t.closeTime ?? t.openedAt;
    const dateStr =
      typeof rawDate === "string"
        ? rawDate.length === 10
          ? rawDate
          : dayKeyOf(rawDate, timeZone)
        : dayKeyOf(new Date(rawDate).toISOString(), timeZone);
    const mKey = dateStr.slice(0, 7); // YYYY-MM
    const current = monthMap.get(mKey) ?? { pnl: 0, count: 0 };
    current.pnl += Number(t.netPnl ?? t.pnl ?? 0);
    current.count++;
    monthMap.set(mKey, current);
  }

  const monthsArray = Array.from(monthMap.entries()).map(([month, data]) => ({
    month,
    pnl: data.pnl,
    count: data.count,
  }));

  let bestMonth: { month: string; pnl: number } | null = null;
  let lowestMonth: { month: string; pnl: number } | null = null;
  let avgMonthlyPnl: number | null = null;

  if (monthsArray.length > 0) {
    bestMonth = monthsArray.reduce((prev, curr) => (curr.pnl > prev.pnl ? curr : prev));
    lowestMonth = monthsArray.reduce((prev, curr) => (curr.pnl < prev.pnl ? curr : prev));
    const totalMonthPnl = monthsArray.reduce((acc, m) => acc + m.pnl, 0);
    avgMonthlyPnl = totalMonthPnl / monthsArray.length;
  }

  // 2. Trade Level Metrics
  let totalPnl = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let winCount = 0;
  let lossCount = 0;
  let beCount = 0;
  let totalVolume = 0;
  let totalCommissions = 0;
  let totalFees = 0;
  let totalSwap = 0;
  let largestProfit = 0;
  let largestLoss = 0;

  let totalHoldTimeMs = 0;
  let winHoldTimeMs = 0;
  let lossHoldTimeMs = 0;
  let beHoldTimeMs = 0;

  let maxConsecWins = 0;
  let currentConsecWins = 0;
  let maxConsecLosses = 0;
  let currentConsecLosses = 0;

  let plannedRSum = 0;
  let plannedRCount = 0;
  let realizedRSum = 0;
  let realizedRCount = 0;

  for (const t of closedTrades) {
    const pnl = Number(t.netPnl ?? t.pnl ?? 0);
    totalPnl += pnl;

    const vol = Number(t.quantity ?? t.volume ?? t.size ?? 0);
    totalVolume += vol;

    totalCommissions += Number(t.commission ?? t.commissions ?? 0);
    totalFees += Number(t.fee ?? t.fees ?? 0);
    totalSwap += Number(t.swap ?? 0);

    // Durations
    const openTime = t.openedAt ? new Date(t.openedAt).getTime() : null;
    const closeTime = (t.closedAt ?? t.closeTime)
      ? new Date(t.closedAt ?? t.closeTime).getTime()
      : null;
    const duration = openTime && closeTime && closeTime >= openTime ? closeTime - openTime : 0;
    totalHoldTimeMs += duration;

    // R-multiples
    if (typeof t.plannedR === "number" && !isNaN(t.plannedR)) {
      plannedRSum += t.plannedR;
      plannedRCount++;
    }
    if (typeof t.realizedR === "number" && !isNaN(t.realizedR)) {
      realizedRSum += t.realizedR;
      realizedRCount++;
    }

    if (pnl > 0.0001) {
      winCount++;
      grossProfit += pnl;
      winHoldTimeMs += duration;
      if (pnl > largestProfit) largestProfit = pnl;

      currentConsecWins++;
      if (currentConsecWins > maxConsecWins) maxConsecWins = currentConsecWins;
      currentConsecLosses = 0;
    } else if (pnl < -0.0001) {
      lossCount++;
      grossLoss += Math.abs(pnl);
      lossHoldTimeMs += duration;
      if (pnl < largestLoss) largestLoss = pnl;

      currentConsecLosses++;
      if (currentConsecLosses > maxConsecLosses) maxConsecLosses = currentConsecLosses;
      currentConsecWins = 0;
    } else {
      beCount++;
      beHoldTimeMs += duration;
      currentConsecWins = 0;
      currentConsecLosses = 0;
    }
  }

  const totalTradesCount = closedTrades.length;
  const avgWinningTrade = winCount > 0 ? grossProfit / winCount : 0;
  const avgLosingTrade = lossCount > 0 ? -(grossLoss / lossCount) : 0;
  const avgTradePnl = totalTradesCount > 0 ? totalPnl / totalTradesCount : 0;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0;

  // 3. Day Level Metrics
  const days = dailyStats(closedTrades, timeZone);
  const totalTradingDays = days.length;
  let winningDays = 0;
  let losingDays = 0;
  let beDays = 0;
  let winDayPnlSum = 0;
  let lossDayPnlSum = 0;
  let largestProfitDay = 0;
  let largestLosingDay = 0;

  let maxConsecWinDays = 0;
  let currConsecWinDays = 0;
  let maxConsecLossDays = 0;
  let currConsecLossDays = 0;

  for (const d of days) {
    if (d.netPnl > 0.0001) {
      winningDays++;
      winDayPnlSum += d.netPnl;
      if (d.netPnl > largestProfitDay) largestProfitDay = d.netPnl;

      currConsecWinDays++;
      if (currConsecWinDays > maxConsecWinDays) maxConsecWinDays = currConsecWinDays;
      currConsecLossDays = 0;
    } else if (d.netPnl < -0.0001) {
      losingDays++;
      lossDayPnlSum += d.netPnl;
      if (d.netPnl < largestLosingDay) largestLosingDay = d.netPnl;

      currConsecLossDays++;
      if (currConsecLossDays > maxConsecLossDays) maxConsecLossDays = currConsecLossDays;
      currConsecWinDays = 0;
    } else {
      beDays++;
      currConsecWinDays = 0;
      currConsecLossDays = 0;
    }
  }

  const avgDailyVolume = totalTradingDays > 0 ? totalVolume / totalTradingDays : 0;
  const avgDailyPnl = totalTradingDays > 0 ? totalPnl / totalTradingDays : 0;
  const avgWinningDayPnl = winningDays > 0 ? winDayPnlSum / winningDays : 0;
  const avgLosingDayPnl = losingDays > 0 ? lossDayPnlSum / losingDays : 0;

  // 4. Drawdowns
  let peak = 0;
  let runningEquity = 0;
  let maxDd = 0;
  let ddDepths: number[] = [];

  for (const d of days) {
    runningEquity += d.netPnl;
    if (runningEquity > peak) {
      peak = runningEquity;
    }
    const dd = peak - runningEquity;
    if (dd > maxDd) {
      maxDd = dd;
    }
    if (dd > 0) {
      ddDepths.push(dd);
    }
  }

  const avgDd = ddDepths.length > 0 ? ddDepths.reduce((a, b) => a + b, 0) / ddDepths.length : 0;
  const initialBalance = 10000; // Benchmark reference or base equity
  const maxDrawdownPct = initialBalance > 0 ? -(maxDd / initialBalance) * 100 : 0;
  const avgDrawdownPct = initialBalance > 0 ? -(avgDd / initialBalance) * 100 : 0;

  // Expectancy
  const winRate = totalTradesCount > 0 ? winCount / totalTradesCount : 0;
  const lossRate = totalTradesCount > 0 ? lossCount / totalTradesCount : 0;
  const tradeExpectancy = winRate * avgWinningTrade + lossRate * avgLosingTrade;

  return ok({
    currency,
    bestMonth,
    lowestMonth,
    avgMonthlyPnl,
    left: {
      totalPnl,
      avgDailyVolume,
      avgWinningTrade,
      avgLosingTrade,
      totalTrades: totalTradesCount,
      winningTrades: winCount,
      losingTrades: lossCount,
      beTrades: beCount,
      maxConsecWins,
      maxConsecLosses,
      totalCommissions,
      totalFees,
      totalSwap,
      largestProfit,
      largestLoss,
      avgHoldTimeAll: totalTradesCount > 0 ? totalHoldTimeMs / totalTradesCount : null,
      avgHoldTimeWin: winCount > 0 ? winHoldTimeMs / winCount : null,
      avgHoldTimeLoss: lossCount > 0 ? lossHoldTimeMs / lossCount : null,
      avgHoldTimeScratch: beCount > 0 ? beHoldTimeMs / beCount : null,
      avgTradePnl,
      profitFactor,
    },
    right: {
      openTrades: openTradesCount,
      totalTradingDays,
      winningDays,
      losingDays,
      beDays,
      loggedDays: 0,
      maxConsecWinDays,
      maxConsecLossDays,
      avgDailyPnl,
      avgWinningDayPnl,
      avgLosingDayPnl,
      largestProfitableDay: largestProfitDay,
      largestLosingDay: largestLosingDay,
      avgPlannedR: plannedRCount > 0 ? plannedRSum / plannedRCount : null,
      avgRealizedR: realizedRCount > 0 ? realizedRSum / realizedRCount : null,
      tradeExpectancy,
      maxDrawdown: -maxDd,
      maxDrawdownPct,
      avgDrawdown: -avgDd,
      avgDrawdownPct,
    },
  });
});
