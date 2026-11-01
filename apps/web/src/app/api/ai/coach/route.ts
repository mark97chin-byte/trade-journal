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

export const dynamic = "force-dynamic";

function getControlDaemonUrl(baseUrl: string): string {
  try {
    const clean = (baseUrl || "http://100.75.201.34:5001").replace(/\/+$/, "").replace(/\/v1$/, "");
    const u = new URL(clean.startsWith("http") ? clean : `http://${clean}`);
    return `${u.protocol}//${u.hostname}:5002`;
  } catch {
    return "http://100.75.201.34:5002";
  }
}


function execShell(cmd: string, timeoutMs = 90_000): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    exec(cmd, { timeout: timeoutMs, env: { ...process.env } }, (error, stdout, stderr) => {
      resolve({
        stdout: String(stdout || ""),
        stderr: String(stderr || ""),
        code: error ? (error as any).code || 1 : 0,
      });
    });
  });
}

export type GoalHorizon = "weekly" | "monthly" | "quarterly";
export type GoalStatus = "on_track" | "slipping" | "breached" | "completed";

export interface TraderGoal {
  id: string;
  horizon: GoalHorizon;
  periodLabel: string;
  title: string;
  whyItMatters: string;
  targetMetric: string;
  status: GoalStatus;
  progressPct: number;
  aiAccountabilityNote: string;
  createdAt: string;
  updatedAt: string;
}

export interface AiCoachReport {
  id: string;
  horizon: GoalHorizon;
  periodKey: string;
  title: string;
  summaryMd: string;
  reasoningTrace: string;
  telemetryJson: string;
  suggestedGoalsJson: string;
  accountabilityJson: string;
  modelUsed: string;
  createdAt: string;
}

function resolveDbPath(): string {
  const p1 = path.resolve(process.cwd(), "data", "journal.db");
  const p2 = path.resolve(process.cwd(), "apps", "web", "data", "journal.db");
  return fs.existsSync(p1) ? p1 : p2;
}

const activeJobControllers = new Map<string, AbortController>();

