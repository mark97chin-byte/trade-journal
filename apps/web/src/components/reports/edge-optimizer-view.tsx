"use client";

import React, { useState, useMemo, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useApi } from "@/lib/use-api";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AiLogButton } from "@/components/ai-log-button";
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
  Info,
  BookOpen,
  MessageSquare,
  Send,
  RefreshCw,
  Calendar,
  Moon,
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

function HintIcon({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center text-muted-foreground/70 hover:text-foreground transition-colors"
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs leading-relaxed">
        {text}
      </TooltipContent>
    </Tooltip>
  );
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
  const [selectedStrategyId, setSelectedStrategyId] = useState<string>("all");
  const [minSampleSize, setMinSampleSize] = useState<number>(1);
  const [activeDimension, setActiveDimension] = useState<string>("playbook_rules");
  const [expandedBucketKey, setExpandedBucketKey] = useState<string | null>(null);
  const [collapsedPlaybooks, setCollapsedPlaybooks] = useState<Record<string, boolean>>({});
  const [collapsedRuleGroups, setCollapsedRuleGroups] = useState<Record<string, boolean>>({});

  // AI Status, Saved Optimizer Reports & Q&A state
  const [aiStatus, setAiStatus] = useState<{
    online: boolean;
    modelName: string;
    baseUrl: string;
  } | null>(null);
  const [savedOptimizerReports, setSavedOptimizerReports] = useState<any[]>([]);
  const [selectedReportId, setSelectedReportId] = useState<string>("");
  const [reportCommentsMap, setReportCommentsMap] = useState<Record<string, any[]>>({});
  const [qaInput, setQaInput] = useState("");
  const [qaSending, setQaSending] = useState(false);
  const [showReportPanel, setShowReportPanel] = useState(true);

  const [aiLoading, setAiLoading] = useState(false);

  const apiUrl = `/api/reports/optimizer?${query}${query ? "&" : ""}includeMissed=${
    includeMissed ? "1" : "0"
  }&strategyId=${encodeURIComponent(selectedStrategyId)}`;

  const { data, loading } = useApi<any>(apiUrl);

  const fetchAiCoachStatusAndReports = useCallback(async () => {
    try {
      const res = await fetch("/api/ai/coach");
      const json = await res.json();
      if (json.ok) {
        if (json.kobold) {
          setAiStatus({
            online: Boolean(json.kobold.online),
            modelName: json.kobold.modelName || json.kobold.activeModelFile || "KoboldCpp",
            baseUrl: json.kobold.baseUrl || "http://100.75.201.34:5001",
          });
        }
        const optReps = (json.reports || []).filter((r: any) => r.horizon === "optimizer");
        setSavedOptimizerReports(optReps);
        setReportCommentsMap(json.reportCommentsMap || {});
        if (!selectedReportId && optReps.length > 0) {
          setSelectedReportId(optReps[0].id);
        }
      }
    } catch {}
  }, [selectedReportId]);

  useEffect(() => {
    void fetchAiCoachStatusAndReports();
  }, [fetchAiCoachStatusAndReports]);

  // Natural sort helper (1., 2., 3., ...)
  const sortRowsNaturally = useCallback((rows: any[]) => {
    return [...rows].sort((a, b) => {
      const catCmp = String(a.categoryName || "").localeCompare(
        String(b.categoryName || ""),
        undefined,
        { numeric: true, sensitivity: "base" }
      );
      if (catCmp !== 0) return catCmp;
      return String(a.label || "").localeCompare(String(b.label || ""), undefined, {
        numeric: true,
        sensitivity: "base",
      });
    });
  }, []);

  const dimensionRows = useMemo(() => {
    if (!data?.dimensions) return [];
    let raw: any[] = [];
    if (activeDimension === "all_categories") {
      const sortedCats = data.tagCategories || [];
      for (const c of sortedCats) {
        const catList = data.dimensions.byCategory?.[c.id] || [];
        raw.push(...sortRowsNaturally(catList));
      }
    } else if (activeDimension.startsWith("cat:")) {
      const catId = activeDimension.slice(4);
      raw = sortRowsNaturally(data.dimensions.byCategory?.[catId] || []);
    } else if (activeDimension === "killzone") {
      raw = data.dimensions.byKillzone || [];
    } else if (activeDimension === "candle7h") {
      raw = data.dimensions.by7hCandle || [];
    } else if (activeDimension === "duration") {
      raw = data.dimensions.byDuration || [];
    } else if (activeDimension === "overnight") {
      raw = data.dimensions.byOvernight || [];
    } else if (activeDimension === "macro") {
      raw = data.dimensions.byMacroEvent || [];
    } else if (activeDimension === "sequential") {
      raw = data.dimensions.bySequentialState || [];
    } else if (activeDimension === "sym_dir") {
      raw = data.dimensions.bySymbolDirection || [];
    } else if (activeDimension === "dow") {
      raw = data.dimensions.byDayOfWeek || [];
    } else if (activeDimension === "symbol") {
      raw = data.dimensions.bySymbol || [];
    }
    return raw.filter((r) => (r.metrics?.count ?? 0) >= minSampleSize);
  }, [data, activeDimension, minSampleSize, sortRowsNaturally]);

  const selectedStrategyLabel = useMemo(() => {
    if (selectedStrategyId === "all") return "All Strategies";
    const found = (data?.playbooks || []).find((p: any) => p.id === selectedStrategyId);
    return found ? found.name : "Strategy";
  }, [data?.playbooks, selectedStrategyId]);

  const runAiAudit = async () => {
    if (!data) return;
    setAiLoading(true);
    try {
      const res = await fetch("/api/reports/optimizer/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          strategyLabel: selectedStrategyLabel,
        }),
      });
      const json = await res.json();
      if (json.ok && json.reportId) {
        await fetchAiCoachStatusAndReports();
        setSelectedReportId(json.reportId);
        setShowReportPanel(true);
      }
    } finally {
      setAiLoading(false);
    }
  };

  const activeSavedReport = useMemo(() => {
    if (!savedOptimizerReports.length) return null;
    return (
      savedOptimizerReports.find((r) => r.id === selectedReportId) ||
      savedOptimizerReports[0] ||
      null
    );
  }, [savedOptimizerReports, selectedReportId]);

  const activeReportComments = useMemo(() => {
    if (!activeSavedReport) return [];
    return reportCommentsMap[activeSavedReport.id] || [];
  }, [activeSavedReport, reportCommentsMap]);

  const handleAskReportQuestion = async () => {
    const q = qaInput.trim();
    if (!q || !activeSavedReport || qaSending) return;
    setQaSending(true);
    setQaInput("");
    try {
      await fetch("/api/ai/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "chat_coach",
          reportId: activeSavedReport.id,
          message: q,
        }),
      });
      // Poll briefly for reply
      setTimeout(() => void fetchAiCoachStatusAndReports(), 1500);
      setTimeout(() => void fetchAiCoachStatusAndReports(), 4000);
      setTimeout(() => void fetchAiCoachStatusAndReports(), 8000);
    } finally {
      setQaSending(false);
    }
  };

  if (loading || !data?.baseline) {
    return <Skeleton className="h-96 w-full rounded-xl" />;
  }

  const b = data.baseline;
  const mfeCurve = data.mfeCurve;
  const bestTarget = mfeCurve?.bestTrailing;
  const samplePct = Math.min(100, Math.round((b.count / 20) * 100));
  const ovSummary = data.overnightSummary;

  const renderTradesDrillDown = (tradesList: any[], label: string) => (
    <div className="rounded-lg border border-border/50 bg-card p-2.5 space-y-1.5">
      <div className="text-[11px] font-bold text-foreground">
        Setups matching &ldquo;{label}&rdquo; ({tradesList.length})
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {tradesList.map((t: any, i: number) => {
          const isM = Boolean(t.isMissed);
          const k = String(t.key ?? t.id ?? i);
          const link = isM
            ? `/missed/${encodeURIComponent(k)}`
            : `/trades/${encodeURIComponent(k)}`;
          const rVal = typeof t.realizedR === "number" ? t.realizedR : null;
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
                  <span className="font-mono font-bold text-foreground">{t.symbol}</span>
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
                    Number(t.netPnl ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"
                  }`}
                >
                  {fmtMoney(Number(t.netPnl ?? 0))}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {rVal !== null ? `${rVal > 0 ? "+" : ""}${rVal.toFixed(2)}R` : ""}{" "}
                  <ExternalLink className="inline h-2.5 w-2.5" />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  const renderMfeCurveSvg = () => {
    const pts: any[] = mfeCurve?.points || [];
    if (pts.length === 0 || b.count === 0) {
      return (
        <div className="flex h-52 items-center justify-center text-xs text-muted-foreground">
          No trades found in the selected date/filter range.
        </div>
      );
    }

    const width = 760;
    const height = 220;
    const padL = 48;
    const padR = 24;
    const padT = 24;
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

        {bestIdx >= 0 && bestTarget && (
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
              x={Math.min(width - 120, Math.max(120, getX(bestIdx)))}
              y={Math.max(14, getY(pts[bestIdx]!.trailingExpR) - 10)}
              textAnchor="middle"
              fontSize="10"
              fontWeight="bold"
              fill="#fbbf24"
            >
              Optimal: {bestTarget.targetR}R ({bestTarget.trailingExpR >= 0 ? "+" : ""}
              {bestTarget.trailingExpR}R/trade • {bestTarget.hitRate}% hit)
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
      {/* TOP CONTROL BAR, AI STATUS CHECK, LOGS BUTTON & SAMPLE SIZE ADVISORY */}
      <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Target className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-base font-bold text-foreground">
                Quantitative Edge &amp; R-Multiple Optimizer
              </h2>
              <HintIcon text="Combines exact R-multiple excursion math (MFE/MAE, Partial Scale-Outs, Hold-Time, Overnight Cushion R, Macro News CPI/NFP/FOMC, and Grouped Playbook Rules) with AI pattern synthesis." />

              {/* Live AI / KoboldCpp Status Badge (Same as Progress Tab) */}
              {aiStatus && (
                <button
                  type="button"
                  onClick={() => void fetchAiCoachStatusAndReports()}
                  title="Click to refresh AI model connection status"
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold transition ${
                    aiStatus.online
                      ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                      : "border-amber-500/40 bg-amber-500/15 text-amber-300"
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      aiStatus.online ? "bg-emerald-400" : "bg-amber-400"
                    }`}
                  />
                  <span>
                    {aiStatus.online
                      ? `AI Online · ${aiStatus.modelName}`
                      : `Desktop AI Offline (Quant Fallback Active)`}
                  </span>
                </button>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Layer 1 exact mathematical excursion, overnight &amp; macro news engine + Layer 2 AI pattern synthesizer.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Strategy Filter */}
            <select
              value={selectedStrategyId}
              onChange={(e) => setSelectedStrategyId(e.target.value)}
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
              {[1, 3, 5, 10, 15, 20].map((nVal) => (
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
              <HintIcon text="Filter out tag/rule rows with fewer than N trades. Set to 1+ to inspect all buckets or 15+ / 20+ for statistically mature patterns." />
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
              className="h-8 gap-1.5 bg-secondary text-foreground font-semibold border border-border hover:bg-secondary/80 text-xs"
            >
              {aiLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
              )}
              <span>{aiLoading ? "Analyzing & Saving..." : "Run AI Pattern & Edge Audit"}</span>
            </Button>

            {/* Live AI Stream Logs Toggle Button (Same as Progress Tab) */}
            <AiLogButton label="Logs" onAborted={() => void fetchAiCoachStatusAndReports()} />
          </div>
        </div>

        {/* Sample Size Confidence & Data Skew Banner */}
        <div className="rounded-lg border border-border/50 bg-secondary/20 p-3 flex flex-wrap items-center justify-between gap-4 text-xs">
          <div className="flex items-center gap-2.5">
            {b.count >= 20 ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
            )}
            <div>
              <span className="font-bold text-foreground">
                Active Sample: {b.count} Setups ({b.executedCount} Executed
                {includeMissed ? ` + ${b.missedCount} Missed` : ""})
              </span>
              <span className="ml-2 text-muted-foreground">
                {b.count >= 20
                  ? "Statistically actionable sample size reached (N ≥ 20). Note: individual sub-buckets with N < 10 may still be skewed by outliers."
                  : "Note: Optimization is running on all available trades below, but data may be skewed due to a small sample size (<20 trades)."}
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

      {/* TOP 6 QUANTITATIVE TELEMETRY CARDS */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 text-xs">
        <div className="rounded-xl border border-border/50 bg-card p-3.5 space-y-1">
          <div className="flex items-center justify-between text-[10px] uppercase font-bold text-muted-foreground">
            <span>Expectancy E[R]</span>
            <HintIcon text="Average R-multiple won or lost per trade: (Win% × Avg Win R) - (Loss% × Avg Loss R). The 95% CI shows the statistical range of your true expectancy." />
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
          <div className="flex items-center justify-between text-[10px] uppercase font-bold text-muted-foreground">
            <span>System Quality (SQN)</span>
            <HintIcon text="Van Tharp's System Quality Number = √N × (Mean R / StdDev R). Measures consistency of returns relative to volatility. >2.0 is solid; >3.0 is excellent." />
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
          <div className="flex items-center justify-between text-[10px] uppercase font-bold text-muted-foreground">
            <span>Optimal Target R*</span>
            <HintIcon text="The fixed Take-Profit R-multiple (between 0.5R and 8.0R) that maximizes per-trade expectancy based on how far your trades actually ran (MFE R)." />
          </div>
          <div className="text-lg font-bold font-mono text-amber-400">
            {bestTarget ? `${bestTarget.targetR}R` : "—"}
          </div>
          <div className="text-[10px] text-muted-foreground">
            {bestTarget
              ? `${bestTarget.trailingExpR >= 0 ? "+" : ""}${bestTarget.trailingExpR}R exp (${bestTarget.hitRate}% hit)`
              : "No MFE data"}
          </div>
        </div>

        <div className="rounded-xl border border-border/50 bg-card p-3.5 space-y-1">
          <div className="flex items-center justify-between text-[10px] uppercase font-bold text-muted-foreground">
            <span>90% Winner Heat (MAE)</span>
            <HintIcon text="90% of your winning trades never experienced more drawdown than this R value. If a live trade draws down past this level, its historical probability of winning drops below 10%." />
          </div>
          <div className="text-lg font-bold font-mono text-rose-400">
            {b.p90WinnerMaeR !== null ? `-${b.p90WinnerMaeR}R` : "—"}
          </div>
          <div className="text-[10px] text-muted-foreground">
            Avg winner heat: {b.avgWinnerMaeR !== null ? `-${b.avgWinnerMaeR}R` : "—"}
          </div>
        </div>

        <div className="rounded-xl border border-border/50 bg-card p-3.5 space-y-1">
          <div className="flex items-center justify-between text-[10px] uppercase font-bold text-muted-foreground">
            <span>R Capture Efficiency</span>
            <HintIcon text="Percentage of Maximum Favorable Excursion (MFE R) locked in at exit on winning trades (Realized R ÷ MFE R). Runner bleed shows average R left on the table." />
          </div>
          <div className="text-lg font-bold font-mono text-foreground">
            {b.avgCaptureEff !== null ? `${b.avgCaptureEff}%` : "—"}
          </div>
          <div className="text-[10px] text-muted-foreground">
            Runner bleed: {b.runnerBleedR !== null ? `${b.runnerBleedR}R/win` : "—"}
          </div>
        </div>

        <div className="rounded-xl border border-border/50 bg-card p-3.5 space-y-1">
          <div className="flex items-center justify-between text-[10px] uppercase font-bold text-muted-foreground">
            <span>Overnight Cushion R*</span>
            <HintIcon text="Minimum floating/peak R cushion typically needed before holding a trade overnight has positive expectancy (25th percentile of winning overnight holds)." />
          </div>
          <div className="text-lg font-bold font-mono text-indigo-400">
            +{ovSummary?.recommendedCushionR ?? 1.0}R
          </div>
          <div className="text-[10px] text-muted-foreground">
            Win median: +{ovSummary?.medianWinnerPeakR ?? "—"}R ({ovSummary?.overnightCount ?? 0} ovn)
          </div>
        </div>
      </div>

      {/* MODULE 1 & 2: MFE TARGET CURVE + PARTIAL SCALE-OUT SIMULATOR */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="lg:col-span-7 rounded-xl border border-border/50 bg-card p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-border/30 pb-2">
            <div>
              <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                <span>1. MFE Optimal Target R Expectancy Curve (0.5R → 8.0R)</span>
                <HintIcon text="Tests every candidate Take-Profit level from 0.5R to 8.0R. If a trade's MFE reached T, it simulates banking +T R; otherwise it keeps the trade's actual realized R." />
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
            <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
              <span>2. Top Partial Scale-Out Plans (TP1 + SL→BE + Runner)</span>
              <HintIcon text="Simulates 36 two-stage partial scale-out combinations (taking 25%/50%/75% off at TP1, moving stop to Breakeven 0R, and holding the runner to TP2) against your historical MFE." />
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
                  <div
                    className={`font-bold ${
                      plan.expectancyR >= 0 ? "text-emerald-400" : "text-rose-400"
                    }`}
                  >
                    {plan.expectancyR >= 0 ? `+${plan.expectancyR}R` : `${plan.expectancyR}R`}/trade
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    Net: {plan.totalR >= 0 ? `+${plan.totalR}R` : `${plan.totalR}R`}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* MODULE 3: MIX & MATCH CROSS-TAB OPTIMIZER MATRIX (SORTED NUMBERS + GROUPED PLAYBOOK RULES + OVERNIGHT + MACRO NEWS) */}
      <div className="rounded-xl border border-border/50 bg-card p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/30 pb-3">
          <div>
            <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
              <Layers className="h-4 w-4 text-muted-foreground" />
              <span>3. Mix &amp; Match Cross-Tab Matrix (Click any row to view trades)</span>
              <HintIcon text="Organized by Playbook & Rule Group, sorted numbered Tag Categories (1. -> 9.), Hold Duration (up to >8h and >1d), Overnight Hold Cushion R, and Big 3 Macro News (CPI, NFP, FOMC & Bank Holidays)." />
            </h3>
            <p className="text-[11px] text-muted-foreground">
              Inspect Grouped Playbook Rules, numbered Tag Categories, Hold Duration (&gt;8h / &gt;1d), Overnight Cushion R, or Macro News (CPI / NFP / FOMC / Holidays).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {[
              { id: "playbook_rules", label: "Playbook Rules (Grouped)" },
              { id: "macro", label: "Macro News (CPI / NFP / FOMC / Holidays)" },
              { id: "overnight", label: "Overnight Holds & Cushion R" },
              { id: "duration", label: "Hold Duration (<5m to >1d)" },
              { id: "all_categories", label: "All Tag Categories (1–9)" },
              ...(data.tagCategories || []).map((c: any) => ({
                id: `cat:${c.id}`,
                label: c.name,
              })),
              { id: "killzone", label: "ICT Killzones" },
              { id: "candle7h", label: "7H Candles" },
              { id: "sequential", label: "Post-Win / Post-Loss" },
              { id: "sym_dir", label: "Symbol × Direction" },
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

        {/* OVERNIGHT HOLD & CUSHION R INSIGHT BANNER */}
        {activeDimension === "overnight" && ovSummary && (
          <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-3.5 text-xs flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <Moon className="h-4 w-4 text-indigo-400 shrink-0" />
              <div>
                <span className="font-bold text-foreground">
                  Overnight Hold Cushion Threshold: +{ovSummary.recommendedCushionR}R
                </span>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Winning overnight trades reached a median peak cushion of{" "}
                  <strong className="text-emerald-400">
                    +{ovSummary.medianWinnerPeakR ?? "—"}R
                  </strong>{" "}
                  (vs.{" "}
                  <strong className="text-rose-400">
                    +{ovSummary.medianLoserPeakR ?? "0.00"}R
                  </strong>{" "}
                  on overnight trades that reversed into losses). Holding overnight when near B/E or negative (&lt; +0.75R cushion) significantly increases stop-out risk.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* MACRO NEWS (CPI, NFP, FOMC & BANK HOLIDAY) INSIGHT BANNER */}
        {activeDimension === "macro" && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <Calendar className="h-4 w-4 text-amber-400 shrink-0" />
              <div>
                <span className="font-bold text-foreground">
                  Big 3 Macro News (CPI, NFP, FOMC) &amp; US Bank Holiday Regime Tracker
                </span>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Compares your baseline non-event days against: (1) Pre-CPI &amp; Pre-FOMC days in the week vs. Post-release days, (2) 1 Day Before (T-1) CPI / NFP / FOMC / Holidays, (3) Release Day (T-0) post-news execution, and (4) NFP Week Mon–Wed vs. Thu–Fri.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* VIEW A: GROUPED PLAYBOOK RULES (PLAYBOOK -> RULE GROUP -> NUMBERED RULES) */}
        {activeDimension === "playbook_rules" ? (
          <div className="space-y-4">
            {(data.groupedPlaybookRules || []).map((pbGroup: any) => {
              const isPbCollapsed = Boolean(collapsedPlaybooks[pbGroup.playbookId]);
              return (
                <div
                  key={pbGroup.playbookId}
                  className="rounded-xl border border-border/60 bg-secondary/10 overflow-hidden"
                >
                  {/* Playbook Group Header */}
                  <button
                    type="button"
                    onClick={() =>
                      setCollapsedPlaybooks((prev) => ({
                        ...prev,
                        [pbGroup.playbookId]: !prev[pbGroup.playbookId],
                      }))
                    }
                    className="flex w-full items-center justify-between bg-secondary/40 px-4 py-2.5 text-left text-xs font-bold text-foreground hover:bg-secondary/60 transition"
                  >
                    <div className="flex items-center gap-2">
                      {isPbCollapsed ? (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span>{pbGroup.playbookIcon}</span>
                      <span>{pbGroup.playbookName}</span>
                      <span className="rounded bg-background/80 px-2 py-0.5 text-[10px] font-mono text-muted-foreground">
                        {pbGroup.totalPlaybookTrades} strategy setups
                      </span>
                    </div>
                    <span className="text-[10px] text-muted-foreground">
                      {isPbCollapsed ? "Expand Playbook" : "Collapse Playbook"}
                    </span>
                  </button>

                  {!isPbCollapsed && (
                    <div className="p-3 space-y-3">
                      {(pbGroup.groups || []).map((rg: any, gIdx: number) => {
                        const rgKey = `${pbGroup.playbookId}::${rg.groupId}`;
                        const isRgCollapsed = Boolean(collapsedRuleGroups[rgKey]);
                        const visibleRules = (rg.rules || []).filter(
                          (r: any) => (r.metrics?.count ?? 0) >= minSampleSize
                        );
                        if (visibleRules.length === 0) return null;

                        return (
                          <div
                            key={rgKey}
                            className="rounded-lg border border-border/40 bg-background/50 overflow-hidden"
                          >
                            <button
                              type="button"
                              onClick={() =>
                                setCollapsedRuleGroups((prev) => ({
                                  ...prev,
                                  [rgKey]: !prev[rgKey],
                                }))
                              }
                              className="flex w-full items-center justify-between bg-secondary/20 px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground transition"
                            >
                              <div className="flex items-center gap-1.5">
                                {isRgCollapsed ? (
                                  <ChevronRight className="h-3.5 w-3.5" />
                                ) : (
                                  <ChevronDown className="h-3.5 w-3.5" />
                                )}
                                <span>
                                  {gIdx + 1}. {rg.groupName}
                                </span>
                              </div>
                              <span className="text-[10px] font-normal lowercase">
                                {visibleRules.length} rules
                              </span>
                            </button>

                            {!isRgCollapsed && (
                              <div className="overflow-x-auto">
                                <table className="w-full text-left text-xs">
                                  <thead className="border-b border-border/30 text-[11px] text-muted-foreground">
                                    <tr>
                                      <th className="py-2 pl-3">Rule</th>
                                      <th className="py-2 text-right">Followed (N)</th>
                                      <th className="py-2 text-right">Win %</th>
                                      <th className="py-2 text-right">Expectancy E[R]</th>
                                      <th className="py-2 text-right">Total Net R</th>
                                      <th className="py-2 text-right">Avg MFE / MAE</th>
                                      <th className="py-2 text-right">R Capture</th>
                                      <th className="py-2 text-right">Optimal Target R*</th>
                                      <th className="py-2 pr-3 text-right">Net P&amp;L</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-border/20">
                                    {visibleRules.map((ruleRow: any, rIdx: number) => {
                                      const m = ruleRow.metrics;
                                      const bKey = `rule-${ruleRow.key}`;
                                      const isExpanded = expandedBucketKey === bKey;
                                      return (
                                        <React.Fragment key={bKey}>
                                          <tr
                                            onClick={() =>
                                              setExpandedBucketKey((prev) =>
                                                prev === bKey ? null : bKey
                                              )
                                            }
                                            className={`cursor-pointer transition-colors ${
                                              isExpanded
                                                ? "bg-secondary/40 font-semibold"
                                                : "hover:bg-secondary/20"
                                            }`}
                                          >
                                            <td className="py-2.5 pl-3 font-medium text-foreground">
                                              <div className="flex items-center gap-2">
                                                {isExpanded ? (
                                                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                                ) : (
                                                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                                )}
                                                <span className="font-mono text-[10px] text-muted-foreground">
                                                  {gIdx + 1}.{rIdx + 1}
                                                </span>
                                                <span>{ruleRow.label}</span>
                                              </div>
                                            </td>
                                            <td className="py-2.5 text-right font-mono text-foreground">
                                              {m.count}{" "}
                                              <span className="text-[10px] text-muted-foreground">
                                                ({ruleRow.followRatePct}%)
                                              </span>
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
                                              {m.expectancyR > 0
                                                ? `+${m.expectancyR}R`
                                                : `${m.expectancyR}R`}
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
                                              {m.avgWinnerMfeR !== null
                                                ? `+${m.avgWinnerMfeR}R`
                                                : "—"}{" "}
                                              /{" "}
                                              {m.avgWinnerMaeR !== null
                                                ? `-${m.avgWinnerMaeR}R`
                                                : "—"}
                                            </td>
                                            <td className="py-2.5 text-right font-mono text-muted-foreground">
                                              {m.avgCaptureEff !== null
                                                ? `${m.avgCaptureEff}%`
                                                : "—"}
                                            </td>
                                            <td className="py-2.5 text-right font-mono font-bold text-amber-400">
                                              {ruleRow.optimalTargetR
                                                ? `${ruleRow.optimalTargetR}R`
                                                : "—"}
                                            </td>
                                            <td
                                              className={`py-2.5 pr-3 text-right font-mono font-semibold ${
                                                m.netPnl >= 0 ? "text-emerald-400" : "text-rose-400"
                                              }`}
                                            >
                                              {fmtMoney(m.netPnl)}
                                            </td>
                                          </tr>
                                          {isExpanded && Array.isArray(ruleRow.trades) && (
                                            <tr>
                                              <td colSpan={9} className="bg-[#0d0f14]/90 p-3">
                                                {renderTradesDrillDown(
                                                  ruleRow.trades,
                                                  ruleRow.label
                                                )}
                                              </td>
                                            </tr>
                                          )}
                                        </React.Fragment>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          /* VIEW B: STANDARD CROSS-TAB TABLE FOR TAG CATEGORIES, MACRO NEWS, OVERNIGHT, DURATION, KILLZONES */
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
                        <td className="py-2.5 text-right font-mono">{m.winRate}%</td>
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
                            {renderTradesDrillDown(row.trades, row.label)}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}

                {dimensionRows.length === 0 && (
                  <tr>
                    <td colSpan={9} className="py-8 text-center text-xs text-muted-foreground">
                      No buckets in this dimension meet Min N = {minSampleSize}. Click &ldquo;1+&rdquo; in Min N above to view all buckets.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* MODULE 4: AUTOMATED EDGE AMPLIFIERS, DRAWDOWN LEAKS & HESITATION TAX */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Top Edge Amplifiers */}
        <div className="rounded-xl border border-border/50 bg-card p-4 space-y-3">
          <div className="flex items-center justify-between text-xs font-bold text-emerald-400 border-b border-border/30 pb-2">
            <span className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              <span>Top Edge Amplifiers (Tags, Rules &amp; Windows)</span>
            </span>
            <HintIcon text="Single factors (Tags, Playbook Rules, Killzones, Hold Durations, or Symbol×Direction) that produce the highest positive R-expectancy." />
          </div>
          <div className="space-y-2 text-xs">
            {(data.edgeAmplifiers || [])
              .filter((f: any) => f.metrics.count >= minSampleSize)
              .slice(0, 6)
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
          <div className="flex items-center justify-between text-xs font-bold text-rose-400 border-b border-border/30 pb-2">
            <span className="flex items-center gap-2">
              <TrendingDown className="h-4 w-4" />
              <span>Negative Conditions &amp; Drawdown Flags</span>
            </span>
            <HintIcon text="Conditions, tags, hold times, or sessions causing net negative R bleed or underperformance." />
          </div>
          <div className="space-y-2 text-xs">
            {(data.drawdownLeaks || []).length === 0 ? (
              <div className="py-6 text-center text-muted-foreground">
                No negative-expectancy factors flagged in this sample.
              </div>
            ) : (
              (data.drawdownLeaks || [])
                .filter((f: any) => f.metrics.count >= minSampleSize)
                .slice(0, 6)
                .map((item: any) => (
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
          <div className="flex items-center justify-between text-xs font-bold text-amber-400 border-b border-border/30 pb-2">
            <span className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4" />
              <span>2-Factor Synergies &amp; Hesitation Tax</span>
            </span>
            <HintIcon text="Pairs of tags that perform best together, plus valid tags where hesitation (Missed Trades) left the most R on the table." />
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

      {/* MODULE 5: SAVED OPTIMIZER AI AUDIT REPORTS & INTERACTIVE FOLLOW-UP Q&A ON THIS PAGE */}
      <div className="rounded-xl border border-indigo-500/40 bg-[#12141f] p-5 space-y-4 shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/40 pb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-indigo-400" />
            <h3 className="text-sm font-bold text-foreground">
              5. AI Pattern &amp; Edge Audit Report + Interactive Q&amp;A
            </h3>
            <HintIcon text="View your AI-generated Edge & R Optimizer reports right on this page and ask follow-up questions. All reports and Q&A threads are synced with Notebook → AI Notebook → Optimizer Reports." />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {savedOptimizerReports.length > 0 && (
              <select
                value={activeSavedReport?.id || ""}
                onChange={(e) => setSelectedReportId(e.target.value)}
                className="h-8 rounded-lg border border-border/70 bg-[#0d0f14] px-2.5 text-xs text-foreground outline-none"
              >
                {savedOptimizerReports.map((rep) => (
                  <option key={rep.id} value={rep.id}>
                    {rep.title} ({rep.modelUsed})
                  </option>
                ))}
              </select>
            )}

            <Link
              href="/notebook?tab=ai&folder=optimizer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/15 hover:bg-emerald-500/25 px-2.5 py-1 text-xs font-semibold text-emerald-300 transition"
            >
              <BookOpen className="h-3.5 w-3.5" />
              <span>Open in AI Notebook ↗</span>
            </Link>

            {activeSavedReport && (
              <button
                type="button"
                onClick={() => setShowReportPanel((v) => !v)}
                className="rounded border border-border/60 bg-background/60 px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
              >
                {showReportPanel ? "Collapse" : "Expand"}
              </button>
            )}
          </div>
        </div>

        {!activeSavedReport ? (
          <div className="py-8 text-center text-xs text-muted-foreground space-y-2">
            <p>
              No Optimizer AI Audit generated yet. Click{" "}
              <strong className="text-foreground">Run AI Pattern &amp; Edge Audit</strong> at the top of the page to synthesize all tables above into an actionable report.
            </p>
          </div>
        ) : (
          showReportPanel && (
            <div className="space-y-4">
              <div className="rounded-xl border border-border/50 bg-[#0d0f14] p-4 whitespace-pre-wrap text-xs leading-relaxed text-foreground/95 max-h-[540px] overflow-y-auto">
                {activeSavedReport.summaryMd}
              </div>

              {/* Embedded Report Q&A Thread */}
              <div className="rounded-xl border border-emerald-500/30 bg-[#0d0f14] p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-bold text-foreground">
                    <MessageSquare className="h-4 w-4 text-emerald-400" />
                    <span>
                      Ask Follow-up Questions About This Optimizer Report ({activeReportComments.length})
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void fetchAiCoachStatusAndReports()}
                    className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    <RefreshCw className="h-3 w-3" />
                    <span>Refresh Replies</span>
                  </button>
                </div>

                {activeReportComments.length > 0 && (
                  <div className="max-h-72 overflow-y-auto space-y-2.5 pr-1">
                    {activeReportComments.map((m: any) => (
                      <div
                        key={m.id}
                        className={`rounded-xl p-3 text-xs whitespace-pre-wrap ${
                          m.role === "user"
                            ? "bg-indigo-600/20 border border-indigo-500/30 text-foreground ml-6"
                            : "bg-[#141722] border border-border/60 text-foreground mr-2"
                        }`}
                      >
                        <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
                          {m.role === "user" ? "You" : "AI Quant Analyst"}
                        </div>
                        {m.text}
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={qaInput}
                    onChange={(e) => setQaInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && qaInput.trim()) {
                        e.preventDefault();
                        void handleAskReportQuestion();
                      }
                    }}
                    placeholder={`Ask about "${activeSavedReport.title}" (e.g., "Which partial plan works best during London Killzone?" or "Why is my NFP week winrate lower?")...`}
                    className="h-8 flex-1 rounded-lg border border-border/70 bg-[#141722] px-3 text-xs text-foreground outline-none focus:border-emerald-500"
                  />
                  <Button
                    size="sm"
                    disabled={!qaInput.trim() || qaSending}
                    onClick={() => void handleAskReportQuestion()}
                    className="h-8 text-xs gap-1.5"
                  >
                    <Send className="h-3.5 w-3.5" />
                    <span>Ask AI</span>
                  </Button>
                </div>
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
}
