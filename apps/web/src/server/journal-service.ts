import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import {
  getNotionConfig,
  editorHtmlToNotionTree,
  appendBlocksTreeRecursive,
  findNotionPageInDb,
} from "@/server/notion-sync";

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
  reviewContent: string;
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
  reviewNotionPageId: string | null;
  reviewNotionUrl: string | null;
  updatedAt: string;
}

export interface SavedNoteTemplate {
  id: string;
  name: string;
  html: string;
}

export type PeriodKey = "day" | "week" | "month" | "quarter" | "year";

export interface JournalConfigData {
  templates: SavedNoteTemplate[];
  defaultTemplates: Record<string, string>; // e.g., "day_prep": "tpl-prep", "week_review": "tpl-review"
  checklists: Record<PeriodKey, Array<{ id: string; label: string }>>;
}

export const INITIAL_NOTE_TEMPLATES: SavedNoteTemplate[] = [
  {
    id: "tpl-prep",
    name: "🎯 Preparation & Session Log",
    html: `<div class="tz-toggle tz-toggle-h2" data-notion-type="heading_2" data-toggle-type="heading_2" data-open="false"><div class="tz-toggle-header"><span class="tz-toggle-btn" contenteditable="false">▸</span><div class="tz-toggle-title"><strong>🎯 Preparation &amp; Game plan</strong></div></div><div class="tz-toggle-body" style="display:none"><div class="tz-column-list" data-notion-type="column_list" data-columns="2"><div class="tz-column" data-notion-type="column"><div class="tz-toggle" data-notion-type="toggle" data-toggle-type="toggle" data-open="false"><div class="tz-toggle-header"><span class="tz-toggle-btn" contenteditable="false">▸</span><div class="tz-toggle-title"><strong>Watchlist &amp; Bias</strong></div></div><div class="tz-toggle-body" style="display:none"><p><em>List of symbols &amp; HTF draw on liquidity</em></p></div></div></div><div class="tz-column" data-notion-type="column"><div class="tz-toggle" data-notion-type="toggle" data-toggle-type="toggle" data-open="false"><div class="tz-toggle-header"><span class="tz-toggle-btn" contenteditable="false">▸</span><div class="tz-toggle-title"><strong>Key Levels &amp; Gameplan</strong></div></div><div class="tz-toggle-body" style="display:none"><p><em>Session highs/lows, FVGs, and triggers</em></p></div></div></div></div></div></div><hr class="tz-divider" data-notion-type="divider" /><div class="tz-toggle tz-toggle-h2" data-notion-type="heading_2" data-toggle-type="heading_2" data-open="false"><div class="tz-toggle-header"><span class="tz-toggle-btn" contenteditable="false">▸</span><div class="tz-toggle-title"><strong>📝 Session log</strong></div></div><div class="tz-toggle-body" style="display:none"><p>Paste TradingView screenshots (Ctrl+V) or log live execution notes here...</p></div></div><p><br/></p>`,
  },
  {
    id: "tpl-weekly-analysis",
    name: "📊 Weekly Multi-Asset Forecast",
    html: `<div class="tz-banner tz-color-gray_background" data-notion-type="paragraph" data-notion-color="gray_background"><strong>What are the Important FED Manipulation / Holiday to look out for this week?</strong></div><blockquote class="tz-quote" data-notion-type="quote"><div><em>Summarize high-impact macro drivers and session expectations...</em></div></blockquote><hr class="tz-divider" data-notion-type="divider" /><div class="tz-toggle tz-toggle-h2" data-notion-type="heading_2" data-toggle-type="heading_2" data-open="false"><div class="tz-toggle-header"><span class="tz-toggle-btn" contenteditable="false">▸</span><div class="tz-toggle-title"><strong>Weekly Thoughts</strong></div></div><div class="tz-toggle-body" style="display:none"><div class="tz-toggle" data-notion-type="toggle" data-toggle-type="toggle" data-open="false"><div class="tz-toggle-header"><span class="tz-toggle-btn" contenteditable="false">▸</span><div class="tz-toggle-title"><strong>ES</strong></div></div><div class="tz-toggle-body" style="display:none"><p><br/></p></div></div><div class="tz-toggle" data-notion-type="toggle" data-toggle-type="toggle" data-open="false"><div class="tz-toggle-header"><span class="tz-toggle-btn" contenteditable="false">▸</span><div class="tz-toggle-title"><strong>NQ</strong></div></div><div class="tz-toggle-body" style="display:none"><p><br/></p></div></div><div class="tz-toggle" data-notion-type="toggle" data-toggle-type="toggle" data-open="false"><div class="tz-toggle-header"><span class="tz-toggle-btn" contenteditable="false">▸</span><div class="tz-toggle-title"><strong>Gold</strong></div></div><div class="tz-toggle-body" style="display:none"><p><br/></p></div></div><div class="tz-toggle" data-notion-type="toggle" data-toggle-type="toggle" data-open="false"><div class="tz-toggle-header"><span class="tz-toggle-btn" contenteditable="false">▸</span><div class="tz-toggle-title"><strong>DXY</strong></div></div><div class="tz-toggle-body" style="display:none"><p><br/></p></div></div></div></div><hr class="tz-divider" data-notion-type="divider" /><div class="tz-toggle tz-toggle-h2" data-notion-type="heading_2" data-toggle-type="heading_2" data-open="false"><div class="tz-toggle-header"><span class="tz-toggle-btn" contenteditable="false">▸</span><div class="tz-toggle-title"><strong>Weekly Forecast</strong></div></div><div class="tz-toggle-body" style="display:none"><div class="tz-toggle" data-notion-type="toggle" data-toggle-type="toggle" data-open="false"><div class="tz-toggle-header"><span class="tz-toggle-btn" contenteditable="false">▸</span><div class="tz-toggle-title"><strong>ES</strong></div></div><div class="tz-toggle-body" style="display:none"><p><br/></p></div></div><div class="tz-toggle" data-notion-type="toggle" data-toggle-type="toggle" data-open="false"><div class="tz-toggle-header"><span class="tz-toggle-btn" contenteditable="false">▸</span><div class="tz-toggle-title"><strong>NQ</strong></div></div><div class="tz-toggle-body" style="display:none"><p><br/></p></div></div><div class="tz-toggle" data-notion-type="toggle" data-toggle-type="toggle" data-open="false"><div class="tz-toggle-header"><span class="tz-toggle-btn" contenteditable="false">▸</span><div class="tz-toggle-title"><strong>Gold</strong></div></div><div class="tz-toggle-body" style="display:none"><p><br/></p></div></div><div class="tz-toggle" data-notion-type="toggle" data-toggle-type="toggle" data-open="false"><div class="tz-toggle-header"><span class="tz-toggle-btn" contenteditable="false">▸</span><div class="tz-toggle-title"><strong>DXY</strong></div></div><div class="tz-toggle-body" style="display:none"><p><br/></p></div></div></div></div><p><br/></p>`,
  },
  {
    id: "tpl-review",
    name: "🔍 End-of-Period Review (2-Col)",
    html: `<div class="tz-callout tz-color-blue_background" data-notion-type="callout" data-notion-color="blue_background" data-icon="🎯"><span class="tz-callout-icon" contenteditable="false">🎯</span><div class="tz-callout-content"><div><strong>Period Execution &amp; Outcome Synthesis</strong></div><div>Summarize system adherence, A+ setups captured, and key lessons from this period.</div></div></div><div class="tz-column-list" data-notion-type="column_list" data-columns="2"><div class="tz-column" data-notion-type="column"><h3>✅ What Went Well</h3><div class="tz-check-row" data-notion-type="to_do"><input type="checkbox" class="tz-inline-checkbox" checked="checked" /><div class="tz-check-text">Followed HTF draw on liquidity &amp; session windows</div></div></div><div class="tz-column" data-notion-type="column"><h3>⚠️ Areas for Refinement</h3><div class="tz-check-row" data-notion-type="to_do"><input type="checkbox" class="tz-inline-checkbox" /><div class="tz-check-text">Review stop placement, scaling, or premature exits</div></div></div></div><hr class="tz-divider" data-notion-type="divider" /><div class="tz-toggle tz-toggle-h2" data-notion-type="heading_2" data-toggle-type="heading_2" data-open="false"><div class="tz-toggle-header"><span class="tz-toggle-btn" contenteditable="false">▸</span><div class="tz-toggle-title"><strong>📈 Multi-Asset Outcome Review (ES / NQ / Gold / DXY)</strong></div></div><div class="tz-toggle-body" style="display:none"><p>Compare forecast vs actual delivery...</p></div></div><p><br/></p>`,
  },
];

