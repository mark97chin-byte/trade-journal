import { NextRequest, NextResponse } from "next/server";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import zlib from "zlib";
import { ensureJournalSchema } from "@/server/journal-service";

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
  "playbooks",
  "trade_rule_checks",
  "folders",
  "notes",
  "note_templates",
  "progress_rules",
  "progress_checks",
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
