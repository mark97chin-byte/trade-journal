"use client";
import { DatePicker } from "@/components/ui/date-picker";
import { OptionSelect } from "@/components/ui/option-select";
import { Checkbox } from "@/components/ui/checkbox";
import { HoverHint } from "@/components/ui/tooltip";
import React, { Suspense, useState, useEffect, useCallback, useMemo } from "react";
import { FilterBar } from "@/components/filter-bar";
import { Field, fieldClass } from "@/components/filter-fields";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ReviewExport } from "@/components/review-export";
import { Markdown } from "@/components/rich-editor";
import { AiLogButton } from "@/components/ai-log-button";
import { useApi, postJson } from "@/lib/use-api";
import { scheduledRules, progressScore, type Routine, type RoutineCheck } from "@/lib/progress";
import {
  Sparkles,
  Target,
  Brain,
  Plus,
  Trash2,
  Send,
  Cpu,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Square,
  MessageSquarePlus,
  SlidersHorizontal,
  FileText,
  TrendingUp,
  Folder,
  Search,
  Printer,
  CheckSquare,
  MessageSquare,
} from "lucide-react";

const STAGES = ["Before trading", "During trading", "After trading"];

type GoalHorizon = "weekly" | "monthly" | "quarterly" | "yearly";
type GoalStatus = "on_track" | "slipping" | "breached" | "completed";
type NotebookFolder =
  | "all"
  | "weekly"
  | "monthly"
  | "quarterly"
  | "yearly"
  | "custom"
  | "chats";

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

interface ReportActionItem {
  id: string;
  text: string;
  horizon: GoalHorizon;
  targetMetric: string;
  done: boolean;
}

interface AiCoachReport {
  id: string;
  horizon: string;
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
  actionItems: ReportActionItem[];
  modelUsed: string;
  createdAt: string;
}

interface ActiveJob {
  id: string;
  jobType: string;
  targetId: string;
  label: string;
  status: string;
  startedAt: string;
  partialText?: string;
  partialReasoning?: string;
}

interface SelectableJournal {
  slug: string;
  periodType: string;
  title: string;
  hasPrep: boolean;
  hasReview: boolean;
  prepCharLen: number;
  reviewCharLen: number;
  processRating?: number | null;
}

interface SelectableTrade {
  key: string;
  symbol: string;
  direction: string;
  openedAt: string;
  netPnl: number;
  realizedR: number | null;
  estimated1RUsd?: number | null;
  mistakes: string[];
  tags: string[];
  hasNotes: boolean;
  tradeUrl: string;
}

interface ChatSession {
  id: string;
  title: string;
  reportId?: string;
  createdAt: string;
  updatedAt: string;
}

