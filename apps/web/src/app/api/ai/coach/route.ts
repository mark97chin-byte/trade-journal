import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
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

function getControlDaemonUrl(baseUrl: string): string {
  try {
    const clean = (baseUrl || "http://100.75.201.34:5001").replace(/\/+$/, "").replace(/\/v1$/, "");
    const u = new URL(clean.startsWith("http") ? clean : `http://${clean}`);
    return `${u.protocol}//${u.hostname}:5002`;
  } catch {
    return "http://100.75.201.34:5002";
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

  // Safe migration for action_items_json and report_id on existing DBs
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

// Compute 1R Dollar Risk for a trade (independent of raw lot size!)
function estimateTrade1RDollarRisk(t: any): number | null {
  const netPnl = Number(t.net_pnl || 0);
  const rMult = Number(t.realized_r);
  // 1. If realized_r is known and non-trivial, 1R $ Risk = |netPnl / realizedR|
  if (Number.isFinite(rMult) && Math.abs(rMult) >= 0.15 && Math.abs(netPnl) > 0) {
    return Math.round(Math.abs(netPnl / rMult) * 100) / 100;
  }
  // 2. If it's a losing trade without explicit R tag, the loss magnitude approximates 1R risk
  if (netPnl < 0) {
    return Math.round(Math.abs(netPnl) * 100) / 100;
  }
  return null;
}

function summarizeBucketMetrics(bucketTrades: any[], baseline1RUsd: number) {
  const count = bucketTrades.length;
  if (count === 0) {
    return { trades: 0, netPnl: 0, winRatePct: 0, avgRisk1RUsd: 0, riskDriftCount: 0, revengeCount: 0 };
  }
  let wins = 0;
  let netPnl = 0;
  let riskDriftCount = 0;
  let revengeCount = 0;
  const risks: number[] = [];

  for (let i = 0; i < bucketTrades.length; i++) {
    const t = bucketTrades[i];
    const pnl = Number(t.net_pnl || 0);
    netPnl += pnl;
    if (pnl > 0) wins += 1;
    const rUsd = estimateTrade1RDollarRisk(t);
    if (rUsd !== null) {
      risks.push(rUsd);
      if (baseline1RUsd > 0 && rUsd > baseline1RUsd * 1.35) {
        riskDriftCount += 1;
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

  const avgRisk1RUsd =
    risks.length > 0 ? Math.round(risks.reduce((a, b) => a + b, 0) / risks.length) : 0;

  return {
    trades: count,
    netPnl: Math.round(netPnl * 100) / 100,
    winRatePct: Math.round((wins / count) * 1000) / 10,
    avgRisk1RUsd,
    riskDriftCount,
    revengeCount,
  };
}

function buildBehavioralTelemetryAndJournals(
  db: Database.Database,
  horizon: GoalHorizon,
  customScope?: CustomAuditScope
) {
  const now = new Date();
  const lookbackDays =
    horizon === "weekly" ? 28 : horizon === "monthly" ? 120 : horizon === "quarterly" ? 270 : 365;
  const cutoffIso = new Date(now.getTime() - lookbackDays * 86_400_000).toISOString().slice(0, 10);

  // Estimate Account Balance Reference from accounts table if available
  let accountBaselineBalance = 50000;
  try {
    const accRows = db.prepare(`SELECT initial_balance FROM accounts`).all() as any[];
    const sumInit = accRows.reduce((acc, r) => acc + Number(r.initial_balance || 0), 0);
    if (sumInit > 0) accountBaselineBalance = sumInit;
  } catch {}

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

  // Calculate Trader's Baseline 1R Risk ($ and % of Account) across all recent trades
  const all1RRisks = allTrades
    .map((t) => estimateTrade1RDollarRisk(t))
    .filter((v): v is number => v !== null && v > 0);
  const baseline1RUsd = Math.round(computeMedian(all1RRisks) * 100) / 100 || 500;
  const baseline1RPct = Math.round((baseline1RUsd / accountBaselineBalance) * 10000) / 100;

  const trades =
    customScope?.selectedTradeKeys && customScope.selectedTradeKeys.length > 0
      ? allTrades.filter((t) => customScope.selectedTradeKeys!.includes(t.key))
      : allTrades.filter((t) => String(t.opened_at).slice(0, 10) >= cutoffIso);

  let revengeCount = 0;
  let revengePnl = 0;
  let revengeWins = 0;
  let postLossRiskExpansionCount = 0;
  let postWinRiskExpansionCount = 0;
  let riskReductionAfterLossCount = 0;
  const mistakeCounts: Record<string, number> = {};
  const tagCounts: Record<string, number> = {};
  const sessionStats: Record<string, { trades: number; pnl: number; wins: number }> = {};
  const dailyMap = new Map<string, { trades: number; pnl: number; peakPnl: number; giveback: number }>();

  for (let i = 0; i < trades.length; i++) {
    const t = trades[i];
    const pnl = Number(t.net_pnl || 0);
    const trade1RUsd = estimateTrade1RDollarRisk(t);
    t.estimated1RUsd = trade1RUsd;
    t.estimatedRiskPct = trade1RUsd
      ? Math.round((trade1RUsd / accountBaselineBalance) * 10000) / 100
      : null;

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

      // Risk-Normalized Sizing Drift: compare this trade's 1R $ Risk against Baseline 1R $ Risk (NOT lot size!)
      if (trade1RUsd !== null && baseline1RUsd > 0) {
        if (prevPnl < 0 && trade1RUsd > baseline1RUsd * 1.35) {
          postLossRiskExpansionCount += 1;
        }
        if (prevPnl > 0 && trade1RUsd > baseline1RUsd * 1.35) {
          postWinRiskExpansionCount += 1;
        }
        if (prevPnl < 0 && trade1RUsd < baseline1RUsd * 0.65) {
          riskReductionAfterLossCount += 1;
        }
      }
    }
  }

  // Build Period-over-Period Comparison Buckets (Target Period vs Prior 3 Periods)
  const stepDays =
    horizon === "weekly" ? 7 : horizon === "monthly" ? 30 : horizon === "quarterly" ? 90 : 365;
  const periodComparisonBuckets: Array<{
    periodLabel: string;
    dateRange: string;
    trades: number;
    netPnl: number;
    winRatePct: number;
    avgRisk1RUsd: number;
    riskDriftCount: number;
    revengeCount: number;
  }> = [];

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
      ...summarizeBucketMetrics(bucketTrades, baseline1RUsd),
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
    baseline1RUsd,
    baseline1RPct,
    revengeTradesCount: revengeCount,
    revengeWinRatePct: revengeCount > 0 ? Math.round((revengeWins / revengeCount) * 100) : 0,
    revengeNetPnl: Math.round(revengePnl * 100) / 100,
    // Keep both names so UI compatibility is preserved while measuring 1R Risk % expansion
    postLossSizeExpansionCount: postLossRiskExpansionCount,
    postLossRiskExpansionCount,
    postWinRiskExpansionCount,
    riskReductionAfterLossCount,
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
      estimated1RUsd: estimateTrade1RDollarRisk(t),
      mistakes: t.mistakes,
      tags: t.tags,
      hasNotes: Boolean((t.notes || "").trim()),
      tradeUrl: t.tradeUrl,
    })),
    recentTradesSample: trades.slice(-25),
  };
}

