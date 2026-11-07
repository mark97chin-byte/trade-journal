import { and, asc, eq, inArray } from "drizzle-orm";
import { matchesFilters, tradeR, plannedR, type AnalysisFilters, type AnnotatedTrade } from "@luxalgo/journal-core";
import { getTimeZone, getMultipliers, getJournalDefaults } from "./settings";
import { db, trades } from "@/db";

export type TradeFilters = AnalysisFilters & { accountIds?: string[] };

export type TradeRow = typeof trades.$inferSelect;

export interface ExtraTradeColumns {
  realized_r: number | null;
  planned_r: number | null;
  mae_r: number | null;
  mfe_r: number | null;
  capture_eff: number | null;
  risk_percent: number | null;
  exit_reason: string | null;
  partials_breakdown: string | null;
  tickets: string | null;
  review_notes: string | null;
}

const parseJsonArray = (value: string | null): string[] => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
};

function loadExtraTradeColumnsMap(): Map<string, ExtraTradeColumns> {
  const map = new Map<string, ExtraTradeColumns>();
  try {
    const rawRows = (db as any).$client
      .prepare(
        `SELECT key,
                realized_r,
                planned_r,
                mae_r,
                mfe_r,
                capture_eff,
                risk_percent,
                exit_reason,
                partials_breakdown,
                tickets
         FROM trades`
      )
      .all() as Array<any>;
    for (const r of rawRows) {
      map.set(String(r.key), {
        realized_r: typeof r.realized_r === "number" ? r.realized_r : null,
        planned_r: typeof r.planned_r === "number" ? r.planned_r : null,
        mae_r: typeof r.mae_r === "number" ? r.mae_r : null,
        mfe_r: typeof r.mfe_r === "number" ? r.mfe_r : null,
        capture_eff: typeof r.capture_eff === "number" ? r.capture_eff : null,
        risk_percent: typeof r.risk_percent === "number" ? r.risk_percent : null,
        exit_reason: r.exit_reason ?? null,
        partials_breakdown: r.partials_breakdown ?? null,
        tickets: r.tickets ?? null,
        review_notes: null,
      });
    }
  } catch {}
  return map;
}

export function getExtraTradeColumnsByKey(key: string): ExtraTradeColumns | null {
  try {
    const r = (db as any).$client
      .prepare(
        `SELECT realized_r,
                planned_r,
                mae_r,
                mfe_r,
                capture_eff,
                risk_percent,
                exit_reason,
                partials_breakdown,
                tickets
         FROM trades
         WHERE key = ?`
      )
      .get(key) as any;
    if (!r) return null;
    return {
      realized_r: typeof r.realized_r === "number" ? r.realized_r : null,
      planned_r: typeof r.planned_r === "number" ? r.planned_r : null,
      mae_r: typeof r.mae_r === "number" ? r.mae_r : null,
      mfe_r: typeof r.mfe_r === "number" ? r.mfe_r : null,
      capture_eff: typeof r.capture_eff === "number" ? r.capture_eff : null,
      risk_percent: typeof r.risk_percent === "number" ? r.risk_percent : null,
      exit_reason: r.exit_reason ?? null,
      partials_breakdown: r.partials_breakdown ?? null,
      tickets: r.tickets ?? null,
      review_notes: null,
    };
  } catch {
    return null;
  }
}

const context = () => ({
  multipliers: getMultipliers(),
  defaults: getJournalDefaults(),
  extraMap: loadExtraTradeColumnsMap(),
});

