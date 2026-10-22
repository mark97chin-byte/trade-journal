"use client";

import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CloudUpload,
  ExternalLink,
  FileText,
  Save,
  CheckSquare,
  Square,
  Target,
  ShieldCheck,
  TrendingUp,
  ArrowRight,
  ArrowDownToLine,
  Pencil,
  Plus,
  Trash2,
  Check,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import { RichEditor, type RichEditorHandle } from "@/components/rich-editor";
import { VoiceNote } from "@/components/voice-note";
import { ReviewExport } from "@/components/review-export";
import { EconomicCalendarCard } from "@/components/journal/economic-calendar-card";
import { PeriodReviewCompanionCard } from "@/components/journal/period-review-companion-card";
import type { JournalEntryRecord, PeriodKey } from "@/server/journal-service";
import type { JournalTrade } from "./journal-view";

interface JournalEntryEditorProps {
  initialEntry: JournalEntryRecord;
  trades: JournalTrade[];
  range: {
    periodType: "day" | "week" | "month" | "quarter" | "year";
    startDate: string;
    endDate: string;
    anchorDate: string;
    defaultTitle: string;
  };
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

function getMondayStr(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  const day = d.getUTCDay();
  const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
  const mon = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), diff));
  return mon.toISOString().slice(0, 10);
}

const FALLBACK_PERIOD_CHECKLISTS: Record<PeriodKey, Array<{ id: string; label: string }>> = {
  day: [
    { id: "htf_narrative", label: "Mapped HTF Draw on Liquidity & Daily Relevant Swing" },
    { id: "session_timing", label: "Waited for key session window / 7H profile alignment" },
    { id: "purge_confirmation", label: "Waited for liquidity sweep + displacement before entry" },
    { id: "risk_respected", label: "Sized position properly & respected hard stop loss" },
    { id: "no_fomo_revenge", label: "Zero impulse, FOMO, or revenge executions" },
  ],
  week: [
    { id: "wk_econ_calendar", label: "Reviewed ForexFactory high-impact USD news & holidays" },
    { id: "wk_htf_dol", label: "Mapped Weekly / Monthly Draw on Liquidity across ES, NQ, Gold, DXY" },
    { id: "wk_smt_levels", label: "Identified key intermarket SMT & Weekly opening range levels" },
    { id: "wk_risk_cap", label: "Defined weekly max drawdown limit & A+ session focus" },
  ],
  month: [
    { id: "mo_macro_review", label: "Audited Monthly candle closures & quarterly dealing ranges" },
    { id: "mo_edge_stats", label: "Reviewed win rate, R-distribution, and playbook expectancy" },
    { id: "mo_mistake_audit", label: "Categorized top execution errors & updated rule filters" },
  ],
  quarter: [
    { id: "q_macro_shift", label: "Evaluated quarterly macro regime & seasonal tendencies" },
    { id: "q_prop_alloc", label: "Reviewed account allocation, payouts, and drawdown buffers" },
    { id: "q_system_refinement", label: "Refined core Playbook criteria based on 90-day sample" },
  ],
  year: [
    { id: "yr_full_audit", label: "Completed full annual performance & tax/payout reconciliation" },
    { id: "yr_edge_evolution", label: "Documented highest-expectancy setups & eliminated low-EV habits" },
    { id: "yr_goals_next", label: "Established capital & process milestones for the upcoming year" },
  ],
};