function ensureCoachTables(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_chat_sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
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
      model_used TEXT DEFAULT 'koboldcpp',
      created_at TEXT NOT NULL
    );
  `);
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

function buildBehavioralTelemetryAndJournals(
  db: Database.Database,
  horizon: GoalHorizon
) {
  const now = new Date();
  const lookbackDays = horizon === "weekly" ? 21 : horizon === "monthly" ? 62 : 120;
  const cutoffIso = new Date(now.getTime() - lookbackDays * 86_400_000).toISOString().slice(0, 10);

  let trades: any[] = [];
  try {
    trades = db
      .prepare(
        `SELECT key, symbol, direction, opened_at, closed_at, quantity, net_pnl, gross_pnl,
                realized_r, mae_r, mfe_r, capture_eff, notes, tags, mistakes, playbook, rating
         FROM trades
         WHERE opened_at >= ?
         ORDER BY opened_at ASC`
      )
      .all(cutoffIso) as any[];
  } catch {}

  let revengeCount = 0;
  let revengePnl = 0;
  let revengeWins = 0;
  let postLossSizeExpansionCount = 0;
  let postWinSizeExpansionCount = 0;
  const mistakeCounts: Record<string, number> = {};
  const tagCounts: Record<string, number> = {};
  const sessionStats: Record<string, { trades: number; pnl: number; wins: number }> = {};
  const dailyMap = new Map<string, { trades: number; pnl: number; peakPnl: number; giveback: number }>();

  const avgQty =
    trades.length > 0
      ? trades.reduce((acc, t) => acc + Number(t.quantity || 0), 0) / trades.length
      : 1;

  for (let i = 0; i < trades.length; i++) {
    const t = trades[i];
    const pnl = Number(t.net_pnl || 0);
    const qty = Number(t.quantity || 0);
    const dayKey = String(t.opened_at || "").slice(0, 10);

    const dStat = dailyMap.get(dayKey) || { trades: 0, pnl: 0, peakPnl: 0, giveback: 0 };
    dStat.trades += 1;
    dStat.pnl += pnl;
    if (dStat.pnl > dStat.peakPnl) dStat.peakPnl = dStat.pnl;
    dStat.giveback = Math.max(0, dStat.peakPnl - dStat.pnl);
    dailyMap.set(dayKey, dStat);

    try {
      const mArr = typeof t.mistakes === "string" && t.mistakes.startsWith("[")
        ? JSON.parse(t.mistakes)
        : String(t.mistakes || "").split(",").filter(Boolean);
      for (const m of mArr) {
        const cleanM = String(m).trim();
        if (cleanM) mistakeCounts[cleanM] = (mistakeCounts[cleanM] || 0) + 1;
      }
    } catch {}

    try {
      const tArr = typeof t.tags === "string" && t.tags.startsWith("[")
        ? JSON.parse(t.tags)
        : String(t.tags || "").split(",").filter(Boolean);
      for (const tg of tArr) {
        const cleanT = String(tg).trim();
        if (cleanT) tagCounts[cleanT] = (tagCounts[cleanT] || 0) + 1;
      }
    } catch {}

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
      if (prevPnl < 0 && qty > avgQty * 1.35) {
        postLossSizeExpansionCount += 1;
      }
      if (prevPnl > 0 && qty > avgQty * 1.35) {
        postWinSizeExpansionCount += 1;
      }
    }
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
        `SELECT symbol, direction, observed_at, miss_reason, theoretical_pnl, realized_r, notes
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
         ORDER BY slug DESC LIMIT 35`
      )
      .all() as any[];
  } catch {}

  const parsedJournals = journals
    .map((j) => {
      const prepDigest = htmlToStructuredDigest(j.content || "");
      const revDigest = htmlToStructuredDigest(j.review_content || "");
      let scores: any = {};
      try {
        scores = JSON.parse(j.scores_json || "{}");
      } catch {}
      const hasSubstantiveText =
        prepDigest.cleanText.length > 40 ||
        revDigest.cleanText.length > 40 ||
        Boolean((j.lessons_learned || "").trim());
      if (!hasSubstantiveText) return null;
      return {
        slug: j.slug,
        periodType: j.period_type,
        title: j.title,
        scores,
        processRating: j.rating,
        lessonsLearned: j.lessons_learned || "",
        qaReflections: [...prepDigest.qaReflections, ...revDigest.qaReflections],
        prepSummary: prepDigest.cleanText.slice(0, 1200),
        reviewSummary: revDigest.cleanText.slice(0, 1800),
      };
    })
    .filter(Boolean)
    .slice(0, 18);

  const totalNetPnl = trades.reduce((acc, t) => acc + Number(t.net_pnl || 0), 0);
  const winsCount = trades.filter((t) => Number(t.net_pnl || 0) > 0).length;

  const telemetry = {
    windowDays: lookbackDays,
    cutoffDate: cutoffIso,
    totalTrades: trades.length,
    winRatePct: trades.length > 0 ? Math.round((winsCount / trades.length) * 1000) / 10 : 0,
    totalNetPnl: Math.round(totalNetPnl * 100) / 100,
    revengeTradesCount: revengeCount,
    revengeWinRatePct: revengeCount > 0 ? Math.round((revengeWins / revengeCount) * 100) : 0,
    revengeNetPnl: Math.round(revengePnl * 100) / 100,
    postLossSizeExpansionCount,
    postWinSizeExpansionCount,
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

  return { telemetry, parsedJournals, recentTradesSample: trades.slice(-20) };
}

// Background Audit Runner (Continues running even if user navigates away from Progress page!)
async function executeAuditJobInBackground(
  jobId: string,
  horizon: GoalHorizon,
  controller: AbortController
) {
  const dbPath = resolveDbPath();
  const db = new Database(dbPath);
  try {
    ensureCoachTables(db);
    const { telemetry, parsedJournals, recentTradesSample } =
      buildBehavioralTelemetryAndJournals(db, horizon);

    const activeGoals = db
      .prepare(`SELECT * FROM trader_goals WHERE status != 'completed' ORDER BY updated_at DESC`)
      .all() as any[];

    const priorReports = db
      .prepare(`SELECT period_key, horizon, title, summary_md, created_at FROM ai_coach_reports ORDER BY created_at DESC LIMIT 3`)
      .all() as any[];

    const now = new Date();
    const periodKey =
      horizon === "weekly"
        ? `${now.toISOString().slice(0, 10)}`
        : horizon === "monthly"
        ? `${now.toISOString().slice(0, 7)}`
        : `${now.getFullYear()}-Q${Math.floor(now.getMonth() / 3) + 1}`;

    const reportTitle =
      horizon === "weekly"
        ? `Weekly Behavioral & Trajectory Audit (${periodKey})`
        : horizon === "monthly"
        ? `Monthly Longitudinal Evolution Report (${periodKey})`
        : `Quarterly Psychological & Process Synthesis (${periodKey})`;

    const deepPrompt = `You are a longitudinal trading psychology and behavioral performance analyst.