export const rowToTrade = (
  row: TradeRow,
  config: {
    multipliers: Record<string, number>;
    defaults: ReturnType<typeof getJournalDefaults>;
    extraMap?: Map<string, ExtraTradeColumns>;
  } = context()
): AnnotatedTrade => {
  const cleanSym = row.symbol.replace(/\.raw$/i, "");
  const multiplier = config.multipliers[row.symbol] ?? config.multipliers[cleanSym];
  const defaults = config.defaults;
  const extra = config.extraMap?.get(row.key) ?? getExtraTradeColumnsByKey(row.key);

  const computedDurationMs =
    row.durationMs != null && row.durationMs > 0
      ? row.durationMs
      : row.closedAt && row.openedAt
      ? Math.max(0, Date.parse(row.closedAt) - Date.parse(row.openedAt))
      : undefined;

  // Infer effective contract multiplier from actual exit delta if not explicitly configured
  let effectiveMultiplier = multiplier;
  if (effectiveMultiplier == null && row.avgExit != null && row.quantity > 0 && Math.abs(row.grossPnl) > 0) {
    const delta = Math.abs(row.avgExit - row.avgEntry);
    if (delta > 0) {
      const imp = Math.abs(row.grossPnl) / (delta * row.quantity);
      if (Number.isFinite(imp) && imp > 0) effectiveMultiplier = imp;
    }
  }

  // Compute trade R-multiple (prefer live Stop Loss if user edited it, else MT5 imported realized_r)
  let computedR: number | null = extra?.realized_r ?? null;
  if (row.stopLoss != null && row.stopLoss > 0 && row.avgEntry > 0 && row.quantity > 0) {
    const stopDist = Math.abs(row.avgEntry - row.stopLoss);
    if (stopDist > 0 && effectiveMultiplier != null && effectiveMultiplier > 0) {
      const riskDollars = stopDist * row.quantity * effectiveMultiplier;
      if (riskDollars > 0) {
        computedR = Number((row.netPnl / riskDollars).toFixed(2));
      }
    }
  }

  const beMode = (defaults.breakevenMode as string) || "r_multiple";
  const beVal = typeof defaults.breakeven === "number" ? Math.abs(defaults.breakeven) : 0.1;

  let status: AnnotatedTrade["status"] = "breakeven";
  if (row.status === "open" || !row.closedAt) {
    status = "open";
  } else if (beMode === "r_multiple") {
    const rThreshold = beVal > 0 ? beVal : 0.1;
    if (computedR !== null && Number.isFinite(computedR)) {
      if (computedR >= -rThreshold && computedR <= rThreshold) {
        status = "breakeven";
      } else if (computedR > rThreshold) {
        status = "win";
      } else {
        status = "loss";
      }
    } else {
      // Fallback if trade has no SL / R-multiple recorded: ±$15 or 0
      if (Math.abs(row.netPnl) <= 1e-9) status = "breakeven";
      else status = row.netPnl > 0 ? "win" : "loss";
    }
  } else {
    const missingMultiplier =
      effectiveMultiplier == null &&
      ["futures", "option", "forex", "cfd"].includes(row.assetClass ?? "");
    const notional = missingMultiplier
      ? 0
      : Math.abs(row.avgEntry * row.quantity * (effectiveMultiplier ?? 1));
    const tolerance =
      beMode === "percent" ? (notional * beVal) / 100 : beVal;
    status =
      Math.abs(row.netPnl) <= Math.max(1e-9, tolerance)
        ? "breakeven"
        : row.netPnl > 0
        ? "win"
        : "loss";
  }

  return {
    key: row.key,
    accountId: row.accountId,
    symbol: row.symbol,
    assetClass: (row.assetClass ?? undefined) as AnnotatedTrade["assetClass"],
    direction: row.direction,
    status,
    contractMultiplier: effectiveMultiplier,
    openedAt: row.openedAt,
    closedAt: row.closedAt ?? undefined,
    quantity: row.quantity,
    openQuantity: row.openQuantity,
    avgEntry: row.avgEntry,
    avgExit: row.avgExit ?? undefined,
    grossPnl: row.grossPnl,
    fees: row.fees,
    netPnl: row.netPnl,
    executionCount: row.executionCount,
    executionIds: parseJsonArray(row.executionIdsJson),
    exits: JSON.parse(row.exitsJson) as AnnotatedTrade["exits"],
    durationMs: computedDurationMs,
    annotations: {
      tags: parseJsonArray(row.tagsJson),
      mistakes: parseJsonArray(row.mistakesJson),
      playbook: row.playbookId ?? undefined,
      rating: row.rating ?? undefined,
      stopLoss: row.stopLoss ?? undefined,
      profitTarget: row.profitTarget ?? undefined,
      reviewed: row.reviewedAt !== null,
    },
  };
};

export const queryTrades = (
  filters: TradeFilters = {}
): { rows: TradeRow[]; trades: AnnotatedTrade[] } => {
  const effective = { ...filters, accounts: filters.accounts ?? filters.accountIds?.join(",") };
  const accountIds = effective.accounts
    ?.split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const all = db
    .select()
    .from(trades)
    .where(
      and(
        accountIds?.length ? inArray(trades.accountId, accountIds) : undefined,
        effective.playbookId ? eq(trades.playbookId, effective.playbookId) : undefined,
        effective.direction
          ? eq(trades.direction, effective.direction as "long" | "short")
          : undefined,
        effective.assetClass ? eq(trades.assetClass, effective.assetClass) : undefined
      )
    )
    .orderBy(asc(trades.openedAt))
    .all();
  const timeZone = getTimeZone();
  const config = context();
  const pairs = all
    .map((row) => ({ row, trade: rowToTrade(row, config) }))
    .filter(({ trade }) => matchesFilters(trade, effective, timeZone));
  return {
    rows: pairs.map(({ row, trade }) => ({
      ...row,
      status: trade.status,
      durationMs: trade.durationMs ?? row.durationMs,
    })),
    trades: pairs.map((p) => p.trade),
  };
};

export const getTradeByKey = (key: string): TradeRow | undefined =>
  db.select().from(trades).where(eq(trades.key, key)).get();

export const getAdjacentTradeKeys = (
  currentKey: string,
  filters: TradeFilters = {},
  accountId?: string
) => {
  const ordered = queryTrades(filters)
    .trades.filter((trade) => !accountId || trade.accountId === accountId)
    .sort((a, b) => {
      const time = Date.parse(a.openedAt) - Date.parse(b.openedAt);
      return time || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
    });
  const index = ordered.findIndex((trade) => trade.key === currentKey);
  return {
    prevKey: index > 0 ? (ordered[index - 1]?.key ?? null) : null,
    nextKey: index >= 0 ? (ordered[index + 1]?.key ?? null) : null,
    position: index >= 0 ? index + 1 : null,
    total: ordered.length,
  };
};
