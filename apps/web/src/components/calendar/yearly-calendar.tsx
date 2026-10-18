"use client";

import React, { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type MetricMode = "winrate" | "pnl" | "trades";

interface MonthStats {
  month: number;
  pnl: number;
  trades: number;
  wins: number;
  winRate: number | null;
}

interface YearlyData {
  year: number;
  currency: string;
  months: MonthStats[];
}

const MONTH_LABELS = [
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

function formatPnlK(amount: number): string {
  const sign = amount < 0 ? "-$" : amount > 0 ? "+$" : "$";
  const abs = Math.abs(amount);
  if (abs >= 1000) {
    return `${sign}${(abs / 1000).toFixed(2)}k`;
  }
  return `${sign}${abs.toFixed(0)}`;
}

export function YearlyCalendar() {
  const searchParams = useSearchParams();
  const search = searchParams.toString();

  const currentYear = useMemo(() => new Date().getFullYear(), []);
  const [year, setYear] = useState<number>(currentYear);
  const [metric, setMetric] = useState<MetricMode>("pnl");
  const [data, setData] = useState<YearlyData | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let ignore = false;
    setIsLoading(true);

    const q = new URLSearchParams(search);
    q.set("year", String(year));

    fetch(`/api/calendar/yearly?${q.toString()}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!ignore && json) {
          setData(json);
        }
      })
      .catch((err) => console.error("Failed to load yearly calendar:", err))
      .finally(() => {
        if (!ignore) setIsLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [year, search]);

  const months = data?.months ?? Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    pnl: 0,
    trades: 0,
    wins: 0,
    winRate: null,
  }));

  // Aggregate stats across each quarter
  const quarters = useMemo(() => {
    return [
      { label: "Q1", start: 0, end: 3 },
      { label: "Q2", start: 3, end: 6 },
      { label: "Q3", start: 6, end: 9 },
      { label: "Q4", start: 9, end: 12 },
    ].map((q) => {
      const qMonths = months.slice(q.start, q.end);
      const pnl = qMonths.reduce((sum, m) => sum + m.pnl, 0);
      const trades = qMonths.reduce((sum, m) => sum + m.trades, 0);
      const wins = qMonths.reduce((sum, m) => sum + m.wins, 0);
      const winRate = trades > 0 ? (wins / trades) * 100 : null;
      return { label: q.label, pnl, trades, wins, winRate };
    });
  }, [months]);

  // Aggregate stats for the entire year
  const yearTotal = useMemo(() => {
    const pnl = months.reduce((sum, m) => sum + m.pnl, 0);
    const trades = months.reduce((sum, m) => sum + m.trades, 0);
    const wins = months.reduce((sum, m) => sum + m.wins, 0);
    const winRate = trades > 0 ? (wins / trades) * 100 : null;
    return { pnl, trades, wins, winRate };
  }, [months]);

  const yearHasTrades = yearTotal.trades > 0;
  const yearIsPositive =
    metric === "pnl"
      ? yearTotal.pnl > 0
      : metric === "winrate"
      ? (yearTotal.winRate ?? 0) >= 50
      : false;
  const yearIsNegative =
    metric === "pnl"
      ? yearTotal.pnl < 0
      : metric === "winrate"
      ? (yearTotal.winRate ?? 0) < 50
      : false;

  return (
    <Card className="h-full">
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 pb-3">
        {/* Title + Info + Year Navigation */}
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-1.5">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Yearly calendar
            </CardTitle>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="text-muted-foreground/70 hover:text-foreground transition-colors"
                >
                  <Info className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">
                  Summary of monthly performance and trade activity for {year}.
                </p>
              </TooltipContent>
            </Tooltip>
          </div>

          {/* Year Controls */}
          <div className="flex items-center gap-1 ml-1 sm:ml-2">
            <button
              type="button"
              onClick={() => setYear((y) => y - 1)}
              className="flex h-6 w-6 items-center justify-center rounded-md border border-border/60 bg-secondary/30 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
              aria-label="Previous year"
            >
              <ChevronLeft className="h-3 w-3" />
            </button>
            <span className="w-10 text-center text-xs font-semibold tracking-tight">
              {year}
            </span>
            <button
              type="button"
              onClick={() => setYear((y) => y + 1)}
              className="flex h-6 w-6 items-center justify-center rounded-md border border-border/60 bg-secondary/30 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
              aria-label="Next year"
            >
              <ChevronRight className="h-3 w-3" />
            </button>
            {year !== currentYear && (
              <button
                type="button"
                onClick={() => setYear(currentYear)}
                className="ml-1 rounded border border-border/60 bg-secondary/20 px-1.5 py-0.5 text-[10px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
              >
                Current
              </button>
            )}
          </div>
        </div>

        {/* Metric Mode Segmented Buttons */}
        <div className="flex items-center rounded-lg border border-border/50 bg-secondary/50 p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setMetric("winrate")}
            className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-all ${
              metric === "winrate"
                ? "bg-secondary text-foreground font-semibold border border-border shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Win rate
          </button>
          <button
            type="button"
            onClick={() => setMetric("pnl")}
            className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-all ${
              metric === "pnl"
                ? "bg-secondary text-foreground font-semibold border border-border shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            P&L
          </button>
          <button
            type="button"
            onClick={() => setMetric("trades")}
            className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-all ${
              metric === "trades"
                ? "bg-secondary text-foreground font-semibold border border-border shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Trades
          </button>
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        {/* 13-Column Grid */}
        <div className="overflow-x-auto pb-1">
          <div
            className={`grid min-w-[760px] gap-1.5 sm:gap-2 transition-opacity ${
              isLoading ? "opacity-60" : "opacity-100"
            }`}
            style={{ gridTemplateColumns: "repeat(13, minmax(0, 1fr))" }}
          >
            {/* ROW 1: Quarterly Stats Row */}
            <div />
            {quarters.map((q) => {
              if (q.trades === 0) {
                return (
                  <div
                    key={q.label}
                    className="col-span-3 flex items-center justify-center gap-1.5 rounded-lg border border-border/30 bg-secondary/50/40 px-2 py-1.5 text-center text-[11px] text-muted-foreground/40 font-medium select-none"
                  >
                    <span>{q.label}</span>
                    <span>--</span>
                  </div>
                );
              }

              return (
                <Link
                  key={q.label}
                  href={`/journal/quarter-${year}-${q.label}${search ? `?${search}` : ""}`}
                  className="col-span-3 flex items-center justify-center gap-1.5 rounded-lg border border-border/50 bg-secondary/50 px-2 py-1.5 text-center text-[11px] font-medium shadow-sm select-none whitespace-nowrap hover:border-border transition-colors"
                >
                  <span className="font-semibold text-foreground">{q.label}</span>
                  <span
                    className={`font-bold ${
                      q.pnl > 0
                        ? "text-profit"
                        : q.pnl < 0
                        ? "text-loss"
                        : "text-foreground"
                    }`}
                  >
                    {formatPnlK(q.pnl)}
                  </span>
                  <span className="text-muted-foreground/40">|</span>
                  <span className="text-muted-foreground">{q.trades} trades</span>
                  <span className="text-muted-foreground/40">|</span>
                  <span className="text-muted-foreground">
                    {q.winRate !== null
                      ? `${q.winRate % 1 === 0 ? q.winRate.toFixed(0) : q.winRate.toFixed(1)}%`
                      : "0%"}{" "}
                    Winrate
                  </span>
                </Link>
              );
            })}

            {/* ROW 2: Header Labels */}
            <div className="rounded-md border border-border/40 bg-secondary/20 py-1 text-center text-[11px] font-medium text-muted-foreground">
              Year
            </div>
            {MONTH_LABELS.map((label) => (
              <div
                key={label}
                className="rounded-md border border-border/40 bg-secondary/20 py-1 text-center text-[11px] font-medium text-muted-foreground"
              >
                {label}
              </div>
            ))}

            {/* ROW 3: Year Card with Full-Year Stats (Matches Monthly Calendar Day Tile Style) */}
            <Link
              href={`/journal/year-${year}${search ? `?${search}` : ""}`}
              className={`flex min-h-[90px] flex-col items-center justify-center rounded-xl border p-1 text-center shadow-sm transition-all select-none ${
                yearHasTrades
                  ? yearIsPositive
                    ? "border-profit/25 bg-profit/10 hover:border-profit/40"
                    : yearIsNegative
                    ? "border-loss/25 bg-loss/10 hover:border-loss/40"
                    : "border-border/50 bg-secondary/50"
                  : "border-border/30 bg-secondary/50/80"
              }`}
            >
              <span className="text-xs font-bold text-foreground tracking-tight">{year}</span>
              {yearHasTrades ? (
                <>
                  {metric === "pnl" && (
                    <>
                      <span
                        className={`text-xs sm:text-sm font-bold tracking-tight mt-0.5 ${
                          yearTotal.pnl > 0
                            ? "text-profit"
                            : yearTotal.pnl < 0
                            ? "text-loss"
                            : "text-foreground"
                        }`}
                      >
                        {formatPnlK(yearTotal.pnl)}
                      </span>
                      <span className="mt-0.5 text-[10px] font-medium text-muted-foreground">
                        {yearTotal.trades} trades
                      </span>
                      {yearTotal.winRate !== null && (
                        <span className="text-[10px] font-medium text-muted-foreground">
                          {yearTotal.winRate % 1 === 0
                            ? yearTotal.winRate.toFixed(0)
                            : yearTotal.winRate.toFixed(1)}
                          %
                        </span>
                      )}
                    </>
                  )}

                  {metric === "winrate" && (
                    <>
                      <span
                        className={`text-xs sm:text-sm font-bold tracking-tight mt-0.5 ${
                          yearIsPositive ? "text-profit" : "text-loss"
                        }`}
                      >
                        {yearTotal.winRate !== null
                          ? `${yearTotal.winRate.toFixed(0)}%`
                          : "0%"}
                      </span>
                      <span className="mt-0.5 text-[10px] font-medium text-muted-foreground">
                        {yearTotal.trades} trades
                      </span>
                    </>
                  )}

                  {metric === "trades" && (
                    <>
                      <span className="text-sm sm:text-base font-bold tracking-tight mt-0.5 text-foreground">
                        {yearTotal.trades}
                      </span>
                      <span className="text-[10px] font-medium text-muted-foreground">
                        trades
                      </span>
                    </>
                  )}
                </>
              ) : (
                <span className="text-xs text-muted-foreground/50 mt-1">--</span>
              )}
            </Link>

            {/* ROW 3: 12 Month Cards (Exact Same Classes as Monthly Calendar Day Tiles) */}
            {months.map((m) => {
              const hasTrades = m.trades > 0;
              const monthStr = String(m.month).padStart(2, "0");
              const href = `/journal/month-${year}-${monthStr}${
                search ? `?${search}` : ""
              }`;

              if (!hasTrades) {
                return (
                  <Link
                    key={m.month}
                    href={href}
                    className="flex min-h-[90px] flex-col items-center justify-center rounded-xl border border-border/30 bg-secondary/50/80 text-xs font-medium text-muted-foreground/50 transition-all hover:border-border/60 hover:bg-secondary/20"
                  >
                    --
                  </Link>
                );
              }

              const isPositive =
                metric === "pnl"
                  ? m.pnl > 0
                  : metric === "winrate"
                  ? (m.winRate ?? 0) >= 50
                  : false;
              const isNegative =
                metric === "pnl"
                  ? m.pnl < 0
                  : metric === "winrate"
                  ? (m.winRate ?? 0) < 50
                  : false;

              const tileClasses =
                metric === "trades"
                  ? "border-border/50 bg-secondary/50 hover:bg-secondary/70"
                  : isPositive
                  ? "border-profit/25 bg-profit/10 hover:border-profit/40 hover:shadow-md"
                  : isNegative
                  ? "border-loss/25 bg-loss/10 hover:border-loss/40 hover:shadow-md"
                  : "border-border/40 bg-secondary/20 hover:border-border";

              const valueColor =
                metric === "trades"
                  ? "text-foreground"
                  : isPositive
                  ? "text-profit"
                  : isNegative
                  ? "text-loss"
                  : "text-foreground";

              return (
                <Link
                  key={m.month}
                  href={href}
                  className={`flex min-h-[90px] flex-col items-center justify-center rounded-xl border p-1 text-center shadow-sm transition-all hover:scale-[1.02] select-none ${tileClasses}`}
                >
                  {metric === "pnl" && (
                    <>
                      <span className={`text-xs sm:text-sm font-bold tracking-tight ${valueColor}`}>
                        {formatPnlK(m.pnl)}
                      </span>
                      <span className="mt-0.5 text-[10px] font-medium text-muted-foreground/90">
                        {m.trades} {m.trades === 1 ? "trade" : "trades"}
                      </span>
                      {m.winRate !== null && (
                        <span className="text-[10px] font-medium text-muted-foreground/80">
                          {m.winRate % 1 === 0 ? m.winRate.toFixed(0) : m.winRate.toFixed(1)}%
                        </span>
                      )}
                    </>
                  )}

                  {metric === "winrate" && (
                    <>
                      <span className={`text-xs sm:text-sm font-bold tracking-tight ${valueColor}`}>
                        {m.winRate !== null ? `${m.winRate.toFixed(0)}%` : "0%"}
                      </span>
                      <span className="mt-0.5 text-[10px] font-medium text-muted-foreground/90">
                        {m.trades} {m.trades === 1 ? "trade" : "trades"}
                      </span>
                    </>
                  )}

                  {metric === "trades" && (
                    <>
                      <span className="text-sm sm:text-base font-bold tracking-tight text-foreground">
                        {m.trades}
                      </span>
                      <span className="text-[10px] font-medium text-muted-foreground/90">
                        {m.trades === 1 ? "trade" : "trades"}
                      </span>
                    </>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function yearlyCalendarWidget() {
  return {
    id: "widget-yearly-calendar",
    label: "Yearly calendar",
    size: "full" as const,
    layoutGroup: "detail" as const,
    content: <YearlyCalendar />,
  };
}
