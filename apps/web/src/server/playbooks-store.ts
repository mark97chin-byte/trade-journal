import { asc, eq, and, sql } from "drizzle-orm";
import { db, playbooks, trades, tradeRuleChecks, accounts } from "@/db";
import { dailyStats, dayKeyOf, readFilters } from "@luxalgo/journal-core";
import { getTimeZone, getCurrencyConversion } from "@/server/settings";
import { currencyProjection } from "@/server/currency-conversion";
import { queryTrades } from "@/server/trades-query";
import { newId, nowIso } from "@/server/ids";

export interface PlaybookRuleItem {
  id: string;
  text: string;
  frequency: "Always" | "Sometimes" | "Optional";
}

export interface PlaybookRuleGroup {
  id: string;
  name: string;
  rules: PlaybookRuleItem[];
}

export interface PlaybookNote {
  id: string;
  playbookId: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

let tablesInitialized = false;

export function ensurePlaybookTables() {
  if (tablesInitialized) return;

  db.run(sql`
    CREATE TABLE IF NOT EXISTS playbook_meta (
      playbook_id TEXT PRIMARY KEY,
      icon TEXT NOT NULL DEFAULT '🚀',
      color TEXT NOT NULL DEFAULT '#6366f1',
      photo_url TEXT NOT NULL DEFAULT '',
      tags_json TEXT NOT NULL DEFAULT '[]',
      rule_groups_json TEXT NOT NULL DEFAULT '[]',
      archived INTEGER NOT NULL DEFAULT 0
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS playbook_notes (
      id TEXT PRIMARY KEY,
      playbook_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT 'Untitled',
      content TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  tablesInitialized = true;
}

export function flattenRuleGroups(groups: PlaybookRuleGroup[]): string[] {
  const result: string[] = [];
  for (const g of groups) {
    for (const r of g.rules) {
      const trimmed = r.text.trim();
      if (trimmed && !result.includes(trimmed)) {
        result.push(trimmed);
      }
    }
  }
  return result;
}

export function normalizeRuleGroups(
  ruleGroupsJson: string | null | undefined,
  fallbackRulesJson: string
): PlaybookRuleGroup[] {
  if (ruleGroupsJson) {
    try {
      const parsed = JSON.parse(ruleGroupsJson);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    } catch {
      // fallback
    }
  }

  try {
    const flatRules = JSON.parse(fallbackRulesJson) as string[];
    if (Array.isArray(flatRules) && flatRules.length > 0) {
      return [
        {
          id: "group-default",
          name: "Entry criteria",
          rules: flatRules.map((text, idx) => ({
            id: `rule-${idx}`,
            text,
            frequency: "Always",
          })),
        },
      ];
    }
  } catch {
    // ignore
  }

  return [
    {
      id: "group-entry",
      name: "Entry criteria",
      rules: [],
    },
  ];
}

function getTradeDurationMs(t: any): number | null {
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

export function getMetaRow(playbookId: string) {
  ensurePlaybookTables();
  const rows = db.all<{
    playbook_id: string;
    icon: string;
    color: string;
    photo_url: string;
    tags_json: string;
    rule_groups_json: string;
    archived: number;
  }>(sql`SELECT * FROM playbook_meta WHERE playbook_id = ${playbookId}`);
  return rows[0] ?? null;
}

export function upsertMetaRow(
  playbookId: string,
  patch: {
    icon?: string;
    color?: string;
    photoUrl?: string;
    tags?: string[];
    ruleGroups?: PlaybookRuleGroup[];
    archived?: boolean;
  }
) {
  ensurePlaybookTables();
  const current = getMetaRow(playbookId);
  const icon = patch.icon ?? current?.icon ?? "🚀";
  const color = patch.color ?? current?.color ?? "#6366f1";
  const photoUrl = patch.photoUrl ?? current?.photo_url ?? "";
  const tagsJson = patch.tags ? JSON.stringify(patch.tags) : current?.tags_json ?? "[]";
  const ruleGroupsJson = patch.ruleGroups
    ? JSON.stringify(patch.ruleGroups)
    : current?.rule_groups_json ?? "[]";
  const archived =
    patch.archived !== undefined ? (patch.archived ? 1 : 0) : current?.archived ?? 0;

  db.run(sql`
    INSERT INTO playbook_meta (playbook_id, icon, color, photo_url, tags_json, rule_groups_json, archived)
    VALUES (${playbookId}, ${icon}, ${color}, ${photoUrl}, ${tagsJson}, ${ruleGroupsJson}, ${archived})
    ON CONFLICT(playbook_id) DO UPDATE SET
      icon = excluded.icon,
      color = excluded.color,
      photo_url = excluded.photo_url,
      tags_json = excluded.tags_json,
      rule_groups_json = excluded.rule_groups_json,
      archived = excluded.archived
  `);
}

export function computeStrategyMetrics(playbookTrades: any[], timeZone: string) {
  const closedTrades = playbookTrades.filter((t) =>
    Boolean(t.closedAt ?? t.closeTime ?? t.exitTime)
  );

  closedTrades.sort((a, b) => {
    const tA = new Date(a.closedAt ?? a.closeTime ?? a.openedAt).getTime();
    const tB = new Date(b.closedAt ?? b.closeTime ?? b.openedAt).getTime();
    return tA - tB;
  });

  const count = closedTrades.length;
  let netPnl = 0;
  let grossWin = 0;
  let grossLoss = 0;
  let wins = 0;
  let losses = 0;
  let beCount = 0;
  let totalHoldTimeMs = 0;
  let holdTimeCount = 0;
  let totalVolume = 0;
  let plannedRSum = 0;
  let plannedRCount = 0;
  let realizedRSum = 0;
  let realizedRCount = 0;

  for (const t of closedTrades) {
    const pnl = Number(t.netPnl ?? t.pnl ?? 0);
    netPnl += pnl;
    totalVolume += Number(t.quantity ?? t.volume ?? 0);

    if (pnl > 0.0001 || t.status === "win") {
      wins++;
      grossWin += pnl;
    } else if (pnl < -0.0001 || t.status === "loss") {
      losses++;
      grossLoss += Math.abs(pnl);
    } else {
      beCount++;
    }

    const dur = getTradeDurationMs(t);
    if (dur !== null && dur > 0) {
      totalHoldTimeMs += dur;
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
  }

  const winRate = count > 0 ? (wins / count) * 100 : 0;
  const avgWinner = wins > 0 ? grossWin / wins : 0;
  const avgLoser = losses > 0 ? -(grossLoss / losses) : 0;
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 0 : 0;
  const avgHoldTimeMs = holdTimeCount > 0 ? totalHoldTimeMs / holdTimeCount : 0;
  const winLossRatio = Math.abs(avgLoser) > 0 ? avgWinner / Math.abs(avgLoser) : 0;
  const lossRate = count > 0 ? losses / count : 0;
  const tradeExpectancy = (winRate / 100) * avgWinner + lossRate * avgLoser;

  // Daily breakdown & cumulative curve
  const days = dailyStats(closedTrades, timeZone);
  const totalTradingDays = days.length;
  let winDays = 0;
  let lossDays = 0;
  let beDays = 0;
  let running = 0;
  let peak = 0;
  let maxDailyNetDrawdown = 0;
  const ddList: number[] = [];
  const cumulativeCurve: { date: string; cumPnl: number }[] = [];

  for (const d of days) {
    const dayDate = (d as any).day ?? (d as any).date ?? "";
    if (d.netPnl > 0.0001) winDays++;
    else if (d.netPnl < -0.0001) lossDays++;
    else beDays++;

    running += d.netPnl;
    if (running > peak) peak = running;
    const dd = peak - running;
    if (dd > maxDailyNetDrawdown) maxDailyNetDrawdown = dd;
    if (dd > 0) ddList.push(dd);

    cumulativeCurve.push({ date: dayDate, cumPnl: running });
  }

  const dailyWinRate = totalTradingDays > 0 ? (winDays / totalTradingDays) * 100 : 0;
  const avgDailyNetDrawdown =
    ddList.length > 0 ? ddList.reduce((a, b) => a + b, 0) / ddList.length : 0;

  return {
    tradesCount: count,
    wins,
    losses,
    beCount,
    winRate,
    netPnl,
    grossWin,
    grossLoss,
    avgWinner,
    avgLoser,
    profitFactor,
    avgHoldTimeMs,
    winLossRatio,
    tradeExpectancy,
    avgNetTradePnl: count > 0 ? netPnl / count : 0,
    dailyWinRate,
    dailyRecord: { wins: winDays, bes: beDays, losses: lossDays },
    maxDailyNetDrawdown: -maxDailyNetDrawdown,
    avgDailyNetDrawdown: -avgDailyNetDrawdown,
    avgDailyVolume: totalTradingDays > 0 ? totalVolume / totalTradingDays : 0,
    avgPlannedR: plannedRCount > 0 ? plannedRSum / plannedRCount : null,
    avgRealizedR: realizedRCount > 0 ? realizedRSum / realizedRCount : null,
    cumulativeCurve,
  };
}

export function getAllPlaybooksEnriched(searchParams?: URLSearchParams) {
  ensurePlaybookTables();
  const timeZone = getTimeZone();
  const filters = searchParams ? readFilters(searchParams) : {};
  const { trades: rawTrades } = queryTrades(filters);
  const accountRows = db.select().from(accounts).all();
  const { trades: projectedTrades, scope } = currencyProjection(
    rawTrades,
    accountRows,
    getCurrencyConversion()
  );
  const currency = scope.monetary ? scope.currency ?? "USD" : "USD";

  // Count missed trades per playbook if missed_trades table exists
  const missedCountMap = new Map<string, number>();
  try {
    const missedRows = db.all<{ playbook_id: string }>(
      sql`SELECT playbook_id FROM missed_trades WHERE playbook_id IS NOT NULL`
    );
    for (const r of missedRows) {
      if (r.playbook_id) {
        missedCountMap.set(r.playbook_id, (missedCountMap.get(r.playbook_id) ?? 0) + 1);
      }
    }
  } catch {
    // ignore if table doesn't exist
  }

  const pbRows = db.select().from(playbooks).orderBy(asc(playbooks.createdAt)).all();

  const enriched = pbRows.map((row) => {
    const meta = getMetaRow(row.id);
    const ruleGroups = normalizeRuleGroups(meta?.rule_groups_json, row.rulesJson);
    const rules = flattenRuleGroups(ruleGroups);
    const tags: string[] = meta?.tags_json ? JSON.parse(meta.tags_json) : [];
    const pbTrades = (projectedTrades as any[]).filter((t) => t.playbookId === row.id);
    const stats = computeStrategyMetrics(pbTrades, timeZone);

    return {
      id: row.id,
      name: row.name,
      description: row.description ?? "",
      createdAt: row.createdAt,
      icon: meta?.icon ?? "🚀",
      color: meta?.color ?? "#6366f1",
      photoUrl: meta?.photo_url ?? "",
      tags,
      archived: Boolean(meta?.archived),
      ruleGroups,
      rules,
      tradeCount: stats.tradesCount,
      missedTradesCount: missedCountMap.get(row.id) ?? 0,
      stats,
    };
  });

  // Compute Top 4 Highlight Cards across active playbooks
  const activePlaybooks = enriched.filter((p) => !p.archived);
  const withTrades = activePlaybooks.filter((p) => p.stats.tradesCount > 0);
  const pool = withTrades.length > 0 ? withTrades : activePlaybooks;

  const highlights =
    pool.length > 0
      ? {
          best: pool.reduce((a, b) => (b.stats.netPnl > a.stats.netPnl ? b : a)),
          least: pool.reduce((a, b) => (b.stats.netPnl < a.stats.netPnl ? b : a)),
          mostActive: pool.reduce((a, b) =>
            b.stats.tradesCount > a.stats.tradesCount ? b : a
          ),
          bestWinRate: pool.reduce((a, b) =>
            b.stats.winRate > a.stats.winRate ? b : a
          ),
        }
      : null;

  return {
    currency,
    playbooks: enriched,
    highlights: highlights
      ? {
          best: {
            id: highlights.best.id,
            name: highlights.best.name,
            icon: highlights.best.icon,
            tradesCount: highlights.best.stats.tradesCount,
            netPnl: highlights.best.stats.netPnl,
          },
          least: {
            id: highlights.least.id,
            name: highlights.least.name,
            icon: highlights.least.icon,
            tradesCount: highlights.least.stats.tradesCount,
            netPnl: highlights.least.stats.netPnl,
          },
          mostActive: {
            id: highlights.mostActive.id,
            name: highlights.mostActive.name,
            icon: highlights.mostActive.icon,
            tradesCount: highlights.mostActive.stats.tradesCount,
          },
          bestWinRate: {
            id: highlights.bestWinRate.id,
            name: highlights.bestWinRate.name,
            icon: highlights.bestWinRate.icon,
            winRate: highlights.bestWinRate.stats.winRate,
            tradesCount: highlights.bestWinRate.stats.tradesCount,
          },
        }
      : null,
  };
}

export function getPlaybookDetail(id: string, searchParams?: URLSearchParams) {
  ensurePlaybookTables();
  const row = db.select().from(playbooks).where(eq(playbooks.id, id)).get();
  if (!row) return null;

  const timeZone = getTimeZone();
  const filters = searchParams ? readFilters(searchParams) : {};
  const { trades: rawTrades } = queryTrades(filters);
  const accountRows = db.select().from(accounts).all();
  const { trades: projectedTrades, scope } = currencyProjection(
    rawTrades,
    accountRows,
    getCurrencyConversion()
  );
  const currency = scope.monetary ? scope.currency ?? "USD" : "USD";

  const meta = getMetaRow(row.id);
  const ruleGroups = normalizeRuleGroups(meta?.rule_groups_json, row.rulesJson);
  const rules = flattenRuleGroups(ruleGroups);
  const tags: string[] = meta?.tags_json ? JSON.parse(meta.tags_json) : [];

  const pbTrades = (projectedTrades as any[]).filter((t) => t.playbookId === row.id);
  const stats = computeStrategyMetrics(pbTrades, timeZone);

  // Compute per-rule performance from tradeRuleChecks
  const allChecks = db
    .select()
    .from(tradeRuleChecks)
    .where(eq(tradeRuleChecks.playbookId, row.id))
    .all();

  const tradeByKey = new Map<string, any>();
  for (const t of pbTrades) {
    const k = t.key ?? t.id;
    if (k) tradeByKey.set(String(k), t);
  }

  const ruleGroupsWithStats = ruleGroups.map((group) => ({
    ...group,
    rules: group.rules.map((r) => {
      const checksForRule = allChecks.filter(
        (c) => c.rule === r.text && tradeByKey.has(c.tradeKey)
      );
      const followedChecks = checksForRule.filter((c) => c.followed);
      const denominator = pbTrades.length > 0 ? pbTrades.length : 0;
      const followRate =
        denominator > 0 ? (followedChecks.length / denominator) * 100 : 0;

      const followedTrades = followedChecks
        .map((c) => tradeByKey.get(c.tradeKey))
        .filter(Boolean);

      let rNetPnl = 0;
      let rGrossWin = 0;
      let rGrossLoss = 0;
      let rWins = 0;
      for (const ft of followedTrades) {
        const p = Number(ft.netPnl ?? ft.pnl ?? 0);
        rNetPnl += p;
        if (p > 0.0001 || ft.status === "win") {
          rWins++;
          rGrossWin += p;
        } else if (p < -0.0001 || ft.status === "loss") {
          rGrossLoss += Math.abs(p);
        }
      }

      const rWinRate =
        followedTrades.length > 0 ? (rWins / followedTrades.length) * 100 : 0;
      const rProfitFactor =
        rGrossLoss > 0 ? rGrossWin / rGrossLoss : null;

      return {
        ...r,
        followRate,
        netPnl: rNetPnl,
        profitFactor: rProfitFactor,
        winRate: rWinRate,
        followedCount: followedTrades.length,
      };
    }),
  }));

  // Missed trades for this playbook
  let missedTrades: any[] = [];
  try {
    missedTrades = db.all(
      sql`SELECT * FROM missed_trades WHERE playbook_id = ${row.id} ORDER BY created_at DESC`
    );
  } catch {
    missedTrades = [];
  }

  // Notes for this playbook
  const notes = db.all< {
    id: string;
    playbook_id: string;
    title: string;
    content: string;
    created_at: string;
    updated_at: string;
  }>(
    sql`SELECT * FROM playbook_notes WHERE playbook_id = ${row.id} ORDER BY created_at ASC`
  ).map((n) => ({
    id: n.id,
    playbookId: n.playbook_id,
    title: n.title,
    content: n.content,
    createdAt: n.created_at,
    updatedAt: n.updated_at,
  }));

  return {
    currency,
    playbook: {
      id: row.id,
      name: row.name,
      description: row.description ?? "",
      createdAt: row.createdAt,
      icon: meta?.icon ?? "🚀",
      color: meta?.color ?? "#6366f1",
      photoUrl: meta?.photo_url ?? "",
      tags,
      archived: Boolean(meta?.archived),
      ruleGroups: ruleGroupsWithStats,
      rules,
      stats,
      trades: pbTrades.map((t) => ({
        key: t.key ?? t.id,
        id: t.id,
        symbol: t.symbol,
        direction: t.direction,
        status:
          Number(t.netPnl ?? t.pnl ?? 0) > 0.0001
            ? "WIN"
            : Number(t.netPnl ?? t.pnl ?? 0) < -0.0001
            ? "LOSS"
            : "BE",
        openedAt: t.openedAt,
        closedAt: t.closedAt ?? t.closeTime ?? t.exitTime,
        avgEntry: t.avgEntry ?? t.entryPrice ?? 0,
        avgExit: t.avgExit ?? t.exitPrice ?? 0,
        quantity: t.quantity ?? t.volume ?? 0,
        netPnl: Number(t.netPnl ?? t.pnl ?? 0),
        roi:
          t.avgEntry && t.quantity
            ? (Number(t.netPnl ?? t.pnl ?? 0) /
                (Math.abs(Number(t.avgEntry)) * Math.abs(Number(t.quantity)))) *
              100
            : 0,
      })),
      missedTrades,
      notes,
    },
  };
}
