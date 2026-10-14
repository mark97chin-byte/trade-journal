import { dailyStats, dayKeyOf, readFilters } from "@luxalgo/journal-core";
import { accounts, db, playbooks as playbooksTable, tradeRuleChecks } from "@/db";
import { ensurePlaybookTables, getMetaRow, normalizeRuleGroups } from "@/server/playbooks-store";
import { handler, ok } from "@/server/api";
import { getTimeZone, getCurrencyConversion } from "@/server/settings";
import { currencyProjection } from "@/server/currency-conversion";
import { queryTrades } from "@/server/trades-query";
import { extractTradeTokens, getTagsWithUsage } from "@/server/tags-store";

const DURATION_BUCKETS = [
  { key: "<1m", label: "<1m", min: 0, max: 60_000 },
  { key: "1-1:59m", label: "1-1:59m", min: 60_000, max: 120_000 },
  { key: "2-4:59m", label: "2-4:59m", min: 120_000, max: 300_000 },
  { key: "5-9:59m", label: "5-9:59m", min: 300_000, max: 600_000 },
  { key: "10-29:59m", label: "10-29:59m", min: 600_000, max: 1_800_000 },
  { key: "30-59:59m", label: "30-59:59m", min: 1_800_000, max: 3_600_000 },
  { key: "1-1:59h", label: "1-1:59h", min: 3_600_000, max: 7_200_000 },
  { key: "2-3:59h", label: "2-3:59h", min: 7_200_000, max: 14_400_000 },
  { key: "4h+", label: "4h+", min: 14_400_000, max: Infinity },
];

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

const DAY_NAMES = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"
];

