"use client";

import React, { useState, useMemo, useRef, useEffect } from "react";
import {
  METRIC_DEFINITIONS,
  CATEGORIES,
  computeBucketValue,
  formatMetricDisplay,
  type MetricDef,
} from "./chart-metric-definitions";
import {
  BarChart2,
  ChevronDown,
  ChevronUp,
  Plus,
  Search,
  Settings,
  MoreVertical,
  X,
  Check,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useApi } from "@/lib/use-api";

export interface ActiveMetricConfig {
  id: string;
  key: string;
  chartType: "bar" | "line" | "area";
  color: string;
}

interface ReportMetricChartProps {
  dimension?: "weekday" | "hour" | "symbol";
  defaultMetrics?: { key: string; chartType: "bar" | "line" | "area"; color: string }[];
  trades?: any[];
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const PRESET_COLORS = ["#10b981", "#ef4444", "#3b82f6", "#8b5cf6", "#f59e0b", "#06b6d4"];

/** Calculate clean, round Y-axis tick intervals (e.g., -1000, -500, 0, 500, 1000) */
function calculateNiceScale(minVal: number, maxVal: number, isPercent = false) {
  if (isPercent) {
    const top = Math.min(100, Math.max(30, Math.ceil(maxVal / 10) * 10));
    const step = top <= 50 ? 10 : 20;
    const ticks: number[] = [];
    for (let t = 0; t <= top; t += step) ticks.push(t);
    return { min: 0, max: top, ticks };
  }

  let effMin = minVal < 0 ? minVal : 0;
  let effMax = maxVal > 0 ? maxVal : 0;

  if (effMin === 0 && effMax === 0) {
    return { min: 0, max: 10, ticks: [0, 2.5, 5, 7.5, 10] };
  }

  const range = effMax - effMin;
  const rawStep = range / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep || 1)));
  const norm = rawStep / mag;

  let stepMag = 1;
  if (norm < 1.5) stepMag = 1;
  else if (norm < 3.5) stepMag = 2;
  else if (norm < 7.5) stepMag = 5;
  else stepMag = 10;

  const step = stepMag * mag;
  const niceMin = Math.floor(effMin / step) * step;
  const niceMax = Math.ceil(effMax / step) * step;

  const ticks: number[] = [];
  for (let t = niceMin; t <= niceMax + step * 0.01; t += step) {
    ticks.push(Math.round(t * 100) / 100);
  }

  return { min: niceMin, max: niceMax, ticks };
}