// Fallback extractor if the LLM omits the ```json block at the end of a report
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

    const priorReports = db
      .prepare(`SELECT period_key, horizon, title, summary_md, created_at FROM ai_coach_reports WHERE horizon = ? ORDER BY created_at DESC LIMIT 3`)
      .all(horizon) as any[];

    const now = new Date();
    const isCustomScoped =
      (customScope?.selectedJournalSlugs && customScope.selectedJournalSlugs.length > 0) ||
      (customScope?.selectedTradeKeys && customScope.selectedTradeKeys.length > 0) ||
      Boolean(customScope?.customFocusPrompt?.trim());

    const periodKey = isCustomScoped
      ? `Scoped (${parsedJournals.length}J / ${recentTradesSample.length}T)`
      : horizon === "weekly"
      ? `${now.toISOString().slice(0, 10)}`
      : horizon === "monthly"
      ? `${now.toISOString().slice(0, 7)}`
      : horizon === "quarterly"
      ? `${now.getFullYear()}-Q${Math.floor(now.getMonth() / 3) + 1}`
      : `${now.getFullYear()}`;

    const reportTitle = isCustomScoped
      ? `Scoped Audit · ${parsedJournals.map((j: any) => j.slug).slice(0, 2).join(", ")}${parsedJournals.length > 2 ? ` +${parsedJournals.length - 2}` : ""}`
      : horizon === "weekly"
      ? `Weekly Delta Audit (${periodKey})`
      : horizon === "monthly"
      ? `Monthly Habit & Trajectory Report (${periodKey})`
      : horizon === "quarterly"
      ? `Quarterly Psychological Synthesis (${periodKey})`
      : `Annual Trading Evolution Audit (${periodKey})`;

    const horizonRoleGuide =
      horizon === "weekly"
        ? "This is a WEEKLY DELTA AUDIT: Use the most recent week (Target Week) as your primary subject and explicitly compare it against the previous 3 weeks (Week -1, Week -2, Week -3). Focus on immediate session execution, emotional triggers, and week-over-week shifts."
        : horizon === "monthly"
        ? "This is a MONTHLY HABIT & TRAJECTORY AUDIT: Compare the Target Month against the previous 3 months (Month -1, Month -2, Month -3). Focus on recurring behavioral loops, routine consistency, and whether weekly adjustments solidified into habits."
        : "This is a MACRO QUARTERLY / YEARLY AUDIT: Synthesize multi-month evolution, risk-of-ruin discipline, drawdown recovery, and long-term edge maturity across quarters.";

    const customFocusSection = customScope?.customFocusPrompt?.trim()
      ? `\n=== SPECIFIC FOCUS REQUESTED BY TRADER ===\n${customScope.customFocusPrompt.trim()}\n`
      : "";

    const deepPrompt = `You are a longitudinal trading psychology and behavioral performance analyst.
You do NOT evaluate the trader's technical chart model.
${horizonRoleGuide}

CRITICAL SIZING RULE: The trader sizes positions by risking a % of account equity (1R) based on stop distance—so raw lot/contract quantities naturally vary per setup. NEVER judge sizing drift by raw lot size! Only evaluate sizing discipline using the provided 1R Dollar Risk (\`estimated1RUsd\`) and \`postLossRiskExpansionCount\` relative to their baseline 1R ($${telemetry.baseline1RUsd} / ${telemetry.baseline1RPct}%).

CLICKABLE LINKS RULE: Whenever you reference a specific trade or journal entry, format it as a clickable Markdown link using the exact URL provided in the data below, e.g. \`[NAS100 Short 10/19 (-$499.20)](/trades?symbol=NAS100&from=2026-10-19&to=2026-10-19)\` or \`[Journal 2026-W42](/journal?slug=2026-W42)\`.
${customFocusSection}
=== 1. PERIOD-OVER-PERIOD COMPARISON TABLE (${horizon.toUpperCase()} DELTAS) ===
${JSON.stringify(telemetry.periodComparisonBuckets, null, 2)}

=== 2. OVERALL BEHAVIORAL TELEMETRY (1R RISK NORMALIZED) ===
${JSON.stringify(telemetry, null, 2)}

=== 3. ACTIVE GOALS TO AUDIT FOR ACCOUNTABILITY ===
${activeGoals.length > 0 ? activeGoals.map((g) => `ID: ${g.id} | [${g.horizon.toUpperCase()}] "${g.title}" | Target Metric: "${g.target_metric}" | Why: "${g.why_it_matters}"`).join("\n") : "No active goals defined yet—propose concrete goals across Weekly, Monthly, and Quarterly horizons."}

=== 4. SELECTED JOURNAL ENTRIES (${parsedJournals.length} ENTRIES | LINK WITH [Slug](journalUrl)) ===
${parsedJournals.length > 0 ? parsedJournals.map((j: any) => `### JOURNAL [${j.slug}](${j.journalUrl}) (${j.periodType.toUpperCase()}): ${j.title}\n- Process Score: ${j.processRating ?? "N/A"}% | Sub-scores: ${JSON.stringify(j.scores)}\n- Key Takeaway: ${j.lessonsLearned || "None recorded"}\n- Self-Reflection Quotes: ${JSON.stringify(j.qaReflections)}${j.prepSummary ? `\n- Prep Notes: ${j.prepSummary}` : ""}${j.reviewSummary ? `\n- Review Notes: ${j.reviewSummary}` : ""}`).join("\n\n") : "No journal entries in selection."}