function getTradeDuration(t: any): number | null {
  const openTime = t.openedAt ? new Date(t.openedAt).getTime() : null;
  const closeTime = (t.closedAt ?? t.closeTime ?? t.exitTime)
    ? new Date(t.closedAt ?? t.closeTime ?? t.exitTime).getTime()
    : null;
  if (openTime && closeTime && closeTime >= openTime) {
    return closeTime - openTime;
  }
  if (typeof t.durationMs === "number") return t.durationMs;
  if (typeof t.duration === "number") return t.duration * 1000;
  return null;
}

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

  const allPlaybooks = db.select().from(playbooksTable).all();
  const { categories: tagCategoriesList, tags: managedTagsList } = getTagsWithUsage();

  const { trades, scope: currencyScope } = currencyProjection(
    originalTrades,
    accountRows,
    getCurrencyConversion(),
  );

  const currency = currencyScope.monetary ? currencyScope.currency ?? "USD" : "USD";

  const closedTrades = (trades as any[]).filter(
    (t) => Boolean(t.closedAt ?? t.closeTime ?? t.exitTime)
  );

  closedTrades.sort((a, b) => {
    const tA = new Date(a.closedAt ?? a.closeTime ?? a.openedAt).getTime();
    const tB = new Date(b.closedAt ?? b.closeTime ?? b.openedAt).getTime();
    return tA - tB;
  });

  function buildSummaryStats(groupTrades: any[]) {
    const count = groupTrades.length;
    let pnl = 0;
    let wins = 0;
    let grossWin = 0;
    let grossLoss = 0;
    let volume = 0;

    for (const t of groupTrades) {
      const net = Number(t.netPnl ?? t.pnl ?? 0);
      pnl += net;
      volume += Number(t.quantity ?? t.volume ?? 0);
      if (net > 0.0001 || t.status === "win") {
        wins++;
        grossWin += net;
      } else if (net < -0.0001 || t.status === "loss") {
        grossLoss += Math.abs(net);
      }
    }

    const losses = count - wins;
    const winRate = count > 0 ? (wins / count) * 100 : 0;
    const avgWin = wins > 0 ? grossWin / wins : 0;
    const avgLoss = losses > 0 ? -(grossLoss / losses) : 0;
    const avgVolume = count > 0 ? volume / count : 0;

    return {
      tradesCount: count,
      netPnl: pnl,
      winRate,
      avgVolume,
      avgWin,
      avgLoss,
    };
  }

  function getHighlightCards(rows: { label: string; trades: any[]; stats: ReturnType<typeof buildSummaryStats> }[]) {
    const active = rows.filter((r) => r.trades.length > 0);
    if (active.length === 0) {
      return {
        best: { label: "--", count: 0, pnl: 0 },
        least: { label: "--", count: 0, pnl: 0 },
        mostActive: { label: "--", count: 0 },
        bestWinRate: { label: "--", winRate: 0, count: 0 },
      };
    }

    const best = active.reduce((p, c) => (c.stats.netPnl > p.stats.netPnl ? c : p));
    const least = active.reduce((p, c) => (c.stats.netPnl < p.stats.netPnl ? c : p));
    const mostActive = active.reduce((p, c) => (c.stats.tradesCount > p.stats.tradesCount ? c : p));
    const bestWinRate = active.reduce((p, c) => (c.stats.winRate > p.stats.winRate ? c : p));

    return {
      best: { label: best.label, count: best.stats.tradesCount, pnl: best.stats.netPnl },
      least: { label: least.label, count: least.stats.tradesCount, pnl: least.stats.netPnl },
      mostActive: { label: mostActive.label, count: mostActive.stats.tradesCount },
      bestWinRate: { label: bestWinRate.label, winRate: bestWinRate.stats.winRate, count: bestWinRate.stats.tradesCount },
    };
  }

  // 1. Days
  const daysRows = DAY_NAMES.map((name, idx) => {
    const dayTrades = closedTrades.filter((t) => {
      const d = new Date(t.closedAt ?? t.closeTime ?? t.openedAt);
      return d.getUTCDay() === idx;
    });
    return { label: name, trades: dayTrades, stats: buildSummaryStats(dayTrades) };
  });

  // 2. Months
  const monthsRows = MONTH_NAMES.map((name, idx) => {
    const monthTrades = closedTrades.filter((t) => {
      const rawDate = t.closedAt ?? t.closeTime ?? t.openedAt;
      const dStr = typeof rawDate === "string" ? rawDate.slice(0, 10) : dayKeyOf(new Date(rawDate).toISOString(), timeZone);
      return Number(dStr.slice(5, 7)) === idx + 1;
    });
    return { label: name, trades: monthTrades, stats: buildSummaryStats(monthTrades) };
  });

  // 3. Trade Time
  const hoursRows = Array.from({ length: 24 }, (_, i) => {
    const hourLabel = `${String(i).padStart(2, "0")}:00`;
    const hourTrades = closedTrades.filter((t) => {
      const d = new Date(t.openedAt ?? t.closedAt);
      return d.getUTCHours() === i;
    });
    return { label: hourLabel, trades: hourTrades, stats: buildSummaryStats(hourTrades) };
  });

  // 4. Trade Duration
  const durationRows = DURATION_BUCKETS.map((b) => {
    const bTrades = closedTrades.filter((t) => {
      const dur = getTradeDuration(t);
      if (dur === null) return false;
      return dur >= b.min && dur < b.max;
    });
    return { label: b.label, trades: bTrades, stats: buildSummaryStats(bTrades) };
  });

  // 5. Symbols
  const symbolsSet = new Set<string>();
  closedTrades.forEach((t) => { if (t.symbol) symbolsSet.add(t.symbol); });
  const symbolsList = Array.from(symbolsSet).sort();

  const symbolsRows = symbolsList.map((sym) => {
    const symTrades = closedTrades.filter((t) => t.symbol === sym);
    return { label: sym, trades: symTrades, stats: buildSummaryStats(symTrades) };
  });

  // 6. Strategies
  const playbookRows = (allPlaybooks.length > 0 ? allPlaybooks : [{ id: "none", name: "None" }]).map((pb) => {
    const pbTrades = closedTrades.filter((t) => (t.playbookId === pb.id) || (!t.playbookId && pb.id === "none"));
    return { id: pb.id, label: pb.name, trades: pbTrades, stats: buildSummaryStats(pbTrades) };
  });

  function buildCrossAnalysis(primary: typeof daysRows, secondaryColKeys: string[], getSecKey: (t: any) => string) {
    const cols = secondaryColKeys;
    const matrix = primary.map((r) => {
      const rowCells: Record<string, { netPnl: number; trades: number; winRate: number }> = {};
      for (const col of cols) {
        const matchingTrades = r.trades.filter((t) => getSecKey(t) === col);
        const st = buildSummaryStats(matchingTrades);
        rowCells[col] = { netPnl: st.netPnl, trades: st.tradesCount, winRate: st.winRate };
      }
      return { rowLabel: r.label, cells: rowCells };
    });
    return { columns: cols, rows: matrix };
  }

  const topSymbols = symbolsList.slice(0, 10);
  const crossSymbols = (rows: typeof daysRows) => buildCrossAnalysis(rows, topSymbols, (t) => t.symbol ?? "");
  const crossMonthsForSymbols = buildCrossAnalysis(symbolsRows, MONTH_NAMES, (t) => {
    const rawDate = t.closedAt ?? t.closeTime ?? t.openedAt;
    const dStr = typeof rawDate === "string" ? rawDate.slice(0, 10) : dayKeyOf(new Date(rawDate).toISOString(), timeZone);
    const mIdx = Number(dStr.slice(5, 7)) - 1;
    return MONTH_NAMES[mIdx] ?? "";
  });

  // 7. Categorized Tags & Group Breakdowns
  function getTradeAllTagTokensLower(t: any): string[] {
    return [
      ...extractTradeTokens(t.tags ?? t.tag).map((s) => s.toLowerCase()),
      ...extractTradeTokens(t.mistakes ?? t.mistake).map((s) => s.toLowerCase()),
    ];
  }

  const tagsRows = managedTagsList.map((mt) => {
    const targetLower = mt.name.toLowerCase();
    const tgTrades = closedTrades.filter((t) => getTradeAllTagTokensLower(t).includes(targetLower));
    return {
      label: mt.name,
      categoryId: mt.categoryId,
      categoryName: mt.categoryName,
      categoryColor: mt.categoryColor,
      trades: tgTrades,
      stats: buildSummaryStats(tgTrades),
    };
  });

  // Breakdown per category ID
  const tagsByCategory: Record<string, any> = {};
  for (const cat of tagCategoriesList) {
    const catRows = tagsRows.filter((r) => r.categoryId === cat.id);
    tagsByCategory[cat.id] = {
      rows: catRows,
      highlights: getHighlightCards(catRows),
      cross: crossSymbols(catRows),
    };
  }

  // Group rollup: comparing Categories themselves as rows
  const categoryRollupRows = tagCategoriesList.map((cat) => {
    const catTagNamesLower = new Set(
      managedTagsList.filter((mt) => mt.categoryId === cat.id).map((mt) => mt.name.toLowerCase())
    );
    const catTrades = closedTrades.filter((t) =>
      getTradeAllTagTokensLower(t).some((tok) => catTagNamesLower.has(tok))
    );
    return {
      label: cat.name,
      categoryColor: cat.color,
      trades: catTrades,
      stats: buildSummaryStats(catTrades),
    };
  });

  // 8. Wins vs Losses Breakdown
  const winTrades = closedTrades.filter((t) => Number(t.netPnl ?? t.pnl ?? 0) > 0.0001 || t.status === "win");
  const lossTrades = closedTrades.filter((t) => Number(t.netPnl ?? t.pnl ?? 0) < -0.0001 || t.status === "loss");

  function getStreak(arr: any[], isTarget: (t: any) => boolean) {
    let maxS = 0;
    let curS = 0;
    for (const t of arr) {
      if (isTarget(t)) {
        curS++;
        if (curS > maxS) maxS = curS;
      } else {
        curS = 0;
      }
    }
    return maxS;
  }

  function buildDetailedTradeStats(targetTrades: any[], isWins: boolean) {
    const count = targetTrades.length;
    let totalPnl = 0;
    let totalVolume = 0;
    let totalCommissions = 0;
    let totalFees = 0;
    let largestTrade = 0;
    let durationSum = 0;
    let durationCount = 0;
    let plannedRSum = 0;
    let plannedRCount = 0;
    let realizedRSum = 0;
    let realizedRCount = 0;

    for (const t of targetTrades) {
      const net = Number(t.netPnl ?? t.pnl ?? 0);
      totalPnl += net;
      totalVolume += Number(t.quantity ?? t.volume ?? 0);
      totalCommissions += Number(t.commission ?? t.commissions ?? 0);
      totalFees += Number(t.fee ?? t.fees ?? 0);

      if (isWins) {
        if (net > largestTrade) largestTrade = net;
      } else {
        if (net < largestTrade) largestTrade = net;
      }

      const dur = getTradeDuration(t);
      if (dur !== null && dur > 0) {
        durationSum += dur;
        durationCount++;
      }

      if (typeof t.plannedR === "number" && !isNaN(t.plannedR)) {
        plannedRSum += t.plannedR;
        plannedRCount++;
      }
      if (typeof t.realizedR === "number" && !isNaN(t.realizedR)) {
        realizedRSum += t.realizedR;
        realizedRCount++;
      }
    }

    return {
      totalPnl,
      tradesCount: count,
      avgTradePnl: count > 0 ? totalPnl / count : 0,
      largestTrade: count > 0 ? largestTrade : 0,
      avgDurationMs: durationCount > 0 ? durationSum / durationCount : null,
      avgMfe: null,
      avgMae: null,
      avgPlannedR: plannedRCount > 0 ? plannedRSum / plannedRCount : null,
      avgRealizedR: realizedRCount > 0 ? realizedRSum / realizedRCount : null,
      avgDailyVolume: count > 0 ? totalVolume / count : 0,
      totalVolume,
      totalCommissions: totalCommissions + totalFees,
      maxConsecutiveStreak: getStreak(
        closedTrades,
        isWins
          ? (t) => Number(t.netPnl ?? t.pnl ?? 0) > 0.0001
          : (t) => Number(t.netPnl ?? t.pnl ?? 0) < -0.0001
      ),
    };
  }

  function buildCumulativeCurve(targetTrades: any[]) {
    let running = 0;
    const curve: { date: string; cumPnl: number }[] = [];
    const daysMap = new Map<string, number>();

    for (const t of targetTrades) {
      const rawDate = t.closedAt ?? t.closeTime ?? t.openedAt;
      const dStr = typeof rawDate === "string" ? rawDate.slice(0, 10) : dayKeyOf(new Date(rawDate).toISOString(), timeZone);
      daysMap.set(dStr, (daysMap.get(dStr) ?? 0) + Number(t.netPnl ?? t.pnl ?? 0));
    }

    Array.from(daysMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .forEach(([date, dayPnl]) => {
        running += dayPnl;
        curve.push({ date, cumPnl: running });
      });

    return curve;
  }

  // 9. Performance Analytics & Records Tracking
  const days = dailyStats(closedTrades, timeZone);
  const totalTradingDays = days.length;
  let winDays = 0;
  let lossDays = 0;
  let beDays = 0;
  let winDayPnlSum = 0;
  let lossDayPnlSum = 0;
  let largestProfitDay = 0;
  let largestProfitableDayDate = "";
  let largestLosingDay = 0;
  let largestLosingDayDate = "";

  for (const d of days) {
    const dayDate = (d as any).day ?? (d as any).date ?? (d as any).key ?? "";
    if (d.netPnl > 0.0001) {
      winDays++;
      winDayPnlSum += d.netPnl;
      if (d.netPnl > largestProfitDay) {
        largestProfitDay = d.netPnl;
        largestProfitableDayDate = dayDate;
      }
    } else if (d.netPnl < -0.0001) {
      lossDays++;
      lossDayPnlSum += d.netPnl;
      if (d.netPnl < largestLosingDay) {
        largestLosingDay = d.netPnl;
        largestLosingDayDate = dayDate;
      }
    } else {
      beDays++;
    }
  }

  const tradesByDay = new Map<string, any[]>();
  for (const t of closedTrades) {
    const rawDate = t.closedAt ?? t.closeTime ?? t.openedAt;
    const dStr = typeof rawDate === "string"
      ? (rawDate.length === 10 ? rawDate : dayKeyOf(rawDate, timeZone))
      : dayKeyOf(new Date(rawDate).toISOString(), timeZone);
    const list = tradesByDay.get(dStr) ?? [];
    list.push(t);
    tradesByDay.set(dStr, list);
  }

  let dayDurationSum = 0;
  for (const [, dayTrades] of tradesByDay) {
    const opens = dayTrades.map((t) => t.openedAt ? new Date(t.openedAt).getTime() : 0).filter(Boolean);
    const closes = dayTrades.map((t) => (t.closedAt ?? t.closeTime ?? t.exitTime ?? t.openedAt) ? new Date(t.closedAt ?? t.closeTime ?? t.exitTime ?? t.openedAt).getTime() : 0).filter(Boolean);
    if (opens.length > 0 && closes.length > 0) {
      const minO = Math.min(...opens);
      const maxC = Math.max(...closes);
      if (maxC >= minO) dayDurationSum += maxC - minO;
    }
  }

  const totalTradesCount = closedTrades.length;
  const totalPnl = closedTrades.reduce((s, t) => s + Number(t.netPnl ?? t.pnl ?? 0), 0);
  const totalVolume = closedTrades.reduce((s, t) => s + Number(t.quantity ?? t.volume ?? 0), 0);
  const winCount = winTrades.length;
  const lossCount = lossTrades.length;
  const grossProfit = winTrades.reduce((s, t) => s + Number(t.netPnl ?? t.pnl ?? 0), 0);
  const grossLoss = lossTrades.reduce((s, t) => s + Math.abs(Number(t.netPnl ?? t.pnl ?? 0)), 0);

  const avgWinningTrade = winCount > 0 ? grossProfit / winCount : 0;
  const avgLosingTrade = lossCount > 0 ? -(grossLoss / lossCount) : 0;
  const avgWinDayPnl = winDays > 0 ? winDayPnlSum / winDays : 0;
  const avgLossDayPnl = lossDays > 0 ? lossDayPnlSum / lossDays : 0;

  let peak = 0;
  let runningEq = 0;
  let maxDailyNetDd = 0;
  let ddDepths: number[] = [];
  for (const d of days) {
    runningEq += d.netPnl;
    if (runningEq > peak) peak = runningEq;
    const dd = peak - runningEq;
    if (dd > maxDailyNetDd) maxDailyNetDd = dd;
    if (dd > 0) ddDepths.push(dd);
  }
  const avgDailyNetDd = ddDepths.length > 0 ? ddDepths.reduce((a, b) => a + b, 0) / ddDepths.length : 0;

  let totalHoldTimeMs = 0;
  let longestTradeDurationMs = 0;
  let plannedRSum = 0;
  let plannedRCount = 0;
  let realizedRSum = 0;
  let realizedRCount = 0;
  let largestProfitTrade = 0;
  let largestProfitableTradeId: string | null = null;
  let largestLossTrade = 0;
  let largestLosingTradeId: string | null = null;

  for (const t of closedTrades) {
    const net = Number(t.netPnl ?? t.pnl ?? 0);
    if (net > largestProfitTrade) {
      largestProfitTrade = net;
      largestProfitableTradeId = t.id ?? null;
    }
    if (net < largestLossTrade) {
      largestLossTrade = net;
      largestLosingTradeId = t.id ?? null;
    }

    const dur = getTradeDuration(t);
    if (dur !== null && dur > 0) {
      totalHoldTimeMs += dur;
      if (dur > longestTradeDurationMs) longestTradeDurationMs = dur;
    }

    if (typeof t.plannedR === "number" && !isNaN(t.plannedR)) {
      plannedRSum += t.plannedR;
      plannedRCount++;
    }
    if (typeof t.realizedR === "number" && !isNaN(t.realizedR)) {
      realizedRSum += t.realizedR;
      realizedRCount++;
    }
  }

  const longs = closedTrades.filter((t) => String(t.direction ?? "").toLowerCase().includes("long"));
  const shorts = closedTrades.filter((t) => String(t.direction ?? "").toLowerCase().includes("short"));
  const longsWins = longs.filter((t) => Number(t.netPnl ?? t.pnl ?? 0) > 0.0001).length;
  const shortsWins = shorts.filter((t) => Number(t.netPnl ?? t.pnl ?? 0) > 0.0001).length;

  const winRate = totalTradesCount > 0 ? (winCount / totalTradesCount) * 100 : 0;
  const lossRate = totalTradesCount > 0 ? lossCount / totalTradesCount : 0;
  const tradeExpectancy = (winRate / 100) * avgWinningTrade + lossRate * avgLosingTrade;

  const performanceData = {
    summary: {
      netPnl: totalPnl,
      winRate,
      avgDailyWinPct: totalTradingDays > 0 ? (winDays / totalTradingDays) * 100 : 0,
      dailyRecord: { wins: winDays, bes: beDays, losses: lossDays },
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99 : 0,
      tradeExpectancy,
      avgDailyWinLoss: Math.abs(avgLossDayPnl) > 0 ? avgWinDayPnl / Math.abs(avgLossDayPnl) : 0,
      avgTradeWinLoss: Math.abs(avgLosingTrade) > 0 ? avgWinningTrade / Math.abs(avgLosingTrade) : 0,
      avgHoldTimeMs: totalTradesCount > 0 ? totalHoldTimeMs / totalTradesCount : 0,
      avgNetTradePnl: totalTradesCount > 0 ? totalPnl / totalTradesCount : 0,
      avgDailyNetPnl: totalTradingDays > 0 ? totalPnl / totalTradingDays : 0,
      avgPlannedR: plannedRCount > 0 ? plannedRSum / plannedRCount : null,
      avgRealizedR: realizedRCount > 0 ? realizedRSum / realizedRCount : null,
      avgDailyVolume: totalTradingDays > 0 ? totalVolume / totalTradingDays : 0,
      loggedDays: 0,
      maxDailyNetDrawdown: -maxDailyNetDd,
      avgDailyNetDrawdown: -avgDailyNetDd,
    },
    days: {
      avgDailyWinPct: totalTradingDays > 0 ? (winDays / totalTradingDays) * 100 : 0,
      dailyRecord: { wins: winDays, bes: beDays, losses: lossDays },
      largestLosingDay,
      largestLosingDayDate,
      avgDailyWinLoss: Math.abs(avgLossDayPnl) > 0 ? avgWinDayPnl / Math.abs(avgLossDayPnl) : 0,
      avgTradingDaysDurationMs: totalTradingDays > 0 ? dayDurationSum / totalTradingDays : 0,
      largestProfitableDay: largestProfitDay,
      largestProfitableDayDate,
      avgDailyNetPnl: totalTradingDays > 0 ? totalPnl / totalTradingDays : 0,
      winRate,
    },
    trades: {
      winRate,
      longsWinPct: longs.length > 0 ? (longsWins / longs.length) * 100 : 0,
      avgNetTradePnl: totalTradesCount > 0 ? totalPnl / totalTradesCount : 0,
      avgTradeWinLoss: Math.abs(avgLosingTrade) > 0 ? avgWinningTrade / Math.abs(avgLosingTrade) : 0,
      tradeExpectancy,
      avgTradingDaysDurationMs: totalTradingDays > 0 ? dayDurationSum / totalTradingDays : 0,
      largestProfitableTrade: largestProfitTrade,
      largestProfitableTradeId,
      largestLosingTrade: largestLossTrade,
      largestLosingTradeId,
      longestTradeDurationMs,
      shortsWinPct: shorts.length > 0 ? (shortsWins / shorts.length) * 100 : 0,
    },
  };

  
  ensurePlaybookTables();
  const allRuleChecks = db.select().from(tradeRuleChecks).all();
  const strategyRulesList: {
    playbookId: string;
    playbookName: string;
    playbookIcon: string;
    groupName: string;
    ruleText: string;
    frequency: string;
  }[] = [];

  const playbooksBrief = allPlaybooks.map((pb) => {
    const meta = getMetaRow(pb.id);
    const icon = meta?.icon ?? "🚀";
    const ruleGroups = normalizeRuleGroups(meta?.rule_groups_json, pb.rulesJson);
    const seenRules = new Set<string>();

    for (const g of ruleGroups) {
      for (const r of g.rules) {
        const txt = r.text.trim();
        if (txt && !seenRules.has(txt)) {
          seenRules.add(txt);
          strategyRulesList.push({
            playbookId: pb.id,
            playbookName: pb.name,
            playbookIcon: icon,
            groupName: g.name,
            ruleText: txt,
            frequency: r.frequency ?? "Always",
          });
        }
      }
    }

    // Also include any legacy rules from pb.rulesJson or tradeRuleChecks
    try {
      const legacy = JSON.parse(pb.rulesJson || "[]") as string[];
      for (const txt of legacy) {
        const trimmed = String(txt).trim();
        if (trimmed && !seenRules.has(trimmed)) {
          seenRules.add(trimmed);
          strategyRulesList.push({
            playbookId: pb.id,
            playbookName: pb.name,
            playbookIcon: icon,
            groupName: "Strategy rules",
            ruleText: trimmed,
            frequency: "Always",
          });
        }
      }
    } catch {}

    return { id: pb.id, name: pb.name, icon };
  });

  return ok({
    strategyRules: {
      playbooks: playbooksBrief,
      rules: strategyRulesList,
      checks: allRuleChecks,
    },
    currency,
    trades: closedTrades,
    tagCategories: tagCategoriesList,
    days: {
      rows: daysRows,
      highlights: getHighlightCards(daysRows),
      cross: crossSymbols(daysRows),
    },
    months: {
      rows: monthsRows,
      highlights: getHighlightCards(monthsRows),
      cross: crossSymbols(monthsRows),
    },
    tradeTime: {
      rows: hoursRows,
      highlights: getHighlightCards(hoursRows),
      cross: crossSymbols(hoursRows),
    },
    tradeDuration: {
      rows: durationRows,
      highlights: getHighlightCards(durationRows),
      cross: crossSymbols(durationRows),
    },
    symbols: {
      rows: symbolsRows,
      highlights: getHighlightCards(symbolsRows),
      cross: crossMonthsForSymbols,
    },
    strategies: {
      rows: playbookRows,
      highlights: getHighlightCards(playbookRows),
      cross: crossSymbols(playbookRows),
    },
    tags: {
      rows: tagsRows,
      highlights: getHighlightCards(tagsRows),
      cross: crossSymbols(tagsRows),
      byCategory: tagsByCategory,
      categoryRollup: {
        rows: categoryRollupRows,
        highlights: getHighlightCards(categoryRollupRows),
        cross: crossSymbols(categoryRollupRows),
      },
    },
    winsVsLosses: {
      winsStats: buildDetailedTradeStats(winTrades, true),
      lossesStats: buildDetailedTradeStats(lossTrades, false),
      winsCurve: buildCumulativeCurve(winTrades),
      lossesCurve: buildCumulativeCurve(lossTrades),
    },
    performance: performanceData,
  });
});
