import { NextRequest, NextResponse } from "next/server";
import Database from "better-sqlite3";
import { parse } from "node-html-parser";
import path from "path";
import fs from "fs";
import {
  loadLocalAiSettings,
  saveLocalAiSettings,
  probeKoboldStatus,
  runKoboldAi,
  abortKoboldGeneration,
} from "@/server/ai";
import { queryTrades } from "@/server/trades-query";

export const dynamic = "force-dynamic";

const activeJobControllers = new Map<string, AbortController>();

let isQueueWorkerActive = false;
let autoStopServerWhenQueueEmpty = false;

export type GoalHorizon = "weekly" | "monthly" | "quarterly" | "yearly";
export type GoalStatus = "on_track" | "slipping" | "breached" | "completed";

export interface CustomAuditScope {
  selectedJournalSlugs?: string[];
  selectedTradeKeys?: string[];
  includeTabs?: "both" | "review_only" | "prep_only";
  thinkingMode?: "fast" | "balanced" | "deep";
  reportStyle?: "auto" | "end_of_period" | "mid_period";
  periodOffset?: number;
  stopServerAfterQueue?: boolean;
  maxOutputTokens?: number;
  customFocusPrompt?: string;
}

export interface GoalStep {
  id: string;
  text: string;
  done: boolean;
}

export interface ReportActionItem {
  id: string;
  text: string;
  horizon: GoalHorizon;
  targetMetric: string;
  done: boolean;
}

// === HIGH-PERFORMANCE SINGLETON WAL DB & IN-MEMORY CACHES ===
let singletonDb: Database.Database | null = null;
let tablesInitialized = false;

// Cache parsed HTML digests per journal (slug -> { updatedAt, prepEval, revEval, prepDigest, revDigest })
const journalDigestCache = new Map<string, any>();

// Cache computed default monthly telemetry keyed by SQLite PRAGMA data_version (0% stale across all tabs!)
let cachedDefaultTelemetry: { dbVersionKey: string; ts: number; data: any } | null = null;

function getSqliteStateSignature(db: Database.Database): string {
  try {
    const dv = db.pragma("data_version", { simple: true });
    const jMax = (
      db.prepare(`SELECT MAX(updated_at) as m, COUNT(*) as c FROM journal_entries`).get() as any
    );
    const gMax = (
      db.prepare(`SELECT MAX(updated_at) as m, COUNT(*) as c FROM trader_goals`).get() as any
    );
    return `${dv}:${jMax?.c || 0}:${jMax?.m || ""}:${gMax?.c || 0}:${gMax?.m || ""}`;
  } catch {
    return String(Date.now());
  }
}

// Cache KoboldCpp status probe for 10s so busy GPU never blocks GET requests
let cachedKoboldProbe: { ts: number; baseUrl: string; status: any } | null = null;

// Live in-memory stream state so 2s polling reads from RAM (0 disk I/O!)
const liveStreamMemory = new Map<
  string,
  { reportId?: string; sessionId?: string; title?: string; partialText: string; partialReasoning: string; lastDbWriteMs: number }
>();

function invalidateCoachCaches() {
  cachedDefaultTelemetry = null;
}

async function probeKoboldStatusCached(baseUrl: string, force = false) {
  const now = Date.now();
  if (!force && cachedKoboldProbe && cachedKoboldProbe.baseUrl === baseUrl && now - cachedKoboldProbe.ts < 10_000) {
    return cachedKoboldProbe.status;
  }
  // If a background generation job is actively streaming right now, we already know KoboldCpp is online!
  if (!force && activeJobControllers.size > 0 && cachedKoboldProbe) {
    return { ...cachedKoboldProbe.status, online: true };
  }
  const status = await probeKoboldStatus(baseUrl);
  cachedKoboldProbe = { ts: now, baseUrl, status };
  return status;
}

function resolveDbPath(): string {
  const p1 = path.resolve(process.cwd(), "data", "journal.db");
  const p2 = path.resolve(process.cwd(), "apps", "web", "data", "journal.db");
  return fs.existsSync(p1) ? p1 : p2;
}

function getCoachDb(): Database.Database {
  if (singletonDb) return singletonDb;
  const dbPath = resolveDbPath();
  const db = new Database(dbPath);
  try {
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    db.pragma("busy_timeout = 5000");
    db.pragma("temp_store = MEMORY");
    db.pragma("cache_size = -32000");
  } catch {}
  // Stub .close() as a no-op so legacy finally { db.close() } blocks never close the shared singleton connection
  (db as any).close = () => {};
  singletonDb = db;
  ensureCoachTables(db);
  return db;
}

