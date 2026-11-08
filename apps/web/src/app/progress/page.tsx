"use client";
import { ensureAiSlotBeforeTask } from "@/lib/ai-slot-guard";
import { DatePicker } from "@/components/ui/date-picker";
import { OptionSelect } from "@/components/ui/option-select";
import { Checkbox } from "@/components/ui/checkbox";
import { HoverHint } from "@/components/ui/tooltip";
import React, { Suspense, useState, useEffect, useCallback, useMemo, useRef } from "react";
import { FilterBar } from "@/components/filter-bar";
import { Field, fieldClass } from "@/components/filter-fields";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ReviewExport } from "@/components/review-export";
import { Markdown } from "@/components/rich-editor";
import { AuditManagerModal } from "@/components/audit-manager-modal";
import { SocraticReflectionManager, type ReportReflectionQuestion } from "@/components/socratic-reflection-manager";
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
  Pencil,
  Check,
  X,
  Bell,
  Maximize2,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  BookOpen,
  ArrowsUpFromLine,
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

interface GoalStep {
  id: string;
  text: string;
  done: boolean;
}

interface TraderGoal {
  id: string;
  horizon: GoalHorizon;
  periodLabel: string;
  title: string;
  whyItMatters: string;
  targetMetric: string;
  status: GoalStatus;
  progressPct: number;
  steps?: GoalStep[];
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
  reflectionQuestions?: ReportReflectionQuestion[];
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
  accountRiskPct?: number | null;
  accountPnlPct?: number | null;
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

interface AuditDueItem {
  due: boolean;
  daysSinceLast: number | null;
  lastRunAt: string | null;
  reason: string;
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
  const nl = String.fromCharCode(10);
  const escaped = bodyPreFormattedHtmlOrMd
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/^### (.*)$/gm, "<h3>$1</h3>")
    .replace(/^## (.*)$/gm, "<h2>$1</h2>")
    .replace(/^# (.*)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .split(nl)
    .join("<br/>");

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


// Interactive Markdown Renderer that reliably parses [label](url) (even with nested parentheses!)
// and opens /journal or /trades links in the Side-by-Side Evidence Inspector
function renderInlineTokens(
  text: string,
  onInspectLink?: (href: string, label: string) => void
): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // Match [label](href) where label can contain anything except unescaped ] and href is (/... or https://...)
  const linkRegex = /\[([^\]]+)\]\(((?:\/|https?:\/\/)[^\s)]+(?:\([^\s)]*\)[^\s)]*)*)\)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let keyCounter = 0;

  const formatBoldItalicCode = (segment: string, baseKey: string): React.ReactNode[] => {
    const parts = segment.split(/(\*\*.*?\*\*|`[^`]+`|\*[^*]+\*)/g);
    return parts.map((part, idx) => {
      if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
        return (
          <strong key={`${baseKey}-b-${idx}`} className="font-bold text-foreground">
            {part.slice(2, -2)}
          </strong>
        );
      }
      if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
        return (
          <code
            key={`${baseKey}-c-${idx}`}
            className="rounded bg-black/50 border border-border/60 px-1.5 py-0.5 font-mono text-[11px] text-indigo-300"
          >
            {part.slice(1, -1)}
          </code>
        );
      }
      if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
        return (
          <em key={`${baseKey}-i-${idx}`} className="italic text-foreground/90">
            {part.slice(1, -1)}
          </em>
        );
      }
      return part;
    });
  };

  while ((match = linkRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(
        ...formatBoldItalicCode(text.slice(lastIndex, match.index), `seg-${keyCounter++}`)
      );
    }
    const label = match[1] || "";
    const href = match[2] || "";
    const isTradeLink = href.startsWith("/trades");
    const isJournalLink = href.startsWith("/journal");

    nodes.push(
      <a
        key={`lnk-${keyCounter++}`}
        href={href}
        onClick={(e) => {
          if ((isTradeLink || isJournalLink) && onInspectLink) {
            e.preventDefault();
            onInspectLink(href, label);
          }
        }}
        className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold transition mx-0.5 ${
          isTradeLink
            ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25"
            : isJournalLink
            ? "border-indigo-500/40 bg-indigo-500/15 text-indigo-300 hover:bg-indigo-500/25"
            : "border-border bg-secondary text-indigo-300 underline"
        }`}
        title={
          isTradeLink || isJournalLink
            ? "Click to inspect side-by-side (or middle-click to open full tab)"
            : href
        }
      >
        <span>{isTradeLink ? "📈" : isJournalLink ? "📓" : "🔗"}</span>
        <span className="underline decoration-dotted underline-offset-2">{label}</span>
      </a>
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    nodes.push(...formatBoldItalicCode(text.slice(lastIndex), `tail-${keyCounter++}`));
  }

  return nodes;
}

