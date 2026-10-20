"use client";

import React, { useState, useEffect, useMemo } from "react";
import Link from "next/link";
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
} from "lucide-react";
import { Markdown } from "@/components/rich-editor";
import type { JournalTrade } from "./journal-view";
import type { SubEntryPreview } from "@/app/api/journal/subentries/route";

interface PeriodReviewCompanionCardProps {
  periodType: "day" | "week" | "month" | "quarter" | "year";
  startDate: string;
  endDate: string;
  anchorDate: string;
  trades: JournalTrade[];
  onInsertReflectionHtml: (html: string) => void;
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

export function PeriodReviewCompanionCard({
  periodType,
  startDate,
  endDate,
  anchorDate,
  trades,
  onInsertReflectionHtml,
}: PeriodReviewCompanionCardProps) {
  // For Daily journal, default straight to "trades" reflection; for Week/Month/Quarter/Year default to "notes"
  const [mode, setMode] = useState<"notes" | "trades">(
    periodType === "day" ? "trades" : "notes"
  );

  // Sub-period notes state
  const [subEntries, setSubEntries] = useState<SubEntryPreview[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [selectedLevel, setSelectedLevel] = useState<string>("all");
  const [selectedSlug, setSelectedSlug] = useState<string>("");
  const [noteSubTab, setNoteSubTab] = useState<"prep" | "review">("prep");
  const [expandedHeight, setExpandedHeight] = useState<boolean>(false);

  // Trade reflection state
  const [tradeIdx, setTradeIdx] = useState(0);
  const [tradeNoteSubTab, setTradeNoteSubTab] = useState<"setup" | "review">("setup");
  const [wouldTakeAgain, setWouldTakeAgain] = useState<
    Record<string, "yes" | "no" | null>
  >({});
  const [q1Answer, setQ1Answer] = useState("");
  const [q2Answer, setQ2Answer] = useState("");
  const [q3Answer, setQ3Answer] = useState("");

  useEffect(() => {
    setMode(periodType === "day" ? "trades" : "notes");
  }, [periodType]);

  useEffect(() => {
    if (periodType === "day") return;
    setLoadingNotes(true);
    fetch(
      `/api/journal/subentries?periodType=${periodType}&start=${startDate}&end=${endDate}&anchor=${anchorDate}`
    )
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.subEntries) && data.subEntries.length > 0) {
          setSubEntries(data.subEntries);
          const defaultLevel = data.subEntries[0].level;
          setSelectedLevel(defaultLevel);
          setSelectedSlug(data.subEntries[0].slug);
        } else {
          setSubEntries([]);
        }
      })
      .catch(() => setSubEntries([]))
      .finally(() => setLoadingNotes(false));
  }, [periodType, startDate, endDate, anchorDate]);

  const availableLevels = useMemo(() => {
    const set = new Set<string>();
    for (const s of subEntries) set.add(s.level);
    return Array.from(set);
  }, [subEntries]);

  const visibleSubEntries = useMemo(() => {
    if (selectedLevel === "all") return subEntries;
    return subEntries.filter((s) => s.level === selectedLevel);
  }, [subEntries, selectedLevel]);

  const activeSubEntry = useMemo(() => {
    return (
      visibleSubEntries.find((s) => s.slug === selectedSlug) ||
      visibleSubEntries[0] ||
      null
    );
  }, [visibleSubEntries, selectedSlug]);

  const activeTrade = trades[tradeIdx] || null;
  const isWinningTrade = activeTrade ? activeTrade.netPnl >= 0 : true;
  const currentTakeAgain = activeTrade ? wouldTakeAgain[activeTrade.key] ?? null : null;

  useEffect(() => {
    setQ1Answer("");
    setQ2Answer("");
    setQ3Answer("");
  }, [tradeIdx, activeTrade?.key]);

  const handlePushReflectionToEditor = () => {
    if (!activeTrade) return;
    const isWin = activeTrade.netPnl >= 0;
    const takeAgainBadge =
      currentTakeAgain === "yes"
        ? "✅ YES — Valid A+ Process (Would take again blindly)"
        : currentTakeAgain === "no"
        ? "❌ NO — Sub-optimal / Rule Violation (Would skip)"
        : "⚪ Unspecified";

    const q1Label = isWin
      ? "Did this win come from A+ rule execution or lucky variance?"
      : "Was this loss a valid system stop-out or an unforced execution error?";
    const q2Label = isWin
      ? "Could entry timing, position sizing, or partial scaling have been optimized?"
      : "What specific HTF context, sweep, or timing filter was misread or ignored?";
    const q3Label = "Concrete rule adjustment / takeaway from this trade:";

    const html = `
<div class="tz-toggle" data-notion-type="toggle" data-toggle-type="toggle" data-open="true">
  <div class="tz-toggle-header">
    <span class="tz-toggle-btn" contenteditable="false">▾</span>
    <div class="tz-toggle-title"><strong>${isWin ? "🟢" : "🔴"} ${activeTrade.symbol} (${activeTrade.direction.toUpperCase()}) • ${fmtCurrency(activeTrade.netPnl)} ${activeTrade.realizedR != null ? `[${activeTrade.realizedR > 0 ? `+${activeTrade.realizedR}R` : `${activeTrade.realizedR}R`}]` : ""} — ${activeTrade.openedAt.slice(0, 16).replace("T", " ")}</strong></div>
  </div>
  <div class="tz-toggle-body">
    <p><strong>Would I take this trade again without knowing the result?</strong> ${takeAgainBadge}</p>
    <ul>
      <li><strong>${q1Label}</strong> ${q1Answer || "—"}</li>
      <li><strong>${q2Label}</strong> ${q2Answer || "—"}</li>
      <li><strong>${q3Label}</strong> ${q3Answer || "—"}</li>
    </ul>
  </div>
</div>
<p><br/></p>`;

    onInsertReflectionHtml(html);
  };

  return (
    <div className="rounded-xl border border-indigo-500/30 bg-[#12141d] p-4 shadow-sm space-y-3">
      {/* HEADER & MODE SWITCHER */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-border/40 pb-2.5">
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-indigo-400" />
          <h3 className="text-sm font-bold text-foreground">
            Review Companion
          </h3>
          <button
            type="button"
            onClick={() => setExpandedHeight((v) => !v)}
            className="rounded border border-border/60 bg-secondary/40 hover:bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:text-foreground transition"
            title="Toggle tall/compact card height (you can also drag the bottom-right corner of the note box)"
          >
            {expandedHeight ? "Compact Height" : "Expand Height"}
          </button>
        </div>

        <div className="flex items-center gap-1 rounded-lg bg-[#0d0f14] p-0.5 border border-border/60 text-[11px]">
          {periodType !== "day" && (
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
              <span>
                {periodType === "week"
                  ? "Daily Notes"
                  : periodType === "month"
                  ? "Weekly / Daily"
                  : periodType === "quarter"
                  ? "Monthly / Weekly"
                  : "Quarterly / Monthly"}
              </span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setMode("trades")}
            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 font-semibold transition ${
              mode === "trades"
                ? "bg-indigo-600 text-white"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <TrendingUp className="w-3 h-3" />
            <span>Trades ({trades.length})</span>
          </button>
        </div>
      </div>

      {/* MODE 1: SUB-PERIOD NOTES FLICKER (Mon-Fri for Week, Weeks/Days for Month, etc.) */}
      {mode === "notes" && periodType !== "day" && (
        <div className="space-y-2.5">
          {/* Level Selector if multiple levels exist (e.g. Month has Weeks + Days) */}
          {availableLevels.length > 1 && (
            <div className="flex items-center gap-1 text-[10px]">
              <span className="text-muted-foreground mr-1 uppercase tracking-wider font-semibold">
                View:
              </span>
              {availableLevels.map((lvl) => (
                <button
                  key={lvl}
                  type="button"
                  onClick={() => {
                    setSelectedLevel(lvl);
                    const first = subEntries.find((s) => s.level === lvl);
                    if (first) setSelectedSlug(first.slug);
                  }}
                  className={`px-2 py-0.5 rounded uppercase font-bold transition ${
                    selectedLevel === lvl
                      ? "bg-secondary text-foreground border border-border"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {lvl}s
                </button>
              ))}
            </div>
          )}

          {/* Day / Week / Month Pill Selector */}
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
                  onClick={() => setSelectedSlug(sub.slug)}
                  className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition ${
                    active
                      ? "bg-indigo-600 text-white shadow"
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
              Loading sub-period notes...
            </div>
          ) : activeSubEntry ? (
            <div className="rounded-lg border border-border/60 bg-[#0d0f14] p-3 space-y-2.5">
              <div className="flex items-center justify-between border-b border-border/40 pb-2">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setNoteSubTab("prep")}
                    className={`px-2 py-0.5 rounded text-[10px] font-semibold transition ${
                      noteSubTab === "prep"
                        ? "bg-secondary text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Prep / Session Notes
                  </button>
                  <button
                    type="button"
                    onClick={() => setNoteSubTab("review")}
                    className={`px-2 py-0.5 rounded text-[10px] font-semibold transition ${
                      noteSubTab === "review"
                        ? "bg-secondary text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Review Notes
                  </button>
                </div>

                <Link
                  href={`/journal/${activeSubEntry.slug}`}
                  className="inline-flex items-center gap-1 text-[10px] text-indigo-400 hover:underline"
                  title="Open full journal page"
                >
                  <span>Open</span>
                  <ExternalLink className="w-2.5 h-2.5" />
                </Link>
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
                style={{ height: expandedHeight ? "560px" : "320px", minHeight: "180px" }}
                className="resize-y overflow-y-auto pr-1 text-xs"
              >
                {noteSubTab === "prep" ? (
                  activeSubEntry.content &&
                  activeSubEntry.content.replace(/<[^>]+>/g, "").trim() ? (
                    <Markdown content={activeSubEntry.content} className="!p-0" />
                  ) : (
                    <div className="py-6 text-center text-muted-foreground italic text-[11px]">
                      No Prep/Session notes recorded for {activeSubEntry.shortLabel}.
                    </div>
                  )
                ) : activeSubEntry.reviewContent &&
                  activeSubEntry.reviewContent.replace(/<[^>]+>/g, "").trim() ? (
                  <Markdown content={activeSubEntry.reviewContent} className="!p-0" />
                ) : (
                  <div className="py-6 text-center text-muted-foreground italic text-[11px]">
                    No Review notes recorded for {activeSubEntry.shortLabel}.
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="py-4 text-center text-xs text-muted-foreground">
              No sub-period entries found.
            </div>
          )}
        </div>
      )}

      {/* MODE 2: EXECUTED TRADES & WINNING/LOSING REFLECTION WIZARD */}
      {mode === "trades" && (
        <div className="space-y-3">
          {trades.length === 0 ? (
            <div className="py-6 text-center text-xs text-muted-foreground border border-dashed border-border/40 rounded-lg">
              No closed trades recorded in this {periodType}.
            </div>
          ) : activeTrade ? (
            <div className="space-y-3">
              {/* Trade Stepper Bar */}
              <div className="flex items-center justify-between rounded-lg bg-[#0d0f14] px-2.5 py-1.5 border border-border/60">
                <button
                  type="button"
                  onClick={() =>
                    setTradeIdx((i) => (i - 1 + trades.length) % trades.length)
                  }
                  className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
                  title="Previous trade"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <div className="text-center">
                  <div className="text-xs font-bold text-foreground flex items-center justify-center gap-1.5">
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
                        activeTrade.netPnl >= 0 ? "text-profit" : "text-loss"
                      }
                    >
                      {fmtCurrency(activeTrade.netPnl)}
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
                  onClick={() => setTradeIdx((i) => (i + 1) % trades.length)}
                  className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
                  title="Next trade"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              {/* Trade Setup Notes vs Trade Review Notes Switcher */}
              <div
                style={{ height: expandedHeight ? "380px" : "220px", minHeight: "130px" }}
                className="rounded-lg border border-border/50 bg-[#0d0f14] p-2.5 resize-y overflow-y-auto text-xs space-y-2"
              >
                <div className="flex items-center justify-between border-b border-border/40 pb-1.5">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setTradeNoteSubTab("setup")}
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
                      onClick={() => setTradeNoteSubTab("review")}
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold transition ${
                        tradeNoteSubTab === "review"
                          ? "bg-secondary text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      Trade Review
                    </button>
                  </div>
                  <Link
                    href={`/trades/${activeTrade.key}`}
                    className="text-[10px] text-indigo-400 hover:underline inline-flex items-center gap-1"
                  >
                    <span>Open Trade</span>
                    <ExternalLink className="w-2.5 h-2.5" />
                  </Link>
                </div>

                {tradeNoteSubTab === "setup" ? (
                  activeTrade.notes && activeTrade.notes.replace(/<[^>]+>/g, "").trim() ? (
                    <Markdown content={activeTrade.notes} className="!p-0" />
                  ) : (
                    <div className="py-6 text-center text-muted-foreground italic text-[11px]">
                      No Setup/Execution notes recorded for this trade.
                    </div>
                  )
                ) : (activeTrade as any).reviewNotes &&
                  String((activeTrade as any).reviewNotes).replace(/<[^>]+>/g, "").trim() ? (
                  <Markdown content={(activeTrade as any).reviewNotes} className="!p-0" />
                ) : (
                  <div className="py-6 text-center text-muted-foreground italic text-[11px]">
                    No Post-Trade Review recorded on this trade yet.
                  </div>
                )}
              </div>

              {/* Hindsight-Free Process Question */}
              <div className="rounded-lg border border-border/60 bg-[#161924] p-2.5 space-y-2">
                <div className="text-[11px] font-bold text-foreground">
                  Would you take this exact setup again without knowing the result?
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setWouldTakeAgain((prev) => ({
                        ...prev,
                        [activeTrade.key]: "yes",
                      }))
                    }
                    className={`flex items-center justify-center gap-1.5 rounded-lg border py-1.5 text-xs font-semibold transition ${
                      currentTakeAgain === "yes"
                        ? "border-emerald-500 bg-emerald-500/20 text-emerald-300"
                        : "border-border/60 bg-[#0d0f14] text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Yes (Valid Process)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setWouldTakeAgain((prev) => ({
                        ...prev,
                        [activeTrade.key]: "no",
                      }))
                    }
                    className={`flex items-center justify-center gap-1.5 rounded-lg border py-1.5 text-xs font-semibold transition ${
                      currentTakeAgain === "no"
                        ? "border-rose-500 bg-rose-500/20 text-rose-300"
                        : "border-border/60 bg-[#0d0f14] text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    <span>No (Skip / Error)</span>
                  </button>
                </div>

                {/* Dynamic Prompts Based on Winning vs Losing Idea */}
                <div className="space-y-2 pt-1">
                  <div
                    className={`text-[10px] font-bold uppercase tracking-wider ${
                      isWinningTrade ? "text-emerald-400" : "text-rose-400"
                    }`}
                  >
                    {isWinningTrade
                      ? "🟢 Winning Idea Reflection Prompts"
                      : "🔴 Losing Idea Root-Cause Prompts"}
                  </div>

                  <div>
                    <label className="block text-[10px] text-muted-foreground mb-0.5">
                      {isWinningTrade
                        ? "1. Did this win follow A+ rules or benefit from lucky variance?"
                        : "1. Was this a valid system stop-out or an unforced rule violation?"}
                    </label>
                    <input
                      type="text"
                      value={q1Answer}
                      onChange={(e) => setQ1Answer(e.target.value)}
                      placeholder="Type brief reflection..."
                      className="h-7 w-full rounded border border-border/60 bg-[#0d0f14] px-2 text-xs text-foreground outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] text-muted-foreground mb-0.5">
                      {isWinningTrade
                        ? "2. Could entry, sizing, or partial profit scaling be improved?"
                        : "2. What HTF context, liquidity sweep, or timing window was misread?"}
                    </label>
                    <input
                      type="text"
                      value={q2Answer}
                      onChange={(e) => setQ2Answer(e.target.value)}
                      placeholder="Type brief reflection..."
                      className="h-7 w-full rounded border border-border/60 bg-[#0d0f14] px-2 text-xs text-foreground outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] text-muted-foreground mb-0.5">
                      3. Key adjustment / takeaway to carry forward:
                    </label>
                    <input
                      type="text"
                      value={q3Answer}
                      onChange={(e) => setQ3Answer(e.target.value)}
                      placeholder="One actionable takeaway..."
                      className="h-7 w-full rounded border border-border/60 bg-[#0d0f14] px-2 text-xs text-foreground outline-none focus:border-indigo-500"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={handlePushReflectionToEditor}
                    className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 py-1.5 text-xs font-semibold text-white shadow transition"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Insert Trade Reflection Block into Review Note</span>
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
