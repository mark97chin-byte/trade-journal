"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Vela } from "@luxalgo/vela";
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw, SkipForward } from "lucide-react";
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

export function TradeMarketData({
  trade,
  executions,
}: {
  trade: ChartTrade & { currency: string };
  executions: ChartExecution[];
}) {
  const privacy = usePrivacy();
  const { data: saved, refresh: refreshSaved } = useApi<{
    saved: { estimate: ExcursionEstimate } | null;
  }>(`/api/trades/${encodeURIComponent(trade.key)}/market-data`);
  const { data: connections, error: connectionError } = useApi<{ connections: MarketConnection[] }>(
    "/api/market-data/connections",
  );
  const available = connections?.connections.filter((connection) => connection.configured) ?? [];
  const [provider, setProvider] = useState("");
  const [symbol, setSymbol] = useState(trade.symbol);
  const [dataset, setDataset] = useState("");
  const [resolution, setResolution] = useState<Resolution>("1m");
  const info = providerInfo(provider);
  const { data: csv } = useApi<{ datasets: MarketCsvDataset[] }>(
    info?.mode === "csv" ? "/api/market-data/csv" : null,
  );
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<TradeMarketResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  const invalidate = () => {
    controller.current?.abort();
    setBusy(false);
    setResult(null);
    setError("");
  };

  const load = async () => {
    if (!available.some((item) => item.id === provider) || (info?.datasets && !dataset)) return;
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch(`/api/trades/${encodeURIComponent(trade.key)}/market-data`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          symbol,
          dataset,
          resolution,
          basisConfirmed: confirmed,
        }),
        signal: request.signal,
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "History request failed.");
      if (!request.signal.aborted) {
        setResult(body);
        refreshSaved();
      }
    } catch (cause) {
      if (!request.signal.aborted)
        setError(cause instanceof Error ? cause.message : "History request failed.");
    } finally {
      if (!request.signal.aborted) setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader>
          <CardTitle>Market data & replay</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Load candles for this trade to use replay. Enable the checkbox to also calculate and
            save monetary MAE/MFE estimates for Reports.
          </p>
          {connectionError && (
            <p role="alert" className="text-sm text-destructive">
              {connectionError}
            </p>
          )}
          {!available.length && (
            <p className="text-sm text-muted-foreground">
              <a className="underline" href="/settings#market-data">
                Connect a market data provider in Settings
              </a>{" "}
              to use historical replay and estimates.
            </p>
          )}
          {!trade.closedAt ? (
            <p className="text-sm text-muted-foreground">Available after this trade closes.</p>
          ) : (
            available.length > 0 && (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="market-provider">Data provider</Label>
                    <OptionSelect
                      id="market-provider"
                      value={provider}
                      onValueChange={(value) => {
                        invalidate();
                        setProvider(value);
                        setDataset("");
                        setConfirmed(false);
                      }}
                    >
                      <option value="" disabled>
                        Choose a data source
                      </option>
                      {available.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </OptionSelect>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="market-symbol">Provider symbol</Label>
                    <Input
                      id="market-symbol"
                      value={symbol}
                      onChange={(event) => {
                        invalidate();
                        setSymbol(event.target.value);
                        setConfirmed(false);
                      }}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="market-resolution">Candle resolution</Label>
                    <OptionSelect
                      id="market-resolution"
                      value={resolution}
                      onValueChange={(value) => {
                        invalidate();
                        setResolution(value as Resolution);
                      }}
                    >
                      {Object.keys(RESOLUTIONS).map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </OptionSelect>
                  </div>
                  {(info?.datasets ||
                    info?.mode === "csv" ||
                    info?.id === "london-strategic-edge") && (
                    <div className="space-y-1">
                      <Label htmlFor="market-dataset">Data feed / dataset</Label>
                      {info?.datasets || info?.mode === "csv" ? (
                        <OptionSelect
                          id="market-dataset"
                          value={dataset}
                          onValueChange={(value) => {
                            invalidate();
                            setDataset(value);
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
                          placeholder="Leave blank for automatic selection"
                          onChange={(event) => {
                            invalidate();
                            setDataset(event.target.value);
                            setConfirmed(false);
                          }}
                        />
                      )}
                    </div>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {info?.description} {info?.symbolHint} Option contract history is not supported
                  yet.
                </p>
                <label className="flex items-start gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    className="mt-0.5"
                    onChange={(event) => {
                      invalidate();
                      setConfirmed(event.target.checked);
                    }}
                  />
                  <span>
                    Calculate and save MAE/MFE estimates for Reports. I confirm that this
                    instrument, price adjustments and quote currency match my fills and account (
                    {trade.currency}).
                  </span>
                </label>
                <p className="text-xs text-muted-foreground">
                  Unchecked: load candles and replay only. Checked: also calculate monetary
                  estimates and save valid results to Reports. Missing or mismatched data stays
                  unavailable.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={
                      busy ||
                      !symbol.trim() ||
                      !available.some((item) => item.id === provider) ||
                      Boolean(info?.datasets && !dataset)
                    }
                    onClick={() => void load()}
                  >
                    {busy
                      ? "Loading history…"
                      : confirmed
                        ? "Load data & save estimates"
                        : "Load candles & replay"}
                  </Button>
                  {busy && (
                    <Button variant="outline" onClick={invalidate}>
                      Cancel
                    </Button>
                  )}
                  {result && (
                    <Button variant="outline" onClick={invalidate}>
                      Show original chart
                    </Button>
                  )}
                </div>
              </>
            )
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </CardContent>
      </Card>
      {!result && saved?.saved && (
        <p className="text-xs text-muted-foreground">
          Previously saved MAE/MFE estimates are shown below. Loading candles without the checkbox
          keeps those saved estimates; it does not calculate new ones.
        </p>
      )}
      {result && result.bars.length > 0 ? (
        <HistoricalReplay
          history={result}
          trade={trade}
          executions={executions}
          privacy={privacy}
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
                      : "Load market data to calculate"}
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
                      : "Load market data to calculate"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Trade replay</p>
              <p className="text-sm">
                {busy ? "Loading candles…" : "Available after candles load"}
              </p>
            </div>
          </div>
          {result && (
            <p role="status" className="text-sm text-muted-foreground">
              No candles were returned for this instrument and trade period. Check the symbol,
              dataset and plan coverage.
            </p>
          )}
          <TradeChart
            trade={trade}
            executions={getEffectiveExecutions(trade, executions, result)}
          />
        </>
      )}
    </div>
  );
}

function getEffectiveExecutions(
  trade: ChartTrade,
  executions: ChartExecution[],
  history?: TradeMarketResult | null,
): ChartExecution[] {
  // 1. If discrete executions exist and price basis is valid, use them
  if (executions.length > 0 && !history?.estimate?.priceBasisMismatch) {
    return executions;
  }

  // 2. Synthesize fills snapped to the 1m bar averages
  if (!history?.bars?.length || !trade.openedAt) {
    return executions;
  }

  const openMs = Date.parse(trade.openedAt);
  const closeMs = trade.closedAt ? Date.parse(trade.closedAt) : openMs;

  // Find nearest candles to the entry and exit timestamps
  const entryBar = history.bars.reduce((prev, curr) =>
    Math.abs(curr.time - openMs) < Math.abs(prev.time - openMs) ? curr : prev,
  );
  const exitBar = history.bars.reduce((prev, curr) =>
    Math.abs(curr.time - closeMs) < Math.abs(prev.time - closeMs) ? curr : prev,
  );

  const isShort = trade.direction
    ? trade.direction.toLowerCase() === "short" || trade.direction.toLowerCase() === "sell"
    : false;
  const entryAvg = Number(((entryBar.open + entryBar.close) / 2).toFixed(2));
  const exitAvg = Number(((exitBar.open + exitBar.close) / 2).toFixed(2));

  const fills: ChartExecution[] = [
    {
      side: isShort ? "sell" : "buy",
      price: entryAvg,
      quantity: (trade as any).quantity || 1,
      executedAt: new Date(entryBar.time).toISOString(),
    },
  ];

  if (trade.closedAt) {
    fills.push({
      side: isShort ? "buy" : "sell",
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
}: {
  history: TradeMarketResult;
  trade: ChartTrade & { currency: string };
  executions: ChartExecution[];
  privacy: boolean;
}) {
  const [count, setCount] = useState(history.bars.length);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState("4");

  useEffect(() => {
    setCount(history.bars.length);
    setPlaying(false);
  }, [history]);

  useEffect(() => {
    if (!playing || privacy) return;
    const timer = window.setInterval(
      () => {
        if (!document.hidden) setCount((current) => Math.min(current + 1, history.bars.length));
      },
      1000 / Number(speed),
    );
    return () => window.clearInterval(timer);
  }, [playing, privacy, speed, history.bars.length]);

  useEffect(() => {
    if (count >= history.bars.length || privacy) setPlaying(false);
  }, [count, privacy, history.bars.length]);

  const complete = count === history.bars.length;
  const effectiveExecutions = useMemo(
    () => getEffectiveExecutions(trade, executions, history),
    [trade, executions, history],
  );

  const frame = useMemo(
    () => replayFrame(history, effectiveExecutions, count),
    [history, effectiveExecutions, count],
  );

  return (
    <Card className="journal-replay-enter">
      <CardHeader>
        <CardTitle>Historical candles</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          {history.provider} · {history.symbol} · {history.resolution} ·{" "}
          {history.bars.length.toLocaleString()} candles · Retrieved{" "}
          {new Date(history.fetchedAt).toLocaleString()}
        </p>
        {privacy ? (
          <p className="text-sm text-muted-foreground">
            Historical prices and excursion amounts are hidden in privacy mode.
          </p>
        ) : (
          <>
            {history.estimate.priceBasisMismatch && (
              <p role="status" className="rounded-md border p-3 text-sm text-muted-foreground">
                The market candles and recorded fill prices do not match. Replay shows market
                prices; fill labels and MAE/MFE estimates are withheld. See the data limits below.
              </p>
            )}
            <ReplayChart history={history} nextFrame={frame} />
            <div
              className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-2"
              role="group"
              aria-label="Candle replay controls"
            >
              <Button
                variant="outline"
                size="icon"
                aria-label="Restart replay"
                onClick={() => {
                  setPlaying(false);
                  setCount(1);
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
                  setCount((current) => Math.max(1, current - 1));
                }}
              >
                <ChevronLeft />
              </Button>
              <Button
                className="min-w-24"
                disabled={history.bars.length <= 1}
                onClick={() => {
                  if (complete) setCount(1);
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
                  setCount((current) => Math.min(current + 1, history.bars.length));
                }}
              >
                <ChevronRight />
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label="Show all candles"
                disabled={complete}
                onClick={() => {
                  setPlaying(false);
                  setCount(history.bars.length);
                }}
              >
                <SkipForward />
              </Button>
              <span className="mx-1 text-xs tabular-nums text-muted-foreground" aria-live="off">
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
            <input
              aria-label="Replay position"
              type="range"
              min={1}
              max={history.bars.length}
              value={count}
              className="w-full accent-primary"
              onChange={(event) => {
                setPlaying(false);
                setCount(Number(event.target.value));
              }}
            />
            <p className="text-xs text-muted-foreground">
              {count} / {history.bars.length} candles · Through{" "}
              {Number.isFinite(frame.through)
                ? new Intl.DateTimeFormat("en-US", {
                    timeZone: "America/New_York",
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                    hour12: false,
                  }).format(new Date(frame.through)) + " (NY)"
                : "—"}
              . Candles are revealed at bar close; this is not a tick-by-tick simulation.
            </p>
          </>
        )}
        <div className="grid grid-cols-2 gap-3 rounded-lg border p-3">
          <div>
            <p className="text-xs text-muted-foreground">Estimated MAE · adverse</p>
            <p className="font-medium">
              {privacy
                ? "••••"
                : !complete
                  ? "Hidden during replay"
                  : history.estimate.mae === null
                    ? "Unavailable"
                    : fmtMoney(history.estimate.mae, trade.currency).replace(/^\+/, "")}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Estimated MFE · favorable</p>
            <p className="font-medium">
              {privacy
                ? "••••"
                : !complete
                  ? "Hidden during replay"
                  : history.estimate.mfe === null
                    ? "Unavailable"
                    : fmtMoney(history.estimate.mfe, trade.currency).replace(/^\+/, "")}
            </p>
          </div>
        </div>
        <details className="text-xs text-muted-foreground" open>
          <summary className="cursor-pointer">Data coverage & estimate limits</summary>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            {[...history.warnings, ...history.estimate.warnings].map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </details>
      </CardContent>
    </Card>
  );
}

/** Calculate the DST-safe epoch offset (in ms) between UTC and America/New_York. */
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
    date.getUTCSeconds(),
  );

  return nyUtcMs - actualUtcMs;
}

function ReplayChart({
  history,
  nextFrame,
}: {
  history: TradeMarketResult;
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

  // Offset UTC timestamps into America/New_York display coordinates
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

      const instance = new Vela(host.current, {
        symbol: history.symbol,
        timeframe:
          { "1m": "1", "5m": "5", "15m": "15", "1h": "60", "1d": "1D" }[
            history.resolution
          ] ?? "1",
        data: shiftedInitialBars,
        live: false,
        height: 420,
        theme: dark() ? "dark" : "light",
        priceStyle: "candles",
        volume: true,
        drawings: false,
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
        className="relative h-[420px] overflow-hidden rounded-lg border"
        aria-busy={!ready && !error}
      >
        {!ready && !error && (
          <div
            className="absolute inset-0 flex items-center justify-center bg-muted/20 text-sm text-muted-foreground"
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