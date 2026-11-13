"use client";

import React, { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useApi } from "@/lib/use-api";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Sparkles,
  TrendingUp,
  TrendingDown,
  Target,
  ShieldAlert,
  Layers,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Loader2,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";

function fmtMoney(val: number | null | undefined): string {
  if (val === null || val === undefined || isNaN(val)) return "$0.00";
  const abs = Math.abs(val);
  const sign = val < 0 ? "-$" : val > 0 ? "+$" : "$";
  return `${sign}${abs.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function EdgeOptimizerView({
  query,
  includeMissed,
  onToggleIncludeMissed,
}: {
  query: string;
  includeMissed: boolean;
  onToggleIncludeMissed: () => void;
}) {
  const router = useRouter();
  const [selectedPlaybookId, setSelectedPlaybookId] = useState<string>("all");
  const [minSampleSize, setMinSampleSize] = useState<number>(1);
  const [activeDimension, setActiveDimension] = useState<string>("all_categories");
  const [expandedBucketKey, setExpandedBucketKey] = useState<string | null>(null);

  const [aiLoading, setAiLoading] = useState(false);
  const [aiReport, setAiReport] = useState<string | null>(null);

  const apiUrl = `/api/reports/optimizer?${query}${query ? "&" : ""}includeMissed=${
    includeMissed ? "1" : "0"
  }&playbookId=${encodeURIComponent(selectedPlaybookId)}`;

  const { data, loading } = useApi<any>(apiUrl);

  const dimensionRows = useMemo(() => {
    if (!data?.dimensions) return [];
    let raw: any[] = [];
    if (activeDimension === "all_categories") {
      raw = Object.values(data.dimensions.byCategory || {}).flat();
    } else if (activeDimension.startsWith("cat:")) {
      const catId = activeDimension.slice(4);
      raw = data.dimensions.byCategory?.[catId] || [];
    } else if (activeDimension === "killzone") {
      raw = data.dimensions.byKillzone || [];
    } else if (activeDimension === "candle7h") {
      raw = data.dimensions.by7hCandle || [];
    } else if (activeDimension === "dow") {
      raw = data.dimensions.byDayOfWeek || [];
    } else if (activeDimension === "symbol") {
      raw = data.dimensions.bySymbol || [];
    }
    return raw.filter((r) => (r.metrics?.count ?? 0) >= minSampleSize);
  }, [data, activeDimension, minSampleSize]);

  const runAiAudit = async () => {
    if (!data) return;
    setAiLoading(true);
    try {
      const res = await fetch("/api/reports/optimizer/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (json.analysis) {
        setAiReport(json.analysis);
      }
    } finally {
      setAiLoading(false);
    }
  };

  if (loading || !data?.baseline) {
    return <Skeleton className="h-96 w-full rounded-xl" />;
  }

  const b = data.baseline;
  const mfeCurve = data.mfeCurve;
  const bestTarget = mfeCurve?.bestTrailing;
  const samplePct = Math.min(100, Math.round((b.count / 20) * 100));

  // Render MFE Expectancy Curve SVG
  const renderMfeCurveSvg = () => {
    const pts: any[] = mfeCurve?.points || [];
    if (pts.length === 0 || b.count === 0) {
      return (
        <div className="flex h-52 items-center justify-center text-xs text-muted-foreground">
          Log trades with MFE / Realized R to generate the Target R Expectancy Curve.
        </div>
      );
    }

    const width = 760;
    const height = 220;
    const padL = 48;
    const padR = 24;
    const padT = 22;
    const padB = 32;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;

    const vals = pts.map((p) => p.trailingExpR);
    const minV = Math.min(...vals, 0, b.expectancyR);
    const maxV = Math.max(...vals, 0.5, b.expectancyR);
    const span = maxV - minV || 1;

    const getX = (i: number) => padL + (i / Math.max(pts.length - 1, 1)) * plotW;
    const getY = (v: number) => padT + plotH - ((v - minV) / span) * plotH;
    const zeroY = getY(0);
    const actualY = getY(b.expectancyR);

    const coords = pts.map((p, i) => `${getX(i).toFixed(1)} ${getY(p.trailingExpR).toFixed(1)}`);
    const linePath = `M ${coords.join(" L ")}`;
    const areaPath = `${linePath} L ${getX(pts.length - 1)} ${zeroY} L ${getX(0)} ${zeroY} Z`;

    const bestIdx = bestTarget
      ? pts.findIndex((p) => p.targetR === bestTarget.targetR)
      : -1;

    return (
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto overflow-visible select-none">
        <line
          x1={padL}
          y1={zeroY}
          x2={width - padR}
          y2={zeroY}
          stroke="rgba(255,255,255,0.18)"
          strokeDasharray="3 3"
        />
        {/* Baseline Actual Expectancy Line */}
        <line
          x1={padL}
          y1={actualY}
          x2={width - padR}
          y2={actualY}
          stroke="#94a3b8"
          strokeDasharray="4 4"
          strokeWidth="1"
        />
        <text x={width - padR - 4} y={actualY - 5} textAnchor="end" fontSize="9.5" fill="#94a3b8">
          Actual Baseline ({b.expectancyR >= 0 ? `+${b.expectancyR}R` : `${b.expectancyR}R`})
        </text>

        <path d={areaPath} fill="#10b981" fillOpacity="0.16" />
        <path d={linePath} fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" />

        {bestIdx >= 0 && (
          <g>
            <line
              x1={getX(bestIdx)}
              y1={padT}
              x2={getX(bestIdx)}
              y2={height - padB}
              stroke="#f59e0b"
              strokeDasharray="2 2"
            />
            <circle
              cx={getX(bestIdx)}
              cy={getY(pts[bestIdx]!.trailingExpR)}
              r="5"
              fill="#f59e0b"
            />
            <text
              x={getX(bestIdx)}
              y={Math.max(14, getY(pts[bestIdx]!.trailingExpR) - 10)}
              textAnchor="middle"
              fontSize="10"
              fontWeight="bold"
              fill="#fbbf24"
            >
              Optimal: {bestTarget.targetR}R (+{bestTarget.trailingExpR}R/trade • {bestTarget.hitRate}% hit)
            </text>
          </g>
        )}

        {pts
          .filter((_, i) => i % 4 === 0 || i === pts.length - 1)
          .map((p) => {
            const origIdx = pts.indexOf(p);
            return (
              <text
                key={p.targetR}
                x={getX(origIdx)}
                y={height - 8}
                textAnchor="middle"
                fontSize="10"
                fill="#94a3b8"
              >
                {p.targetR}R
              </text>
            );
          })}
      </svg>
    );
  };

  return (
    <div className="space-y-6">
      {/* TOP CONTROL BAR & SAMPLE SIZE GATE */}
      <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-foreground flex items-center gap-2">
              <Target className="h-4 w-4 text-emerald-400" />
              <span>Quantitative Edge &amp; R-Multiple Optimizer</span>
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Layer 1 exact mathematical excursion &amp; confluence engine + Layer 2 AI pattern synthesizer.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Strategy Filter */}
            <select
              value={selectedPlaybookId}
              onChange={(e) => setSelectedPlaybookId(e.target.value)}
              className="h-8 rounded-lg border border-border/70 bg-background px-2.5 text-xs font-semibold text-foreground outline-none"
            >
              <option value="all">All Strategies</option>
              {(data.playbooks || []).map((p: any) => (
                <option key={p.id} value={p.id}>
                  {p.icon} {p.name}
                </option>
              ))}
            </select>

            {/* Min Sample Size Filter */}
            <div className="flex items-center gap-1.5 rounded-lg border border-border/70 bg-background px-2.5 h-8 text-xs">
              <span className="text-muted-foreground">Min N:</span>
              {[1, 5, 10, 15, 20].map((nVal) => (
                <button
                  key={nVal}
                  type="button"
                  onClick={() => setMinSampleSize(nVal)}
                  className={`rounded px-1.5 py-0.5 text-[11px] font-mono font-semibold transition ${
                    minSampleSize === nVal
                      ? "bg-secondary text-foreground border border-border"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {nVal}+
                </button>
              ))}
            </div>

            {/* Include Missed Toggle */}
            <button
              type="button"
              onClick={onToggleIncludeMissed}
              className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition ${
                includeMissed
                  ? "border-amber-500/50 bg-amber-500/15 text-amber-300"
                  : "border-border/70 bg-background text-muted-foreground hover:text-foreground"
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  includeMissed ? "bg-amber-400" : "bg-muted-foreground/40"
                }`}
              />
              <span>{includeMissed ? "Including Missed Setups" : "Executed Only"}</span>
            </button>

            {/* Run AI Audit Button */}
            <Button
              type="button"
              size="sm"
              disabled={aiLoading || b.count === 0}
              onClick={() => void runAiAudit()}
              className="h-8 gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold"
            >
              {aiLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              <span>{aiLoading ? "Synthesizing..." : "Run AI Pattern & Edge Audit"}</span>
            </Button>
          </div>
        </div>

        {/* Sample Size Confidence Bar */}
        <div className="rounded-lg border border-border/50 bg-secondary/20 p-3 flex flex-wrap items-center justify-between gap-4 text-xs">
          <div className="flex items-center gap-2.5">
            {b.count >= 20 ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
            )}
            <div>
              <span className="font-bold text-foreground">
                Sample Size Gate: {b.count} / 20 Setups ({b.executedCount} Executed
                {includeMissed ? ` + ${b.missedCount} Missed` : ""})
              </span>
              <span className="ml-2 text-muted-foreground">
                {b.count >= 20
                  ? "High statistical confidence unlocked (N ≥ 20)."
                  : `Need ${Math.max(0, 20 - b.count)} more setup(s) to reach the 20-trade statistical threshold (early preview active).`}
              </span>
            </div>
          </div>

          <div className="w-48 h-2 rounded-full bg-secondary overflow-hidden">
            <div
              style={{ width: `${samplePct}%` }}
              className={`h-full transition-all ${
                b.count >= 20 ? "bg-emerald-500" : "bg-amber-400"
              }`}
            />
          </div>
        </div>
      </div>

      {/* LAYER 2: AI PATTERN SYNTHESIS PANEL (WHEN TRIGGERED) */}
      {aiReport && (
        <div className="rounded-xl border border-indigo-500/40 bg-[#12141f] p-5 space-y-3 shadow-lg">
          <div className="flex items-center justify-between border-b border-border/40 pb-2.5">
            <div className="flex items-center gap-2 text-sm font-bold text-indigo-300">
              <Sparkles className="h-4 w-4" />
              <span>AI Quantitative Strategy &amp; Edge Synthesis</span>
            </div>
            <button
              type="button"
              onClick={() => setAiReport(null)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Dismiss ✕
            </button>
          </div>
          <div className="whitespace-pre-wrap text-xs leading-relaxed text-foreground/95 space-y-1">
            {aiReport}
          </div>
        </div>
      )}

      {/* TOP 6 QUANTITATIVE TELEMETRY CARDS */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 text-xs">
        <div className="rounded-xl border border-border/50 bg-card p-3.5 space-y-1">
          <div className="text-[10px] uppercase font-bold text-muted-foreground">
            Expectancy E[R]
          </div>
          <div
            className={`text-lg font-bold font-mono ${
              b.expectancyR >= 0 ? "text-emerald-400" : "text-rose-400"
            }`}
          >
            {b.expectancyR >= 0 ? `+${b.expectancyR}R` : `${b.expectancyR}R`}
          </div>
          <div className="text-[10px] text-muted-foreground font-mono">
            95% CI: [{b.ci95LowR}R, +{b.ci95HighR}R]
          </div>
        </div>

        <div className="rounded-xl border border-border/50 bg-card p-3.5 space-y-1">
          <div className="text-[10px] uppercase font-bold text-muted-foreground">
            System Quality (SQN)
          </div>
          <div className="text-lg font-bold font-mono text-foreground">{b.sqn}</div>
          <div className="text-[10px] text-muted-foreground">
            {b.sqn >= 3.0
              ? "Excellent Edge (3.0+)"
              : b.sqn >= 2.0
              ? "Solid Edge (2.0+)"
              : "Developing (<2.0)"}
          </div>
        </div>

        <div className="rounded-xl border border-border/50 bg-card p-3.5 space-y-1">
          <div className="text-[10px] uppercase font-bold text-muted-foreground">
            Optimal Target R*
          </div>
          <div className="text-lg font-bold font-mono text-amber-400">
            {bestTarget ? `${bestTarget.targetR}R` : "—"}
          </div>
          <div className="text-[10px] text-muted-foreground">
            {bestTarget
              ? `+${bestTarget.trailingExpR}R exp (${bestTarget.hitRate}% hit)`
              : "No MFE data"}
          </div>
        </div>

        <div className="rounded-xl border border-border/50 bg-card p-3.5 space-y-1">
          <div className="text-[10px] uppercase font-bold text-muted-foreground">
            90% Winner Heat (MAE)
          </div>
          <div className="text-lg font-bold font-mono text-rose-400">
            {b.p90WinnerMaeR !== null ? `-${b.p90WinnerMaeR}R` : "—"}
          </div>
          <div className="text-[10px] text-muted-foreground">
            Avg winner heat: {b.avgWinnerMaeR !== null ? `-${b.avgWinnerMaeR}R` : "—"}
          </div>
        </div>

        <div className="rounded-xl border border-border/50 bg-card p-3.5 space-y-1">
          <div className="text-[10px] uppercase font-bold text-muted-foreground">
            R Capture Efficiency
          </div>
          <div className="text-lg font-bold font-mono text-foreground">
            {b.avgCaptureEff !== null ? `${b.avgCaptureEff}%` : "—"}
          </div>
          <div className="text-[10px] text-muted-foreground">
            Runner bleed: {b.runnerBleedR !== null ? `${b.runnerBleedR}R/win` : "—"}
          </div>
        </div>

        <div className="rounded-xl border border-border/50 bg-card p-3.5 space-y-1">
          <div className="text-[10px] uppercase font-bold text-muted-foreground">
            Half-Kelly Safe Risk
          </div>
          <div className="text-lg font-bold font-mono text-indigo-400">
            {b.halfKellyPct}%
          </div>
          <div className="text-[10px] text-muted-foreground">
            Max streak (100t): {b.expectedMaxLosingStreak} losses
          </div>
        </div>
      </div>

      {/* MODULE 1 & 2: MFE TARGET CURVE + PARTIAL SCALE-OUT SIMULATOR */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="lg:col-span-7 rounded-xl border border-border/50 bg-card p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-border/30 pb-2">
            <div>
              <h3 className="text-sm font-bold text-foreground">
                1. MFE Optimal Target R Expectancy Curve (0.5R → 8.0R)
              </h3>
              <p className="text-[11px] text-muted-foreground">
                Simulates expected R per trade across candidate Full-TP targets based on each setup&apos;s recorded MFE.
              </p>
            </div>
          </div>
          {renderMfeCurveSvg()}
        </div>

        <div className="lg:col-span-5 rounded-xl border border-border/50 bg-card p-4 space-y-3">
          <div className="border-b border-border/30 pb-2">
            <h3 className="text-sm font-bold text-foreground">
              2. Top Partial Scale-Out Plans (TP1 + SL→BE + Runner)
            </h3>
            <p className="text-[11px] text-muted-foreground">
              Ranked 2-stage partial plans vs. your actual realized expectancy ({b.expectancyR}R).
            </p>
          </div>

          <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1 text-xs">
            {(data.partialGrid || []).map((plan: any, idx: number) => (
              <div
                key={plan.id}
                className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 ${
                  idx === 0
                    ? "border-emerald-500/40 bg-emerald-500/10"
                    : "border-border/40 bg-secondary/20"
                }`}
              >
                <div className="min-w-0">
                  <div className="font-semibold text-foreground truncate">
                    #{idx + 1} {plan.label}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    TP1 hit: {plan.tp1HitRate}% • TP2 runner hit: {plan.tp2HitRate}%
                  </div>
                </div>
                <div className="text-right font-mono shrink-0">
                  <div className="font-bold text-emerald-400">
                    +{plan.expectancyR}R/trade
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    Net: +{plan.totalR}R
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* MODULE 3: MIX & MATCH CROSS-TAB OPTIMIZER MATRIX */}
      <div className="rounded-xl border border-border/50 bg-card p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/30 pb-3">
          <div>
            <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
              <Layers className="h-4 w-4 text-indigo-400" />
              <span>3. Mix &amp; Match Cross-Tab Matrix (Click any row to view trades)</span>
            </h3>
            <p className="text-[11px] text-muted-foreground">
              Slice your selected Strategy by Tag Category (Entry Timeframe, Entry Model, Drivers), ICT Killzone, 7H Candle, or Symbol.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {[
              { id: "all_categories", label: "All Tag Categories" },
              ...(data.tagCategories || []).map((c: any) => ({
                id: `cat:${c.id}`,
                label: c.name,
              })),
              { id: "killzone", label: "ICT Killzones" },
              { id: "candle7h", label: "7H Candles" },
              { id: "dow", label: "Day of Week" },
              { id: "symbol", label: "Symbols" },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setActiveDimension(tab.id);
                  setExpandedBucketKey(null);
                }}
                className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition ${
                  activeDimension === tab.id
                    ? "bg-secondary text-foreground border border-border shadow-2xs"
                    : "bg-secondary/20 text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-border/40 text-muted-foreground">
              <tr>
                <th className="py-2.5 pl-2">Factor / Bucket</th>
                <th className="py-2.5 text-right">Setups (N)</th>
                <th className="py-2.5 text-right">Win %</th>
                <th className="py-2.5 text-right">Expectancy E[R]</th>
                <th className="py-2.5 text-right">Total Net R</th>
                <th className="py-2.5 text-right">Avg MFE / MAE</th>
                <th className="py-2.5 text-right">R Capture</th>
                <th className="py-2.5 text-right">Optimal Target R*</th>
                <th className="py-2.5 pr-2 text-right">Net P&amp;L</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/20">
              {dimensionRows.map((row: any, rIdx: number) => {
                const m = row.metrics;
                const bKey = `${row.key}-${rIdx}`;
                const isExpanded = expandedBucketKey === bKey;

                return (
                  <React.Fragment key={bKey}>
                    <tr
                      onClick={() =>
                        setExpandedBucketKey((prev) => (prev === bKey ? null : bKey))
                      }
                      className={`cursor-pointer transition-colors ${
                        isExpanded ? "bg-secondary/40 font-semibold" : "hover:bg-secondary/20"
                      }`}
                    >
                      <td className="py-2.5 pl-2 font-medium text-foreground">
                        <div className="flex items-center gap-2">
                          {isExpanded ? (
                            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                          )}
                          {row.color && (
                            <span
                              className="h-2 w-2 rounded-full shrink-0"
                              style={{ backgroundColor: row.color }}
                            />
                          )}
                          <span>{row.label}</span>
                          {row.categoryName && (
                            <span className="text-[10px] text-muted-foreground">
                              ({row.categoryName})
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 text-right font-mono text-foreground">
                        {m.count}
                      </td>
                      <td className="py-2.5 text-right font-mono">
                        {m.winRate}%
                      </td>
                      <td
                        className={`py-2.5 text-right font-mono font-bold ${
                          m.expectancyR > 0
                            ? "text-emerald-400"
                            : m.expectancyR < 0
                            ? "text-rose-400"
                            : "text-muted-foreground"
                        }`}
                      >
                        {m.expectancyR > 0 ? `+${m.expectancyR}R` : `${m.expectancyR}R`}
                      </td>
                      <td
                        className={`py-2.5 text-right font-mono font-semibold ${
                          m.totalR > 0
                            ? "text-emerald-400"
                            : m.totalR < 0
                            ? "text-rose-400"
                            : "text-muted-foreground"
                        }`}
                      >
                        {m.totalR > 0 ? `+${m.totalR}R` : `${m.totalR}R`}
                      </td>
                      <td className="py-2.5 text-right font-mono text-muted-foreground">
                        {m.avgWinnerMfeR !== null ? `+${m.avgWinnerMfeR}R` : "—"} /{" "}
                        {m.avgWinnerMaeR !== null ? `-${m.avgWinnerMaeR}R` : "—"}
                      </td>
                      <td className="py-2.5 text-right font-mono text-muted-foreground">
                        {m.avgCaptureEff !== null ? `${m.avgCaptureEff}%` : "—"}
                      </td>
                      <td className="py-2.5 text-right font-mono font-bold text-amber-400">
                        {row.optimalTargetR ? `${row.optimalTargetR}R` : "—"}
                      </td>
                      <td
                        className={`py-2.5 pr-2 text-right font-mono font-semibold ${
                          m.netPnl >= 0 ? "text-emerald-400" : "text-rose-400"
                        }`}
                      >
                        {fmtMoney(m.netPnl)}
                      </td>
                    </tr>

                    {isExpanded && Array.isArray(row.trades) && (
                      <tr>
                        <td colSpan={9} className="bg-[#0d0f14]/90 p-3">
                          <div className="rounded-lg border border-border/50 bg-card p-2.5 space-y-1.5">
                            <div className="text-[11px] font-bold text-foreground">
                              Setups matching &ldquo;{row.label}&rdquo; ({row.trades.length})
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                              {row.trades.map((t: any, i: number) => {
                                const isM = Boolean(t.isMissed);
                                const k = String(t.key ?? t.id ?? i);
                                const link = isM
                                  ? `/missed/${encodeURIComponent(k)}`
                                  : `/trades/${encodeURIComponent(k)}`;
                                const rVal =
                                  typeof t.realizedR === "number" ? t.realizedR : null;
                                return (
                                  <div
                                    key={`${k}-${i}`}
                                    onClick={() => router.push(link)}
                                    className="cursor-pointer rounded-lg border border-border/50 bg-secondary/20 hover:bg-secondary/50 p-2 flex items-center justify-between text-xs transition"
                                  >
                                    <div>
                                      <div className="flex items-center gap-1.5">
                                        <span
                                          className={`rounded px-1 py-0.2 text-[9px] font-bold ${
                                            isM
                                              ? "bg-amber-500/20 text-amber-300"
                                              : "bg-indigo-500/20 text-indigo-300"
                                          }`}
                                        >
                                          {isM ? "MISSED" : "EXEC"}
                                        </span>
                                        <span className="font-mono font-bold text-foreground">
                                          {t.symbol}
                                        </span>
                                        <span className="uppercase text-[10px] text-muted-foreground">
                                          {t.direction}
                                        </span>
                                      </div>
                                      <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                                        {String(t.openedAt || "").slice(0, 10)}
                                      </div>
                                    </div>
                                    <div className="text-right font-mono">
                                      <div
                                        className={`font-bold ${
                                          Number(t.netPnl ?? 0) >= 0
                                            ? "text-emerald-400"
                                            : "text-rose-400"
                                        }`}
                                      >
                                        {fmtMoney(Number(t.netPnl ?? 0))}
                                      </div>
                                      <div className="text-[10px] text-muted-foreground">
                                        {rVal !== null
                                          ? `${rVal > 0 ? "+" : ""}${rVal.toFixed(2)}R`
                                          : ""}{" "}
                                        <ExternalLink className="inline h-2.5 w-2.5" />
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}

              {dimensionRows.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-xs text-muted-foreground">
                    No buckets meet the minimum sample size filter (Min N: {minSampleSize}).
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODULE 4: AUTOMATED EDGE AMPLIFIERS, DRAWDOWN LEAKS & HESITATION TAX */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Top Edge Amplifiers */}
        <div className="rounded-xl border border-border/50 bg-card p-4 space-y-3">
          <div className="flex items-center gap-2 text-xs font-bold text-emerald-400 border-b border-border/30 pb-2">
            <TrendingUp className="h-4 w-4" />
            <span>Top Edge Amplifiers (Tags &amp; Rules)</span>
          </div>
          <div className="space-y-2 text-xs">
            {(data.edgeAmplifiers || [])
              .filter((f: any) => f.metrics.count >= minSampleSize)
              .slice(0, 5)
              .map((item: any) => (
                <div
                  key={item.id}
                  className="rounded-lg border border-border/40 bg-secondary/20 p-2.5 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <div className="text-[10px] text-muted-foreground truncate">
                      {item.groupLabel}
                    </div>
                    <div className="font-semibold text-foreground truncate">
                      {item.label}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {item.metrics.count} setups • Win Rate: {item.metrics.winRate}%
                    </div>
                  </div>
                  <div className="text-right font-mono shrink-0">
                    <div className="font-bold text-emerald-400">
                      +{item.metrics.expectancyR}R/trade
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      Lift: {item.expectancyLiftR >= 0 ? "+" : ""}
                      {item.expectancyLiftR}R
                    </div>
                  </div>
                </div>
              ))}
          </div>
        </div>

        {/* Top Drawdown & Leak Flags */}
        <div className="rounded-xl border border-border/50 bg-card p-4 space-y-3">
          <div className="flex items-center gap-2 text-xs font-bold text-rose-400 border-b border-border/30 pb-2">
            <TrendingDown className="h-4 w-4" />
            <span>Drawdown &amp; Underperformance Flags</span>
          </div>
          <div className="space-y-2 text-xs">
            {(data.drawdownLeaks || []).length === 0 ? (
              <div className="py-6 text-center text-muted-foreground">
                No negative-expectancy tags or rules flagged in this sample.
              </div>
            ) : (
              (data.drawdownLeaks || []).slice(0, 5).map((item: any) => (
                <div
                  key={item.id}
                  className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-2.5 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <div className="text-[10px] text-muted-foreground truncate">
                      {item.groupLabel}
                    </div>
                    <div className="font-semibold text-foreground truncate">
                      {item.label}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {item.metrics.count} setups • Win Rate: {item.metrics.winRate}%
                    </div>
                  </div>
                  <div className="text-right font-mono shrink-0">
                    <div className="font-bold text-rose-400">
                      {item.metrics.expectancyR}R/trade
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      Net: {item.metrics.totalR}R
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Hesitation Tax & 2-Factor Synergies */}
        <div className="rounded-xl border border-border/50 bg-card p-4 space-y-3">
          <div className="flex items-center gap-2 text-xs font-bold text-amber-400 border-b border-border/30 pb-2">
            <ShieldAlert className="h-4 w-4" />
            <span>2-Factor Synergies &amp; Hesitation Tax</span>
          </div>
          <div className="space-y-2 text-xs">
            {(data.confluencePairs || []).slice(0, 3).map((pair: any) => (
              <div
                key={pair.id}
                className="rounded-lg border border-indigo-500/30 bg-indigo-500/10 p-2.5 flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <div className="text-[10px] text-indigo-300 truncate">
                    Confluence Synergy • {pair.metrics.count} setups
                  </div>
                  <div className="font-semibold text-foreground truncate">
                    {pair.label}
                  </div>
                </div>
                <div className="text-right font-mono shrink-0">
                  <div className="font-bold text-emerald-400">
                    +{pair.metrics.expectancyR}R
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {pair.metrics.winRate}% WR
                  </div>
                </div>
              </div>
            ))}

            {(data.hesitationTax || []).slice(0, 3).map((h: any) => (
              <div
                key={h.tag}
                className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <div className="text-[10px] text-amber-300">
                    Hesitation Tax ({h.hesitationRatePct}% missed)
                  </div>
                  <div className="font-semibold text-foreground truncate">
                    {h.tag}
                  </div>
                </div>
                <div className="text-right font-mono shrink-0">
                  <div className="font-bold text-amber-300">
                    +{h.missedTotalR}R missed
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {fmtMoney(h.missedPnl)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
