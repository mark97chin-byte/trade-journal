"use client";
import { DateTimeInputDMY, DateInputDMY } from "@/components/ui/datetime-dmy";
import { ensureAiSlotBeforeTask } from "@/lib/ai-slot-guard";

import React, { useState, useEffect, useMemo } from "react";
import {
  Calendar,
  Layers,
  Sparkles,
  Play,
  Plus,
  CheckCircle2,
  Sliders,
  ArrowLeftRight,
  TrendingUp,
  FileText,
  X,
  Power,
} from "lucide-react";

export type GoalHorizon = "weekly" | "monthly" | "quarterly" | "yearly";

interface AuditManagerModalProps {
  open: boolean;
  onClose: () => void;
  coachData: any;
  onJobStarted: () => void;
  initialHorizon?: GoalHorizon;
}

export function AuditManagerModal({
  open,
  onClose,
  coachData,
  onJobStarted,
  initialHorizon = "weekly",
}: AuditManagerModalProps) {
  const [modeTab, setModeTab] = useState<"period" | "intra" | "scoped">("period");
  const [horizon, setHorizon] = useState<GoalHorizon>(initialHorizon);

  // Explicit Period Anchors
  const [selectedWeekAnchor, setSelectedWeekAnchor] = useState<string>("");
  const [selectedMonthAnchor, setSelectedMonthAnchor] = useState<string>("");
  const [selectedQuarterAnchor, setSelectedQuarterAnchor] = useState<string>("");
  const [selectedYearAnchor, setSelectedYearAnchor] = useState<string>("");

  // Intra-Period Calendar Day Picker
  const [calendarDay, setCalendarDay] = useState<string>(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [intraType, setIntraType] = useState<
    "intraweek" | "intramonth" | "intraquarter" | "single_day"
  >("intraweek");

  // Scoped Audit & Comparator Sub-Mode
  const [scopeSubMode, setScopeSubMode] = useState<
    "compare_periods" | "trade_lookback" | "custom_event"
  >("compare_periods");
  const [comparePeriodA, setComparePeriodA] = useState<string>("");
  const [comparePeriodB, setComparePeriodB] = useState<string>("");

  // Trade Lookback & Specific Trade Selection
  const [tradeLookbackMode, setTradeLookbackMode] = useState<"last_n" | "manual">("last_n");
  const [tradeLookbackCount, setTradeLookbackCount] = useState<number>(10);
  const [tradeFilterSymbol, setTradeFilterSymbol] = useState<string>("ALL");
  const [tradeFilterOutcome, setTradeFilterOutcome] = useState<"all" | "wins" | "losses">("all");
  const [selectedTradeKeys, setSelectedTradeKeys] = useState<string[]>([]);

  // Specific Event / Journals Selection
  const [selectedJournalSlugs, setSelectedJournalSlugs] = useState<string[]>([]);
  const [journalPeriodFilter, setJournalPeriodFilter] = useState<string>("all");
  const [customFocusPrompt, setCustomFocusPrompt] = useState<string>("");

  // Execution & GPU Settings
  const [thinkingMode, setThinkingMode] = useState<"fast" | "balanced" | "deep">("balanced");
  const [stopServerAfterQueue, setStopServerAfterQueue] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);

  // Live Server-Verified Preview of the 4-Period Lookback Buckets
  const [previewData, setPreviewData] = useState<any>(null);
  const [loadingPreview, setLoadingPreview] = useState<boolean>(false);

  const periods = coachData?.availablePeriods || {
    weeks: [],
    months: [],
    quarters: [],
    years: [],
  };

  // Initialize default selections when catalog loads
  useEffect(() => {
    if (!selectedWeekAnchor && periods.weeks?.length > 0) {
      // Default to Last Completed Week (index 1) if Current Week has 0 trades, else index 0
      const defWk =
        periods.weeks[0]?.trades === 0 && periods.weeks[1]
          ? periods.weeks[1].anchorValue
          : periods.weeks[0].anchorValue;
      setSelectedWeekAnchor(defWk);
    }
    if (!selectedMonthAnchor && periods.months?.length > 0) {
      const defMo =
        periods.months[0]?.trades === 0 && periods.months[1]
          ? periods.months[1].anchorValue
          : periods.months[0].anchorValue;
      setSelectedMonthAnchor(defMo);
    }
    if (!selectedQuarterAnchor && periods.quarters?.length > 0) {
      setSelectedQuarterAnchor(periods.quarters[0].anchorValue);
    }
    if (!selectedYearAnchor && periods.years?.length > 0) {
      setSelectedYearAnchor(periods.years[0].anchorValue);
    }
    if (!comparePeriodA && periods.months?.length >= 2) {
      const m0 = periods.months[0]?.trades === 0 && periods.months[1] ? periods.months[1] : periods.months[0];
      const m1 = periods.months[0]?.trades === 0 && periods.months[2] ? periods.months[2] : periods.months[1];
      if (m0) setComparePeriodA(m0.anchorValue);
      if (m1) setComparePeriodB(m1.anchorValue);
    }
  }, [
    periods,
    selectedWeekAnchor,
    selectedMonthAnchor,
    selectedQuarterAnchor,
    selectedYearAnchor,
    comparePeriodA,
  ]);

  const activeTargetAnchor = useMemo(() => {
    if (modeTab === "intra") return calendarDay;
    if (horizon === "weekly") return selectedWeekAnchor;
    if (horizon === "monthly") return selectedMonthAnchor;
    if (horizon === "quarterly") return selectedQuarterAnchor;
    return selectedYearAnchor;
  }, [
    modeTab,
    calendarDay,
    horizon,
    selectedWeekAnchor,
    selectedMonthAnchor,
    selectedQuarterAnchor,
    selectedYearAnchor,
  ]);

  const effectiveHorizon: GoalHorizon = useMemo(() => {
    if (modeTab === "intra") {
      if (intraType === "intramonth") return "monthly";
      if (intraType === "intraquarter") return "quarterly";
      return "weekly";
    }
    return horizon;
  }, [modeTab, intraType, horizon]);

  const builtCustomScope = useMemo(() => {
    const base: any = {
      thinkingMode,
      stopServerAfterQueue,
      customFocusPrompt: customFocusPrompt.trim() || undefined,
    };

    if (modeTab === "period") {
      base.scopeMode = "standard";
      base.intraMode = "none";
      base.targetAnchorDate = activeTargetAnchor;
      base.reportStyle = "end_of_period";
    } else if (modeTab === "intra") {
      base.scopeMode = "standard";
      base.intraMode = intraType;
      base.targetAnchorDate = calendarDay;
      base.reportStyle = "mid_period";
    } else {
      // modeTab === "scoped"
      base.scopeMode = scopeSubMode;
      base.intraMode = "none";
      base.targetAnchorDate = activeTargetAnchor;
      if (scopeSubMode === "compare_periods") {
        base.comparePeriodA = comparePeriodA;
        base.comparePeriodB = comparePeriodB;
      } else if (scopeSubMode === "trade_lookback") {
        if (tradeLookbackMode === "manual") {
          base.selectedTradeKeys = selectedTradeKeys;
        } else {
          base.tradeLookbackCount = tradeLookbackCount;
          base.tradeFilterSymbol = tradeFilterSymbol;
          base.tradeFilterOutcome = tradeFilterOutcome;
        }
      } else if (scopeSubMode === "custom_event") {
        base.selectedJournalSlugs = selectedJournalSlugs;
        base.selectedTradeKeys = selectedTradeKeys;
      }
    }
    return base;
  }, [
    modeTab,
    thinkingMode,
    stopServerAfterQueue,
    customFocusPrompt,
    activeTargetAnchor,
    intraType,
    calendarDay,
    scopeSubMode,
    comparePeriodA,
    comparePeriodB,
    tradeLookbackMode,
    selectedTradeKeys,
    tradeLookbackCount,
    tradeFilterSymbol,
    tradeFilterOutcome,
    selectedJournalSlugs,
  ]);

  // Fetch live server-verified preview whenever selection changes
  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoadingPreview(true);
    fetch("/api/ai/coach", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "preview_audit_scope",
        horizon: effectiveHorizon,
        customScope: builtCustomScope,
      }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (active && d?.ok) {
          setPreviewData(d);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoadingPreview(false);
      });
    return () => {
      active = false;
    };
  }, [open, effectiveHorizon, builtCustomScope]);

  if (!open) return null;

  const selectableTrades = coachData?.selectableTrades || [];
  const selectableJournals = coachData?.selectableJournals || [];
  const uniqueSymbols = Array.from(
    new Set(selectableTrades.map((t: any) => t.symbol).filter(Boolean))
  ) as string[];

  const allComparisonPeriodOptions = [
    ...(periods.months || []).map((m: any) => ({
      value: m.anchorValue,
      label: `Month: ${m.label} (${m.trades}T · $${m.netPnl})`,
    })),
    ...(periods.weeks || []).map((w: any) => ({
      value: w.anchorValue,
      label: `Week: ${w.shortLabel} (${w.trades}T · $${w.netPnl})`,
    })),
    ...(periods.quarters || []).map((q: any) => ({
      value: q.anchorValue,
      label: `Quarter: ${q.label} (${q.trades}T · $${q.netPnl})`,
    })),
  ];

  const handleTriggerAudit = async () => {
    setSubmitting(true);
    try {
      await fetch("/api/ai/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate_report",
          horizon: effectiveHorizon,
          stopServerAfterQueue,
          customScope: builtCustomScope,
        }),
      });
      onJobStarted();
      onClose();
    } catch {}
    setSubmitting(false);
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 p-3 sm:p-5 backdrop-blur-xs">
      <div className="w-full max-w-4xl max-h-[92vh] flex flex-col rounded-2xl border border-border bg-card dark:bg-[#11131c] shadow-2xl overflow-hidden text-xs">
        {/* TOP HEADER */}
        <div className="flex items-center justify-between border-b border-border/60 bg-muted/40 dark:bg-[#161925] px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <Sparkles className="w-4 h-4 text-indigo-400" />
            <div>
              <h2 className="text-sm font-bold text-foreground">
                AI Audit &amp; Scoped Comparison Manager
              </h2>
              <p className="text-[11px] text-muted-foreground">
                Choose the exact Week, Month, Quarter, Year, or Calendar Day to review (with automatic 3-period lookback), or run a Scoped Comparison.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border/60 p-1.5 text-muted-foreground hover:text-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* BODY SCROLL AREA */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* 1. PRIMARY AUDIT MODE SWITCHER */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 rounded-xl bg-muted/50 dark:bg-background dark:bg-[#0b0d13] p-1.5 border border-border/70">
            <button
              type="button"
              onClick={() => setModeTab("period")}
              className={`flex items-center justify-center gap-2 rounded-lg py-2 px-3 font-semibold transition ${
                modeTab === "period"
                  ? "bg-indigo-600 text-white shadow"
                  : "text-foreground/80 dark:text-muted-foreground hover:text-foreground hover:bg-card/60"
              }`}
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>1. End-of-Period Review (Wk / Mo / Qtr / Yr)</span>
            </button>

            <button
              type="button"
              onClick={() => setModeTab("intra")}
              className={`flex items-center justify-center gap-2 rounded-lg py-2 px-3 font-semibold transition ${
                modeTab === "intra"
                  ? "bg-indigo-600 text-white shadow"
                  : "text-foreground/80 dark:text-muted-foreground hover:text-foreground hover:bg-card/60"
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>2. Intra-Period Check-In (Calendar Day)</span>
            </button>

            <button
              type="button"
              onClick={() => setModeTab("scoped")}
              className={`flex items-center justify-center gap-2 rounded-lg py-2 px-3 font-semibold transition ${
                modeTab === "scoped"
                  ? "bg-indigo-600 text-white shadow"
                  : "text-foreground/80 dark:text-muted-foreground hover:text-foreground hover:bg-card/60"
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>3. Scoped Audit &amp; Comparator</span>
            </button>
          </div>

          {/* ================================================================= */}
          {/* TAB 1: END-OF-PERIOD REVIEW (WEEK / MONTH / QUARTER / YEAR)       */}
          {/* ================================================================= */}
          {modeTab === "period" && (
            <div className="rounded-xl border border-border/70 bg-card dark:bg-[#161925]/70 p-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold text-foreground">
                  Step 1: Select Horizon &amp; Exact Target Period (Automatically Looks Back 3 Prior Periods)
                </span>
                <div className="flex items-center gap-1 rounded-lg bg-background dark:bg-[#0b0d13] p-1 border border-border/60">
                  {(["weekly", "monthly", "quarterly", "yearly"] as GoalHorizon[]).map((hz) => (
                    <button
                      key={hz}
                      type="button"
                      onClick={() => setHorizon(hz)}
                      className={`px-3 py-1 rounded-md font-semibold capitalize transition ${
                        horizon === hz
                          ? "bg-indigo-600 text-white"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {hz}
                    </button>
                  ))}
                </div>
              </div>

              {/* Explicit Period Dropdown with Full Date Ranges + Trade Counts */}
              {horizon === "weekly" && (
                <div className="space-y-2">
                  <label className="block text-[11px] font-semibold text-muted-foreground">
                    Choose Target Week to Review (Shows exact Monday–Sunday dates, trade count &amp; Net P&amp;L):
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={selectedWeekAnchor}
                      onChange={(e) => setSelectedWeekAnchor(e.target.value)}
                      className="h-9 flex-1 min-w-[280px] rounded-lg border border-border/70 bg-background dark:bg-[#0b0d13] px-3 text-xs font-semibold text-foreground outline-none focus:border-indigo-500"
                    >
                      {(periods.weeks || []).map((w: any) => (
                        <option key={w.anchorValue} value={w.anchorValue}>
                          {w.label} — {w.trades} {w.trades === 1 ? "trade" : "trades"} ({w.wins}W / {w.losses}L · ${w.netPnl.toFixed(2)})
                        </option>
                      ))}
                    </select>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-muted-foreground">Or pick any date in week:</span>
                      <DateInputDMY
                        value={selectedWeekAnchor}
                        onChange={(e) => {
                          if (e.target.value) setSelectedWeekAnchor(e.target.value);
                        }}
                        className="h-9 rounded-lg border border-border/70 bg-background dark:bg-[#0b0d13] px-2.5 text-xs text-foreground outline-none focus:border-indigo-500"
                      />
                    </div>
                  </div>
                </div>
              )}

              {horizon === "monthly" && (
                <div className="space-y-2">
                  <label className="block text-[11px] font-semibold text-muted-foreground">
                    Choose Target Calendar Month to Review (Compares against prior 3 Calendar Months M-1, M-2, M-3):
                  </label>
                  <select
                    value={selectedMonthAnchor}
                    onChange={(e) => setSelectedMonthAnchor(e.target.value)}
                    className="h-9 w-full rounded-lg border border-border/70 bg-background dark:bg-[#0b0d13] px-3 text-xs font-semibold text-foreground outline-none focus:border-indigo-500"
                  >
                    {(periods.months || []).map((m: any) => (
                      <option key={m.anchorValue} value={m.anchorValue}>
                        {m.label} — {m.trades} {m.trades === 1 ? "trade" : "trades"} ({m.wins}W / {m.losses}L · ${m.netPnl.toFixed(2)})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {horizon === "quarterly" && (
                <div className="space-y-2">
                  <label className="block text-[11px] font-semibold text-muted-foreground">
                    Choose Target Quarter to Review (Compares against prior 3 Quarters Q-1, Q-2, Q-3):
                  </label>
                  <select
                    value={selectedQuarterAnchor}
                    onChange={(e) => setSelectedQuarterAnchor(e.target.value)}
                    className="h-9 w-full rounded-lg border border-border/70 bg-background dark:bg-[#0b0d13] px-3 text-xs font-semibold text-foreground outline-none focus:border-indigo-500"
                  >
                    {(periods.quarters || []).map((q: any) => (
                      <option key={q.anchorValue} value={q.anchorValue}>
                        {q.label} — {q.trades} {q.trades === 1 ? "trade" : "trades"} ({q.wins}W / {q.losses}L · ${q.netPnl.toFixed(2)})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {horizon === "yearly" && (
                <div className="space-y-2">
                  <label className="block text-[11px] font-semibold text-muted-foreground">
                    Choose Target Year to Review:
                  </label>
                  <select
                    value={selectedYearAnchor}
                    onChange={(e) => setSelectedYearAnchor(e.target.value)}
                    className="h-9 w-full rounded-lg border border-border/70 bg-background dark:bg-[#0b0d13] px-3 text-xs font-semibold text-foreground outline-none focus:border-indigo-500"
                  >
                    {(periods.years || []).map((y: any) => (
                      <option key={y.anchorValue} value={y.anchorValue}>
                        {y.label} — {y.trades} {y.trades === 1 ? "trade" : "trades"} ({y.wins}W / {y.losses}L · ${y.netPnl.toFixed(2)})
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          {/* ================================================================= */}
          {/* TAB 2: INTRA-PERIOD CHECK-IN (PICK A DAY ON THE CALENDAR)         */}
          {/* ================================================================= */}
          {modeTab === "intra" && (
            <div className="rounded-xl border border-border/70 bg-card dark:bg-[#161925]/70 p-4 space-y-4">
              <div className="font-bold text-foreground">
                Pick Any Day on the Calendar for an Intra-Week, Intra-Month, Intra-Quarter, or Single-Day Check-In
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-[11px] font-semibold text-muted-foreground">
                    1. Choose Anchor Date on Calendar:
                  </label>
                  <DateInputDMY
                    value={calendarDay}
                    onChange={(e) => setCalendarDay(e.target.value)}
                    className="h-9 w-full rounded-lg border border-border/70 bg-background dark:bg-[#0b0d13] px-3 text-xs font-semibold text-foreground outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[11px] font-semibold text-muted-foreground">
                    2. Choose Intra-Period Review Type:
                  </label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {(
                      [
                        { id: "intraweek", label: "Intra-Week (WTD vs 3 Wks)" },
                        { id: "intramonth", label: "Intra-Month (MTD vs 3 Mos)" },
                        { id: "intraquarter", label: "Intra-Quarter (QTD vs 3 Qtrs)" },
                        { id: "single_day", label: "Single-Day Session Audit" },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setIntraType(opt.id)}
                        className={`rounded-lg border px-2.5 py-2 text-[11px] font-semibold transition ${
                          intraType === opt.id
                            ? "border-indigo-600 dark:border-indigo-500 bg-indigo-100 dark:bg-indigo-600/25 text-indigo-950 dark:text-indigo-200 font-bold shadow-xs"
                            : "border-border/70 bg-card dark:bg-background dark:bg-[#0b0d13] text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ================================================================= */}
          {/* TAB 3: SCOPED AUDIT & COMPARATOR (PERIODS / TRADES / EVENTS)      */}
          {/* ================================================================= */}
          {modeTab === "scoped" && (
            <div className="rounded-xl border border-border/70 bg-card dark:bg-[#161925]/70 p-4 space-y-4">
              <div className="flex flex-wrap items-center gap-2 border-b border-border/40 pb-3">
                <button
                  type="button"
                  onClick={() => setScopeSubMode("compare_periods")}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-semibold transition ${
                    scopeSubMode === "compare_periods"
                      ? "bg-indigo-600 text-white"
                      : "bg-background dark:bg-[#0b0d13] text-muted-foreground hover:text-foreground border border-border/60"
                  }`}
                >
                  <ArrowLeftRight className="w-3.5 h-3.5" />
                  <span>Compare Two Periods (Period A vs. Period B)</span>
                </button>

                <button
                  type="button"
                  onClick={() => setScopeSubMode("trade_lookback")}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-semibold transition ${
                    scopeSubMode === "trade_lookback"
                      ? "bg-indigo-600 text-white"
                      : "bg-background dark:bg-[#0b0d13] text-muted-foreground hover:text-foreground border border-border/60"
                  }`}
                >
                  <TrendingUp className="w-3.5 h-3.5" />
                  <span>Compare Specific Trades / Look Back N Trades</span>
                </button>

                <button
                  type="button"
                  onClick={() => setScopeSubMode("custom_event")}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-semibold transition ${
                    scopeSubMode === "custom_event"
                      ? "bg-indigo-600 text-white"
                      : "bg-background dark:bg-[#0b0d13] text-muted-foreground hover:text-foreground border border-border/60"
                  }`}
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>Audit Specific Event / Journals</span>
                </button>
              </div>

              {/* SUB-MODE A: COMPARE TWO PERIODS */}
              {scopeSubMode === "compare_periods" && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="block text-[11px] font-semibold text-indigo-300">
                      Period A (Primary / Target Period):
                    </label>
                    <select
                      value={comparePeriodA}
                      onChange={(e) => setComparePeriodA(e.target.value)}
                      className="h-9 w-full rounded-lg border border-border/70 bg-background dark:bg-[#0b0d13] px-3 text-xs text-foreground"
                    >
                      {allComparisonPeriodOptions.map((opt) => (
                        <option key={`pa-${opt.value}`} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-[11px] font-semibold text-emerald-300">
                      Period B (Baseline Comparison Period):
                    </label>
                    <select
                      value={comparePeriodB}
                      onChange={(e) => setComparePeriodB(e.target.value)}
                      className="h-9 w-full rounded-lg border border-border/70 bg-background dark:bg-[#0b0d13] px-3 text-xs text-foreground"
                    >
                      {allComparisonPeriodOptions.map((opt) => (
                        <option key={`pb-${opt.value}`} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {/* SUB-MODE B: TRADE LOOKBACK / SPECIFIC TRADES */}
              {scopeSubMode === "trade_lookback" && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setTradeLookbackMode("last_n")}
                      className={`rounded-lg px-3 py-1 font-semibold ${
                        tradeLookbackMode === "last_n"
                          ? "bg-secondary text-foreground border border-border"
                          : "text-muted-foreground"
                      }`}
                    >
                      Look Back Last N Trades
                    </button>
                    <button
                      type="button"
                      onClick={() => setTradeLookbackMode("manual")}
                      className={`rounded-lg px-3 py-1 font-semibold ${
                        tradeLookbackMode === "manual"
                          ? "bg-secondary text-foreground border border-border"
                          : "text-muted-foreground"
                      }`}
                    >
                      Hand-Pick Specific Trades ({selectedTradeKeys.length} selected)
                    </button>
                  </div>

                  {tradeLookbackMode === "last_n" ? (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-[10px] font-semibold uppercase text-muted-foreground mb-1">
                          Number of Trades to Look Back
                        </label>
                        <select
                          value={tradeLookbackCount}
                          onChange={(e) => setTradeLookbackCount(Number(e.target.value))}
                          className="h-8 w-full rounded-lg border border-border/70 bg-background dark:bg-[#0b0d13] px-2.5 text-xs text-foreground"
                        >
                          {[3, 5, 7, 10, 15, 20, 30, 50].map((n) => (
                            <option key={n} value={n}>
                              Last {n} Trades
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-[10px] font-semibold uppercase text-muted-foreground mb-1">
                          Filter by Symbol
                        </label>
                        <select
                          value={tradeFilterSymbol}
                          onChange={(e) => setTradeFilterSymbol(e.target.value)}
                          className="h-8 w-full rounded-lg border border-border/70 bg-background dark:bg-[#0b0d13] px-2.5 text-xs text-foreground"
                        >
                          <option value="ALL">All Symbols</option>
                          {uniqueSymbols.map((sym) => (
                            <option key={sym} value={sym}>
                              {sym}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-[10px] font-semibold uppercase text-muted-foreground mb-1">
                          Filter by Outcome
                        </label>
                        <select
                          value={tradeFilterOutcome}
                          onChange={(e) => setTradeFilterOutcome(e.target.value as any)}
                          className="h-8 w-full rounded-lg border border-border/70 bg-background dark:bg-[#0b0d13] px-2.5 text-xs text-foreground"
                        >
                          <option value="all">All Outcomes (Wins &amp; Losses)</option>
                          <option value="losses">Losing Trades Only</option>
                          <option value="wins">Winning Trades Only</option>
                        </select>
                      </div>
                    </div>
                  ) : (
                    <div className="max-h-48 overflow-y-auto rounded-lg border border-border/60 bg-background dark:bg-[#0b0d13] p-2 space-y-1">
                      {selectableTrades.map((t: any) => {
                        const checked = selectedTradeKeys.includes(t.key);
                        return (
                          <label
                            key={t.key}
                            className="flex items-center justify-between gap-2 rounded px-2 py-1.5 hover:bg-secondary/40 cursor-pointer"
                          >
                            <div className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() =>
                                  setSelectedTradeKeys((prev) =>
                                    checked ? prev.filter((k) => k !== t.key) : [...prev, t.key]
                                  )
                                }
                              />
                              <span className="font-mono font-semibold text-foreground">
                                {String(t.openedAt).slice(0, 10)}
                              </span>
                              <span className="px-1.5 py-0.5 rounded bg-secondary text-[10px] font-bold">
                                {t.symbol} {String(t.direction).toUpperCase()}
                              </span>
                            </div>
                            <span
                              className={`font-mono font-bold ${
                                Number(t.netPnl) >= 0 ? "text-emerald-400" : "text-rose-400"
                              }`}
                            >
                              ${Number(t.netPnl).toFixed(2)} ({t.accountRiskPct}% Risk)
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* SUB-MODE C: SPECIFIC EVENT / JOURNALS */}
              {scopeSubMode === "custom_event" && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-muted-foreground">
                      Select Specific Written Journals to Audit ({selectedJournalSlugs.length} selected):
                    </span>
                    <div className="flex items-center gap-1">
                      {["all", "week", "month", "day", "quarter"].map((pf) => (
                        <button
                          key={pf}
                          type="button"
                          onClick={() => setJournalPeriodFilter(pf)}
                          className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold ${
                            journalPeriodFilter === pf
                              ? "bg-indigo-600 text-white"
                              : "bg-background dark:bg-[#0b0d13] text-muted-foreground"
                          }`}
                        >
                          {pf}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="max-h-44 overflow-y-auto rounded-lg border border-border/60 bg-background dark:bg-[#0b0d13] p-2 space-y-1">
                    {selectableJournals
                      .filter(
                        (j: any) =>
                          !j.isTemplateOnly &&
                          (journalPeriodFilter === "all" || j.periodType === journalPeriodFilter)
                      )
                      .map((j: any) => {
                        const checked = selectedJournalSlugs.includes(j.slug);
                        return (
                          <label
                            key={j.slug}
                            className="flex items-center justify-between gap-2 rounded px-2 py-1.5 hover:bg-secondary/40 cursor-pointer"
                          >
                            <div className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() =>
                                  setSelectedJournalSlugs((prev) =>
                                    checked ? prev.filter((s) => s !== j.slug) : [...prev, j.slug]
                                  )
                                }
                              />
                              <span className="font-semibold text-foreground">
                                {j.humanLabel || j.title}
                              </span>
                              <span className="text-[10px] text-muted-foreground">
                                ({j.startDate} to {j.endDate})
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5 text-[10px]">
                              {j.hasPrep && (
                                <span className="rounded bg-indigo-500/20 text-indigo-300 px-1.5 py-0.5">
                                  Prep ({j.prepCharLen}c)
                                </span>
                              )}
                              {j.hasReview && (
                                <span className="rounded bg-emerald-500/20 text-emerald-300 px-1.5 py-0.5">
                                  Review ({j.reviewCharLen}c)
                                </span>
                              )}
                            </div>
                          </label>
                        );
                      })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ================================================================= */}
          {/* LIVE SERVER-VERIFIED 4-PERIOD LOOKBACK PREVIEW TABLE              */}
          {/* ================================================================= */}
          <div className="rounded-xl border border-indigo-500/30 bg-muted/30 dark:bg-background dark:bg-[#0b0d13] p-4 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span className="font-bold text-foreground">
                  Live SQLite Data Verification Preview (Exact Data That Will Be Fed to AI)
                </span>
              </div>
              {loadingPreview ? (
                <span className="text-[11px] text-muted-foreground">Verifying SQLite window...</span>
              ) : (
                <span className="text-[11px] text-indigo-300 font-semibold">
                  {previewData?.matchedJournalsCount ?? 0} substantive written journals matched in window
                </span>
              )}
            </div>

            {previewData?.buckets && previewData.buckets.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[11px] border-collapse">
                  <thead>
                    <tr className="border-b border-border/50 text-muted-foreground">
                      <th className="py-1.5 px-2">Period Bucket</th>
                      <th className="py-1.5 px-2">Exact Date Range</th>
                      <th className="py-1.5 px-2 text-right">Trades</th>
                      <th className="py-1.5 px-2 text-right">W / L</th>
                      <th className="py-1.5 px-2 text-right">Win Rate</th>
                      <th className="py-1.5 px-2 text-right">Net P&amp;L</th>
                      <th className="py-1.5 px-2 text-right">Avg Risk %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewData.buckets.map((b: any, i: number) => (
                      <tr
                        key={b.periodKey + i}
                        className={`border-b border-border/20 ${
                          i === 0 ? "bg-indigo-100/70 dark:bg-indigo-500/15 font-bold text-indigo-950 dark:text-foreground" : "text-muted-foreground"
                        }`}
                      >
                        <td className="py-1.5 px-2">{b.periodLabel}</td>
                        <td className="py-1.5 px-2 font-mono">{b.dateRange}</td>
                        <td className="py-1.5 px-2 text-right font-mono">{b.trades}</td>
                        <td className="py-1.5 px-2 text-right font-mono">
                          {b.wins}W / {b.losses}L
                        </td>
                        <td className="py-1.5 px-2 text-right font-mono">{b.winRatePct}%</td>
                        <td
                          className={`py-1.5 px-2 text-right font-mono font-bold ${
                            b.netPnl > 0
                              ? "text-emerald-400"
                              : b.netPnl < 0
                              ? "text-rose-400"
                              : "text-muted-foreground"
                          }`}
                        >
                          ${Number(b.netPnl).toFixed(2)}
                        </td>
                        <td className="py-1.5 px-2 text-right font-mono">{b.avgAccountRiskPct}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {previewData?.targetTradeDates && (
              <div className="text-[11px] text-muted-foreground pt-1">
                <strong>Verified Trade Dates in Target Period:</strong>{" "}
                {previewData.targetTradeDates.length > 0
                  ? previewData.targetTradeDates.join(", ")
                  : "None (0 trades executed in Target Period)"}
              </div>
            )}
          </div>

          {/* CUSTOM FOCUS PROMPT & THINKING / AUTO-STOP SETTINGS */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
            <div className="lg:col-span-7 space-y-1.5">
              <label className="block text-[11px] font-semibold text-muted-foreground">
                Optional Specific Event / Focus Instruction for This Audit:
              </label>
              <textarea
                rows={2}
                value={customFocusPrompt}
                onChange={(e) => setCustomFocusPrompt(e.target.value)}
                placeholder="e.g., Focus on my Oct 5 Gold 3-trade cluster vs Oct 8, or compare my pre-Korea vs post-Korea execution..."
                className="w-full rounded-lg border border-border/70 bg-background dark:bg-[#0b0d13] px-3 py-2 text-xs text-foreground outline-none focus:border-indigo-500"
              />
            </div>

            <div className="lg:col-span-5 space-y-2.5 rounded-xl border border-border/70 bg-card dark:bg-[#161925]/60 p-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-muted-foreground">
                  Reasoning Depth:
                </span>
                <div className="flex items-center gap-1">
                  {(["fast", "balanced", "deep"] as const).map((tm) => (
                    <button
                      key={tm}
                      type="button"
                      onClick={() => setThinkingMode(tm)}
                      className={`px-2.5 py-1 rounded text-[11px] font-semibold capitalize ${
                        thinkingMode === tm
                          ? "bg-indigo-600 text-white"
                          : "bg-background dark:bg-[#0b0d13] text-muted-foreground"
                      }`}
                    >
                      {tm}
                    </button>
                  ))}
                </div>
              </div>

              <label className="flex items-center justify-between gap-2 cursor-pointer pt-1 border-t border-border/40">
                <span className="flex items-center gap-1.5 text-[11px] text-amber-950 dark:text-amber-200 font-semibold">
                  <Power className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                  <span>Auto-stop Desktop GPU Server when queue finishes</span>
                </span>
                <input
                  type="checkbox"
                  checked={stopServerAfterQueue}
                  onChange={(e) => setStopServerAfterQueue(e.target.checked)}
                />
              </label>
            </div>
          </div>
        </div>

        {/* FOOTER ACTIONS */}
        <div className="flex items-center justify-between border-t border-border/60 bg-muted/40 dark:bg-[#161925] px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border/60 px-4 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={() => void handleTriggerAudit()}
            disabled={submitting}
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-5 py-2 text-xs font-bold text-white shadow-lg transition disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5" />
            <span>
              {submitting
                ? "Starting Audit..."
                : modeTab === "period"
                ? `Run ${horizon.toUpperCase()} Audit (${activeTargetAnchor || "Selected"})`
                : modeTab === "intra"
                ? `Run ${intraType.toUpperCase()} Check-In (${calendarDay})`
                : "Run Scoped Comparison Audit"}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
