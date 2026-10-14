"use client";

import React from "react";
import { Info, MoreHorizontal } from "lucide-react";
import { useApi } from "@/lib/use-api";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";

interface YourStatsResponse {
  currency: string;
  bestMonth: { month: string; pnl: number } | null;
  lowestMonth: { month: string; pnl: number } | null;
  avgMonthlyPnl: number | null;
  left: {
    totalPnl: number;
    avgDailyVolume: number;
    avgWinningTrade: number;
    avgLosingTrade: number;
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    beTrades: number;
    maxConsecWins: number;
    maxConsecLosses: number;
    totalCommissions: number;
    totalFees: number;
    totalSwap: number;
    largestProfit: number;
    largestLoss: number;
    avgHoldTimeAll: number | null;
    avgHoldTimeWin: number | null;
    avgHoldTimeLoss: number | null;
    avgHoldTimeScratch: number | null;
    avgTradePnl: number;
    profitFactor: number;
  };
  right: {
    openTrades: number;
    totalTradingDays: number;
    winningDays: number;
    losingDays: number;
    beDays: number;
    loggedDays: number;
    maxConsecWinDays: number;
    maxConsecLossDays: number;
    avgDailyPnl: number;
    avgWinningDayPnl: number;
    avgLosingDayPnl: number;
    largestProfitableDay: number;
    largestLosingDay: number;
    avgPlannedR: number | null;
    avgRealizedR: number | null;
    tradeExpectancy: number;
    maxDrawdown: number;
    maxDrawdownPct: number;
    avgDrawdown: number;
    avgDrawdownPct: number;
  };
}

function fmtMoney(val: number | null | undefined, currency: string = "USD"): string {
  if (val === null || val === undefined || isNaN(val)) return "-";
  const abs = Math.abs(val);
  const sign = val < 0 ? "-$" : "$";
  return `${sign}${abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtHoldTime(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms <= 0) return "N/A";
  const totalMinutes = Math.round(ms / 60000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `${days} ${days === 1 ? "day" : "days"}, ${hours} ${hours === 1 ? "hour" : "hours"}`;
  if (hours > 0) return `${hours} ${hours === 1 ? "hours" : "hours"}, ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

function formatMonthLabel(mKey: string): string {
  const [y, m] = mKey.split("-");
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, 1));
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

