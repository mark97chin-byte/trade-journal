"use client";

import React, { useState, useMemo, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Calendar as CalendarIcon,
  FileText,
  ArrowRight,
  X,
} from "lucide-react";

export interface JournalTrade {
  key: string;
  symbol: string;
  direction: string;
  openedAt: string;
  closedAt?: string | null;
  netPnl: number;
  grossPnl?: number;
  fees?: number;
  quantity: number;
  avgEntry?: number;
  avgExit?: number;
  realizedR?: number | null;
  strategy?: string | null;
  notes?: string | null;
  tags?: string[];
}

export type JournalPeriod = "day" | "week" | "month" | "quarter" | "year";

interface JournalViewProps {
  trades: JournalTrade[];
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

const fmtCompactCurrency = (val: number) => {
  if (val === 0) return "$0";
  const abs = Math.abs(val);
  const sign = val > 0 ? "+" : "-";
  if (abs >= 1000) {
    return `${sign}$${(abs / 1000).toFixed(1)}k`;
  }
  return `${sign}$${Math.round(abs)}`;
};

function getMondayDateStr(dateInput: string | Date): string {
  const d =
    typeof dateInput === "string"
      ? new Date(dateInput)
      : new Date(dateInput.getTime());
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diff));
  return monday.toISOString().slice(0, 10);
}

// Custom hook to cleanly separate single-click from double-click without premature unmount
function useDelayedClick() {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleInteraction = (onSingle: () => void, onDouble: () => void) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
      onDouble();
    } else {
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        onSingle();
      }, 220);
    }
  };

  return handleInteraction;
}

// --- SVG INTRADAY CUMULATIVE P&L CHART ---
function IntradayPnlCurve({ trades }: { trades: JournalTrade[] }) {
  const points = useMemo(() => {
    const sorted = [...trades].sort(
      (a, b) => new Date(a.openedAt).getTime() - new Date(b.openedAt).getTime()
    );
    let running = 0;
    const pts = [{ x: 0, y: 0 }];
    sorted.forEach((t, idx) => {
      running += t.netPnl;
      pts.push({ x: idx + 1, y: running });
    });
    return pts;
  }, [trades]);

  if (points.length <= 1) {
    return (
      <div className="h-24 flex items-center justify-center text-xs text-muted-foreground/50 border border-dashed border-border/40 rounded-lg">
        No intraday trajectory data
      </div>
    );
  }

  const minY = Math.min(0, ...points.map((p) => p.y));
  const maxY = Math.max(0, ...points.map((p) => p.y));
  const rangeY = Math.max(maxY - minY, 10);
  const maxX = points.length - 1;

  const width = 280;
  const height = 84;
  const padTop = 8;
  const padBottom = 12;
  const usableH = height - padTop - padBottom;

  const getY = (val: number) => padTop + usableH - ((val - minY) / rangeY) * usableH;
  const getX = (idx: number) => (idx / maxX) * (width - 10) + 5;

  const zeroY = getY(0);

  const linePath = points
    .map((p, idx) => `${idx === 0 ? "M" : "L"} ${getX(p.x).toFixed(1)} ${getY(p.y).toFixed(1)}`)
    .join(" ");

  const lastPoint = points[points.length - 1]!;
  const isProfit = lastPoint.y >= 0;
  const areaPath = `${linePath} L ${getX(maxX)} ${zeroY} L ${getX(0)} ${zeroY} Z`;

  return (
    <div className="flex flex-col h-full justify-between">
      <div className="flex justify-between items-center text-[10px] text-muted-foreground px-1 pb-1">
        <span>Peak: {fmtCompactCurrency(maxY)}</span>
        <span>Low: {fmtCompactCurrency(minY)}</span>
      </div>
      <div className="relative w-full h-[70px]">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-full overflow-visible"
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id={`grad-${isProfit ? "win" : "loss"}`} x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="0%"
                stopColor={isProfit ? "#10b981" : "#f43f5e"}
                stopOpacity={isProfit ? "0.35" : "0.45"}
              />
              <stop
                offset="100%"
                stopColor={isProfit ? "#10b981" : "#f43f5e"}
                stopOpacity="0.0"
              />
            </linearGradient>
          </defs>

          <line
            x1="0"
            y1={zeroY}
            x2={width}
            y2={zeroY}
            stroke="#474d66"
            strokeDasharray="3 3"
            strokeWidth="1"
          />

          <path d={areaPath} fill={`url(#grad-${isProfit ? "win" : "loss"})`} />

          <path
            d={linePath}
            fill="none"
            stroke={isProfit ? "#34d399" : "#fb7185"}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  );
}

// --- P&L SWING BAR COMPONENT ---
function PnlSwingBar({
  maxDrawdown,
  maxPeak,
  currentPnl,
}: {
  maxDrawdown: number;
  maxPeak: number;
  currentPnl: number;
}) {
  const ddAbs = Math.abs(Math.min(0, maxDrawdown));
  const peakAbs = Math.max(0, maxPeak);
  const totalSpan = ddAbs + peakAbs || 1;

  const ddPct = (ddAbs / totalSpan) * 100;
  const peakPct = (peakAbs / totalSpan) * 100;

  let currentPosPct = 50;
  if (currentPnl <= 0 && ddAbs > 0) {
    currentPosPct = 50 - (Math.abs(currentPnl) / ddAbs) * 50;
  } else if (currentPnl > 0 && peakAbs > 0) {
    currentPosPct = 50 + (currentPnl / peakAbs) * 50;
  }
  currentPosPct = Math.max(2, Math.min(98, currentPosPct));

  return (
    <div className="space-y-1.5">
      <div className="flex justify-between items-center text-[11px] font-medium">
        <span className="text-muted-foreground">P&L Swing</span>
        <div className="flex gap-3">
          <span className="text-rose-400">
            Max Loss: <span className="font-semibold">{fmtCurrency(maxDrawdown)}</span>
          </span>
          <span className="text-emerald-400">
            Max Profit: <span className="font-semibold">{fmtCurrency(maxPeak)}</span>
          </span>
        </div>
      </div>

      <div className="relative h-2 w-full bg-[#1b1e2a] rounded-full overflow-hidden flex items-center">
        <div
          className="h-full bg-rose-500/80 transition-all duration-300"
          style={{ width: `${ddPct}%` }}
        />
        <div
          className="h-full bg-emerald-500/80 transition-all duration-300"
          style={{ width: `${peakPct}%` }}
        />
        <div
          className="absolute top-0 bottom-0 w-1.5 bg-white shadow-[0_0_8px_#ffffff] rounded-full"
          style={{ left: `${currentPosPct}%` }}
          title={`Net P&L: ${fmtCurrency(currentPnl)}`}
        />
      </div>
    </div>
  );
}

