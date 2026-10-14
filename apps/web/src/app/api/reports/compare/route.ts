import { dayKeyOf, readFilters } from "@luxalgo/journal-core";
import { accounts, db, playbooks as playbooksTable } from "@/db";
import { handler, ok } from "@/server/api";
import { getTimeZone, getCurrencyConversion } from "@/server/settings";
import { currencyProjection } from "@/server/currency-conversion";
import { queryTrades } from "@/server/trades-query";

interface GroupFilterConfig {
  symbols?: string[];
  tags?: string[];
  strategies?: string[];
  side?: string; // "all" | "long" | "short"
  pnlStatus?: string; // "all" | "win" | "loss" | "breakeven"
  startDate?: string;
  endDate?: string;
}

const DAY_NAMES = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"
];

function extractTokens(val: unknown): string[] {
  if (!val) return [];
  if (Array.isArray(val)) return val.flatMap(extractTokens);
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try { return extractTokens(JSON.parse(trimmed)); } catch {}
    }
    return trimmed.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

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

export const POST = handler(async (request: Request) => {
  const body = await request.json().catch(() => ({}));
  const g1Config: GroupFilterConfig = body.group1 || {};
  const g2Config: GroupFilterConfig = body.group2 || {};

  const timeZone = getTimeZone();
  const filters = readFilters(new URLSearchParams(body.globalQuery || ""));

  const { trades: originalTrades } = queryTrades(filters);
  const selectedIds = filters.accounts?.split(",").map((id) => id.trim());
  const accountRows = db
    .select()
    .from(accounts)
    .all()
    .filter((account) => !selectedIds || selectedIds.includes(account.id));

  const allPlaybooks = db.select().from(playbooksTable).all();
  const playbookMap = new Map(allPlaybooks.map((p) => [p.id, p.name]));

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

  function filterGroupTrades(cfg: GroupFilterConfig) {
    return closedTrades.filter((t) => {
      // 1. Symbol filter
      if (cfg.symbols && cfg.symbols.length > 0) {
        if (!cfg.symbols.includes(t.symbol)) return false;
      }

      // 2. Tags filter
      if (cfg.tags && cfg.tags.length > 0) {
        const tradeTags = extractTokens(t.tags ?? t.tag);
        const hasMatch = cfg.tags.some((tag) => tradeTags.includes(tag));
        if (!hasMatch) return false;
      }

      // 3. Strategy filter
      if (cfg.strategies && cfg.strategies.length > 0) {
        const pbName = (t.playbookId && playbookMap.get(t.playbookId))
          ? playbookMap.get(t.playbookId)!
          : "None";
        const matches =
          cfg.strategies.includes(pbName) ||
          (t.playbookId && cfg.strategies.includes(t.playbookId));
        if (!matches) return false;
      }

      // 4. Side filter
      if (cfg.side && cfg.side !== "all") {
        const dir = String(t.direction ?? "").toLowerCase();
        if (cfg.side === "long" && !dir.includes("long")) return false;
        if (cfg.side === "short" && !dir.includes("short")) return false;
      }

      // 5. Trade P&L outcome filter
      const net = Number(t.netPnl ?? t.pnl ?? 0);
      if (cfg.pnlStatus && cfg.pnlStatus !== "all") {
        if (cfg.pnlStatus === "win" && net <= 0.0001 && t.status !== "win") return false;
        if (cfg.pnlStatus === "loss" && net >= -0.0001 && t.status !== "loss") return false;
        if (cfg.pnlStatus === "breakeven" && Math.abs(net) > 0.0001) return false;
      }

      // 6. Date boundaries
      const rawDate = t.closedAt ?? t.closeTime ?? t.openedAt;
      const dStr = typeof rawDate === "string"
        ? (rawDate.length === 10 ? rawDate : dayKeyOf(rawDate, timeZone))
        : dayKeyOf(new Date(rawDate).toISOString(), timeZone);

      if (cfg.startDate && dStr < cfg.startDate) return false;
      if (cfg.endDate && dStr > cfg.endDate) return false;

      return true;
    });
  }

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

  function analyzeGroup(groupTrades: any[]) {
    const count = groupTrades.length;
    let totalPnl = 0;
    let totalVolume = 0;
    let totalCommissions = 0;
    let totalFees = 0;

    let grossWin = 0;
    let grossLoss = 0;
    let winCount = 0;
    let lossCount = 0;

    let holdTimeSum = 0;
    let holdTimeCount = 0;
    let winHoldTimeSum = 0;
    let lossHoldTimeSum = 0;

    let plannedRSum = 0;
    let plannedRCount = 0;
    let realizedRSum = 0;
    let realizedRCount = 0;

    const symbolMap = new Map<string, number>();
    const dayMap = new Map<string, number>();
    const strategyMap = new Map<string, number>();
    const tagMap = new Map<string, number>();

    let longsCount = 0;
    let longsWins = 0;
    let shortsCount = 0;
    let shortsWins = 0;

    for (const t of groupTrades) {
      const net = Number(t.netPnl ?? t.pnl ?? 0);
      totalPnl += net;
      totalVolume += Number(t.quantity ?? t.volume ?? 0);
      totalCommissions += Number(t.commission ?? t.commissions ?? 0);
      totalFees += Number(t.fee ?? t.fees ?? 0);

      const dir = String(t.direction ?? "").toLowerCase();
      if (dir.includes("long")) {
        longsCount++;
        if (net > 0.0001) longsWins++;
      } else if (dir.includes("short")) {
        shortsCount++;
        if (net > 0.0001) shortsWins++;
      }

      const dur = getTradeDuration(t);
      if (dur !== null && dur > 0) {
        holdTimeSum += dur;
        holdTimeCount++;
      }

      if (typeof t.plannedR === "number" && !isNaN(t.plannedR)) {
        plannedRSum += t.plannedR;
        plannedRCount++;
      }
      if (typeof t.realizedR === "number" && !isNaN(t.realizedR)) {
        realizedRSum += t.realizedR;
        realizedRCount++;
      }

      if (net > 0.0001 || t.status === "win") {
        winCount++;
        grossWin += net;
        if (dur !== null && dur > 0) winHoldTimeSum += dur;
      } else if (net < -0.0001 || t.status === "loss") {
        lossCount++;
        grossLoss += Math.abs(net);
        if (dur !== null && dur > 0) lossHoldTimeSum += dur;
      }

      if (t.symbol) {
        symbolMap.set(t.symbol, (symbolMap.get(t.symbol) ?? 0) + net);
      }

      const rawDate = t.closedAt ?? t.closeTime ?? t.openedAt;
      if (rawDate) {
        const d = new Date(rawDate);
        const dayName = DAY_NAMES[d.getUTCDay()] ?? "Other";
        dayMap.set(dayName, (dayMap.get(dayName) ?? 0) + net);
      }

      const pbName = (t.playbookId && playbookMap.get(t.playbookId)) ? playbookMap.get(t.playbookId)! : "None";
      strategyMap.set(pbName, (strategyMap.get(pbName) ?? 0) + net);

      extractTokens(t.tags ?? t.tag).forEach((tg) => {
        tagMap.set(tg, (tagMap.get(tg) ?? 0) + net);
      });
    }

    function getBestAndWorst(map: Map<string, number>) {
      if (map.size === 0) return { best: null, worst: null };
      const arr = Array.from(map.entries());
      const best = arr.reduce((p, c) => (c[1] > p[1] ? c : p));
      const worst = arr.reduce((p, c) => (c[1] < p[1] ? c : p));
      return {
        best: { name: best[0], pnl: best[1] },
        worst: { name: worst[0], pnl: worst[1] },
      };
    }

    const daysMap = new Map<string, number>();
    for (const t of groupTrades) {
      const rawDate = t.closedAt ?? t.closeTime ?? t.openedAt;
      const dStr = typeof rawDate === "string"
        ? (rawDate.length === 10 ? rawDate : dayKeyOf(rawDate, timeZone))
        : dayKeyOf(new Date(rawDate).toISOString(), timeZone);
      daysMap.set(dStr, (daysMap.get(dStr) ?? 0) + Number(t.netPnl ?? t.pnl ?? 0));
    }

    let running = 0;
    const curve: { date: string; cumPnl: number }[] = [];
    Array.from(daysMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .forEach(([date, dayPnl]) => {
        running += dayPnl;
        curve.push({ date, cumPnl: running });
      });

    const winRate = count > 0 ? (winCount / count) * 100 : 0;
    const avgWin = winCount > 0 ? grossWin / winCount : 0;
    const avgLoss = lossCount > 0 ? -(grossLoss / lossCount) : 0;
    const lossRate = count > 0 ? lossCount / count : 0;
    const expectancy = (winRate / 100) * avgWin + lossRate * avgLoss;

    return {
      tradesCount: count,
      totalPnl,
      avgDailyVolume: count > 0 ? totalVolume / count : 0,
      avgWinningTrade: winCount > 0 ? avgWin : null,
      avgLosingTrade: lossCount > 0 ? avgLoss : null,
      winningTrades: winCount,
      losingTrades: lossCount,
      totalCommissions: totalCommissions + totalFees,
      maxConsecutiveWins: getStreak(groupTrades, (t) => Number(t.netPnl ?? t.pnl ?? 0) > 0.0001),
      maxConsecutiveLosses: getStreak(groupTrades, (t) => Number(t.netPnl ?? t.pnl ?? 0) < -0.0001),
      avgHoldTimeAllMs: holdTimeCount > 0 ? holdTimeSum / holdTimeCount : null,
      avgHoldTimeWinMs: winCount > 0 ? winHoldTimeSum / winCount : null,
      avgHoldTimeLossMs: lossCount > 0 ? lossHoldTimeSum / lossCount : null,
      profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 99 : 0,
      tradeExpectancy: expectancy,
      avgPlannedR: plannedRCount > 0 ? plannedRSum / plannedRCount : null,
      avgRealizedR: realizedRCount > 0 ? realizedRSum / realizedRCount : null,
      longsWinPct: longsCount > 0 ? (longsWins / longsCount) * 100 : 0,
      shortsWinPct: shortsCount > 0 ? (shortsWins / shortsCount) * 100 : 0,
      assetStats: getBestAndWorst(symbolMap),
      dayStats: getBestAndWorst(dayMap),
      strategyStats: getBestAndWorst(strategyMap),
      tagStats: getBestAndWorst(tagMap),
      winRate,
      curve,
    };
  }

  const group1Trades = filterGroupTrades(g1Config);
  const group2Trades = filterGroupTrades(g2Config);

  return ok({
    currency,
    group1: analyzeGroup(group1Trades),
    group2: analyzeGroup(group2Trades),
  });
});
