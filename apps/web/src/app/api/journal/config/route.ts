import { NextRequest, NextResponse } from "next/server";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import {
  getJournalConfig,
  saveJournalConfig,
  autoPopulateUpcomingJournals,
} from "@/server/journal-service";

export const dynamic = "force-dynamic";

function resolveDbPath(): string {
  const dbPath = path.resolve(process.cwd(), "data", "journal.db");
  const altDbPath = path.resolve(process.cwd(), "apps", "web", "data", "journal.db");
  return fs.existsSync(dbPath) ? dbPath : altDbPath;
}

function readCustomReviewQuestions(): any | null {
  try {
    const dbPath = resolveDbPath();
    if (!fs.existsSync(dbPath)) return null;
    const db = new Database(dbPath);
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS journal_kv_settings (
          key TEXT PRIMARY KEY,
          value_json TEXT NOT NULL
        )
      `);
      const row = db
        .prepare(`SELECT value_json FROM journal_kv_settings WHERE key = 'review_questions'`)
        .get() as { value_json: string } | undefined;
      return row ? JSON.parse(row.value_json) : null;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

function writeCustomReviewQuestions(questions: any) {
  try {
    const dbPath = resolveDbPath();
    if (!fs.existsSync(dbPath)) return;
    const db = new Database(dbPath);
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS journal_kv_settings (
          key TEXT PRIMARY KEY,
          value_json TEXT NOT NULL
        )
      `);
      db.prepare(`
        INSERT INTO journal_kv_settings (key, value_json)
        VALUES ('review_questions', ?)
        ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json
      `).run(JSON.stringify(questions));
    } finally {
      db.close();
    }
  } catch {}
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const config = getJournalConfig() as any;
    const reviewQuestions = readCustomReviewQuestions();
    if (reviewQuestions) {
      config.reviewQuestions = reviewQuestions;
    }
    if (url.searchParams.get("autopopulate") === "1") {
      void autoPopulateUpcomingJournals(5).catch((err) =>
        console.warn("[AutoPopulate] Background warning:", err)
      );
    }
    return NextResponse.json({ ok: true, config });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "Failed to load journal config" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (body.reviewQuestions !== undefined) {
      writeCustomReviewQuestions(body.reviewQuestions);
    }
    const updated = saveJournalConfig(body) as any;
    const reviewQuestions = readCustomReviewQuestions();
    if (reviewQuestions) {
      updated.reviewQuestions = reviewQuestions;
    }
    if (body.triggerAutoPopulate) {
      void autoPopulateUpcomingJournals(5).catch((err) =>
        console.warn("[AutoPopulate] Background warning:", err)
      );
    }
    return NextResponse.json({ ok: true, config: updated });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "Failed to save journal config" },
      { status: 500 }
    );
  }
}
