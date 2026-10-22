"use client";

import React, { useEffect, useId, useMemo, useRef, useState } from "react";
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
  Crosshair,
  Check,
  X,
  Calendar,
  Trash2,
} from "lucide-react";
import {
  RESOLUTIONS,
  type MarketConnection,
  type ExcursionEstimate,
  type Resolution,
  type TradeMarketResult,
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

export interface PositionPartialItem {
  id: string;
  label: string;
  price: number;
  pct: number;
  manualPct?: boolean;
  hitTimeMs?: number | null;
}

export function rebalanceEqualPartials(
  items: PositionPartialItem[],
  entryPrice: number,
  fullTargetPrice: number
): PositionPartialItem[] {
  const n = items.length;
  if (n === 0) return [];
  // Total legs = n intermediate partials + 1 final leg at Full Take Profit
  const totalLegs = n + 1;
  const hasManual = items.some((it) => it.manualPct);
  const equalPct = Number((100 / totalLegs).toFixed(2));

  return items.map((it, idx) => {
    const ratio = (idx + 1) / totalLegs;
    const defaultPrice =
      entryPrice > 0 && fullTargetPrice > 0
        ? Number((entryPrice + (fullTargetPrice - entryPrice) * ratio).toFixed(2))
        : it.price;
    return {
      ...it,
      label: `TP${idx + 1}`,
      price: it.price > 0 ? it.price : defaultPrice,
      pct: hasManual ? it.pct : equalPct,
    };
  });
}

export interface ExtractedRrSetup {
  direction: "long" | "short";
  entry: number;
  stop: number;
  target: number;
  partials: PositionPartialItem[];
  entryTimeIso: string;
  exitTimeIso: string;
  plannedR: number;
  realizedR: number;
  outcome: "WIN" | "LOSS" | "BE";
  mfeR: number;
  maeR: number;
}

export function TradeMarketData({
  trade,
  executions,
  onResultChange,
  onExtractRr,
  onJumpDateChange,
  initialRrOverlay,
}: {
  onResultChange?: (result: TradeMarketResult | null) => void;
  onExtractRr?: (setup: ExtractedRrSetup) => void;
  onJumpDateChange?: (isoDate: string) => void;
  initialRrOverlay?: {
    direction: "long" | "short";
    entry: number;
    stop: number;
    target: number;
    partials?: PositionPartialItem[];
  } | null;
  trade: ChartTrade & { currency: string };
  executions: ChartExecution[];
}) {
  const privacy = usePrivacy();
  const isStandalone = trade.key.startsWith("missed_") || trade.key.startsWith("sim_");

  const { data: saved, refresh: refreshSaved } = useApi<{
    saved: { estimate: ExcursionEstimate } | null;
  }>(isStandalone ? null : `/api/trades/${encodeURIComponent(trade.key)}/market-data`);

  const { data: connections } = useApi<{ connections: MarketConnection[] }>(
    "/api/market-data/connections"
  );
  const available = connections?.connections.filter((c) => c.configured) ?? [];

  const [provider, setProvider] = useState("");
  const [symbol, setSymbol] = useState(trade.symbol);
  const [dataset, setDataset] = useState("");
  const [resolution, setResolution] = useState<Resolution>(isStandalone ? "15m" : "1m");
  const [paddingDays, setPaddingDays] = useState<number>(5);
  const [forwardDays, setForwardDays] = useState<number>(2);
  const [showAllForwardBars, setShowAllForwardBars] = useState<boolean>(isStandalone);

  // Jump-to-Date state (allows jumping to any historical date & auto-downloading from provider into market_candles.db)
  const [anchorIso, setAnchorIso] = useState<string>(() =>
    trade.openedAt || new Date().toISOString()
  );
  const [jumpDateInput, setJumpDateInput] = useState<string>(() =>
    (trade.openedAt || new Date().toISOString()).slice(0, 16)
  );

  const [useCustomDates, setUseCustomDates] = useState<boolean>(false);
  const [customFrom, setCustomFrom] = useState<string>(() => {
    const ms = Date.parse(trade.openedAt || new Date().toISOString()) - 3 * 86_400_000;
    return new Date(Number.isFinite(ms) ? ms : Date.now() - 3 * 86_400_000)
      .toISOString()
      .slice(0, 16);
  });
  const [customTo, setCustomTo] = useState<string>(() => {
    const baseMs =
      Date.parse(trade.closedAt || trade.openedAt || new Date().toISOString()) +
      2 * 86_400_000;
    return new Date(Number.isFinite(baseMs) ? baseMs : Date.now())
      .toISOString()
      .slice(0, 16);
  });
  const [confirmed, setConfirmed] = useState(false);

  const [result, setResult] = useState<TradeMarketResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [isCardExpanded, setIsCardExpanded] = useState(false);
  const [hasAutoLoaded, setHasAutoLoaded] = useState(false);

  // Shared stable localStorage key so refreshing /missed never loses cached candles
  const cacheKey = useMemo(() => {
    if (isStandalone) {
      return `candle_cache_shared_${provider || "lse"}_${symbol}_${resolution}`;
    }
    return `candle_cache_${trade.key}`;
  }, [isStandalone, provider, symbol, resolution, trade.key]);

  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

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

  const load = async (overrides?: {
    resolution?: Resolution;
    paddingDays?: number;
    forwardDays?: number;
    anchorIsoOverride?: string;
    useCustomDates?: boolean;
    customFrom?: string;
    customTo?: string;
    expandForwardView?: boolean;
  }) => {
    if (!available.some((item) => item.id === provider) || (info?.datasets && !dataset)) return;
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setBusy(true);
    setError("");

    const targetRes = overrides?.resolution ?? resolution;
    const targetPadding = overrides?.paddingDays ?? paddingDays;
    const targetForward = overrides?.forwardDays ?? forwardDays;
    const targetAnchor = overrides?.anchorIsoOverride ?? anchorIso;
    const targetUseCustom = overrides?.useCustomDates ?? useCustomDates;
    const targetFromStr = overrides?.customFrom ?? customFrom;
    const targetToStr = overrides?.customTo ?? customTo;

    const openMs = Date.parse(targetAnchor || trade.openedAt || new Date().toISOString());
    const closeMs =
      !overrides?.anchorIsoOverride && trade.closedAt
        ? Date.parse(trade.closedAt)
        : openMs + 4 * 3600_000;

    const fromMs = targetUseCustom
      ? Date.parse(targetFromStr)
      : openMs - targetPadding * 86_400_000;
    const toMs = targetUseCustom
      ? Date.parse(targetToStr)
      : closeMs + targetForward * 86_400_000;

    const useDirectRangeEndpoint =
      isStandalone ||
      targetUseCustom ||
      Boolean(overrides?.anchorIsoOverride) ||
      overrides?.forwardDays !== undefined ||
      targetForward !== 2;

    try {
      const endpoint = useDirectRangeEndpoint
        ? "/api/market-data/candles"
        : `/api/trades/${encodeURIComponent(trade.key)}/market-data`;

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          symbol,
          dataset,
          resolution: targetRes,
          paddingDays: targetPadding,
          forwardDays: targetForward,
          fromMs,
          toMs,
          basisConfirmed: confirmed,
        }),
        signal: request.signal,
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "History request failed.");
      if (!request.signal.aborted) {
        if (
          overrides?.expandForwardView ||
          targetUseCustom ||
          overrides?.forwardDays !== undefined ||
          isStandalone
        ) {
          setShowAllForwardBars(true);
        }
        setResult(body);
        onResultChange?.(body);
        if (overrides?.resolution) setResolution(overrides.resolution);
        if (overrides?.paddingDays !== undefined) setPaddingDays(overrides.paddingDays);
        if (overrides?.forwardDays !== undefined) setForwardDays(overrides.forwardDays);
        if (overrides?.anchorIsoOverride) setAnchorIso(overrides.anchorIsoOverride);
        if (!isStandalone) refreshSaved();

        try {
          localStorage.setItem(
            cacheKey,
            JSON.stringify({
              fetchedAt: Date.now(),
              resolution: targetRes,
              paddingDays: targetPadding,
              forwardDays: targetForward,
              data: body,
            })
          );
        } catch {}
      }
    } catch (cause) {
      if (!request.signal.aborted)
        setError(cause instanceof Error ? cause.message : "History request failed.");
    } finally {
      if (!request.signal.aborted) setBusy(false);
    }
  };

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
          if (parsed.paddingDays) setPaddingDays(parsed.paddingDays);
          if (parsed.forwardDays !== undefined) setForwardDays(parsed.forwardDays);
          return;
        }
      }
    } catch {}

    void load();
  }, [hasAutoLoaded, provider, symbol, cacheKey]);

  const handleJumpToDate = () => {
    if (!jumpDateInput) return;
    const parsedMs = Date.parse(jumpDateInput);
    if (!Number.isFinite(parsedMs)) return;
    const iso = new Date(parsedMs).toISOString();
    setAnchorIso(iso);
    setUseCustomDates(false);
    onJumpDateChange?.(iso);
    void load({ anchorIsoOverride: iso, expandForwardView: true, useCustomDates: false });
  };

  return (
    <div className="space-y-3">
      {result && result.bars.length > 0 ? (
        <HistoricalReplay
          history={result}
          trade={{
            ...trade,
            openedAt: anchorIso || trade.openedAt,
          }}
          executions={executions}
          privacy={privacy}
          activeResolution={resolution}
          paddingDays={paddingDays}
          forwardDays={forwardDays}
          showAllForwardBars={showAllForwardBars}
          busy={busy}
          jumpDateInput={jumpDateInput}
          onJumpDateInputChange={setJumpDateInput}
          onJumpToDate={handleJumpToDate}
          onTimeframeChange={(res) => load({ resolution: res })}
          onPaddingChange={(days) => load({ paddingDays: days })}
          onForwardChange={(days) => load({ forwardDays: days, expandForwardView: true })}
          onExtractRr={onExtractRr}
          initialRrOverlay={initialRrOverlay}
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

      {/* COMPACT & COLLAPSIBLE MARKET DATA & REPLAY SETTINGS CARD */}
      <Card className="border-border/60 bg-card">
        <div className="flex items-center justify-between p-3">
          <div className="flex flex-wrap items-center gap-2.5 text-xs">
            <span className="font-semibold text-foreground flex items-center gap-1.5">
              <Settings2 className="h-3.5 w-3.5 text-muted-foreground" />
              Market Data &amp; Replay
            </span>
            <span className="rounded bg-secondary px-2 py-0.5 text-muted-foreground">
              {available.find((c) => c.id === provider)?.name || provider || "No provider"}
            </span>
            <span className="rounded bg-secondary px-2 py-0.5 font-mono text-foreground">
              {symbol}
            </span>
            <span className="rounded bg-secondary px-2 py-0.5 text-muted-foreground">
              {resolution} · -{paddingDays}d / +{forwardDays}d
            </span>
            {result?.bars?.length ? (
              <span className="rounded bg-secondary px-2 py-0.5 text-muted-foreground hidden sm:inline">
                {result.bars.length.toLocaleString()} candles (Cached in market_candles.db)
              </span>
            ) : null}
            {busy && (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
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
              title={isCardExpanded ? "Collapse settings" : "Expand settings (Date Range & Provider)"}
            >
              {isCardExpanded ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        </div>

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
                      className="text-[11px] text-muted-foreground underline hover:text-foreground"
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
                    const nextRes = val as Resolution;
                    setResolution(nextRes);
                    void load({ resolution: nextRes });
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
                <Label htmlFor="market-padding">Lookback / Lookforward</Label>
                <div className="grid grid-cols-2 gap-1.5">
                  <OptionSelect
                    id="market-padding"
                    value={String(paddingDays)}
                    onValueChange={(val) => {
                      const num = Number(val);
                      setPaddingDays(num);
                      setUseCustomDates(false);
                      void load({ paddingDays: num, useCustomDates: false });
                    }}
                  >
                    <option value="1">-1d Back</option>
                    <option value="3">-3d Back</option>
                    <option value="5">-5d Back</option>
                    <option value="10">-10d Back</option>
                    <option value="15">-15d Back</option>
                    <option value="30">-30d Back</option>
                  </OptionSelect>
                  <OptionSelect
                    id="market-forward"
                    value={String(forwardDays)}
                    onValueChange={(val) => {
                      const num = Number(val);
                      setForwardDays(num);
                      setUseCustomDates(false);
                      void load({
                        forwardDays: num,
                        useCustomDates: false,
                        expandForwardView: true,
                      });
                    }}
                  >
                    <option value="0">+0d Fwd</option>
                    <option value="1">+1d Fwd</option>
                    <option value="2">+2d Fwd</option>
                    <option value="5">+5d Fwd</option>
                    <option value="10">+10d Fwd</option>
                    <option value="15">+15d Fwd</option>
                    <option value="30">+30d Fwd</option>
                  </OptionSelect>
                </div>
              </div>
            </div>

            {/* CUSTOM DATE RANGE SELECTOR */}
            <div className="rounded-lg border border-border/60 bg-secondary/20 p-3 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-xs font-semibold text-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useCustomDates}
                    onChange={(e) => setUseCustomDates(e.target.checked)}
                    className="h-3.5 w-3.5 accent-foreground"
                  />
                  <span>Load Custom Date Range (From → To)</span>
                </label>
                {useCustomDates && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs font-semibold"
                    disabled={busy}
                    onClick={() =>
                      void load({
                        useCustomDates: true,
                        customFrom,
                        customTo,
                        expandForwardView: true,
                      })
                    }
                  >
                    Load Date Range
                  </Button>
                )}
              </div>
              {useCustomDates && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                  <div>
                    <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">
                      From (Start Date &amp; Time)
                    </label>
                    <input
                      type="datetime-local"
                      value={customFrom}
                      onChange={(e) => setCustomFrom(e.target.value)}
                      className="h-8 w-full rounded-md border border-border bg-background px-2.5 text-xs text-foreground"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">
                      To (End Date &amp; Time)
                    </label>
                    <input
                      type="datetime-local"
                      value={customTo}
                      onChange={(e) => setCustomTo(e.target.value)}
                      className="h-8 w-full rounded-md border border-border bg-background px-2.5 text-xs text-foreground"
                    />
                  </div>
                </div>
              )}
            </div>

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
    let chosen = bars[0]!;
    for (let i = 0; i < bars.length; i++) {
      const b = bars[i]!;
      if (b.time <= targetMs) {
        chosen = b;
      } else {
        break;
      }
    }
    return chosen;
  };

  if (executions && executions.length > 0) {
    return executions.map((ex) => {
      const ms = Date.parse(ex.executedAt);
      const bar = getCandleAt(Number.isFinite(ms) ? ms : Date.parse(trade.openedAt));
      const validPrice =
        typeof ex.price === "number" && Number.isFinite(ex.price) && ex.price > 0
          ? ex.price
          : Number(((bar.open + bar.close) / 2).toFixed(2));
      return {
        ...ex,
        price: validPrice,
        barTimeMs: bar.time,
      };
    });
  }

  if (trade.key.startsWith("missed_") || trade.key.startsWith("sim_")) {
    return [];
  }

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

export interface NativeVelaPositionOverlay {
  direction: "long" | "short";
  entry: number;
  stop: number;
  target: number;
  partials: PositionPartialItem[];
  startTimeMs: number;
  exitTimeMs: number;
  exitPrice: number;
  outcome: "WIN" | "LOSS" | "BE";
  plannedR: number;
  realizedR: number;
  mfeR: number;
  maeR: number;
}

export function HistoricalReplay({
  history,
  trade,
  executions,
  privacy,
  activeResolution = history.resolution,
  paddingDays = 5,
  forwardDays = 2,
  showAllForwardBars = false,
  busy = false,
  jumpDateInput = "",
  onJumpDateInputChange = () => {},
  onJumpToDate = () => {},
  onTimeframeChange = () => {},
  onPaddingChange = () => {},
  onForwardChange = () => {},
  onExtractRr,
  initialRrOverlay,
}: {
  history: TradeMarketResult;
  trade: ChartTrade & { currency: string };
  executions: ChartExecution[];
  privacy: boolean;
  activeResolution?: Resolution;
  paddingDays?: number;
  forwardDays?: number;
  showAllForwardBars?: boolean;
  busy?: boolean;
  jumpDateInput?: string;
  onJumpDateInputChange?: (val: string) => void;
  onJumpToDate?: () => void;
  onTimeframeChange?: (res: Resolution) => void;
  onPaddingChange?: (days: number) => void;
  onForwardChange?: (days: number) => void;
  onExtractRr?: (setup: ExtractedRrSetup) => void;
  initialRrOverlay?: {
    direction: "long" | "short";
    entry: number;
    stop: number;
    target: number;
    partials?: PositionPartialItem[];
  } | null;
}) {
  const effectiveExecutions = useMemo(
    () => getEffectiveExecutions(trade, executions, history),
    [trade, executions, history]
  );

  const findClosestBarIndex = (targetMs: number) => {
    let containingIdx = 0;
    for (let i = 0; i < history.bars.length; i++) {
      if (history.bars[i]!.time <= targetMs) {
        containingIdx = i;
      } else {
        break;
      }
    }
    return containingIdx + 1;
  };

  const openMs = Date.parse(trade.openedAt);
  const closeMs = trade.closedAt ? Date.parse(trade.closedAt) : openMs;
  const entryBarIndex = useMemo(() => findClosestBarIndex(openMs), [history.bars, openMs]);
  const closeBarIndex = useMemo(() => findClosestBarIndex(closeMs), [history.bars, closeMs]);

  const defaultSnapCount = useMemo(() => {
    if (showAllForwardBars || trade.key.startsWith("missed_")) {
      return history.bars.length;
    }
    return Math.min(history.bars.length, Math.max(1, closeBarIndex + 5));
  }, [history.bars.length, closeBarIndex, showAllForwardBars, trade.key]);

  const [count, setCount] = useState(defaultSnapCount);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState("4");
  const [customTfInput, setCustomTfInput] = useState("");
  const [showCustomModal, setShowCustomModal] = useState(false);

  // Native Vela Position Tool State (renders directly inside Vela's price pane so prices match axis 100%)
  const [posActive, setPosActive] = useState<boolean>(Boolean(initialRrOverlay?.entry));
  const [pickingStartCandleDir, setPickingStartCandleDir] = useState<"long" | "short" | null>(null);
  const [posDir, setPosDir] = useState<"long" | "short">(
    initialRrOverlay?.direction || "long"
  );
  const [posStartBarIdx, setPosStartBarIdx] = useState<number>(() =>
    Math.max(0, Math.min(history.bars.length - 1, entryBarIndex - 1))
  );
  const [posEntry, setPosEntry] = useState<number>(() => {
    if (initialRrOverlay?.entry) return initialRrOverlay.entry;
    const b = history.bars[Math.max(0, entryBarIndex - 1)] || history.bars[0];
    return b ? b.close : 0;
  });
  const [posStop, setPosStop] = useState<number>(() => {
    if (initialRrOverlay?.stop) return initialRrOverlay.stop;
    const b = history.bars[Math.max(0, entryBarIndex - 1)] || history.bars[0];
    if (!b) return 0;
    const span = Math.max(b.close * 0.0025, Math.abs(b.high - b.low) * 2, 15);
    return Number((b.close - span).toFixed(2));
  });
  const [posTarget, setPosTarget] = useState<number>(() => {
    if (initialRrOverlay?.target) return initialRrOverlay.target;
    const b = history.bars[Math.max(0, entryBarIndex - 1)] || history.bars[0];
    if (!b) return 0;
    const span = Math.max(b.close * 0.0025, Math.abs(b.high - b.low) * 2, 15);
    return Number((b.close + span * 2.5).toFixed(2));
  });
  const [posPartials, setPosPartials] = useState<PositionPartialItem[]>(
    () => initialRrOverlay?.partials || []
  );

  // Price bounds of loaded history for smooth slider adjustments
  const historyPriceBounds = useMemo(() => {
    if (!history.bars.length) return { min: 0, max: 100, step: 0.5 };
    let min = Infinity;
    let max = -Infinity;
    for (const b of history.bars) {
      if (b.low < min) min = b.low;
      if (b.high > max) max = b.high;
    }
    const range = max - min || 10;
    const step = range > 500 ? 1 : range > 50 ? 0.25 : range > 5 ? 0.05 : 0.0001;
    return {
      min: Number((min - range * 0.1).toFixed(4)),
      max: Number((max + range * 0.1).toFixed(4)),
      step,
    };
  }, [history.bars]);

  const spawnPositionToolAtBar = (dir: "long" | "short", targetBarIdx: number) => {
    const startIdx = Math.max(0, Math.min(history.bars.length - 1, targetBarIdx));
    const bar = history.bars[startIdx] || history.bars[0];
    if (!bar) return;

    const slice = history.bars.slice(Math.max(0, startIdx - 12), startIdx + 1);
    const localLow = Math.min(...slice.map((b) => b.low));
    const localHigh = Math.max(...slice.map((b) => b.high));
    const entryP = bar.close;
    const fallbackSpan = Math.max((historyPriceBounds.max - historyPriceBounds.min) * 0.08, 10);

    setPosDir(dir);
    setPosStartBarIdx(startIdx);
    setPosEntry(entryP);

    if (dir === "long") {
      const sl =
        localLow < entryP
          ? Number((localLow - fallbackSpan * 0.1).toFixed(2))
          : Number((entryP - fallbackSpan).toFixed(2));
      const risk = Math.abs(entryP - sl) || fallbackSpan;
      const tp = Number((entryP + risk * 2.5).toFixed(2));
      setPosStop(sl);
      setPosTarget(tp);
    } else {
      const sl =
        localHigh > entryP
          ? Number((localHigh + fallbackSpan * 0.1).toFixed(2))
          : Number((entryP + fallbackSpan).toFixed(2));
      const risk = Math.abs(sl - entryP) || fallbackSpan;
      const tp = Number((entryP - risk * 2.5).toFixed(2));
      setPosStop(sl);
      setPosTarget(tp);
    }
    setPosActive(true);
    setPickingStartCandleDir(null);
    if (posPartials.length > 0) {
      setPosPartials((prev) =>
        rebalanceEqualPartials(
          prev,
          entryP,
          dir === "long"
            ? Number((entryP + fallbackSpan * 2).toFixed(2))
            : Number((entryP - fallbackSpan * 2).toFixed(2))
        )
      );
    }
  };

  const handleClickPositionButton = (dir: "long" | "short") => {
    // Enter "Click on Chart to Choose Start Candle" mode!
    setPosDir(dir);
    setPickingStartCandleDir((prev) => (prev === dir ? null : dir));
  };

  // Candle-Accurate Simulation Engine:
  // Starts at posStartBarIdx, walks forward candle-by-candle, checks Partial TPs,
  // and stops at the EXACT candle where Stop Loss or Full Take Profit is hit first!
  const simulatedPosition: NativeVelaPositionOverlay | null = useMemo(() => {
    if (!posActive || !history.bars.length || posEntry <= 0 || posStop <= 0 || posTarget <= 0) {
      return null;
    }
    const sIdx = Math.max(0, Math.min(history.bars.length - 1, posStartBarIdx));
    const startBar = history.bars[sIdx] || history.bars[0]!;
    const forwardBars = history.bars.slice(sIdx);

    const riskDist = Math.abs(posEntry - posStop);
    const rewardDist = Math.abs(posTarget - posEntry);
    const plannedR = riskDist > 0 ? Number((rewardDist / riskDist).toFixed(2)) : 0;

    let exitBar = forwardBars[forwardBars.length - 1] || startBar;
    let exitPrice = posTarget;
    let outcome: "WIN" | "LOSS" | "BE" = "WIN";
    let maxFav = 0;
    let maxAdv = 0;

    // Track the exact candle timestamp when each partial target is first touched
    const hitPartialTimes = new Map<string, number>();

    for (let i = 0; i < forwardBars.length; i++) {
      const b = forwardBars[i]!;
      if (posDir === "long") {
        const fav = Math.max(0, b.high - posEntry);
        const adv = Math.max(0, posEntry - b.low);
        if (fav > maxFav) maxFav = fav;
        if (adv > maxAdv) maxAdv = adv;

        // Check if Stop Loss hit on this candle
        if (b.low <= posStop) {
          outcome = hitPartialTimes.size > 0 ? "WIN" : "LOSS";
          exitBar = b;
          exitPrice = posStop;
          break;
        }
        // Check if any Partial TPs were hit on this candle
        for (const p of posPartials) {
          if (p.price > posEntry && b.high >= p.price && !hitPartialTimes.has(p.id)) {
            hitPartialTimes.set(p.id, b.time);
          }
        }
        // Check if Full Take Profit hit on this candle
        if (b.high >= posTarget) {
          outcome = "WIN";
          exitBar = b;
          exitPrice = posTarget;
          break;
        }
      } else {
        const fav = Math.max(0, posEntry - b.low);
        const adv = Math.max(0, b.high - posEntry);
        if (fav > maxFav) maxFav = fav;
        if (adv > maxAdv) maxAdv = adv;

        if (b.high >= posStop) {
          outcome = hitPartialTimes.size > 0 ? "WIN" : "LOSS";
          exitBar = b;
          exitPrice = posStop;
          break;
        }
        for (const p of posPartials) {
          if (p.price < posEntry && b.low <= p.price && !hitPartialTimes.has(p.id)) {
            hitPartialTimes.set(p.id, b.time);
          }
        }
        if (b.low <= posTarget) {
          outcome = "WIN";
          exitBar = b;
          exitPrice = posTarget;
          break;
        }
      }
    }

    // Calculate blended Realized R across filled partials + remainder at exitPrice
    let allocatedPct = 0;
    let weightedR = 0;
    if (riskDist > 0) {
      for (const p of posPartials) {
        if (hitPartialTimes.has(p.id) && p.pct > 0) {
          const pct = Math.min(100 - allocatedPct, p.pct);
          allocatedPct += pct;
          const pMove = posDir === "long" ? p.price - posEntry : posEntry - p.price;
          weightedR += (pct / 100) * (pMove / riskDist);
        }
      }
      const remPct = Math.max(0, 100 - allocatedPct);
      const finalMove = posDir === "long" ? exitPrice - posEntry : posEntry - exitPrice;
      weightedR += (remPct / 100) * (finalMove / riskDist);
    }

    const realizedR = Number(weightedR.toFixed(2));
    if (realizedR > 0.05) outcome = "WIN";
    else if (realizedR < -0.05) outcome = "LOSS";
    else outcome = "BE";

    return {
      direction: posDir,
      entry: posEntry,
      stop: posStop,
      target: posTarget,
      partials: posPartials.map((p) => ({
        ...p,
        hitTimeMs: hitPartialTimes.get(p.id) ?? null,
      })),
      startTimeMs: startBar.time,
      exitTimeMs: exitBar.time,
      exitPrice,
      outcome,
      plannedR,
      realizedR,
      mfeR: riskDist > 0 ? Number((maxFav / riskDist).toFixed(2)) : 0,
      maeR: riskDist > 0 ? Number((maxAdv / riskDist).toFixed(2)) : 0,
    };
  }, [posActive, history.bars, posStartBarIdx, posEntry, posStop, posTarget, posDir, posPartials]);

  useEffect(() => {
    setCount(defaultSnapCount);
    setPlaying(false);
  }, [history]);

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

  const executionMarkers = useMemo(() => {
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
  }, [effectiveExecutions, history.bars]);

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

  // Auto-sync simulatedPosition to parent form without refreshing chart
  const lastEmittedSigRef = useRef<string>("");
  useEffect(() => {
    if (!onExtractRr || !simulatedPosition) return;
    const totalPct = simulatedPosition.partials.reduce((s, p) => s + (Number(p.pct) || 0), 0);
    if (totalPct > 100) return;
    const sig = JSON.stringify({
      d: simulatedPosition.direction,
      e: Number(simulatedPosition.entry.toFixed(2)),
      s: Number(simulatedPosition.stop.toFixed(2)),
      t: Number(simulatedPosition.target.toFixed(2)),
      p: simulatedPosition.partials,
      st: simulatedPosition.startTimeMs,
      et: simulatedPosition.exitTimeMs,
    });
    if (sig === lastEmittedSigRef.current) return;
    lastEmittedSigRef.current = sig;
    onExtractRr({
      direction: simulatedPosition.direction,
      entry: Number(simulatedPosition.entry.toFixed(2)),
      stop: Number(simulatedPosition.stop.toFixed(2)),
      target: Number(simulatedPosition.target.toFixed(2)),
      partials: simulatedPosition.partials,
      entryTimeIso: new Date(simulatedPosition.startTimeMs).toISOString(),
      exitTimeIso: new Date(simulatedPosition.exitTimeMs).toISOString(),
      plannedR: simulatedPosition.plannedR,
      realizedR: simulatedPosition.realizedR,
      outcome: simulatedPosition.outcome,
      mfeR: simulatedPosition.mfeR,
      maeR: simulatedPosition.maeR,
    });
  }, [simulatedPosition, onExtractRr]);

  const handlePopulateFromSimulatedPosition = () => {
    if (!onExtractRr || !simulatedPosition) return;
    const totalPct = simulatedPosition.partials.reduce((s, p) => s + (Number(p.pct) || 0), 0);
    if (totalPct > 100) {
      window.alert(
        `Invalid Partial TP Allocation: Your partial TPs add up to ${totalPct.toFixed(
          2
        )}%, which is more than 100% of your position size.`
      );
      return;
    }
    onExtractRr({
      direction: simulatedPosition.direction,
      entry: Number(simulatedPosition.entry.toFixed(2)),
      stop: Number(simulatedPosition.stop.toFixed(2)),
      target: Number(simulatedPosition.target.toFixed(2)),
      partials: simulatedPosition.partials,
      entryTimeIso: new Date(simulatedPosition.startTimeMs).toISOString(),
      exitTimeIso: new Date(simulatedPosition.exitTimeMs).toISOString(),
      plannedR: simulatedPosition.plannedR,
      realizedR: simulatedPosition.realizedR,
      outcome: simulatedPosition.outcome,
      mfeR: simulatedPosition.mfeR,
      maeR: simulatedPosition.maeR,
    });
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
            {/* JUMP TO SPECIFIC DATE (AUTO-DOWNLOADS IF MISSING) */}
            <div className="flex items-center gap-1 rounded-md border border-border/60 bg-muted/30 px-1.5 py-0.5 text-xs">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <input
                type="datetime-local"
                value={jumpDateInput}
                onChange={(e) => onJumpDateInputChange(e.target.value)}
                className="h-6 bg-transparent text-[11px] text-foreground outline-none font-mono"
                title="Jump to specific date & time (auto-downloads candles if not cached)"
              />
              <button
                type="button"
                disabled={busy}
                onClick={onJumpToDate}
                className="rounded bg-secondary hover:bg-secondary/80 border border-border px-2 py-0.5 text-[11px] font-semibold text-foreground transition"
              >
                Jump
              </button>
            </div>

            {/* Timeframe Selector */}
            <div className="flex flex-wrap items-center gap-0.5 rounded-lg border border-border/60 bg-muted/30 p-1 text-xs">
              {ALL_RESOLUTIONS.map((res) => (
                <button
                  key={res}
                  disabled={busy}
                  onClick={() => onTimeframeChange(res)}
                  className={`rounded px-2 py-0.5 font-medium transition ${
                    activeResolution === res
                      ? "bg-secondary text-foreground border border-border font-semibold shadow-2xs"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  {res}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setShowCustomModal(true)}
                className="rounded px-2 py-0.5 text-[11px] font-semibold text-muted-foreground hover:bg-secondary hover:text-foreground border border-border/60"
                title="Create custom timeframe (e.g. 2m, 45m, 8h)"
              >
                + Custom
              </button>
            </div>

            {/* Lookback Stepper (Neutral) */}
            <div
              className="flex items-center gap-1 rounded-md border border-border/60 bg-muted/30 p-0.5 text-xs"
              title="Lookback days before entry"
            >
              <span className="px-1 text-[10px] font-semibold text-muted-foreground uppercase">
                Back {paddingDays}d
              </span>
              <button
                disabled={busy || paddingDays <= 1}
                onClick={() => onPaddingChange(Math.max(1, paddingDays - 5))}
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
              >
                <Minus className="h-3 w-3" />
              </button>
              <button
                disabled={busy}
                onClick={() => onPaddingChange(paddingDays + 5)}
                className="flex items-center gap-0.5 rounded bg-muted px-1.5 py-0.5 font-medium text-foreground hover:bg-accent"
              >
                <Plus className="h-3 w-3" />
                <span>5d</span>
              </button>
            </div>

            {/* Lookforward Stepper (Neutral) */}
            <div
              className="flex items-center gap-1 rounded-md border border-border/60 bg-muted/30 p-0.5 text-xs"
              title="Lookforward days after trade exit"
            >
              <span className="px-1 text-[10px] font-semibold text-muted-foreground uppercase">
                Fwd +{forwardDays}d
              </span>
              <button
                disabled={busy || forwardDays <= 0}
                onClick={() => onForwardChange(Math.max(0, forwardDays - 2))}
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
              >
                <Minus className="h-3 w-3" />
              </button>
              <button
                disabled={busy}
                onClick={() => onForwardChange(forwardDays + 5)}
                className="flex items-center gap-0.5 rounded bg-muted px-1.5 py-0.5 font-medium text-foreground hover:bg-accent"
              >
                <Plus className="h-3 w-3" />
                <span>5d</span>
              </button>
            </div>

            {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
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
            {/* VELA NATIVE POSITION R:R TOOL & PARTIALS CONTROLLER */}
            {onExtractRr && (
              <div className="rounded-lg border border-border/70 bg-secondary/20 p-3 space-y-2.5 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-semibold text-foreground flex items-center gap-1.5 mr-1">
                      <Crosshair className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>Vela Position Tool:</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => handleClickPositionButton("long")}
                      className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-semibold transition ${
                        pickingStartCandleDir === "long" || (posActive && posDir === "long")
                          ? "border-foreground bg-secondary text-foreground shadow-2xs"
                          : "border-border bg-card text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <span>
                        {pickingStartCandleDir === "long"
                          ? "Click Start Candle on Chart…"
                          : "+ Long Position"}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleClickPositionButton("short")}
                      className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-semibold transition ${
                        pickingStartCandleDir === "short" || (posActive && posDir === "short")
                          ? "border-foreground bg-secondary text-foreground shadow-2xs"
                          : "border-border bg-card text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <span>
                        {pickingStartCandleDir === "short"
                          ? "Click Start Candle on Chart…"
                          : "+ Short Position"}
                      </span>
                    </button>
                    {posActive && (
                      <button
                        type="button"
                        onClick={() =>
                          setPickingStartCandleDir((prev) => (prev ? null : posDir))
                        }
                        className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition ${
                          pickingStartCandleDir
                            ? "border-foreground bg-foreground text-background"
                            : "border-border bg-card text-foreground hover:bg-secondary"
                        }`}
                        title="Click any candle on the chart to move the Start Bar to that candle"
                      >
                        <Crosshair className="h-3 w-3" />
                        <span>
                          {pickingStartCandleDir
                            ? "Click Any Candle Now…"
                            : "Pick Start Candle"}
                        </span>
                      </button>
                    )}
                    {posActive && (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            setPosPartials((prev) => {
                              const nextRaw: PositionPartialItem[] = [
                                ...prev.map((p) => ({ ...p, manualPct: false })),
                                {
                                  id: `tp_${Date.now()}`,
                                  label: `TP${prev.length + 1}`,
                                  price: 0,
                                  pct: 0,
                                  manualPct: false,
                                },
                              ];
                              return rebalanceEqualPartials(nextRaw, posEntry, posTarget);
                            })
                          }
                          className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs font-medium text-foreground hover:bg-secondary"
                        >
                          <Plus className="h-3 w-3" />
                          <span>Add Partial TP</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setPosActive(false)}
                          className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                        >
                          <X className="h-3 w-3" />
                          <span>Clear</span>
                        </button>
                      </>
                    )}
                  </div>

                  {simulatedPosition && (
                    <Button
                      size="sm"
                      onClick={handlePopulateFromSimulatedPosition}
                      className="h-7 text-xs font-semibold"
                    >
                      <Check className="h-3.5 w-3.5 mr-1" />
                      Populate Setup ({simulatedPosition.outcome} • {simulatedPosition.realizedR > 0 ? `+${simulatedPosition.realizedR}R` : `${simulatedPosition.realizedR}R`})
                    </Button>
                  )}
                </div>

                {posActive && simulatedPosition && (() => {
                  const partialsPctSum = Number(
                    posPartials.reduce((acc, p) => acc + (Number(p.pct) || 0), 0).toFixed(2)
                  );
                  const finalTpPct = Number((100 - partialsPctSum).toFixed(2));
                  const isOverAllocated = partialsPctSum > 100;

                  return (
                    <div className="space-y-2 pt-1 border-t border-border/40">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
                        <span>
                          Drag the <strong>ENTRY</strong>, <strong>SL</strong>,{" "}
                          <strong>TP1..TPn</strong>, or <strong>FULL TP</strong> lines directly on
                          the chart below (or type exact prices):
                        </span>
                        <span className="font-mono text-foreground">
                          Start:{" "}
                          {new Date(simulatedPosition.startTimeMs)
                            .toISOString()
                            .slice(5, 16)
                            .replace("T", " ")}{" "}
                          → Candle Exit:{" "}
                          {new Date(simulatedPosition.exitTimeMs)
                            .toISOString()
                            .slice(5, 16)
                            .replace("T", " ")}
                        </span>
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="block text-[10px] text-muted-foreground mb-0.5">
                            Entry Price (Drag on Chart)
                          </label>
                          <input
                            type="number"
                            step="any"
                            value={posEntry}
                            onChange={(e) => setPosEntry(Number(e.target.value) || 0)}
                            className="h-7 w-full rounded border border-border bg-background px-2 font-mono text-xs text-foreground"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] text-muted-foreground mb-0.5">
                            Stop Loss (Drag on Chart)
                          </label>
                          <input
                            type="number"
                            step="any"
                            value={posStop}
                            onChange={(e) => setPosStop(Number(e.target.value) || 0)}
                            className="h-7 w-full rounded border border-border bg-background px-2 font-mono text-xs text-rose-500 font-bold"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] text-muted-foreground mb-0.5">
                            Full Take Profit (Final TP)
                          </label>
                          <input
                            type="number"
                            step="any"
                            value={posTarget}
                            onChange={(e) => setPosTarget(Number(e.target.value) || 0)}
                            className="h-7 w-full rounded border border-border bg-background px-2 font-mono text-xs text-emerald-500 font-bold"
                          />
                        </div>
                      </div>

                      {/* Take Partials & Final Full TP Allocation Table */}
                      <div className="space-y-1.5 pt-1 border-t border-border/30">
                        <div className="flex items-center justify-between text-[10px]">
                          <span className="font-semibold uppercase tracking-wider text-muted-foreground">
                            Take Profit Scaling Plan (Total Position = 100%)
                          </span>
                          {posPartials.length > 0 && (
                            <button
                              type="button"
                              onClick={() =>
                                setPosPartials((prev) =>
                                  rebalanceEqualPartials(
                                    prev.map((p) => ({ ...p, manualPct: false })),
                                    posEntry,
                                    posTarget
                                  )
                                )
                              }
                              className="underline text-muted-foreground hover:text-foreground"
                            >
                              Reset Equal % Split
                            </button>
                          )}
                        </div>

                        {isOverAllocated && (
                          <div
                            role="alert"
                            className="rounded border border-rose-500/50 bg-rose-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-rose-400"
                          >
                            Error: Total partial TP allocation is {partialsPctSum}%, which exceeds
                            100% of your position size. Reduce partial percentages so total ≤ 100%.
                          </div>
                        )}

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                          {posPartials.map((p, idx) => (
                            <div
                              key={p.id}
                              className="flex items-center gap-2 rounded border border-border/60 bg-background px-2 py-1"
                            >
                              <span className="font-mono text-[11px] font-bold text-foreground w-8">
                                TP{idx + 1}
                              </span>
                              <input
                                type="number"
                                step="any"
                                value={p.price}
                                onChange={(e) => {
                                  const val = Number(e.target.value) || 0;
                                  setPosPartials((prev) =>
                                    prev.map((it, i) => (i === idx ? { ...it, price: val } : it))
                                  );
                                }}
                                className="h-6 flex-1 rounded border border-border bg-card px-1.5 font-mono text-xs text-foreground"
                                title="Partial TP Price (or drag line on chart)"
                              />
                              <div className="flex items-center gap-1">
                                <input
                                  type="number"
                                  step="any"
                                  value={p.pct}
                                  onChange={(e) => {
                                    const val = Math.max(0, Number(e.target.value) || 0);
                                    setPosPartials((prev) =>
                                      prev.map((it, i) =>
                                        i === idx ? { ...it, pct: val, manualPct: true } : it
                                      )
                                    );
                                  }}
                                  className={`h-6 w-14 rounded border px-1 font-mono text-xs text-center ${
                                    isOverAllocated
                                      ? "border-rose-500 bg-rose-500/10 text-rose-400"
                                      : "border-border bg-card text-foreground"
                                  }`}
                                />
                                <span className="text-[10px] text-muted-foreground">%</span>
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  setPosPartials((prev) => {
                                    const filtered = prev.filter((_, i) => i !== idx);
                                    return rebalanceEqualPartials(filtered, posEntry, posTarget);
                                  })
                                }
                                className="text-rose-500 hover:bg-rose-500/10 p-0.5 rounded"
                                title="Remove partial"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          ))}

                          {/* Final TP Row — Always Locked to Full Take Profit Price */}
                          <div className="flex items-center justify-between gap-2 rounded border border-border/60 bg-secondary/30 px-2.5 py-1">
                            <span className="font-mono text-[11px] font-bold text-emerald-500">
                              Final TP (Full Target)
                            </span>
                            <span className="font-mono text-xs font-semibold text-foreground">
                              @ {posTarget}
                            </span>
                            <span
                              className={`font-mono text-xs font-bold ${
                                finalTpPct < 0 ? "text-rose-400" : "text-emerald-400"
                              }`}
                            >
                              {finalTpPct}% of pos
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            <ReplayChart
              history={history}
              trade={trade}
              nextFrame={frame}
              showAllForwardBars={showAllForwardBars}
              velaPosition={simulatedPosition}
              pickingStartCandleDir={pickingStartCandleDir}
              onPickStartCandleIdx={(barIdx) => {
                const dir = pickingStartCandleDir || posDir;
                if (!posActive) {
                  spawnPositionToolAtBar(dir, barIdx);
                } else {
                  setPosStartBarIdx(barIdx);
                  if (pickingStartCandleDir) {
                    const chosenBar = history.bars[barIdx];
                    if (chosenBar) setPosEntry(chosenBar.close);
                    setPickingStartCandleDir(null);
                  }
                }
              }}
              onDragPositionPrice={(kind, value, partialIdx) => {
                if (kind === "entry") setPosEntry(value);
                else if (kind === "stop") setPosStop(value);
                else if (kind === "target") setPosTarget(value);
                else if (kind === "partial" && partialIdx !== undefined) {
                  setPosPartials((prev) =>
                    prev.map((it, i) => (i === partialIdx ? { ...it, price: value } : it))
                  );
                }
              }}
              onDragStartBarOffset={(barDelta) => {
                setPosStartBarIdx((prev) =>
                  Math.max(0, Math.min(history.bars.length - 2, prev + barDelta))
                );
              }}
            />

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
                variant="secondary"
                className="min-w-24 border border-border font-semibold"
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
                aria-label="Snap to end of loaded candles"
                disabled={count === history.bars.length}
                title="Show all loaded forward candles"
                onClick={() => {
                  setPlaying(false);
                  setCount(history.bars.length);
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

            {/* TIMELINE SLIDER */}
            <div className="relative w-full py-2 flex items-center">
              <div
                className="absolute h-2.5 rounded bg-secondary border border-border pointer-events-none"
                style={{
                  left: `${entryPct}%`,
                  width: `${tradeSpanPct}%`,
                }}
              />
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
                            ? "bg-rose-500"
                            : "bg-emerald-500"
                          : isBuy
                          ? "bg-emerald-400"
                          : "bg-rose-400"
                      }`}
                    />
                  </div>
                );
              })}
              <input
                aria-label="Replay position"
                type="range"
                min={1}
                max={history.bars.length}
                value={count}
                className="w-full accent-foreground z-20 cursor-pointer"
                onChange={(e) => handleSliderChange(Number(e.target.value))}
              />
            </div>
          </>
        )}

        {showCustomModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="w-full max-w-xs rounded-xl border border-border bg-card p-4 space-y-3 shadow-2xl">
              <h4 className="text-sm font-bold text-foreground">Custom Timeframe</h4>
              <p className="text-xs text-muted-foreground">
                Enter any interval (e.g. <code>2m</code>, <code>45m</code>, <code>2h</code>,{" "}
                <code>8h</code>):
              </p>
              <Input
                value={customTfInput}
                onChange={(e) => setCustomTfInput(e.target.value)}
                placeholder="e.g. 7h or 3m"
                autoFocus
              />
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="outline" size="sm" onClick={() => setShowCustomModal(false)}>
                  Cancel
                </Button>
                <Button size="sm" onClick={handleApplyCustomTf}>
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
  showAllForwardBars = false,
  velaPosition,
  pickingStartCandleDir,
  onPickStartCandleIdx,
  onDragPositionPrice,
  onDragStartBarOffset,
}: {
  history: TradeMarketResult;
  trade: ChartTrade & { currency: string };
  executions?: ChartExecution[];
  nextFrame: ReturnType<typeof replayFrame<ChartExecution>>;
  showAllForwardBars?: boolean;
  velaPosition?: NativeVelaPositionOverlay | null;
  pickingStartCandleDir?: "long" | "short" | null;
  onPickStartCandleIdx?: (barIdx: number) => void;
  onDragPositionPrice?: (
    kind: "entry" | "stop" | "target" | "partial",
    newPrice: number,
    partialIdx?: number
  ) => void;
  onDragStartBarOffset?: (barDelta: number) => void;
}) {
  const indicatorType = `replay-fills-${useId()}`;
  const host = useRef<HTMLDivElement>(null);
  const outerWrapRef = useRef<HTMLDivElement>(null);
  const chart = useRef<Vela | null>(null);
  const indicatorCtxRef = useRef<any>(null);
  const emitIndicatorPayloadRef = useRef<(() => void) | null>(null);

  const frame = useRef(nextFrame);
  const latest = useRef(nextFrame);
  latest.current = nextFrame;
  const lastAppliedBarCountRef = useRef<number>(-1);

  const latestPosRef = useRef(velaPosition);
  latestPosRef.current = velaPosition;

  const lastCrosshairRef = useRef<{ rawTimeMs: number | null; price: number | null }>({
    rawTimeMs: null,
    price: null,
  });

  const pickingDirRef = useRef<"long" | "short" | null>(pickingStartCandleDir ?? null);
  pickingDirRef.current = pickingStartCandleDir ?? null;
  const onPickRef = useRef(onPickStartCandleIdx);
  onPickRef.current = onPickStartCandleIdx;
  const onDragPriceRef = useRef(onDragPositionPrice);
  onDragPriceRef.current = onDragPositionPrice;
  const onDragStartBarRef = useRef(onDragStartBarOffset);
  onDragStartBarRef.current = onDragStartBarOffset;

  // Live linear regression of (pixelY <-> price) calibrated continuously from Vela's crosshair & visible bars
  const scaleModelRef = useRef<{ topPrice: number; bottomPrice: number; plotHeight: number }>({
    topPrice: 100,
    bottomPrice: 0,
    plotHeight: 440,
  });
  const crosshairSamplesRef = useRef<Array<{ y: number; price: number }>>([]);
  const lastPointerYRef = useRef<number>(220);
  const [, forceRailRender] = useState(0);

  const visibleTimeRangeRef = useRef<{ fromMs: number; toMs: number }>({
    fromMs: history.bars[0]?.time ?? Date.now() - 86_400_000,
    toMs: history.bars[history.bars.length - 1]?.time ?? Date.now(),
  });

  const updateMarketBarsRef = useRef<(() => void) | null>(null);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);

  const nyShiftMs = useMemo(() => {
    const refTime = history.bars[0]?.time ?? Date.now();
    return getNewYorkOffsetMs(new Date(refTime));
  }, [history]);

  // Recomputes the fallback visible price bounds whenever visibleTimeRange or bars change
  const recomputeVisibleScaleFallback = () => {
    const allBars = latest.current.bars.length ? latest.current.bars : history.bars;
    if (!allBars.length) return;
    const { fromMs, toMs } = visibleTimeRangeRef.current;
    const vis = allBars.filter((b) => b.time >= fromMs && b.time <= toMs);
    const slice = vis.length >= 2 ? vis : allBars;

    let minP = Infinity;
    let maxP = -Infinity;
    for (const b of slice) {
      if (b.low < minP) minP = b.low;
      if (b.high > maxP) maxP = b.high;
    }
    const pos = latestPosRef.current;
    if (pos && pos.entry > 0) {
      minP = Math.min(minP, pos.entry, pos.stop, pos.target);
      maxP = Math.max(maxP, pos.entry, pos.stop, pos.target);
    }
    const span = Math.max(0.0001, maxP - minP);
    const pad = span * 0.09;
    scaleModelRef.current = {
      topPrice: maxP + pad,
      bottomPrice: minP - pad,
      plotHeight: 440,
    };
  };

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    setError("");
    setReady(false);
    lastAppliedBarCountRef.current = -1;
    crosshairSamplesRef.current = [];

    void (async () => {
      const { Vela, registerNativeIndicator, unregisterNativeIndicator } =
        await import("@luxalgo/vela");
      if (disposed || !host.current) return;
      const type = indicatorType;

      const buildAndEmit = (ctx: any) => {
        if (!ctx) return;
        const pos = latestPosRef.current;
        const isMissedTrade = trade.key.startsWith("missed_") || trade.key.startsWith("sim_");
        const fillLabels =
          pos || isMissedTrade
            ? []
            : frame.current.fills.map((fill, index) => ({
                id: `fill-${index}`,
                paneId: "price",
                xloc: "bar_time" as const,
                x: ((fill as any).barTimeMs ?? Date.parse(fill.executedAt)) + nyShiftMs,
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
              }));

        const posLines: any[] = [];
        const posLabels: any[] = [];

        if (pos && pos.entry > 0 && pos.stop > 0 && pos.target > 0) {
          const x1 = pos.startTimeMs + nyShiftMs;
          const x2 = Math.max(x1 + 60_000, pos.exitTimeMs + nyShiftMs);

          // 1. Entry Line & Right Tag
          posLines.push({
            id: "pos-entry-line",
            paneId: "price",
            xloc: "bar_time" as const,
            x1,
            y1: pos.entry,
            x2,
            y2: pos.entry,
            extend: "none" as const,
            color: "#38bdf8",
            invisible: false,
            width: 2,
            style: "solid" as const,
            arrowLeft: false,
            arrowRight: false,
            overlay: true,
          });
          posLabels.push({
            id: "pos-entry-lbl",
            paneId: "price",
            xloc: "bar_time" as const,
            x: x2,
            y: pos.entry,
            yloc: "price" as const,
            text: `ENTRY ${pos.entry} (${
              pos.realizedR > 0 ? `+${pos.realizedR}R` : `${pos.realizedR}R`
            })`,
            style: "label_left" as const,
            color: "#0284c7",
            textColor: "#ffffff",
            size: "small" as const,
            textAlign: "left" as const,
            fontFamily: "default" as const,
            overlay: true,
          });

          // 2. Stop Loss Line & Right Tag
          posLines.push({
            id: "pos-sl-line",
            paneId: "price",
            xloc: "bar_time" as const,
            x1,
            y1: pos.stop,
            x2,
            y2: pos.stop,
            extend: "none" as const,
            color: "#ef4444",
            invisible: false,
            width: 2,
            style: "solid" as const,
            arrowLeft: false,
            arrowRight: false,
            overlay: true,
          });
          posLabels.push({
            id: "pos-sl-lbl",
            paneId: "price",
            xloc: "bar_time" as const,
            x: x2,
            y: pos.stop,
            yloc: "price" as const,
            text: `SL ${pos.stop}`,
            style: "label_left" as const,
            color: "#dc2626",
            textColor: "#ffffff",
            size: "small" as const,
            textAlign: "left" as const,
            fontFamily: "default" as const,
            overlay: true,
          });

          // 3. Full Take Profit Line & Right Tag
          posLines.push({
            id: "pos-tp-line",
            paneId: "price",
            xloc: "bar_time" as const,
            x1,
            y1: pos.target,
            x2,
            y2: pos.target,
            extend: "none" as const,
            color: "#10b981",
            invisible: false,
            width: 2,
            style: "solid" as const,
            arrowLeft: false,
            arrowRight: false,
            overlay: true,
          });
          posLabels.push({
            id: "pos-tp-lbl",
            paneId: "price",
            xloc: "bar_time" as const,
            x: x2,
            y: pos.target,
            yloc: "price" as const,
            text: `Full TP ${pos.target}`,
            style: "label_left" as const,
            color: "#059669",
            textColor: "#ffffff",
            size: "small" as const,
            textAlign: "left" as const,
            fontFamily: "default" as const,
            overlay: true,
          });

          // 4. Intermediate Take Partials Lines & Right Tags
          pos.partials.forEach((p, idx) => {
            if (p.price > 0) {
              posLines.push({
                id: `pos-part-line-${idx}`,
                paneId: "price",
                xloc: "bar_time" as const,
                x1,
                y1: p.price,
                x2,
                y2: p.price,
                extend: "none" as const,
                color: "#34d399",
                invisible: false,
                width: 1,
                style: "dashed" as const,
                arrowLeft: false,
                arrowRight: false,
                overlay: true,
              });
              posLabels.push({
                id: `pos-part-lbl-${idx}`,
                paneId: "price",
                xloc: "bar_time" as const,
                x: x2,
                y: p.price,
                yloc: "price" as const,
                text: `TP${idx + 1} (${p.pct}%) @ ${p.price}`,
                style: "label_left" as const,
                color: "#047857",
                textColor: "#ffffff",
                size: "small" as const,
                textAlign: "left" as const,
                fontFamily: "default" as const,
                overlay: true,
              });
            }
          });

          // 5. Sleek Multi-Segment Polyarrow connecting Entry -> TP1 -> TP2 -> ... -> Final Exit
          const waypoints: Array<{ x: number; y: number }> = [{ x: x1, y: pos.entry }];
          const sortedPartials = [...pos.partials]
            .filter((p) => p.price > 0 && p.hitTimeMs != null)
            .sort((a, b) => (a.hitTimeMs || 0) - (b.hitTimeMs || 0));

          sortedPartials.forEach((p) => {
            const stepX = (p.hitTimeMs as number) + nyShiftMs;
            const clampedX = Math.max(waypoints[waypoints.length - 1]!.x, Math.min(x2, stepX));
            waypoints.push({ x: clampedX, y: p.price });
          });

          waypoints.push({ x: x2, y: pos.exitPrice });

          const pathColor = pos.outcome === "WIN" ? "#10b981" : "#ef4444";
          for (let w = 0; w < waypoints.length - 1; w++) {
            const ptA = waypoints[w]!;
            const ptB = waypoints[w + 1]!;
            posLines.push({
              id: `pos-polyarrow-seg-${w}`,
              paneId: "price",
              xloc: "bar_time" as const,
              x1: ptA.x,
              y1: ptA.y,
              x2: Math.max(ptA.x + 1000, ptB.x),
              y2: ptB.y,
              extend: "none" as const,
              color: pathColor,
              invisible: false,
              width: 1,
              style: "dashed" as const,
              arrowLeft: false,
              arrowRight: true,
              overlay: true,
            });
          }
        }

        ctx.emit({
          lines: posLines,
          labels: [...fillLabels, ...posLabels],
        });
        ctx.setStatus("idle");
      };

      emitIndicatorPayloadRef.current = () => {
        if (indicatorCtxRef.current) {
          buildAndEmit(indicatorCtxRef.current);
        }
      };

      registerNativeIndicator({
        type,
        title: "Recorded fills & R:R Position",
        paneHint: "price",
        overlay: true,
        inputsSchema: () => [],
        defaultInputs: () => ({}),
        create: () => ({
          start(ctx) {
            indicatorCtxRef.current = ctx;
            buildAndEmit(ctx);
          },
          onBars() {
            if (indicatorCtxRef.current) buildAndEmit(indicatorCtxRef.current);
          },
          onViewport(vp: any) {
            if (vp && typeof vp.from === "number" && typeof vp.to === "number") {
              visibleTimeRangeRef.current = {
                fromMs: vp.from - nyShiftMs,
                toMs: vp.to - nyShiftMs,
              };
              crosshairSamplesRef.current = [];
              recomputeVisibleScaleFallback();
              forceRailRender((c) => c + 1);
            }
          },
          setInputs() {},
          suspend() {},
          resume() {},
          stop() {
            if (indicatorCtxRef.current) indicatorCtxRef.current = null;
          },
        }),
      });

      const dark = () => document.documentElement.classList.contains("dark");
      const shiftedInitialBars = latest.current.bars.map((bar) => ({
        ...bar,
        time: bar.time + nyShiftMs,
      }));
      lastAppliedBarCountRef.current = latest.current.bars.length;

      const firstBarMs = latest.current.bars[0]?.time ?? Date.parse(trade.openedAt);
      const lastLoadedBarMs =
        latest.current.bars[latest.current.bars.length - 1]?.time ?? firstBarMs;
      const openMs = Date.parse(trade.openedAt);
      const closeMs = showAllForwardBars
        ? lastLoadedBarMs
        : trade.closedAt
        ? Date.parse(trade.closedAt)
        : openMs;
      const durationMs = Math.max(closeMs - openMs, 30 * 60_000);
      const padMs = Math.max(durationMs * 0.35, 20 * 60_000);
      const visibleFrom = (showAllForwardBars ? firstBarMs : openMs - padMs) + nyShiftMs;
      const visibleTo = (showAllForwardBars ? lastLoadedBarMs : closeMs + padMs) + nyShiftMs;

      visibleTimeRangeRef.current = {
        fromMs: visibleFrom - nyShiftMs,
        toMs: visibleTo - nyShiftMs,
      };
      recomputeVisibleScaleFallback();

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
        upColor: "#cbd5e1",
        downColor: "#787b86",
        visibleRange: {
          from: visibleFrom,
          to: visibleTo,
        },
      });

      chart.current = instance;
      frame.current = latest.current;
      instance.addNativeIndicator(type);

      const resolveBarIndexFromShiftedTime = (shiftedMs: number): number => {
        const rawTargetMs = shiftedMs - nyShiftMs;
        const bars = latest.current.bars.length ? latest.current.bars : history.bars;
        let bestIdx = 0;
        let bestDiff = Infinity;
        for (let i = 0; i < bars.length; i++) {
          const diff = Math.abs(bars[i]!.time - rawTargetMs);
          if (diff < bestDiff) {
            bestDiff = diff;
            bestIdx = i;
          }
        }
        return bestIdx;
      };

      const handleCrosshairEv = (ev: any) => {
        if (!ev) return;
        const rawT = typeof ev.time === "number" ? ev.time - nyShiftMs : null;
        const curPrice = typeof ev.price === "number" ? ev.price : null;
        lastCrosshairRef.current = { rawTimeMs: rawT, price: curPrice };

        // Continuously calibrate exact pixelY <-> Price mapping from Vela's own crosshair!
        if (curPrice !== null && Number.isFinite(curPrice)) {
          const y = lastPointerYRef.current;
          const samples = crosshairSamplesRef.current;
          if (!samples.length || Math.abs(samples[samples.length - 1]!.y - y) >= 12) {
            samples.push({ y, price: curPrice });
            if (samples.length > 8) samples.shift();
          }
          if (samples.length >= 2) {
            const sA = samples[0]!;
            const sB = samples[samples.length - 1]!;
            const dy = sB.y - sA.y;
            const dp = sB.price - sA.price;
            if (Math.abs(dy) >= 15 && Math.abs(dp) > 0) {
              const slope = dp / dy; // negative (price decreases as y increases)
              const plotH = 440;
              const topP = sA.price - slope * sA.y;
              const botP = topP + slope * plotH;
              if (topP > botP) {
                scaleModelRef.current = {
                  topPrice: topP,
                  bottomPrice: botP,
                  plotHeight: plotH,
                };
              }
            }
          }
        }
      };

      const unsubCrosshair =
        (instance as any).onCrosshairMove?.(handleCrosshairEv) ||
        (instance as any).renderer?.onCrosshairMove?.(handleCrosshairEv);

      const handleClickEv = (ev: any) => {
        if (pickingDirRef.current && onPickRef.current && ev && typeof ev.time === "number") {
          const idx = resolveBarIndexFromShiftedTime(ev.time);
          onPickRef.current(idx);
        }
      };

      const unsubClick =
        (instance as any).onClick?.(handleClickEv) ||
        (instance as any).renderer?.onClick?.(handleClickEv);

      let updating = false;
      const flush = async () => {
        if (updating || disposed) return;
        if (lastAppliedBarCountRef.current === latest.current.bars.length) {
          frame.current = latest.current;
          emitIndicatorPayloadRef.current?.();
          return;
        }
        updating = true;
        try {
          frame.current = latest.current;
          lastAppliedBarCountRef.current = frame.current.bars.length;
          const shiftedBars = frame.current.bars.map((bar) => ({
            ...bar,
            time: bar.time + nyShiftMs,
          }));
          await instance.setMarket({ data: shiftedBars });
          emitIndicatorPayloadRef.current?.();
        } catch {
          if (!disposed) setError("The replay chart could not be updated.");
        } finally {
          updating = false;
        }
      };

      updateMarketBarsRef.current = () => {
        void flush();
      };

      const observer = new MutationObserver(() => instance.setTheme(dark() ? "dark" : "light"));
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

      cleanup = () => {
        try { unsubCrosshair?.(); } catch {}
        try { unsubClick?.(); } catch {}
        updateMarketBarsRef.current = null;
        emitIndicatorPayloadRef.current = null;
        indicatorCtxRef.current = null;
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
    updateMarketBarsRef.current?.();
  }, [nextFrame]);

  useEffect(() => {
    recomputeVisibleScaleFallback();
    emitIndicatorPayloadRef.current?.();
  }, [velaPosition]);

  // Maps any price to a Y coordinate on the Left Handle Rail, clamping to [8, plotH - 8]
  // so even when a level is scrolled out of the chart's visible range, its pill stays pinned
  // at the top or bottom edge of the left rail!
  const priceToClampedRailY = (price: number): { y: number; clamped: "top" | "bottom" | null } => {
    const { topPrice, bottomPrice, plotHeight } = scaleModelRef.current;
    const span = Math.max(0.0001, topPrice - bottomPrice);
    const rawY = ((topPrice - price) / span) * plotHeight;
    if (rawY < 8) return { y: 8, clamped: "top" };
    if (rawY > plotHeight - 16) return { y: plotHeight - 16, clamped: "bottom" };
    return { y: rawY, clamped: null };
  };

  // Starts dragging a price pill on the Left Rail — disables pointer-events on Vela's host
  // so the chart NEVER pans or moves while you drag the pill!
  const startRailPriceDrag = (
    e: React.PointerEvent | React.MouseEvent,
    kind: "entry" | "stop" | "target" | "partial",
    initialPrice: number,
    partialIdx?: number
  ) => {
    e.preventDefault();
    e.stopPropagation();

    const startY = e.clientY;
    const { topPrice, bottomPrice, plotHeight } = scaleModelRef.current;
    const pricePerPx = Math.max(0.0001, (topPrice - bottomPrice) / Math.max(100, plotHeight));

    // Lock Vela's canvas pointer events so the chart cannot pan during drag!
    if (host.current) host.current.style.pointerEvents = "none";
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";

    const onMove = (moveEv: PointerEvent | MouseEvent) => {
      moveEv.preventDefault();
      moveEv.stopPropagation();
      const dy = moveEv.clientY - startY;
      const nextPrice = Number((initialPrice - dy * pricePerPx).toFixed(2));
      onDragPriceRef.current?.(kind, nextPrice, partialIdx);
    };

    const onUp = () => {
      if (host.current) host.current.style.pointerEvents = "";
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // Starts dragging the "↔ Start Bar" pill horizontally — locks Vela's canvas so the chart NEVER pans!
  const startRailTimeDrag = (e: React.PointerEvent | React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    let lastX = e.clientX;
    if (host.current) host.current.style.pointerEvents = "none";
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";

    const onMove = (moveEv: PointerEvent | MouseEvent) => {
      moveEv.preventDefault();
      moveEv.stopPropagation();
      const dx = moveEv.clientX - lastX;
      if (Math.abs(dx) >= 10 && onDragStartBarRef.current) {
        const steps = Math.trunc(dx / 10);
        lastX += steps * 10;
        onDragStartBarRef.current(steps);
      }
    };

    const onUp = () => {
      if (host.current) host.current.style.pointerEvents = "";
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const currentStartIdx = useMemo(() => {
    if (!velaPosition) return 0;
    const idx = history.bars.findIndex((b) => b.time >= velaPosition.startTimeMs);
    return idx >= 0 ? idx : 0;
  }, [velaPosition, history.bars]);

  return (
    <>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div
        ref={outerWrapRef}
        onPointerMove={(e) => {
          if (outerWrapRef.current) {
            const rect = outerWrapRef.current.getBoundingClientRect();
            lastPointerYRef.current = Math.max(0, e.clientY - rect.top - 12);
          }
        }}
        onPointerDownCapture={(e) => {
          if (!ready || !pickingStartCandleDir || !onPickStartCandleIdx || !outerWrapRef.current)
            return;
          const rect = outerWrapRef.current.getBoundingClientRect();
          const relX = e.clientX - rect.left;
          if (relX < 48 || relX > rect.width - 68) return;

          e.preventDefault();
          e.stopPropagation();

          const bars = nextFrame.bars.length ? nextFrame.bars : history.bars;
          if (!bars.length) return;

          if (lastCrosshairRef.current.rawTimeMs !== null) {
            const targetRawMs = lastCrosshairRef.current.rawTimeMs;
            let bestIdx = 0;
            let bestDiff = Infinity;
            bars.forEach((b, idx) => {
              const d = Math.abs(b.time - targetRawMs);
              if (d < bestDiff) {
                bestDiff = d;
                bestIdx = idx;
              }
            });
            onPickStartCandleIdx(bestIdx);
          }
        }}
        className={`relative h-[480px] overflow-hidden rounded-lg border border-border bg-card select-none ${
          pickingStartCandleDir ? "cursor-crosshair ring-1 ring-foreground/50" : ""
        }`}
        aria-busy={!ready && !error}
      >
        {!ready && !error && (
          <div
            className="absolute inset-0 flex items-center justify-center bg-card text-sm text-muted-foreground"
            role="status"
          >
            Preparing candle replay…
          </div>
        )}
        <div ref={host} className={`h-full ${ready ? "journal-replay-reveal" : "invisible"}`} />

        {/* TOP-LEFT PINNED START BAR SCRUBBER + DRAG RAIL */}
        {ready && velaPosition && !pickingStartCandleDir && (
          <div
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            className="pointer-events-auto absolute left-14 top-2.5 z-40 flex items-center gap-2 rounded-lg border border-border bg-card/95 px-2.5 py-1 text-[11px] shadow-md backdrop-blur-xs"
          >
            <span
              onPointerDown={startRailTimeDrag}
              className="cursor-ew-resize rounded bg-secondary px-1.5 py-0.5 font-mono font-bold text-foreground hover:bg-secondary/80"
              title="Drag left/right to move Start Bar without moving the chart"
            >
              ↔ Drag Start Bar
            </span>
            <input
              type="range"
              min={0}
              max={Math.max(0, history.bars.length - 2)}
              value={currentStartIdx}
              onChange={(e) => {
                const nextIdx = Number(e.target.value);
                onPickRef.current?.(nextIdx);
              }}
              className="w-28 accent-foreground cursor-pointer h-1.5"
              title="Scrub Start Candle position"
            />
            <span className="font-mono text-[10px] text-muted-foreground">
              {new Date(velaPosition.startTimeMs).toISOString().slice(5, 16).replace("T", " ")}
            </span>
          </div>
        )}

        {/* LEFT-EDGE PINNED HANDLE RAIL (SNAPPED TO LEFT OF CHART + CLAMPED WHEN OUT OF RANGE) */}
        {ready && velaPosition && onDragPositionPrice && !pickingStartCandleDir && (
          <div
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            className="pointer-events-none absolute top-10 bottom-8 left-14 w-48 z-40"
          >
            {(() => {
              const slPos = priceToClampedRailY(velaPosition.stop);
              const entryPos = priceToClampedRailY(velaPosition.entry);
              const tpPos = priceToClampedRailY(velaPosition.target);

              return (
                <>
                  {/* 1. Left-Snapped SL Handle Pill */}
                  <div
                    onPointerDown={(e) => startRailPriceDrag(e, "stop", velaPosition.stop)}
                    style={{ top: slPos.y }}
                    className="pointer-events-auto absolute left-0 -translate-y-1/2 cursor-ns-resize flex items-center gap-1 rounded border border-rose-500/70 bg-card/95 hover:bg-rose-950/60 px-2 py-0.5 font-mono text-[10px] font-bold text-rose-400 shadow-md transition-colors"
                    title="Drag up/down to adjust Stop Loss (chart stays locked)"
                  >
                    <span>
                      {slPos.clamped === "top"
                        ? "▲"
                        : slPos.clamped === "bottom"
                        ? "▼"
                        : "↕"}{" "}
                      SL {velaPosition.stop}
                    </span>
                  </div>

                  {/* 2. Left-Snapped Entry Handle Pill */}
                  <div
                    onPointerDown={(e) => startRailPriceDrag(e, "entry", velaPosition.entry)}
                    style={{ top: entryPos.y }}
                    className="pointer-events-auto absolute left-0 -translate-y-1/2 cursor-ns-resize flex items-center gap-1.5 rounded border border-sky-500/70 bg-card/95 hover:bg-sky-950/60 px-2 py-0.5 font-mono text-[10px] font-bold text-sky-300 shadow-md transition-colors"
                    title="Drag up/down to adjust Entry Price • Drag '↔' to move Start Candle"
                  >
                    <span
                      onPointerDown={startRailTimeDrag}
                      className="cursor-ew-resize rounded bg-sky-500/20 px-1 text-sky-200 hover:bg-sky-500/40"
                      title="Drag left/right to move Start Candle"
                    >
                      ↔
                    </span>
                    <span>
                      {entryPos.clamped === "top"
                        ? "▲"
                        : entryPos.clamped === "bottom"
                        ? "▼"
                        : "↕"}{" "}
                      Entry {velaPosition.entry}
                    </span>
                  </div>

                  {/* 3. Left-Snapped Partial TP Handle Pills */}
                  {velaPosition.partials.map((p, idx) => {
                    const pPos = priceToClampedRailY(p.price);
                    return (
                      <div
                        key={p.id}
                        onPointerDown={(e) => startRailPriceDrag(e, "partial", p.price, idx)}
                        style={{ top: pPos.y }}
                        className="pointer-events-auto absolute left-2 -translate-y-1/2 cursor-ns-resize flex items-center gap-1 rounded border border-emerald-500/50 bg-card/95 hover:bg-emerald-950/60 px-2 py-0.5 font-mono text-[10px] font-semibold text-emerald-300 shadow-md transition-colors"
                        title={`Drag up/down to adjust TP${idx + 1} (${p.pct}%)`}
                      >
                        <span>
                          {pPos.clamped === "top"
                            ? "▲"
                            : pPos.clamped === "bottom"
                            ? "▼"
                            : "↕"}{" "}
                          TP{idx + 1} ({p.pct}%) {p.price}
                        </span>
                      </div>
                    );
                  })}

                  {/* 4. Left-Snapped Full Take Profit Handle Pill */}
                  <div
                    onPointerDown={(e) => startRailPriceDrag(e, "target", velaPosition.target)}
                    style={{ top: tpPos.y }}
                    className="pointer-events-auto absolute left-0 -translate-y-1/2 cursor-ns-resize flex items-center gap-1 rounded border border-emerald-500/70 bg-card/95 hover:bg-emerald-950/60 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-400 shadow-md transition-colors"
                    title="Drag up/down to adjust Full Take Profit (chart stays locked)"
                  >
                    <span>
                      {tpPos.clamped === "top"
                        ? "▲"
                        : tpPos.clamped === "bottom"
                        ? "▼"
                        : "↕"}{" "}
                      Full TP {velaPosition.target}
                    </span>
                  </div>
                </>
              );
            })()}
          </div>
        )}

        {/* Banner when Picking Start Candle */}
        {ready && pickingStartCandleDir && (
          <div className="pointer-events-none absolute inset-x-0 top-2.5 z-40 flex justify-center">
            <div className="rounded-full border border-border bg-card/95 px-3.5 py-1 text-[11px] font-semibold text-foreground shadow-md">
              Click any candle on the chart to place {pickingStartCandleDir.toUpperCase()} Start Bar…
            </div>
          </div>
        )}
      </div>
    </>
  );
}
