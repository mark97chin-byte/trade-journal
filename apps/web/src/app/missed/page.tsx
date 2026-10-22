"use client";

import React, { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Plus,
  Trash2,
  ChevronLeft,
  ChevronRight,
  LayoutList,
  ArrowRight,
} from "lucide-react";
import { FilterBar } from "@/components/filter-bar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useApi } from "@/lib/use-api";
import { fmtMoney } from "@/lib/utils";

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
  quantity: number;
  plannedR: number | null;
  realizedR: number | null;
  theoreticalPnl: number;
  missReason: string;
  session: string;
  notes: string;
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

function utcIsoToNyInput(isoStr: string | null | undefined): string {
  const d = isoStr ? new Date(isoStr) : new Date();
  if (isNaN(d.getTime())) return new Date().toISOString().slice(0, 16);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  const hr = map.hour === "24" ? "00" : map.hour || "00";
  return `${map.year}-${map.month}-${map.day}T${hr}:${map.minute}`;
}

function deriveIctSessionFromIso(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return "NY AM";
    const hStr = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      hour12: false,
    }).format(d);
    const h = parseInt(hStr, 10) % 24;
    if (h >= 2 && h < 8) return "London";
    if (h >= 8 && h < 12) return "NY AM";
    if (h >= 12 && h < 18) return "NY PM";
    return "Asia";
  } catch {
    return "NY AM";
  }
}

export default function MissedPage() {
  return (
    <Suspense>
      <MissedTradesDirectory />
    </Suspense>
  );
}

