import { NextRequest, NextResponse } from "next/server";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import {
  getNotionConfig,
  editorHtmlToNotionTree,
  clearNotionPageBlocks,
  appendBlocksTreeRecursive,
  fetchNotionBlocksRecursive,
  notionBlocksToHtml,
  findNotionPageInDb,
} from "@/server/notion-sync";

export const dynamic = "force-dynamic";

function resolveDbPath(): string {
  const dbPath = path.resolve(process.cwd(), "data", "journal.db");
  const altDbPath = path.resolve(process.cwd(), "apps", "web", "data", "journal.db");
  return fs.existsSync(dbPath) ? dbPath : altDbPath;
}

function ensureMissedTradesSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS missed_trades (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      direction TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      exit_at TEXT,
      outcome TEXT DEFAULT 'WIN',
      playbook_id TEXT,
      entry REAL,
      stop REAL,
      target REAL,
      partials_json TEXT DEFAULT '[]',
      account_size REAL DEFAULT 100000,
      risk_percent REAL DEFAULT 1.0,
      risk_amount REAL DEFAULT 1000,
      contract_multiplier REAL DEFAULT 1,
      quantity REAL DEFAULT 1,
      planned_r REAL,
      realized_r REAL,
      theoretical_pnl REAL DEFAULT 0,
      mae_r REAL,
      mfe_r REAL,
      miss_reason TEXT DEFAULT 'Hesitation / Fear',
      session TEXT DEFAULT 'NY AM',
      tags_json TEXT DEFAULT '[]',
      mistakes_json TEXT DEFAULT '[]',
      notes TEXT NOT NULL DEFAULT '',
      review_notes TEXT DEFAULT '',
      rating INTEGER,
      notion_page_id TEXT,
      notion_url TEXT,
      created_at TEXT NOT NULL,
      archived_at TEXT
    );
  `);

  const extraCols = [
    "ALTER TABLE missed_trades ADD COLUMN exit_at TEXT",
    "ALTER TABLE missed_trades ADD COLUMN outcome TEXT DEFAULT 'WIN'",
    "ALTER TABLE missed_trades ADD COLUMN partials_json TEXT DEFAULT '[]'",
    "ALTER TABLE missed_trades ADD COLUMN account_size REAL DEFAULT 100000",
    "ALTER TABLE missed_trades ADD COLUMN risk_percent REAL DEFAULT 1.0",
    "ALTER TABLE missed_trades ADD COLUMN risk_amount REAL DEFAULT 1000",
    "ALTER TABLE missed_trades ADD COLUMN contract_multiplier REAL DEFAULT 1",
    "ALTER TABLE missed_trades ADD COLUMN quantity REAL DEFAULT 1",
    "ALTER TABLE missed_trades ADD COLUMN planned_r REAL",
    "ALTER TABLE missed_trades ADD COLUMN realized_r REAL",
    "ALTER TABLE missed_trades ADD COLUMN theoretical_pnl REAL DEFAULT 0",
    "ALTER TABLE missed_trades ADD COLUMN mae_r REAL",
    "ALTER TABLE missed_trades ADD COLUMN mfe_r REAL",
    "ALTER TABLE missed_trades ADD COLUMN miss_reason TEXT DEFAULT 'Hesitation / Fear'",
    "ALTER TABLE missed_trades ADD COLUMN session TEXT DEFAULT 'NY AM'",
    "ALTER TABLE missed_trades ADD COLUMN tags_json TEXT DEFAULT '[]'",
    "ALTER TABLE missed_trades ADD COLUMN mistakes_json TEXT DEFAULT '[]'",
    "ALTER TABLE missed_trades ADD COLUMN review_notes TEXT DEFAULT ''",
    "ALTER TABLE missed_trades ADD COLUMN rating INTEGER",
    "ALTER TABLE missed_trades ADD COLUMN notion_page_id TEXT",
    "ALTER TABLE missed_trades ADD COLUMN notion_url TEXT",
  ];
  for (const sql of extraCols) {
    try {
      db.exec(sql);
    } catch {}
  }
}

function classifyNySession(isoStr: string): string {
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

function mapMissedRow(r: any) {
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
    session: r.session || classifyNySession(r.observed_at),
    tagsJson: r.tags_json || "[]",
    mistakesJson: r.mistakes_json || "[]",
    notes: r.notes || "",
    reviewNotes: r.review_notes || "",
    rating: r.rating ?? null,
    notionPageId: r.notion_page_id || null,
    notionUrl: r.notion_url || null,
    createdAt: r.created_at,
    archivedAt: r.archived_at || null,
  };
}

export async function GET() {
  try {
    const dbPath = resolveDbPath();
    if (!fs.existsSync(dbPath)) {
      return NextResponse.json({ trades: [] });
    }
    const db = new Database(dbPath);
    try {
      ensureMissedTradesSchema(db);
      const rows = db
        .prepare(`SELECT * FROM missed_trades ORDER BY observed_at DESC`)
        .all() as any[];
      return NextResponse.json({
        trades: rows.map(mapMissedRow),
      });
    } finally {
      db.close();
    }
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to load missed trades" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const dbPath = resolveDbPath();
    const db = new Database(dbPath);
    ensureMissedTradesSchema(db);

    try {
      const id = body.id || `missed_${crypto.randomUUID().slice(0, 10)}`;
      const nowIso = new Date().toISOString();
      const observedAt = body.observedAt || nowIso;
      const session = body.session || classifyNySession(observedAt);

      // Handle Notion Pull if requested
      if (body.action === "pull_notion") {
        const existing = db
          .prepare(`SELECT * FROM missed_trades WHERE id = ?`)
          .get(id) as any;
        const token = process.env.NOTION_TOKEN || "";
        const dbId = (
          process.env.NOTION_MISSED_DATABASE_ID ||
          process.env.NOTION_TRADES_DATABASE_ID ||
          process.env.NOTION_DATABASE_ID ||
          ""
        ).replace(/-/g, "");

        if (!token || !dbId) {
          return NextResponse.json(
            { error: "Missing NOTION_TOKEN or NOTION_TRADES_DATABASE_ID in .env.local" },
            { status: 400 }
          );
        }

        let pageId = existing?.notion_page_id || body.notionPageId;
        let pageUrl = existing?.notion_url || body.notionUrl;
        const slugTitle = `[MISSED] ${existing?.symbol || body.symbol} ${(
          existing?.direction || "LONG"
        ).toUpperCase()}`;

        if (!pageId) {
          const found = await findNotionPageInDb(dbId, token, id, slugTitle);
          if (found.page) {
            pageId = found.page.id;
            pageUrl = found.page.url;
          }
        }

        if (!pageId) {
          return NextResponse.json(
            { error: "No linked Notion page found for this missed trade yet. Sync to Notion first." },
            { status: 404 }
          );
        }

        const blocks = await fetchNotionBlocksRecursive(pageId, token);
        const pulledHtml = await notionBlocksToHtml(blocks, id);
        const activeTab = body.activeTab === "review" ? "review" : "setup";

        if (activeTab === "review") {
          db.prepare(
            `UPDATE missed_trades SET review_notes = ?, notion_page_id = ?, notion_url = ? WHERE id = ?`
          ).run(pulledHtml, pageId, pageUrl, id);
        } else {
          db.prepare(
            `UPDATE missed_trades SET notes = ?, notion_page_id = ?, notion_url = ? WHERE id = ?`
          ).run(pulledHtml, pageId, pageUrl, id);
        }

        const updated = db.prepare(`SELECT * FROM missed_trades WHERE id = ?`).get(id);
        return NextResponse.json({ trade: mapMissedRow(updated), notionPulled: true });
      }

      // Upsert missed trade locally
      const existing = db.prepare(`SELECT * FROM missed_trades WHERE id = ?`).get(id) as any;

      const rowData = {
        id,
        symbol: String(body.symbol ?? existing?.symbol ?? "US500").trim(),
        direction: String(body.direction ?? existing?.direction ?? "long").toLowerCase(),
        observed_at: observedAt,
        exit_at: body.exitAt !== undefined ? body.exitAt : existing?.exit_at ?? null,
        outcome: body.outcome ?? existing?.outcome ?? "WIN",
        playbook_id:
          body.playbookId !== undefined ? body.playbookId || null : existing?.playbook_id ?? null,
        entry: body.entry !== undefined ? body.entry : existing?.entry ?? null,
        stop: body.stop !== undefined ? body.stop : existing?.stop ?? null,
        target: body.target !== undefined ? body.target : existing?.target ?? null,
        partials_json:
          body.partialsJson !== undefined
            ? typeof body.partialsJson === "string"
              ? body.partialsJson
              : JSON.stringify(body.partialsJson)
            : existing?.partials_json ?? "[]",
        account_size:
          body.accountSize !== undefined ? Number(body.accountSize) : existing?.account_size ?? 100000,
        risk_percent:
          body.riskPercent !== undefined ? Number(body.riskPercent) : existing?.risk_percent ?? 1.0,
        risk_amount:
          body.riskAmount !== undefined ? Number(body.riskAmount) : existing?.risk_amount ?? 1000,
        contract_multiplier:
          body.contractMultiplier !== undefined
            ? Number(body.contractMultiplier)
            : existing?.contract_multiplier ?? 1,
        quantity: body.quantity !== undefined ? Number(body.quantity) : existing?.quantity ?? 1,
        planned_r: body.plannedR !== undefined ? body.plannedR : existing?.planned_r ?? null,
        realized_r: body.realizedR !== undefined ? body.realizedR : existing?.realized_r ?? null,
        theoretical_pnl:
          body.theoreticalPnl !== undefined
            ? Number(body.theoreticalPnl)
            : existing?.theoretical_pnl ?? 0,
        mae_r: body.maeR !== undefined ? body.maeR : existing?.mae_r ?? null,
        mfe_r: body.mfeR !== undefined ? body.mfeR : existing?.mfe_r ?? null,
        miss_reason: body.missReason ?? existing?.miss_reason ?? "Hesitation / Fear",
        session,
        tags_json:
          body.tagsJson !== undefined
            ? typeof body.tagsJson === "string"
              ? body.tagsJson
              : JSON.stringify(body.tagsJson)
            : existing?.tags_json ?? "[]",
        mistakes_json:
          body.mistakesJson !== undefined
            ? typeof body.mistakesJson === "string"
              ? body.mistakesJson
              : JSON.stringify(body.mistakesJson)
            : existing?.mistakes_json ?? "[]",
        notes: body.notes !== undefined ? body.notes : existing?.notes ?? "",
        review_notes:
          body.reviewNotes !== undefined ? body.reviewNotes : existing?.review_notes ?? "",
        rating: body.rating !== undefined ? body.rating : existing?.rating ?? null,
        notion_page_id: existing?.notion_page_id ?? null,
        notion_url: existing?.notion_url ?? null,
        created_at: existing?.created_at ?? nowIso,
        archived_at: existing?.archived_at ?? null,
      };

      db.prepare(
        `INSERT INTO missed_trades (
          id, symbol, direction, observed_at, exit_at, outcome, playbook_id,
          entry, stop, target, partials_json,
          account_size, risk_percent, risk_amount, contract_multiplier, quantity,
          planned_r, realized_r, theoretical_pnl, mae_r, mfe_r,
          miss_reason, session, tags_json, mistakes_json,
          notes, review_notes, rating, notion_page_id, notion_url, created_at, archived_at
        ) VALUES (
          @id, @symbol, @direction, @observed_at, @exit_at, @outcome, @playbook_id,
          @entry, @stop, @target, @partials_json,
          @account_size, @risk_percent, @risk_amount, @contract_multiplier, @quantity,
          @planned_r, @realized_r, @theoretical_pnl, @mae_r, @mfe_r,
          @miss_reason, @session, @tags_json, @mistakes_json,
          @notes, @review_notes, @rating, @notion_page_id, @notion_url, @created_at, @archived_at
        )
        ON CONFLICT(id) DO UPDATE SET
          symbol = excluded.symbol,
          direction = excluded.direction,
          observed_at = excluded.observed_at,
          exit_at = excluded.exit_at,
          outcome = excluded.outcome,
          playbook_id = excluded.playbook_id,
          entry = excluded.entry,
          stop = excluded.stop,
          target = excluded.target,
          partials_json = excluded.partials_json,
          account_size = excluded.account_size,
          risk_percent = excluded.risk_percent,
          risk_amount = excluded.risk_amount,
          contract_multiplier = excluded.contract_multiplier,
          quantity = excluded.quantity,
          planned_r = excluded.planned_r,
          realized_r = excluded.realized_r,
          theoretical_pnl = excluded.theoretical_pnl,
          mae_r = excluded.mae_r,
          mfe_r = excluded.mfe_r,
          miss_reason = excluded.miss_reason,
          session = excluded.session,
          tags_json = excluded.tags_json,
          mistakes_json = excluded.mistakes_json,
          notes = excluded.notes,
          review_notes = excluded.review_notes,
          rating = excluded.rating`
      ).run(rowData);

      // Handle Notion Push if requested
      if (body.syncNotion) {
        const token = process.env.NOTION_TOKEN || "";
        const dbId = (
          process.env.NOTION_MISSED_DATABASE_ID ||
          process.env.NOTION_TRADES_DATABASE_ID ||
          process.env.NOTION_DATABASE_ID ||
          ""
        ).replace(/-/g, "");

        if (!token || !dbId) {
          return NextResponse.json({
            trade: mapMissedRow(rowData),
            notionSynced: false,
            notionError: "Missing NOTION_TOKEN or NOTION_TRADES_DATABASE_ID",
          });
        }

        const pageTitle = `⚠️ [MISSED TRADE] ${rowData.symbol} ${rowData.direction.toUpperCase()} (${rowData.miss_reason})`;
        const found = await findNotionPageInDb(dbId, token, id, pageTitle);
        const availableProps = found.availableProps || {};
        const titleProp = found.titleProp || "Name";

        const properties: Record<string, any> = {
          [titleProp]: { title: [{ text: { content: pageTitle } }] },
        };
        if ("Symbol" in availableProps && availableProps["Symbol"].type === "select") {
          properties["Symbol"] = { select: { name: rowData.symbol } };
        }
        if ("Direction" in availableProps && availableProps["Direction"].type === "select") {
          properties["Direction"] = { select: { name: rowData.direction.toUpperCase() } };
        }
        if ("Outcome" in availableProps && availableProps["Outcome"].type === "select") {
          properties["Outcome"] = { select: { name: `MISSED (${rowData.outcome})` } };
        }
        for (const typeCol of ["Type", "Category", "Kind", "Status"]) {
          if (typeCol in availableProps && availableProps[typeCol].type === "select") {
            properties[typeCol] = { select: { name: "Missed Trade" } };
          }
        }
        if ("Session" in availableProps && availableProps["Session"].type === "select") {
          properties["Session"] = { select: { name: rowData.session } };
        }
        if ("Entry Price" in availableProps && availableProps["Entry Price"].type === "number" && rowData.entry != null) {
          properties["Entry Price"] = { number: Number(rowData.entry) };
        }
        if ("Exit Price" in availableProps && availableProps["Exit Price"].type === "number" && rowData.target != null) {
          properties["Exit Price"] = { number: Number(rowData.target) };
        }
        if ("Volume" in availableProps && availableProps["Volume"].type === "number") {
          properties["Volume"] = { number: Number(rowData.quantity) };
        }
        if ("Planned R" in availableProps && availableProps["Planned R"].type === "number" && rowData.planned_r != null) {
          properties["Planned R"] = { number: Number(rowData.planned_r) };
        }
        if ("Realized R" in availableProps && availableProps["Realized R"].type === "number" && rowData.realized_r != null) {
          properties["Realized R"] = { number: Number(rowData.realized_r) };
        }
        if ("MFE (R)" in availableProps && availableProps["MFE (R)"].type === "number" && rowData.mfe_r != null) {
          properties["MFE (R)"] = { number: Number(rowData.mfe_r) };
        }
        if ("MAE (R)" in availableProps && availableProps["MAE (R)"].type === "number" && rowData.mae_r != null) {
          properties["MAE (R)"] = { number: Number(rowData.mae_r) };
        }
        if ("Open Date" in availableProps && availableProps["Open Date"].type === "date") {
          properties["Open Date"] = { date: { start: rowData.observed_at } };
        }
        if ("Date" in availableProps && availableProps["Date"].type === "date") {
          properties["Date"] = { date: { start: rowData.observed_at } };
        }
        if ("LuxAlgo ID" in availableProps && availableProps["LuxAlgo ID"].type === "rich_text") {
          properties["LuxAlgo ID"] = { rich_text: [{ text: { content: id } }] };
        }

        // Prepend an unmistakable Missed Trade Banner Callout in Notion page content
        const bannerHtml = `<div class="tz-callout tz-color-orange_background" data-notion-type="callout" data-notion-color="orange_background" data-icon="⚠️"><span class="tz-callout-icon">⚠️</span><div class="tz-callout-content"><p><strong>MISSED TRADE (THEORETICAL OPPORTUNITY — NOT EXECUTED)</strong> • Reason Missed: <strong>${rowData.miss_reason}</strong> • Theoretical P&amp;L: <strong>$${Number(rowData.theoretical_pnl).toFixed(2)} (${rowData.realized_r ?? 0}R)</strong> • Size: <strong>${rowData.quantity}L</strong> ($${rowData.account_size} @ ${rowData.risk_percent}% risk)</p></div></div>`;
        const combinedHtml = [
          bannerHtml,
          rowData.notes ? `<h2>Setup &amp; Context Notes</h2>${rowData.notes}` : "",
          rowData.review_notes ? `<hr/><h2>Post-Mortem &amp; Missed Trade Review</h2>${rowData.review_notes}` : "",
        ]
          .filter(Boolean)
          .join("");

        const blockTree = await editorHtmlToNotionTree(combinedHtml, token);
        let targetPageId = rowData.notion_page_id || found.page?.id;
        let targetPageUrl = found.page?.url || rowData.notion_url;

        if (targetPageId) {
          const patchRes = await fetch(`https://api.notion.com/v1/pages/${targetPageId}`, {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${token}`,
              "Notion-Version": "2022-06-28",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ properties }),
          });
          if (patchRes.ok) {
            const pData = await patchRes.json();
            targetPageUrl = pData.url || targetPageUrl;
            await clearNotionPageBlocks(targetPageId, token);
            await appendBlocksTreeRecursive(targetPageId, blockTree, token);
          } else {
            targetPageId = null;
          }
        }

        if (!targetPageId) {
          const createRes = await fetch("https://api.notion.com/v1/pages", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Notion-Version": "2022-06-28",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              parent: { database_id: dbId },
              properties,
            }),
          });
          if (createRes.ok) {
            const cData = await createRes.json();
            targetPageId = cData.id;
            targetPageUrl = cData.url;
            if (targetPageId && blockTree.length > 0) {
              await appendBlocksTreeRecursive(targetPageId, blockTree, token);
            }
          }
        }

        if (targetPageId) {
          db.prepare(
            `UPDATE missed_trades SET notion_page_id = ?, notion_url = ? WHERE id = ?`
          ).run(targetPageId, targetPageUrl, id);
          rowData.notion_page_id = targetPageId;
          rowData.notion_url = targetPageUrl;
        }

        return NextResponse.json({
          trade: mapMissedRow(rowData),
          notionSynced: Boolean(targetPageId),
        });
      }

      return NextResponse.json({ trade: mapMissedRow(rowData) });
    } finally {
      db.close();
    }
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to save missed trade" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json();
    const id = String(body.id || "");
    const permanent = Boolean(body.permanent);
    const restore = Boolean(body.restore);

    const dbPath = resolveDbPath();
    const db = new Database(dbPath);
    ensureMissedTradesSchema(db);
    try {
      if (permanent) {
        db.prepare(`DELETE FROM missed_trades WHERE id = ?`).run(id);
      } else {
        const archivedAt = restore ? null : new Date().toISOString();
        db.prepare(`UPDATE missed_trades SET archived_at = ? WHERE id = ?`).run(archivedAt, id);
      }
      return NextResponse.json({ ok: true });
    } finally {
      db.close();
    }
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to update missed trade" },
      { status: 500 }
    );
  }
}