export function JournalEntryEditor({
  initialEntry,
  trades,
  range,
}: JournalEntryEditorProps) {
  const router = useRouter();
  const noteEditorRef = useRef<RichEditorHandle>(null);

  const [activeTab, setActiveTab] = useState<"prep" | "review">("prep");
  const [title, setTitle] = useState(initialEntry.title);
  const [content, setContent] = useState(initialEntry.content);
  const [reviewContent, setReviewContent] = useState(
    initialEntry.reviewContent || ""
  );
  const [lessonsLearned, setLessonsLearned] = useState(
    initialEntry.lessonsLearned || ""
  );

  const [notionUrl, setNotionUrl] = useState<string | null>(
    initialEntry.notionUrl ||
      (initialEntry.notionPageId
        ? `https://www.notion.so/${initialEntry.notionPageId.replace(/-/g, "")}`
        : null)
  );
  const [reviewNotionUrl, setReviewNotionUrl] = useState<string | null>(
    initialEntry.reviewNotionUrl ||
      (initialEntry.reviewNotionPageId
        ? `https://www.notion.so/${initialEntry.reviewNotionPageId.replace(/-/g, "")}`
        : null)
  );

  // Per-period customizable DEFAULT checklist definitions + Entry-specific custom items
  const [periodChecklists, setPeriodChecklists] = useState<
    Record<PeriodKey, Array<{ id: string; label: string }>>
  >(FALLBACK_PERIOD_CHECKLISTS);
  const [editingChecklist, setEditingChecklist] = useState(false);
  const [newDefaultItemText, setNewDefaultItemText] = useState("");
  const [newLocalItemText, setNewLocalItemText] = useState("");

  useEffect(() => {
    fetch("/api/journal/config?autopopulate=1")
      .then((r) => r.json())
      .then((data) => {
        if (data?.config?.checklists) {
          setPeriodChecklists((prev) => ({ ...prev, ...data.config.checklists }));
        }
      })
      .catch(() => {});
  }, []);

  const currentChecklistDefs = useMemo(
    () => periodChecklists[range.periodType] || FALLBACK_PERIOD_CHECKLISTS[range.periodType],
    [periodChecklists, range.periodType]
  );

  const persistPeriodChecklistDefs = (
    nextItems: Array<{ id: string; label: string }>
  ) => {
    const nextMap = {
      ...periodChecklists,
      [range.periodType]: nextItems,
    };
    setPeriodChecklists(nextMap);
    void fetch("/api/journal/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checklists: nextMap }),
    });
  };

  const [checklist, setChecklist] = useState<Record<string, any>>(() => {
    try {
      return JSON.parse(initialEntry.checklistJson || "{}");
    } catch {
      return {};
    }
  });

  const entryCustomItems: Array<{ id: string; label: string }> = useMemo(() => {
    return Array.isArray(checklist._customItems) ? checklist._customItems : [];
  }, [checklist._customItems]);

  const updateEntryCustomItems = (nextCustom: Array<{ id: string; label: string }>) => {
    setChecklist((prev) => ({
      ...prev,
      _customItems: nextCustom,
    }));
  };

  const [scores, setScores] = useState<{
    planAdherence: number;
    execution: number;
    riskMgmt: number;
    mentalState: number;
  }>(() => {
    try {
      const parsed = JSON.parse(initialEntry.scoresJson || "{}");
      return {
        planAdherence: parsed.planAdherence ?? 4,
        execution: parsed.execution ?? 4,
        riskMgmt: parsed.riskMgmt ?? 4,
        mentalState: parsed.mentalState ?? 4,
      };
    } catch {
      return { planAdherence: 4, execution: 4, riskMgmt: 4, mentalState: 4 };
    }
  });

  const [saving, setSaving] = useState(false);
  const [periodMissedTrades, setPeriodMissedTrades] = useState<any[]>([]);
  const [includeMissedInStats, setIncludeMissedInStats] = useState<boolean>(false);
  const [bottomTradesTab, setBottomTradesTab] = useState<"executed" | "missed">("executed");

  useEffect(() => {
    fetch(
      `/api/reports/missed-analytics?from=${encodeURIComponent(
        range.startDate
      )}&to=${encodeURIComponent(range.endDate)}`
    )
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d?.missedTrades)) {
          setPeriodMissedTrades(d.missedTrades);
        }
      })
      .catch(() => {});
  }, [range.startDate, range.endDate]);

  const missedSummary = useMemo(() => {
    const count = periodMissedTrades.length;
    const winningMisses = periodMissedTrades.filter(
      (m) => (m.outcome || "WIN") === "WIN" || Number(m.theoretical_pnl || 0) > 0
    );
    const losingMisses = periodMissedTrades.filter(
      (m) => m.outcome === "LOSS" || Number(m.theoretical_pnl || 0) < 0
    );

    const leftOnTablePnl = winningMisses.reduce(
      (acc, m) => acc + Math.max(0, Number(m.theoretical_pnl || 0)),
      0
    );
    const leftOnTableR = winningMisses.reduce(
      (acc, m) => acc + Math.max(0, Number(m.realized_r ?? m.planned_r ?? 0)),
      0
    );

    const losingMissesPnl = losingMisses.reduce(
      (acc, m) => acc + Number(m.theoretical_pnl || 0),
      0
    );
    const losingMissesR = losingMisses.reduce(
      (acc, m) => acc + Number(m.realized_r ?? -1),
      0
    );

    const netPnl = periodMissedTrades.reduce(
      (acc, m) => acc + Number(m.theoretical_pnl || 0),
      0
    );
    const netR = periodMissedTrades.reduce(
      (acc, m) => acc + Number(m.realized_r ?? m.planned_r ?? 0),
      0
    );

    const totalOpportunities = trades.length + count;
    const captureEfficiencyPct =
      totalOpportunities > 0
        ? Math.round((trades.length / totalOpportunities) * 100)
        : 100;

    const reasonCounts: Record<string, number> = {};
    for (const m of periodMissedTrades) {
      const r = m.miss_reason || "Hesitation / Fear";
      reasonCounts[r] = (reasonCounts[r] || 0) + 1;
    }
    const topReason =
      Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "—";

    return {
      count,
      winningCount: winningMisses.length,
      losingCount: losingMisses.length,
      leftOnTablePnl,
      leftOnTableR,
      losingMissesPnl,
      losingMissesR,
      netPnl,
      netR,
      captureEfficiencyPct,
      topReason,
    };
  }, [periodMissedTrades, trades.length]);
  const [syncingNotion, setSyncingNotion] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  // Draggable 2-column split ratio (saved in localStorage so user can widen Review Companion)
  const [leftWidth, setLeftWidth] = useState<number>(64);
  const [rightCollapsed, setRightCollapsed] = useState<boolean>(false);
  const isDraggingSplitRef = useRef<boolean>(false);

  useEffect(() => {
    try {
      const savedRatio = localStorage.getItem("tz_journal_split_ratio");
      if (savedRatio) {
        const num = Number(savedRatio);
        if (num >= 30 && num <= 80) setLeftWidth(num);
      }
    } catch {}
  }, []);

  const handleSplitMouseDown = () => {
    isDraggingSplitRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMouseMove = (e: MouseEvent) => {
      if (!isDraggingSplitRef.current) return;
      const totalWidth = window.innerWidth;
      const newPct = Math.max(32, Math.min(78, (e.clientX / totalWidth) * 100));
      setLeftWidth(Math.round(newPct * 10) / 10);
    };

    const onMouseUp = () => {
      isDraggingSplitRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      try {
        localStorage.setItem("tz_journal_split_ratio", String(leftWidth));
      } catch {}
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  useEffect(() => {
    setTitle(initialEntry.title);
    setContent(initialEntry.content);
    setReviewContent(initialEntry.reviewContent || "");
    setLessonsLearned(initialEntry.lessonsLearned || "");
    setNotionUrl(
      initialEntry.notionUrl ||
        (initialEntry.notionPageId
          ? `https://www.notion.so/${initialEntry.notionPageId.replace(/-/g, "")}`
          : null)
    );
    setReviewNotionUrl(
      initialEntry.reviewNotionUrl ||
        (initialEntry.reviewNotionPageId
          ? `https://www.notion.so/${initialEntry.reviewNotionPageId.replace(/-/g, "")}`
          : null)
    );
    try {
      setChecklist(JSON.parse(initialEntry.checklistJson || "{}"));
    } catch {
      setChecklist({});
    }
    try {
      const parsed = JSON.parse(initialEntry.scoresJson || "{}");
      setScores({
        planAdherence: parsed.planAdherence ?? 4,
        execution: parsed.execution ?? 4,
        riskMgmt: parsed.riskMgmt ?? 4,
        mentalState: parsed.mentalState ?? 4,
      });
    } catch {}
  }, [initialEntry]);

  const [activeAnchor, setActiveAnchor] = useState<string>(range.anchorDate);

  useEffect(() => {
    if (range.periodType === "day" || range.periodType === "week") {
      setActiveAnchor(range.anchorDate);
      try {
        localStorage.setItem("tz_active_journal_anchor", range.anchorDate);
      } catch {}
      return;
    }

    try {
      const saved = localStorage.getItem("tz_active_journal_anchor");
      if (saved && /^\d{4}-\d{2}-\d{2}$/.test(saved)) {
        const currentYear = range.anchorDate.slice(0, 4);
        if (range.periodType === "year" && saved.startsWith(currentYear)) {
          setActiveAnchor(saved);
          return;
        } else if (
          range.periodType === "month" &&
          saved.startsWith(range.anchorDate.slice(0, 7))
        ) {
          setActiveAnchor(saved);
          return;
        } else if (range.periodType === "quarter") {
          const qNum =
            Math.floor((parseInt(range.anchorDate.slice(5, 7), 10) - 1) / 3) + 1;
          const savedMonth = parseInt(saved.slice(5, 7), 10);
          const savedQ = Math.floor((savedMonth - 1) / 3) + 1;
          if (saved.startsWith(currentYear) && savedQ === qNum) {
            setActiveAnchor(saved);
            return;
          }
        }
      }
    } catch {}

    setActiveAnchor(range.anchorDate);
  }, [range.periodType, range.anchorDate]);

  const hierarchyLinks = useMemo(() => {
    const anchor = activeAnchor || range.anchorDate;
    const yr = anchor.slice(0, 4);
    const mo = anchor.slice(0, 7);
    const monthNum = parseInt(anchor.slice(5, 7), 10);
    const qNum = Math.floor((monthNum - 1) / 3) + 1;
    const mondayStr = getMondayStr(anchor);

    return [
      {
        type: "day" as const,
        label: `Day (${anchor.slice(5)})`,
        href: `/journal/${anchor}`,
      },
      {
        type: "week" as const,
        label: `Week (${mondayStr.slice(5)})`,
        href: `/journal/week-${mondayStr}`,
      },
      {
        type: "month" as const,
        label: `Month (${mo})`,
        href: `/journal/month-${mo}`,
      },
      {
        type: "quarter" as const,
        label: `Quarter (${yr}-Q${qNum})`,
        href: `/journal/quarter-${yr}-Q${qNum}`,
      },
      {
        type: "year" as const,
        label: `Year (${yr})`,
        href: `/journal/year-${yr}`,
      },
    ];
  }, [activeAnchor, range.anchorDate]);

  const adjacentSlugs = useMemo(() => {
    const d = new Date(`${range.anchorDate}T12:00:00Z`);
    if (range.periodType === "day") {
      const prev = new Date(d.getTime() - 86_400_000).toISOString().slice(0, 10);
      const next = new Date(d.getTime() + 86_400_000).toISOString().slice(0, 10);
      return { prev: `/journal/${prev}`, next: `/journal/${next}` };
    }
    if (range.periodType === "week") {
      const prev = new Date(d.getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
      const next = new Date(d.getTime() + 7 * 86_400_000).toISOString().slice(0, 10);
      return { prev: `/journal/week-${prev}`, next: `/journal/week-${next}` };
    }
    if (range.periodType === "month") {
      const prevM = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1))
        .toISOString()
        .slice(0, 7);
      const nextM = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))
        .toISOString()
        .slice(0, 7);
      return { prev: `/journal/month-${prevM}`, next: `/journal/month-${nextM}` };
    }
    if (range.periodType === "quarter") {
      const yr = d.getUTCFullYear();
      const q = Math.floor(d.getUTCMonth() / 3) + 1;
      const prevQ = q === 1 ? `${yr - 1}-Q4` : `${yr}-Q${q - 1}`;
      const nextQ = q === 4 ? `${yr + 1}-Q1` : `${yr}-Q${q + 1}`;
      return { prev: `/journal/quarter-${prevQ}`, next: `/journal/quarter-${nextQ}` };
    }
    const yr = d.getUTCFullYear();
    return {
      prev: `/journal/year-${yr - 1}`,
      next: `/journal/year-${yr + 1}`,
    };
  }, [range]);

  const effectiveTradesForStats = useMemo(() => {
    if (!includeMissedInStats || periodMissedTrades.length === 0) return trades;
    const mappedMissed: JournalTrade[] = periodMissedTrades.map((m) => ({
      key: m.id,
      symbol: m.symbol,
      direction: m.direction || "long",
      openedAt: m.observed_at || range.startDate,
      closedAt: m.exit_at || m.observed_at || range.startDate,
      netPnl: Number(m.theoretical_pnl || 0),
      grossPnl: Number(m.theoretical_pnl || 0),
      fees: 0,
      quantity: Number(m.quantity || 1),
      avgEntry: m.entry ?? undefined,
      avgExit: m.target ?? undefined,
      realizedR: Number(m.realized_r ?? m.planned_r ?? 0),
      notes: m.notes || "",
      tags: [],
    }));
    return [...trades, ...mappedMissed];
  }, [trades, periodMissedTrades, includeMissedInStats, range.startDate]);

  const stats = useMemo(() => {
    const sourceTrades = effectiveTradesForStats;
    const total = sourceTrades.length;
    const wins = sourceTrades.filter((t) => t.netPnl > 0);
    const losses = sourceTrades.filter((t) => t.netPnl < 0);
    const netPnl = sourceTrades.reduce((acc, t) => acc + t.netPnl, 0);
    const grossPnl = sourceTrades.reduce((acc, t) => acc + (t.grossPnl ?? t.netPnl), 0);
    const fees = sourceTrades.reduce((acc, t) => acc + (t.fees ?? 0), 0);
    const volume = sourceTrades.reduce((acc, t) => acc + (t.quantity || 0), 0);
    const totalR = sourceTrades.reduce((acc, t) => acc + (t.realizedR ?? 0), 0);

    const grossWin = wins.reduce((acc, t) => acc + (t.grossPnl ?? t.netPnl), 0);
    const grossLoss = Math.abs(
      losses.reduce((acc, t) => acc + (t.grossPnl ?? t.netPnl), 0)
    );
    const profitFactor =
      grossLoss > 0
        ? (grossWin / grossLoss).toFixed(2)
        : grossWin > 0
        ? "∞"
        : "0.00";
    const winRate = total > 0 ? ((wins.length / total) * 100).toFixed(1) : "0.0";

    const sorted = [...sourceTrades].sort(
      (a, b) => new Date(a.openedAt).getTime() - new Date(b.openedAt).getTime()
    );
    let running = 0;
    let maxPeak = 0;
    let maxDd = 0;
    const curvePts = [{ x: 0, y: 0 }];
    sorted.forEach((t, i) => {
      running += t.netPnl;
      if (running > maxPeak) maxPeak = running;
      if (running < maxDd) maxDd = running;
      curvePts.push({ x: i + 1, y: running });
    });

    const bestTrade =
      sourceTrades.length > 0
        ? [...sourceTrades].sort((a, b) => b.netPnl - a.netPnl)[0]
        : null;
    const worstTrade =
      sourceTrades.length > 0
        ? [...sourceTrades].sort((a, b) => a.netPnl - b.netPnl)[0]
        : null;

    return {
      total,
      winsCount: wins.length,
      lossesCount: losses.length,
      netPnl,
      grossPnl,
      fees,
      volume,
      totalR,
      profitFactor,
      winRate,
      maxPeak,
      maxDd,
      curvePts,
      bestTrade,
      worstTrade,
    };
  }, [trades]);

  const processScorePct = useMemo(() => {
    const sum =
      scores.planAdherence +
      scores.execution +
      scores.riskMgmt +
      scores.mentalState;
    return Math.round((sum / 20) * 100);
  }, [scores]);

  const tabLabels = useMemo(() => {
    switch (range.periodType) {
      case "week":
        return {
          prep: "Weekly Synthesis & Forecast",
          review: "Weekly Review",
        };
      case "month":
        return {
          prep: "Monthly Macro Plan",
          review: "Monthly Review",
        };
      case "quarter":
        return {
          prep: "Quarterly Strategy Plan",
          review: "Quarterly Review",
        };
      case "year":
        return {
          prep: "Annual System Plan",
          review: "Annual Review",
        };
      default:
        return {
          prep: "Daily Session Notes",
          review: "Daily Review",
        };
    }
  }, [range.periodType]);

  const [pullingNotion, setPullingNotion] = useState(false);
  const [editorKey, setEditorKey] = useState(0);

  const handlePullFromNotion = useCallback(async () => {
    setPullingNotion(true);
    setSaveStatus(null);
    try {
      const res = await fetch(`/api/journal/${initialEntry.slug}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pullFromNotion: true,
          activeTab,
          notionPageId: initialEntry.notionPageId,
          reviewNotionPageId: initialEntry.reviewNotionPageId,
          title,
        }),
      });
      const data = await res.json();
      if (data.notionPulled && data.entry) {
        setTitle(data.entry.title);
        if (activeTab === "review") {
          setReviewContent(data.entry.reviewContent || "");
          if (data.entry.reviewNotionUrl) setReviewNotionUrl(data.entry.reviewNotionUrl);
        } else {
          setContent(data.entry.content || "");
          if (data.entry.notionUrl) setNotionUrl(data.entry.notionUrl);
        }
        setEditorKey((k) => k + 1);
        setSaveStatus(`Pulled ${activeTab === "review" ? "Review" : "Notes"} from Notion!`);
      } else {
        setSaveStatus(data.notionError || "Could not pull from Notion");
      }
    } catch {
      setSaveStatus("Error connecting to Notion");
    } finally {
      setPullingNotion(false);
    }
  }, [
    initialEntry.slug,
    initialEntry.notionPageId,
    initialEntry.reviewNotionPageId,
    activeTab,
    title,
  ]);

  const handleSave = useCallback(
    async (syncNotion = false) => {
      if (syncNotion) setSyncingNotion(true);
      else setSaving(true);
      setSaveStatus(null);

      try {
        const res = await fetch(`/api/journal/${initialEntry.slug}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            content,
            reviewContent,
            lessonsLearned,
            checklistJson: JSON.stringify(checklist),
            scoresJson: JSON.stringify(scores),
            rating: processScorePct,
            syncNotion,
            activeTab,
          }),
        });
        const data = await res.json();
        if (data.entry?.notionUrl) {
          setNotionUrl(data.entry.notionUrl);
        }
        if (data.entry?.reviewNotionUrl) {
          setReviewNotionUrl(data.entry.reviewNotionUrl);
        }
        if (syncNotion) {
          if (data.notionSynced) {
            setSaveStatus(
              `Saved & Synced ${activeTab === "review" ? "Review Page" : "Prep Page"} to Notion!`
            );
          } else {
            setSaveStatus(data.notionError || "Saved locally (Notion sync skipped)");
          }
        } else {
          setSaveStatus("Saved to database");
        }
      } catch {
        setSaveStatus("Error saving journal");
      } finally {
        setSaving(false);
        setSyncingNotion(false);
      }
    },
    [
      initialEntry.slug,
      title,
      content,
      reviewContent,
      lessonsLearned,
      checklist,
      scores,
      processScorePct,
      activeTab,
    ]
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void handleSave(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleSave]);

  // Zero-lag background autosave (1.5s debounce) + immediate keepalive flush on page leave/unmount
  const latestPayloadRef = useRef({
    slug: initialEntry.slug,
    title,
    content,
    reviewContent,
    lessonsLearned,
    checklistJson: JSON.stringify(checklist),
    scoresJson: JSON.stringify(scores),
    rating: processScorePct,
    activeTab,
  });

  const lastSavedSnapshotRef = useRef<string>("");
  const isDirtyRef = useRef<boolean>(false);

  useEffect(() => {
    const initialSnap = JSON.stringify({
      title: initialEntry.title,
      content: initialEntry.content,
      reviewContent: initialEntry.reviewContent || "",
      lessonsLearned: initialEntry.lessonsLearned || "",
      checklistJson: initialEntry.checklistJson || "{}",
      scoresJson: initialEntry.scoresJson || "{}",
    });
    lastSavedSnapshotRef.current = initialSnap;
    isDirtyRef.current = false;
  }, [initialEntry]);

  useEffect(() => {
    const currentSnap = JSON.stringify({
      title,
      content,
      reviewContent,
      lessonsLearned,
      checklistJson: JSON.stringify(checklist),
      scoresJson: JSON.stringify(scores),
    });

    latestPayloadRef.current = {
      slug: initialEntry.slug,
      title,
      content,
      reviewContent,
      lessonsLearned,
      checklistJson: JSON.stringify(checklist),
      scoresJson: JSON.stringify(scores),
      rating: processScorePct,
      activeTab,
    };

    if (currentSnap === lastSavedSnapshotRef.current) {
      isDirtyRef.current = false;
      return;
    }

    isDirtyRef.current = true;
    const timer = setTimeout(async () => {
      if (!isDirtyRef.current) return;
      const payload = latestPayloadRef.current;
      try {
        const res = await fetch(`/api/journal/${payload.slug}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: payload.title,
            content: payload.content,
            reviewContent: payload.reviewContent,
            lessonsLearned: payload.lessonsLearned,
            checklistJson: payload.checklistJson,
            scoresJson: payload.scoresJson,
            rating: payload.rating,
            syncNotion: false,
            activeTab: payload.activeTab,
          }),
        });
        if (res.ok) {
          lastSavedSnapshotRef.current = currentSnap;
          isDirtyRef.current = false;
          setSaveStatus("Auto-saved");
        }
      } catch {}
    }, 1500);

    return () => clearTimeout(timer);
  }, [
    initialEntry.slug,
    title,
    content,
    reviewContent,
    lessonsLearned,
    checklist,
    scores,
    processScorePct,
    activeTab,
  ]);

  const flushUnsavedImmediately = useCallback(() => {
    if (!isDirtyRef.current) return;
    const payload = latestPayloadRef.current;
    isDirtyRef.current = false;
    try {
      void fetch(`/api/journal/${payload.slug}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: payload.title,
          content: payload.content,
          reviewContent: payload.reviewContent,
          lessonsLearned: payload.lessonsLearned,
          checklistJson: payload.checklistJson,
          scoresJson: payload.scoresJson,
          rating: payload.rating,
          syncNotion: false,
          activeTab: payload.activeTab,
        }),
        keepalive: true,
      });
    } catch {}
  }, []);

  useEffect(() => {
    const onBeforeUnload = () => flushUnsavedImmediately();
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flushUnsavedImmediately();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      flushUnsavedImmediately();
    };
  }, [flushUnsavedImmediately]);

  const jumpToToday = () => {
    flushUnsavedImmediately();
    const nyToday = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    try {
      localStorage.setItem("tz_active_journal_anchor", nyToday);
    } catch {}
    router.push(`/journal/${nyToday}`);
  };

  const activeNotionLink = activeTab === "review" ? reviewNotionUrl : notionUrl;

  return (
    <div className="space-y-6 pb-12">
      {/* TOP BAR */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 pb-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <Link
            href="/journal"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-secondary/50 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Overview</span>
          </Link>

          <div className="flex items-center rounded-lg border border-border/60 bg-secondary/50 p-0.5">
            <button
              onClick={() => router.push(adjacentSlugs.prev)}
              title="Previous Period"
              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="px-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              {range.periodType}
            </span>
            <button
              onClick={() => router.push(adjacentSlugs.next)}
              title="Next Period"
              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <button
            type="button"
            onClick={jumpToToday}
            title="Jump immediately to Today's Daily Journal"
            className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-500/40 bg-indigo-500/15 hover:bg-indigo-500/25 px-3 py-1.5 text-xs font-semibold text-indigo-300 transition shadow-2xs"
          >
            <Calendar className="w-3.5 h-3.5 text-indigo-400" />
            <span>Today</span>
          </button>

          <div className="flex flex-wrap items-center rounded-xl bg-secondary/50 p-1 border border-border/60">
            {hierarchyLinks.map((link) => {
              const isActive = range.periodType === link.type;
              return (
                <Link
                  key={link.type}
                  href={link.href}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition ${
                    isActive
                      ? "bg-secondary text-foreground border border-border font-medium shadow"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {saveStatus && (
            <span className="text-xs text-profit flex items-center gap-1 mr-1">
              <CheckCircle2 className="w-3.5 h-3.5" />
              {saveStatus}
            </span>
          )}

          <a
            href={activeNotionLink || "https://www.notion.so"}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-secondary/70 hover:bg-secondary px-3 py-1.5 text-xs font-semibold text-foreground shadow-2xs transition"
            title={
              activeNotionLink
                ? `Open ${activeTab === "review" ? "Review" : "Prep"} page in Notion`
                : "Open Notion"
            }
          >
            <span>
              Open {activeTab === "review" ? "Review" : ""} in Notion
            </span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>

          <button
            type="button"
            onClick={handlePullFromNotion}
            disabled={pullingNotion || syncingNotion || saving}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-secondary/70 hover:bg-secondary px-3 py-1.5 text-xs font-semibold text-foreground shadow-2xs transition disabled:opacity-50"
            title={`Pull ${activeTab === "review" ? "Review" : "Prep"} blocks from Notion`}
          >
            <ArrowDownToLine className="h-3.5 w-3.5" />
            <span>{pullingNotion ? "Pulling..." : "Pull from Notion"}</span>
          </button>
          <button
            onClick={() => void handleSave(true)}
            disabled={syncingNotion || saving}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-secondary/70 hover:bg-secondary px-3 py-1.5 text-xs font-semibold text-foreground shadow-2xs transition disabled:opacity-50"
          >
            <CloudUpload className="w-3.5 h-3.5 text-muted-foreground" />
            <span>{syncingNotion ? "Syncing Notion..." : "Sync to Notion"}</span>
          </button>

          <button
            onClick={() => void handleSave(false)}
            disabled={saving || syncingNotion}
            className="inline-flex items-center gap-1.5 rounded-lg bg-secondary text-foreground border border-border font-semibold hover:bg-secondary/80 px-3.5 py-1.5 text-xs shadow transition disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{saving ? "Saving..." : "Save (Ctrl+S)"}</span>
          </button>
        </div>
      </div>

      {/* STATS BANNER */}
      <div className="rounded-xl border border-border/70 bg-[#12141d] p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-slate-200 dark:border-border/40">
          <div className="flex items-center gap-3">
            <Calendar className="w-5 h-5 text-muted-foreground" />
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="bg-transparent text-base font-bold text-foreground focus:outline-none focus:ring-1 focus:ring-indigo-500 rounded px-1 -ml-1"
              placeholder="Journal Title..."
            />
          </div>

          <div className="flex flex-wrap items-center gap-3 text-sm">
            <button
              type="button"
              onClick={() => setIncludeMissedInStats((v) => !v)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${
                includeMissedInStats
                  ? "border-foreground bg-secondary text-foreground shadow-2xs"
                  : "border-border/60 bg-secondary/30 text-muted-foreground hover:text-foreground"
              }`}
              title="Toggle including missed trades in this journal's stats to evaluate full model potential"
            >
              <span>
                {includeMissedInStats
                  ? `Model Stats: Including ${missedSummary.count} Missed (${fmtCurrency(missedSummary.netPnl)})`
                  : `Include Missed Trades (${missedSummary.count})`}
              </span>
            </button>
            <div>
              <span className="text-xs text-muted-foreground mr-1.5">
                {includeMissedInStats ? "Model P&L:" : "Net P&L:"}
              </span>
              <span
                className={`font-bold ${
                  stats.netPnl >= 0 ? "text-profit" : "text-loss"
                }`}
              >
                {fmtCurrency(stats.netPnl)}
              </span>
            </div>
            <div>
              <span className="text-xs text-muted-foreground mr-1.5">Realized R:</span>
              <span
                className={`font-bold ${
                  stats.totalR >= 0 ? "text-profit" : "text-loss"
                }`}
              >
                {stats.totalR > 0 ? `+${stats.totalR.toFixed(2)}R` : `${stats.totalR.toFixed(2)}R`}
              </span>
            </div>
            <div className="px-2.5 py-0.5 rounded-full bg-secondary border border-indigo-500/30 text-xs font-semibold text-foreground">
              Process Score: {processScorePct}%
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 pt-4 items-center">
          <div className="lg:col-span-4 border-r-0 lg:border-r border-slate-200 dark:border-border/40 pr-0 lg:pr-5">
            {stats.curvePts.length > 1 ? (
              <div className="space-y-2">
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>Intraday / Period P&amp;L Curve</span>
                  <span>
                    Peak: {fmtCurrency(stats.maxPeak)} | Low: {fmtCurrency(stats.maxDd)}
                  </span>
                </div>
                <svg viewBox="0 0 260 65" className="w-full h-16 overflow-visible">
                  {(() => {
                    const minY = Math.min(0, ...stats.curvePts.map((p) => p.y));
                    const maxY = Math.max(0, ...stats.curvePts.map((p) => p.y));
                    const spanY = Math.max(maxY - minY, 10);
                    const maxX = stats.curvePts.length - 1;
                    const getX = (x: number) => (x / maxX) * 250 + 5;
                    const getY = (y: number) => 55 - ((y - minY) / spanY) * 45;
                    const zeroY = getY(0);
                    const path = stats.curvePts
                      .map(
                        (p, idx) =>
                          `${idx === 0 ? "M" : "L"} ${getX(p.x).toFixed(1)} ${getY(p.y).toFixed(1)}`
                      )
                      .join(" ");
                    const isWin = stats.netPnl >= 0;
                    return (
                      <>
                        <line
                          x1="0"
                          y1={zeroY}
                          x2="260"
                          y2={zeroY}
                          stroke="#474d66"
                          strokeDasharray="3 3"
                          strokeWidth="1"
                        />
                        <path
                          d={path}
                          fill="none"
                          stroke={isWin ? "#34d399" : "#fb7185"}
                          strokeWidth="2.2"
                          strokeLinecap="round"
                        />
                      </>
                    );
                  })()}
                </svg>
              </div>
            ) : (
              <div className="h-16 flex items-center justify-center text-xs text-muted-foreground/50 border border-dashed border-slate-200 dark:border-border/40 rounded-lg">
                No closed trades recorded in this period
              </div>
            )}
          </div>

          <div className="lg:col-span-8 grid grid-cols-2 sm:grid-cols-4 gap-y-3 gap-x-6 text-xs">
            <div>
              <div className="text-muted-foreground text-[10px]">Total Trades</div>
              <div className="font-semibold text-sm text-foreground">{stats.total}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-[10px]">Win Rate</div>
              <div className="font-semibold text-sm text-foreground">
                {stats.winRate}% ({stats.winsCount}W / {stats.lossesCount}L)
              </div>
            </div>
            <div>
              <div className="text-muted-foreground text-[10px]">Profit Factor</div>
              <div className="font-semibold text-sm text-foreground">
                {stats.profitFactor}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground text-[10px]">Volume / Fees</div>
              <div className="font-semibold text-sm text-foreground">
                {stats.volume.toFixed(2)}L • ${stats.fees.toFixed(2)}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground text-[10px]">Gross P&amp;L</div>
              <div
                className={`font-semibold text-sm ${
                  stats.grossPnl >= 0 ? "text-profit" : "text-loss"
                }`}
              >
                {fmtCurrency(stats.grossPnl)}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground text-[10px]">Max Profit Peak</div>
              <div className="font-semibold text-sm text-profit">
                {fmtCurrency(stats.maxPeak)}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground text-[10px]">Max Drawdown</div>
              <div className="font-semibold text-sm text-loss">
                {fmtCurrency(stats.maxDd)}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground text-[10px]">Best / Worst Trade</div>
              <div className="font-semibold text-xs tabular-nums">
                <span className="text-profit">
                  {stats.bestTrade ? fmtCurrency(stats.bestTrade.netPnl) : "—"}
                </span>{" "}
                /{" "}
                <span className="text-loss">
                  {stats.worstTrade ? fmtCurrency(stats.worstTrade.netPnl) : "—"}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* ALWAYS-VISIBLE MISSED TRADES, CAPTURE EFFICIENCY & COUNTERFACTUAL LOSS IMPACT ROW */}
        <div className="mt-4 pt-3 border-t border-slate-200 dark:border-border/40 grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
          <div>
            <div className="text-muted-foreground text-[10px]">
              Setup Capture Efficiency
            </div>
            <div className="font-semibold text-foreground">
              {missedSummary.captureEfficiencyPct}% ({trades.length} Taken /{" "}
              {missedSummary.count} Missed)
            </div>
          </div>

          <div>
            <div className="text-muted-foreground text-[10px]">
              Left on Table ({missedSummary.winningCount} Missed Wins)
            </div>
            <div className="font-semibold text-profit font-mono">
              {fmtCurrency(missedSummary.leftOnTablePnl)} (+
              {missedSummary.leftOnTableR.toFixed(2)}R)
            </div>
          </div>

          <div>
            <div className="text-muted-foreground text-[10px]">
              Missed Losses ({missedSummary.losingCount} Losing Setups)
            </div>
            <div className="font-semibold text-loss font-mono">
              {fmtCurrency(missedSummary.losingMissesPnl)} (
              {missedSummary.losingMissesR.toFixed(2)}R)
            </div>
          </div>

          <div>
            <div className="text-muted-foreground text-[10px]">
              If All Missed Taken (Model P&amp;L)
            </div>
            <div
              className={`font-semibold font-mono ${
                trades.reduce((s, t) => s + t.netPnl, 0) + missedSummary.netPnl >= 0
                  ? "text-profit"
                  : "text-loss"
              }`}
            >
              {fmtCurrency(
                trades.reduce((s, t) => s + t.netPnl, 0) + missedSummary.netPnl
              )}{" "}
              ({(() => {
                const combR =
                  trades.reduce((s, t) => s + (t.realizedR ?? 0), 0) +
                  missedSummary.netR;
                return combR > 0 ? `+${combR.toFixed(2)}R` : `${combR.toFixed(2)}R`;
              })()})
            </div>
          </div>

          <div>
            <div className="text-muted-foreground text-[10px]">
              Top Reason Missed
            </div>
            <div className="font-semibold text-foreground truncate">
              {missedSummary.topReason}
            </div>
          </div>
        </div>
      </div>

      {/* NOTES WORKSPACE (DRAGGABLE RESIZABLE 2-COLUMN SPLIT) */}
      <div className="flex flex-col lg:flex-row gap-0 relative items-stretch">
        <div
          style={{
            width: rightCollapsed ? "100%" : `${leftWidth}%`,
            flexShrink: 0,
          }}
          className="w-full lg:w-auto space-y-4 pr-0 lg:pr-3 min-w-[320px]"
        >
          <div className="rounded-xl border border-border/70 bg-[#12141d] p-4 shadow-sm space-y-4">
            {/* DUAL TAB HEADER: PREP/SYNTHESIS TAB vs END-OF-PERIOD REVIEW TAB */}
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200 dark:border-border/40">
              <div className="flex items-center gap-1.5 rounded-xl bg-[#0d0f14] p-1 border border-border/60">
                <button
                  type="button"
                  onClick={() => setActiveTab("prep")}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    activeTab === "prep"
                      ? "bg-secondary text-foreground border border-border shadow"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <FileText className="w-3.5 h-3.5 text-indigo-400" />
                  <span>{tabLabels.prep}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("review")}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    activeTab === "review"
                      ? "bg-secondary text-foreground border border-border shadow"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span>{tabLabels.review}</span>
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <VoiceNote
                  onPrepare={() => noteEditorRef.current?.focus()}
                  onText={(text) => {
                    const formatted = ` ${text}`;
                    if (noteEditorRef.current?.insertText) {
                      noteEditorRef.current.insertText(formatted);
                    } else if (activeTab === "review") {
                      setReviewContent((prev) => `${prev || ""}${formatted}`);
                    } else {
                      setContent((prev) => `${prev || ""}${formatted}`);
                    }
                  }}
                />
              </div>
            </div>

            {/* FULL NOTION RICH EDITOR (Switches cleanly between Prep and Review tabs) */}
            <div className="pt-1">
              <RichEditor
                key={`${editorKey}-${activeTab}`}
                editorRef={noteEditorRef}
                value={activeTab === "review" ? reviewContent : content}
                onChange={activeTab === "review" ? setReviewContent : setContent}
                minHeight={480}
                ownerType={range.periodType}
                ownerId={
                  activeTab === "review"
                    ? `${initialEntry.slug}-review`
                    : initialEntry.slug
                }
                companionNode={
                  <PeriodReviewCompanionCard
                    periodType={range.periodType}
                    startDate={range.startDate}
                    endDate={range.endDate}
                    anchorDate={range.anchorDate}
                    trades={trades}
                    missedTrades={periodMissedTrades}
                    onInsertReflectionHtml={(html) => {
                      if (noteEditorRef.current?.insertHtml) {
                        noteEditorRef.current.insertHtml(html);
                      } else if (activeTab === "review") {
                        setReviewContent((prev) => (prev ? `${prev}${html}` : html));
                      } else {
                        setContent((prev) => (prev ? `${prev}${html}` : html));
                      }
                    }}
                  />
                }
                placeholder={
                  activeTab === "review"
                    ? `Write your ${tabLabels.review} here, or type '/' for Notion blocks...`
                    : "Type '/' for Notion blocks (toggles, columns, callouts, images) or paste screenshots (Ctrl+V)..."
                }
              />
            </div>

            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                Key Takeaway / Primary Focus for Next Session
              </label>
              <input
                value={lessonsLearned}
                onChange={(e) => setLessonsLearned(e.target.value)}
                placeholder="One concrete rule or adjustment to carry into the next session..."
                className="w-full rounded-lg border border-indigo-500/30 bg-indigo-950/15 px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <div className="pt-2 border-t border-border/30 space-y-3">
              <ReviewExport
                containsFinancialData
                document={{
                  title: `${initialEntry.title || range.defaultTitle} (${
                    activeTab === "review" ? tabLabels.review : tabLabels.prep
                  })`,
                  subtitle: `${range.periodType.toUpperCase()} (${range.startDate} to ${range.endDate})`,
                  lines: [
                    `Trades: ${stats.total} | Win Rate: ${stats.winRate}%`,
                    `Net P&L: ${fmtCurrency(stats.netPnl)} | Realized R: ${stats.totalR.toFixed(2)}R`,
                    `Focus: ${lessonsLearned || "None"}`,
                    "",
                    activeTab === "review" ? reviewContent : content,
                  ],
                }}
              />
            </div>
          </div>
        </div>

        {/* DRAGGABLE VERTICAL SPLIT RESIZER HANDLE */}
        {!rightCollapsed && (
          <div
            onMouseDown={handleSplitMouseDown}
            className="hidden lg:flex w-2.5 cursor-col-resize items-center justify-center bg-transparent hover:bg-indigo-500/15 transition-colors group z-10 select-none"
            title="Drag left or right to resize Review Companion & Sidebar width"
          >
            <div className="h-16 w-1 rounded-full bg-border/40 group-hover:bg-indigo-400 transition-colors" />
          </div>
        )}

        {/* RIGHT SIDEBAR: REVIEW COMPANION -> SCORECARD -> ECONOMIC CALENDAR -> CHECKLIST */}
        {!rightCollapsed && (
          <div
            style={{
              width: `calc(${100 - leftWidth}% - 10px)`,
              flexShrink: 0,
            }}
            className="w-full lg:w-auto space-y-4 pl-0 lg:pl-3 min-w-[300px] mt-6 lg:mt-0"
          >
          {/* 1. EXECUTION & PROCESS SCORECARD */}
          <div className="rounded-xl border border-border/70 bg-[#12141d] p-4 shadow-sm space-y-3.5">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-border/40 pb-2.5">
              <div className="flex items-center gap-2">
                <Target className="w-4 h-4 text-muted-foreground" />
                <h3 className="text-sm font-bold text-foreground">
                  Execution &amp; Process Scorecard
                </h3>
              </div>
              <span className="text-xs font-bold text-muted-foreground">
                {processScorePct}%
              </span>
            </div>

            {(
              [
                { key: "planAdherence", label: "Plan & Setup Adherence" },
                { key: "execution", label: "Entry & Partial Timing" },
                { key: "riskMgmt", label: "Risk & Stop Discipline" },
                { key: "mentalState", label: "Mental & Emotional Composure" },
              ] as const
            ).map((item) => (
              <div key={item.key} className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{item.label}</span>
                  <span className="font-semibold text-foreground">
                    {scores[item.key]} / 5
                  </span>
                </div>
                <div className="grid grid-cols-5 gap-1.5">
                  {[1, 2, 3, 4, 5].map((val) => {
                    const active = scores[item.key] >= val;
                    return (
                      <button
                        key={val}
                        type="button"
                        onClick={() =>
                          setScores((prev) => ({ ...prev, [item.key]: val }))
                        }
                        className={`h-2 rounded-full transition ${
                          active
                            ? scores[item.key] >= 4
                              ? "bg-profit/15 text-profit"
                              : scores[item.key] === 3
                              ? "bg-amber-500"
                              : "bg-loss/15 text-loss"
                            : "bg-muted/40 hover:bg-muted"
                        }`}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* 2. REVIEW COMPANION CARD: SUB-PERIOD NOTES FLICKER & TRADE REFLECTION WIZARD */}
          {activeTab === "review" && (
            <PeriodReviewCompanionCard
              periodType={range.periodType}
              startDate={range.startDate}
              endDate={range.endDate}
              anchorDate={range.anchorDate}
              trades={trades}
              missedTrades={periodMissedTrades}
              onInsertReflectionHtml={(html) => {
                if (noteEditorRef.current?.insertHtml) {
                  noteEditorRef.current.insertHtml(html);
                } else {
                  setReviewContent((prev) => (prev ? `${prev}${html}` : html));
                }
              }}
            />
          )}

          {/* 3. FOREXFACTORY ECONOMIC CALENDAR (DAILY & WEEKLY JOURNALS) */}
          <EconomicCalendarCard
            periodType={range.periodType}
            startDate={range.startDate}
            endDate={range.endDate}
            anchorDate={range.anchorDate}
          />

          {/* 3. PER-PERIOD DEFAULT + ENTRY-SPECIFIC TRADING PLAN CHECKLIST */}
          <div className="rounded-xl border border-border/70 bg-[#12141d] p-4 shadow-sm space-y-3">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-border/40 pb-2.5">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-profit" />
                <h3 className="text-sm font-bold text-foreground">
                  Trading Plan Checklist ({range.periodType.toUpperCase()})
                </h3>
              </div>

              <button
                type="button"
                onClick={() => setEditingChecklist((e) => !e)}
                className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium transition ${
                  editingChecklist
                    ? "bg-indigo-600 text-white"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                }`}
                title="Manage Default rules vs rules specific to this entry"
              >
                {editingChecklist ? (
                  <>
                    <Check className="w-3 h-3" />
                    <span>Done</span>
                  </>
                ) : (
                  <>
                    <Pencil className="w-3 h-3" />
                    <span>Manage</span>
                  </>
                )}
              </button>
            </div>

            {editingChecklist ? (
              <div className="space-y-4">
                {/* SECTION A: PERMANENT DEFAULT RULES FOR THIS PERIOD TYPE */}
                <div className="space-y-2">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-400">
                    Default {range.periodType} Rules (Appear on every {range.periodType})
                  </div>
                  {currentChecklistDefs.map((item, idx) => (
                    <div key={item.id} className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={item.label}
                        onChange={(e) => {
                          const updated = currentChecklistDefs.map((it, i) =>
                            i === idx ? { ...it, label: e.target.value } : it
                          );
                          persistPeriodChecklistDefs(updated);
                        }}
                        className="h-8 flex-1 rounded-lg border border-border/60 bg-[#161924] px-2.5 text-xs text-foreground outline-none focus:border-indigo-500"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          // Move from Default to This Entry Only
                          const nextDefaults = currentChecklistDefs.filter((_, i) => i !== idx);
                          persistPeriodChecklistDefs(nextDefaults);
                          updateEntryCustomItems([...entryCustomItems, item]);
                        }}
                        className="rounded-lg border border-border/60 bg-secondary/50 hover:bg-secondary px-2 py-1 text-[10px] font-medium text-muted-foreground hover:text-foreground shrink-0"
                        title={`Make specific to this ${range.periodType} only`}
                      >
                        Only This {range.periodType}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const next = currentChecklistDefs.filter((_, i) => i !== idx);
                          persistPeriodChecklistDefs(next);
                        }}
                        className="rounded-lg bg-rose-500/15 hover:bg-rose-500/25 p-1.5 text-rose-400 shrink-0"
                        title="Delete default rule"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}

                  <div className="flex items-center gap-1.5 pt-1">
                    <input
                      type="text"
                      value={newDefaultItemText}
                      onChange={(e) => setNewDefaultItemText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && newDefaultItemText.trim()) {
                          e.preventDefault();
                          persistPeriodChecklistDefs([
                            ...currentChecklistDefs,
                            {
                              id: `${range.periodType}_def_${Date.now()}`,
                              label: newDefaultItemText.trim(),
                            },
                          ]);
                          setNewDefaultItemText("");
                        }
                      }}
                      placeholder={`Add new default ${range.periodType} rule...`}
                      className="h-8 flex-1 rounded-lg border border-dashed border-indigo-500/40 bg-[#0d0f14] px-2.5 text-xs text-foreground outline-none focus:border-indigo-500"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (!newDefaultItemText.trim()) return;
                        persistPeriodChecklistDefs([
                          ...currentChecklistDefs,
                          {
                            id: `${range.periodType}_def_${Date.now()}`,
                            label: newDefaultItemText.trim(),
                          },
                        ]);
                        setNewDefaultItemText("");
                      }}
                      className="inline-flex h-8 items-center gap-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 px-2.5 text-xs font-semibold text-white shrink-0"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Default</span>
                    </button>
                  </div>
                </div>

                {/* SECTION B: ENTRY-SPECIFIC RULES (ONLY FOR THIS SPECIFIC DATE/PERIOD) */}
                <div className="space-y-2 border-t border-border/40 pt-3">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                    Specific to This {range.periodType} Only ({initialEntry.slug})
                  </div>
                  {entryCustomItems.length === 0 && (
                    <div className="text-[11px] text-muted-foreground italic">
                      No custom items added specifically for this {range.periodType} yet.
                    </div>
                  )}
                  {entryCustomItems.map((item, idx) => (
                    <div key={item.id} className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={item.label}
                        onChange={(e) => {
                          const updated = entryCustomItems.map((it, i) =>
                            i === idx ? { ...it, label: e.target.value } : it
                          );
                          updateEntryCustomItems(updated);
                        }}
                        className="h-8 flex-1 rounded-lg border border-border/60 bg-[#161924] px-2.5 text-xs text-foreground outline-none focus:border-emerald-500"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          // Promote to permanent Default for this periodType
                          const nextCustom = entryCustomItems.filter((_, i) => i !== idx);
                          updateEntryCustomItems(nextCustom);
                          persistPeriodChecklistDefs([...currentChecklistDefs, item]);
                        }}
                        className="rounded-lg border border-indigo-500/40 bg-indigo-500/10 hover:bg-indigo-500/20 px-2 py-1 text-[10px] font-medium text-indigo-300 shrink-0"
                        title={`Promote to Default for all ${range.periodType}s`}
                      >
                        Make Default
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const next = entryCustomItems.filter((_, i) => i !== idx);
                          updateEntryCustomItems(next);
                        }}
                        className="rounded-lg bg-rose-500/15 hover:bg-rose-500/25 p-1.5 text-rose-400 shrink-0"
                        title="Remove from this entry"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {/* Render Default Period Items */}
                {currentChecklistDefs.map((item) => {
                  const checked = !!checklist[item.id];
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() =>
                        setChecklist((prev) => ({
                          ...prev,
                          [item.id]: !prev[item.id],
                        }))
                      }
                      className={`w-full flex items-start justify-between gap-2.5 p-2 rounded-lg border text-left text-xs transition ${
                        checked
                          ? "border-profit/20 bg-emerald-950/20 text-foreground"
                          : "border-slate-200 dark:border-border/40 bg-[#161924]/40 text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <div className="flex items-start gap-2.5">
                        {checked ? (
                          <CheckSquare className="w-4 h-4 text-profit shrink-0 mt-0.5" />
                        ) : (
                          <Square className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                        )}
                        <span className="leading-snug">{item.label}</span>
                      </div>
                      <span className="shrink-0 rounded bg-white/[0.04] px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
                        Default
                      </span>
                    </button>
                  );
                })}

                {/* Render Entry-Specific Items */}
                {entryCustomItems.map((item) => {
                  const checked = !!checklist[item.id];
                  return (
                    <div
                      key={item.id}
                      className={`group flex items-start justify-between gap-2 p-2 rounded-lg border text-left text-xs transition ${
                        checked
                          ? "border-profit/20 bg-emerald-950/20 text-foreground"
                          : "border-indigo-500/25 bg-indigo-950/10 text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setChecklist((prev) => ({
                            ...prev,
                            [item.id]: !prev[item.id],
                          }))
                        }
                        className="flex flex-1 items-start gap-2.5 text-left"
                      >
                        {checked ? (
                          <CheckSquare className="w-4 h-4 text-profit shrink-0 mt-0.5" />
                        ) : (
                          <Square className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                        )}
                        <span className="leading-snug">{item.label}</span>
                      </button>

                      <div className="flex items-center gap-1 shrink-0">
                        <span className="rounded bg-indigo-500/15 px-1.5 py-0.5 text-[9px] font-medium text-indigo-300">
                          This {range.periodType}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            updateEntryCustomItems(
                              entryCustomItems.filter((i) => i.id !== item.id)
                            )
                          }
                          className="opacity-0 group-hover:opacity-100 p-0.5 text-muted-foreground hover:text-rose-400 transition"
                          title={`Remove from this ${range.periodType}`}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}

                {/* Quick-Add Input for This Specific Day/Week/Month/Quarter/Year */}
                <div className="flex items-center gap-1.5 pt-1">
                  <input
                    type="text"
                    value={newLocalItemText}
                    onChange={(e) => setNewLocalItemText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newLocalItemText.trim()) {
                        e.preventDefault();
                        const newItem = {
                          id: `custom_${Date.now()}`,
                          label: newLocalItemText.trim(),
                        };
                        updateEntryCustomItems([...entryCustomItems, newItem]);
                        setNewLocalItemText("");
                      }
                    }}
                    placeholder={`+ Add item for this ${range.periodType} only (press Enter then Save)...`}
                    className="h-7 flex-1 rounded-lg border border-dashed border-border/50 bg-transparent px-2.5 text-[11px] text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-indigo-500/60"
                  />
                  {newLocalItemText.trim() && (
                    <button
                      type="button"
                      onClick={() => {
                        const newItem = {
                          id: `custom_${Date.now()}`,
                          label: newLocalItemText.trim(),
                        };
                        updateEntryCustomItems([...entryCustomItems, newItem]);
                        setNewLocalItemText("");
                      }}
                      className="h-7 rounded-lg bg-indigo-600 hover:bg-indigo-500 px-2.5 text-[11px] font-semibold text-white"
                    >
                      Add
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
        )}
      </div>

      {/* EXECUTED TRADES & MISSED TRADES TABS TABLE */}
      <div className="rounded-xl border border-border/70 bg-[#12141d] p-4 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-border/40 pb-3">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-xl bg-[#0d0f14] p-1 border border-border/60 text-xs">
              <button
                type="button"
                onClick={() => setBottomTradesTab("executed")}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1 font-semibold transition ${
                  bottomTradesTab === "executed"
                    ? "bg-secondary text-foreground border border-border shadow-2xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <TrendingUp className="w-3.5 h-3.5" />
                <span>Executed Trades ({trades.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setBottomTradesTab("missed")}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1 font-semibold transition ${
                  bottomTradesTab === "missed"
                    ? "bg-secondary text-foreground border border-border shadow-2xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <span>Missed Trades ({periodMissedTrades.length})</span>
              </button>
            </div>
          </div>

          {bottomTradesTab === "missed" && periodMissedTrades.length > 0 ? (
            <div className="flex flex-wrap items-center gap-4 text-xs">
              <span className="text-muted-foreground">
                Opportunity Missed:{" "}
                <strong className="text-foreground font-mono">
                  {fmtCurrency(missedSummary.netPnl)} (
                  {missedSummary.netR >= 0
                    ? `+${missedSummary.netR.toFixed(2)}R`
                    : `${missedSummary.netR.toFixed(2)}R`}
                  )
                </strong>
              </span>
              <span className="text-muted-foreground">
                Top Miss Reason:{" "}
                <strong className="text-foreground">{missedSummary.topReason}</strong>
              </span>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">
              Click any trade to inspect its chart replay &amp; running P&amp;L excursion
            </span>
          )}
        </div>

        {bottomTradesTab === "executed" ? (
          trades.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-muted-foreground border-b border-slate-200 dark:border-border/40">
                    <th className="py-2 px-2.5 font-medium">Opened (NY)</th>
                    <th className="py-2 px-2.5 font-medium">Symbol</th>
                    <th className="py-2 px-2.5 font-medium">Side</th>
                    <th className="py-2 px-2.5 font-medium text-right">Volume</th>
                    <th className="py-2 px-2.5 font-medium text-right">Entry → Exit</th>
                    <th className="py-2 px-2.5 font-medium text-right">Realized R</th>
                    <th className="py-2 px-2.5 font-medium text-right">Net P&amp;L</th>
                    <th className="py-2 px-2.5 font-medium">Partials / Notes</th>
                    <th className="py-2 px-2.5 font-medium text-right">Replay</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((t) => {
                    const isBuy =
                      t.direction.toLowerCase() === "buy" ||
                      t.direction.toLowerCase() === "long";
                    const datePart = t.openedAt.slice(0, 10);
                    const timePart =
                      t.openedAt.length >= 16 ? t.openedAt.slice(11, 19) : "";

                    return (
                      <tr
                        key={t.key}
                        className="border-b border-border/20 hover:bg-muted/20 transition"
                      >
                        <td className="py-2.5 px-2.5 tabular-nums text-muted-foreground">
                          {datePart}{" "}
                          <span className="text-foreground font-medium">{timePart}</span>
                        </td>
                        <td className="py-2.5 px-2.5">
                          <span className="px-2 py-0.5 rounded bg-secondary text-foreground font-semibold text-[11px]">
                            {t.symbol}
                          </span>
                        </td>
                        <td className="py-2.5 px-2.5">
                          <span
                            className={`font-bold text-[11px] uppercase ${
                              isBuy ? "text-profit" : "text-loss"
                            }`}
                          >
                            {t.direction}
                          </span>
                        </td>
                        <td className="py-2.5 px-2.5 text-right tabular-nums text-foreground">
                          {t.quantity}L
                        </td>
                        <td className="py-2.5 px-2.5 text-right tabular-nums text-muted-foreground">
                          {t.avgEntry ?? "—"} → {t.avgExit ?? "—"}
                        </td>
                        <td className="py-2.5 px-2.5 text-right tabular-nums font-medium">
                          {t.realizedR != null ? (
                            <span
                              className={
                                t.realizedR >= 0 ? "text-profit" : "text-loss"
                              }
                            >
                              {t.realizedR > 0 ? `+${t.realizedR}R` : `${t.realizedR}R`}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td
                          className={`py-2.5 px-2.5 text-right font-bold tabular-nums ${
                            t.netPnl >= 0 ? "text-profit" : "text-loss"
                          }`}
                        >
                          {fmtCurrency(t.netPnl)}
                        </td>
                        <td className="py-2.5 px-2.5 text-muted-foreground max-w-[260px] truncate">
                          {(t as any).partialsBreakdown || t.notes || "—"}
                        </td>
                        <td className="py-2.5 px-2.5 text-right">
                          <Link
                            href={`/trades/${t.key}`}
                            className="inline-flex items-center gap-1 rounded-md bg-secondary text-foreground border border-border px-2.5 py-1 text-[11px] font-semibold transition hover:bg-secondary/80"
                          >
                            <span>Replay</span>
                            <ArrowRight className="w-3 h-3" />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-8 text-center text-xs text-muted-foreground border border-dashed border-slate-200 dark:border-border/40 rounded-lg">
              No trades executed during this period.
            </div>
          )
        ) : periodMissedTrades.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-muted-foreground border-b border-slate-200 dark:border-border/40">
                  <th className="py-2 px-2.5 font-medium">Observed At</th>
                  <th className="py-2 px-2.5 font-medium">Symbol</th>
                  <th className="py-2 px-2.5 font-medium">Side</th>
                  <th className="py-2 px-2.5 font-medium">Reason Missed</th>
                  <th className="py-2 px-2.5 font-medium text-right">Entry / SL / TP</th>
                  <th className="py-2 px-2.5 font-medium text-right">Theoretical R</th>
                  <th className="py-2 px-2.5 font-medium text-right">Opportunity ($)</th>
                  <th className="py-2 px-2.5 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {periodMissedTrades.map((m) => {
                  const isBuy = String(m.direction || "long").toLowerCase() === "long";
                  const mPnl = Number(m.theoretical_pnl || 0);
                  const mR = Number(m.realized_r ?? m.planned_r ?? 0);
                  return (
                    <tr
                      key={m.id}
                      className="border-b border-border/20 hover:bg-muted/20 transition"
                    >
                      <td className="py-2.5 px-2.5 tabular-nums text-muted-foreground">
                        {(m.observed_at || "").slice(0, 16).replace("T", " ")} •{" "}
                        <strong className="text-foreground">{m.session || "NY AM"}</strong>
                      </td>
                      <td className="py-2.5 px-2.5">
                        <span className="px-2 py-0.5 rounded bg-secondary text-foreground font-semibold text-[11px]">
                          {m.symbol}
                        </span>
                      </td>
                      <td className="py-2.5 px-2.5">
                        <span
                          className={`font-bold text-[11px] uppercase ${
                            isBuy ? "text-profit" : "text-loss"
                          }`}
                        >
                          {m.direction}
                        </span>
                      </td>
                      <td className="py-2.5 px-2.5 font-medium text-foreground">
                        {m.miss_reason || "Hesitation / Fear"}
                      </td>
                      <td className="py-2.5 px-2.5 text-right tabular-nums text-muted-foreground font-mono">
                        {m.entry ?? "—"} / {m.stop ?? "—"} / {m.target ?? "—"}
                      </td>
                      <td
                        className={`py-2.5 px-2.5 text-right tabular-nums font-bold ${
                          mR >= 0 ? "text-profit" : "text-loss"
                        }`}
                      >
                        {mR > 0 ? `+${mR}R` : `${mR}R`}
                      </td>
                      <td
                        className={`py-2.5 px-2.5 text-right font-bold tabular-nums ${
                          mPnl >= 0 ? "text-profit" : "text-loss"
                        }`}
                      >
                        {fmtCurrency(mPnl)}
                      </td>
                      <td className="py-2.5 px-2.5 text-right">
                        <Link
                          href={`/missed/${encodeURIComponent(m.id)}`}
                          className="inline-flex items-center gap-1 rounded-md bg-secondary text-foreground border border-border px-2.5 py-1 text-[11px] font-semibold transition hover:bg-secondary/80"
                        >
                          <span>Open Lab</span>
                          <ArrowRight className="w-3 h-3" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="py-8 text-center text-xs text-muted-foreground border border-dashed border-slate-200 dark:border-border/40 rounded-lg">
            No missed trades recorded during this period.
          </div>
        )}
      </div>
    </div>
  );
}