interface ChatMessage {
  id: string;
  sessionId: string;
  role: "user" | "coach";
  text: string;
  reasoning?: string;
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

function exportDocumentToPdfWindow(title: string, subtitle: string, bodyPreFormattedHtmlOrMd: string) {
  const win = window.open("", "_blank", "width=900,height=1000");
  if (!win) return;
  const escaped = bodyPreFormattedHtmlOrMd
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/^### (.*)$/gm, "<h3>$1</h3>")
    .replace(/^## (.*)$/gm, "<h2>$1</h2>")
    .replace(/^# (.*)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .split(String.fromCharCode(10)).join("<br/>");

  win.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>${title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #0f172a; padding: 40px; line-height: 1.6; max-width: 820px; margin: 0 auto; }
    h1 { font-size: 22px; margin-bottom: 4px; color: #0f172a; }
    h2 { font-size: 17px; margin-top: 22px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
    h3 { font-size: 14px; margin-top: 16px; }
    .meta { font-size: 12px; color: #64748b; margin-bottom: 24px; border-bottom: 2px solid #cbd5e1; padding-bottom: 12px; }
    .content { font-size: 13px; }
    a { color: #4f46e5; text-decoration: underline; }
    @media print { body { padding: 15px; } }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <div class="meta">${subtitle}</div>
  <div class="content">${escaped}</div>
  <script>setTimeout(() => { window.print(); }, 350);</script>
</body>
</html>`);
  win.document.close();
}

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

  const [coachData, setCoachData] = useState<{
    kobold: { mode: string; baseUrl: string; online: boolean; modelName: string };
    telemetry: any;
    selectableJournals: SelectableJournal[];
    selectableTrades: SelectableTrade[];
    activeJobs: ActiveJob[];
    chatSessions: ChatSession[];
    activeSessionId: string;
    chatMessages: ChatMessage[];
    goals: TraderGoal[];
    reports: AiCoachReport[];
  } | null>(null);

  // 3-Pane Notebook State
  const [activeFolder, setActiveFolder] = useState<NotebookFolder>("all");
  const [notebookSearch, setNotebookSearch] = useState("");
  const [activeDocType, setActiveDocType] = useState<"report" | "chat">("report");
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string>("");

  const [showReasoning, setShowReasoning] = useState(false);
  const [koboldUrlInput, setKoboldUrlInput] = useState("[http://100.75.201.34:5001](http://100.75.201.34:5001)");
  const [configOpen, setConfigOpen] = useState(false);
  const [newActionText, setNewActionText] = useState("");
  const [reportQuestionInput, setReportQuestionInput] = useState("");

  // Custom Scoped Audit Builder Modal State
  const [scopeModalOpen, setScopeModalOpen] = useState(false);
  const [scopeHorizon, setScopeHorizon] = useState<GoalHorizon>("weekly");
  const [scopePeriodFilter, setScopePeriodFilter] = useState<string>("all");
  const [selectedJournalSlugs, setSelectedJournalSlugs] = useState<string[]>([]);
  const [selectedTradeKeys, setSelectedTradeKeys] = useState<string[]>([]);
  const [includeTabs, setIncludeTabs] = useState<"both" | "review_only" | "prep_only">("both");
  const [thinkingMode, setThinkingMode] = useState<"fast" | "balanced" | "deep">("balanced");
  const [customFocusPrompt, setCustomFocusPrompt] = useState("");

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

  const [chatInput, setChatInput] = useState("");

  const fetchCoachData = useCallback(
    async (overrideSessionId?: string) => {
      try {
        const targetSess = overrideSessionId !== undefined ? overrideSessionId : selectedSessionId;
        const qs = targetSess ? `?sessionId=${encodeURIComponent(targetSess)}` : "";
        const res = await fetch(`/api/ai/coach${qs}`);
        const json = await res.json();
        if (json.ok) {
          setCoachData(json);
          if (json.kobold?.baseUrl) setKoboldUrlInput(json.kobold.baseUrl);
          if (json.activeSessionId && !selectedSessionId) {
            setSelectedSessionId(json.activeSessionId);
          }
          if (json.reports?.length > 0 && !selectedReportId) {
            setSelectedReportId(json.reports[0].id);
          }
        }
      } catch {}
    },
    [selectedSessionId, selectedReportId]
  );

  useEffect(() => {
    void fetchCoachData();
  }, [fetchCoachData]);

  const activeJobs = coachData?.activeJobs || [];
  const isAnyJobRunning = activeJobs.length > 0;
  const runningAuditJob = activeJobs.find((j) => j.jobType.startsWith("audit_"));
  const runningChatJob = activeJobs.find((j) => j.jobType === "chat");

  useEffect(() => {
    if (!isAnyJobRunning) return;
    const timer = setInterval(() => {
      void fetchCoachData();
    }, 2000);
    return () => clearInterval(timer);
  }, [isAnyJobRunning, fetchCoachData]);

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

  const handleGenerateAudit = async (
    horizon: GoalHorizon,
    customScope?: {
      selectedJournalSlugs?: string[];
      selectedTradeKeys?: string[];
      includeTabs?: "both" | "review_only" | "prep_only";
      thinkingMode?: "fast" | "balanced" | "deep";
      customFocusPrompt?: string;
    }
  ) => {
    setFailure("");
    setScopeModalOpen(false);
    setActiveDocType("report");
    try {
      const res = await fetch("/api/ai/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate_report",
          horizon,
          customScope: customScope || { thinkingMode },
        }),
      });
      const json = await res.json();
      if (!json.ok) {
        setFailure(json.error || "Failed to start longitudinal AI report.");
      } else {
        setSelectedReportId(null);
        await fetchCoachData();
      }
    } catch (err: any) {
      setFailure(err?.message || "Failed to connect to KoboldCpp.");
    }
  };

  const handleCancelJob = async (jobId?: string) => {
    try {
      await fetch("/api/ai/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel_job", jobId }),
      });
      await fetchCoachData();
    } catch {}
  };

  const handleDeleteReport = async (repId: string) => {
    if (!window.confirm("Delete this AI report from your notebook?")) return;
    try {
      await fetch("/api/ai/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_report", reportId: repId }),
      });
      if (selectedReportId === repId) setSelectedReportId(null);
      await fetchCoachData();
    } catch {}
  };

  const handleToggleReportAction = async (reportId: string, actionId: string, done: boolean) => {
    try {
      await fetch("/api/ai/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "toggle_report_action", reportId, actionId, done }),
      });
      await fetchCoachData();
    } catch {}
  };

  const handleAddCustomReportAction = async (reportId: string, horizon: GoalHorizon) => {
    const clean = newActionText.trim();
    if (!clean) return;
    setNewActionText("");
    try {
      await fetch("/api/ai/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add_report_action", reportId, text: clean, horizon }),
      });
      await fetchCoachData();
    } catch {}
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

  const handleNewChatSession = async (linkedReport?: AiCoachReport) => {
    try {
      const res = await fetch("/api/ai/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "new_chat_session",
          reportId: linkedReport?.id || "",
          title: linkedReport ? `Q&A · ${linkedReport.title.slice(0, 32)}` : undefined,
        }),
      });
      const json = await res.json();
      if (json.ok && json.sessionId) {
        setSelectedSessionId(json.sessionId);
        setActiveDocType("chat");
        await fetchCoachData(json.sessionId);
      }
    } catch {}
  };

  const handleDeleteChatSession = async (sessId: string) => {
    if (!sessId) return;
    if (!window.confirm("Delete this coaching conversation thread?")) return;
    try {
      await fetch("/api/ai/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_chat_session", sessionId: sessId }),
      });
      setSelectedSessionId("");
      await fetchCoachData("");
    } catch {}
  };

  const handleSendCoachChat = async (overrideMessage?: string, linkedReportId?: string) => {
    const msg = (overrideMessage ?? chatInput).trim();
    if (!msg || runningChatJob) return;
    setChatInput("");
    setReportQuestionInput("");
    try {
      const res = await fetch("/api/ai/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "chat_coach",
          sessionId: linkedReportId ? "" : selectedSessionId,
          reportId: linkedReportId || "",
          message: msg,
          customScope:
            selectedJournalSlugs.length > 0 || selectedTradeKeys.length > 0
              ? {
                  selectedJournalSlugs,
                  selectedTradeKeys,
                  includeTabs,
                  thinkingMode,
                }
              : { thinkingMode },
        }),
      });
      const json = await res.json();
      if (json.ok && json.sessionId) {
        setSelectedSessionId(json.sessionId);
        setActiveDocType("chat");
        await fetchCoachData(json.sessionId);
      } else if (!json.ok) {
        setFailure(json.error || "Could not send message.");
      }
    } catch (e: any) {
      setFailure(e?.message || "Connection error.");
    }
  };

  const reports = coachData?.reports || [];
  const chatSessions = coachData?.chatSessions || [];
  const chatMessages = coachData?.chatMessages || [];
  const tel = coachData?.telemetry;
  const selectableJournals = coachData?.selectableJournals || [];
  const selectableTrades = coachData?.selectableTrades || [];

  const activeReport =
    reports.find((r) => r.id === selectedReportId) || reports[0] || null;

  const activeChatSession =
    chatSessions.find((s) => s.id === selectedSessionId) || chatSessions[0] || null;

  const filteredSelectableJournals = useMemo(() => {
    if (scopePeriodFilter === "all") return selectableJournals;
    return selectableJournals.filter((j) => j.periodType === scopePeriodFilter);
  }, [selectableJournals, scopePeriodFilter]);

  // Unified Notebook Items for Middle List
  const notebookItems = useMemo(() => {
    const q = notebookSearch.trim().toLowerCase();
    const repItems = reports
      .filter((r) => {
        if (activeFolder === "chats") return false;
        if (activeFolder !== "all" && r.horizon !== activeFolder) return false;
        if (q && !r.title.toLowerCase().includes(q) && !r.summaryMd.toLowerCase().includes(q)) {
          return false;
        }
        return true;
      })
      .map((r) => {
        const doneCount = (r.actionItems || []).filter((a) => a.done).length;
        const totalActions = (r.actionItems || []).length;
        return {
          kind: "report" as const,
          id: r.id,
          title: r.title,
          badge: r.horizon.toUpperCase(),
          sub:
            totalActions > 0
              ? `${doneCount}/${totalActions} actions done · ${r.createdAt.slice(0, 10)}`
              : r.createdAt.slice(0, 10),
          updatedAt: r.createdAt,
        };
      });

    const chatItems = chatSessions
      .filter((s) => {
        if (activeFolder !== "all" && activeFolder !== "chats") return false;
        if (q && !s.title.toLowerCase().includes(q)) return false;
        return true;
      })
      .map((s) => ({
        kind: "chat" as const,
        id: s.id,
        title: s.title,
        badge: "CHAT",
        sub: s.updatedAt.slice(0, 16).replace("T", " "),
        updatedAt: s.updatedAt,
      }));

    return [...repItems, ...chatItems].sort((a, b) =>
      String(b.updatedAt).localeCompare(String(a.updatedAt))
    );
  }, [reports, chatSessions, activeFolder, notebookSearch]);

  const folderCounts = useMemo(() => {
    return {
      all: reports.length + chatSessions.length,
      weekly: reports.filter((r) => r.horizon === "weekly").length,
      monthly: reports.filter((r) => r.horizon === "monthly").length,
      quarterly: reports.filter((r) => r.horizon === "quarterly").length,
      yearly: reports.filter((r) => r.horizon === "yearly").length,
      custom: reports.filter((r) => r.horizon === "custom").length,
      chats: chatSessions.length,
    };
  }, [reports, chatSessions]);

  return (
    <div>
      <FilterBar
        title="Progress, Goals & AI Accountability Notebook"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <AiLogButton label="AI Logs" onAborted={() => void fetchCoachData()} />
            <Button
              size="sm"
              variant="outline"
              onClick={() => setScopeModalOpen(true)}
              className="border-indigo-500/40 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20"
            >
              <SlidersHorizontal className="mr-1.5 h-3.5 w-3.5" />
              Custom / Scoped Audit
            </Button>
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
          <p
            role="alert"
            className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300"
          >
            {error || failure}
          </p>
        )}

        {/* 1. KOBOLDCPP DESKTOP AI STATUS & 1R-NORMALIZED TELEMETRY BAR */}
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
                    Compares Target Period vs. Prior 3 Periods and evaluates 1R risk % consistency rather than raw lot sizes.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={thinkingMode}
                  onChange={(e) => setThinkingMode(e.target.value as any)}
                  className="h-8 rounded-lg border border-border/70 bg-[#0d0f14] px-2 text-xs text-foreground outline-none"
                  title="Choose AI reasoning depth vs speed"
                >
                  <option value="fast">⚡ Fast Direct (Best for Chat &amp; Quick Audits)</option>
                  <option value="balanced">🧠 Balanced Reasoning (Recommended for Weekly)</option>
                  <option value="deep">🔬 Deep Overnight CoT (Monthly / Quarterly)</option>
                </select>

                {runningAuditJob ? (
                  <div className="flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs">
                    <RefreshCw className="h-3.5 w-3.5 animate-spin text-amber-400" />
                    <span className="font-semibold text-amber-200">
                      {runningAuditJob.label}...
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleCancelJob(runningAuditJob.id)}
                      className="ml-1 inline-flex items-center gap-1 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 px-2 py-0.5 text-[11px] font-semibold text-rose-300 transition"
                    >
                      <Square className="h-2.5 w-2.5 fill-current" />
                      <span>Cancel</span>
                    </button>
                  </div>
                ) : (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setScopeModalOpen(true)}
                      className="text-xs border-indigo-500/50 bg-indigo-500/15 text-indigo-200 hover:bg-indigo-500/25"
                    >
                      <SlidersHorizontal className="mr-1.5 h-3.5 w-3.5" />
                      Pick Entries ({selectedJournalSlugs.length || "Auto"})
                    </Button>
                    {(["weekly", "monthly", "quarterly", "yearly"] as GoalHorizon[]).map((h) => (
                      <Button
                        key={h}
                        size="sm"
                        variant={h === "weekly" ? "default" : "outline"}
                        onClick={() => void handleGenerateAudit(h)}
                        className="text-xs capitalize"
                      >
                        <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                        {`Run ${h}`}
                      </Button>
                    ))}
                  </>
                )}

                <AiLogButton label="Logs" onAborted={() => void fetchCoachData()} />

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
                    placeholder="[http://100.75.201.34:5001](http://100.75.201.34:5001)"
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
                  Full GPU Layer &amp; Model controls available in Settings &rarr; AI.
                </span>
              </div>
            )}

            {/* 1R RISK-NORMALIZED BEHAVIORAL TELEMETRY STRIP */}
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
                    Post-Loss Risk % Expansion (&gt;1.35R)
                  </div>
                  <div
                    className={`font-bold text-sm mt-0.5 ${
                      (tel.postLossRiskExpansionCount || 0) > 0
                        ? "text-amber-400"
                        : "text-emerald-400"
                    }`}
                    title={`Baseline 1R Unit: ~$${tel.baseline1RUsd || 500} (${tel.baseline1RPct || 1}% of account)`}
                  >
                    {tel.postLossRiskExpansionCount || 0} occurrences{" "}
                    <span className="text-[10px] font-normal text-muted-foreground">
                      (1R ≈ ${tel.baseline1RUsd || 500})
                    </span>
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

        {/* 2. MULTI-HORIZON GOALS & ACCOUNTABILITY BOARD */}
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
            const colGoals = (coachData?.goals || []).filter((g) => g.horizon === col.key);
            return (
              <Card key={col.key} className="bg-[#12141d] border-border/70">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-sm font-bold flex items-center gap-2">
                        <Target className="h-4 w-4 text-indigo-400" />
                        <span>{col.title}</span>
                      </CardTitle>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{col.sub}</p>
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
                      No {col.key} goals active yet. Promote action points from your AI Notebook below or click + Add.
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
                              <h4 className="font-bold text-foreground leading-snug">{g.title}</h4>
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
                                  onClick={() => void handleUpsertGoal({ ...g, status: st })}
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

        {/* 3. 3-PANE AI NOTEBOOK STRUCTURE (FOLDERS -> ITEM LIST -> DOCUMENT / CHAT VIEWER + PDF EXPORT) */}
        <Card className="bg-[#0d0f14] border-border/70 overflow-hidden">
          <div className="grid grid-cols-1 lg:grid-cols-12 min-h-[680px]">
            {/* PANE 1 (LEFT 2 COLS): NOTEBOOK FOLDERS */}
            <div className="lg:col-span-2 border-b lg:border-b-0 lg:border-r border-border/50 bg-[#11131c] p-3 flex flex-col justify-between">
              <div className="space-y-1">
                <div className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  AI Notebook Folders
                </div>
                {(
                  [
                    { id: "all", label: "All Notes & Audits", count: folderCounts.all },
                    { id: "weekly", label: "Weekly Audits", count: folderCounts.weekly },
                    { id: "monthly", label: "Monthly Audits", count: folderCounts.monthly },
                    { id: "quarterly", label: "Quarterly Audits", count: folderCounts.quarterly },
                    { id: "yearly", label: "Yearly Audits", count: folderCounts.yearly },
                    { id: "custom", label: "Scoped Audits", count: folderCounts.custom },
                    { id: "chats", label: "Coach Chats", count: folderCounts.chats },
                  ] as const
                ).map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => {
                      setActiveFolder(f.id);
                      if (f.id === "chats") setActiveDocType("chat");
                      else if (f.id !== "all") setActiveDocType("report");
                    }}
                    className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-xs font-medium transition ${
                      activeFolder === f.id
                        ? "bg-secondary text-foreground font-bold border border-border/80 shadow-2xs"
                        : "text-muted-foreground hover:bg-secondary/40 hover:text-foreground"
                    }`}
                  >
                    <span className="flex items-center gap-2 truncate">
                      {f.id === "chats" ? (
                        <MessageSquare className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                      ) : (
                        <Folder className="h-3.5 w-3.5 text-indigo-400 shrink-0" />
                      )}
                      <span className="truncate">{f.label}</span>
                    </span>
                    <span className="ml-1 rounded-full bg-black/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {f.count}
                    </span>
                  </button>
                ))}
              </div>

              <div className="pt-4 border-t border-border/40 space-y-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void handleNewChatSession()}
                  className="w-full justify-start text-xs h-8"
                >
                  <MessageSquarePlus className="mr-1.5 h-3.5 w-3.5 text-emerald-400" />
                  New Coach Chat
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setScopeModalOpen(true)}
                  className="w-full justify-start text-xs h-8"
                >
                  <Sparkles className="mr-1.5 h-3.5 w-3.5 text-amber-400" />
                  New Scoped Audit
                </Button>
              </div>
            </div>

            {/* PANE 2 (MIDDLE 3 COLS): SEARCHABLE DOCUMENT & CHAT LIST */}
            <div className="lg:col-span-3 border-b lg:border-b-0 lg:border-r border-border/50 bg-[#0f1119] flex flex-col">
              <div className="p-3 border-b border-border/50">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    type="text"
                    value={notebookSearch}
                    onChange={(e) => setNotebookSearch(e.target.value)}
                    placeholder="Search reports & chats..."
                    className="h-8 w-full rounded-lg border border-border/70 bg-[#161925] pl-8 pr-2.5 text-xs text-foreground outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="flex-1 max-h-[620px] overflow-y-auto divide-y divide-border/30">
                {notebookItems.length === 0 ? (
                  <div className="p-6 text-center text-xs text-muted-foreground">
                    No notes or reports in this folder yet.
                  </div>
                ) : (
                  notebookItems.map((item) => {
                    const isSelected =
                      (item.kind === "report" &&
                        activeDocType === "report" &&
                        activeReport?.id === item.id) ||
                      (item.kind === "chat" &&
                        activeDocType === "chat" &&
                        selectedSessionId === item.id);

                    return (
                      <div
                        key={`${item.kind}-${item.id}`}
                        onClick={() => {
                          if (item.kind === "report") {
                            setActiveDocType("report");
                            setSelectedReportId(item.id);
                          } else {
                            setActiveDocType("chat");
                            setSelectedSessionId(item.id);
                            void fetchCoachData(item.id);
                          }
                        }}
                        className={`group flex items-start justify-between gap-2 p-3 cursor-pointer transition ${
                          isSelected
                            ? "bg-indigo-600/15 border-l-2 border-l-indigo-400"
                            : "hover:bg-secondary/30"
                        }`}
                      >
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                                item.kind === "chat"
                                  ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                                  : "bg-indigo-500/15 text-indigo-300 border border-indigo-500/30"
                              }`}
                            >
                              {item.badge}
                            </span>
                            <span className="text-[10px] text-muted-foreground truncate">
                              {item.sub}
                            </span>
                          </div>
                          <div className="text-xs font-semibold text-foreground line-clamp-2">
                            {item.title}
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (item.kind === "report") {
                              void handleDeleteReport(item.id);
                            } else {
                              void handleDeleteChatSession(item.id);
                            }
                          }}
                          className="opacity-0 group-hover:opacity-100 rounded p-1 text-rose-400/70 hover:text-rose-400 hover:bg-rose-500/10 transition"
                          title="Delete item"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* PANE 3 (RIGHT 7 COLS): DOCUMENT VIEWER / INTERACTIVE COACH WORKSPACE */}
            <div className="lg:col-span-7 bg-[#0d0f14] flex flex-col justify-between p-4">
              {/* LIVE STREAMING BANNER IF AN AUDIT JOB IS RUNNING */}
              {runningAuditJob && activeDocType === "report" && (
                <div className="mb-4 rounded-xl border border-amber-500/40 bg-[#121521] p-4 space-y-3">
                  <div className="flex items-center justify-between border-b border-border/40 pb-2">
                    <div className="flex items-center gap-2 text-xs font-bold text-amber-300">
                      <RefreshCw className="h-3.5 w-3.5 animate-spin text-amber-400" />
                      <span>Live Stream: {runningAuditJob.label}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleCancelJob(runningAuditJob.id)}
                      className="inline-flex items-center gap-1 rounded bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 px-2 py-0.5 text-[10px] font-semibold text-rose-300"
                    >
                      <Square className="h-2.5 w-2.5 fill-current" />
                      <span>Stop</span>
                    </button>
                  </div>

                  {runningAuditJob.partialReasoning && (
                    <div className="rounded-lg border border-indigo-500/25 bg-black/60 p-2.5">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-indigo-400 mb-1">
                        🧠 Live Chain-of-Thought (&lt;think&gt;)
                      </div>
                      <pre className="max-h-36 overflow-y-auto font-mono text-[10px] text-muted-foreground whitespace-pre-wrap">
                        {runningAuditJob.partialReasoning}
                      </pre>
                    </div>
                  )}

                  {runningAuditJob.partialText ? (
                    <div className="max-h-96 overflow-y-auto">
                      <Markdown value={runningAuditJob.partialText} />
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground animate-pulse">
                      Comparing periods and synthesizing behavioral patterns...
                    </div>
                  )}
                </div>
              )}

              {/* VIEW MODE A: LONGITUDINAL REPORT DOCUMENT */}
              {activeDocType === "report" ? (
                !activeReport ? (
                  <div className="my-auto py-16 text-center space-y-3">
                    <p className="text-sm font-semibold text-foreground">
                      No Report Selected
                    </p>
                    <p className="text-xs text-muted-foreground max-w-md mx-auto">
                      Select a report from the Notebook list on the left, or click <strong>Run Weekly / Monthly / Quarterly</strong> above to generate a new longitudinal audit.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Document Header & PDF Export Bar */}
                    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/50 pb-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="rounded bg-indigo-500/20 border border-indigo-500/40 px-2 py-0.5 text-[10px] font-bold uppercase text-indigo-300">
                            {activeReport.horizon}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            Generated {activeReport.createdAt.slice(0, 16).replace("T", " ")} ·{" "}
                            {activeReport.modelUsed}
                          </span>
                        </div>
                        <h3 className="text-base font-bold text-foreground mt-1">
                          {activeReport.title}
                        </h3>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            exportDocumentToPdfWindow(
                              activeReport.title,
                              `${activeReport.horizon.toUpperCase()} Audit · ${activeReport.createdAt.slice(0, 10)}`,
                              activeReport.summaryMd
                            )
                          }
                          className="h-8 text-xs"
                        >
                          <Printer className="mr-1.5 h-3.5 w-3.5 text-indigo-400" />
                          Export PDF
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void handleNewChatSession(activeReport)}
                          className="h-8 text-xs border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
                        >
                          <MessageSquare className="mr-1.5 h-3.5 w-3.5" />
                          Discuss in Chat
                        </Button>
                      </div>
                    </div>

                    {/* PERIOD-OVER-PERIOD COMPARISON TABLE (IF PRESENT IN TELEMETRY) */}
                    {Array.isArray(activeReport.telemetry?.periodComparisonBuckets) &&
                      activeReport.telemetry.periodComparisonBuckets.length > 0 && (
                        <div className="rounded-xl border border-border/60 bg-[#121521] p-3 space-y-2">
                          <div className="text-[11px] font-bold text-indigo-300">
                            Period-over-Period Telemetry Comparison (1R Risk Normalized)
                          </div>
                          <div className="overflow-x-auto">
                            <table className="w-full text-left text-[11px]">
                              <thead>
                                <tr className="border-b border-border/40 text-muted-foreground">
                                  <th className="py-1 pr-2">Period</th>
                                  <th className="py-1 px-2">Dates</th>
                                  <th className="py-1 px-2">Trades</th>
                                  <th className="py-1 px-2">Win Rate</th>
                                  <th className="py-1 px-2">Net P&amp;L</th>
                                  <th className="py-1 px-2">Avg 1R $</th>
                                  <th className="py-1 pl-2">&gt;1.35R Drift</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-border/20 font-mono">
                                {activeReport.telemetry.periodComparisonBuckets.map(
                                  (b: any, idx: number) => (
                                    <tr
                                      key={idx}
                                      className={idx === 0 ? "font-bold text-foreground" : "text-muted-foreground"}
                                    >
                                      <td className="py-1 pr-2 font-sans">{b.periodLabel}</td>
                                      <td className="py-1 px-2 text-[10px]">{b.dateRange}</td>
                                      <td className="py-1 px-2">{b.trades}</td>
                                      <td className="py-1 px-2">{b.winRatePct}%</td>
                                      <td
                                        className={`py-1 px-2 ${
                                          b.netPnl >= 0 ? "text-emerald-400" : "text-rose-400"
                                        }`}
                                      >
                                        ${b.netPnl}
                                      </td>
                                      <td className="py-1 px-2">${b.avgRisk1RUsd}</td>
                                      <td className="py-1 pl-2">{b.riskDriftCount}x</td>
                                    </tr>
                                  )
                                )}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                    {/* Collapsible Reasoning Trace */}
                    {activeReport.reasoningTrace && (
                      <div className="rounded-xl border border-indigo-500/30 bg-[#121521] overflow-hidden">
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
                            <span>🧠 View AI Chain-of-Thought Reasoning Trace</span>
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {showReasoning ? "Hide" : "Expand"}
                          </span>
                        </button>
                        {showReasoning && (
                          <pre className="max-h-64 overflow-y-auto border-t border-indigo-500/20 p-3 text-[11px] font-mono whitespace-pre-wrap text-muted-foreground leading-relaxed">
                            {activeReport.reasoningTrace}
                          </pre>
                        )}
                      </div>
                    )}

                    {/* Full Report Body (With Clickable Trade & Journal Links) */}
                    <div className="rounded-xl border border-border/50 bg-[#121521] p-5 max-h-[560px] overflow-y-auto leading-relaxed">
                      <Markdown value={activeReport.summaryMd} />
                    </div>

                    {/* ACTION POINTS TRACKER + 1-CLICK GOAL PROMOTER */}
                    <div className="rounded-xl border border-indigo-500/30 bg-[#121521] p-4 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <CheckSquare className="h-4 w-4 text-emerald-400" />
                          <span className="text-xs font-bold text-foreground">
                            Action Points &amp; Next Steps Tracker
                          </span>
                        </div>
                        {activeReport.actionItems && activeReport.actionItems.length > 0 && (
                          <span className="text-[11px] font-semibold text-emerald-300">
                            {activeReport.actionItems.filter((a) => a.done).length} of{" "}
                            {activeReport.actionItems.length} completed
                          </span>
                        )}
                      </div>

                      {activeReport.actionItems && activeReport.actionItems.length > 0 ? (
                        <div className="space-y-2">
                          {activeReport.actionItems.map((item) => (
                            <div
                              key={item.id}
                              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/50 bg-[#0d0f14] px-3 py-2 text-xs"
                            >
                              <label className="flex items-start gap-2.5 flex-1 cursor-pointer">
                                <Checkbox
                                  className="mt-0.5"
                                  checked={item.done}
                                  onCheckedChange={(c) =>
                                    void handleToggleReportAction(
                                      activeReport.id,
                                      item.id,
                                      c === true
                                    )
                                  }
                                />
                                <span
                                  className={
                                    item.done
                                      ? "line-through text-muted-foreground"
                                      : "text-foreground font-medium"
                                  }
                                >
                                  {item.text}
                                </span>
                              </label>

                              <div className="flex items-center gap-1 shrink-0">
                                {(["weekly", "monthly", "quarterly"] as const).map((hz) => (
                                  <button
                                    key={hz}
                                    type="button"
                                    onClick={() =>
                                      void handleUpsertGoal({
                                        horizon: hz,
                                        periodLabel:
                                          hz === "weekly"
                                            ? "This Week"
                                            : hz === "monthly"
                                            ? "This Month"
                                            : "This Quarter",
                                        title: item.text,
                                        whyItMatters: `From ${activeReport.title}`,
                                        targetMetric: item.targetMetric || "Consistent execution",
                                        status: "on_track",
                                        progressPct: item.done ? 100 : 0,
                                      })
                                    }
                                    className="rounded border border-indigo-500/30 bg-indigo-500/10 hover:bg-indigo-500/25 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-300 capitalize transition"
                                    title={`Add directly to your ${hz} goals`}
                                  >
                                    + {hz} Goal
                                  </button>
                                ))}
                                <button
                                  type="button"
                                  onClick={() =>
                                    void act({
                                      title: item.text.slice(0, 80),
                                      stage: "Before trading",
                                      weekdays: [1, 2, 3, 4, 5],
                                    })
                                  }
                                  className="rounded border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/25 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300 transition"
                                  title="Add as a daily routine checkbox"
                                >
                                  + Routine
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          Add custom action items below or promote AI-suggested goals.
                        </p>
                      )}

                      {/* Add Custom Action Step to Report */}
                      <div className="flex items-center gap-2 pt-1">
                        <input
                          type="text"
                          value={newActionText}
                          onChange={(e) => setNewActionText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              void handleAddCustomReportAction(
                                activeReport.id,
                                (activeReport.horizon as GoalHorizon) || "weekly"
                              );
                            }
                          }}
                          placeholder="Add an action point to track on this report..."
                          className="h-8 flex-1 rounded-lg border border-border/70 bg-[#0d0f14] px-2.5 text-xs text-foreground outline-none focus:border-indigo-500"
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs"
                          onClick={() =>
                            void handleAddCustomReportAction(
                              activeReport.id,
                              (activeReport.horizon as GoalHorizon) || "weekly"
                            )
                          }
                        >
                          + Add Action
                        </Button>
                      </div>
                    </div>

                    {/* INLINE "ASK QUESTION ABOUT THIS REPORT" BAR */}
                    <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/10 p-3 flex items-center gap-2">
                      <MessageSquare className="h-4 w-4 text-emerald-400 shrink-0" />
                      <input
                        type="text"
                        value={reportQuestionInput}
                        onChange={(e) => setReportQuestionInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && reportQuestionInput.trim()) {
                            e.preventDefault();
                            void handleSendCoachChat(reportQuestionInput, activeReport.id);
                          }
                        }}
                        placeholder={`Ask your coach a follow-up question about "${activeReport.title}"...`}
                        className="h-8 flex-1 rounded-lg border border-border/70 bg-[#0d0f14] px-3 text-xs text-foreground outline-none focus:border-emerald-500"
                      />
                      <Button
                        size="sm"
                        disabled={!reportQuestionInput.trim()}
                        onClick={() =>
                          void handleSendCoachChat(reportQuestionInput, activeReport.id)
                        }
                        className="h-8 text-xs"
                      >
                        Ask Coach &rarr;
                      </Button>
                    </div>
                  </div>
                )
              ) : (
                /* VIEW MODE B: ACCOUNTABILITY COACH CONVERSATION VIEWER + PDF EXPORT */
                <div className="flex flex-col h-full justify-between space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-emerald-500/20 border border-emerald-500/40 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-300">
                          COACH CONVERSATION
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {activeChatSession?.updatedAt.slice(0, 16).replace("T", " ")}
                        </span>
                      </div>
                      <h3 className="text-base font-bold text-foreground mt-1">
                        {activeChatSession?.title || "Accountability Coaching Session"}
                      </h3>
                    </div>

                    <div className="flex items-center gap-2">
                      <AiLogButton label="Logs" onAborted={() => void fetchCoachData()} />
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const transcript = chatMessages
                            .map(
                              (m) =>
                                `### ${m.role === "user" ? "Trader" : "AI Accountability Coach"} (${m.createdAt.slice(0, 16).replace("T", " ")})
${m.text}`
                            )
                            .join(String.fromCharCode(10) + String.fromCharCode(10));
                          exportDocumentToPdfWindow(
                            activeChatSession?.title || "Coaching Transcript",
                            `Accountability Coach Session · ${chatMessages.length} messages`,
                            transcript
                          );
                        }}
                        className="h-8 text-xs"
                      >
                        <Printer className="mr-1.5 h-3.5 w-3.5 text-emerald-400" />
                        Export Chat PDF
                      </Button>
                    </div>
                  </div>

                  <div className="flex-1 min-h-[420px] max-h-[540px] overflow-y-auto space-y-3 rounded-xl border border-border/50 bg-[#121521] p-4 text-xs">
                    {chatMessages.length === 0 ? (
                      <div className="space-y-2 text-muted-foreground">
                        <p>
                          Ask your Accountability Coach anything about your journals, trades, or goals:
                        </p>
                        {[
                          "What recurring emotional trigger shows up across my recent journal reviews?",
                          "Help me set realistic Weekly and Monthly goals based on my biggest leak.",
                          "How has my 1R risk consistency evolved over the last 3 weeks?",
                        ].map((q) => (
                          <button
                            key={q}
                            type="button"
                            onClick={() => setChatInput(q)}
                            className="block w-full rounded-lg border border-border/50 bg-[#161925] px-3 py-2 text-left text-xs text-foreground hover:border-indigo-500/50 transition"
                          >
                            &ldquo;{q}&rdquo;
                          </button>
                        ))}
                      </div>
                    ) : (
                      chatMessages.map((m) => (
                        <div
                          key={m.id}
                          className={`rounded-xl p-3 space-y-2 ${
                            m.role === "user"
                              ? "bg-indigo-600/20 border border-indigo-500/30 text-foreground ml-8"
                              : "bg-[#0d0f14] border border-border/60 text-foreground mr-4"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                              {m.role === "user" ? "You" : "AI Accountability Coach"}
                            </span>
                            {m.role === "coach" && (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingGoal({
                                    horizon: "weekly",
                                    periodLabel: "This Week",
                                    title: m.text.split(String.fromCharCode(10))[0]?.replace(/^[#*-]\s*/, "").slice(0, 90) || "",
                                    whyItMatters: "From Accountability Coach session",
                                    targetMetric: "Consistent daily execution",
                                    status: "on_track",
                                    progressPct: 0,
                                  });
                                  setGoalModalOpen(true);
                                }}
                                className="text-[10px] text-indigo-400 hover:underline"
                              >
                                + Convert to Goal
                              </button>
                            )}
                          </div>
                          <Markdown value={m.text} />
                        </div>
                      ))
                    )}

                    {runningChatJob && (
                      <div className="rounded-xl border border-indigo-500/30 bg-indigo-950/20 p-3 space-y-2 text-xs text-indigo-200">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <RefreshCw className="h-3.5 w-3.5 animate-spin text-indigo-400" />
                            <span className="font-semibold">Coach is replying...</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => void handleCancelJob(runningChatJob.id)}
                            className="inline-flex items-center gap-1 rounded bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 px-2 py-0.5 text-[10px] font-semibold text-rose-300"
                          >
                            <Square className="h-2.5 w-2.5 fill-current" />
                            <span>Cancel</span>
                          </button>
                        </div>
                        {runningChatJob.partialText && (
                          <div className="border-t border-indigo-500/20 pt-2 text-foreground">
                            <Markdown value={runningChatJob.partialText} />
                          </div>
                        )}
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
                      placeholder="Reply to your coach or ask about specific trades..."
                      className="h-9 flex-1 rounded-lg border border-border/70 bg-[#121521] px-3 text-xs text-foreground outline-none focus:border-indigo-500"
                    />
                    {runningChatJob ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void handleCancelJob(runningChatJob.id)}
                        className="border-rose-500/40 bg-rose-500/15 text-rose-300 hover:bg-rose-500/25"
                      >
                        <Square className="h-3.5 w-3.5 fill-current" />
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        disabled={!chatInput.trim()}
                        onClick={() => void handleSendCoachChat()}
                      >
                        <Send className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </Card>

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

        {/* CUSTOM SCOPED AUDIT & ENTRY PICKER DIALOG */}
        <Dialog open={scopeModalOpen} onOpenChange={setScopeModalOpen}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-indigo-400" />
                <span>Custom Scoped AI Audit — Pick Exact Journals &amp; Trades</span>
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="Target Horizon">
                  <OptionSelect
                    className={fieldClass}
                    value={scopeHorizon}
                    onValueChange={(v) => setScopeHorizon(v as GoalHorizon)}
                  >
                    <option value="weekly">Weekly Audit</option>
                    <option value="monthly">Monthly Audit</option>
                    <option value="quarterly">Quarterly Audit</option>
                    <option value="yearly">Yearly Audit</option>
                  </OptionSelect>
                </Field>

                <Field label="Which Journal Tabs to Feed AI">
                  <OptionSelect
                    className={fieldClass}
                    value={includeTabs}
                    onValueChange={(v) => setIncludeTabs(v as any)}
                  >
                    <option value="both">Both Prep &amp; Review Tabs</option>
                    <option value="review_only">Review Tab Only (Faster &amp; Focused)</option>
                    <option value="prep_only">Prep / Forecast Tab Only</option>
                  </OptionSelect>
                </Field>

                <Field label="Reasoning Depth vs Speed">
                  <OptionSelect
                    className={fieldClass}
                    value={thinkingMode}
                    onValueChange={(v) => setThinkingMode(v as any)}
                  >
                    <option value="fast">⚡ Fast Direct (~3x Faster)</option>
                    <option value="balanced">🧠 Balanced Thinking</option>
                    <option value="deep">🔬 Deep Overnight CoT</option>
                  </OptionSelect>
                </Field>
              </div>

              <div className="space-y-2 rounded-xl border border-border/60 bg-[#0d0f14] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <FileText className="h-3.5 w-3.5 text-indigo-400" />
                    <span className="font-bold text-foreground">
                      1. Choose Journal Entries ({selectedJournalSlugs.length} selected — leave 0 for auto)
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    {(["all", "day", "week", "month", "quarter", "year"] as const).map((pt) => (
                      <button
                        key={pt}
                        type="button"
                        onClick={() => setScopePeriodFilter(pt)}
                        className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase transition ${
                          scopePeriodFilter === pt
                            ? "bg-indigo-600 text-white"
                            : "bg-secondary/50 text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {pt}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedJournalSlugs(filteredSelectableJournals.map((j) => j.slug))
                      }
                      className="ml-1 text-[10px] text-indigo-400 hover:underline px-1"
                    >
                      Select All
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedJournalSlugs([])}
                      className="text-[10px] text-muted-foreground hover:underline px-1"
                    >
                      Clear
                    </button>
                  </div>
                </div>

                <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
                  {filteredSelectableJournals.length === 0 ? (
                    <div className="py-4 text-center text-muted-foreground">
                      No non-empty journal entries found for this filter.
                    </div>
                  ) : (
                    filteredSelectableJournals.map((j) => {
                      const checked = selectedJournalSlugs.includes(j.slug);
                      return (
                        <label
                          key={j.slug}
                          className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 cursor-pointer transition ${
                            checked
                              ? "border-indigo-500/50 bg-indigo-500/15 text-foreground"
                              : "border-border/40 bg-[#141722] text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          <div className="flex items-center gap-2 truncate">
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(c) => {
                                if (c === true) {
                                  setSelectedJournalSlugs((prev) => [...prev, j.slug]);
                                } else {
                                  setSelectedJournalSlugs((prev) =>
                                    prev.filter((s) => s !== j.slug)
                                  );
                                }
                              }}
                            />
                            <span className="rounded bg-secondary px-1.5 py-0.5 text-[9px] font-bold uppercase text-foreground">
                              {j.periodType}
                            </span>
                            <span className="font-medium text-foreground truncate">
                              {j.title}
                            </span>
                            <span className="text-[10px] text-muted-foreground font-mono">
                              ({j.slug})
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0 text-[10px]">
                            {j.hasPrep && (
                              <span className="rounded bg-indigo-500/15 border border-indigo-500/30 px-1.5 py-0.5 text-indigo-300">
                                Prep ({j.prepCharLen}c)
                              </span>
                            )}
                            {j.hasReview && (
                              <span className="rounded bg-emerald-500/15 border border-emerald-500/30 px-1.5 py-0.5 text-emerald-300">
                                Review ({j.reviewCharLen}c)
                              </span>
                            )}
                          </div>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="space-y-2 rounded-xl border border-border/60 bg-[#0d0f14] p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
                    <span className="font-bold text-foreground">
                      2. Choose Specific Trades ({selectedTradeKeys.length} selected — leave 0 for auto)
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedTradeKeys([])}
                    className="text-[10px] text-muted-foreground hover:underline"
                  >
                    Clear Trades
                  </button>
                </div>

                <div className="max-h-40 overflow-y-auto space-y-1 pr-1">
                  {selectableTrades.length === 0 ? (
                    <div className="py-3 text-center text-muted-foreground">
                      No executed trades recorded yet.
                    </div>
                  ) : (
                    selectableTrades.map((t) => {
                      const checked = selectedTradeKeys.includes(t.key);
                      return (
                        <label
                          key={t.key}
                          className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 cursor-pointer transition ${
                            checked
                              ? "border-indigo-500/50 bg-indigo-500/15 text-foreground"
                              : "border-border/40 bg-[#141722] text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          <div className="flex items-center gap-2 truncate">
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(c) => {
                                if (c === true) {
                                  setSelectedTradeKeys((prev) => [...prev, t.key]);
                                } else {
                                  setSelectedTradeKeys((prev) =>
                                    prev.filter((k) => k !== t.key)
                                  );
                                }
                              }}
                            />
                            <span className="font-mono text-[10px]">
                              {t.openedAt.slice(0, 16).replace("T", " ")}
                            </span>
                            <span className="font-bold text-foreground">{t.symbol}</span>
                            <span className="uppercase text-[10px]">{t.direction}</span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0 font-mono text-[11px]">
                            {t.estimated1RUsd && (
                              <span className="text-[10px] text-muted-foreground">
                                1R≈${t.estimated1RUsd}
                              </span>
                            )}
                            <span
                              className={
                                t.netPnl >= 0 ? "text-emerald-400 font-bold" : "text-rose-400 font-bold"
                              }
                            >
                              {t.netPnl >= 0 ? `+$${t.netPnl.toFixed(2)}` : `-$${Math.abs(t.netPnl).toFixed(2)}`}
                            </span>
                          </div>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>

              <Field label="3. Optional Specific Instruction or Question for This Audit">
                <textarea
                  rows={2}
                  value={customFocusPrompt}
                  onChange={(e) => setCustomFocusPrompt(e.target.value)}
                  placeholder="e.g., Compare my execution and emotional triggers in this week's review against the prior 2 weeks..."
                  className="w-full rounded-lg border border-border/70 bg-[#0d0f14] p-2.5 text-xs text-foreground outline-none focus:border-indigo-500"
                />
              </Field>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/40">
                <Button variant="outline" size="sm" onClick={() => setScopeModalOpen(false)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={() =>
                    void handleGenerateAudit(scopeHorizon, {
                      selectedJournalSlugs,
                      selectedTradeKeys,
                      includeTabs,
                      thinkingMode,
                      customFocusPrompt,
                    })
                  }
                >
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                  Run Scoped Audit Now
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

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
                  placeholder="e.g., Risk strictly 1.0R per trade; stop trading after -2R"
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
