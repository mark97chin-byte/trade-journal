"use client";

import React, { useState } from "react";
import {
  MultiSelectDropdown,
  type CategorizedOption,
} from "@/components/ui/multi-select-dropdown";
import { OptionSelect } from "@/components/ui/option-select";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useApi } from "@/lib/use-api";
import { SlidersHorizontal } from "lucide-react";

interface FilterOptionsResponse {
  symbols: string[];
  tags: string[];
  managedTags?: CategorizedOption[];
}

interface PlaybooksResponse {
  playbooks: { id: string; name: string }[];
}

interface DimensionRank {
  name: string;
  pnl: number;
}

interface GroupAnalysis {
  tradesCount: number;
  totalPnl: number;
  avgDailyVolume: number;
  avgWinningTrade: number | null;
  avgLosingTrade: number | null;
  winningTrades: number;
  losingTrades: number;
  totalCommissions: number;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  avgHoldTimeAllMs: number | null;
  avgHoldTimeWinMs: number | null;
  avgHoldTimeLossMs: number | null;
  profitFactor: number;
  tradeExpectancy: number;
  avgPlannedR: number | null;
  avgRealizedR: number | null;
  longsWinPct: number;
  shortsWinPct: number;
  assetStats: { best: DimensionRank | null; worst: DimensionRank | null };
  dayStats: { best: DimensionRank | null; worst: DimensionRank | null };
  strategyStats: { best: DimensionRank | null; worst: DimensionRank | null };
  tagStats: { best: DimensionRank | null; worst: DimensionRank | null };
  winRate: number;
  curve: { date: string; cumPnl: number }[];
}

interface CompareResponse {
  currency: string;
  group1: GroupAnalysis;
  group2: GroupAnalysis;
}

interface GroupFilterState {
  symbols: string[];
  tags: string[];
  strategies: string[];
  side: string;
  pnlStatus: string;
  startDate: string;
  endDate: string;
}

const EMPTY_GROUP: GroupFilterState = {
  symbols: [],
  tags: [],
  strategies: [],
  side: "all",
  pnlStatus: "all",
  startDate: "",
  endDate: "",
};

function fmtMoney(val: number | null | undefined): string {
  if (val === null || val === undefined || isNaN(val)) return "N/A";
  const abs = Math.abs(val);
  const sign = val < 0 ? "-$" : "$";
  return `${sign}${abs.toLocaleString(undefined, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  })}`;
}

function fmtAxisMoney(val: number): string {
  const abs = Math.abs(val);
  const sign = val < 0 ? "-$" : "$";
  return `${sign}${Math.round(abs).toLocaleString()}`;
}