You do NOT evaluate the trader's technical chart model.

=== 1. ACTIVE GOALS TO AUDIT ===
${activeGoals.length > 0 ? activeGoals.map((g) => `ID: ${g.id} | [${g.horizon.toUpperCase()}] "${g.title}" | Target Metric: "${g.target_metric}" | Why: "${g.why_it_matters}"`).join("\n") : "No active goals yet—propose 3 structured goals across Weekly, Monthly, and Quarterly horizons."}

=== 2. HARD BEHAVIORAL TELEMETRY (LAST ${telemetry.windowDays} DAYS) ===
${JSON.stringify(telemetry, null, 2)}

=== 3. MULTI-JOURNAL REVIEWS, LESSONS LEARNED & QUOTE BLOCK Q&A ===
${parsedJournals.length > 0 ? parsedJournals.map((j: any) => `### JOURNAL [${j.slug}] (${j.periodType.toUpperCase()}): ${j.title}\n- Process Score: ${j.processRating ?? "N/A"}% | Sub-scores: ${JSON.stringify(j.scores)}\n- Key Takeaway: ${j.lessonsLearned || "None recorded"}\n- Self-Reflection Quotes: ${JSON.stringify(j.qaReflections)}\n- Prep Excerpt: ${j.prepSummary || "None"}\n- Review Excerpt: ${j.reviewSummary || "None"}`).join("\n\n") : "No rich text journals recorded yet in this window."}

=== 4. RECENT TRADES SAMPLE ===
${recentTradesSample.map((t: any) => `${t.opened_at?.slice(0, 16)} | ${t.symbol} ${t.direction} qty=${t.quantity} | Net=$${t.net_pnl} (${t.realized_r ?? "?"}R) | Mistakes=${t.mistakes || "none"} | Notes=${(t.notes || "").replace(/<[^>]+>/g, " ").slice(0, 140)}`).join("\n")}

=== 5. PREVIOUS AI LONGITUDINAL REPORTS ===
${priorReports.length > 0 ? priorReports.map((r) => `[${r.created_at.slice(0, 10)} | ${r.title}]:\n${r.summary_md.slice(0, 1000)}`).join("\n---\n") : "This is the first longitudinal report in the series."}

=== INSTRUCTIONS ===
Write a thorough, candid, deeply insightful longitudinal report in Markdown with these exact sections:
1. **Executive Trajectory (${horizon.toUpperCase()} Progress)**
2. **Psychological & Emotional Pattern Recognition**
3. **Goal Accountability Audit**
4. **Recommended Multi-Level Goals (Weekly -> Monthly -> Quarterly)**

