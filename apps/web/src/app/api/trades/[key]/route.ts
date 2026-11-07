import { tradeRisk, tradeR, plannedR } from "@luxalgo/journal-core";
import { eq } from "drizzle-orm";
import { db, trades, playbooks, accounts } from "@/db";
import { bad, handler, ok, requireValue } from "@/server/api";
import { deleteExecutionsForTrades, listExecutions } from "@/server/executions";
import { nowIso } from "@/server/ids";
import { getTradeByKey, rowToTrade } from "@/server/trades-query";
import { getTimeZone } from "@/server/settings";
import { patchNotionTradePage } from "@/lib/notion-sync";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Params = { params: Promise<{ key: string }> };

function ensureTradeReviewNotesColumn() {
  try {
    (db as any).$client.prepare("ALTER TABLE trades ADD COLUMN review_notes TEXT DEFAULT ''").run();
  } catch {}
}

export const GET = handler(async (_request: Request, { params }: Params) => {
  ensureTradeReviewNotesColumn();
  const { key } = await params;
  const row = getTradeByKey(key);
  if (!row) return bad("Trade not found", 404);
  const trade = rowToTrade(row);
  const rawFills = trade.executionIds.length > 0 ? listExecutions(row.accountId, trade.executionIds).filter((f: any) => !f.symbol || f.symbol === row.symbol) : [];
  const exitsMap = new Map<string, number>(
    (JSON.parse(row.exitsJson || "[]") as { executionId: string; grossPnl: number }[]).map((e) => [
      e.executionId,
      e.grossPnl,
    ])
  );
  const fills = rawFills.map((f: any) => {
    let meta: { reason?: string; grossPnl?: number } = {};
    try {
      if (f.importMetadataJson) meta = JSON.parse(f.importMetadataJson);
    } catch {}
    const pnl = meta.grossPnl ?? exitsMap.get(f.id);
    return {
      ...f,
      reason: meta.reason ?? (f.id.endsWith("_entry") ? "Entry" : undefined),
      pnl: typeof pnl === "number" && pnl !== 0 ? pnl : undefined,
    };
  });
  const extraRow =
    (db as any).$client
      .prepare(
        `SELECT review_notes, realized_r, planned_r, mae_r, mfe_r,
                capture_eff, risk_percent, exit_reason, partials_breakdown, tickets
         FROM trades WHERE key = ?`
      )
      .get(key) || {};

  const acctRow = db
    .select()
    .from(accounts)
    .where(eq(accounts.id, row.accountId))
    .get() as any;

  const accountInitialBalance =
    typeof acctRow?.initialBalance === "number"
      ? acctRow.initialBalance
      : typeof acctRow?.initial_balance === "number"
      ? acctRow.initial_balance
      : 100000;

  const computedDurationMs =
    trade.durationMs ??
    (row.closedAt && row.openedAt
      ? Math.max(0, Date.parse(row.closedAt) - Date.parse(row.openedAt))
      : null);

  const coreRiskAmount = tradeRisk(trade);
  const coreRealizedR = tradeR(trade);
  const corePlannedR = plannedR(trade);

  const finalRealizedR =
    coreRealizedR !== null && Number.isFinite(coreRealizedR)
      ? Number(coreRealizedR.toFixed(2))
      : typeof extraRow.realized_r === "number"
      ? extraRow.realized_r
      : null;

  const finalPlannedR =
    corePlannedR !== null && Number.isFinite(corePlannedR)
      ? Number(corePlannedR.toFixed(2))
      : typeof extraRow.planned_r === "number"
      ? extraRow.planned_r
      : null;

  const finalRiskAmount =
    coreRiskAmount !== null && Number.isFinite(coreRiskAmount)
      ? coreRiskAmount
      : finalRealizedR && Math.abs(finalRealizedR) > 0.001
      ? Math.abs(row.netPnl / finalRealizedR)
      : typeof extraRow.risk_percent === "number" && extraRow.risk_percent > 0
      ? (accountInitialBalance * extraRow.risk_percent) / 100
      : null;

  const finalRiskPercent =
    typeof extraRow.risk_percent === "number" && extraRow.risk_percent > 0
      ? extraRow.risk_percent
      : finalRiskAmount && accountInitialBalance > 0
      ? Number(((finalRiskAmount / accountInitialBalance) * 100).toFixed(2))
      : null;

  const finalMfeR = typeof extraRow.mfe_r === "number" ? extraRow.mfe_r : null;
  const finalMaeR = typeof extraRow.mae_r === "number" ? extraRow.mae_r : null;
  const finalCaptureEff =
    typeof extraRow.capture_eff === "number"
      ? extraRow.capture_eff
      : finalRealizedR !== null && finalMfeR !== null && finalMfeR > 0
      ? Number(((finalRealizedR / finalMfeR) * 100).toFixed(1))
      : null;

  return ok({
    timeZone: getTimeZone(),
    trade: {
      ...row,
      status: trade.status,
      durationMs: computedDurationMs,
      reviewNotes: extraRow.review_notes ?? "",
      partials_breakdown: extraRow.partials_breakdown ?? (row as any).partials_breakdown ?? "",
      exit_reason: extraRow.exit_reason ?? null,
      tickets: extraRow.tickets ?? null,
      riskAmount: finalRiskAmount,
      riskPercent: finalRiskPercent,
      accountInitialBalance,
      realizedR: finalRealizedR,
      plannedR: finalPlannedR,
      mfeR: finalMfeR,
      maeR: finalMaeR,
      captureEff: finalCaptureEff,
      contractMultiplier: trade.contractMultiplier ?? null,
      currency: acctRow?.currency ?? "USD",
    },
    executions: fills,
  });
});