export function YourStatsOverview({
  query,
  dateLabel = "All dates",
}: {
  query: string;
  dateLabel?: string;
}) {
  const { data, loading, error } = useApi<YourStatsResponse>(`/api/reports/your-stats?${query}`);

  if (loading || !data) return <Skeleton className="h-96 w-full rounded-xl" />;
  if (error) return null;

  const { left, right, bestMonth, lowestMonth, avgMonthlyPnl, currency } = data;

  return (
    <div className="w-full rounded-xl border border-border/50 bg-[#12141a] p-5 text-foreground shadow-sm mb-6">
      {/* Header with dynamic date */}
      <div className="flex items-center justify-between pb-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Your stats</h2>
          <span className="text-xs text-muted-foreground">({dateLabel})</span>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" className="text-muted-foreground hover:text-foreground">
              <Info className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Detailed account performance statistics across all matched trades.</TooltipContent>
        </Tooltip>
      </div>

      {/* Top 3 Highlights */}
      <div className="flex flex-wrap items-center justify-between gap-6 pb-4">
        <div className="flex flex-wrap items-center gap-8 sm:gap-14">
          <div>
            <div className="text-xs text-muted-foreground">Best month</div>
            <div className="text-lg font-bold text-foreground">
              {bestMonth ? fmtMoney(bestMonth.pnl, currency) : "-"}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {bestMonth ? `in ${formatMonthLabel(bestMonth.month)}` : "--"}
            </div>
          </div>

          <div>
            <div className="text-xs text-muted-foreground">Lowest month</div>
            <div className="text-lg font-bold text-foreground">
              {lowestMonth ? fmtMoney(lowestMonth.pnl, currency) : "-"}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {lowestMonth ? `in ${formatMonthLabel(lowestMonth.month)}` : "--"}
            </div>
          </div>

          <div>
            <div className="text-xs text-muted-foreground">Average</div>
            <div className="text-lg font-bold text-foreground">
              {avgMonthlyPnl !== null ? fmtMoney(avgMonthlyPnl, currency) : "-"}
            </div>
            <div className="text-[11px] text-muted-foreground">per Month</div>
          </div>
        </div>

        <button type="button" className="text-muted-foreground/60 hover:text-foreground">
          <MoreHorizontal className="h-5 w-5" />
        </button>
      </div>

      <div className="border-b border-border/40 pb-2 mb-2" />

      {/* 2-Column Stats Table */}
      <div className="grid grid-cols-1 md:grid-cols-2 md:gap-x-12">
        {/* Left Column */}
        <div className="divide-y divide-border/20 text-xs">
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Total P&L</span>
            <span className={`font-semibold tabular-nums ${left.totalPnl > 0 ? "text-emerald-400" : left.totalPnl < 0 ? "text-rose-400" : ""}`}>
              {fmtMoney(left.totalPnl, currency)}
            </span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Average daily volume</span>
            <span className="font-semibold tabular-nums">{left.avgDailyVolume.toFixed(2)}</span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Average winning trade</span>
            <span className="font-semibold tabular-nums">{fmtMoney(left.avgWinningTrade, currency)}</span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Average losing trade</span>
            <span className="font-semibold tabular-nums">{fmtMoney(left.avgLosingTrade, currency)}</span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Total number of trades</span>
            <span className="font-semibold tabular-nums">{left.totalTrades}</span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Number of winning trades</span>
            <span className="font-semibold tabular-nums">{left.winningTrades}</span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Number of losing trades</span>
            <span className="font-semibold tabular-nums">{left.losingTrades}</span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Number of break even trades</span>
            <span className="font-semibold tabular-nums">{left.beTrades}</span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Max consecutive wins</span>
            <span className="font-semibold tabular-nums">{left.maxConsecWins}</span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Max consecutive losses</span>
            <span className="font-semibold tabular-nums">{left.maxConsecLosses}</span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Total commissions</span>
            <span className="font-semibold tabular-nums">{fmtMoney(left.totalCommissions, currency)}</span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Total fees</span>
            <span className="font-semibold tabular-nums">{fmtMoney(left.totalFees, currency)}</span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Total swap</span>
            <span className="font-semibold tabular-nums">{fmtMoney(left.totalSwap, currency)}</span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Largest profit</span>
            <span className="font-semibold tabular-nums">{fmtMoney(left.largestProfit, currency)}</span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Largest loss</span>
            <span className="font-semibold tabular-nums">{fmtMoney(left.largestLoss, currency)}</span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Average hold time (All trades)</span>
            <span className="font-semibold">{fmtHoldTime(left.avgHoldTimeAll)}</span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Average hold time (Winning trades)</span>
            <span className="font-semibold">{fmtHoldTime(left.avgHoldTimeWin)}</span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Average hold time (Losing trades)</span>
            <span className="font-semibold">{fmtHoldTime(left.avgHoldTimeLoss)}</span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Average hold time (Scratch trades)</span>
            <span className="font-semibold">{fmtHoldTime(left.avgHoldTimeScratch)}</span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Average trade P&L</span>
            <span className="font-semibold tabular-nums">{fmtMoney(left.avgTradePnl, currency)}</span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Profit factor</span>
            <span className="font-semibold tabular-nums">
              {left.profitFactor >= 999 ? "∞" : left.profitFactor.toFixed(2)}
            </span>
          </div>
        </div>

        {/* Right Column */}
        <div className="divide-y divide-border/20 text-xs">
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Open trades</span>
            <span className="font-semibold tabular-nums">{right.openTrades}</span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Total trading days</span>
            <span className="font-semibold tabular-nums">{right.totalTradingDays}</span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Winning days</span>
            <span className="font-semibold tabular-nums">{right.winningDays}</span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Losing days</span>
            <span className="font-semibold tabular-nums">{right.losingDays}</span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Breakeven days</span>
            <span className="font-semibold tabular-nums">{right.beDays}</span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Logged days</span>
            <span className="font-semibold tabular-nums">{right.loggedDays}</span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Max consecutive winning days</span>
            <span className="font-semibold tabular-nums">{right.maxConsecWinDays}</span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Max consecutive losing days</span>
            <span className="font-semibold tabular-nums">{right.maxConsecLossDays}</span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Average daily P&L</span>
            <span className="font-semibold tabular-nums">{fmtMoney(right.avgDailyPnl, currency)}</span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Average winning day P&L</span>
            <span className="font-semibold tabular-nums">{fmtMoney(right.avgWinningDayPnl, currency)}</span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Average losing day P&L</span>
            <span className="font-semibold tabular-nums">{fmtMoney(right.avgLosingDayPnl, currency)}</span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Largest profitable day (Profits)</span>
            <span className="font-semibold tabular-nums">{fmtMoney(right.largestProfitableDay, currency)}</span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Largest losing day (Losses)</span>
            <span className="font-semibold tabular-nums">{fmtMoney(right.largestLosingDay, currency)}</span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Average planned R-Multiple</span>
            <span className="font-semibold tabular-nums">
              {right.avgPlannedR !== null ? `${right.avgPlannedR.toFixed(2)}R` : "-"}
            </span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Average realized R-Multiple</span>
            <span className="font-semibold tabular-nums">
              {right.avgRealizedR !== null ? `${right.avgRealizedR.toFixed(2)}R` : "-"}
            </span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Trade expectancy</span>
            <span className="font-semibold tabular-nums">{fmtMoney(right.tradeExpectancy, currency)}</span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Max drawdown</span>
            <span className="font-semibold tabular-nums">{fmtMoney(right.maxDrawdown, currency)}</span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Max drawdown, %</span>
            <span className="font-semibold tabular-nums">{right.maxDrawdownPct.toFixed(2)}%</span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Average drawdown</span>
            <span className="font-semibold tabular-nums">{fmtMoney(right.avgDrawdown, currency)}</span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Average drawdown, %</span>
            <span className="font-semibold tabular-nums">{right.avgDrawdownPct.toFixed(2)}%</span>
          </div>
        </div>
      </div>
    </div>
  );
}
