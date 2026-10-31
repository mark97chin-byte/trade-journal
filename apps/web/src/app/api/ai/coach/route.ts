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
} from "@/server/ai";

export const dynamic = "force-dynamic";

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

export async function GET() {
  const dbPath = resolveDbPath();
  const db = new Database(dbPath);
  try {
    ensureCoachTables(db);
    const localSettings = loadLocalAiSettings();
    const status = await probeKoboldStatus(localSettings.baseUrl);

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

    // 1. SCAN GGUF MODELS DIRECTORY (LOCAL FS OR OVER TAILSCALE SSH)
    if (action === "scan_models") {
      const settings = loadLocalAiSettings();
      let targetDir = String(body.dir || settings.modelsDir || "~/koboldcpp/models").trim();
      const rawDir = targetDir;

      let resolvedLocalDir = targetDir;
      if (resolvedLocalDir.startsWith("~")) {
        resolvedLocalDir = resolvedLocalDir.replace(/^~/, process.env.HOME || process.env.USERPROFILE || "");
      } else if (resolvedLocalDir.includes("%USERPROFILE%")) {
        resolvedLocalDir = resolvedLocalDir.replace("%USERPROFILE%", process.env.USERPROFILE || "");
      }

      let ggufFiles: Array<{ name: string; sizeMb: number }> = [];

      if (fs.existsSync(resolvedLocalDir)) {
        try {
          const entries = fs.readdirSync(resolvedLocalDir, { withFileTypes: true });
          for (const ent of entries) {
            if (ent.isFile() && ent.name.toLowerCase().endsWith(".gguf")) {
              const fullP = path.join(resolvedLocalDir, ent.name);
              const stat = fs.statSync(fullP);
              ggufFiles.push({
                name: ent.name,
                sizeMb: Math.round((stat.size / (1024 * 1024)) * 10) / 10,
              });
            }
          }
        } catch {}
      }

      if (ggufFiles.length === 0) {
        try {
          const remoteHost = settings.baseUrl.includes("100.")
            ? settings.baseUrl.split("://")[1]?.split(":")[0] || "100.75.201.34"
            : "100.75.201.34";

          const pyScript = `python3 -c "import os, glob; d = os.path.expanduser(os.path.expandvars('${rawDir}')); [print(f'{os.path.basename(f)}|{round(os.path.getsize(f)/(1024*1024),1)}') for f in glob.glob(os.path.join(d, '*.gguf'))]" 2>/dev/null || python -c "import os, glob; d = os.path.expanduser(os.path.expandvars('${rawDir}')); [print(f'{os.path.basename(f)}|{round(os.path.getsize(f)/(1024*1024),1)}') for f in glob.glob(os.path.join(d, '*.gguf'))]" 2>/dev/null`;

          const sshCmd = `ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=4 mark@${remoteHost} "${pyScript}"`;
          const sshRes = await execShell(sshCmd, 8000);
          if (sshRes.code === 0 && sshRes.stdout) {
            const lines = sshRes.stdout.trim().split("\n");
            for (const line of lines) {
              const [name, sizeStr] = line.trim().split("|");
              if (name && name.toLowerCase().endsWith(".gguf")) {
                ggufFiles.push({ name: name.trim(), sizeMb: parseFloat(sizeStr || "0") });
              }
            }
          }
        } catch {}
      }

      saveLocalAiSettings({ modelsDir: rawDir });
      return NextResponse.json({ ok: true, modelsDir: rawDir, models: ggufFiles });
    }

    // 2. SET ACTIVE GGUF MODEL
    if (action === "set_active_model") {
      const modelFile = String(body.modelFile || "").trim();
      const settings = loadLocalAiSettings();
      saveLocalAiSettings({ activeModelFile: modelFile });

      const remoteHost = settings.baseUrl.includes("100.")
        ? settings.baseUrl.split("://")[1]?.split(":")[0] || "100.75.201.34"
        : "100.75.201.34";

      const updateCmd = `
        if [ -f "$HOME/koboldcpp/start-kobold.sh" ]; then
          sed -i 's|MODEL=".*"|MODEL="$HOME/koboldcpp/models/${modelFile}"|g' "$HOME/koboldcpp/start-kobold.sh"
        fi
      `;

      try {
        await execShell(`ssh -o BatchMode=yes mark@${remoteHost} "${updateCmd}" 2>/dev/null`, 4000);
      } catch {}

      return NextResponse.json({ ok: true, activeModelFile: modelFile });
    }

    // 3. SAVE KOBOLD CONFIG
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

    // 5. CHAT COACH
    if (action === "chat_coach") {
      const userMessage = String(body.message || "").trim();
      if (!userMessage) {
        return NextResponse.json({ ok: false, error: "Message is required" }, { status: 400 });
      }
      const { telemetry, parsedJournals } = buildBehavioralTelemetryAndJournals(db, "monthly");
      const activeGoals = db.prepare(`SELECT * FROM trader_goals ORDER BY updated_at DESC`).all() as any[];
      const latestReport = db
        .prepare(`SELECT title, summary_md FROM ai_coach_reports ORDER BY created_at DESC LIMIT 1`)
        .get() as any;

      const chatPrompt = `You are the trader's dedicated Behavioral & Performance Accountability Coach.
You DO NOT judge their technical trading strategy or market model.

=== ACTIVE TRADER GOALS ===
${activeGoals.length > 0 ? activeGoals.map((g) => `- [${g.horizon.toUpperCase()} | ${g.status.toUpperCase()}] ${g.title} (Metric: ${g.target_metric || "N/A"}) — Note: ${g.ai_accountability_note || "None"}`).join("\n") : "No active goals set yet."}

=== BEHAVIORAL TELEMETRY (LAST ${telemetry.windowDays} DAYS) ===
${JSON.stringify(telemetry, null, 2)}

=== RECENT JOURNAL REFLECTIONS & QUOTE Q&A ===
${parsedJournals.slice(0, 8).map((j: any) => `[${j.slug} | ${j.title} | Score: ${j.processRating ?? "N/A"}%]\nLessons: ${j.lessonsLearned}\nQ&A Quotes: ${JSON.stringify(j.qaReflections)}\nReview: ${j.reviewSummary}`).join("\n---\n")}

${latestReport ? `=== MOST RECENT AI LONGITUDINAL REPORT (${latestReport.title}) ===\n${latestReport.summary_md.slice(0, 1800)}` : ""}

=== TRADER'S QUESTION / MESSAGE ===
${userMessage}

Respond directly, candidly, and empathetically as a peer accountability partner.`;

      const aiRes = await runKoboldAi(chatPrompt, {
        persona: "coach",
        maxOutputTokens: 2500,
        temperature: 0.6,
      });

      return NextResponse.json({
        ok: true,
        reply: aiRes.text,
        reasoning: aiRes.reasoning,
        model: aiRes.model,
      });
    }

    // 6. GENERATE REPORT
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

      const aiRes = await runKoboldAi(deepPrompt, {
        persona: "coach",
        maxOutputTokens: 8192,
        temperature: 0.6,
        timeoutMs: 480_000,
      });

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
          db.prepare(`
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
      db.prepare(`
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

      return NextResponse.json({
        ok: true,
        reportId,
        title: reportTitle,
        summaryMd: rawMarkdown,
        reasoningTrace: aiRes.reasoning,
        suggestedGoals,
        goalAudits,
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