function fmtDuration(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return "N/A";
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function CompareView({
  dateLabel = "All dates",
  globalQuery = "",
}: {
  dateLabel?: string;
  globalQuery?: string;
}) {
  const { data: filterOpts } = useApi<FilterOptionsResponse>("/api/filter-options");
  const { data: playbooksData } = useApi<PlaybooksResponse>("/api/playbooks");

  const [g1, setG1] = useState<GroupFilterState>(EMPTY_GROUP);
  const [g2, setG2] = useState<GroupFilterState>(EMPTY_GROUP);
  const [data, setData] = useState<CompareResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasGenerated, setHasGenerated] = useState(false);

  const playbookOptions = [
    ...(playbooksData?.playbooks.map((p) => p.name) ?? []),
    "None",
  ];

  const runComparison = async () => {
    setLoading(true);
    setHasGenerated(true);
    try {
      const res = await fetch("/api/reports/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          group1: g1,
          group2: g2,
          globalQuery,
        }),
      });
      if (res.ok) {
        const json = await res.json();
        setData(json.data || json);
      }
    } catch {
      // fallback
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setG1(EMPTY_GROUP);
    setG2(EMPTY_GROUP);
    setData(null);
    setHasGenerated(false);
  };

  function renderGroupFilterCard(
    groupNum: 1 | 2,
    state: GroupFilterState,
    setState: React.Dispatch<React.SetStateAction<GroupFilterState>>,
    count?: number
  ) {
    return (
      <div className="rounded-xl border border-border/50 bg-card p-4 text-foreground shadow-sm">
        <h3 className="text-xs font-semibold text-foreground pb-3">
          Group #{groupNum}{" "}
          {hasGenerated && count !== undefined ? `(${count} Trades Matched)` : ""}
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          {/* Symbol */}
          <div>
            <label className="text-[11px] text-muted-foreground block mb-1">Symbol</label>
            <MultiSelectDropdown
              placeholder="Select symbols"
              searchPlaceholder="Search symbols..."
              options={filterOpts?.symbols ?? []}
              selected={state.symbols}
              onChange={(s) => setState((prev) => ({ ...prev, symbols: s }))}
            />
          </div>

          {/* Tags */}
          <div>
            <label className="text-[11px] text-muted-foreground block mb-1">Tags</label>
            <MultiSelectDropdown
              placeholder="Select tags"
              searchPlaceholder="Search tags..."
              options={filterOpts?.tags ?? []}
              categorizedOptions={filterOpts?.managedTags}
              selected={state.tags}
              onChange={(t) => setState((prev) => ({ ...prev, tags: t }))}
            />
          </div>

          {/* Strategy */}
          <div>
            <label className="text-[11px] text-muted-foreground block mb-1">Strategy</label>
            <MultiSelectDropdown
              placeholder="Select strategies"
              searchPlaceholder="Search strategies..."
              options={playbookOptions}
              selected={state.strategies}
              onChange={(st) => setState((prev) => ({ ...prev, strategies: st }))}
            />
          </div>

          {/* Side */}
          <div>
            <label className="text-[11px] text-muted-foreground block mb-1">Side</label>
            <OptionSelect
              className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-xs text-foreground"
              value={state.side}
              onValueChange={(val) => setState((prev) => ({ ...prev, side: val }))}
            >
              <option value="all">Select side</option>
              <option value="long">Long</option>
              <option value="short">Short</option>
            </OptionSelect>
          </div>

          {/* Trade P&L */}
          <div>
            <label className="text-[11px] text-muted-foreground block mb-1">Trade P&L</label>
            <OptionSelect
              className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-xs text-foreground"
              value={state.pnlStatus}
              onValueChange={(val) => setState((prev) => ({ ...prev, pnlStatus: val }))}
            >
              <option value="all">Select P&L</option>
              <option value="win">Winners</option>
              <option value="loss">Losers</option>
              <option value="breakeven">Breakeven</option>
            </OptionSelect>
          </div>

          {/* Start Date */}
          <div>
            <label className="text-[11px] text-muted-foreground block mb-1">Start date</label>
            <input
              type="date"
              value={state.startDate}
              onChange={(e) =>
                setState((prev) => ({ ...prev, startDate: e.target.value }))
              }
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none"
            />
          </div>

          {/* End Date */}
          <div className="sm:col-span-2">
            <label className="text-[11px] text-muted-foreground block mb-1">End date</label>
            <input
              type="date"
              value={state.endDate}
              onChange={(e) =>
                setState((prev) => ({ ...prev, endDate: e.target.value }))
              }
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none"
            />
          </div>
        </div>
      </div>
    );
  }

  function renderStatsTable(title: string, group?: GroupAnalysis) {
    if (!group) return null;

    return (
      <div className="rounded-xl border border-border/50 bg-card p-4 text-foreground shadow-sm">
        <div className="pb-3 border-b border-border/20">
          <h3 className="text-xs font-semibold text-foreground">{title}</h3>
          <span className="text-[11px] text-muted-foreground">({dateLabel})</span>
        </div>

        <div className="divide-y divide-border/20 text-xs pt-1">
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Total P&L</span>
            <span
              className={`font-semibold tabular-nums ${
                group.totalPnl > 0
                  ? "text-emerald-400"
                  : group.totalPnl < 0
                  ? "text-rose-400"
                  : ""
              }`}
            >
              {fmtMoney(group.totalPnl)}
            </span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Average daily volume</span>
            <span className="font-semibold tabular-nums">
              {group.avgDailyVolume.toFixed(2)}
            </span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Average winning trade</span>
            <span className="font-semibold tabular-nums text-emerald-400">
              {fmtMoney(group.avgWinningTrade)}
            </span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Average losing trade</span>
            <span className="font-semibold tabular-nums text-rose-400">
              {fmtMoney(group.avgLosingTrade)}
            </span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Number of winning trades</span>
            <span className="font-semibold tabular-nums">{group.winningTrades}</span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Number of losing trades</span>
            <span className="font-semibold tabular-nums">{group.losingTrades}</span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Total commissions</span>
            <span className="font-semibold tabular-nums">
              {fmtMoney(group.totalCommissions)}
            </span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Max consecutive wins</span>
            <span className="font-semibold tabular-nums">
              {group.maxConsecutiveWins}
            </span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Max consecutive losses</span>
            <span className="font-semibold tabular-nums">
              {group.maxConsecutiveLosses}
            </span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Average hold time (all)</span>
            <span className="font-semibold">
              {fmtDuration(group.avgHoldTimeAllMs)}
            </span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Avg win trade duration</span>
            <span className="font-semibold text-emerald-400">
              {fmtDuration(group.avgHoldTimeWinMs)}
            </span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Avg loss trade duration</span>
            <span className="font-semibold text-rose-400">
              {fmtDuration(group.avgHoldTimeLossMs)}
            </span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Profit factor</span>
            <span className="font-semibold tabular-nums">
              {group.profitFactor.toFixed(2)}
            </span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Trade expectancy</span>
            <span className="font-semibold tabular-nums">
              {fmtMoney(group.tradeExpectancy)}
            </span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Avg planned R / Realized R</span>
            <span className="font-semibold tabular-nums">
              {group.avgPlannedR !== null ? `${group.avgPlannedR.toFixed(1)}R` : "-"} /{" "}
              {group.avgRealizedR !== null ? `${group.avgRealizedR.toFixed(1)}R` : "-"}
            </span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Best performing asset</span>
            <span className="font-semibold text-emerald-400">
              {group.assetStats.best
                ? `${group.assetStats.best.name} (${fmtMoney(
                    group.assetStats.best.pnl
                  )})`
                : "N/A"}
            </span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Worst performing asset</span>
            <span className="font-semibold text-rose-400">
              {group.assetStats.worst
                ? `${group.assetStats.worst.name} (${fmtMoney(
                    group.assetStats.worst.pnl
                  )})`
                : "N/A"}
            </span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Best / Worst trading day</span>
            <span className="font-semibold">
              {group.dayStats.best?.name ?? "-"} / {group.dayStats.worst?.name ?? "-"}
            </span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Best strategy</span>
            <span className="font-semibold text-emerald-400">
              {group.strategyStats.best
                ? `${group.strategyStats.best.name} (${fmtMoney(
                    group.strategyStats.best.pnl
                  )})`
                : "N/A"}
            </span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Longs win % / Shorts win %</span>
            <span className="font-semibold tabular-nums">
              {group.longsWinPct.toFixed(0)}% / {group.shortsWinPct.toFixed(0)}%
            </span>
          </div>
        </div>
      </div>
    );
  }

  function renderEvaluationRing(title: string, group?: GroupAnalysis) {
    if (!group) return null;

    const total = group.winningTrades + group.losingTrades;
    const winRate = Math.round(group.winRate);
    const radius = 44;
    const circ = 2 * Math.PI * radius;
    const strokeDash = (winRate / 100) * circ;

    return (
      <div className="rounded-xl border border-border/50 bg-card p-4 text-foreground shadow-sm">
        <div className="pb-3 border-b border-border/20">
          <h3 className="text-xs font-semibold text-foreground">{title}</h3>
          <span className="text-[11px] text-muted-foreground">({dateLabel})</span>
        </div>

        <div className="flex items-center justify-center gap-12 py-6">
          <div className="relative flex items-center justify-center">
            <svg width="124" height="124" viewBox="0 0 124 124" className="rotate-90">
              {/* Base Circle (Losers in Red when trades exist, neutral grey when empty) */}
              <circle
                cx="62"
                cy="62"
                r={radius}
                fill="none"
                stroke={total > 0 ? "#ef4444" : "rgba(255,255,255,0.08)"}
                strokeWidth="9"
              />
              {/* Foreground Arc (Winners in Green) */}
              {total > 0 && winRate > 0 && (
                <circle
                  cx="62"
                  cy="62"
                  r={radius}
                  fill="none"
                  stroke="#10b981"
                  strokeWidth="9"
                  strokeDasharray={`${strokeDash} ${circ}`}
                  strokeLinecap="butt"
                />
              )}
            </svg>
            <div className="absolute flex flex-col items-center justify-center text-center">
              <div className="flex items-baseline gap-0.5 text-[#34d399]">
                <span className="text-2xl font-bold tracking-tight">{winRate}</span>
                <span className="text-xs font-semibold">%</span>
              </div>
              <span className="text-[9px] font-semibold uppercase tracking-wider text-[#34d399]/80">
                WINRATE
              </span>
            </div>
          </div>

          <div className="space-y-3.5 text-xs">
            <div className="flex items-center gap-2.5">
              <span className="h-3.5 w-3.5 rounded-xs bg-card" />
              <div>
                <span className="font-bold text-foreground text-sm leading-none block">
                  {group.winningTrades}
                </span>
                <span className="text-[11px] text-muted-foreground block mt-0.5">
                  winners
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              <span className="h-3.5 w-3.5 rounded-xs bg-[#ef4444]" />
              <div>
                <span className="font-bold text-foreground text-sm leading-none block">
                  {group.losingTrades}
                </span>
                <span className="text-[11px] text-muted-foreground block mt-0.5">
                  losers
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  function renderCumulativeCurve(
    safeId: string,
    title: string,
    group?: GroupAnalysis
  ) {
    if (!group) return null;
    const rawPts = group.curve;

    if (rawPts.length === 0) {
      return (
        <div className="rounded-xl border border-border/50 bg-card p-4 text-foreground shadow-sm">
          <div className="pb-3 border-b border-border/20">
            <h3 className="text-xs font-semibold text-foreground">{title}</h3>
            <span className="text-[11px] text-muted-foreground">({dateLabel})</span>
          </div>
          <div className="flex h-52 items-center justify-center text-xs text-muted-foreground">
            No trades in this selection
          </div>
        </div>
      );
    }

    // Prepend a $0 starting anchor point so the curve starts from $0 like TradeZella
    const pts =
      rawPts[0] && rawPts[0].cumPnl !== 0
        ? [{ date: rawPts[0].date, cumPnl: 0 }, ...rawPts]
        : rawPts;

    const width = 620;
    const height = 230;
    const padLeft = 58;
    const padRight = 24;
    const padTop = 18;
    const padBottom = 28;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    const values = pts.map((p) => p.cumPnl);
    const minVal = Math.min(...values, 0);
    const maxVal = Math.max(...values, 0);
    const rawSpan = maxVal - minVal || 100;

    // Nice 6-step Y-axis ticks
    const step = rawSpan / 5;
    const ticks = Array.from({ length: 6 }, (_, i) => minVal + step * i);
    if (!ticks.some((t) => Math.abs(t) < 0.01)) {
      ticks.push(0);
      ticks.sort((a, b) => a - b);
    }

    const getX = (i: number) =>
      padLeft + (i / Math.max(pts.length - 1, 1)) * plotW;
    const getY = (v: number) =>
      padTop + plotH - ((v - minVal) / rawSpan) * plotH;
    const zeroY = getY(0);

    const pathPts = pts.map(
      (p, i) => `${getX(i).toFixed(1)} ${getY(p.cumPnl).toFixed(1)}`
    );
    const linePath = `M ${pathPts.join(" L ")}`;
    const areaPath = `${linePath} L ${getX(pts.length - 1).toFixed(1)} ${zeroY.toFixed(
      1
    )} L ${getX(0).toFixed(1)} ${zeroY.toFixed(1)} Z`;

    return (
      <div className="rounded-xl border border-border/50 bg-card p-4 text-foreground shadow-sm">
        <div className="pb-3 border-b border-border/20">
          <h3 className="text-xs font-semibold text-foreground">{title}</h3>
          <span className="text-[11px] text-muted-foreground">({dateLabel})</span>
        </div>

        <div className="pt-3">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="w-full h-auto overflow-visible select-none"
          >
            <defs>
              {/* Positive Area Gradient (Above $0) */}
              <linearGradient
                id={`posGrad-${safeId}`}
                x1="0"
                y1={padTop}
                x2="0"
                y2={Math.max(zeroY, padTop + 1)}
                gradientUnits="userSpaceOnUse"
              >
                <stop offset="0%" stopColor="#10b981" stopOpacity="0.5" />
                <stop offset="100%" stopColor="#10b981" stopOpacity="0.03" />
              </linearGradient>

              {/* Negative Area Gradient (Below $0) */}
              <linearGradient
                id={`negGrad-${safeId}`}
                x1="0"
                y1={zeroY}
                x2="0"
                y2={ Math.max(height - padBottom, zeroY + 1)}
                gradientUnits="userSpaceOnUse"
              >
                <stop offset="0%" stopColor="#ef4444" stopOpacity="0.03" />
                <stop offset="100%" stopColor="#ef4444" stopOpacity="0.5" />
              </linearGradient>

              {/* Clip paths split at $0 */}
              <clipPath id={`clipPos-${safeId}`}>
                <rect x="0" y="0" width={width} height={Math.max(0, zeroY)} />
              </clipPath>
              <clipPath id={`clipNeg-${safeId}`}>
                <rect
                  x="0"
                  y={zeroY}
                  width={width}
                  height={Math.max(0, height - zeroY)}
                />
              </clipPath>
            </defs>

            {/* Horizontal Grid Lines + Y-Axis Labels */}
            {ticks.map((tk, idx) => {
              const y = getY(tk);
              const isZero = Math.abs(tk) < 0.01;
              return (
                <g key={idx}>
                  <line
                    x1={padLeft}
                    y1={y}
                    x2={width - padRight}
                    y2={y}
                    stroke={
                      isZero
                        ? "rgba(255,255,255,0.22)"
                        : "rgba(255,255,255,0.07)"
                    }
                    strokeDasharray={isZero ? undefined : "2 3"}
                  />
                  <text
                    x={padLeft - 8}
                    y={y + 3}
                    textAnchor="end"
                    fontSize="10"
                    fill="#94a3b8"
                  >
                    {fmtAxisMoney(tk)}
                  </text>
                </g>
              );
            })}

            {/* Green Area Above $0 */}
            <path
              d={areaPath}
              fill={`url(#posGrad-${safeId})`}
              clipPath={`url(#clipPos-${safeId})`}
            />

            {/* Red Area Below $0 */}
            <path
              d={areaPath}
              fill={`url(#negGrad-${safeId})`}
              clipPath={`url(#clipNeg-${safeId})`}
            />

            {/* Curve Line Above $0 */}
            <path
              d={linePath}
              fill="none"
              stroke="#34d399"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              clipPath={`url(#clipPos-${safeId})`}
            />

            {/* Curve Line Below $0 */}
            <path
              d={linePath}
              fill="none"
              stroke="#f87171"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              clipPath={`url(#clipNeg-${safeId})`}
            />

            {/* X-Axis Date Labels */}
            <text x={padLeft} y={height - 6} fontSize="10" fill="#94a3b8">
              {rawPts[0]?.date.slice(5)}
            </text>
            {rawPts.length > 2 && (
              <text
                x={padLeft + plotW / 2}
                y={height - 6}
                textAnchor="middle"
                fontSize="10"
                fill="#94a3b8"
              >
                {rawPts[Math.floor(rawPts.length / 2)]?.date.slice(5)}
              </text>
            )}
            <text
              x={width - padRight}
              y={height - 6}
              textAnchor="end"
              fontSize="10"
              fill="#94a3b8"
            >
              {rawPts[rawPts.length - 1]?.date.slice(5)}
            </text>
          </svg>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 1. TOP GROUP FILTER INPUT CARDS */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {renderGroupFilterCard(1, g1, setG1, data?.group1.tradesCount)}
        {renderGroupFilterCard(2, g2, setG2, data?.group2.tradesCount)}
      </div>

      {/* Action Buttons */}
      <div className="flex items-center justify-end gap-2.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleReset}
          className="text-xs h-8 px-4"
        >
          Reset
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={runComparison}
          disabled={loading}
          className="bg-secondary text-foreground font-semibold border border-border hover:bg-secondary text-foreground font-semibold border border-border text-foreground text-xs h-8 px-4 font-semibold"
        >
          {loading ? "Generating..." : "Generate Report"}
        </Button>
      </div>

      {/* 2. LOADING STATE */}
      {loading && <Skeleton className="h-72 w-full rounded-xl" />}

      {/* 3. EMPTY STATE BEFORE GENERATING */}
      {!hasGenerated && !loading && (
        <div className="rounded-xl border border-dashed border-border/60 bg-card/40 p-8 text-center text-muted-foreground">
          <SlidersHorizontal className="mx-auto h-8 w-8 opacity-40 mb-2" />
          <p className="text-xs font-medium text-foreground">
            No comparison generated yet
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Select the criteria for Group #1 and Group #2 above, then click{" "}
            <strong>Generate Report</strong>.
          </p>
        </div>
      )}

      {/* 4. COMPARISON STATS & CHARTS */}
      {hasGenerated && !loading && data && (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {renderStatsTable("Statistics (Group #1)", data.group1)}
            {renderStatsTable("Statistics (Group #2)", data.group2)}
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {renderEvaluationRing("Overall evaluation (Group #1)", data.group1)}
            {renderEvaluationRing("Overall evaluation (Group #2)", data.group2)}
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {renderCumulativeCurve(
              "group1",
              "Daily net cumulative P&L (Group #1)",
              data.group1
            )}
            {renderCumulativeCurve(
              "group2",
              "Daily net cumulative P&L (Group #2)",
              data.group2
            )}
          </div>
        </>
      )}
    </div>
  );
}