function InteractiveCoachMarkdown({
  value,
  onInspectLink,
}: {
  value: string;
  onInspectLink?: (href: string, label: string) => void;
}) {
  if (!value) return null;
  const cleanedValue = value
    .replace(/```json[\s\S]*$/i, "")
    .replace(/\{\s*"goalAudits"\s*:[\s\S]*$/i, "")
    .trimEnd();
  const nl = String.fromCharCode(10);
  const lines = cleanedValue.split(nl);
  const elements: React.ReactNode[] = [];
  let listItems: React.ReactNode[] = [];
  let tableRows: string[][] = [];

  const flushList = (keyPrefix: string) => {
    if (listItems.length > 0) {
      elements.push(
        <ul key={`${keyPrefix}-ul`} className="list-disc pl-5 space-y-1.5 my-2 text-xs text-foreground/90">
          {listItems}
        </ul>
      );
      listItems = [];
    }
  };

  const flushTable = (keyPrefix: string) => {
    if (tableRows.length > 0) {
      const header = tableRows[0] || [];
      const body = tableRows.slice(1).filter((r) => !r.every((c) => /^[-:\s]+$/.test(c)));
      elements.push(
        <div key={`${keyPrefix}-tbl`} className="my-3 overflow-x-auto rounded-lg border border-border/60">
          <table className="w-full text-left text-[11px]">
            <thead className="bg-secondary/60 text-muted-foreground border-b border-border/50">
              <tr>
                {header.map((h, cIdx) => (
                  <th key={cIdx} className="px-2.5 py-1.5 font-bold">
                    {renderInlineTokens(h, onInspectLink)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {body.map((row, rIdx) => (
                <tr key={rIdx} className="hover:bg-secondary/20">
                  {row.map((cell, cIdx) => (
                    <td key={cIdx} className="px-2.5 py-1.5">
                      {renderInlineTokens(cell, onInspectLink)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      tableRows = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i] || "";
    const trimmed = rawLine.trim();

    // If line is empty and we are currently accumulating table rows, peek ahead:
    // Qwen/LLMs often insert blank lines between | Header |, |---|---|, and | Row |!
    if (!trimmed) {
      if (tableRows.length > 0) {
        continue;
      }
      flushList(`l-${i}`);
      continue;
    }

    if (trimmed.startsWith("|") && (trimmed.endsWith("|") || trimmed.split("|").length >= 3)) {
      flushList(`l-${i}`);
      const cleanRow = trimmed.replace(/^\|/, "").replace(/\|$/, "");
      const cells = cleanRow.split("|").map((c) => c.trim());
      tableRows.push(cells);
      continue;
    } else {
      flushTable(`t-${i}`);
    }

    if (/^---+$/.test(trimmed)) {
      flushList(`l-${i}`);
      elements.push(<hr key={`hr-${i}`} className="my-4 border-border/50" />);
      continue;
    }

    if (trimmed.startsWith("### ")) {
      flushList(`l-${i}`);
      elements.push(
        <h3 key={`h3-${i}`} className="text-sm font-bold text-foreground mt-4 mb-1.5">
          {renderInlineTokens(trimmed.slice(4), onInspectLink)}
        </h3>
      );
      continue;
    }

    if (trimmed.startsWith("## ")) {
      flushList(`l-${i}`);
      elements.push(
        <h2
          key={`h2-${i}`}
          className="text-base font-bold text-foreground mt-5 mb-2 border-b border-border/40 pb-1"
        >
          {renderInlineTokens(trimmed.slice(3), onInspectLink)}
        </h2>
      );
      continue;
    }

    if (trimmed.startsWith("# ")) {
      flushList(`l-${i}`);
      elements.push(
        <h1 key={`h1-${i}`} className="text-lg font-bold text-foreground mt-5 mb-2">
          {renderInlineTokens(trimmed.slice(2), onInspectLink)}
        </h1>
      );
      continue;
    }

    if (trimmed.startsWith("> ")) {
      flushList(`l-${i}`);
      elements.push(
        <blockquote
          key={`bq-${i}`}
          className="my-2 border-l-2 border-indigo-400 bg-indigo-950/20 pl-3 py-1.5 italic text-xs text-indigo-200 rounded-r"
        >
          {renderInlineTokens(trimmed.slice(2), onInspectLink)}
        </blockquote>
      );
      continue;
    }

    if (/^([-*•]|\d+\.)\s+/.test(trimmed)) {
      const content = trimmed.replace(/^([-*•]|\d+\.)\s+/, "");
      listItems.push(
        <li key={`li-${i}`} className="leading-relaxed">
          {renderInlineTokens(content, onInspectLink)}
        </li>
      );
      continue;
    }

    flushList(`l-${i}`);
    elements.push(
      <p key={`p-${i}`} className="text-xs text-foreground/90 leading-relaxed my-2">
        {renderInlineTokens(trimmed, onInspectLink)}
      </p>
    );
  }

  flushList("end");
  flushTable("end");

  return <div className="space-y-1">{elements}</div>;
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
    kobold: {
      mode: string;
      baseUrl: string;
      online: boolean;
      modelName: string;
      baselineRiskPct?: number;
      accountBalanceOverride?: number;
    };
    auditDue?: {
      weekly: AuditDueItem;
      monthly: AuditDueItem;
      quarterly: AuditDueItem;
    };
    telemetry: any;
    selectableJournals: SelectableJournal[];
    selectableTrades: SelectableTrade[];
    activeJobs: ActiveJob[];
    chatSessions: ChatSession[];
    activeSessionId: string;
    chatMessages: ChatMessage[];
    reportCommentsMap: Record<string, ChatMessage[]>;
    goals: TraderGoal[];
    reports: AiCoachReport[];
  } | null>(null);

  const [activeFolder, setActiveFolder] = useState<NotebookFolder>("all");
  const [notebookSearch, setNotebookSearch] = useState("");
  const [activeDocType, setActiveDocType] = useState<"report" | "chat">("report");
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [latestKnownReportId, setLatestKnownReportId] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string>("");

  const [showReasoning, setShowReasoning] = useState(false);
  const [koboldUrlInput, setKoboldUrlInput] = useState("http://100.75.201.34:5001");
  const [baselineRiskPctInput, setBaselineRiskPctInput] = useState("1.0");
  const [accountBalInput, setAccountBalInput] = useState("");
  const [configOpen, setConfigOpen] = useState(false);
  const [dismissedDueBanner, setDismissedDueBanner] = useState(false);

  // Action item creation & inline editing state
  const [newActionText, setNewActionText] = useState("");
  const [editingActionId, setEditingActionId] = useState<string | null>(null);
  const [editingActionText, setEditingActionText] = useState("");

  const [reportQuestionInput, setReportQuestionInput] = useState("");
  const [syncNotice, setSyncNotice] = useState("");
  const [evidenceModalOpen, setEvidenceModalOpen] = useState(false);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [evidenceData, setEvidenceData] = useState<any>(null);

  // Custom Scoped Audit Builder Modal State
  const [scopeModalOpen, setScopeModalOpen] = useState(false);
  const [auditManagerOpen, setAuditManagerOpen] = useState<boolean>(false);
  const [scopeHorizon, setScopeHorizon] = useState<GoalHorizon>("weekly");
  const [scopePeriodFilter, setScopePeriodFilter] = useState<string>("all");
  const [selectedJournalSlugs, setSelectedJournalSlugs] = useState<string[]>([]);
  const [selectedTradeKeys, setSelectedTradeKeys] = useState<string[]>([]);
  const [includeTabs, setIncludeTabs] = useState<"both" | "review_only" | "prep_only">("both");
  const [thinkingMode, setThinkingMode] = useState<"fast" | "balanced" | "deep">("balanced");
  const [reportStyle, setReportStyle] = useState<"auto" | "end_of_period" | "mid_period">("auto");
  const [periodOffset, setPeriodOffset] = useState<number>(0);
  const [autoStopAfterQueue, setAutoStopAfterQueue] = useState<boolean>(false);
  const [customFocusPrompt, setCustomFocusPrompt] = useState("");

  const [goalModalOpen, setGoalModalOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Partial<TraderGoal>>({
    horizon: "weekly",
    periodLabel: "This Week",
    title: "",
    whyItMatters: "",
    targetMetric: "",
    status: "on_track",
    progressPct: 0,
    steps: [],
  });
  const [modalNewStepText, setModalNewStepText] = useState("");
  const [goalStepInputs, setGoalStepInputs] = useState<Record<string, string>>({});

  // Adjustable 3-Pane Notebook Layout, Expandable Height & Full-Screen State
  const [foldersCollapsed, setFoldersCollapsed] = useState(false);
  const [folderPaneWidthPct, setFolderPaneWidthPct] = useState(16);
  const [listPaneWidthPct, setListPaneWidthPct] = useState(24);
  const [notebookHeightMode, setNotebookHeightMode] = useState<"standard" | "tall" | "expanded">("tall");
  const [notebookFullscreen, setNotebookFullscreen] = useState(false);

  // Side-Tab Journal Quick Editor Drawer State
  const [sideJournalOpen, setSideJournalOpen] = useState(false);
  const [sideJournalLoading, setSideJournalLoading] = useState(false);
  const [sideJournalSlug, setSideJournalSlug] = useState("");
  const [sideJournalTitle, setSideJournalTitle] = useState("");
  const [sideJournalPrepMd, setSideJournalPrepMd] = useState("");
  const [sideJournalRevMd, setSideJournalRevMd] = useState("");
  const [sideJournalNewPrep, setSideJournalNewPrep] = useState("");
  const [sideJournalNewRev, setSideJournalNewRev] = useState("");
  const [sideJournalLessons, setSideJournalLessons] = useState("");
  const [sideJournalRating, setSideJournalRating] = useState<string>("");

  const [chatInput, setChatInput] = useState("");

  const selectedReportIdRef = useRef<string | null>(null);
  selectedReportIdRef.current = selectedReportId;
  const latestKnownReportIdRef = useRef<string | null>(null);
  latestKnownReportIdRef.current = latestKnownReportId;

  const fetchCoachData = useCallback(
    async (overrideSessionId?: string) => {
      try {
        const targetSess = overrideSessionId !== undefined ? overrideSessionId : selectedSessionId;
        const qs = targetSess ? `?sessionId=${encodeURIComponent(targetSess)}` : "";
        const res = await fetch(`/api/ai/coach${qs}`);
        const json = await res.json();
        if (json.ok) {
          setCoachData(json);
          if (typeof json.autoStopAfterQueue === "boolean") {
            setAutoStopAfterQueue(json.autoStopAfterQueue);
          }
          if (json.kobold?.baseUrl) setKoboldUrlInput(json.kobold.baseUrl);
          if (json.kobold?.baselineRiskPct) {
            setBaselineRiskPctInput(String(json.kobold.baselineRiskPct));
          }
          if (json.kobold?.accountBalanceOverride && json.kobold.accountBalanceOverride > 0) {
            setAccountBalInput(String(json.kobold.accountBalanceOverride));
          }
          if (json.activeSessionId && !selectedSessionId) {
            setSelectedSessionId(json.activeSessionId);
          }
          if (json.reports?.length > 0) {
            const newestId = json.reports[0].id;
            const curSel = selectedReportIdRef.current;
            const prevLatest = latestKnownReportIdRef.current;
            if (!curSel || (prevLatest && newestId !== prevLatest)) {
              setSelectedReportId(newestId);
              setActiveDocType("report");
            }
            setLatestKnownReportId(newestId);
          }
        }
      } catch {}
    },
    [selectedSessionId]
  );

  useEffect(() => {
    void fetchCoachData();
  }, [fetchCoachData]);

  const activeJobs = coachData?.activeJobs || [];
  const isAnyJobRunning = activeJobs.length > 0;
  const runningAuditJob = activeJobs.find(
    (j) => j.jobType.startsWith("audit_") && j.status === "running"
  );
  const queuedAuditJobs = activeJobs.filter(
    (j) => j.jobType.startsWith("audit_") && j.status === "queued"
  );
  const runningChatJob = activeJobs.find((j) => j.jobType === "chat");

  // Lightweight 2.5s poll (?poll=1) that ONLY fetches activeJobs (~1KB) from RAM
  // and triggers a full fetchCoachData() ONLY when a job finishes or starts a new report!
  useEffect(() => {
    if (!isAnyJobRunning) return;
    let prevJobSignature = activeJobs.map((j) => `${j.id}:${j.status}`).join(",");

    const timer = setInterval(async () => {
      try {
        const res = await fetch("/api/ai/coach?poll=1");
        const json = await res.json();
        if (!json.ok) return;

        const nextJobs: ActiveJob[] = json.activeJobs || [];
        const nextSignature = nextJobs.map((j) => `${j.id}:${j.status}`).join(",");

        if (typeof json.autoStopAfterQueue === "boolean") {
          setAutoStopAfterQueue(json.autoStopAfterQueue);
        }

        // Update live stream text in memory without re-fetching all 50 reports & 90 journals
        setCoachData((prev) => {
          if (!prev) return prev;
          const runningRep = nextJobs.find((j) => j.status === "running" && (j as any).reportId);
          const updatedReports =
            runningRep && runningRep.partialText
              ? prev.reports.map((r) =>
                  r.id === (runningRep as any).reportId
                    ? {
                        ...r,
                        summaryMd: runningRep.partialText || r.summaryMd,
                        reasoningTrace: runningRep.partialReasoning || r.reasoningTrace,
                      }
                    : r
                )
              : prev.reports;
          return {
            ...prev,
            activeJobs: nextJobs,
            reports: updatedReports,
          };
        });

        // If a job completed or transitioned in the queue, perform ONE full sync to load final data
        if (nextSignature !== prevJobSignature) {
          prevJobSignature = nextSignature;
          await fetchCoachData();
        }
      } catch {}
    }, 2500);

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

  const handleToggleAutoStopServer = async (nextVal: boolean) => {
    setAutoStopAfterQueue(nextVal);
    try {
      await fetch("/api/ai/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_auto_stop_server", enabled: nextVal }),
      });
    } catch {}
  };

  const handleGenerateAudit = async (
    horizon: GoalHorizon,
    customScope?: {
      selectedJournalSlugs?: string[];
      selectedTradeKeys?: string[];
      includeTabs?: "both" | "review_only" | "prep_only";
      thinkingMode?: "fast" | "balanced" | "deep";
      reportStyle?: "auto" | "end_of_period" | "mid_period";
      periodOffset?: number;
      stopServerAfterQueue?: boolean;
      customFocusPrompt?: string;
    }
  ) => {
    setFailure("");
    setScopeModalOpen(false);
    setActiveDocType("report");
    try {
      const slotCheck = await ensureAiSlotBeforeTask("kobold_report", "Report & Audit Generation");
      if (!slotCheck.proceed) return;
      const res = await fetch("/api/ai/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate_report",
          horizon,
          stopServerAfterQueue: customScope?.stopServerAfterQueue ?? autoStopAfterQueue,
          customScope: customScope || {
            thinkingMode,
            reportStyle,
            periodOffset,
            stopServerAfterQueue: autoStopAfterQueue,
          },
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

  const handleQueueBatchAudits = async (horizons: GoalHorizon[]) => {
    setFailure("");
    setActiveDocType("report");
    try {
      const res = await fetch("/api/ai/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "queue_multiple_reports",
          horizons,
          stopServerAfterQueue: autoStopAfterQueue,
          customScope: {
            thinkingMode,
            reportStyle,
            periodOffset,
            stopServerAfterQueue: autoStopAfterQueue,
          },
        }),
      });
      const json = await res.json();
      if (!json.ok) {
        setFailure(json.error || "Failed to queue audits.");
      } else {
        await fetchCoachData();
      }
    } catch (err: any) {
      setFailure(err?.message || "Failed to connect to KoboldCpp.");
    }
  };

  const handleContinueReport = async (reportId: string) => {
    setFailure("");
    try {
      const res = await fetch("/api/ai/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "continue_report", reportId }),
      });
      const json = await res.json();
      if (!json.ok) {
        setFailure(json.error || "Could not continue report.");
      } else {
        await fetchCoachData();
      }
    } catch (e: any) {
      setFailure(e?.message || "Connection error.");
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

  const handleSaveEditedAction = async (reportId: string, actionId: string) => {
    const clean = editingActionText.trim();
    if (!clean) return;
    setEditingActionId(null);
    try {
      await fetch("/api/ai/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "edit_report_action",
          reportId,
          actionId,
          text: clean,
        }),
      });
      await fetchCoachData();
    } catch {}
  };

  const handleDeleteReportAction = async (reportId: string, actionId: string) => {
    try {
      await fetch("/api/ai/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete_report_action",
          reportId,
          actionId,
        }),
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

  const handleOpenSideJournalEditor = async (slug: string) => {
    setSideJournalOpen(true);
    setSideJournalLoading(true);
    setSideJournalSlug(slug);
    setSideJournalNewPrep("");
    setSideJournalNewRev("");
    try {
      const res = await fetch("/api/ai/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "inspect_evidence",
          href: `/journal?slug=${encodeURIComponent(slug)}`,
        }),
      });
      const json = await res.json();
      if (json.ok && json.journal) {
        setSideJournalTitle(json.journal.title || slug);
        setSideJournalPrepMd(json.journal.prepMd || "");
        setSideJournalRevMd(json.journal.reviewMd || "");
        setSideJournalLessons(json.journal.lessonsLearned || "");
        setSideJournalRating(json.journal.rating != null ? String(json.journal.rating) : "");
      } else {
        setSideJournalTitle(slug);
        setSideJournalPrepMd("*(No Prep notes yet)*");
        setSideJournalRevMd("*(No Review notes yet)*");
        setSideJournalLessons("");
        setSideJournalRating("");
      }
    } catch {
      setSideJournalTitle(slug);
    } finally {
      setSideJournalLoading(false);
    }
  };

  const handleSaveSideJournal = async () => {
    if (!sideJournalSlug) return;
    setSideJournalLoading(true);
    try {
      const res = await fetch("/api/ai/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save_journal_quick_edit",
          slug: sideJournalSlug,
          prepNoteToAppend: sideJournalNewPrep,
          reviewNoteToAppend: sideJournalNewRev,
          lessonsLearned: sideJournalLessons,
          rating: sideJournalRating !== "" ? Number(sideJournalRating) : null,
        }),
      });
      const json = await res.json();
      if (json.ok) {
        setSyncNotice(`✓ Updated ${sideJournalTitle} (${sideJournalSlug})!`);
        setSideJournalNewPrep("");
        setSideJournalNewRev("");
        await handleOpenSideJournalEditor(sideJournalSlug);
        await fetchCoachData();
        setTimeout(() => setSyncNotice(""), 5000);
      }
    } finally {
      setSideJournalLoading(false);
    }
  };

  const handleToggleGoalStep = async (goalId: string, stepId: string, done: boolean) => {
    try {
      await fetch("/api/ai/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "toggle_goal_step", goalId, stepId, done }),
      });
      await fetchCoachData();
    } catch {}
  };

  const handleAddGoalStep = async (goalId: string) => {
    const txt = (goalStepInputs[goalId] || "").trim();
    if (!txt) return;
    setGoalStepInputs((prev) => ({ ...prev, [goalId]: "" }));
    try {
      await fetch("/api/ai/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add_goal_step", goalId, text: txt }),
      });
      await fetchCoachData();
    } catch {}
  };

  const handleDeleteGoalStep = async (goalId: string, stepId: string) => {
    try {
      await fetch("/api/ai/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_goal_step", goalId, stepId }),
      });
      await fetchCoachData();
    } catch {}
  };

  const startColumnResize = (
    whichDivider: "folder" | "list",
    e: React.MouseEvent<HTMLDivElement>
  ) => {
    e.preventDefault();
    const container = e.currentTarget.parentElement;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const onMove = (moveEv: MouseEvent) => {
      const relPct = ((moveEv.clientX - rect.left) / rect.width) * 100;
      if (whichDivider === "folder") {
        setFolderPaneWidthPct(Math.max(10, Math.min(28, Math.round(relPct))));
      } else {
        const effFolder = foldersCollapsed ? 0 : folderPaneWidthPct;
        const newListPct = Math.max(15, Math.min(45, Math.round(relPct - effFolder)));
        setListPaneWidthPct(newListPct);
      }
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
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

  const handleNewChatSession = async () => {
    try {
      const res = await fetch("/api/ai/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "new_chat_session",
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

  // If linkedReportId is passed, the question & reply stay embedded inside the Report view!
  const handleInspectLink = async (href: string, label: string) => {
    setEvidenceModalOpen(true);
    setEvidenceLoading(true);
    setEvidenceData({ href, label });
    try {
      const res = await fetch("/api/ai/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "inspect_evidence", href }),
      });
      const json = await res.json();
      if (json.ok) {
        setEvidenceData({ ...json, label });
      } else {
        setEvidenceData({ href, label, error: json.error || "Could not load item" });
      }
    } catch (e: any) {
      setEvidenceData({ href, label, error: e?.message || "Failed to load evidence" });
    } finally {
      setEvidenceLoading(false);
    }
  };

  const handlePushToJournal = async (reportId?: string, targetPeriod: "week" | "day" = "week") => {
    setSyncNotice("");
    try {
      const res = await fetch("/api/ai/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "push_actions_to_journal",
          reportId: reportId || activeReport?.id || "",
          targetPeriod,
        }),
      });
      const json = await res.json();
      if (json.ok) {
        setSyncNotice(`✓ ${json.message}`);
        setTimeout(() => setSyncNotice(""), 6000);
      } else {
        setFailure(json.error || "Failed to sync to journal.");
      }
    } catch (e: any) {
      setFailure(e?.message || "Sync error.");
    }
  };

  const handleSaveDebriefToJournal = async (text: string, question?: string) => {
    try {
      const res = await fetch("/api/ai/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "append_to_journal_review",
          text,
          question,
        }),
      });
      const json = await res.json();
      if (json.ok) {
        setSyncNotice(`✓ ${json.message}`);
        await fetchCoachData();
        setTimeout(() => setSyncNotice(""), 6000);
      }
    } catch {}
  };

  const handleStartSocraticDebrief = async () => {
    const prompt =
      "Run a 60-second Pre-Audit Socratic Debrief for me: Based on my recent trades, Account % Risk sizing, and journal entries this week, ask me 3 short, direct, high-leverage reflection questions to uncover any emotional blind spots or hesitation before I run my next audit.";
    await handleSendCoachChat(prompt);
  };

  const handleSendCoachChat = async (overrideMessage?: string, linkedReportId?: string) => {
    const msg = (overrideMessage ?? chatInput).trim();
    if (!msg || runningChatJob) return;
    if (linkedReportId) {
      setReportQuestionInput("");
    } else {
      setChatInput("");
    }
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
      if (json.ok) {
        if (!linkedReportId && json.sessionId) {
          setSelectedSessionId(json.sessionId);
          setActiveDocType("chat");
          await fetchCoachData(json.sessionId);
        } else {
          // Stay right inside the Report view!
          await fetchCoachData();
        }
      } else {
        setFailure(json.error || "Could not send message.");
      }
    } catch (e: any) {
      setFailure(e?.message || "Connection error.");
    }
  };

  const reports = coachData?.reports || [];
  const chatSessions = coachData?.chatSessions || [];
  const chatMessages = coachData?.chatMessages || [];
  const reportCommentsMap = coachData?.reportCommentsMap || {};
  const tel = coachData?.telemetry;
  const auditDue = coachData?.auditDue;
  const selectableJournals = coachData?.selectableJournals || [];
  const selectableTrades = coachData?.selectableTrades || [];

  const activeReport =
    reports.find((r) => r.id === selectedReportId) || reports[0] || null;

  const activeReportComments = activeReport
    ? reportCommentsMap[activeReport.id] || []
    : [];

  const activeChatSession =
    chatSessions.find((s) => s.id === selectedSessionId) || chatSessions[0] || null;

  const filteredSelectableJournals = useMemo(() => {
    if (scopePeriodFilter === "all") return selectableJournals;
    return selectableJournals.filter((j) => j.periodType === scopePeriodFilter);
  }, [selectableJournals, scopePeriodFilter]);

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
        const qCount = (reportCommentsMap[r.id] || []).length;
        return {
          kind: "report" as const,
          id: r.id,
          title: r.title,
          badge: r.horizon.toUpperCase(),
          sub: `${totalActions > 0 ? `${doneCount}/${totalActions} actions` : r.createdAt.slice(0, 10)}${qCount > 0 ? ` · ${qCount} Q&A` : ""}`,
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
  }, [reports, chatSessions, reportCommentsMap, activeFolder, notebookSearch]);

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

  const dueHorizons = useMemo(() => {
    if (!auditDue) return [];
    const list: Array<{ horizon: GoalHorizon; label: string; reason: string }> = [];
    if (auditDue.weekly?.due) {
      list.push({ horizon: "weekly", label: "Weekly Audit Due", reason: auditDue.weekly.reason });
    }
    if (auditDue.monthly?.due) {
      list.push({ horizon: "monthly", label: "Monthly Audit Due", reason: auditDue.monthly.reason });
    }
    if (auditDue.quarterly?.due) {
      list.push({
        horizon: "quarterly",
        label: "Quarterly Audit Due",
        reason: auditDue.quarterly.reason,
      });
    }
    return list;
  }, [auditDue]);

  return (
    <div>
      <FilterBar
        title="Progress, Goals & AI Accountability Notebook"
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

        {syncNotice && (
          <div className="flex items-center justify-between rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-4 py-2.5 text-xs font-semibold text-emerald-200">
            <span>{syncNotice}</span>
            <button type="button" onClick={() => setSyncNotice("")} className="text-emerald-300 hover:text-white">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

{/* 1. KOBOLDCPP DESKTOP AI STATUS & ACCOUNT % RISK TELEMETRY BAR */}
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
                    Longitudinal behavioral performance and risk discipline coach.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => setAuditManagerOpen(true)}
                  className="h-8 text-xs bg-indigo-600 hover:bg-indigo-500 text-white font-bold shadow-md transition px-3.5"
                  title="Open the Report Generation & Queue Manager"
                >
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                  Report Manager
                </Button>

                <button
                  type="button"
                  onClick={() => void handleToggleAutoStopServer(!autoStopAfterQueue)}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition ${
                    autoStopAfterQueue
                      ? "border-amber-600/50 dark:border-amber-500/50 bg-amber-100 dark:bg-amber-500/20 text-amber-950 dark:text-amber-200 shadow-sm"
                      : "border-border/70 bg-card dark:bg-[#0d0f14] text-muted-foreground hover:text-foreground"
                  }`}
                  title="When enabled, KoboldCpp will automatically shut down as soon as the queue finishes so your desktop PC can go to sleep overnight"
                >
                  <span className="font-semibold">🌙 Auto-Stop Server: {autoStopAfterQueue ? "ON (PC Sleeps)" : "OFF"}</span>
                </button>

                <AiLogButton label="Logs" onAborted={() => void fetchCoachData()} />

                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfigOpen((v) => !v)}
                  title="Configure Standard Risk % & Desktop KoboldCpp Endpoint"
                >
                  <Cpu className="h-4 w-4 text-muted-foreground" />
                </Button>
              </div>
            </div>

            {/* SEQUENTIAL BACKGROUND QUEUE STATUS BAR */}
            {(runningAuditJob || queuedAuditJobs.length > 0) && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3.5 py-2.5 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  {runningAuditJob && (
                    <span className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/50 bg-black/40 px-2.5 py-1 font-semibold text-amber-200">
                      <RefreshCw className="h-3.5 w-3.5 animate-spin text-amber-400" />
                      <span>Running Now: {runningAuditJob.label}</span>
                      <button
                        type="button"
                        onClick={() => void handleCancelJob(runningAuditJob.id)}
                        className="ml-1 rounded bg-rose-500/25 hover:bg-rose-500/40 px-1.5 py-0.5 text-[10px] text-rose-200"
                        title="Abort active generation"
                      >
                        Stop
                      </button>
                    </span>
                  )}

                  {queuedAuditJobs.map((qj, idx) => (
                    <span
                      key={qj.id}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-[#0d0f14] px-2.5 py-1 text-[11px] text-muted-foreground"
                    >
                      <span className="font-mono text-indigo-400 font-bold">#{idx + 1} Queued:</span>
                      <span className="text-foreground">{qj.label}</span>
                      <button
                        type="button"
                        onClick={() => void handleCancelJob(qj.id)}
                        className="ml-1 text-rose-400 hover:text-rose-300"
                        title="Remove from queue"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => void handleCancelJob()}
                  className="inline-flex items-center gap-1 rounded-lg border border-rose-500/40 bg-rose-500/15 hover:bg-rose-500/25 px-2.5 py-1 text-[11px] font-semibold text-rose-300"
                >
                  <Square className="h-2.5 w-2.5 fill-current" />
                  <span>Clear All Queue</span>
                </button>
              </div>
            )}

            {configOpen && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 rounded-xl border border-border/60 bg-[#0d0f14] p-3 text-xs">
                <div className="space-y-1">
                  <span className="font-semibold text-foreground">
                    Desktop KoboldCpp Tailscale URL
                  </span>
                  <input
                    type="text"
                    value={koboldUrlInput}
                    onChange={(e) => setKoboldUrlInput(e.target.value)}
                    placeholder="http://100.75.201.34:5001"
                    className="h-8 w-full rounded-lg border border-border/70 bg-[#141722] px-2.5 text-xs text-foreground outline-none focus:border-indigo-500"
                  />
                </div>
                <div className="space-y-1">
                  <span className="font-semibold text-foreground">
                    Standard Full Risk % of Account (e.g. 1.0%)
                  </span>
                  <input
                    type="number"
                    step="0.1"
                    value={baselineRiskPctInput}
                    onChange={(e) => setBaselineRiskPctInput(e.target.value)}
                    placeholder="1.0"
                    className="h-8 w-full rounded-lg border border-border/70 bg-[#141722] px-2.5 text-xs text-foreground outline-none focus:border-indigo-500"
                  />
                </div>
                <div className="space-y-1">
                  <span className="font-semibold text-foreground">
                    Starting Account Equity $ (0 = Auto-Detect)
                  </span>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      step="1000"
                      value={accountBalInput}
                      onChange={(e) => setAccountBalInput(e.target.value)}
                      placeholder={`Auto ($${tel?.initialAccountBalance || 50000})`}
                      className="h-8 flex-1 rounded-lg border border-border/70 bg-[#141722] px-2.5 text-xs text-foreground outline-none focus:border-indigo-500"
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
                            baselineRiskPct: parseFloat(baselineRiskPctInput || "1.0"),
                            accountBalanceOverride: parseFloat(accountBalInput || "0"),
                          }),
                        });
                        await fetchCoachData();
                        setConfigOpen(false);
                      }}
                    >
                      Save
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* ACCOUNT % RISK NORMALIZED TELEMETRY STRIP */}
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
                    Post-Loss Risk &gt;{( (tel.targetRiskPct || 1) * 1.3 ).toFixed(2)}% Acct
                  </div>
                  <div
                    className={`font-bold text-sm mt-0.5 ${
                      (tel.postLossRiskExpansionCount || 0) > 0
                        ? "text-amber-400"
                        : "text-emerald-400"
                    }`}
                  >
                    {tel.postLossRiskExpansionCount || 0} occurrences{" "}
                    <span className="text-[10px] font-normal text-muted-foreground">
                      (Std={tel.targetRiskPct || 1}%)
                    </span>
                  </div>
                </div>
                <div className="rounded-lg border border-border/40 bg-[#0d0f14] px-3 py-2">
                  <div className="text-[10px] text-muted-foreground">
                    Reduced / Half-Risk Probes (&lt;0.7% Acct)
                  </div>
                  <div className="font-bold text-sm text-indigo-300 mt-0.5">
                    {tel.intentionalDownsizeCount || 0} trades
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

                          {/* MULTI-STEP GOAL CHECKLIST & PROGRESS BAR */}
                          <div className="space-y-1.5 pt-1">
                            {g.steps && g.steps.length > 0 && (
                              <>
                                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                                  <span>
                                    Checklist ({g.steps.filter((s) => s.done).length}/{g.steps.length} steps)
                                  </span>
                                  <span className="font-mono font-bold text-indigo-300">
                                    {g.progressPct}%
                                  </span>
                                </div>
                                <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                                  <div
                                    className="h-full bg-indigo-500 transition-all"
                                    style={{ width: `${Math.min(100, Math.max(0, g.progressPct || 0))}%` }}
                                  />
                                </div>
                                <div className="space-y-1 pt-1">
                                  {g.steps.map((st) => (
                                    <div
                                      key={st.id}
                                      className="flex items-center justify-between gap-2 rounded bg-[#141722] px-2 py-1 text-[11px]"
                                    >
                                      <label className="flex items-start gap-2 flex-1 cursor-pointer">
                                        <Checkbox checked={st.done} className="mt-0.5" onCheckedChange={(c) => void handleToggleGoalStep(g.id, st.id, c === true)} />
                                        <span
                                          className={
                                            st.done
                                              ? "line-through text-muted-foreground"
                                              : "text-foreground"
                                          }
                                        >
                                          {st.text}
                                        </span>
                                      </label>
                                      <button
                                        type="button"
                                        onClick={() => void handleDeleteGoalStep(g.id, st.id)}
                                        className="text-muted-foreground hover:text-rose-400"
                                        title="Remove step"
                                      >
                                        <X className="h-3 w-3"/>
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              </>
                            )}
                            <div className="flex items-center gap-1 pt-0.5">
                              <input
                                type="text"
                                value={goalStepInputs[g.id] || ""}
                                onChange={(e) =>
                                  setGoalStepInputs((prev) => ({ ...prev, [g.id]: e.target.value }))
                                }
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    void handleAddGoalStep(g.id);
                                  }
                                }}
                                placeholder="+ Add milestone step to check off..."
                                className="h-6 flex-1 rounded border border-border/50 bg-[#141722] px-2 text-[10px] text-foreground outline-none focus:border-indigo-500"
                              />
                              <button
                                type="button"
                                onClick={() => void handleAddGoalStep(g.id)}
                                className="rounded border border-border/60 bg-secondary/50 hover:bg-secondary px-1.5 py-0.5 text-[10px] font-semibold"
                              >
                                Add
                              </button>
                            </div>
                          </div>

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

        {/* 3. 3-PANE AI NOTEBOOK STRUCTURE WITH ADJUSTABLE DIVIDERS, EXPANDABLE HEIGHT & FULL-SCREEN */}
        <Card className={`bg-[#0d0f14] border-border/70 overflow-hidden transition-all ${notebookFullscreen ? "fixed inset-0 z-50 rounded-none border-0 w-screen h-screen flex flex-col" : ""}`}>
          {/* NOTEBOOK WORKSPACE TOOLBAR */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-[#141722] px-3 py-2 text-xs">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setFoldersCollapsed((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-[#0d0f14] hover:bg-secondary px-2 py-1 text-[11px] font-medium text-foreground transition"
                title={foldersCollapsed ? "Show Folders Sidebar" : "Collapse Folders Sidebar"}
              >
                {foldersCollapsed ? (
                  <PanelLeftOpen className="h-3.5 w-3.5 text-indigo-400" />
                ) : (
                  <PanelLeftClose className="h-3.5 w-3.5 text-indigo-400" />
                )}
                <span>{foldersCollapsed ? "Show Folders" : "Hide Folders"}</span>
              </button>
              <span className="text-[11px] text-muted-foreground hidden sm:inline">
                Drag vertical dividers between panes to resize width
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center rounded-lg border border-border/60 bg-[#0d0f14] p-0.5 text-[11px]">
                {(
                  [
                    { id: "standard", label: "Compact" },
                    { id: "tall", label: "Tall" },
                    { id: "expanded", label: "↕ Full Expand" },
                  ] as const
                ).map((hm) => (
                  <button
                    key={hm.id}
                    type="button"
                    onClick={() => setNotebookHeightMode(hm.id)}
                    className={`rounded-md px-2 py-0.5 font-semibold transition ${
                      notebookHeightMode === hm.id
                        ? "bg-indigo-600 text-white"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                    title="Adjust vertical height of the Notebook and reading pane"
                  >
                    {hm.label}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => {
                  const defaultSlug =
                    selectableJournals[0]?.slug ||
                    `week-${new Date().toISOString().slice(0, 10)}`;
                  void handleOpenSideJournalEditor(defaultSlug);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 px-2.5 py-1 text-[11px] font-semibold text-emerald-300 transition"
                title="Open the Quick Journal Side-Tab Editor to add review notes or takeaways without leaving this page"
              >
                <BookOpen className="h-3.5 w-3.5" />
                <span>Journal Side-Tab</span>
              </button>

              <button
                type="button"
                onClick={() => setNotebookFullscreen((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-500/40 bg-indigo-500/15 hover:bg-indigo-500/25 px-2.5 py-1 text-[11px] font-semibold text-indigo-200 transition"
                title={notebookFullscreen ? "Exit Full Screen" : "Expand Notebook to Full Screen"}
              >
                {notebookFullscreen ? (
                  <>
                    <Minimize2 className="h-3.5 w-3.5" />
                    <span>Exit Full Screen</span>
                  </>
                ) : (
                  <>
                    <Maximize2 className="h-3.5 w-3.5" />
                    <span>Full Screen</span>
                  </>
                )}
              </button>
            </div>
          </div>

          <div
            className={`flex flex-col lg:flex-row ${
              notebookFullscreen
                ? "flex-1 overflow-hidden"
                : notebookHeightMode === "standard"
                ? "min-h-[640px]"
                : notebookHeightMode === "tall"
                ? "min-h-[920px]"
                : "min-h-[1100px]"
            }`}
          >
            {/* PANE 1: NOTEBOOK FOLDERS WITH DUE DOTS */}
            {!foldersCollapsed && (
              <>
                <div
                  style={{ width: `${folderPaneWidthPct}%` }}
                  className="w-full lg:w-auto shrink-0 border-b lg:border-b-0 bg-[#11131c] p-3 flex flex-col justify-between"
                >
              <div className="space-y-1">
                <div className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  AI Notebook Folders
                </div>
                {(
                  [
                    { id: "all", label: "All Notes & Audits", count: folderCounts.all, due: false },
                    {
                      id: "weekly",
                      label: "Weekly Audits",
                      count: folderCounts.weekly,
                      due: Boolean(auditDue?.weekly?.due),
                    },
                    {
                      id: "monthly",
                      label: "Monthly Audits",
                      count: folderCounts.monthly,
                      due: Boolean(auditDue?.monthly?.due),
                    },
                    {
                      id: "quarterly",
                      label: "Quarterly Audits",
                      count: folderCounts.quarterly,
                      due: Boolean(auditDue?.quarterly?.due),
                    },
                    { id: "yearly", label: "Yearly Audits", count: folderCounts.yearly, due: false },
                    { id: "custom", label: "Scoped Audits", count: folderCounts.custom, due: false },
                    { id: "chats", label: "Coach Chats", count: folderCounts.chats, due: false },
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
                      {f.due && (
                        <span
                          className="h-2 w-2 rounded-full bg-amber-400 shrink-0"
                          title={`${f.label} is due`}
                        />
                      )}
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
                  onClick={() => setAuditManagerOpen(true)}
                  className="w-full justify-start text-xs h-8"
                >
                  <Sparkles className="mr-1.5 h-3.5 w-3.5 text-amber-400" />
                  New Scoped Audit
                </Button>
              </div>
            </div>

            {/* DRAGGABLE RESIZER HANDLE 1 (FOLDERS <-> LIST) */}
            <div
              onMouseDown={(e) => startColumnResize("folder", e)}
              className="hidden lg:flex w-1.5 cursor-col-resize items-center justify-center bg-border/30 hover:bg-indigo-500/60 transition group select-none shrink-0"
              title="Drag to resize Folders pane"
            >
              <div className="h-8 w-0.5 rounded bg-muted-foreground/40 group-hover:bg-white" />
            </div>
              </>
            )}

            {/* PANE 2: SEARCHABLE DOCUMENT & CHAT LIST */}
            <div
              style={{ width: `${listPaneWidthPct}%` }}
              className="w-full lg:w-auto shrink-0 border-b lg:border-b-0 bg-[#0f1119] flex flex-col"
            >
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

            {/* DRAGGABLE RESIZER HANDLE 2 (LIST <-> REPORT VIEWER) */}
            <div
              onMouseDown={(e) => startColumnResize("list", e)}
              className="hidden lg:flex w-1.5 cursor-col-resize items-center justify-center bg-border/30 hover:bg-indigo-500/60 transition group select-none shrink-0"
              title="Drag to resize Document List vs Reading Pane"
            >
              <div className="h-8 w-0.5 rounded bg-muted-foreground/40 group-hover:bg-white" />
            </div>

            {/* PANE 3: DOCUMENT VIEWER + EMBEDDED REPORT Q&A */}
            <div className="flex-1 min-w-0 bg-[#0d0f14] flex flex-col justify-between p-4 overflow-y-auto">
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
                      <InteractiveCoachMarkdown value={runningAuditJob.partialText} onInspectLink={handleInspectLink} />
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
                    {/* Document Header, Continue Report Button & PDF Export */}
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
                          disabled={Boolean(runningAuditJob)}
                          onClick={() => void handleContinueReport(activeReport.id)}
                          className="h-8 text-xs border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20"
                          title="If this report stopped mid-sentence, click to seamlessly continue & complete remaining sections"
                        >
                          <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                          Continue / Complete Report
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            const nl = String.fromCharCode(10);
                            const qaAppendix =
                              activeReportComments.length > 0
                                ? `${nl}${nl}---${nl}## Report Discussion & Q&A${nl}` +
                                  activeReportComments
                                    .map(
                                      (m) =>
                                        `### ${m.role === "user" ? "Trader Question" : "Coach Answer"}${nl}${m.text}`
                                    )
                                    .join(`${nl}${nl}`)
                                : "";
                            exportDocumentToPdfWindow(
                              activeReport.title,
                              `${activeReport.horizon.toUpperCase()} Audit · ${activeReport.createdAt.slice(0, 10)}`,
                              `${activeReport.summaryMd}${qaAppendix}`
                            );
                          }}
                          className="h-8 text-xs"
                        >
                          <Printer className="mr-1.5 h-3.5 w-3.5 text-indigo-400" />
                          Export PDF
                        </Button>
                      </div>
                    </div>

                    {/* PERIOD-OVER-PERIOD COMPARISON TABLE (ACCOUNT % RISK NORMALIZED) */}
                    {Array.isArray(activeReport.telemetry?.periodComparisonBuckets) &&
                      activeReport.telemetry.periodComparisonBuckets.length > 0 && (
                        <div className="rounded-xl border border-border/60 bg-[#121521] p-3 space-y-2">
                          <div className="text-[11px] font-bold text-indigo-300">
                            Period-over-Period Telemetry Comparison (Account % Risk Normalized)
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
                                  <th className="py-1 px-2">Avg Risk %</th>
                                  <th className="py-1 px-2">0.5% / 1% / &gt;1.3%</th>
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
                                      <td className="py-1 px-2">
                                        {b.avgAccountRiskPct ?? 0}%
                                      </td>
                                      <td className="py-1 px-2 text-[10px]">
                                        {b.halfRiskTradesCount ?? 0} / {b.standardRiskTradesCount ?? 0} /{" "}
                                        <span
                                          className={
                                            (b.oversizedRiskTradesCount || 0) > 0
                                              ? "text-amber-400 font-bold"
                                              : ""
                                          }
                                        >
                                          {b.oversizedRiskTradesCount ?? b.riskDriftCount ?? 0}
                                        </span>
                                      </td>
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

                    {/* Full Report Body (Respects Compact / Tall / Full Expand height mode) */}
                    <div
                      className={`rounded-xl border border-border/50 bg-[#121521] p-5 leading-relaxed ${
                        notebookFullscreen
                          ? "max-h-none"
                          : notebookHeightMode === "standard"
                          ? "max-h-[560px] overflow-y-auto resize-y"
                          : notebookHeightMode === "tall"
                          ? "max-h-[920px] overflow-y-auto resize-y"
                          : "max-h-none"
                      }`}
                    >
                      <InteractiveCoachMarkdown value={activeReport.summaryMd} onInspectLink={handleInspectLink} />
                    </div>

                    {/* SOCRATIC ALIGNMENT & CONTRADICTION PROBES + UNIVERSAL APPEND MANAGER */}
                    <SocraticReflectionManager
                      reportId={activeReport.id}
                      initialQuestions={activeReport.reflectionQuestions || []}
                      onUpdated={() => void fetchCoachData()}
                    />

                    {/* AI RECOMMENDED MULTI-LEVEL GOALS (WITH PRE-BUILT MULTI-STEP CHECKLISTS) */}
                    {Array.isArray(activeReport.suggestedGoals) &&
                      activeReport.suggestedGoals.length > 0 && (
                        <div className="rounded-xl border border-indigo-500/30 bg-[#121521] p-4 space-y-2.5">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-indigo-300 flex items-center gap-1.5">
                              <Target className="h-4 w-4" />
                              Recommended Multi-Step Goals from This Audit
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              1-Click Add to Goal Board
                            </span>
                          </div>
                          <div className="grid gap-2.5 md:grid-cols-3">
                            {activeReport.suggestedGoals.map((sg: any, idx: number) => (
                              <div
                                key={idx}
                                className="rounded-lg border border-border/60 bg-[#0d0f14] p-3 flex flex-col justify-between space-y-2 text-xs"
                              >
                                <div className="space-y-1">
                                  <span className="rounded bg-indigo-500/20 px-1.5 py-0.5 text-[9px] font-bold uppercase text-indigo-300">
                                    {sg.horizon} · {sg.periodLabel}
                                  </span>
                                  <div className="font-bold text-foreground">{sg.title}</div>
                                  <div className="text-[11px] text-indigo-300">{sg.targetMetric}</div>
                                  {Array.isArray(sg.steps) && sg.steps.length > 0 && (
                                    <ul className="list-disc pl-4 text-[10px] text-muted-foreground space-y-0.5 pt-1">
                                      {sg.steps.map((st: string, sIdx: number) => (
                                        <li key={sIdx}>{st}</li>
                                      ))}
                                    </ul>
                                  )}
                                </div>
                                <Button className="h-7 w-full text-[11px] border-indigo-500/40 bg-indigo-500/15 text-indigo-200 hover:bg-indigo-500/25" onClick={() => void handleUpsertGoal({
                                      horizon: sg.horizon || "weekly",
                                      periodLabel: sg.periodLabel || "Current Period",
                                      title: sg.title,
                                      whyItMatters: sg.whyItMatters || `From ${activeReport.title}`,
                                      targetMetric: sg.targetMetric || "",
                                      steps: Array.isArray(sg.steps)
                                        ? sg.steps.map((sText: string, i: number) => ({
                                            id: `st_${Date.now()}_${i}`,
                                            text: sText,
                                            done: false,
                                          }))
                                        : [],
                                      status: "on_track",
                                      progressPct: 0,
                                    })
                                  }
                                >
                                  + Activate {sg.horizon} Goal
                                </Button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                    {/* ACTION POINTS TRACKER WITH INLINE EDIT, DELETE & 1-CLICK GOAL PROMOTER */}
                    <div className="rounded-xl border border-indigo-500/30 bg-[#121521] p-4 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <CheckSquare className="h-4 w-4 text-emerald-400" />
                          <span className="text-xs font-bold text-foreground">
                            Action Points &amp; Next Steps Tracker
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => void handlePushToJournal(activeReport.id, "week")}
                            className="rounded border border-indigo-500/40 bg-indigo-500/15 hover:bg-indigo-500/25 px-2 py-0.5 text-[10px] font-semibold text-indigo-200 transition"
                            title="Inject these Action Points & Active Goals as a checklist banner at the top of your current Weekly Journal Prep tab"
                          >
                            📌 Push to Weekly Journal Prep
                          </button>
                          <button
                            type="button"
                            onClick={() => void handlePushToJournal(activeReport.id, "day")}
                            className="rounded border border-emerald-500/40 bg-emerald-500/15 hover:bg-emerald-500/25 px-2 py-0.5 text-[10px] font-semibold text-emerald-200 transition"
                            title="Inject these Action Points & Active Goals into Today's Daily Journal Prep tab"
                          >
                            📌 Push to Today&apos;s Prep
                          </button>
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
                          {activeReport.actionItems.map((item) => {
                            const isEditingThis = editingActionId === item.id;
                            return (
                              <div
                                key={item.id}
                                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/50 bg-[#0d0f14] px-3 py-2 text-xs"
                              >
                                {isEditingThis ? (
                                  <div className="flex items-center gap-1.5 flex-1">
                                    <input
                                      type="text"
                                      value={editingActionText}
                                      onChange={(e) => setEditingActionText(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                          e.preventDefault();
                                          void handleSaveEditedAction(activeReport.id, item.id);
                                        } else if (e.key === "Escape") {
                                          setEditingActionId(null);
                                        }
                                      }}
                                      className="h-7 flex-1 rounded border border-indigo-500 bg-[#141722] px-2 text-xs text-foreground outline-none"
                                      autoFocus
                                    />
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void handleSaveEditedAction(activeReport.id, item.id)
                                      }
                                      className="rounded p-1 text-emerald-400 hover:bg-emerald-500/15"
                                      title="Save edit"
                                    >
                                      <Check className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setEditingActionId(null)}
                                      className="rounded p-1 text-muted-foreground hover:bg-secondary"
                                      title="Cancel"
                                    >
                                      <X className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                ) : (
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
                                )}

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
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingActionId(item.id);
                                      setEditingActionText(item.text);
                                    }}
                                    className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                                    title="Edit action point"
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void handleDeleteReportAction(activeReport.id, item.id)
                                    }
                                    className="rounded p-1 text-rose-400/70 hover:text-rose-400 hover:bg-rose-500/10"
                                    title="Delete action point"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          Add custom action items below or click &ldquo;Continue / Complete Report&rdquo; above if the report cut off before generating action points.
                        </p>
                      )}

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

                    {/* EMBEDDED REPORT Q&A DISCUSSION THREAD (BOUND DIRECTLY TO THIS REPORT!) */}
                    <div className="rounded-xl border border-emerald-500/30 bg-[#121521] p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <MessageSquare className="h-4 w-4 text-emerald-400" />
                          <span className="text-xs font-bold text-foreground">
                            Report Discussion &amp; Follow-up Q&amp;A ({activeReportComments.length})
                          </span>
                        </div>
                        <span className="text-[10px] text-muted-foreground">
                          Linked directly to this report
                        </span>
                      </div>

                      {activeReportComments.length > 0 && (
                        <div className="max-h-72 overflow-y-auto space-y-2.5 pr-1">
                          {activeReportComments.map((m) => (
                            <div
                              key={m.id}
                              className={`rounded-xl p-3 text-xs ${
                                m.role === "user"
                                  ? "bg-indigo-600/20 border border-indigo-500/30 text-foreground ml-6"
                                  : "bg-[#0d0f14] border border-border/60 text-foreground mr-2"
                              }`}
                            >
                              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
                                {m.role === "user" ? "You" : "AI Coach (Report Context)"}
                              </div>
                              <InteractiveCoachMarkdown value={m.text} onInspectLink={handleInspectLink} />
                            </div>
                          ))}
                        </div>
                      )}

                      {runningChatJob && runningChatJob.targetId === activeReport.id && (
                        <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-3 space-y-2 text-xs text-emerald-200">
                          <div className="flex items-center justify-between">
                            <span className="flex items-center gap-2 font-semibold">
                              <RefreshCw className="h-3.5 w-3.5 animate-spin text-emerald-400" />
                              Coach is answering your question on this report...
                            </span>
                            <button
                              type="button"
                              onClick={() => void handleCancelJob(runningChatJob.id)}
                              className="rounded bg-rose-500/20 border border-rose-500/40 px-2 py-0.5 text-[10px] text-rose-300"
                            >
                              Cancel
                            </button>
                          </div>
                          {runningChatJob.partialText && (
                            <div className="border-t border-emerald-500/20 pt-2 text-foreground">
                              <InteractiveCoachMarkdown value={runningChatJob.partialText} onInspectLink={handleInspectLink} />
                            </div>
                          )}
                        </div>
                      )}

                      <div className="flex items-center gap-2">
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
                          disabled={!reportQuestionInput.trim() || Boolean(runningChatJob)}
                          onClick={() =>
                            void handleSendCoachChat(reportQuestionInput, activeReport.id)
                          }
                          className="h-8 text-xs"
                        >
                          Ask Coach &rarr;
                        </Button>
                      </div>
                    </div>
                  </div>
                )
              ) : (
                /* VIEW MODE B: GENERAL ACCOUNTABILITY COACH CONVERSATION VIEWER + PDF EXPORT */
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
                          const nl = String.fromCharCode(10);
                          const transcript = chatMessages
                            .map(
                              (m) =>
                                `### ${m.role === "user" ? "Trader" : "AI Accountability Coach"} (${m.createdAt.slice(0, 16).replace("T", " ")}) — ${m.text}`
                            )
                            .join(nl + nl);
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
                          "How has my Account % Risk consistency evolved over the last 3 weeks?",
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
                            {m.role === "user" && (
                              <button
                                type="button"
                                onClick={() => void handleSaveDebriefToJournal(m.text)}
                                className="text-[10px] text-emerald-400 hover:underline font-semibold"
                                title="Append your reflection response directly into your current Weekly Journal Review tab"
                              >
                                📥 Save Reflection to Weekly Journal Review
                              </button>
                            )}
                            {m.role === "coach" && (
                              <button
                                type="button"
                                onClick={() => {
                                  const nl = String.fromCharCode(10);
                                  setEditingGoal({
                                    horizon: "weekly",
                                    periodLabel: "This Week",
                                    title:
                                      m.text
                                        .split(nl)[0]
                                        ?.replace(/^[#*-]\s*/, "")
                                        .slice(0, 90) || "",
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
                          <InteractiveCoachMarkdown value={m.text} onInspectLink={handleInspectLink} />
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
                            <InteractiveCoachMarkdown value={runningChatJob.partialText} onInspectLink={handleInspectLink} />
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

        {/* 3B. JOURNAL REFLECTION READINESS CARD (TEMPLATE-AWARE + SIDE-TAB QUICK EDITOR) */}
        {tel?.reflectionReadiness && (
          <Card className="bg-card dark:bg-[#12141d] border-border/70">
            <CardContent className="py-4 flex flex-wrap items-center justify-between gap-4 text-xs">
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <BookOpen className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                  <span className="font-bold text-foreground">
                    Journal Reflection Readiness (Template-Filtered): {tel.reflectionReadiness.readinessPct}%
                  </span>
                  <span className="text-muted-foreground">
                    ({tel.reflectionReadiness.reviewedCount} of {tel.reflectionReadiness.totalRecentJournals} recent entries have substantive user-written reviews; untouched templates are excluded)
                  </span>
                </div>
                {tel.reflectionReadiness.unreviewedJournals?.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <span className="text-[11px] font-semibold text-amber-800 dark:text-amber-300">
                      Click to open in Side-Tab Editor:
                    </span>
                    {tel.reflectionReadiness.unreviewedJournals.slice(0, 6).map((uj: any) => (
                      <button
                        key={uj.slug}
                        type="button"
                        onClick={() => void handleOpenSideJournalEditor(uj.slug)}
                        className="inline-flex items-center gap-1 rounded-md border border-amber-600/40 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10 hover:bg-amber-100 dark:hover:bg-amber-500/25 px-2 py-0.5 text-[10px] font-mono font-medium text-amber-900 dark:text-amber-200 transition"
                        title={
                          uj.isTemplateOnly
                            ? "Auto-populated template only (considered empty until you add notes)"
                            : "Has Prep notes, missing Review reflection"
                        }
                      >
                        <span>✏️ {uj.slug}</span>
                        <span className="text-[9px] text-amber-800 dark:text-amber-300/80 font-normal">
                          {uj.isTemplateOnly ? "(Template Only)" : "(Needs Review)"}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const targetSlug =
                      tel.reflectionReadiness.unreviewedJournals?.[0]?.slug ||
                      selectableJournals[0]?.slug ||
                      `week-${new Date().toISOString().slice(0, 10)}`;
                    void handleOpenSideJournalEditor(targetSlug);
                  }}
                  className="h-8 text-xs font-semibold border-emerald-600/40 dark:border-emerald-500/40 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-500/20"
                >
                  <BookOpen className="mr-1.5 h-3.5 w-3.5" />
                  Open Journal Side-Tab Editor
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void handlePushToJournal(activeReport?.id, "week")}
                  className="h-8 text-xs font-semibold border-indigo-600/40 dark:border-indigo-500/40 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-800 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-500/20"
                >
                  📌 Push Active Focus Rules to Weekly Journal
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
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
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => setOpen(true)} className="h-8 text-xs font-semibold">
                <Plus className="mr-1 h-3.5 w-3.5" />
                Add Routine
              </Button>
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
            </div>
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
                <span>Report Generation &amp; Queue Manager — Period Timing, Scope &amp; Overnight Sleep</span>
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-xl border border-indigo-500/30 bg-[#121521] p-3">
                <Field label="Report Type (End-of-Period Final vs Mid-Period Check-In)">
                  <OptionSelect
                    className={fieldClass}
                    value={reportStyle}
                    onValueChange={(v) => setReportStyle(v as any)}
                  >
                    <option value="auto">🔄 Smart Auto (Detects End-of-Period vs Mid-Period)</option>
                    <option value="end_of_period">🏁 Force End-of-Period Final Audit (Full Review)</option>
                    <option value="mid_period">📊 Force Mid-Period Progress Check-In (Tactical Pulse)</option>
                  </OptionSelect>
                </Field>

                <Field label="Target Period Window (Compared vs Prior 3 Periods)">
                  <OptionSelect
                    className={fieldClass}
                    value={String(periodOffset)}
                    onValueChange={(v) => setPeriodOffset(Number(v))}
                  >
                    <option value="0">Current Active Period (This Week / Month / Quarter)</option>
                    <option value="1">Last Completed Period (Missed Sunday/Month-End? Run W-1 / M-1)</option>
                    <option value="2">2 Periods Ago (W-2 / M-2 vs Prior 3 Periods)</option>
                    <option value="3">3 Periods Ago (W-3 / M-3 vs Prior 3 Periods)</option>
                  </OptionSelect>
                </Field>
              </div>

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
                            {t.accountRiskPct && (
                              <span className="text-[10px] text-indigo-300">
                                Risked {t.accountRiskPct}% Acct
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

              <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-border/40">
                <label className="flex items-center gap-2 cursor-pointer text-xs text-amber-200 font-medium">
                  <Checkbox
                    checked={autoStopAfterQueue}
                    onCheckedChange={(c) => void handleToggleAutoStopServer(c === true)}
                  />
                  <span>
                    🌙 Auto-stop KoboldCpp server when queue finishes (allows desktop PC to sleep overnight)
                  </span>
                </label>

                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setScopeModalOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
                    onClick={() => {
                      setScopeModalOpen(false);
                      void handleQueueBatchAudits(["weekly", "monthly", "quarterly"]);
                    }}
                  >
                    ⚡ Queue W + M + Q with These Settings
                  </Button>
                  <Button
                    size="sm"
                    onClick={() =>
                      void handleGenerateAudit(scopeHorizon, {
                        selectedJournalSlugs,
                        selectedTradeKeys,
                        includeTabs,
                        thinkingMode,
                        reportStyle,
                        periodOffset,
                        stopServerAfterQueue: autoStopAfterQueue,
                        customFocusPrompt,
                      })
                    }
                  >
                    <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                    Run / Queue {scopeHorizon} Report
                  </Button>
                </div>
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
                  placeholder="e.g., Risk strictly 0.5%–1.0% of account per trade; stop after -2%"
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
              <div className="space-y-2 rounded-xl border border-border/60 bg-[#0d0f14] p-3">
                <div className="font-semibold text-foreground">
                  Multi-Step Milestones / Checklist (Check off as you work toward this goal)
                </div>
                {Array.isArray(editingGoal.steps) && editingGoal.steps.length > 0 && (
                  <div className="space-y-1">
                    {editingGoal.steps.map((st, idx) => (
                      <div
                        key={st.id || idx}
                        className="flex items-center justify-between gap-2 rounded bg-[#141722] px-2.5 py-1.5 text-xs"
                      >
                        <span className="text-foreground">
                          {idx + 1}. {st.text}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setEditingGoal((prev) => ({
                              ...prev,
                              steps: (prev.steps || []).filter((_, i) => i !== idx),
                            }))
                          }
                          className="text-rose-400 hover:text-rose-300"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <input
                    className={fieldClass}
                    value={modalNewStepText}
                    onChange={(e) => setModalNewStepText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && modalNewStepText.trim()) {
                        e.preventDefault();
                        const clean = modalNewStepText.trim();
                        setModalNewStepText("");
                        setEditingGoal((prev) => ({
                          ...prev,
                          steps: [
                            ...(prev.steps || []),
                            { id: `st_${Date.now()}`, text: clean, done: false },
                          ],
                        }));
                      }
                    }}
                    placeholder="Add a concrete step (e.g., Log pre-session bias before 08:00 NY)..."
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const clean = modalNewStepText.trim();
                      if (!clean) return;
                      setModalNewStepText("");
                      setEditingGoal((prev) => ({
                        ...prev,
                        steps: [
                          ...(prev.steps || []),
                          { id: `st_${Date.now()}`, text: clean, done: false },
                        ],
                      }));
                    }}
                  >
                    + Step
                  </Button>
                </div>
              </div>

              <Button
                disabled={!editingGoal.title?.trim()}
                onClick={() => void handleUpsertGoal(editingGoal)}
              >
                Save Goal
              </Button>
            </div>
          </DialogContent>
        </Dialog>


        {/* SIDE-BY-SIDE EVIDENCE INSPECTOR MODAL FOR CLICKED JOURNAL & TRADE LINKS */}
        <Dialog open={evidenceModalOpen} onOpenChange={setEvidenceModalOpen}>
          <DialogContent className="max-w-3xl max-h-[88vh] overflow-y-auto">
            <DialogHeader>
              <div className="flex flex-wrap items-center justify-between gap-2 pr-6">
                <DialogTitle className="text-sm font-bold flex items-center gap-2">
                  <span>
                    {evidenceData?.evidenceType === "trades" ? "📈 Trade Evidence Inspector" : "📓 Journal Evidence Inspector"}
                  </span>
                </DialogTitle>
                {evidenceData?.href && (
                  <a
                    href={evidenceData.href}
                    className="inline-flex items-center gap-1 rounded-lg border border-indigo-500/40 bg-indigo-500/15 hover:bg-indigo-500/25 px-2.5 py-1 text-xs font-semibold text-indigo-200 transition"
                  >
                    <span>Open Full Page in App &nearr;</span>
                  </a>
                )}
              </div>
            </DialogHeader>

            {evidenceLoading ? (
              <div className="py-12 text-center text-xs text-muted-foreground animate-pulse">
                Loading referenced record from SQLite...
              </div>
            ) : evidenceData?.error ? (
              <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-4 text-xs text-rose-300">
                {evidenceData.error}
              </div>
            ) : evidenceData?.evidenceType === "journal" && evidenceData?.journal ? (
              <div className="space-y-4 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 bg-[#0d0f14] p-3">
                  <div>
                    <span className="rounded bg-indigo-500/20 px-1.5 py-0.5 text-[10px] font-bold uppercase text-indigo-300 mr-2">
                      {evidenceData.journal.periodType}
                    </span>
                    <span className="font-bold text-sm text-foreground">
                      {evidenceData.journal.title}
                    </span>
                    <span className="ml-2 font-mono text-muted-foreground">
                      ({evidenceData.journal.slug})
                    </span>
                  </div>
                  {evidenceData.journal.rating != null && (
                    <span className="rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-bold text-emerald-300">
                      Process Score: {evidenceData.journal.rating}%
                    </span>
                  )}
                </div>

                {evidenceData.journal.lessonsLearned && (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                    <div className="text-[10px] font-bold uppercase text-amber-300 mb-1">
                      Key Lesson Learned
                    </div>
                    <div className="text-foreground">{evidenceData.journal.lessonsLearned}</div>
                  </div>
                )}

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-xl border border-border/60 bg-[#0d0f14] p-3 space-y-2 max-h-96 overflow-y-auto">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-indigo-400 border-b border-border/40 pb-1">
                      Prep / Market Forecast Tab
                    </div>
                    <InteractiveCoachMarkdown value={evidenceData.journal.prepMd} />
                  </div>
                  <div className="rounded-xl border border-border/60 bg-[#0d0f14] p-3 space-y-2 max-h-96 overflow-y-auto">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-400 border-b border-border/40 pb-1">
                      End-of-Period Review &amp; Psychology Tab
                    </div>
                    <InteractiveCoachMarkdown value={evidenceData.journal.reviewMd} />
                  </div>
                </div>
              </div>
            ) : evidenceData?.evidenceType === "trades" ? (
              <div className="space-y-3 text-xs">
                {(!evidenceData.trades || evidenceData.trades.length === 0) ? (
                  <div className="py-8 text-center text-muted-foreground">
                    No matching closed trades found for {evidenceData.symbol} on {evidenceData.fromDate}.
                  </div>
                ) : (
                  evidenceData.trades.map((t: any) => (
                    <div
                      key={t.key}
                      className="rounded-xl border border-border/60 bg-[#0d0f14] p-3.5 space-y-2"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm text-foreground">{t.symbol}</span>
                          <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-bold uppercase">
                            {t.direction}
                          </span>
                          <span className="font-mono text-muted-foreground">
                            Qty: {t.quantity} · {String(t.openedAt || "").slice(0, 16).replace("T", " ")}
                          </span>
                        </div>
                        <span
                          className={`font-mono text-sm font-bold ${
                            Number(t.netPnl) >= 0 ? "text-emerald-400" : "text-rose-400"
                          }`}
                        >
                          {Number(t.netPnl) >= 0
                            ? `+$${Number(t.netPnl).toFixed(2)}`
                            : `-$${Math.abs(Number(t.netPnl)).toFixed(2)}`}
                          {t.realizedR != null ? ` (${t.realizedR}R)` : ""}
                        </span>
                      </div>
                      {t.mistakes?.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          <span className="text-rose-400 font-semibold">Mistakes:</span>
                          {t.mistakes.map((m: string, i: number) => (
                            <span
                              key={i}
                              className="rounded bg-rose-500/15 border border-rose-500/30 px-1.5 py-0.5 text-[10px] text-rose-300"
                            >
                              {m}
                            </span>
                          ))}
                        </div>
                      )}
                      {t.notes && (
                        <div className="rounded border border-border/40 bg-[#141722] p-2.5 text-muted-foreground space-y-1">
                          <div className="text-[10px] font-bold uppercase text-indigo-400">Setup &amp; Execution Notes</div>
                          <div>{t.notes}</div>
                        </div>
                      )}
                      {t.reviewNotes && (
                        <div className="rounded border border-emerald-500/30 bg-emerald-950/15 p-2.5 text-foreground/90 space-y-1">
                          <div className="text-[10px] font-bold uppercase text-emerald-400">Post-Trade Review &amp; Reflection Q&amp;A</div>
                          <div>{t.reviewNotes}</div>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            ) : null}
          </DialogContent>
        </Dialog>


        {/* SLIDE-OVER SIDE-TAB JOURNAL QUICK EDITOR */}
        {sideJournalOpen && (
          <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col border-l border-border bg-[#11131c] shadow-2xl">
            <div className="flex items-center justify-between border-b border-border/60 bg-[#161925] px-4 py-3">
              <div className="flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-emerald-400" />
                <div>
                  <h3 className="text-sm font-bold text-foreground">
                    Quick Journal Side-Tab Editor
                  </h3>
                  <p className="text-[10px] text-muted-foreground">
                    Add reflections, takeaways, or calibrated process scores without leaving your AI Notebook
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {sideJournalSlug && (
                  <a
                    href={`/journal?slug=${encodeURIComponent(sideJournalSlug)}`}
                    className="rounded border border-indigo-500/40 bg-indigo-500/15 px-2 py-1 text-[11px] font-semibold text-indigo-200 hover:bg-indigo-500/25"
                  >
                    Full Editor &nearr;
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => setSideJournalOpen(false)}
                  className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                >
                  <X className="h-4 w-4"/>
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-muted-foreground">
                  Select Journal Entry to View / Update
                </label>
                <select
                  value={sideJournalSlug}
                  onChange={(e) => void handleOpenSideJournalEditor(e.target.value)}
                  className="h-8 w-full rounded-lg border border-border/70 bg-[#0d0f14] px-2.5 text-xs text-foreground outline-none"
                >
                  {selectableJournals.map((j) => (
                    <option key={j.slug} value={j.slug}>
                      [{j.periodType.toUpperCase()}] {j.title} ({j.slug}){" "}
                      {!j.hasPrep && !j.hasReview ? "— Empty Template" : !j.hasReview ? "— Missing Review" : "— Reviewed ✓"}
                    </option>
                  ))}
                </select>
              </div>

              {sideJournalLoading ? (
                <div className="py-12 text-center text-muted-foreground animate-pulse">
                  Loading journal entry...
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold text-foreground">
                        Calibrated Process Score (0–100%)
                      </label>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={sideJournalRating}
                        onChange={(e) => setSideJournalRating(e.target.value)}
                        placeholder="e.g. 55 (Avoid default 80%)"
                        className="h-8 w-full rounded-lg border border-border/70 bg-[#0d0f14] px-2.5 text-xs text-foreground outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold text-foreground">
                        Key Takeaway / Lesson Learned
                      </label>
                      <input
                        type="text"
                        value={sideJournalLessons}
                        onChange={(e) => setSideJournalLessons(e.target.value)}
                        placeholder="1-sentence core takeaway from this period..."
                        className="h-8 w-full rounded-lg border border-border/70 bg-[#0d0f14] px-2.5 text-xs text-foreground outline-none focus:border-indigo-500"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-emerald-400">
                      + Append to End-of-Period Review &amp; Psychology Tab
                    </label>
                    <textarea
                      rows={4}
                      value={sideJournalNewRev}
                      onChange={(e) => setSideJournalNewRev(e.target.value)}
                      placeholder="Write your honest post-session or end-of-week reflection here (e.g. Did I follow my rules? Where did emotions leak?)..."
                      className="w-full rounded-lg border border-border/70 bg-[#0d0f14] p-2.5 text-xs text-foreground outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-indigo-400">
                      + Append to Prep / Forecast Tab
                    </label>
                    <textarea
                      rows={3}
                      value={sideJournalNewPrep}
                      onChange={(e) => setSideJournalNewPrep(e.target.value)}
                      placeholder="Optional pre-session note or thesis adjustment..."
                      className="w-full rounded-lg border border-border/70 bg-[#0d0f14] p-2.5 text-xs text-foreground outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div className="flex justify-end gap-2 pt-1">
                    <Button
                      size="sm"
                      onClick={() => void handleSaveSideJournal()}
                      disabled={sideJournalLoading}
                    >
                      Save to Journal Entry
                    </Button>
                  </div>

                  <div className="border-t border-border/50 pt-3 space-y-3">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                      Current Recorded Content in {sideJournalSlug}
                    </div>
                    <div className="rounded-lg border border-border/50 bg-[#0d0f14] p-3 max-h-48 overflow-y-auto space-y-1">
                      <div className="text-[10px] font-bold text-emerald-400">Review Tab:</div>
                      <InteractiveCoachMarkdown value={sideJournalRevMd} />
                    </div>
                    <div className="rounded-lg border border-border/50 bg-[#0d0f14] p-3 max-h-48 overflow-y-auto space-y-1">
                      <div className="text-[10px] font-bold text-indigo-400">Prep Tab:</div>
                      <InteractiveCoachMarkdown value={sideJournalPrepMd} />
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

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

      <AuditManagerModal
        open={auditManagerOpen}
        onClose={() => setAuditManagerOpen(false)}
        coachData={coachData}
        onJobStarted={() => void fetchCoachData()}
      />
    </div>
  );
}