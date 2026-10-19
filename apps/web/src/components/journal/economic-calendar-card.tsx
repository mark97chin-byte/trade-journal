"use client";

import React, { useEffect, useState, useMemo } from "react";
import { CalendarClock, Filter, RefreshCw, ExternalLink } from "lucide-react";

export interface EconomicEvent {
  id: string;
  date: string;
  time: string;
  timestampIso: string;
  country: string;
  impact: string;
  title: string;
  forecast: string;
  previous: string;
  actual: string;
}

interface EconomicCalendarCardProps {
  periodType: "day" | "week" | "month" | "quarter" | "year";
  startDate: string;
  endDate: string;
  anchorDate: string;
}

interface BadgeStyle {
  dot: string;
  bg: string;
  label: string;
}

const DEFAULT_BADGE: BadgeStyle = {
  dot: "bg-yellow-300",
  bg: "border-yellow-500/25 bg-yellow-500/10 text-yellow-200",
  label: "Low",
};

const IMPACT_BADGE: Record<string, BadgeStyle> = {
  High: {
    dot: "bg-rose-500 shadow-[0_0_6px_#f43f5e]",
    bg: "border-rose-500/30 bg-rose-500/10 text-rose-300",
    label: "High",
  },
  Medium: {
    dot: "bg-amber-500 shadow-[0_0_6px_#f59e0b]",
    bg: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    label: "Med",
  },
  Low: DEFAULT_BADGE,
  Holiday: {
    dot: "bg-slate-400",
    bg: "border-slate-500/30 bg-slate-500/10 text-slate-300",
    label: "Bank",
  },
};

function formatDayLabel(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  if (isNaN(d.getTime())) return dateStr;
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(d);
}

function getForexFactoryUrl(anchorDate: string): string {
  const d = new Date(`${anchorDate}T12:00:00Z`);
  if (isNaN(d.getTime())) return "https://www.forexfactory.com/calendar";
  const monthNames = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const m = monthNames[d.getUTCMonth()];
  const day = d.getUTCDate();
  const yr = d.getUTCFullYear();
  return `https://www.forexfactory.com/calendar?week=${m}${day}.${yr}`;
}

function isEventPassed(ev: EconomicEvent): boolean {
  if (ev.timestampIso) {
    const evTime = new Date(ev.timestampIso).getTime();
    if (!isNaN(evTime) && !ev.timestampIso.endsWith("T12:00:00.000Z") && !ev.timestampIso.endsWith("T12:00:00Z")) {
      return Date.now() > evTime;
    }
  }

  const todayNy = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  if (ev.date < todayNy) return true;
  if (ev.date > todayNy) return false;

  const m = ev.time.match(/(\d+):(\d+)(am|pm)/i);
  if (!m || !m[1] || !m[2] || !m[3]) return false;
  let hr = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const ampm = m[3].toLowerCase();
  if (ampm === "pm" && hr < 12) hr += 12;
  if (ampm === "am" && hr === 12) hr = 0;

  const nyTimeStr = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).format(new Date());

  const [curHrStr, curMinStr] = nyTimeStr.split(":");
  const curHr = parseInt(curHrStr || "0", 10);
  const curMin = parseInt(curMinStr || "0", 10);

  if (curHr > hr) return true;
  if (curHr === hr && curMin >= min) return true;
  return false;
}

