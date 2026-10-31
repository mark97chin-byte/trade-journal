"use client";
import { DatePicker } from "@/components/ui/date-picker";
import { OptionSelect } from "@/components/ui/option-select";
import { Checkbox } from "@/components/ui/checkbox";
import { HoverHint } from "@/components/ui/tooltip";
import React, { Suspense, useState, useEffect, useCallback } from "react";
import { FilterBar } from "@/components/filter-bar";
import { Field, fieldClass } from "@/components/filter-fields";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ReviewExport } from "@/components/review-export";
import { Markdown } from "@/components/rich-editor";
import { useApi, postJson } from "@/lib/use-api";
import { scheduledRules, progressScore, type Routine, type RoutineCheck } from "@/lib/progress";
import {
  Sparkles,
  Target,
  Brain,
  CheckCircle2,
  AlertTriangle,
  Plus,
  Trash2,
  Send,
  Cpu,
  ChevronDown,
  ChevronRight,
  RefreshCw,
} from "lucide-react";

const STAGES = ["Before trading", "During trading", "After trading"];

type GoalHorizon = "weekly" | "monthly" | "quarterly";
type GoalStatus = "on_track" | "slipping" | "breached" | "completed";

interface TraderGoal {
  id: string;
  horizon: GoalHorizon;
  periodLabel: string;
  title: string;
  whyItMatters: string;
  targetMetric: string;
  status: GoalStatus;
  progressPct: number;
  aiAccountabilityNote: string;
  updatedAt: string;
}

interface AiCoachReport {
  id: string;
  horizon: GoalHorizon;
  periodKey: string;
  title: string;
  summaryMd: string;
  reasoningTrace: string;
  telemetry: any;
  suggestedGoals: Array<{
    horizon: GoalHorizon;
    periodLabel: string;
    title: string;
    whyItMatters: string;
    targetMetric: string;
  }>;
  modelUsed: string;
  createdAt: string;
}

const STATUS_BADGE: Record<GoalStatus, { label: string; cls: string }> = {
  on_track: {
    label: "On Track",
    cls: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
  },
  slipping: {
    label: "Slipping — Needs Focus",
    cls: "border-amber-500/40 bg-amber-500/15 text-amber-300",
  },
  breached: {
    label: "Rule Breached",
    cls: "border-rose-500/40 bg-rose-500/15 text-rose-300",
  },
  completed: {
    label: "Completed ✓",
    cls: "border-indigo-500/40 bg-indigo-500/15 text-indigo-300",
  },
};

export default function ProgressPage() {
  return (
    <Suspense>
      <Progress />
    </Suspense>
  );
}

