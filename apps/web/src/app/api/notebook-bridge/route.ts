import { NextRequest, NextResponse } from "next/server";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import crypto from "crypto";

export const dynamic = "force-dynamic";

function resolveDbPath(): string {
  const p1 = path.resolve(process.cwd(), "data", "journal.db");
  const p2 = path.resolve(process.cwd(), "apps", "web", "data", "journal.db");
  return fs.existsSync(p1) ? p1 : p2;
}

function getDb() {
  const db = new Database(resolveDbPath());
  // Ensure notes table has archive & trade link columns
  const cols = (db.prepare("PRAGMA table_info(notes)").all() as Array<{ name: string }>).map(
    (c) => c.name
  );
  if (!cols.includes("archived_at")) {
    try {
      db.prepare("ALTER TABLE notes ADD COLUMN archived_at TEXT DEFAULT NULL").run();
    } catch {}
  }
  if (!cols.includes("linked_trade_key")) {
    try {
      db.prepare("ALTER TABLE notes ADD COLUMN linked_trade_key TEXT DEFAULT NULL").run();
    } catch {}
  }
  // Ensure 'archived' folder exists in folders table
  try {
    db.prepare(
      "INSERT OR IGNORE INTO folders (id, name, kind, created_at) VALUES ('archived', 'Archived (14d auto-delete)', 'system', datetime('now'))"
    ).run();
  } catch {
    try {
      db.prepare(
        "INSERT OR IGNORE INTO folders (id, name, kind) VALUES ('archived', 'Archived (14d auto-delete)', 'system')"
      ).run();
    } catch {}
  }

  // Ensure trades table has review_notes
  try {
    db.prepare("ALTER TABLE trades ADD COLUMN review_notes TEXT DEFAULT ''").run();
  } catch {}

  // Auto-delete archived notes older than 14 days (2 weeks)
  try {
    db.prepare(
      `DELETE FROM notes
       WHERE (archived_at IS NOT NULL AND datetime(archived_at) <= datetime('now', '-14 days'))
          OR (folder_id = 'archived' AND datetime(updated_at) <= datetime('now', '-14 days'))`
    ).run();
  } catch {}

  return db;
}

function splitScratchpadContent(html: string): { setupHtml: string; reviewHtml: string } {
  if (!html) return { setupHtml: "", reviewHtml: "" };
  // Check for explicit Scratchpad Review Divider or <hr>
  const dividerRegex = /<hr[^>]*>\s*(?:<h[1-6][^>]*>.*?(?:Post-Trade Review|After Trade|Trade Review).*?<\/h[1-6]>|<p><strong>.*?(?:Post-Trade Review|After Trade|Trade Review).*?<\/strong><\/p>)?/i;
  const match = html.match(dividerRegex);
  if (match && match.index !== undefined) {
    const setupHtml = html.slice(0, match.index).trim();
    const reviewHtml = html.slice(match.index + match[0].length).trim();
    return { setupHtml, reviewHtml };
  }
  return { setupHtml: html, reviewHtml: "" };
}