interface AnnotateBody {
  notes?: string | null;
  reviewNotes?: string | null;
  tags?: string[];
  mistakes?: string[];
  playbookId?: string | null;
  rating?: number | null;
  stopLoss?: number | null;
  profitTarget?: number | null;
  reviewed?: boolean;
}

export const PATCH = handler(async (request: Request, { params }: Params) => {
  ensureTradeReviewNotesColumn();
  const { key } = await params;
  const decoded = key;
  const row = getTradeByKey(decoded);
  if (!row) return bad("Trade not found", 404);

  const body = (await request.json()) as AnnotateBody;
  for (const field of ["stopLoss", "profitTarget", "rating"] as const)
    requireValue(
      body[field] == null || (typeof body[field] === "number" && Number.isFinite(body[field])),
                 `Invalid ${field}.`,
    );
  requireValue(
    body.rating == null || (Number.isInteger(body.rating) && body.rating >= 1 && body.rating <= 5),
               "Rating must be 1–5.",
  );
  requireValue(
    body.notes == null || (typeof body.notes === "string" && body.notes.length <= 100000),
               "Notes must be at most 100,000 characters.",
  );
  for (const field of ["tags", "mistakes"] as const)
    requireValue(
      body[field] === undefined ||
      (Array.isArray(body[field]) &&
      body[field]!.length <= 100 &&
      body[field]!.every((s) => typeof s === "string" && s.length <= 200)),
                 `Invalid ${field}.`,
    );

  let selectedPlaybookTitle: string | null | undefined = undefined;
  if (body.playbookId !== undefined) {
    if (body.playbookId) {
      const pb = db.select().from(playbooks).where(eq(playbooks.id, body.playbookId)).get();
      requireValue(Boolean(pb), "Playbook not found.");
      selectedPlaybookTitle = pb?.name ?? body.playbookId;
    } else {
      selectedPlaybookTitle = null;
    }
  }

  const patch: Partial<typeof trades.$inferInsert> = {};
  if (body.notes !== undefined) patch.notes = body.notes;
  if (body.tags !== undefined) patch.tagsJson = JSON.stringify(body.tags);
  if (body.mistakes !== undefined) patch.mistakesJson = JSON.stringify(body.mistakes);
  if (body.playbookId !== undefined) patch.playbookId = body.playbookId;
  if (body.rating !== undefined) patch.rating = body.rating;
  if (body.stopLoss !== undefined) patch.stopLoss = body.stopLoss;
  if (body.profitTarget !== undefined) patch.profitTarget = body.profitTarget;
  if (body.reviewed !== undefined) patch.reviewedAt = body.reviewed ? nowIso() : null;

  if (body.reviewNotes !== undefined) {
    (db as any).$client
      .prepare("UPDATE trades SET review_notes = ? WHERE key = ?")
      .run(body.reviewNotes ?? "", decoded);
  }
  if (!Object.keys(patch).length && body.reviewNotes === undefined) return ok({ updated: true });

  // 1. Update SQLite
  if (Object.keys(patch).length > 0) {
    db.update(trades).set(patch).where(eq(trades.key, decoded)).run();
  }

  // 2. Sync to Notion if this trade is linked to a Notion page
  const notionPageId = (row as any).notionPageId ?? (row as any).notion_page_id;
  if (notionPageId) {
    void patchNotionTradePage(notionPageId, {
      rating: body.rating,
      reviewed: body.reviewed,
      tags: body.tags,
      mistakes: body.mistakes,
      playbook: selectedPlaybookTitle,
      stopLoss: body.stopLoss,
      profitTarget: body.profitTarget,
    });
  }

  return ok({ updated: true });
});

export const DELETE = handler(async (_request: Request, { params }: Params) => {
  const { key } = await params;
  const row = getTradeByKey(key);
  if (!row) return bad("Trade not found", 404);
  deleteExecutionsForTrades(row.accountId, JSON.parse(row.executionIdsJson) as string[]);
  return ok({ deleted: true });
});