function MissedTradesDirectory() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlIdParam = searchParams.get("id");

  const { data, refresh } = useApi<{ trades: MissedTradeRecord[] }>("/api/workspace/missed");
  const { data: journalSymbols } = useApi<{ symbols: string[] }>("/api/trades/distinct-symbols");

  // If ?id=... was passed, redirect straight to the dedicated /missed/[id] page
  useEffect(() => {
    if (urlIdParam) {
      router.replace(`/missed/${encodeURIComponent(urlIdParam)}`);
    }
  }, [urlIdParam, router]);

  const [calendarMonth, setCalendarMonth] = useState<string>(() =>
    new Date().toISOString().slice(0, 7)
  );
  const [selectedDateFilter, setSelectedDateFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [reasonFilter, setReasonFilter] = useState<string>("all");
  const [sessionFilter, setSessionFilter] = useState<string>("all");
  const [outcomeFilter, setOutcomeFilter] = useState<string>("all");
  const [directionFilter, setDirectionFilter] = useState<string>("all");
  const [newSymbolInput, setNewSymbolInput] = useState("NAS100");
  const [newDateInput, setNewDateInput] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [creating, setCreating] = useState(false);

  const allUnarchived = useMemo(
    () => (data?.trades || []).filter((t) => !t.archivedAt),
    [data]
  );

  const activeList = useMemo(() => {
    return allUnarchived.filter((t) => {
      if (
        selectedDateFilter &&
        utcIsoToNyInput(t.observedAt).slice(0, 10) !== selectedDateFilter
      )
        return false;
      if (reasonFilter !== "all" && t.missReason !== reasonFilter) return false;
      if (sessionFilter !== "all" && t.session !== sessionFilter) return false;
      if (outcomeFilter !== "all" && t.outcome !== outcomeFilter) return false;
      if (directionFilter !== "all" && t.direction !== directionFilter) return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        t.id.toLowerCase().includes(q) ||
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

  const summaryStats = useMemo(() => {
    const list = activeList;
    const totalMissedPnl = list.reduce((acc, t) => acc + (t.theoreticalPnl || 0), 0);
    const totalMissedR = list.reduce((acc, t) => acc + (t.realizedR || 0), 0);
    const wins = list.filter((t) => t.outcome === "WIN").length;
    const winRate = list.length > 0 ? Math.round((wins / list.length) * 100) : 0;
    return { count: list.length, totalMissedPnl, totalMissedR, winRate };
  }, [activeList]);

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
      const dKey = utcIsoToNyInput(t.observedAt).slice(0, 10);
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

  const handleCreateMissedSetup = async () => {
    setCreating(true);
    try {
      const targetDate = selectedDateFilter || newDateInput || new Date().toISOString().slice(0, 10);
      const observedIso = `${targetDate}T13:30:00.000Z`; // 09:30 NY default
      const res = await fetch("/api/workspace/missed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: (newSymbolInput || "NAS100").trim().toUpperCase(),
          direction: "long",
          observedAt: observedIso,
          exitAt: observedIso,
          outcome: "WIN",
          missReason: MISS_REASONS[0],
          notes: "<p></p>",
        }),
      });
      const out = await res.json();
      if (out?.trade?.id) {
        router.push(`/missed/${encodeURIComponent(out.trade.id)}`);
      }
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteMissed = async (id: string) => {
    if (!window.confirm(`Delete missed setup ${id}?`)) return;
    await fetch("/api/workspace/missed", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, permanent: true }),
    });
    refresh();
  };

  return (
    <div className="flex flex-col min-h-screen">
      <FilterBar title="Missed trades" />

      <div className="p-4 space-y-4">
        {/* TOP SUMMARY & QUICK CREATE BAR */}
        <Card className="border-border/70 bg-card">
          <CardContent className="flex flex-wrap items-center justify-between gap-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={newSymbolInput}
                onChange={(e) => setNewSymbolInput(e.target.value)}
                className="h-8 rounded-md border border-border bg-background px-2 text-xs font-mono font-bold text-foreground"
              >
                {(journalSymbols?.symbols || ["NAS100", "US500", "US30", "XAUUSD"]).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <input
                type="date"
                value={selectedDateFilter || newDateInput}
                onChange={(e) => setNewDateInput(e.target.value)}
                className="h-8 rounded-md border border-border bg-background px-2.5 text-xs font-mono text-foreground"
              />
              <Button
                size="sm"
                disabled={creating}
                onClick={handleCreateMissedSetup}
                className="h-8 text-xs font-semibold"
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                {creating ? "Creating..." : "Log Missed Setup"}
              </Button>
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

        {/* MONTHLY CALENDAR */}
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
                onClick={() => setCalendarMonth(new Date().toISOString().slice(0, 7))}
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
                    onClick={() => {
                      if (cell.stat && cell.stat.items.length === 1) {
                        router.push(`/missed/${encodeURIComponent(cell.stat.items[0]!.id)}`);
                      } else {
                        setSelectedDateFilter((prev) =>
                          prev === cell.dateStr ? null : cell.dateStr
                        );
                      }
                    }}
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

        {/* FILTERABLE MISSED TRADES TABLE */}
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
                  placeholder="Search ID, symbol or notes..."
                  className="h-8 w-48 text-xs"
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
                      <th className="py-2 px-3">Setup ID</th>
                      <th className="py-2 px-3">Date (NY) &amp; Session</th>
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
                        onClick={() => router.push(`/missed/${encodeURIComponent(item.id)}`)}
                        className="hover:bg-secondary/40 cursor-pointer transition"
                      >
                        <td className="py-2.5 px-3 font-mono font-semibold text-foreground">
                          {item.id}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-muted-foreground">
                          {utcIsoToNyInput(item.observedAt).replace("T", " ")} •{" "}
                          <strong className="text-foreground">
                            {deriveIctSessionFromIso(item.observedAt)}
                          </strong>
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
                          <Link
                            href={`/missed/${encodeURIComponent(item.id)}`}
                            className="inline-flex items-center gap-1 rounded-md border border-border bg-secondary hover:bg-secondary/80 px-2.5 py-1 text-xs font-semibold text-foreground mr-1.5"
                          >
                            <span>Open Setup</span>
                            <ArrowRight className="h-3 w-3" />
                          </Link>
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
    </div>
  );
}
