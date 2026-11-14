import { NextRequest, NextResponse } from "next/server";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { loadLocalAiSettings, probeKoboldStatus, runKoboldAi } from "@/server/ai";

export const dynamic = "force-dynamic";

function resolveDbPath(): string {
  const p1 = path.resolve(process.cwd(), "data", "journal.db");
  const p2 = path.resolve(process.cwd(), "apps", "web", "data", "journal.db");
  return fs.existsSync(p1) ? p1 : p2;
}

function buildDeterministicQuantReport(payload: any): string {
  const b = payload?.baseline || {};
  const mfeBest = payload?.mfeCurve?.bestTrailing;
  const topPartial = payload?.partialGrid?.[0];
  const topEdges = payload?.edgeAmplifiers || [];
  const topLeaks = payload?.drawdownLeaks || [];
  const topPairs = payload?.confluencePairs || [];
  const topHesitation = payload?.hesitationTax || [];
  const kzBest = payload?.dimensions?.byKillzone?.[0];
  const c7Best = payload?.dimensions?.by7hCandle?.[0];
  const durBest = payload?.dimensions?.byDuration?.[0];
  const durWorst =
    payload?.dimensions?.byDuration?.length > 1
      ? payload.dimensions.byDuration[payload.dimensions.byDuration.length - 1]
      : null;
  const seqRows = payload?.dimensions?.bySequentialState || [];
  const symDirRows = payload?.dimensions?.bySymbolDirection || [];

  const lines: string[] = [];

  lines.push("## 1. Sample Confidence & System Quality Telemetry");
  if ((b.count || 0) < 20) {
    lines.push(
      `- **Data Skew Warning (${b.count || 0} / 20 setups):** Current dataset contains **${b.count || 0} setups** (${b.executedCount || 0} executed, ${b.missedCount || 0} missed). Because the sample is below 20 trades, single outliers can skew percentages—treat these findings as emerging hypotheses.`
    );
  } else {
    lines.push(
      `- **Actionable Sample Size (${b.count} setups):** Dataset meets the 20+ trade threshold with a **System Quality Number (SQN) of ${b.sqn}** and a 95% Expectancy Confidence Interval of **[${b.ci95LowR}R, +${b.ci95HighR}R]**.`
    );
  }
  lines.push(
    `- **Baseline Expectancy & Sizing:** Overall Win Rate is **${b.winRate}%** with **${b.expectancyR >= 0 ? "+" : ""}${b.expectancyR}R expectancy per trade** (Net **${b.totalR >= 0 ? "+" : ""}${b.totalR}R** / **$${b.netPnl}**), Avg Win **+${b.avgWinR}R** vs. Avg Loss **-${b.avgLossR}R** (Payoff Ratio **${b.payoffRatioR}:1**, Profit Factor **${b.profitFactorR}**). Half-Kelly risk ceiling is **${b.halfKellyPct}%** with an expected 100-trade max losing streak of **${b.expectedMaxLosingStreak} trades**.`
  );

  lines.push("\n## 2. MFE Target Optimization & Partial Scale-Out Structure");
  if (mfeBest) {
    const deltaExp = Number((mfeBest.trailingExpR - (b.expectancyR || 0)).toFixed(2));
    lines.push(
      `- **Optimal Full-Hold Target (${mfeBest.targetR}R):** Across recorded MFE excursions, **${mfeBest.targetR}R** is the highest-expectancy target (reached on **${mfeBest.hitRate}%** of setups for **+${mfeBest.trailingExpR}R/trade** vs. actual **${b.expectancyR}R/trade**, a **${deltaExp >= 0 ? "+" : ""}${deltaExp}R** per-trade improvement).`
    );
  }
  if (b.avgWinnerMfeR !== null && b.runnerBleedR !== null) {
    lines.push(
      `- **R Capture Efficiency (${b.avgCaptureEff ?? 0}%):** Winning trades reach an average peak excursion of **+${b.avgWinnerMfeR}R** (median **+${b.medianWinnerMfeR ?? b.avgWinnerMfeR}R**), leaving an average of **${b.runnerBleedR}R** on the table between peak MFE and final exit.`
    );
  }
  if (topPartial) {
    lines.push(
      `- **Best 2-Stage Partial Scale-Out Plan:** **${topPartial.label}** yields **+${topPartial.expectancyR}R/trade** (Net **+${topPartial.totalR}R**, TP1 hit rate **${topPartial.tp1HitRate}%**, TP2 runner hit rate **${topPartial.tp2HitRate}%**).`
    );
  }

  lines.push("\n## 3. Positive Edge Conditions to Lean Into (Amplifiers)");
  if (kzBest && kzBest.metrics?.count > 0) {
    lines.push(
      `- **Best ICT Killzone / Session:** **${kzBest.label}** (${kzBest.metrics.count} setups, **${kzBest.metrics.winRate}% WR**, **+${kzBest.metrics.expectancyR}R/trade**, Net **+${kzBest.metrics.totalR}R**, Optimal Target **${kzBest.optimalTargetR ?? "—"}R**).`
    );
  }
  if (c7Best && c7Best.metrics?.count > 0) {
    lines.push(
      `- **Best 7-Hour Candle Window:** **${c7Best.label}** (${c7Best.metrics.count} setups, **${c7Best.metrics.winRate}% WR**, **+${c7Best.metrics.expectancyR}R/trade**).`
    );
  }
  if (durBest && durBest.metrics?.count > 0) {
    lines.push(
      `- **Optimal Hold-Time Sweet Spot:** **${durBest.label}** produces **+${durBest.metrics.expectancyR}R/trade** (${durBest.metrics.winRate}% WR across ${durBest.metrics.count} trades).`
    );
  }
  if (symDirRows.length > 0 && symDirRows[0].metrics.expectancyR > 0) {
    const topSd = symDirRows[0];
    lines.push(
      `- **Strongest Symbol × Direction Pair:** **${topSd.label}** (${topSd.metrics.count} setups, **${topSd.metrics.winRate}% WR**, **+${topSd.metrics.expectancyR}R/trade**, Net **$${topSd.metrics.netPnl}**).`
    );
  }
  if (topEdges.length > 0) {
    const edgeStr = topEdges
      .slice(0, 4)
      .map(
        (e: any) =>
          `**${e.label}** (${e.metrics.count}t, ${e.metrics.winRate}% WR, +${e.metrics.expectancyR}R/trade)`
      )
      .join("; ");
    lines.push(`- **Top Single-Factor Edge Amplifiers:** ${edgeStr}.`);
  }
  if (topPairs.length > 0) {
    const pairStr = topPairs
      .slice(0, 3)
      .map(
        (p: any) =>
          `**${p.label}** (${p.metrics.count}t, ${p.metrics.winRate}% WR, +${p.metrics.expectancyR}R/trade)`
      )
      .join("; ");
    lines.push(`- **Best 2-Factor Confluence Synergies:** ${pairStr}.`);
  }

  lines.push("\n## 4. Negative Conditions, Drawdown Leaks & MAE Heat Warnings");
  if (b.p90WinnerMaeR !== null) {
    lines.push(
      `- **90th-Percentile Winner Heat (-${b.p90WinnerMaeR}R):** 90% of winning trades never draw down past **-${b.p90WinnerMaeR}R** (average winner heat is **-${b.avgWinnerMaeR}R**). Trades exceeding **-${b.p90WinnerMaeR}R** MAE have a low historical recovery rate.`
    );
  }
  if (durWorst && durWorst.metrics.expectancyR < 0) {
    lines.push(
      `- **Hold-Time Decay Leak (${durWorst.label}):** Trades held in the **${durWorst.label}** bucket drop to **${durWorst.metrics.winRate}% WR** and **${durWorst.metrics.expectancyR}R/trade** (Net **${durWorst.metrics.totalR}R**).`
    );
  }
  if (seqRows.length > 0) {
    const seqSummary = seqRows
      .map(
        (s: any) =>
          `**${s.label}**: ${s.metrics.count}t, ${s.metrics.winRate}% WR, ${s.metrics.expectancyR >= 0 ? "+" : ""}${s.metrics.expectancyR}R/trade (Avg Risk: ${s.metrics.avgRiskPct ?? "—"}%)`
      )
      .join(" | ");
    lines.push(`- **Sequential State (Post-Win vs. Post-Loss Recency):** ${seqSummary}.`);
  }
  if (topLeaks.length > 0) {
    const leakStr = topLeaks
      .slice(0, 4)
      .map(
        (l: any) =>
          `**${l.label}** (${l.metrics.count}t, ${l.metrics.winRate}% WR, ${l.metrics.totalR}R net, $${l.metrics.netPnl})`
      )
      .join("; ");
    lines.push(`- **Biggest Drawdown / Negative Expectancy Factors:** ${leakStr}.`);
  }
  if (topHesitation.length > 0) {
    const h = topHesitation[0];
    lines.push(
      `- **Hesitation Tax Flag (${h.tag}):** ${h.missedCount} missed setup(s) (${h.hesitationRatePct}% hesitation rate) left **+${h.missedTotalR}R ($${h.missedPnl})** uncaptured.`
    );
  }

  lines.push("\n## 5. Concrete Optimization Action Plan");
  lines.push(
    `- **Rule 1 (Target & Partial Scaling):** Anchor TP1 around **${topPartial?.tp1R ?? 1.5}R** and hold runners toward **${mfeBest?.targetR ?? 2.5}R** when HTF displacement aligns.`
  );
  if (topLeaks[0]) {
    lines.push(
      `- **Rule 2 (Drawdown Filter):** Reduce risk or stand down when **${topLeaks[0].label}** is present (${topLeaks[0].metrics.totalR}R historical drag).`
    );
  }
  if (kzBest) {
    lines.push(
      `- **Rule 3 (Session Concentration):** Concentrate primary risk during **${kzBest.label}** where expectancy peaks at **+${kzBest.metrics.expectancyR}R/trade**.`
    );
  }

  return lines.join("\n");
}

