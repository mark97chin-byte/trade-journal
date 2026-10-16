"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Vela } from "@luxalgo/vela";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Pause,
  Play,
  RotateCcw,
  SkipForward,
  Plus,
  Minus,
  Loader2,
  Settings2,
} from "lucide-react";
import {
  RESOLUTIONS,
  type MarketConnection,
  type ExcursionEstimate,
  type Resolution,
  type TradeMarketResult,
  aggregateCandles,
} from "@/lib/market-data";
import { providerInfo } from "@/lib/market-providers";
import type { MarketCsvDataset } from "@/lib/market-csv";
import { replayFrame } from "@/lib/trade-replay";
import { useApi } from "@/lib/use-api";
import { fmtMoney } from "@/lib/utils";
import { TradeChart, type ChartExecution, type ChartTrade } from "./trade-chart";
import { usePrivacy } from "./privacy";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { OptionSelect } from "./ui/option-select";
import { resolveProviderSymbol } from "@/lib/symbol-mapping";

const ALL_RESOLUTIONS: Resolution[] = [
  "1m",
  "3m",
  "4m",
  "5m",
  "15m",
  "30m",
  "1h",
  "4h",
  "7h",
  "1d",
  "1w",
  "1M",
];

export function TradeMarketData({
  trade,
  executions,
  onResultChange,
}: {
  onResultChange?: (result: TradeMarketResult | null) => void;
  trade: ChartTrade & { currency: string };
  executions: ChartExecution[];
}) {
  const privacy = usePrivacy();
  const cacheKey = `candle_cache_${trade.key}`;

  const { data: saved, refresh: refreshSaved } = useApi<{
    saved: { estimate: ExcursionEstimate } | null;
  }>(`/api/trades/${encodeURIComponent(trade.key)}/market-data`);
  const { data: connections, error: connectionError } = useApi<{ connections: MarketConnection[] }>(
    "/api/market-data/connections"
  );
  const available = connections?.connections.filter((c) => c.configured) ?? [];

  const [provider, setProvider] = useState("");
  const [symbol, setSymbol] = useState(trade.symbol);
  const [dataset, setDataset] = useState("");
  const [resolution, setResolution] = useState<Resolution>("1m");
  const [paddingDays, setPaddingDays] = useState<number>(5);
  const [confirmed, setConfirmed] = useState(false);

  const [result, setResult] = useState<TradeMarketResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [isCardExpanded, setIsCardExpanded] = useState(false);
  const [hasAutoLoaded, setHasAutoLoaded] = useState(false);

  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  // 1. Initial Provider & Symbol Auto-mapping
  useEffect(() => {
    if (!provider && available.length > 0) {
      const lse = available.find((a) => a.id === "london-strategic-edge");
      const target = lse?.id ?? available[0]?.id ?? "";
      setProvider(target);
      const mapped = resolveProviderSymbol(target, trade.symbol);
      setSymbol(mapped.symbol);
      setDataset(mapped.dataset || "");
    }
  }, [available, provider, trade.symbol]);

  const info = providerInfo(provider);
  const { data: csv } = useApi<{ datasets: MarketCsvDataset[] }>(
    info?.mode === "csv" ? "/api/market-data/csv" : null
  );

  const currentAutoMapped = useMemo(() => {
    return provider ? resolveProviderSymbol(provider, trade.symbol) : null;
  }, [provider, trade.symbol]);

  const invalidate = () => {
    controller.current?.abort();
    setBusy(false);
    setResult(null);
    onResultChange?.(null);
    setError("");
  };

  // 2. Fetch candles and store in LocalStorage
  const load = async (overrides?: { resolution?: Resolution; paddingDays?: number }) => {
    if (!available.some((item) => item.id === provider) || (info?.datasets && !dataset)) return;
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setBusy(true);
    setError("");

    const targetRes = overrides?.resolution ?? resolution;
    const targetPadding = overrides?.paddingDays ?? paddingDays;

    try {
      const response = await fetch(`/api/trades/${encodeURIComponent(trade.key)}/market-data`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          symbol,
          dataset,
          resolution: targetRes,
          paddingDays: targetPadding,
          basisConfirmed: confirmed,
        }),
        signal: request.signal,
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "History request failed.");
      if (!request.signal.aborted) {
        setResult(body);
        onResultChange?.(body);
        if (overrides?.resolution) setResolution(overrides.resolution);
        if (overrides?.paddingDays !== undefined) setPaddingDays(overrides.paddingDays);
        refreshSaved();

        // Save candles to local storage
        try {
          localStorage.setItem(
            cacheKey,
            JSON.stringify({
              fetchedAt: Date.now(),
              resolution: targetRes,
              data: body,
            })
          );
        } catch {
          // ignore quota limits
        }
      }
    } catch (cause) {
      if (!request.signal.aborted)
        setError(cause instanceof Error ? cause.message : "History request failed.");
    } finally {
      if (!request.signal.aborted) setBusy(false);
    }
  };

  // 3. Auto-load candles immediately upon mount
  useEffect(() => {
    if (hasAutoLoaded || !provider || !symbol) return;
    setHasAutoLoaded(true);

    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed.data && Array.isArray(parsed.data.bars) && parsed.data.bars.length > 0) {
          setResult(parsed.data);
          onResultChange?.(parsed.data);
          if (parsed.resolution) setResolution(parsed.resolution);
          return;
        }
      }
    } catch {
      // ignore
    }

    // Auto-fetch if not in local storage
    void load();
  }, [hasAutoLoaded, provider, symbol, trade.key]);

  return (
    <div className="space-y-3">
      {/* 1. MAIN CHART (REPLAY OR STATIC WITH 1M CANDLE ALIGNED PARTIALS) */}
      {result && result.bars.length > 0 ? (
        <HistoricalReplay
          history={result}
          trade={trade}
          executions={executions}
          privacy={privacy}
          activeResolution={resolution}
          paddingDays={paddingDays}
          busy={busy}
          onTimeframeChange={(res) => load({ resolution: res })}
          onPaddingChange={(days) => load({ paddingDays: days })}
        />
      ) : (
        <>
          <div
            className="grid gap-3 rounded-lg border bg-card p-3 sm:grid-cols-3"
            aria-label="Market data feature status"
          >
            <div>
              <p className="text-xs text-muted-foreground">Estimated MAE</p>
              <p className="text-sm">
                {busy
                  ? "Loading candles…"
                  : error
                  ? "Data request failed"
                  : saved?.saved
                  ? privacy
                    ? "••••"
                    : fmtMoney(saved.saved.estimate.mae!, trade.currency)
                  : "Loading market data…"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Estimated MFE</p>
              <p className="text-sm">
                {busy
                  ? "Loading candles…"
                  : error
                  ? "Data request failed"
                  : saved?.saved
                  ? privacy
                    ? "••••"
                    : fmtMoney(saved.saved.estimate.mfe!, trade.currency)
                  : "Loading market data…"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Trade replay</p>
              <p className="text-sm">{busy ? "Loading candles…" : "Available upon candle load"}</p>
            </div>
          </div>
          <TradeChart
            trade={trade}
            executions={getEffectiveExecutions(trade, executions, result)}
          />
        </>
      )}

      {/* 2. COMPACT & COLLAPSIBLE MARKET DATA & REPLAY CARD BELOW CHART */}
      <Card className="border-border/60 bg-[#10121a]">
        <div className="flex items-center justify-between p-3">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="font-semibold text-foreground flex items-center gap-1.5">
              <Settings2 className="h-3.5 w-3.5 text-muted-foreground" />
              Market Data &amp; Replay
            </span>
            <span className="rounded bg-secondary/60 px-2 py-0.5 text-muted-foreground">
              {available.find((c) => c.id === provider)?.name || provider || "No provider"}
            </span>
            <span className="rounded bg-secondary/60 px-2 py-0.5 font-mono text-indigo-300">
              {symbol}
            </span>
            <span className="rounded bg-secondary/60 px-2 py-0.5 text-muted-foreground">
              {resolution} · {paddingDays}d
            </span>
            {result?.bars?.length ? (
              <span className="rounded bg-secondary/60 px-2 py-0.5 text-muted-foreground hidden sm:inline">
                {result.bars.length.toLocaleString()} candles · Retrieved {new Date(result.fetchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            ) : null}
            {busy && (
              <span className="inline-flex items-center gap-1 text-[11px] text-indigo-400">
                <Loader2 className="h-3 w-3 animate-spin" /> Fetching...
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              disabled={busy || !symbol.trim()}
              onClick={() => void load()}
            >
              {busy ? "Loading…" : "Reload candles"}
            </Button>
            <button
              type="button"
              onClick={() => setIsCardExpanded(!isCardExpanded)}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-border/60 hover:bg-secondary/50 text-muted-foreground hover:text-foreground"
              title={isCardExpanded ? "Collapse settings" : "Expand settings"}
            >
              {isCardExpanded ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        </div>

        {/* EXPANDABLE SECTION */}
        {isCardExpanded && (
          <CardContent className="border-t border-border/40 pt-3 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1">
                <Label htmlFor="market-provider">Data provider</Label>
                <OptionSelect
                  id="market-provider"
                  value={provider}
                  onValueChange={(val) => {
                    invalidate();
                    setProvider(val);
                    const mapped = resolveProviderSymbol(val, trade.symbol);
                    setSymbol(mapped.symbol);
                    setDataset(mapped.dataset || "");
                    setConfirmed(false);
                  }}
                >
                  {available.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </OptionSelect>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label htmlFor="market-symbol">Provider symbol</Label>
                  {currentAutoMapped && symbol !== currentAutoMapped.symbol && (
                    <button
                      type="button"
                      onClick={() => {
                        setSymbol(currentAutoMapped.symbol);
                        setDataset(currentAutoMapped.dataset || "");
                      }}
                      className="text-[11px] text-blue-400 hover:underline"
                    >
                      Reset to {currentAutoMapped.symbol}
                    </button>
                  )}
                </div>
                <Input
                  id="market-symbol"
                  value={symbol}
                  onChange={(e) => {
                    invalidate();
                    setSymbol(e.target.value);
                    setConfirmed(false);
                  }}
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="market-resolution">Candle resolution</Label>
                <OptionSelect
                  id="market-resolution"
                  value={resolution}
                  onValueChange={(val) => {
                    invalidate();
                    setResolution(val as Resolution);
                  }}
                >
                  {ALL_RESOLUTIONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </OptionSelect>
              </div>

              <div className="space-y-1">
                <Label htmlFor="market-padding">Lookback context</Label>
                <OptionSelect
                  id="market-padding"
                  value={String(paddingDays)}
                  onValueChange={(val) => {
                    invalidate();
                    setPaddingDays(Number(val));
                  }}
                >
                  <option value="1">1 Day</option>
                  <option value="3">3 Days</option>
                  <option value="5">5 Days</option>
                  <option value="10">10 Days</option>
                  <option value="15">15 Days</option>
                  <option value="30">30 Days</option>
                </OptionSelect>
              </div>
            </div>

            {(info?.datasets || info?.mode === "csv" || info?.id === "london-strategic-edge") && (
              <div className="space-y-1">
                <Label htmlFor="market-dataset">Data feed / dataset</Label>
                {info?.datasets || info?.mode === "csv" ? (
                  <OptionSelect
                    id="market-dataset"
                    value={dataset}
                    onValueChange={(val) => {
                      invalidate();
                      setDataset(val);
                      setConfirmed(false);
                    }}
                  >
                    {(
                      info.datasets ?? [
                        { value: "", label: "Automatic matching file" },
                        ...(csv?.datasets ?? []).map((item) => ({
                          value: item.id,
                          label: `${item.name} · ${item.symbol} · ${item.resolution}`,
                        })),
                      ]
                    ).map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </OptionSelect>
                ) : (
                  <Input
                    id="market-dataset"
                    value={dataset}
                    placeholder={
                      currentAutoMapped?.dataset || "Leave blank for automatic selection"
                    }
                    onChange={(e) => {
                      invalidate();
                      setDataset(e.target.value);
                      setConfirmed(false);
                    }}
                  />
                )}
              </div>
            )}

            <label className="flex items-start gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={confirmed}
                className="mt-0.5 accent-indigo-500"
                onChange={(e) => {
                  invalidate();
                  setConfirmed(e.target.checked);
                }}
              />
              <span>
                Calculate and save MAE/MFE estimates for Reports. ({trade.currency})
              </span>
            </label>

            {error && (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
          </CardContent>
        )}
      </Card>
    </div>
  );
}

/**
 * Calculates effective execution legs from recorded executions or MT5 partials breakdown text.
 * Anchors each partial TP/SL/Manual exit to its matching 1-minute candle average.
 */
export function getEffectiveExecutions(
  trade: ChartTrade,
  executions: ChartExecution[],
  history?: TradeMarketResult | null
): ChartExecution[] {
  const isShort = trade.direction
    ? trade.direction.toLowerCase() === "short" || trade.direction.toLowerCase() === "sell"
    : false;
  const entrySide = isShort ? "sell" : "buy";
  const exitSide = isShort ? "buy" : "sell";

  if (!history?.bars?.length || !trade.openedAt) {
    return executions;
  }

  const bars = history.bars;
  const getCandleAt = (targetMs: number) => {
    return bars.reduce((prev, curr) =>
      Math.abs(curr.time - targetMs) < Math.abs(prev.time - targetMs) ? curr : prev
    );
  };

  // Case A: Multiple recorded executions exist (from DB or parsed from breakdown)
  if (executions && executions.length > 0) {
    return executions.map((ex) => {
      const ms = Date.parse(ex.executedAt);
      const bar = getCandleAt(Number.isFinite(ms) ? ms : Date.parse(trade.openedAt));
      const price = Number(((bar.open + bar.close) / 2).toFixed(2));
      return {
        ...ex,
        price,
      };
    });
  }

  // Case B: Fallback - Reconstruct from partials_breakdown if executions table is empty
  const notesText = (trade as any).partials_breakdown || (trade as any).notes || "";
  const partialMatches = [...notesText.matchAll(/\[(\d+)\]\s+([\d.]+)L?\s+@\s+([\d.]+)/gi)];

  const openMs = Date.parse(trade.openedAt);
  const closeMs = trade.closedAt ? Date.parse(trade.closedAt) : openMs;

  const entryBar = getCandleAt(openMs);
  const entryAvg = Number(((entryBar.open + entryBar.close) / 2).toFixed(2));

  const fills: ChartExecution[] = [
    {
      side: entrySide,
      price: entryAvg,
      quantity: (trade as any).quantity || 1,
      executedAt: new Date(entryBar.time).toISOString(),
    },
  ];

  if (partialMatches.length > 0) {
    const exitDuration = Math.max(0, closeMs - openMs);
    const stepTime = partialMatches.length > 1 ? exitDuration / partialMatches.length : 0;

    partialMatches.forEach((m, idx) => {
      const legQty = parseFloat(m[2]!);
      const targetTimeMs = openMs + stepTime * (idx + 1);
      const legBar = getCandleAt(targetTimeMs);
      const legPrice = Number(((legBar.open + legBar.close) / 2).toFixed(2));

      fills.push({
        side: exitSide,
        price: legPrice,
        quantity: legQty,
        executedAt: new Date(legBar.time).toISOString(),
      });
    });
    return fills;
  }

  // Case C: Standard 1-entry 1-exit
  if (trade.closedAt) {
    const exitBar = getCandleAt(closeMs);
    const exitAvg = Number(((exitBar.open + exitBar.close) / 2).toFixed(2));
    fills.push({
      side: exitSide,
      price: exitAvg,
      quantity: (trade as any).quantity || 1,
      executedAt: new Date(exitBar.time).toISOString(),
    });
  }

  return fills;
}

export function HistoricalReplay({
  history,
  trade,
  executions,
  privacy,
  activeResolution = history.resolution,
  paddingDays = 5,
  busy = false,
  onTimeframeChange = () => {},
  onPaddingChange = () => {},
}: {
  history: TradeMarketResult;
  trade: ChartTrade & { currency: string };
  executions: ChartExecution[];
  privacy: boolean;
  activeResolution?: Resolution;
  paddingDays?: number;
  busy?: boolean;
  onTimeframeChange?: (res: Resolution) => void;
  onPaddingChange?: (days: number) => void;
}) {
  const effectiveExecutions = useMemo(
    () => getEffectiveExecutions(trade, executions, history),
    [trade, executions, history]
  );

  const findClosestBarIndex = (targetMs: number) => {
    let closest = 0;
    let minDiff = Infinity;
    for (let i = 0; i < history.bars.length; i++) {
      const diff = Math.abs(history.bars[i]!.time - targetMs);
      if (diff < minDiff) {
        minDiff = diff;
        closest = i;
      }
    }
    return closest + 1; // 1-based index
  };

  const openMs = Date.parse(trade.openedAt);
  const closeMs = trade.closedAt ? Date.parse(trade.closedAt) : openMs;
  const entryBarIndex = useMemo(() => findClosestBarIndex(openMs), [history.bars, openMs]);
  const closeBarIndex = useMemo(() => findClosestBarIndex(closeMs), [history.bars, closeMs]);

  // Default count snaps to where the execution completed (+ 5 bars for immediate aftermath)
  const defaultSnapCount = useMemo(() => {
    return Math.min(history.bars.length, Math.max(1, closeBarIndex + 5));
  }, [history.bars.length, closeBarIndex]);

  const [count, setCount] = useState(defaultSnapCount);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState("4");
  const [customTfInput, setCustomTfInput] = useState("");
  const [showCustomModal, setShowCustomModal] = useState(false);

  useEffect(() => {
    setCount(defaultSnapCount);
    setPlaying(false);
  }, [history, defaultSnapCount]);

  useEffect(() => {
    if (!playing || privacy) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) setCount((curr) => Math.min(curr + 1, history.bars.length));
    }, 1000 / Number(speed));
    return () => window.clearInterval(timer);
  }, [playing, privacy, speed, history.bars.length]);

  useEffect(() => {
    if (count >= history.bars.length || privacy) setPlaying(false);
  }, [count, privacy, history.bars.length]);

  const complete = count === history.bars.length;

  const frame = useMemo(
    () => replayFrame(history, effectiveExecutions, count),
    [history, effectiveExecutions, count]
  );

  // Markers for timeline slider
  const executionMarkers = useMemo(() => {
    const isShort = trade.direction
      ? trade.direction.toLowerCase() === "short" || trade.direction.toLowerCase() === "sell"
      : false;
    return effectiveExecutions.map((ex, idx) => {
      const barIdx = findClosestBarIndex(Date.parse(ex.executedAt));
      const isEntry = idx === 0;
      return {
        id: `marker-${idx}`,
        barIndex: barIdx,
        side: ex.side,
        quantity: ex.quantity,
        price: ex.price,
        isEntry,
        label: isEntry
          ? `${ex.side.toUpperCase()} ${ex.quantity}L (Entry)`
          : `${ex.side.toUpperCase()} ${ex.quantity}L`,
      };
    });
  }, [effectiveExecutions, history.bars, trade.direction]);

  // Soft magnetic snap handler - only snaps to trade start (entry)
  const handleSliderChange = (rawVal: number) => {
    setPlaying(false);
    const snapRadius = Math.max(3, Math.round(history.bars.length * 0.007));
    if (Math.abs(rawVal - entryBarIndex) <= snapRadius) {
      setCount(entryBarIndex);
      return;
    }
    setCount(rawVal);
  };

  const handleApplyCustomTf = () => {
    const val = customTfInput.trim();
    if (/^\d+[mhdDwW]$/.test(val)) {
      onTimeframeChange(val as Resolution);
      setShowCustomModal(false);
      setCustomTfInput("");
    }
  };

  const entryPct = ((entryBarIndex - 1) / Math.max(1, history.bars.length - 1)) * 100;
  const closePct = ((closeBarIndex - 1) / Math.max(1, history.bars.length - 1)) * 100;
  const tradeSpanPct = Math.max(0.6, closePct - entryPct);

  return (
    <Card className="journal-replay-enter border-border/70">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base font-bold">Historical candles</CardTitle>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap items-center gap-0.5 rounded-lg border border-border/60 bg-muted/30 p-1 text-xs">
              {ALL_RESOLUTIONS.map((res) => (
                <button
                  key={res}
                  disabled={busy}
                  onClick={() => onTimeframeChange(res)}
                  className={`rounded px-2 py-0.5 font-medium transition ${
                    activeResolution === res
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  {res}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setShowCustomModal(true)}
                className="rounded px-2 py-0.5 text-[11px] font-semibold text-indigo-400 hover:bg-indigo-500/10"
                title="Create custom timeframe (e.g. 2m, 45m, 8h)"
              >
                + Custom
              </button>
            </div>

            <div className="flex items-center gap-1 rounded-md border border-border/60 bg-muted/30 p-0.5 text-xs">
              <span className="px-1 text-[11px] font-semibold text-muted-foreground uppercase">
                {paddingDays}d
              </span>
              <button
                disabled={busy || paddingDays <= 1}
                onClick={() => onPaddingChange(Math.max(1, paddingDays - 5))}
                title="Decrease 5 days of history"
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
              >
                <Minus className="h-3 w-3" />
              </button>
              <button
                disabled={busy}
                onClick={() => onPaddingChange(paddingDays + 5)}
                title="Add 5 days of history"
                className="flex items-center gap-0.5 rounded bg-muted px-1.5 py-0.5 font-medium text-foreground hover:bg-accent"
              >
                <Plus className="h-3 w-3" />
                <span>5d</span>
              </button>
            </div>

            {busy && <Loader2 className="h-4 w-4 animate-spin text-indigo-400" />}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {privacy ? (
          <p className="text-sm text-muted-foreground">
            Historical prices are hidden in privacy mode.
          </p>
        ) : (
          <>
            <ReplayChart history={history} trade={trade} nextFrame={frame} />
            <div
              className="flex flex-wrap items-center gap-2 rounded-lg border border-border/50 bg-muted/20 p-2"
              role="group"
              aria-label="Candle replay controls"
            >
              <Button
                variant="outline"
                size="icon"
                title="Restart replay from trade entry"
                onClick={() => {
                  setPlaying(false);
                  setCount(Math.max(1, entryBarIndex - 2));
                }}
              >
                <RotateCcw />
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label="Previous candle"
                disabled={count <= 1}
                onClick={() => {
                  setPlaying(false);
                  setCount((c) => Math.max(1, c - 1));
                }}
              >
                <ChevronLeft />
              </Button>
              <Button
                className="min-w-24 bg-indigo-600 hover:bg-indigo-700 text-white"
                disabled={history.bars.length <= 1}
                onClick={() => {
                  if (complete) setCount(Math.max(1, entryBarIndex - 2));
                  setPlaying(!playing);
                }}
              >
                {playing ? <Pause /> : <Play />}
                {playing ? "Pause" : "Play"}
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label="Next candle"
                disabled={complete}
                onClick={() => {
                  setPlaying(false);
                  setCount((c) => Math.min(c + 1, history.bars.length));
                }}
              >
                <ChevronRight />
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label="Snap to execution close"
                disabled={count === defaultSnapCount}
                title="Snap to trade exit"
                onClick={() => {
                  setPlaying(false);
                  setCount(defaultSnapCount);
                }}
              >
                <SkipForward />
              </Button>
              <span className="mx-1 text-xs tabular-nums text-muted-foreground">
                {count.toLocaleString()} / {history.bars.length.toLocaleString()}
              </span>
              <OptionSelect
                aria-label="Replay speed"
                className="ml-auto w-20"
                value={speed}
                onValueChange={setSpeed}
              >
                <option value="1">1×</option>
                <option value="2">2×</option>
                <option value="4">4×</option>
              </OptionSelect>
            </div>

            {/* TIMELINE SLIDER WITH TRADE WINDOW & EXECUTION NOTCH PINS */}
            <div className="relative w-full py-2 flex items-center">
              {/* Shaded trade window */}
              <div
                className="absolute h-2.5 rounded bg-indigo-500/25 border border-indigo-400/40 pointer-events-none"
                style={{
                  left: `${entryPct}%`,
                  width: `${tradeSpanPct}%`,
                }}
              />

              {/* Execution Markers */}
              {executionMarkers.map((m) => {
                const pct = ((m.barIndex - 1) / Math.max(1, history.bars.length - 1)) * 100;
                const isBuy = m.side === "buy";
                return (
                  <div
                    key={m.id}
                    className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 pointer-events-none z-10 flex flex-col items-center"
                    style={{ left: `${pct}%` }}
                    title={m.label}
                  >
                    <div
                      className={`w-1.5 h-4 rounded-full shadow-md ${
                        m.isEntry
                          ? m.side === "sell"
                            ? "bg-rose-500 ring-2 ring-rose-500/40"
                            : "bg-emerald-500 ring-2 ring-emerald-500/40"
                          : isBuy
                          ? "bg-emerald-400 ring-1 ring-emerald-400/40"
                          : "bg-rose-400 ring-1 ring-rose-400/40"
                      }`}
                    />
                  </div>
                );
              })}

              {/* Soft Sticky Range Input */}
              <input
                aria-label="Replay position"
                type="range"
                min={1}
                max={history.bars.length}
                value={count}
                className="w-full accent-indigo-500 z-20 cursor-pointer"
                onChange={(e) => handleSliderChange(Number(e.target.value))}
              />
            </div>
          </>
        )}

        {/* CUSTOM TIMEFRAME POPUP MODAL */}
        {showCustomModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="w-full max-w-xs rounded-xl border border-border/80 bg-[#161822] p-4 space-y-3 shadow-2xl">
              <h4 className="text-sm font-bold text-foreground">Custom Timeframe</h4>
              <p className="text-xs text-muted-foreground">
                Enter any interval (e.g. <code>2m</code>, <code>45m</code>, <code>2h</code>, <code>8h</code>):
              </p>
              <Input
                value={customTfInput}
                onChange={(e) => setCustomTfInput(e.target.value)}
                placeholder="e.g. 7h or 3m"
                autoFocus
              />
              <div className="flex justify-end gap-2 pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowCustomModal(false)}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="bg-indigo-600 hover:bg-indigo-700 text-white"
                  onClick={handleApplyCustomTf}
                >
                  Apply
                </Button>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
function getNewYorkOffsetMs(date: Date = new Date()): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  let year = date.getUTCFullYear();
  let month = date.getUTCMonth() + 1;
  let day = date.getUTCDate();
  let hour = date.getUTCHours();
  let minute = date.getUTCMinutes();
  let second = date.getUTCSeconds();

  for (const part of dtf.formatToParts(date)) {
    const val = parseInt(part.value, 10);
    if (Number.isNaN(val)) continue;
    switch (part.type) {
      case "year":
        year = val;
        break;
      case "month":
        month = val;
        break;
      case "day":
        day = val;
        break;
      case "hour":
        hour = val % 24;
        break;
      case "minute":
        minute = val;
        break;
      case "second":
        second = val;
        break;
    }
  }

  const nyUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const actualUtcMs = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds()
  );

  return nyUtcMs - actualUtcMs;
}

function ReplayChart({
  history,
  trade,
  nextFrame,
}: {
  history: TradeMarketResult;
  trade: ChartTrade & { currency: string };
  nextFrame: ReturnType<typeof replayFrame<ChartExecution>>;
}) {
  const indicatorType = `replay-fills-${useId()}`;
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<Vela | null>(null);
  const frame = useRef(nextFrame);
  const latest = useRef(nextFrame);
  latest.current = nextFrame;
  const update = useRef<(() => void) | null>(null);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);

  const nyShiftMs = useMemo(() => {
    const refTime = history.bars[0]?.time ?? Date.now();
    return getNewYorkOffsetMs(new Date(refTime));
  }, [history]);

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    setError("");
    setReady(false);

    void (async () => {
      const { Vela, registerNativeIndicator, unregisterNativeIndicator } =
        await import("@luxalgo/vela");
      if (disposed || !host.current) return;
      const type = indicatorType;

      registerNativeIndicator({
        type,
        title: "Recorded fills",
        paneHint: "price",
        overlay: true,
        inputsSchema: () => [],
        defaultInputs: () => ({}),
        create: () => ({
          start(ctx) {
            ctx.emit({
              labels: frame.current.fills.map((fill, index) => ({
                id: `fill-${index}`,
                paneId: "price",
                xloc: "bar_time" as const,
                x: Date.parse(fill.executedAt) + nyShiftMs,
                y: fill.price,
                yloc: "price" as const,
                text: `${fill.side.toUpperCase()} ${fill.quantity}`,
                style: "label_left" as const,
                color: fill.side === "buy" ? "#087f23" : "#bd2626",
                textColor: "#ffffff",
                size: "small" as const,
                textAlign: "center" as const,
                fontFamily: "default" as const,
                overlay: true,
              })),
            });
            ctx.setStatus("idle");
          },
          onBars() {},
          onViewport() {},
          setInputs() {},
          suspend() {},
          resume() {},
          stop() {},
        }),
      });

      const dark = () => document.documentElement.classList.contains("dark");
      const shiftedInitialBars = latest.current.bars.map((bar) => ({
        ...bar,
        time: bar.time + nyShiftMs,
      }));

      const openMs = Date.parse(trade.openedAt);
      const closeMs = trade.closedAt ? Date.parse(trade.closedAt) : openMs;
      const durationMs = Math.max(closeMs - openMs, 30 * 60_000);
      const padMs = Math.max(durationMs * 0.45, 20 * 60_000);
      const visibleFrom = openMs + nyShiftMs - padMs;
      const visibleTo = closeMs + nyShiftMs + padMs;

      const instance = new Vela(host.current, {
        symbol: history.symbol,
        timeframe:
          ({
            "1m": "1",
            "3m": "3",
            "4m": "4",
            "5m": "5",
            "15m": "15",
            "30m": "30",
            "1h": "60",
            "4h": "240",
            "7h": "420",
            "1d": "1D",
            "1w": "1W",
            "1M": "1M",
          } as Record<string, string>)[history.resolution] ?? "1",
        data: shiftedInitialBars,
        live: false,
        height: 480,
        theme: dark() ? "dark" : "light",
        priceStyle: "candles",
        volume: false,
        drawings: true,
        upColor: "#ffffff",
        downColor: "#787b86",
        visibleRange: {
          from: visibleFrom,
          to: visibleTo,
        },
      });

      chart.current = instance;
      frame.current = latest.current;
      instance.addNativeIndicator(type);

      let updating = false;
      const flush = async () => {
        if (updating || disposed) return;
        updating = true;
        try {
          do {
            frame.current = latest.current;
            const shiftedBars = frame.current.bars.map((bar) => ({
              ...bar,
              time: bar.time + nyShiftMs,
            }));
            await instance.setMarket({ data: shiftedBars });
          } while (!disposed && frame.current !== latest.current);
        } catch {
          if (!disposed) setError("The replay chart could not be updated.");
        } finally {
          updating = false;
        }
      };

      update.current = () => {
        void flush();
      };

      const observer = new MutationObserver(() => instance.setTheme(dark() ? "dark" : "light"));
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

      cleanup = () => {
        update.current = null;
        observer.disconnect();
        instance.destroy();
        unregisterNativeIndicator(type);
        if (chart.current === instance) chart.current = null;
      };

      await instance.ready();
      try {
        instance.setVisibleRange({
          from: visibleFrom,
          to: visibleTo,
        });
      } catch {}
      if (!disposed) setReady(true);
    })().catch(() => {
      if (!disposed) setError("The historical chart could not be rendered.");
    });

    return () => {
      disposed = true;
      cleanup();
    };
  }, [history, indicatorType, nyShiftMs]);

  useEffect(() => {
    update.current?.();
  }, [nextFrame, history]);

  return (
    <>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div
        className="relative h-[480px] overflow-hidden rounded-lg border border-neutral-800 bg-[#181a20]"
        aria-busy={!ready && !error}
      >
        {!ready && !error && (
          <div
            className="absolute inset-0 flex items-center justify-center bg-[#181a20] text-sm text-neutral-400"
            role="status"
          >
            Preparing candle replay…
          </div>
        )}
        <div ref={host} className={`h-full ${ready ? "journal-replay-reveal" : "invisible"}`} />
      </div>
    </>
  );
}
