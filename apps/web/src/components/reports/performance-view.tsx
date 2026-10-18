"use client";

import React, { useState } from "react";
import Link from "next/link";
import { ReportMetricChart } from "./report-metric-chart";
import { Settings, ExternalLink, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface PerformanceData {
  summary: {
    netPnl: number;
    winRate: number;
    avgDailyWinPct: number;
    dailyRecord: { wins: number; bes: number; losses: number };
    profitFactor: number;
    tradeExpectancy: number;
    avgDailyWinLoss: number;
    avgTradeWinLoss: number;
    avgHoldTimeMs: number;
    avgNetTradePnl: number;
    avgDailyNetPnl: number;
    avgPlannedR: number | null;
    avgRealizedR: number | null;
    avgDailyVolume: number;
    loggedDays: number;
    maxDailyNetDrawdown: number;
    avgDailyNetDrawdown: number;
  };
  days: {
    avgDailyWinPct: number;
    dailyRecord: { wins: number; bes: number; losses: number };
    largestLosingDay: number;
    largestLosingDayDate?: string;
    avgDailyWinLoss: number;
    avgTradingDaysDurationMs: number;
    largestProfitableDay: number;
    largestProfitableDayDate?: string;
    avgDailyNetPnl: number;
    winRate: number;
  };
  trades: {
    winRate: number;
    longsWinPct: number;
    avgNetTradePnl: number;
    avgTradeWinLoss: number;
    tradeExpectancy: number;
    avgTradingDaysDurationMs: number;
    largestProfitableTrade: number;
    largestProfitableTradeId?: string | null;
    largestLosingTrade: number;
    largestLosingTradeId?: string | null;
    longestTradeDurationMs: number;
    shortsWinPct: number;
  };
}

function fmtMoney(val: number | null | undefined): string {
  if (val === null || val === undefined || isNaN(val)) return "$0";
  const abs = Math.abs(val);
  const sign = val < 0 ? "-$" : "$";
  return `${sign}${abs.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function fmtDuration(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return "0m";
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function MetricItem({
  label,
  value,
  hint,
  valueClass = "text-foreground",
  href,
}: {
  label: string;
  value: React.ReactNode;
  hint: string;
  valueClass?: string;
  href?: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <span>{label}</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" className="text-muted-foreground/70 hover:text-foreground">
              <Info className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{hint}</TooltipContent>
        </Tooltip>
      </div>
      <div className="flex items-center gap-1.5 text-base sm:text-lg font-bold tracking-tight">
        {href ? (
          <Link
            href={href}
            className={`group inline-flex items-center gap-1.5 transition-colors hover:underline ${valueClass}`}
            title="View details"
          >
            <span>{value}</span>
            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground opacity-80 group-hover:opacity-100" />
          </Link>
        ) : (
          <span className={valueClass}>{value}</span>
        )}
      </div>
    </div>
  );
}

export function PerformanceView({
  trades = [],
  performance,
}: {
  trades: any[];
  performance?: PerformanceData;
  currency?: string;
}) {
  const [activeTab, setActiveTab] = useState<"summary" | "days" | "trades">("summary");

  const s = performance?.summary;
  const d = performance?.days;
  const t = performance?.trades;

  return (
    <div className="space-y-6">
      {/* 1. TOP TABBED CARD */}
      <div className="rounded-xl border border-border/50 bg-card p-5 shadow-sm">
        <div className="flex items-center justify-between border-b border-border/30 pb-3">
          <div className="flex items-center gap-6">
            {(["summary", "days", "trades"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`relative pb-2 text-xs font-semibold capitalize transition-colors ${
                  activeTab === tab
                    ? "text-muted-foreground after:absolute after:bottom-[-13px] after:left-0 after:right-0 after:h-0.5 after:bg-secondary text-foreground border border-border font-semibold shadow-2xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          <button type="button" className="text-muted-foreground hover:text-foreground">
            <Settings className="h-4 w-4" />
          </button>
        </div>

        {/* SUB-VIEW 1: SUMMARY */}
        {activeTab === "summary" && s && (
          <div className="grid grid-cols-1 gap-6 pt-5 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-4">
              <MetricItem
                label="Net P&L"
                value={fmtMoney(s.netPnl)}
                valueClass={s.netPnl < 0 ? "text-rose-400" : s.netPnl > 0 ? "text-profit" : ""}
                hint="Total net profits or losses realized across all closed trades."
              />
              <MetricItem
                label="Win %"
                value={`${s.winRate.toFixed(2)}%`}
                hint="Percentage of trades that closed positive."
              />
              <MetricItem
                label="Avg daily win %"
                value={`${s.avgDailyWinPct.toFixed(0)}% (${s.dailyRecord.wins}/${s.dailyRecord.bes}/${s.dailyRecord.losses})`}
                hint="Percentage of profitable trading days (Wins / Breakeven / Losses)."
              />
              <MetricItem
                label="Profit factor"
                value={s.profitFactor.toFixed(2)}
                hint="Gross profit divided by gross loss."
              />
            </div>

            <div className="space-y-4">
              <MetricItem
                label="Trade expectancy"
                value={fmtMoney(s.tradeExpectancy)}
                valueClass={s.tradeExpectancy < 0 ? "text-rose-400" : "text-profit"}
                hint="Average expected return per trade."
              />
              <MetricItem
                label="Avg daily win/loss"
                value={s.avgDailyWinLoss.toFixed(2)}
                hint="Ratio of average winning day return to average losing day return."
              />
              <MetricItem
                label="Avg trade win/loss"
                value={s.avgTradeWinLoss.toFixed(2)}
                hint="Ratio of average winning trade return to average losing trade return."
              />
              <MetricItem
                label="Avg hold time"
                value={fmtDuration(s.avgHoldTimeMs)}
                hint="Average time spent in active positions."
              />
            </div>

            <div className="space-y-4">
              <MetricItem
                label="Avg net trade P&L"
                value={fmtMoney(s.avgNetTradePnl)}
                valueClass={s.avgNetTradePnl < 0 ? "text-rose-400" : "text-profit"}
                hint="Average net P&L across all closed trades."
              />
              <MetricItem
                label="Avg daily net P&L"
                value={fmtMoney(s.avgDailyNetPnl)}
                valueClass={s.avgDailyNetPnl < 0 ? "text-rose-400" : "text-profit"}
                hint="Average net P&L across all trading days."
              />
              <MetricItem
                label="Avg. planned r-multiple"
                value={s.avgPlannedR !== null ? `${s.avgPlannedR.toFixed(2)}R` : "-"}
                hint="Average initial risk-to-reward planned."
              />
              <MetricItem
                label="Avg. realized r-multiple"
                value={s.avgRealizedR !== null ? `${s.avgRealizedR.toFixed(2)}R` : "-"}
                hint="Average risk-to-reward realized."
              />
            </div>

            <div className="space-y-4">
              <MetricItem
                label="Avg daily volume"
                value={s.avgDailyVolume.toFixed(2)}
                hint="Average position volume entered per trading day."
              />
              <MetricItem
                label="Logged days"
                value={s.loggedDays}
                hint="Count of active trading days with journal entries."
              />
              <MetricItem
                label="Max daily net drawdown"
                value={fmtMoney(s.maxDailyNetDrawdown)}
                valueClass="text-rose-400"
                hint="Maximum daily net loss experienced in this period."
              />
              <MetricItem
                label="Avg daily net drawdown"
                value={fmtMoney(s.avgDailyNetDrawdown)}
                valueClass="text-rose-400"
                hint="Average daily net drawdown depth."
              />
            </div>
          </div>
        )}

        {/* SUB-VIEW 2: DAYS */}
        {activeTab === "days" && d && (
          <div className="grid grid-cols-1 gap-6 pt-5 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-4">
              <MetricItem
                label="Avg daily win %"
                value={`${d.avgDailyWinPct.toFixed(0)}% (${d.dailyRecord.wins}/${d.dailyRecord.bes}/${d.dailyRecord.losses})`}
                hint="Percentage of winning trading days."
              />
              <MetricItem
                label="Largest losing day"
                value={fmtMoney(d.largestLosingDay)}
                valueClass="text-rose-400"
                href={d.largestLosingDayDate ? `/journal/${d.largestLosingDayDate}` : undefined}
                hint="The biggest single-day loss recorded. Click to open daily journal."
              />
            </div>

            <div className="space-y-4">
              <MetricItem
                label="Avg daily win/loss"
                value={d.avgDailyWinLoss.toFixed(2)}
                hint="Average daily winning return divided by average daily loss return."
              />
              <MetricItem
                label="Average trading days duration"
                value={fmtDuration(d.avgTradingDaysDurationMs)}
                hint="Average time from the first trade opened to the last trade closed in a day."
              />
            </div>

            <div className="space-y-4">
              <MetricItem
                label="Largest profitable day"
                value={fmtMoney(d.largestProfitableDay)}
                valueClass="text-profit"
                href={d.largestProfitableDayDate ? `/journal/${d.largestProfitableDayDate}` : undefined}
                hint="The biggest single-day profit recorded. Click to open daily journal."
              />
            </div>

            <div className="space-y-4">
              <MetricItem
                label="Avg daily net P&L"
                value={fmtMoney(d.avgDailyNetPnl)}
                valueClass={d.avgDailyNetPnl < 0 ? "text-rose-400" : "text-profit"}
                hint="Average net P&L per active day."
              />
            </div>
          </div>
        )}

        {/* SUB-VIEW 3: TRADES */}
        {activeTab === "trades" && t && (
          <div className="grid grid-cols-1 gap-6 pt-5 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-4">
              <MetricItem
                label="Win %"
                value={`${t.winRate.toFixed(2)}%`}
                hint="Overall trade win percentage."
              />
              <MetricItem
                label="Longs win %"
                value={`${t.longsWinPct.toFixed(0)}%`}
                hint="Win percentage for long positions."
              />
              <MetricItem
                label="Avg net trade P&L"
                value={fmtMoney(t.avgNetTradePnl)}
                valueClass={t.avgNetTradePnl < 0 ? "text-rose-400" : "text-profit"}
                hint="Average net return per trade."
              />
            </div>

            <div className="space-y-4">
              <MetricItem
                label="Avg trade win/loss"
                value={t.avgTradeWinLoss.toFixed(2)}
                hint="Ratio of average win to average loss."
              />
              <MetricItem
                label="Trade expectancy"
                value={fmtMoney(t.tradeExpectancy)}
                valueClass={t.tradeExpectancy < 0 ? "text-rose-400" : "text-profit"}
                hint="Expected dollar gain or loss per trade."
              />
              <MetricItem
                label="Average trading days duration"
                value={fmtDuration(t.avgTradingDaysDurationMs)}
                hint="Average trading session duration."
              />
            </div>

            <div className="space-y-4">
              <MetricItem
                label="Largest profitable trade"
                value={fmtMoney(t.largestProfitableTrade)}
                valueClass="text-profit"
                href={t.largestProfitableTradeId ? `/trades?id=${t.largestProfitableTradeId}` : undefined}
                hint="The single most profitable trade. Click to view trade."
              />
              <MetricItem
                label="Largest losing trade"
                value={fmtMoney(t.largestLosingTrade)}
                valueClass="text-rose-400"
                href={t.largestLosingTradeId ? `/trades?id=${t.largestLosingTradeId}` : undefined}
                hint="The single largest losing trade. Click to view trade."
              />
            </div>

            <div className="space-y-4">
              <MetricItem
                label="Longest trade duration"
                value={fmtDuration(t.longestTradeDurationMs)}
                hint="The longest time spent in a single trade."
              />
              <MetricItem
                label="Shorts win %"
                value={`${t.shortsWinPct.toFixed(2)}%`}
                hint="Win percentage for short positions."
              />
            </div>
          </div>
        )}
      </div>

      {/* 2. STACKED TIMEFRAME CHARTS */}
      <div className="space-y-4">
        <ReportMetricChart
          trades={trades}
          enableTimeframeControl={true}
          initialTimeframe="day"
          defaultMetrics={[
            { key: "avgHoldTimeCumulative", chartType: "line", color: "#3b82f6" },
          ]}
        />

        <ReportMetricChart
          trades={trades}
          enableTimeframeControl={true}
          initialTimeframe="week"
          defaultMetrics={[
            { key: "avgTradingWeeksDuration", chartType: "bar", color: "var(--profit)" },
          ]}
        />
      </div>
    </div>
  );
}
