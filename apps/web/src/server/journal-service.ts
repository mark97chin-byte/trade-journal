import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

export interface DBJournalTrade {
  key: string;
  symbol: string;
  direction: string;
  opened_at: string;
  closed_at: string | null;
  net_pnl: number;
  gross_pnl: number | null;
  fees: number | null;
  quantity: number;
  avg_entry: number | null;
  avg_exit: number | null;
  realized_r: number | null;
  mae_r: number | null;
  mfe_r: number | null;
  partials_breakdown: string | null;
  notes: string | null;
  tags_json: string | null;
}

export interface JournalEntryRecord {
  slug: string;
  periodType: "day" | "week" | "month" | "quarter" | "year";
  title: string;
  content: string;
  marketBias: string;
  dayProfile: string;
  keyLevels: string;
  lessonsLearned: string;
  checklistJson: string;
  scoresJson: string;
  tagsJson: string;
  rating: number;
  notionPageId: string | null;
  notionUrl: string | null;
  updatedAt: string;
}

function resolveDbPath(): string {
  const dbPath = path.resolve(process.cwd(), "data", "journal.db");
  const altDbPath = path.resolve(process.cwd(), "apps", "web", "data", "journal.db");
  return fs.existsSync(dbPath) ? dbPath : altDbPath;
}

