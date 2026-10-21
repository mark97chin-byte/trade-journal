"use client";

import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  Plus,
  Trash2,
  Save,
  UploadCloud,
  Download,
  ExternalLink,
  Calculator,
  ChevronLeft,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Loader2,
  Calendar as CalendarIcon,
  LayoutList,
  SlidersHorizontal,
} from "lucide-react";
import { FilterBar } from "@/components/filter-bar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { RichEditor, Markdown, type RichEditorHandle } from "@/components/rich-editor";
import { VoiceNote } from "@/components/voice-note";
import { TradeRating } from "@/components/trade-rating";
import { TradeTagsEditor } from "@/components/tags/trade-tags-editor";
import {
  TradeMarketData,
  type ExtractedRrSetup,
} from "@/components/trade-market-data";
import type { ChartExecution } from "@/components/trade-chart";
import { useApi } from "@/lib/use-api";
import { fmtMoney } from "@/lib/utils";

interface PartialTarget {
  id: string;
  label: string;
  price: number;
  pct: number;
  manualPct?: boolean;
}

function rebalanceEqualPartialsForm(
  items: PartialTarget[],
  entryPrice: number,
  fullTargetPrice: number
): PartialTarget[] {
  const n = items.length;
  if (n === 0) return [];
  const totalLegs = n + 1;
  const hasManual = items.some((it) => it.manualPct);
  const equalPct = Number((100 / totalLegs).toFixed(2));

  return items.map((it, idx) => {
    const ratio = (idx + 1) / totalLegs;
    const defaultPrice =
      Number.isFinite(entryPrice) &&
      entryPrice > 0 &&
      Number.isFinite(fullTargetPrice) &&
      fullTargetPrice > 0
        ? Number((entryPrice + (fullTargetPrice - entryPrice) * ratio).toFixed(2))
        : it.price;
    return {
      ...it,
      label: `TP${idx + 1}`,
      price: it.price > 0 ? it.price : defaultPrice,
      pct: hasManual ? it.pct : equalPct,
    };
  });
}

interface MissedTradeRecord {
  id: string;
  symbol: string;
  direction: "long" | "short";
  observedAt: string;
  exitAt: string | null;
  outcome: "WIN" | "LOSS" | "BE";
  playbookId: string | null;
  entry: number | null;
  stop: number | null;
  target: number | null;
  partialsJson: string;
  accountSize: number;
  riskPercent: number;
  riskAmount: number;
  contractMultiplier: number;
  quantity: number;
  plannedR: number | null;
  realizedR: number | null;
  theoreticalPnl: number;
  maeR: number | null;
  mfeR: number | null;
  missReason: string;
  session: string;
  tagsJson: string;
  mistakesJson: string;
  notes: string;
  reviewNotes: string;
  rating: number | null;
  notionPageId: string | null;
  notionUrl: string | null;
  createdAt: string;
  archivedAt: string | null;
}

const MISS_REASONS = [
  "Hesitation / Fear",
  "Away from Desk / Missed Alert",
  "Spread / Limit Unfilled by Ticks",
  "Second-Guessed HTF Bias",
  "News / High-Impact Volatility",
  "In Another Trade / Max Risk Reached",
  "Prematurely Cancelled Order",
  "Other",
];

const ICT_SESSIONS = ["Asia", "London", "NY AM", "NY PM"];

function inferDefaultPointMultiplier(symbol: string): number {
  const s = symbol.toUpperCase();
  if (s.includes("ES") && !s.includes("MES")) return 50;
  if (s.includes("MES")) return 5;
  if (s.includes("NQ") && !s.includes("MNQ") && !s.includes("NAS")) return 20;
  if (s.includes("MNQ")) return 2;
  if (s.includes("XAU") || s.includes("GOLD")) return 100;
  if (/^[A-Z]{6}$/.test(s)) return 100000;
  return 1;
}

function getMondayOfDate(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  if (isNaN(d.getTime())) return dateStr;
  const day = d.getUTCDay();
  const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
  const mon = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), diff));
  return mon.toISOString().slice(0, 10);
}

