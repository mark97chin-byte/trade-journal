"use client";

import { useMemo, useState, useRef } from "react";
import type { MarketBar } from "@/lib/market-data";
import { formatTimestamp } from "@/lib/timezone";
import { fmtMoney, fmtNumber } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export interface RunningPnlChartProps {
  trade: {
    key: string;
    symbol: string;
    direction: "long" | "short" | string;
    openedAt: string;
    closedAt: string | null;
    quantity: number;
    avgEntry: number;
    avgExit: number | null;
    grossPnl: number;
    netPnl: number;
    currency: string;
    contractMultiplier?: number | null;
  };
  executions: {
    id: string;
    side: "buy" | "sell";
    quantity: number;
    price: number;
    executedAt: string;
    reason?: string;
    pnl?: number;
  }[];
  bars?: MarketBar[];
  timeZone?: string;
  height?: number;
}

interface Point {
  time: number;
  isoTime: string;
  timeLabel: string;
  runningPnl: number;
  holdPnl: number;
  price: number;
  activeQty: number;
  exitMarker?: {
    reason: string;
    quantity: number;
    pnl?: number;
    price: number;
  };
}

const formatSignedMoney = (val: number, currency?: string) => {
  const formatted = fmtMoney(val, currency);
  if (val > 0) {
    return formatted.startsWith("+") ? formatted : `+${formatted}`;
  }
  return formatted;
};

