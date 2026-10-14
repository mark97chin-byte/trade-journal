"use client";

import React, { useState } from "react";
import { TrendingUp, TrendingDown, Zap, Trophy, Settings } from "lucide-react";
import { ReportMetricChart } from "./report-metric-chart";

interface SummaryRow {
  label: string;
  trades: any[];
  stats: {
    tradesCount: number;
    netPnl: number;
    winRate: number;
    avgVolume: number;
    avgWin: number;
    avgLoss: number;
  };
}

interface DimensionData {
  rows: SummaryRow[];
  highlights: {
    best: { label: string; count: number; pnl: number };
    least: { label: string; count: number; pnl: number };
    mostActive: { label: string; count: number };
    bestWinRate: { label: string; winRate: number; count: number };
  };
  cross: {
    columns: string[];
    rows: {
      rowLabel: string;
      cells: Record<string, { netPnl: number; trades: number; winRate: number }>;
    }[];
  };
}

function fmtMoney(val: number): string {
  if (isNaN(val)) return "$0";
  const abs = Math.abs(val);
  const sign = val < 0 ? "-$" : val > 0 ? "+$" : "$";
  return `${sign}${abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function ReportDimensionView({
  title,
  unitLabel,
  data,
  currency = "USD",
}: {
  title: string;
  unitLabel: string;
  data: DimensionData;
  currency?: string;
}) {
  const { rows, highlights, cross } = data;
  const [crossMetric, setCrossMetric] = useState<"pnl" | "winrate" | "trades">("pnl");

  // Custom buckets for the dual charts
  const chartBuckets = rows.map((r) => ({ label: r.label, trades: r.trades }));

  return (
    <div className="space-y-6">
      {/* 1. TOP 4 HIGHLIGHT CARDS */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* Best Performing */}
        <div className="rounded-xl border border-border/50 bg-[#161822] p-4 shadow-sm">
          <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-medium">
            <TrendingUp className="h-4 w-4" />
            <span>Best performing {unitLabel}</span>
          </div>
          <div className="mt-2 text-xl font-bold text-foreground">{highlights.best.label}</div>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <span>{highlights.best.count} trades</span>
            <span className="font-semibold text-emerald-400">
              {highlights.best.pnl !== 0 ? fmtMoney(highlights.best.pnl) : "$0"}
            </span>
          </div>
        </div>

        {/* Least Performing */}
        <div className="rounded-xl border border-border/50 bg-[#161822] p-4 shadow-sm">
          <div className="flex items-center gap-1.5 text-xs text-rose-400 font-medium">
            <TrendingDown className="h-4 w-4" />
            <span>Least performing {unitLabel}</span>
          </div>
          <div className="mt-2 text-xl font-bold text-foreground">{highlights.least.label}</div>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <span>{highlights.least.count} trades</span>
            <span className="font-semibold text-rose-400">
              {highlights.least.pnl !== 0 ? fmtMoney(highlights.least.pnl) : "$0"}
            </span>
          </div>
        </div>

        {/* Most Active */}
        <div className="rounded-xl border border-border/50 bg-[#161822] p-4 shadow-sm">
          <div className="flex items-center gap-1.5 text-xs text-amber-400 font-medium">
            <Zap className="h-4 w-4" />
            <span>Most active {unitLabel}</span>
          </div>
          <div className="mt-2 text-xl font-bold text-foreground">{highlights.mostActive.label}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {highlights.mostActive.count} trades
          </div>
        </div>

        {/* Best Win Rate */}
        <div className="rounded-xl border border-border/50 bg-[#161822] p-4 shadow-sm">
          <div className="flex items-center gap-1.5 text-xs text-indigo-400 font-medium">
            <Trophy className="h-4 w-4" />
            <span>Best win rate</span>
          </div>
          <div className="mt-2 text-xl font-bold text-foreground">{highlights.bestWinRate.label}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {highlights.bestWinRate.winRate.toFixed(0)}% / {highlights.bestWinRate.count} trades
          </div>
        </div>
      </div>

      {/* 2. DUAL CHARTS SIDE BY SIDE */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ReportMetricChart
          customBuckets={chartBuckets}
          defaultMetrics={[
            { key: "netPnl", chartType: "area", color: "#ef4444" },
            { key: "tradeCount", chartType: "line", color: "#3b82f6" },
          ]}
        />
        <ReportMetricChart
          customBuckets={chartBuckets}
          defaultMetrics={[{ key: "winRate", chartType: "bar", color: "#10b981" }]}
        />
      </div>

      {/* 3. SUMMARY TABLE */}
      <div className="rounded-xl border border-border/50 bg-[#12141a] p-4 shadow-sm">
        <div className="flex items-center justify-between pb-3">
          <h3 className="text-sm font-semibold text-foreground">Summary</h3>
          <button type="button" className="text-muted-foreground hover:text-foreground">
            <Settings className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-border/40 text-muted-foreground">
              <tr>
                <th className="py-2.5 font-medium">{title}</th>
                <th className="py-2.5 text-right font-medium">Win %</th>
                <th className="py-2.5 text-right font-medium">Net P&L</th>
                <th className="py-2.5 text-right font-medium">Trade count</th>
                <th className="py-2.5 text-right font-medium">Avg daily volume</th>
                <th className="py-2.5 text-right font-medium">Avg win</th>
                <th className="py-2.5 text-right font-medium">Avg loss</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/20">
              {rows.map((r) => {
                const s = r.stats;
                return (
                  <tr key={r.label} className="hover:bg-secondary/20 transition-colors">
                    <td className="py-2.5 font-medium text-foreground">{r.label}</td>
                    <td className="py-2.5 text-right tabular-nums">
                      {s.tradesCount > 0 ? `${s.winRate % 1 === 0 ? s.winRate.toFixed(0) : s.winRate.toFixed(1)}%` : "0%"}
                    </td>
                    <td
                      className={`py-2.5 text-right font-semibold tabular-nums ${
                        s.netPnl > 0 ? "text-emerald-400" : s.netPnl < 0 ? "text-rose-400" : "text-muted-foreground"
                      }`}
                    >
                      {fmtMoney(s.netPnl)}
                    </td>
                    <td className="py-2.5 text-right tabular-nums text-foreground">{s.tradesCount}</td>
                    <td className="py-2.5 text-right tabular-nums text-muted-foreground">{s.avgVolume.toFixed(2)}</td>
                    <td className="py-2.5 text-right tabular-nums text-emerald-400 font-medium">
                      {s.avgWin > 0 ? fmtMoney(s.avgWin) : "$0"}
                    </td>
                    <td className="py-2.5 text-right tabular-nums text-rose-400 font-medium">
                      {s.avgLoss < 0 ? fmtMoney(s.avgLoss) : "$0"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 4. CROSS ANALYSIS MATRIX */}
      {cross && cross.columns.length > 0 && (
        <div className="rounded-xl border border-border/50 bg-[#12141a] p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
            <h3 className="text-sm font-semibold text-foreground">Cross analysis</h3>

            {/* Metric Mode Switcher */}
            <div className="flex items-center rounded-lg border border-border/50 bg-[#161822] p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setCrossMetric("winrate")}
                className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-all ${
                  crossMetric === "winrate"
                    ? "bg-[#4f46e5] text-white shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Win rate
              </button>
              <button
                type="button"
                onClick={() => setCrossMetric("pnl")}
                className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-all ${
                  crossMetric === "pnl"
                    ? "bg-[#4f46e5] text-white shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                P&L
              </button>
              <button
                type="button"
                onClick={() => setCrossMetric("trades")}
                className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-all ${
                  crossMetric === "trades"
                    ? "bg-[#4f46e5] text-white shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Trades
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-center text-xs">
              <thead className="border-b border-border/40 text-muted-foreground">
                <tr>
                  <th className="py-2.5 text-left font-medium"></th>
                  {cross.columns.map((c) => (
                    <th key={c} className="py-2.5 px-3 font-medium uppercase tracking-wider text-[11px]">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/20">
                {cross.rows.map((r) => (
                  <tr key={r.rowLabel} className="hover:bg-secondary/10">
                    <td className="py-2.5 text-left font-medium text-foreground whitespace-nowrap pr-4">
                      {r.rowLabel}
                    </td>
                    {cross.columns.map((c) => {
                      const cell = r.cells[c] ?? { netPnl: 0, trades: 0, winRate: 0 };
                      const hasTrades = cell.trades > 0;

                      let cellBg = "";
                      if (hasTrades) {
                        if (crossMetric === "pnl") {
                          cellBg =
                            cell.netPnl > 0
                              ? "bg-emerald-500/25 text-emerald-300 font-semibold"
                              : cell.netPnl < 0
                              ? "bg-rose-500/25 text-rose-300 font-semibold"
                              : "text-muted-foreground";
                        } else if (crossMetric === "winrate") {
                          cellBg =
                            cell.winRate >= 50
                              ? "bg-emerald-500/25 text-emerald-300 font-semibold"
                              : "bg-rose-500/25 text-rose-300 font-semibold";
                        } else {
                          cellBg = "bg-indigo-500/20 text-indigo-300 font-semibold";
                        }
                      } else {
                        cellBg = "text-muted-foreground/60";
                      }

                      return (
                        <td key={c} className={`py-2 px-3 tabular-nums border border-border/10 ${cellBg}`}>
                          {crossMetric === "pnl" && (hasTrades ? fmtMoney(cell.netPnl) : "$0")}
                          {crossMetric === "winrate" && (hasTrades ? `${cell.winRate.toFixed(0)}%` : "0%")}
                          {crossMetric === "trades" && cell.trades}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