export const DEFAULT_PERIOD_CHECKLISTS: Record<PeriodKey, Array<{ id: string; label: string }>> = {
  day: [
    { id: "htf_narrative", label: "Mapped HTF Draw on Liquidity & Daily Relevant Swing" },
    { id: "session_timing", label: "Waited for key session window / 7H profile alignment" },
    { id: "purge_confirmation", label: "Waited for liquidity sweep + displacement before entry" },
    { id: "risk_respected", label: "Sized position properly & respected hard stop loss" },
    { id: "no_fomo_revenge", label: "Zero impulse, FOMO, or revenge executions" },
  ],
  week: [
    { id: "wk_econ_calendar", label: "Reviewed ForexFactory high-impact USD news & holidays" },
    { id: "wk_htf_dol", label: "Mapped Weekly / Monthly Draw on Liquidity across ES, NQ, Gold, DXY" },
    { id: "wk_smt_levels", label: "Identified key intermarket SMT & Weekly opening range levels" },
    { id: "wk_risk_cap", label: "Defined weekly max drawdown limit & A+ session focus" },
  ],
  month: [
    { id: "mo_macro_review", label: "Audited Monthly candle closures & quarterly dealing ranges" },
    { id: "mo_edge_stats", label: "Reviewed win rate, R-distribution, and playbook expectancy" },
    { id: "mo_mistake_audit", label: "Categorized top execution errors & updated rule filters" },
  ],
  quarter: [
    { id: "q_macro_shift", label: "Evaluated quarterly macro regime & seasonal tendencies" },
    { id: "q_prop_alloc", label: "Reviewed account allocation, payouts, and drawdown buffers" },
    { id: "q_system_refinement", label: "Refined core Playbook criteria based on 90-day sample" },
  ],
  year: [
    { id: "yr_full_audit", label: "Completed full annual performance & tax/payout reconciliation" },
    { id: "yr_edge_evolution", label: "Documented highest-expectancy setups & eliminated low-EV habits" },
    { id: "yr_goals_next", label: "Established capital & process milestones for the upcoming year" },
  ],
};

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
      review_content TEXT DEFAULT '',
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
      review_notion_page_id TEXT,
      review_notion_url TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Safe migrations for existing journal_entries table
  for (const colDef of [
    "review_content TEXT DEFAULT ''",
    "review_notion_page_id TEXT",
    "review_notion_url TEXT",
  ]) {
    try {
      db.exec(`ALTER TABLE journal_entries ADD COLUMN ${colDef}`);
    } catch {}
  }
}

