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
import { TradeTagsEditor } from "@/components/tags/trade-tags-editor";
import { AiNotice } from "@/components/ai-notice";
import { useAutosave } from "@/lib/use-autosave";
import { postJson, useApi } from "@/lib/use-api";
import { fmtDuration, fmtMoney, fmtNumber, fmtPercent } from "@/lib/utils";
import { tradeKeyFromSegment } from "@/lib/trade-links";
import { formatTimestamp } from "@/lib/timezone";

interface TradeDetail {
  riskAmount: number | null;
  realizedR: number | null;
  plannedR: number | null;
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
    const matches = [...notes.matchAll(/\[(\d+)\]\s+([\d.]+)L?\s+@\s+([\d.]+)(?:\s+@\s+([\d:]+))?\s*\(([+-]?\$?[\d.]+)?(?:,\s*([^)]+))?\)/gi)];
    if (!matches.length) return rawExecutions;

    const isShort = trade.direction === "short";
    const openMs = Date.parse(trade.openedAt);
    const closeMs = trade.closedAt ? Date.parse(trade.closedAt) : openMs;
    const dur = Math.max(0, closeMs - openMs);
    const step = matches.length > 1 ? dur / matches.length : 0;

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

    matches.forEach((m, idx) => {
      const q = parseFloat(m[2]!);
      const p = parseFloat(m[3]!);
      const timeStr = m[4]; // optional HH:MM:SS
      const pnlRaw = m[5] ? parseFloat(m[5].replace(/[+$,]/g, "")) : 0;
      const reason = m[6] || "TP";

      let legTime: string;
      if (timeStr && trade.openedAt) {
        const datePrefix = trade.openedAt.slice(0, 10);
        const parsed = Date.parse(`${datePrefix}T${timeStr}Z`);
        legTime = Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date(openMs + step * (idx + 1)).toISOString();
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
        <Card className="border-border/70 bg-[#12141c]">
          <CardContent className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3 py-4">
            <div className="flex items-center gap-4">
              <div>
                <div className="text-xs text-muted-foreground">Net P&L</div>
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
            </div>

            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
              <Meta label="Gross" value={fmtMoney(trade.grossPnl)} monetary />
              <Meta label="Fees" value={fmtMoney(trade.fees)} monetary />
              <Meta label="Volume" value={fmtNumber(trade.quantity, 2)} />
              <Meta label="Avg entry" value={fmtNumber(trade.avgEntry)} monetary />
              <Meta
                label="Avg exit"
                monetary
                value={trade.avgExit === null ? "open" : fmtNumber(trade.avgExit)}
              />
              <Meta label="Duration" value={fmtDuration(trade.durationMs)} />
              <Meta label="Net / entry" value={fmtPercent(netReturnOnEntry(trade), 2)} />
              <Meta
                label="Planned R"
                value={trade.plannedR === null ? "–" : `${fmtNumber(trade.plannedR)}R`}
              />
              <Meta
                label="Realized R"
                value={trade.realizedR === null ? "–" : `${fmtNumber(trade.realizedR)}R`}
              />
            </div>

            {/* Quick Column Collapse Toggles */}
            <div className="flex items-center gap-1.5 border-l border-border/50 pl-4">
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
          </CardContent>
        </Card>

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
              <RuleChecklist tradeKey={trade.key} playbookId={trade.playbookId} />

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
      { id: "day", label: `Daily (${dateStr.slice(5)})`, slug: dateStr },
      { id: "week", label: `Weekly (${mondayStr.slice(5)})`, slug: `week-${mondayStr}` },
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
  const [isPulling, setIsPulling] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  const { data: playbookData } = useApi<{ playbooks: { id: string; name: string }[] }>(
    "/api/playbooks"
  );
  const {
    save: debounced,
    status: saveStatus,
    flush,
  } = useAutosave(`/api/trades/${encodeURIComponent(trade.key)}`, "PATCH", () => void onPatch({}));

  // Support Ctrl+S / Cmd+S keyboard shortcut to save immediately
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void flush();
        setSyncMsg("Saved");
        setTimeout(() => setSyncMsg(null), 2000);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [flush]);

  const handlePullFromNotion = async () => {
    setIsPulling(true);
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
      }
      if (data.notionUrl) setNotionUrl(data.notionUrl);
      setSyncMsg("Pulled from Notion");
      void onPatch({});
    } catch (err: any) {
      setSyncMsg(err?.message || "Error pulling from Notion");
    } finally {
      setIsPulling(false);
      setTimeout(() => setSyncMsg(null), 3500);
    }
  };

  const handleSyncToNotion = async () => {
    setIsSyncing(true);
    setSyncMsg("Syncing to Notion...");
    try {
      await flush();
      const res = await fetch(`/api/trades/${encodeURIComponent(trade.key)}/notion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      });
      const rawText = await res.text();
      let data: any = {};
      try {
        data = JSON.parse(rawText);
      } catch {
        throw new Error(`Server returned status ${res.status}: ${rawText.slice(0, 100)}`);
      }
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
      if (data.notionUrl) setNotionUrl(data.notionUrl);
      setSyncMsg("Synced to Notion");
    } catch (err: any) {
      setSyncMsg(err?.message || "Error syncing to Notion");
    } finally {
      setIsSyncing(false);
      setTimeout(() => setSyncMsg(null), 3500);
    }
  };

  const parseList = (value: string) =>
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

  return (
    <Card className="border-border/70">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
        <CardTitle className="text-sm font-bold">Journal this trade</CardTitle>

        {/* Unified Notion + Save Action Bar (Matches Daily Journal) */}
        <div className="flex flex-wrap items-center gap-1.5">
          {(syncMsg || saveStatus) && (
            <span className="mr-1 text-[11px] font-medium text-muted-foreground" role="status">
              {syncMsg || saveStatus}
            </span>
          )}

          {notionUrl && (
            <a
              href={notionUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border bg-secondary/40 px-2.5 text-[11px] font-medium text-foreground transition-colors hover:bg-secondary"
            >
              <span>Open in Notion</span>
              <ExternalLink className="h-3 w-3 opacity-70" />
            </a>
          )}

          <button
            type="button"
            onClick={handlePullFromNotion}
            disabled={isPulling || isSyncing}
            className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border bg-secondary/40 px-2.5 text-[11px] font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-50"
          >
            {isPulling ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Download className="h-3 w-3 opacity-80" />
            )}
            <span>Pull from Notion</span>
          </button>

          <button
            type="button"
            onClick={handleSyncToNotion}
            disabled={isPulling || isSyncing}
            className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border bg-secondary/40 px-2.5 text-[11px] font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-50"
          >
            {isSyncing ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <UploadCloud className="h-3 w-3 opacity-80" />
            )}
            <span>Sync to Notion</span>
          </button>

          <button
            type="button"
            onClick={() => {
              void flush();
              setSyncMsg("Saved");
              setTimeout(() => setSyncMsg(null), 2000);
            }}
            className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border bg-secondary px-2.5 text-[11px] font-semibold text-foreground shadow-2xs transition-colors hover:bg-secondary/80"
          >
            <Save className="h-3 w-3 opacity-80" />
            <span>Save (Ctrl+S)</span>
          </button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <TradeRating value={trade.rating} onChange={(rating) => onPatch({ rating })} />
          <label className="flex items-center gap-2 text-xs">
            <Checkbox
              checked={trade.reviewedAt !== null}
              onCheckedChange={(checked) => void onPatch({ reviewed: checked === true })}
            />
            Reviewed
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
          <label className="text-[11px] text-muted-foreground">Playbook</label>
          <Select
            value={trade.playbookId ?? "none"}
            onValueChange={(val) => void onPatch({ playbookId: val === "none" ? null : val })}
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
                onClick={() => setActiveNoteTab("setup")}
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
                onClick={() => setActiveNoteTab("review")}
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