export function RunningPnlChart({
  trade,
  executions,
  bars = [],
  timeZone = "America/New_York",
  height = 220,
}: RunningPnlChartProps) {
  const isShort =
    trade.direction.toLowerCase() === "short" || trade.direction.toLowerCase() === "sell";
  const openMs = Date.parse(trade.openedAt);
  const closeMs = trade.closedAt ? Date.parse(trade.closedAt) : Date.now();

  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // 1. Calculate effective contract multiplier for the instrument
  const multiplier = useMemo(() => {
    let mult = trade.contractMultiplier || 1;
    const totalExitDelta = Math.abs((trade.avgExit ?? trade.avgEntry) - trade.avgEntry);
    if (totalExitDelta > 0 && trade.quantity > 0 && Math.abs(trade.grossPnl) > 0) {
      const implied = Math.abs(trade.grossPnl) / (totalExitDelta * trade.quantity);
      if (Number.isFinite(implied) && implied > 0) {
        mult = implied;
      }
    }
    return mult;
  }, [trade]);

  // 2. Identify exit fills
  const exitFills = useMemo(() => {
    return executions
      .filter((e) => e.side === (isShort ? "buy" : "sell"))
      .sort((a, b) => Date.parse(a.executedAt) - Date.parse(b.executedAt));
  }, [executions, isShort]);

  // 3. Generate minute-by-minute simulation points
  const points = useMemo<Point[]>(() => {
    if (!bars || bars.length === 0) {
      // Fallback if candles haven't arrived yet: plot basic executions
      let cum = 0;
      return exitFills.map((ex) => {
        cum += ex.pnl || 0;
        return {
          time: Date.parse(ex.executedAt),
          isoTime: ex.executedAt,
          timeLabel: formatTimestamp(ex.executedAt, timeZone).slice(11, 16),
          runningPnl: cum,
          holdPnl: cum,
          price: ex.price,
          activeQty: 0,
          exitMarker: {
            reason: ex.reason || "TP",
            quantity: ex.quantity,
            pnl: ex.pnl,
            price: ex.price,
          },
        };
      });
    }

    // Filter bars to the exact trade window
    const tradeBars = bars.filter(
      (b) => b.time >= openMs - 60_000 && b.time <= closeMs + 60_000
    );
    if (tradeBars.length === 0) return [];

    const pts: Point[] = [];
    const usedExits = new Set<string>();

    for (let i = 0; i < tradeBars.length; i++) {
      const b = tradeBars[i]!;
      const t = b.time;

      // Find all exits that happened up to this bar time (+30s threshold)
      const pastExits = exitFills.filter(
        (e) => Date.parse(e.executedAt) <= t + 30_000
      );
      const realizedPnl = pastExits.reduce((acc, e) => acc + (e.pnl || 0), 0);
      const closedQty = pastExits.reduce((acc, e) => acc + e.quantity, 0);
      const activeQty = Math.max(0, trade.quantity - closedQty);

      // Price delta from entry
      const priceDelta = isShort ? trade.avgEntry - b.close : b.close - trade.avgEntry;
      const floatingUnrealized = activeQty * priceDelta * multiplier;
      const runningPnl = activeQty > 0 ? realizedPnl + floatingUnrealized : trade.netPnl;
      const holdPnl = trade.quantity * priceDelta * multiplier;

      // Check if any exit occurred right around this bar
      let exitMarker: Point["exitMarker"] = undefined;
      const currentExit = exitFills.find(
        (e) =>
          !usedExits.has(e.id) &&
          Math.abs(Date.parse(e.executedAt) - t) <= 60_000
      );
      if (currentExit) {
        usedExits.add(currentExit.id);
        exitMarker = {
          reason: currentExit.reason || "TP",
          quantity: currentExit.quantity,
          pnl: currentExit.pnl,
          price: currentExit.price,
        };
      }

      pts.push({
        time: t,
        isoTime: new Date(t).toISOString(),
        timeLabel: formatTimestamp(new Date(t).toISOString(), timeZone).slice(11, 16),
        runningPnl: Number(runningPnl.toFixed(2)),
        holdPnl: Number(holdPnl.toFixed(2)),
        price: b.close,
        activeQty: Number(activeQty.toFixed(2)),
        exitMarker,
      });
    }

    return pts;
  }, [bars, openMs, closeMs, exitFills, isShort, trade, multiplier, timeZone]);

  // 4. Calculate Trade Management Efficiency Metrics
  const metrics = useMemo(() => {
    if (points.length === 0) {
      return {
        efficiency: 100,
        deltaVsHold: 0,
        maxMfe: trade.netPnl,
        maxMae: 0,
        finalHoldPnl: trade.netPnl,
      };
    }

    const runningValues = points.map((p) => p.runningPnl);
    const maxMfe = Math.max(...runningValues, 0);
    const maxMae = Math.min(...runningValues, 0);
    const finalHoldPnl = points[points.length - 1]?.holdPnl ?? trade.netPnl;
    const deltaVsHold = trade.netPnl - finalHoldPnl;

    // Efficiency: Actual Realized vs Full-Hold Benchmark
    let efficiency = 100;
    if (Math.abs(finalHoldPnl) > 0.01) {
      efficiency = Number(((trade.netPnl / finalHoldPnl) * 100).toFixed(1));
    }

    return {
      efficiency,
      deltaVsHold,
      maxMfe,
      maxMae,
      finalHoldPnl,
    };
  }, [points, trade.netPnl]);

  if (points.length < 2) {
    return null;
  }

  // 5. SVG Coordinate Mapping
  const padding = { top: 24, right: 30, bottom: 28, left: 60 };
  const width = 800; // base virtual viewBox width
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const minVal = Math.min(
    ...points.map((p) => Math.min(p.runningPnl, p.holdPnl)),
    0
  );
  const maxVal = Math.max(
    ...points.map((p) => Math.max(p.runningPnl, p.holdPnl)),
    0
  );
  const valRange = Math.max(maxVal - minVal, 10);

  const getX = (idx: number) => padding.left + (idx / (points.length - 1)) * plotWidth;
  const getY = (val: number) =>
    padding.top + plotHeight - ((val - minVal) / valRange) * plotHeight;

  const zeroY = getY(0);

  // SVG Paths
  const runningPath = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${getX(i).toFixed(1)} ${getY(p.runningPnl).toFixed(1)}`)
    .join(" ");

  const holdPath = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${getX(i).toFixed(1)} ${getY(p.holdPnl).toFixed(1)}`)
    .join(" ");

  const areaPath = `${runningPath} L ${getX(points.length - 1).toFixed(1)} ${zeroY.toFixed(
    1
  )} L ${getX(0).toFixed(1)} ${zeroY.toFixed(1)} Z`;

  // Grid tick values (4-5 horizontal lines)
  const yTicks = [
    maxVal,
    maxVal * 0.5,
    0,
    minVal < 0 ? minVal * 0.5 : null,
    minVal < 0 ? minVal : null,
  ].filter((v): v is number => v !== null);

  const activePoint = hoverIndex !== null ? points[hoverIndex] : points[points.length - 1];

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const relativeX = (mouseX / rect.width) * width;
    const clampedX = Math.max(padding.left, Math.min(width - padding.right, relativeX));
    const ratio = (clampedX - padding.left) / plotWidth;
    const idx = Math.min(points.length - 1, Math.max(0, Math.round(ratio * (points.length - 1))));
    setHoverIndex(idx);
  };

  return (
    <Card className="border-border/70 bg-[#12141c]">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <span>Running P&amp;L</span>
              {/* Management Efficiency Badge */}
              <Badge
                variant="outline"
                className={`text-[11px] font-mono font-semibold ${
                  metrics.efficiency >= 100
                    ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-400"
                    : metrics.efficiency >= 70
                    ? "border-border bg-secondary/70 text-foreground"
                    : "border-rose-500/50 bg-rose-500/10 text-rose-400"
                }`}
              >
                {metrics.efficiency}% Mgmt Efficiency
              </Badge>
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Realized + floating excursion in {timeZone}
            </p>
          </div>

          {/* Quick Metric Pills */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <div className="rounded border border-border/60 bg-muted/20 px-2 py-0.5">
              <span className="text-muted-foreground mr-1">Max Float:</span>
              <span className="font-semibold text-emerald-400">
                {formatSignedMoney(metrics.maxMfe, trade.currency)}
              </span>
            </div>
            <div className="rounded border border-border/60 bg-muted/20 px-2 py-0.5">
              <span className="text-muted-foreground mr-1">Max Drawdown:</span>
              <span className="font-semibold text-rose-400">
                {fmtMoney(metrics.maxMae, trade.currency)}
              </span>
            </div>
            <div className="rounded border border-border/60 bg-muted/20 px-2 py-0.5">
              <span className="text-muted-foreground mr-1">vs Full Hold:</span>
              <span
                className={`font-semibold ${
                  metrics.deltaVsHold >= 0 ? "text-emerald-400" : "text-amber-400"
                }`}
              >
                {formatSignedMoney(metrics.deltaVsHold, trade.currency)}
              </span>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-2">
        {/* Legend */}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <span className="h-0.5 w-4 rounded-full bg-cyan-400 inline-block" />
              <span className="text-foreground font-medium">Actual Running P&amp;L</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-0.5 w-4 border-t-2 border-dashed border-indigo-400 inline-block" />
              <span>Full-Hold Benchmark</span>
            </div>
          </div>

          {activePoint && (
            <div className="font-mono text-xs text-foreground flex items-center gap-3">
              <span>{activePoint.timeLabel}</span>
              <span
                className={`font-bold ${
                  activePoint.runningPnl >= 0 ? "text-emerald-400" : "text-rose-400"
                }`}
              >
                {formatSignedMoney(activePoint.runningPnl, trade.currency)}
              </span>
              <span className="text-muted-foreground text-[11px]">
                Hold: {fmtMoney(activePoint.holdPnl, trade.currency)}
              </span>
              <span className="text-muted-foreground text-[11px]">
                Open: {activePoint.activeQty}L
              </span>
            </div>
          )}
        </div>

        {/* Responsive SVG Chart */}
        <div className="relative w-full overflow-hidden rounded-md border border-border/50 bg-[#0d0f17]">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${width} ${height}`}
            className="w-full h-auto cursor-crosshair block"
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setHoverIndex(null)}
          >
            <defs>
              <linearGradient id="pnlGreenGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.35" />
                <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.0" />
              </linearGradient>
              <linearGradient id="pnlRedGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.0" />
                <stop offset="100%" stopColor="#f43f5e" stopOpacity="0.35" />
              </linearGradient>
            </defs>

            {/* Zero Line (Breakeven) */}
            <line
              x1={padding.left}
              y1={zeroY}
              x2={width - padding.right}
              y2={zeroY}
              stroke="currentColor" className="text-slate-200/80 dark:text-slate-800/70"
              strokeDasharray="3 3"
              strokeWidth="1.5"
            />
            <text
              x={padding.left - 8}
              y={zeroY + 3}
              textAnchor="end"
              fill="#64748b"
              fontSize="10"
              fontFamily="monospace"
            >
              $0
            </text>

            {/* Horizontal Grid & Y-Axis Labels */}
            {yTicks
              .filter((v) => Math.abs(v) > 1)
              .map((val, idx) => {
                const y = getY(val);
                return (
                  <g key={`ytick-${idx}`}>
                    <line
                      x1={padding.left}
                      y1={y}
                      x2={width - padding.right}
                      y2={y}
                      stroke="currentColor" className="text-slate-200/80 dark:text-slate-800/70"
                      strokeWidth="1"
                    />
                    <text
                      x={padding.left - 8}
                      y={y + 3}
                      textAnchor="end"
                      fill="#64748b"
                      fontSize="9"
                      fontFamily="monospace"
                    >
                      {val > 0 ? `+${fmtNumber(val, 0)}` : fmtNumber(val, 0)}
                    </text>
                  </g>
                );
              })}

            {/* Area Fill */}
            <path d={areaPath} fill="url(#pnlGreenGrad)" />

            {/* Dotted Full-Hold Benchmark Line */}
            <path
              d={holdPath}
              fill="none"
              stroke="#818cf8"
              strokeWidth="1.75"
              strokeDasharray="4 4"
              opacity="0.8"
            />

            {/* Solid Running P&L Line */}
            <path
              d={runningPath}
              fill="none"
              stroke="#22d3ee"
              strokeWidth="2.25"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* Partial Exit Badges & Markers */}
            {points.map((p, i) => {
              if (!p.exitMarker) return null;
              const x = getX(i);
              const y = getY(p.runningPnl);
              const isProfit = (p.exitMarker.pnl || 0) >= 0;
              const label = `${p.exitMarker.reason} ${p.exitMarker.quantity}L ${
                p.exitMarker.pnl !== undefined
                  ? `(${isProfit ? "+" : ""}${fmtMoney(p.exitMarker.pnl, trade.currency)})`
                  : ""
              }`;

              return (
                <g key={`marker-${i}`} className="pointer-events-none">
                  {/* Vertical Guideline */}
                  <line
                    x1={x}
                    y1={y}
                    x2={x}
                    y2={zeroY}
                    stroke={isProfit ? "#10b981" : "#f43f5e"}
                    strokeWidth="1"
                    strokeDasharray="2 2"
                    opacity="0.7"
                  />
                  {/* Pin Dot */}
                  <circle
                    cx={x}
                    cy={y}
                    r="4"
                    fill={isProfit ? "#10b981" : "#f43f5e"}
                    stroke="#ffffff"
                    strokeWidth="1.5"
                  />
                  {/* Pill Badge */}
                  <rect
                    x={x - 35}
                    y={Math.max(10, y - 22)}
                    width="70"
                    height="16"
                    rx="3"
                    fill="#181b26"
                    stroke={isProfit ? "#10b981" : "#f43f5e"}
                    strokeWidth="1"
                  />
                  <text
                    x={x}
                    y={Math.max(10, y - 22) + 11}
                    textAnchor="middle"
                    fill={isProfit ? "#34d399" : "#fb7185"}
                    fontSize="8.5"
                    fontWeight="bold"
                    fontFamily="monospace"
                  >
                    {p.exitMarker.reason} {p.exitMarker.quantity}L
                  </text>
                </g>
              );
            })}

            {/* Hover Crosshair & Dot */}
            {hoverIndex !== null && (
              <g className="pointer-events-none">
                <line
                  x1={getX(hoverIndex)}
                  y1={padding.top}
                  x2={getX(hoverIndex)}
                  y2={height - padding.bottom}
                  stroke="currentColor" className="text-slate-300 dark:text-slate-700"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                />
                <circle
                  cx={getX(hoverIndex)}
                  cy={getY(points[hoverIndex]!.runningPnl)}
                  r="5"
                  fill="#22d3ee"
                  stroke="#ffffff"
                  strokeWidth="2"
                />
                <circle
                  cx={getX(hoverIndex)}
                  cy={getY(points[hoverIndex]!.holdPnl)}
                  r="3.5"
                  fill="#818cf8"
                  stroke="#ffffff"
                  strokeWidth="1.5"
                />
              </g>
            )}

            {/* X-Axis Time Labels */}
            {points.length > 0 && (
              <>
                <text
                  x={getX(0)}
                  y={height - 8}
                  textAnchor="start"
                  fill="#64748b"
                  fontSize="9"
                  fontFamily="monospace"
                >
                  {points[0]!.timeLabel}
                </text>
                <text
                  x={getX(Math.floor((points.length - 1) / 2))}
                  y={height - 8}
                  textAnchor="middle"
                  fill="#64748b"
                  fontSize="9"
                  fontFamily="monospace"
                >
                  {points[Math.floor((points.length - 1) / 2)]!.timeLabel}
                </text>
                <text
                  x={getX(points.length - 1)}
                  y={height - 8}
                  textAnchor="end"
                  fill="#64748b"
                  fontSize="9"
                  fontFamily="monospace"
                >
                  {points[points.length - 1]!.timeLabel}
                </text>
              </>
            )}
          </svg>
        </div>
      </CardContent>
    </Card>
  );
}
