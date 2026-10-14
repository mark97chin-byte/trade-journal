"use client";

import React, { Suspense, useState, useEffect } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FilterBar, useFilters } from "@/components/filter-bar";
import { useApi } from "@/lib/use-api";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { RichEditor } from "@/components/rich-editor";
import { PlaybookModal } from "@/components/playbooks/playbook-modal";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ChevronRight,
  Share2,
  MoreVertical,
  Info,
  GripVertical,
  Plus,
  Pencil,
  Trash2,
  Check,
  X,
} from "lucide-react";
import type { PlaybookRuleGroup } from "@/server/playbooks-store";

function fmtMoney(val: number | null | undefined): string {
  if (val === null || val === undefined || isNaN(val)) return "$0";
  if (Math.abs(val) < 0.005) return "$0";
  const abs = Math.abs(val);
  const sign = val < 0 ? "-$" : "$";
  return `${sign}${abs.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtDuration(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return "0m";
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function fmtDateShort(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso).slice(0, 10);
  return d.toLocaleDateString("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  });
}

export default function PlaybookDetailPage() {
  return (
    <Suspense>
      <PlaybookDetailContent />
    </Suspense>
  );
}

function PlaybookDetailContent() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { query } = useFilters();
  const [refreshKey, setRefreshKey] = useState(0);
  const reload = () => setRefreshKey((k) => k + 1);
  const { data, loading } = useApi<any>(
    `/api/playbooks/${params.id}?${query}${query ? "&" : ""}_r=${refreshKey}`
  );

  const [activeTab, setActiveTab] = useState<"stats" | "rules" | "trades" | "notes">("stats");
  const [tradesSubTab, setTradesSubTab] = useState<"executed" | "missed">("executed");
  const [editModalOpen, setEditModalOpen] = useState(false);

  // Rules tab inline editing states
  const [addingRuleGroupId, setAddingRuleGroupId] = useState<string | null>(null);
  const [newRuleText, setNewRuleText] = useState("");
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [editingRuleText, setEditingRuleText] = useState("");
  const [addingGroupModal, setAddingGroupModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [openGroupMenuId, setOpenGroupMenuId] = useState<string | null>(null);

  // Notes tab states
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteContent, setNoteContent] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);

  const pb = data?.playbook;

  useEffect(() => {
    if (pb?.notes && pb.notes.length > 0 && !selectedNoteId) {
      const first = pb.notes[0];
      setSelectedNoteId(first.id);
      setNoteTitle(first.title);
      setNoteContent(first.content);
    }
  }, [pb?.notes, selectedNoteId]);

  if (loading || !pb) {
    return (
      <>
        <FilterBar title="Strategy" />
        <main className="mx-auto max-w-7xl px-4 py-6">
          <Skeleton className="h-96 w-full rounded-xl" />
        </main>
      </>
    );
  }

  const s = pb.stats;

  // Persist updated ruleGroups to backend
  const saveRuleGroups = async (nextGroups: PlaybookRuleGroup[]) => {
    const clean: PlaybookRuleGroup[] = nextGroups.map((g) => ({
      id: g.id,
      name: g.name,
      rules: g.rules.map((r: any) => ({
        id: r.id,
        text: r.text,
        frequency: r.frequency ?? "Always",
      })),
    }));
    await fetch(`/api/playbooks/${pb.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ruleGroups: clean }),
    });
    reload();
  };

  const handleAddRule = async (groupId: string) => {
    if (!newRuleText.trim()) return;
    const nextGroups = pb.ruleGroups.map((g: any) =>
      g.id === groupId
        ? {
            ...g,
            rules: [
              ...g.rules,
              {
                id: `rule-${Date.now()}`,
                text: newRuleText.trim(),
                frequency: "Always",
              },
            ],
          }
        : g
    );
    setNewRuleText("");
    setAddingRuleGroupId(null);
    await saveRuleGroups(nextGroups);
  };

  const handleSaveEditedRule = async (groupId: string, ruleId: string) => {
    if (!editingRuleText.trim()) return;
    const nextGroups = pb.ruleGroups.map((g: any) =>
      g.id === groupId
        ? {
            ...g,
            rules: g.rules.map((r: any) =>
              r.id === ruleId ? { ...r, text: editingRuleText.trim() } : r
            ),
          }
        : g
    );
    setEditingRuleId(null);
    await saveRuleGroups(nextGroups);
  };

  const handleDeleteRule = async (groupId: string, ruleId: string) => {
    const nextGroups = pb.ruleGroups.map((g: any) =>
      g.id === groupId
        ? { ...g, rules: g.rules.filter((r: any) => r.id !== ruleId) }
        : g
    );
    await saveRuleGroups(nextGroups);
  };

  const handleAddRuleGroup = async () => {
    if (!newGroupName.trim()) return;
    const nextGroups = [
      ...pb.ruleGroups,
      {
        id: `group-${Date.now()}`,
        name: newGroupName.trim(),
        rules: [],
      },
    ];
    setNewGroupName("");
    setAddingGroupModal(false);
    await saveRuleGroups(nextGroups);
  };

  const handleDeleteRuleGroup = async (groupId: string) => {
    setOpenGroupMenuId(null);
    const nextGroups = pb.ruleGroups.filter((g: any) => g.id !== groupId);
    await saveRuleGroups(nextGroups);
  };

  // Multi-Note handlers
  const handleCreateNote = async () => {
    const res = await fetch(`/api/playbooks/${pb.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create_note",
        title: "Untitled",
        content: "",
      }),
    });
    if (res.ok) {
      const json = await res.json();
      const updated = json.data?.playbook ?? json.playbook;
      const newest = updated?.notes?.[updated.notes.length - 1];
      reload();
      if (newest) {
        setSelectedNoteId(newest.id);
        setNoteTitle(newest.title);
        setNoteContent(newest.content);
      }
    }
  };

  const handleSaveCurrentNote = async (nextTitle: string, nextContent: string) => {
    if (!selectedNoteId) return;
    setNoteSaving(true);
    try {
      await fetch(`/api/playbooks/${pb.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_note",
          noteId: selectedNoteId,
          title: nextTitle,
          content: nextContent,
        }),
      });
      reload();
    } finally {
      setNoteSaving(false);
    }
  };

  const handleDeleteNote = async (noteId: string) => {
    await fetch(`/api/playbooks/${pb.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete_note", noteId }),
    });
    setSelectedNoteId(null);
    reload();
  };

  // Cumulative equity SVG helper
  const renderEquityCurve = () => {
    const pts: { date: string; cumPnl: number }[] = s.cumulativeCurve ?? [];
    if (pts.length === 0) {
      return (
        <div className="flex h-60 items-center justify-center text-xs text-muted-foreground">
          No closed trades logged for this strategy yet.
        </div>
      );
    }

    const chartPts =
      pts.length === 1
        ? [{ date: pts[0]!.date, cumPnl: 0 }, pts[0]!]
        : pts;

    const width = 900;
    const height = 260;
    const padLeft = 55;
    const padRight = 30;
    const padTop = 20;
    const padBottom = 35;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    const vals = chartPts.map((p) => p.cumPnl);
    const minVal = Math.min(...vals, 0);
    const maxVal = Math.max(...vals, 100);
    const span = maxVal - minVal || 1;

    const getX = (i: number) =>
      padLeft + (i / Math.max(chartPts.length - 1, 1)) * plotW;
    const getY = (v: number) => padTop + plotH - ((v - minVal) / span) * plotH;
    const zeroY = getY(0);

    const lineCoords = chartPts.map(
      (p, i) => `${getX(i).toFixed(1)} ${getY(p.cumPnl).toFixed(1)}`
    );
    const linePath = `M ${lineCoords.join(" L ")}`;
    const areaPath = `${linePath} L ${getX(chartPts.length - 1)} ${zeroY} L ${getX(0)} ${zeroY} Z`;

    const ticks = [0, 0.2, 0.4, 0.6, 0.8, 1].map((t) => minVal + span * t);

    return (
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto overflow-visible">
        <defs>
          <linearGradient id="pbEquityGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {ticks.map((tk, idx) => {
          const y = getY(tk);
          return (
            <g key={idx}>
              <line
                x1={padLeft}
                y1={y}
                x2={width - padRight}
                y2={y}
                stroke="rgba(255,255,255,0.07)"
                strokeDasharray="3 3"
              />
              <text
                x={padLeft - 10}
                y={y + 3}
                textAnchor="end"
                fontSize="10"
                fill="#71717a"
              >
                {fmtMoney(tk)}
              </text>
            </g>
          );
        })}

        <path d={areaPath} fill="url(#pbEquityGrad)" />
        <path
          d={linePath}
          fill="none"
          stroke="#a5b4fc"
          strokeWidth="2"
          strokeLinecap="round"
        />

        <text x={padLeft} y={height - 8} fontSize="10" fill="#71717a">
          {chartPts[0]?.date}
        </text>
        <text
          x={width - padRight}
          y={height - 8}
          textAnchor="end"
          fontSize="10"
          fill="#71717a"
        >
          {chartPts[chartPts.length - 1]?.date}
        </text>
      </svg>
    );
  };

  return (
    <>
      <FilterBar title="Strategy" />

      <main className="mx-auto max-w-7xl px-4 py-5 space-y-6">
        {/* BREADCRUMB */}
        <div className="flex items-center gap-1.5 text-xs">
          <Link
            href="/playbooks"
            className="font-medium text-indigo-400 hover:underline"
          >
            Strategies
          </Link>
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-muted-foreground">
            {pb.icon} {pb.name}
          </span>
        </div>

        {/* TOP STRATEGY OVERVIEW CARD */}
        <div className="rounded-2xl border border-border/50 bg-[#12141a] p-5 shadow-sm">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center">
            {/* Left Cover Photo / Candlestick Preview */}
            <div className="h-44 w-full shrink-0 overflow-hidden rounded-xl border border-border/40 bg-[#0b0d13] lg:w-72 flex items-center justify-center relative">
              {pb.photoUrl ? (
                <img
                  src={pb.photoUrl}
                  alt={pb.name}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex flex-col items-center justify-center text-muted-foreground/40">
                  <span className="text-4xl">{pb.icon}</span>
                  <span className="text-[11px] mt-1">Strategy Setup</span>
                </div>
              )}
            </div>

            {/* Right Info + Quick Metrics Bar */}
            <div className="flex-1 space-y-3">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h1 className="text-lg font-bold text-foreground flex items-center gap-2">
                    <span>{pb.icon}</span>
                    <span>{pb.name}</span>
                  </h1>

                  {pb.tags && pb.tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {pb.tags.map((tg: string) => (
                        <span
                          key={tg}
                          className="rounded-full border border-border/60 bg-[#161822] px-2.5 py-0.5 text-[11px] text-muted-foreground"
                        >
                          {tg}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setEditModalOpen(true)}
                    className="h-8 text-xs gap-1.5"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    <span>Edit</span>
                  </Button>
                </div>
              </div>

              {pb.description && (
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {pb.description}
                </p>
              )}

              {/* 6 Quick Stats Row */}
              <div className="grid grid-cols-2 gap-4 border-t border-border/30 pt-3.5 sm:grid-cols-6 text-xs">
                <div className="flex items-center gap-2.5">
                  <svg width="28" height="28" viewBox="0 0 32 32" className="-rotate-90">
                    <circle
                      cx="16"
                      cy="16"
                      r="12"
                      fill="none"
                      stroke="rgba(255,255,255,0.1)"
                      strokeWidth="3.5"
                    />
                    <circle
                      cx="16"
                      cy="16"
                      r="12"
                      fill="none"
                      stroke="#10b981"
                      strokeWidth="3.5"
                      strokeDasharray={`${(s.winRate / 100) * 75.4} 75.4`}
                    />
                  </svg>
                  <div>
                    <span className="text-[11px] text-muted-foreground block">Win rate</span>
                    <span className="font-bold text-foreground">
                      {s.winRate.toFixed(0)}%
                    </span>
                  </div>
                </div>

                <div>
                  <span className="text-[11px] text-muted-foreground block">Trades</span>
                  <span className="font-bold text-foreground">{s.tradesCount}</span>
                </div>

                <div>
                  <span className="text-[11px] text-muted-foreground block">Profit factor</span>
                  <span className="font-bold text-foreground">
                    {s.profitFactor.toFixed(1)}
                  </span>
                </div>

                <div>
                  <span className="text-[11px] text-muted-foreground block">Daily win rate</span>
                  <span className="font-bold text-foreground">
                    {s.dailyWinRate.toFixed(1)}
                  </span>
                </div>

                <div>
                  <span className="text-[11px] text-muted-foreground block">
                    Avg trade duration
                  </span>
                  <span className="font-bold text-foreground">
                    {fmtDuration(s.avgHoldTimeMs)}
                  </span>
                </div>

                <div>
                  <span className="text-[11px] text-muted-foreground block">Win/Loss</span>
                  <span className="font-bold text-foreground">
                    {s.winLossRatio.toFixed(1)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* MAIN 4 TABS CONTAINER */}
        <div className="rounded-2xl border border-border/50 bg-[#12141a] p-5 shadow-sm space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/40 pb-3">
            <div className="flex items-center gap-6">
              {(
                [
                  ["stats", "Stats"],
                  ["rules", "Rules"],
                  ["trades", "Trades"],
                  ["notes", "Notes"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setActiveTab(key)}
                  className={`relative pb-3 text-xs font-semibold transition-colors ${
                    activeTab === key
                      ? "text-indigo-400 after:absolute after:bottom-[-13px] after:left-0 after:right-0 after:h-0.5 after:bg-indigo-500"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {activeTab === "rules" && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setAddingGroupModal(true)}
                className="h-8 text-xs"
              >
                Add rule group
              </Button>
            )}
          </div>

          {/* TAB 1: STATS */}
          {activeTab === "stats" && (
            <div className="space-y-5">
              {/* Cumulative Equity Curve Card */}
              <div className="rounded-xl border border-border/40 bg-[#0d0f14] p-4">
                <div className="flex items-center gap-1.5 pb-3 border-b border-border/20">
                  <h3 className="text-xs font-semibold text-foreground">
                    Daily net cumulative P&L
                  </h3>
                  <Info className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
                <div className="pt-4">{renderEquityCurve()}</div>
              </div>

              {/* 4-Column Detailed Strategy Metrics */}
              <div className="rounded-xl border border-border/40 bg-[#0d0f14] p-5">
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4 lg:divide-x lg:divide-border/30">
                  {/* Col 1 */}
                  <div className="space-y-5">
                    <div>
                      <span className="text-xs text-muted-foreground block">
                        Net P&L
                      </span>
                      <span
                        className={`text-lg font-bold ${
                          s.netPnl >= 0 ? "text-foreground" : "text-rose-400"
                        }`}
                      >
                        {fmtMoney(s.netPnl)}
                      </span>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground block">Win %</span>
                      <span className="text-lg font-bold text-foreground">
                        {s.winRate.toFixed(0)}%{" "}
                        <span className="text-xs font-normal text-muted-foreground">
                          ({s.wins}/{s.beCount}/{s.losses})
                        </span>
                      </span>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground block">
                        Avg daily win %
                      </span>
                      <span className="text-lg font-bold text-foreground">
                        {s.dailyWinRate.toFixed(0)}%{" "}
                        <span className="text-xs font-normal text-muted-foreground">
                          ({s.dailyRecord.wins}/{s.dailyRecord.bes}/{s.dailyRecord.losses})
                        </span>
                      </span>
                    </div>
                  </div>

                  {/* Col 2 */}
                  <div className="space-y-5 lg:pl-6">
                    <div>
                      <span className="text-xs text-muted-foreground block">
                        Profit factor
                      </span>
                      <span className="text-lg font-bold text-foreground">
                        {s.profitFactor.toFixed(2)}{" "}
                        <span className="text-xs font-normal text-muted-foreground">
                          ({fmtMoney(s.grossWin)}/{fmtMoney(s.grossLoss)})
                        </span>
                      </span>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground block">
                        Trade expectancy
                      </span>
                      <span className="text-lg font-bold text-foreground">
                        {fmtMoney(s.tradeExpectancy)}
                      </span>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground block">
                        Avg trade win/loss
                      </span>
                      <span className="text-lg font-bold text-foreground">
                        {s.winLossRatio.toFixed(2)}
                      </span>
                    </div>
                  </div>

                  {/* Col 3 */}
                  <div className="space-y-5 lg:pl-6">
                    <div>
                      <span className="text-xs text-muted-foreground block">
                        Avg net trade P&L
                      </span>
                      <span className="text-lg font-bold text-foreground">
                        {fmtMoney(s.avgNetTradePnl)}
                      </span>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground block">
                        Avg hold time
                      </span>
                      <span className="text-lg font-bold text-foreground">
                        {fmtDuration(s.avgHoldTimeMs)}
                      </span>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground block">
                        Avg planned/realized r-multiple
                      </span>
                      <span className="text-lg font-bold text-foreground">
                        {s.avgPlannedR !== null ? `${s.avgPlannedR.toFixed(2)}R` : "-"}
                        /
                        {s.avgRealizedR !== null ? `${s.avgRealizedR.toFixed(2)}R` : "-"}
                      </span>
                    </div>
                  </div>

                  {/* Col 4 */}
                  <div className="space-y-5 lg:pl-6">
                    <div>
                      <span className="text-xs text-muted-foreground block">
                        Max daily net drawdown
                      </span>
                      <span className="text-lg font-bold text-foreground">
                        {fmtMoney(s.maxDailyNetDrawdown)}
                      </span>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground block">
                        Avg daily net drawdown
                      </span>
                      <span className="text-lg font-bold text-foreground">
                        {fmtMoney(s.avgDailyNetDrawdown)}
                      </span>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground block">
                        Avg daily volume
                      </span>
                      <span className="text-lg font-bold text-foreground">
                        {s.avgDailyVolume.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: RULES */}
          {activeTab === "rules" && (
            <div className="space-y-6">
              {/* Column Headers */}
              <div className="grid grid-cols-12 rounded-lg bg-[#161822]/70 px-4 py-2.5 text-xs font-medium text-muted-foreground">
                <div className="col-span-6">Rule</div>
                <div className="col-span-1 text-center">Follow rate</div>
                <div className="col-span-2 text-center">Net profit/loss</div>
                <div className="col-span-1 text-center">Profit factor</div>
                <div className="col-span-2 text-center">Win rate</div>
              </div>

              {pb.ruleGroups.map((group: any) => (
                <div key={group.id} className="space-y-2.5">
                  <div className="flex items-center justify-between px-1">
                    <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                      <GripVertical className="h-4 w-4 text-muted-foreground" />
                      <span>{group.name}</span>
                    </div>

                    <div className="relative">
                      <button
                        type="button"
                        onClick={() =>
                          setOpenGroupMenuId(
                            openGroupMenuId === group.id ? null : group.id
                          )
                        }
                        className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                      >
                        <MoreVertical className="h-4 w-4" />
                      </button>

                      {openGroupMenuId === group.id && (
                        <div className="absolute right-0 top-8 z-50 w-36 rounded-xl border border-border/80 bg-[#161822] p-1 shadow-xl">
                          <button
                            type="button"
                            onClick={() => handleDeleteRuleGroup(group.id)}
                            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-rose-400 hover:bg-rose-500/10"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            <span>Delete group</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="rounded-xl border border-border/40 bg-[#0d0f14] divide-y divide-border/20">
                    {group.rules.map((r: any) => (
                      <div
                        key={r.id}
                        className="grid grid-cols-12 items-center px-4 py-3 text-xs hover:bg-secondary/10"
                      >
                        <div className="col-span-6 flex items-center gap-2.5 pr-3">
                          <GripVertical className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
                          {editingRuleId === r.id ? (
                            <div className="flex flex-1 items-center gap-1.5">
                              <input
                                type="text"
                                value={editingRuleText}
                                onChange={(e) => setEditingRuleText(e.target.value)}
                                autoFocus
                                className="h-7 flex-1 rounded border border-indigo-500 bg-[#161822] px-2 text-xs text-foreground outline-none"
                              />
                              <button
                                type="button"
                                onClick={() => handleSaveEditedRule(group.id, r.id)}
                                className="text-emerald-400 hover:text-emerald-300 p-1"
                              >
                                <Check className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingRuleId(null)}
                                className="text-muted-foreground hover:text-foreground p-1"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ) : (
                            <div className="group flex flex-1 items-center justify-between gap-2 truncate">
                              <span className="truncate text-foreground">{r.text}</span>
                              <div className="hidden items-center gap-1 group-hover:flex shrink-0">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingRuleId(r.id);
                                    setEditingRuleText(r.text);
                                  }}
                                  className="text-muted-foreground hover:text-foreground p-0.5"
                                >
                                  <Pencil className="h-3 w-3" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteRule(group.id, r.id)}
                                  className="text-muted-foreground hover:text-rose-400 p-0.5"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="col-span-1 text-center tabular-nums text-foreground">
                          {r.followRate.toFixed(0)} %
                        </div>
                        <div
                          className={`col-span-2 text-center tabular-nums font-medium ${
                            r.netPnl > 0
                              ? "text-emerald-400"
                              : r.netPnl < 0
                              ? "text-rose-400"
                              : "text-foreground"
                          }`}
                        >
                          {fmtMoney(r.netPnl)}
                        </div>
                        <div className="col-span-1 text-center tabular-nums text-muted-foreground">
                          {r.profitFactor !== null ? r.profitFactor.toFixed(2) : "N/A"}
                        </div>
                        <div className="col-span-2 text-center tabular-nums text-foreground">
                          {r.winRate.toFixed(0)} %
                        </div>
                      </div>
                    ))}

                    {group.rules.length === 0 && (
                      <div className="py-4 text-center text-xs text-muted-foreground">
                        No rules in this group yet.
                      </div>
                    )}
                  </div>

                  {/* Inline + Add rule */}
                  {addingRuleGroupId === group.id ? (
                    <div className="flex items-center gap-2 pl-2 pt-1">
                      <input
                        type="text"
                        value={newRuleText}
                        onChange={(e) => setNewRuleText(e.target.value)}
                        placeholder="Enter rule criteria..."
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleAddRule(group.id);
                        }}
                        className="h-8 flex-1 max-w-md rounded-lg border border-border/70 bg-[#161822] px-3 text-xs text-foreground outline-none focus:border-indigo-500"
                      />
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => handleAddRule(group.id)}
                        className="h-8 bg-[#6366f1] text-white text-xs"
                      >
                        Add
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setAddingRuleGroupId(null)}
                        className="h-8 text-xs"
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setAddingRuleGroupId(group.id);
                        setNewRuleText("");
                      }}
                      className="inline-flex items-center gap-1.5 pl-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span>Add rule</span>
                    </button>
                  )}
                </div>
              ))}

              {/* Add Rule Group Modal */}
              {addingGroupModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
                  <div className="w-full max-w-sm rounded-xl border border-border/70 bg-[#161822] p-5 space-y-4">
                    <h4 className="text-sm font-bold text-foreground">New Rule Group</h4>
                    <input
                      type="text"
                      value={newGroupName}
                      onChange={(e) => setNewGroupName(e.target.value)}
                      placeholder="E.g. Timeframes, Risk Management..."
                      autoFocus
                      className="h-9 w-full rounded-lg border border-border/70 bg-[#0d0f14] px-3 text-xs text-foreground outline-none"
                    />
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setAddingGroupModal(false)}
                        className="text-xs"
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={handleAddRuleGroup}
                        className="bg-[#6366f1] text-white text-xs"
                      >
                        Create Group
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: TRADES */}
          {activeTab === "trades" && (
            <div className="space-y-4">
              {/* Sub-pills: Executed | Missed */}
              <div className="inline-flex rounded-lg border border-border/50 bg-[#0d0f14] p-0.5">
                <button
                  type="button"
                  onClick={() => setTradesSubTab("executed")}
                  className={`rounded-md px-3.5 py-1.5 text-xs font-semibold transition-all ${
                    tradesSubTab === "executed"
                      ? "bg-[#4f46e5] text-white"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Executed
                </button>
                <button
                  type="button"
                  onClick={() => setTradesSubTab("missed")}
                  className={`rounded-md px-3.5 py-1.5 text-xs font-semibold transition-all ${
                    tradesSubTab === "missed"
                      ? "bg-[#4f46e5] text-white"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Missed
                </button>
              </div>

              {tradesSubTab === "executed" ? (
                <div className="overflow-x-auto rounded-xl border border-border/40 bg-[#0d0f14]">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-border/40 bg-[#161822]/60 text-muted-foreground">
                      <tr>
                        <th className="py-3 pl-4 font-medium">Open date</th>
                        <th className="py-3 font-medium">Symbol</th>
                        <th className="py-3 text-center font-medium">Status</th>
                        <th className="py-3 text-center font-medium">Close date</th>
                        <th className="py-3 text-right font-medium">Entry price</th>
                        <th className="py-3 text-right font-medium">Exit price</th>
                        <th className="py-3 text-right font-medium">Net P&L</th>
                        <th className="py-3 text-right font-medium">Net ROI</th>
                        <th className="py-3 pr-4 text-center font-medium">Setups</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/20">
                      {pb.trades.map((t: any) => (
                        <tr
                          key={t.key}
                          onClick={() => router.push(`/trades/${encodeURIComponent(t.key)}`)}
                          className="cursor-pointer hover:bg-secondary/20 transition-colors"
                        >
                          <td className="py-3.5 pl-4 tabular-nums text-foreground">
                            {fmtDateShort(t.openedAt)}
                          </td>
                          <td className="py-3.5 font-bold text-foreground">{t.symbol}</td>
                          <td className="py-3.5 text-center">
                            <span
                              className={`inline-block rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
                                t.status === "WIN"
                                  ? "bg-emerald-500/20 text-emerald-400"
                                  : t.status === "LOSS"
                                  ? "bg-rose-500/20 text-rose-400"
                                  : "bg-secondary text-muted-foreground"
                              }`}
                            >
                              {t.status}
                            </span>
                          </td>
                          <td className="py-3.5 text-center tabular-nums text-muted-foreground">
                            {fmtDateShort(t.closedAt)}
                          </td>
                          <td className="py-3.5 text-right tabular-nums text-foreground">
                            {fmtMoney(t.avgEntry)}
                          </td>
                          <td className="py-3.5 text-right tabular-nums text-foreground">
                            {fmtMoney(t.avgExit)}
                          </td>
                          <td
                            className={`py-3.5 text-right font-semibold tabular-nums ${
                              t.netPnl > 0
                                ? "text-emerald-400"
                                : t.netPnl < 0
                                ? "text-rose-400"
                                : "text-foreground"
                            }`}
                          >
                            {fmtMoney(t.netPnl)}
                          </td>
                          <td
                            className={`py-3.5 text-right tabular-nums ${
                              t.roi >= 0 ? "text-emerald-400" : "text-rose-400"
                            }`}
                          >
                            {t.roi.toFixed(2)}%
                          </td>
                          <td className="py-3.5 pr-4 text-center text-muted-foreground">
                            {pb.name}
                          </td>
                        </tr>
                      ))}

                      {pb.trades.length === 0 && (
                        <tr>
                          <td
                            colSpan={9}
                            className="py-10 text-center text-xs text-muted-foreground"
                          >
                            No executed trades linked to this playbook yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="rounded-xl border border-border/40 bg-[#0d0f14] p-8 text-center text-xs text-muted-foreground">
                  {pb.missedTrades.length === 0
                    ? "No missed trades recorded for this strategy."
                    : `${pb.missedTrades.length} missed trades recorded.`}
                </div>
              )}
            </div>
          )}

          {/* TAB 4: NOTES */}
          {activeTab === "notes" && (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 min-h-[480px]">
              {/* Left Note List Sidebar */}
              <div className="lg:col-span-3 rounded-xl border border-border/40 bg-[#0d0f14] p-3 space-y-2">
                <button
                  type="button"
                  onClick={handleCreateNote}
                  className="flex w-full items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-indigo-400 hover:bg-indigo-500/10 transition-colors"
                >
                  <Plus className="h-4 w-4" />
                  <span>Add note</span>
                </button>

                <div className="divide-y divide-border/20">
                  {pb.notes.map((n: any) => {
                    const isSelected = n.id === selectedNoteId;
                    return (
                      <button
                        key={n.id}
                        type="button"
                        onClick={() => {
                          setSelectedNoteId(n.id);
                          setNoteTitle(n.title);
                          setNoteContent(n.content);
                        }}
                        className={`flex w-full items-center justify-between px-3 py-3 text-left text-xs transition-colors ${
                          isSelected
                            ? "bg-[#161822] font-semibold text-foreground rounded-lg"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <span className="truncate">{n.title || "Untitled"}</span>
                      </button>
                    );
                  })}

                  {pb.notes.length === 0 && (
                    <div className="py-8 text-center text-xs text-muted-foreground">
                      No notes yet. Click <strong>+ Add note</strong> to start writing.
                    </div>
                  )}
                </div>
              </div>

              {/* Right Note Editor Area */}
              <div className="lg:col-span-9 rounded-xl border border-border/40 bg-[#0d0f14] p-5 space-y-4">
                {selectedNoteId ? (
                  <>
                    <div className="flex items-start justify-between gap-4 border-b border-border/30 pb-3">
                      <div className="flex-1">
                        <input
                          type="text"
                          value={noteTitle}
                          onChange={(e) => setNoteTitle(e.target.value)}
                          onBlur={() => handleSaveCurrentNote(noteTitle, noteContent)}
                          placeholder="Note title..."
                          className="w-full bg-transparent text-lg font-bold text-foreground outline-none"
                        />
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {noteSaving ? "Saving..." : "Auto-saves on edit"}
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => handleSaveCurrentNote(noteTitle, noteContent)}
                          className="h-7 bg-[#6366f1] text-white text-xs"
                        >
                          Save note
                        </Button>
                        <button
                          type="button"
                          onClick={() => handleDeleteNote(selectedNoteId)}
                          className="rounded p-1.5 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-400"
                          title="Delete note"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    <RichEditor
                      value={noteContent}
                      onChange={(val) => {
                        setNoteContent(val);
                      }}
                    />
                  </>
                ) : (
                  <div className="flex h-full min-h-[320px] flex-col items-center justify-center text-center text-xs text-muted-foreground">
                    <p>Select a note on the left or click <strong>+ Add note</strong> to create a strategy breakdown.</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      <PlaybookModal
        open={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        initialData={pb}
        onSaved={() => reload()}
      />
    </>
  );
}
