"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { AuditManagerModal } from "@/components/audit-manager-modal";
import { SocraticReflectionManager } from "@/components/socratic-reflection-manager";
import {
  Folder,
  MessageSquare,
  MessageSquarePlus,
  Sparkles,
  Search,
  Trash2,
  Printer,
  ChevronDown,
  ChevronRight,
  CheckSquare,
  Send,
  RefreshCw,
  Square,
  PanelLeftClose,
  PanelLeftOpen,
  Target,
} from "lucide-react";

type AiFolderKey =
  | "all"
  | "optimizer"
  | "weekly"
  | "monthly"
  | "quarterly"
  | "yearly"
  | "custom"
  | "chats";

function exportToPdf(title: string, subtitle: string, md: string) {
  const win = window.open("", "_blank", "width=900,height=1000");
  if (!win) return;
  const escaped = md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/^### (.*)$/gm, "<h3>$1</h3>")
    .replace(/^## (.*)$/gm, "<h2>$1</h2>")
    .replace(/^# (.*)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .split("\n")
    .join("<br/>");
  win.document.write(
    `<html><head><title>${title}</title><style>body{font-family:sans-serif;padding:36px;line-height:1.6;max-width:820px;margin:0 auto;}</style></head><body><h1>${title}</h1><p style="color:#64748b;font-size:12px;">${subtitle}</p><div>${escaped}</div><script>setTimeout(()=>window.print(),300);</script></body></html>`
  );
  win.document.close();
}

export function AiNotebookPanel() {
  const searchParams = useSearchParams();
  const initialFolder = (searchParams.get("folder") as AiFolderKey) || "all";

  const [coachData, setCoachData] = useState<any>(null);
  const [activeFolder, setActiveFolder] = useState<AiFolderKey>(initialFolder);
  const [search, setSearch] = useState("");
  const [activeDocType, setActiveDocType] = useState<"report" | "chat">("report");
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string>("");
  const [showReasoning, setShowReasoning] = useState(false);
  const [foldersCollapsed, setFoldersCollapsed] = useState(false);
  const [auditManagerOpen, setAuditManagerOpen] = useState(false);
  const [reportQuestionInput, setReportQuestionInput] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [newActionText, setNewActionText] = useState("");

  const fetchCoachData = useCallback(
    async (overrideSessId?: string) => {
      try {
        const sess = overrideSessId !== undefined ? overrideSessId : selectedSessionId;
        const qs = sess ? `?sessionId=${encodeURIComponent(sess)}` : "";
        const res = await fetch(`/api/ai/coach${qs}`);
        const json = await res.json();
        if (json.ok) {
          setCoachData(json);
          if (!selectedReportId && json.reports?.length > 0) {
            const firstMatch =
              initialFolder && initialFolder !== "all" && initialFolder !== "chats"
                ? json.reports.find((r: any) => r.horizon === initialFolder) || json.reports[0]
                : json.reports[0];
            if (firstMatch) setSelectedReportId(firstMatch.id);
          }
          if (!selectedSessionId && json.activeSessionId) {
            setSelectedSessionId(json.activeSessionId);
          }
        }
      } catch {}
    },
    [selectedReportId, selectedSessionId, initialFolder]
  );

  useEffect(() => {
    void fetchCoachData();
  }, [fetchCoachData]);

  const reports: any[] = coachData?.reports || [];
  const chatSessions: any[] = coachData?.chatSessions || [];
  const chatMessages: any[] = coachData?.chatMessages || [];
  const reportCommentsMap: Record<string, any[]> = coachData?.reportCommentsMap || {};
  const activeJobs: any[] = coachData?.activeJobs || [];
  const runningChatJob = activeJobs.find((j) => j.jobType === "chat");

  const folderCounts = useMemo(
    () => ({
      all: reports.length + chatSessions.length,
      optimizer: reports.filter((r) => r.horizon === "optimizer").length,
      weekly: reports.filter((r) => r.horizon === "weekly").length,
      monthly: reports.filter((r) => r.horizon === "monthly").length,
      quarterly: reports.filter((r) => r.horizon === "quarterly").length,
      yearly: reports.filter((r) => r.horizon === "yearly").length,
      custom: reports.filter((r) => r.horizon === "custom").length,
      chats: chatSessions.length,
    }),
    [reports, chatSessions]
  );

  const items = useMemo(() => {
    const q = search.trim().toLowerCase();
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
        const doneCount = (r.actionItems || []).filter((a: any) => a.done).length;
        const totalActions = (r.actionItems || []).length;
        const qCount = (reportCommentsMap[r.id] || []).length;
        return {
          kind: "report" as const,
          id: r.id,
          title: r.title,
          badge: r.horizon === "optimizer" ? "OPTIMIZER" : String(r.horizon).toUpperCase(),
          sub: `${totalActions > 0 ? `${doneCount}/${totalActions} actions` : r.createdAt.slice(0, 10)}${
            qCount > 0 ? ` · ${qCount} Q&A` : ""
          }`,
          updatedAt: r.createdAt,
        };
      });

    const cItems = chatSessions
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

    return [...repItems, ...cItems].sort((a, b) =>
      String(b.updatedAt).localeCompare(String(a.updatedAt))
    );
  }, [reports, chatSessions, reportCommentsMap, activeFolder, search]);

  const activeReport =
    reports.find((r) => r.id === selectedReportId) ||
    reports.find((r) => activeFolder === "all" || r.horizon === activeFolder) ||
    reports[0] ||
    null;

  const activeReportComments = activeReport
    ? reportCommentsMap[activeReport.id] || []
    : [];

  const handleDeleteReport = async (repId: string) => {
    if (!window.confirm("Delete this AI report from your notebook?")) return;
    await fetch("/api/ai/coach", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete_report", reportId: repId }),
    });
    if (selectedReportId === repId) setSelectedReportId(null);
    await fetchCoachData();
  };

  const handleDeleteChat = async (sessId: string) => {
    if (!window.confirm("Delete this chat thread?")) return;
    await fetch("/api/ai/coach", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete_chat_session", sessionId: sessId }),
    });
    setSelectedSessionId("");
    await fetchCoachData("");
  };

  const handleNewChat = async () => {
    const res = await fetch("/api/ai/coach", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "new_chat_session" }),
    });
    const json = await res.json();
    if (json.ok && json.sessionId) {
      setSelectedSessionId(json.sessionId);
      setActiveDocType("chat");
      await fetchCoachData(json.sessionId);
    }
  };

  const handleSendChat = async (msgText: string, linkedReportId?: string) => {
    const clean = msgText.trim();
    if (!clean) return;
    if (linkedReportId) setReportQuestionInput("");
    else setChatInput("");

    await fetch("/api/ai/coach", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "chat_coach",
        sessionId: linkedReportId ? "" : selectedSessionId,
        reportId: linkedReportId || "",
        message: clean,
      }),
    });
    await fetchCoachData();
  };

  const handleToggleAction = async (reportId: string, actionId: string, done: boolean) => {
    await fetch("/api/ai/coach", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "toggle_report_action", reportId, actionId, done }),
    });
    await fetchCoachData();
  };

  const handleAddAction = async (reportId: string, horizon: string) => {
    const clean = newActionText.trim();
    if (!clean) return;
    setNewActionText("");
    await fetch("/api/ai/coach", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "add_report_action", reportId, text: clean, horizon }),
    });
    await fetchCoachData();
  };

  return (
    <div className="p-3 sm:p-4">
      <Card className="bg-[#0d0f14] border-border/70 overflow-hidden">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-[#141722] px-3 py-2 text-xs">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setFoldersCollapsed((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-[#0d0f14] hover:bg-secondary px-2.5 py-1 text-[11px] font-medium text-foreground transition"
            >
              {foldersCollapsed ? (
                <PanelLeftOpen className="h-3.5 w-3.5 text-indigo-400" />
              ) : (
                <PanelLeftClose className="h-3.5 w-3.5 text-indigo-400" />
              )}
              <span>{foldersCollapsed ? "Show Folders" : "Hide Folders"}</span>
            </button>
            <span className="text-[11px] text-muted-foreground">
              Unified AI Notebook — Behavioral Audits, Optimizer Reports &amp; Coach Chats
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void handleNewChat()}
              className="h-7 text-xs"
            >
              <MessageSquarePlus className="mr-1.5 h-3.5 w-3.5 text-emerald-400" />
              New Coach Chat
            </Button>
            <Button
              size="sm"
              onClick={() => setAuditManagerOpen(true)}
              className="h-7 text-xs bg-indigo-600 hover:bg-indigo-500 text-white font-semibold"
            >
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              Report Manager
            </Button>
          </div>
        </div>

        {/* 3-Pane Workspace */}
        <div className="flex flex-col lg:flex-row min-h-[760px]">
          {/* Pane 1: Folders */}
          {!foldersCollapsed && (
            <div className="w-full lg:w-56 shrink-0 border-b lg:border-b-0 lg:border-r border-border/50 bg-[#11131c] p-3 space-y-1">
              <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                AI Notebook Folders
              </div>
              {(
                [
                  { id: "all", label: "All Notes & Audits", count: folderCounts.all },
                  { id: "optimizer", label: "Optimizer Reports", count: folderCounts.optimizer },
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
                    else if (f.id !== "all") {
                      setActiveDocType("report");
                      const firstInFolder = reports.find((r) => r.horizon === f.id);
                      if (firstInFolder) setSelectedReportId(firstInFolder.id);
                    }
                  }}
                  className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-xs font-medium transition ${
                    activeFolder === f.id
                      ? "bg-secondary text-foreground font-bold border border-border/80"
                      : "text-muted-foreground hover:bg-secondary/40 hover:text-foreground"
                  }`}
                >
                  <span className="flex items-center gap-2 truncate">
                    {f.id === "chats" ? (
                      <MessageSquare className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                    ) : f.id === "optimizer" ? (
                      <Target className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                    ) : (
                      <Folder className="h-3.5 w-3.5 text-indigo-400 shrink-0" />
                    )}
                    <span className="truncate">{f.label}</span>
                  </span>
                  <span className="rounded-full bg-black/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {f.count}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Pane 2: Document List */}
          <div className="w-full lg:w-72 shrink-0 border-b lg:border-b-0 lg:border-r border-border/50 bg-[#0f1119] flex flex-col">
            <div className="p-3 border-b border-border/50">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search AI reports & chats..."
                  className="h-8 w-full rounded-lg border border-border/70 bg-[#161925] pl-8 pr-2.5 text-xs text-foreground outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <div className="flex-1 max-h-[700px] overflow-y-auto divide-y divide-border/30">
              {items.length === 0 ? (
                <div className="p-6 text-center text-xs text-muted-foreground">
                  No reports in this folder yet.
                </div>
              ) : (
                items.map((item) => {
                  const isSel =
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
                        isSel
                          ? "bg-indigo-600/15 border-l-2 border-l-indigo-400"
                          : "hover:bg-secondary/30"
                      }`}
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                              item.badge === "OPTIMIZER"
                                ? "bg-amber-500/15 text-amber-300 border border-amber-500/30"
                                : item.kind === "chat"
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
                          if (item.kind === "report") void handleDeleteReport(item.id);
                          else void handleDeleteChat(item.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 rounded p-1 text-rose-400/70 hover:text-rose-400"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Pane 3: Reader & Discussion */}
          <div className="flex-1 min-w-0 p-4 overflow-y-auto space-y-4">
            {activeDocType === "report" ? (
              !activeReport ? (
                <div className="py-20 text-center text-xs text-muted-foreground">
                  Select a report on the left, or run an AI Pattern Audit from Reports → Edge &amp; R Optimizer.
                </div>
              ) : (
                <div className="space-y-4">
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

                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        exportToPdf(
                          activeReport.title,
                          `${activeReport.horizon.toUpperCase()} Report · ${activeReport.createdAt.slice(0, 10)}`,
                          activeReport.summaryMd
                        )
                      }
                      className="h-8 text-xs"
                    >
                      <Printer className="mr-1.5 h-3.5 w-3.5 text-indigo-400" />
                      Export PDF
                    </Button>
                  </div>

                  {activeReport.reasoningTrace && (
                    <div className="rounded-xl border border-indigo-500/30 bg-[#121521] overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setShowReasoning((v) => !v)}
                        className="flex w-full items-center justify-between px-3 py-2 text-xs font-semibold text-indigo-300 hover:bg-indigo-500/10"
                      >
                        <span className="flex items-center gap-1.5">
                          {showReasoning ? (
                            <ChevronDown className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5" />
                          )}
                          <span>View AI Chain-of-Thought Reasoning Trace</span>
                        </span>
                      </button>
                      {showReasoning && (
                        <pre className="max-h-60 overflow-y-auto border-t border-indigo-500/20 p-3 text-[11px] font-mono whitespace-pre-wrap text-muted-foreground">
                          {activeReport.reasoningTrace}
                        </pre>
                      )}
                    </div>
                  )}

                  <div className="rounded-xl border border-border/50 bg-[#121521] p-5 whitespace-pre-wrap text-xs leading-relaxed text-foreground/95">
                    {activeReport.summaryMd}
                  </div>

                  {activeReport.reflectionQuestions &&
                    activeReport.reflectionQuestions.length > 0 && (
                      <SocraticReflectionManager
                        reportId={activeReport.id}
                        initialQuestions={activeReport.reflectionQuestions}
                        onUpdated={() => void fetchCoachData()}
                      />
                    )}

                  {/* Action Items */}
                  <div className="rounded-xl border border-indigo-500/30 bg-[#121521] p-4 space-y-3">
                    <div className="flex items-center gap-2 text-xs font-bold text-foreground">
                      <CheckSquare className="h-4 w-4 text-emerald-400" />
                      <span>Action Points &amp; Next Steps</span>
                    </div>
                    <div className="space-y-1.5">
                      {(activeReport.actionItems || []).map((item: any) => (
                        <label
                          key={item.id}
                          className="flex items-start gap-2.5 rounded-lg border border-border/50 bg-[#0d0f14] px-3 py-2 text-xs cursor-pointer"
                        >
                          <Checkbox
                            checked={item.done}
                            onCheckedChange={(c) =>
                              void handleToggleAction(activeReport.id, item.id, c === true)
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
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={newActionText}
                        onChange={(e) => setNewActionText(e.target.value)}
                        placeholder="Add an action item to this report..."
                        className="h-8 flex-1 rounded-lg border border-border/70 bg-[#0d0f14] px-2.5 text-xs text-foreground outline-none"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs"
                        onClick={() =>
                          void handleAddAction(activeReport.id, activeReport.horizon || "weekly")
                        }
                      >
                        + Add
                      </Button>
                    </div>
                  </div>

                  {/* Report Follow-up Q&A */}
                  <div className="rounded-xl border border-emerald-500/30 bg-[#121521] p-4 space-y-3">
                    <div className="text-xs font-bold text-foreground flex items-center gap-2">
                      <MessageSquare className="h-4 w-4 text-emerald-400" />
                      <span>Report Follow-up Q&amp;A ({activeReportComments.length})</span>
                    </div>
                    {activeReportComments.map((m: any) => (
                      <div
                        key={m.id}
                        className={`rounded-xl p-3 text-xs whitespace-pre-wrap ${
                          m.role === "user"
                            ? "bg-indigo-600/20 border border-indigo-500/30 ml-6"
                            : "bg-[#0d0f14] border border-border/60 mr-2"
                        }`}
                      >
                        {m.text}
                      </div>
                    ))}
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={reportQuestionInput}
                        onChange={(e) => setReportQuestionInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && reportQuestionInput.trim()) {
                            e.preventDefault();
                            void handleSendChat(reportQuestionInput, activeReport.id);
                          }
                        }}
                        placeholder={`Ask a follow-up question about "${activeReport.title}"...`}
                        className="h-8 flex-1 rounded-lg border border-border/70 bg-[#0d0f14] px-3 text-xs text-foreground outline-none"
                      />
                      <Button
                        size="sm"
                        disabled={!reportQuestionInput.trim() || Boolean(runningChatJob)}
                        onClick={() => void handleSendChat(reportQuestionInput, activeReport.id)}
                        className="h-8 text-xs"
                      >
                        Ask Coach →
                      </Button>
                    </div>
                  </div>
                </div>
              )
            ) : (
              /* Coach Chat View */
              <div className="flex flex-col h-full justify-between space-y-4">
                <div className="flex-1 min-h-[460px] overflow-y-auto space-y-3 rounded-xl border border-border/50 bg-[#121521] p-4 text-xs">
                  {chatMessages.map((m: any) => (
                    <div
                      key={m.id}
                      className={`rounded-xl p-3 whitespace-pre-wrap ${
                        m.role === "user"
                          ? "bg-indigo-600/20 border border-indigo-500/30 ml-8"
                          : "bg-[#0d0f14] border border-border/60 mr-4"
                      }`}
                    >
                      {m.text}
                    </div>
                  ))}
                  {runningChatJob && (
                    <div className="flex items-center gap-2 text-xs text-indigo-300">
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      <span>Coach is replying...</span>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && chatInput.trim()) {
                        e.preventDefault();
                        void handleSendChat(chatInput);
                      }
                    }}
                    placeholder="Message your AI Coach..."
                    className="h-9 flex-1 rounded-lg border border-border/70 bg-[#121521] px-3 text-xs text-foreground outline-none"
                  />
                  <Button
                    size="sm"
                    disabled={!chatInput.trim() || Boolean(runningChatJob)}
                    onClick={() => void handleSendChat(chatInput)}
                  >
                    <Send className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </Card>

      <AuditManagerModal
        open={auditManagerOpen}
        onClose={() => setAuditManagerOpen(false)}
        coachData={coachData}
        onJobStarted={() => void fetchCoachData()}
      />
    </div>
  );
}
