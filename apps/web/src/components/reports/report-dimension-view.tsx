"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import {
  TrendingUp,
  TrendingDown,
  Zap,
  Trophy,
  Settings,
  Tag as TagIcon,
  ChevronDown,
  ChevronRight,
  ExternalLink,
} from "lucide-react";
import { ReportMetricChart } from "./report-metric-chart";

interface SummaryRow {
  id?: string;
  label: string;
  categoryName?: string;
  categoryColor?: string;
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
      rowId?: string;
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

function fmtDateShort(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso).slice(0, 10);
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function ReportDimensionView({
  title,
  unitLabel,
  data,
  currency = "USD",
  extraSection,
}: {
  title: string;
  unitLabel: string;
  data: DimensionData;
  currency?: string;
  extraSection?: React.ReactNode;
}) {
  const router = useRouter();
  const { rows, highlights, cross } = data;
  const [crossMetric, setCrossMetric] = useState<"pnl" | "winrate" | "trades">("pnl");
  const [expandedRowKey, setExpandedRowKey] = useState<string | null>(null);

  const chartBuckets = rows.map((r, idx) => ({
    label: rows.filter((x) => x.label === r.label).length > 1 ? `${r.label} (#${idx + 1})` : r.label,
    trades: r.trades,
  }));
  const showCategoryCol = rows.some((r) => Boolean(r.categoryName));
  const totalCols = showCategoryCol ? 8 : 7;

  return (
    <div className="space-y-6">
      {/* 1. TOP 4 HIGHLIGHT CARDS */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-border/50 bg-slate-50 dark:bg-card p-4 shadow-sm">
          <div className="flex items-center gap-1.5 text-xs text-profit font-semibold">
            <TrendingUp className="h-4 w-4" />
            <span>Best performing {unitLabel}</span>
          </div>
          <div className="mt-2 text-xl font-bold text-foreground truncate">{highlights.best.label}</div>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <span>{highlights.best.count} trades</span>
            <span className="font-semibold text-profit">
              {highlights.best.pnl !== 0 ? fmtMoney(highlights.best.pnl) : "$0"}
            </span>
          </div>
        </div>

        <div className="rounded-xl border border-border/50 bg-slate-50 dark:bg-card p-4 shadow-sm">
          <div className="flex items-center gap-1.5 text-xs text-loss font-semibold">
            <TrendingDown className="h-4 w-4" />
            <span>Least performing {unitLabel}</span>
          </div>
          <div className="mt-2 text-xl font-bold text-foreground truncate">{highlights.least.label}</div>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <span>{highlights.least.count} trades</span>
            <span className="font-semibold text-loss">
              {highlights.least.pnl !== 0 ? fmtMoney(highlights.least.pnl) : "$0"}
            </span>
          </div>
        </div>

        <div className="rounded-xl border border-border/50 bg-slate-50 dark:bg-card p-4 shadow-sm">
          <div className="flex items-center gap-1.5 text-xs text-amber-400 font-medium">
            <Zap className="h-4 w-4" />
            <span>Most active {unitLabel}</span>
          </div>
          <div className="mt-2 text-xl font-bold text-foreground truncate">{highlights.mostActive.label}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {highlights.mostActive.count} trades
          </div>
        </div>

        <div className="rounded-xl border border-border/50 bg-slate-50 dark:bg-card p-4 shadow-sm">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
            <Trophy className="h-4 w-4" />
            <span>Best win rate</span>
          </div>
          <div className="mt-2 text-xl font-bold text-foreground truncate">{highlights.bestWinRate.label}</div>
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
          defaultMetrics={[{ key: "winRate", chartType: "bar", color: "var(--profit)" }]}
        />
      </div>

      {/* OPTIONAL EXTRA SECTION (e.g., Strategy Rules Winrate Analyzer) */}
      {extraSection}

      {/* 3. SUMMARY TABLE (CLICKABLE ROWS TO EXPAND TRADE DRILL-DOWN) */}
      <div className="rounded-xl border border-border/50 bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Summary</h3>
            <p className="text-[11px] text-muted-foreground">
              Click any {unitLabel} row below to inspect and open the individual trades.
            </p>
          </div>
          <button type="button" className="text-muted-foreground hover:text-foreground">
            <Settings className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 dark:border-border/40 text-muted-foreground">
              <tr>
                <th className="py-2.5 font-medium">{title}</th>
                {showCategoryCol && <th className="py-2.5 font-medium">Category</th>}
                <th className="py-2.5 text-right font-medium">Win %</th>
                <th className="py-2.5 text-right font-medium">Net P&amp;L</th>
                <th className="py-2.5 text-right font-medium">Trade count</th>
                <th className="py-2.5 text-right font-medium">Avg daily volume</th>
                <th className="py-2.5 text-right font-medium">Avg win</th>
                <th className="py-2.5 text-right font-medium">Avg loss</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/20">
              {rows.map((r, idx) => {
                const s = r.stats;
                const rowKey = r.id ? `${r.id}-${idx}` : `${r.label}-${idx}`;
                const isExpanded = expandedRowKey === rowKey;

                return (
                  <React.Fragment key={rowKey}>
                    <tr
                      onClick={() =>
                        setExpandedRowKey((prev) => (prev === rowKey ? null : rowKey))
                      }
                      className={`cursor-pointer transition-colors ${
                        isExpanded
                          ? "bg-secondary/40 font-semibold"
                          : "hover:bg-secondary/20"
                      }`}
                    >
                      <td className="py-2.5 font-medium text-foreground">
                        <div className="flex items-center gap-2">
                          {isExpanded ? (
                            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          )}
                          {r.categoryColor && !showCategoryCol && (
                            <span
                              className="h-2.5 w-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: r.categoryColor }}
                            />
                          )}
                          <span>{r.label}</span>
                        </div>
                      </td>
                      {showCategoryCol && (
                        <td className="py-2.5">
                          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                            <TagIcon
                              className="h-3 w-3"
                              style={{
                                color: r.categoryColor ?? "#94a3b8",
                                fill: r.categoryColor ?? "#94a3b8",
                              }}
                            />
                            <span>{r.categoryName}</span>
                          </span>
                        </td>
                      )}
                      <td className="py-2.5 text-right tabular-nums">
                        {s.tradesCount > 0
                          ? `${s.winRate % 1 === 0 ? s.winRate.toFixed(0) : s.winRate.toFixed(1)}%`
                          : "0%"}
                      </td>
                      <td
                        className={`py-2.5 text-right font-semibold tabular-nums ${
                          s.netPnl > 0
                            ? "text-profit"
                            : s.netPnl < 0
                            ? "text-loss"
                            : "text-muted-foreground"
                        }`}
                      >
                        {fmtMoney(s.netPnl)}
                      </td>
                      <td className="py-2.5 text-right tabular-nums text-foreground">
                        <span className="inline-flex items-center gap-1">
                          <span>{s.tradesCount}</span>
                        </span>
                      </td>
                      <td className="py-2.5 text-right tabular-nums text-muted-foreground">
                        {s.avgVolume.toFixed(2)}
                      </td>
                      <td className="py-2.5 text-right tabular-nums text-profit font-medium">
                        {s.avgWin > 0 ? fmtMoney(s.avgWin) : "$0"}
                      </td>
                      <td className="py-2.5 text-right tabular-nums text-loss font-medium">
                        {s.avgLoss < 0 ? fmtMoney(s.avgLoss) : "$0"}
                      </td>
                    </tr>

                    {/* INLINE EXPANDED DRILL-DOWN OF MATCHED TRADES */}
                    {isExpanded && (
                      <tr>
                        <td colSpan={totalCols} className="bg-[#0d0f14]/90 p-3">
                          <div className="rounded-xl border border-border/60 bg-card p-3 space-y-2">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-bold text-foreground">
                                Trades tagged with &ldquo;{r.label}&rdquo; ({r.trades.length})
                              </span>
                              <button
                                type="button"
                                onClick={() => setExpandedRowKey(null)}
                                className="text-[11px] text-muted-foreground hover:text-foreground"
                              >
                                Close ✕
                              </button>
                            </div>

                            {r.trades.length === 0 ? (
                              <div className="py-4 text-center text-xs text-muted-foreground">
                                No trades recorded for {r.label} in the selected date range.
                              </div>
                            ) : (
                              <div className="overflow-x-auto">
                                <table className="w-full text-left text-xs">
                                  <thead className="border-b border-border/40 text-muted-foreground">
                                    <tr>
                                      <th className="py-2 pl-2">Type</th>
                                      <th className="py-2">Date</th>
                                      <th className="py-2">Symbol</th>
                                      <th className="py-2">Direction</th>
                                      <th className="py-2">Outcome</th>
                                      <th className="py-2 text-right">Realized R</th>
                                      <th className="py-2 text-right">MFE / MAE</th>
                                      <th className="py-2 text-right">Net P&amp;L</th>
                                      <th className="py-2 pr-2 text-right">Action</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-border/20">
                                    {r.trades.map((t: any, tIdx: number) => {
                                      const isMissed = Boolean(t.isMissed);
                                      const tKey = String(t.key ?? t.id ?? tIdx);
                                      const href = isMissed
                                        ? `/missed/${encodeURIComponent(tKey)}`
                                        : `/trades/${encodeURIComponent(tKey)}`;
                                      const net = Number(t.netPnl ?? t.pnl ?? 0);
                                      const rMult =
                                        typeof t.realizedR === "number" ? t.realizedR : null;
                                      const mfe = typeof t.mfeR === "number" ? t.mfeR : null;
                                      const mae = typeof t.maeR === "number" ? t.maeR : null;
                                      const statusUpper = String(t.status || "").toUpperCase();

                                      return (
                                        <tr
                                          key={`${tKey}-${tIdx}`}
                                          onClick={() => router.push(href)}
                                          className="cursor-pointer hover:bg-secondary/30 transition-colors"
                                        >
                                          <td className="py-2 pl-2">
                                            <span
                                              className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                                                isMissed
                                                  ? "bg-amber-500/20 text-amber-300"
                                                  : "bg-indigo-500/20 text-indigo-300"
                                              }`}
                                            >
                                              {isMissed ? "MISSED" : "EXECUTED"}
                                            </span>
                                          </td>
                                          <td className="py-2 font-mono text-muted-foreground">
                                            {fmtDateShort(t.openedAt ?? t.closedAt)}
                                          </td>
                                          <td className="py-2 font-mono font-bold text-foreground">
                                            {t.symbol}
                                          </td>
                                          <td className="py-2">
                                            <span
                                              className={`uppercase font-semibold ${
                                                String(t.direction).toLowerCase() === "short"
                                                  ? "text-rose-400"
                                                  : "text-emerald-400"
                                              }`}
                                            >
                                              {t.direction}
                                            </span>
                                          </td>
                                          <td className="py-2">
                                            <span
                                              className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                                                statusUpper === "WIN" || net > 0
                                                  ? "bg-emerald-500/15 text-emerald-400"
                                                  : statusUpper === "LOSS" || net < 0
                                                  ? "bg-rose-500/15 text-rose-400"
                                                  : "bg-secondary text-muted-foreground"
                                              }`}
                                            >
                                              {statusUpper || (net >= 0 ? "WIN" : "LOSS")}
                                            </span>
                                          </td>
                                          <td
                                            className={`py-2 text-right font-mono font-semibold ${
                                              rMult !== null && rMult >= 0
                                                ? "text-emerald-400"
                                                : rMult !== null
                                                ? "text-rose-400"
                                                : "text-muted-foreground"
                                            }`}
                                          >
                                            {rMult !== null
                                              ? `${rMult > 0 ? "+" : ""}${rMult.toFixed(2)}R`
                                              : "—"}
                                          </td>
                                          <td className="py-2 text-right font-mono text-muted-foreground">
                                            {mfe !== null ? `+${mfe.toFixed(2)}R` : "—"} /{" "}
                                            {mae !== null ? `-${Math.abs(mae).toFixed(2)}R` : "—"}
                                          </td>
                                          <td
                                            className={`py-2 text-right font-mono font-bold ${
                                              net > 0
                                                ? "text-emerald-400"
                                                : net < 0
                                                ? "text-rose-400"
                                                : "text-foreground"
                                            }`}
                                          >
                                            {fmtMoney(net)}
                                          </td>
                                          <td className="py-2 pr-2 text-right">
                                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-400 hover:underline">
                                              <span>Open</span>
                                              <ExternalLink className="h-3 w-3" />
                                            </span>
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 4. CROSS ANALYSIS MATRIX */}
      {cross && cross.columns.length > 0 && (
        <div className="rounded-xl border border-border/50 bg-card p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
            <h3 className="text-sm font-semibold text-foreground">Cross analysis</h3>

            <div className="flex items-center rounded-lg border border-border/50 bg-slate-50 dark:bg-card p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setCrossMetric("winrate")}
                className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-all ${
                  crossMetric === "winrate"
                    ? "bg-secondary text-foreground font-semibold border border-border shadow-sm"
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
                    ? "bg-secondary text-foreground font-semibold border border-border shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                P&amp;L
              </button>
              <button
                type="button"
                onClick={() => setCrossMetric("trades")}
                className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-all ${
                  crossMetric === "trades"
                    ? "bg-secondary text-foreground font-semibold border border-border shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Trades
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-center text-xs">
              <thead className="border-b border-slate-200 dark:border-border/40 text-muted-foreground">
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
                {cross.rows.map((r, rowIdx) => (
                  <tr key={r.rowId ? `${r.rowId}-${rowIdx}` : `${r.rowLabel}-${rowIdx}`} className="hover:bg-secondary/10">
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
                              ? "bg-profit/10 text-profit font-semibold"
                              : cell.netPnl < 0
                              ? "bg-loss/10 text-loss font-semibold"
                              : "text-muted-foreground";
                        } else if (crossMetric === "winrate") {
                          cellBg =
                            cell.winRate >= 50
                              ? "bg-profit/10 text-profit font-semibold"
                              : "bg-loss/10 text-loss font-semibold";
                        } else {
                          cellBg = "bg-secondary text-foreground border border-border font-semibold";
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