export function ensureJournalSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS journal_entries (
      slug TEXT PRIMARY KEY,
      period_type TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT DEFAULT '',
      market_bias TEXT DEFAULT '',
      day_profile TEXT DEFAULT '',
      key_levels TEXT DEFAULT '',
      lessons_learned TEXT DEFAULT '',
      checklist_json TEXT DEFAULT '{}',
      scores_json TEXT DEFAULT '{}',
      tags_json TEXT DEFAULT '[]',
      rating INTEGER DEFAULT 0,
      notion_page_id TEXT,
      notion_url TEXT,
      updated_at TEXT NOT NULL
    );
  `);
}

export async function getJournalTrades() {
  const finalPath = resolveDbPath();
  if (!fs.existsSync(finalPath)) {
    console.warn("journal.db not found at", finalPath);
    return [];
  }

  const db = new Database(finalPath, { readonly: true });
  try {
    const rows = db
      .prepare(
        `SELECT key, symbol, direction, opened_at, closed_at, net_pnl, gross_pnl, fees, quantity,
                avg_entry, avg_exit, realized_r, mae_r, mfe_r, partials_breakdown, notes, tags_json
         FROM trades
         WHERE status != 'open'
         ORDER BY opened_at DESC`
      )
      .all() as DBJournalTrade[];

    return rows.map((r) => {
      let tags: string[] = [];
      try {
        if (r.tags_json) tags = JSON.parse(r.tags_json);
      } catch {}

      return {
        key: r.key,
        symbol: r.symbol,
        direction: r.direction,
        openedAt: r.opened_at,
        closedAt: r.closed_at,
        netPnl: r.net_pnl ?? 0,
        grossPnl: r.gross_pnl ?? r.net_pnl ?? 0,
        fees: r.fees ?? 0,
        quantity: r.quantity ?? 1,
        avgEntry: r.avg_entry ?? undefined,
        avgExit: r.avg_exit ?? undefined,
        realizedR: r.realized_r ?? null,
        maeR: r.mae_r ?? null,
        mfeR: r.mfe_r ?? null,
        partialsBreakdown: r.partials_breakdown ?? null,
        notes: r.notes ?? null,
        tags,
      };
    });
  } finally {
    db.close();
  }
}

export function parseSlugRange(slug: string): {
  periodType: "day" | "week" | "month" | "quarter" | "year";
  startDate: string; // YYYY-MM-DD inclusive
  endDate: string;   // YYYY-MM-DD inclusive
  anchorDate: string; // Representative YYYY-MM-DD used to compute sibling Day/Week/Month/Quarter/Year tabs
  defaultTitle: string;
} {
  if (slug.startsWith("week-")) {
    const mondayStr = slug.replace("week-", "");
    const mon = new Date(`${mondayStr}T12:00:00Z`);
    const sunBefore = new Date(mon.getTime() - 86_400_000);
    const satAfter = new Date(mon.getTime() + 5 * 86_400_000);
    const startStr = sunBefore.toISOString().slice(0, 10);
    const endStr = satAfter.toISOString().slice(0, 10);
    return {
      periodType: "week",
      startDate: startStr,
      endDate: endStr,
      anchorDate: mondayStr,
      defaultTitle: `Weekly Journal (${mondayStr})`,
    };
  }

  if (slug.startsWith("month-")) {
    const mKey = slug.replace("month-", ""); // YYYY-MM
    const [yr, mo] = mKey.split("-").map(Number);
    const lastDay = new Date(Date.UTC(yr || 2026, mo || 1, 0)).getUTCDate();
    const startStr = `${mKey}-01`;
    const endStr = `${mKey}-${String(lastDay).padStart(2, "0")}`;
    return {
      periodType: "month",
      startDate: startStr,
      endDate: endStr,
      anchorDate: startStr,
      defaultTitle: `Monthly Journal (${mKey})`,
    };
  }

  if (slug.startsWith("quarter-")) {
    const qKey = slug.replace("quarter-", ""); // YYYY-Q1
    const [yrStr, qPart] = qKey.split("-");
    const yr = parseInt(yrStr || "2026", 10);
    const qNum = parseInt((qPart || "Q1").replace("Q", ""), 10);
    const startMonth = (qNum - 1) * 3 + 1;
    const endMonth = startMonth + 2;
    const lastDay = new Date(Date.UTC(yr, endMonth, 0)).getUTCDate();
    const startStr = `${yr}-${String(startMonth).padStart(2, "0")}-01`;
    const endStr = `${yr}-${String(endMonth).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    return {
      periodType: "quarter",
      startDate: startStr,
      endDate: endStr,
      anchorDate: startStr,
      defaultTitle: `Quarterly Journal (${qKey})`,
    };
  }

  if (slug.startsWith("year-")) {
    const yr = slug.replace("year-", "");
    const startStr = `${yr}-01-01`;
    const endStr = `${yr}-12-31`;
    return {
      periodType: "year",
      startDate: startStr,
      endDate: endStr,
      anchorDate: startStr,
      defaultTitle: `Yearly Journal (${yr})`,
    };
  }

  // Default: Daily Journal (YYYY-MM-DD)
  const dateStr = slug.slice(0, 10);
  return {
    periodType: "day",
    startDate: dateStr,
    endDate: dateStr,
    anchorDate: dateStr,
    defaultTitle: `Daily Journal — ${dateStr}`,
  };
}

export async function getJournalEntryWithTrades(slug: string) {
  const finalPath = resolveDbPath();
  const range = parseSlugRange(slug);
  const allTrades = await getJournalTrades();

  const periodTrades = allTrades.filter((t) => {
    const d = t.openedAt.slice(0, 10);
    return d >= range.startDate && d <= range.endDate;
  });

  if (!fs.existsSync(finalPath)) {
    return {
      entry: {
        slug,
        periodType: range.periodType,
        title: range.defaultTitle,
        content: "",
        marketBias: "",
        dayProfile: "",
        keyLevels: "",
        lessonsLearned: "",
        checklistJson: "{}",
        scoresJson: "{}",
        tagsJson: "[]",
        rating: 0,
        notionPageId: null,
        notionUrl: null,
        updatedAt: new Date().toISOString(),
      } as JournalEntryRecord,
      trades: periodTrades,
      range,
    };
  }

  const db = new Database(finalPath);
  try {
    ensureJournalSchema(db);
    const row = db
      .prepare(`SELECT * FROM journal_entries WHERE slug = ?`)
      .get(slug) as any;

    const entry: JournalEntryRecord = row
      ? {
          slug: row.slug,
          periodType: row.period_type,
          title: row.title,
          content: row.content ?? "",
          marketBias: row.market_bias ?? "",
          dayProfile: row.day_profile ?? "",
          keyLevels: row.key_levels ?? "",
          lessonsLearned: row.lessons_learned ?? "",
          checklistJson: row.checklist_json ?? "{}",
          scoresJson: row.scores_json ?? "{}",
          tagsJson: row.tags_json ?? "[]",
          rating: row.rating ?? 0,
          notionPageId: row.notion_page_id ?? null,
          notionUrl: row.notion_url ?? null,
          updatedAt: row.updated_at,
        }
      : {
          slug,
          periodType: range.periodType,
          title: range.defaultTitle,
          content: "",
          marketBias: "",
          dayProfile: "",
          keyLevels: "",
          lessonsLearned: "",
          checklistJson: "{}",
          scoresJson: "{}",
          tagsJson: "[]",
          rating: 0,
          notionPageId: null,
          notionUrl: null,
          updatedAt: new Date().toISOString(),
        };

    return {
      entry,
      trades: periodTrades,
      range,
    };
  } finally {
    db.close();
  }
}

