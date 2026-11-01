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

function getIsoWeekKey(d: Date): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function getPeriodTimingContext(horizon: GoalHorizon, now: Date): {
  isMidPeriod: boolean;
  timingTag: string;
  basePeriodKey: string;
  timingInstruction: string;
} {
  const dayOfWeek = now.getDay(); // 0=Sun, 6=Sat, 5=Fri
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const monthInQuarter = now.getMonth() % 3; // 0, 1, 2

  if (horizon === "weekly") {
    const isEndOfWeek = dayOfWeek === 0 || dayOfWeek === 6 || dayOfWeek === 5;
    const wkKey = getIsoWeekKey(now);
    return {
      isMidPeriod: !isEndOfWeek,
      timingTag: isEndOfWeek ? "End-of-Week Audit" : "Mid-Week Check-In",
      basePeriodKey: wkKey,
      timingInstruction: isEndOfWeek
        ? `This is an END-OF-WEEK AUDIT for ${wkKey}. Evaluate the full week's execution against the prior 3 weeks and set concrete adjustments for next week.`
        : `This is a MID-WEEK PROGRESS CHECK-IN for ${wkKey} (ran mid-period). Do NOT complain that the week is incomplete—evaluate progress so far this week against prior weeks, highlight early behavioral wins or leaks, and give immediate tactical adjustments for the remaining sessions of this week!`,
    };
  }

  if (horizon === "monthly") {
    const isEndOfMonth = dayOfMonth >= daysInMonth - 3 || dayOfMonth <= 2;
    const mKey = now.toISOString().slice(0, 7);
    return {
      isMidPeriod: !isEndOfMonth,
      timingTag: isEndOfMonth ? "Monthly Audit" : `Mid-Month Check-In (Day ${dayOfMonth}/${daysInMonth})`,
      basePeriodKey: mKey,
      timingInstruction: isEndOfMonth
        ? `This is an END-OF-MONTH AUDIT for ${mKey}. Compare the completed month against the prior 3 months.`
        : `This is a MID-MONTH PROGRESS CHECK-IN (${mKey}, Day ${dayOfMonth} of ${daysInMonth}). Evaluate month-to-date progress against prior months and all recent Weekly/Check-In reports, and provide mid-course corrections for the rest of the month!`,
    };
  }

  if (horizon === "quarterly") {
    const qNum = Math.floor(now.getMonth() / 3) + 1;
    const qKey = `${now.getFullYear()}-Q${qNum}`;
    const isEndOfQuarter = monthInQuarter === 2 && dayOfMonth >= daysInMonth - 5;
    return {
      isMidPeriod: !isEndOfQuarter,
      timingTag: isEndOfQuarter ? "Quarterly Synthesis" : "Mid-Quarter Progress Pulse",
      basePeriodKey: qKey,
      timingInstruction: `This is a ${isEndOfQuarter ? "QUARTERLY SYNTHESIS" : "MID-QUARTER PROGRESS PULSE"} for ${qKey}. Synthesize all journals, trades, and prior Weekly/Monthly reports within this quarter window to assess trajectory and course-correct for the remainder of the quarter.`,
    };
  }

  const yKey = `${now.getFullYear()}`;
  return {
    isMidPeriod: true,
    timingTag: "Annual Evolution Check-In",
    basePeriodKey: yKey,
    timingInstruction: `This is an ANNUAL EVOLUTION AUDIT for ${yKey}. Synthesize year-to-date progress, habit maturity, and macro account risk discipline.`,
  };
}


function getControlDaemonUrl(baseUrl: string): string {
  try {
    const clean = (baseUrl || "[http://100.75.201.34:5001](http://100.75.201.34:5001)").replace(/\/+$/, "").replace(/\/v1$/, "");
    const u = new URL(clean.startsWith("http") ? clean : `http://${clean}`);
    return `${u.protocol}//${u.hostname}:5002`;
  } catch {
    return "[http://100.75.201.34:5002](http://100.75.201.34:5002)";
  }
}

export type GoalHorizon = "weekly" | "monthly" | "quarterly" | "yearly";
export type GoalStatus = "on_track" | "slipping" | "breached" | "completed";

export interface CustomAuditScope {
  horizon?: GoalHorizon;
  selectedJournalSlugs?: string[];
  selectedTradeKeys?: string[];
  includeTabs?: "both" | "review_only" | "prep_only";
  thinkingMode?: "fast" | "balanced" | "deep";
  maxOutputTokens?: number;
  customFocusPrompt?: string;
}