export async function GET(req: NextRequest) {
  const db = getDb();
  try {
    const url = new URL(req.url);
    const tradeKey = url.searchParams.get("tradeKey") || "";
    const dateParam = url.searchParams.get("date") || "";
    const includeArchived = url.searchParams.get("includeArchived") === "true";

    // Fetch all unarchived notes (or archived if requested)
    const notes = db
      .prepare(
        `SELECT id, folder_id as folderId, title, content, updated_at as updatedAt,
                archived_at as archivedAt, linked_trade_key as linkedTradeKey
         FROM notes
         WHERE ${
           includeArchived
             ? "1=1"
             : "(archived_at IS NULL AND folder_id != 'archived')"
         }
         ORDER BY updated_at DESC
         LIMIT 100`
      )
      .all() as Array<{
      id: string;
      folderId: string;
      title: string;
      content: string;
      updatedAt: string;
      archivedAt: string | null;
      linkedTradeKey: string | null;
    }>;

    // Fetch recent trades (for dropdown & multi-matching)
    const recentTrades = db
      .prepare(
        `SELECT t.key, t.symbol, t.direction, t.status, t.opened_at as openedAt,
                t.closed_at as closedAt, t.net_pnl as netPnl, t.quantity,
                CASE WHEN (t.notes IS NOT NULL AND TRIM(t.notes) != '') OR (t.review_notes IS NOT NULL AND TRIM(t.review_notes) != '') THEN 1 ELSE 0 END as hasNotes
         FROM trades t
         ORDER BY t.opened_at DESC
         LIMIT 80`
      )
      .all() as Array<any>;

    let targetTrade: any = null;
    if (tradeKey) {
      targetTrade = recentTrades.find((t) => t.key === tradeKey) ||
        db
          .prepare(
            `SELECT key, symbol, direction, status, opened_at as openedAt, closed_at as closedAt, net_pnl as netPnl, quantity
             FROM trades WHERE key = ?`
          )
          .get(tradeKey);
    }

    const refDate = (targetTrade?.openedAt || dateParam || "").slice(0, 10);
    const refSymbol = (targetTrade?.symbol || "").toUpperCase();

    // Score and filter candidate drafts for the target trade / date
    const matchingDrafts = notes
      .filter((n) => !n.archivedAt && n.folderId !== "archived")
      .map((n) => {
        const noteDate = (n.updatedAt || "").slice(0, 10);
        const textUpper = `${n.title || ""} ${n.content || ""}`.toUpperCase();
        const sameDay = Boolean(refDate && noteDate === refDate);
        const symbolMatch = Boolean(refSymbol && textUpper.includes(refSymbol));

        // Also check common alias pairs (e.g. NQ <-> NAS100, ES <-> US500, GC <-> XAUUSD)
        const aliasMatch =
          (refSymbol.includes("NAS") && (textUpper.includes("NQ") || textUpper.includes("NAS"))) ||
          (refSymbol.includes("NQ") && textUpper.includes("NAS")) ||
          (refSymbol.includes("US500") && (textUpper.includes("ES") || textUpper.includes("SPX"))) ||
          (refSymbol.includes("XAU") && textUpper.includes("GOLD"));

        let score = 0;
        if (sameDay) score += 2;
        if (symbolMatch || aliasMatch) score += 2;
        if ((n.title || "").toLowerCase().includes("trade") || (n.title || "").toLowerCase().includes("scratchpad")) {
          score += 1;
        }
        return {
          ...n,
          sameDay,
          symbolMatch: symbolMatch || aliasMatch,
          score,
        };
      })
      .filter((n) => (refDate ? n.sameDay || n.symbolMatch : true))
      .sort((a, b) => b.score - a.score || b.updatedAt.localeCompare(a.updatedAt));

    // Also find all trades on that same date so multi-entry matching knows if multiple trades occurred
    const sameDayTrades = refDate
      ? recentTrades.filter((t) => (t.openedAt || "").slice(0, 10) === refDate)
      : recentTrades.slice(0, 15);

    return NextResponse.json({
      ok: true,
      notes,
      matchingDrafts,
      sameDayTrades,
      recentTrades,
      targetTrade,
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || "Bridge query failed" }, { status: 500 });
  } finally {
    db.close();
  }
}

