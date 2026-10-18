"use client";

import React from "react";
import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface DetailedTradeStats {
  totalPnl: number;
  tradesCount: number;
  avgTradePnl: number;
  largestTrade: number;
  avgDurationMs: number | null;
  avgMfe: number | null;
  avgMae: number | null;
  avgPlannedR: number | null;
  avgRealizedR: number | null;
  avgDailyVolume: number;
  totalVolume: number;
  totalCommissions: number;
  maxConsecutiveStreak: number;
}

interface WinsVsLossesData {
  winsStats: DetailedTradeStats;
  lossesStats: DetailedTradeStats;
  winsCurve: { date: string; cumPnl: number }[];
  lossesCurve: { date: string; cumPnl: number }[];
}

function fmtMoney(val: number | null): string {
  if (val === null || isNaN(val)) return "N/A";
  const abs = Math.abs(val);
  const sign = val < 0 ? "-$" : "$";
  return `${sign}${abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms <= 0) return "N/A";
  const totalMinutes = Math.round(ms / 60000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function WinsVsLossesView({
  data,
  dateLabel = "All dates",
  currency = "USD",
}: {
  data: WinsVsLossesData;
  dateLabel?: string;
  currency?: string;
}) {
  const { winsStats, lossesStats, winsCurve, lossesCurve } = data;

  function renderCurve(pts: { date: string; cumPnl: number }[], color: string) {
    if (pts.length === 0) {
      return (
        <div className="flex h-56 items-center justify-center text-xs text-muted-foreground">
          No data recorded in this period
        </div>
      );
    }

    const width = 600;
    const height = 220;
    const padX = 50;
    const padY = 25;

    const values = pts.map((p) => p.cumPnl);
    const minVal = Math.min(...values, 0);
    const maxVal = Math.max(...values, 0);
    const span = maxVal - minVal || 1;

    const getX = (i: number) => padX + (i / Math.max(pts.length - 1, 1)) * (width - padX * 2);
    const getY = (v: number) => height - padY - ((v - minVal) / span) * (height - padY * 2);
    const zeroY = getY(0);

    const pathPts = pts.map((p, i) => `${getX(i).toFixed(1)} ${getY(p.cumPnl).toFixed(1)}`);
    const linePath = `M ${pathPts.join(" L ")}`;
    const areaPath = `${linePath} L ${getX(pts.length - 1)} ${zeroY} L ${getX(0)} ${zeroY} Z`;

    return (
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto overflow-visible">
        <line
          x1={padX}
          y1={zeroY}
          x2={width - padX}
          y2={zeroY}
          stroke="rgba(255,255,255,0.15)"
          strokeDasharray="3 3"
        />
        <path d={areaPath} fill={color} fillOpacity="0.2" />
        <path
          d={linePath}
          fill="none"
          stroke={color}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <text x={padX} y={height - 5} fontSize="10" fill="#71717a">
          {pts[0]?.date.slice(5)}
        </text>
        <text x={width - padX} y={height - 5} textAnchor="end" fontSize="10" fill="#71717a">
          {pts[pts.length - 1]?.date.slice(5)}
        </text>
      </svg>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {/* LEFT: WINS */}
      <div className="space-y-4">
        <div className="rounded-xl border border-border/50 bg-slate-50 dark:bg-card p-4">
          <div className="flex items-center justify-between pb-3 border-b border-border/20">
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                Wins ({winsStats.tradesCount} Trades Matched)
              </h3>
              <span className="text-[11px] text-muted-foreground">({dateLabel})</span>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" className="text-muted-foreground hover:text-foreground">
                  <Info className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Performance metrics for all profitable trades.</TooltipContent>
            </Tooltip>
          </div>

          <div className="divide-y divide-border/20 text-xs pt-2">
            <div className="flex justify-between py-2">
              <span className="text-muted-foreground">Total P&L</span>
              <span className="font-semibold text-profit tabular-nums">
                {fmtMoney(winsStats.totalPnl)}
              </span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-muted-foreground">Number of trades</span>
              <span className="font-semibold tabular-nums">{winsStats.tradesCount}</span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-muted-foreground">Average winning trade</span>
              <span className="font-semibold tabular-nums text-profit">
                {fmtMoney(winsStats.avgTradePnl)}
              </span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-muted-foreground">Largest winning trade</span>
              <span className="font-semibold tabular-nums text-profit">
                {fmtMoney(winsStats.largestTrade)}
              </span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-muted-foreground">Average trade duration</span>
              <span className="font-semibold">{fmtDuration(winsStats.avgDurationMs)}</span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-muted-foreground">Average MFE (Max Run-up)</span>
              <span className="font-semibold text-profit tabular-nums">
                {winsStats.avgMfe !== null ? fmtMoney(winsStats.avgMfe) : "N/A"}
              </span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-muted-foreground">Average MAE (Max Drawdown)</span>
              <span className="font-semibold text-rose-400 tabular-nums">
                {winsStats.avgMae !== null ? fmtMoney(-Math.abs(winsStats.avgMae)) : "N/A"}
              </span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-muted-foreground">Average planned R-Multiple</span>
              <span className="font-semibold tabular-nums">
                {winsStats.avgPlannedR !== null ? `${winsStats.avgPlannedR.toFixed(2)}R` : "N/A"}
              </span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-muted-foreground">Average realized R-Multiple</span>
              <span className="font-semibold tabular-nums text-profit">
                {winsStats.avgRealizedR !== null ? `${winsStats.avgRealizedR.toFixed(2)}R` : "N/A"}
              </span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-muted-foreground">Average volume per trade</span>
              <span className="font-semibold tabular-nums">{winsStats.avgDailyVolume.toFixed(2)}</span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-muted-foreground">Total volume</span>
              <span className="font-semibold tabular-nums">{winsStats.totalVolume.toFixed(2)}</span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-muted-foreground">Total commissions & fees</span>
              <span className="font-semibold tabular-nums">{fmtMoney(winsStats.totalCommissions)}</span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-muted-foreground">Max consecutive wins</span>
              <span className="font-semibold tabular-nums text-profit">{winsStats.maxConsecutiveStreak}</span>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border/50 bg-slate-50 dark:bg-card p-4">
          <div className="flex items-center justify-between pb-2 border-b border-border/20">
            <div>
              <h4 className="text-xs font-semibold text-foreground">Daily net cumulative P&L (Wins)</h4>
              <span className="text-[10px] text-muted-foreground">({dateLabel})</span>
            </div>
          </div>
          <div className="pt-2">{renderCurve(winsCurve, "var(--profit)")}</div>
        </div>
      </div>

      {/* RIGHT: LOSSES */}
      <div className="space-y-4">
        <div className="rounded-xl border border-border/50 bg-slate-50 dark:bg-card p-4">
          <div className="flex items-center justify-between pb-3 border-b border-border/20">
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                Losses ({lossesStats.tradesCount} Trades Matched)
              </h3>
              <span className="text-[11px] text-muted-foreground">({dateLabel})</span>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" className="text-muted-foreground hover:text-foreground">
                  <Info className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Performance metrics for all losing trades.</TooltipContent>
            </Tooltip>
          </div>

          <div className="divide-y divide-border/20 text-xs pt-2">
            <div className="flex justify-between py-2">
              <span className="text-muted-foreground">Total P&L</span>
              <span className="font-semibold text-rose-400 tabular-nums">
                {fmtMoney(lossesStats.totalPnl)}
              </span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-muted-foreground">Number of trades</span>
              <span className="font-semibold tabular-nums">{lossesStats.tradesCount}</span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-muted-foreground">Average losing trade</span>
              <span className="font-semibold tabular-nums text-rose-400">
                {fmtMoney(lossesStats.avgTradePnl)}
              </span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-muted-foreground">Largest losing trade</span>
              <span className="font-semibold tabular-nums text-rose-400">
                {fmtMoney(lossesStats.largestTrade)}
              </span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-muted-foreground">Average trade duration</span>
              <span className="font-semibold">{fmtDuration(lossesStats.avgDurationMs)}</span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-muted-foreground">Average MFE (Max Run-up)</span>
              <span className="font-semibold text-profit tabular-nums">
                {lossesStats.avgMfe !== null ? fmtMoney(lossesStats.avgMfe) : "N/A"}
              </span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-muted-foreground">Average MAE (Max Drawdown)</span>
              <span className="font-semibold text-rose-400 tabular-nums">
                {lossesStats.avgMae !== null ? fmtMoney(-Math.abs(lossesStats.avgMae)) : "N/A"}
              </span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-muted-foreground">Average planned R-Multiple</span>
              <span className="font-semibold tabular-nums">
                {lossesStats.avgPlannedR !== null ? `${lossesStats.avgPlannedR.toFixed(2)}R` : "N/A"}
              </span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-muted-foreground">Average realized R-Multiple</span>
              <span className="font-semibold tabular-nums text-rose-400">
                {lossesStats.avgRealizedR !== null ? `${lossesStats.avgRealizedR.toFixed(2)}R` : "N/A"}
              </span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-muted-foreground">Average volume per trade</span>
              <span className="font-semibold tabular-nums">{lossesStats.avgDailyVolume.toFixed(2)}</span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-muted-foreground">Total volume</span>
              <span className="font-semibold tabular-nums">{lossesStats.totalVolume.toFixed(2)}</span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-muted-foreground">Total commissions & fees</span>
              <span className="font-semibold tabular-nums">{fmtMoney(lossesStats.totalCommissions)}</span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-muted-foreground">Max consecutive losses</span>
              <span className="font-semibold tabular-nums text-rose-400">{lossesStats.maxConsecutiveStreak}</span>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border/50 bg-slate-50 dark:bg-card p-4">
          <div className="flex items-center justify-between pb-2 border-b border-border/20">
            <div>
              <h4 className="text-xs font-semibold text-foreground">Daily net cumulative P&L (Losses)</h4>
              <span className="text-[10px] text-muted-foreground">({dateLabel})</span>
            </div>
          </div>
          <div className="pt-2">{renderCurve(lossesCurve, "#ef4444")}</div>
        </div>
      </div>
    </div>
  );
}