function Progress() {
  const { data, error, refresh } = useApi<{
    rules: Routine[];
    checks: RoutineCheck[];
    today: string;
  }>("/api/workspace/progress");

  const [date, setDate] = useState(""),
    [open, setOpen] = useState(false),
    [title, setTitle] = useState(""),
    [stage, setStage] = useState(STAGES[0]!),
    [weekdays, setWeekdays] = useState([1, 2, 3, 4, 5]),
    [failure, setFailure] = useState(""),
    [busy, setBusy] = useState(false);

  // Longitudinal AI Coach & Multi-Horizon Goal State
  const [coachData, setCoachData] = useState<{
    kobold: { enabled: boolean; baseUrl: string; online: boolean; modelName: string };
    telemetry: any;
    goals: TraderGoal[];
    reports: AiCoachReport[];
  } | null>(null);
  const [coachLoading, setCoachLoading] = useState(false);
  const [generatingHorizon, setGeneratingHorizon] = useState<GoalHorizon | null>(null);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [showReasoning, setShowReasoning] = useState(false);
  const [koboldUrlInput, setKoboldUrlInput] = useState("http://100.75.201.34:5001");
  const [configOpen, setConfigOpen] = useState(false);

  // Goal Modal State
  const [goalModalOpen, setGoalModalOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Partial<TraderGoal>>({
    horizon: "weekly",
    periodLabel: "This Week",
    title: "",
    whyItMatters: "",
    targetMetric: "",
    status: "on_track",
    progressPct: 50,
  });

  // Interactive Coach Chat State
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatHistory, setChatHistory] = useState<
    Array<{ role: "user" | "coach"; text: string; reasoning?: string }>
  >([]);

  const fetchCoachData = useCallback(async () => {
    setCoachLoading(true);
    try {
      const res = await fetch("/api/ai/coach");
      const json = await res.json();
      if (json.ok) {
        setCoachData(json);
        if (json.kobold?.baseUrl) setKoboldUrlInput(json.kobold.baseUrl);
        if (json.reports?.length > 0 && !selectedReportId) {
          setSelectedReportId(json.reports[0].id);
        }
      }
    } catch {} finally {
      setCoachLoading(false);
    }
  }, [selectedReportId]);

  useEffect(() => {
    void fetchCoachData();
  }, [fetchCoachData]);

  const selected = date || data?.today || "",
    rules = data ? scheduledRules(data.rules, selected) : [],
    score = data ? progressScore(data.rules, data.checks, selected) : null;

  const days = data
    ? Array.from({ length: 91 }, (_, i) => {
        const d = new Date(`${data.today}T12:00:00Z`);
        d.setUTCDate(d.getUTCDate() - 90 + i);
        const key = d.toISOString().slice(0, 10);
        return { date: key, ...progressScore(data.rules, data.checks, key) };
      })
    : [];

  async function act(body: unknown, method: "POST" | "DELETE" = "POST") {
    setBusy(true);
    try {
      await postJson("/api/workspace/progress", body, method);
      setFailure("");
      refresh();
      return true;
    } catch (e) {
      setFailure(e instanceof Error ? e.message : "Could not save.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const handleGenerateAudit = async (horizon: GoalHorizon) => {
    setGeneratingHorizon(horizon);
    setFailure("");
    try {
      const res = await fetch("/api/ai/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate_report", horizon }),
      });
      const json = await res.json();
      if (!json.ok) {
        setFailure(json.error || "Failed to generate longitudinal AI report.");
      } else {
        await fetchCoachData();
        if (json.reportId) setSelectedReportId(json.reportId);
      }
    } catch (err: any) {
      setFailure(err?.message || "Failed to connect to KoboldCpp.");
    } finally {
      setGeneratingHorizon(null);
    }
  };

  const handleUpsertGoal = async (goalPayload: Partial<TraderGoal>) => {
    try {
      const res = await fetch("/api/ai/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "upsert_goal", ...goalPayload }),
      });
      const json = await res.json();
      if (json.ok) {
        setGoalModalOpen(false);
        await fetchCoachData();
      }
    } catch {}
  };

  const handleDeleteGoal = async (id: string) => {
    try {
      await fetch("/api/ai/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_goal", id }),
      });
      await fetchCoachData();
    } catch {}
  };

  const handleSendCoachChat = async () => {
    const msg = chatInput.trim();
    if (!msg || chatBusy) return;
    setChatInput("");
    setChatHistory((prev) => [...prev, { role: "user", text: msg }]);
    setChatBusy(true);
    try {
      const res = await fetch("/api/ai/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "chat_coach", message: msg }),
      });
      const json = await res.json();
      if (json.ok) {
        setChatHistory((prev) => [
          ...prev,
          { role: "coach", text: json.reply, reasoning: json.reasoning },
        ]);
      } else {
        setChatHistory((prev) => [
          ...prev,
          { role: "coach", text: `Error: ${json.error || "Could not reach KoboldCpp."}` },
        ]);
      }
    } catch (e: any) {
      setChatHistory((prev) => [
        ...prev,
        { role: "coach", text: `Connection error: ${e?.message}` },
      ]);
    } finally {
      setChatBusy(false);
    }
  };

  const activeReport =
    coachData?.reports.find((r) => r.id === selectedReportId) ||
    coachData?.reports[0] ||
    null;

  const tel = coachData?.telemetry;

  return (
    <div>
      <FilterBar
        title="Progress, Goals & AI Accountability Coach"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setEditingGoal({
                  horizon: "weekly",
                  periodLabel: "This Week",
                  title: "",
                  whyItMatters: "",
                  targetMetric: "",
                  status: "on_track",
                  progressPct: 0,
                });
                setGoalModalOpen(true);
              }}
            >
              <Target className="mr-1.5 h-3.5 w-3.5 text-indigo-400" />
              Add Goal
            </Button>
            <Button size="sm" onClick={() => setOpen(true)}>
              <Plus className="mr-1 h-3.5 w-3.5" />
              Add Routine
            </Button>
          </div>
        }
      />

      <div className="space-y-6 p-4">
        {(error || failure) && (
          <p role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
            {error || failure}
          </p>
        )}

        {/* 1. KOBOLDCPP DESKTOP AI STATUS & LONGITUDINAL AUDIT BAR */}
        <Card className="border-indigo-500/30 bg-[#12141d]">
          <CardContent className="py-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/15 border border-indigo-500/30">
                  <Brain className="h-5 w-5 text-indigo-400" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-bold text-foreground">
                      Longitudinal AI Behavioral Coach (KoboldCpp)
                    </h2>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                        coachData?.kobold?.online
                          ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                          : "border-amber-500/40 bg-amber-500/15 text-amber-300"
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          coachData?.kobold?.online ? "bg-emerald-400" : "bg-amber-400"
                        }`}
                      />
                      {coachData?.kobold?.online
                        ? `Online · ${coachData.kobold.modelName}`
                        : `Desktop Offline (${coachData?.kobold?.baseUrl || "100.75.201.34:5001"})`}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Synthesizes your Daily/Weekly/Monthly reviews, reflection quotes, and execution telemetry to track behavioral improvement over time.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {(["weekly", "monthly", "quarterly"] as GoalHorizon[]).map((h) => (
                  <Button
                    key={h}
                    size="sm"
                    variant={h === "weekly" ? "default" : "outline"}
                    disabled={generatingHorizon !== null}
                    onClick={() => void handleGenerateAudit(h)}
                    className="text-xs capitalize"
                  >
                    <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                    {generatingHorizon === h
                      ? `Running ${h} Deep Audit...`
                      : `Run ${h} Audit`}
                  </Button>
                ))}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfigOpen((v) => !v)}
                  title="Configure Desktop KoboldCpp Tailscale Endpoint"
                >
                  <Cpu className="h-4 w-4 text-muted-foreground" />
                </Button>
              </div>
            </div>

            {configOpen && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-[#0d0f14] p-3 text-xs">
                <div className="flex flex-wrap items-center gap-2 flex-1">
                  <span className="font-semibold text-foreground">
                    Desktop KoboldCpp Tailscale URL:
                  </span>
                  <input
                    type="text"
                    value={koboldUrlInput}
                    onChange={(e) => setKoboldUrlInput(e.target.value)}
                    placeholder="http://100.75.201.34:5001"
                    className="h-8 w-64 rounded-lg border border-border/70 bg-[#141722] px-2.5 text-xs text-foreground outline-none focus:border-indigo-500"
                  />
                  <Button
                    size="sm"
                    onClick={async () => {
                      await fetch("/api/ai/coach", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          action: "save_kobold_config",
                          baseUrl: koboldUrlInput,
                          enabled: true,
                        }),
                      });
                      await fetchCoachData();
                    }}
                  >
                    Save &amp; Test Connection
                  </Button>
                </div>
                <span className="text-[11px] text-muted-foreground">
                  Overnight Cron: Runs automatically at 3:15 AM when desktop is on.
                </span>
              </div>
            )}

            {/* BEHAVIORAL TELEMETRY STRIP (MODEL-AGNOSTIC TENDENCIES) */}
            {tel && (
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-2 border-t border-border/40 text-xs">
                <div className="rounded-lg border border-border/40 bg-[#0d0f14] px-3 py-2">
                  <div className="text-[10px] text-muted-foreground">
                    Revenge Entries (&lt;20m post-loss)
                  </div>
                  <div
                    className={`font-bold text-sm mt-0.5 ${
                      tel.revengeTradesCount > 0 ? "text-amber-400" : "text-emerald-400"
                    }`}
                  >
                    {tel.revengeTradesCount} trades (${tel.revengeNetPnl})
                  </div>
                </div>
                <div className="rounded-lg border border-border/40 bg-[#0d0f14] px-3 py-2">
                  <div className="text-[10px] text-muted-foreground">
                    Profit Giveback Days
                  </div>
                  <div className="font-bold text-sm text-foreground mt-0.5">
                    {tel.profitGivebackDays?.length || 0} sessions
                  </div>
                </div>
                <div className="rounded-lg border border-border/40 bg-[#0d0f14] px-3 py-2">
                  <div className="text-[10px] text-muted-foreground">
                    Post-Loss Size Expansion
                  </div>
                  <div className="font-bold text-sm text-foreground mt-0.5">
                    {tel.postLossSizeExpansionCount} occurrences
                  </div>
                </div>
                <div className="rounded-lg border border-border/40 bg-[#0d0f14] px-3 py-2">
                  <div className="text-[10px] text-muted-foreground">
                    Missed Setups (Hesitation)
                  </div>
                  <div className="font-bold text-sm text-foreground mt-0.5">
                    {tel.missedTradesCount} (${tel.missedOpportunityPnl})
                  </div>
                </div>
                <div className="rounded-lg border border-border/40 bg-[#0d0f14] px-3 py-2">
                  <div className="text-[10px] text-muted-foreground">
                    Top Recorded Mistake
                  </div>
                  <div className="font-bold text-sm text-foreground truncate mt-0.5">
                    {tel.topMistakes?.[0]?.[0]
                      ? `${tel.topMistakes[0][0]} (${tel.topMistakes[0][1]}x)`
                      : "None tagged"}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 2. MULTI-HORIZON GOALS & ACCOUNTABILITY BOARD (WEEKLY / MONTHLY / QUARTERLY) */}
        <div className="grid gap-4 xl:grid-cols-3">
          {(
            [
              {
                key: "weekly" as const,
                title: "Weekly Process Goals",
                sub: "Immediate session execution & emotional triggers",
              },
              {
                key: "monthly" as const,
                title: "Monthly Habit Targets",
                sub: "Recurring behavioral patterns & routine consistency",
              },
              {
                key: "quarterly" as const,
                title: "Quarterly Evolution Milestones",
                sub: "Macro discipline, drawdown control & edge maturity",
              },
            ] as const
          ).map((col) => {
            const colGoals = (coachData?.goals || []).filter(
              (g) => g.horizon === col.key
            );
            return (
              <Card key={col.key} className="bg-[#12141d] border-border/70">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-sm font-bold flex items-center gap-2">
                        <Target className="h-4 w-4 text-indigo-400" />
                        <span>{col.title}</span>
                      </CardTitle>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {col.sub}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingGoal({
                          horizon: col.key,
                          periodLabel:
                            col.key === "weekly"
                              ? "This Week"
                              : col.key === "monthly"
                              ? "This Month"
                              : "This Quarter",
                          title: "",
                          whyItMatters: "",
                          targetMetric: "",
                          status: "on_track",
                          progressPct: 0,
                        });
                        setGoalModalOpen(true);
                      }}
                      className="rounded-lg border border-border/60 bg-secondary/50 hover:bg-secondary px-2 py-1 text-[11px] font-semibold text-foreground"
                    >
                      + Add
                    </button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2.5">
                  {colGoals.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border/50 p-4 text-center text-xs text-muted-foreground">
                      No {col.key} goals active yet. Run an AI Audit to generate data-backed recommendations or click + Add.
                    </div>
                  ) : (
                    colGoals.map((g) => {
                      const badge = STATUS_BADGE[g.status] || STATUS_BADGE.on_track;
                      return (
                        <div
                          key={g.id}
                          className="rounded-xl border border-border/60 bg-[#0d0f14] p-3 space-y-2 text-xs"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                {g.periodLabel}
                              </span>
                              <h4 className="font-bold text-foreground leading-snug">
                                {g.title}
                              </h4>
                            </div>
                            <span
                              className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${badge.cls}`}
                            >
                              {badge.label}
                            </span>
                          </div>

                          {g.targetMetric && (
                            <div className="text-[11px] text-indigo-300 font-medium">
                              Rule / Metric: {g.targetMetric}
                            </div>
                          )}
                          {g.whyItMatters && (
                            <div className="text-[11px] text-muted-foreground">
                              Addresses: {g.whyItMatters}
                            </div>
                          )}

                          {g.aiAccountabilityNote && (
                            <div className="rounded-lg border border-indigo-500/25 bg-indigo-950/20 px-2.5 py-1.5 text-[11px] text-indigo-200">
                              <strong className="text-indigo-400">AI Audit:</strong>{" "}
                              {g.aiAccountabilityNote}
                            </div>
                          )}

                          <div className="flex items-center justify-between pt-1 border-t border-border/30">
                            <div className="flex items-center gap-1">
                              {(
                                ["on_track", "slipping", "breached", "completed"] as GoalStatus[]
                              ).map((st) => (
                                <button
                                  key={st}
                                  type="button"
                                  onClick={() =>
                                    void handleUpsertGoal({ ...g, status: st })
                                  }
                                  className={`rounded px-1.5 py-0.5 text-[10px] capitalize transition ${
                                    g.status === st
                                      ? "bg-secondary text-foreground font-bold border border-border"
                                      : "text-muted-foreground hover:text-foreground"
                                  }`}
                                >
                                  {st.replace("_", " ")}
                                </button>
                              ))}
                            </div>
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingGoal(g);
                                  setGoalModalOpen(true);
                                }}
                                className="text-[11px] text-muted-foreground hover:text-foreground underline"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleDeleteGoal(g.id)}
                                className="text-rose-400/70 hover:text-rose-400"
                                title="Delete goal"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* 3. LONGITUDINAL AI REPORT VIEWER + INTERACTIVE ACCOUNTABILITY PARTNER CHAT */}
        <div className="grid gap-4 lg:grid-cols-12">
          {/* Left 7 Cols: Longitudinal Report & Suggested Goals */}
          <Card className="lg:col-span-7 bg-[#12141d] border-border/70">
            <CardHeader className="pb-3 border-b border-border/40">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-amber-400" />
                  <span>Longitudinal Review Synthesis &amp; Behavioral Reports</span>
                </CardTitle>
                {coachData?.reports && coachData.reports.length > 0 && (
                  <select
                    value={activeReport?.id || ""}
                    onChange={(e) => setSelectedReportId(e.target.value)}
                    className="h-8 rounded-lg border border-border/70 bg-[#0d0f14] px-2.5 text-xs text-foreground outline-none"
                  >
                    {coachData.reports.map((r) => (
                      <option key={r.id} value={r.id}>
                        [{r.horizon.toUpperCase()}] {r.title} ({r.createdAt.slice(0, 10)})
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </CardHeader>
            <CardContent className="pt-4 space-y-4">
              {!activeReport ? (
                <div className="rounded-xl border border-dashed border-border/50 p-8 text-center space-y-2">
                  <p className="text-sm font-semibold text-foreground">
                    No Longitudinal AI Reports Generated Yet
                  </p>
                  <p className="text-xs text-muted-foreground max-w-md mx-auto">
                    Click &ldquo;Run Weekly Audit&rdquo;, &ldquo;Run Monthly Audit&rdquo;, or &ldquo;Run Quarterly Audit&rdquo; above to have your desktop AI analyze your journals, reflection quotes, and tendencies.
                  </p>
                </div>
              ) : (
                <>
                  {/* Collapsible DeepSeek / Qwen <think> Chain-of-Thought Trace */}
                  {activeReport.reasoningTrace && (
                    <div className="rounded-xl border border-indigo-500/30 bg-[#0d0f14] overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setShowReasoning((v) => !v)}
                        className="flex w-full items-center justify-between px-3 py-2 text-xs font-semibold text-indigo-300 hover:bg-indigo-500/10 transition"
                      >
                        <span className="flex items-center gap-1.5">
                          {showReasoning ? (
                            <ChevronDown className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5" />
                          )}
                          <span>
                            🧠 View AI Chain-of-Thought Reasoning Trace ({activeReport.modelUsed})
                          </span>
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {showReasoning ? "Hide" : "Expand"}
                        </span>
                      </button>
                      {showReasoning && (
                        <pre className="max-h-72 overflow-y-auto border-t border-indigo-500/20 p-3 text-[11px] font-mono whitespace-pre-wrap text-muted-foreground leading-relaxed">
                          {activeReport.reasoningTrace}
                        </pre>
                      )}
                    </div>
                  )}

                  {/* Rendered Report Body */}
                  <div className="rounded-xl border border-border/50 bg-[#0d0f14] p-4 max-h-[540px] overflow-y-auto">
                    <Markdown value={activeReport.summaryMd} />
                  </div>

                  {/* 1-Click AI Suggested Goals from this Report */}
                  {activeReport.suggestedGoals &&
                    activeReport.suggestedGoals.length > 0 && (
                      <div className="space-y-2 pt-2 border-t border-border/40">
                        <div className="text-xs font-bold text-foreground">
                          AI-Proposed Goals from This Audit (Click to Adopt into Your Goal Board):
                        </div>
                        <div className="grid gap-2 sm:grid-cols-3">
                          {activeReport.suggestedGoals.map((sg, idx) => (
                            <div
                              key={idx}
                              className="rounded-xl border border-indigo-500/30 bg-indigo-950/15 p-2.5 flex flex-col justify-between gap-2 text-xs"
                            >
                              <div className="space-y-1">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-400">
                                  {sg.horizon} · {sg.periodLabel}
                                </span>
                                <div className="font-bold text-foreground">
                                  {sg.title}
                                </div>
                                <div className="text-[11px] text-muted-foreground">
                                  {sg.targetMetric}
                                </div>
                              </div>
                              <Button
                                size="sm"
                                variant="outline"
                                className="w-full h-7 text-[11px]"
                                onClick={() =>
                                  void handleUpsertGoal({
                                    horizon: sg.horizon || "weekly",
                                    periodLabel: sg.periodLabel || "Upcoming",
                                    title: sg.title,
                                    whyItMatters: sg.whyItMatters || "",
                                    targetMetric: sg.targetMetric || "",
                                    status: "on_track",
                                    progressPct: 0,
                                  })
                                }
                              >
                                + Adopt {sg.horizon} Goal
                              </Button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                </>
              )}
            </CardContent>
          </Card>

          {/* Right 5 Cols: Interactive Accountability Partner Chat */}
          <Card className="lg:col-span-5 bg-[#12141d] border-border/70 flex flex-col">
            <CardHeader className="pb-3 border-b border-border/40">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Brain className="h-4 w-4 text-emerald-400" />
                <span>Collaborate with Your Accountability Coach</span>
              </CardTitle>
              <p className="text-[11px] text-muted-foreground">
                Co-design goals, ask what recurring triggers show up in your reviews, or test a new daily routine.
              </p>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col justify-between pt-4 gap-3">
              <div className="flex-1 min-h-[280px] max-h-[440px] overflow-y-auto space-y-3 rounded-xl border border-border/50 bg-[#0d0f14] p-3 text-xs">
                {chatHistory.length === 0 ? (
                  <div className="space-y-2 text-muted-foreground">
                    <p>Try asking your coach:</p>
                    {[
                      "What recurring emotional trigger shows up across my recent journal reviews?",
                      "Help me set realistic Weekly and Monthly goals based on my biggest leak.",
                      "Where did I deviate from my process most this month compared to last month?",
                    ].map((q) => (
                      <button
                        key={q}
                        type="button"
                        onClick={() => setChatInput(q)}
                        className="block w-full rounded-lg border border-border/50 bg-[#141722] px-2.5 py-1.5 text-left text-[11px] text-foreground hover:border-indigo-500/50 transition"
                      >
                        &ldquo;{q}&rdquo;
                      </button>
                    ))}
                  </div>
                ) : (
                  chatHistory.map((m, idx) => (
                    <div
                      key={idx}
                      className={`rounded-xl p-2.5 ${
                        m.role === "user"
                          ? "bg-indigo-600/20 border border-indigo-500/30 text-foreground ml-6"
                          : "bg-secondary/50 border border-border/60 text-foreground mr-2"
                      }`}
                    >
                      <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
                        {m.role === "user" ? "You" : "AI Accountability Coach"}
                      </div>
                      <Markdown value={m.text} />
                    </div>
                  ))
                )}
                {chatBusy && (
                  <div className="text-xs text-indigo-300 animate-pulse px-2">
                    Coach is thinking across your journals &amp; goals...
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void handleSendCoachChat();
                    }
                  }}
                  placeholder="Ask your coach or co-design a goal..."
                  className="h-9 flex-1 rounded-lg border border-border/70 bg-[#0d0f14] px-3 text-xs text-foreground outline-none focus:border-indigo-500"
                />
                <Button
                  size="sm"
                  disabled={chatBusy || !chatInput.trim()}
                  onClick={() => void handleSendCoachChat()}
                >
                  <Send className="h-3.5 w-3.5" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* 4. DAILY EXECUTION ROUTINES & 13-WEEK CONSISTENCY HEATMAP */}
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-6 py-6">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <div>
                <p className="text-xs text-muted-foreground">Daily routine completion</p>
                <p className="text-4xl font-semibold">
                  {score?.score == null ? "-" : `${Math.round(score.score * 100)}%`}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {score?.completed ?? 0} of {score?.total ?? 0} scheduled routines
                </p>
              </div>
              <Field label="Review date">
                <DatePicker
                  label="Progress date"
                  value={selected}
                  max={data?.today}
                  onValueChange={setDate}
                />
              </Field>
            </div>
            <ReviewExport
              document={{
                title: `Routine review · ${selected}`,
                lines: [
                  `Completed: ${score?.completed ?? 0}/${score?.total ?? 0}`,
                  ...rules.map(
                    (r) =>
                      `${data?.checks.some((c) => c.date === selected && c.ruleId === r.id && c.done) ? "[done]" : "[ ]"} ${r.stage}: ${r.title}`
                  ),
                ],
              }}
            />
          </CardContent>
        </Card>

        <div className="grid gap-4 xl:grid-cols-3">
          {STAGES.map((s) => (
            <Card key={s}>
              <CardHeader>
                <CardTitle>{s}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {rules
                  .filter((r) => r.stage === s)
                  .map((r) => (
                    <div key={r.id} className="flex items-start justify-between gap-2">
                      <label className="flex items-start gap-3 text-sm">
                        <Checkbox
                          className="mt-1"
                          checked={
                            data?.checks.some(
                              (c) => c.ruleId === r.id && c.date === selected && c.done
                            ) ?? false
                          }
                          disabled={busy || selected > (data?.today ?? "")}
                          onCheckedChange={(checked) =>
                            void act({ ruleId: r.id, date: selected, done: checked === true })
                          }
                        />
                        {r.title}
                      </label>
                      {!r.archivedAt && (
                        <button
                          className="text-xs text-muted-foreground underline"
                          onClick={() => {
                            if (confirm(`Archive “${r.title}”? Previous days are preserved.`))
                              void act({ id: r.id }, "DELETE");
                          }}
                        >
                          Archive
                        </button>
                      )}
                    </div>
                  ))}
                {!rules.some((r) => r.stage === s) && (
                  <p className="text-xs text-muted-foreground">No routines scheduled.</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Last 13 weeks routine consistency</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-flow-col grid-rows-7 gap-1 overflow-x-auto">
              {days.map((d) => (
                <HoverHint
                  key={d.date}
                  heading={d.date}
                  content={`${d.completed} of ${d.total} routines completed`}
                >
                  <button
                    key={d.date}
                    aria-label={`${d.date}: ${d.completed}/${d.total} complete`}
                    onClick={() => setDate(d.date)}
                    className={`min-h-7 min-w-7 rounded border ${
                      selected === d.date ? "border-foreground" : "border-transparent"
                    }`}
                    style={{
                      background:
                        d.score === null
                          ? "var(--muted)"
                          : `color-mix(in srgb, var(--brand) ${15 + d.score * 75}%, var(--card))`,
                    }}
                  />
                </HoverHint>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Brighter squares mean a higher completion rate. Grey means no scheduled routines.
              Click a day to review it.
            </p>
          </CardContent>
        </Card>

        {/* ADD / EDIT MULTI-HORIZON GOAL DIALOG */}
        <Dialog open={goalModalOpen} onOpenChange={setGoalModalOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {editingGoal.id ? "Edit Goal & Accountability Target" : "Set Multi-Horizon Goal"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Horizon Level">
                  <OptionSelect
                    className={fieldClass}
                    value={editingGoal.horizon || "weekly"}
                    onValueChange={(v) =>
                      setEditingGoal((prev) => ({ ...prev, horizon: v as GoalHorizon }))
                    }
                  >
                    <option value="weekly">Weekly Process Focus</option>
                    <option value="monthly">Monthly Habit Target</option>
                    <option value="quarterly">Quarterly Evolution Milestone</option>
                  </OptionSelect>
                </Field>
                <Field label="Period Label">
                  <input
                    className={fieldClass}
                    value={editingGoal.periodLabel || ""}
                    placeholder="e.g., Nov W1, November 2026, Q4 2026"
                    onChange={(e) =>
                      setEditingGoal((prev) => ({ ...prev, periodLabel: e.target.value }))
                    }
                  />
                </Field>
              </div>
              <Field label="Goal Statement">
                <input
                  className={fieldClass}
                  value={editingGoal.title || ""}
                  placeholder="e.g., Zero impulse re-entries within 20m of a stop-out"
                  onChange={(e) =>
                    setEditingGoal((prev) => ({ ...prev, title: e.target.value }))
                  }
                />
              </Field>
              <Field label="Measurable Rule / Target Metric (Used by AI to hold you accountable)">
                <input
                  className={fieldClass}
                  value={editingGoal.targetMetric || ""}
                  placeholder="e.g., 0 revenge trades; stop trading for the day after -2R"
                  onChange={(e) =>
                    setEditingGoal((prev) => ({ ...prev, targetMetric: e.target.value }))
                  }
                />
              </Field>
              <Field label="Why It Matters (Root tendency or trigger this solves)">
                <input
                  className={fieldClass}
                  value={editingGoal.whyItMatters || ""}
                  placeholder="e.g., Protects mental capital after early NY AM losses"
                  onChange={(e) =>
                    setEditingGoal((prev) => ({ ...prev, whyItMatters: e.target.value }))
                  }
                />
              </Field>
              <Button
                disabled={!editingGoal.title?.trim()}
                onClick={() => void handleUpsertGoal(editingGoal)}
              >
                Save Goal
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* ADD DAILY ROUTINE DIALOG */}
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add a daily routine</DialogTitle>
            </DialogHeader>
            <Field label="Routine">
              <input
                className={fieldClass}
                value={title}
                placeholder="Review the economic calendar"
                onChange={(e) => setTitle(e.target.value)}
              />
            </Field>
            <Field label="When">
              <OptionSelect
                className={fieldClass}
                value={stage}
                onValueChange={(next) => setStage(next)}
              >
                {STAGES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </OptionSelect>
            </Field>
            <div className="flex flex-wrap gap-3">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, i) => (
                <label key={day} className="flex items-center gap-1 text-xs">
                  <Checkbox
                    checked={weekdays.includes(i)}
                    onCheckedChange={(checked) =>
                      setWeekdays(
                        checked === true ? [...weekdays, i] : weekdays.filter((n) => n !== i)
                      )
                    }
                  />
                  {day}
                </label>
              ))}
            </div>
            {failure && (
              <p role="alert" className="text-xs text-destructive">
                {failure}
              </p>
            )}
            <Button
              disabled={!title.trim() || !weekdays.length || busy}
              onClick={async () => {
                if (await act({ title, stage, weekdays })) {
                  setOpen(false);
                  setTitle("");
                }
              }}
            >
              Add routine
            </Button>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