// --- STATS METRICS GRID ---
function StatsGrid({
  trades,
  columns = 4,
}: {
  trades: JournalTrade[];
  netPnl?: number;
  columns?: 4 | 7;
}) {
  const metrics = useMemo(() => {
    const totalTrades = trades.length;
    const wins = trades.filter((t) => t.netPnl > 0);
    const losses = trades.filter((t) => t.netPnl < 0);
    const winRate = totalTrades > 0 ? (wins.length / totalTrades) * 100 : 0;

    const grossProfit = wins.reduce((acc, t) => acc + (t.grossPnl ?? t.netPnl), 0);
    const grossLoss = Math.abs(
      losses.reduce((acc, t) => acc + (t.grossPnl ?? t.netPnl), 0)
    );
    const grossPnl = trades.reduce((acc, t) => acc + (t.grossPnl ?? t.netPnl), 0);
    const totalFees = trades.reduce((acc, t) => acc + (t.fees ?? 0), 0);
    const totalVolume = trades.reduce((acc, t) => acc + (t.quantity || 0), 0);

    const profitFactor =
      grossLoss > 0
        ? (grossProfit / grossLoss).toFixed(2)
        : grossProfit > 0
        ? "∞"
        : "0.00";

    return {
      totalTrades,
      grossPnl,
      winsCount: wins.length,
      lossesCount: losses.length,
      fees: totalFees,
      winRate: winRate.toFixed(1),
      volume: totalVolume.toFixed(2),
      profitFactor,
    };
  }, [trades]);

  const gridClass =
    columns === 7
      ? "grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-y-2 gap-x-4 text-xs"
      : "grid grid-cols-2 sm:grid-cols-4 gap-y-2.5 gap-x-5 text-xs";

  return (
    <div className={gridClass}>
      <div>
        <div className="text-muted-foreground text-[10px]">Total Trades</div>
        <div className="font-semibold text-foreground text-sm">{metrics.totalTrades}</div>
      </div>
      <div>
        <div className="text-muted-foreground text-[10px]">Gross P&L</div>
        <div
          className={`font-semibold text-sm ${
            metrics.grossPnl >= 0 ? "text-emerald-400" : "text-rose-400"
          }`}
        >
          {fmtCurrency(metrics.grossPnl)}
        </div>
      </div>
      <div>
        <div className="text-muted-foreground text-[10px]">Winners / Losers</div>
        <div className="font-semibold text-foreground text-sm">
          {metrics.winsCount} / {metrics.lossesCount}
        </div>
      </div>
      <div>
        <div className="text-muted-foreground text-[10px]">Commissions</div>
        <div className="font-semibold text-foreground text-sm">
          ${metrics.fees.toFixed(2)}
        </div>
      </div>
      <div>
        <div className="text-muted-foreground text-[10px]">Win Rate</div>
        <div className="font-semibold text-foreground text-sm">{metrics.winRate}%</div>
      </div>
      <div>
        <div className="text-muted-foreground text-[10px]">Volume</div>
        <div className="font-semibold text-foreground text-sm">{metrics.volume}</div>
      </div>
      <div>
        <div className="text-muted-foreground text-[10px]">Profit Factor</div>
        <div className="font-semibold text-foreground text-sm">{metrics.profitFactor}</div>
      </div>
    </div>
  );
}

// --- BI-DIRECTIONAL (+ / -) SUB-PERIOD BAR CHART ---
export interface SubPeriodItem {
  label: string;
  pnl: number;
  count: number;
  targetPeriod?: JournalPeriod;
  targetId?: string;
  journalHref?: string;
}