export async function POST(req: NextRequest) {
  const db = getDb();
  try {
    const body = await req.json();
    const action = body.action || "";

    // 1. CREATE PRE-STRUCTURED LIVE TRADE SCRATCHPAD NOTE
    if (action === "create_scratchpad") {
      const symbol = String(body.symbol || "").trim().toUpperCase();
      const direction = String(body.direction || "LONG").toUpperCase();
      const nowStr = new Date().toISOString();
      const timeLabel = nowStr.slice(11, 16);
      const id = crypto.randomUUID();
      const title = symbol
        ? `[Trade Draft] ${symbol} ${direction} (${ nowStr.slice(0, 10) } ${timeLabel})`
        : `[Trade Draft] Live Execution (${ nowStr.slice(0, 10) } ${timeLabel})`;

      const templateHtml =
        `<h3>1. Entry &amp; Before-Trade Screenshot</h3>` +
        `<p><strong>Symbol / Bias:</strong> ${symbol || "NAS100"} (${direction})</p>` +
        `<p><strong>Entry Thesis &amp; Confirmation:</strong> </p>` +
        `<p><em>(Paste your Before-Trade screenshot below)</em></p><p><br/></p>` +
        `<hr/>` +
        `<h3>2. Post-Trade Review &amp; After Screenshot</h3>` +
        `<p><strong>Execution &amp; Management Notes:</strong> </p>` +
        `<p><em>(Paste your After-Trade screenshot below)</em></p><p><br/></p>`;

      db.prepare(
        `INSERT INTO notes (id, folder_id, title, content, created_at, updated_at)
         VALUES (?, 'my-notes', ?, ?, ?, ?)`
      ).run(id, title, templateHtml, nowStr, nowStr);

      return NextResponse.json({ ok: true, id, title, content: templateHtml });
    }

    // 2. BATCH OR SINGLE CONFIRMED TRANSFER: NOTEBOOK DRAFT(S) -> TRADE(S)
    if (action === "transfer_to_trades") {
      const transfers: Array<{
        noteId: string;
        tradeKey: string;
        targetSection?: "auto_split" | "setup" | "review";
        mode?: "append" | "replace";
      }> = Array.isArray(body.transfers) ? body.transfers : [];

      if (transfers.length === 0) {
        return NextResponse.json({ ok: false, error: "No draft-to-trade mappings selected." }, { status: 400 });
      }

      const nowIso = new Date().toISOString();
      let movedCount = 0;

      const tx = db.transaction(() => {
        for (const item of transfers) {
          if (!item.noteId || !item.tradeKey) continue;
          const note = db
            .prepare("SELECT id, title, content FROM notes WHERE id = ?")
            .get(item.noteId) as { id: string; title: string; content: string } | undefined;
          const trade = db
            .prepare("SELECT key, notes, review_notes FROM trades WHERE key = ?")
            .get(item.tradeKey) as { key: string; notes: string | null; review_notes: string | null } | undefined;

          if (!note || !trade) continue;

          const section = item.targetSection || "auto_split";
          const mode = item.mode || "append";

          let nextNotes = (trade.notes || "").trim();
          let nextReview = (trade.review_notes || "").trim();

          if (section === "auto_split") {
            const { setupHtml, reviewHtml } = splitScratchpadContent(note.content);
            if (setupHtml) {
              nextNotes = mode === "replace" || !nextNotes ? setupHtml : `${nextNotes}<p><br/></p>${setupHtml}`;
            }
            if (reviewHtml) {
              nextReview = mode === "replace" || !nextReview ? reviewHtml : `${nextReview}<p><br/></p>${reviewHtml}`;
            }
          } else if (section === "review") {
            nextReview = mode === "replace" || !nextReview ? note.content : `${nextReview}<p><br/></p>${note.content}`;
          } else {
            nextNotes = mode === "replace" || !nextNotes ? note.content : `${nextNotes}<p><br/></p>${note.content}`;
          }

          db.prepare(
            `UPDATE trades
             SET notes = ?, review_notes = ?, reviewed_at = COALESCE(reviewed_at, ?)
             WHERE key = ?`
          ).run(nextNotes, nextReview, nowIso, item.tradeKey);

          // Archive the Notebook draft (auto-deletes after 14 days)
          db.prepare(
            `UPDATE notes
             SET folder_id = 'archived',
                 archived_at = ?,
                 linked_trade_key = ?,
                 updated_at = ?
             WHERE id = ?`
          ).run(nowIso, item.tradeKey, nowIso, note.id);

          movedCount += 1;
        }
      });

      tx();
      return NextResponse.json({
        ok: true,
        movedCount,
        message: `Moved ${movedCount} Notebook draft(s) into Trade Journal and archived (auto-deletes in 14 days).`,
      });
    }

    // 3. MOVE NOTEBOOK DRAFT -> MISSED TRADES + ARCHIVE
    if (action === "transfer_to_missed") {
      const noteId = String(body.noteId || "");
      const symbol = String(body.symbol || "NAS100").trim().toUpperCase();
      const direction = body.direction === "short" ? "short" : "long";
      const setup = String(body.setup || "").trim();

      const note = db
        .prepare("SELECT id, title, content, updated_at FROM notes WHERE id = ?")
        .get(noteId) as { id: string; title: string; content: string; updated_at: string } | undefined;

      if (!note) {
        return NextResponse.json({ ok: false, error: "Notebook note not found." }, { status: 404 });
      }

      const nowIso = new Date().toISOString();
      const missedId = crypto.randomUUID();

      // Inspect missed_trades columns dynamically so insert always succeeds
      const mCols = (db.prepare("PRAGMA table_info(missed_trades)").all() as Array<{ name: string }>).map(
        (c) => c.name
      );

      const insertData: Record<string, any> = {
        id: missedId,
        symbol,
        direction,
        notes: `<h4>${note.title || "Missed Trade Draft"}</h4>\n${note.content || ""}`,
      };
      if (mCols.includes("setup")) insertData.setup = setup || note.title || "Notebook Draft";
      if (mCols.includes("missed_at")) insertData.missed_at = note.updated_at || nowIso;
      if (mCols.includes("date")) insertData.date = (note.updated_at || nowIso).slice(0, 10);
      if (mCols.includes("created_at")) insertData.created_at = nowIso;
      if (mCols.includes("updated_at")) insertData.updated_at = nowIso;
      if (mCols.includes("reason")) insertData.reason = setup || "Logged via Notebook Scratchpad";

      const validKeys = Object.keys(insertData).filter((k) => mCols.includes(k));
      const placeholders = validKeys.map(() => "?").join(", ");
      const values = validKeys.map((k) => insertData[k]);

      db.prepare(
        `INSERT INTO missed_trades (${validKeys.join(", ")}) VALUES (${placeholders})`
      ).run(...values);

      // Archive the Notebook draft (auto-deletes after 14 days)
      db.prepare(
        `UPDATE notes
         SET folder_id = 'archived',
             archived_at = ?,
             linked_trade_key = ?,
             updated_at = ?
         WHERE id = ?`
      ).run(nowIso, `missed:${missedId}`, nowIso, note.id);

      return NextResponse.json({
        ok: true,
        missedId,
        message: `Moved "${note.title}" to Missed Trades (${symbol} ${direction.toUpperCase()}) and archived draft (auto-deletes in 14 days).`,
      });
    }

    // 4. UNARCHIVE A NOTE IF NEEDED
    if (action === "unarchive_note") {
      const noteId = String(body.noteId || "");
      db.prepare(
        `UPDATE notes SET folder_id = 'my-notes', archived_at = NULL, updated_at = datetime('now') WHERE id = ?`
      ).run(noteId);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || "Bridge action failed" }, { status: 500 });
  } finally {
    db.close();
  }
}
