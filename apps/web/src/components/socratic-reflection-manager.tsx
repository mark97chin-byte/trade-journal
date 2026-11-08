"use client";

import React, { useEffect, useState } from "react";
import {
  HelpCircle,
  Trash2,
  Plus,
  Check,
  Send,
  BookOpen,
  ExternalLink,
  Pencil,
  X,
  Sparkles,
  CheckSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

export interface ReportReflectionQuestion {
  id: string;
  category: "htf_ltf_alignment" | "contradiction_probe" | "execution_sizing" | "psychology";
  contextSummary: string;
  question: string;
  answer: string;
  appendedTo?: string[];
}

interface AppendTargetsCatalog {
  weekTargets: Array<{ slug: string; label: string; badge?: string }>;
  monthTargets: Array<{ slug: string; label: string; badge?: string }>;
  quarterYearTargets: Array<{ slug: string; label: string }>;
  dayTargets: Array<{ slug: string; label: string }>;
  tradeTargets: Array<{ key: string; label: string }>;
  notebookTargets: Array<{ id: string; label: string }>;
}

const CATEGORY_BADGES: Record<
  ReportReflectionQuestion["category"],
  { label: string; cls: string }
> = {
  htf_ltf_alignment: {
    label: "HTF ↔ LTF Alignment",
    cls: "border-indigo-500/40 bg-indigo-500/15 text-indigo-300",
  },
  contradiction_probe: {
    label: "Contradiction Probe",
    cls: "border-amber-500/40 bg-amber-500/15 text-amber-300",
  },
  execution_sizing: {
    label: "Execution & Optimal R",
    cls: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
  },
  psychology: {
    label: "Mindset & Selectivity",
    cls: "border-purple-500/40 bg-purple-500/15 text-purple-300",
  },
};

export function SocraticReflectionManager({
  reportId,
  initialQuestions = [],
  onUpdated,
}: {
  reportId: string;
  initialQuestions?: ReportReflectionQuestion[];
  onUpdated?: () => void;
}) {
  const [questions, setQuestions] = useState<ReportReflectionQuestion[]>(initialQuestions);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editingQId, setEditingQId] = useState<string | null>(null);
  const [editingQText, setEditingQText] = useState<string>("");
  const [addingCustom, setAddingCustom] = useState<boolean>(false);
  const [customQText, setCustomQText] = useState<string>("");
  const [customQCategory, setCustomQCategory] =
    useState<ReportReflectionQuestion["category"]>("htf_ltf_alignment");

  const [catalog, setCatalog] = useState<AppendTargetsCatalog | null>(null);
  const [destGroup, setDestGroup] = useState<
    "week" | "month" | "quarter_year" | "day" | "trade" | "notebook"
  >("week");
  const [targetId, setTargetId] = useState<string>("");
  const [targetTab, setTargetTab] = useState<"review" | "prep" | "setup">("review");
  const [newNoteTitle, setNewNoteTitle] = useState<string>("");

  const [busyId, setBusyId] = useState<string | null>(null);
  const [appendBanner, setAppendBanner] = useState<{
    message: string;
    url?: string;
    badge?: string;
  } | null>(null);

  useEffect(() => {
    setQuestions(initialQuestions || []);
    setSelectedIds(
      (initialQuestions || [])
        .filter((q) => q.answer && q.answer.trim().length > 0)
        .map((q) => q.id)
    );
  }, [reportId, initialQuestions]);

  useEffect(() => {
    fetch("/api/ai/coach", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "list_append_targets" }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d?.ok) {
          setCatalog(d);
          // Default to Current Week's Journal Review
          const curWeek = d.weekTargets?.[1]?.slug || d.weekTargets?.[0]?.slug || "";
          if (curWeek) setTargetId(curWeek);
        }
      })
      .catch(() => {});
  }, [reportId]);

  const handleGroupChange = (
    nextGroup: "week" | "month" | "quarter_year" | "day" | "trade" | "notebook"
  ) => {
    setDestGroup(nextGroup);
    if (!catalog) return;
    if (nextGroup === "week") {
      setTargetId(catalog.weekTargets?.[1]?.slug || catalog.weekTargets?.[0]?.slug || "");
      setTargetTab("review");
    } else if (nextGroup === "month") {
      setTargetId(catalog.monthTargets?.[1]?.slug || catalog.monthTargets?.[0]?.slug || "");
      setTargetTab("review");
    } else if (nextGroup === "quarter_year") {
      setTargetId(catalog.quarterYearTargets?.[0]?.slug || "");
      setTargetTab("review");
    } else if (nextGroup === "day") {
      setTargetId(catalog.dayTargets?.[1]?.slug || catalog.dayTargets?.[0]?.slug || "");
      setTargetTab("review");
    } else if (nextGroup === "trade") {
      setTargetId(catalog.tradeTargets?.[0]?.key || "");
      setTargetTab("review");
    } else if (nextGroup === "notebook") {
      setTargetId(catalog.notebookTargets?.[0]?.id || "__new__");
    }
  };

  const applyQuickPreset = (
    group: "week" | "month",
    which: "current_review" | "next_prep" | "month_review" | "month_prep"
  ) => {
    if (!catalog) return;
    setDestGroup(group);
    if (which === "current_review") {
      const curWk = catalog.weekTargets?.[1]?.slug || catalog.weekTargets?.[0]?.slug || "";
      setTargetId(curWk);
      setTargetTab("review");
    } else if (which === "next_prep") {
      const nextWk = catalog.weekTargets?.[0]?.slug || "";
      setTargetId(nextWk);
      setTargetTab("prep");
    } else if (which === "month_review") {
      const curMo = catalog.monthTargets?.[1]?.slug || catalog.monthTargets?.[0]?.slug || "";
      setTargetId(curMo);
      setTargetTab("review");
    } else if (which === "month_prep") {
      const curMo = catalog.monthTargets?.[1]?.slug || catalog.monthTargets?.[0]?.slug || "";
      setTargetId(curMo);
      setTargetTab("prep");
    }
  };

  const saveAnswerDraft = async (q: ReportReflectionQuestion, nextAnswer: string) => {
    setBusyId(q.id);
    try {
      const res = await fetch("/api/ai/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save_reflection_question",
          reportId,
          questionId: q.id,
          answer: nextAnswer,
        }),
      });
      const data = await res.json();
      if (data?.ok && Array.isArray(data.reflectionQuestions)) {
        setQuestions(data.reflectionQuestions);
        if (nextAnswer.trim() && !selectedIds.includes(q.id)) {
          setSelectedIds((prev) => [...prev, q.id]);
        }
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleSaveEditedQuestion = async (qId: string) => {
    const clean = editingQText.trim();
    if (!clean) return;
    setEditingQId(null);
    setBusyId(qId);
    try {
      const res = await fetch("/api/ai/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save_reflection_question",
          reportId,
          questionId: qId,
          question: clean,
        }),
      });
      const data = await res.json();
      if (data?.ok && Array.isArray(data.reflectionQuestions)) {
        setQuestions(data.reflectionQuestions);
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteQuestion = async (qId: string) => {
    setBusyId(qId);
    try {
      const res = await fetch("/api/ai/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete_reflection_question",
          reportId,
          questionId: qId,
        }),
      });
      const data = await res.json();
      if (data?.ok && Array.isArray(data.reflectionQuestions)) {
        setQuestions(data.reflectionQuestions);
        setSelectedIds((prev) => prev.filter((id) => id !== qId));
        onUpdated?.();
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleAddCustomQuestion = async () => {
    const clean = customQText.trim();
    if (!clean) return;
    setBusyId("add_new");
    try {
      const res = await fetch("/api/ai/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add_reflection_question",
          reportId,
          category: customQCategory,
          contextSummary: "Self-Added Socratic Reflection Prompt",
          question: clean,
        }),
      });
      const data = await res.json();
      if (data?.ok && Array.isArray(data.reflectionQuestions)) {
        setQuestions(data.reflectionQuestions);
        setCustomQText("");
        setAddingCustom(false);
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleAppendSelected = async (overrideIds?: string[]) => {
    const idsToAppend =
      overrideIds && overrideIds.length > 0
        ? overrideIds
        : selectedIds.length > 0
        ? selectedIds
        : questions.filter((q) => q.answer.trim().length > 0).map((q) => q.id);

    if (idsToAppend.length === 0) {
      window.alert(
        "Check at least one question (or write an answer) before appending to your journal."
      );
      return;
    }

    if (!targetId) {
      window.alert("Select a target journal, trade, or notebook note first.");
      return;
    }

    setBusyId("append_all");
    setAppendBanner(null);

    const targetKind: "journal" | "trade" | "notebook" =
      destGroup === "trade" ? "trade" : destGroup === "notebook" ? "notebook" : "journal";

    try {
      const res = await fetch("/api/ai/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "append_reflections_to_target",
          reportId,
          questionIds: idsToAppend,
          items: questions,
          targetKind,
          targetId,
          targetTab,
          newNoteTitle,
        }),
      });
      const data = await res.json();
      if (data?.ok) {
        if (Array.isArray(data.reflectionQuestions)) {
          setQuestions(data.reflectionQuestions);
        }
        setAppendBanner({
          message: data.message,
          url: data.destinationUrl,
          badge: data.destinationBadge,
        });
        onUpdated?.();
      } else {
        window.alert(data?.error || "Failed to append reflections.");
      }
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="rounded-xl border border-purple-500/35 bg-[#121521] p-4 space-y-4">
      {/* HEADER */}
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border/50 pb-3">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <HelpCircle className="h-4 w-4 text-purple-400" />
            <span className="text-xs font-bold text-foreground">
              Socratic Alignment &amp; Contradiction Probes ({questions.length})
            </span>
            <span className="rounded-full border border-purple-500/40 bg-purple-500/15 px-2 py-0.5 text-[10px] font-semibold text-purple-300">
              Interactive Review &amp; Append Manager
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Questions raised where Higher-Timeframe (Monthly/Quarterly) plans, Weekly/Daily sentiment,
            or execution sizing shifted. Delete any question that doesn&apos;t apply, or answer and
            append directly to any Weekly, Monthly, or Next-Week journal.
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() =>
              setSelectedIds(
                selectedIds.length === questions.length ? [] : questions.map((q) => q.id)
              )
            }
            className="rounded border border-border/60 bg-[#0d0f14] hover:bg-secondary px-2 py-1 text-[10px] font-semibold text-muted-foreground hover:text-foreground transition"
          >
            {selectedIds.length === questions.length ? "Unselect All" : "Select All"}
          </button>
          <button
            type="button"
            onClick={() => setAddingCustom((v) => !v)}
            className="inline-flex items-center gap-1 rounded border border-purple-500/40 bg-purple-500/15 hover:bg-purple-500/25 px-2.5 py-1 text-[10px] font-semibold text-purple-200 transition"
          >
            <Plus className="h-3 w-3" />
            <span>Add Question</span>
          </button>
        </div>
      </div>

      {/* ADD CUSTOM QUESTION FORM */}
      {addingCustom && (
        <div className="rounded-lg border border-purple-500/40 bg-[#0d0f14] p-3 space-y-2 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-bold text-purple-300 text-[11px]">
              Add Custom Reflection Question
            </span>
            <select
              value={customQCategory}
              onChange={(e) => setCustomQCategory(e.target.value as any)}
              className="h-7 rounded border border-border/70 bg-[#141722] px-2 text-[11px] text-foreground"
            >
              <option value="htf_ltf_alignment">HTF ↔ LTF Alignment</option>
              <option value="contradiction_probe">Contradiction Probe</option>
              <option value="execution_sizing">Execution &amp; Optimal R</option>
              <option value="psychology">Mindset &amp; Selectivity</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={customQText}
              onChange={(e) => setCustomQText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleAddCustomQuestion();
                }
              }}
              placeholder="e.g., What signature on the H4 chart made me shift from bullish to bearish mid-week?"
              className="h-8 flex-1 rounded-lg border border-border/70 bg-[#141722] px-2.5 text-xs text-foreground outline-none focus:border-purple-500"
            />
            <Button
              size="sm"
              className="h-8 text-xs"
              disabled={!customQText.trim() || busyId === "add_new"}
              onClick={() => void handleAddCustomQuestion()}
            >
              Add
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs"
              onClick={() => setAddingCustom(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* QUESTIONS LIST */}
      {questions.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/50 p-6 text-center text-xs text-muted-foreground">
          All reflection questions for this report have been dismissed, or none were generated. Click{" "}
          <strong>+ Add Question</strong> above to add your own.
        </div>
      ) : (
        <div className="space-y-3">
          {questions.map((q, idx) => {
            const badge = CATEGORY_BADGES[q.category] || CATEGORY_BADGES.contradiction_probe;
            const isChecked = selectedIds.includes(q.id);
            const isEditingQ = editingQId === q.id;

            return (
              <div
                key={q.id}
                className={`rounded-xl border p-3.5 space-y-2.5 text-xs transition ${
                  isChecked
                    ? "border-purple-500/50 bg-[#0d0f14]"
                    : "border-border/60 bg-[#0d0f14]/70"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2.5 flex-1 min-w-0">
                    <Checkbox
                      checked={isChecked}
                      className="mt-0.5"
                      onCheckedChange={(c) => {
                        if (c === true) {
                          setSelectedIds((prev) => [...prev, q.id]);
                        } else {
                          setSelectedIds((prev) => prev.filter((id) => id !== q.id));
                        }
                      }}
                    />
                    <div className="space-y-1 flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-[10px] font-bold text-muted-foreground">
                          Q{idx + 1}
                        </span>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${badge.cls}`}
                        >
                          {badge.label}
                        </span>
                        {Array.isArray(q.appendedTo) &&
                          q.appendedTo.map((dest) => (
                            <span
                              key={dest}
                              className="inline-flex items-center gap-1 rounded bg-emerald-500/15 border border-emerald-500/30 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300"
                            >
                              <Check className="h-2.5 w-2.5" />
                              Appended → {dest}
                            </span>
                          ))}
                      </div>

                      {q.contextSummary && (
                        <div className="text-[11px] text-muted-foreground italic">
                          {q.contextSummary}
                        </div>
                      )}

                      {isEditingQ ? (
                        <div className="flex items-center gap-1.5 pt-1">
                          <input
                            type="text"
                            value={editingQText}
                            onChange={(e) => setEditingQText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                void handleSaveEditedQuestion(q.id);
                              } else if (e.key === "Escape") {
                                setEditingQId(null);
                              }
                            }}
                            className="h-7 flex-1 rounded border border-purple-500 bg-[#141722] px-2 text-xs text-foreground outline-none"
                            autoFocus
                          />
                          <button
                            type="button"
                            onClick={() => void handleSaveEditedQuestion(q.id)}
                            className="rounded p-1 text-emerald-400 hover:bg-emerald-500/15"
                            title="Save question text"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingQId(null)}
                            className="rounded p-1 text-muted-foreground hover:bg-secondary"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div className="font-bold text-foreground leading-snug pt-0.5">
                          {q.question}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Edit Question or Dismiss/Delete Irrelevant Question */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingQId(q.id);
                        setEditingQText(q.question);
                      }}
                      className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                      title="Edit question wording"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeleteQuestion(q.id)}
                      disabled={busyId === q.id}
                      className="inline-flex items-center gap-1 rounded border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/25 px-2 py-0.5 text-[10px] font-semibold text-rose-300 transition"
                      title="Delete / dismiss this question if it is irrelevant or misunderstood your journal"
                    >
                      <Trash2 className="h-3 w-3" />
                      <span className="hidden sm:inline">Dismiss</span>
                    </button>
                  </div>
                </div>

                {/* Answer Textarea + Quick Actions */}
                <div className="pl-6 space-y-1.5">
                  <textarea
                    rows={3}
                    value={q.answer || ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      setQuestions((prev) =>
                        prev.map((item) => (item.id === q.id ? { ...item, answer: val } : item))
                      );
                      if (val.trim() && !selectedIds.includes(q.id)) {
                        setSelectedIds((prev) => [...prev, q.id]);
                      }
                    }}
                    onBlur={(e) => void saveAnswerDraft(q, e.target.value)}
                    placeholder="Write your reflection or clarify the price signatures that drove your shift..."
                    className="w-full resize-y rounded-lg border border-l-4 border-border/70 border-l-purple-500 bg-[#141722] p-2.5 text-xs text-foreground outline-none focus:border-purple-400"
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-muted-foreground">
                    <span>
                      {busyId === q.id
                        ? "Saving draft..."
                        : q.answer?.trim()
                        ? `✓ Answer saved (${q.answer.trim().length} chars)`
                        : "Auto-saves when you click out"}
                    </span>
                    <button
                      type="button"
                      disabled={busyId === "append_all"}
                      onClick={() => void handleAppendSelected([q.id])}
                      className="inline-flex items-center gap-1 rounded border border-purple-500/40 bg-purple-500/15 hover:bg-purple-500/25 px-2 py-0.5 font-semibold text-purple-200 transition"
                      title="Append just this Q&A to the destination selected below"
                    >
                      <Send className="h-2.5 w-2.5" />
                      <span>Append This Q&amp;A to Selected Target Below</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* UNIVERSAL APPEND DESTINATION MANAGER */}
      <div className="rounded-xl border border-indigo-500/35 bg-[#0d0f14] p-3.5 space-y-3 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-indigo-400" />
            <span className="font-bold text-foreground">
              Universal Reflection Append Manager
            </span>
            <span className="text-[11px] text-muted-foreground">
              (Choose where to append your {selectedIds.length} selected answer
              {selectedIds.length === 1 ? "" : "s"})
            </span>
          </div>

          {/* 1-Click Quick Destination Presets */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground mr-0.5">Quick Presets:</span>
            <button
              type="button"
              onClick={() => applyQuickPreset("week", "current_review")}
              className="rounded border border-indigo-500/40 bg-indigo-500/15 hover:bg-indigo-500/25 px-2 py-0.5 text-[10px] font-semibold text-indigo-200 transition"
            >
              📅 This Week&apos;s Review
            </button>
            <button
              type="button"
              onClick={() => applyQuickPreset("week", "next_prep")}
              className="rounded border border-emerald-500/40 bg-emerald-500/15 hover:bg-emerald-500/25 px-2 py-0.5 text-[10px] font-semibold text-emerald-200 transition"
            >
              ⏭️ Next Week&apos;s Prep / Notes
            </button>
            <button
              type="button"
              onClick={() => applyQuickPreset("month", "month_review")}
              className="rounded border border-amber-500/40 bg-amber-500/15 hover:bg-amber-500/25 px-2 py-0.5 text-[10px] font-semibold text-amber-200 transition"
            >
              🗓️ Monthly Review
            </button>
            <button
              type="button"
              onClick={() => applyQuickPreset("month", "month_prep")}
              className="rounded border border-purple-500/40 bg-purple-500/15 hover:bg-purple-500/25 px-2 py-0.5 text-[10px] font-semibold text-purple-200 transition"
            >
              🧭 Monthly Macro Plan
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
          {/* 1. Destination Category */}
          <div className="space-y-1">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              1. Destination Category
            </label>
            <select
              value={destGroup}
              onChange={(e) => handleGroupChange(e.target.value as any)}
              className="h-8 w-full rounded-lg border border-border/70 bg-[#141722] px-2.5 text-xs text-foreground outline-none focus:border-indigo-500"
            >
              <option value="week">Weekly Journal (Next Week / Current / Past)</option>
              <option value="month">Monthly Journal (Current / Next / Past)</option>
              <option value="quarter_year">Quarterly / Yearly Journal</option>
              <option value="day">Daily Journal</option>
              <option value="trade">Specific Trade Entry</option>
              <option value="notebook">Standalone Notebook Note</option>
            </select>
          </div>

          {/* 2. Specific Period / Note Picker */}
          <div className="space-y-1">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              2. Select Specific Entry
            </label>
            {destGroup === "week" && (
              <select
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                className="h-8 w-full rounded-lg border border-border/70 bg-[#141722] px-2.5 text-xs text-foreground outline-none focus:border-indigo-500"
              >
                {(catalog?.weekTargets || []).map((w) => (
                  <option key={w.slug} value={w.slug}>
                    {w.label}
                  </option>
                ))}
              </select>
            )}
            {destGroup === "month" && (
              <select
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                className="h-8 w-full rounded-lg border border-border/70 bg-[#141722] px-2.5 text-xs text-foreground outline-none focus:border-indigo-500"
              >
                {(catalog?.monthTargets || []).map((m) => (
                  <option key={m.slug} value={m.slug}>
                    {m.label}
                  </option>
                ))}
              </select>
            )}
            {destGroup === "quarter_year" && (
              <select
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                className="h-8 w-full rounded-lg border border-border/70 bg-[#141722] px-2.5 text-xs text-foreground outline-none focus:border-indigo-500"
              >
                {(catalog?.quarterYearTargets || []).map((q) => (
                  <option key={q.slug} value={q.slug}>
                    {q.label}
                  </option>
                ))}
              </select>
            )}
            {destGroup === "day" && (
              <select
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                className="h-8 w-full rounded-lg border border-border/70 bg-[#141722] px-2.5 text-xs text-foreground outline-none focus:border-indigo-500"
              >
                {(catalog?.dayTargets || []).map((d) => (
                  <option key={d.slug} value={d.slug}>
                    {d.label}
                  </option>
                ))}
              </select>
            )}
            {destGroup === "trade" && (
              <select
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                className="h-8 w-full rounded-lg border border-border/70 bg-[#141722] px-2.5 text-xs text-foreground outline-none focus:border-indigo-500"
              >
                {(catalog?.tradeTargets || []).map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </select>
            )}
            {destGroup === "notebook" && (
              <div className="flex items-center gap-1.5">
                <select
                  value={targetId}
                  onChange={(e) => setTargetId(e.target.value)}
                  className="h-8 flex-1 rounded-lg border border-border/70 bg-[#141722] px-2.5 text-xs text-foreground outline-none focus:border-indigo-500"
                >
                  <option value="__new__">+ Create New Notebook Note</option>
                  {(catalog?.notebookTargets || []).map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.label}
                    </option>
                  ))}
                </select>
                {targetId === "__new__" && (
                  <input
                    type="text"
                    value={newNoteTitle}
                    onChange={(e) => setNewNoteTitle(e.target.value)}
                    placeholder="New note title..."
                    className="h-8 w-40 rounded-lg border border-border/70 bg-[#141722] px-2 text-xs text-foreground"
                  />
                )}
              </div>
            )}
          </div>

          {/* 3. Target Section / Tab + Append Action Button */}
          <div className="space-y-1">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              3. Target Section Tab &amp; Append
            </label>
            <div className="flex items-center gap-2">
              {destGroup !== "notebook" && (
                <select
                  value={targetTab}
                  onChange={(e) => setTargetTab(e.target.value as any)}
                  className="h-8 flex-1 rounded-lg border border-border/70 bg-[#141722] px-2 text-xs text-foreground outline-none focus:border-indigo-500"
                >
                  {destGroup === "trade" ? (
                    <>
                      <option value="review">Post-Trade Review Tab</option>
                      <option value="setup">Execution &amp; Setup Notes Tab</option>
                    </>
                  ) : (
                    <>
                      <option value="review">End-of-Period Review Tab</option>
                      <option value="prep">Prep / Forecast &amp; Synthesis Tab</option>
                    </>
                  )}
                </select>
              )}

              <Button
                size="sm"
                disabled={busyId === "append_all" || questions.length === 0}
                onClick={() => void handleAppendSelected()}
                className="h-8 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shrink-0"
              >
                <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                {busyId === "append_all"
                  ? "Appending..."
                  : `Append (${selectedIds.length || "Answered"})`}
              </Button>
            </div>
          </div>
        </div>

        {appendBanner && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-2 text-xs font-semibold text-emerald-200">
            <span>✓ {appendBanner.message}</span>
            {appendBanner.url && (
              <a
                href={appendBanner.url}
                className="inline-flex items-center gap-1 rounded bg-emerald-600/30 hover:bg-emerald-600/50 border border-emerald-400/40 px-2.5 py-0.5 text-[11px] text-white transition"
              >
                <span>Open {appendBanner.badge}</span>
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
