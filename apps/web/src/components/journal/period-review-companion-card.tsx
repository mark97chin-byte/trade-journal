"use client";

import React, { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Sparkles,
  ExternalLink,
  Layers,
  TrendingUp,
  Pencil,
  Save,
  Check,
  Settings2,
  Plus,
  Trash2,
  RotateCcw,
} from "lucide-react";
import { Markdown, RichEditor } from "@/components/rich-editor";
import type { JournalTrade } from "./journal-view";
import type { SubEntryPreview } from "@/app/api/journal/subentries/route";

export type TradeOutcomeCategory = "win" | "loss" | "breakeven" | "missed";

export interface OutcomeQuestionBranch {
  rootQuestion: string;
  yesLabel: string;
  noLabel: string;
  yesQuestions: string[];
  noQuestions: string[];
}

export type ReviewQuestionTreeConfig = Record<TradeOutcomeCategory, OutcomeQuestionBranch>;

export const DEFAULT_REVIEW_QUESTION_TREE: ReviewQuestionTreeConfig = {
  win: {
    rootQuestion: "Is this a trade you would take again without knowing the outcome was a win?",
    yesLabel: "Yes",
    noLabel: "No",
    yesQuestions: [
      "What did you execute well?",
      "What would you improve with your execution on this trade?",
      "How could you have managed this trade to increase the profit?",
      "What conditions or confirmations made this a high-quality trade?",
      "Did I learn anything technically or if any part of my process was unclear?",
      "How can you reinforce this process to ensure you capitalize on similar trades in the future?",
    ],
    noQuestions: [
      "Where did you deviate from your plan or approach and why?",
      "Was this win due to luck, mismanagement, or poor risk-reward selection?",
      "What specific mistakes were made despite the positive outcome?",
      "How could this flawed win have been avoided in the future, and what would the correct process have been?",
      "How will you adjust your process to prevent reinforcing bad habits?",
    ],
  },
  loss: {
    rootQuestion: "Is this a trade you would take again without knowing the outcome was a loss?",
    yesLabel: "Yes",
    noLabel: "No",
    yesQuestions: [
      "Was there any logical way to avoid this loss in the moment, or was it an unavoidable part of the model?",
      "What specifically was done well in this trade despite the outcome?",
      "Did the trade align with your strategy and risk management rules?",
      "Did I learn anything technically or if any part of my process was unclear that caused this losing trade?",
      "Were emotions controlled after this losing trade was realised, or did it influence your next decisions?",
      "How can you maintain confidence in your process despite this loss?",
    ],
    noQuestions: [
      "Where did you deviate from your plan or approach and what caused it?",
      "What were the warning signs before or during the trade that should have led to avoidance or adjustment?",
      "Was this trade taken out of impulse, revenge, or emotional bias?",
      "How did you respond to the outcome of this trade and did it impact following trades?",
      "What specific rule or adjustment will help prevent this type of mistake in the future?",
    ],
  },
  breakeven: {
    rootQuestion:
      "Is this a trade you would take again without knowing the outcome was breakeven?",
    yesLabel: "Yes",
    noLabel: "No",
    yesQuestions: [
      "Was moving the stop to breakeven part of my predefined plan or ruleset?",
      "What was the specific trigger for adjusting the stop to breakeven?",
      "Did you execute the breakeven move with discipline or was there hesitation?",
      "If price later reached your original target, did you follow your breakeven protocol, or move it too early?",
      "If price reversed after breakeven, was the timing of your breakeven move justified based on structure or risk?",
      "What did you do well in managing this trade, despite the outcome?",
      "Did the breakeven affect your mindset or next trades positively or negatively?",
      "What can you learn or reinforce from this trade that supports your edge and discipline?",
    ],
    noQuestions: [
      "Where did this trade deviate from my trading plan and what caused it?",
      "What were the warning signs before or during the trade that should have led to avoidance or adjustment?",
      "What emotions, impulses, or external factors may have influenced the decision to enter or adjust this trade?",
      "Was moving to breakeven a fear-based or reactive choice? If so, what triggered it?",
      "How did you respond to the outcome of this trade and did it impact following trades?",
      "What specific rule or adjustment will help prevent this type of mistake in the future?",
    ],
  },
  missed: {
    rootQuestion: "Did I see this trade in real time?",
    yesLabel: "Yes",
    noLabel: "No",
    yesQuestions: [
      "What was the reason for missing it?",
      "Was I second-guessing my strategy or analysis?",
      "What doubts or fears held me back?",
      "What was the emotion that prevented me from taking the trade?",
      "How can I approach my process differently to strengthen my conviction and decision-making in real time?",
    ],
    noQuestions: [
      "Was the trade part of my trading plan? or was it an unexpected setup?",
      "Would I be able to catch this trade in real time if I seen it?",
      "Was it a lack of focus, screen time, or distractions?",
      "Did I learn anything technically or if any part of my process was unclear that caused this missed trade?",
      "How can I approach my process differently to be able to catch this in the future?",
    ],
  },
};

interface PeriodReviewCompanionCardProps {
  periodType: "day" | "week" | "month" | "quarter" | "year";
  startDate: string;
  endDate: string;
  anchorDate: string;
  currentSlug?: string;
  currentPrepContent?: string;
  currentReviewContent?: string;
  onSyncCurrentEntryEdit?: (tab: "prep" | "review", nextHtml: string) => void;
  trades: JournalTrade[];
  missedTrades?: any[];
  onInsertReflectionHtml?: (html: string) => void;
  isSplitMode?: boolean;
}

