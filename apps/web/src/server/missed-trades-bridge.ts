import { sql } from "drizzle-orm";
import { matchesFilters, type AnalysisFilters, type AnnotatedTrade } from "@luxalgo/journal-core";
import { db } from "@/db";
import { getTimeZone } from "./settings";

export interface RawMissedTradeRow {
  id: string;
  symbol: string;
  direction: string;
  observed_at: string;
  exit_at: string | null;
  outcome: string | null;
  playbook_id: string | null;
  entry: number | null;
  stop: number | null;
  target: number | null;
  partials_json: string | null;
  account_size: number | null;
  risk_percent: number | null;
  risk_amount: number | null;
  contract_multiplier: number | null;
  quantity: number | null;
  planned_r: number | null;
  realized_r: number | null;
  theoretical_pnl: number | null;
  mae_r: number | null;
  mfe_r: number | null;
  miss_reason: string | null;
  session: string | null;
  tags_json: string | null;
  mistakes_json: string | null;
  rules_followed_json?: string | null;
  notes: string | null;
  review_notes?: string | null;
  rating?: number | null;
  notion_page_id?: string | null;
  notion_url?: string | null;
  created_at: string;
  archived_at: string | null;
}

function parseJsonStringArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.map((x) => String(x).trim()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

export function formatMissedTradeRow(r: RawMissedTradeRow) {
  const outcomeUpper = String(r.outcome || "WIN").toUpperCase();
  const status =
    outcomeUpper === "WIN"
      ? "WIN"
      : outcomeUpper === "LOSS"
      ? "LOSS"
      : "BE";
  const tags = parseJsonStringArray(r.tags_json);
  const mistakes = parseJsonStringArray(r.mistakes_json);
  const rulesFollowed = parseJsonStringArray(r.rules_followed_json);

  return {
    id: r.id,
    key: r.id,
    isMissed: true,
    symbol: r.symbol,
    direction: (String(r.direction || "long").toLowerCase() === "short" ? "short" : "long") as "long" | "short",
    observedAt: r.observed_at,
    openedAt: r.observed_at,
    exitAt: r.exit_at || r.observed_at,
    closedAt: r.exit_at || r.observed_at,
    outcome: status,
    status,
    playbookId: r.playbook_id || null,
    entry: r.entry ?? null,
    avgEntry: r.entry ?? 0,
    stop: r.stop ?? null,
    target: r.target ?? null,
    avgExit: r.target ?? r.entry ?? 0,
    quantity: r.quantity ?? 1,
    plannedR: typeof r.planned_r === "number" ? r.planned_r : null,
    realizedR:
      typeof r.realized_r === "number"
        ? r.realized_r
        : status === "LOSS"
        ? -1
        : typeof r.planned_r === "number"
        ? r.planned_r
        : null,
    mfeR: typeof r.mfe_r === "number" ? r.mfe_r : null,
    maeR: typeof r.mae_r === "number" ? r.mae_r : null,
    theoreticalPnl: Number(r.theoretical_pnl ?? 0),
    netPnl: Number(r.theoretical_pnl ?? 0),
    riskPercent: typeof r.risk_percent === "number" ? r.risk_percent : 1.0,
    riskAmount: typeof r.risk_amount === "number" ? r.risk_amount : 1000,
    missReason: r.miss_reason || "Hesitation / Fear",
    session: r.session || "NY AM",
    tags,
    mistakes,
    rulesFollowed,
  };
}

export function loadUnarchivedMissedRows(): RawMissedTradeRow[] {
  try {
    return db.all<RawMissedTradeRow>(
      sql`SELECT * FROM missed_trades WHERE archived_at IS NULL ORDER BY observed_at DESC`
    );
  } catch {
    return [];
  }
}

export function missedRowToAnnotatedTrade(r: RawMissedTradeRow): AnnotatedTrade {
  const formatted = formatMissedTradeRow(r);
  const openMs = Date.parse(formatted.openedAt);
  const closeMs = Date.parse(formatted.closedAt);
  const durationMs =
    Number.isFinite(openMs) && Number.isFinite(closeMs) && closeMs >= openMs
      ? closeMs - openMs
      : 0;

  const coreStatus: AnnotatedTrade["status"] =
    formatted.outcome === "WIN"
      ? "win"
      : formatted.outcome === "LOSS"
      ? "loss"
      : "breakeven";

  const captureEff =
    formatted.realizedR !== null &&
    formatted.mfeR !== null &&
    formatted.mfeR > 0
      ? Number(
          Math.min(100, Math.max(0, (formatted.realizedR / formatted.mfeR) * 100)).toFixed(1)
        )
      : null;

  return {
    key: r.id,
    id: r.id,
    isMissed: true,
    missReason: formatted.missReason,
    session: formatted.session,
    accountId: "missed-trades",
    symbol: r.symbol,
    assetClass: "futures",
    direction: formatted.direction,
    status: coreStatus,
    contractMultiplier: r.contract_multiplier ?? 1,
    openedAt: formatted.openedAt,
    closedAt: formatted.closedAt,
    quantity: formatted.quantity,
    openQuantity: 0,
    avgEntry: formatted.avgEntry,
    avgExit: formatted.avgExit,
    grossPnl: formatted.netPnl,
    fees: 0,
    netPnl: formatted.netPnl,
    executionCount: 2,
    executionIds: [],
    exits: [],
    durationMs,
    playbookId: formatted.playbookId,
    playbook: formatted.playbookId ?? undefined,
    tags: formatted.tags,
    mistakes: formatted.mistakes,
    tagsJson: r.tags_json ?? "[]",
    mistakesJson: r.mistakes_json ?? "[]",
    stopLoss: r.stop ?? null,
    profitTarget: r.target ?? null,
    rating: r.rating ?? null,
    reviewed: true,
    reviewedAt: r.created_at,
    realizedR: formatted.realizedR,
    plannedR: formatted.plannedR,
    maeR: formatted.maeR,
    mfeR: formatted.mfeR,
    captureEff,
    riskPercent: formatted.riskPercent,
    rulesFollowed: formatted.rulesFollowed,
    annotations: {
      tags: formatted.tags,
      mistakes: formatted.mistakes,
      playbook: formatted.playbookId ?? undefined,
      rating: r.rating ?? undefined,
      stopLoss: typeof r.stop === "number" ? r.stop : undefined,
      profitTarget: typeof r.target === "number" ? r.target : undefined,
      reviewed: true,
    },
  } as unknown as AnnotatedTrade;
}

export function queryMissedTradesAsAnnotated(filters: AnalysisFilters = {}): {
  trades: AnnotatedTrade[];
  ruleChecks: Array<{ tradeKey: string; playbookId: string; rule: string; followed: boolean }>;
} {
  const rawRows = loadUnarchivedMissedRows();
  const timeZone = getTimeZone();
  // Strip account filter when matching missed trades since missed trades are account-agnostic
  const filtersWithoutAccount: AnalysisFilters = { ...filters, accounts: undefined };

  const trades: AnnotatedTrade[] = [];
  const ruleChecks: Array<{ tradeKey: string; playbookId: string; rule: string; followed: boolean }> = [];

  for (const r of rawRows) {
    const t = missedRowToAnnotatedTrade(r);
    if (!matchesFilters(t, filtersWithoutAccount, timeZone)) continue;
    trades.push(t);

    if (r.playbook_id) {
      const rules = parseJsonStringArray(r.rules_followed_json);
      for (const ruleText of rules) {
        ruleChecks.push({
          tradeKey: r.id,
          playbookId: r.playbook_id,
          rule: ruleText,
          followed: true,
        });
      }
    }
  }

  return { trades, ruleChecks };
}
