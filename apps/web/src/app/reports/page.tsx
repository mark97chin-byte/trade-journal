"use client";

import React, { Suspense, useState, useRef, useEffect, useMemo } from "react";
import { FilterBar, useFilters } from "@/components/filter-bar";
import { ReportOverview } from "@/components/report-overview";
import { ReportDimensionView } from "@/components/reports/report-dimension-view";
import { WinsVsLossesView } from "@/components/reports/wins-vs-losses-view";
import { PerformanceView } from "@/components/reports/performance-view";
import { CompareView } from "@/components/reports/compare-view";
import { useApi } from "@/lib/use-api";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown, Check } from "lucide-react";

type MainTab =
  | "overview"
  | "day_time"
  | "symbols"
  | "strategies"
  | "tags"
  | "wins_vs_losses"
  | "performance"
  | "compare";

type DayTimeSubTab = "days" | "months" | "trade_time" | "trade_duration";

const REPORT_DROPDOWN_OPTIONS: { key: MainTab; label: string }[] = [
  { key: "day_time", label: "Day & Time" },
  { key: "symbols", label: "Symbols" },
  { key: "strategies", label: "Strategies" },
  { key: "tags", label: "Tags" },
  { key: "wins_vs_losses", label: "Wins vs Losses" },
];

const PRESET_LABELS: Record<string, string> = {
  "this-week": "Current week",
  "last-week": "Last week",
  "this-month": "Current month",
  "last-month": "Last month",
  "this-quarter": "Current quarter",
  "last-quarter": "Last quarter",
  "this-year": "Current year",
  ytd: "Current year",
  "last-year": "Last year",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  all: "All dates",
};

export default function ReportsPage() {
  return (
    <Suspense>
      <ReportsContent />
    </Suspense>
  );
}

