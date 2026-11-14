import { NextRequest, NextResponse } from "next/server";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import zlib from "zlib";
import { ensureJournalSchema } from "@/server/journal-service";
import { getCandleDb } from "@/server/market-data/candle-db";

export const dynamic = "force-dynamic";

function resolveDbPath(): string {
  const dbPath = path.resolve(process.cwd(), "data", "journal.db");
  const altDbPath = path.resolve(process.cwd(), "apps", "web", "data", "journal.db");
  return fs.existsSync(dbPath) ? dbPath : altDbPath;
}

const BACKUP_TABLES = [
  "accounts",
  "trades",
  "executions",
  "journal_entries",
  "journal_days",
  "settings",
  "journal_kv_settings",
  "playbooks",
  "playbook_meta",
  "playbook_notes",
  "trade_rule_checks",
  "tag_categories",
  "tag_definitions",
  "folders",
  "notes",
  "note_templates",
  "ai_coach_reports",
  "ai_chat_sessions",
  "ai_chat_messages",
  "trader_goals",
  "progress_rules",
  "progress_checks",
  "routine_checks",
  "missed_trades",
  "trade_excursions",
  "market_csv_datasets",
  "prop_accounts",
  "prop_entries",
  "prop_receipts",
  "attachments",
];

export async function GET() {
  try {
    const dbPath = resolveDbPath();
    if (!fs.existsSync(dbPath)) {
      return NextResponse.json({ error: "Database not found" }, { status: 404 });
    }

    const db = new Database(dbPath, { readonly: true });
    const dump: Record<string, any[]> = {};

    try {
      for (const tbl of BACKUP_TABLES) {
        try {
          const rows = db.prepare(`SELECT * FROM ${tbl}`).all() as any[];
          if (tbl === "attachments") {
            dump[tbl] = rows.map((r) => ({
              ...r,
              data_b64: Buffer.isBuffer(r.data) ? r.data.toString("base64") : null,
              data: undefined,
            }));
          } else {
            dump[tbl] = rows;
          }
        } catch {
          dump[tbl] = [];
        }
      }
      try {
        const cdb = getCandleDb();
        dump["market_candles"] = cdb.prepare(`SELECT * FROM candles`).all() as any[];
      } catch {
        dump["market_candles"] = [];
      }
    } finally {
      db.close();
    }

    const payloadJson = JSON.stringify({
      version: 2,
      exportedAt: new Date().toISOString(),
      tables: dump,
    });

    // Lossless Level-9 Gzip compression (~70% smaller with 0% quality loss)
    const compressed = zlib.gzipSync(Buffer.from(payloadJson, "utf-8"), { level: 9 });
    const dateStamp = new Date().toISOString().slice(0, 10);

    return new NextResponse(compressed, {
      status: 200,
      headers: {
        "Content-Type": "application/gzip",
        "Content-Disposition": `attachment; filename="trade-journal-backup-${dateStamp}.json.gz"`,
        "Content-Length": String(compressed.length),
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to generate compressed backup" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const mode = String(formData.get("mode") || "merge"); // "merge" | "replace"

    if (!file) {
      return NextResponse.json({ ok: false, error: "No backup file provided" }, { status: 400 });
    }

    const arrayBuf = await file.arrayBuffer();
    const rawBuf = Buffer.from(arrayBuf);

    // Detect Gzip magic bytes (0x1f 0x8b)
    let jsonStr: string;
    if (rawBuf.length >= 2 && rawBuf[0] === 0x1f && rawBuf[1] === 0x8b) {
      jsonStr = zlib.gunzipSync(rawBuf).toString("utf-8");
    } else {
      jsonStr = rawBuf.toString("utf-8");
    }

    const parsed = JSON.parse(jsonStr);
    const tables = parsed.tables || parsed;
    if (!tables || typeof tables !== "object") {
      return NextResponse.json({ ok: false, error: "Invalid backup archive structure" }, { status: 400 });
    }

    const dbPath = resolveDbPath();
    const db = new Database(dbPath);
    ensureJournalSchema(db);
    db.exec(`
      CREATE TABLE IF NOT EXISTS journal_kv_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS playbook_meta (playbook_id TEXT PRIMARY KEY, icon TEXT NOT NULL DEFAULT '🚀', color TEXT NOT NULL DEFAULT '#6366f1', photo_url TEXT NOT NULL DEFAULT '', tags_json TEXT NOT NULL DEFAULT '[]', rule_groups_json TEXT NOT NULL DEFAULT '[]', archived INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS playbook_notes (id TEXT PRIMARY KEY, playbook_id TEXT NOT NULL, title TEXT NOT NULL DEFAULT 'Untitled', content TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tag_categories (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tag_definitions (id TEXT PRIMARY KEY, name TEXT NOT NULL, category_id TEXT, description TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ai_coach_reports (id TEXT PRIMARY KEY, horizon TEXT NOT NULL, period_key TEXT NOT NULL, title TEXT NOT NULL, summary_md TEXT NOT NULL, reasoning_trace TEXT, telemetry_json TEXT, suggested_goals_json TEXT, accountability_json TEXT, action_items_json TEXT DEFAULT '[]', reflection_questions_json TEXT DEFAULT '[]', model_used TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ai_chat_sessions (id TEXT PRIMARY KEY, title TEXT NOT NULL, report_id TEXT DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ai_chat_messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, reasoning TEXT, model_used TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS trader_goals (id TEXT PRIMARY KEY, horizon TEXT NOT NULL, period_label TEXT NOT NULL, title TEXT NOT NULL, why_it_matters TEXT, target_metric TEXT, status TEXT NOT NULL, progress_pct INTEGER DEFAULT 0, steps_json TEXT DEFAULT '[]', ai_accountability_note TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    `);

    let restoredRows = 0;

    try {
      db.pragma("foreign_keys = OFF");
      const tx = db.transaction(() => {
        for (const tbl of BACKUP_TABLES) {
          const rows = tables[tbl];
          if (!Array.isArray(rows) || rows.length === 0) continue;

          // Verify table exists in current schema
          let colInfo: Array<{ name: string }> = [];
          try {
            colInfo = db.prepare(`PRAGMA table_info(${tbl})`).all() as any[];
          } catch {
            continue;
          }
          if (!colInfo.length) continue;

          const validCols = new Set(colInfo.map((c) => c.name));

          if (mode === "replace") {
            try {
              db.prepare(`DELETE FROM ${tbl}`).run();
            } catch {}
          }

          for (const rawRow of rows) {
            const rowObj: Record<string, any> = { ...rawRow };
            if (tbl === "attachments" && rowObj.data_b64) {
              rowObj.data = Buffer.from(rowObj.data_b64, "base64");
              delete rowObj.data_b64;
            }

            const cols = Object.keys(rowObj).filter(
              (k) => validCols.has(k) && rowObj[k] !== undefined
            );
            if (!cols.length) continue;

            const placeholders = cols.map(() => "?").join(", ");
            const values = cols.map((c) => rowObj[c]);

            const sql = `INSERT OR REPLACE INTO ${tbl} (${cols.join(", ")}) VALUES (${placeholders})`;
            db.prepare(sql).run(...values);
            restoredRows++;
          }
        }
      });
      tx();
      if (Array.isArray(tables["market_candles"]) && tables["market_candles"].length > 0) {
        try {
          const cdb = getCandleDb();
          if (mode === "replace") {
            cdb.prepare(`DELETE FROM candles`).run();
          }
          const ins = cdb.prepare(
            `INSERT OR REPLACE INTO candles (provider, symbol, timeframe, time, open, high, low, close, volume)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          );
          const cTx = cdb.transaction((rows: any[]) => {
            for (const r of rows) {
              ins.run(r.provider, r.symbol, r.timeframe, r.time, r.open, r.high, r.low, r.close, r.volume);
              restoredRows++;
            }
          });
          cTx(tables["market_candles"]);
        } catch {}
      }
      db.pragma("foreign_keys = ON");
      db.exec(`PRAGMA wal_checkpoint(TRUNCATE);`);
    } finally {
      db.close();
    }

    return NextResponse.json({
      ok: true,
      restoredRows,
      mode,
      message: `Successfully restored ${restoredRows.toLocaleString()} records (${mode === "replace" ? "Full Snapshot Replace" : "Safe Merge"}).`,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "Failed to restore backup archive" },
      { status: 500 }
    );
  }
}
