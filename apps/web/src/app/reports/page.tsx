"use client";

import { StrategyRulesCard } from "@/components/reports/strategy-rules-card";
import React, { Suspense, useState, useRef, useEffect, useMemo } from "react";
import { FilterBar, useFilters } from "@/components/filter-bar";
import { ReportOverview } from "@/components/report-overview";
import { ReportDimensionView } from "@/components/reports/report-dimension-view";
import { WinsVsLossesView } from "@/components/reports/wins-vs-losses-view";
import { PerformanceView } from "@/components/reports/performance-view";
import { CompareView } from "@/components/reports/compare-view";
import { MissedTradesReportView } from "@/components/reports/missed-trades-report-view";
import { ContentManagementView } from "@/components/tags/content-management-view";
import { useApi } from "@/lib/use-api";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown, Check, Tags } from "lucide-react";

type MainTab =
  | "overview"
  | "day_time"
  | "symbols"
  | "strategies"
  | "tags"
  | "wins_vs_losses"
  | "performance"
  | "compare"
  | "missed_opportunity"
  | "content_management";

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
  const [selectedTagCategory, setSelectedTagCategory] = useState<string>("all");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [catDropdownOpen, setCatDropdownOpen] = useState(false);

  const dropdownRef = useRef<HTMLDivElement>(null);
  const catDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
      if (catDropdownRef.current && !catDropdownRef.current.contains(e.target as Node)) {
        setCatDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const isReportsTabActive = [
    "day_time",
    "symbols",
    "strategies",
    "tags",
    "wins_vs_losses",
  ].includes(mainTab);

  const activeDropdownLabel =
    mainTab === "content_management"
      ? "Tags"
      : REPORT_DROPDOWN_OPTIONS.find((o) => o.key === mainTab)?.label ?? "Day & Time";

  const dateLabel = useMemo(() => {
    if (range && range !== "custom" && range !== "all" && PRESET_LABELS[range]) {
      return PRESET_LABELS[range];
    }
    if (from && to) return `${from} to ${to}`;
    if (from) return `From ${from}`;
    if (to) return `Until ${to}`;
    return "All dates";
  }, [range, from, to]);

  const activeTagsData = useMemo(() => {
    if (!data?.tags) return null;
    if (selectedTagCategory === "all") return data.tags;
    if (selectedTagCategory === "by_category") return data.tags.categoryRollup;
    return data.tags.byCategory?.[selectedTagCategory] ?? data.tags;
  }, [data, selectedTagCategory]);

  const activeCategoryObj = useMemo(() => {
    if (!data?.tagCategories) return null;
    return (
      data.tagCategories.find(
        (c: { id: string; name: string; color: string }) => c.id === selectedTagCategory
      ) ?? null
    );
  }, [data, selectedTagCategory]);

  return (
    <>
      <FilterBar title="Reports" />

      <main className="mx-auto max-w-7xl px-4 py-5 space-y-5">
        {/* TOP TAB BAR */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-border/40 pb-3">
          <div className="flex flex-wrap items-center gap-2">
            {/* 1. Overview */}
            <button
              type="button"
              onClick={() => setMainTab("overview")}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                mainTab === "overview"
                  ? "bg-secondary text-foreground font-semibold border border-border text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-slate-100/90 dark:bg-secondary/40"
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
                  isReportsTabActive || mainTab === "content_management"
                    ? "bg-secondary text-foreground font-semibold border border-border text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-slate-100/90 dark:bg-secondary/40"
                }`}
              >
                <span>
                  Reports
                  {isReportsTabActive || mainTab === "content_management"
                    ? `: ${activeDropdownLabel}`
                    : ""}
                </span>
                <ChevronDown className="h-3.5 w-3.5 ml-0.5" />
              </button>

              {dropdownOpen && (
                <div className="absolute left-0 top-full z-50 mt-1.5 w-48 rounded-xl border border-border/80 bg-slate-50 dark:bg-card p-1.5 shadow-2xl animate-in fade-in-50 zoom-in-95">
                  {REPORT_DROPDOWN_OPTIONS.map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => {
                        setMainTab(opt.key);
                        setDropdownOpen(false);
                      }}
                      className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-xs font-medium text-left transition-colors ${
                        mainTab === opt.key ||
                        (mainTab === "content_management" && opt.key === "tags")
                          ? "bg-secondary text-foreground font-semibold border border-border/20 text-[#a5b4fc]"
                          : "text-muted-foreground hover:bg-slate-100/90 dark:bg-secondary/40 hover:text-foreground"
                      }`}
                    >
                      <span>{opt.label}</span>
                      {(mainTab === opt.key ||
                        (mainTab === "content_management" && opt.key === "tags")) && (
                        <Check className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
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
                  ? "bg-secondary text-foreground font-semibold border border-border text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-slate-100/90 dark:bg-secondary/40"
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
                  ? "bg-secondary text-foreground font-semibold border border-border text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-slate-100/90 dark:bg-secondary/40"
              }`}
            >
              Compare
            </button>

            {/* 5. Missed trades */}
            <button
              type="button"
              onClick={() => setMainTab("missed_opportunity")}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                mainTab === "missed_opportunity"
                  ? "bg-secondary text-foreground font-semibold border border-border shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-slate-100/90 dark:bg-secondary/40"
              }`}
            >
              Missed trades
            </button>
          </div>

          {/* Right: Categories & Tags button — ONLY visible when in Reports: Tags */}
          {(mainTab === "tags" || mainTab === "content_management") && (
            <button
              type="button"
              onClick={() =>
                setMainTab(mainTab === "content_management" ? "tags" : "content_management")
              }
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all ${
                mainTab === "content_management"
                  ? "border-indigo-500 bg-secondary text-foreground font-semibold border border-border text-foreground shadow-sm"
                  : "border-border/60 bg-slate-50 dark:bg-card text-muted-foreground hover:text-foreground hover:bg-slate-100/90 dark:bg-secondary/40"
              }`}
            >
              <Tags className="h-3.5 w-3.5" />
              <span>Categories & Tags</span>
            </button>
          )}
        </div>

        {/* SUB-PILLS FOR DAY & TIME */}
        {mainTab === "day_time" && (
          <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-border/40 bg-slate-50 dark:bg-card p-1 w-fit">
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
                    ? "bg-secondary text-foreground font-semibold border border-border text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {/* COMPACT CONTROLS FOR TAGS REPORT (Pills + Category Dropdown Menu) */}
        {mainTab === "tags" && data?.tagCategories && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-border/40 bg-slate-50 dark:bg-card p-1">
              <button
                type="button"
                onClick={() => setSelectedTagCategory("all")}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-all ${
                  selectedTagCategory === "all"
                    ? "bg-secondary text-foreground font-semibold border border-border text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                All tags
              </button>

              <button
                type="button"
                onClick={() => setSelectedTagCategory("by_category")}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-all ${
                  selectedTagCategory === "by_category"
                    ? "bg-secondary text-foreground font-semibold border border-border text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Compare categories
              </button>
            </div>

            {/* Category Dropdown Menu */}
            <div ref={catDropdownRef} className="relative">
              <button
                type="button"
                onClick={() => setCatDropdownOpen(!catDropdownOpen)}
                className={`flex h-8 items-center gap-2 rounded-lg border px-3 text-xs font-medium transition-colors ${
                  activeCategoryObj
                    ? "border-indigo-500/60 bg-secondary text-foreground font-semibold border border-border/20 text-foreground"
                    : "border-border/50 bg-slate-50 dark:bg-card text-muted-foreground hover:text-foreground"
                }`}
              >
                {activeCategoryObj ? (
                  <>
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: activeCategoryObj.color }}
                    />
                    <span>{activeCategoryObj.name}</span>
                  </>
                ) : (
                  <span>Filter by category</span>
                )}
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              </button>

              {catDropdownOpen && (
                <div className="absolute left-0 top-full z-50 mt-1.5 w-56 rounded-xl border border-border/80 bg-slate-50 dark:bg-card p-1.5 shadow-2xl animate-in fade-in-50 zoom-in-95">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedTagCategory("all");
                      setCatDropdownOpen(false);
                    }}
                    className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs font-medium text-left transition-colors ${
                      selectedTagCategory === "all"
                        ? "bg-secondary text-foreground font-semibold border border-border/20 text-[#a5b4fc]"
                        : "text-muted-foreground hover:bg-slate-100/90 dark:bg-secondary/40 hover:text-foreground"
                    }`}
                  >
                    <span>All categories</span>
                    {selectedTagCategory === "all" && (
                      <Check className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </button>

                  <div className="my-1 border-t border-border/30" />

                  <div className="max-h-64 overflow-y-auto space-y-0.5">
                    {data.tagCategories.map(
                      (cat: { id: string; name: string; color: string }) => (
                        <button
                          key={cat.id}
                          type="button"
                          onClick={() => {
                            setSelectedTagCategory(cat.id);
                            setCatDropdownOpen(false);
                          }}
                          className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs font-medium text-left transition-colors ${
                            selectedTagCategory === cat.id
                              ? "bg-secondary text-foreground font-semibold border border-border/20 text-[#a5b4fc]"
                              : "text-muted-foreground hover:bg-slate-100/90 dark:bg-secondary/40 hover:text-foreground"
                          }`}
                        >
                          <div className="flex items-center gap-2 truncate">
                            <span
                              className="h-2 w-2 rounded-full shrink-0"
                              style={{ backgroundColor: cat.color }}
                            />
                            <span className="truncate">{cat.name}</span>
                          </div>
                          {selectedTagCategory === cat.id && (
                            <Check className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          )}
                        </button>
                      )
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* CONTENT MANAGEMENT TAB */}
        {mainTab === "content_management" && <ContentManagementView />}

        {/* LOADING & ERROR STATES */}
        {mainTab !== "content_management" && loading && (
          <Skeleton className="h-96 w-full rounded-xl" />
        )}
        {mainTab !== "content_management" && error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        {/* REPORT CONTENT VIEWS */}
        {mainTab !== "content_management" && !loading && data && (
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
                extraSection={
                  <StrategyRulesCard
                    trades={data.trades}
                    ruleAnalysis={data.strategyRules}
                  />
                }
              />
            )}

            {mainTab === "tags" && activeTagsData && (
              <ReportDimensionView
                title={selectedTagCategory === "by_category" ? "Categories" : "Tags"}
                unitLabel={selectedTagCategory === "by_category" ? "category" : "tag"}
                data={activeTagsData}
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

            {mainTab === "missed_opportunity" && (
              <MissedTradesReportView query={query} />
            )}
          </div>
        )}
      </main>
    </>
  );
}