const fmtCurrency = (val: number) => {
  const abs = Math.abs(val);
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(abs);
  if (val > 0) return `+${formatted}`;
  if (val < 0) return `-${formatted}`;
  return formatted;
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatAnswerHtml(text: string): string {
  const trimmed = (text || "").trim();
  if (!trimmed) return "<br/>";
  return escapeHtml(trimmed).split(String.fromCharCode(10)).join("<br/>");
}

/**
 * Classifies an executed trade into 'breakeven', 'win', or 'loss'.
 * Breakeven is strictly defined as Realized R within [-0.1R, +0.1R].
 */
function classifyTradeOutcome(trade: JournalTrade | null): "win" | "loss" | "breakeven" {
  if (!trade) return "win";
  if (trade.realizedR != null && Number.isFinite(trade.realizedR)) {
    if (trade.realizedR >= -0.1 && trade.realizedR <= 0.1) {
      return "breakeven";
    }
    return trade.realizedR > 0.1 ? "win" : "loss";
  }
  if (Math.abs(trade.netPnl) <= 0.01) return "breakeven";
  return trade.netPnl > 0 ? "win" : "loss";
}

export function PeriodReviewCompanionCard({
  periodType,
  startDate,
  endDate,
  anchorDate,
  currentSlug,
  currentPrepContent,
  currentReviewContent,
  onSyncCurrentEntryEdit,
  trades,
  missedTrades = [],
  isSplitMode = false,
}: PeriodReviewCompanionCardProps) {
  const router = useRouter();
  const [mode, setMode] = useState<"notes" | "trades" | "missed" | "questions">("notes");
  const [creatingMissedCompanion, setCreatingMissedCompanion] = useState(false);

  const handleCreateMissedFromCompanion = async () => {
    setCreatingMissedCompanion(true);
    try {
      const todayIso = new Date().toISOString().slice(0, 10);
      const targetDate =
        periodType === "day"
          ? anchorDate
          : todayIso >= startDate && todayIso <= endDate
          ? todayIso
          : anchorDate;
      const observedIso = `${targetDate}T13:30:00.000Z`;
      const res = await fetch("/api/workspace/missed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: "NAS100",
          direction: "long",
          observedAt: observedIso,
          exitAt: observedIso,
          outcome: "WIN",
          missReason: "Hesitation / Fear",
          notes: "<p></p>",
        }),
      });
      const out = await res.json();
      if (out?.trade?.id) {
        router.push(`/missed/${encodeURIComponent(out.trade.id)}`);
      } else {
        router.push("/missed");
      }
    } catch {
      router.push("/missed");
    } finally {
      setCreatingMissedCompanion(false);
    }
  };
  const [missedIdx, setMissedIdx] = useState(0);

  // Default to expanded height (`true`) so Review Companion matches the height of the main box!
  const [expandedHeight, setExpandedHeight] = useState<boolean>(() => Boolean(isSplitMode));

  // Sub-period & current-period analysis state
  const [subEntries, setSubEntries] = useState<SubEntryPreview[]>([]);
  const [tradeReviewsMap, setTradeReviewsMap] = useState<
    Record<string, { notes: string; reviewNotes: string }>
  >({});
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [selectedLevel, setSelectedLevel] = useState<string>("all");
  const [selectedSlug, setSelectedSlug] = useState<string>("");
  const [noteSubTab, setNoteSubTab] = useState<"prep" | "review">("prep");

  // Direct inline editing state inside Review Companion
  const [isEditingPage, setIsEditingPage] = useState<boolean>(false);
  const [editDraftHtml, setEditDraftHtml] = useState<string>("");
  const [savingPageEdit, setSavingPageEdit] = useState<boolean>(false);
  const [pageSaveStatus, setPageSaveStatus] = useState<string | null>(null);

  // Trade & Missed Trade inline note editing state
  const [isEditingTradeNote, setIsEditingTradeNote] = useState<boolean>(false);
  const [tradeNoteDraftHtml, setTradeNoteDraftHtml] = useState<string>("");
  const [savingTradeNote, setSavingTradeNote] = useState<boolean>(false);
  const [tradeSaveStatus, setTradeSaveStatus] = useState<string | null>(null);

  // Question Tree Config (loaded & saved via /api/journal/config)
  const [questionTree, setQuestionTree] = useState<ReviewQuestionTreeConfig>(
    DEFAULT_REVIEW_QUESTION_TREE
  );
  const [editingCategory, setEditingCategory] = useState<TradeOutcomeCategory>("win");
  const [editingBranch, setEditingBranch] = useState<"yes" | "no">("yes");
  const [newQuestionText, setNewQuestionText] = useState<string>("");
  const [questionSaveMsg, setQuestionSaveMsg] = useState<string | null>(null);

  // Trade & Missed Trade questionnaire state
  const [tradeIdx, setTradeIdx] = useState(0);
  const [tradeNoteSubTab, setTradeNoteSubTab] = useState<"setup" | "review">("setup");
  const [missedNoteSubTab, setMissedNoteSubTab] = useState<"setup" | "review">("setup");
  const [missedNotesOverride, setMissedNotesOverride] = useState<
    Record<string, { notes: string; reviewNotes: string }>
  >({});

  // Branch selection ('yes' | 'no') & multiline answers keyed by trade/missed ID
  const [branchChoice, setBranchChoice] = useState<Record<string, "yes" | "no">>({});
  const [answersMap, setAnswersMap] = useState<Record<string, Record<number, string>>>({});

  // Load custom question tree config
  useEffect(() => {
    fetch("/api/journal/config")
      .then((r) => r.json())
      .then((d) => {
        if (d?.config?.reviewQuestions) {
          setQuestionTree((prev) => ({
            ...prev,
            ...d.config.reviewQuestions,
          }));
        }
      })
      .catch(() => {});
  }, []);

  const persistQuestionTree = async (nextTree: ReviewQuestionTreeConfig) => {
    setQuestionTree(nextTree);
    setQuestionSaveMsg("Saving...");
    try {
      await fetch("/api/journal/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewQuestions: nextTree }),
      });
      setQuestionSaveMsg("Saved questions!");
      setTimeout(() => setQuestionSaveMsg(null), 2500);
    } catch {
      setQuestionSaveMsg("Failed to save");
    }
  };

  // Load period analysis & sub-entries for ALL periodTypes (including "day"!)
  useEffect(() => {
    setLoadingNotes(true);
    fetch(
      `/api/journal/subentries?periodType=${periodType}&start=${startDate}&end=${endDate}&anchor=${anchorDate}`
    )
      .then((r) => r.json())
      .then((data) => {
        if (data?.tradeReviews) {
          setTradeReviewsMap(data.tradeReviews);
        }
        if (Array.isArray(data.subEntries) && data.subEntries.length > 0) {
          setSubEntries(data.subEntries);
          setSelectedLevel("all");
          setSelectedSlug(data.subEntries[0].slug);
        } else {
          setSubEntries([]);
        }
      })
      .catch(() => setSubEntries([]))
      .finally(() => setLoadingNotes(false));
  }, [periodType, startDate, endDate, anchorDate]);

  // Keep current period's entry in subEntries synced with parent editor if user edits on the left
  const syncedSubEntries = useMemo(() => {
    return subEntries.map((sub) => {
      if (currentSlug && sub.slug === currentSlug) {
        return {
          ...sub,
          content: currentPrepContent !== undefined ? currentPrepContent : sub.content,
          reviewContent:
            currentReviewContent !== undefined ? currentReviewContent : sub.reviewContent,
        };
      }
      return sub;
    });
  }, [subEntries, currentSlug, currentPrepContent, currentReviewContent]);

  const availableLevels = useMemo(() => {
    const set = new Set<string>();
    for (const s of syncedSubEntries) set.add(s.level);
    return Array.from(set);
  }, [syncedSubEntries]);

  const visibleSubEntries = useMemo(() => {
    if (selectedLevel === "all") return syncedSubEntries;
    return syncedSubEntries.filter((s) => s.level === selectedLevel);
  }, [syncedSubEntries, selectedLevel]);

  const activeSubEntry = useMemo(() => {
    return (
      visibleSubEntries.find((s) => s.slug === selectedSlug) ||
      visibleSubEntries[0] ||
      null
    );
  }, [visibleSubEntries, selectedSlug]);

  // Reset inline editor draft when switching sub-entry or sub-tab
  useEffect(() => {
    if (!activeSubEntry) return;
    const raw =
      noteSubTab === "prep" ? activeSubEntry.content || "" : activeSubEntry.reviewContent || "";
    setEditDraftHtml(raw);
  }, [activeSubEntry?.slug, noteSubTab, activeSubEntry?.content, activeSubEntry?.reviewContent]);

  const handleSaveSubEntryPage = async () => {
    if (!activeSubEntry) return;
    setSavingPageEdit(true);
    setPageSaveStatus("Saving...");
    try {
      const nextPrep = noteSubTab === "prep" ? editDraftHtml : activeSubEntry.content;
      const nextRev = noteSubTab === "review" ? editDraftHtml : activeSubEntry.reviewContent;

      const res = await fetch(`/api/journal/${encodeURIComponent(activeSubEntry.slug)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: activeSubEntry.fullTitle,
          content: nextPrep,
          reviewContent: nextRev,
          lessonsLearned: activeSubEntry.lessonsLearned || "",
          syncNotion: false,
          activeTab: noteSubTab,
        }),
      });
      if (!res.ok) throw new Error("Save failed");

      setSubEntries((prev) =>
        prev.map((item) =>
          item.slug === activeSubEntry.slug
            ? { ...item, content: nextPrep, reviewContent: nextRev }
            : item
        )
      );

      if (currentSlug && activeSubEntry.slug === currentSlug && onSyncCurrentEntryEdit) {
        onSyncCurrentEntryEdit(noteSubTab, editDraftHtml);
      }

      setPageSaveStatus("Saved!");
      setIsEditingPage(false);
      setTimeout(() => setPageSaveStatus(null), 2500);
    } catch {
      setPageSaveStatus("Error saving");
    } finally {
      setSavingPageEdit(false);
    }
  };

  // Active Executed Trade & Outcome Category
  const activeTrade = trades[tradeIdx] || null;
  const activeTradeOutcome = useMemo(
    () => classifyTradeOutcome(activeTrade),
    [activeTrade]
  );

  const activeTradeNotes = useMemo(() => {
    if (!activeTrade) return { notes: "", reviewNotes: "" };
    const fromMap = tradeReviewsMap[activeTrade.key];
    return {
      notes: fromMap?.notes ?? activeTrade.notes ?? "",
      reviewNotes: fromMap?.reviewNotes ?? (activeTrade as any).reviewNotes ?? "",
    };
  }, [activeTrade, tradeReviewsMap]);

  useEffect(() => {
    if (!activeTrade) return;
    setTradeNoteDraftHtml(
      tradeNoteSubTab === "review" ? activeTradeNotes.reviewNotes : activeTradeNotes.notes
    );
  }, [activeTrade?.key, tradeNoteSubTab, activeTradeNotes.notes, activeTradeNotes.reviewNotes]);

  const handleSaveInlineTradeNote = async (
    targetTab: "setup" | "review",
    htmlToSave: string
  ) => {
    if (!activeTrade) return;
    setSavingTradeNote(true);
    setTradeSaveStatus("Saving...");
    try {
      const payload =
        targetTab === "review"
          ? { reviewNotes: htmlToSave, reviewed: true }
          : { notes: htmlToSave };

      const res = await fetch(`/api/trades/${encodeURIComponent(activeTrade.key)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Failed to save trade note");

      setTradeReviewsMap((prev) => ({
        ...prev,
        [activeTrade.key]: {
          notes: targetTab === "setup" ? htmlToSave : prev[activeTrade.key]?.notes ?? activeTrade.notes ?? "",
          reviewNotes:
            targetTab === "review"
              ? htmlToSave
              : prev[activeTrade.key]?.reviewNotes ?? "",
        },
      }));
      setTradeSaveStatus("Saved to Trade!");
      setIsEditingTradeNote(false);
      setTimeout(() => setTradeSaveStatus(null), 2500);
    } catch {
      setTradeSaveStatus("Error saving");
    } finally {
      setSavingTradeNote(false);
    }
  };

  // Build Notion-formatted Q&A HTML and append/save directly into the Trade's Post-Trade Review (`reviewNotes`)
  const handlePopulateTradePostReview = async () => {
    if (!activeTrade) return;
    const branchKey = branchChoice[activeTrade.key] || "yes";
    const branchCfg = questionTree[activeTradeOutcome];
    const questions =
      branchKey === "yes" ? branchCfg.yesQuestions : branchCfg.noQuestions;
    const tradeAnswers = answersMap[activeTrade.key] || {};

    const choiceBadge =
      branchKey === "yes" ? `☑ ${branchCfg.yesLabel}` : `☒ ${branchCfg.noLabel}`;

    const qaBlocksHtml = questions
      .map((qText, idx) => {
        const formattedAns = formatAnswerHtml(tradeAnswers[idx] || "");
        return `<p><strong>${escapeHtml(qText)}</strong></p><blockquote>${formattedAns}</blockquote>`;
      })
      .join("");

    const newSectionHtml = `<p><strong>${escapeHtml(branchCfg.rootQuestion)}</strong></p><p><strong>${choiceBadge}</strong></p>${qaBlocksHtml}<p><br/></p>`;

    const existingReview = activeTradeNotes.reviewNotes || "";
    const combinedHtml = existingReview.trim()
      ? `${existingReview}${newSectionHtml}`
      : newSectionHtml;

    // 1. Save directly to SQLite
    await handleSaveInlineTradeNote("review", combinedHtml);
    setTradeNoteSubTab("review");
    setTradeNoteDraftHtml(combinedHtml);

    // 2. Immediately sync to Notion
    setTradeSaveStatus("Syncing to Notion...");
    try {
      const res = await fetch(`/api/trades/${encodeURIComponent(activeTrade.key)}/notion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewNotes: combinedHtml }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.ok) {
        setTradeSaveStatus("Saved & Synced to Notion!");
      } else {
        setTradeSaveStatus(data?.error ? `Saved (${data.error})` : "Saved (No Notion link)");
      }
    } catch {
      setTradeSaveStatus("Saved locally");
    }
    setTimeout(() => setTradeSaveStatus(null), 3500);
  };

  // Missed Trade Post-Review Population
  const activeMissed = missedTrades[missedIdx] || missedTrades[0] || null;
  const activeMissedNotes = useMemo(() => {
    if (!activeMissed) return { notes: "", reviewNotes: "" };
    const ov = missedNotesOverride[activeMissed.id];
    return {
      notes: ov?.notes ?? activeMissed.notes ?? "",
      reviewNotes: ov?.reviewNotes ?? activeMissed.review_notes ?? activeMissed.reviewNotes ?? "",
    };
  }, [activeMissed, missedNotesOverride]);

  const handleSaveMissedTradeNote = async (
    targetTab: "setup" | "review",
    htmlToSave: string
  ) => {
    if (!activeMissed) return;
    setSavingTradeNote(true);
    setTradeSaveStatus("Saving...");
    try {
      const nextNotes = targetTab === "setup" ? htmlToSave : activeMissedNotes.notes;
      const nextReview = targetTab === "review" ? htmlToSave : activeMissedNotes.reviewNotes;

      const res = await fetch("/api/workspace/missed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: activeMissed.id,
          symbol: activeMissed.symbol,
          direction: activeMissed.direction,
          observedAt: activeMissed.observed_at || activeMissed.observedAt,
          notes: nextNotes,
          reviewNotes: nextReview,
        }),
      });
      if (!res.ok) throw new Error("Failed to save missed trade review");

      setMissedNotesOverride((prev) => ({
        ...prev,
        [activeMissed.id]: {
          notes: nextNotes,
          reviewNotes: nextReview,
        },
      }));
      setTradeSaveStatus("Saved to Missed Trade!");
      setIsEditingTradeNote(false);
      setTimeout(() => setTradeSaveStatus(null), 2500);
    } catch {
      setTradeSaveStatus("Error saving");
    } finally {
      setSavingTradeNote(false);
    }
  };

  const handlePopulateMissedPostReview = async () => {
    if (!activeMissed) return;
    const key = `missed_${activeMissed.id}`;
    const branchKey = branchChoice[key] || "yes";
    const branchCfg = questionTree.missed;
    const questions =
      branchKey === "yes" ? branchCfg.yesQuestions : branchCfg.noQuestions;
    const mAnswers = answersMap[key] || {};

    const choiceBadge =
      branchKey === "yes" ? `☑ ${branchCfg.yesLabel}` : `☒ ${branchCfg.noLabel}`;

    const qaBlocksHtml = questions
      .map((qText, idx) => {
        const formattedAns = formatAnswerHtml(mAnswers[idx] || "");
        return `<p><strong>${escapeHtml(qText)}</strong></p><blockquote>${formattedAns}</blockquote>`;
      })
      .join("");

    const newSectionHtml = `<p><strong>${escapeHtml(branchCfg.rootQuestion)}</strong></p><p><strong>${choiceBadge}</strong></p>${qaBlocksHtml}<p><br/></p>`;

    const existingReview = activeMissedNotes.reviewNotes || "";
    const combinedHtml = existingReview.trim()
      ? `${existingReview}${newSectionHtml}`
      : newSectionHtml;

    await handleSaveMissedTradeNote("review", combinedHtml);
    setMissedNoteSubTab("review");
  };

  const analysisTabLabel = useMemo(() => {
    switch (periodType) {
      case "day":
        return "Daily Analysis";
      case "week":
        return "Weekly & Daily";
      case "month":
        return "Monthly / Wk / Day";
      case "quarter":
        return "Quarterly / Mo / Wk";
      case "year":
        return "Yearly / Qtr / Mo";
    }
  }, [periodType]);

  return (
    <div className="rounded-xl border border-border/70 bg-card text-card-foreground p-4 shadow-sm space-y-3 flex flex-col h-auto w-full">
      {/* HEADER & MODE SWITCHER */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-border/40 pb-2.5">
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-indigo-400" />
          <h3 className="text-sm font-bold text-foreground">Review Companion</h3>
          {!isSplitMode ? (
            <button
              type="button"
              onClick={() => setExpandedHeight((v) => !v)}
              className="rounded border border-border/60 bg-secondary/40 hover:bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:text-foreground transition"
              title="Toggle tall/compact card height"
            >
              {expandedHeight ? "Compact Height" : "Expand Height"}
            </button>
          ) : (
            <span className="rounded border border-indigo-500/30 bg-indigo-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-indigo-400">
              Auto-Fit Height
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1 rounded-lg bg-[#0d0f14] p-0.5 border border-border/60 text-[11px]">
          <button
            type="button"
            onClick={() => setMode("notes")}
            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 font-semibold transition ${
              mode === "notes"
                ? "bg-indigo-600 text-white"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Layers className="w-3 h-3" />
            <span>{analysisTabLabel}</span>
          </button>

          <button
            type="button"
            onClick={() => setMode("trades")}
            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 font-semibold transition ${
              mode === "trades"
                ? "bg-secondary text-foreground border border-border"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <TrendingUp className="w-3 h-3" />
            <span>Trades ({trades.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setMode("missed")}
            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 font-semibold transition ${
              mode === "missed"
                ? "bg-secondary text-foreground border border-border"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span>Missed ({missedTrades.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setMode("questions")}
            className={`inline-flex items-center gap-1 rounded-md px-1.5 py-1 font-semibold transition ${
              mode === "questions"
                ? "bg-indigo-600 text-white"
                : "text-muted-foreground hover:text-foreground"
            }`}
            title="Customize Review Decision Tree Questions"
          >
            <Settings2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ===================================================================== */}
      {/* MODE 1: PERIOD ANALYSIS & SUB-PERIOD NOTES (WITH DIRECT INLINE EDIT)  */}
      {/* ===================================================================== */}
      {mode === "notes" && (
        <div className="space-y-2.5">
          {/* Level Filter Pills when multiple levels exist (e.g. Week has Weekly + Daily) */}
          {availableLevels.length > 1 && (
            <div className="flex flex-wrap items-center gap-1 text-[10px]">
              <span className="text-muted-foreground mr-1 uppercase tracking-wider font-semibold">
                Level:
              </span>
              <button
                type="button"
                onClick={() => setSelectedLevel("all")}
                className={`px-2 py-0.5 rounded uppercase font-bold transition ${
                  selectedLevel === "all"
                    ? "bg-secondary text-foreground border border-border"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                All
              </button>
              {availableLevels.map((lvl) => (
                <button
                  key={lvl}
                  type="button"
                  onClick={() => {
                    setSelectedLevel(lvl);
                    const first = syncedSubEntries.find((s) => s.level === lvl);
                    if (first) setSelectedSlug(first.slug);
                  }}
                  className={`px-2 py-0.5 rounded uppercase font-bold transition ${
                    selectedLevel === lvl
                      ? "bg-secondary text-foreground border border-border"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {lvl === periodType ? `${lvl} Analysis` : `${lvl}s`}
                </button>
              ))}
            </div>
          )}

          {/* Entry Selector Pills (Weekly Analysis, Mon, Tue, Wed, Thu, Fri, etc.) */}
          <div className="flex flex-wrap items-center gap-1">
            {visibleSubEntries.map((sub) => {
              const active = activeSubEntry?.slug === sub.slug;
              const hasText = Boolean(
                (sub.content && sub.content.replace(/<[^>]+>/g, "").trim()) ||
                  (sub.reviewContent && sub.reviewContent.replace(/<[^>]+>/g, "").trim())
              );
              return (
                <button
                  key={sub.slug}
                  type="button"
                  onClick={() => {
                    setSelectedSlug(sub.slug);
                    setIsEditingPage(false);
                  }}
                  className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition ${
                    active
                      ? "bg-indigo-600 text-white shadow"
                      : sub.isSelfPeriod
                      ? "bg-indigo-950/40 text-indigo-200 border border-indigo-500/40 hover:bg-indigo-900/50"
                      : "bg-[#181b26] text-muted-foreground hover:text-foreground border border-border/50"
                  }`}
                >
                  <span>{sub.shortLabel}</span>
                  {hasText && (
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        active ? "bg-white" : "bg-emerald-400"
                      }`}
                      title="Has recorded notes"
                    />
                  )}
                </button>
              );
            })}
          </div>

          {loadingNotes ? (
            <div className="py-6 text-center text-xs text-muted-foreground">
              Loading analysis &amp; notes...
            </div>
          ) : activeSubEntry ? (
            <div className="rounded-lg border border-border/60 bg-[#0d0f14] p-3 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 pb-2">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setNoteSubTab("prep");
                      setIsEditingPage(false);
                    }}
                    className={`px-2 py-0.5 rounded text-[10px] font-semibold transition ${
                      noteSubTab === "prep"
                        ? "bg-secondary text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {activeSubEntry.isSelfPeriod
                      ? `${periodType.charAt(0).toUpperCase() + periodType.slice(1)} Analysis / Prep`
                      : "Analysis / Prep Notes"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setNoteSubTab("review");
                      setIsEditingPage(false);
                    }}
                    className={`px-2 py-0.5 rounded text-[10px] font-semibold transition ${
                      noteSubTab === "review"
                        ? "bg-secondary text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Review Notes
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  {pageSaveStatus && (
                    <span className="text-[10px] font-semibold text-emerald-400">
                      {pageSaveStatus}
                    </span>
                  )}
                  {isEditingPage ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void handleSaveSubEntryPage()}
                        disabled={savingPageEdit}
                        className="inline-flex items-center gap-1 rounded bg-emerald-600 hover:bg-emerald-500 px-2 py-0.5 text-[10px] font-semibold text-white transition"
                      >
                        <Save className="w-3 h-3" />
                        <span>{savingPageEdit ? "Saving..." : "Save Page"}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsEditingPage(false)}
                        className="rounded border border-border/60 bg-secondary/40 px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setEditDraftHtml(
                          noteSubTab === "prep"
                            ? activeSubEntry.content || ""
                            : activeSubEntry.reviewContent || ""
                        );
                        setIsEditingPage(true);
                      }}
                      className="inline-flex items-center gap-1 rounded border border-indigo-500/40 bg-indigo-500/15 hover:bg-indigo-500/25 px-2 py-0.5 text-[10px] font-semibold text-indigo-300 transition"
                      title="Enable direct inline editing of this page"
                    >
                      <Pencil className="w-2.5 h-2.5" />
                      <span>Edit Page</span>
                    </button>
                  )}

                  <Link
                    href={`/journal/${activeSubEntry.slug}`}
                    className="inline-flex items-center gap-1 text-[10px] text-indigo-400 hover:underline"
                    title="Open full journal page"
                  >
                    <span>Open</span>
                    <ExternalLink className="w-2.5 h-2.5" />
                  </Link>
                </div>
              </div>

              {activeSubEntry.lessonsLearned && (
                <div className="rounded bg-indigo-950/25 border border-indigo-500/30 px-2.5 py-1.5 text-[11px] text-indigo-200">
                  <span className="font-bold uppercase text-[9px] tracking-wider text-indigo-400 mr-1.5">
                    Key Takeaway:
                  </span>
                  {activeSubEntry.lessonsLearned}
                </div>
              )}

              <div
                style={
                  isSplitMode
                    ? { minHeight: "360px", height: "auto" }
                    : {
                        height: expandedHeight ? "520px" : "240px",
                        minHeight: "180px",
                      }
                }
                className={`text-xs flex-1 ${
                  isSplitMode ? "overflow-visible" : "resize-y overflow-y-auto pr-1"
                }`}
              >
                {isEditingPage ? (
                  <RichEditor
                    key={`inline-edit-${activeSubEntry.slug}-${noteSubTab}`}
                    value={editDraftHtml}
                    onChange={setEditDraftHtml}
                    minHeight={expandedHeight ? 480 : 260}
                    ownerType={activeSubEntry.level}
                    ownerId={
                      noteSubTab === "review"
                        ? `${activeSubEntry.slug}-review`
                        : activeSubEntry.slug
                    }
                  />
                ) : noteSubTab === "prep" ? (
                  activeSubEntry.content &&
                  activeSubEntry.content.replace(/<[^>]+>/g, "").trim() ? (
                    <Markdown content={activeSubEntry.content} className="!p-0" />
                  ) : (
                    <div className="py-10 text-center text-muted-foreground italic text-[11px]">
                      No Analysis / Prep notes recorded for {activeSubEntry.shortLabel}. Click{" "}
                      <strong>Edit Page</strong> above to write directly here.
                    </div>
                  )
                ) : activeSubEntry.reviewContent &&
                  activeSubEntry.reviewContent.replace(/<[^>]+>/g, "").trim() ? (
                  <Markdown content={activeSubEntry.reviewContent} className="!p-0" />
                ) : (
                  <div className="py-10 text-center text-muted-foreground italic text-[11px]">
                    No Review notes recorded for {activeSubEntry.shortLabel}. Click{" "}
                    <strong>Edit Page</strong> above to write directly here.
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="py-4 text-center text-xs text-muted-foreground">
              No entries found.
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODE 2: EXECUTED TRADES & POST-TRADE REVIEW DECISION TREE             */}
      {/* ===================================================================== */}
      {mode === "trades" && (
        <div className="space-y-3">
          {trades.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground border border-dashed border-border/40 rounded-lg">
              No closed trades recorded in this {periodType}.
            </div>
          ) : activeTrade ? (
            <div className="space-y-3">
              {/* Trade Stepper Bar */}
              <div className="flex items-center justify-between rounded-lg bg-[#0d0f14] px-2.5 py-1.5 border border-border/60">
                <button
                  type="button"
                  onClick={() => {
                    setTradeIdx((i) => (i - 1 + trades.length) % trades.length);
                    setIsEditingTradeNote(false);
                  }}
                  className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
                  title="Previous trade"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <div className="text-center">
                  <div className="text-xs font-bold text-foreground flex flex-wrap items-center justify-center gap-1.5">
                    <span>
                      Trade {tradeIdx + 1} of {trades.length}:
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-secondary text-[11px]">
                      {activeTrade.symbol}
                    </span>
                    <span
                      className={`uppercase text-[11px] ${
                        activeTrade.direction.toLowerCase().includes("buy") ||
                        activeTrade.direction.toLowerCase().includes("long")
                          ? "text-profit"
                          : "text-loss"
                      }`}
                    >
                      {activeTrade.direction}
                    </span>
                    <span
                      className={
                        activeTradeOutcome === "breakeven"
                          ? "text-amber-400"
                          : activeTradeOutcome === "win"
                          ? "text-profit"
                          : "text-loss"
                      }
                    >
                      {fmtCurrency(activeTrade.netPnl)}
                    </span>
                    <span
                      className={`rounded px-1.5 py-0.2 text-[10px] uppercase font-mono font-bold ${
                        activeTradeOutcome === "win"
                          ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                          : activeTradeOutcome === "breakeven"
                          ? "bg-amber-500/15 text-amber-300 border border-amber-500/30"
                          : "bg-rose-500/15 text-rose-400 border border-rose-500/30"
                      }`}
                    >
                      {activeTradeOutcome === "breakeven"
                        ? "BREAKEVEN (-0.1R..0.1R)"
                        : activeTradeOutcome.toUpperCase()}
                    </span>
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {activeTrade.openedAt.slice(0, 16).replace("T", " ")} •{" "}
                    {activeTrade.quantity}L
                    {activeTrade.realizedR != null
                      ? ` • ${
                          activeTrade.realizedR > 0
                            ? `+${activeTrade.realizedR}R`
                            : `${activeTrade.realizedR}R`
                        }`
                      : ""}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setTradeIdx((i) => (i + 1) % trades.length);
                    setIsEditingTradeNote(false);
                  }}
                  className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
                  title="Next trade"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              {/* Setup Note vs Post-Trade Review Viewer & Inline Editor */}
              <div
                style={isSplitMode ? { minHeight: "220px", height: "auto" } : { height: expandedHeight ? "420px" : "200px", minHeight: "130px" }}
                className={`rounded-lg border border-border/50 bg-background/50 p-2.5 text-xs space-y-2 ${isSplitMode ? "overflow-visible" : "resize-y overflow-y-auto"}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 pb-1.5">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setTradeNoteSubTab("setup");
                        setIsEditingTradeNote(false);
                      }}
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold transition ${
                        tradeNoteSubTab === "setup"
                          ? "bg-secondary text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      Setup &amp; Execution Note
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setTradeNoteSubTab("review");
                        setIsEditingTradeNote(false);
                      }}
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold transition ${
                        tradeNoteSubTab === "review"
                          ? "bg-indigo-600 text-white"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      Post-Trade Review
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    {tradeSaveStatus && (
                      <span className="text-[10px] font-semibold text-emerald-400">
                        {tradeSaveStatus}
                      </span>
                    )}
                    {isEditingTradeNote ? (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            void handleSaveInlineTradeNote(
                              tradeNoteSubTab,
                              tradeNoteDraftHtml
                            )
                          }
                          disabled={savingTradeNote}
                          className="inline-flex items-center gap-1 rounded bg-emerald-600 hover:bg-emerald-500 px-2 py-0.5 text-[10px] font-semibold text-white"
                        >
                          <Save className="w-3 h-3" />
                          <span>Save</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setIsEditingTradeNote(false)}
                          className="rounded border border-border/60 px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setTradeNoteDraftHtml(
                            tradeNoteSubTab === "review"
                              ? activeTradeNotes.reviewNotes
                              : activeTradeNotes.notes
                          );
                          setIsEditingTradeNote(true);
                        }}
                        className="inline-flex items-center gap-1 rounded border border-indigo-500/40 bg-indigo-500/15 hover:bg-indigo-500/25 px-2 py-0.5 text-[10px] font-semibold text-indigo-300"
                      >
                        <Pencil className="w-2.5 h-2.5" />
                        <span>Edit Page</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={async () => {
                        setTradeSaveStatus("Syncing to Notion...");
                        try {
                          const res = await fetch(`/api/trades/${encodeURIComponent(activeTrade.key)}/notion`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              reviewNotes: activeTradeNotes.reviewNotes,
                              notes: activeTradeNotes.notes,
                            }),
                          });
                          const data = await res.json().catch(() => ({}));
                          if (res.ok && data?.ok) {
                            setTradeSaveStatus("Synced to Notion!");
                          } else {
                            setTradeSaveStatus(data?.error || "Sync failed");
                          }
                        } catch {
                          setTradeSaveStatus("Sync error");
                        }
                        setTimeout(() => setTradeSaveStatus(null), 3500);
                      }}
                      className="inline-flex items-center gap-1 rounded border border-border/60 bg-secondary/50 hover:bg-secondary px-2 py-0.5 text-[10px] font-semibold text-foreground transition"
                      title="Sync current trade notes & review directly to Notion"
                    >
                      <span>Sync Notion</span>
                    </button>
                    <Link
                      href={`/trades/${encodeURIComponent(activeTrade.key)}`}
                      className="text-[10px] text-indigo-400 hover:underline inline-flex items-center gap-1"
                    >
                      <span>Open Trade</span>
                      <ExternalLink className="w-2.5 h-2.5" />
                    </Link>
                  </div>
                </div>

                {isEditingTradeNote ? (
                  <RichEditor
                    key={`trade-inline-${activeTrade.key}-${tradeNoteSubTab}`}
                    value={tradeNoteDraftHtml}
                    onChange={setTradeNoteDraftHtml}
                    minHeight={200}
                  />
                ) : tradeNoteSubTab === "setup" ? (
                  activeTradeNotes.notes &&
                  activeTradeNotes.notes.replace(/<[^>]+>/g, "").trim() ? (
                    <Markdown content={activeTradeNotes.notes} className="!p-0" />
                  ) : (
                    <div className="py-6 text-center text-muted-foreground italic text-[11px]">
                      No Setup/Execution notes recorded for this trade.
                    </div>
                  )
                ) : activeTradeNotes.reviewNotes &&
                  activeTradeNotes.reviewNotes.replace(/<[^>]+>/g, "").trim() ? (
                  <Markdown content={activeTradeNotes.reviewNotes} className="!p-0" />
                ) : (
                  <div className="py-6 text-center text-muted-foreground italic text-[11px]">
                    No Post-Trade Review recorded yet. Fill out the questionnaire below to populate it!
                  </div>
                )}
              </div>

              {/* OUTCOME-SPECIFIC DECISION TREE QUESTIONNAIRE (WIN / LOSS / BREAKEVEN) */}
              {(() => {
                const branchCfg = questionTree[activeTradeOutcome];
                const selectedBranch = branchChoice[activeTrade.key] ?? null;
                const activeQuestions =
                  selectedBranch === "yes"
                    ? branchCfg.yesQuestions
                    : selectedBranch === "no"
                    ? branchCfg.noQuestions
                    : [];
                const currentAnswers = answersMap[activeTrade.key] || {};

                return (
                  <div className="rounded-lg border border-border/60 bg-[#161924] p-3 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-bold text-foreground">
                        {branchCfg.rootQuestion}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingCategory(activeTradeOutcome);
                          if (selectedBranch) setEditingBranch(selectedBranch);
                          setMode("questions");
                        }}
                        className="text-[10px] text-muted-foreground hover:text-foreground underline shrink-0"
                      >
                        Edit Questions
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setBranchChoice((prev) => ({
                            ...prev,
                            [activeTrade.key]: "yes",
                          }))
                        }
                        className={`flex items-center justify-center gap-1.5 rounded-lg border py-1.5 text-xs font-semibold transition ${
                          selectedBranch === "yes"
                            ? "border-emerald-500 bg-emerald-500/20 text-emerald-300"
                            : "border-border/60 bg-[#0d0f14] text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>{branchCfg.yesLabel}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setBranchChoice((prev) => ({
                            ...prev,
                            [activeTrade.key]: "no",
                          }))
                        }
                        className={`flex items-center justify-center gap-1.5 rounded-lg border py-1.5 text-xs font-semibold transition ${
                          selectedBranch === "no"
                            ? "border-rose-500 bg-rose-500/20 text-rose-300"
                            : "border-border/60 bg-[#0d0f14] text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        <span>{branchCfg.noLabel}</span>
                      </button>
                    </div>

                    {selectedBranch === null ? (
                      <div className="py-3 text-center text-[11px] text-muted-foreground italic">
                        Select <strong>Yes</strong> or <strong>No</strong> above to load the{" "}
                        {activeTradeOutcome === "breakeven"
                          ? "Breakeven (-0.1R to 0.1R)"
                          : activeTradeOutcome === "win"
                          ? "Winning Trade"
                          : "Losing Trade"}{" "}
                        questions.
                      </div>
                    ) : (
                      <div className="space-y-2.5 pt-1">
                        {activeQuestions.map((qText, idx) => (
                          <div key={`${selectedBranch}-q-${idx}`} className="space-y-1">
                            <label className="block text-[11px] font-bold text-foreground">
                              {qText}
                            </label>
                            <textarea
                              rows={2}
                              value={currentAnswers[idx] || ""}
                              onChange={(e) => {
                                const val = e.target.value;
                                setAnswersMap((prev) => ({
                                  ...prev,
                                  [activeTrade.key]: {
                                    ...(prev[activeTrade.key] || {}),
                                    [idx]: val,
                                  },
                                }));
                              }}
                              placeholder="Write your reflection..."
                              className="w-full resize-y min-h-[52px] rounded-md border border-l-4 border-border/60 border-l-indigo-500/70 bg-[#0d0f14] px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-indigo-500"
                            />
                          </div>
                        ))}

                        <button
                          type="button"
                          onClick={() => void handlePopulateTradePostReview()}
                          disabled={savingTradeNote}
                          className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 py-2 text-xs font-semibold text-white shadow transition disabled:opacity-50"
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          <span>
                            {savingTradeNote
                              ? "Saving & Syncing to Notion..."
                              : "Add to Post-Trade Review & Sync to Notion"}
                          </span>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          ) : null}
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODE 3: MISSED TRADES & REAL-TIME DECISION TREE QUESTIONNAIRE         */}
      {/* ===================================================================== */}
      {mode === "missed" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-muted-foreground">
              Missed Opportunities in This {periodType.charAt(0).toUpperCase() + periodType.slice(1)} ({missedTrades.length})
            </span>
            <button
              type="button"
              disabled={creatingMissedCompanion}
              onClick={() => void handleCreateMissedFromCompanion()}
              className="inline-flex items-center gap-1 rounded-md bg-indigo-600 hover:bg-indigo-500 px-2.5 py-1 text-[11px] font-semibold text-white shadow-2xs transition disabled:opacity-50"
            >
              <Plus className="w-3 h-3" />
              <span>{creatingMissedCompanion ? "Creating..." : "Add Missed Trade"}</span>
            </button>
          </div>
          {missedTrades.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground border border-dashed border-border/40 rounded-lg space-y-2.5">
              <div>No missed trades recorded in this {periodType}.</div>
              <button
                type="button"
                disabled={creatingMissedCompanion}
                onClick={() => void handleCreateMissedFromCompanion()}
                className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 text-xs font-semibold text-white shadow transition disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{creatingMissedCompanion ? "Creating..." : "Add Missed Trade"}</span>
              </button>
            </div>
          ) : activeMissed ? (
            (() => {
              const mPnl = Number(activeMissed.theoretical_pnl || 0);
              const mR = Number(activeMissed.realized_r ?? activeMissed.planned_r ?? 0);
              const mKey = `missed_${activeMissed.id}`;
              const branchCfg = questionTree.missed;
              const selectedBranch = branchChoice[mKey] ?? null;
              const activeQuestions =
                selectedBranch === "yes"
                  ? branchCfg.yesQuestions
                  : selectedBranch === "no"
                  ? branchCfg.noQuestions
                  : [];
              const currentAnswers = answersMap[mKey] || {};

              return (
                <div className="space-y-3">
                  <div className="flex items-center justify-between rounded-lg bg-[#0d0f14] px-2.5 py-1.5 border border-border/60">
                    <button
                      type="button"
                      onClick={() => {
                        setMissedIdx(
                          (i) => (i - 1 + missedTrades.length) % missedTrades.length
                        );
                        setIsEditingTradeNote(false);
                      }}
                      className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <div className="text-center">
                      <div className="text-xs font-bold text-foreground flex items-center justify-center gap-1.5">
                        <span>
                          Missed {missedIdx + 1} of {missedTrades.length}:
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-secondary text-[11px] font-mono">
                          {activeMissed.symbol}
                        </span>
                        <span className="uppercase text-[11px]">
                          {activeMissed.direction}
                        </span>
                        <span className={mPnl >= 0 ? "text-profit" : "text-loss"}>
                          {fmtCurrency(mPnl)} ({mR >= 0 ? `+${mR}R` : `${mR}R`})
                        </span>
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {(activeMissed.observed_at || "").slice(0, 16).replace("T", " ")} •
                        Reason:{" "}
                        <strong className="text-foreground">
                          {activeMissed.miss_reason || "Hesitation / Fear"}
                        </strong>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setMissedIdx((i) => (i + 1) % missedTrades.length);
                        setIsEditingTradeNote(false);
                      }}
                      className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Missed Trade Setup Notes vs Post-Trade Review */}
                  <div
                    style={isSplitMode ? { minHeight: "200px", height: "auto" } : { height: expandedHeight ? "400px" : "180px", minHeight: "120px" }}
                    className={`rounded-lg border border-border/50 bg-background/50 p-2.5 text-xs space-y-2 ${isSplitMode ? "overflow-visible" : "resize-y overflow-y-auto"}`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 pb-1.5 text-[11px]">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setMissedNoteSubTab("setup");
                            setIsEditingTradeNote(false);
                          }}
                          className={`px-2 py-0.5 rounded text-[10px] font-semibold transition ${
                            missedNoteSubTab === "setup"
                              ? "bg-secondary text-foreground"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          Setup Notes
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setMissedNoteSubTab("review");
                            setIsEditingTradeNote(false);
                          }}
                          className={`px-2 py-0.5 rounded text-[10px] font-semibold transition ${
                            missedNoteSubTab === "review"
                              ? "bg-indigo-600 text-white"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          Missed Trade Review
                        </button>
                      </div>

                      <div className="flex items-center gap-2">
                        {tradeSaveStatus && (
                          <span className="text-[10px] font-semibold text-emerald-400">
                            {tradeSaveStatus}
                          </span>
                        )}
                        {isEditingTradeNote ? (
                          <>
                            <button
                              type="button"
                              onClick={() =>
                                void handleSaveMissedTradeNote(
                                  missedNoteSubTab,
                                  tradeNoteDraftHtml
                                )
                              }
                              disabled={savingTradeNote}
                              className="inline-flex items-center gap-1 rounded bg-emerald-600 hover:bg-emerald-500 px-2 py-0.5 text-[10px] font-semibold text-white"
                            >
                              <Save className="w-3 h-3" />
                              <span>Save</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setIsEditingTradeNote(false)}
                              className="rounded border border-border/60 px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setTradeNoteDraftHtml(
                                missedNoteSubTab === "review"
                                  ? activeMissedNotes.reviewNotes
                                  : activeMissedNotes.notes
                              );
                              setIsEditingTradeNote(true);
                            }}
                            className="inline-flex items-center gap-1 rounded border border-indigo-500/40 bg-indigo-500/15 hover:bg-indigo-500/25 px-2 py-0.5 text-[10px] font-semibold text-indigo-300"
                          >
                            <Pencil className="w-2.5 h-2.5" />
                            <span>Edit Page</span>
                          </button>
                        )}

                        <Link
                          href={`/missed/${encodeURIComponent(activeMissed.id)}`}
                          className="text-[10px] text-indigo-400 hover:underline inline-flex items-center gap-1"
                        >
                          <span>Open Setup</span>
                          <ExternalLink className="w-2.5 h-2.5" />
                        </Link>
                      </div>
                    </div>

                    {isEditingTradeNote ? (
                      <RichEditor
                        key={`missed-inline-${activeMissed.id}-${missedNoteSubTab}`}
                        value={tradeNoteDraftHtml}
                        onChange={setTradeNoteDraftHtml}
                        minHeight={180}
                      />
                    ) : missedNoteSubTab === "setup" ? (
                      activeMissedNotes.notes &&
                      activeMissedNotes.notes.replace(/<[^>]+>/g, "").trim() ? (
                        <Markdown content={activeMissedNotes.notes} className="!p-0" />
                      ) : (
                        <div className="py-4 text-center text-muted-foreground italic text-[11px]">
                          No setup notes recorded for this missed opportunity.
                        </div>
                      )
                    ) : activeMissedNotes.reviewNotes &&
                      activeMissedNotes.reviewNotes.replace(/<[^>]+>/g, "").trim() ? (
                      <Markdown content={activeMissedNotes.reviewNotes} className="!p-0" />
                    ) : (
                      <div className="py-4 text-center text-muted-foreground italic text-[11px]">
                        No Missed Trade Review recorded yet. Fill out the questionnaire below!
                      </div>
                    )}
                  </div>

                  {/* MISSED TRADE QUESTIONNAIRE ("Did I see this trade in real time?") */}
                  <div className="rounded-lg border border-border/60 bg-[#161924] p-3 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-bold text-foreground">
                        {branchCfg.rootQuestion}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingCategory("missed");
                          if (selectedBranch) setEditingBranch(selectedBranch);
                          setMode("questions");
                        }}
                        className="text-[10px] text-muted-foreground hover:text-foreground underline shrink-0"
                      >
                        Edit Questions
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setBranchChoice((prev) => ({
                            ...prev,
                            [mKey]: "yes",
                          }))
                        }
                        className={`flex items-center justify-center gap-1.5 rounded-lg border py-1.5 text-xs font-semibold transition ${
                          selectedBranch === "yes"
                            ? "border-emerald-500 bg-emerald-500/20 text-emerald-300"
                            : "border-border/60 bg-[#0d0f14] text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>{branchCfg.yesLabel}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setBranchChoice((prev) => ({
                            ...prev,
                            [mKey]: "no",
                          }))
                        }
                        className={`flex items-center justify-center gap-1.5 rounded-lg border py-1.5 text-xs font-semibold transition ${
                          selectedBranch === "no"
                            ? "border-rose-500 bg-rose-500/20 text-rose-300"
                            : "border-border/60 bg-[#0d0f14] text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        <span>{branchCfg.noLabel}</span>
                      </button>
                    </div>

                    {selectedBranch === null ? (
                      <div className="py-3 text-center text-[11px] text-muted-foreground italic">
                        Select <strong>Yes</strong> or <strong>No</strong> above to load the Missed
                        Trade reflection questions.
                      </div>
                    ) : (
                      <div className="space-y-2.5 pt-1">
                        {activeQuestions.map((qText, idx) => (
                          <div key={`missed-${selectedBranch}-q-${idx}`} className="space-y-1">
                            <label className="block text-[11px] font-bold text-foreground">
                              {qText}
                            </label>
                            <textarea
                              rows={2}
                              value={currentAnswers[idx] || ""}
                              onChange={(e) => {
                                const val = e.target.value;
                                setAnswersMap((prev) => ({
                                  ...prev,
                                  [mKey]: {
                                    ...(prev[mKey] || {}),
                                    [idx]: val,
                                  },
                                }));
                              }}
                              placeholder="Write your reflection..."
                              className="w-full resize-y min-h-[52px] rounded-md border border-l-4 border-border/60 border-l-indigo-500/70 bg-[#0d0f14] px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-indigo-500"
                            />
                          </div>
                        ))}

                        <button
                          type="button"
                          onClick={() => void handlePopulateMissedPostReview()}
                          disabled={savingTradeNote}
                          className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 py-2 text-xs font-semibold text-white shadow transition disabled:opacity-50"
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          <span>
                            {savingTradeNote
                              ? "Saving & Syncing to Notion..."
                              : "Add to Missed Review & Sync to Notion"}
                          </span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()
          ) : null}
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODE 4: DISCRETE TAB TO EDIT DECISION TREE QUESTIONS FOR THE FUTURE   */}
      {/* ===================================================================== */}
      {mode === "questions" && (
        <div className="space-y-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 pb-2">
            <div>
              <div className="font-bold text-foreground">
                Customize Post-Trade Review Questionnaires
              </div>
              <div className="text-[10px] text-muted-foreground">
                Breakeven is automatically triggered when Realized R is within -0.1R to +0.1R
              </div>
            </div>

            <div className="flex items-center gap-2">
              {questionSaveMsg && (
                <span className="text-[11px] font-semibold text-emerald-400">
                  {questionSaveMsg}
                </span>
              )}
              <button
                type="button"
                onClick={() => void persistQuestionTree(DEFAULT_REVIEW_QUESTION_TREE)}
                className="inline-flex items-center gap-1 rounded border border-border/60 bg-secondary/40 hover:bg-secondary px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground"
                title="Reset all categories to default Notion questions"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset Defaults</span>
              </button>
            </div>
          </div>

          {/* Outcome Category Selector */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            {(
              [
                { id: "win", label: "Winning (> 0.1R)" },
                { id: "loss", label: "Losing (< -0.1R)" },
                { id: "breakeven", label: "Breakeven (-0.1..0.1R)" },
                { id: "missed", label: "Missed Trade" },
              ] as const
            ).map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setEditingCategory(cat.id)}
                className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition ${
                  editingCategory === cat.id
                    ? "border-indigo-500 bg-indigo-600 text-white"
                    : "border-border/60 bg-[#0d0f14] text-muted-foreground hover:text-foreground"
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {(() => {
            const catCfg = questionTree[editingCategory];
            const listKey = editingBranch === "yes" ? "yesQuestions" : "noQuestions";
            const currentQuestions = catCfg[listKey];

            return (
              <div className="rounded-lg border border-border/60 bg-[#0d0f14] p-3 space-y-3 flex-1">
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                    First Question (Root Decision Prompt)
                  </label>
                  <input
                    type="text"
                    value={catCfg.rootQuestion}
                    onChange={(e) => {
                      const next: ReviewQuestionTreeConfig = {
                        ...questionTree,
                        [editingCategory]: {
                          ...catCfg,
                          rootQuestion: e.target.value,
                        },
                      };
                      void persistQuestionTree(next);
                    }}
                    className="h-8 w-full rounded-md border border-border/60 bg-[#161924] px-2.5 text-xs text-foreground outline-none focus:border-indigo-500"
                  />
                </div>

                {/* Yes vs No Branch Switcher */}
                <div className="flex items-center gap-2 border-b border-border/40 pb-2">
                  <button
                    type="button"
                    onClick={() => setEditingBranch("yes")}
                    className={`rounded-md px-3 py-1 text-[11px] font-semibold transition ${
                      editingBranch === "yes"
                        ? "bg-emerald-600 text-white"
                        : "bg-secondary/40 text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    ✓ When Clicking &ldquo;Yes&rdquo; ({catCfg.yesQuestions.length} questions)
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingBranch("no")}
                    className={`rounded-md px-3 py-1 text-[11px] font-semibold transition ${
                      editingBranch === "no"
                        ? "bg-rose-600 text-white"
                        : "bg-secondary/40 text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    ✕ When Clicking &ldquo;No&rdquo; ({catCfg.noQuestions.length} questions)
                  </button>
                </div>

                {/* Editable List of Questions for this Branch */}
                <div className="space-y-2">
                  {currentQuestions.map((q, qIdx) => (
                    <div key={`${editingCategory}-${editingBranch}-${qIdx}`} className="flex items-center gap-1.5">
                      <span className="font-mono text-[10px] text-muted-foreground w-5">
                        {qIdx + 1}.
                      </span>
                      <input
                        type="text"
                        value={q}
                        onChange={(e) => {
                          const updatedList = currentQuestions.map((item, i) =>
                            i === qIdx ? e.target.value : item
                          );
                          const next: ReviewQuestionTreeConfig = {
                            ...questionTree,
                            [editingCategory]: {
                              ...catCfg,
                              [listKey]: updatedList,
                            },
                          };
                          void persistQuestionTree(next);
                        }}
                        className="h-8 flex-1 rounded-md border border-border/60 bg-[#161924] px-2.5 text-xs text-foreground outline-none focus:border-indigo-500"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const updatedList = currentQuestions.filter((_, i) => i !== qIdx);
                          const next: ReviewQuestionTreeConfig = {
                            ...questionTree,
                            [editingCategory]: {
                              ...catCfg,
                              [listKey]: updatedList,
                            },
                          };
                          void persistQuestionTree(next);
                        }}
                        className="rounded bg-rose-500/15 hover:bg-rose-500/25 p-1.5 text-rose-400"
                        title="Remove question"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}

                  {/* Add New Question to this Branch */}
                  <div className="flex items-center gap-1.5 pt-1">
                    <input
                      type="text"
                      value={newQuestionText}
                      onChange={(e) => setNewQuestionText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && newQuestionText.trim()) {
                          e.preventDefault();
                          const next: ReviewQuestionTreeConfig = {
                            ...questionTree,
                            [editingCategory]: {
                              ...catCfg,
                              [listKey]: [...currentQuestions, newQuestionText.trim()],
                            },
                          };
                          void persistQuestionTree(next);
                          setNewQuestionText("");
                        }
                      }}
                      placeholder={`+ Add new question to ${editingCategory.toUpperCase()} (${editingBranch.toUpperCase()})...`}
                      className="h-8 flex-1 rounded-md border border-dashed border-indigo-500/40 bg-[#161924] px-2.5 text-xs text-foreground outline-none focus:border-indigo-500"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (!newQuestionText.trim()) return;
                        const next: ReviewQuestionTreeConfig = {
                          ...questionTree,
                          [editingCategory]: {
                            ...catCfg,
                            [listKey]: [...currentQuestions, newQuestionText.trim()],
                          },
                        };
                        void persistQuestionTree(next);
                        setNewQuestionText("");
                      }}
                      className="inline-flex h-8 items-center gap-1 rounded-md bg-indigo-600 hover:bg-indigo-500 px-3 text-xs font-semibold text-white"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