export function getJournalConfig(): JournalConfigData {
  const fallback: JournalConfigData = {
    templates: INITIAL_NOTE_TEMPLATES,
    defaultTemplates: {
      day_prep: "tpl-prep",
      day_review: "tpl-review",
      week_prep: "tpl-weekly-analysis",
      week_review: "tpl-review",
      month_prep: "tpl-weekly-analysis",
      month_review: "tpl-review",
      quarter_prep: "tpl-weekly-analysis",
      quarter_review: "tpl-review",
      year_prep: "tpl-weekly-analysis",
      year_review: "tpl-review",
    },
    checklists: DEFAULT_PERIOD_CHECKLISTS,
  };

  const finalPath = resolveDbPath();
  if (!fs.existsSync(finalPath)) return fallback;

  const db = new Database(finalPath);
  try {
    ensureJournalSchema(db);
    const row = db
      .prepare(`SELECT value FROM settings WHERE key = 'tz_journal_config'`)
      .get() as { value?: string } | undefined;
    if (!row?.value) return fallback;
    const parsed = JSON.parse(row.value);
    return {
      templates: Array.isArray(parsed.templates) ? parsed.templates : fallback.templates,
      defaultTemplates: { ...fallback.defaultTemplates, ...(parsed.defaultTemplates || {}) },
      checklists: { ...fallback.checklists, ...(parsed.checklists || {}) },
    };
  } catch {
    return fallback;
  } finally {
    db.close();
  }
}