function SubPeriodBarChart({
  title,
  items,
  onBarSingleClick,
  onBarDoubleClick,
  compactLabels = false,
}: {
  title?: string;
  items: SubPeriodItem[];
  onBarSingleClick?: (item: SubPeriodItem) => void;
  onBarDoubleClick?: (item: SubPeriodItem) => void;
  compactLabels?: boolean;
}) {
  const triggerClick = useDelayedClick();
  const maxPos = Math.max(0, ...items.map((i) => i.pnl));
  const minNeg = Math.min(0, ...items.map((i) => i.pnl));
  const maxExtent = Math.max(maxPos, Math.abs(minNeg), 50);

  const shouldShowLabel = (idx: number, total: number) => {
    if (total <= 14) return true;
    if (total <= 35) return idx === 0 || (idx + 1) % 5 === 0 || idx === total - 1;
    if (total <= 55) return idx === 0 || (idx + 1) % 8 === 0 || idx === total - 1;
    return idx === 0 || (idx + 1) % 14 === 0 || idx === total - 1;
  };

  return (
    <div className="rounded-lg border border-border/40 bg-[#161924]/50 p-2.5 select-none">
      {title && (
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
          {title}
        </div>
      )}
      <div className="flex gap-1.5 w-full">
        {/* Y-Axis Reference Labels */}
        <div className="flex flex-col justify-between text-[9px] text-muted-foreground tabular-nums h-[80px] pb-3.5 pr-1 text-right min-w-[34px]">
          <span className="text-emerald-400/80">{fmtCompactCurrency(maxExtent)}</span>
          <span>$0</span>
          <span className="text-rose-400/80">{fmtCompactCurrency(-maxExtent)}</span>
        </div>

        {/* Bars Container with 0-Baseline in the Middle */}
        <div className="relative flex-1 flex flex-col">
          <div className="relative flex items-stretch gap-[2px] h-[66px] w-full">
            <div className="absolute inset-x-0 top-0 border-t border-dashed border-border/25 pointer-events-none" />
            <div className="absolute inset-x-0 top-1/2 border-t border-border/70 pointer-events-none z-0" />
            <div className="absolute inset-x-0 bottom-0 border-b border-dashed border-border/25 pointer-events-none" />

            {items.map((item, idx) => {
              const pct = Math.min(
                100,
                Math.max(item.count > 0 ? 10 : 0, (Math.abs(item.pnl) / maxExtent) * 100)
              );
              const isPos = item.pnl > 0;
              const isNeg = item.pnl < 0;
              const isInteractive =
                item.count > 0 && (!!onBarSingleClick || !!onBarDoubleClick);

              return (
                <div
                  key={idx}
                  onClick={() => {
                    if (!isInteractive) return;
                    triggerClick(
                      () => onBarSingleClick?.(item),
                      () => onBarDoubleClick?.(item)
                    );
                  }}
                  className={`flex-1 flex flex-col h-full group z-10 ${
                    isInteractive ? "cursor-pointer" : ""
                  }`}
                  title={
                    item.count > 0
                      ? `${item.label}: ${fmtCurrency(item.pnl)} (${item.count} ${
                          item.count === 1 ? "trade" : "trades"
                        })`
                      : `${item.label}: No trades`
                  }
                >
                  {/* Top Half: Positive P&L */}
                  <div className="h-1/2 w-full flex items-end justify-center">
                    {isPos && (
                      <div
                        style={{ height: `${pct}%` }}
                        className="w-full max-w-[16px] rounded-t-[2px] bg-emerald-500/85 group-hover:bg-emerald-400 group-hover:ring-1 group-hover:ring-emerald-300 transition-all"
                      />
                    )}
                  </div>

                  {/* Bottom Half: Negative P&L */}
                  <div className="h-1/2 w-full flex items-start justify-center">
                    {isNeg && (
                      <div
                        style={{ height: `${pct}%` }}
                        className="w-full max-w-[16px] rounded-b-[2px] bg-rose-500/85 group-hover:bg-rose-400 group-hover:ring-1 group-hover:ring-rose-300 transition-all"
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* X-Axis Labels */}
          <div className="flex items-center gap-[2px] h-3.5 mt-1">
            {items.map((item, idx) => {
              const show = !compactLabels || shouldShowLabel(idx, items.length);
              return (
                <div key={idx} className="flex-1 text-center overflow-visible">
                  {show && (
                    <span className="text-[9px] text-muted-foreground whitespace-nowrap">
                      {item.label}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// --- SUB-PERIOD INTERACTIVE STRIP ---
function SubPeriodStrip({
  items,
  colsClass = "grid-cols-7",
  onItemSingleClick,
  onItemDoubleClick,
}: {
  items: SubPeriodItem[];
  colsClass?: string;
  onItemSingleClick?: (item: SubPeriodItem) => void;
  onItemDoubleClick?: (item: SubPeriodItem) => void;
}) {
  const triggerClick = useDelayedClick();

  return (
    <div className={`grid ${colsClass} gap-1.5 py-2.5 border-b border-border/30 select-none`}>
      {items.map((d, i) => (
        <button
          key={i}
          type="button"
          disabled={d.count === 0}
          onClick={() => {
            if (d.count === 0) return;
            triggerClick(
              () => onItemSingleClick?.(d),
              () => onItemDoubleClick?.(d)
            );
          }}
          className={`rounded-lg py-1.5 px-2 flex flex-col items-center justify-center text-center transition ${
            d.count === 0
              ? "bg-[#181a24]/40 text-muted-foreground/40 border border-transparent"
              : d.pnl >= 0
              ? "bg-emerald-950/25 border border-emerald-900/50 hover:border-emerald-500 cursor-pointer text-emerald-400"
              : "bg-rose-950/25 border border-rose-900/50 hover:border-rose-500 cursor-pointer text-rose-400"
          }`}
        >
          <span className="text-[10px] font-semibold text-muted-foreground">
            {d.label}
          </span>
          {d.count > 0 ? (
            <>
              <span className="text-[11px] font-bold mt-0.5">{fmtCurrency(d.pnl)}</span>
              <span className="text-[9px] text-muted-foreground">
                {d.count} {d.count === 1 ? "trade" : "trades"}
              </span>
            </>
          ) : (
            <span className="text-[10px] text-muted-foreground/30 mt-0.5">—</span>
          )}
        </button>
      ))}
    </div>
  );
}

// --- TOP INTERACTIVE CALENDAR FOR DAY TAB ---
function InteractiveDayCalendar({
  trades,
  selectedDate,
  onSelectDate,
  onDoubleClickDate,
}: {
  trades: JournalTrade[];
  selectedDate: string | null;
  onSelectDate: (dateStr: string | null) => void;
  onDoubleClickDate: (dateStr: string) => void;
}) {
  const triggerClick = useDelayedClick();
  const [currentMonth, setCurrentMonth] = useState(() => new Date());

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayIndex = new Date(year, month, 1).getDay();

  const dailyPnlMap = useMemo(() => {
    const map = new Map<string, { netPnl: number; count: number }>();
    trades.forEach((t) => {
      const d = t.openedAt.slice(0, 10);
      const existing = map.get(d) || { netPnl: 0, count: 0 };
      existing.netPnl += t.netPnl;
      existing.count += 1;
      map.set(d, existing);
    });
    return map;
  }, [trades]);

  const monthName = currentMonth.toLocaleString("default", { month: "long" });

  const prevMonth = () => setCurrentMonth(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentMonth(new Date(year, month + 1, 1));

  return (
    <div className="rounded-xl border border-border/70 bg-[#12141d] p-4 shadow-sm mb-6 select-none">
      <div className="flex items-center justify-between pb-3 border-b border-border/40">
        <div className="flex items-center gap-2">
          <CalendarIcon className="w-4 h-4 text-indigo-400" />
          <h3 className="text-sm font-semibold text-foreground">
            {monthName} {year}
          </h3>
          {selectedDate && (
            <button
              onClick={() => onSelectDate(null)}
              className="inline-flex items-center gap-1 text-[11px] bg-indigo-500/15 text-indigo-300 px-2 py-0.5 rounded-md hover:bg-indigo-500/25 ml-2"
            >
              <span>Filtered: {selectedDate}</span>
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={prevMonth}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={nextMonth}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 pt-3 text-center text-xs">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
          <div key={day} className="text-[11px] font-medium text-muted-foreground pb-1">
            {day}
          </div>
        ))}

        {Array.from({ length: firstDayIndex }).map((_, idx) => (
          <div key={`empty-${idx}`} className="h-14 rounded-lg bg-transparent" />
        ))}

        {Array.from({ length: daysInMonth }).map((_, idx) => {
          const dayNum = idx + 1;
          const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(
            dayNum
          ).padStart(2, "0")}`;
          const dayData = dailyPnlMap.get(dateStr);
          const isSelected = selectedDate === dateStr;

          return (
            <button
              key={dateStr}
              type="button"
              onClick={() =>
                triggerClick(
                  () => onSelectDate(isSelected ? null : dateStr),
                  () => onDoubleClickDate(dateStr)
                )
              }
              className={`h-14 rounded-lg p-1 flex flex-col justify-between items-center transition border text-left ${
                isSelected
                  ? "ring-2 ring-indigo-500 border-indigo-400 bg-indigo-500/10"
                  : dayData
                  ? dayData.netPnl >= 0
                    ? "bg-emerald-950/20 border-emerald-900/40 hover:border-emerald-700/60"
                    : "bg-rose-950/20 border-rose-900/40 hover:border-rose-700/60"
                  : "border-transparent hover:bg-muted/20"
              }`}
            >
              <span className="text-[11px] font-medium text-muted-foreground self-start pl-1">
                {dayNum}
              </span>
              {dayData && (
                <div className="w-full text-center pb-0.5">
                  <span
                    className={`block text-[11px] font-bold leading-tight ${
                      dayData.netPnl >= 0 ? "text-emerald-400" : "text-rose-400"
                    }`}
                  >
                    {fmtCurrency(dayData.netPnl)}
                  </span>
                  <span className="text-[9px] text-muted-foreground">
                    {dayData.count} {dayData.count === 1 ? "trade" : "trades"}
                  </span>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// --- COLLAPSIBLE TRADES TABLE ---
function TradesTable({ trades }: { trades: JournalTrade[] }) {
  return (
    <div className="mt-4 pt-3 border-t border-border/50 overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="text-muted-foreground border-b border-border/40 pb-1">
            <th className="py-1.5 px-2 font-medium">Date / Time</th>
            <th className="py-1.5 px-2 font-medium">Ticker</th>
            <th className="py-1.5 px-2 font-medium">Side</th>
            <th className="py-1.5 px-2 font-medium text-right">Net P&L</th>
            <th className="py-1.5 px-2 font-medium text-right">R</th>
            <th className="py-1.5 px-2 font-medium text-right">Volume</th>
            <th className="py-1.5 px-2 font-medium">Strategy / Tags</th>
            <th className="py-1.5 px-2 font-medium text-center">Action</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t) => {
            const isBuy =
              t.direction.toLowerCase() === "buy" || t.direction.toLowerCase() === "long";
            const datePart = t.openedAt.slice(0, 10);
            const timePart = t.openedAt.length >= 16 ? t.openedAt.slice(11, 19) : "";
            return (
              <tr
                key={t.key}
                className="border-b border-border/20 hover:bg-muted/20 transition-colors"
              >
                <td className="py-2 px-2 text-muted-foreground tabular-nums">
                  {datePart} <span className="text-muted-foreground/70">{timePart}</span>
                </td>
                <td className="py-2 px-2 font-semibold text-foreground">
                  <span className="px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-300 text-[11px]">
                    {t.symbol}
                  </span>
                </td>
                <td className="py-2 px-2">
                  <span
                    className={`font-bold text-[11px] ${
                      isBuy ? "text-emerald-400" : "text-rose-400"
                    }`}
                  >
                    {t.direction.toUpperCase()}
                  </span>
                </td>
                <td
                  className={`py-2 px-2 text-right font-bold tabular-nums ${
                    t.netPnl >= 0 ? "text-emerald-400" : "text-rose-400"
                  }`}
                >
                  {fmtCurrency(t.netPnl)}
                </td>
                <td className="py-2 px-2 text-right text-muted-foreground tabular-nums">
                  {t.realizedR != null ? `${t.realizedR > 0 ? "+" : ""}${t.realizedR}R` : "—"}
                </td>
                <td className="py-2 px-2 text-right text-muted-foreground tabular-nums">
                  {t.quantity}
                </td>
                <td className="py-2 px-2 text-muted-foreground truncate max-w-[150px]">
                  {t.strategy || t.tags?.join(", ") || "—"}
                </td>
                <td className="py-2 px-2 text-center">
                  <Link
                    href={`/trades/${t.key}`}
                    className="inline-flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300 hover:underline"
                  >
                    Review <ArrowRight className="w-3 h-3" />
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// --- MAIN JOURNAL COMPONENT ---
export function JournalView({ trades }: JournalViewProps) {
  const router = useRouter();
  const [period, setPeriod] = useState<JournalPeriod>("day");
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<string | null>(null);
  const [activeSubFilterId, setActiveSubFilterId] = useState<string | null>(null);

  // Pagination for Day View
  const [daysPerPage, setDaysPerPage] = useState<number>(10);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Card expansion toggles
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({});

  const toggleCard = (id: string) => {
    setExpandedCards((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleSubItemSingleClick = (item: SubPeriodItem) => {
    if (!item.targetPeriod || !item.targetId) return;
    if (item.targetPeriod === "day") {
      setPeriod("day");
      setSelectedCalendarDate(item.targetId);
      setCurrentPage(1);
    } else {
      setPeriod(item.targetPeriod);
      setActiveSubFilterId(item.targetId);
    }
  };

  const handleSubItemDoubleClick = (item: SubPeriodItem) => {
    if (item.journalHref) {
      router.push(item.journalHref);
    }
  };

  // Group trades by Day
  const dayGroups = useMemo(() => {
    const map = new Map<string, JournalTrade[]>();
    trades.forEach((t) => {
      const d = t.openedAt.slice(0, 10);
      const arr = map.get(d) || [];
      arr.push(t);
      map.set(d, arr);
    });

    const entries = Array.from(map.entries()).sort(
      (a, b) => new Date(b[0]).getTime() - new Date(a[0]).getTime()
    );

    return entries.map(([dateStr, trs]) => {
      const netPnl = trs.reduce((acc, t) => acc + t.netPnl, 0);
      const dt = new Date(`${dateStr}T12:00:00Z`);
      const dateFormatted = dt.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "2-digit",
        year: "numeric",
      });
      return {
        id: dateStr,
        title: dateFormatted,
        dateStr,
        trades: trs,
        netPnl,
        journalHref: `/journal/${dateStr}`,
      };
    });
  }, [trades]);

  // Group trades by Week (Monday - Sunday)
  const weekGroups = useMemo(() => {
    const map = new Map<string, JournalTrade[]>();

    trades.forEach((t) => {
      const weekKey = getMondayDateStr(t.openedAt);
      const arr = map.get(weekKey) || [];
      arr.push(t);
      map.set(weekKey, arr);
    });

    return Array.from(map.entries())
      .sort((a, b) => new Date(b[0]).getTime() - new Date(a[0]).getTime())
      .map(([mondayStr, trs]) => {
        const mon = new Date(`${mondayStr}T12:00:00Z`);
        const sun = new Date(mon.getTime() - 86_400_000);
        const sat = new Date(mon.getTime() + 5 * 86_400_000);
        const title = `${sun.toLocaleDateString("en-US", {
          month: "short",
          day: "2-digit",
        })} - ${sat.toLocaleDateString("en-US", {
          month: "short",
          day: "2-digit",
          year: "numeric",
        })}`;

        const netPnl = trs.reduce((acc, t) => acc + t.netPnl, 0);

        const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        const dayItems: SubPeriodItem[] = [0, 1, 2, 3, 4, 5, 6].map((dayIdx) => {
          const matching = trs.filter(
            (t) => new Date(t.openedAt).getDay() === dayIdx
          );
          const pnl = matching.reduce((acc, t) => acc + t.netPnl, 0);
          const repDateStr =
            matching[0]?.openedAt.slice(0, 10) ||
            new Date(sun.getTime() + dayIdx * 86_400_000).toISOString().slice(0, 10);

          return {
            label: names[dayIdx]!,
            count: matching.length,
            pnl,
            targetPeriod: "day",
            targetId: repDateStr,
            journalHref: `/journal/${repDateStr}`,
          };
        });

        let running = 0;
        let maxDd = 0;
        let maxPk = 0;
        const sorted = [...trs].sort(
          (a, b) => new Date(a.openedAt).getTime() - new Date(b.openedAt).getTime()
        );
        sorted.forEach((t) => {
          running += t.netPnl;
          if (running < maxDd) maxDd = running;
          if (running > maxPk) maxPk = running;
        });

        return {
          id: mondayStr,
          title,
          trades: trs,
          netPnl,
          subItems: dayItems,
          maxDrawdown: maxDd,
          maxPeak: maxPk,
          journalHref: `/journal/week-${mondayStr}`,
        };
      });
  }, [trades]);

  // Group trades by Month (Weeks W1-W5 + Days 1..31)
  const monthGroups = useMemo(() => {
    const map = new Map<string, JournalTrade[]>();
    trades.forEach((t) => {
      const mKey = t.openedAt.slice(0, 7);
      const arr = map.get(mKey) || [];
      arr.push(t);
      map.set(mKey, arr);
    });

    return Array.from(map.entries())
      .sort((a, b) => new Date(b[0]).getTime() - new Date(a[0]).getTime())
      .map(([mKey, trs]) => {
        const [yrStr, moStr] = mKey.split("-");
        const yr = parseInt(yrStr!, 10);
        const mo = parseInt(moStr!, 10);
        const daysInMonth = new Date(yr, mo, 0).getDate();

        const dt = new Date(`${mKey}-01T12:00:00Z`);
        const title = dt.toLocaleDateString("en-US", { month: "long", year: "numeric" });
        const netPnl = trs.reduce((acc, t) => acc + t.netPnl, 0);

        const weekItems: SubPeriodItem[] = [1, 2, 3, 4, 5].map((w) => {
          const matching = trs.filter((t) => {
            const dayNum = new Date(t.openedAt).getDate();
            return Math.ceil(dayNum / 7) === w;
          });
          const repMonday = matching[0]
            ? getMondayDateStr(matching[0].openedAt)
            : `${mKey}-${String((w - 1) * 7 + 1).padStart(2, "0")}`;

          return {
            label: `W${w}`,
            pnl: matching.reduce((acc, t) => acc + t.netPnl, 0),
            count: matching.length,
            targetPeriod: "week",
            targetId: repMonday,
            journalHref: `/journal/week-${repMonday}`,
          };
        });

        const dayItems: SubPeriodItem[] = Array.from({ length: daysInMonth }).map(
          (_, idx) => {
            const dayNum = idx + 1;
            const dateStr = `${mKey}-${String(dayNum).padStart(2, "0")}`;
            const matching = trs.filter((t) => t.openedAt.slice(0, 10) === dateStr);
            return {
              label: `${dayNum}`,
              pnl: matching.reduce((acc, t) => acc + t.netPnl, 0),
              count: matching.length,
              targetPeriod: "day",
              targetId: dateStr,
              journalHref: `/journal/${dateStr}`,
            };
          }
        );

        let running = 0;
        let maxDd = 0;
        let maxPk = 0;
        [...trs]
          .sort((a, b) => new Date(a.openedAt).getTime() - new Date(b.openedAt).getTime())
          .forEach((t) => {
            running += t.netPnl;
            if (running < maxDd) maxDd = running;
            if (running > maxPk) maxPk = running;
          });

        return {
          id: mKey,
          title,
          trades: trs,
          netPnl,
          weekItems,
          dayItems,
          maxDrawdown: maxDd,
          maxPeak: maxPk,
          journalHref: `/journal/month-${mKey}`,
        };
      });
  }, [trades]);

  // Group trades by Quarter (Months + Weeks + Days)
  const quarterGroups = useMemo(() => {
    const map = new Map<string, JournalTrade[]>();
    trades.forEach((t) => {
      const d = new Date(t.openedAt);
      const q = Math.floor(d.getMonth() / 3) + 1;
      const qKey = `${d.getFullYear()}-Q${q}`;
      const arr = map.get(qKey) || [];
      arr.push(t);
      map.set(qKey, arr);
    });

    const monthNames = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];

    return Array.from(map.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([qKey, trs]) => {
        const [yrStr, qStr] = qKey.split("-");
        const yr = parseInt(yrStr!, 10);
        const qNum = parseInt(qStr!.replace("Q", ""), 10);
        const startMonth = (qNum - 1) * 3;
        const title = `${qStr} ${yr}`;
        const netPnl = trs.reduce((acc, t) => acc + t.netPnl, 0);

        const monthItems: SubPeriodItem[] = [
          startMonth,
          startMonth + 1,
          startMonth + 2,
        ].map((mIdx) => {
          const matching = trs.filter((t) => new Date(t.openedAt).getMonth() === mIdx);
          const mKey = `${yr}-${String(mIdx + 1).padStart(2, "0")}`;
          return {
            label: monthNames[mIdx]!,
            pnl: matching.reduce((acc, t) => acc + t.netPnl, 0),
            count: matching.length,
            targetPeriod: "month",
            targetId: mKey,
            journalHref: `/journal/month-${mKey}`,
          };
        });

        const qStart = new Date(Date.UTC(yr, startMonth, 1));
        const qEnd = new Date(Date.UTC(yr, startMonth + 3, 0));
        const weekItems: SubPeriodItem[] = Array.from({ length: 13 }).map((_, wIdx) => {
          const wStart = new Date(qStart.getTime() + wIdx * 7 * 86_400_000);
          const wEnd = new Date(wStart.getTime() + 7 * 86_400_000);
          const matching = trs.filter((t) => {
            const ms = new Date(t.openedAt).getTime();
            return ms >= wStart.getTime() && ms < wEnd.getTime();
          });
          const repMonday = matching[0]
            ? getMondayDateStr(matching[0].openedAt)
            : getMondayDateStr(wStart);
          return {
            label: `W${wIdx + 1}`,
            pnl: matching.reduce((acc, t) => acc + t.netPnl, 0),
            count: matching.length,
            targetPeriod: "week",
            targetId: repMonday,
            journalHref: `/journal/week-${repMonday}`,
          };
        });

        const dayItems: SubPeriodItem[] = [];
        const curDay = new Date(qStart.getTime());
        while (curDay <= qEnd) {
          const dStr = curDay.toISOString().slice(0, 10);
          const matching = trs.filter((t) => t.openedAt.slice(0, 10) === dStr);
          dayItems.push({
            label: dStr.slice(5),
            pnl: matching.reduce((acc, t) => acc + t.netPnl, 0),
            count: matching.length,
            targetPeriod: "day",
            targetId: dStr,
            journalHref: `/journal/${dStr}`,
          });
          curDay.setUTCDate(curDay.getUTCDate() + 1);
        }

        let running = 0;
        let maxDd = 0;
        let maxPk = 0;
        [...trs]
          .sort((a, b) => new Date(a.openedAt).getTime() - new Date(b.openedAt).getTime())
          .forEach((t) => {
            running += t.netPnl;
            if (running < maxDd) maxDd = running;
            if (running > maxPk) maxPk = running;
          });

        return {
          id: qKey,
          title,
          trades: trs,
          netPnl,
          monthItems,
          weekItems,
          dayItems,
          maxDrawdown: maxDd,
          maxPeak: maxPk,
          journalHref: `/journal/quarter-${qKey}`,
        };
      });
  }, [trades]);

  // Group trades by Year (Quarterly + Monthly + 52-Week P&L breakdowns)
  const yearGroups = useMemo(() => {
    const map = new Map<string, JournalTrade[]>();
    trades.forEach((t) => {
      const yKey = t.openedAt.slice(0, 4);
      const arr = map.get(yKey) || [];
      arr.push(t);
      map.set(yKey, arr);
    });

    const monthNames = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];

    return Array.from(map.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([yKey, trs]) => {
        const yr = parseInt(yKey, 10);
        const netPnl = trs.reduce((acc, t) => acc + t.netPnl, 0);

        const quarterItems: SubPeriodItem[] = [1, 2, 3, 4].map((q) => {
          const matching = trs.filter((t) => {
            const m = new Date(t.openedAt).getMonth();
            return Math.floor(m / 3) + 1 === q;
          });
          const qKey = `${yKey}-Q${q}`;
          return {
            label: `Q${q}`,
            pnl: matching.reduce((acc, t) => acc + t.netPnl, 0),
            count: matching.length,
            targetPeriod: "quarter",
            targetId: qKey,
            journalHref: `/journal/quarter-${qKey}`,
          };
        });

        const monthItems: SubPeriodItem[] = Array.from({ length: 12 }).map((_, mIdx) => {
          const matching = trs.filter((t) => new Date(t.openedAt).getMonth() === mIdx);
          const mKey = `${yKey}-${String(mIdx + 1).padStart(2, "0")}`;
          return {
            label: monthNames[mIdx]!,
            pnl: matching.reduce((acc, t) => acc + t.netPnl, 0),
            count: matching.length,
            targetPeriod: "month",
            targetId: mKey,
            journalHref: `/journal/month-${mKey}`,
          };
        });

        const yearStart = new Date(Date.UTC(yr, 0, 1));
        const weekItems: SubPeriodItem[] = Array.from({ length: 52 }).map((_, wIdx) => {
          const wStart = new Date(yearStart.getTime() + wIdx * 7 * 86_400_000);
          const wEnd = new Date(wStart.getTime() + 7 * 86_400_000);
          const matching = trs.filter((t) => {
            const ms = new Date(t.openedAt).getTime();
            return ms >= wStart.getTime() && ms < wEnd.getTime();
          });
          const repMonday = matching[0]
            ? getMondayDateStr(matching[0].openedAt)
            : getMondayDateStr(wStart);
          return {
            label: `W${wIdx + 1}`,
            pnl: matching.reduce((acc, t) => acc + t.netPnl, 0),
            count: matching.length,
            targetPeriod: "week",
            targetId: repMonday,
            journalHref: `/journal/week-${repMonday}`,
          };
        });

        let running = 0;
        let maxDd = 0;
        let maxPk = 0;
        [...trs]
          .sort((a, b) => new Date(a.openedAt).getTime() - new Date(b.openedAt).getTime())
          .forEach((t) => {
            running += t.netPnl;
            if (running < maxDd) maxDd = running;
            if (running > maxPk) maxPk = running;
          });

        return {
          id: yKey,
          title: yKey,
          trades: trs,
          netPnl,
          quarterItems,
          monthItems,
          weekItems,
          maxDrawdown: maxDd,
          maxPeak: maxPk,
          journalHref: `/journal/year-${yKey}`,
        };
      });
  }, [trades]);

  // Filter dayGroups if calendar date selected
  const filteredDayGroups = useMemo(() => {
    if (!selectedCalendarDate) return dayGroups;
    return dayGroups.filter((g) => g.dateStr === selectedCalendarDate);
  }, [dayGroups, selectedCalendarDate]);

  // Paginate Day View
  const paginatedDays = useMemo(() => {
    if (daysPerPage === -1) return filteredDayGroups;
    const start = (currentPage - 1) * daysPerPage;
    return filteredDayGroups.slice(start, start + daysPerPage);
  }, [filteredDayGroups, currentPage, daysPerPage]);

  const totalPages =
    daysPerPage === -1
      ? 1
      : Math.max(1, Math.ceil(filteredDayGroups.length / daysPerPage));

  const filteredWeekGroups = useMemo(() => {
    if (!activeSubFilterId || period !== "week") return weekGroups;
    return weekGroups.filter((w) => w.id === activeSubFilterId);
  }, [weekGroups, activeSubFilterId, period]);

  const filteredMonthGroups = useMemo(() => {
    if (!activeSubFilterId || period !== "month") return monthGroups;
    return monthGroups.filter((m) => m.id === activeSubFilterId);
  }, [monthGroups, activeSubFilterId, period]);

  const filteredQuarterGroups = useMemo(() => {
    if (!activeSubFilterId || period !== "quarter") return quarterGroups;
    return quarterGroups.filter((q) => q.id === activeSubFilterId);
  }, [quarterGroups, activeSubFilterId, period]);

  return (
    <div className="space-y-6">
      {/* HEADER & PERIOD SWITCHER */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-border/50">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-xl font-bold text-foreground">Journal</h1>
            <p className="text-xs text-muted-foreground">
              Track performance and review trade journals across Day, Week, Month, Quarter, and Year.
            </p>
          </div>
          {activeSubFilterId && period !== "day" && (
            <button
              onClick={() => setActiveSubFilterId(null)}
              className="inline-flex items-center gap-1 text-xs bg-indigo-500/15 text-indigo-300 px-2.5 py-1 rounded-lg hover:bg-indigo-500/25"
            >
              <span>Showing: {activeSubFilterId}</span>
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Period Selector Toggle */}
        <div className="flex items-center rounded-xl bg-[#161822] p-1 border border-border/60">
          {(["day", "week", "month", "quarter", "year"] as JournalPeriod[]).map((p) => (
            <button
              key={p}
              onClick={() => {
                setPeriod(p);
                setActiveSubFilterId(null);
                setCurrentPage(1);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition ${
                period === p
                  ? "bg-indigo-600 text-white shadow"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* --- DAY TAB --- */}
      {period === "day" && (
        <div className="space-y-4">
          <InteractiveDayCalendar
            trades={trades}
            selectedDate={selectedCalendarDate}
            onSelectDate={(d) => {
              setSelectedCalendarDate(d);
              setCurrentPage(1);
            }}
            onDoubleClickDate={(dateStr) => router.push(`/journal/${dateStr}`)}
          />

          <div className="space-y-4">
            {paginatedDays.map((dg) => {
              const isExpanded = !!expandedCards[dg.id];
              const isWin = dg.netPnl >= 0;

              return (
                <div
                  key={dg.id}
                  className="rounded-xl border border-border/70 bg-[#12141d] p-4 shadow-sm hover:border-border transition"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-border/40">
                    <div className="flex items-center gap-2.5">
                      <button
                        onClick={() => toggleCard(dg.id)}
                        className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                      >
                        {isExpanded ? (
                          <ChevronUp className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                      </button>
                      <h4
                        onDoubleClick={() => router.push(dg.journalHref)}
                        className="text-sm font-bold text-foreground cursor-pointer hover:text-indigo-300 transition"
                      >
                        {dg.title}
                      </h4>
                      <span className="text-muted-foreground text-xs">•</span>
                      <span
                        className={`text-sm font-bold ${
                          isWin ? "text-emerald-400" : "text-rose-400"
                        }`}
                      >
                        Net P&L {fmtCurrency(dg.netPnl)}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground px-2 py-0.5 rounded bg-muted/40">
                        {dg.trades.length} {dg.trades.length === 1 ? "trade" : "trades"}
                      </span>
                      <Link
                        href={dg.journalHref}
                        className="flex items-center gap-1.5 text-xs border border-indigo-500/40 bg-indigo-500/10 hover:bg-indigo-500/20 px-3 py-1 rounded-lg text-indigo-200 font-medium transition"
                      >
                        <FileText className="w-3.5 h-3.5 text-indigo-400" />
                        <span>Journal</span>
                      </Link>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-12 gap-6 pt-3 items-center">
                    <div className="md:col-span-5 border-r-0 md:border-r border-border/40 pr-0 md:pr-4">
                      <IntradayPnlCurve trades={dg.trades} />
                    </div>
                    <div className="md:col-span-7">
                      <StatsGrid trades={dg.trades} netPnl={dg.netPnl} />
                    </div>
                  </div>

                  {isExpanded && <TradesTable trades={dg.trades} />}
                </div>
              );
            })}

            {paginatedDays.length === 0 && (
              <div className="py-12 text-center text-sm text-muted-foreground border border-dashed border-border/50 rounded-xl">
                No trades found for this period.
              </div>
            )}
          </div>

          {/* Pagination Controls */}
          <div className="flex flex-wrap items-center justify-between gap-4 pt-4 border-t border-border/40 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Days per page:</span>
              <select
                value={daysPerPage}
                onChange={(e) => {
                  setDaysPerPage(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="bg-[#161822] border border-border/60 rounded px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={-1}>All</option>
              </select>
              <span className="text-muted-foreground ml-2">
                Showing {paginatedDays.length} of {filteredDayGroups.length} days
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="p-1.5 rounded-lg border border-border/60 hover:bg-muted disabled:opacity-40 text-muted-foreground hover:text-foreground"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="font-medium text-foreground">
                Page {currentPage} of {totalPages}
              </span>
              <button
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                className="p-1.5 rounded-lg border border-border/60 hover:bg-muted disabled:opacity-40 text-muted-foreground hover:text-foreground"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- WEEK TAB --- */}
      {period === "week" && (
        <div className="space-y-4">
          {filteredWeekGroups.map((wg) => {
            const isExpanded = !!expandedCards[wg.id];
            const isWin = wg.netPnl >= 0;

            return (
              <div
                key={wg.id}
                className="rounded-xl border border-border/70 bg-[#12141d] p-4 shadow-sm hover:border-border transition"
              >
                <div className="flex flex-wrap items-center justify-between gap-3 pb-2.5 border-b border-border/40">
                  <div className="flex items-center gap-2.5">
                    <button
                      onClick={() => toggleCard(wg.id)}
                      className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                    >
                      {isExpanded ? (
                        <ChevronUp className="w-4 h-4" />
                      ) : (
                        <ChevronDown className="w-4 h-4" />
                      )}
                    </button>
                    <h4 className="text-sm font-bold text-foreground">{wg.title}</h4>
                    <span className="text-muted-foreground text-xs">•</span>
                    <span
                      className={`text-sm font-bold ${
                        isWin ? "text-emerald-400" : "text-rose-400"
                      }`}
                    >
                      Net P&L {fmtCurrency(wg.netPnl)}
                    </span>
                  </div>

                  <Link
                    href={wg.journalHref}
                    className="flex items-center gap-1.5 text-xs border border-indigo-500/40 bg-indigo-500/10 hover:bg-indigo-500/20 px-3 py-1 rounded-lg text-indigo-200 font-medium transition"
                  >
                    <FileText className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Weekly Journal</span>
                  </Link>
                </div>

                <SubPeriodStrip
                  items={wg.subItems}
                  colsClass="grid-cols-7"
                  onItemSingleClick={handleSubItemSingleClick}
                  onItemDoubleClick={handleSubItemDoubleClick}
                />

                <div className="grid grid-cols-1 md:grid-cols-12 gap-5 pt-3 items-center">
                  <div className="md:col-span-5">
                    <SubPeriodBarChart
                      title="Daily P&L (Sun – Sat)"
                      items={wg.subItems}
                      onBarSingleClick={handleSubItemSingleClick}
                      onBarDoubleClick={handleSubItemDoubleClick}
                    />
                  </div>
                  <div className="md:col-span-7 space-y-3">
                    <StatsGrid trades={wg.trades} netPnl={wg.netPnl} />
                    <div className="pt-2 border-t border-border/30">
                      <PnlSwingBar
                        maxDrawdown={wg.maxDrawdown}
                        maxPeak={wg.maxPeak}
                        currentPnl={wg.netPnl}
                      />
                    </div>
                  </div>
                </div>

                {isExpanded && <TradesTable trades={wg.trades} />}
              </div>
            );
          })}
        </div>
      )}

      {/* --- MONTH TAB (Compact Side-by-Side Layout) --- */}
      {period === "month" && (
        <div className="space-y-4">
          {filteredMonthGroups.map((group) => {
            const isExpanded = !!expandedCards[group.id];
            const isWin = group.netPnl >= 0;

            return (
              <div
                key={group.id}
                className="rounded-xl border border-border/70 bg-[#12141d] p-4 shadow-sm hover:border-border transition"
              >
                <div className="flex flex-wrap items-center justify-between gap-3 pb-2.5 border-b border-border/40">
                  <div className="flex items-center gap-2.5">
                    <button
                      onClick={() => toggleCard(group.id)}
                      className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                    >
                      {isExpanded ? (
                        <ChevronUp className="w-4 h-4" />
                      ) : (
                        <ChevronDown className="w-4 h-4" />
                      )}
                    </button>
                    <h4 className="text-sm font-bold text-foreground">{group.title}</h4>
                    <span className="text-muted-foreground text-xs">•</span>
                    <span
                      className={`text-sm font-bold ${
                        isWin ? "text-emerald-400" : "text-rose-400"
                      }`}
                    >
                      Net P&L {fmtCurrency(group.netPnl)}
                    </span>
                  </div>

                  <Link
                    href={group.journalHref}
                    className="flex items-center gap-1.5 text-xs border border-indigo-500/40 bg-indigo-500/10 hover:bg-indigo-500/20 px-3 py-1 rounded-lg text-indigo-200 font-medium transition"
                  >
                    <FileText className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Monthly Journal</span>
                  </Link>
                </div>

                {/* Week Strip Row (W1 - W5) */}
                <SubPeriodStrip
                  items={group.weekItems}
                  colsClass="grid-cols-5"
                  onItemSingleClick={handleSubItemSingleClick}
                  onItemDoubleClick={handleSubItemDoubleClick}
                />

                {/* Compact Metrics & P&L Swing Row */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 py-3 border-b border-border/30 items-center">
                  <div className="lg:col-span-8">
                    <StatsGrid trades={group.trades} netPnl={group.netPnl} columns={7} />
                  </div>
                  <div className="lg:col-span-4 lg:border-l border-border/40 lg:pl-4">
                    <PnlSwingBar
                      maxDrawdown={group.maxDrawdown}
                      maxPeak={group.maxPeak}
                      currentPnl={group.netPnl}
                    />
                  </div>
                </div>

                {/* Side-by-Side Charts: Weekly P&L (left) + Days of Month P&L (right) */}
                <div className="grid grid-cols-1 md:grid-cols-12 gap-3 pt-3">
                  <div className="md:col-span-4">
                    <SubPeriodBarChart
                      title="Weekly P&L"
                      items={group.weekItems}
                      onBarSingleClick={handleSubItemSingleClick}
                      onBarDoubleClick={handleSubItemDoubleClick}
                    />
                  </div>
                  <div className="md:col-span-8">
                    <SubPeriodBarChart
                      title="Days of the Month P&L"
                      items={group.dayItems}
                      onBarSingleClick={handleSubItemSingleClick}
                      onBarDoubleClick={handleSubItemDoubleClick}
                      compactLabels
                    />
                  </div>
                </div>

                {isExpanded && <TradesTable trades={group.trades} />}
              </div>
            );
          })}
        </div>
      )}

      {/* --- QUARTER TAB (Compact 3-Chart Grid Layout) --- */}
      {period === "quarter" && (
        <div className="space-y-4">
          {filteredQuarterGroups.map((group) => {
            const isExpanded = !!expandedCards[group.id];
            const isWin = group.netPnl >= 0;

            return (
              <div
                key={group.id}
                className="rounded-xl border border-border/70 bg-[#12141d] p-4 shadow-sm hover:border-border transition"
              >
                <div className="flex flex-wrap items-center justify-between gap-3 pb-2.5 border-b border-border/40">
                  <div className="flex items-center gap-2.5">
                    <button
                      onClick={() => toggleCard(group.id)}
                      className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                    >
                      {isExpanded ? (
                        <ChevronUp className="w-4 h-4" />
                      ) : (
                        <ChevronDown className="w-4 h-4" />
                      )}
                    </button>
                    <h4 className="text-sm font-bold text-foreground">{group.title}</h4>
                    <span className="text-muted-foreground text-xs">•</span>
                    <span
                      className={`text-sm font-bold ${
                        isWin ? "text-emerald-400" : "text-rose-400"
                      }`}
                    >
                      Net P&L {fmtCurrency(group.netPnl)}
                    </span>
                  </div>

                  <Link
                    href={group.journalHref}
                    className="flex items-center gap-1.5 text-xs border border-indigo-500/40 bg-indigo-500/10 hover:bg-indigo-500/20 px-3 py-1 rounded-lg text-indigo-200 font-medium transition"
                  >
                    <FileText className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Quarterly Journal</span>
                  </Link>
                </div>

                {/* Month Strip Row (3 Months in Quarter) */}
                <SubPeriodStrip
                  items={group.monthItems}
                  colsClass="grid-cols-3"
                  onItemSingleClick={handleSubItemSingleClick}
                  onItemDoubleClick={handleSubItemDoubleClick}
                />

                {/* Compact Metrics & P&L Swing Row */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 py-3 border-b border-border/30 items-center">
                  <div className="lg:col-span-8">
                    <StatsGrid trades={group.trades} netPnl={group.netPnl} columns={7} />
                  </div>
                  <div className="lg:col-span-4 lg:border-l border-border/40 lg:pl-4">
                    <PnlSwingBar
                      maxDrawdown={group.maxDrawdown}
                      maxPeak={group.maxPeak}
                      currentPnl={group.netPnl}
                    />
                  </div>
                </div>

                {/* Side-by-Side 3-Column Charts: Months + Weeks (W1-W13) + Days in Quarter */}
                <div className="grid grid-cols-1 md:grid-cols-12 gap-3 pt-3">
                  <div className="md:col-span-3">
                    <SubPeriodBarChart
                      title="Monthly P&L"
                      items={group.monthItems}
                      onBarSingleClick={handleSubItemSingleClick}
                      onBarDoubleClick={handleSubItemDoubleClick}
                    />
                  </div>
                  <div className="md:col-span-4">
                    <SubPeriodBarChart
                      title="Weekly P&L (W1 – W13)"
                      items={group.weekItems}
                      onBarSingleClick={handleSubItemSingleClick}
                      onBarDoubleClick={handleSubItemDoubleClick}
                    />
                  </div>
                  <div className="md:col-span-5">
                    <SubPeriodBarChart
                      title="Daily P&L (Quarter)"
                      items={group.dayItems}
                      onBarSingleClick={handleSubItemSingleClick}
                      onBarDoubleClick={handleSubItemDoubleClick}
                      compactLabels
                    />
                  </div>
                </div>

                {isExpanded && <TradesTable trades={group.trades} />}
              </div>
            );
          })}
        </div>
      )}

      {/* --- YEAR TAB (Compact Multi-Column Layout) --- */}
      {period === "year" && (
        <div className="space-y-4">
          {yearGroups.map((group) => {
            const isExpanded = !!expandedCards[group.id];
            const isWin = group.netPnl >= 0;

            return (
              <div
                key={group.id}
                className="rounded-xl border border-border/70 bg-[#12141d] p-4 shadow-sm hover:border-border transition"
              >
                <div className="flex flex-wrap items-center justify-between gap-3 pb-2.5 border-b border-border/40">
                  <div className="flex items-center gap-2.5">
                    <button
                      onClick={() => toggleCard(group.id)}
                      className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                    >
                      {isExpanded ? (
                        <ChevronUp className="w-4 h-4" />
                      ) : (
                        <ChevronDown className="w-4 h-4" />
                      )}
                    </button>
                    <h4 className="text-sm font-bold text-foreground">{group.title}</h4>
                    <span className="text-muted-foreground text-xs">•</span>
                    <span
                      className={`text-sm font-bold ${
                        isWin ? "text-emerald-400" : "text-rose-400"
                      }`}
                    >
                      Net P&L {fmtCurrency(group.netPnl)}
                    </span>
                  </div>

                  <Link
                    href={group.journalHref}
                    className="flex items-center gap-1.5 text-xs border border-indigo-500/40 bg-indigo-500/10 hover:bg-indigo-500/20 px-3 py-1 rounded-lg text-indigo-200 font-medium transition"
                  >
                    <FileText className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Yearly Journal</span>
                  </Link>
                </div>

                {/* Quarterly & Monthly Strips */}
                <SubPeriodStrip
                  items={group.quarterItems}
                  colsClass="grid-cols-4"
                  onItemSingleClick={handleSubItemSingleClick}
                  onItemDoubleClick={handleSubItemDoubleClick}
                />
                <SubPeriodStrip
                  items={group.monthItems}
                  colsClass="grid-cols-6 sm:grid-cols-12"
                  onItemSingleClick={handleSubItemSingleClick}
                  onItemDoubleClick={handleSubItemDoubleClick}
                />

                {/* Compact Metrics & P&L Swing Row */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 py-3 border-b border-border/30 items-center">
                  <div className="lg:col-span-8">
                    <StatsGrid trades={group.trades} netPnl={group.netPnl} columns={7} />
                  </div>
                  <div className="lg:col-span-4 lg:border-l border-border/40 lg:pl-4">
                    <PnlSwingBar
                      maxDrawdown={group.maxDrawdown}
                      maxPeak={group.maxPeak}
                      currentPnl={group.netPnl}
                    />
                  </div>
                </div>

                {/* Side-by-Side 3-Column Charts: Quarterly + Monthly + Weekly (W1-W52) */}
                <div className="grid grid-cols-1 md:grid-cols-12 gap-3 pt-3">
                  <div className="md:col-span-3">
                    <SubPeriodBarChart
                      title="Quarterly P&L (Q1 – Q4)"
                      items={group.quarterItems}
                      onBarSingleClick={handleSubItemSingleClick}
                      onBarDoubleClick={handleSubItemDoubleClick}
                    />
                  </div>
                  <div className="md:col-span-4">
                    <SubPeriodBarChart
                      title="Monthly P&L (Jan – Dec)"
                      items={group.monthItems}
                      onBarSingleClick={handleSubItemSingleClick}
                      onBarDoubleClick={handleSubItemDoubleClick}
                    />
                  </div>
                  <div className="md:col-span-5">
                    <SubPeriodBarChart
                      title="Weekly P&L (W1 – W52)"
                      items={group.weekItems}
                      onBarSingleClick={handleSubItemSingleClick}
                      onBarDoubleClick={handleSubItemDoubleClick}
                      compactLabels
                    />
                  </div>
                </div>

                {isExpanded && <TradesTable trades={group.trades} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