function ensureCoachTables(db: Database.Database) {
  if (tablesInitialized) return;
  tablesInitialized = true;
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_coach_reports (
      id TEXT PRIMARY KEY,
      horizon TEXT NOT NULL,
      period_key TEXT NOT NULL,
      title TEXT NOT NULL,
      summary_md TEXT NOT NULL,
      reasoning_trace TEXT,
      telemetry_json TEXT,
      suggested_goals_json TEXT,
      accountability_json TEXT,
      action_items_json TEXT DEFAULT '[]',
      model_used TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS trader_goals (
      id TEXT PRIMARY KEY,
      horizon TEXT NOT NULL,
      period_label TEXT NOT NULL,
      title TEXT NOT NULL,
      why_it_matters TEXT,
      target_metric TEXT,
      status TEXT NOT NULL,
      progress_pct INTEGER DEFAULT 0,
      steps_json TEXT DEFAULT '[]',
      ai_accountability_note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ai_chat_sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      report_id TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ai_chat_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      reasoning TEXT,
      model_used TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ai_background_jobs (
      id TEXT PRIMARY KEY,
      job_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      label TEXT NOT NULL,
      status TEXT NOT NULL,
      error_text TEXT,
      result_json TEXT,
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  try {
    db.exec(`ALTER TABLE ai_coach_reports ADD COLUMN action_items_json TEXT DEFAULT '[]'`);
  } catch {}
  try {
    db.exec(`ALTER TABLE trader_goals ADD COLUMN steps_json TEXT DEFAULT '[]'`);
  } catch {}
  try {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_ai_reports_created ON ai_coach_reports(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_ai_reports_horizon_created ON ai_coach_reports(horizon, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_ai_reports_period_key ON ai_coach_reports(period_key);
      CREATE INDEX IF NOT EXISTS idx_ai_jobs_status_started ON ai_background_jobs(status, started_at ASC);
      CREATE INDEX IF NOT EXISTS idx_ai_sessions_report_id ON ai_chat_sessions(report_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_ai_messages_session_created ON ai_chat_messages(session_id, created_at ASC);
      CREATE INDEX IF NOT EXISTS idx_trader_goals_status_updated ON trader_goals(status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_journal_entries_period_slug ON journal_entries(period_type, slug DESC);
      CREATE INDEX IF NOT EXISTS idx_journal_entries_updated ON journal_entries(updated_at DESC);
    `);
  } catch {}

  // Also index core trade/routine tables on the tablet DB if present (wrapped in individual try/catch)
  for (const idxSql of [
    `CREATE INDEX IF NOT EXISTS idx_trades_opened_at ON trades(opened_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_trades_symbol_opened ON trades(symbol, opened_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_missed_trades_observed ON missed_trades(observed_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_routine_checks_date ON routine_checks(date DESC, rule_id)`,
  ]) {
    try {
      db.exec(idxSql);
    } catch {}
  }

  // One-time automatic repair of existing reports on the Tablet's live SQLite DB:
  // 1) Strips any unclosed ```json blocks from summary_md
  // 2) Removes accidentally scraped diagnostic bullets ending in ',' or starting with '*'
  // 3) Recomputes periodComparisonBuckets on older reports so Monthly Audit #2 shows exact Calendar Months!
  try {
    const existingReps = db
      .prepare(`SELECT id, horizon, summary_md, action_items_json, telemetry_json FROM ai_coach_reports`)
      .all() as any[];
    const builtMonthly = buildCalendarPeriodBuckets(
      (queryTrades({}).trades || []).map((t: any) => ({
        ...t,
        opened_at: t.openedAt || "",
        closed_at: t.closedAt || t.openedAt || "",
        net_pnl: Number(t.netPnl || 0),
        quantity: Number(t.quantity || 1),
        realized_r: t.realizedR ?? null,
      })),
      "monthly",
      new Date(),
      Number(loadLocalAiSettings().baselineRiskPct || 1.0)
    );

    for (const r of existingReps) {
      let needsUpdate = false;
      let cleanMd = String(r.summary_md || "");
      const strippedMd = stripTrailingJsonBlock(cleanMd);
      if (strippedMd !== cleanMd) {
        cleanMd = strippedMd;
        needsUpdate = true;
      }

      let acts: any[] = [];
      try {
        acts = JSON.parse(r.action_items_json || "[]");
      } catch {}
      const filteredActs = acts.filter((it: any) => {
        const txt = String(it?.text || "").trim();
        return (
          txt.length > 15 &&
          !txt.endsWith(",") &&
          !txt.startsWith("*") &&
          !/^(win rate collapsed|oversized trades appeared|a \d+-trade same-day|the journal's own language|the infrastructure exists)/i.test(txt)
        );
      });
      if (filteredActs.length !== acts.length) {
        acts = filteredActs;
        needsUpdate = true;
      }

      let telObj: any = {};
      try {
        telObj = JSON.parse(r.telemetry_json || "{}");
      } catch {}
      // Strip heavy prompt-only markdown strings from stored telemetry_json to shrink DB payload by 75%
      if (telObj.verifiedTradesLedgerMd || telObj.verifiedPeriodTableMd || telObj.journalCompletionMatrixMd) {
        delete telObj.verifiedTradesLedgerMd;
        delete telObj.verifiedPeriodTableMd;
        delete telObj.verifiedPlaybookTableMd;
        delete telObj.journalCompletionMatrixMd;
        needsUpdate = true;
      }
      // If an older monthly report had rolling 30-day buckets ("Target Monthly (Current)"), upgrade it to exact calendar months
      if (
        r.horizon === "monthly" &&
        Array.isArray(telObj.periodComparisonBuckets) &&
        telObj.periodComparisonBuckets[0]?.periodLabel?.includes("Target Monthly")
      ) {
        telObj.periodComparisonBuckets = builtMonthly;
        needsUpdate = true;
      }

      if (needsUpdate) {
        db.prepare(
          `UPDATE ai_coach_reports SET summary_md = ?, action_items_json = ?, telemetry_json = ? WHERE id = ?`
        ).run(cleanMd, JSON.stringify(acts), JSON.stringify(telObj), r.id);
      }
    }
  } catch {}
}

function stripTrailingJsonBlock(md: string): string {
  if (!md) return "";
  let cleaned = md.replace(/```json[\s\S]*$/i, "").trimEnd();
  cleaned = cleaned.replace(/\{\s*"goalAudits"\s*:[\s\S]*$/i, "").trimEnd();
  return cleaned;
}

const TEMPLATE_BOILERPLATE_PATTERNS = [
  /empty quote/gi,
  /summarize system adherence,?\s*a\+ setups captured,?\s*and key lessons\.?/gi,
  /did i trade the plan or my impulses\??/gi,
  /what assumption held true or failed\??/gi,
  /what worked well and what needs adjustment\??/gi,
  /pre-session checklist|post-session review|alignment check|actionable adjustments|psychology & mindset|market narrative|htf bias|key levels|session plan/gi,
  /write your reflection here\.{0,3}/gi,
  /no notes recorded\.?/gi,
  /\bn\/a\b|\bnone\b|\btbd\b/gi,
];

function evaluateSubstantiveJournalHtml(html: string): {
  isSubstantive: boolean;
  userCharCount: number;
} {
  if (!html || !html.trim()) return { isSubstantive: false, userCharCount: 0 };
  try {
    const root = parse(html);
    root
      .querySelectorAll("style, script, img, svg, button, h1, h2, h3, h4, th, .tz-banner, .tz-toggle-title")
      .forEach((el) => el.remove());

    let text = (root.text || "").replace(/\s+/g, " ").trim();
    for (const pat of TEMPLATE_BOILERPLATE_PATTERNS) {
      text = text.replace(pat, " ");
    }
    const alphaNum = text.replace(/[^a-zA-Z0-9]+/g, "");
    return {
      isSubstantive: alphaNum.length >= 25,
      userCharCount: alphaNum.length,
    };
  } catch {
    return { isSubstantive: false, userCharCount: 0 };
  }
}

function htmlToStructuredDigest(html: string): {
  qaReflections: Array<{ question: string; answer: string }>;
  cleanText: string;
} {
  if (!html || !html.trim()) {
    return { qaReflections: [], cleanText: "" };
  }
  try {
    const root = parse(html);
    const qa: Array<{ question: string; answer: string }> = [];

    root.querySelectorAll(".tz-quote, blockquote, .tz-callout").forEach((el) => {
      const qText = el.text.replace(/\s+/g, " ").trim();
      if (qText && !/empty quote/i.test(qText)) {
        qa.push({ question: "Self-Reflection / Quote", answer: qText });
      }
    });

    root.querySelectorAll("p, div, li").forEach((el) => {
      const strong = el.querySelector("strong, b");
      if (strong) {
        const q = strong.text.trim();
        const full = el.text.trim();
        const a = full.replace(q, "").trim();
        if (q.endsWith("?") && a && !/^(n\/a|none|tbd)$/i.test(a)) {
          qa.push({ question: q, answer: a });
        }
      }
    });

    root.querySelectorAll("script, style, svg, img").forEach((el) => el.remove());
    const cleanText = root.text.replace(/\s+/g, " ").trim();

    return { qaReflections: qa, cleanText };
  } catch {
    return {
      qaReflections: [],
      cleanText: html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
    };
  }
}

function getControlDaemonUrl(baseUrl?: string): string {
  try {
    if (!baseUrl) return "http://127.0.0.1:5002";
    const u = new URL(baseUrl);
    return `${u.protocol}//${u.hostname}:5002`;
  } catch {
    return "http://127.0.0.1:5002";
  }
}

async function stopKoboldServerAfterQueue() {
  try {
    const settings = loadLocalAiSettings();
    const daemonUrl = getControlDaemonUrl(settings.baseUrl);
    await fetch(daemonUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "stop" }),
      signal: AbortSignal.timeout(5000),
    });
    console.log("[AI Queue] All queued audits completed. Stopped KoboldCpp server so PC can sleep.");
  } catch (e) {
    console.error("[AI Queue] Failed to auto-stop KoboldCpp daemon:", e);
  }
}

function getIsoWeekKey(d: Date): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function getPeriodTimingContext(
  horizon: GoalHorizon,
  now: Date,
  customScope?: CustomAuditScope,
  targetBucket?: any
): {
  isMidPeriod: boolean;
  timingTag: string;
  basePeriodKey: string;
  timingInstruction: string;
} {
  const style = customScope?.reportStyle || "auto";
  const offset = Number(customScope?.periodOffset || 0);
  const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon ... 6=Sat
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const monthInQuarter = now.getMonth() % 3;

  const bucketKey = targetBucket?.periodKey || "";
  const bucketRange = targetBucket?.dateRange || "";

  if (horizon === "weekly") {
    const autoIsEnd =
      offset > 0 || dayOfWeek === 0 || dayOfWeek === 6 || dayOfWeek === 5 || (dayOfWeek <= 2 && targetBucket?.isPreviousPeriodAutoAnchored);
    const isEnd = style === "end_of_period" ? true : style === "mid_period" ? false : autoIsEnd;
    const wkKey = bucketKey || getIsoWeekKey(now);
    return {
      isMidPeriod: !isEnd,
      timingTag: isEnd ? "End-of-Week Audit" : "Mid-Week Check-In",
      basePeriodKey: wkKey,
      timingInstruction: isEnd
        ? `This is an END-OF-WEEK FINAL AUDIT for ${wkKey} (${bucketRange}). Evaluate the completed week's execution and self-reflection completeness against the prior 3 weeks (W-1, W-2, W-3) and set concrete rules for the upcoming week.`
        : `This is a MID-WEEK PROGRESS CHECK-IN for ${wkKey} (${bucketRange}). Evaluate week-to-date execution and mindset against the prior 3 weeks, call out early behavioral tells or hesitation, and provide immediate tactical adjustments for the remaining sessions of this week.`,
    };
  }

  if (horizon === "monthly") {
    const autoIsEnd =
      offset > 0 || dayOfMonth >= daysInMonth - 3 || dayOfMonth <= 5;
    const isEnd = style === "end_of_period" ? true : style === "mid_period" ? false : autoIsEnd;
    const mKey = bucketKey || now.toISOString().slice(0, 7);
    return {
      isMidPeriod: !isEnd,
      timingTag: isEnd ? "End-of-Month Audit" : `Mid-Month Check-In`,
      basePeriodKey: mKey,
      timingInstruction: isEnd
        ? `This is an END-OF-MONTH FINAL AUDIT for ${mKey} (${bucketRange}). Compare the target month against the prior 3 calendar months (M-1, M-2, M-3), audit habit consolidation, and establish next month's behavioral protocol.`
        : `This is a MID-MONTH PROGRESS CHECK-IN for ${mKey} (${bucketRange}). Evaluate month-to-date trajectory against the prior 3 months and provide mid-course corrections for the remainder of the month.`,
    };
  }

  if (horizon === "quarterly") {
    const autoIsEnd = offset > 0 || (monthInQuarter === 2 && dayOfMonth >= daysInMonth - 5);
    const isEnd = style === "end_of_period" ? true : style === "mid_period" ? false : autoIsEnd;
    const qNum = Math.floor(now.getMonth() / 3) + 1;
    const qKey = bucketKey || `${now.getFullYear()}-Q${qNum}`;
    return {
      isMidPeriod: !isEnd,
      timingTag: isEnd ? "End-of-Quarter Audit" : "Mid-Quarter Progress Pulse",
      basePeriodKey: qKey,
      timingInstruction: `This is a ${isEnd ? "END-OF-QUARTER FINAL SYNTHESIS" : "MID-QUARTER PROGRESS PULSE"} for ${qKey} (${bucketRange}). Compare ${qKey} against the prior 3 quarters, synthesizing long-term psychological evolution, drawdown discipline, and accountability infrastructure.`,
    };
  }

  const yKey = bucketKey || `${now.getFullYear()}`;
  const isEndYear = style === "end_of_period" || offset > 0;
  return {
    isMidPeriod: !isEndYear,
    timingTag: isEndYear ? "End-of-Year Audit" : "Annual Evolution Check-In",
    basePeriodKey: yKey,
    timingInstruction: `This is an ${isEndYear ? "END-OF-YEAR FINAL AUDIT" : "ANNUAL EVOLUTION CHECK-IN"} for ${yKey} (${bucketRange}). Compare ${yKey} against prior years and synthesize macro edge maturity.`,
  };
}

function computeMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

// Compute Implied Capital Risked ($) on a trade:
// 1. If realized_r is present, Risk $ = |net_pnl / realized_r|
// 2. If losing trade (net_pnl < 0), Risk $ = |net_pnl|
// 3. If winning trade without realized_r, use symbol's calibrated risk-per-lot * quantity (so winners are NEVER dropped from risk tiers!)
function estimateTradeCapitalRiskedUsd(
  t: any,
  symbolRiskPerUnitMap?: Record<string, number>,
  fallback1RUsd?: number
): number {
  const netPnl = Number(t.net_pnl || 0);
  const rMult = Number(t.realized_r);
  if (Number.isFinite(rMult) && Math.abs(rMult) >= 0.15 && Math.abs(netPnl) > 0) {
    return Math.round(Math.abs(netPnl / rMult) * 100) / 100;
  }
  if (netPnl < 0) {
    return Math.round(Math.abs(netPnl) * 100) / 100;
  }
  const qty = Math.abs(Number(t.quantity || 0));
  const symRate = symbolRiskPerUnitMap?.[t.symbol];
  if (qty > 0 && symRate && symRate > 0) {
    return Math.round(qty * symRate * 100) / 100;
  }
  return fallback1RUsd || 500;
}

function summarizeBucketMetrics(bucketTrades: any[], targetRiskPct: number) {
  const count = bucketTrades.length;
  if (count === 0) {
    return {
      trades: 0,
      wins: 0,
      losses: 0,
      netPnl: 0,
      netAcctPct: 0,
      winRatePct: 0,
      avgAccountRiskPct: 0,
      halfRiskTradesCount: 0,
      standardRiskTradesCount: 0,
      oversizedRiskTradesCount: 0,
      revengeCount: 0,
    };
  }
  let wins = 0;
  let losses = 0;
  let netPnl = 0;
  let netAcctPct = 0;
  let halfRiskTradesCount = 0;
  let standardRiskTradesCount = 0;
  let oversizedRiskTradesCount = 0;
  let revengeCount = 0;
  const riskPcts: number[] = [];

  for (let i = 0; i < bucketTrades.length; i++) {
    const t = bucketTrades[i];
    const pnl = Number(t.net_pnl || 0);
    netPnl += pnl;
    if (t.accountPnlPct !== null && t.accountPnlPct !== undefined) {
      netAcctPct += Number(t.accountPnlPct);
    }
    if (pnl > 0) wins += 1;
    else if (pnl < 0) losses += 1;

    const rPct = Number(t.accountRiskPct ?? targetRiskPct);
    riskPcts.push(rPct);

    // Every single trade is classified into exactly ONE tier so Half + Standard + Oversized === Total Trades!
    if (rPct < targetRiskPct * 0.72) {
      halfRiskTradesCount += 1;
    } else if (rPct > targetRiskPct * 1.30) {
      oversizedRiskTradesCount += 1;
    } else {
      standardRiskTradesCount += 1;
    }

    if (i > 0) {
      const prev = bucketTrades[i - 1];
      const prevPnl = Number(prev.net_pnl || 0);
      const mins =
        (new Date(t.opened_at).getTime() - new Date(prev.closed_at || prev.opened_at).getTime()) /
        60_000;
      if (prevPnl < 0 && mins >= 0 && mins <= 20) revengeCount += 1;
    }
  }

  const avgAccountRiskPct =
    riskPcts.length > 0
      ? Math.round((riskPcts.reduce((a, b) => a + b, 0) / riskPcts.length) * 100) / 100
      : 0;

  return {
    trades: count,
    wins,
    losses,
    netPnl: Math.round(netPnl * 100) / 100,
    netAcctPct: Math.round(netAcctPct * 100) / 100,
    winRatePct: Math.round((wins / count) * 1000) / 10,
    avgAccountRiskPct,
    halfRiskTradesCount,
    standardRiskTradesCount,
    oversizedRiskTradesCount,
    revengeCount,
  };
}

function computeAuditDueStatus(db: Database.Database) {
  const now = new Date();
  const getLatest = (hz: string) =>
    db
      .prepare(`SELECT id, title, created_at FROM ai_coach_reports WHERE horizon = ? ORDER BY created_at DESC LIMIT 1`)
      .get(hz) as { id: string; title: string; created_at: string } | undefined;

  const wLast = getLatest("weekly");
  const mLast = getLatest("monthly");
  const qLast = getLatest("quarterly");

  const daysSince = (iso?: string) =>
    iso ? Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000) : 999;

  const wDays = daysSince(wLast?.created_at);
  const mDays = daysSince(mLast?.created_at);
  const qDays = daysSince(qLast?.created_at);

  return {
    weekly: {
      due: wDays >= 7,
      daysSinceLast: wLast ? wDays : null,
      lastRunAt: wLast?.created_at || null,
      reason: !wLast
        ? "No Weekly Audit run yet"
        : wDays >= 7
        ? `Last Weekly Audit was ${wDays} days ago`
        : `Up to date (${wDays}d ago)`,
    },
    monthly: {
      due: mDays >= 28,
      daysSinceLast: mLast ? mDays : null,
      lastRunAt: mLast?.created_at || null,
      reason: !mLast
        ? "No Monthly Audit run yet"
        : mDays >= 28
        ? `Last Monthly Audit was ${mDays} days ago`
        : `Up to date (${mDays}d ago)`,
    },
    quarterly: {
      due: qDays >= 85,
      daysSinceLast: qLast ? qDays : null,
      lastRunAt: qLast?.created_at || null,
      reason: !qLast
        ? "No Quarterly Audit run yet"
        : qDays >= 85
        ? `Last Quarterly Audit was ${qDays} days ago`
        : `Up to date (${qDays}d ago)`,
    },
  };
}

// Build True Calendar Period Buckets (Supports Period Offset + Smart Monday/Early-Month Rollback!)
function buildCalendarPeriodBuckets(
  allTrades: any[],
  horizon: GoalHorizon,
  now: Date,
  targetRiskPct: number,
  customScope?: CustomAuditScope
) {
  const buckets: Array<any> = [];
  const explicitOffset =
    customScope?.periodOffset !== undefined && customScope?.periodOffset !== null
      ? Math.max(0, Number(customScope.periodOffset))
      : null;
  const style = customScope?.reportStyle || "auto";

  if (horizon === "monthly") {
    const curMonthPrefix = now.toISOString().slice(0, 7);
    const curMonthHasTrades = allTrades.some((t) => String(t.opened_at).startsWith(curMonthPrefix));
    const autoOffset =
      style !== "mid_period" && !curMonthHasTrades && now.getDate() <= 7 ? 1 : 0;
    const anchorOffset = explicitOffset !== null ? explicitOffset : autoOffset;

    for (let p = 0; p < 4; p++) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - anchorOffset - p, 1));
      const ym = d.toISOString().slice(0, 7);
      const monthName = d.toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
      const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
      const startIso = `${ym}-01`;
      const endIso = `${ym}-${String(lastDay).padStart(2, "0")}`;

      const bucketTrades = allTrades.filter((t) => String(t.opened_at).slice(0, 7) === ym);
      buckets.push({
        periodKey: ym,
        periodLabel: p === 0 ? `${monthName} (Target)` : `${monthName} (M-${p})`,
        dateRange: `${startIso} to ${endIso}`,
        isPreviousPeriodAutoAnchored: anchorOffset > 0,
        ...summarizeBucketMetrics(bucketTrades, targetRiskPct),
      });
    }
    return buckets;
  }

  if (horizon === "quarterly") {
    const curQ = Math.floor(now.getUTCMonth() / 3);
    const curYear = now.getUTCFullYear();
    const anchorOffset = explicitOffset !== null ? explicitOffset : 0;
    for (let p = 0; p < 4; p++) {
      const totalQ = curYear * 4 + curQ - anchorOffset - p;
      const y = Math.floor(totalQ / 4);
      const q = ((totalQ % 4) + 4) % 4 + 1;
      const startMonth = (q - 1) * 3 + 1;
      const endMonth = q * 3;
      const lastDay = new Date(Date.UTC(y, endMonth, 0)).getUTCDate();
      const startIso = `${y}-${String(startMonth).padStart(2, "0")}-01`;
      const endIso = `${y}-${String(endMonth).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
      const bucketTrades = allTrades.filter((t) => {
        const dStr = String(t.opened_at).slice(0, 10);
        return dStr >= startIso && dStr <= endIso;
      });
      buckets.push({
        periodKey: `${y}-Q${q}`,
        periodLabel: p === 0 ? `${y} Q${q} (Target)` : `${y} Q${q} (Q-${p})`,
        dateRange: `${startIso} to ${endIso}`,
        isPreviousPeriodAutoAnchored: anchorOffset > 0,
        ...summarizeBucketMetrics(bucketTrades, targetRiskPct),
      });
    }
    return buckets;
  }

  if (horizon === "yearly") {
    const curYear = now.getUTCFullYear();
    const anchorOffset = explicitOffset !== null ? explicitOffset : 0;
    for (let p = 0; p < 3; p++) {
      const y = curYear - anchorOffset - p;
      const startIso = `${y}-01-01`;
      const endIso = `${y}-12-31`;
      const bucketTrades = allTrades.filter((t) => String(t.opened_at).startsWith(`${y}-`));
      buckets.push({
        periodKey: `${y}`,
        periodLabel: p === 0 ? `${y} (Target Year)` : `${y} (Y-${p})`,
        dateRange: `${startIso} to ${endIso}`,
        isPreviousPeriodAutoAnchored: anchorOffset > 0,
        ...summarizeBucketMetrics(bucketTrades, targetRiskPct),
      });
    }
    return buckets;
  }

  // Weekly: Exact Monday-to-Sunday ISO Weeks
  // If user clicks on Monday or Tuesday (dayOfWeek <= 2) and current week has 0 trades (or if style === "end_of_period" early in week),
  // automatically shift Target Week (p=0) to Last Completed Week (offset = 1) so missed Sunday reviews work seamlessly on Monday!
  const dayOfWeek = now.getUTCDay() || 7; // 1=Mon ... 7=Sun
  const currentMonday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - dayOfWeek + 1)
  );
  const curMonIso = currentMonday.toISOString().slice(0, 10);
  const curWeekHasTrades = allTrades.some((t) => String(t.opened_at).slice(0, 10) >= curMonIso);

  const autoWeekOffset =
    style === "mid_period"
      ? 0
      : style === "end_of_period" && dayOfWeek <= 4 && !curWeekHasTrades
      ? 1
      : !curWeekHasTrades && dayOfWeek <= 2
      ? 1
      : 0;
  const weekOffset = explicitOffset !== null ? explicitOffset : autoWeekOffset;

  for (let p = 0; p < 4; p++) {
    const mon = new Date(currentMonday.getTime() - (p + weekOffset) * 7 * 86_400_000);
    const sun = new Date(mon.getTime() + 6 * 86_400_000);
    const startIso = mon.toISOString().slice(0, 10);
    const endIso = sun.toISOString().slice(0, 10);
    const wkKey = getIsoWeekKey(mon);
    const bucketTrades = allTrades.filter((t) => {
      const d = String(t.opened_at).slice(0, 10);
      return d >= startIso && d <= endIso;
    });
    buckets.push({
      periodKey: wkKey,
      periodLabel: p === 0 ? `${wkKey} (Target Week)` : `${wkKey} (W-${p})`,
      dateRange: `${startIso} to ${endIso}`,
      isPreviousPeriodAutoAnchored: weekOffset > 0,
      ...summarizeBucketMetrics(bucketTrades, targetRiskPct),
    });
  }
  return buckets;
}

function buildBehavioralTelemetryAndJournals(
  db: Database.Database,
  horizon: GoalHorizon,
  customScope?: CustomAuditScope
) {
  const now = new Date();
  const settings = loadLocalAiSettings();
  const targetRiskPct = Number(settings.baselineRiskPct || 1.0);

  let allTrades: any[] = [];
  try {
    const qRes = queryTrades({});
    allTrades = (qRes.trades || []).map((t: any) => {
      const dayStr = String(t.openedAt || "").slice(0, 10);
      const tradeUrl = `/trades?symbol=${encodeURIComponent(t.symbol)}&from=${dayStr}&to=${dayStr}`;
      return {
        key: t.key,
        symbol: t.symbol,
        direction: t.direction,
        opened_at: t.openedAt || "",
        closed_at: t.closedAt || t.openedAt || "",
        quantity: Number(t.quantity || 1),
        net_pnl: Number(t.netPnl || 0),
        gross_pnl: Number(t.grossPnl ?? t.netPnl ?? 0),
        realized_r: t.realizedR ?? null,
        notes: t.notes || "",
        tags: t.annotations?.tags || [],
        mistakes: t.annotations?.mistakes || [],
        playbook: t.annotations?.playbook || "",
        rating: t.annotations?.rating ?? null,
        tradeUrl,
      };
    });
  } catch {}

  allTrades.sort((a, b) => String(a.opened_at).localeCompare(String(b.opened_at)));

  // Calibrate per-symbol Dollar Risk per 1.0 unit/lot from losing trades so winning trades without realized_r get accurate risk tiers!
  const symbolRiskRates: Record<string, number[]> = {};
  const lossRisksUsd: number[] = [];
  for (const t of allTrades) {
    const pnl = Number(t.net_pnl || 0);
    const qty = Math.abs(Number(t.quantity || 0));
    if (pnl < 0 && qty > 0) {
      const lossUsd = Math.abs(pnl);
      lossRisksUsd.push(lossUsd);
      symbolRiskRates[t.symbol] = symbolRiskRates[t.symbol] || [];
      symbolRiskRates[t.symbol]!.push(lossUsd / qty);
    }
  }
  const symbolRiskPerUnitMap: Record<string, number> = {};
  for (const [sym, rates] of Object.entries(symbolRiskRates)) {
    symbolRiskPerUnitMap[sym] = computeMedian(rates);
  }

  // Standard 1R Dollar Unit (use 75th percentile of loss magnitudes or $1,000 if losses cluster at 0.5% and 1.0%)
  const maxLossUsd = lossRisksUsd.length > 0 ? Math.max(...lossRisksUsd) : 1000;
  const medianLossUsd = computeMedian(lossRisksUsd) || 500;
  const inferredFull1RUsd = maxLossUsd >= medianLossUsd * 1.6 ? Math.round(maxLossUsd) : Math.round(medianLossUsd);

  let initialAccountBalance = Number(settings.accountBalanceOverride || 0);
  if (initialAccountBalance <= 0) {
    try {
      const accRows = db.prepare(`SELECT initial_balance FROM accounts`).all() as any[];
      const sumInit = accRows.reduce((acc, r) => acc + Number(r.initial_balance || 0), 0);
      if (sumInit > 0) initialAccountBalance = sumInit;
    } catch {}
  }
  if (initialAccountBalance <= 0) {
    initialAccountBalance = Math.round((inferredFull1RUsd / (targetRiskPct / 100)) / 1000) * 1000 || 100000;
  }

  let runningEquity = initialAccountBalance;
  for (const t of allTrades) {
    const eqBeforeTrade = Math.max(runningEquity, initialAccountBalance * 0.25);
    const capRiskUsd = estimateTradeCapitalRiskedUsd(t, symbolRiskPerUnitMap, inferredFull1RUsd);
    const isExactRisk = Number(t.net_pnl || 0) < 0 || (t.realized_r !== null && t.realized_r !== undefined);
    t.equityAtTrade = Math.round(eqBeforeTrade);
    t.estimated1RUsd = capRiskUsd;
    t.accountRiskPct = Math.round(((capRiskUsd / eqBeforeTrade) * 100) * 100) / 100;
    t.accountPnlPct = Math.round(((Number(t.net_pnl || 0) / eqBeforeTrade) * 100) * 100) / 100;
    t.riskTier =
      t.accountRiskPct < targetRiskPct * 0.72
        ? `Half/Reduced Risk (${t.accountRiskPct}%${isExactRisk ? "" : " est"})`
        : t.accountRiskPct > targetRiskPct * 1.30
        ? `Oversized Risk (${t.accountRiskPct}%${isExactRisk ? "" : " est"})`
        : `Standard Risk (${t.accountRiskPct}%${isExactRisk ? "" : " est"})`;
    runningEquity += Number(t.net_pnl || 0);
  }

  // Build Exact Calendar Comparison Buckets (e.g. Oct 2026, Sep 2026, Aug 2026, Jul 2026)
  const periodComparisonBuckets = buildCalendarPeriodBuckets(allTrades, horizon, now, targetRiskPct, customScope);
  const targetBucket = periodComparisonBuckets[0];
  const oldestBucket = periodComparisonBuckets[periodComparisonBuckets.length - 1];
  const cutoffIso = oldestBucket?.dateRange?.slice(0, 10) || "2026-01-01";

  // Target Period Trades (e.g. strictly Oct 2026's 7 trades for Monthly Audit!) vs 4-Period Window Trades
  const windowTrades =
    customScope?.selectedTradeKeys && customScope.selectedTradeKeys.length > 0
      ? allTrades.filter((t) => customScope.selectedTradeKeys!.includes(t.key))
      : allTrades.filter((t) => String(t.opened_at).slice(0, 10) >= cutoffIso);

  const targetPeriodStart = targetBucket?.dateRange?.slice(0, 10) || cutoffIso;
  const targetPeriodEnd = targetBucket?.dateRange?.slice(-10) || "2099-12-31";
  const targetPeriodTrades =
    customScope?.selectedTradeKeys && customScope.selectedTradeKeys.length > 0
      ? windowTrades
      : allTrades.filter((t) => {
          const d = String(t.opened_at).slice(0, 10);
          return d >= targetPeriodStart && d <= targetPeriodEnd;
        });

  // Use windowTrades for multi-period pattern detection, but clearly separate Target Period stats from 4-Period Window stats!
  const trades = windowTrades;

  let revengeCount = 0;
  let revengePnl = 0;
  let revengeWins = 0;
  let postLossRiskExpansionCount = 0;
  let postWinRiskExpansionCount = 0;
  let intentionalDownsizeCount = 0;
  const mistakeCounts: Record<string, number> = {};
  const tagCounts: Record<string, number> = {};
  const sessionStats: Record<string, { trades: number; pnl: number; wins: number }> = {};
  const dailyMap = new Map<string, { trades: number; pnl: number; peakPnl: number; giveback: number; items: any[] }>();

  for (let i = 0; i < trades.length; i++) {
    const t = trades[i];
    const pnl = Number(t.net_pnl || 0);
    const rPct = t.accountRiskPct;

    if (typeof rPct === "number" && rPct < targetRiskPct * 0.72) {
      intentionalDownsizeCount += 1;
    }

    const dayKey = String(t.opened_at || "").slice(0, 10);
    const dStat = dailyMap.get(dayKey) || { trades: 0, pnl: 0, peakPnl: 0, giveback: 0, items: [] };
    dStat.trades += 1;
    dStat.pnl += pnl;
    dStat.items.push({
      symbol: t.symbol,
      direction: t.direction,
      quantity: t.quantity,
      netPnl: t.net_pnl,
      accountRiskPct: t.accountRiskPct,
      riskTier: t.riskTier,
      tradeUrl: t.tradeUrl,
    });
    if (dStat.pnl > dStat.peakPnl) dStat.peakPnl = dStat.pnl;
    dStat.giveback = Math.max(0, dStat.peakPnl - dStat.pnl);
    dailyMap.set(dayKey, dStat);

    for (const m of Array.isArray(t.mistakes) ? t.mistakes : []) {
      const cleanM = String(m).trim();
      if (cleanM) mistakeCounts[cleanM] = (mistakeCounts[cleanM] || 0) + 1;
    }

    for (const tg of Array.isArray(t.tags) ? t.tags : []) {
      const cleanT = String(tg).trim();
      if (cleanT) tagCounts[cleanT] = (tagCounts[cleanT] || 0) + 1;
    }

    const hr = parseInt(String(t.opened_at || "").slice(11, 13), 10);
    const sess =
      !isNaN(hr) && hr >= 8 && hr < 12
        ? "NY AM (08-12)"
        : !isNaN(hr) && hr >= 12 && hr < 17
        ? "NY PM (12-17)"
        : !isNaN(hr) && hr >= 2 && hr < 8
        ? "London (02-08)"
        : "Asia / Other";
    const sBucket = sessionStats[sess] || { trades: 0, pnl: 0, wins: 0 };
    sBucket.trades += 1;
    sBucket.pnl += pnl;
    if (pnl > 0) sBucket.wins += 1;
    sessionStats[sess] = sBucket;

    if (i > 0) {
      const prev = trades[i - 1];
      const prevPnl = Number(prev.net_pnl || 0);
      const prevCloseMs = new Date(prev.closed_at || prev.opened_at).getTime();
      const curOpenMs = new Date(t.opened_at).getTime();
      const minsSincePrev = (curOpenMs - prevCloseMs) / 60_000;

      if (prevPnl < 0 && minsSincePrev >= 0 && minsSincePrev <= 20) {
        revengeCount += 1;
        revengePnl += pnl;
        if (pnl > 0) revengeWins += 1;
      }

      if (typeof rPct === "number") {
        if (prevPnl < 0 && rPct > targetRiskPct * 1.30) {
          postLossRiskExpansionCount += 1;
        }
        if (prevPnl > 0 && rPct > targetRiskPct * 1.30) {
          postWinRiskExpansionCount += 1;
        }
      }
    }
  }

  // Deterministic Same-Day Multi-Trade Clusters (Prevents AI from hallucinating Oct 1 into Oct 5!)
  const sameDayClusters = Array.from(dailyMap.entries())
    .filter(([_d, st]) => st.trades >= 2)
    .map(([d, st]) => ({
      date: d,
      tradeCount: st.trades,
      totalNetPnl: Math.round(st.pnl * 100) / 100,
      tradesOnThisExactDate: st.items,
    }));

  const profitGivebackDays = Array.from(dailyMap.entries())
    .filter(([_d, st]) => st.peakPnl > 100 && st.pnl < st.peakPnl * 0.35 && st.trades >= 2)
    .map(([d, st]) => ({
      date: d,
      trades: st.trades,
      peakPnl: Math.round(st.peakPnl),
      endedPnl: Math.round(st.pnl),
      givenBack: Math.round(st.giveback),
    }));

  let missedTrades: any[] = [];
  try {
    missedTrades = db
      .prepare(
        `SELECT id, symbol, direction, observed_at, miss_reason, theoretical_pnl, realized_r, notes
         FROM missed_trades
         WHERE observed_at >= ?
         ORDER BY observed_at DESC LIMIT 30`
      )
      .all(cutoffIso) as any[];
  } catch {}

  const missReasons: Record<string, number> = {};
  let missedOpportunityPnl = 0;
  for (const m of missedTrades) {
    const r = m.miss_reason || "Hesitation / Fear";
    missReasons[r] = (missReasons[r] || 0) + 1;
    missedOpportunityPnl += Number(m.theoretical_pnl || 0);
  }

  // Fetch lightweight journal metadata first (skips reading 90 heavy HTML blobs from tablet flash storage!)
  let journalsMeta: any[] = [];
  try {
    journalsMeta = db
      .prepare(
        `SELECT slug, period_type, title, lessons_learned, scores_json, rating, updated_at
         FROM journal_entries
         ORDER BY slug DESC LIMIT 90`
      )
      .all() as any[];
  } catch {}

  const includeTabs = customScope?.includeTabs || "both";
  const fetchHtmlStmt = db.prepare(
    `SELECT content, review_content FROM journal_entries WHERE slug = ?`
  );

  const allParsedJournals = journalsMeta
    .map((j) => {
      const slotKey = `${j.slug}:${includeTabs}`;
      const stamp = j.updated_at || "";
      let cachedJ = journalDigestCache.get(slotKey);

      // Only read content & review_content from SQLite disk if this journal was never parsed or its updated_at changed!
      if (!cachedJ || cachedJ.stamp !== stamp) {
        const htmlRow = (fetchHtmlStmt.get(j.slug) as { content?: string; review_content?: string }) || {};
        const rawContent = htmlRow.content || "";
        const rawReview = htmlRow.review_content || "";

        const prepDigest =
          includeTabs === "review_only"
            ? { qaReflections: [], cleanText: "" }
            : htmlToStructuredDigest(rawContent);
        const revDigest =
          includeTabs === "prep_only"
            ? { qaReflections: [], cleanText: "" }
            : htmlToStructuredDigest(rawReview);
        const prepEval = evaluateSubstantiveJournalHtml(rawContent);
        const revEval = evaluateSubstantiveJournalHtml(rawReview);

        cachedJ = { stamp, prepDigest, revDigest, prepEval, revEval };
        // Bound cache size on tablet RAM
        if (journalDigestCache.size > 200) {
          const oldestKey = journalDigestCache.keys().next().value;
          if (oldestKey) journalDigestCache.delete(oldestKey);
        }
        journalDigestCache.set(slotKey, cachedJ);
      }
      const { prepDigest, revDigest, prepEval, revEval } = cachedJ;
      const cleanLesson = (j.lessons_learned || "")
        .replace(/Summarize system adherence.*$/i, "")
        .replace(/n\/a/gi, "")
        .trim();

      const rawPrepLen = prepEval.userCharCount;
      const rawRevLen = revEval.userCharCount;

      let scores: any = {};
      try {
        scores = JSON.parse(j.scores_json || "{}");
      } catch {}

      const hasSubstantiveText =
        prepEval.isSubstantive ||
        revEval.isSubstantive ||
        cleanLesson.length >= 10;

      return {
        slug: j.slug,
        periodType: j.period_type || "day",
        title: j.title || j.slug,
        journalUrl: `/journal?slug=${encodeURIComponent(j.slug)}`,
        hasPrep: prepEval.isSubstantive,
        hasReview: revEval.isSubstantive,
        isTemplateOnly: !hasSubstantiveText,
        prepCharLen: rawPrepLen,
        reviewCharLen: rawRevLen,
        scores,
        processRating: j.rating,
        lessonsLearned: j.lessons_learned || "",
        qaReflections: [...prepDigest.qaReflections, ...revDigest.qaReflections],
        prepSummary: prepDigest.cleanText.slice(0, 1200),
        reviewSummary: revDigest.cleanText.slice(0, 1800),
        updatedAt: j.updated_at || "",
      };
    })
    .filter(Boolean) as any[];

  const substantiveJournals = allParsedJournals.filter((j) => !j.isTemplateOnly);
  const selectedJournals =
    customScope?.selectedJournalSlugs && customScope.selectedJournalSlugs.length > 0
      ? allParsedJournals.filter((j) => customScope.selectedJournalSlugs!.includes(j.slug))
      : substantiveJournals.slice(0, 12);

  const fourPeriodNetPnl = trades.reduce((acc, t) => acc + Number(t.net_pnl || 0), 0);
  const fourPeriodWins = trades.filter((t) => Number(t.net_pnl || 0) > 0).length;

  // Build Server-Verified Locked Markdown Tables so the AI NEVER invents numbers or misaligns dates!
  const verifiedPeriodTableMd = [
    `| Period | Date Range | Total Trades | Wins / Losses | Win Rate | Net P&L ($) | Net Acct % | Avg Risk % | Half (<0.72%) | Standard (~1%) | Oversized (>1.3%) |`,
    `|---|---|---|---|---|---|---|---|---|---|---|`,
    ...periodComparisonBuckets.map(
      (b: any) =>
        `| **${b.periodLabel}** | ${b.dateRange} | **${b.trades}** | ${b.wins}W / ${b.losses}L | ${b.winRatePct}% | **$${b.netPnl.toFixed(2)}** | ${b.netAcctPct}% | ${b.avgAccountRiskPct}% | ${b.halfRiskTradesCount} | ${b.standardRiskTradesCount} | ${b.oversizedRiskTradesCount} |`
    ),
  ].join("\n");

  // Build Playbook & Setup Tag Telemetry Breakdown (Future-proofed for Playbooks & Tags)
  const playbookMap: Record<
    string,
    { trades: number; wins: number; losses: number; netPnl: number; riskSum: number; mistakes: number }
  > = {};
  const tagPerfMap: Record<
    string,
    { trades: number; wins: number; losses: number; netPnl: number; riskSum: number }
  > = {};
  let unassignedPlaybookTrades = 0;
  let untaggedTrades = 0;

  for (const t of trades) {
    const pnl = Number(t.net_pnl || 0);
    const rPct = Number(t.accountRiskPct || targetRiskPct);
    const pbName = String(t.playbook || "").trim() || "Unassigned / No Playbook";
    if (pbName === "Unassigned / No Playbook") unassignedPlaybookTrades += 1;

    const pbStat = playbookMap[pbName] || {
      trades: 0,
      wins: 0,
      losses: 0,
      netPnl: 0,
      riskSum: 0,
      mistakes: 0,
    };
    pbStat.trades += 1;
    if (pnl > 0) pbStat.wins += 1;
    else if (pnl < 0) pbStat.losses += 1;
    pbStat.netPnl = Math.round((pbStat.netPnl + pnl) * 100) / 100;
    pbStat.riskSum += rPct;
    pbStat.mistakes += Array.isArray(t.mistakes) ? t.mistakes.length : 0;
    playbookMap[pbName] = pbStat;

    const tTags = Array.isArray(t.tags) ? t.tags.map((x: any) => String(x).trim()).filter(Boolean) : [];
    if (tTags.length === 0) {
      untaggedTrades += 1;
    } else {
      for (const tg of tTags) {
        const tgStat = tagPerfMap[tg] || { trades: 0, wins: 0, losses: 0, netPnl: 0, riskSum: 0 };
        tgStat.trades += 1;
        if (pnl > 0) tgStat.wins += 1;
        else if (pnl < 0) tgStat.losses += 1;
        tgStat.netPnl = Math.round((tgStat.netPnl + pnl) * 100) / 100;
        tgStat.riskSum += rPct;
        tagPerfMap[tg] = tgStat;
      }
    }
  }

  const playbookBreakdown = Object.entries(playbookMap).map(([name, st]) => ({
    playbook: name,
    trades: st.trades,
    wins: st.wins,
    losses: st.losses,
    winRatePct: st.trades > 0 ? Math.round((st.wins / st.trades) * 1000) / 10 : 0,
    netPnl: st.netPnl,
    avgAccountRiskPct: st.trades > 0 ? Math.round((st.riskSum / st.trades) * 100) / 100 : 0,
    mistakesCount: st.mistakes,
  }));

  const tagBreakdown = Object.entries(tagPerfMap).map(([tag, st]) => ({
    tag,
    trades: st.trades,
    wins: st.wins,
    losses: st.losses,
    winRatePct: st.trades > 0 ? Math.round((st.wins / st.trades) * 1000) / 10 : 0,
    netPnl: st.netPnl,
    avgAccountRiskPct: st.trades > 0 ? Math.round((st.riskSum / st.trades) * 100) / 100 : 0,
  }));

  const verifiedPlaybookTableMd = [
    `| Playbook / Setup | Trades | W / L | Win Rate | Net P&L ($) | Avg Risk % | Tagged Mistakes |`,
    `|---|---|---|---|---|---|---|`,
    ...playbookBreakdown.map(
      (p) =>
        `| **${p.playbook}** | ${p.trades} | ${p.wins}W / ${p.losses}L | ${p.winRatePct}% | **$${p.netPnl.toFixed(2)}** | ${p.avgAccountRiskPct}% | ${p.mistakesCount} |`
    ),
  ].join("\n");

  const verifiedTradesLedgerMd = [
    `| Exact Date | Trade Link | Qty (Lots) | Net P&L ($) | Acct P&L % | Acct Risk % | Risk Tier |`,
    `|---|---|---|---|---|---|---|`,
    ...trades.map(
      (t: any) =>
        `| **${String(t.opened_at).slice(0, 10)}** | [${t.symbol} ${t.direction}](${t.tradeUrl}) | ${t.quantity} | **$${Number(t.net_pnl).toFixed(2)}** | ${t.accountPnlPct}% | ${t.accountRiskPct}% | ${t.riskTier} |`
    ),
  ].join("\n");

  const telemetry: any = {
    targetPeriodLabel: targetBucket?.periodLabel || horizon,
    targetPeriodDateRange: targetBucket?.dateRange || "",
    targetPeriodTradesCount: targetBucket?.trades ?? targetPeriodTrades.length,
    targetPeriodNetPnl: targetBucket?.netPnl ?? 0,
    targetPeriodWinRatePct: targetBucket?.winRatePct ?? 0,
    fourPeriodCumulativeTrades: trades.length,
    fourPeriodCumulativeWinRatePct:
      trades.length > 0 ? Math.round((fourPeriodWins / trades.length) * 1000) / 10 : 0,
    fourPeriodCumulativeNetPnl: Math.round(fourPeriodNetPnl * 100) / 100,
    // Keep legacy keys mapped to target period or cumulative clearly
    totalTrades: targetBucket?.trades ?? trades.length,
    winRatePct: targetBucket?.winRatePct ?? 0,
    totalNetPnl: targetBucket?.netPnl ?? 0,
    initialAccountBalance,
    currentEquity: Math.round(runningEquity * 100) / 100,
    targetRiskPct,
    baseline1RUsd: inferredFull1RUsd,
    baseline1RPct: targetRiskPct,
    revengeTradesCount: revengeCount,
    revengeWinRatePct: revengeCount > 0 ? Math.round((revengeWins / revengeCount) * 100) : 0,
    revengeNetPnl: Math.round(revengePnl * 100) / 100,
    postLossSizeExpansionCount: postLossRiskExpansionCount,
    postLossRiskExpansionCount,
    postWinRiskExpansionCount,
    intentionalDownsizeCount,
    periodComparisonBuckets,
    sameDayClusters,
    verifiedPeriodTableMd,
    verifiedTradesLedgerMd,
    verifiedPlaybookTableMd,
    playbookBreakdown,
    tagBreakdown,
    unassignedPlaybookTrades,
    untaggedTrades,
    profitGivebackDays,
    topMistakes: Object.entries(mistakeCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6),
    topTags: Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6),
    sessionBreakdown: sessionStats,
    missedTradesCount: missedTrades.length,
    missedOpportunityPnl: Math.round(missedOpportunityPnl * 100) / 100,
    topMissReasons: Object.entries(missReasons).sort((a, b) => b[1] - a[1]),
  };

  // === DEEP BEHAVIORAL FORENSICS ENGINE ===
  const winnerHoldMins: number[] = [];
  const loserHoldMins: number[] = [];
  const winnerRs: number[] = [];
  const loserRs: number[] = [];
  let scratchTradesCount = 0;

  for (const t of trades) {
    const pnl = Number(t.net_pnl || 0);
    const rVal = t.realized_r !== null && t.realized_r !== undefined ? Number(t.realized_r) : null;
    const openMs = new Date(t.opened_at).getTime();
    const closeMs = new Date(t.closed_at || t.opened_at).getTime();
    const holdMins =
      Number.isFinite(openMs) && Number.isFinite(closeMs) && closeMs >= openMs
        ? Math.round((closeMs - openMs) / 60_000)
        : null;

    if (rVal !== null && Math.abs(rVal) <= 0.2) scratchTradesCount += 1;
    if (pnl > 0) {
      if (holdMins !== null) winnerHoldMins.push(holdMins);
      if (rVal !== null) winnerRs.push(rVal);
    } else if (pnl < 0) {
      if (holdMins !== null) loserHoldMins.push(holdMins);
      if (rVal !== null) loserRs.push(rVal);
    }
  }

  const avgArr = (arr: number[]) =>
    arr.length > 0 ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) / 100 : null;

  telemetry.executionAsymmetry = {
    avgWinnerHoldMins: avgArr(winnerHoldMins),
    avgLoserHoldMins: avgArr(loserHoldMins),
    holdTimeRatioWinToLoss:
      avgArr(winnerHoldMins) && avgArr(loserHoldMins)
        ? Math.round((avgArr(winnerHoldMins)! / Math.max(1, avgArr(loserHoldMins)!)) * 100) / 100
        : null,
    avgWinnerR: avgArr(winnerRs),
    avgLoserR: avgArr(loserRs),
    scratchOrEarlyBeCount: scratchTradesCount,
  };

  const daysGapAfterLoss: number[] = [];
  const daysGapAfterWin: number[] = [];
  const riskDeltaAfterLoss: number[] = [];
  let winsAfterLoss = 0;
  let tradesAfterLoss = 0;

  for (let i = 1; i < trades.length; i++) {
    const prev = trades[i - 1];
    const cur = trades[i];
    const prevPnl = Number(prev.net_pnl || 0);
    const curPnl = Number(cur.net_pnl || 0);
    const gapDays =
      (new Date(cur.opened_at).getTime() - new Date(prev.closed_at || prev.opened_at).getTime()) /
      86_400_000;

    if (prevPnl < 0) {
      tradesAfterLoss += 1;
      if (curPnl > 0) winsAfterLoss += 1;
      if (gapDays >= 0) daysGapAfterLoss.push(Math.round(gapDays * 10) / 10);
      if (typeof cur.accountRiskPct === "number" && typeof prev.accountRiskPct === "number") {
        riskDeltaAfterLoss.push(
          Math.round((cur.accountRiskPct - prev.accountRiskPct) * 100) / 100
        );
      }
    } else if (prevPnl > 0) {
      if (gapDays >= 0) daysGapAfterWin.push(Math.round(gapDays * 10) / 10);
    }
  }

  const lastTrade = trades[trades.length - 1];
  const daysSinceLastTrade = lastTrade
    ? Math.floor((now.getTime() - new Date(lastTrade.closed_at || lastTrade.opened_at).getTime()) / 86_400_000)
    : null;

  telemetry.emotionalBaggageMetrics = {
    tradesFollowingLossCount: tradesAfterLoss,
    winRateFollowingLossPct:
      tradesAfterLoss > 0 ? Math.round((winsAfterLoss / tradesAfterLoss) * 100) : null,
    avgDaysInactiveAfterLoss: avgArr(daysGapAfterLoss),
    avgDaysInactiveAfterWin: avgArr(daysGapAfterWin),
    avgAccountRiskShiftAfterLossPct: avgArr(riskDeltaAfterLoss),
    lastTradeOutcome: lastTrade ? (Number(lastTrade.net_pnl) >= 0 ? "WIN" : "LOSS") : "NONE",
    daysSinceLastTrade,
  };

  const totalPrepChars = selectedJournals.reduce((acc, j) => acc + Number(j.prepCharLen || 0), 0);
  const totalRevChars = selectedJournals.reduce((acc, j) => acc + Number(j.reviewCharLen || 0), 0);
  const ratingsList = selectedJournals
    .map((j) => j.processRating)
    .filter((r): r is number => typeof r === "number");
  const uniqueRatings = new Set(ratingsList);

  // E. Linguistic Crutches & Rationalization Refrain Detector (e.g. "low probability", "easy to say in hindsight")
  const CRUTCH_PHRASES = [
    "low probability",
    "lower probability",
    "hindsight",
    "sidelines",
    "high resistance",
    "consolidation",
    "didn't really have much opportunity",
    "no opportunity",
  ];
  const linguisticCrutches: Array<{ phrase: string; count: number; examples: Array<{ slug: string; snippet: string }> }> = [];
  for (const phrase of CRUTCH_PHRASES) {
    let totalHits = 0;
    const examples: Array<{ slug: string; snippet: string }> = [];
    const rx = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    for (const j of allParsedJournals.slice(0, 18)) {
      const combinedText = `${j.prepSummary || ""} ${j.reviewSummary || ""}`;
      const matches = combinedText.match(rx);
      if (matches && matches.length > 0) {
        totalHits += matches.length;
        const idx = combinedText.toLowerCase().indexOf(phrase.toLowerCase());
        if (idx !== -1 && examples.length < 5) {
          const snip = combinedText.slice(Math.max(0, idx - 35), Math.min(combinedText.length, idx + phrase.length + 55)).trim();
          examples.push({ slug: j.slug, snippet: `"...${snip}..."` });
        }
      }
    }
    if (totalHits > 0) {
      linguisticCrutches.push({ phrase, count: totalHits, examples });
    }
  }
  telemetry.linguisticCrutches = linguisticCrutches;

  // F. Orphan Trade Detector (Trades executed in ledger that have zero notes/tags/mistakes AND are never mentioned in journals)
  const allJournalTextLower = allParsedJournals
    .slice(0, 20)
    .map((j) => `${j.slug} ${j.prepSummary || ""} ${j.reviewSummary || ""} ${j.lessonsLearned || ""}`.toLowerCase())
    .join(" ");

  telemetry.orphanTrades = trades
    .filter((t) => {
      const hasNoAnnotations =
        (!Array.isArray(t.mistakes) || t.mistakes.length === 0) &&
        (!Array.isArray(t.tags) || t.tags.length === 0) &&
        !String(t.notes || "").trim();
      const dateStr = String(t.opened_at || "").slice(0, 10);
      const shortDate = dateStr.slice(5).replace("-", "/"); // e.g. 10/16
      const mentionedByDate =
        allJournalTextLower.includes(dateStr) || allJournalTextLower.includes(shortDate);
      return hasNoAnnotations && !mentionedByDate;
    })
    .map((t) => ({
      date: String(t.opened_at || "").slice(0, 16).replace("T", " "),
      symbol: t.symbol,
      direction: t.direction,
      quantity: t.quantity,
      netPnl: t.net_pnl,
      accountRiskPct: t.accountRiskPct,
      tradeUrl: t.tradeUrl,
      warning: "Orphan Trade: Executed in broker ledger with zero tags, zero mistakes, zero trade notes, and zero mention in the corresponding journal review.",
    }));

  // G. Journal Review Loop Completeness & Mantra Matrix (Exposes Empty Review Loops & 80% Shield)
  telemetry.journalCompletionMatrixMd = [
    `| Journal Entry | Period | Forecast/Prep? | Review Answers Present? | Key Takeaway | Process Score |`,
    `|---|---|---|---|---|---|`,
    ...allParsedJournals.slice(0, 14).map((j) => {
      const prepStatus = j.hasPrep ? `Yes (${j.prepCharLen}c)` : "Empty / Skeleton";
      const revStatus = j.hasReview
        ? `Yes (${j.reviewCharLen}c)`
        : j.isTemplateOnly
        ? "No (Unfilled Template)"
        : "No (Questions Unanswered)";
      const takeaway = j.lessonsLearned ? j.lessonsLearned.slice(0, 45) : "None";
      const scoreStr = j.processRating !== null && j.processRating !== undefined ? `${j.processRating}%` : "Unscored";
      return `| [${j.slug}](${j.journalUrl}) | ${j.periodType.toUpperCase()} | ${prepStatus} | **${revStatus}** | ${takeaway} | **${scoreStr}** |`;
    }),
  ].join("\n");

  telemetry.journalingForensics = {
    totalPrepChars,
    totalReviewChars: totalRevChars,
    prepToReviewRatio:
      totalRevChars > 0 ? Math.round((totalPrepChars / totalRevChars) * 10) / 10 : totalPrepChars,
    avoidanceAlert:
      totalPrepChars > 1000 && totalRevChars < totalPrepChars * 0.25
        ? `High Prep-to-Review imbalance (${totalPrepChars} chars in Prep vs ${totalRevChars} chars in Review).`
        : null,
    autopilotScoringAlert:
      ratingsList.length >= 3 && uniqueRatings.size === 1
        ? `Uniform process score of ${ratingsList[0]}% across ${ratingsList.length} rated journals.`
        : null,
  };

  // Match trade strictly to exact day slug or exact containing ISO week so Oct 1 NEVER maps to week-2026-10-05!
  telemetry.sayDoAlignmentMap = trades.slice(-10).map((t) => {
    const tDate = String(t.opened_at || "").slice(0, 10);
    const matchingJournal = allParsedJournals.find((j) => j.slug === `day-${tDate}` || j.slug === `month-${tDate.slice(0, 7)}`);
    return {
      exactTradeDate: tDate,
      trade: `${t.symbol} ${t.direction} on ${tDate} (Qty ${t.quantity} | Net $${t.net_pnl} | Acct Risk ${t.accountRiskPct}%)`,
      tradeUrl: t.tradeUrl,
      linkedJournalSlug: matchingJournal?.slug || null,
    };
  });

  const recent14Cutoff = new Date(now.getTime() - 14 * 86_400_000).toISOString().slice(0, 10);
  const recentJournals14 = allParsedJournals
    .filter((j) => j.slug.replace(/^[a-z]+-/, "") >= recent14Cutoff || j.periodType !== "day")
    .slice(0, 10);
  const unreviewedJournals = recentJournals14
    .filter((j) => !j.hasReview)
    .map((j) => ({
      slug: j.slug,
      title: j.title,
      periodType: j.periodType,
      hasPrep: j.hasPrep,
      isTemplateOnly: Boolean(j.isTemplateOnly),
    }));

  const untaggedLosingTrades = trades
    .filter(
      (t) =>
        Number(t.net_pnl || 0) < 0 &&
        (!Array.isArray(t.mistakes) || t.mistakes.length === 0) &&
        !String(t.notes || "").trim()
    )
    .slice(-5)
    .map((t) => ({
      key: t.key,
      symbol: t.symbol,
      date: String(t.opened_at || "").slice(0, 10),
      netPnl: t.net_pnl,
      tradeUrl: t.tradeUrl,
    }));

  const reviewedCount = recentJournals14.filter((j) => j.hasReview).length;
  const readinessPct =
    recentJournals14.length > 0
      ? Math.round((reviewedCount / recentJournals14.length) * 100)
      : 100;

  telemetry.reflectionReadiness = {
    readinessPct,
    totalRecentJournals: recentJournals14.length,
    reviewedCount,
    unreviewedJournals,
    untaggedLosingTrades,
  };

  return {
    telemetry,
    parsedJournals: selectedJournals,
    selectableJournals: allParsedJournals.map((j) => ({
      slug: j.slug,
      periodType: j.periodType,
      title: j.title,
      hasPrep: j.hasPrep,
      hasReview: j.hasReview,
      prepCharLen: j.prepCharLen,
      reviewCharLen: j.reviewCharLen,
      processRating: j.processRating,
    })),
    selectableTrades: allTrades.slice(-50).reverse().map((t) => ({
      key: t.key,
      symbol: t.symbol,
      direction: t.direction,
      openedAt: t.opened_at,
      netPnl: t.net_pnl,
      realizedR: t.realized_r,
      estimated1RUsd: t.estimated1RUsd,
      accountRiskPct: t.accountRiskPct,
      accountPnlPct: t.accountPnlPct,
      mistakes: t.mistakes,
      tags: t.tags,
      hasNotes: Boolean((t.notes || "").trim()),
      tradeUrl: t.tradeUrl,
    })),
    recentTradesSample: trades.slice(-25),
  };
}

function extractFallbackActionItems(markdown: string, horizon: GoalHorizon): ReportActionItem[] {
  const items: ReportActionItem[] = [];
  const lines = markdown.split("\n");
  let inActionSection = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Stop if we hit the Reference Links appendix
    if (/Direct Links to Referenced/i.test(trimmed)) {
      break;
    }

    // Only enter action section on Section 4/5 Action Plan / Action Protocol / Next Steps headers (NEVER on "3. Goal Accountability Audit"!)
    if (/^(?:#{1,4}|\*\*)\s*(?:[45]\.|mental game action|concrete action|action plan|action protocol|next steps|recommended.*goals)/i.test(trimmed)) {
      inActionSection = true;
      continue;
    }

    if (!inActionSection) continue;

    // Match explicit What:/Rule:/Action: lines or proper list bullets (require whitespace after - or * so *italics* are never matched!)
    const isListBullet = /^(?:[-•]\s+|\*\s+|\d+\.\s+)/.test(trimmed);
    const isRuleLine = /^(?:\*\*)?(?:Action|Rule|Step|Protocol|Circuit Breaker|Pre-Session Rule)\s*\d*[:—-]/i.test(trimmed);

    if (isListBullet || isRuleLine) {
      const cleaned = trimmed
        .replace(/^(?:[-•]\s+|\*\s+|\d+\.\s+)/, "")
        .replace(/\*\*/g, "")
        .replace(/^\*+|\*+$/g, "")
        .trim();

      // Reject diagnostic fragments ending in a comma or short non-action labels
      if (
        cleaned.length > 18 &&
        cleaned.length < 240 &&
        !cleaned.endsWith(",") &&
        !/^(win rate|oversized trades|a \d+-trade|the journal's own|the infrastructure|grade:|status:)/i.test(cleaned)
      ) {
        items.push({
          id: `act_${Date.now()}_${items.length}`,
          text: cleaned,
          horizon,
          targetMetric: "Execute consistently in upcoming sessions",
          done: false,
        });
      }
    }
  }
  return items.slice(0, 6);
}

async function executeAuditJobInBackground(
  jobId: string,
  horizon: GoalHorizon,
  controller: AbortController,
  customScope?: CustomAuditScope,
  precreatedReportId?: string
) {
  const dbPath = resolveDbPath();
  const db = getCoachDb();
  const reportId = precreatedReportId || `rep_${Date.now()}`;
  let reportTitle = `${horizon.toUpperCase()} Audit`;
  let periodKey: string = horizon;
  let telemetry: any = {};
  let parsedJournals: any[] = [];
  let recentTradesSample: any[] = [];

  try {
    ensureCoachTables(db);
    const built = buildBehavioralTelemetryAndJournals(db, horizon, customScope);
    telemetry = built.telemetry;
    parsedJournals = built.parsedJournals;
    recentTradesSample = built.recentTradesSample;

    const activeGoals = db
      .prepare(`SELECT * FROM trader_goals WHERE status != 'completed' ORDER BY updated_at DESC`)
      .all() as any[];

    const now = new Date();
    const timing = getPeriodTimingContext(horizon, now, customScope, telemetry.periodComparisonBuckets?.[0]);

    // Pull prior completed reports in window (excluding the newly created placeholder reportId)
    const priorReports = db
      .prepare(
        `SELECT period_key, horizon, title, summary_md, action_items_json, created_at
         FROM ai_coach_reports
         WHERE created_at >= ? AND id != ?
         ORDER BY created_at DESC LIMIT 6`
      )
      .all(telemetry.cutoffDate, reportId) as any[];

    const isCustomScoped =
      (customScope?.selectedJournalSlugs && customScope.selectedJournalSlugs.length > 0) ||
      (customScope?.selectedTradeKeys && customScope.selectedTradeKeys.length > 0) ||
      Boolean(customScope?.customFocusPrompt?.trim());

    const existingCountRow = db
      .prepare(`SELECT COUNT(*) as cnt FROM ai_coach_reports WHERE period_key LIKE ? AND id != ?`)
      .get(`${timing.basePeriodKey}%`, reportId) as { cnt: number } | undefined;
    const seqNum = (existingCountRow?.cnt || 0) + 1;
    const shortStamp = now.toISOString().slice(5, 16).replace("T", " ");

    periodKey = isCustomScoped
      ? `${timing.basePeriodKey}-Scoped-#${seqNum}`
      : `${timing.basePeriodKey}-#${seqNum}`;

    reportTitle = isCustomScoped
      ? `Scoped ${timing.timingTag} #${seqNum} · ${parsedJournals.map((j: any) => j.slug).slice(0, 2).join(", ") || timing.basePeriodKey} (${shortStamp})`
      : `${timing.timingTag} #${seqNum} · ${timing.basePeriodKey} (${shortStamp})`;

    const horizonRoleGuide = timing.timingInstruction;
    const settings = loadLocalAiSettings();
    const nowIso = now.toISOString();

    // 1. IMMEDIATELY CREATE THE REPORT PAGE & LINKED Q&A THREAD IN SQLITE AT T=0s!
    //    This guarantees a new report page appears right away and can NEVER be lost if interrupted!
    db.prepare(`
      INSERT INTO ai_coach_reports (
        id, horizon, period_key, title, summary_md, reasoning_trace,
        telemetry_json, suggested_goals_json, accountability_json, action_items_json, model_used, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, '[]', '[]', '[]', ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        period_key = excluded.period_key,
        telemetry_json = excluded.telemetry_json
    `).run(
      reportId,
      isCustomScoped ? "custom" : horizon,
      periodKey,
      reportTitle,
      `*(⏳ Generating ${reportTitle} on Desktop GPU... Live output will stream into this page automatically)*`,
      "",
      JSON.stringify(telemetry),
      settings.activeModelFile || "koboldcpp",
      nowIso
    );

    const threadId = `sess_rep_${reportId}`;
    db.prepare(`
      INSERT OR IGNORE INTO ai_chat_sessions (id, title, report_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(threadId, `Discussion · ${reportTitle}`, reportId, nowIso, nowIso);

    db.prepare(`
      UPDATE ai_background_jobs
      SET label = ?, result_json = ?, updated_at = ?
      WHERE id = ?
    `).run(
      reportTitle,
      JSON.stringify({ streaming: true, reportId, title: reportTitle, partialText: "", partialReasoning: "" }),
      nowIso,
      jobId
    );

    const customFocusSection = customScope?.customFocusPrompt?.trim()
      ? `\n=== SPECIFIC FOCUS REQUESTED BY TRADER ===\n${customScope.customFocusPrompt.trim()}\n`
      : "";

    const deepPrompt = `You are a longitudinal trading psychology and behavioral performance analyst.
You do NOT evaluate the trader's technical chart model.
${horizonRoleGuide}

CRITICAL ACCOUNT % RISK RULE:
The trader's standard full risk is ${telemetry.targetRiskPct}% of account equity (~$${telemetry.baseline1RUsd} on a $${telemetry.initialAccountBalance} account).
However, in their trade log, "Realized R" is relative to whatever risk was placed on that specific trade—meaning if the trader intentionally scales down to 0.5% account risk, a stop-out still reads as "-1R" in trade R, even though it only risked 0.5% of the account!
Therefore, ALWAYS evaluate sizing discipline using the provided \`accountRiskPct\` (% of account risked on the trade) and \`accountPnlPct\` (% of account won/lost), NOT raw lot sizes or raw Trade R alone!
- \`reduced_risk (<0.72%)\` = intentional half/probe risk (e.g. 0.5% of account)
- \`standard_risk (0.72%–1.30%)\` = standard 1% account risk
- \`oversized_risk (>1.30%)\` = sizing expansion / tilt above 1% standard risk

CLICKABLE LINKS RULE: Whenever you reference a specific trade or journal entry, format it as a clickable Markdown link using the exact URL provided in the data below, e.g. \`[NAS100 Short 10/19 (-$499.20 | 1.0% Risk)](/trades?symbol=NAS100&from=2026-10-19&to=2026-10-19)\` or \`[Journal 2026-W42](/journal?slug=2026-W42)\`.
${customFocusSection}
=== 1. SERVER-VERIFIED CALENDAR PERIOD COMPARISON TABLE (LOCKED SQLITE TRUTH — DO NOT ALTER NUMBERS!) ===
${telemetry.verifiedPeriodTableMd}

=== 1B. SERVER-VERIFIED EXACT TRADE-BY-TRADE LEDGER & SAME-DAY CLUSTERS (DO NOT DUPLICATE TRADES ACROSS DATES!) ===
${telemetry.verifiedTradesLedgerMd}

Same-Day Multi-Trade Clusters:
${JSON.stringify(telemetry.sameDayClusters, null, 2)}

CRITICAL DATA INTEGRITY RULES:
1. Every number in the two Markdown tables above is computed directly from SQLite and matches the trader's dashboard 1-for-1.
2. When you include a Period Comparison Table or Trade Cluster Table in your report, copy the EXACT numbers, dates, trade counts, P&L, and Risk Tier counts from the Server-Verified tables above!
3. Notice that Half-Risk + Standard-Risk + Oversized-Risk in every row equals 100% of Total Trades. NEVER invent "unlisted oversized trades" or move a trade from one date to another (e.g. 2026-10-01 has 1 trade of -$1,007.23; 2026-10-05 has 3 trades of -$555.62, -$497.73, and -$504.34 totaling -$1,557.69).
4. Do NOT confuse the 4-Period Cumulative Net P&L ($${telemetry.fourPeriodCumulativeNetPnl} across ${telemetry.fourPeriodCumulativeTrades} trades) with the Target Period's single-period Net P&L ($${telemetry.targetPeriodNetPnl} across ${telemetry.targetPeriodTradesCount} trades).

=== 1C. JOURNAL REVIEW LOOP COMPLETENESS & PROCESS SCORE MATRIX ===
${telemetry.journalCompletionMatrixMd}

=== 1D. LINGUISTIC CRUTCHES ("LOW PROBABILITY" / "HINDSIGHT" REFRAIN) & ORPHAN TRADES ===
Linguistic Crutches Detected Across Journals:
${JSON.stringify(telemetry.linguisticCrutches, null, 2)}

Orphan Trades (Executed in Ledger with Zero Tags/Notes & Invisible in Journals):
${JSON.stringify(telemetry.orphanTrades, null, 2)}

=== 2. OVERALL BEHAVIORAL TELEMETRY (ACCOUNT % RISK NORMALIZED) ===
${JSON.stringify(telemetry, null, 2)}

=== 2B. PLAYBOOK & TAG PERFORMANCE BREAKDOWN ===
${telemetry.verifiedPlaybookTableMd}
Tag Breakdown: ${JSON.stringify(telemetry.tagBreakdown)}
(Note: Unassigned Playbook Trades = ${telemetry.unassignedPlaybookTrades}, Untagged Trades = ${telemetry.untaggedTrades}. If playbooks or tags are assigned, evaluate edge and discipline by Playbook & Tag; if unassigned, remind the trader to tag setups in the trade log.)

=== 3. ACTIVE GOALS & MULTI-STEP CHECKLISTS TO AUDIT FOR ACCOUNTABILITY ===
${activeGoals.length > 0 ? activeGoals.map((g) => {
  let stepsArr: any[] = [];
  try { stepsArr = JSON.parse(g.steps_json || "[]"); } catch {}
  const stepsSummary = stepsArr.length > 0
    ? ` | Sub-Steps (${stepsArr.filter((s: any) => s.done).length}/${stepsArr.length} done): ` + stepsArr.map((s: any) => `[${s.done ? "x" : " "}] ${s.text}`).join("; ")
    : "";
  return `ID: ${g.id} | [${g.horizon.toUpperCase()}] "${g.title}" | Progress: ${g.progress_pct}% | Target Metric: "${g.target_metric}" | Why: "${g.why_it_matters}"${stepsSummary}`;
}).join("\n") : "No active goals defined yet—propose concrete goals with multi-step checklists across Weekly, Monthly, and Quarterly horizons."}

=== 4. SELECTED JOURNAL ENTRIES (${parsedJournals.length} ENTRIES | LINK WITH [Slug](journalUrl)) ===
${parsedJournals.length > 0 ? parsedJournals.map((j: any) => `### JOURNAL [${j.slug}](${j.journalUrl}) (${j.periodType.toUpperCase()}): ${j.title}\n- Process Score: ${j.processRating ?? "N/A"}% | Sub-scores: ${JSON.stringify(j.scores)}\n- Key Takeaway: ${j.lessonsLearned || "None recorded"}\n- Self-Reflection Quotes: ${JSON.stringify(j.qaReflections)}${j.prepSummary ? `\n- Prep Notes: ${j.prepSummary}` : ""}${j.reviewSummary ? `\n- Review Notes: ${j.reviewSummary}` : ""}`).join("\n\n") : "No journal entries in selection."}

=== 5. SELECTED / RECENT TRADES (LINK WITH [Symbol Direction Date](tradeUrl)) ===
${recentTradesSample.length > 0 ? recentTradesSample.map((t: any) => `- [${t.symbol} ${t.direction} ${t.opened_at?.slice(0, 10)} ($${t.net_pnl} | Acct PnL: ${t.accountPnlPct}% | Acct Risk: ${t.accountRiskPct ?? "?"}% [${t.riskTier}] | Trade R: ${t.realized_r ?? "?"}R)](${t.tradeUrl}) | Mistakes=${JSON.stringify(t.mistakes)} | Tags=${JSON.stringify(t.tags)} | Notes=${(t.notes || "").replace(/<[^>]+>/g, " ").slice(0, 180)}`).join("\n") : "No closed trades in this selection."}

=== 6. PREVIOUS AI REPORTS IN WINDOW (FOR LONGITUDINAL CONTINUITY) ===
${priorReports.length > 0 ? priorReports.map((r) => `[${r.created_at.slice(0, 10)} | ${r.title}]:\n${r.summary_md.slice(0, 900)}`).join("\n---\n") : "First report in this horizon series."}

=== INSTRUCTIONS ===
Write a complete, candid, deeply insightful report in Markdown with these exact 5 sections.
CRITICAL STYLE & DEPTH REQUIREMENT: Write with the piercing psychological depth of an elite behavioral performance analyst. Specifically examine and call out:
- **The "Spectator Analyst" vs. Executor Identity**: Does the trader write dense third-person ICT/SMC market narrations ("we got the SMT", "easy to say in hindsight") as a substitute for execution decisions?
- **Orphan Trades & Same-Day Re-Entry Clusters**: Call out trades taken in the ledger that have zero notes/tags/mistakes or are completely unmentioned in the journals, as well as same-day multi-trade clusters (revenge without the tag).
- **Uniform Self-Scoring as Emotional Protection (The 80% Shield)**: If process scores are uniformly 80% (4/5) across winning, losing, or 0-trade travel weeks, call out how uniform scoring acts as emotional homeostasis rather than an honest feedback loop.
- **The Empty Review Loop & Identity Anchor Mantras**: Use the Journal Completion Matrix in 1C to show which entries have unanswered review templates or repeated daily quotes/mantras, and notice whether the trader only answers psychology questions when there is zero emotional consequence (e.g. travel weeks).
- **Linguistic Crutches (The "Low Probability" Refrain)**: Cite exact counts and quotes from \`linguisticCrutches\` (e.g., how many times "low probability" or "hindsight" appears) to distinguish valid patience from fear disguised as selectivity.

Include these 5 sections (and complete all 5 sections + the closing JSON block):
1. **Period-over-Period Trajectory (${horizon.toUpperCase()} Delta Comparison)**: Compare the Target ${horizon} against the prior 3 periods using \`periodComparisonBuckets\`. Highlight what improved, what stagnated, and how Account % Risk (0.5% probe vs 1.0% standard vs >1.3% oversized) evolved.
2. **Say–Do Alignment & Execution Asymmetry**: Cross-examine what the trader planned in their Journal Prep against what they actually executed (\`sayDoAlignmentMap\` & \`executionAsymmetry\`). Did they execute their written bias, freeze/hesitate on valid setups, or take impulsive off-plan trades? Audit their winner vs. loser hold times and R-capture. Include clickable Markdown links!
3. **Emotional Baggage, Blind Spots & Avoidance Forensics**: Use \`emotionalBaggageMetrics\` and \`journalingForensics\` to diagnose deeper psychological patterns:
   - **Emotional Carryover / Scar Tissue**: How did the trader react after losses or missed trades (e.g., post-loss freeze, shrinking risk out of fear, or forcing trades)?
   - **Journaling Avoidance & C-Game Tells**: Call out Prep-vs-Review effort imbalances (writing 800 words of chart forecast while leaving self-reflection blank), autopilot 80% scoring, or defensive rationalizations in their quotes.
4. **Goal Accountability Audit**: Grade active goals with specific evidence and clickable links.
5. **Mental Game Action Protocol & Multi-Level Goals (Weekly -> Monthly -> Quarterly)**: Provide 3 to 5 concrete, trackable action steps (including a specific C-Game Circuit Breaker and an A-Game Pre-Session Rule) followed by Weekly, Monthly, and Quarterly goals.

At the very end, append a JSON block wrapped in \`\`\`json ... \`\`\` with this exact structure:
\`\`\`json
{
  "goalAudits": [
    {
      "goalId": "exact ID from section 3 if any",
      "status": "on_track | slipping | breached | completed",
      "progressPct": 75,
      "evidenceNote": "1-sentence specific citation"
    }
  ],
  "actionItems": [
    {
      "text": "Specific action step to execute this week",
      "horizon": "weekly",
      "targetMetric": "Measurable completion criteria"
    }
  ],
  "suggestedGoals": [
    {
      "horizon": "weekly",
      "periodLabel": "Next Week",
      "title": "Concise weekly process goal",
      "whyItMatters": "Why it matters",
      "targetMetric": "Measurable rule",
      "steps": ["Actionable checklist step 1", "Actionable checklist step 2", "Actionable checklist step 3"]
    },
    {
      "horizon": "monthly",
      "periodLabel": "Current Month",
      "title": "Monthly habit goal",
      "whyItMatters": "Root tendency",
      "targetMetric": "Target"
    },
    {
      "horizon": "quarterly",
      "periodLabel": "Current Quarter",
      "title": "Quarterly milestone",
      "whyItMatters": "Edge evolution",
      "targetMetric": "Target"
    }
  ]
}
\`\`\``;

    db.close();

    const thinkingMode = customScope?.thinkingMode || "balanced";
    const maxOut =
      customScope?.maxOutputTokens ||
      (thinkingMode === "fast" ? 8192 : thinkingMode === "balanced" ? 12288 : 16384);

    let latestStreamedText = "";
    let latestStreamedReasoning = "";

    const aiRes = await runKoboldAi(deepPrompt, {
      persona: "coach",
      thinkingMode,
      autoContinue: true,
      maxOutputTokens: maxOut,
      temperature: 0.6,
      abortSignal: controller.signal,
      onPartial: (partial) => {
        latestStreamedText = stripTrailingJsonBlock(partial.text || "") || latestStreamedText;
        latestStreamedReasoning = partial.reasoning || latestStreamedReasoning;
        const nowMs = Date.now();
        const prevMem = liveStreamMemory.get(jobId);
        const lastWrite = prevMem?.lastDbWriteMs || 0;

        // Always update RAM immediately (0ms cost) so ?poll=1 reads live text without touching disk
        liveStreamMemory.set(jobId, {
          reportId,
          title: reportTitle,
          partialText: latestStreamedText,
          partialReasoning: latestStreamedReasoning,
          lastDbWriteMs: nowMs - lastWrite > 4000 ? nowMs : lastWrite,
        });

        // Only checkpoint to SQLite disk every 4 seconds to eliminate I/O contention
        if (nowMs - lastWrite > 4000) {
          try {
            const dbStream = getCoachDb();
            const nowStr = new Date(nowMs).toISOString();
            if (latestStreamedText.trim() || latestStreamedReasoning.trim()) {
              dbStream
                .prepare(`UPDATE ai_coach_reports SET summary_md = ?, reasoning_trace = ? WHERE id = ?`)
                .run(
                  latestStreamedText.trim() ||
                    `*(🧠 AI is currently reasoning in <think>... Expand Reasoning Trace above to watch live)*`,
                  latestStreamedReasoning,
                  reportId
                );
            }
            dbStream
              .prepare(`UPDATE ai_background_jobs SET result_json = ?, updated_at = ? WHERE id = ? AND status = 'running'`)
              .run(
                JSON.stringify({
                  streaming: true,
                  reportId,
                  title: reportTitle,
                  partialText: latestStreamedText,
                  partialReasoning: latestStreamedReasoning,
                }),
                nowStr,
                jobId
              );
          } catch {}
        }
      },
    });

    const db2 = getCoachDb();
    try {
      let rawMarkdown = aiRes.text || latestStreamedText;
      let suggestedGoals: any[] = [];
      let goalAudits: any[] = [];
      let actionItems: ReportActionItem[] = [];

      const jsonMatch = rawMarkdown.match(/```json\s*([\s\S]*?)```/i);
      if (jsonMatch?.[1]) {
        try {
          const parsedJson = JSON.parse(jsonMatch[1].trim());
          if (Array.isArray(parsedJson.suggestedGoals)) suggestedGoals = parsedJson.suggestedGoals;
          if (Array.isArray(parsedJson.goalAudits)) goalAudits = parsedJson.goalAudits;
          if (Array.isArray(parsedJson.actionItems)) {
            actionItems = parsedJson.actionItems
              .map((ai: any, idx: number) => ({
                id: `act_${Date.now()}_${idx}`,
                text: String(ai.text || ai.title || ""),
                horizon: (ai.horizon as GoalHorizon) || horizon,
                targetMetric: String(ai.targetMetric || "Consistent execution"),
                done: false,
              }))
              .filter((a: ReportActionItem) => Boolean(a.text));
          }
          rawMarkdown = rawMarkdown.replace(jsonMatch[0], "").trim();
        } catch {}
      }

      if (!rawMarkdown.trim() && (aiRes.reasoning || latestStreamedReasoning).trim()) {
        rawMarkdown = `*(Note: Model completed reasoning trace; see full thought process below)*\n\n${aiRes.reasoning || latestStreamedReasoning}`;
      }

      const tradeLinksMd = recentTradesSample
        .slice(0, 10)
        .map(
          (t: any) =>
            `- [${t.symbol} ${t.direction.toUpperCase()} · ${t.opened_at?.slice(0, 10)} · Net $${t.net_pnl.toFixed(2)} · ${t.accountPnlPct >= 0 ? "+" : ""}${t.accountPnlPct}% Acct · Risked ${t.accountRiskPct ?? "?"}% Acct](${t.tradeUrl})`
        )
        .join("\n");
      const journalLinksMd = parsedJournals
        .slice(0, 8)
        .map((j: any) => `- [${j.slug} · ${j.title.replace(/[\[\]]/g, "")} · ${j.periodType.toUpperCase()}](${j.journalUrl})`)
        .join("\n");

      if (tradeLinksMd || journalLinksMd) {
        rawMarkdown += `\n\n---\n### 🔗 Direct Links to Referenced Journals & Trades\n${
          journalLinksMd ? `**Journals Analyzed:**\n${journalLinksMd}\n\n` : ""
        }${tradeLinksMd ? `**Trades Analyzed:**\n${tradeLinksMd}` : ""}`;
      }

      if (actionItems.length === 0) {
        actionItems = extractFallbackActionItems(rawMarkdown, horizon);
      }

      if (suggestedGoals.length === 0 && actionItems.length > 0) {
        suggestedGoals = actionItems.slice(0, 3).map((ai, idx) => ({
          horizon: idx === 0 ? "weekly" : idx === 1 ? "monthly" : "quarterly",
          periodLabel: idx === 0 ? "Next Week" : idx === 1 ? "Current Month" : "Current Quarter",
          title: ai.text,
          whyItMatters: "Derived from longitudinal audit action plan",
          targetMetric: ai.targetMetric,
        }));
      }

      const nowIso = new Date().toISOString();
      for (const audit of goalAudits) {
        if (audit.goalId) {
          db2.prepare(`
            UPDATE trader_goals
            SET status = COALESCE(?, status),
                progress_pct = COALESCE(?, progress_pct),
                ai_accountability_note = COALESCE(?, ai_accountability_note),
                updated_at = ?
            WHERE id = ?
          `).run(
            audit.status || null,
            typeof audit.progressPct === "number" ? audit.progressPct : null,
            audit.evidenceNote || null,
            nowIso,
            audit.goalId
          );
        }
      }

      db2.prepare(`
        UPDATE ai_coach_reports
        SET summary_md = ?,
            reasoning_trace = ?,
            telemetry_json = ?,
            suggested_goals_json = ?,
            accountability_json = ?,
            action_items_json = ?,
            model_used = ?
        WHERE id = ?
      `).run(
        rawMarkdown,
        aiRes.reasoning || latestStreamedReasoning || "",
        JSON.stringify({
          ...telemetry,
          verifiedPeriodTableMd: undefined,
          verifiedTradesLedgerMd: undefined,
          verifiedPlaybookTableMd: undefined,
          journalCompletionMatrixMd: undefined,
        }),
        JSON.stringify(suggestedGoals),
        JSON.stringify(goalAudits),
        JSON.stringify(actionItems),
        aiRes.model || "koboldcpp",
        reportId
      );

      db2.prepare(`
        UPDATE ai_background_jobs
        SET status = 'completed',
            result_json = ?,
            updated_at = ?
        WHERE id = ?
      `).run(JSON.stringify({ reportId, horizon }), nowIso, jobId);
    } finally {
      db2.close();
    }
  } catch (err: any) {
    const dbErr = getCoachDb();
    try {
      const isAborted = controller.signal.aborted || err?.name === "AbortError" || /Aborted/i.test(err?.message || "");
      // Flush any un-checkpointed tokens from liveStreamMemory to ai_coach_reports immediately on Stop/Abort!
      const memFlush = liveStreamMemory.get(jobId);
      if (memFlush && (memFlush.partialText?.trim() || memFlush.partialReasoning?.trim())) {
        dbErr
          .prepare(`UPDATE ai_coach_reports SET summary_md = ?, reasoning_trace = ? WHERE id = ?`)
          .run(
            memFlush.partialText.trim() ||
              `*(⚠️ Paused during <think> reasoning trace)*`,
            memFlush.partialReasoning || "",
            reportId
          );
      }
      const curRep = dbErr.prepare(`SELECT summary_md FROM ai_coach_reports WHERE id = ?`).get(reportId) as any;
      if (curRep && curRep.summary_md?.startsWith("*(⏳ Generating")) {
        dbErr.prepare(`UPDATE ai_coach_reports SET summary_md = ? WHERE id = ?`).run(
          `*(⚠️ Generation stopped before completion: ${err?.message || "Interrupted"}. Click **"Continue / Complete Report"** above to resume.)*`,
          reportId
        );
      }
      dbErr.prepare(`
        UPDATE ai_background_jobs
        SET status = ?,
            error_text = ?,
            result_json = ?,
            updated_at = ?
        WHERE id = ?
      `).run(
        isAborted ? "cancelled" : "failed",
        isAborted ? "Generation paused/cancelled by user." : err?.message || "Audit interrupted",
        JSON.stringify({ reportId, horizon }),
        new Date().toISOString(),
        jobId
      );
    } finally {
      dbErr.close();
    }
  } finally {
    activeJobControllers.delete(jobId);
    liveStreamMemory.delete(jobId);
    invalidateCoachCaches();
  }
}

async function processAuditQueue() {
  if (isQueueWorkerActive) return;
  isQueueWorkerActive = true;
  try {
    while (true) {
      const dbPath = resolveDbPath();
      const db = getCoachDb();
      let nextJob: any = null;
      try {
        ensureCoachTables(db);
        // If there is already a 'running' audit job that has an active controller, wait for it
        const runningRow = db
          .prepare(`SELECT id FROM ai_background_jobs WHERE status = 'running' AND job_type LIKE 'audit_%' LIMIT 1`)
          .get() as any;
        if (runningRow && activeJobControllers.has(runningRow.id)) {
          db.close();
          break;
        }
        nextJob = db
          .prepare(`SELECT * FROM ai_background_jobs WHERE status = 'queued' AND job_type LIKE 'audit_%' ORDER BY started_at ASC LIMIT 1`)
          .get() as any;
        if (nextJob) {
          db.prepare(`UPDATE ai_background_jobs SET status = 'running', updated_at = ? WHERE id = ?`).run(
            new Date().toISOString(),
            nextJob.id
          );
        }
      } finally {
        db.close();
      }

      if (!nextJob) {
        if (autoStopServerWhenQueueEmpty) {
          autoStopServerWhenQueueEmpty = false;
          await stopKoboldServerAfterQueue();
        }
        break;
      }

      let payload: { horizon: GoalHorizon; customScope?: CustomAuditScope } = {
        horizon: (nextJob.target_id as GoalHorizon) || "weekly",
      };
      try {
        const parsed = JSON.parse(nextJob.result_json || "{}");
        if (parsed.horizon) payload.horizon = parsed.horizon;
        if (parsed.customScope) payload.customScope = parsed.customScope;
      } catch {}

      const controller = new AbortController();
      activeJobControllers.set(nextJob.id, controller);

      await executeAuditJobInBackground(
        nextJob.id,
        payload.horizon,
        controller,
        payload.customScope
      );
    }
  } finally {
    isQueueWorkerActive = false;
  }
}

// Background Continuation Job for any Report that cut off mid-sentence
async function executeContinueReportJobInBackground(
  jobId: string,
  reportId: string,
  controller: AbortController
) {
  const dbPath = resolveDbPath();
  const db = getCoachDb();
  try {
    ensureCoachTables(db);
    const rep = db.prepare(`SELECT * FROM ai_coach_reports WHERE id = ?`).get(reportId) as any;
    if (!rep) {
      db.close();
      return;
    }

    // Strip any trailing Reference Links appendix before continuing the cut-off text
    const mainBody = String(rep.summary_md || "").split("\n\n---\n### 🔗 Direct Links")[0] || "";
    const appendix = String(rep.summary_md || "").includes("\n\n---\n### 🔗 Direct Links")
      ? "\n\n---\n### 🔗 Direct Links" + String(rep.summary_md || "").split("\n\n---\n### 🔗 Direct Links")[1]
      : "";

    const contPrompt = `Below is an in-progress Longitudinal Trading Psychology & Behavioral Performance Report that was cut off mid-sentence at the end.

=== EXISTING REPORT SO FAR ===
${mainBody.slice(-6000)}

=== INSTRUCTIONS ===
Continue writing seamlessly from the EXACT word where the text above cut off ("${mainBody.slice(-80)}").
Do NOT repeat what was already written. Complete any unfinished sentence/section, then write:
- **4. Concrete Action Plan & Next Steps (What to Work On Now)** (3 to 5 specific action steps)
- **5. Recommended Multi-Level Goals (Weekly -> Monthly -> Quarterly)**
And append a closing \`\`\`json block with "actionItems" and "suggestedGoals".`;

    db.close();

    const aiRes = await runKoboldAi(contPrompt, {
      persona: "coach",
      thinkingMode: "fast",
      autoContinue: false,
      maxOutputTokens: 4096,
      temperature: 0.6,
      abortSignal: controller.signal,
      onPartial: (partial) => {
        const mergedLive = `${mainBody.trimEnd()} ${stripTrailingJsonBlock(partial.text || "").trimStart()}`;
        const nowMs = Date.now();
        const lastWrite = liveStreamMemory.get(jobId)?.lastDbWriteMs || 0;
        liveStreamMemory.set(jobId, {
          reportId,
          title: `Completing: ${rep.title}`,
          partialText: mergedLive,
          partialReasoning: partial.reasoning || "",
          lastDbWriteMs: nowMs - lastWrite > 4000 ? nowMs : lastWrite,
        });
        if (nowMs - lastWrite > 4000) {
          try {
            const dbStream = getCoachDb();
            dbStream
              .prepare(`UPDATE ai_coach_reports SET summary_md = ? WHERE id = ?`)
              .run(mergedLive, reportId);
            dbStream
              .prepare(`UPDATE ai_background_jobs SET result_json = ?, updated_at = ? WHERE id = ? AND status = 'running'`)
              .run(
                JSON.stringify({
                  streaming: true,
                  reportId,
                  title: `Completing: ${rep.title}`,
                  partialText: mergedLive,
                }),
                new Date(nowMs).toISOString(),
                jobId
              );
          } catch {}
        }
      },
    });

    const db2 = getCoachDb();
    try {
      let contMd = aiRes.text;
      let existingActions: ReportActionItem[] = [];
      let existingGoals: any[] = [];
      try {
        existingActions = JSON.parse(rep.action_items_json || "[]");
      } catch {}
      try {
        existingGoals = JSON.parse(rep.suggested_goals_json || "[]");
      } catch {}

      const jsonMatch = contMd.match(/```json\s*([\s\S]*?)```/i);
      if (jsonMatch?.[1]) {
        try {
          const parsedJson = JSON.parse(jsonMatch[1].trim());
          if (Array.isArray(parsedJson.actionItems)) {
            const newActs = parsedJson.actionItems
              .map((ai: any, idx: number) => ({
                id: `act_${Date.now()}_${idx}`,
                text: String(ai.text || ai.title || ""),
                horizon: (ai.horizon as GoalHorizon) || rep.horizon || "weekly",
                targetMetric: String(ai.targetMetric || "Consistent execution"),
                done: false,
              }))
              .filter((a: ReportActionItem) => Boolean(a.text));
            existingActions = [...existingActions, ...newActs];
          }
          if (Array.isArray(parsedJson.suggestedGoals) && parsedJson.suggestedGoals.length > 0) {
            existingGoals = parsedJson.suggestedGoals;
          }
          contMd = contMd.replace(jsonMatch[0], "").trim();
        } catch {}
      }

      const mergedMd = `${mainBody.trimEnd()} ${contMd.trimStart()}${appendix}`;
      if (existingActions.length === 0) {
        existingActions = extractFallbackActionItems(mergedMd, (rep.horizon as GoalHorizon) || "weekly");
      }

      db2
        .prepare(
          `UPDATE ai_coach_reports SET summary_md = ?, action_items_json = ?, suggested_goals_json = ? WHERE id = ?`
        )
        .run(mergedMd, JSON.stringify(existingActions), JSON.stringify(existingGoals), reportId);

      db2
        .prepare(`UPDATE ai_background_jobs SET status = 'completed', result_json = ?, updated_at = ? WHERE id = ?`)
        .run(JSON.stringify({ reportId }), new Date().toISOString(), jobId);
    } finally {
      db2.close();
    }
  } catch (err: any) {
    const dbErr = getCoachDb();
    try {
      dbErr
        .prepare(`UPDATE ai_background_jobs SET status = 'failed', error_text = ?, updated_at = ? WHERE id = ?`)
        .run(err?.message || "Continuation failed", new Date().toISOString(), jobId);
    } finally {
      dbErr.close();
    }
  } finally {
    activeJobControllers.delete(jobId);
    liveStreamMemory.delete(jobId);
    invalidateCoachCaches();
  }
}

async function executeChatJobInBackground(
  jobId: string,
  sessionId: string,
  userMessage: string,
  controller: AbortController,
  customScope?: CustomAuditScope,
  linkedReportId?: string
) {
  const dbPath = resolveDbPath();
  const db = getCoachDb();
  try {
    ensureCoachTables(db);
    const { telemetry, parsedJournals, recentTradesSample } = buildBehavioralTelemetryAndJournals(
      db,
      "monthly",
      customScope
    );
    const activeGoals = db.prepare(`SELECT * FROM trader_goals ORDER BY updated_at DESC`).all() as any[];

    const targetReport = linkedReportId
      ? (db.prepare(`SELECT title, summary_md FROM ai_coach_reports WHERE id = ?`).get(linkedReportId) as any)
      : (db.prepare(`SELECT title, summary_md FROM ai_coach_reports ORDER BY created_at DESC LIMIT 1`).get() as any);

    const priorMsgs = db
      .prepare(
        `SELECT role, content FROM ai_chat_messages WHERE session_id = ? ORDER BY created_at ASC LIMIT 16`
      )
      .all(sessionId) as Array<{ role: string; content: string }>;

    const historyTranscript = priorMsgs
      .map((m) => `${m.role === "user" ? "TRADER" : "COACH"}: ${m.content}`)
      .join("\n\n");

    const chatPrompt = `You are the trader's dedicated Behavioral & Performance Accountability Coach.
You DO NOT judge their technical trading strategy or market model.
Note: The trader's standard full risk is ${telemetry.targetRiskPct}% of account equity (~$${telemetry.baseline1RUsd}). When they risk 0.5% of account, Trade R still reads as 1R, so evaluate risk sizing using \`accountRiskPct\` (% of account risked), not raw lot sizes or Trade R alone.
Whenever referencing a specific trade or journal entry, format it as a clickable Markdown link using the exact URL provided below.

=== ACTIVE TRADER GOALS ===
${activeGoals.length > 0 ? activeGoals.map((g) => `- [${g.horizon.toUpperCase()} | ${g.status.toUpperCase()}] ${g.title} (Metric: ${g.target_metric || "N/A"})`).join("\n") : "No active goals set yet."}

=== BEHAVIORAL TELEMETRY (ACCOUNT % RISK NORMALIZED) ===
${JSON.stringify(telemetry, null, 2)}

=== RECENT TRADES WITH CLICKABLE LINKS ===
${recentTradesSample.slice(0, 12).map((t: any) => `- [${t.symbol} ${t.direction} ${t.opened_at?.slice(0, 10)} ($${t.net_pnl} | Acct PnL: ${t.accountPnlPct}% | Risked: ${t.accountRiskPct ?? "?"}% Acct)](${t.tradeUrl})`).join("\n")}

=== JOURNAL REFLECTIONS IN CONTEXT (${parsedJournals.length} ENTRIES) ===
${parsedJournals.slice(0, 8).map((j: any) => `[${j.slug} | ${j.title}](${j.journalUrl})\nLessons: ${j.lessonsLearned}\nQ&A Quotes: ${JSON.stringify(j.qaReflections)}\nReview: ${j.reviewSummary}`).join("\n---\n")}

${targetReport ? `=== REFERENCED AI AUDIT REPORT (${targetReport.title}) ===\n${targetReport.summary_md.slice(0, 3200)}` : ""}

=== CONVERSATION HISTORY IN THIS SESSION ===
${historyTranscript}

Respond directly, candidly, and empathetically as a peer accountability partner to the trader's latest message.`;

    db.close();

    const aiRes = await runKoboldAi(chatPrompt, {
      persona: "coach",
      thinkingMode: customScope?.thinkingMode || "fast",
      maxOutputTokens: 3500,
      temperature: 0.6,
      abortSignal: controller.signal,
      onPartial: (partial) => {
        const nowMs = Date.now();
        const lastWrite = liveStreamMemory.get(jobId)?.lastDbWriteMs || 0;
        liveStreamMemory.set(jobId, {
          sessionId,
          reportId: linkedReportId || "",
          partialText: partial.text || "",
          partialReasoning: partial.reasoning || "",
          lastDbWriteMs: nowMs - lastWrite > 4000 ? nowMs : lastWrite,
        });
        if (nowMs - lastWrite > 4000) {
          try {
            const dbStream = getCoachDb();
            dbStream
              .prepare(`UPDATE ai_background_jobs SET result_json = ?, updated_at = ? WHERE id = ? AND status = 'running'`)
              .run(
                JSON.stringify({
                  streaming: true,
                  sessionId,
                  reportId: linkedReportId || "",
                  partialText: partial.text,
                  partialReasoning: partial.reasoning,
                }),
                new Date(nowMs).toISOString(),
                jobId
              );
          } catch {}
        }
      },
    });

    const db2 = getCoachDb();
    try {
      const jobRow = db2.prepare(`SELECT status FROM ai_background_jobs WHERE id = ?`).get(jobId) as any;
      if (jobRow?.status === "cancelled") return;

      const nowIso = new Date().toISOString();
      const msgId = `msg_${Date.now()}_coach`;
      const finalReply = aiRes.text.trim() || aiRes.reasoning.trim() || "(No response generated)";
      db2.prepare(`
        INSERT INTO ai_chat_messages (id, session_id, role, content, reasoning, model_used, created_at)
        VALUES (?, ?, 'coach', ?, ?, ?, ?)
      `).run(msgId, sessionId, finalReply, aiRes.reasoning || "", aiRes.model || "koboldcpp", nowIso);

      db2.prepare(`UPDATE ai_chat_sessions SET updated_at = ? WHERE id = ?`).run(nowIso, sessionId);

      db2.prepare(`
        UPDATE ai_background_jobs
        SET status = 'completed',
            result_json = ?,
            updated_at = ?
        WHERE id = ?
      `).run(JSON.stringify({ sessionId, reportId: linkedReportId || "", messageId: msgId }), nowIso, jobId);
    } finally {
      db2.close();
    }
  } catch (err: any) {
    const dbErr = getCoachDb();
    try {
      const isAborted = controller.signal.aborted || err?.name === "AbortError";
      dbErr.prepare(`
        UPDATE ai_background_jobs
        SET status = ?,
            error_text = ?,
            updated_at = ?
        WHERE id = ?
      `).run(
        isAborted ? "cancelled" : "failed",
        isAborted ? "Cancelled by user." : err?.message || "Coach chat failed",
        new Date().toISOString(),
        jobId
      );
    } finally {
      dbErr.close();
    }
  } finally {
    activeJobControllers.delete(jobId);
    liveStreamMemory.delete(jobId);
    invalidateCoachCaches();
  }
}

export async function GET(req: NextRequest) {
  const db = getCoachDb();
  try {
    ensureCoachTables(db);
    const isPollOnly = req.nextUrl.searchParams.get("poll") === "1";

    const activeJobsRaw = db
      .prepare(`SELECT id, job_type as jobType, target_id as targetId, label, status, result_json as resultJson, started_at as startedAt FROM ai_background_jobs WHERE status IN ('running', 'queued') ORDER BY CASE WHEN status = 'running' THEN 0 ELSE 1 END, started_at ASC`)
      .all() as any[];

    const activeJobs = activeJobsRaw.map((j) => {
      const mem = liveStreamMemory.get(j.id);
      let streamData: any = {};
      if (!mem) {
        try {
          streamData = JSON.parse(j.resultJson || "{}");
        } catch {}
      }
      return {
        id: j.id,
        jobType: j.jobType,
        targetId: j.targetId,
        reportId: mem?.reportId || streamData.reportId || "",
        label: mem?.title || j.label,
        status: j.status,
        startedAt: j.startedAt,
        partialText: mem ? mem.partialText : streamData.partialText || "",
        partialReasoning: mem ? mem.partialReasoning : streamData.partialReasoning || "",
      };
    });

    // ULTRA-FAST POLL PATH (<0.5ms CPU, 0 HTML parses, 0 trade scans, 0 network pings!)
    if (isPollOnly) {
      return NextResponse.json({
        ok: true,
        pollOnly: true,
        autoStopAfterQueue: autoStopServerWhenQueueEmpty,
        activeJobs,
      });
    }

    const localSettings = loadLocalAiSettings();
    const status = await probeKoboldStatusCached(localSettings.baseUrl);
    const auditDue = computeAuditDueStatus(db);

    const staleCutoff = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
    db.prepare(`
      UPDATE ai_background_jobs
      SET status = 'failed', error_text = 'Orphaned after server restart'
      WHERE status = 'running' AND started_at < ?
    `).run(staleCutoff);

    // Separate general standalone Coach Chats (report_id = '') from Report-embedded Q&A threads
    const allChatSessions = db
      .prepare(`SELECT id, title, report_id as reportId, created_at as createdAt, updated_at as updatedAt FROM ai_chat_sessions ORDER BY updated_at DESC LIMIT 80`)
      .all() as any[];

    const standaloneChatSessions = allChatSessions.filter((s) => !s.reportId);

    const reqSessionId =
      req.nextUrl.searchParams.get("sessionId") || standaloneChatSessions[0]?.id || "";
    const chatMessages = reqSessionId
      ? (db
          .prepare(
            `SELECT id, session_id as sessionId, role, content as text, reasoning, model_used as modelUsed, created_at as createdAt
             FROM ai_chat_messages
             WHERE session_id = ?
             ORDER BY created_at ASC`
          )
          .all(reqSessionId) as any[])
      : [];

    // Single JOIN query for all report-bound Q&A messages (eliminates N+1 query loop!)
    const reportCommentsMap: Record<string, any[]> = {};
    const joinedReportMsgs = db
      .prepare(
        `SELECT m.id, m.session_id as sessionId, s.report_id as reportId, m.role, m.content as text,
                m.reasoning, m.model_used as modelUsed, m.created_at as createdAt
         FROM ai_chat_messages m
         INNER JOIN ai_chat_sessions s ON s.id = m.session_id
         WHERE s.report_id != ''
         ORDER BY m.created_at ASC`
      )
      .all() as any[];

    for (const msg of joinedReportMsgs) {
      const rId = msg.reportId;
      if (!reportCommentsMap[rId]) reportCommentsMap[rId] = [];
      reportCommentsMap[rId]!.push(msg);
    }

    const goals = db
      .prepare(`SELECT * FROM trader_goals ORDER BY updated_at DESC`)
      .all() as any[];

    const reports = db
      .prepare(`SELECT * FROM ai_coach_reports ORDER BY created_at DESC LIMIT 50`)
      .all() as any[];

    const nowMs = Date.now();
    const currentDbSig = getSqliteStateSignature(db);
    if (
      !cachedDefaultTelemetry ||
      cachedDefaultTelemetry.dbVersionKey !== currentDbSig ||
      nowMs - cachedDefaultTelemetry.ts > 60_000
    ) {
      cachedDefaultTelemetry = {
        dbVersionKey: currentDbSig,
        ts: nowMs,
        data: buildBehavioralTelemetryAndJournals(db, "monthly"),
      };
    }
    const { telemetry, selectableJournals, selectableTrades } = cachedDefaultTelemetry.data;

    return NextResponse.json({
      ok: true,
      autoStopAfterQueue: autoStopServerWhenQueueEmpty,
      kobold: { ...localSettings, ...status },
      auditDue,
      telemetry,
      selectableJournals,
      selectableTrades,
      activeJobs,
      chatSessions: standaloneChatSessions,
      activeSessionId: reqSessionId,
      chatMessages,
      reportCommentsMap,
      goals: goals.map((g) => {
        let steps: GoalStep[] = [];
        try {
          steps = JSON.parse(g.steps_json || "[]");
        } catch {}
        return {
          id: g.id,
          horizon: g.horizon,
          periodLabel: g.period_label,
          title: g.title,
          whyItMatters: g.why_it_matters,
          targetMetric: g.target_metric,
          status: g.status,
          progressPct: g.progress_pct,
          steps,
          aiAccountabilityNote: g.ai_accountability_note,
          createdAt: g.created_at,
          updatedAt: g.updated_at,
        };
      }),
      reports: reports.map((r) => {
        const parsedActions: ReportActionItem[] = JSON.parse(r.action_items_json || "[]");
        const finalActions =
          parsedActions.length > 0
            ? parsedActions
            : extractFallbackActionItems(r.summary_md || "", (r.horizon as GoalHorizon) || "weekly");
        return {
          id: r.id,
          horizon: r.horizon,
          periodKey: r.period_key,
          title: r.title,
          summaryMd: r.summary_md,
          reasoningTrace: r.reasoning_trace,
          telemetry: JSON.parse(r.telemetry_json || "{}"),
          suggestedGoals: JSON.parse(r.suggested_goals_json || "[]"),
          accountability: JSON.parse(r.accountability_json || "[]"),
          actionItems: finalActions,
          modelUsed: r.model_used,
          createdAt: r.created_at,
        };
      }),
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message }, { status: 500 });
  } finally {
    db.close();
  }
}

export async function POST(req: NextRequest) {
  const dbPath = resolveDbPath();
  const db = getCoachDb();
  try {
    ensureCoachTables(db);
    const body = await req.json().catch(() => ({}));
    const action = body.action || "generate_report";
    if (action !== "inspect_evidence" && action !== "scan_models" && action !== "daemon_status") {
      invalidateCoachCaches();
    }

    if (action === "scan_models" || action === "daemon_status") {
      const settings = loadLocalAiSettings();
      const targetDir = String(body.dir || settings.modelsDir || "~/koboldcpp/models").trim();
      const daemonUrl = getControlDaemonUrl(body.baseUrl || settings.baseUrl);

      try {
        const dRes = await fetch(daemonUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "scan", modelsDir: targetDir }),
          signal: AbortSignal.timeout(3500),
        });
        if (dRes.ok) {
          const dJson = await dRes.json();
          const stRes = await fetch(daemonUrl, { signal: AbortSignal.timeout(2500) });
          const stJson = stRes.ok ? await stRes.json() : {};
          saveLocalAiSettings({ modelsDir: targetDir });
          return NextResponse.json({
            ok: true,
            daemonOnline: true,
            modelsDir: targetDir,
            models: dJson.models || [],
            daemonState: stJson.state || dJson.state || {},
            processRunning: Boolean(stJson.processRunning),
            loading: Boolean(stJson.loading),
            online: Boolean(stJson.online),
            loadedModel: stJson.loadedModel || "",
            logTail: stJson.logTail || "",
            activeJobs: db
              .prepare("SELECT id, job_type as jobType, label, started_at as startedAt FROM ai_background_jobs WHERE status = 'running'")
              .all(),
          });
        }
      } catch {}

      let resolvedLocalDir = targetDir;
      if (resolvedLocalDir.startsWith("~")) {
        resolvedLocalDir = resolvedLocalDir.replace(/^~/, process.env.HOME || process.env.USERPROFILE || "/home/mark");
      }
      const ggufFiles: Array<{ name: string; sizeMb: number }> = [];
      if (fs.existsSync(resolvedLocalDir)) {
        try {
          for (const ent of fs.readdirSync(resolvedLocalDir, { withFileTypes: true })) {
            if (ent.isFile() && ent.name.toLowerCase().endsWith(".gguf")) {
              const stat = fs.statSync(path.join(resolvedLocalDir, ent.name));
              ggufFiles.push({
                name: ent.name,
                sizeMb: Math.round((stat.size / (1024 * 1024)) * 10) / 10,
              });
            }
          }
        } catch {}
      }
      saveLocalAiSettings({ modelsDir: targetDir });
      return NextResponse.json({
        ok: true,
        daemonOnline: false,
        modelsDir: targetDir,
        models: ggufFiles,
      });
    }

    if (action === "control_kobold") {
      const settings = loadLocalAiSettings();
      const baseUrl = String(body.baseUrl || settings.baseUrl || "[http://100.75.201.34:5001](http://100.75.201.34:5001)").trim();
      const daemonUrl = getControlDaemonUrl(baseUrl);
      const command: "start" | "stop" | "save_state" = body.command || "start";
      const launchState = body.launchState || {};

      if (launchState.modelFile) {
        saveLocalAiSettings({ activeModelFile: launchState.modelFile, baseUrl });
      }

      try {
        const dRes = await fetch(daemonUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: command,
            state: launchState,
          }),
          signal: AbortSignal.timeout(6000),
        });
        const dJson = await dRes.json();
        const stRes = await fetch(daemonUrl, { signal: AbortSignal.timeout(2500) }).catch(() => null);
        const stJson = stRes && stRes.ok ? await stRes.json() : {};
        return NextResponse.json({
          ok: true,
          message: dJson.message || `Command '${command}' sent to desktop.`,
          daemonState: stJson.state || dJson.state || launchState,
          processRunning: Boolean(stJson.processRunning),
          loading: Boolean(stJson.loading),
          online: Boolean(stJson.online),
          logTail: stJson.logTail || "",
        });
      } catch {
        return NextResponse.json(
          {
            ok: false,
            error: `Could not reach Desktop Control Daemon at ${daemonUrl}.`,
          },
          { status: 502 }
        );
      }
    }

    if (action === "set_active_model") {
      const modelFile = String(body.modelFile || "").trim();
      const settings = loadLocalAiSettings();
      saveLocalAiSettings({ activeModelFile: modelFile });
      const daemonUrl = getControlDaemonUrl(settings.baseUrl);
      try {
        await fetch(daemonUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "save_state", state: { modelFile } }),
          signal: AbortSignal.timeout(3000),
        });
      } catch {}
      return NextResponse.json({ ok: true, activeModelFile: modelFile });
    }

    if (action === "save_kobold_config") {
      const patch: any = {
        mode: "local_kobold",
        baseUrl: String(body.baseUrl || "[http://100.75.201.34:5001](http://100.75.201.34:5001)").trim(),
      };
      if (body.baselineRiskPct !== undefined) {
        patch.baselineRiskPct = Number(body.baselineRiskPct);
      }
      if (body.accountBalanceOverride !== undefined) {
        patch.accountBalanceOverride = Number(body.accountBalanceOverride);
      }
      const saved = saveLocalAiSettings(patch);
      const status = await probeKoboldStatus(saved.baseUrl);
      return NextResponse.json({ ok: true, kobold: { ...saved, ...status } });
    }

    // REPORT ACTION ITEMS: TOGGLE / ADD / EDIT / DELETE
    if (action === "toggle_report_action") {
      const reportId = String(body.reportId || "");
      const actionId = String(body.actionId || "");
      const done = Boolean(body.done);
      const row = db
        .prepare(`SELECT summary_md, horizon, action_items_json FROM ai_coach_reports WHERE id = ?`)
        .get(reportId) as any;
      if (row) {
        let items: ReportActionItem[] = [];
        try {
          items = JSON.parse(row.action_items_json || "[]");
        } catch {}
        if (items.length === 0) {
          items = extractFallbackActionItems(row.summary_md || "", row.horizon || "weekly");
        }
        items = items.map((it) => (it.id === actionId ? { ...it, done } : it));
        db.prepare(`UPDATE ai_coach_reports SET action_items_json = ? WHERE id = ?`).run(
          JSON.stringify(items),
          reportId
        );
      }
      return NextResponse.json({ ok: true });
    }

    if (action === "edit_report_action") {
      const reportId = String(body.reportId || "");
      const actionId = String(body.actionId || "");
      const newText = String(body.text || "").trim();
      const row = db
        .prepare(`SELECT summary_md, horizon, action_items_json FROM ai_coach_reports WHERE id = ?`)
        .get(reportId) as any;
      if (row && newText) {
        let items: ReportActionItem[] = [];
        try {
          items = JSON.parse(row.action_items_json || "[]");
        } catch {}
        if (items.length === 0) {
          items = extractFallbackActionItems(row.summary_md || "", row.horizon || "weekly");
        }
        items = items.map((it) => (it.id === actionId ? { ...it, text: newText } : it));
        db.prepare(`UPDATE ai_coach_reports SET action_items_json = ? WHERE id = ?`).run(
          JSON.stringify(items),
          reportId
        );
      }
      return NextResponse.json({ ok: true });
    }

    if (action === "delete_report_action") {
      const reportId = String(body.reportId || "");
      const actionId = String(body.actionId || "");
      const row = db
        .prepare(`SELECT summary_md, horizon, action_items_json FROM ai_coach_reports WHERE id = ?`)
        .get(reportId) as any;
      if (row) {
        let items: ReportActionItem[] = [];
        try {
          items = JSON.parse(row.action_items_json || "[]");
        } catch {}
        if (items.length === 0) {
          items = extractFallbackActionItems(row.summary_md || "", row.horizon || "weekly");
        }
        items = items.filter((it) => it.id !== actionId);
        db.prepare(`UPDATE ai_coach_reports SET action_items_json = ? WHERE id = ?`).run(
          JSON.stringify(items),
          reportId
        );
      }
      return NextResponse.json({ ok: true });
    }

    if (action === "add_report_action") {
      const reportId = String(body.reportId || "");
      const text = String(body.text || "").trim();
      const horizon: GoalHorizon = body.horizon || "weekly";
      if (reportId && text) {
        const row = db
          .prepare(`SELECT summary_md, horizon, action_items_json FROM ai_coach_reports WHERE id = ?`)
          .get(reportId) as any;
        if (row) {
          let items: ReportActionItem[] = [];
          try {
            items = JSON.parse(row.action_items_json || "[]");
          } catch {}
          if (items.length === 0) {
            items = extractFallbackActionItems(row.summary_md || "", row.horizon || "weekly");
          }
          items.push({
            id: `act_${Date.now()}`,
            text,
            horizon,
            targetMetric: String(body.targetMetric || "Action step"),
            done: false,
          });
          db.prepare(`UPDATE ai_coach_reports SET action_items_json = ? WHERE id = ?`).run(
            JSON.stringify(items),
            reportId
          );
        }
      }
      return NextResponse.json({ ok: true });
    }

    // CONTINUE / COMPLETE A TRUNCATED REPORT
    if (action === "continue_report") {
      const reportId = String(body.reportId || "");
      if (!reportId) {
        return NextResponse.json({ ok: false, error: "reportId required" }, { status: 400 });
      }
      const nowIso = new Date().toISOString();
      const jobId = `job_audit_continue_${Date.now()}`;
      db.prepare(`
        INSERT INTO ai_background_jobs (id, job_type, target_id, label, status, started_at, updated_at)
        VALUES (?, 'audit_continue', ?, 'Completing Report Sections...', 'running', ?, ?)
      `).run(jobId, reportId, nowIso, nowIso);

      const controller = new AbortController();
      activeJobControllers.set(jobId, controller);
      void executeContinueReportJobInBackground(jobId, reportId, controller);

      return NextResponse.json({ ok: true, background: true, jobId, reportId });
    }

    // INSPECT JOURNAL OR TRADE EVIDENCE SIDE-BY-SIDE WITHOUT LEAVING REPORT
    if (action === "inspect_evidence") {
      const href = String(body.href || "").trim();
      if (href.startsWith("/journal")) {
        const u = new URL(href, "http://localhost");
        const slug = u.searchParams.get("slug") || "";
        const jRow = db
          .prepare(
            `SELECT slug, period_type, title, content, review_content, lessons_learned, rating, scores_json, updated_at
             FROM journal_entries WHERE slug = ?`
          )
          .get(slug) as any;
        if (!jRow) {
          return NextResponse.json({ ok: false, error: `Journal '${slug}' not found.` }, { status: 404 });
        }
        const prepDigest = htmlToStructuredDigest(jRow.content || "");
        const revDigest = htmlToStructuredDigest(jRow.review_content || "");
        return NextResponse.json({
          ok: true,
          evidenceType: "journal",
          href,
          journal: {
            slug: jRow.slug,
            periodType: jRow.period_type,
            title: jRow.title,
            rating: jRow.rating,
            lessonsLearned: jRow.lessons_learned || "",
            prepMd: prepDigest.cleanText || "*(No Prep content recorded)*",
            reviewMd: revDigest.cleanText || "*(No Review content recorded)*",
            qaReflections: [...prepDigest.qaReflections, ...revDigest.qaReflections],
            updatedAt: jRow.updated_at,
          },
        });
      }

      if (href.startsWith("/trades")) {
        const u = new URL(href, "http://localhost");
        const symbol = u.searchParams.get("symbol") || "";
        const fromDate = u.searchParams.get("from") || "";
        const toDate = u.searchParams.get("to") || fromDate;
        const qRes = queryTrades({});
        const matching = (qRes.trades || []).filter((t: any) => {
          const d = String(t.openedAt || "").slice(0, 10);
          const symMatch = !symbol || t.symbol === symbol;
          const dateMatch = !fromDate || (d >= fromDate && d <= toDate);
          return symMatch && dateMatch;
        });
        return NextResponse.json({
          ok: true,
          evidenceType: "trades",
          href,
          symbol,
          fromDate,
          trades: matching.map((t: any) => ({
            key: t.key,
            symbol: t.symbol,
            direction: t.direction,
            openedAt: t.openedAt,
            closedAt: t.closedAt,
            quantity: t.quantity,
            netPnl: t.netPnl,
            realizedR: t.realizedR,
            notes: (t.notes || "").replace(/<[^>]+>/g, " ").trim(),
            tags: t.annotations?.tags || [],
            mistakes: t.annotations?.mistakes || [],
            playbook: t.annotations?.playbook || "",
          })),
        });
      }

      return NextResponse.json({ ok: false, error: "Unsupported evidence link" }, { status: 400 });
    }

    // PUSH ACTIVE GOALS & REPORT ACTION ITEMS DIRECTLY INTO CURRENT WEEKLY OR DAILY JOURNAL PREP TAB
    if (action === "push_actions_to_journal") {
      const reportId = String(body.reportId || "");
      const targetPeriod: "week" | "day" = body.targetPeriod === "day" ? "day" : "week";
      const now = new Date();
      const todayIso = now.toISOString().slice(0, 10);

      // Find the most recent Weekly or Daily journal entry in journal_entries
      let targetRow = db
        .prepare(
          `SELECT slug, title, content FROM journal_entries WHERE period_type = ? ORDER BY slug DESC LIMIT 1`
        )
        .get(targetPeriod) as { slug: string; title: string; content: string } | undefined;

      if (!targetRow) {
        const slug = targetPeriod === "day" ? `day-${todayIso}` : `week-${todayIso}`;
        const title =
          targetPeriod === "day" ? `Daily Journal (${todayIso})` : `Weekly Journal (${todayIso})`;
        db.prepare(
          `INSERT INTO journal_entries (slug, period_type, title, content, review_content, updated_at)
           VALUES (?, ?, ?, '', '', ?)`
        ).run(slug, targetPeriod, title, now.toISOString());
        targetRow = { slug, title, content: "" };
      }

      const activeGoals = db
        .prepare(`SELECT horizon, title, target_metric FROM trader_goals WHERE status != 'completed' ORDER BY updated_at DESC LIMIT 6`)
        .all() as Array<{ horizon: string; title: string; target_metric: string }>;

      let reportActions: ReportActionItem[] = [];
      let reportTitle = "AI Accountability Coach";
      if (reportId) {
        const rep = db
          .prepare(`SELECT title, summary_md, horizon, action_items_json FROM ai_coach_reports WHERE id = ?`)
          .get(reportId) as any;
        if (rep) {
          reportTitle = rep.title;
          try {
            reportActions = JSON.parse(rep.action_items_json || "[]");
          } catch {}
          if (reportActions.length === 0) {
            reportActions = extractFallbackActionItems(rep.summary_md || "", rep.horizon || "weekly");
          }
        }
      }

      const goalItemsHtml = activeGoals
        .map(
          (g) =>
            `<li><strong>[${g.horizon.toUpperCase()} GOAL]</strong> ${g.title}${
              g.target_metric ? ` <em>(Rule: ${g.target_metric})</em>` : ""
            }</li>`
        )
        .join("");

      const actionItemsHtml = reportActions
        .filter((a) => !a.done)
        .map(
          (a) =>
            `<div class="tz-check-row"><input type="checkbox" /> <span><strong>[Action Step]</strong> ${a.text}</span></div>`
        )
        .join("");

      const focusBlockHtml = `<div class="tz-callout" data-coach-sync="true" style="border-left: 4px solid #6366f1; background: rgba(99,102,241,0.08); padding: 12px 16px; margin-bottom: 16px; border-radius: 8px;">
  <p><strong>🎯 Active AI Coach Focus &amp; Pre-Session Rules (Synced ${todayIso} from ${reportTitle})</strong></p>
  ${goalItemsHtml ? `<ul>${goalItemsHtml}</ul>` : ""}
  ${actionItemsHtml || "<p><em>No pending action items.</em></p>"}
</div>`;

      // Replace existing synced block if present, otherwise prepend to top of Prep content
      const existingContent = targetRow.content || "";
      const cleanedContent = existingContent.replace(
        /<div class="tz-callout" data-coach-sync="true"[\s\S]*?<\/div>\s*/i,
        ""
      );
      const updatedContent = `${focusBlockHtml}
${cleanedContent}`;

      db.prepare(`UPDATE journal_entries SET content = ?, updated_at = ? WHERE slug = ?`).run(
        updatedContent,
        now.toISOString(),
        targetRow.slug
      );

      return NextResponse.json({
        ok: true,
        slug: targetRow.slug,
        title: targetRow.title,
        message: `Synced ${activeGoals.length} goals and ${reportActions.filter((a) => !a.done).length} action items into ${targetRow.title}!`,
      });
    }

    // APPEND SOCRATIC DEBRIEF REFLECTION DIRECTLY INTO CURRENT WEEKLY JOURNAL REVIEW TAB
    if (action === "append_to_journal_review") {
      const reflectionText = String(body.text || "").trim();
      const promptQuestion = String(body.question || "AI Coach Reflection Debrief").trim();
      if (!reflectionText) {
        return NextResponse.json({ ok: false, error: "Reflection text is empty" }, { status: 400 });
      }
      const now = new Date();
      const todayIso = now.toISOString().slice(0, 10);

      let targetRow = db
        .prepare(
          `SELECT slug, title, review_content FROM journal_entries WHERE period_type IN ('week', 'day') ORDER BY CASE WHEN period_type = 'week' THEN 0 ELSE 1 END, slug DESC LIMIT 1`
        )
        .get() as { slug: string; title: string; review_content: string } | undefined;

      if (!targetRow) {
        const slug = `week-${todayIso}`;
        const title = `Weekly Journal (${todayIso})`;
        db.prepare(
          `INSERT INTO journal_entries (slug, period_type, title, content, review_content, updated_at)
           VALUES (?, 'week', ?, '', '', ?)`
        ).run(slug, title, now.toISOString());
        targetRow = { slug, title, review_content: "" };
      }

      const appendedHtml = `
<hr/>
<h3>🧠 Coach Debrief Reflection (${todayIso})</h3>
<p><strong>Context:</strong> ${promptQuestion.slice(0, 220)}</p>
<blockquote>${reflectionText.split(String.fromCharCode(10)).join("<br/>")}</blockquote>
`;
      const nextReview = `${targetRow.review_content || ""}${appendedHtml}`;

      db.prepare(`UPDATE journal_entries SET review_content = ?, updated_at = ? WHERE slug = ?`).run(
        nextReview,
        now.toISOString(),
        targetRow.slug
      );

      return NextResponse.json({
        ok: true,
        slug: targetRow.slug,
        title: targetRow.title,
        message: `Saved reflection to ${targetRow.title} Review tab!`,
      });
    }

    // SAVE JOURNAL ENTRY QUICK EDIT FROM SIDE-TAB DRAWER
    if (action === "save_journal_quick_edit") {
      const slug = String(body.slug || "").trim();
      if (!slug) {
        return NextResponse.json({ ok: false, error: "Journal slug is required" }, { status: 400 });
      }
      const nowIso = new Date().toISOString();
      const existing = db
        .prepare(`SELECT slug, content, review_content, lessons_learned, rating FROM journal_entries WHERE slug = ?`)
        .get(slug) as any;

      const appendNoteToHtml = (origHtml: string, newNote: string, label: string) => {
        if (!newNote.trim()) return origHtml;
        const formatted = newNote
          .trim()
          .split(String.fromCharCode(10))
          .map((line) => `<p>${line}</p>`)
          .join("");
        return `${origHtml || ""}
<div class="tz-callout" style="border-left: 3px solid #10b981; padding: 8px 12px; margin-top: 10px;"><p><strong>✍️ ${label} (${nowIso.slice(0, 10)}):</strong></p>${formatted}</div>`;
      };

      const nextPrep =
        body.prepNoteToAppend !== undefined
          ? appendNoteToHtml(existing?.content || "", String(body.prepNoteToAppend), "Prep Note")
          : existing?.content || "";
      const nextReview =
        body.reviewNoteToAppend !== undefined
          ? appendNoteToHtml(existing?.review_content || "", String(body.reviewNoteToAppend), "Review Reflection")
          : existing?.review_content || "";
      const nextLessons =
        body.lessonsLearned !== undefined ? String(body.lessonsLearned) : existing?.lessons_learned || "";
      const nextRating =
        body.rating !== undefined && body.rating !== null && body.rating !== ""
          ? Number(body.rating)
          : existing?.rating ?? null;

      if (existing) {
        db.prepare(
          `UPDATE journal_entries
           SET content = ?, review_content = ?, lessons_learned = ?, rating = ?, updated_at = ?
           WHERE slug = ?`
        ).run(nextPrep, nextReview, nextLessons, nextRating, nowIso, slug);
      } else {
        const periodType = slug.startsWith("week-")
          ? "week"
          : slug.startsWith("month-")
          ? "month"
          : slug.startsWith("quarter-")
          ? "quarter"
          : slug.startsWith("year-")
          ? "year"
          : "day";
        db.prepare(
          `INSERT INTO journal_entries (slug, period_type, title, content, review_content, lessons_learned, rating, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(slug, periodType, slug, nextPrep, nextReview, nextLessons, nextRating, nowIso);
      }

      return NextResponse.json({ ok: true, slug });
    }

    if (action === "upsert_goal") {
      const nowIso = new Date().toISOString();
      const id = body.id || `goal_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const horizon: GoalHorizon = body.horizon || "weekly";
      const periodLabel =
        body.periodLabel ||
        (horizon === "weekly"
          ? "Current Week"
          : horizon === "monthly"
          ? "Current Month"
          : "Current Quarter");
      const title = String(body.title || "").trim();
      if (!title) {
        return NextResponse.json({ ok: false, error: "Goal title is required" }, { status: 400 });
      }

      let existingSteps: GoalStep[] = [];
      if (body.id) {
        const row = db.prepare(`SELECT steps_json FROM trader_goals WHERE id = ?`).get(body.id) as any;
        if (row?.steps_json) {
          try {
            existingSteps = JSON.parse(row.steps_json);
          } catch {}
        }
      }

      const steps: GoalStep[] = Array.isArray(body.steps)
        ? body.steps
            .map((s: any, idx: number) =>
              typeof s === "string"
                ? { id: `st_${Date.now()}_${idx}`, text: s.trim(), done: false }
                : {
                    id: String(s.id || `st_${Date.now()}_${idx}`),
                    text: String(s.text || "").trim(),
                    done: Boolean(s.done),
                  }
            )
            .filter((s: GoalStep) => Boolean(s.text))
        : existingSteps;

      const computedPct =
        steps.length > 0
          ? Math.round((steps.filter((s) => s.done).length / steps.length) * 100)
          : Number(body.progressPct ?? 0);

      const computedStatus: GoalStatus =
        steps.length > 0 && steps.every((s) => s.done)
          ? "completed"
          : (body.status as GoalStatus) || "on_track";

      db.prepare(`
        INSERT INTO trader_goals (
          id, horizon, period_label, title, why_it_matters, target_metric,
          status, progress_pct, steps_json, ai_accountability_note, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          horizon = excluded.horizon,
          period_label = excluded.period_label,
          title = excluded.title,
          why_it_matters = excluded.why_it_matters,
          target_metric = excluded.target_metric,
          status = excluded.status,
          progress_pct = excluded.progress_pct,
          steps_json = excluded.steps_json,
          ai_accountability_note = excluded.ai_accountability_note,
          updated_at = excluded.updated_at
      `).run(
        id,
        horizon,
        periodLabel,
        title,
        String(body.whyItMatters || ""),
        String(body.targetMetric || ""),
        computedStatus,
        computedPct,
        JSON.stringify(steps),
        String(body.aiAccountabilityNote || ""),
        nowIso,
        nowIso
      );
      return NextResponse.json({ ok: true, id });
    }

    if (action === "toggle_goal_step") {
      const goalId = String(body.goalId || "");
      const stepId = String(body.stepId || "");
      const done = Boolean(body.done);
      const row = db.prepare(`SELECT status, steps_json FROM trader_goals WHERE id = ?`).get(goalId) as any;
      if (row) {
        let steps: GoalStep[] = [];
        try {
          steps = JSON.parse(row.steps_json || "[]");
        } catch {}
        steps = steps.map((s) => (s.id === stepId ? { ...s, done } : s));
        const pct =
          steps.length > 0
            ? Math.round((steps.filter((s) => s.done).length / steps.length) * 100)
            : 0;
        const nextStatus =
          steps.length > 0 && steps.every((s) => s.done)
            ? "completed"
            : row.status === "completed"
            ? "on_track"
            : row.status;
        db.prepare(
          `UPDATE trader_goals SET steps_json = ?, progress_pct = ?, status = ?, updated_at = ? WHERE id = ?`
        ).run(JSON.stringify(steps), pct, nextStatus, new Date().toISOString(), goalId);
      }
      return NextResponse.json({ ok: true });
    }

    if (action === "add_goal_step") {
      const goalId = String(body.goalId || "");
      const text = String(body.text || "").trim();
      const row = db.prepare(`SELECT steps_json FROM trader_goals WHERE id = ?`).get(goalId) as any;
      if (row && text) {
        let steps: GoalStep[] = [];
        try {
          steps = JSON.parse(row.steps_json || "[]");
        } catch {}
        steps.push({ id: `st_${Date.now()}`, text, done: false });
        const pct = Math.round((steps.filter((s) => s.done).length / steps.length) * 100);
        db.prepare(
          `UPDATE trader_goals SET steps_json = ?, progress_pct = ?, updated_at = ? WHERE id = ?`
        ).run(JSON.stringify(steps), pct, new Date().toISOString(), goalId);
      }
      return NextResponse.json({ ok: true });
    }

    if (action === "delete_goal_step") {
      const goalId = String(body.goalId || "");
      const stepId = String(body.stepId || "");
      const row = db.prepare(`SELECT steps_json FROM trader_goals WHERE id = ?`).get(goalId) as any;
      if (row) {
        let steps: GoalStep[] = [];
        try {
          steps = JSON.parse(row.steps_json || "[]");
        } catch {}
        steps = steps.filter((s) => s.id !== stepId);
        const pct =
          steps.length > 0
            ? Math.round((steps.filter((s) => s.done).length / steps.length) * 100)
            : 0;
        db.prepare(
          `UPDATE trader_goals SET steps_json = ?, progress_pct = ?, updated_at = ? WHERE id = ?`
        ).run(JSON.stringify(steps), pct, new Date().toISOString(), goalId);
      }
      return NextResponse.json({ ok: true });
    }

    if (action === "delete_goal") {
      db.prepare(`DELETE FROM trader_goals WHERE id = ?`).run(String(body.id || ""));
      return NextResponse.json({ ok: true });
    }

    if (action === "delete_report") {
      const repId = String(body.reportId || "");
      db.prepare(`DELETE FROM ai_coach_reports WHERE id = ?`).run(repId);
      // Also clean up any embedded Q&A sessions bound to this report
      const linkedSessions = db.prepare(`SELECT id FROM ai_chat_sessions WHERE report_id = ?`).all(repId) as any[];
      for (const s of linkedSessions) {
        db.prepare(`DELETE FROM ai_chat_messages WHERE session_id = ?`).run(s.id);
      }
      db.prepare(`DELETE FROM ai_chat_sessions WHERE report_id = ?`).run(repId);
      return NextResponse.json({ ok: true });
    }

    if (action === "cancel_job") {
      const targetJobId = body.jobId ? String(body.jobId) : null;
      const nowIso = new Date().toISOString();

      const targetRow = targetJobId
        ? (db.prepare(`SELECT status FROM ai_background_jobs WHERE id = ?`).get(targetJobId) as any)
        : null;

      if (targetJobId) {
        const ctrl = activeJobControllers.get(targetJobId);
        if (ctrl) ctrl.abort();
        activeJobControllers.delete(targetJobId);
        db.prepare(`UPDATE ai_background_jobs SET status = 'cancelled', error_text = 'Cancelled by user', updated_at = ? WHERE id = ?`).run(nowIso, targetJobId);
      } else {
        for (const [jid, ctrl] of activeJobControllers.entries()) {
          ctrl.abort();
          activeJobControllers.delete(jid);
        }
        db.prepare(`UPDATE ai_background_jobs SET status = 'cancelled', error_text = 'Cancelled by user', updated_at = ? WHERE status IN ('running', 'queued')`).run(nowIso);
      }

      // Only send hardware abort to KoboldCpp if we cancelled a currently 'running' job (not a 'queued' one)
      if (!targetJobId || targetRow?.status === "running") {
        const settings = loadLocalAiSettings();
        await abortKoboldGeneration(settings.baseUrl);
        const daemonUrl = getControlDaemonUrl(settings.baseUrl);
        try {
          await fetch(daemonUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "abort" }),
            signal: AbortSignal.timeout(2000),
          });
        } catch {}
      }

      // Trigger next item in queue if any remain
      setTimeout(() => void processAuditQueue(), 300);
      return NextResponse.json({ ok: true, cancelled: true });
    }

    if (action === "new_chat_session") {
      const nowIso = new Date().toISOString();
      const sessionId = `sess_${Date.now()}`;
      const reportId = String(body.reportId || "");
      const title = String(body.title || `Coaching Session · ${nowIso.slice(5, 10)}`).trim();
      db.prepare(`INSERT INTO ai_chat_sessions (id, title, report_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run(
        sessionId,
        title,
        reportId,
        nowIso,
        nowIso
      );
      return NextResponse.json({ ok: true, sessionId, title });
    }

    if (action === "delete_chat_session") {
      const sessionId = String(body.sessionId || "");
      db.prepare(`DELETE FROM ai_chat_messages WHERE session_id = ?`).run(sessionId);
      db.prepare(`DELETE FROM ai_chat_sessions WHERE id = ?`).run(sessionId);
      return NextResponse.json({ ok: true });
    }

    // CHAT COACH: Supports both Standalone Coach Chats and Report-Embedded Q&A Threads!
    if (action === "chat_coach") {
      const userMessage = String(body.message || "").trim();
      if (!userMessage) {
        return NextResponse.json({ ok: false, error: "Message is required" }, { status: 400 });
      }

      const customScope: CustomAuditScope | undefined = body.customScope;
      const linkedReportId = String(body.reportId || "").trim();
      const nowIso = new Date().toISOString();
      let sessionId = String(body.sessionId || "").trim();

      if (linkedReportId) {
        // Reuse the single dedicated embedded session for this report so it never creates messy separate chats!
        const existingReportSess = db
          .prepare(`SELECT id FROM ai_chat_sessions WHERE report_id = ? ORDER BY created_at ASC LIMIT 1`)
          .get(linkedReportId) as { id: string } | undefined;
        if (existingReportSess) {
          sessionId = existingReportSess.id;
          db.prepare(`UPDATE ai_chat_sessions SET updated_at = ? WHERE id = ?`).run(nowIso, sessionId);
        } else {
          sessionId = `sess_rep_${linkedReportId}`;
          db.prepare(
            `INSERT INTO ai_chat_sessions (id, title, report_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
          ).run(sessionId, `Report Discussion (${linkedReportId})`, linkedReportId, nowIso, nowIso);
        }
      } else if (!sessionId) {
        sessionId = `sess_${Date.now()}`;
        const autoTitle = userMessage.slice(0, 42) + (userMessage.length > 42 ? "…" : "");
        db.prepare(`INSERT INTO ai_chat_sessions (id, title, report_id, created_at, updated_at) VALUES (?, ?, '', ?, ?)`).run(
          sessionId,
          autoTitle,
          nowIso,
          nowIso
        );
      } else {
        const exists = db.prepare(`SELECT id FROM ai_chat_sessions WHERE id = ?`).get(sessionId);
        if (!exists) {
          const autoTitle = userMessage.slice(0, 42) + (userMessage.length > 42 ? "…" : "");
          db.prepare(`INSERT INTO ai_chat_sessions (id, title, report_id, created_at, updated_at) VALUES (?, ?, '', ?, ?)`).run(
            sessionId,
            autoTitle,
            nowIso,
            nowIso
          );
        } else {
          db.prepare(`UPDATE ai_chat_sessions SET updated_at = ? WHERE id = ?`).run(nowIso, sessionId);
        }
      }

      const userMsgId = `msg_${Date.now()}_user`;
      db.prepare(`
        INSERT INTO ai_chat_messages (id, session_id, role, content, reasoning, model_used, created_at)
        VALUES (?, ?, 'user', ?, '', 'user', ?)
      `).run(userMsgId, sessionId, userMessage, nowIso);

      const jobId = `job_chat_${Date.now()}`;
      db.prepare(`
        INSERT INTO ai_background_jobs (id, job_type, target_id, label, status, started_at, updated_at)
        VALUES (?, 'chat', ?, ?, 'running', ?, ?)
      `).run(
        jobId,
        linkedReportId || sessionId,
        `Coach reply: "${userMessage.slice(0, 28)}..."`,
        nowIso,
        nowIso
      );

      const controller = new AbortController();
      activeJobControllers.set(jobId, controller);

      void executeChatJobInBackground(
        jobId,
        sessionId,
        userMessage,
        controller,
        customScope,
        linkedReportId
      );

      return NextResponse.json({
        ok: true,
        background: true,
        jobId,
        sessionId,
        reportId: linkedReportId,
      });
    }

    if (action === "set_auto_stop_server") {
      autoStopServerWhenQueueEmpty = Boolean(body.enabled);
      return NextResponse.json({ ok: true, autoStopAfterQueue: autoStopServerWhenQueueEmpty });
    }

    if (action === "generate_report" || action === "queue_multiple_reports" || action === "overnight_auto_audit") {
      if (typeof body.stopServerAfterQueue === "boolean") {
        autoStopServerWhenQueueEmpty = body.stopServerAfterQueue;
      } else if (typeof body.customScope?.stopServerAfterQueue === "boolean") {
        autoStopServerWhenQueueEmpty = body.customScope.stopServerAfterQueue;
      }
      const horizonsToQueue: GoalHorizon[] = Array.isArray(body.horizons) && body.horizons.length > 0
        ? body.horizons
        : [body.horizon || "weekly"];
      const customScope: CustomAuditScope | undefined = body.customScope;

      if (action === "overnight_auto_audit") {
        const probe = await probeKoboldStatus();
        if (!probe.online) {
          return NextResponse.json({
            ok: true,
            skipped: true,
            message: "Desktop KoboldCpp is offline; overnight audit skipped gracefully.",
          });
        }
      }

      const queuedJobIds: string[] = [];
      let baseTs = Date.now();

      for (const hz of horizonsToQueue) {
        baseTs += 5;
        const nowIso = new Date(baseTs).toISOString();
        const jobId = `job_audit_${hz}_${baseTs}`;
        const timing = getPeriodTimingContext(hz, new Date(), customScope);
        const label =
          customScope?.selectedJournalSlugs?.length || customScope?.selectedTradeKeys?.length
            ? `Scoped ${timing.timingTag} (${customScope?.selectedJournalSlugs?.length || 0}J / ${customScope?.selectedTradeKeys?.length || 0}T)`
            : `${timing.timingTag} (${timing.basePeriodKey})`;

        db.prepare(`
          INSERT INTO ai_background_jobs (id, job_type, target_id, label, status, result_json, started_at, updated_at)
          VALUES (?, ?, ?, ?, 'queued', ?, ?, ?)
        `).run(
          jobId,
          `audit_${hz}`,
          hz,
          label,
          JSON.stringify({ horizon: hz, customScope }),
          nowIso,
          nowIso
        );
        queuedJobIds.push(jobId);
      }

      // Kick off sequential queue processor
      setTimeout(() => void processAuditQueue(), 50);

      return NextResponse.json({
        ok: true,
        background: true,
        jobIds: queuedJobIds,
        jobId: queuedJobIds[0],
      });
    }

    return NextResponse.json({ ok: false, error: "Unknown coach action" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "AI Coach error" },
      { status: 500 }
    );
  } finally {
    db.close();
  }
}