function ReportsContent() {
  const { query, range, from, to } = useFilters();
  const { data, loading, error } = useApi<any>(`/api/reports/breakdown?${query}`);

  const [mainTab, setMainTab] = useState<MainTab>("overview");
  const [dayTimeSubTab, setDayTimeSubTab] = useState<DayTimeSubTab>("days");
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    if (dropdownOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [dropdownOpen]);

  const isReportsTabActive = [
    "day_time",
    "symbols",
    "strategies",
    "tags",
    "wins_vs_losses",
  ].includes(mainTab);

  const activeDropdownLabel =
    REPORT_DROPDOWN_OPTIONS.find((o) => o.key === mainTab)?.label ?? "Day & Time";

  const dateLabel = useMemo(() => {
    if (range && range !== "custom" && range !== "all" && PRESET_LABELS[range]) {
      return PRESET_LABELS[range];
    }
    if (from && to) return `${from} to ${to}`;
    if (from) return `From ${from}`;
    if (to) return `Until ${to}`;
    return "All dates";
  }, [range, from, to]);

  return (
    <>
      <FilterBar title="Reports" />

      <main className="mx-auto max-w-7xl px-4 py-5 space-y-5">
        {/* TOP TAB BAR: Overview -> Reports -> Performance -> Compare */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border/40 pb-3">
          {/* 1. Overview */}
          <button
            type="button"
            onClick={() => setMainTab("overview")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
              mainTab === "overview"
                ? "bg-[#4f46e5] text-white shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary/40"
            }`}
          >
            Overview
          </button>

          {/* 2. Reports Dropdown */}
          <div ref={dropdownRef} className="relative">
            <button
              type="button"
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                isReportsTabActive
                  ? "bg-[#4f46e5] text-white shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/40"
              }`}
            >
              <span>Reports{isReportsTabActive ? `: ${activeDropdownLabel}` : ""}</span>
              <ChevronDown className="h-3.5 w-3.5 ml-0.5" />
            </button>

            {dropdownOpen && (
              <div className="absolute left-0 top-full z-50 mt-1.5 w-48 rounded-xl border border-border/80 bg-[#161822] p-1.5 shadow-2xl animate-in fade-in-50 zoom-in-95">
                {REPORT_DROPDOWN_OPTIONS.map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => {
                      setMainTab(opt.key);
                      setDropdownOpen(false);
                    }}
                    className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-xs font-medium text-left transition-colors ${
                      mainTab === opt.key
                        ? "bg-[#4f46e5]/20 text-[#a5b4fc]"
                        : "text-muted-foreground hover:bg-secondary/40 hover:text-foreground"
                    }`}
                  >
                    <span>{opt.label}</span>
                    {mainTab === opt.key && <Check className="h-3.5 w-3.5 text-indigo-400" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 3. Performance */}
          <button
            type="button"
            onClick={() => setMainTab("performance")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
              mainTab === "performance"
                ? "bg-[#4f46e5] text-white shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary/40"
            }`}
          >
            Performance
          </button>

          {/* 4. Compare */}
          <button
            type="button"
            onClick={() => setMainTab("compare")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
              mainTab === "compare"
                ? "bg-[#4f46e5] text-white shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary/40"
            }`}
          >
            Compare
          </button>
        </div>

        {/* SUB-PILLS FOR DAY & TIME */}
        {mainTab === "day_time" && (
          <div className="flex items-center gap-1.5 rounded-lg border border-border/40 bg-[#161822] p-1 w-fit">
            {(
              [
                ["days", "days"],
                ["months", "months"],
                ["trade_time", "trade time"],
                ["trade_duration", "trade duration"],
              ] as const
            ).map(([subKey, label]) => (
              <button
                key={subKey}
                type="button"
                onClick={() => setDayTimeSubTab(subKey)}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-all ${
                  dayTimeSubTab === subKey
                    ? "bg-[#4f46e5] text-white shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {/* LOADING & ERROR STATES */}
        {loading && <Skeleton className="h-96 w-full rounded-xl" />}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        {/* CONTENT VIEWS */}
        {!loading && data && (
          <div>
            {mainTab === "overview" && <ReportOverview query={query} dateLabel={dateLabel} />}

            {mainTab === "day_time" && (
              <>
                {dayTimeSubTab === "days" && (
                  <ReportDimensionView
                    title="Days"
                    unitLabel="day"
                    data={data.days}
                    currency={data.currency}
                  />
                )}
                {dayTimeSubTab === "months" && (
                  <ReportDimensionView
                    title="Months"
                    unitLabel="month"
                    data={data.months}
                    currency={data.currency}
                  />
                )}
                {dayTimeSubTab === "trade_time" && (
                  <ReportDimensionView
                    title="Hours"
                    unitLabel="hour"
                    data={data.tradeTime}
                    currency={data.currency}
                  />
                )}
                {dayTimeSubTab === "trade_duration" && (
                  <ReportDimensionView
                    title="Trade durations"
                    unitLabel="trade duration"
                    data={data.tradeDuration}
                    currency={data.currency}
                  />
                )}
              </>
            )}

            {mainTab === "symbols" && (
              <ReportDimensionView
                title="Symbols"
                unitLabel="symbol"
                data={data.symbols}
                currency={data.currency}
              />
            )}

            {mainTab === "strategies" && (
              <ReportDimensionView
                title="Strategies"
                unitLabel="strategy"
                data={data.strategies}
                currency={data.currency}
              />
            )}

            {mainTab === "tags" && (
              <ReportDimensionView
                title="Tags"
                unitLabel="tag"
                data={data.tags}
                currency={data.currency}
              />
            )}

            {mainTab === "wins_vs_losses" && (
              <WinsVsLossesView
                data={data.winsVsLosses}
                dateLabel={dateLabel}
                currency={data.currency}
              />
            )}

            {mainTab === "performance" && (
              <PerformanceView
                trades={data.trades}
                performance={data.performance}
                currency={data.currency}
              />
            )}

            {mainTab === "compare" && (
              <CompareView dateLabel={dateLabel} globalQuery={query} />
            )}
          </div>
        )}
      </main>
    </>
  );
}