export async function saveJournalEntry(
  slug: string,
  payload: Partial<JournalEntryRecord>
): Promise<JournalEntryRecord> {
  const finalPath = resolveDbPath();
  const range = parseSlugRange(slug);
  const db = new Database(finalPath);

  try {
    ensureJournalSchema(db);
    const existing = db
      .prepare(`SELECT * FROM journal_entries WHERE slug = ?`)
      .get(slug) as any;

    const nowIso = new Date().toISOString();
    const updated: JournalEntryRecord = {
      slug,
      periodType: range.periodType,
      title: payload.title ?? existing?.title ?? range.defaultTitle,
      content: payload.content ?? existing?.content ?? "",
      marketBias: payload.marketBias ?? existing?.market_bias ?? "",
      dayProfile: payload.dayProfile ?? existing?.day_profile ?? "",
      keyLevels: payload.keyLevels ?? existing?.key_levels ?? "",
      lessonsLearned: payload.lessonsLearned ?? existing?.lessons_learned ?? "",
      checklistJson: payload.checklistJson ?? existing?.checklist_json ?? "{}",
      scoresJson: payload.scoresJson ?? existing?.scores_json ?? "{}",
      tagsJson: payload.tagsJson ?? existing?.tags_json ?? "[]",
      rating: payload.rating ?? existing?.rating ?? 0,
      notionPageId:
        payload.notionPageId !== undefined
          ? payload.notionPageId
          : existing?.notion_page_id ?? null,
      notionUrl:
        payload.notionUrl !== undefined
          ? payload.notionUrl
          : existing?.notion_url ?? null,
      updatedAt: nowIso,
    };

    db.prepare(
      `INSERT INTO journal_entries (
        slug, period_type, title, content, market_bias, day_profile,
        key_levels, lessons_learned, checklist_json, scores_json,
        tags_json, rating, notion_page_id, notion_url, updated_at
      ) VALUES (
        @slug, @periodType, @title, @content, @marketBias, @dayProfile,
        @keyLevels, @lessonsLearned, @checklistJson, @scoresJson,
        @tagsJson, @rating, @notionPageId, @notionUrl, @updatedAt
      )
      ON CONFLICT(slug) DO UPDATE SET
        title = excluded.title,
        content = excluded.content,
        market_bias = excluded.market_bias,
        day_profile = excluded.day_profile,
        key_levels = excluded.key_levels,
        lessons_learned = excluded.lessons_learned,
        checklist_json = excluded.checklist_json,
        scores_json = excluded.scores_json,
        tags_json = excluded.tags_json,
        rating = excluded.rating,
        notion_page_id = COALESCE(excluded.notion_page_id, journal_entries.notion_page_id),
        notion_url = COALESCE(excluded.notion_url, journal_entries.notion_url),
        updated_at = excluded.updated_at`
    ).run(updated);

    return updated;
  } finally {
    db.close();
  }
}