At the end, append a JSON block wrapped in \`\`\`json ... \`\`\` with:
\`\`\`json
{
  "goalAudits": [
    {
      "goalId": "exact ID from section 1 if any",
      "status": "on_track | slipping | breached | completed",
      "progressPct": 75,
      "evidenceNote": "1-sentence specific citation"
    }
  ],
  "suggestedGoals": [
    {
      "horizon": "weekly",
      "periodLabel": "Next Week",
      "title": "Concise behavioral goal",
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

    const aiRes = await runKoboldAi(deepPrompt, {
      persona: "coach",
      maxOutputTokens: 8192,
      temperature: 0.6,
      timeoutMs: 480_000,
      abortSignal: controller.signal,
    });

    const db2 = new Database(dbPath);
    try {
      // Check if job was cancelled while awaiting
      const jobRow = db2.prepare(`SELECT status FROM ai_background_jobs WHERE id = ?`).get(jobId) as any;
      if (jobRow?.status === "cancelled") return;

      let rawMarkdown = aiRes.text;
      let suggestedGoals: any[] = [];
      let goalAudits: any[] = [];

      const jsonMatch = rawMarkdown.match(/```json\s*([\s\S]*?)```/i);
      if (jsonMatch?.[1]) {
        try {
          const parsedJson = JSON.parse(jsonMatch[1].trim());
          if (Array.isArray(parsedJson.suggestedGoals)) suggestedGoals = parsedJson.suggestedGoals;
          if (Array.isArray(parsedJson.goalAudits)) goalAudits = parsedJson.goalAudits;
          rawMarkdown = rawMarkdown.replace(jsonMatch[0], "").trim();
        } catch {}
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
          telemetry_json, suggested_goals_json, accountability_json, model_used, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        reportId,
        horizon,
        periodKey,
        reportTitle,
        rawMarkdown,
        aiRes.reasoning || "",
        JSON.stringify(telemetry),
        JSON.stringify(suggestedGoals),
        JSON.stringify(goalAudits),
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

// Background Chat Runner (Continues running & saves reply to SQLite even if user clicks away!)
async function executeChatJobInBackground(
  jobId: string,
  sessionId: string,
  userMessage: string,
  controller: AbortController
) {
  const dbPath = resolveDbPath();
  const db = new Database(dbPath);
  try {
    ensureCoachTables(db);
    const { telemetry, parsedJournals } = buildBehavioralTelemetryAndJournals(db, "monthly");
    const activeGoals = db.prepare(`SELECT * FROM trader_goals ORDER BY updated_at DESC`).all() as any[];
    const latestReport = db
      .prepare(`SELECT title, summary_md FROM ai_coach_reports ORDER BY created_at DESC LIMIT 1`)
      .get() as any;

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

=== ACTIVE TRADER GOALS ===
${activeGoals.length > 0 ? activeGoals.map((g) => `- [${g.horizon.toUpperCase()} | ${g.status.toUpperCase()}] ${g.title} (Metric: ${g.target_metric || "N/A"}) — Note: ${g.ai_accountability_note || "None"}`).join("\n") : "No active goals set yet."}

=== BEHAVIORAL TELEMETRY (LAST ${telemetry.windowDays} DAYS) ===
${JSON.stringify(telemetry, null, 2)}

=== RECENT JOURNAL REFLECTIONS & QUOTE Q&A ===
${parsedJournals.slice(0, 8).map((j: any) => `[${j.slug} | ${j.title} | Score: ${j.processRating ?? "N/A"}%]\nLessons: ${j.lessonsLearned}\nQ&A Quotes: ${JSON.stringify(j.qaReflections)}\nReview: ${j.reviewSummary}`).join("\n---\n")}

${latestReport ? `=== MOST RECENT AI LONGITUDINAL REPORT (${latestReport.title}) ===\n${latestReport.summary_md.slice(0, 1600)}` : ""}

=== CONVERSATION HISTORY IN THIS SESSION ===
${historyTranscript}

Respond directly, candidly, and empathetically as a peer accountability partner to the trader's latest message.`;

    db.close();

    const aiRes = await runKoboldAi(chatPrompt, {
      persona: "coach",
      maxOutputTokens: 2500,
      temperature: 0.6,
      abortSignal: controller.signal,
    });

    const db2 = new Database(dbPath);
    try {
      const jobRow = db2.prepare(`SELECT status FROM ai_background_jobs WHERE id = ?`).get(jobId) as any;
      if (jobRow?.status === "cancelled") return;

      const nowIso = new Date().toISOString();
      const msgId = `msg_${Date.now()}_coach`;
      db2.prepare(`
        INSERT INTO ai_chat_messages (id, session_id, role, content, reasoning, model_used, created_at)
        VALUES (?, ?, 'coach', ?, ?, ?, ?)
      `).run(msgId, sessionId, aiRes.text, aiRes.reasoning || "", aiRes.model || "koboldcpp", nowIso);

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

    // Auto-expire stale jobs older than 12 minutes
    const staleCutoff = new Date(Date.now() - 12 * 60_000).toISOString();
    db.prepare(`
      UPDATE ai_background_jobs
      SET status = 'failed', error_text = 'Timed out'
      WHERE status = 'running' AND started_at < ?
    `).run(staleCutoff);

    const activeJobs = db
      .prepare(`SELECT id, job_type as jobType, target_id as targetId, label, status, started_at as startedAt FROM ai_background_jobs WHERE status = 'running' ORDER BY started_at DESC`)
      .all() as any[];

    const recentJobs = db
      .prepare(`SELECT id, job_type as jobType, target_id as targetId, label, status, error_text as errorText, result_json as resultJson, updated_at as updatedAt FROM ai_background_jobs ORDER BY updated_at DESC LIMIT 5`)
      .all() as any[];

    const chatSessions = db
      .prepare(`SELECT id, title, created_at as createdAt, updated_at as updatedAt FROM ai_chat_sessions ORDER BY updated_at DESC LIMIT 30`)
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
      .prepare(`SELECT * FROM ai_coach_reports ORDER BY created_at DESC LIMIT 15`)
      .all() as any[];

    const { telemetry } = buildBehavioralTelemetryAndJournals(db, "monthly");

    return NextResponse.json({
      ok: true,
      kobold: { ...localSettings, ...status },
      telemetry,
      activeJobs,
      recentJobs,
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
      reports: reports.map((r) => ({
        id: r.id,
        horizon: r.horizon,
        periodKey: r.period_key,
        title: r.title,
        summaryMd: r.summary_md,
        reasoningTrace: r.reasoning_trace,
        telemetry: JSON.parse(r.telemetry_json || "{}"),
        suggestedGoals: JSON.parse(r.suggested_goals_json || "[]"),
        accountability: JSON.parse(r.accountability_json || "[]"),
        modelUsed: r.model_used,
        createdAt: r.created_at,
      })),
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

    // 1. SCAN GGUF MODELS DIRECTORY & DAEMON STATUS (VIA HTTP DAEMON PORT 5002 OR LOCAL FS)
    if (action === "scan_models" || action === "daemon_status") {
      const settings = loadLocalAiSettings();
      const targetDir = String(body.dir || settings.modelsDir || "~/koboldcpp/models").trim();
      const daemonUrl = getControlDaemonUrl(body.baseUrl || settings.baseUrl);

      // Query Desktop Control Daemon on port 5002 first (works seamlessly from Tablet over Tailscale!)
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
            activeJobs: db.prepare("SELECT id, job_type as jobType, label, started_at as startedAt FROM ai_background_jobs WHERE status = 'running'").all(),
          });
        }
      } catch {}

      // Fallback: local filesystem scan if running directly on desktop without daemon
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

    // 2. REMOTE START / RESTART / STOP KOBOLDCPP SERVER FROM TABLET UI
    if (action === "control_kobold") {
      const settings = loadLocalAiSettings();
      const baseUrl = String(body.baseUrl || settings.baseUrl || "http://100.75.201.34:5001").trim();
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
      } catch (e: any) {
        return NextResponse.json(
          {
            ok: false,
            error: `Could not reach Desktop Control Daemon at ${daemonUrl}. Make sure kobold-control.service is running on your desktop.`,
          },
          { status: 502 }
        );
      }
    }

    // 2b. SET ACTIVE GGUF MODEL
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

    // 3. SAVE KOBOLD CONFIG & PROBE STATUS
    if (action === "save_kobold_config") {
      const saved = saveLocalAiSettings({
        mode: "local_kobold",
        baseUrl: String(body.baseUrl || "http://100.75.201.34:5001").trim(),
      });
      const status = await probeKoboldStatus(saved.baseUrl);
      return NextResponse.json({ ok: true, kobold: { ...saved, ...status } });
    }

    // 4. GOALS CRUD
    if (action === "upsert_goal") {
      const nowIso = new Date().toISOString();
      const id = body.id || `goal_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const horizon: GoalHorizon = body.horizon || "weekly";
      const periodLabel = body.periodLabel || (horizon === "weekly" ? "Current Week" : horizon === "monthly" ? "Current Month" : "Current Quarter");
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

    // 5. CANCEL RUNNING AI JOB (ABORTS BOTH BACKGROUND TASK AND DESKTOP KOBOLDCPP GENERATION)
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

      // Tell KoboldCpp on desktop to stop generating immediately
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

    // 5b. MANAGE CHAT SESSIONS (NEW SESSION / DELETE SESSION)
    if (action === "new_chat_session") {
      const nowIso = new Date().toISOString();
      const sessionId = `sess_${Date.now()}`;
      const title = String(body.title || `Coaching Session · ${nowIso.slice(5, 10)}`).trim();
      db.prepare(`INSERT INTO ai_chat_sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)`).run(
        sessionId,
        title,
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

    // 5c. CHAT COACH (SAVES USER MSG IMMEDIATELY & RUNS GENERATION IN DETACHED BACKGROUND JOB)
    if (action === "chat_coach") {
      const userMessage = String(body.message || "").trim();
      if (!userMessage) {
        return NextResponse.json({ ok: false, error: "Message is required" }, { status: 400 });
      }

      const nowIso = new Date().toISOString();
      let sessionId = String(body.sessionId || "").trim();

      if (!sessionId) {
        sessionId = `sess_${Date.now()}`;
        const autoTitle = userMessage.slice(0, 42) + (userMessage.length > 42 ? "…" : "");
        db.prepare(`INSERT INTO ai_chat_sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)`).run(
          sessionId,
          autoTitle,
          nowIso,
          nowIso
        );
      } else {
        const exists = db.prepare(`SELECT id FROM ai_chat_sessions WHERE id = ?`).get(sessionId);
        if (!exists) {
          const autoTitle = userMessage.slice(0, 42) + (userMessage.length > 42 ? "…" : "");
          db.prepare(`INSERT INTO ai_chat_sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)`).run(
            sessionId,
            autoTitle,
            nowIso,
            nowIso
          );
        } else {
          db.prepare(`UPDATE ai_chat_sessions SET updated_at = ? WHERE id = ?`).run(nowIso, sessionId);
        }
      }

      // Insert user message immediately so it is never lost if user switches tabs
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

      // Fire and forget in background!
      void executeChatJobInBackground(jobId, sessionId, userMessage, controller);

      return NextResponse.json({
        ok: true,
        background: true,
        jobId,
        sessionId,
      });
    }

    // 6. GENERATE LONGITUDINAL REPORT (RUNS IN DETACHED BACKGROUND SO USER CAN NAVIGATE FREELY)
    if (action === "generate_report" || action === "overnight_auto_audit") {
      const horizon: GoalHorizon = body.horizon || "weekly";

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

      // Prevent duplicate concurrent audit of the same horizon
      const existingJob = db
        .prepare(`SELECT id FROM ai_background_jobs WHERE status = 'running' AND job_type = ?`)
        .get(`audit_${horizon}`) as any;
      if (existingJob) {
        return NextResponse.json({
          ok: true,
          background: true,
          jobId: existingJob.id,
          horizon,
          alreadyRunning: true,
        });
      }

      const nowIso = new Date().toISOString();
      const jobId = `job_audit_${horizon}_${Date.now()}`;
      db.prepare(`
        INSERT INTO ai_background_jobs (id, job_type, target_id, label, status, started_at, updated_at)
        VALUES (?, ?, ?, ?, 'running', ?, ?)
      `).run(
        jobId,
        `audit_${horizon}`,
        horizon,
        `${horizon.charAt(0).toUpperCase() + horizon.slice(1)} Longitudinal Audit`,
        nowIso,
        nowIso
      );

      const controller = new AbortController();
      activeJobControllers.set(jobId, controller);

      // Spawn detached background audit
      void executeAuditJobInBackground(jobId, horizon, controller);

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
