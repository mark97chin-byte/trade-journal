"use client";

import React, { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FilterBar, useFilters } from "@/components/filter-bar";
import { useApi } from "@/lib/use-api";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { PlaybookModal } from "@/components/playbooks/playbook-modal";
import {
  Plus,
  TrendingUp,
  TrendingDown,
  Zap,
  Trophy,
  LayoutGrid,
  List,
  MoreVertical,
  Pencil,
  Archive,
  Trash2,
} from "lucide-react";

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

export default function PlaybooksPage() {
  return (
    <Suspense>
      <PlaybooksContent />
    </Suspense>
  );
}

function PlaybooksContent() {
  const router = useRouter();
  const { query } = useFilters();
  const [refreshKey, setRefreshKey] = useState(0);
  const reload = () => setRefreshKey((k) => k + 1);
  const { data, loading } = useApi<any>(`/api/playbooks?${query}${query ? "&" : ""}_r=${refreshKey}`);

  const [tab, setTab] = useState<"active" | "archived">("active");
  const [viewMode, setViewMode] = useState<"table" | "grid">("table");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingPlaybook, setEditingPlaybook] = useState<any | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const playbooks = data?.playbooks ?? [];
  const highlights = data?.highlights ?? null;

  const filteredPlaybooks = playbooks.filter((p: any) =>
    tab === "active" ? !p.archived : p.archived
  );

  const handleArchiveToggle = async (pb: any) => {
    setOpenMenuId(null);
    await fetch(`/api/playbooks/${pb.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: !pb.archived }),
    });
    reload();
  };

  const handleDelete = async (pb: any) => {
    setOpenMenuId(null);
    await fetch(`/api/playbooks/${pb.id}`, { method: "DELETE" });
    reload();
  };

  return (
    <>
      <FilterBar title="Playbooks" />

      <main className="mx-auto max-w-7xl px-4 py-5 space-y-5">
        {/* TOP ROW: + New playbook button */}
        <div className="flex items-center justify-end">
          <Button
            type="button"
            onClick={() => {
              setEditingPlaybook(null);
              setModalOpen(true);
            }}
            className="bg-[#6366f1] hover:bg-[#4f46e5] text-white text-xs font-semibold h-9 px-4 gap-1.5 shadow-sm"
          >
            <Plus className="h-4 w-4" />
            <span>New playbook</span>
          </Button>
        </div>

        {/* TOP 4 QUICK STATS CARDS */}
        {highlights && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {/* Best performing */}
            <div className="rounded-xl border border-border/50 bg-[#12141a] p-4 shadow-sm">
              <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-medium">
                <TrendingUp className="h-3.5 w-3.5" />
                <span>Best performing strategy</span>
              </div>
              <div className="mt-2 flex items-center gap-2 text-base font-bold text-foreground truncate">
                <span>{highlights.best.icon}</span>
                <span className="truncate">{highlights.best.name}</span>
              </div>
              <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                <span>
                  {highlights.best.tradesCount}{" "}
                  {highlights.best.tradesCount === 1 ? "trade" : "trades"}
                </span>
                <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-semibold text-emerald-400">
                  {fmtMoney(highlights.best.netPnl)}
                </span>
              </div>
            </div>

            {/* Least performing */}
            <div className="rounded-xl border border-border/50 bg-[#12141a] p-4 shadow-sm">
              <div className="flex items-center gap-1.5 text-xs text-rose-400 font-medium">
                <TrendingDown className="h-3.5 w-3.5" />
                <span>Least performing strategy</span>
              </div>
              <div className="mt-2 flex items-center gap-2 text-base font-bold text-foreground truncate">
                <span>{highlights.least.icon}</span>
                <span className="truncate">{highlights.least.name}</span>
              </div>
              <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                <span>
                  {highlights.least.tradesCount}{" "}
                  {highlights.least.tradesCount === 1 ? "trade" : "trades"}
                </span>
                <span
                  className={`rounded px-1.5 py-0.5 font-semibold ${
                    highlights.least.netPnl >= 0
                      ? "bg-emerald-500/15 text-emerald-400"
                      : "bg-rose-500/15 text-rose-400"
                  }`}
                >
                  {fmtMoney(highlights.least.netPnl)}
                </span>
              </div>
            </div>

            {/* Most active */}
            <div className="rounded-xl border border-border/50 bg-[#12141a] p-4 shadow-sm">
              <div className="flex items-center gap-1.5 text-xs text-amber-400 font-medium">
                <Zap className="h-3.5 w-3.5" />
                <span>Most active strategy</span>
              </div>
              <div className="mt-2 flex items-center gap-2 text-base font-bold text-foreground truncate">
                <span>{highlights.mostActive.icon}</span>
                <span className="truncate">{highlights.mostActive.name}</span>
              </div>
              <div className="mt-1.5 text-xs text-muted-foreground">
                {highlights.mostActive.tradesCount}{" "}
                {highlights.mostActive.tradesCount === 1 ? "trade" : "trades"}
              </div>
            </div>

            {/* Best win rate */}
            <div className="rounded-xl border border-border/50 bg-[#12141a] p-4 shadow-sm">
              <div className="flex items-center gap-1.5 text-xs text-indigo-400 font-medium">
                <Trophy className="h-3.5 w-3.5" />
                <span>Best win rate</span>
              </div>
              <div className="mt-2 flex items-center gap-2 text-base font-bold text-foreground truncate">
                <span>{highlights.bestWinRate.icon}</span>
                <span className="truncate">{highlights.bestWinRate.name}</span>
              </div>
              <div className="mt-1.5 text-xs text-muted-foreground">
                {highlights.bestWinRate.winRate.toFixed(0)}% /{" "}
                {highlights.bestWinRate.tradesCount}{" "}
                {highlights.bestWinRate.tradesCount === 1 ? "trade" : "trades"}
              </div>
            </div>
          </div>
        )}

        {/* VIEW BAR & ACTIVE / ARCHIVED PILLS */}
        <div className="space-y-3">
          <div className="flex items-center justify-end gap-2 rounded-xl border border-border/40 bg-[#12141a] px-4 py-2.5">
            <button
              type="button"
              onClick={() => setViewMode("grid")}
              className={`rounded p-1.5 transition-colors ${
                viewMode === "grid"
                  ? "text-indigo-400 bg-indigo-500/10"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              title="Grid view"
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode("table")}
              className={`rounded p-1.5 transition-colors ${
                viewMode === "table"
                  ? "text-indigo-400 bg-indigo-500/10"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              title="List view"
            >
              <List className="h-4 w-4" />
            </button>
          </div>

          <div className="flex items-center gap-1 rounded-xl border border-border/40 bg-[#161822] p-1 w-fit">
            <button
              type="button"
              onClick={() => setTab("active")}
              className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${
                tab === "active"
                  ? "bg-[#0d0f14] text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Active
            </button>
            <button
              type="button"
              onClick={() => setTab("archived")}
              className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${
                tab === "archived"
                  ? "bg-[#0d0f14] text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Archived
            </button>
          </div>
        </div>

        {/* LOADING */}
        {loading && <Skeleton className="h-64 w-full rounded-xl" />}

        {/* TABLE VIEW */}
        {!loading && viewMode === "table" && (
          <div className="rounded-xl border border-border/40 bg-[#12141a] overflow-visible">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border/40 bg-[#161822]/60 text-muted-foreground">
                <tr>
                  <th className="w-10 py-3.5 pl-4">
                    <Checkbox
                      checked={
                        filteredPlaybooks.length > 0 &&
                        filteredPlaybooks.every((p: any) => selectedIds.has(p.id))
                      }
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setSelectedIds(new Set(filteredPlaybooks.map((p: any) => p.id)));
                        } else {
                          setSelectedIds(new Set());
                        }
                      }}
                    />
                  </th>
                  <th className="py-3.5 font-medium">Title</th>
                  <th className="py-3.5 text-center font-medium">Missed trades</th>
                  <th className="py-3.5 text-center font-medium">Shared strategies</th>
                  <th className="py-3.5 text-center font-medium">Average loser</th>
                  <th className="py-3.5 text-center font-medium">Average winner</th>
                  <th className="py-3.5 text-center font-medium">Total net P&L</th>
                  <th className="py-3.5 text-center font-medium">Profit factor</th>
                  <th className="py-3.5 text-center font-medium">Trades</th>
                  <th className="w-10 py-3.5 pr-4"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/20">
                {filteredPlaybooks.map((pb: any) => {
                  const s = pb.stats;
                  return (
                    <tr
                      key={pb.id}
                      onClick={() => router.push(`/playbooks/${pb.id}`)}
                      className="cursor-pointer hover:bg-secondary/20 transition-colors"
                    >
                      <td
                        className="py-4 pl-4"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Checkbox
                          checked={selectedIds.has(pb.id)}
                          onCheckedChange={(checked) => {
                            const next = new Set(selectedIds);
                            if (checked) next.add(pb.id);
                            else next.delete(pb.id);
                            setSelectedIds(next);
                          }}
                        />
                      </td>
                      <td className="py-4 font-semibold text-foreground">
                        <div className="flex items-center gap-2.5">
                          <span className="text-base">{pb.icon}</span>
                          <span>{pb.name}</span>
                        </div>
                      </td>
                      <td className="py-4 text-center tabular-nums text-muted-foreground">
                        {pb.missedTradesCount ?? 0}
                      </td>
                      <td className="py-4 text-center text-muted-foreground">-</td>
                      <td className="py-4 text-center tabular-nums text-foreground">
                        {fmtMoney(s.avgLoser)}
                      </td>
                      <td className="py-4 text-center tabular-nums text-foreground">
                        {fmtMoney(s.avgWinner)}
                      </td>
                      <td
                        className={`py-4 text-center font-semibold tabular-nums ${
                          s.netPnl > 0
                            ? "text-emerald-400"
                            : s.netPnl < 0
                            ? "text-rose-400"
                            : "text-foreground"
                        }`}
                      >
                        {fmtMoney(s.netPnl)}
                      </td>
                      <td className="py-4 text-center tabular-nums text-foreground">
                        {s.tradesCount > 0 ? s.profitFactor.toFixed(1) : "N/A"}
                      </td>
                      <td className="py-4 text-center tabular-nums text-foreground">
                        {s.tradesCount}
                      </td>
                      <td
                        className="relative py-4 pr-4 text-right"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setOpenMenuId(openMenuId === pb.id ? null : pb.id)
                          }
                          className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                        >
                          <MoreVertical className="h-4 w-4" />
                        </button>

                        {openMenuId === pb.id && (
                          <div className="absolute right-4 top-12 z-50 w-36 rounded-xl border border-border/80 bg-[#161822] p-1.5 shadow-2xl text-left">
                            <button
                              type="button"
                              onClick={() => {
                                setOpenMenuId(null);
                                setEditingPlaybook(pb);
                                setModalOpen(true);
                              }}
                              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-foreground hover:bg-secondary/50"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              <span>Edit strategy</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleArchiveToggle(pb)}
                              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-foreground hover:bg-secondary/50"
                            >
                              <Archive className="h-3.5 w-3.5" />
                              <span>{pb.archived ? "Unarchive" : "Archive"}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(pb)}
                              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-rose-400 hover:bg-rose-500/10"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              <span>Delete</span>
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}

                {filteredPlaybooks.length === 0 && (
                  <tr>
                    <td
                      colSpan={10}
                      className="py-12 text-center text-xs text-muted-foreground"
                    >
                      No {tab} playbooks yet. Click <strong>+ New playbook</strong> to build your first strategy.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* GRID VIEW */}
        {!loading && viewMode === "grid" && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredPlaybooks.map((pb: any) => {
              const s = pb.stats;
              return (
                <Link
                  key={pb.id}
                  href={`/playbooks/${pb.id}`}
                  className="group rounded-xl border border-border/50 bg-[#12141a] p-5 hover:border-indigo-500/50 transition-all space-y-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <span className="text-xl">{pb.icon}</span>
                      <div>
                        <h3 className="text-sm font-bold text-foreground group-hover:text-indigo-400 transition-colors">
                          {pb.name}
                        </h3>
                        <p className="text-[11px] text-muted-foreground line-clamp-1">
                          {pb.description || `${pb.rules.length} rules`}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border/20 text-xs">
                    <div>
                      <span className="text-[10px] text-muted-foreground block">Net P&L</span>
                      <span
                        className={`font-bold ${
                          s.netPnl > 0
                            ? "text-emerald-400"
                            : s.netPnl < 0
                            ? "text-rose-400"
                            : "text-foreground"
                        }`}
                      >
                        {fmtMoney(s.netPnl)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-muted-foreground block">Win rate</span>
                      <span className="font-bold text-foreground">
                        {s.winRate.toFixed(0)}%
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-muted-foreground block">Trades</span>
                      <span className="font-bold text-foreground">{s.tradesCount}</span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        {/* PAGINATION FOOTER */}
        {!loading && filteredPlaybooks.length > 0 && (
          <div className="flex flex-col items-center justify-center gap-1.5 pt-2 text-xs text-muted-foreground">
            <span>
              Result: 1 - {filteredPlaybooks.length} of {filteredPlaybooks.length} strategies
            </span>
          </div>
        )}
      </main>

      <PlaybookModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        initialData={editingPlaybook}
        onSaved={() => reload()}
      />
    </>
  );
}