/** Smooth cubic Bézier spline generator for TradeZella-style curves */
function buildSplinePath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M ${pts[0]!.x} ${pts[0]!.y}`;
  if (pts.length === 2) return `M ${pts[0]!.x} ${pts[0]!.y} L ${pts[1]!.x} ${pts[1]!.y}`;

  const path = [`M ${pts[0]!.x} ${pts[0]!.y}`];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[i + 2] ?? p2;

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    path.push(`C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`);
  }
  return path.join(" ");
}

export function ReportMetricChart({
  dimension = "weekday",
  defaultMetrics = [{ key: "winRate", chartType: "bar", color: "#10b981" }],
  trades: passedTrades,
}: ReportMetricChartProps) {
  const searchParams = useSearchParams();
  const search = searchParams.toString();

  const { data } = useApi<any>(`/api/stats?${search}`);
  const trades = useMemo(() => passedTrades ?? data?.recentTrades ?? [], [passedTrades, data]);

  // Unique metric state tracking
  const [activeMetrics, setActiveMetrics] = useState<ActiveMetricConfig[]>(() =>
    defaultMetrics.map((m, idx) => ({
      ...m,
      id: `${m.key}-${idx}-${Math.random().toString(36).slice(2, 7)}`,
    }))
  );

  const [editingMetricIndex, setEditingMetricIndex] = useState<number | null>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [openCategories, setOpenCategories] = useState<Record<string, boolean>>({
    Profitability: true,
    "Streaks & Consistency": true,
  });
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    }
    if (isDropdownOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isDropdownOpen]);

  // Aggregate trades into buckets
  const buckets = useMemo(() => {
    if (dimension === "weekday") {
      return WEEKDAYS.map((label, i) => {
        const bucketTrades = (trades as any[]).filter((t) => {
          const dateStr = t.closedAt ?? t.closeTime ?? t.openedAt;
          if (!dateStr) return false;
          const d = new Date(dateStr);
          return d.getUTCDay() === i;
        });
        return { label, trades: bucketTrades };
      });
    }
    return WEEKDAYS.map((label) => ({ label, trades: [] }));
  }, [trades, dimension]);

  // Calculate series data
  const seriesData = useMemo(() => {
    return activeMetrics.map((am) => {
      const def = METRIC_DEFINITIONS.find((d) => d.key === am.key) ?? METRIC_DEFINITIONS[0]!;
      const values = buckets.map((b) => computeBucketValue(am.key, b.trades));
      return { config: am, def, values };
    });
  }, [activeMetrics, buckets]);

  const primarySeries = seriesData[0];
  const secondarySeries = seriesData[1];

  // Primary Y-Axis calculations
  const primaryScale = useMemo(() => {
    if (!primarySeries) return { min: 0, max: 100, ticks: [0, 25, 50, 75, 100] };
    const minVal = Math.min(...primarySeries.values);
    const maxVal = Math.max(...primarySeries.values);
    return calculateNiceScale(minVal, maxVal, primarySeries.def.format === "percent");
  }, [primarySeries]);

  // Secondary Y-Axis calculations
  const secondaryScale = useMemo(() => {
    if (!secondarySeries) return { min: 0, max: 10, ticks: [0, 2.5, 5, 7.5, 10] };
    const minVal = Math.min(...secondarySeries.values);
    const maxVal = Math.max(...secondarySeries.values);
    return calculateNiceScale(minVal, maxVal, secondarySeries.def.format === "percent");
  }, [secondarySeries]);

  // Layout bounds
  const width = 800;
  const height = 300;
  const padLeft = 60;
  const padRight = secondarySeries ? 60 : 20;
  const padTop = 25;
  const padBottom = 35;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const getYPrimary = (val: number) => {
    const span = primaryScale.max - primaryScale.min || 1;
    return padTop + plotH - ((val - primaryScale.min) / span) * plotH;
  };

  const getYSecondary = (val: number) => {
    const span = secondaryScale.max - secondaryScale.min || 1;
    return padTop + plotH - ((val - secondaryScale.min) / span) * plotH;
  };

  const getX = (idx: number) => padLeft + (idx + 0.5) * (plotW / buckets.length);
  const zeroYPrimary = getYPrimary(0);
  const zeroYSecondary = getYSecondary(0);

  const handleSelectMetric = (metricDef: MetricDef) => {
    if (editingMetricIndex !== null) {
      setActiveMetrics((prev) =>
        prev.map((m, idx) =>
          idx === editingMetricIndex
            ? {
                ...m,
                key: metricDef.key,
                chartType: metricDef.defaultChartType,
                color: metricDef.defaultColor,
              }
            : m
        )
      );
    } else {
      if (activeMetrics.length < 2) {
        setActiveMetrics((prev) => [
          ...prev,
          {
            id: `${metricDef.key}-${Date.now()}`,
            key: metricDef.key,
            chartType: metricDef.defaultChartType,
            color: metricDef.defaultColor,
          },
        ]);
      }
    }
    setIsDropdownOpen(false);
  };

  const removeMetric = (indexToRemove: number) => {
    if (activeMetrics.length <= 1) return;
    setActiveMetrics((prev) => prev.filter((_, idx) => idx !== indexToRemove));
  };

  const filteredCategories = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return CATEGORIES.map((cat) => {
      const items = METRIC_DEFINITIONS.filter(
        (m) => m.category === cat && (!q || m.label.toLowerCase().includes(q))
      );
      return { cat, items };
    }).filter((g) => g.items.length > 0);
  }, [searchQuery]);

  return (
    <div className="relative w-full rounded-xl border border-border/40 bg-[#12141a] p-4 text-foreground shadow-sm">
      {/* HEADER CONTROLS */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/20 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/60 bg-secondary/20 text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <BarChart2 className="h-4 w-4" />
          </button>

          {activeMetrics.map((m, idx) => {
            const def = METRIC_DEFINITIONS.find((d) => d.key === m.key);
            return (
              <div
                key={m.id}
                className="group flex items-center rounded-lg border bg-[#161822] text-xs transition-colors hover:border-foreground/30"
                style={{ borderColor: `${m.color}80` }}
              >
                <button
                  type="button"
                  onClick={() => {
                    setEditingMetricIndex(idx);
                    setIsDropdownOpen(true);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 font-medium"
                >
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: m.color }} />
                  <span>{def?.label ?? m.key}</span>
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                </button>

                {activeMetrics.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeMetric(idx)}
                    className="pr-2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            );
          })}

          {activeMetrics.length < 2 && (
            <button
              type="button"
              onClick={() => {
                setEditingMetricIndex(null);
                setIsDropdownOpen(true);
              }}
              className="flex items-center gap-1 text-xs font-semibold text-[#818cf8] hover:text-[#a5b4fc] transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Add metric</span>
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => setIsSettingsOpen(!isSettingsOpen)}
          className="rounded p-1 text-muted-foreground/60 hover:text-foreground"
        >
          <MoreVertical className="h-4 w-4" />
        </button>
      </div>

      {/* DROPDOWN MENU */}
      {isDropdownOpen && (
        <div
          ref={dropdownRef}
          className="absolute left-6 top-16 z-50 w-72 sm:w-80 rounded-xl border border-border/80 bg-[#161822] p-3 shadow-2xl animate-in fade-in-50 zoom-in-95"
        >
          <div className="relative mb-3">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search"
              autoFocus
              className="h-8 w-full rounded-md border border-border/60 bg-[#0f1117] pl-8 pr-2.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <div className="max-h-80 overflow-y-auto space-y-1 pr-1">
            {filteredCategories.map(({ cat, items }) => {
              const isOpen = openCategories[cat] ?? false;
              return (
                <div key={cat} className="rounded-md">
                  <button
                    type="button"
                    onClick={() => setOpenCategories((prev) => ({ ...prev, [cat]: !isOpen }))}
                    className="flex w-full items-center justify-between px-2 py-1.5 text-xs font-semibold text-[#a5b4fc] hover:bg-secondary/30 rounded"
                  >
                    <span>{cat}</span>
                    {isOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </button>

                  {isOpen && (
                    <div className="space-y-0.5 pl-2 pt-1">
                      {items.map((m) => {
                        const isSelected = activeMetrics.some((am) => am.key === m.key);
                        return (
                          <button
                            key={m.key}
                            type="button"
                            onClick={() => handleSelectMetric(m)}
                            className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-xs text-left transition-colors ${
                              isSelected
                                ? "bg-indigo-600/30 text-indigo-300 font-medium"
                                : "text-muted-foreground hover:bg-secondary/40 hover:text-foreground"
                            }`}
                          >
                            <span>{m.label}</span>
                            {isSelected && <Check className="h-3 w-3 text-indigo-400" />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* SVG CHART */}
      <div className="relative mt-4 w-full select-none">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto overflow-visible">
          {/* Horizontal Grid lines aligned to Primary Scale */}
          {primaryScale.ticks.map((tickVal) => {
            const y = getYPrimary(tickVal);
            return (
              <g key={`grid-${tickVal}`}>
                <line
                  x1={padLeft}
                  y1={y}
                  x2={width - padRight}
                  y2={y}
                  stroke={tickVal === 0 ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.06)"}
                  strokeDasharray={tickVal === 0 ? undefined : "3 3"}
                  strokeWidth={tickVal === 0 ? 1 : 0.75}
                />
                <text x={padLeft - 8} y={y + 3.5} textAnchor="end" fontSize="10" fill="#71717a">
                  {formatMetricDisplay(tickVal, primarySeries?.def.format ?? "number")}
                </text>
              </g>
            );
          })}

          {/* Secondary Y Axis Ticks (Right Side) */}
          {secondarySeries &&
            secondaryScale.ticks.map((tickVal) => {
              const y = getYSecondary(tickVal);
              return (
                <text
                  key={`sec-tick-${tickVal}`}
                  x={width - padRight + 8}
                  y={y + 3.5}
                  textAnchor="start"
                  fontSize="10"
                  fill="#71717a"
                >
                  {formatMetricDisplay(tickVal, secondarySeries.def.format)}
                </text>
              );
            })}

          {/* PRIMARY METRIC */}
          {primarySeries && (
            <g>
              {/* Bars */}
              {primarySeries.config.chartType === "bar" &&
                primarySeries.values.map((val, idx) => {
                  const x = getX(idx) - 22;
                  const barW = 44;
                  const topY = getYPrimary(Math.max(val, 0));
                  const botY = getYPrimary(Math.min(val, 0));
                  const barH = Math.max(Math.abs(botY - topY), val !== 0 ? 3 : 0);
                  if (val === 0) return null;

                  return (
                    <rect
                      key={`bar-p-${idx}`}
                      x={x}
                      y={val >= 0 ? topY : zeroYPrimary}
                      width={barW}
                      height={barH}
                      rx="3"
                      fill={primarySeries.config.color}
                      opacity={hoveredIdx === idx ? 1 : 0.85}
                      className="cursor-pointer transition-opacity"
                      onMouseEnter={() => setHoveredIdx(idx)}
                      onMouseLeave={() => setHoveredIdx(null)}
                    />
                  );
                })}

              {/* Area */}
              {primarySeries.config.chartType === "area" && (
                <path
                  d={`${buildSplinePath(
                    buckets.map((_, idx) => ({ x: getX(idx), y: getYPrimary(primarySeries.values[idx]!) }))
                  )} L ${getX(buckets.length - 1)} ${zeroYPrimary} L ${getX(0)} ${zeroYPrimary} Z`}
                  fill={primarySeries.config.color}
                  fillOpacity="0.2"
                />
              )}

              {/* Smooth Line Curve */}
              {primarySeries.config.chartType !== "bar" && (
                <path
                  d={buildSplinePath(
                    buckets.map((_, idx) => ({ x: getX(idx), y: getYPrimary(primarySeries.values[idx]!) }))
                  )}
                  style={{
                    fill: "none",
                    stroke: primarySeries.config.color,
                    strokeWidth: 2.5,
                    strokeLinecap: "round",
                    strokeLinejoin: "round",
                  }}
                />
              )}

              {/* Data Point Circles */}
              {primarySeries.config.chartType !== "bar" &&
                primarySeries.values.map((val, idx) => (
                  <circle
                    key={`dot-p-${idx}`}
                    cx={getX(idx)}
                    cy={getYPrimary(val)}
                    r="4"
                    fill={primarySeries.config.color}
                    className="cursor-pointer"
                    onMouseEnter={() => setHoveredIdx(idx)}
                    onMouseLeave={() => setHoveredIdx(null)}
                  />
                ))}
            </g>
          )}

          {/* SECONDARY METRIC */}
          {secondarySeries && (
            <g>
              {/* Secondary Bars */}
              {secondarySeries.config.chartType === "bar" &&
                secondarySeries.values.map((val, idx) => {
                  const x = getX(idx) - 18;
                  const barW = 36;
                  const topY = getYSecondary(Math.max(val, 0));
                  const botY = getYSecondary(Math.min(val, 0));
                  const barH = Math.max(Math.abs(botY - topY), val !== 0 ? 3 : 0);
                  if (val === 0) return null;

                  return (
                    <rect
                      key={`bar-s-${idx}`}
                      x={x}
                      y={val >= 0 ? topY : zeroYSecondary}
                      width={barW}
                      height={barH}
                      rx="3"
                      fill={secondarySeries.config.color}
                      opacity={hoveredIdx === idx ? 1 : 0.85}
                      className="cursor-pointer"
                      onMouseEnter={() => setHoveredIdx(idx)}
                      onMouseLeave={() => setHoveredIdx(null)}
                    />
                  );
                })}

              {/* Secondary Area */}
              {secondarySeries.config.chartType === "area" && (
                <path
                  d={`${buildSplinePath(
                    buckets.map((_, idx) => ({ x: getX(idx), y: getYSecondary(secondarySeries.values[idx]!) }))
                  )} L ${getX(buckets.length - 1)} ${zeroYSecondary} L ${getX(0)} ${zeroYSecondary} Z`}
                  fill={secondarySeries.config.color}
                  fillOpacity="0.2"
                />
              )}

              {/* Secondary Smooth Line Curve */}
              {secondarySeries.config.chartType !== "bar" && (
                <path
                  d={buildSplinePath(
                    buckets.map((_, idx) => ({ x: getX(idx), y: getYSecondary(secondarySeries.values[idx]!) }))
                  )}
                  style={{
                    fill: "none",
                    stroke: secondarySeries.config.color,
                    strokeWidth: 2.5,
                    strokeLinecap: "round",
                    strokeLinejoin: "round",
                  }}
                />
              )}

              {/* Secondary Data Point Circles */}
              {secondarySeries.values.map((val, idx) => (
                <circle
                  key={`dot-s-${idx}`}
                  cx={getX(idx)}
                  cy={getYSecondary(val)}
                  r="4"
                  fill={secondarySeries.config.color}
                  className="cursor-pointer"
                  onMouseEnter={() => setHoveredIdx(idx)}
                  onMouseLeave={() => setHoveredIdx(null)}
                />
              ))}
            </g>
          )}

          {/* X Axis Labels */}
          {buckets.map((b, idx) => (
            <text key={`x-${b.label}`} x={getX(idx)} y={height - 10} textAnchor="middle" fontSize="11" fill="#a1a1aa">
              {b.label}
            </text>
          ))}
        </svg>

        {/* Hover Tooltip Overlay */}
        {hoveredIdx !== null && (
          <div
            className="pointer-events-none absolute rounded-md border border-border/80 bg-[#161822] p-2 text-xs shadow-xl"
            style={{
              left: `${(getX(hoveredIdx) / width) * 100}%`,
              top: "20%",
              transform: "translateX(-50%)",
            }}
          >
            <div className="font-semibold text-foreground mb-1">{buckets[hoveredIdx]?.label}</div>
            {seriesData.map((s) => (
              <div key={s.config.id} className="flex items-center gap-1.5 text-muted-foreground">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.config.color }} />
                <span>{s.def.label}:</span>
                <span className="font-medium text-foreground">
                  {formatMetricDisplay(s.values[hoveredIdx]!, s.def.format)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* FOOTER: UNIQUE LEGEND & SETTINGS BUTTON */}
      <div className="mt-3 flex items-center justify-between border-t border-border/20 pt-3">
        <div className="flex flex-wrap items-center gap-4 text-xs">
          {activeMetrics.map((m) => {
            const def = METRIC_DEFINITIONS.find((d) => d.key === m.key);
            return (
              <div key={m.id} className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: m.color }} />
                <span className="text-muted-foreground">{def?.label ?? m.key}</span>
              </div>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => setIsSettingsOpen(!isSettingsOpen)}
          className="rounded-md border border-border/60 bg-secondary/20 p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
          title="Customize chart & colors"
        >
          <Settings className="h-4 w-4" />
        </button>
      </div>

      {/* SETTINGS DRAWER */}
      {isSettingsOpen && (
        <div className="mt-3 rounded-lg border border-border/60 bg-[#161822] p-3 text-xs space-y-3 animate-in fade-in-50">
          <div className="font-semibold text-foreground">Chart Customization</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {activeMetrics.map((m, idx) => {
              const def = METRIC_DEFINITIONS.find((d) => d.key === m.key);
              return (
                <div key={m.id} className="space-y-2 rounded border border-border/40 p-2">
                  <div className="font-medium text-foreground">{def?.label}</div>

                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground text-[11px]">Type:</span>
                    {(["bar", "line", "area"] as const).map((type) => (
                      <button
                        key={type}
                        type="button"
                        onClick={() =>
                          setActiveMetrics((prev) =>
                            prev.map((item, i) => (i === idx ? { ...item, chartType: type } : item))
                          )
                        }
                        className={`rounded px-2 py-0.5 text-[10px] uppercase font-semibold ${
                          m.chartType === type
                            ? "bg-indigo-600 text-white"
                            : "bg-secondary/40 text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {type}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-1.5 pt-1">
                    <span className="text-muted-foreground text-[11px]">Color:</span>
                    {PRESET_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() =>
                          setActiveMetrics((prev) =>
                            prev.map((item, i) => (i === idx ? { ...item, color: c } : item))
                          )
                        }
                        className={`h-4 w-4 rounded-full border ${
                          m.color === c ? "border-white scale-110" : "border-transparent"
                        }`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