export function saveJournalConfig(partial: Partial<JournalConfigData>): JournalConfigData {
  const current = getJournalConfig();
  const next: JournalConfigData = {
    templates: Array.isArray(partial.templates) ? partial.templates : current.templates,
    defaultTemplates: partial.defaultTemplates
      ? { ...current.defaultTemplates, ...partial.defaultTemplates }
      : current.defaultTemplates,
    checklists: partial.checklists
      ? { ...current.checklists, ...partial.checklists }
      : current.checklists,
  };

  const finalPath = resolveDbPath();
  if (!fs.existsSync(finalPath)) return next;

  const db = new Database(finalPath);
  try {
    ensureJournalSchema(db);
    db.prepare(
      `INSERT INTO settings (key, value) VALUES ('tz_journal_config', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).run(JSON.stringify(next));
  } finally {
    db.close();
  }
  return next;
}

export function getDefaultTemplateHtml(
  periodType: PeriodKey,
  tab: "prep" | "review",
  config?: JournalConfigData
): string {
  const cfg = config || getJournalConfig();
  const tplId = cfg.defaultTemplates[`${periodType}_${tab}`];
  if (!tplId || tplId === "none") return "";
  const found = cfg.templates.find((t) => t.id === tplId);
  return found?.html || "";
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
  startDate: string;
  endDate: string;
  anchorDate: string;
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
    const mKey = slug.replace("month-", "");
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
    const qKey = slug.replace("quarter-", "");
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
  const cfg = getJournalConfig();

  const periodTrades = allTrades.filter((t) => {
    const d = t.openedAt.slice(0, 10);
    return d >= range.startDate && d <= range.endDate;
  });

  const defaultPrepHtml = getDefaultTemplateHtml(range.periodType, "prep", cfg);
  const defaultReviewHtml = getDefaultTemplateHtml(range.periodType, "review", cfg);

  if (!fs.existsSync(finalPath)) {
    return {
      entry: {
        slug,
        periodType: range.periodType,
        title: range.defaultTitle,
        content: defaultPrepHtml,
        reviewContent: defaultReviewHtml,
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
        reviewNotionPageId: null,
        reviewNotionUrl: null,
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

    if (!row) {
      // Auto-initialize local row with configured default templates
      const created = await saveJournalEntry(slug, {
        title: range.defaultTitle,
        content: defaultPrepHtml,
        reviewContent: defaultReviewHtml,
      });
      return {
        entry: created,
        trades: periodTrades,
        range,
      };
    }

    const entry: JournalEntryRecord = {
      slug: row.slug,
      periodType: row.period_type,
      title: row.title,
      content: row.content || defaultPrepHtml,
      reviewContent: row.review_content || defaultReviewHtml,
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
      reviewNotionPageId: row.review_notion_page_id ?? null,
      reviewNotionUrl: row.review_notion_url ?? null,
      updatedAt: row.updated_at,
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
      reviewContent: payload.reviewContent ?? existing?.review_content ?? "",
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
      reviewNotionPageId:
        payload.reviewNotionPageId !== undefined
          ? payload.reviewNotionPageId
          : existing?.review_notion_page_id ?? null,
      reviewNotionUrl:
        payload.reviewNotionUrl !== undefined
          ? payload.reviewNotionUrl
          : existing?.review_notion_url ?? null,
      updatedAt: nowIso,
    };

    db.prepare(
      `INSERT INTO journal_entries (
        slug, period_type, title, content, review_content, market_bias, day_profile,
        key_levels, lessons_learned, checklist_json, scores_json,
        tags_json, rating, notion_page_id, notion_url, review_notion_page_id, review_notion_url, updated_at
      ) VALUES (
        @slug, @periodType, @title, @content, @reviewContent, @marketBias, @dayProfile,
        @keyLevels, @lessonsLearned, @checklistJson, @scoresJson,
        @tagsJson, @rating, @notionPageId, @notionUrl, @reviewNotionPageId, @reviewNotionUrl, @updatedAt
      )
      ON CONFLICT(slug) DO UPDATE SET
        title = excluded.title,
        content = excluded.content,
        review_content = excluded.review_content,
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
        review_notion_page_id = COALESCE(excluded.review_notion_page_id, journal_entries.review_notion_page_id),
        review_notion_url = COALESCE(excluded.review_notion_url, journal_entries.review_notion_url),
        updated_at = excluded.updated_at`
    ).run(updated);

    return updated;
  } finally {
    db.close();
  }
}

function getMondayStr(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  const day = d.getUTCDay();
  const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
  const mon = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), diff));
  return mon.toISOString().slice(0, 10);
}

export async function ensureNotionJournalPageExists(
  slug: string,
  tab: "prep" | "review",
  entry: JournalEntryRecord,
  range: ReturnType<typeof parseSlugRange>
): Promise<{ pageId: string | null; pageUrl: string | null }> {
  const { token, databaseId } = getNotionConfig(range.periodType);
  if (!token || !databaseId) return { pageId: null, pageUrl: null };

  const isReview = tab === "review";
  const existingId = isReview ? entry.reviewNotionPageId : entry.notionPageId;
  const existingUrl = isReview ? entry.reviewNotionUrl : entry.notionUrl;
  if (existingId) return { pageId: existingId, pageUrl: existingUrl };

  const targetSlug = isReview ? `${slug}-review` : slug;
  const targetTitle = isReview
    ? `${ (entry.title || range.defaultTitle).replace("Journal", "Review") }`
    : entry.title || range.defaultTitle;
  const categoryLabel = isReview
    ? `${range.periodType.toUpperCase()} REVIEW`
    : range.periodType.toUpperCase();

  try {
    const found = await findNotionPageInDb(databaseId, token, targetSlug, targetTitle);
    if (found.page?.id) {
      const pid = found.page.id;
      const purl = found.page.url;
      await saveJournalEntry(
        slug,
        isReview
          ? { reviewNotionPageId: pid, reviewNotionUrl: purl }
          : { notionPageId: pid, notionUrl: purl }
      );
      return { pageId: pid, pageUrl: purl };
    }

    const availableProps = found.availableProps || {};
    const titlePropName = found.titleProp || "Name";

    const properties: Record<string, any> = {
      [titlePropName]: {
        title: [{ text: { content: targetTitle } }],
      },
    };

    if ("Slug" in availableProps && availableProps["Slug"].type === "rich_text") {
      properties["Slug"] = { rich_text: [{ text: { content: targetSlug } }] };
    }
    if ("Period" in availableProps && availableProps["Period"].type === "select") {
      properties["Period"] = { select: { name: categoryLabel } };
    }
    for (const catKey of ["Category", "Type", "Kind", "Tab"]) {
      if (catKey in availableProps) {
        if (availableProps[catKey].type === "select") {
          properties[catKey] = { select: { name: isReview ? "Review" : "Preparation" } };
        } else if (availableProps[catKey].type === "rich_text") {
          properties[catKey] = {
            rich_text: [{ text: { content: isReview ? "Review" : "Preparation" } }],
          };
        }
      }
    }
    if ("Date" in availableProps && availableProps["Date"].type === "date") {
      properties["Date"] = { date: { start: range.startDate } };
    }
    if ("Open Date" in availableProps && availableProps["Open Date"].type === "date") {
      properties["Open Date"] = { date: { start: range.startDate } };
    }

    const createRes = await fetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        parent: { database_id: databaseId },
        properties,
      }),
    });

    if (!createRes.ok) return { pageId: null, pageUrl: null };
    const createdData = await createRes.json();
    const newPageId = createdData.id;
    const newPageUrl = createdData.url;

    const htmlToPush = isReview ? entry.reviewContent : entry.content;
    if (newPageId && htmlToPush) {
      const blockTree = await editorHtmlToNotionTree(htmlToPush, token);
      if (blockTree.length > 0) {
        await appendBlocksTreeRecursive(newPageId, blockTree, token);
      }
    }

    await saveJournalEntry(
      slug,
      isReview
        ? { reviewNotionPageId: newPageId, reviewNotionUrl: newPageUrl }
        : { notionPageId: newPageId, notionUrl: newPageUrl }
    );

    return { pageId: newPageId, pageUrl: newPageUrl };
  } catch (err) {
    console.warn(`[Notion AutoPopulate] Failed for ${targetSlug}:`, err);
    return { pageId: null, pageUrl: null };
  }
}

let lastAutoPopulateRun = 0;

export async function autoPopulateUpcomingJournals(daysAhead = 5) {
  const nowMs = Date.now();
  // Throttle background auto-populate to once every 15 minutes
  if (nowMs - lastAutoPopulateRun < 15 * 60 * 1000) return;
  lastAutoPopulateRun = nowMs;

  const slugs = new Set<string>();
  const baseDate = new Date();

  for (let i = 0; i <= daysAhead; i++) {
    const d = new Date(baseDate.getTime() + i * 86_400_000);
    const dateStr = d.toISOString().slice(0, 10);
    slugs.add(dateStr);
    slugs.add(`week-${getMondayStr(dateStr)}`);
    slugs.add(`month-${dateStr.slice(0, 7)}`);
    const qNum = Math.floor((parseInt(dateStr.slice(5, 7), 10) - 1) / 3) + 1;
    slugs.add(`quarter-${dateStr.slice(0, 4)}-Q${qNum}`);
    slugs.add(`year-${dateStr.slice(0, 4)}`);
  }

  for (const slug of slugs) {
    try {
      const { entry, range } = await getJournalEntryWithTrades(slug);
      if (!entry.notionPageId) {
        await ensureNotionJournalPageExists(slug, "prep", entry, range);
      }
      if (!entry.reviewNotionPageId) {
        await ensureNotionJournalPageExists(slug, "review", entry, range);
      }
    } catch (err) {
      console.warn(`[AutoPopulate] Skipped ${slug}:`, err);
    }
  }
}
