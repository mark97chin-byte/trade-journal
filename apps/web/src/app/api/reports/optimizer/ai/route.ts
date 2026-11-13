import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

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

  const lines: string[] = [];

  lines.push("### 1. Sample Confidence & System Quality Assessment");
  if ((b.count || 0) < 15) {
    lines.push(
      `• **Sample Size Alert (${b.count || 0} / 20 setups):** Current sample is in the early discovery phase (${b.executedCount || 0} executed, ${b.missedCount || 0} missed). Treat current parameters as preliminary hypotheses until your sample crosses 15–20 setups.`
    );
  } else {
    lines.push(
      `• **Statistical Confidence Reached (${b.count} setups):** Your sample crosses the actionable threshold with a **System Quality Number (SQN) of ${b.sqn}** and a 95% Expectancy Confidence Interval of **[${b.ci95LowR}R, +${b.ci95HighR}R]**.`
    );
  }
  lines.push(
    `• **Baseline Expectancy & Kelly Sizing:** Your current baseline delivers **${b.expectancyR >= 0 ? "+" : ""}${b.expectancyR}R per trade** (${b.winRate}% win rate, ${b.payoffRatioR}:1 payoff ratio, Profit Factor ${b.profitFactorR}). Full Kelly is **${b.kellyPct}%**, and Half-Kelly ceiling is **${b.halfKellyPct}%** (keep actual risk at 0.5%–1.0% to insulate against an expected 100-trade max losing streak of **${b.expectedMaxLosingStreak} trades**).`
  );

  lines.push("\n### 2. MFE Target Optimization & Partial Scale-Out Plan");
  if (mfeBest) {
    const deltaExp = Number((mfeBest.trailingExpR - (b.expectancyR || 0)).toFixed(2));
    lines.push(
      `• **Optimal Full-Hold Target (${mfeBest.targetR}R):** Across your recorded MFE excursions, **${mfeBest.targetR}R** is the mathematical sweet spot (hit on **${mfeBest.hitRate}%** of setups for a simulated expectancy of **+${mfeBest.trailingExpR}R/trade** vs. actual **${b.expectancyR}R**, a **${deltaExp >= 0 ? "+" : ""}${deltaExp}R** per-trade lift).`
    );
  }
  if (b.avgWinnerMfeR !== null && b.runnerBleedR !== null) {
    lines.push(
      `• **Runner Capture Efficiency (${b.avgCaptureEff ?? 0}%):** Winning trades reach an average MFE of **+${b.avgWinnerMfeR}R** (median **+${b.medianWinnerMfeR ?? b.avgWinnerMfeR}R**), leaving an average of **${b.runnerBleedR}R** on the table between peak excursion and final exit.`
    );
  }
  if (topPartial) {
    lines.push(
      `• **Highest-Expectancy 2-Stage Partial Structure:** **${topPartial.label}** yields **+${topPartial.expectancyR}R/trade** (${topPartial.totalR}R total, TP1 hit rate ${topPartial.tp1HitRate}%, TP2 runner hit rate ${topPartial.tp2HitRate}%).`
    );
  }

  lines.push("\n### 3. MAE Heat Tolerance & Stop-Loss Placement");
  if (b.p90WinnerMaeR !== null) {
    lines.push(
      `• **90th-Percentile Winner Heat (-${b.p90WinnerMaeR}R):** 90% of your winning setups never experience more than **-${b.p90WinnerMaeR}R** of adverse heat (average winner heat is **-${b.avgWinnerMaeR}R**). If a trade draws down past **-${b.p90WinnerMaeR}R**, the probability of it recovering into a standard winner drops sharply.`
    );
  } else {
    lines.push(
      `• **MAE Tracking:** Continue logging Stop Loss levels so 1-minute candle excursions populate MAE R percentiles across all winners.`
    );
  }

  lines.push("\n### 4. Highest-Edge Confluences, Timeframes & Session Windows");
  if (kzBest && kzBest.metrics?.count > 0) {
    lines.push(
      `• **Best Killzone Window:** **${kzBest.label}** leads with **${kzBest.metrics.winRate}% win rate** and **+${kzBest.metrics.expectancyR}R expectancy** (${kzBest.metrics.totalR}R net across ${kzBest.metrics.count} setups).`
    );
  }
  if (c7Best && c7Best.metrics?.count > 0) {
    lines.push(
      `• **Best 7-Hour Candle Window:** **${c7Best.label}** delivers **+${c7Best.metrics.expectancyR}R expectancy** (${c7Best.metrics.winRate}% win rate).`
    );
  }
  if (topEdges.length > 0) {
    const edgeStr = topEdges
      .slice(0, 3)
      .map(
        (e: any) =>
          `**${e.label}** (${e.metrics.winRate}% WR, +${e.metrics.expectancyR}R exp, ${e.expectancyLiftR >= 0 ? "+" : ""}${e.expectancyLiftR}R lift over baseline)`
      )
      .join("; ");
    lines.push(`• **Top Single-Factor Edge Amplifiers:** ${edgeStr}.`);
  }
  if (topPairs.length > 0) {
    const pairStr = topPairs
      .slice(0, 2)
      .map(
        (p: any) =>
          `**${p.label}** (${p.metrics.winRate}% WR, +${p.metrics.expectancyR}R exp across ${p.metrics.count} setups)`
      )
      .join("; ");
    lines.push(`• **Best 2-Tag Confluence Synergies:** ${pairStr}.`);
  }

  lines.push("\n### 5. Drawdown Leaks & Hesitation Tax Flagged");
  if (topLeaks.length > 0) {
    const leakStr = topLeaks
      .slice(0, 3)
      .map(
        (l: any) =>
          `**${l.label}** (${l.metrics.winRate}% WR, ${l.metrics.totalR}R net across ${l.metrics.count} setups)`
      )
      .join("; ");
    lines.push(`• **Factors Causing Drawdown / Underperformance:** ${leakStr}.`);
  } else {
    lines.push(
      `• **No Negative-Expectancy Tag Leaks Detected:** None of your active tags currently show net negative R bleed.`
    );
  }
  if (topHesitation.length > 0) {
    const h = topHesitation[0];
    lines.push(
      `• **Hesitation Tax Alert (${h.tag}):** You missed **${h.missedCount}** valid setup(s) tagged **${h.tag}** (${h.hesitationRatePct}% hesitation rate), leaving **+${h.missedTotalR}R (${h.missedPnl >= 0 ? `+$${h.missedPnl}` : `-$${Math.abs(h.missedPnl)}`})** on the table.`
    );
  }

  return lines.join("\n");
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const fallbackReport = buildDeterministicQuantReport(body);

    const openAiKey = process.env.OPENAI_API_KEY || "";
    const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";

    const systemPrompt =
      "You are an institutional quantitative trading performance analyst specializing in ICT orderflow, 7-hour candle profiling, and R-multiple optimization. Analyze the exact mathematical tables provided and output 5 concise, actionable sections: (1) Sample Confidence & SQN Assessment, (2) Optimal MFE Target R & Partial Scale-Out Plan, (3) MAE Winner Heat & Stop Tightening, (4) Best Confluence Tags/Rules/Timeframes, and (5) Drawdown Leaks & Hesitation Tax.";

    const compactData = JSON.stringify({
      baseline: body.baseline,
      bestMfeTarget: body.mfeCurve?.bestTrailing,
      topPartialPlans: (body.partialGrid || []).slice(0, 3),
      maeSimulator: body.maeSimulator,
      edgeAmplifiers: (body.edgeAmplifiers || []).slice(0, 5),
      drawdownLeaks: (body.drawdownLeaks || []).slice(0, 5),
      confluencePairs: (body.confluencePairs || []).slice(0, 4),
      hesitationTax: (body.hesitationTax || []).slice(0, 4),
      byKillzone: body.dimensions?.byKillzone,
      by7hCandle: body.dimensions?.by7hCandle,
    });

    if (geminiKey) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [
                {
                  parts: [
                    {
                      text: `${systemPrompt}\n\nQUANTITATIVE TELEMETRY JSON:\n${compactData}`,
                    },
                  ],
                },
              ],
            }),
          }
        );
        if (res.ok) {
          const data = await res.json();
          const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text && text.trim()) {
            return NextResponse.json({ ok: true, analysis: text.trim(), source: "gemini" });
          }
        }
      } catch {}
    }

    if (openAiKey) {
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
            return NextResponse.json({ ok: true, analysis: text.trim(), source: "openai" });
          }
        }
      } catch {}
    }

    return NextResponse.json({
      ok: true,
      analysis: fallbackReport,
      source: "quant-engine",
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "Failed to generate optimization audit" },
      { status: 500 }
    );
  }
}
