"use client";

import React, { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { CalendarMonth } from "@luxalgo/journal-core";
import {
  ChevronLeft,
  ChevronRight,
  BookOpen,
  Calendar as CalendarIcon,
  Crosshair,
} from "lucide-react";

interface TradeCalendarProps {
  calendar: CalendarMonth;
  currency?: string;
  compact?: boolean;
}

function formatPnl(amount: number, currency: string = "USD"): string {
  const sign = amount < 0 ? "-$" : amount > 0 ? "+$" : "$";
  const abs = Math.abs(amount);
  if (abs >= 1000) {
    return `${sign}${(abs / 1000).toFixed(2)}K`;
  }
  return `${sign}${abs.toFixed(amount % 1 === 0 ? 0 : 2)}`;
}

/**
 * Computes the Monday YYYY-MM-DD date for a given calendar week row (Sun..Sat)
 * so clicking a week card navigates to /journal/week-YYYY-MM-DD (e.g. week-2026-09-28).
 */
function getWeekMondayDate(days: Array<{ date: string } | null | undefined>): string | null {
  if (days[1]?.date) {
    return days[1].date;
  }
  for (let dIdx = 0; dIdx < days.length; dIdx++) {
    const d = days[dIdx];
    if (d?.date) {
      const dt = new Date(`${d.date}T00:00:00Z`);
      dt.setUTCDate(dt.getUTCDate() + (1 - dIdx));
      return dt.toISOString().slice(0, 10);
    }
  }
  return null;
}

export function TradeCalendar({
  calendar,
  currency = "USD",
  compact = false,
}: TradeCalendarProps) {
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const todayStr = new Date().toISOString().slice(0, 10);

  // Month navigation state
  const [selectedDate, setSelectedDate] = useState<{ year: number; month: number }>(() => ({
    year: calendar.year,
    month: calendar.month,
  }));
  const [fetchedCalendar, setFetchedCalendar] = useState<CalendarMonth | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Synchronize when parent prop changes
  useEffect(() => {
    setSelectedDate({ year: calendar.year, month: calendar.month });
    setFetchedCalendar(null);
  }, [calendar.year, calendar.month]);

  // Active calendar to render
  const activeCalendar = useMemo(() => {
    if (
      fetchedCalendar &&
      fetchedCalendar.year === selectedDate.year &&
      fetchedCalendar.month === selectedDate.month
    ) {
      return fetchedCalendar;
    }
    if (calendar.year === selectedDate.year && calendar.month === selectedDate.month) {
      return calendar;
    }
    return fetchedCalendar ?? calendar;
  }, [fetchedCalendar, calendar, selectedDate]);

  const monthLabel = useMemo(() => {
    return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(
      new Date(Date.UTC(selectedDate.year, selectedDate.month - 1, 1))
    );
  }, [selectedDate]);

  const monthKey = `${selectedDate.year}-${String(selectedDate.month).padStart(2, "0")}`;

  // Month navigation handlers
  const handleShift = async (delta: number) => {
    const next = new Date(Date.UTC(selectedDate.year, selectedDate.month - 1 + delta, 1));
    const nextYear = next.getUTCFullYear();
    const nextMonth = next.getUTCMonth() + 1;
    setSelectedDate({ year: nextYear, month: nextMonth });

    if (nextYear === calendar.year && nextMonth === calendar.month) {
      setFetchedCalendar(null);
      return;
    }

    setIsLoading(true);
    try {
      const q = new URLSearchParams(search);
      q.set("calYear", String(nextYear));
      q.set("calMonth", String(nextMonth));
      const res = await fetch(`/api/calendar?${q.toString()}`);
      if (res.ok) {
        const json = await res.json();
        if (json.calendar) setFetchedCalendar(json.calendar);
      }
    } catch (err) {
      console.error("Failed to load month calendar:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleThisMonth = async () => {
    const now = new Date();
    const thisYear = now.getFullYear();
    const thisMonth = now.getMonth() + 1;

    if (thisYear === calendar.year && thisMonth === calendar.month) {
      setSelectedDate({ year: thisYear, month: thisMonth });
      setFetchedCalendar(null);
      return;
    }

    setSelectedDate({ year: thisYear, month: thisMonth });
    setIsLoading(true);
    try {
      const q = new URLSearchParams(search);
      q.set("calYear", String(thisYear));
      q.set("calMonth", String(thisMonth));
      const res = await fetch(`/api/calendar?${q.toString()}`);
      if (res.ok) {
        const json = await res.json();
        if (json.calendar) setFetchedCalendar(json.calendar);
      }
    } catch (err) {
      console.error("Failed to load current month:", err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={`w-full space-y-3 ${isLoading ? "opacity-60 pointer-events-none" : ""}`}>
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 pb-2.5">
        {/* Month Selector */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          <button
            type="button"
            onClick={() => handleShift(-1)}
            disabled={isLoading}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-border/60 bg-secondary/30 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors disabled:opacity-50"
            aria-label="Previous month"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span className="text-xs sm:text-sm font-semibold tracking-tight min-w-[105px] text-center">
            {monthLabel}
          </span>
          <button
            type="button"
            onClick={() => handleShift(1)}
            disabled={isLoading}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-border/60 bg-secondary/30 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors disabled:opacity-50"
            aria-label="Next month"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={handleThisMonth}
            disabled={isLoading}
            className="rounded-md border border-border/60 bg-secondary/20 px-2 py-1 text-[11px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
          >
            This month
          </button>
        </div>

        {/* Right side: Stats chip & Monthly Journal Button */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-md border border-border/40 bg-secondary/20 px-2 py-1 text-[11px]">
            <span className="text-muted-foreground">Monthly stats:</span>
            <span
              className={`font-semibold ${
                activeCalendar.monthNetPnl > 0
                  ? "text-profit"
                  : activeCalendar.monthNetPnl < 0
                  ? "text-loss"
                  : "text-muted-foreground"
              }`}
            >
              {formatPnl(activeCalendar.monthNetPnl, currency)}
            </span>
            <span className="rounded bg-secondary border border-border/60 px-1.5 py-0.2 text-[9px] font-semibold text-foreground">
              {activeCalendar.tradingDays} {activeCalendar.tradingDays === 1 ? "day" : "days"}
            </span>
          </div>

          <Link
            href={`/journal/month-${monthKey}${search ? `?${search}` : ""}`}
            className="flex items-center gap-1 rounded-md border border-border/60 bg-secondary/40 px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-secondary"
          >
            <BookOpen className="h-3 w-3" />
            <span className="hidden sm:inline">Monthly Journal</span>
          </Link>
        </div>
      </div>

      {/* Main Grid: Days + Weekly Sidebar */}
      <div className="flex gap-2 sm:gap-3">
        {/* Days Grid */}
        <div className="flex-1 min-w-0">
          <div className="grid grid-cols-7 gap-1.5 sm:gap-2 mb-1.5">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
              <div
                key={day}
                className="py-1 text-center text-[11px] font-medium text-muted-foreground"
              >
                {day}
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-1.5 sm:gap-2">
            {activeCalendar.weeks.map((week, weekIdx) => (
              <div key={weekIdx} className="grid grid-cols-7 gap-1.5 sm:gap-2">
                {week.days.map((day, dayIdx) => {
                  if (!day) {
                    return (
                      <div
                        key={dayIdx}
                        className={`rounded-lg border border-transparent bg-transparent opacity-20 pointer-events-none ${
                          compact ? "min-h-[75px]" : "min-h-[110px]"
                        }`}
                      />
                    );
                  }

                  const hasTrades = day.trades > 0;
                  const isPositive = day.netPnl > 0;
                  const isNegative = day.netPnl < 0;
                  const isToday = day.date === todayStr;
                  const dayNum = Number(day.date.slice(8));

                  const rawWinRate = (day as any).winRate;
                  const rawWins = (day as any).wins;
                  const winRate =
                    typeof rawWinRate === "number"
                      ? rawWinRate <= 1
                        ? rawWinRate * 100
                        : rawWinRate
                      : typeof rawWins === "number" && day.trades > 0
                      ? (rawWins / day.trades) * 100
                      : null;

                  return (
                    <Link
                      key={day.date}
                      href={`/journal/${day.date}${search ? `?${search}` : ""}`}
                      className={`relative rounded-lg border transition-all select-none ${
                        compact ? "min-h-[75px] p-1.5" : "min-h-[110px] p-2.5"
                      } ${
                        hasTrades
                          ? isPositive
                            ? "cursor-pointer border-profit/25 bg-profit/10 hover:border-profit/40 hover:shadow-md"
                            : isNegative
                            ? "cursor-pointer border-loss/25 bg-loss/10 hover:border-loss/40 hover:shadow-md"
                            : "cursor-pointer border-border/40 bg-secondary/20 hover:border-border hover:bg-secondary/40"
                          : "cursor-pointer border-border/30 bg-secondary/50/80 hover:border-border/60 hover:bg-secondary/20"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span />
                        {isToday ? (
                          <span className="flex h-4 w-4 sm:h-5 sm:w-5 items-center justify-center rounded-full bg-secondary text-foreground border border-border font-semibold shadow-2xs text-[10px] sm:text-[11px] font-bold">
                            {dayNum}
                          </span>
                        ) : (
                          <span className="text-[10px] sm:text-xs font-semibold text-muted-foreground/80">
                            {dayNum}
                          </span>
                        )}
                      </div>

                      {hasTrades && (
                        <div className="mt-1 flex flex-col items-center justify-center text-center">
                          <span
                            className={`font-bold tracking-tight ${
                              compact ? "text-[11px] sm:text-xs" : "text-sm"
                            } ${
                              isPositive
                                ? "text-profit"
                                : isNegative
                                ? "text-loss"
                                : "text-muted-foreground"
                            }`}
                          >
                            {formatPnl(day.netPnl, currency)}
                          </span>
                          <span className="text-[9px] sm:text-[10px] text-muted-foreground/90">
                            {day.trades} {day.trades === 1 ? "trade" : "trades"}
                          </span>

                          {winRate !== null && (
                            <span className="text-[9px] font-medium text-muted-foreground/80">
                              {winRate.toFixed(0)}%
                            </span>
                          )}

                          {!compact && (
                            <div className="mt-1 flex items-center justify-center">
                              <Crosshair
                                className={`h-2.5 w-2.5 ${
                                  isPositive
                                    ? "text-profit/70"
                                    : isNegative
                                    ? "text-loss/70"
                                    : "text-muted-foreground/50"
                                }`}
                              />
                            </div>
                          )}
                        </div>
                      )}
                    </Link>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Weekly Summary Cards Sidebar */}
        <div
          className={`flex flex-col gap-1.5 sm:gap-2 ${
            compact ? "w-24 sm:w-28 pt-6" : "w-40 sm:w-44 pt-7"
          }`}
        >
          {activeCalendar.weeks.map((week, idx) => {
            const hasActivity = week.weekTrades > 0;
            const isPositive = week.weekNetPnl > 0;
            const isNegative = week.weekNetPnl < 0;
            const weekNum = idx + 1;
            const mondayDate = getWeekMondayDate(week.days);
            const weekHref = mondayDate
              ? `/journal/week-${mondayDate}${search ? `?${search}` : ""}`
              : `/journal${search ? `?${search}` : ""}`;

            return (
              <Link
                key={idx}
                href={weekHref}
                className={`group flex flex-col justify-between rounded-lg border p-2 cursor-pointer transition-all select-none ${
                  compact ? "min-h-[75px]" : "min-h-[110px]"
                } ${
                  hasActivity
                    ? isPositive
                      ? "border-profit/25 bg-profit/10 hover:border-profit/40 hover:shadow-md"
                      : isNegative
                      ? "border-loss/25 bg-loss/10 hover:border-loss/40 hover:shadow-md"
                      : "border-border/40 bg-secondary/20 hover:border-border hover:bg-secondary/40"
                    : "border-border/30 bg-secondary/50/80 hover:border-border/60 hover:bg-secondary/20"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] sm:text-xs font-semibold text-muted-foreground group-hover:text-foreground">
                    Week {weekNum}
                  </span>
                  <CalendarIcon className="h-2.5 w-2.5 sm:h-3 sm:w-3 text-muted-foreground/40 group-hover:text-muted-foreground" />
                </div>

                <div className="flex flex-col">
                  <span
                    className={`font-bold tracking-tight ${
                      compact ? "text-[11px] sm:text-xs" : "text-sm"
                    } ${
                      !hasActivity
                        ? "text-muted-foreground"
                        : isPositive
                        ? "text-profit"
                        : isNegative
                        ? "text-loss"
                        : "text-muted-foreground"
                    }`}
                  >
                    {hasActivity ? formatPnl(week.weekNetPnl, currency) : "$0"}
                  </span>
                  <span className="mt-0.5 inline-block text-[9px] sm:text-[10px] font-semibold text-muted-foreground">
                    {week.weekTrades} {week.weekTrades === 1 ? "trade" : "trades"}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Restored Bottom Monthly Stats Footer */}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs border-t border-border/30 pt-2">
        <span className="text-muted-foreground">
          {activeCalendar.tradingDays} trading days · {activeCalendar.winningDays} green
        </span>
        <span className="text-muted-foreground">
          Month:{" "}
          <span
            className={`font-semibold ${
              activeCalendar.monthNetPnl > 0
                ? "text-profit"
                : activeCalendar.monthNetPnl < 0
                ? "text-loss"
                : "text-muted-foreground"
            }`}
          >
            {formatPnl(activeCalendar.monthNetPnl, currency)}
          </span>
        </span>
      </div>
    </div>
  );
}