function MissedTradePeriodCompanion({ observedAt }: { observedAt: string }) {
  const dateStr = (observedAt || new Date().toISOString()).slice(0, 10);
  const mondayStr = getMondayOfDate(dateStr);
  const monthKey = dateStr.slice(0, 7);
  const yr = dateStr.slice(0, 4);
  const qNum = Math.floor((parseInt(dateStr.slice(5, 7), 10) - 1) / 3) + 1;

  const periods = useMemo(
    () => [
      { id: "day", label: `Daily (${dateStr.slice(5)})`, slug: dateStr },
      { id: "week", label: `Weekly (${mondayStr.slice(5)})`, slug: `week-${mondayStr}` },
      { id: "month", label: `Monthly (${monthKey})`, slug: `month-${monthKey}` },
      { id: "quarter", label: `Quarterly (${yr}-Q${qNum})`, slug: `quarter-${yr}-Q${qNum}` },
    ],
    [dateStr, mondayStr, monthKey, yr, qNum]
  );

  const [selectedSlug, setSelectedSlug] = useState<string>(dateStr);
  const [subTab, setSubTab] = useState<"prep" | "review">("prep");
  const [expanded, setExpanded] = useState<boolean>(false);
  const [entryData, setEntryData] = useState<{
    title: string;
    content: string;
    reviewContent: string;
    lessonsLearned: string;
  } | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    setSelectedSlug(dateStr);
  }, [dateStr]);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/journal/${encodeURIComponent(selectedSlug)}`)
      .then((r) => r.json())
      .then((res) => {
        const entry = res?.data?.entry || res?.entry;
        if (entry) {
          setEntryData({
            title: entry.title || selectedSlug,
            content: entry.content || "",
            reviewContent: entry.reviewContent || "",
            lessonsLearned: entry.lessonsLearned || "",
          });
        } else {
          setEntryData(null);
        }
      })
      .catch(() => setEntryData(null))
      .finally(() => setLoading(false));
  }, [selectedSlug]);

  return (
    <Card className="border-border/70 bg-card">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
        <div className="flex items-center gap-2">
          <CardTitle className="text-sm font-bold">
            HTF &amp; Daily Journal Companion
          </CardTitle>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="rounded border border-border/60 bg-secondary/40 hover:bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:text-foreground transition"
          >
            {expanded ? "Compact" : "Expand Height"}
          </button>
        </div>

        <a
          href={`/journal/${selectedSlug}`}
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground underline font-medium"
        >
          <span>Open {selectedSlug}</span>
          <ExternalLink className="h-3 w-3" />
        </a>
      </CardHeader>
      <CardContent className="space-y-2.5">
        <div className="flex flex-wrap items-center gap-1">
          {periods.map((p) => (
            <button
              key={p.slug}
              type="button"
              onClick={() => setSelectedSlug(p.slug)}
              className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition ${
                selectedSlug === p.slug
                  ? "bg-secondary text-foreground border border-border shadow-2xs"
                  : "bg-muted/30 text-muted-foreground hover:text-foreground"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="rounded-lg border border-border/60 bg-background p-3 space-y-2">
          <div className="flex items-center justify-between border-b border-border/40 pb-1.5">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setSubTab("prep")}
                className={`px-2 py-0.5 rounded text-[10px] font-semibold transition ${
                  subTab === "prep"
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Synthesis / Prep Notes
              </button>
              <button
                type="button"
                onClick={() => setSubTab("review")}
                className={`px-2 py-0.5 rounded text-[10px] font-semibold transition ${
                  subTab === "review"
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Period Review
              </button>
            </div>
            <span className="text-[10px] text-muted-foreground font-mono">
              {selectedSlug}
            </span>
          </div>

          <div
            style={{ height: expanded ? "480px" : "240px", minHeight: "140px" }}
            className="resize-y overflow-y-auto pr-1 text-xs"
          >
            {loading ? (
              <div className="py-6 text-center text-muted-foreground">
                Loading {selectedSlug} journal...
              </div>
            ) : subTab === "prep" ? (
              entryData?.content && entryData.content.replace(/<[^>]+>/g, "").trim() ? (
                <Markdown content={entryData.content} className="!p-0" />
              ) : (
                <div className="py-6 text-center text-muted-foreground italic text-[11px]">
                  No Prep/Synthesis notes recorded for {selectedSlug}.
                </div>
              )
            ) : entryData?.reviewContent &&
              entryData.reviewContent.replace(/<[^>]+>/g, "").trim() ? (
              <Markdown content={entryData.reviewContent} className="!p-0" />
            ) : (
              <div className="py-6 text-center text-muted-foreground italic text-[11px]">
                No Review notes recorded for {selectedSlug}.
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function MissedPage() {
  return (
    <Suspense>
      <MissedTradesWorkspace />
    </Suspense>
  );
}

function MissedTradesWorkspace() {
  const { data, refresh } = useApi<{ trades: MissedTradeRecord[] }>("/api/workspace/missed");
  const { data: books } = useApi<{ playbooks: { id: string; name: string }[] }>("/api/playbooks");

  // Top-level Page View Mode: "workspace" (Setup & Replay) vs "calendar" (Calendar & List)
  const [viewMode, setViewMode] = useState<"workspace" | "calendar">("workspace");

  // Calendar & List Filters
  const [calendarMonth, setCalendarMonth] = useState<string>(() =>
    new Date().toISOString().slice(0, 7)
  );
  const [selectedDateFilter, setSelectedDateFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [reasonFilter, setReasonFilter] = useState<string>("all");
  const [sessionFilter, setSessionFilter] = useState<string>("all");
  const [outcomeFilter, setOutcomeFilter] = useState<string>("all");
  const [directionFilter, setDirectionFilter] = useState<string>("all");

  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Layout split state
  const [leftWidth, setLeftWidth] = useState<number>(45);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const isDraggingRef = useRef(false);

  // Active Missed Trade Form State
  const [symbol, setSymbol] = useState("NAS100");
  const [direction, setDirection] = useState<"long" | "short">("long");
  const [observedAt, setObservedAt] = useState(() =>
    new Date().toISOString().slice(0, 16)
  );
  const [exitAt, setExitAt] = useState(() =>
    new Date(Date.now() + 3600_000).toISOString().slice(0, 16)
  );
  const [outcome, setOutcome] = useState<"WIN" | "LOSS" | "BE">("WIN");
  const [playbookId, setPlaybookId] = useState<string>("none");
  const [missReason, setMissReason] = useState<string>(MISS_REASONS[0]!);
  const [session, setSession] = useState<string>("NY AM");

  // Entry, SL, Full TP & Multi-Partials
  const [entryStr, setEntryStr] = useState<string>("");
  const [stopStr, setStopStr] = useState<string>("");
  const [targetStr, setTargetStr] = useState<string>("");
  const [partials, setPartials] = useState<PartialTarget[]>([]);

  // Automatic Position Sizer State
  const [accountSize, setAccountSize] = useState<number>(100000);
  const [riskPercent, setRiskPercent] = useState<number>(1.0);
  const [contractMultiplier, setContractMultiplier] = useState<number>(1);
  const [maeRStr, setMaeRStr] = useState<string>("");
  const [mfeRStr, setMfeRStr] = useState<string>("");

  // Notes, Review Notes, Tags, Rating & Notion
  const [activeNoteTab, setActiveNoteTab] = useState<"setup" | "review">("setup");
  const [notes, setNotes] = useState<string>("");
  const [reviewNotes, setReviewNotes] = useState<string>("");
  const [tags, setTags] = useState<string[]>([]);
  const [mistakes, setMistakes] = useState<string[]>([]);
  const [rating, setRating] = useState<number | null>(null);
  const [notionUrl, setNotionUrl] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [syncingNotion, setSyncingNotion] = useState(false);
  const [pullingNotion, setPullingNotion] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const noteEditorRef = useRef<RichEditorHandle>(null);

  const allUnarchived = useMemo(
    () => (data?.trades || []).filter((t) => !t.archivedAt),
    [data]
  );

  const activeList = useMemo(() => {
    return allUnarchived.filter((t) => {
      if (selectedDateFilter && (t.observedAt || "").slice(0, 10) !== selectedDateFilter)
        return false;
      if (reasonFilter !== "all" && t.missReason !== reasonFilter) return false;
      if (sessionFilter !== "all" && t.session !== sessionFilter) return false;
      if (outcomeFilter !== "all" && t.outcome !== outcomeFilter) return false;
      if (directionFilter !== "all" && t.direction !== directionFilter) return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        t.symbol.toLowerCase().includes(q) ||
        t.missReason.toLowerCase().includes(q) ||
        t.notes.toLowerCase().includes(q)
      );
    });
  }, [
    allUnarchived,
    selectedDateFilter,
    reasonFilter,
    sessionFilter,
    outcomeFilter,
    directionFilter,
    search,
  ]);

  const loadRecordIntoWorkspace = (rec: MissedTradeRecord) => {
    setSelectedId(rec.id);
    setSymbol(rec.symbol);
    setDirection(rec.direction === "short" ? "short" : "long");
    setObservedAt((rec.observedAt || new Date().toISOString()).slice(0, 16));
    setExitAt(
      (rec.exitAt || rec.observedAt || new Date().toISOString()).slice(0, 16)
    );
    setOutcome(rec.outcome || "WIN");
    setPlaybookId(rec.playbookId || "none");
    setMissReason(rec.missReason || MISS_REASONS[0]!);
    setSession(rec.session || "NY AM");
    setEntryStr(rec.entry != null ? String(rec.entry) : "");
    setStopStr(rec.stop != null ? String(rec.stop) : "");
    setTargetStr(rec.target != null ? String(rec.target) : "");
    try {
      setPartials(JSON.parse(rec.partialsJson || "[]"));
    } catch {
      setPartials([]);
    }
    setAccountSize(rec.accountSize || 100000);
    setRiskPercent(rec.riskPercent || 1.0);
    setContractMultiplier(
      rec.contractMultiplier || inferDefaultPointMultiplier(rec.symbol)
    );
    setMaeRStr(rec.maeR != null ? String(rec.maeR) : "");
    setMfeRStr(rec.mfeR != null ? String(rec.mfeR) : "");
    setNotes(rec.notes || "");
    setReviewNotes(rec.reviewNotes || "");
    try {
      setTags(JSON.parse(rec.tagsJson || "[]"));
    } catch {
      setTags([]);
    }
    try {
      setMistakes(JSON.parse(rec.mistakesJson || "[]"));
    } catch {
      setMistakes([]);
    }
    setRating(rec.rating ?? null);
    setNotionUrl(rec.notionUrl || null);
  };

  useEffect(() => {
    if (!selectedId && allUnarchived.length > 0) {
      loadRecordIntoWorkspace(allUnarchived[0]!);
    }
  }, [allUnarchived, selectedId]);

  const handleStartNewMissedTrade = () => {
    setSelectedId(`missed_${Date.now().toString(36)}`);
    setSymbol("NAS100");
    setDirection("long");
    const nowLocal = new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
    setObservedAt(nowLocal);
    setExitAt(nowLocal);
    setOutcome("WIN");
    setPlaybookId("none");
    setMissReason(MISS_REASONS[0]!);
    setSession("NY AM");
    setEntryStr("");
    setStopStr("");
    setTargetStr("");
    setPartials([]);
    setMaeRStr("");
    setMfeRStr("");
    setNotes("");
    setReviewNotes("");
    setTags([]);
    setMistakes([]);
    setRating(null);
    setNotionUrl(null);
    setViewMode("workspace");
    setStatusMsg("New Missed Setup ready");
  };

  const calc = useMemo(() => {
    const entry = parseFloat(entryStr);
    const stop = parseFloat(stopStr);
    const target = parseFloat(targetStr);
    const riskDollars = (accountSize * riskPercent) / 100;

    if (!Number.isFinite(entry) || !Number.isFinite(stop) || entry === stop) {
      return {
        riskDollars,
        stopDistance: 0,
        quantity: 1,
        plannedR: 0,
        blendedRealizedR: outcome === "LOSS" ? -1 : 0,
        theoreticalPnl: outcome === "LOSS" ? -riskDollars : 0,
      };
    }

    const stopDistance = Math.abs(entry - stop);
    const mult = contractMultiplier > 0 ? contractMultiplier : 1;
    const rawQty = riskDollars / (stopDistance * mult);
    const quantity = Math.max(0.01, Math.round(rawQty * 100) / 100);

    const fullRewardDist = Number.isFinite(target) ? Math.abs(target - entry) : 0;
    const plannedR = stopDistance > 0 ? Number((fullRewardDist / stopDistance).toFixed(2)) : 0;

    if (outcome === "LOSS") {
      return {
        riskDollars: Number(riskDollars.toFixed(2)),
        stopDistance,
        quantity,
        plannedR,
        blendedRealizedR: -1,
        theoreticalPnl: Number((-riskDollars).toFixed(2)),
      };
    }
    if (outcome === "BE") {
      return {
        riskDollars: Number(riskDollars.toFixed(2)),
        stopDistance,
        quantity,
        plannedR,
        blendedRealizedR: 0,
        theoreticalPnl: 0,
      };
    }

    let allocatedPct = 0;
    let weightedR = 0;
    for (const p of partials) {
      if (Number.isFinite(p.price) && p.pct > 0) {
        const pct = Math.min(100 - allocatedPct, p.pct);
        allocatedPct += pct;
        const pDist = direction === "long" ? p.price - entry : entry - p.price;
        const pR = stopDistance > 0 ? pDist / stopDistance : 0;
        weightedR += (pct / 100) * pR;
      }
    }
    const remainderPct = Math.max(0, 100 - allocatedPct);
    weightedR += (remainderPct / 100) * plannedR;

    const blendedRealizedR = Number(weightedR.toFixed(2));
    const theoreticalPnl = Number((blendedRealizedR * riskDollars).toFixed(2));

    return {
      riskDollars: Number(riskDollars.toFixed(2)),
      stopDistance,
      quantity,
      plannedR,
      blendedRealizedR,
      theoreticalPnl,
    };
  }, [
    entryStr,
    stopStr,
    targetStr,
    accountSize,
    riskPercent,
    contractMultiplier,
    outcome,
    partials,
    direction,
  ]);

  const syntheticExecutions: ChartExecution[] = useMemo(() => {
    const entry = parseFloat(entryStr);
    const target = parseFloat(targetStr);
    const stop = parseFloat(stopStr);
    if (!Number.isFinite(entry) || entry <= 0) return [];

    const entrySide = direction === "short" ? "sell" : "buy";
    const exitSide = direction === "short" ? "buy" : "sell";
    const openIso = new Date(observedAt || Date.now()).toISOString();
    const closeIso = new Date(exitAt || observedAt || Date.now()).toISOString();

    const list: ChartExecution[] = [
      {
        side: entrySide,
        quantity: calc.quantity,
        price: entry,
        executedAt: openIso,
      },
    ];

    partials.forEach((p, idx) => {
      if (Number.isFinite(p.price) && p.price > 0 && p.pct > 0) {
        const legQty = Number(((calc.quantity * p.pct) / 100).toFixed(2));
        const openMs = Date.parse(openIso);
        const closeMs = Date.parse(closeIso);
        const legMs = openMs + ((closeMs - openMs) * (idx + 1)) / (partials.length + 1);
        list.push({
          side: exitSide,
          quantity: legQty,
          price: p.price,
          executedAt: new Date(legMs).toISOString(),
        });
      }
    });

    const finalExitPrice =
      outcome === "LOSS" && Number.isFinite(stop)
        ? stop
        : Number.isFinite(target)
        ? target
        : entry;

    if (Number.isFinite(finalExitPrice) && finalExitPrice > 0) {
      list.push({
        side: exitSide,
        quantity: calc.quantity,
        price: finalExitPrice,
        executedAt: closeIso,
      });
    }

    return list;
  }, [entryStr, stopStr, targetStr, direction, observedAt, exitAt, calc.quantity, partials, outcome]);

  const partialsPctTotal = useMemo(
    () => Number(partials.reduce((acc, p) => acc + (Number(p.pct) || 0), 0).toFixed(2)),
    [partials]
  );
  const finalFullTpPct = useMemo(
    () => Number((100 - partialsPctTotal).toFixed(2)),
    [partialsPctTotal]
  );
  const isPartialsOver100 = partialsPctTotal > 100;

  const handleSave = async (syncNotion = false) => {
    if (!symbol.trim()) return;
    if (isPartialsOver100) {
      setStatusMsg(
        `Error: Total Partial TP % (${partialsPctTotal}%) cannot exceed 100% of position size.`
      );
      return;
    }
    if (syncNotion) setSyncingNotion(true);
    else setSaving(true);
    setStatusMsg(syncNotion ? "Syncing to Notion..." : "Saving...");

    try {
      const res = await fetch("/api/workspace/missed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: selectedId,
          symbol: symbol.trim().toUpperCase(),
          direction,
          observedAt: new Date(observedAt).toISOString(),
          exitAt: exitAt ? new Date(exitAt).toISOString() : null,
          outcome,
          playbookId: playbookId === "none" ? null : playbookId,
          entry: entryStr !== "" ? Number(entryStr) : null,
          stop: stopStr !== "" ? Number(stopStr) : null,
          target: targetStr !== "" ? Number(targetStr) : null,
          partialsJson: JSON.stringify(partials),
          accountSize,
          riskPercent,
          riskAmount: calc.riskDollars,
          contractMultiplier,
          quantity: calc.quantity,
          plannedR: calc.plannedR,
          realizedR: calc.blendedRealizedR,
          theoreticalPnl: calc.theoreticalPnl,
          maeR: maeRStr !== "" ? Number(maeRStr) : null,
          mfeR: mfeRStr !== "" ? Number(mfeRStr) : null,
          missReason,
          session,
          tagsJson: JSON.stringify(tags),
          mistakesJson: JSON.stringify(mistakes),
          notes,
          reviewNotes,
          rating,
          syncNotion,
        }),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error || "Failed to save missed trade");
      if (out.trade) {
        setSelectedId(out.trade.id);
        if (out.trade.notionUrl) setNotionUrl(out.trade.notionUrl);
      }
      setStatusMsg(
        syncNotion
          ? out.notionSynced
            ? "Synced to Notion"
            : out.notionError || "Saved locally"
          : "Saved"
      );
      refresh();
    } catch (err: any) {
      setStatusMsg(err?.message || "Save failed");
    } finally {
      setSaving(false);
      setSyncingNotion(false);
    }
  };

  const handlePullNotion = async () => {
    if (!selectedId) return;
    setPullingNotion(true);
    setStatusMsg("Pulling from Notion...");
    try {
      const res = await fetch("/api/workspace/missed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: selectedId,
          symbol,
          direction,
          action: "pull_notion",
          activeTab: activeNoteTab,
        }),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error || "Pull failed");
      if (out.trade) {
        loadRecordIntoWorkspace(out.trade);
      }
      setStatusMsg("Pulled from Notion");
      refresh();
    } catch (err: any) {
      setStatusMsg(err?.message || "Pull failed");
    } finally {
      setPullingNotion(false);
    }
  };

  const handleDeleteMissed = async (id: string) => {
    if (!window.confirm("Delete this missed trade opportunity?")) return;
    await fetch("/api/workspace/missed", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, permanent: true }),
    });
    setSelectedId(null);
    refresh();
  };

  const handleApplyExtractedRr = (setup: ExtractedRrSetup) => {
    setDirection(setup.direction);
    setEntryStr(String(setup.entry));
    setStopStr(String(setup.stop));
    setTargetStr(String(setup.target));
    if (Array.isArray(setup.partials) && setup.partials.length > 0) {
      setPartials(setup.partials);
    }
    setObservedAt(setup.entryTimeIso.slice(0, 16));
    setExitAt(setup.exitTimeIso.slice(0, 16));
    setOutcome(setup.outcome);
    setMfeRStr(String(setup.mfeR));
    setMaeRStr(String(setup.maeR));
    setStatusMsg(
      `Populated from Position Tool (${setup.direction.toUpperCase()} • ${setup.realizedR > 0 ? `+${setup.realizedR}R` : `${setup.realizedR}R`} • ${setup.outcome})`
    );
  };

  const handleSplitMouseDown = () => {
    isDraggingRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const onMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const pct = Math.max(25, Math.min(75, (e.clientX / window.innerWidth) * 100));
      setLeftWidth(Math.round(pct * 10) / 10);
    };
    const onUp = () => {
      isDraggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const summaryStats = useMemo(() => {
    const list = activeList;
    const totalMissedPnl = list.reduce((acc, t) => acc + (t.theoreticalPnl || 0), 0);
    const totalMissedR = list.reduce((acc, t) => acc + (t.realizedR || 0), 0);
    const wins = list.filter((t) => t.outcome === "WIN").length;
    const winRate = list.length > 0 ? Math.round((wins / list.length) * 100) : 0;
    return { count: list.length, totalMissedPnl, totalMissedR, winRate };
  }, [activeList]);

  // Monthly Calendar Grid Builder for "Calendar & List" Tab
  const calendarDays = useMemo(() => {
    const [yrStr, moStr] = calendarMonth.split("-");
    const year = parseInt(yrStr || "2026", 10);
    const month = parseInt(moStr || "10", 10) - 1;
    const firstDay = new Date(Date.UTC(year, month, 1));
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const startWeekday = firstDay.getUTCDay();

    const byDate = new Map<
      string,
      { count: number; pnl: number; r: number; items: MissedTradeRecord[] }
    >();
    for (const t of allUnarchived) {
      const dKey = (t.observedAt || "").slice(0, 10);
      if (!dKey.startsWith(calendarMonth)) continue;
      const cur = byDate.get(dKey) || { count: 0, pnl: 0, r: 0, items: [] };
      cur.count++;
      cur.pnl += t.theoreticalPnl || 0;
      cur.r += t.realizedR || 0;
      cur.items.push(t);
      byDate.set(dKey, cur);
    }

    const cells: Array<{
      dateStr: string | null;
      dayNum: number | null;
      stat?: { count: number; pnl: number; r: number; items: MissedTradeRecord[] };
    }> = [];

    for (let i = 0; i < startWeekday; i++) {
      cells.push({ dateStr: null, dayNum: null });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      cells.push({
        dateStr,
        dayNum: d,
        stat: byDate.get(dateStr),
      });
    }
    return cells;
  }, [calendarMonth, allUnarchived]);

  const shiftCalendarMonth = (delta: number) => {
    const [yrStr, moStr] = calendarMonth.split("-");
    const d = new Date(Date.UTC(parseInt(yrStr!, 10), parseInt(moStr!, 10) - 1 + delta, 1));
    setCalendarMonth(d.toISOString().slice(0, 7));
    setSelectedDateFilter(null);
  };

  return (
    <div className="flex flex-col min-h-screen">
      <FilterBar
        title="Missed trades"
        actions={
          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-lg border border-border bg-secondary/40 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setViewMode("workspace")}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-semibold transition ${
                  viewMode === "workspace"
                    ? "bg-card text-foreground shadow-2xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                <span>Setup &amp; Replay</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode("calendar")}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-semibold transition ${
                  viewMode === "calendar"
                    ? "bg-card text-foreground shadow-2xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <CalendarIcon className="h-3.5 w-3.5" />
                <span>Calendar &amp; List ({allUnarchived.length})</span>
              </button>
            </div>

            <Button size="sm" onClick={handleStartNewMissedTrade} className="text-xs font-semibold">
              <Plus className="h-3.5 w-3.5 mr-1" />
              Log Missed Setup
            </Button>
          </div>
        }
      />

      <div className="p-4 space-y-4">
        {/* NEUTRAL SUMMARY BAR (CLEAN IN LIGHT & DARK MODE) */}
        <Card className="border-border/70 bg-card">
          <CardContent className="flex flex-wrap items-center justify-between gap-4 py-3">
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-foreground">
                Missed Trades Vault (Isolated from Executed P&amp;L)
              </div>
              <p className="text-xs text-muted-foreground">
                Setups recorded here do not affect your executed trade stats unless included in
                Journals or Reports.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-6 text-xs">
              <div>
                <div className="text-[10px] uppercase text-muted-foreground">Missed Setups</div>
                <div className="text-sm font-bold text-foreground">{summaryStats.count}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase text-muted-foreground">
                  Theoretical Win Rate
                </div>
                <div className="text-sm font-bold text-foreground">{summaryStats.winRate}%</div>
              </div>
              <div>
                <div className="text-[10px] uppercase text-muted-foreground">
                  Net R Left on Table
                </div>
                <div className="text-sm font-bold text-foreground font-mono">
                  {summaryStats.totalMissedR >= 0
                    ? `+${summaryStats.totalMissedR.toFixed(2)}R`
                    : `${summaryStats.totalMissedR.toFixed(2)}R`}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase text-muted-foreground">
                  Opportunity Cost ($)
                </div>
                <div
                  className={`text-sm font-bold font-mono ${
                    summaryStats.totalMissedPnl >= 0 ? "text-emerald-500" : "text-rose-500"
                  }`}
                >
                  {fmtMoney(summaryStats.totalMissedPnl)}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ===================================================================== */}
        {/* TAB 1: CALENDAR & FILTERABLE MISSED TRADES LIST                       */}
        {/* ===================================================================== */}
        {viewMode === "calendar" && (
          <div className="space-y-4">
            {/* Monthly Calendar Card */}
            <Card className="border-border/70 bg-card">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-sm font-bold">
                    Missed Trades Calendar ({calendarMonth})
                  </CardTitle>
                  {selectedDateFilter && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedDateFilter(null)}
                      className="h-6 text-[11px] px-2"
                    >
                      Showing {selectedDateFilter} ✕
                    </Button>
                  )}
                </div>

                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => shiftCalendarMonth(-1)}
                    className="h-7 px-2"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setCalendarMonth(new Date().toISOString().slice(0, 7))
                    }
                    className="h-7 px-2.5 text-xs"
                  >
                    This Month
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => shiftCalendarMonth(1)}
                    className="h-7 px-2"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-7 gap-1.5 text-center text-[11px] font-semibold text-muted-foreground mb-1.5">
                  {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                    <div key={d}>{d}</div>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-1.5">
                  {calendarDays.map((cell, idx) => {
                    if (!cell.dateStr) {
                      return (
                        <div
                          key={`empty-${idx}`}
                          className="h-20 rounded-lg border border-border/20 bg-muted/10"
                        />
                      );
                    }
                    const isSelected = selectedDateFilter === cell.dateStr;
                    const hasMissed = Boolean(cell.stat && cell.stat.count > 0);
                    return (
                      <button
                        key={cell.dateStr}
                        type="button"
                        onClick={() =>
                          setSelectedDateFilter((prev) =>
                            prev === cell.dateStr ? null : cell.dateStr
                          )
                        }
                        className={`h-20 rounded-lg border p-2 text-left flex flex-col justify-between transition ${
                          isSelected
                            ? "border-foreground bg-secondary"
                            : hasMissed
                            ? "border-border bg-secondary/40 hover:bg-secondary/70"
                            : "border-border/40 bg-background hover:bg-secondary/20"
                        }`}
                      >
                        <div className="flex items-center justify-between w-full">
                          <span className="text-xs font-semibold text-foreground">
                            {cell.dayNum}
                          </span>
                          {hasMissed && (
                            <span className="rounded bg-secondary border border-border px-1.5 py-0.2 text-[10px] font-bold text-foreground">
                              {cell.stat!.count} missed
                            </span>
                          )}
                        </div>
                        {hasMissed && (
                          <div className="text-right font-mono">
                            <div
                              className={`text-xs font-bold ${
                                cell.stat!.pnl >= 0 ? "text-emerald-500" : "text-rose-500"
                              }`}
                            >
                              {fmtMoney(cell.stat!.pnl)}
                            </div>
                            <div className="text-[10px] text-muted-foreground">
                              {cell.stat!.r >= 0
                                ? `+${cell.stat!.r.toFixed(1)}R`
                                : `${cell.stat!.r.toFixed(1)}R`}
                            </div>
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* Filter Bar + Missed Trades List Table */}
            <Card className="border-border/70 bg-card">
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="text-sm font-bold flex items-center gap-2">
                    <LayoutList className="h-4 w-4 text-muted-foreground" />
                    <span>All Missed Trades ({activeList.length})</span>
                  </CardTitle>

                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={reasonFilter}
                      onChange={(e) => setReasonFilter(e.target.value)}
                      className="h-8 rounded-lg border border-border bg-background px-2.5 text-xs text-foreground"
                    >
                      <option value="all">All Reasons</option>
                      {MISS_REASONS.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>

                    <select
                      value={sessionFilter}
                      onChange={(e) => setSessionFilter(e.target.value)}
                      className="h-8 rounded-lg border border-border bg-background px-2.5 text-xs text-foreground"
                    >
                      <option value="all">All Sessions</option>
                      {ICT_SESSIONS.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>

                    <select
                      value={directionFilter}
                      onChange={(e) => setDirectionFilter(e.target.value)}
                      className="h-8 rounded-lg border border-border bg-background px-2.5 text-xs text-foreground"
                    >
                      <option value="all">All Directions</option>
                      <option value="long">Long</option>
                      <option value="short">Short</option>
                    </select>

                    <select
                      value={outcomeFilter}
                      onChange={(e) => setOutcomeFilter(e.target.value)}
                      className="h-8 rounded-lg border border-border bg-background px-2.5 text-xs text-foreground"
                    >
                      <option value="all">All Outcomes</option>
                      <option value="WIN">Win</option>
                      <option value="LOSS">Loss</option>
                      <option value="BE">Breakeven</option>
                    </select>

                    <Input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search symbol or notes..."
                      className="h-8 w-44 text-xs"
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {activeList.length === 0 ? (
                  <div className="py-12 text-center text-xs text-muted-foreground">
                    No missed trades match the active filters.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-border text-muted-foreground">
                          <th className="py-2 px-3">Date &amp; Session</th>
                          <th className="py-2 px-3">Symbol</th>
                          <th className="py-2 px-3">Direction</th>
                          <th className="py-2 px-3">Reason Missed</th>
                          <th className="py-2 px-3">Entry / SL / TP</th>
                          <th className="py-2 px-3">Realized R</th>
                          <th className="py-2 px-3">Theoretical P&amp;L</th>
                          <th className="py-2 px-3 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/40">
                        {activeList.map((item) => (
                          <tr
                            key={item.id}
                            onClick={() => {
                              loadRecordIntoWorkspace(item);
                              setViewMode("workspace");
                            }}
                            className="hover:bg-secondary/40 cursor-pointer transition"
                          >
                            <td className="py-2.5 px-3 font-mono text-muted-foreground">
                              {(item.observedAt || "").slice(0, 16).replace("T", " ")} •{" "}
                              <strong className="text-foreground">{item.session}</strong>
                            </td>
                            <td className="py-2.5 px-3 font-mono font-bold text-foreground">
                              {item.symbol}
                            </td>
                            <td className="py-2.5 px-3">
                              <span
                                className={`uppercase font-semibold ${
                                  item.direction === "short" ? "text-rose-500" : "text-emerald-500"
                                }`}
                              >
                                {item.direction}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 font-medium text-foreground">
                              {item.missReason}
                            </td>
                            <td className="py-2.5 px-3 font-mono text-muted-foreground">
                              {item.entry ?? "—"} / {item.stop ?? "—"} / {item.target ?? "—"}
                            </td>
                            <td className="py-2.5 px-3 font-mono font-semibold text-foreground">
                              {item.realizedR != null
                                ? item.realizedR > 0
                                  ? `+${item.realizedR}R`
                                  : `${item.realizedR}R`
                                : "—"}
                            </td>
                            <td
                              className={`py-2.5 px-3 font-mono font-bold ${
                                item.theoreticalPnl >= 0 ? "text-emerald-500" : "text-rose-500"
                              }`}
                            >
                              {fmtMoney(item.theoreticalPnl)}
                            </td>
                            <td
                              className="py-2.5 px-3 text-right"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs mr-1.5"
                                onClick={() => {
                                  loadRecordIntoWorkspace(item);
                                  setViewMode("workspace");
                                }}
                              >
                                Open Replay
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-rose-500 hover:bg-rose-500/10"
                                onClick={() => void handleDeleteMissed(item.id)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* ===================================================================== */}
        {/* TAB 2: SETUP & REPLAY WORKSPACE                                       */}
        {/* ===================================================================== */}
        {viewMode === "workspace" && (
          <>
            {/* Quick Selector Strip */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/60 bg-card p-2.5">
              <div className="flex flex-wrap items-center gap-1.5 overflow-x-auto max-w-full">
                <button
                  type="button"
                  onClick={handleStartNewMissedTrade}
                  className="inline-flex items-center gap-1 rounded-lg border border-border bg-secondary/50 hover:bg-secondary px-2.5 py-1.5 text-xs font-semibold text-foreground shrink-0"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>New</span>
                </button>

                {activeList.map((item) => {
                  const active = item.id === selectedId;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => loadRecordIntoWorkspace(item)}
                      className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold transition shrink-0 ${
                        active
                          ? "border-foreground bg-secondary text-foreground shadow-2xs"
                          : "border-border/50 bg-background text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <span className="font-mono font-bold">{item.symbol}</span>
                      <span
                        className={`uppercase text-[10px] ${
                          item.direction === "short" ? "text-rose-500" : "text-emerald-500"
                        }`}
                      >
                        {item.direction}
                      </span>
                      <span className="text-[10px] font-mono">
                        {item.realizedR != null
                          ? item.realizedR > 0
                            ? `+${item.realizedR}R`
                            : `${item.realizedR}R`
                          : ""}
                      </span>
                      <span className="text-[10px] opacity-75">
                        {(item.observedAt || "").slice(5, 10)}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center gap-2">
                <select
                  value={reasonFilter}
                  onChange={(e) => setReasonFilter(e.target.value)}
                  className="h-8 rounded-lg border border-border bg-background px-2.5 text-xs text-foreground"
                >
                  <option value="all">All Miss Reasons</option>
                  {MISS_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filter symbol or notes..."
                  className="h-8 w-44 text-xs"
                />
              </div>
            </div>

            {/* KPI Header Bar */}
            <Card className="border-border/70 bg-card">
              <CardContent className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-3.5">
                <div className="flex items-center gap-3">
                  <Badge variant="outline" className="uppercase font-bold text-[11px] px-2.5 py-1">
                    MISSED TRADE
                  </Badge>
                  <div>
                    <div className="text-[11px] text-muted-foreground">Theoretical P&amp;L</div>
                    <div
                      className={`text-xl font-bold font-mono ${
                        calc.theoreticalPnl >= 0 ? "text-emerald-500" : "text-rose-500"
                      }`}
                    >
                      {fmtMoney(calc.theoreticalPnl)}
                    </div>
                  </div>
                  <Badge
                    variant={
                      outcome === "WIN" ? "profit" : outcome === "LOSS" ? "loss" : "secondary"
                    }
                    className="text-xs uppercase font-semibold px-2.5 py-1"
                  >
                    {outcome}
                  </Badge>
                </div>

                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
                  <div>
                    <div className="text-[10px] text-muted-foreground">Auto Position Size</div>
                    <div className="font-mono font-bold text-foreground">{calc.quantity} Lots</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground">$ Risk ({riskPercent}%)</div>
                    <div className="font-mono font-semibold text-foreground">
                      {fmtMoney(calc.riskDollars)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground">Planned R</div>
                    <div className="font-mono font-semibold text-foreground">{calc.plannedR}R</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground">Theoretical Realized R</div>
                    <div
                      className={`font-mono font-bold ${
                        calc.blendedRealizedR >= 0 ? "text-emerald-500" : "text-rose-500"
                      }`}
                    >
                      {calc.blendedRealizedR > 0
                        ? `+${calc.blendedRealizedR}R`
                        : `${calc.blendedRealizedR}R`}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground">MFE / MAE</div>
                    <div className="font-mono font-semibold text-foreground">
                      {mfeRStr ? `+${mfeRStr}R` : "—"} / {maeRStr ? `-${maeRStr}R` : "—"}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground">Why Missed</div>
                    <div className="font-semibold text-foreground">{missReason}</div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 border-l border-border/50 pl-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setLeftCollapsed(!leftCollapsed)}
                    className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
                  >
                    {leftCollapsed ? (
                      <PanelLeftOpen className="h-4 w-4" />
                    ) : (
                      <PanelLeftClose className="h-4 w-4" />
                    )}
                    <span className="hidden sm:inline ml-1">Journal</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setRightCollapsed(!rightCollapsed)}
                    className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
                  >
                    {rightCollapsed ? (
                      <PanelRightOpen className="h-4 w-4" />
                    ) : (
                      <PanelRightClose className="h-4 w-4" />
                    )}
                    <span className="hidden sm:inline ml-1">Chart Replay</span>
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Resizable 2-Column Split */}
            <div className="flex flex-col lg:flex-row gap-0 relative items-stretch min-h-[640px]">
              {!leftCollapsed && (
                <div
                  style={{
                    width: rightCollapsed ? "100%" : `${leftWidth}%`,
                    flexShrink: 0,
                  }}
                  className="space-y-4 pr-0 lg:pr-3 min-w-[320px]"
                >
                  <Card className="border-border/70">
                    <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
                      <CardTitle className="text-sm font-bold">
                        Missed Setup Execution, Position Sizer &amp; Journal
                      </CardTitle>

                      <div className="flex flex-wrap items-center gap-1.5">
                        {statusMsg && (
                          <span className="text-[11px] font-medium text-muted-foreground mr-1">
                            {statusMsg}
                          </span>
                        )}
                        {notionUrl && (
                          <a
                            href={notionUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex h-7 items-center gap-1 rounded-lg border border-border bg-secondary/40 px-2.5 text-[11px] font-medium text-foreground hover:bg-secondary"
                          >
                            <span>Open in Notion</span>
                            <ExternalLink className="h-3 w-3 opacity-70" />
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={handlePullNotion}
                          disabled={pullingNotion || syncingNotion}
                          className="inline-flex h-7 items-center gap-1 rounded-lg border border-border bg-secondary/40 px-2.5 text-[11px] font-medium text-foreground hover:bg-secondary disabled:opacity-50"
                        >
                          {pullingNotion ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Download className="h-3 w-3" />
                          )}
                          <span>Pull Notion</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleSave(true)}
                          disabled={saving || syncingNotion}
                          className="inline-flex h-7 items-center gap-1 rounded-lg border border-border bg-secondary/40 px-2.5 text-[11px] font-medium text-foreground hover:bg-secondary disabled:opacity-50"
                        >
                          {syncingNotion ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <UploadCloud className="h-3 w-3" />
                          )}
                          <span>Sync to Notion</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleSave(false)}
                          disabled={saving}
                          className="inline-flex h-7 items-center gap-1 rounded-lg border border-border bg-secondary hover:bg-secondary/80 px-3 text-[11px] font-semibold text-foreground shadow-2xs transition"
                        >
                          <Save className="h-3 w-3" />
                          <span>{saving ? "Saving..." : "Save"}</span>
                        </button>
                        {selectedId && (
                          <button
                            type="button"
                            onClick={() => void handleDeleteMissed(selectedId)}
                            className="inline-flex h-7 items-center justify-center rounded-lg bg-rose-500/15 hover:bg-rose-500/25 px-2 text-rose-500"
                            title="Delete missed trade"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </CardHeader>

                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                        <div>
                          <label className="block text-[11px] text-muted-foreground mb-0.5">
                            Symbol
                          </label>
                          <Input
                            value={symbol}
                            onChange={(e) => {
                              const s = e.target.value.toUpperCase();
                              setSymbol(s);
                              setContractMultiplier(inferDefaultPointMultiplier(s));
                            }}
                            placeholder="NAS100, US500, XAUUSD"
                            className="h-8 text-xs font-mono font-bold"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-muted-foreground mb-0.5">
                            Direction
                          </label>
                          <select
                            value={direction}
                            onChange={(e) => setDirection(e.target.value as "long" | "short")}
                            className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs font-bold text-foreground"
                          >
                            <option value="long">▲ LONG</option>
                            <option value="short">▼ SHORT</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[11px] text-muted-foreground mb-0.5">
                            Theoretical Outcome
                          </label>
                          <select
                            value={outcome}
                            onChange={(e) => setOutcome(e.target.value as "WIN" | "LOSS" | "BE")}
                            className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs font-bold text-foreground"
                          >
                            <option value="WIN">WIN (Hit Target)</option>
                            <option value="LOSS">LOSS (Hit Stop)</option>
                            <option value="BE">BREAKEVEN</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[11px] text-muted-foreground mb-0.5">
                            ICT Session
                          </label>
                          <select
                            value={session}
                            onChange={(e) => setSession(e.target.value)}
                            className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground"
                          >
                            {ICT_SESSIONS.map((s) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                        <div>
                          <label className="block text-[11px] text-muted-foreground mb-0.5">
                            Setup Entry Time (Observed At)
                          </label>
                          <input
                            type="datetime-local"
                            value={observedAt}
                            onChange={(e) => setObservedAt(e.target.value)}
                            className="h-8 w-full rounded-md border border-border bg-background px-2.5 text-xs text-foreground"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-muted-foreground mb-0.5">
                            Theoretical Exit Time (TP / SL Hit)
                          </label>
                          <input
                            type="datetime-local"
                            value={exitAt}
                            onChange={(e) => setExitAt(e.target.value)}
                            className="h-8 w-full rounded-md border border-border bg-background px-2.5 text-xs text-foreground"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold text-foreground mb-0.5">
                            Primary Reason Trade Was Missed
                          </label>
                          <select
                            value={missReason}
                            onChange={(e) => setMissReason(e.target.value)}
                            className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground font-medium"
                          >
                            {MISS_REASONS.map((r) => (
                              <option key={r} value={r}>
                                {r}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[11px] text-muted-foreground mb-0.5">
                            Playbook / Strategy Model
                          </label>
                          <select
                            value={playbookId}
                            onChange={(e) => setPlaybookId(e.target.value)}
                            className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground"
                          >
                            <option value="none">No Playbook</option>
                            {books?.playbooks.map((b) => (
                              <option key={b.id} value={b.id}>
                                {b.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {/* AUTOMATIC POSITION SIZER & KEY LEVELS */}
                      <div className="rounded-xl border border-border/70 bg-secondary/20 p-3 space-y-3">
                        <div className="flex items-center justify-between border-b border-border/40 pb-1.5">
                          <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                            <Calculator className="h-3.5 w-3.5 text-muted-foreground" />
                            Automatic Position Sizer &amp; Price Levels
                          </span>
                          <span className="text-[11px] font-mono text-foreground font-bold">
                            Auto Size: {calc.quantity} Lots • Risk: {fmtMoney(calc.riskDollars)}
                          </span>
                        </div>

                        <div className="grid grid-cols-3 gap-2 text-xs">
                          <div>
                            <label className="block text-[10px] text-muted-foreground mb-0.5">
                              Account Size ($)
                            </label>
                            <Input
                              type="number"
                              value={accountSize}
                              onChange={(e) => setAccountSize(Number(e.target.value) || 0)}
                              className="h-7 text-xs font-mono"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] text-muted-foreground mb-0.5">
                              Risk % per Trade
                            </label>
                            <Input
                              type="number"
                              step="0.1"
                              value={riskPercent}
                              onChange={(e) => setRiskPercent(Number(e.target.value) || 0)}
                              className="h-7 text-xs font-mono"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] text-muted-foreground mb-0.5">
                              $ per Point / 1 Lot
                            </label>
                            <Input
                              type="number"
                              step="any"
                              value={contractMultiplier}
                              onChange={(e) => setContractMultiplier(Number(e.target.value) || 1)}
                              className="h-7 text-xs font-mono"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 text-xs">
                          <div>
                            <label className="block text-[10px] text-muted-foreground mb-0.5">
                              Planned Entry
                            </label>
                            <Input
                              type="number"
                              step="any"
                              value={entryStr}
                              onChange={(e) => setEntryStr(e.target.value)}
                              placeholder="Entry"
                              className="h-8 text-xs font-mono"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] text-muted-foreground mb-0.5">
                              Stop Loss (SL)
                            </label>
                            <Input
                              type="number"
                              step="any"
                              value={stopStr}
                              onChange={(e) => setStopStr(e.target.value)}
                              placeholder="Stop"
                              className="h-8 text-xs font-mono"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] text-muted-foreground mb-0.5">
                              Full Take Profit
                            </label>
                            <Input
                              type="number"
                              step="any"
                              value={targetStr}
                              onChange={(e) => setTargetStr(e.target.value)}
                              placeholder="Full TP"
                              className="h-8 text-xs font-mono"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] text-muted-foreground mb-0.5">
                              MFE (R)
                            </label>
                            <Input
                              type="number"
                              step="any"
                              value={mfeRStr}
                              onChange={(e) => setMfeRStr(e.target.value)}
                              placeholder="Auto"
                              className="h-8 text-xs font-mono"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] text-muted-foreground mb-0.5">
                              MAE (R)
                            </label>
                            <Input
                              type="number"
                              step="any"
                              value={maeRStr}
                              onChange={(e) => setMaeRStr(e.target.value)}
                              placeholder="Auto"
                              className="h-8 text-xs font-mono"
                            />
                          </div>
                        </div>

                        {/* MULTI-PARTIALS BUILDER (EQUAL DEFAULT SPLIT + <=100% VALIDATION + LOCKED FINAL FULL TP) */}
                        <div className="space-y-2 border-t border-border/40 pt-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-semibold text-foreground">
                              Take Partials Plan (Spreads % Equally by Default • Final Leg = Full TP)
                            </span>
                            <div className="flex items-center gap-1.5">
                              {partials.length > 0 && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setPartials((prev) =>
                                      rebalanceEqualPartialsForm(
                                        prev.map((p) => ({ ...p, manualPct: false })),
                                        parseFloat(entryStr) || 0,
                                        parseFloat(targetStr) || 0
                                      )
                                    )
                                  }
                                  className="text-[10px] underline text-muted-foreground hover:text-foreground"
                                >
                                  Equal % Split
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() =>
                                  setPartials((prev) => {
                                    const nextRaw: PartialTarget[] = [
                                      ...prev.map((p) => ({ ...p, manualPct: false })),
                                      {
                                        id: `tp_${Date.now()}`,
                                        label: `TP${prev.length + 1}`,
                                        price: 0,
                                        pct: 0,
                                        manualPct: false,
                                      },
                                    ];
                                    return rebalanceEqualPartialsForm(
                                      nextRaw,
                                      parseFloat(entryStr) || 0,
                                      parseFloat(targetStr) || 0
                                    );
                                  })
                                }
                                className="inline-flex items-center gap-1 rounded border border-border bg-secondary/50 hover:bg-secondary px-2 py-0.5 text-[10px] font-semibold text-foreground"
                              >
                                <Plus className="h-3 w-3" />
                                <span>Add Partial TP</span>
                              </button>
                            </div>
                          </div>

                          {isPartialsOver100 && (
                            <div
                              role="alert"
                              className="rounded-md border border-rose-500/50 bg-rose-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-rose-400"
                            >
                              Error: Partial TP allocations total {partialsPctTotal}%, which exceeds
                              100% of your position size! Please reduce partial % so total ≤ 100%.
                            </div>
                          )}

                          {partials.map((p, idx) => (
                            <div key={p.id} className="flex items-center gap-2 text-xs">
                              <span className="font-mono text-[11px] font-bold text-foreground w-10">
                                TP{idx + 1}
                              </span>
                              <Input
                                type="number"
                                step="any"
                                value={p.price}
                                onChange={(e) => {
                                  const val = Number(e.target.value);
                                  setPartials((prev) =>
                                    prev.map((it, i) => (i === idx ? { ...it, price: val } : it))
                                  );
                                }}
                                placeholder="Partial Price"
                                className="h-7 flex-1 text-xs font-mono"
                              />
                              <div className="flex items-center gap-1">
                                <Input
                                  type="number"
                                  step="any"
                                  value={p.pct}
                                  onChange={(e) => {
                                    const val = Math.max(0, Number(e.target.value) || 0);
                                    setPartials((prev) =>
                                      prev.map((it, i) =>
                                        i === idx ? { ...it, pct: val, manualPct: true } : it
                                      )
                                    );
                                  }}
                                  className={`h-7 w-16 text-xs font-mono text-center ${
                                    isPartialsOver100 ? "border-rose-500 text-rose-400" : ""
                                  }`}
                                />
                                <span className="text-[11px] text-muted-foreground">%</span>
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  setPartials((prev) => {
                                    const filtered = prev.filter((_, i) => i !== idx);
                                    return rebalanceEqualPartialsForm(
                                      filtered,
                                      parseFloat(entryStr) || 0,
                                      parseFloat(targetStr) || 0
                                    );
                                  })
                                }
                                className="p-1 text-rose-500 hover:bg-rose-500/15 rounded"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ))}

                          {/* Final TP Row — Always Locked to Full Take Profit */}
                          <div className="flex items-center justify-between rounded-md border border-border/60 bg-background px-2.5 py-1.5 text-xs">
                            <span className="font-mono text-[11px] font-bold text-foreground">
                              Final TP (Full Take Profit)
                            </span>
                            <span className="font-mono text-xs text-muted-foreground">
                              Price:{" "}
                              <strong className="text-foreground">
                                {targetStr || "—"}
                              </strong>
                            </span>
                            <span
                              className={`font-mono text-xs font-bold ${
                                finalFullTpPct < 0 ? "text-rose-400" : "text-emerald-500"
                              }`}
                            >
                              {finalFullTpPct}% of position
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-1">
                        <TradeRating
                          value={rating}
                          onChange={async (val) => {
                            setRating(val);
                          }}
                        />
                      </div>

                      <TradeTagsEditor
                        selectedTags={tags}
                        selectedMistakes={mistakes}
                        onChange={(nextTags, nextMistakes) => {
                          setTags(nextTags);
                          setMistakes(nextMistakes);
                        }}
                      />

                      <div>
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-2">
                          <div className="flex items-center gap-1 rounded-xl bg-secondary/40 p-1 border border-border/60">
                            <button
                              type="button"
                              onClick={() => setActiveNoteTab("setup")}
                              className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                                activeNoteTab === "setup"
                                  ? "bg-card text-foreground border border-border shadow-2xs"
                                  : "text-muted-foreground hover:text-foreground"
                              }`}
                            >
                              Setup &amp; Context Notes
                            </button>
                            <button
                              type="button"
                              onClick={() => setActiveNoteTab("review")}
                              className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                                activeNoteTab === "review"
                                  ? "bg-card text-foreground border border-border shadow-2xs"
                                  : "text-muted-foreground hover:text-foreground"
                              }`}
                            >
                              Missed Trade Review
                            </button>
                          </div>

                          <VoiceNote
                            onPrepare={() => noteEditorRef.current?.focus()}
                            onText={(text) => {
                              if (activeNoteTab === "review") {
                                setReviewNotes((prev) => (prev ? `${prev} ${text}` : text));
                              } else {
                                setNotes((prev) => (prev ? `${prev} ${text}` : text));
                              }
                            }}
                          />
                        </div>

                        <RichEditor
                          key={`${selectedId || "new"}-${activeNoteTab}`}
                          editorRef={noteEditorRef}
                          value={activeNoteTab === "review" ? reviewNotes : notes}
                          onChange={activeNoteTab === "review" ? setReviewNotes : setNotes}
                          ownerType="missed"
                          ownerId={`${selectedId || "new"}-${activeNoteTab}`}
                          companionNode={<MissedTradePeriodCompanion observedAt={observedAt} />}
                        />
                      </div>
                    </CardContent>
                  </Card>

                  <MissedTradePeriodCompanion observedAt={observedAt} />
                </div>
              )}

              {!leftCollapsed && !rightCollapsed && (
                <div
                  onMouseDown={handleSplitMouseDown}
                  className="hidden lg:flex w-2.5 cursor-col-resize items-center justify-center bg-transparent hover:bg-secondary transition-colors group z-10"
                  title="Drag to resize split"
                >
                  <div className="h-16 w-1 rounded-full bg-border/60 group-hover:bg-foreground transition-colors" />
                </div>
              )}

              {!rightCollapsed && (
                <div
                  style={{
                    width: leftCollapsed ? "100%" : `calc(${100 - leftWidth}% - 10px)`,
                    flexShrink: 0,
                  }}
                  className="space-y-4 pl-0 lg:pl-3 min-w-[340px]"
                >
                  <TradeMarketData
                    key={`${selectedId || "new"}_${symbol}`}
                    trade={{
                      key: selectedId || "missed_sim",
                      symbol: symbol || "NAS100",
                      direction,
                      openedAt: new Date(observedAt || Date.now()).toISOString(),
                      closedAt: new Date(exitAt || observedAt || Date.now()).toISOString(),
                      netPnl: calc.theoreticalPnl,
                      avgEntry: parseFloat(entryStr) || 0,
                      avgExit: parseFloat(targetStr) || null,
                      currency: "USD",
                    }}
                    executions={syntheticExecutions}
                    onExtractRr={handleApplyExtractedRr}
                    onJumpDateChange={(iso) => {
                      setObservedAt(iso.slice(0, 16));
                    }}
                    initialRrOverlay={
                      entryStr && stopStr && targetStr
                        ? {
                            direction,
                            entry: parseFloat(entryStr),
                            stop: parseFloat(stopStr),
                            target: parseFloat(targetStr),
                            partials,
                          }
                        : null
                    }
                  />
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
