"use client";

import { use, useEffect, useMemo, useRef, useState } from "react";
import {
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
    PanelRightOpen,
  ExternalLink,
  Download,
  UploadCloud,
  Save,
  Loader2,
} from "lucide-react";
import { netReturnOnEntry } from "@luxalgo/journal-core";
import { FilterBar } from "@/components/filter-bar";
import { Pnl } from "@/components/pnl";
import { MonetaryValue, MonetaryField } from "@/components/privacy";
import { TradeMarketData } from "@/components/trade-market-data";
import { RunningPnlChart } from "@/components/charts/running-pnl-chart";
import type { TradeMarketResult } from "@/lib/market-data";
import { TradeNavigation } from "@/components/trade-navigation";
import { TradeRating } from "@/components/trade-rating";
import { EquityArea } from "@/components/charts/equity-area";
import { VoiceNote } from "@/components/voice-note";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RichEditor, Markdown, type RichEditorHandle } from "@/components/rich-editor";
import { ReviewExport } from "@/components/review-export";
import { RuleChecklist } from "@/components/rule-checklist";
import { TradePlaybookChecklist } from "@/components/playbooks/trade-playbook-checklist";
import { TradeTagsEditor } from "@/components/tags/trade-tags-editor";
import { AiNotice } from "@/components/ai-notice";
import { useAutosave } from "@/lib/use-autosave";
import { postJson, useApi } from "@/lib/use-api";
import { fmtDuration, fmtMoney, fmtNumber, fmtPercent } from "@/lib/utils";
import { tradeKeyFromSegment } from "@/lib/trade-links";
import { formatTimestamp, formatDateDMY } from "@/lib/timezone";
import { classifyKillzoneAnd7hCandle } from "@/lib/killzones";
import { NotebookTradeMatcherModal } from "@/components/notebook/notebook-trade-matcher-modal";
import { FileText, ArrowRightLeft } from "lucide-react";

interface TradeDetail {
  riskAmount: number | null;
  riskPercent?: number | null;
  accountInitialBalance?: number | null;
  realizedR: number | null;
  plannedR: number | null;
  mfeR?: number | null;
  maeR?: number | null;
  captureEff?: number | null;
  contractMultiplier: number | null;
  currency: string;
  key: string;
  accountId: string;
  symbol: string;
  assetClass: string | null;
  direction: "long" | "short";
  status: string;
  openedAt: string;
  closedAt: string | null;
  quantity: number;
  avgEntry: number;
  avgExit: number | null;
  grossPnl: number;
  fees: number;
  netPnl: number;
  durationMs: number | null;
  exitsJson: string;
  notes: string | null;
  review_notes?: string | null;
  reviewNotes?: string | null;
  tagsJson: string | null;
  mistakesJson: string | null;
  playbookId: string | null;
  rating: number | null;
  stopLoss: number | null;
  profitTarget: number | null;
  reviewedAt: string | null;
  partials_breakdown?: string;
}

interface ExecutionRow {
  id: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  fee: number;
  executedAt: string;
  reason?: string;
  pnl?: number;
}

export default function TradePage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = use(params);
  const tradeKey = tradeKeyFromSegment(key);
  return <TradeView key={tradeKey} tradeKey={tradeKey} />;
}