export interface ReportActionItem {
  id: string;
  text: string;
  horizon: GoalHorizon;
  targetMetric: string;
  done: boolean;
}

function resolveDbPath(): string {
  const p1 = path.resolve(process.cwd(), "data", "journal.db");
  const p2 = path.resolve(process.cwd(), "apps", "web", "data", "journal.db");
  return fs.existsSync(p1) ? p1 : p2;
}

function ensureCoachTables(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS trader_goals (
      id TEXT PRIMARY KEY,
      horizon TEXT NOT NULL,
      period_label TEXT NOT NULL,
      title TEXT NOT NULL,
      why_it_matters TEXT DEFAULT '',
      target_metric TEXT DEFAULT '',
      status TEXT DEFAULT 'on_track',
      progress_pct INTEGER DEFAULT 0,
      ai_accountability_note TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_coach_reports (
      id TEXT PRIMARY KEY,
      horizon TEXT NOT NULL,
      period_key TEXT NOT NULL,
      title TEXT NOT NULL,
      summary_md TEXT NOT NULL,
      reasoning_trace TEXT DEFAULT '',
      telemetry_json TEXT DEFAULT '{}',
      suggested_goals_json TEXT DEFAULT '[]',
      accountability_json TEXT DEFAULT '[]',
      action_items_json TEXT DEFAULT '[]',
      model_used TEXT DEFAULT 'koboldcpp',
      created_at TEXT NOT NULL
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
      reasoning TEXT DEFAULT '',
      model_used TEXT DEFAULT 'koboldcpp',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_background_jobs (
      id TEXT PRIMARY KEY,
      job_type TEXT NOT NULL,
      target_id TEXT DEFAULT '',
      label TEXT DEFAULT '',
      status TEXT NOT NULL,
      result_json TEXT DEFAULT '{}',
      error_text TEXT DEFAULT '',
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  try {
    db.exec(`ALTER TABLE ai_coach_reports ADD COLUMN action_items_json TEXT DEFAULT '[]'`);
  } catch {}
  try {
    db.exec(`ALTER TABLE ai_chat_sessions ADD COLUMN report_id TEXT DEFAULT ''`);
  } catch {}
}

function htmlToStructuredDigest(html: string): {
  qaReflections: Array<{ prompt: string; answer: string }>;
  cleanText: string;
} {
  if (!html || !html.trim()) return { qaReflections: [], cleanText: "" };
  try {
    const root = parse(html);
    root.querySelectorAll("style, script, img, svg, button").forEach((el) => el.remove());

    const qaReflections: Array<{ prompt: string; answer: string }> = [];
    const quotes = root.querySelectorAll("blockquote, .tz-quote");
    for (const q of quotes) {
      const answer = (q.text || "").replace(/Empty quote/gi, "").replace(/\s+/g, " ").trim();
      if (!answer) continue;
      let prev = q.previousElementSibling;
      let promptText = "";
      while (prev) {
        const cand = (prev.text || "").replace(/\s+/g, " ").trim();
        if (cand) {
          promptText = cand;
          break;
        }
        prev = prev.previousElementSibling;
      }
      qaReflections.push({
        prompt: promptText || "Self-Reflection Quote",
        answer,
      });
    }

    const lines: string[] = [];
    for (const el of root.querySelectorAll("h1, h2, h3, .tz-banner, .tz-toggle-title, p, li, blockquote, .tz-callout-content, .tz-check-row, tr")) {
      const text = (el.text || "").replace(/Empty quote/gi, "").replace(/\s+/g, " ").trim();
      if (!text || text === "▾" || text === "▸") continue;
      const tag = el.tagName?.toUpperCase();
      if (tag === "H1" || tag === "H2" || tag === "H3" || el.classList.contains("tz-banner") || el.classList.contains("tz-toggle-title")) {
        lines.push(`### ${text}`);
      } else if (tag === "BLOCKQUOTE" || el.classList.contains("tz-quote")) {
        lines.push(`> "${text}"`);
      } else if (el.classList.contains("tz-check-row")) {
        const chk = el.querySelector('input[type="checkbox"]');
        const isChecked = chk?.hasAttribute("checked") || chk?.getAttribute("checked") === "checked";
        lines.push(`- [${isChecked ? "x" : " "}] ${text}`);
      } else if (tag === "TR") {
        const cells = el.querySelectorAll("th, td").map((c) => (c.text || "").trim());
        if (cells.some(Boolean)) lines.push(`| ${cells.join(" | ")} |`);
      } else {
        lines.push(text);
      }
    }

    const deduped = lines.filter((line, idx) => idx === 0 || line !== lines[idx - 1]);
    return {
      qaReflections,
      cleanText: deduped.join("\n").slice(0, 3500),
    };
  } catch {
    return {
      qaReflections: [],
      cleanText: html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 3000),
    };
  }
}

function computeMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

// Compute Implied Capital Risked ($) on a trade regardless of whether user risked 0.5% or 1.0% as "1R"
function estimateTradeCapitalRiskedUsd(t: any): number | null {
  const netPnl = Number(t.net_pnl || 0);
  const rMult = Number(t.realized_r);
  if (Number.isFinite(rMult) && Math.abs(rMult) >= 0.15 && Math.abs(netPnl) > 0) {
    return Math.round(Math.abs(netPnl / rMult) * 100) / 100;
  }
  if (netPnl < 0) {
    return Math.round(Math.abs(netPnl) * 100) / 100;
  }
  return null;
}

function summarizeBucketMetrics(bucketTrades: any[], targetRiskPct: number) {
  const count = bucketTrades.length;
  if (count === 0) {
    return {
      trades: 0,
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

    const rPct = t.accountRiskPct;
    if (typeof rPct === "number" && rPct > 0) {
      riskPcts.push(rPct);
      if (rPct < targetRiskPct * 0.72) {
        halfRiskTradesCount += 1; // e.g., 0.5% probe risk when target is 1.0%
      } else if (rPct > targetRiskPct * 1.30) {
        oversizedRiskTradesCount += 1; // >1.3% risk expansion
      } else {
        standardRiskTradesCount += 1; // ~1.0% standard risk
      }
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

function buildBehavioralTelemetryAndJournals(
  db: Database.Database,
  horizon: GoalHorizon,
  customScope?: CustomAuditScope
) {
  const now = new Date();
  const settings = loadLocalAiSettings();
  const targetRiskPct = Number(settings.baselineRiskPct || 1.0); // Standard 1R = 1.0% of Account

  const lookbackDays =
    horizon === "weekly" ? 28 : horizon === "monthly" ? 120 : horizon === "quarterly" ? 270 : 365;
  const cutoffIso = new Date(now.getTime() - lookbackDays * 86_400_000).toISOString().slice(0, 10);

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

  // Determine Initial Account Balance:
  // 1. User override in settings -> 2. Sum of accounts.initial_balance -> 3. Inferred from Median Full Risk $ = targetRiskPct (1%)
  const allCapitalRisks = allTrades
    .map((t) => estimateTradeCapitalRiskedUsd(t))
    .filter((v): v is number => v !== null && v > 0);
  const medianRiskUsd = Math.round(computeMedian(allCapitalRisks) * 100) / 100 || 500;

  let initialAccountBalance = Number(settings.accountBalanceOverride || 0);
  if (initialAccountBalance <= 0) {
    try {
      const accRows = db.prepare(`SELECT initial_balance FROM accounts`).all() as any[];
      const sumInit = accRows.reduce((acc, r) => acc + Number(r.initial_balance || 0), 0);
      if (sumInit > 0) initialAccountBalance = sumInit;
    } catch {}
  }
  if (initialAccountBalance <= 0) {
    // Infer account size so that median 1R trade risk equals targetRiskPct (1.0% of account)
    initialAccountBalance = Math.round((medianRiskUsd / (targetRiskPct / 100)) * 100) / 100;
  }

  // Compute dynamic running equity & Account % Risk for every trade chronologically
  let runningEquity = initialAccountBalance;
  for (const t of allTrades) {
    const eqBeforeTrade = Math.max(runningEquity, initialAccountBalance * 0.25);
    const capRiskUsd = estimateTradeCapitalRiskedUsd(t);
    t.equityAtTrade = Math.round(eqBeforeTrade);
    t.estimated1RUsd = capRiskUsd;
    t.accountRiskPct =
      capRiskUsd !== null
        ? Math.round(((capRiskUsd / eqBeforeTrade) * 100) * 100) / 100
        : null;
    t.accountPnlPct = Math.round(((Number(t.net_pnl || 0) / eqBeforeTrade) * 100) * 100) / 100;
    t.riskTier =
      t.accountRiskPct === null
        ? "unknown"
        : t.accountRiskPct < targetRiskPct * 0.72
        ? `reduced_risk (~${t.accountRiskPct}%)`
        : t.accountRiskPct > targetRiskPct * 1.30
        ? `oversized_risk (~${t.accountRiskPct}%)`
        : `standard_risk (~${t.accountRiskPct}%)`;
    runningEquity += Number(t.net_pnl || 0);
  }

  const trades =
    customScope?.selectedTradeKeys && customScope.selectedTradeKeys.length > 0
      ? allTrades.filter((t) => customScope.selectedTradeKeys!.includes(t.key))
      : allTrades.filter((t) => String(t.opened_at).slice(0, 10) >= cutoffIso);

  let revengeCount = 0;
  let revengePnl = 0;
  let revengeWins = 0;
  let postLossRiskExpansionCount = 0;
  let postWinRiskExpansionCount = 0;
  let intentionalDownsizeCount = 0;
  const mistakeCounts: Record<string, number> = {};
  const tagCounts: Record<string, number> = {};
  const sessionStats: Record<string, { trades: number; pnl: number; wins: number }> = {};
  const dailyMap = new Map<string, { trades: number; pnl: number; peakPnl: number; giveback: number }>();

  for (let i = 0; i < trades.length; i++) {
    const t = trades[i];
    const pnl = Number(t.net_pnl || 0);
    const rPct = t.accountRiskPct;

    if (typeof rPct === "number" && rPct < targetRiskPct * 0.72) {
      intentionalDownsizeCount += 1;
    }

    const dayKey = String(t.opened_at || "").slice(0, 10);
    const dStat = dailyMap.get(dayKey) || { trades: 0, pnl: 0, peakPnl: 0, giveback: 0 };
    dStat.trades += 1;
    dStat.pnl += pnl;
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

  const stepDays =
    horizon === "weekly" ? 7 : horizon === "monthly" ? 30 : horizon === "quarterly" ? 90 : 365;
  const periodComparisonBuckets: Array<any> = [];

  for (let p = 0; p < 4; p++) {
    const endMs = now.getTime() - p * stepDays * 86_400_000;
    const startMs = endMs - stepDays * 86_400_000;
    const startIso = new Date(startMs).toISOString().slice(0, 10);
    const endIso = new Date(endMs).toISOString().slice(0, 10);
    const bucketTrades = allTrades.filter((t) => {
      const d = String(t.opened_at).slice(0, 10);
      return d > startIso && d <= endIso;
    });
    const label =
      p === 0
        ? `Target ${horizon.charAt(0).toUpperCase() + horizon.slice(1)} (Current)`
        : `${horizon.charAt(0).toUpperCase() + horizon.slice(1)} -${p} (Prior)`;
    periodComparisonBuckets.push({
      periodLabel: label,
      dateRange: `${startIso} to ${endIso}`,
      ...summarizeBucketMetrics(bucketTrades, targetRiskPct),
    });
  }

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

  let journals: any[] = [];
  try {
    journals = db
      .prepare(
        `SELECT slug, period_type, title, content, review_content, lessons_learned,
                checklist_json, scores_json, rating, updated_at
         FROM journal_entries
         ORDER BY slug DESC LIMIT 90`
      )
      .all() as any[];
  } catch {}

  const includeTabs = customScope?.includeTabs || "both";

  const allParsedJournals = journals
    .map((j) => {
      const prepDigest =
        includeTabs === "review_only"
          ? { qaReflections: [], cleanText: "" }
          : htmlToStructuredDigest(j.content || "");
      const revDigest =
        includeTabs === "prep_only"
          ? { qaReflections: [], cleanText: "" }
          : htmlToStructuredDigest(j.review_content || "");

      const rawPrepLen = (j.content || "").replace(/<[^>]+>/g, "").trim().length;
      const rawRevLen = (j.review_content || "").replace(/<[^>]+>/g, "").trim().length;

      let scores: any = {};
      try {
        scores = JSON.parse(j.scores_json || "{}");
      } catch {}

      const hasSubstantiveText =
        rawPrepLen > 25 ||
        rawRevLen > 25 ||
        Boolean((j.lessons_learned || "").trim());

      if (!hasSubstantiveText) return null;
      return {
        slug: j.slug,
        periodType: j.period_type || "day",
        title: j.title || j.slug,
        journalUrl: `/journal?slug=${encodeURIComponent(j.slug)}`,
        hasPrep: rawPrepLen > 25,
        hasReview: rawRevLen > 25,
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

  const selectedJournals =
    customScope?.selectedJournalSlugs && customScope.selectedJournalSlugs.length > 0
      ? allParsedJournals.filter((j) => customScope.selectedJournalSlugs!.includes(j.slug))
      : allParsedJournals.slice(0, 12);

  const totalNetPnl = trades.reduce((acc, t) => acc + Number(t.net_pnl || 0), 0);
  const winsCount = trades.filter((t) => Number(t.net_pnl || 0) > 0).length;

  const telemetry = {
    windowDays: lookbackDays,
    cutoffDate: cutoffIso,
    totalTrades: trades.length,
    winRatePct: trades.length > 0 ? Math.round((winsCount / trades.length) * 1000) / 10 : 0,
    totalNetPnl: Math.round(totalNetPnl * 100) / 100,
    initialAccountBalance,
    currentEquity: Math.round(runningEquity * 100) / 100,
    targetRiskPct,
    baseline1RUsd: medianRiskUsd,
    baseline1RPct: targetRiskPct,
    revengeTradesCount: revengeCount,
    revengeWinRatePct: revengeCount > 0 ? Math.round((revengeWins / revengeCount) * 100) : 0,
    revengeNetPnl: Math.round(revengePnl * 100) / 100,
    postLossSizeExpansionCount: postLossRiskExpansionCount,
    postLossRiskExpansionCount,
    postWinRiskExpansionCount,
    intentionalDownsizeCount,
    periodComparisonBuckets,
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
    if (/action|next step|recommend|what to work on|goal/i.test(line) && /^#{1,4}\s|\*\*/.test(line)) {
      inActionSection = true;
      continue;
    }
    if (inActionSection && /^[-*•]|\d+\.\s/.test(line.trim())) {
      const cleaned = line
        .replace(/^([-*•]|\d+\.)\s*/, "")
        .replace(/\*\*/g, "")
        .trim();
      if (cleaned.length > 12 && cleaned.length < 220) {
        items.push({
          id: `act_${Date.now()}_${items.length}`,
          text: cleaned,
          horizon,
          targetMetric: "Complete in upcoming sessions",
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
  customScope?: CustomAuditScope
) {
  const dbPath = resolveDbPath();
  const db = new Database(dbPath);
  try {
    ensureCoachTables(db);
    const { telemetry, parsedJournals, recentTradesSample } =
      buildBehavioralTelemetryAndJournals(db, horizon, customScope);

    const activeGoals = db
      .prepare(`SELECT * FROM trader_goals WHERE status != 'completed' ORDER BY updated_at DESC`)
      .all() as any[];

    const now = new Date();
    const timing = getPeriodTimingContext(horizon, now);

    // Pull ALL non-deleted reports within the lookback window (Weekly, Monthly, Scoped, etc.)
    // If the user deletes an irrelevant report in the Notebook, it is automatically excluded here!
    const priorReports = db
      .prepare(
        `SELECT period_key, horizon, title, summary_md, action_items_json, created_at
         FROM ai_coach_reports
         WHERE created_at >= ?
         ORDER BY created_at DESC LIMIT 6`
      )
      .all(telemetry.cutoffDate) as any[];

    const isCustomScoped =
      (customScope?.selectedJournalSlugs && customScope.selectedJournalSlugs.length > 0) ||
      (customScope?.selectedTradeKeys && customScope.selectedTradeKeys.length > 0) ||
      Boolean(customScope?.customFocusPrompt?.trim());

    // Count how many reports already exist for this base period so every run gets a unique #N sequence number
    const existingCountRow = db
      .prepare(`SELECT COUNT(*) as cnt FROM ai_coach_reports WHERE period_key LIKE ?`)
      .get(`${timing.basePeriodKey}%`) as { cnt: number } | undefined;
    const seqNum = (existingCountRow?.cnt || 0) + 1;
    const shortStamp = now.toISOString().slice(5, 16).replace("T", " ");

    const periodKey = isCustomScoped
      ? `${timing.basePeriodKey}-Scoped-#${seqNum}`
      : `${timing.basePeriodKey}-#${seqNum}`;

    const reportTitle = isCustomScoped
      ? `Scoped ${timing.timingTag} #${seqNum} · ${parsedJournals.map((j: any) => j.slug).slice(0, 2).join(", ") || timing.basePeriodKey} (${shortStamp})`
      : `${timing.timingTag} #${seqNum} · ${timing.basePeriodKey} (${shortStamp})`;

    const horizonRoleGuide = timing.timingInstruction;

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
=== 1. PERIOD-OVER-PERIOD COMPARISON TABLE (${horizon.toUpperCase()} DELTAS — ACCOUNT % RISK NORMALIZED) ===
${JSON.stringify(telemetry.periodComparisonBuckets, null, 2)}

=== 2. OVERALL BEHAVIORAL TELEMETRY (ACCOUNT % RISK NORMALIZED) ===
${JSON.stringify(telemetry, null, 2)}

=== 3. ACTIVE GOALS TO AUDIT FOR ACCOUNTABILITY ===
${activeGoals.length > 0 ? activeGoals.map((g) => `ID: ${g.id} | [${g.horizon.toUpperCase()}] "${g.title}" | Target Metric: "${g.target_metric}" | Why: "${g.why_it_matters}"`).join("\n") : "No active goals defined yet—propose concrete goals across Weekly, Monthly, and Quarterly horizons."}

=== 4. SELECTED JOURNAL ENTRIES (${parsedJournals.length} ENTRIES | LINK WITH [Slug](journalUrl)) ===
${parsedJournals.length > 0 ? parsedJournals.map((j: any) => `### JOURNAL [${j.slug}](${j.journalUrl}) (${j.periodType.toUpperCase()}): ${j.title}\n- Process Score: ${j.processRating ?? "N/A"}% | Sub-scores: ${JSON.stringify(j.scores)}\n- Key Takeaway: ${j.lessonsLearned || "None recorded"}\n- Self-Reflection Quotes: ${JSON.stringify(j.qaReflections)}${j.prepSummary ? `\n- Prep Notes: ${j.prepSummary}` : ""}${j.reviewSummary ? `\n- Review Notes: ${j.reviewSummary}` : ""}`).join("\n\n") : "No journal entries in selection."}

=== 5. SELECTED / RECENT TRADES (LINK WITH [Symbol Direction Date](tradeUrl)) ===
${recentTradesSample.length > 0 ? recentTradesSample.map((t: any) => `- [${t.symbol} ${t.direction} ${t.opened_at?.slice(0, 10)} ($${t.net_pnl} | Acct PnL: ${t.accountPnlPct}% | Acct Risk: ${t.accountRiskPct ?? "?"}% [${t.riskTier}] | Trade R: ${t.realized_r ?? "?"}R)](${t.tradeUrl}) | Mistakes=${JSON.stringify(t.mistakes)} | Tags=${JSON.stringify(t.tags)} | Notes=${(t.notes || "").replace(/<[^>]+>/g, " ").slice(0, 180)}`).join("\n") : "No closed trades in this selection."}

=== 6. PREVIOUS ${horizon.toUpperCase()} AI REPORTS (FOR LONGITUDINAL CONTINUITY) ===
${priorReports.length > 0 ? priorReports.map((r) => `[${r.created_at.slice(0, 10)} | ${r.title}]:\n${r.summary_md.slice(0, 900)}`).join("\n---\n") : "First report in this horizon series."}

=== INSTRUCTIONS ===
Write a complete, candid, deeply insightful report in Markdown with these exact 5 sections (ensure you complete all 5 sections and the JSON block without cutting off):
1. **Period-over-Period Trajectory (${horizon.toUpperCase()} Comparison)**: Compare the Target ${horizon} against the previous periods using the comparison buckets and journals.
2. **Psychological & Account % Risk Pattern Recognition**: Connect the trader's self-reflection quotes and review notes with their Account % Risk consistency (0.5% probe vs 1.0% standard vs >1.3% oversized), hesitation, or execution telemetry. Include clickable Markdown links!
3. **Goal Accountability Audit**: Grade active goals with specific evidence.
4. **Concrete Action Plan & Next Steps (What to Work On Now)**: 3 to 5 specific, trackable action steps for the upcoming sessions.
5. **Recommended Multi-Level Goals (Weekly -> Monthly -> Quarterly)**

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
      "targetMetric": "Measurable rule"
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

    const aiRes = await runKoboldAi(deepPrompt, {
      persona: "coach",
      thinkingMode,
      autoContinue: true,
      maxOutputTokens: maxOut,
      temperature: 0.6,
      timeoutMs: 1_800_000,
      abortSignal: controller.signal,
      onPartial: (partial) => {
        try {
          const dbStream = new Database(dbPath);
          dbStream
            .prepare(`UPDATE ai_background_jobs SET result_json = ?, updated_at = ? WHERE id = ? AND status = 'running'`)
            .run(
              JSON.stringify({
                streaming: true,
                title: reportTitle,
                partialText: partial.text,
                partialReasoning: partial.reasoning,
              }),
              new Date().toISOString(),
              jobId
            );
          dbStream.close();
        } catch {}
      },
    });

    const db2 = new Database(dbPath);
    try {
      const jobRow = db2.prepare(`SELECT status FROM ai_background_jobs WHERE id = ?`).get(jobId) as any;
      if (jobRow?.status === "cancelled") return;

      let rawMarkdown = aiRes.text;
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

      if (!rawMarkdown.trim() && aiRes.reasoning.trim()) {
        rawMarkdown = `*(Note: Model completed reasoning trace; see full thought process below)*\n\n${aiRes.reasoning}`;
      }

      const tradeLinksMd = recentTradesSample
        .slice(0, 10)
        .map(
          (t: any) =>
            `- [${t.symbol} ${t.direction.toUpperCase()} (${t.opened_at?.slice(0, 10)}) · Net $${t.net_pnl.toFixed(2)} (${t.accountPnlPct >= 0 ? "+" : ""}${t.accountPnlPct}% Acct) · Risked ${t.accountRiskPct ?? "?"}% Acct](${t.tradeUrl})`
        )
        .join("\n");
      const journalLinksMd = parsedJournals
        .slice(0, 8)
        .map((j: any) => `- [${j.slug}: ${j.title} (${j.periodType.toUpperCase()})](${j.journalUrl})`)
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

      const reportId = `rep_${Date.now()}`;
      db2.prepare(`
        INSERT INTO ai_coach_reports (
          id, horizon, period_key, title, summary_md, reasoning_trace,
          telemetry_json, suggested_goals_json, accountability_json, action_items_json, model_used, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        reportId,
        isCustomScoped ? "custom" : horizon,
        periodKey,
        reportTitle,
        rawMarkdown,
        aiRes.reasoning || "",
        JSON.stringify(telemetry),
        JSON.stringify(suggestedGoals),
        JSON.stringify(goalAudits),
        JSON.stringify(actionItems),
        aiRes.model || "koboldcpp",
        nowIso
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
    const dbErr = new Database(dbPath);
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
        isAborted ? "Generation cancelled by user." : err?.message || "Audit failed",
        new Date().toISOString(),
        jobId
      );
    } finally {
      dbErr.close();
    }
  } finally {
    activeJobControllers.delete(jobId);
  }
}


async function processAuditQueue() {
  if (isQueueWorkerActive) return;
  isQueueWorkerActive = true;
  try {
    while (true) {
      const dbPath = resolveDbPath();
      const db = new Database(dbPath);
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

      if (!nextJob) break;

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
  const db = new Database(dbPath);
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
        try {
          const dbStream = new Database(dbPath);
          dbStream
            .prepare(`UPDATE ai_background_jobs SET result_json = ?, updated_at = ? WHERE id = ? AND status = 'running'`)
            .run(
              JSON.stringify({
                streaming: true,
                title: `Completing: ${rep.title}`,
                partialText: `${mainBody.trimEnd()} ${partial.text.trimStart()}`,
              }),
              new Date().toISOString(),
              jobId
            );
          dbStream.close();
        } catch {}
      },
    });

    const db2 = new Database(dbPath);
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
    const dbErr = new Database(dbPath);
    try {
      dbErr
        .prepare(`UPDATE ai_background_jobs SET status = 'failed', error_text = ?, updated_at = ? WHERE id = ?`)
        .run(err?.message || "Continuation failed", new Date().toISOString(), jobId);
    } finally {
      dbErr.close();
    }
  } finally {
    activeJobControllers.delete(jobId);
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
  const db = new Database(dbPath);
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
        try {
          const dbStream = new Database(dbPath);
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
              new Date().toISOString(),
              jobId
            );
          dbStream.close();
        } catch {}
      },
    });

    const db2 = new Database(dbPath);
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
    const dbErr = new Database(dbPath);
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
  }
}

export async function GET(req: NextRequest) {
  const dbPath = resolveDbPath();
  const db = new Database(dbPath);
  try {
    ensureCoachTables(db);
    const localSettings = loadLocalAiSettings();
    const status = await probeKoboldStatus(localSettings.baseUrl);
    const auditDue = computeAuditDueStatus(db);

    const staleCutoff = new Date(Date.now() - 35 * 60_000).toISOString();
    db.prepare(`
      UPDATE ai_background_jobs
      SET status = 'failed', error_text = 'Timed out'
      WHERE status = 'running' AND started_at < ?
    `).run(staleCutoff);

    const activeJobsRaw = db
      .prepare(`SELECT id, job_type as jobType, target_id as targetId, label, status, result_json as resultJson, started_at as startedAt FROM ai_background_jobs WHERE status IN ('running', 'queued') ORDER BY CASE WHEN status = 'running' THEN 0 ELSE 1 END, started_at ASC`)
      .all() as any[];

    const activeJobs = activeJobsRaw.map((j) => {
      let streamData: any = {};
      try {
        streamData = JSON.parse(j.resultJson || "{}");
      } catch {}
      return {
        id: j.id,
        jobType: j.jobType,
        targetId: j.targetId,
        label: j.label,
        status: j.status,
        startedAt: j.startedAt,
        partialText: streamData.partialText || "",
        partialReasoning: streamData.partialReasoning || "",
      };
    });

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

    // Also fetch embedded Q&A messages for the requested reportId (or all report threads)
    const reportCommentsMap: Record<string, any[]> = {};
    const reportLinkedSessions = allChatSessions.filter((s) => Boolean(s.reportId));
    for (const rs of reportLinkedSessions) {
      const msgs = db
        .prepare(
          `SELECT id, session_id as sessionId, role, content as text, reasoning, model_used as modelUsed, created_at as createdAt
           FROM ai_chat_messages
           WHERE session_id = ?
           ORDER BY created_at ASC`
        )
        .all(rs.id) as any[];
      reportCommentsMap[rs.reportId] = [
        ...(reportCommentsMap[rs.reportId] || []),
        ...msgs,
      ];
    }

    const goals = db
      .prepare(`SELECT * FROM trader_goals ORDER BY updated_at DESC`)
      .all() as any[];

    const reports = db
      .prepare(`SELECT * FROM ai_coach_reports ORDER BY created_at DESC LIMIT 50`)
      .all() as any[];

    const { telemetry, selectableJournals, selectableTrades } =
      buildBehavioralTelemetryAndJournals(db, "monthly");

    return NextResponse.json({
      ok: true,
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
      goals: goals.map((g) => ({
        id: g.id,
        horizon: g.horizon,
        periodLabel: g.period_label,
        title: g.title,
        whyItMatters: g.why_it_matters,
        targetMetric: g.target_metric,
        status: g.status,
        progressPct: g.progress_pct,
        aiAccountabilityNote: g.ai_accountability_note,
        createdAt: g.created_at,
        updatedAt: g.updated_at,
      })),
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
  const db = new Database(dbPath);
  try {
    ensureCoachTables(db);
    const body = await req.json().catch(() => ({}));
    const action = body.action || "generate_report";

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
      db.prepare(`
        INSERT INTO trader_goals (
          id, horizon, period_label, title, why_it_matters, target_metric,
          status, progress_pct, ai_accountability_note, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          horizon = excluded.horizon,
          period_label = excluded.period_label,
          title = excluded.title,
          why_it_matters = excluded.why_it_matters,
          target_metric = excluded.target_metric,
          status = excluded.status,
          progress_pct = excluded.progress_pct,
          ai_accountability_note = excluded.ai_accountability_note,
          updated_at = excluded.updated_at
      `).run(
        id,
        horizon,
        periodLabel,
        title,
        String(body.whyItMatters || ""),
        String(body.targetMetric || ""),
        String(body.status || "on_track"),
        Number(body.progressPct ?? 0),
        String(body.aiAccountabilityNote || ""),
        nowIso,
        nowIso
      );
      return NextResponse.json({ ok: true, id });
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

    if (action === "generate_report" || action === "queue_multiple_reports" || action === "overnight_auto_audit") {
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
        const timing = getPeriodTimingContext(hz, new Date());
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
