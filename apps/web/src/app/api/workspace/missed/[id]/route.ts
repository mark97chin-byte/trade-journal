import { NextRequest, NextResponse } from "next/server";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

export const dynamic = "force-dynamic";

function resolveDbPath(): string {
  const dbPath = path.resolve(process.cwd(), "data", "journal.db");
  const altDbPath = path.resolve(process.cwd(), "apps", "web", "data", "journal.db");
  return fs.existsSync(dbPath) ? dbPath : altDbPath;
}

function classifyNySessionLocal(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return "NY AM";
    const hourStr = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      hour12: false,
    }).format(d);
    const h = parseInt(hourStr, 10) % 24;
    if (h >= 2 && h < 8) return "London";
    if (h >= 8 && h < 12) return "NY AM";
    if (h >= 12 && h < 18) return "NY PM";
    return "Asia";
  } catch {
    return "NY AM";
  }
}

function mapRow(r: any) {
  return {
    id: r.id,
    symbol: r.symbol,
    direction: r.direction || "long",
    observedAt: r.observed_at,
    exitAt: r.exit_at || null,
    outcome: r.outcome || "WIN",
    playbookId: r.playbook_id || null,
    entry: r.entry ?? null,
    stop: r.stop ?? null,
    target: r.target ?? null,
    partialsJson: r.partials_json || "[]",
    accountSize: r.account_size ?? 100000,
    riskPercent: r.risk_percent ?? 1.0,
    riskAmount: r.risk_amount ?? 1000,
    contractMultiplier: r.contract_multiplier ?? 1,
    quantity: r.quantity ?? 1,
    plannedR: r.planned_r ?? null,
    realizedR: r.realized_r ?? null,
    theoreticalPnl: r.theoretical_pnl ?? 0,
    maeR: r.mae_r ?? null,
    mfeR: r.mfe_r ?? null,
    missReason: r.miss_reason || "Hesitation / Fear",
    session: r.session || classifyNySessionLocal(r.observed_at),
    tagsJson: r.tags_json || "[]",
    mistakesJson: r.mistakes_json || "[]",
    rulesFollowedJson: r.rules_followed_json || "[]",
    notes: r.notes || "",
    reviewNotes: r.review_notes || "",
    rating: r.rating ?? null,
    notionPageId: r.notion_page_id || null,
    notionUrl: r.notion_url || null,
    createdAt: r.created_at,
    archivedAt: r.archived_at || null,
  };
}

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const decodedId = decodeURIComponent(id);
    const dbPath = resolveDbPath();
    if (!fs.existsSync(dbPath)) {
      return NextResponse.json({ error: "Database not found" }, { status: 404 });
    }

    const db = new Database(dbPath, { readonly: true });
    try {
      const allRows = db
        .prepare(
          `SELECT * FROM missed_trades WHERE archived_at IS NULL ORDER BY observed_at DESC`
        )
        .all() as any[];

      const idx = allRows.findIndex((r) => r.id === decodedId);
      if (idx === -1) {
        const direct = db
          .prepare(`SELECT * FROM missed_trades WHERE id = ?`)
          .get(decodedId) as any;
        if (!direct) {
          return NextResponse.json({ error: "Missed trade not found" }, { status: 404 });
        }
        return NextResponse.json({
          trade: mapRow(direct),
          prevId: null,
          nextId: null,
          totalCount: allRows.length,
          currentIndex: 0,
        });
      }

      const current = allRows[idx]!;
      const prevId = idx < allRows.length - 1 ? allRows[idx + 1]!.id : null;
      const nextId = idx > 0 ? allRows[idx - 1]!.id : null;

      return NextResponse.json({
        trade: mapRow(current),
        prevId,
        nextId,
        totalCount: allRows.length,
        currentIndex: idx + 1,
      });
    } finally {
      db.close();
    }
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to load missed trade" },
      { status: 500 }
    );
  }
}