function saveOptimizerReportToNotebooks(params: {
  title: string;
  markdown: string;
  reasoning: string;
  telemetry: any;
  modelUsed: string;
}): { reportId: string; noteId: string } {
  const dbPath = resolveDbPath();
  const db = new Database(dbPath);
  const nowIso = new Date().toISOString();
  const reportId = `rep_opt_${Date.now()}`;
  const noteId = `note_opt_${Date.now()}`;

  try {
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
        reflection_questions_json TEXT DEFAULT '[]',
        model_used TEXT,
        created_at TEXT NOT NULL
      );
    `);

    const defaultActions = [
      {
        id: `act_opt_${Date.now()}_1`,
        text: `Test Optimal Target R (${params.telemetry?.mfeCurve?.bestTrailing?.targetR ?? 2.0}R) and top partial plan on next 10 setups`,
        horizon: "weekly",
        targetMetric: "Improve R Capture Efficiency above 65%",
        done: false,
      },
      ...(params.telemetry?.drawdownLeaks?.[0]
        ? [
            {
              id: `act_opt_${Date.now()}_2`,
              text: `Audit or filter out leak condition: ${params.telemetry.drawdownLeaks[0].label} (${params.telemetry.drawdownLeaks[0].metrics.totalR}R drag)`,
              horizon: "weekly",
              targetMetric: "0 unconfirmed entries under leak condition",
              done: false,
            },
          ]
        : []),
    ];

    db.prepare(`
      INSERT INTO ai_coach_reports (
        id, horizon, period_key, title, summary_md, reasoning_trace,
        telemetry_json, suggested_goals_json, accountability_json, action_items_json, model_used, created_at
      ) VALUES (?, 'optimizer', ?, ?, ?, ?, ?, '[]', '[]', ?, ?, ?)
    `).run(
      reportId,
      nowIso.slice(0, 10),
      params.title,
      params.markdown,
      params.reasoning || "",
      JSON.stringify({
        baseline: params.telemetry?.baseline,
        bestMfeTarget: params.telemetry?.mfeCurve?.bestTrailing,
      }),
      JSON.stringify(defaultActions),
      params.modelUsed,
      nowIso
    );

    // Clean up any legacy optimizer report copies from manual scratchpad `notes` & `folders`
    try {
      db.prepare(
        `DELETE FROM notes WHERE id LIKE 'note_opt_%' OR folder_id = 'optimizer-reports' OR title LIKE 'Edge & R Optimizer Audit%'`
      ).run();
      db.prepare(`DELETE FROM folders WHERE id = 'optimizer-reports'`).run();
    } catch {}
  } finally {
    db.close();
  }

  return { reportId, noteId };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const strategyLabel = body.strategyLabel || "All Strategies";
    const sampleCount = body.baseline?.count ?? 0;
    const shortStamp = new Date().toISOString().slice(0, 16).replace("T", " ");
    const reportTitle = `Edge & R Optimizer Audit · ${strategyLabel} (N=${sampleCount}) · ${shortStamp}`;

    const fallbackReport = buildDeterministicQuantReport(body);

    const systemPrompt = `You are an institutional quantitative trading performance analyst specializing in ICT orderflow, 7-hour candle profiling, and R-multiple optimization.
Analyze ALL provided report dimensions (Baseline SQN/Kelly, MFE Target Curve, 2-Stage Partial Scale-Out Grid, MAE Stop-Tightening Simulator, Hold-Time Duration Buckets, Post-Win vs. Post-Loss Sequential States, Symbol x Direction Long/Short Asymmetry, ICT Killzones, 7H Candles, Single-Factor Tag/Rule Rankings, 2-Factor Confluence Synergies, Drawdown Leaks, and Hesitation Tax).
Note: If N < 20, explicitly remind the trader that data may be skewed due to small sample size, then still analyze all patterns present in the numbers.
Write a structured Markdown report with these exact 5 sections:
## 1. Sample Confidence & System Quality Telemetry
## 2. MFE Target Optimization & Partial Scale-Out Structure
## 3. Positive Edge Conditions to Consider (Tags, Rules, Killzones, Hold Duration & Symbol×Direction)
## 4. Negative Conditions & Drawdown Leaks to Avoid (Post-Win/Loss Shifts, MAE Heat & Leak Flags)
## 5. Concrete Optimization Action Plan (3–5 testable rules)`;

    const compactData = JSON.stringify(
      {
        strategyScope: strategyLabel,
        baseline: body.baseline,
        bestMfeTarget: body.mfeCurve?.bestTrailing,
        topPartialPlans: (body.partialGrid || []).slice(0, 4),
        maeSimulator: body.maeSimulator,
        byKillzone: body.dimensions?.byKillzone,
        by7hCandle: body.dimensions?.by7hCandle,
        byDuration: body.dimensions?.byDuration,
        overnightSummary: body.overnightSummary,
        byOvernight: body.dimensions?.byOvernight,
        byMacroEvent: body.dimensions?.byMacroEvent,
        bySequentialState: body.dimensions?.bySequentialState,
        bySymbolDirection: body.dimensions?.bySymbolDirection,
        byDayOfWeek: body.dimensions?.byDayOfWeek,
        edgeAmplifiers: (body.edgeAmplifiers || []).slice(0, 8),
        drawdownLeaks: (body.drawdownLeaks || []).slice(0, 8),
        confluencePairs: (body.confluencePairs || []).slice(0, 6),
        hesitationTax: (body.hesitationTax || []).slice(0, 5),
      },
      null,
      2
    );

    let finalMarkdown = fallbackReport;
    let finalReasoning = "";
    let modelUsed = "quant-engine";

    try {
      const localCfg = loadLocalAiSettings();
      const status = await probeKoboldStatus(localCfg.baseUrl);
      if (status.online) {
        const kRes = await runKoboldAi(
          `${systemPrompt}\n\n=== COMPLETE MULTI-DIMENSIONAL REPORT TELEMETRY ===\n${compactData}`,
          {
            persona: "coach",
            thinkingMode: "balanced",
            autoContinue: false,
            maxOutputTokens: 4096,
            temperature: 0.3,
          }
        );
        if (kRes.text && kRes.text.trim().length > 120) {
          finalMarkdown = kRes.text.trim();
          finalReasoning = kRes.reasoning || "";
          modelUsed = status.modelName || localCfg.activeModelFile || "koboldcpp";
        }
      }
    } catch {}

    if (modelUsed === "quant-engine") {
      const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
      const openAiKey = process.env.OPENAI_API_KEY || "";
      if (geminiKey) {
        try {
          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                contents: [{ parts: [{ text: `${systemPrompt}\n\n${compactData}` }] }],
              }),
            }
          );
          if (res.ok) {
            const data = await res.json();
            const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text && text.trim()) {
              finalMarkdown = text.trim();
              modelUsed = "gemini-2.5-flash";
            }
          }
        } catch {}
      } else if (openAiKey) {
        try {
          const res = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${openAiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: process.env.OPENAI_MODEL || "gpt-4o-mini",
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: compactData },
              ],
              temperature: 0.2,
            }),
          });
          if (res.ok) {
            const data = await res.json();
            const text = data?.choices?.[0]?.message?.content;
            if (text && text.trim()) {
              finalMarkdown = text.trim();
              modelUsed = "openai";
            }
          }
        } catch {}
      }
    }

    const saved = saveOptimizerReportToNotebooks({
      title: reportTitle,
      markdown: finalMarkdown,
      reasoning: finalReasoning,
      telemetry: body,
      modelUsed,
    });

    return NextResponse.json({
      ok: true,
      title: reportTitle,
      analysis: finalMarkdown,
      reasoning: finalReasoning,
      source: modelUsed,
      reportId: saved.reportId,
      noteId: saved.noteId,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "Failed to generate optimization audit" },
      { status: 500 }
    );
  }
}