export function EconomicCalendarCard({
  periodType,
  startDate,
  endDate,
  anchorDate,
}: EconomicCalendarCardProps) {
  const [events, setEvents] = useState<EconomicEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  // Default filters: USD only, High + Medium + Holiday ON, Low OFF
  const [selectedCurrencies, setSelectedCurrencies] = useState<string[]>(["USD"]);
  const [selectedImpacts, setSelectedImpacts] = useState<string[]>([
    "High",
    "Medium",
    "Holiday",
  ]);

  const queryRange = useMemo(() => {
    if (periodType === "day") {
      return { start: anchorDate, end: anchorDate };
    }
    return {
      start: startDate || anchorDate,
      end: endDate || anchorDate,
    };
  }, [periodType, startDate, endDate, anchorDate]);

  const fetchEvents = async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/calendar/economic?start=${queryRange.start}&end=${queryRange.end}`
      );
      const data = await res.json();
      if (Array.isArray(data.events)) {
        setEvents(data.events);
      }
    } catch {
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (periodType === "day" || periodType === "week") {
      void fetchEvents();
    }
  }, [queryRange.start, queryRange.end, periodType]);

  if (periodType !== "day" && periodType !== "week") {
    return null;
  }

  const toggleCurrency = (curr: string) => {
    if (curr === "ALL") {
      setSelectedCurrencies(["ALL"]);
      return;
    }
    setSelectedCurrencies((prev) => {
      const withoutAll = prev.filter((c) => c !== "ALL");
      if (withoutAll.includes(curr)) {
        const next = withoutAll.filter((c) => c !== curr);
        return next.length ? next : ["USD"];
      }
      return [...withoutAll, curr];
    });
  };

  const toggleImpact = (imp: string) => {
    setSelectedImpacts((prev) =>
      prev.includes(imp) ? prev.filter((i) => i !== imp) : [...prev, imp]
    );
  };

  const filteredEvents = useMemo(() => {
    return events.filter((ev) => {
      const currMatch =
        selectedCurrencies.includes("ALL") ||
        selectedCurrencies.includes(ev.country.toUpperCase());
      const impMatch = selectedImpacts.some(
        (i) => i.toLowerCase() === ev.impact.toLowerCase()
      );
      return currMatch && impMatch;
    });
  }, [events, selectedCurrencies, selectedImpacts]);

  const groupedByDate = useMemo(() => {
    const map = new Map<string, EconomicEvent[]>();
    for (const ev of filteredEvents) {
      const list = map.get(ev.date) || [];
      list.push(ev);
      map.set(ev.date, list);
    }
    return Array.from(map.entries());
  }, [filteredEvents]);

  return (
    <div className="rounded-xl border border-border/70 bg-[#12141d] p-4 shadow-sm space-y-3">
      <div className="flex items-center justify-between border-b border-slate-200 dark:border-border/40 pb-2.5">
        <div className="flex items-center gap-2">
          <CalendarClock className="w-4 h-4 text-amber-400" />
          <h3 className="text-sm font-bold text-foreground">
            Economic Calendar
          </h3>
          <span className="rounded bg-secondary/80 px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
            {selectedCurrencies.includes("ALL")
              ? "ALL"
              : selectedCurrencies.join("+")}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setShowFilters((s) => !s)}
            className={`p-1 rounded-md text-xs transition ${
              showFilters
                ? "bg-indigo-600/20 text-indigo-300 border border-indigo-500/40"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
            }`}
            title="Filter Currency & Impact"
          >
            <Filter className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={fetchEvents}
            disabled={loading}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition"
            title="Refresh Live Calendar"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
          <a
            href={getForexFactoryUrl(anchorDate)}
            target="_blank"
            rel="noreferrer"
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition"
            title="Open week on ForexFactory.com"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      {/* FILTER DRAWER */}
      {showFilters && (
        <div className="rounded-lg border border-border/50 bg-[#161924] p-2.5 space-y-2 text-[11px]">
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-muted-foreground mr-1 font-medium">Currency:</span>
            {["USD", "EUR", "GBP", "JPY", "CAD", "AUD", "ALL"].map((c) => {
              const active = selectedCurrencies.includes(c);
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => toggleCurrency(c)}
                  className={`px-2 py-0.5 rounded font-semibold transition ${
                    active
                      ? "bg-indigo-600 text-white"
                      : "bg-secondary/50 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {c}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-muted-foreground mr-1 font-medium">Impact:</span>
            {[
              { id: "High", label: "High 🔴" },
              { id: "Medium", label: "Med 🟠" },
              { id: "Low", label: "Low 🟡" },
              { id: "Holiday", label: "Holiday ⚪" },
            ].map((imp) => {
              const active = selectedImpacts.includes(imp.id);
              return (
                <button
                  key={imp.id}
                  type="button"
                  onClick={() => toggleImpact(imp.id)}
                  className={`px-2 py-0.5 rounded font-semibold transition ${
                    active
                      ? "bg-secondary text-foreground border border-border"
                      : "bg-transparent text-muted-foreground/50 border border-transparent hover:text-muted-foreground"
                  }`}
                >
                  {imp.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* REAL-TIME EVENTS LIST */}
      <div className="max-h-72 overflow-y-auto space-y-2.5 pr-1">
        {loading && events.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
            <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-400" />
            <span>Loading live economic events...</span>
          </div>
        ) : groupedByDate.length === 0 ? (
          <div className="py-5 text-center text-xs text-muted-foreground border border-dashed border-border/40 rounded-lg px-3">
            <div>
              No {selectedCurrencies.join("/")} high/medium impact events scheduled for {queryRange.start}
              {queryRange.end !== queryRange.start ? ` – ${queryRange.end}` : ""}.
            </div>
          </div>
        ) : (
          groupedByDate.map(([dateStr, dayEvents]) => (
            <div key={dateStr} className="space-y-1">
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground bg-secondary/30 px-2 py-0.5 rounded">
                {formatDayLabel(dateStr)}
              </div>
              <div className="divide-y divide-border/20">
                {dayEvents.map((ev) => {
                  const badge: BadgeStyle = IMPACT_BADGE[ev.impact] ?? DEFAULT_BADGE;
                  const passed = isEventPassed(ev);

                  return (
                    <div
                      key={ev.id}
                      className={`flex items-start justify-between gap-2 py-1.5 px-1 text-xs rounded transition-all ${
                        passed
                          ? "opacity-45 hover:opacity-85 bg-white/[0.01]"
                          : "hover:bg-white/[0.02]"
                      }`}
                    >
                      <div className="flex items-start gap-2 min-w-0">
                        {/* Dot always keeps its impact color badge (Red 🔴 for High, Orange 🟠 for Medium) */}
                        <span
                          className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${badge.dot} ${
                            passed ? "ring-1 ring-white/10" : ""
                          }`}
                          title={`${ev.impact} Impact${passed ? " (Concluded)" : ""}`}
                        />
                        <div className="min-w-0">
                          <div
                            className={`font-medium leading-tight truncate ${
                              passed ? "text-zinc-400" : "text-foreground"
                            }`}
                          >
                            {ev.title}
                          </div>
                          <div className="text-[10px] text-muted-foreground flex items-center gap-2 mt-0.5">
                            <span
                              className={`font-mono ${
                                passed ? "text-zinc-500" : "text-zinc-300"
                              }`}
                            >
                              {ev.time}
                            </span>
                            <span className="font-semibold text-foreground/70">
                              {ev.country}
                            </span>
                            {passed && (
                              <span className="text-[9px] px-1 rounded bg-zinc-800 text-zinc-400 font-normal">
                                Passed
                              </span>
                            )}
                            {ev.forecast && <span>Fcst: {ev.forecast}</span>}
                            {ev.previous && <span>Prev: {ev.previous}</span>}
                          </div>
                        </div>
                      </div>

                      {ev.actual && (
                        <span
                          className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
                            passed
                              ? "bg-zinc-800/80 text-zinc-300 border border-zinc-700/50"
                              : "bg-secondary text-emerald-400"
                          }`}
                        >
                          {ev.actual}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