=== 5. SELECTED / RECENT TRADES (LINK WITH [Symbol Direction Date](tradeUrl)) ===
${recentTradesSample.length > 0 ? recentTradesSample.map((t: any) => `- [${t.symbol} ${t.direction} ${t.opened_at?.slice(0, 10)} ($${t.net_pnl} | ${t.realized_r ?? "?"}R | 1R Risk ~$${t.estimated1RUsd ?? "?"})](${t.tradeUrl}) | Mistakes=${JSON.stringify(t.mistakes)} | Tags=${JSON.stringify(t.tags)} | Notes=${(t.notes || "").replace(/<[^>]+>/g, " ").slice(0, 180)}`).join("\n") : "No closed trades in this selection."}

=== 6. PREVIOUS ${horizon.toUpperCase()} AI REPORTS (FOR LONGITUDINAL CONTINUITY) ===
${priorReports.length > 0 ? priorReports.map((r) => `[${r.created_at.slice(0, 10)} | ${r.title}]:\n${r.summary_md.slice(0, 900)}`).join("\n---\n") : "First report in this horizon series."}

=== INSTRUCTIONS ===
Write a thorough, candid, deeply insightful report in Markdown with these exact 5 sections:
1. **Period-over-Period Trajectory (${horizon.toUpperCase()} Comparison)**: Compare the Target ${horizon} against the previous periods using the comparison buckets and journals. What improved vs. what regressed?
2. **Psychological & Emotional Pattern Recognition**: Connect the trader's self-reflection quotes and review notes with their 1R risk consistency, hesitation, or execution telemetry. Include clickable Markdown links to specific trades and journals!
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
      (thinkingMode === "fast" ? 4096 : thinkingMode === "balanced" ? 6144 : 10240);

    const aiRes = await runKoboldAi(deepPrompt, {
      persona: "coach",
      thinkingMode,
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
            actionItems = parsedJson.actionItems.map((ai: any, idx: number) => ({
              id: `act_${Date.now()}_${idx}`,
              text: String(ai.text || ai.title || ""),
              horizon: (ai.horizon as GoalHorizon) || horizon,
              targetMetric: String(ai.targetMetric || "Consistent execution"),
              done: false,
            })).filter((a: ReportActionItem) => Boolean(a.text));
          }
          rawMarkdown = rawMarkdown.replace(jsonMatch[0], "").trim();
        } catch {}
      }

      if (!rawMarkdown.trim() && aiRes.reasoning.trim()) {
        rawMarkdown = `*(Note: Model completed reasoning trace; see full thought process below)*\n\n${aiRes.reasoning}`;
      }

      // Append Reference Links Appendix for every Trade & Journal in scope so user ALWAYS has 1-click links
      const tradeLinksMd = recentTradesSample
        .slice(0, 10)
        .map(
          (t: any) =>
            `- [${t.symbol} ${t.direction.toUpperCase()} (${t.opened_at?.slice(0, 10)}) · Net $${t.net_pnl.toFixed(2)}${t.estimated1RUsd ? ` · 1R ~$${t.estimated1RUsd}` : ""}](${t.tradeUrl})`
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
Note: The trader sizes by risking 1R (% of account equity based on stop distance). Evaluate risk discipline using their 1R Dollar Risk ($${telemetry.baseline1RUsd}), not raw lot sizes.
Whenever referencing a specific trade or journal entry, format it as a clickable Markdown link using the exact URL provided below.

=== ACTIVE TRADER GOALS ===
${activeGoals.length > 0 ? activeGoals.map((g) => `- [${g.horizon.toUpperCase()} | ${g.status.toUpperCase()}] ${g.title} (Metric: ${g.target_metric || "N/A"})`).join("\n") : "No active goals set yet."}

=== BEHAVIORAL TELEMETRY (1R NORMALIZED) ===
${JSON.stringify(telemetry, null, 2)}

=== RECENT TRADES WITH CLICKABLE LINKS ===
${recentTradesSample.slice(0, 12).map((t: any) => `- [${t.symbol} ${t.direction} ${t.opened_at?.slice(0, 10)} ($${t.net_pnl})](${t.tradeUrl})`).join("\n")}

=== JOURNAL REFLECTIONS IN CONTEXT (${parsedJournals.length} ENTRIES) ===
${parsedJournals.slice(0, 8).map((j: any) => `[${j.slug} | ${j.title}](${j.journalUrl})\nLessons: ${j.lessonsLearned}\nQ&A Quotes: ${JSON.stringify(j.qaReflections)}\nReview: ${j.reviewSummary}`).join("\n---\n")}

${targetReport ? `=== REFERENCED AI AUDIT REPORT (${targetReport.title}) ===\n${targetReport.summary_md.slice(0, 2400)}` : ""}

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
      `).run(JSON.stringify({ sessionId, messageId: msgId }), nowIso, jobId);
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

    const staleCutoff = new Date(Date.now() - 35 * 60_000).toISOString();
    db.prepare(`
      UPDATE ai_background_jobs
      SET status = 'failed', error_text = 'Timed out'
      WHERE status = 'running' AND started_at < ?
    `).run(staleCutoff);

    const activeJobsRaw = db
      .prepare(`SELECT id, job_type as jobType, target_id as targetId, label, status, result_json as resultJson, started_at as startedAt FROM ai_background_jobs WHERE status = 'running' ORDER BY started_at DESC`)
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

    const chatSessions = db
      .prepare(`SELECT id, title, report_id as reportId, created_at as createdAt, updated_at as updatedAt FROM ai_chat_sessions ORDER BY updated_at DESC LIMIT 50`)
      .all() as any[];

    const reqSessionId = req.nextUrl.searchParams.get("sessionId") || chatSessions[0]?.id || "";
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
      telemetry,
      selectableJournals,
      selectableTrades,
      activeJobs,
      chatSessions,
      activeSessionId: reqSessionId,
      chatMessages,
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
      const saved = saveLocalAiSettings({
        mode: "local_kobold",
        baseUrl: String(body.baseUrl || "[http://100.75.201.34:5001](http://100.75.201.34:5001)").trim(),
      });
      const status = await probeKoboldStatus(saved.baseUrl);
      return NextResponse.json({ ok: true, kobold: { ...saved, ...status } });
    }

    // TOGGLE REPORT ACTION ITEM PROGRESS CHECKBOX
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
      db.prepare(`DELETE FROM ai_coach_reports WHERE id = ?`).run(String(body.reportId || ""));
      return NextResponse.json({ ok: true });
    }

    if (action === "cancel_job") {
      const targetJobId = body.jobId ? String(body.jobId) : null;
      const nowIso = new Date().toISOString();

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
        db.prepare(`UPDATE ai_background_jobs SET status = 'cancelled', error_text = 'Cancelled by user', updated_at = ? WHERE status = 'running'`).run(nowIso);
      }

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

    if (action === "chat_coach") {
      const userMessage = String(body.message || "").trim();
      if (!userMessage) {
        return NextResponse.json({ ok: false, error: "Message is required" }, { status: 400 });
      }

      const customScope: CustomAuditScope | undefined = body.customScope;
      const linkedReportId = String(body.reportId || "");
      const nowIso = new Date().toISOString();
      let sessionId = String(body.sessionId || "").trim();

      if (!sessionId) {
        sessionId = `sess_${Date.now()}`;
        const autoTitle = userMessage.slice(0, 42) + (userMessage.length > 42 ? "…" : "");
        db.prepare(`INSERT INTO ai_chat_sessions (id, title, report_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run(
          sessionId,
          autoTitle,
          linkedReportId,
          nowIso,
          nowIso
        );
      } else {
        const exists = db.prepare(`SELECT id FROM ai_chat_sessions WHERE id = ?`).get(sessionId);
        if (!exists) {
          const autoTitle = userMessage.slice(0, 42) + (userMessage.length > 42 ? "…" : "");
          db.prepare(`INSERT INTO ai_chat_sessions (id, title, report_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run(
            sessionId,
            autoTitle,
            linkedReportId,
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
      `).run(jobId, sessionId, `Coach reply: "${userMessage.slice(0, 28)}..."`, nowIso, nowIso);

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
      });
    }

    if (action === "generate_report" || action === "overnight_auto_audit") {
      const horizon: GoalHorizon = body.horizon || "weekly";
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

      const nowIso = new Date().toISOString();
      const jobId = `job_audit_${horizon}_${Date.now()}`;
      const label =
        customScope?.selectedJournalSlugs?.length || customScope?.selectedTradeKeys?.length
          ? `Scoped Audit (${customScope?.selectedJournalSlugs?.length || 0} journals, ${customScope?.selectedTradeKeys?.length || 0} trades)`
          : `${horizon.charAt(0).toUpperCase() + horizon.slice(1)} Longitudinal Audit`;

      db.prepare(`
        INSERT INTO ai_background_jobs (id, job_type, target_id, label, status, started_at, updated_at)
        VALUES (?, ?, ?, ?, 'running', ?, ?)
      `).run(jobId, `audit_${horizon}`, horizon, label, nowIso, nowIso);

      const controller = new AbortController();
      activeJobControllers.set(jobId, controller);

      void executeAuditJobInBackground(jobId, horizon, controller, customScope);

      return NextResponse.json({
        ok: true,
        background: true,
        jobId,
        horizon,
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