function TradeView({ tradeKey }: { tradeKey: string }) {
  const { data, error, refresh } = useApi<{
    trade: TradeDetail;
    executions: ExecutionRow[];
    timeZone: string;
  }>(`/api/trades/${encodeURIComponent(tradeKey)}`);

  const [aiBusy, setAiBusy] = useState(false);
  const [critique, setCritique] = useState<string | null>(null);
  const [marketResult, setMarketResult] = useState<TradeMarketResult | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  // Dynamic 2-column layout state
  const [leftWidth, setLeftWidth] = useState<number>(42); // percentage
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const isDraggingRef = useRef(false);

  useEffect(() => {
    try {
      const savedWidth = localStorage.getItem("tz_trade_split_ratio");
      if (savedWidth) setLeftWidth(Number(savedWidth));
    } catch {}
  }, []);

  const handleMouseDown = () => {
    isDraggingRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const totalWidth = window.innerWidth;
      const newPct = Math.max(20, Math.min(80, (e.clientX / totalWidth) * 100));
      setLeftWidth(newPct);
    };

    const onMouseUp = () => {
      isDraggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      localStorage.setItem("tz_trade_split_ratio", String(leftWidth));
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  // Reconstruct executions from MT5 partials breakdown if raw executions table is unpopulated
  const executions: ExecutionRow[] = useMemo(() => {
    if (!data) return [];
    const { trade, executions: rawExecutions } = data;
    if (rawExecutions && rawExecutions.length > 0) return rawExecutions;

    const notes = trade.partials_breakdown || trade.notes || "";
    const matches = [
      ...notes.matchAll(
        /\[(\d+)\]\s+([\d.]+)L?\s+@\s+([\d.]+)(?:\s+@\s+(?:(\d{4}-\d{2}-\d{2})\s+)?([\d:]+))?\s*\(([+-]?\$?[\d.]+)?(?:,\s*([^)]+))?\)/gi
      ),
    ];
    if (!matches.length) return rawExecutions;

    const isShort = trade.direction === "short";
    const openMs = Date.parse(trade.openedAt);
    const closeMs = trade.closedAt ? Date.parse(trade.closedAt) : openMs;
    const dur = Math.max(0, closeMs - openMs);
    const step = matches.length > 1 ? dur / matches.length : 0;
    const tzSuffix = trade.openedAt.length >= 19 ? trade.openedAt.slice(19) : "Z";

    const list: ExecutionRow[] = [
      {
        id: "entry-1",
        side: isShort ? "sell" : "buy",
        quantity: trade.quantity,
        price: trade.avgEntry,
        fee: 0,
        executedAt: trade.openedAt,
        reason: "Entry",
      },
    ];

    let prevLegMs = openMs;
    let curDatePrefix = trade.openedAt.slice(0, 10);

    matches.forEach((m, idx) => {
      const q = parseFloat(m[2]!);
      const p = parseFloat(m[3]!);
      const explicitDate = m[4];
      const timeStr = m[5];
      const pnlRaw = m[6] ? parseFloat(m[6].replace(/[+$,]/g, "")) : 0;
      const reason = m[7] || "TP";

      let legTime: string;
      if (timeStr && trade.openedAt) {
        if (explicitDate) curDatePrefix = explicitDate;
        let parsed = Date.parse(`${curDatePrefix}T${timeStr}${tzSuffix}`);
        if (Number.isFinite(parsed)) {
          while (parsed < prevLegMs - 30_000) {
            parsed += 86_400_000;
          }
          prevLegMs = parsed;
          legTime = new Date(parsed).toISOString();
        } else {
          legTime = new Date(openMs + step * (idx + 1)).toISOString();
        }
      } else {
        legTime = new Date(openMs + step * (idx + 1)).toISOString();
      }

      list.push({
        id: `exit-${idx + 1}`,
        side: isShort ? "buy" : "sell",
        quantity: q,
        price: p,
        fee: 0,
        executedAt: legTime,
        reason,
        pnl: pnlRaw,
      });
    });

    return list;
  }, [data]);

  if (!data) {
    return (
      <div>
        <FilterBar title="Trade" />
        <div className="p-4">
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : (
            <Skeleton className="h-96" />
          )}
        </div>
      </div>
    );
  }

  const { trade, timeZone } = data;

  const patch = async (body: Record<string, unknown>) => {
    if (Object.keys(body).length)
      await postJson(`/api/trades/${encodeURIComponent(tradeKey)}`, body, "PATCH");
    refresh();
  };

  const runningPnl = (() => {
    const exits = JSON.parse(trade.exitsJson || "[]") as {
      executionId: string;
      grossPnl: number;
      quantity: number;
    }[];
    const times = new Map(executions.map((e) => [e.id, e.executedAt]));
    const totalExitQty = exits.reduce((tot, exit) => tot + exit.quantity, 0);
    let cum = 0;
    return exits
      .map((exit) => ({
        t: times.get(exit.executionId) ?? trade.openedAt,
        pnl: exit.grossPnl - (totalExitQty > 0 ? trade.fees * (exit.quantity / totalExitQty) : 0),
      }))
      .sort((a, b) => Date.parse(a.t) - Date.parse(b.t))
      .map((event) => ({
        t: formatTimestamp(event.t, timeZone).slice(11, 16),
        cumNetPnl: (cum += event.pnl),
      }));
  })();

  const askCritique = async () => {
    setAiBusy(true);
    setAiError(null);
    try {
      const res = await postJson<{ critique: string }>("/api/ai/critique", { key: tradeKey });
      setCritique(res.critique);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "AI critique failed");
    } finally {
      setAiBusy(false);
    }
  };

  return (
    <div className="flex flex-col min-h-screen">
      <FilterBar title={`${trade.symbol} · ${trade.direction.toUpperCase()}`} />
      <TradeNavigation tradeKey={tradeKey} />

      <div className="p-4 space-y-4">
        {/* 1. FULL-WIDTH TOP SUMMARY BAR (STRETCHES ACROSS THE PAGE) */}
        {(() => {
          const kzEntry = classifyKillzoneAnd7hCandle(trade.openedAt);
          const kzExit = trade.closedAt ? classifyKillzoneAnd7hCandle(trade.closedAt) : null;
          const computedDurMs =
            trade.durationMs != null && trade.durationMs > 0
              ? trade.durationMs
              : trade.closedAt && trade.openedAt
              ? Math.max(0, Date.parse(trade.closedAt) - Date.parse(trade.openedAt))
              : null;

          // Calculate Full-Hold vs Trade Management Efficiency from executions (or 1m candles)
          const isShort = trade.direction.toLowerCase() === "short";
          const exitLegs = executions
            .filter((e) => e.side === (isShort ? "buy" : "sell"))
            .sort((a, b) => Date.parse(a.executedAt) - Date.parse(b.executedAt));

          // Time to TP1 (first partial scale-out)
          const validPostEntryExits = exitLegs.filter((e) => Date.parse(e.executedAt) >= Date.parse(trade.openedAt));
          const firstExitMs = validPostEntryExits.length > 1 ? Date.parse(validPostEntryExits[0]!.executedAt) : null;
          const timeToTp1Ms =
            firstExitMs && Number.isFinite(firstExitMs)
              ? Math.max(0, firstExitMs - Date.parse(trade.openedAt))
              : null;

          // Full-Hold P&L = holding 100% of initial quantity until the final exit leg's price
          const finalExitPrice =
            exitLegs.length > 0
              ? exitLegs[exitLegs.length - 1]!.price
              : trade.avgExit ?? trade.avgEntry;
          const avgMove = isShort
            ? trade.avgEntry - (trade.avgExit ?? trade.avgEntry)
            : (trade.avgExit ?? trade.avgEntry) - trade.avgEntry;
          const impliedMult =
            trade.contractMultiplier && trade.contractMultiplier > 0
              ? trade.contractMultiplier
              : Math.abs(avgMove) > 0 && trade.quantity > 0 && Math.abs(trade.grossPnl) > 0
              ? Math.abs(trade.grossPnl) / (Math.abs(avgMove) * trade.quantity)
              : 1;
          const finalMove = isShort
            ? trade.avgEntry - finalExitPrice
            : finalExitPrice - trade.avgEntry;
          const fullHoldPnl =
            exitLegs.length > 1
              ? Number((trade.quantity * finalMove * impliedMult).toFixed(2))
              : trade.netPnl;
          const deltaVsHold = Number((trade.netPnl - fullHoldPnl).toFixed(2));
          const mgmtEffPct =
            Math.abs(fullHoldPnl) > 0.01
              ? Number(((trade.netPnl / fullHoldPnl) * 100).toFixed(1))
              : 100;

          // Infer 1R price distance (from explicit Stop Loss, or from Realized R & Avg Exit distance)
          const explicitRiskPts =
            trade.stopLoss && trade.stopLoss > 0
              ? Math.abs(trade.avgEntry - trade.stopLoss)
              : null;
          const inferredRiskPts =
            explicitRiskPts && explicitRiskPts > 0
              ? explicitRiskPts
              : trade.realizedR && Math.abs(trade.realizedR) > 0.01 && Math.abs(avgMove) > 0
              ? Math.abs(avgMove) / Math.abs(trade.realizedR)
              : null;

          // Compute best favorable excursion across actual partial exit fills (floor for MFE R)
          let minMfeFromFills: number | null = null;
          if (inferredRiskPts && inferredRiskPts > 0 && exitLegs.length > 0) {
            const favMoves = exitLegs.map((e) => {
              const rawP = (e as any).rawMt5Price ?? e.price;
              return isShort
                ? Math.max(0, trade.avgEntry - rawP)
                : Math.max(0, rawP - trade.avgEntry);
            });
            const maxFillFav = Math.max(...favMoves, 0);
            if (maxFillFav > 0) {
              minMfeFromFills = Number((maxFillFav / inferredRiskPts).toFixed(2));
            }
          }

          let displayMfeR =
            trade.mfeR != null && minMfeFromFills != null
              ? Math.max(trade.mfeR, minMfeFromFills)
              : trade.mfeR ?? minMfeFromFills;
          let displayMaeR = trade.maeR ?? null;

          // Refine MFE R and MAE R using loaded 1m candles during the trade window
          if (marketResult?.bars?.length && inferredRiskPts && inferredRiskPts > 0) {
            const openT = Date.parse(trade.openedAt);
            const closeT = trade.closedAt ? Date.parse(trade.closedAt) : Date.now();
            const tBars = marketResult.bars.filter(
              (b) => b.time >= openT - 60_000 && b.time <= closeT + 60_000
            );
            if (tBars.length > 0) {
              const entryBar = tBars[0]!;
              const refEntry =
                Math.abs(entryBar.open - trade.avgEntry) > inferredRiskPts * 0.5
                  ? (entryBar.open + entryBar.close) / 2
                  : trade.avgEntry;
              const hi = Math.max(...tBars.map((b) => b.high));
              const lo = Math.min(...tBars.map((b) => b.low));
              const favPts = isShort
                ? Math.max(0, refEntry - lo)
                : Math.max(0, hi - refEntry);
              const advPts = isShort
                ? Math.max(0, hi - refEntry)
                : Math.max(0, refEntry - lo);
              const candleMfeR = Number((favPts / inferredRiskPts).toFixed(2));
              const candleMaeR = Number((advPts / inferredRiskPts).toFixed(2));
              displayMfeR = Math.max(displayMfeR ?? 0, candleMfeR, minMfeFromFills ?? 0);
              if (displayMaeR === null || displayMaeR === 0) {
                displayMaeR = candleMaeR;
              }
            }
          }

          const displayCaptureEff =
            trade.realizedR != null && displayMfeR != null && displayMfeR > 0
              ? Number(Math.min(100, Math.max(0, (trade.realizedR / displayMfeR) * 100)).toFixed(1))
              : trade.captureEff ?? null;

          // Multi-day check for the top Date & Time pills
          const isMultiDay = Boolean(kzExit && kzExit.dateDMY !== kzEntry.dateDMY);
          const calendarDaysSpan =
            computedDurMs != null ? Math.max(1, Math.round(computedDurMs / 86_400_000)) : 1;

          return (
            <Card className="border-border/70 bg-[#12141c]">
              <CardContent className="space-y-3 py-4">
                {/* TOP ROW: P&L, STATUS, DAY/DATE, KILLZONE / 7H CANDLE, PANEL TOGGLES */}
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/40 pb-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <div>
                      <div className="text-[11px] text-muted-foreground">Net P&amp;L</div>
                      <Pnl value={trade.netPnl} className="text-2xl font-bold" />
                    </div>
                    <Badge
                      variant={
                        trade.status === "win"
                          ? "profit"
                          : trade.status === "loss"
                          ? "loss"
                          : "secondary"
                      }
                      className="text-xs uppercase font-semibold px-2.5 py-1"
                    >
                      {trade.status}
                    </Badge>

                    {/* Day of Week, Date (DD-MM-YYYY) & NY Entry -> Exit Time (Supports Multi-Day Span) */}
                    <div className="flex flex-wrap items-center gap-1.5 pl-2 border-l border-border/50">
                      <span className="rounded-md border border-border/70 bg-secondary/40 px-2.5 py-1 font-mono text-xs font-semibold text-foreground">
                        {isMultiDay && kzExit
                          ? `${kzEntry.dayShort}, ${kzEntry.dateDMY} → ${kzExit.dayShort}, ${kzExit.dateDMY}`
                          : `${kzEntry.dayShort}, ${kzEntry.dateDMY}`}
                      </span>
                      <span className="rounded-md border border-border/70 bg-secondary/40 px-2.5 py-1 font-mono text-xs text-muted-foreground">
                        {isMultiDay && kzExit
                          ? `${kzEntry.timeHM} (${kzEntry.dateDMY.slice(0, 5)}) → ${kzExit.timeHM} (${kzExit.dateDMY.slice(0, 5)}) NY (+${calendarDaysSpan}d)`
                          : `${kzEntry.timeHM}${kzExit ? ` → ${kzExit.timeHM}` : ""} NY`}
                      </span>
                      <span
                        className={`rounded-md border px-2.5 py-1 text-xs font-semibold ${
                          kzEntry.isKillzone
                            ? "border-indigo-500/40 bg-indigo-500/15 text-indigo-300"
                            : "border-amber-500/40 bg-amber-500/15 text-amber-300"
                        }`}
                        title={`7-Hour Candle Window: ${kzEntry.candle7h}`}
                      >
                        {kzEntry.label}
                      </span>
                      {kzEntry.isKillzone && (
                        <span className="rounded-md border border-border/60 bg-background/60 px-2 py-1 font-mono text-[11px] text-muted-foreground">
                          {kzEntry.candle7h}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Quick Column Collapse Toggles */}
                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setLeftCollapsed(!leftCollapsed)}
                      className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
                      title={leftCollapsed ? "Expand Journal" : "Collapse Journal"}
                    >
                      {leftCollapsed ? (
                        <PanelLeftOpen className="h-4 w-4" />
                      ) : (
                        <PanelLeftClose className="h-4 w-4" />
                      )}
                      <span className="hidden sm:inline ml-1">Journal</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setRightCollapsed(!rightCollapsed)}
                      className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
                      title={rightCollapsed ? "Expand Chart" : "Collapse Chart"}
                    >
                      {rightCollapsed ? (
                        <PanelRightOpen className="h-4 w-4" />
                      ) : (
                        <PanelRightClose className="h-4 w-4" />
                      )}
                      <span className="hidden sm:inline ml-1">Chart</span>
                    </Button>
                  </div>
                </div>

                {/* SECOND ROW: COMPLETE EXECUTION, RISK, R-MULTIPLE, OPTIMAL R & MGMT EFFICIENCY TELEMETRY */}
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2.5 text-sm">
                  <Meta
                    label="Realized R"
                    value={
                      trade.realizedR === null
                        ? "–"
                        : `${trade.realizedR > 0 ? "+" : ""}${fmtNumber(trade.realizedR, 2)}R`
                    }
                  />
                  <Meta
                    label="Planned R"
                    value={trade.plannedR === null ? "–" : `${fmtNumber(trade.plannedR, 2)}R`}
                  />
                  <Meta
                    label="Account Risk"
                    value={
                      trade.riskPercent != null
                        ? `${fmtNumber(trade.riskPercent, 2)}%${
                            trade.riskAmount ? ` (${fmtMoney(trade.riskAmount, trade.currency)})` : ""
                          }`
                        : trade.riskAmount != null
                        ? fmtMoney(trade.riskAmount, trade.currency)
                        : "–"
                    }
                  />
                  <Meta
                    label="Optimal R (MFE)"
                    value={displayMfeR === null ? "–" : `+${fmtNumber(displayMfeR, 2)}R`}
                  />
                  <Meta
                    label="Max Heat (MAE)"
                    value={displayMaeR === null ? "–" : `-${fmtNumber(displayMaeR, 2)}R`}
                  />
                  <Meta
                    label="R Capture Eff"
                    value={displayCaptureEff === null ? "–" : `${fmtNumber(displayCaptureEff, 1)}%`}
                  />
                  <Meta
                    label="Mgmt vs Full Hold"
                    value={`${mgmtEffPct}% (${deltaVsHold >= 0 ? "+" : ""}${fmtMoney(
                      deltaVsHold,
                      trade.currency
                    )})`}
                  />
                  <Meta
                    label="Duration"
                    value={
                      computedDurMs != null
                        ? `${fmtDuration(computedDurMs)}${
                            timeToTp1Ms != null ? ` (TP1: ${fmtDuration(timeToTp1Ms)})` : ""
                          }`
                        : "–"
                    }
                  />
                  <Meta label="Volume" value={`${fmtNumber(trade.quantity, 2)}L`} />
                  <Meta label="Avg entry" value={fmtNumber(trade.avgEntry)} monetary />
                  <Meta
                    label="Avg exit"
                    monetary
                    value={trade.avgExit === null ? "open" : fmtNumber(trade.avgExit)}
                  />
                  <Meta label="Gross" value={fmtMoney(trade.grossPnl)} monetary />
                  <Meta label="Fees" value={fmtMoney(trade.fees)} monetary />
                </div>
              </CardContent>
            </Card>
          );
        })()}

        {/* 2. DYNAMIC RESIZABLE 2-COLUMN LAYOUT */}
        <div className="flex flex-col lg:flex-row gap-0 relative items-stretch min-h-[600px]">
          {/* LEFT COLUMN: JOURNAL (RICH EDITOR, RULES, TAGS, AI) */}
          {!leftCollapsed && (
            <div
              style={{
                width: rightCollapsed ? "100%" : `${leftWidth}%`,
                flexShrink: 0,
              }}
              className="space-y-4 pr-0 lg:pr-3 min-w-[280px]"
            >
              <AnnotationsCard key={trade.key} trade={trade} onPatch={patch} />
              <TradePeriodCompanion openedAt={trade.openedAt} />

              <Card>
                <CardHeader className="flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-bold flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-purple-400" />
                    <span>AI Review</span>
                  </CardTitle>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={askCritique}
                    disabled={aiBusy}
                    className="h-7 text-xs"
                  >
                    {aiBusy ? "Thinking…" : "Critique this trade"}
                  </Button>
                </CardHeader>
                {aiError && (
                  <CardContent>
                    <AiNotice
                      error={aiError}
                      onRetry={() => void askCritique()}
                      onDismiss={() => setAiError(null)}
                    />
                  </CardContent>
                )}
                {critique && (
                  <CardContent>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
                      {critique}
                    </p>
                  </CardContent>
                )}
              </Card>
            </div>
          )}

          {/* DRAGGABLE RESIZER HANDLE */}
          {!leftCollapsed && !rightCollapsed && (
            <div
              onMouseDown={handleMouseDown}
              className="hidden lg:flex w-2 cursor-col-resize items-center justify-center bg-transparent hover:bg-white/[0.03] transition-colors group z-10"
              title="Drag to resize split"
            >
              <div className="h-12 w-0.5 rounded-full bg-border/20 group-hover:bg-indigo-500/50 transition-colors" />
            </div>
          )}

          {/* RIGHT COLUMN: CHART, REPLAY, COMPACT MARKET DATA & EXECUTIONS */}
          {!rightCollapsed && (
            <div
              style={{
                width: leftCollapsed ? "100%" : `calc(${100 - leftWidth}% - 8px)`,
                flexShrink: 0,
              }}
              className="space-y-4 pl-0 lg:pl-3 min-w-[340px]"
            >
              <TradeMarketData trade={trade} executions={executions} onResultChange={setMarketResult} />

              <RunningPnlChart
                trade={trade}
                executions={executions}
                bars={marketResult?.bars}
                timeZone={timeZone}
              />

              {/* EXECUTIONS TABLE: DETAILED PARTIAL TAKE PROFITS & LEGS */}
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-sm font-bold">Executions &amp; Partials</CardTitle>
                      <p className="text-xs text-muted-foreground">Times in {timeZone}</p>
                    </div>
                    <Badge variant="outline" className="text-[11px] font-mono">
                      {executions.length} {executions.length === 1 ? "leg" : "legs"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Time</TableHead>
                        <TableHead>Side</TableHead>
                        <TableHead>Quantity</TableHead>
                        <TableHead>Price</TableHead>
                        <TableHead>Leg P&amp;L / Reason</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {executions
                        .sort((a, b) => a.executedAt.localeCompare(b.executedAt))
                        .map((execution, idx) => (
                          <TableRow key={execution.id || `exec-${idx}`}>
                            <TableCell className="text-xs text-muted-foreground">
                              {formatTimestamp(execution.executedAt, timeZone)}
                            </TableCell>
                            <TableCell>
                              <span
                                className={`text-xs font-semibold ${
                                  execution.side === "buy" ? "text-profit" : "text-loss"
                                }`}
                              >
                                {execution.side === "buy" ? "▲ BUY" : "▼ SELL"}
                              </span>
                            </TableCell>
                            <TableCell className="tnum text-xs font-medium">
                              {fmtNumber(execution.quantity, 2)}L
                            </TableCell>
                            <TableCell className="tnum text-xs font-mono">
                              <MonetaryValue>{fmtNumber(execution.price, 2)}</MonetaryValue>
                            </TableCell>
                            <TableCell className="text-xs">
                              {execution.pnl !== undefined ? (
                                <span
                                  className={`font-semibold mr-1.5 ${
                                    execution.pnl >= 0 ? "text-emerald-400" : "text-rose-400"
                                  }`}
                                >
                                  {execution.pnl >= 0 && !fmtMoney(execution.pnl).startsWith("+") ? "+" : ""}{fmtMoney(execution.pnl)}
                                </span>
                              ) : null}
                              {execution.reason && (
                                <Badge variant="secondary" className="text-[10px] py-0 px-1.5">
                                  {execution.reason}
                                </Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Meta({
  label,
  value,
  monetary = false,
}: {
  label: string;
  value: string;
  monetary?: boolean;
}) {
  return (
    <div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="tnum text-sm font-semibold text-foreground">
        {monetary ? <MonetaryValue>{value}</MonetaryValue> : value}
      </div>
    </div>
  );
}

function cleanLegacyTradeNotes(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .split("\n")
    .filter((line) => {
      const s = line.trim();
      if (s.startsWith("Notion: http")) return false;
      if (/^\[\d+\]\s+[\d.]+L\s+@/i.test(s)) return false;
      return true;
    })
    .join("\n")
    .trim();
}


function getMondayOfDate(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  if (isNaN(d.getTime())) return dateStr;
  const day = d.getUTCDay();
  const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
  const mon = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), diff));
  return mon.toISOString().slice(0, 10);
}

function TradePeriodCompanion({ openedAt }: { openedAt: string }) {
  const dateStr = (openedAt || new Date().toISOString()).slice(0, 10);
  const mondayStr = getMondayOfDate(dateStr);
  const monthKey = dateStr.slice(0, 7);
  const yr = dateStr.slice(0, 4);
  const qNum = Math.floor((parseInt(dateStr.slice(5, 7), 10) - 1) / 3) + 1;

  const periods = useMemo(
    () => [
      { id: "day", label: `Daily (${dateStr.slice(8, 10)}-${dateStr.slice(5, 7)})`, slug: dateStr },
      { id: "week", label: `Weekly (${mondayStr.slice(8, 10)}-${mondayStr.slice(5, 7)})`, slug: `week-${mondayStr}` },
      { id: "month", label: `Monthly (${monthKey})`, slug: `month-${monthKey}` },
      { id: "quarter", label: `Quarterly (${yr}-Q${qNum})`, slug: `quarter-${yr}-Q${qNum}` },
    ],
    [dateStr, mondayStr, monthKey, yr, qNum]
  );

  const [selectedSlug, setSelectedSlug] = useState<string>(dateStr);
  const [subTab, setSubTab] = useState<"prep" | "review">("prep");
  const [expanded, setExpanded] = useState<boolean>(false);
  const [entryData, setEntryData] = useState<{
    title: string;
    content: string;
    reviewContent: string;
    lessonsLearned: string;
  } | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/journal/${encodeURIComponent(selectedSlug)}`)
      .then((r) => r.json())
      .then((res) => {
        const entry = res?.data?.entry || res?.entry;
        if (entry) {
          setEntryData({
            title: entry.title || selectedSlug,
            content: entry.content || "",
            reviewContent: entry.reviewContent || "",
            lessonsLearned: entry.lessonsLearned || "",
          });
        } else {
          setEntryData(null);
        }
      })
      .catch(() => setEntryData(null))
      .finally(() => setLoading(false));
  }, [selectedSlug]);

  return (
    <Card className="border-indigo-500/30 bg-[#12141d]">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
        <div className="flex items-center gap-2">
          <CardTitle className="text-sm font-bold">
            HTF &amp; Daily Journal Companion
          </CardTitle>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="rounded border border-border/60 bg-secondary/40 hover:bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:text-foreground transition"
          >
            {expanded ? "Compact" : "Expand Height"}
          </button>
        </div>

        <a
          href={`/journal/${selectedSlug}`}
          className="inline-flex items-center gap-1 text-[11px] text-indigo-400 hover:underline font-medium"
        >
          <span>Open Journal</span>
          <ExternalLink className="h-3 w-3" />
        </a>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {/* Period Switcher Pills */}
        <div className="flex flex-wrap items-center gap-1">
          {periods.map((p) => (
            <button
              key={p.slug}
              type="button"
              onClick={() => setSelectedSlug(p.slug)}
              className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition ${
                selectedSlug === p.slug
                  ? "bg-indigo-600 text-white shadow"
                  : "bg-[#181b26] text-muted-foreground hover:text-foreground border border-border/50"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Prep vs Review Sub-Tab */}
        <div className="rounded-lg border border-border/60 bg-[#0d0f14] p-3 space-y-2">
          <div className="flex items-center justify-between border-b border-border/40 pb-1.5">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setSubTab("prep")}
                className={`px-2 py-0.5 rounded text-[10px] font-semibold transition ${
                  subTab === "prep"
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Synthesis / Prep Notes
              </button>
              <button
                type="button"
                onClick={() => setSubTab("review")}
                className={`px-2 py-0.5 rounded text-[10px] font-semibold transition ${
                  subTab === "review"
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Period Review
              </button>
            </div>
            <span className="text-[10px] text-muted-foreground font-mono">
              {selectedSlug}
            </span>
          </div>

          {entryData?.lessonsLearned && (
            <div className="rounded bg-indigo-950/25 border border-indigo-500/30 px-2.5 py-1 text-[11px] text-indigo-200">
              <span className="font-bold uppercase text-[9px] tracking-wider text-indigo-400 mr-1.5">
                Key Focus:
              </span>
              {entryData.lessonsLearned}
            </div>
          )}

          <div
            style={{ height: expanded ? "520px" : "260px", minHeight: "140px" }}
            className="resize-y overflow-y-auto pr-1 text-xs"
          >
            {loading ? (
              <div className="py-6 text-center text-muted-foreground">
                Loading {selectedSlug} journal...
              </div>
            ) : subTab === "prep" ? (
              entryData?.content && entryData.content.replace(/<[^>]+>/g, "").trim() ? (
                <Markdown content={entryData.content} className="!p-0" />
              ) : (
                <div className="py-6 text-center text-muted-foreground italic text-[11px]">
                  No Prep/Synthesis notes recorded for {selectedSlug}.
                </div>
              )
            ) : entryData?.reviewContent &&
              entryData.reviewContent.replace(/<[^>]+>/g, "").trim() ? (
              <Markdown content={entryData.reviewContent} className="!p-0" />
            ) : (
              <div className="py-6 text-center text-muted-foreground italic text-[11px]">
                No Review notes recorded for {selectedSlug}.
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function AnnotationsCard({
  trade,
  onPatch,
}: {
  trade: TradeDetail;
  onPatch: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [activeNoteTab, setActiveNoteTab] = useState<"setup" | "review">("setup");
  const activeNoteTabRef = useRef<"setup" | "review">(activeNoteTab);
  activeNoteTabRef.current = activeNoteTab;

  const [notes, setNotes] = useState(() => cleanLegacyTradeNotes(trade.notes));
  const [reviewNotes, setReviewNotes] = useState(
    () => trade.review_notes || trade.reviewNotes || ""
  );
  const noteEditor = useRef<RichEditorHandle>(null);
  const [tags, setTags] = useState((JSON.parse(trade.tagsJson ?? "[]") as string[]).join(", "));
  const [mistakes, setMistakes] = useState(
    (JSON.parse(trade.mistakesJson ?? "[]") as string[]).join(", ")
  );
  const [stopLoss, setStopLoss] = useState(trade.stopLoss?.toString() ?? "");
  const [profitTarget, setProfitTarget] = useState(trade.profitTarget?.toString() ?? "");
  const [notionUrl, setNotionUrl] = useState<string | null>(
    (trade as any).notionUrl || (trade as any).notion_url || null
  );
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<"saved" | "unsaved" | "working" | "notion" | "error">("saved");
  const [isPulling, setIsPulling] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isManualSaving, setIsManualSaving] = useState(false);
  const [saveBtnFlash, setSaveBtnFlash] = useState(false);
  const [notionBtnFlash, setNotionBtnFlash] = useState(false);
  const [pullBtnFlash, setPullBtnFlash] = useState(false);

  const [matchingDrafts, setMatchingDrafts] = useState<Array<any>>([]);
  const [sameDayTradeCount, setSameDayTradeCount] = useState<number>(1);
  const [dismissedDraftBanner, setDismissedDraftBanner] = useState(false);
  const [matcherModalOpen, setMatcherModalOpen] = useState(false);

  const fetchMatchingNotebookDrafts = () => {
    fetch(`/api/notebook-bridge?tradeKey=${encodeURIComponent(trade.key)}`)
      .then((r) => r.json())
      .then((res) => {
        if (res.ok) {
          setMatchingDrafts(res.matchingDrafts || []);
          setSameDayTradeCount((res.sameDayTrades || []).length || 1);
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    fetchMatchingNotebookDrafts();
  }, [trade.key]);

  const { data: playbookData } = useApi<{ playbooks: { id: string; name: string }[] }>(
    "/api/playbooks"
  );
  const {
    save: rawDebounced,
    status: saveStatus,
    flush: rawFlush,
  } = useAutosave(`/api/trades/${encodeURIComponent(trade.key)}`, "PATCH");

  const pendingPatchRef = useRef<Record<string, unknown>>({});
  const isDirtyPatchRef = useRef<boolean>(false);
  const savedNotesRef = useRef<string>(notes);
  const savedReviewNotesRef = useRef<string>(reviewNotes);

  const debounced = (patchObj: Record<string, unknown>) => {
    pendingPatchRef.current = { ...pendingPatchRef.current, ...patchObj };
    isDirtyPatchRef.current = true;
    setStatusTone("unsaved");
    setSyncMsg("Unsaved changes...");
    rawDebounced(patchObj);
  };

  const captureLiveEditorIntoPatch = (): Record<string, unknown> => {
    const liveHtml = noteEditor.current?.getHtml?.();
    const extra: Record<string, unknown> = {};
    if (typeof liveHtml === "string") {
      if (activeNoteTabRef.current === "review") {
        if (liveHtml !== savedReviewNotesRef.current) {
          setReviewNotes(liveHtml);
          extra.reviewNotes = liveHtml;
        }
      } else {
        if (liveHtml !== savedNotesRef.current) {
          setNotes(liveHtml);
          extra.notes = liveHtml;
        }
      }
    }
    return extra;
  };

  const flush = async (manualClick = false) => {
    const liveExtra = captureLiveEditorIntoPatch();
    const combined = { ...pendingPatchRef.current, ...liveExtra };
    isDirtyPatchRef.current = false;
    pendingPatchRef.current = {};

    if (manualClick) setIsManualSaving(true);
    setStatusTone("working");
    setSyncMsg("Saving...");

    try {
      if (Object.keys(combined).length > 0) {
        await fetch(`/api/trades/${encodeURIComponent(trade.key)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(combined),
        });
        if (typeof combined.notes === "string") savedNotesRef.current = combined.notes;
        if (typeof combined.reviewNotes === "string") savedReviewNotesRef.current = combined.reviewNotes;
      }
      await rawFlush();
      setStatusTone("saved");
      setSyncMsg("Saved");
      if (manualClick) {
        setSaveBtnFlash(true);
        setTimeout(() => setSaveBtnFlash(false), 2200);
      }
    } catch {
      setStatusTone("error");
      setSyncMsg("Save failed");
    } finally {
      if (manualClick) setIsManualSaving(false);
    }
  };

  useEffect(() => {
    if (saveStatus === "Saving…") {
      setStatusTone("working");
      setSyncMsg("Saving...");
    } else if (saveStatus === "Saved") {
      isDirtyPatchRef.current = false;
      pendingPatchRef.current = {};
      savedNotesRef.current = notes;
      savedReviewNotesRef.current = reviewNotes;
      setStatusTone((prev) => (prev === "notion" ? "notion" : "saved"));
      setSyncMsg((prev) => (prev === "Synced to Notion" || prev === "Pulled from Notion" ? prev : "Saved"));
    } else if (saveStatus && /error|fail/i.test(saveStatus)) {
      setStatusTone("error");
      setSyncMsg(saveStatus);
    }
  }, [saveStatus, notes, reviewNotes]);

  // Guaranteed save flush when flipping to another page or closing tab (captures live RichEditor DOM!)
  useEffect(() => {
    const flushOnLeave = () => {
      const liveExtra = captureLiveEditorIntoPatch();
      const bodyToFlush = { ...pendingPatchRef.current, ...liveExtra };
      if (isDirtyPatchRef.current || Object.keys(bodyToFlush).length > 0) {
        isDirtyPatchRef.current = false;
        pendingPatchRef.current = {};
        try {
          fetch(`/api/trades/${encodeURIComponent(trade.key)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(bodyToFlush),
            keepalive: true,
          }).catch(() => {});
        } catch {}
      }
    };
    window.addEventListener("pagehide", flushOnLeave);
    window.addEventListener("beforeunload", flushOnLeave);
    return () => {
      window.removeEventListener("pagehide", flushOnLeave);
      window.removeEventListener("beforeunload", flushOnLeave);
      flushOnLeave();
    };
  }, [trade.key]);

  const { data: configData } = useApi<{
    config?: {
      templates?: Array<{ id: string; name: string; content: string }>;
      defaultTemplates?: Record<string, string>;
    };
  }>("/api/journal/config");

  const autoPopulatedRef = useRef(false);
  useEffect(() => {
    if (autoPopulatedRef.current || !configData?.config) return;
    const { templates = [], defaultTemplates = {} } = configData.config;

    let didPopulate = false;

    if (!notes.trim() && defaultTemplates.trade_setup) {
      const tpl = templates.find((t) => t.id === defaultTemplates.trade_setup);
      if (tpl?.content && tpl.content.trim()) {
        setNotes(tpl.content);
        debounced({ notes: tpl.content });
        didPopulate = true;
      }
    }

    if (!reviewNotes.trim() && defaultTemplates.trade_review) {
      const tpl = templates.find((t) => t.id === defaultTemplates.trade_review);
      if (tpl?.content && tpl.content.trim()) {
        setReviewNotes(tpl.content);
        debounced({ reviewNotes: tpl.content });
        didPopulate = true;
      }
    }

    if (didPopulate) {
      autoPopulatedRef.current = true;
    }
  }, [configData, notes, reviewNotes]);

  // Support Ctrl+S / Cmd+S keyboard shortcut to save immediately
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void flush(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const handlePatchWithFeedback = async (body: Record<string, unknown>) => {
    setStatusTone("working");
    setSyncMsg("Saving...");
    try {
      await onPatch(body);
      setStatusTone("saved");
      setSyncMsg("Saved");
    } catch {
      setStatusTone("error");
      setSyncMsg("Save failed");
    }
  };

  const handlePullFromNotion = async () => {
    setIsPulling(true);
    setStatusTone("working");
    setSyncMsg("Pulling from Notion...");
    try {
      const res = await fetch(`/api/trades/${encodeURIComponent(trade.key)}/notion`);
      const rawText = await res.text();
      let data: any = {};
      try {
        data = JSON.parse(rawText);
      } catch {
        throw new Error(`Server returned status ${res.status}: ${rawText.slice(0, 100)}`);
      }
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
      if (typeof data.notes === "string") {
        setNotes(data.notes);
        savedNotesRef.current = data.notes;
      }
      if (data.notionUrl) setNotionUrl(data.notionUrl);
      setStatusTone("notion");
      setSyncMsg("Pulled from Notion");
      setPullBtnFlash(true);
      setTimeout(() => {
        setPullBtnFlash(false);
        setStatusTone("saved");
        setSyncMsg("Saved");
      }, 3200);
      void onPatch({});
    } catch (err: any) {
      setStatusTone("error");
      setSyncMsg(err?.message || "Error pulling from Notion");
    } finally {
      setIsPulling(false);
    }
  };

  const handleSyncToNotion = async (): Promise<string | null> => {
    setIsSyncing(true);
    setStatusTone("working");
    setSyncMsg("Syncing to Notion...");
    try {
      const liveExtra = captureLiveEditorIntoPatch();
      const latestNotes = typeof liveExtra.notes === "string" ? liveExtra.notes : notes;
      const latestRev = typeof liveExtra.reviewNotes === "string" ? liveExtra.reviewNotes : reviewNotes;
      await flush(false);
      setStatusTone("working");
      setSyncMsg("Syncing to Notion...");

      const res = await fetch(`/api/trades/${encodeURIComponent(trade.key)}/notion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: latestNotes, reviewNotes: latestRev }),
      });
      const rawText = await res.text();
      let data: any = {};
      try {
        data = JSON.parse(rawText);
      } catch {
        throw new Error(`Server returned status ${res.status}: ${rawText.slice(0, 100)}`);
      }
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
      const resolvedUrl = data.notionUrl || notionUrl || null;
      if (data.notionUrl) setNotionUrl(data.notionUrl);
      setStatusTone("notion");
      setSyncMsg("Synced to Notion");
      setNotionBtnFlash(true);
      setTimeout(() => {
        setNotionBtnFlash(false);
        setStatusTone("saved");
        setSyncMsg("Saved");
      }, 3200);
      return resolvedUrl;
    } catch (err: any) {
      setStatusTone("error");
      setSyncMsg(err?.message || "Error syncing to Notion");
      return null;
    } finally {
      setIsSyncing(false);
    }
  };

  const handleOpenInNotion = async () => {
    if (notionUrl) {
      if (isDirtyPatchRef.current) {
        void flush(false);
      }
      window.open(notionUrl, "_blank", "noopener,noreferrer");
      return;
    }
    const newWin = window.open("about:blank", "_blank");
    const createdUrl = await handleSyncToNotion();
    if (createdUrl) {
      if (newWin) newWin.location.href = createdUrl;
      else window.open(createdUrl, "_blank", "noopener,noreferrer");
    } else if (newWin) {
      newWin.close();
    }
  };

  const parseList = (value: string) =>
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

  const displayStatusText = syncMsg || saveStatus || "Saved";

  return (
    <Card className="border-border/70">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
        <CardTitle className="text-sm font-bold">Journal this trade</CardTitle>

        {/* Unified Notion + Save Action Bar (Matches Daily Journal & Missed Trades) */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            role="status"
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition-all ${
              statusTone === "error"
                ? "border-rose-500/40 bg-rose-500/15 text-rose-400"
                : statusTone === "unsaved"
                ? "border-amber-500/40 bg-amber-500/15 text-amber-300"
                : statusTone === "working"
                ? "border-indigo-500/40 bg-indigo-500/15 text-indigo-300"
                : statusTone === "notion"
                ? "border-emerald-500/50 bg-emerald-500/20 text-emerald-300 shadow-2xs"
                : "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
            }`}
          >
            {statusTone === "working" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : statusTone === "unsaved" ? (
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
            ) : statusTone === "error" ? (
              <span>⚠</span>
            ) : (
              <span>✓</span>
            )}
            <span>{displayStatusText}</span>
          </span>

          <button
            type="button"
            disabled={isSyncing}
            onClick={() => void handleOpenInNotion()}
            className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border bg-secondary/40 px-2.5 text-[11px] font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-50"
            title={notionUrl ? "Open linked Notion page" : "Create & open Notion page for this trade"}
          >
            {notionUrl && (
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" title="Linked to Notion" />
            )}
            <span>{notionUrl ? "Open in Notion" : "Create & Open in Notion"}</span>
            {isSyncing && !notionUrl ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <ExternalLink className="h-3 w-3 opacity-70" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setMatcherModalOpen(true)}
            className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-2.5 text-[11px] font-semibold text-indigo-300 transition-colors hover:bg-indigo-500/20"
            title="Pull a draft from Notebook and archive it"
          >
            <ArrowRightLeft className="h-3 w-3" />
            <span>Pull from Notebook</span>
          </button>

          <button
            type="button"
            onClick={() => void handlePullFromNotion()}
            disabled={isPulling || isSyncing}
            className={`inline-flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-medium transition-colors disabled:opacity-50 ${
              pullBtnFlash
                ? "border-emerald-500/50 bg-emerald-500/20 text-emerald-300 font-semibold"
                : "border-border bg-secondary/40 text-foreground hover:bg-secondary"
            }`}
          >
            {isPulling ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Download className="h-3 w-3 opacity-80" />
            )}
            <span>{pullBtnFlash ? "✓ Pulled!" : "Pull from Notion"}</span>
          </button>

          <button
            type="button"
            onClick={() => void handleSyncToNotion()}
            disabled={isPulling || isSyncing}
            className={`inline-flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-medium transition-colors disabled:opacity-50 ${
              notionBtnFlash
                ? "border-emerald-500/50 bg-emerald-500/20 text-emerald-300 font-semibold"
                : "border-border bg-secondary/40 text-foreground hover:bg-secondary"
            }`}
          >
            {isSyncing ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <UploadCloud className="h-3 w-3 opacity-80" />
            )}
            <span>
              {isSyncing
                ? "Syncing..."
                : notionBtnFlash
                ? "✓ Synced to Notion!"
                : "Sync to Notion"}
            </span>
          </button>

          <button
            type="button"
            disabled={isManualSaving}
            onClick={() => void flush(true)}
            className={`inline-flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-semibold shadow-2xs transition-colors ${
              saveBtnFlash
                ? "border-emerald-500/50 bg-emerald-500/20 text-emerald-300"
                : "border-border bg-secondary text-foreground hover:bg-secondary/80"
            }`}
          >
            {isManualSaving ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Save className="h-3 w-3 opacity-80" />
            )}
            <span>
              {isManualSaving ? "Saving..." : saveBtnFlash ? "✓ Saved!" : "Save (Ctrl+S)"}
            </span>
          </button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <NotebookTradeMatcherModal
          open={matcherModalOpen}
          onOpenChange={setMatcherModalOpen}
          preselectedTradeKey={trade.key}
          onCompleted={(msg) => {
            setStatusTone("saved");
            setSyncMsg(msg);
            fetchMatchingNotebookDrafts();
            fetch(`/api/trades/${encodeURIComponent(trade.key)}`)
              .then((r) => r.json())
              .then((d) => {
                if (d?.trade) {
                  const cleaned = cleanLegacyTradeNotes(d.trade.notes);
                  const rev = d.trade.review_notes || d.trade.reviewNotes || "";
                  setNotes(cleaned);
                  setReviewNotes(rev);
                  savedNotesRef.current = cleaned;
                  savedReviewNotesRef.current = rev;
                }
              });
            void onPatch({});
          }}
        />

        {!dismissedDraftBanner && matchingDrafts.length > 0 && (
          <div className="rounded-xl border border-indigo-500/40 bg-indigo-950/25 p-3 space-y-2 text-xs">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2">
                <FileText className="h-4 w-4 text-indigo-400 shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold text-indigo-200">
                    {matchingDrafts.length === 1 && sameDayTradeCount <= 1
                      ? `Matching Notebook Draft Found: "${matchingDrafts[0].title || "Untitled"}"`
                      : `Found ${matchingDrafts.length} Matching Notebook Draft(s) for This Session`}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {matchingDrafts.length === 1 && sameDayTradeCount <= 1
                      ? "Would you like to move this draft (and its screenshots) into this trade and archive the draft (auto-deletes in 14 days)?"
                      : `There are ${matchingDrafts.length} draft(s) and ${sameDayTradeCount} trade(s) on this date. Click 'Match & Confirm' to choose which draft goes to which trade.`}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDismissedDraftBanner(true)}
                className="text-[10px] text-muted-foreground hover:text-foreground px-1.5 py-0.5"
              >
                Dismiss
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2 pl-6">
              {matchingDrafts.length === 1 && sameDayTradeCount <= 1 && (
                <button
                  type="button"
                  onClick={async () => {
                    const draft = matchingDrafts[0];
                    if (
                      !window.confirm(
                        `Confirm moving Notebook draft "${draft.title}" into ${trade.symbol} ${trade.direction.toUpperCase()}?\n\nThe draft will be archived and automatically deleted in 14 days.`
                      )
                    ) {
                      return;
                    }
                    const res = await fetch("/api/notebook-bridge", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        action: "transfer_to_trades",
                        transfers: [
                          {
                            noteId: draft.id,
                            tradeKey: trade.key,
                            targetSection: "setup",
                            mode: "append",
                          },
                        ],
                      }),
                    });
                    const out = await res.json();
                    if (out.ok) {
                      setStatusTone("saved");
                      setSyncMsg("Moved Notebook draft & archived!");
                      fetchMatchingNotebookDrafts();
                      const tRes = await fetch(`/api/trades/${encodeURIComponent(trade.key)}`).then((r) => r.json());
                      if (tRes?.trade) {
                        const cleaned = cleanLegacyTradeNotes(tRes.trade.notes);
                        const rev = tRes.trade.review_notes || tRes.trade.reviewNotes || "";
                        setNotes(cleaned);
                        setReviewNotes(rev);
                        savedNotesRef.current = cleaned;
                        savedReviewNotesRef.current = rev;
                      }
                      void onPatch({});
                    }
                  }}
                  className="rounded-lg bg-indigo-600 hover:bg-indigo-500 px-3 py-1 text-[11px] font-semibold text-white shadow transition"
                >
                  Confirm &amp; Move Draft Here
                </button>
              )}

              <button
                type="button"
                onClick={() => setMatcherModalOpen(true)}
                className="rounded-lg border border-indigo-500/40 bg-indigo-500/15 hover:bg-indigo-500/25 px-3 py-1 text-[11px] font-semibold text-indigo-200 transition"
              >
                {matchingDrafts.length > 1 || sameDayTradeCount > 1
                  ? "Match Drafts to Trades..."
                  : "Choose Section / Match Multiple..."}
              </button>
            </div>
          </div>
        )}

        <div className="flex items-center justify-end">
          <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
            <Checkbox
              checked={trade.reviewedAt !== null}
              onCheckedChange={(checked) => void handlePatchWithFeedback({ reviewed: checked === true })}
            />
            <span className="font-medium text-foreground">Reviewed</span>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[11px] text-muted-foreground">Stop loss</label>
            <MonetaryField>
              <Input
                value={stopLoss}
                onChange={(e) => {
                  setStopLoss(e.target.value);
                  debounced({ stopLoss: e.target.value === "" ? null : Number(e.target.value) });
                }}
                placeholder="planned stop"
                inputMode="decimal"
                className="h-8 text-xs"
              />
            </MonetaryField>
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground">Profit target</label>
            <MonetaryField>
              <Input
                value={profitTarget}
                onChange={(e) => {
                  setProfitTarget(e.target.value);
                  debounced({
                    profitTarget: e.target.value === "" ? null : Number(e.target.value),
                  });
                }}
                placeholder="planned target"
                inputMode="decimal"
                className="h-8 text-xs"
              />
            </MonetaryField>
          </div>
        </div>

        <div>
          <label className="text-[11px] text-muted-foreground">Playbook / Strategy Model</label>
          <Select
            value={trade.playbookId ?? "none"}
            onValueChange={(val) => void handlePatchWithFeedback({ playbookId: val === "none" ? null : val })}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="No playbook" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No playbook</SelectItem>
              {playbookData?.playbooks.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <TradePlaybookChecklist
            tradeKey={trade.key}
            playbookId={trade.playbookId}
            asCard={false}
          />
        </div>

        <TradeTagsEditor
          selectedTags={parseList(tags)}
          selectedMistakes={parseList(mistakes)}
          onChange={(nextTags, nextMistakes) => {
            setTags(nextTags.join(", "));
            setMistakes(nextMistakes.join(", "));
            debounced({ tags: nextTags, mistakes: nextMistakes });
          }}
        />

        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-2">
            <div className="flex items-center gap-1 rounded-xl bg-[#0d0f14] p-1 border border-border/60">
              <button
                type="button"
                onClick={() => {
                  const liveExtra = captureLiveEditorIntoPatch();
                  if (Object.keys(liveExtra).length > 0) debounced(liveExtra);
                  setActiveNoteTab("setup");
                }}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                  activeNoteTab === "setup"
                    ? "bg-secondary text-foreground border border-border shadow"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Execution &amp; Setup Notes
              </button>
              <button
                type="button"
                onClick={() => {
                  const liveExtra = captureLiveEditorIntoPatch();
                  if (Object.keys(liveExtra).length > 0) debounced(liveExtra);
                  setActiveNoteTab("review");
                }}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                  activeNoteTab === "review"
                    ? "bg-secondary text-foreground border border-border shadow"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Trade Review
              </button>
            </div>

            <VoiceNote
              onPrepare={() => noteEditor.current?.focus()}
              onText={(text) => {
                if (activeNoteTab === "review") {
                  const next = reviewNotes ? `${reviewNotes} ${text}` : text;
                  setReviewNotes(next);
                  debounced({ reviewNotes: next });
                } else {
                  const next = notes ? `${notes} ${text}` : text;
                  setNotes(next);
                  debounced({ notes: next });
                }
              }}
            />
          </div>
          <RichEditor
            key={`${trade.key}-${activeNoteTab}`}
            editorRef={noteEditor}
            value={activeNoteTab === "review" ? reviewNotes : notes}
            ownerType="trade"
            ownerId={activeNoteTab === "review" ? `${trade.key}-review` : trade.key}
            onChange={(value) => {
              if (activeNoteTab === "review") {
                setReviewNotes(value);
                debounced({ reviewNotes: value });
              } else {
                setNotes(value);
                debounced({ notes: value });
              }
            }}
            companionNode={<TradePeriodCompanion openedAt={trade.openedAt} />}
          />
          <div className="mt-2">
            <ReviewExport
              containsFinancialData
              document={{
                title: `${trade.symbol} · ${trade.direction} review`,
                subtitle: `${trade.openedAt} · ${trade.currency}`,
                lines: [
                  `Status: ${trade.status} | Quantity: ${trade.quantity}`,
                  `Entry: ${trade.avgEntry} | Exit: ${trade.avgExit ?? "Open"}`,
                  `Net P&L: ${trade.netPnl.toFixed(2)} | Fees: ${trade.fees.toFixed(2)}`,
                  `Stop: ${stopLoss || "Unspecified"} | Target: ${profitTarget || "Unspecified"}`,
                  `Tags: ${tags || "None"} | Mistakes: ${mistakes || "None"}`,
                  "",
                  notes,
                ],
              }}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
