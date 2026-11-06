"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  HardDrive,
  CloudUpload,
  Trash2,
  Download,
  Upload,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Terminal,
  ShieldCheck,
  Lock,
  CheckSquare,
  Square,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface DbMetric {
  label: string;
  description: string;
  rowCount: number;
  subCountLabel: string;
  dataBytes: number;
  attachmentBytes: number;
  attachmentCount: number;
  totalBytes: number;
}

interface BucketStat {
  count: number;
  bytes: number;
  bars: number;
}

interface CandleSeriesItem {
  seriesKey: string;
  sourceType: "candles_db" | "csv_table" | "excursions_table";
  providerRaw: string;
  providerCategory: "databento" | "londonstrategicedge" | "csv" | "other";
  symbol: string;
  assetClass: "futures" | "forex" | "crypto" | "equities";
  timeframe: string;
  barCount: number;
  bytes: number;
  rangeBarCount?: number;
  rangeBytes?: number;
  firstDate: string;
  lastDate: string;
}

interface TelemetryResponse {
  ok: boolean;
  totalDiskBytes: number;
  journalDiskBytes?: number;
  candleDbDiskBytes?: number;
  candleBreakdown?: {
    byProvider: Record<string, BucketStat>;
    byAssetClass: Record<string, BucketStat>;
    series: CandleSeriesItem[];
  };
  databases: {
    trades: DbMetric;
    daily: DbMetric;
    periodic: DbMetric;
    candles: DbMetric;
  };
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let val = bytes;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  return `${val.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

export function DataManagementSettings() {
  const [telemetry, setTelemetry] = useState<TelemetryResponse | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);

  const [startDate, setStartDate] = useState(() => {
    const d = new Date(Date.now() - 30 * 86_400_000);
    return d.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [selectedTargets, setSelectedTargets] = useState<string[]>([
    "trades",
    "daily",
    "periodic",
  ]);

  // Candlestick Provider, Asset Class & Individual Ticker Series Selection
  // Databento (paid) is UNCHECKED/PROTECTED by default!
  const [candleProviders, setCandleProviders] = useState<string[]>([
    "londonstrategicedge",
    "csv",
  ]);
  const [candleAssetClasses, setCandleAssetClasses] = useState<string[]>([
    "futures",
    "forex",
    "crypto",
    "equities",
  ]);
  const [selectedSeriesKeys, setSelectedSeriesKeys] = useState<string[]>([]);
  const [ignoreDateRangeForCandles, setIgnoreDateRangeForCandles] = useState<boolean>(false);

  const [onlySyncedToNotion, setOnlySyncedToNotion] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<{
    type: "ok" | "err";
    text: string;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [restoreMode, setRestoreMode] = useState<"merge" | "replace">("merge");

  const [desktopHost, setDesktopHost] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("tz_mt5_desktop_host") || "mark@fedora-mark-desktop";
    }
    return "mark@fedora-mark-desktop";
  });
  const [mt5Log, setMt5Log] = useState<string | null>(null);
  const [syncSettings, setSyncSettings] = useState<any>(null);
  const [tailscaleInfo, setTailscaleInfo] = useState<any>(null);
  const [newDevName, setNewDevName] = useState("");
  const [newDevTarget, setNewDevTarget] = useState("");
  const [newDevOs, setNewDevOs] = useState<"linux" | "windows">("linux");

  const [gdriveConfig, setGdriveConfig] = useState<any>({
    rcloneRemotePath: "gdrive:TradeJournalBackups",
    keepCount: 3,
    schedule: "daily",
  });
  const [snapshots, setSnapshots] = useState<any[]>([]);

  const fetchSyncAndGDriveStatus = async () => {
    try {
      const [sRes, gRes] = await Promise.all([
        fetch("/api/mt5/sync").then((r) => r.json()),
        fetch("/api/settings/gdrive-backup").then((r) => r.json()),
      ]);
      if (sRes?.ok) {
        setSyncSettings(sRes.settings);
        setTailscaleInfo(sRes.tailscale);
      }
      if (gRes?.ok) {
        setGdriveConfig(gRes.config);
        setSnapshots(gRes.snapshots || []);
      }
    } catch {}
  };

  useEffect(() => {
    void fetchSyncAndGDriveStatus();
  }, []);

  const allSeries = useMemo(
    () => telemetry?.candleBreakdown?.series || [],
    [telemetry]
  );

  // Sync selectedSeriesKeys automatically whenever telemetry loads or Provider/Asset Class filters change
  useEffect(() => {
    const matching = allSeries
      .filter(
        (s) =>
          candleProviders.includes(s.providerCategory) &&
          candleAssetClasses.includes(s.assetClass)
      )
      .map((s) => s.seriesKey);
    setSelectedSeriesKeys(matching);
  }, [allSeries, candleProviders, candleAssetClasses]);

  const fetchTelemetry = async (sDate = startDate, eDate = endDate) => {
    setLoadingStats(true);
    try {
      const res = await fetch(
        `/api/settings/data-management?startDate=${encodeURIComponent(
          sDate
        )}&endDate=${encodeURIComponent(eDate)}`
      );
      const data = await res.json();
      if (data?.ok) {
        setTelemetry(data);
      }
    } catch {
    } finally {
      setLoadingStats(false);
    }
  };

  useEffect(() => {
    void fetchTelemetry(startDate, endDate);
  }, [startDate, endDate]);

  const toggleItem = (
    list: string[],
    setList: React.Dispatch<React.SetStateAction<string[]>>,
    id: string
  ) => {
    setList((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handlePushRangeToNotion = async () => {
    if (selectedTargets.length === 0) return;
    setBusyAction("push_notion");
    setStatusMsg(null);
    try {
      const res = await fetch("/api/settings/data-management", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "push_notion",
          startDate,
          endDate,
          targets: selectedTargets,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setStatusMsg({ type: "ok", text: data.message });
      } else {
        setStatusMsg({ type: "err", text: data.error || "Notion range sync failed" });
      }
    } catch (err: any) {
      setStatusMsg({ type: "err", text: err?.message || "Network error" });
    } finally {
      setBusyAction(null);
    }
  };

  const handleDeleteRangeLocal = async (overrideSeriesKeys?: string[]) => {
    const keysToDelete = overrideSeriesKeys ?? selectedSeriesKeys;
    const activeTargets = overrideSeriesKeys ? ["candles"] : selectedTargets;

    if (activeTargets.length === 0) return;
    if (activeTargets.includes("candles") && keysToDelete.length === 0 && activeTargets.length === 1) {
      window.alert("Select at least one ticker series to delete.");
      return;
    }

    const tickerNames = allSeries
      .filter((s) => keysToDelete.includes(s.seriesKey))
      .map((s) => `${s.symbol} (${s.timeframe}, ${s.providerRaw})`)
      .join(", ");

    const candleNotice = activeTargets.includes("candles")
      ? `\n• Tickers to Delete (${keysToDelete.length}): ${tickerNames || "None"}\n• Scope: ${
          ignoreDateRangeForCandles
            ? "Entire cached history for selected tickers"
            : `Bars between ${startDate} and ${endDate}`
        }`
      : "";

    const confirmed = window.confirm(
      `Confirm deleting local data for [${activeTargets.join(", ")}]?${candleNotice}`
    );
    if (!confirmed) return;

    setBusyAction("delete_range");
    setStatusMsg(null);
    try {
      const res = await fetch("/api/settings/data-management", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete_range",
          startDate,
          endDate,
          targets: activeTargets,
          onlySyncedToNotion,
          selectedSeriesKeys: keysToDelete,
          ignoreDateRangeForCandles,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setStatusMsg({ type: "ok", text: data.message });
        void fetchTelemetry();
      } else {
        setStatusMsg({ type: "err", text: data.error || "Delete failed" });
      }
    } catch (err: any) {
      setStatusMsg({ type: "err", text: err?.message || "Network error" });
    } finally {
      setBusyAction(null);
    }
  };

  const handleUploadBackup = async (file: File) => {
    setBusyAction("restore");
    setStatusMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("mode", restoreMode);

      const res = await fetch("/api/settings/backup", {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (data.ok) {
        setStatusMsg({ type: "ok", text: data.message });
        void fetchTelemetry();
      } else {
        setStatusMsg({ type: "err", text: data.error || "Backup restore failed" });
      }
    } catch (err: any) {
      setStatusMsg({ type: "err", text: err?.message || "Restore error" });
    } finally {
      setBusyAction(null);
    }
  };

  const handleTriggerMt5Sync = async () => {
    setBusyAction("mt5_sync");
    setMt5Log(null);
    setStatusMsg(null);
    try {
      localStorage.setItem("tz_mt5_desktop_host", desktopHost.trim());
    } catch {}
    try {
      const res = await fetch("/api/mt5/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ useConfiguredDevices: true }),
      });
      const data = await res.json();
      setMt5Log(data.log || data.error || "Finished");
      if (data.ok) {
        setStatusMsg({
          type: "ok",
          text: "MT5 trades synced to SQLite & Notion!",
        });
        void fetchTelemetry();
      } else {
        setStatusMsg({
          type: "err",
          text: data.error || "MT5 sync returned an error (see log below).",
        });
      }
    } catch (err: any) {
      setStatusMsg({ type: "err", text: err?.message || "Failed to trigger MT5 sync" });
    } finally {
      setBusyAction(null);
    }
  };

  const dbCards: Array<{ key: "trades" | "daily" | "periodic" | "candles"; metric?: DbMetric }> = [
    { key: "trades", metric: telemetry?.databases.trades },
    { key: "daily", metric: telemetry?.databases.daily },
    { key: "periodic", metric: telemetry?.databases.periodic },
    { key: "candles", metric: telemetry?.databases.candles },
  ];

  const provStats = telemetry?.candleBreakdown?.byProvider;
  const assetStats = telemetry?.candleBreakdown?.byAssetClass;

  return (
    <div className="space-y-6">
      {statusMsg && (
        <div
          className={`flex items-start gap-2.5 rounded-xl border p-3.5 text-xs font-medium ${
            statusMsg.type === "ok"
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
              : "border-rose-500/40 bg-rose-500/10 text-rose-300"
          }`}
        >
          {statusMsg.type === "ok" ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />
          ) : (
            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400 mt-0.5" />
          )}
          <span>{statusMsg.text}</span>
        </div>
      )}

      {/* 1. STORAGE TELEMETRY ACROSS THE 4 MAIN DATABASES */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <div>
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <HardDrive className="h-4 w-4 text-muted-foreground" />
              <span>Database Storage &amp; Attachment Telemetry</span>
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Total SQLite Footprint (<code>journal.db</code> + <code>market_candles.db</code>):{" "}
              <strong className="text-foreground">
                {telemetry ? formatBytes(telemetry.totalDiskBytes) : "Calculating..."}
              </strong>
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void fetchTelemetry(startDate, endDate)}
            disabled={loadingStats}
            className="h-8 text-xs"
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loadingStats ? "animate-spin" : ""}`} />
            Refresh Stats
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {dbCards.map(({ key, metric }) => {
              const totalFootprint = telemetry?.totalDiskBytes || 1;
              const pct = metric
                ? Math.min(100, Math.round((metric.totalBytes / totalFootprint) * 100))
                : 0;
              return (
                <div
                  key={key}
                  className="rounded-xl border border-border/70 bg-secondary/20 p-3.5 space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-xs font-bold text-foreground">
                        {metric?.label || key.toUpperCase()}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {metric?.description}
                      </div>
                    </div>
                    <span className="rounded-md bg-secondary border border-border px-2 py-0.5 font-mono text-xs font-bold text-foreground shrink-0">
                      {metric ? formatBytes(metric.totalBytes) : "—"}
                    </span>
                  </div>

                  <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
                    <div
                      style={{ width: `${Math.max(3, pct)}%` }}
                      className="h-full bg-foreground rounded-full transition-all"
                    />
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground pt-1">
                    <span className="font-medium text-foreground/90">
                      {metric?.subCountLabel || "0 records"}
                    </span>
                    <span>
                      Data: <strong>{metric ? formatBytes(metric.dataBytes) : "0 B"}</strong>
                      {key !== "candles" && (
                        <>
                          {" • "}
                          Attachments:{" "}
                          <strong>{metric ? formatBytes(metric.attachmentBytes) : "0 B"}</strong>
                        </>
                      )}
                    </span>
                  </div>

                  {key === "candles" && provStats && assetStats && (
                    <div className="mt-2 pt-2 border-t border-border/40 space-y-1.5 text-[10px]">
                      <div className="flex flex-wrap items-center justify-between gap-1">
                        <span className="text-muted-foreground font-semibold">By Provider:</span>
                        <div className="flex flex-wrap gap-1.5">
                          <span className="rounded bg-secondary border border-border px-1.5 py-0.5 text-foreground font-medium">
                            🔒 Databento: {formatBytes(provStats.databento?.bytes || 0)} (
                            {(provStats.databento?.bars || 0).toLocaleString()} bars)
                          </span>
                          <span className="rounded bg-secondary border border-border px-1.5 py-0.5 text-foreground font-medium">
                            London Strategic Edge:{" "}
                            {formatBytes(provStats.londonstrategicedge?.bytes || 0)} (
                            {(provStats.londonstrategicedge?.bars || 0).toLocaleString()} bars)
                          </span>
                          {(provStats.csv?.bytes || 0) > 0 && (
                            <span className="rounded bg-secondary px-1.5 py-0.5 text-muted-foreground">
                              CSV: {formatBytes(provStats.csv?.bytes || 0)}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-1">
                        <span className="text-muted-foreground font-semibold">By Asset Class:</span>
                        <div className="flex flex-wrap gap-1.5 text-muted-foreground">
                          <span>Futures: {formatBytes(assetStats.futures?.bytes || 0)}</span>
                          <span>•</span>
                          <span>Forex: {formatBytes(assetStats.forex?.bytes || 0)}</span>
                          <span>•</span>
                          <span>Crypto: {formatBytes(assetStats.crypto?.bytes || 0)}</span>
                          <span>•</span>
                          <span>Equities: {formatBytes(assetStats.equities?.bytes || 0)}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* 2. CLOUD BACKUP SYNC TO NOTION & GRANULAR LOCAL CLEANUP */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-bold flex items-center gap-2">
            <CloudUpload className="h-4 w-4 text-muted-foreground" />
            <span>Date-Range Cloud Sync to Notion &amp; Selective Local Cleanup</span>
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Push local journals &amp; trades to Notion as a cloud backup, or prune local data by date range
            and individual ticker. Empty pages and pages containing only unmodified default templates are
            automatically skipped.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-foreground mb-1">
                Start Date (Inclusive)
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs text-foreground"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-foreground mb-1">
                End Date (Inclusive)
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs text-foreground"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="text-xs font-semibold text-foreground">
              Select Target Databases:
            </div>
            <div className="flex flex-wrap gap-2">
              {[
                { id: "trades", label: "1. Trade Database" },
                { id: "daily", label: "2. Daily Journal Database" },
                { id: "periodic", label: "3. Periodic Journal Database (W/M/Q/Y)" },
                { id: "candles", label: "4. Chart Replay / Candlesticks Database" },
              ].map((t) => {
                const checked = selectedTargets.includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => toggleItem(selectedTargets, setSelectedTargets, t.id)}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                      checked
                        ? "border-foreground bg-indigo-600/20 text-foreground"
                        : "border-border/60 bg-secondary/30 text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      readOnly
                      className="h-3.5 w-3.5 accent-foreground pointer-events-none"
                    />
                    <span>{t.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* GRANULAR CANDLESTICK FILTERS: PROVIDER -> ASSET CLASS -> INDIVIDUAL TICKER SERIES */}
          {selectedTargets.includes("candles") && (
            <div className="rounded-xl border border-border bg-secondary/20 p-4 space-y-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-bold text-foreground flex items-center gap-1.5">
                  <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>
                    Candlestick Provider, Asset Class &amp; Individual Ticker Selector
                  </span>
                </div>

                <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={ignoreDateRangeForCandles}
                    onChange={(e) => setIgnoreDateRangeForCandles(e.target.checked)}
                    className="h-3.5 w-3.5 accent-foreground"
                  />
                  <span>
                    Delete entire cached history for selected tickers (ignore date range above)
                  </span>
                </label>
              </div>

              {/* A. Quick Filter by Data Provider */}
              <div className="space-y-1.5">
                <div className="text-[11px] font-semibold text-muted-foreground">
                  1. Filter by Data Provider:
                </div>
                <div className="flex flex-wrap gap-2">
                  {[
                    {
                      id: "londonstrategicedge",
                      label: "London Strategic Edge (Free — Safe to Delete)",
                    },
                    { id: "csv", label: "Uploaded CSV Datasets" },
                    {
                      id: "databento",
                      label: "🔒 Databento (Paid — Keep Unchecked to Protect)",
                    },
                  ].map((p) => {
                    const active = candleProviders.includes(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => toggleItem(candleProviders, setCandleProviders, p.id)}
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${
                          active
                            ? p.id === "databento"
                              ? "border-rose-500 bg-rose-500/20 text-rose-200"
                              : "border-foreground bg-sky-500/20 text-foreground"
                            : "border-border/60 bg-background/60 text-muted-foreground"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={active}
                          readOnly
                          className="h-3.5 w-3.5 pointer-events-none"
                        />
                        <span>{p.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* B. Quick Filter by Asset Class */}
              <div className="space-y-1.5">
                <div className="text-[11px] font-semibold text-muted-foreground">
                  2. Filter by Asset Class:
                </div>
                <div className="flex flex-wrap gap-2">
                  {[
                    { id: "futures", label: "Futures / Indices (ES, NQ, NAS100, SPX500)" },
                    { id: "forex", label: "Forex & Metals (EUR/USD, XAU/USD)" },
                    { id: "crypto", label: "Crypto" },
                    { id: "equities", label: "Equities / Stocks" },
                  ].map((a) => {
                    const active = candleAssetClasses.includes(a.id);
                    return (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() =>
                          toggleItem(candleAssetClasses, setCandleAssetClasses, a.id)
                        }
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${
                          active
                            ? "border-foreground bg-foreground/20 text-foreground"
                            : "border-border/60 bg-background/60 text-muted-foreground"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={active}
                          readOnly
                          className="h-3.5 w-3.5 pointer-events-none"
                        />
                        <span>{a.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* C. Individual Ticker Series Table with Checkboxes & 1-Click Delete */}
              <div className="space-y-2 pt-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-[11px] font-semibold text-foreground">
                    3. Choose Individual Ticker Series to Delete ({selectedSeriesKeys.length} of{" "}
                    {allSeries.length} selected):
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px]">
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedSeriesKeys(
                          allSeries
                            .filter((s) => s.providerCategory !== "databento")
                            .map((s) => s.seriesKey)
                        )
                      }
                      className="rounded border border-border/60 bg-secondary/50 hover:bg-secondary px-2 py-0.5 text-foreground"
                    >
                      Select All Free (Non-Databento)
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedSeriesKeys([])}
                      className="rounded border border-border/60 bg-secondary/50 hover:bg-secondary px-2 py-0.5 text-muted-foreground hover:text-foreground"
                    >
                      Clear All
                    </button>
                  </div>
                </div>

                {allSeries.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border/50 p-4 text-center text-xs text-muted-foreground">
                    No cached candlestick series found in <code>market_candles.db</code>.
                  </div>
                ) : (
                  <div className="max-h-72 overflow-y-auto rounded-lg border border-border/60 bg-background divide-y divide-border/40">
                    {allSeries.map((s) => {
                      const isChecked = selectedSeriesKeys.includes(s.seriesKey);
                      const isPaid = s.providerCategory === "databento";
                      const shortProvider =
                        s.providerRaw === "london-strategic-edge"
                          ? "LSE"
                          : s.providerRaw.replace("databento:", "Databento ");
                      return (
                        <div
                          key={s.seriesKey}
                          className={`flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-3 py-2.5 text-xs transition ${
                            isChecked ? "bg-secondary/40" : "hover:bg-secondary/20"
                          }`}
                        >
                          <label className="flex flex-wrap items-center gap-2 cursor-pointer min-w-0">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() =>
                                toggleItem(selectedSeriesKeys, setSelectedSeriesKeys, s.seriesKey)
                              }
                              className="h-3.5 w-3.5 accent-foreground shrink-0"
                            />
                            <span className="font-mono font-bold text-foreground whitespace-nowrap">
                              {s.symbol}
                            </span>
                            <span className="rounded border border-border bg-secondary px-1.5 py-0.5 text-[10px] font-mono text-foreground whitespace-nowrap shrink-0">
                              {s.timeframe}
                            </span>
                            <span
                              className="rounded border border-border bg-secondary/70 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground whitespace-nowrap shrink-0"
                              title={s.providerRaw}
                            >
                              {isPaid ? `🔒 ${shortProvider}` : shortProvider}
                            </span>
                            <span className="rounded bg-muted/40 px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground whitespace-nowrap shrink-0">
                              {s.assetClass}
                            </span>
                          </label>

                          <div className="flex flex-wrap items-center justify-end gap-3 text-[11px] shrink-0 pl-5 sm:pl-0">
                            <span className="font-mono text-muted-foreground whitespace-nowrap">
                              {s.firstDate} → {s.lastDate}
                            </span>
                            <span className="font-mono text-foreground whitespace-nowrap">
                              {ignoreDateRangeForCandles
                                ? `${s.barCount.toLocaleString()} bars`
                                : `${(s.rangeBarCount ?? s.barCount).toLocaleString()} / ${s.barCount.toLocaleString()} bars`}
                            </span>
                            <span className="font-mono font-semibold text-foreground min-w-[64px] text-right whitespace-nowrap">
                              {formatBytes(
                                ignoreDateRangeForCandles ? s.bytes : s.rangeBytes ?? s.bytes
                              )}
                            </span>
                            <button
                              type="button"
                              onClick={() => void handleDeleteRangeLocal([s.seriesKey])}
                              disabled={busyAction !== null}
                              className="rounded border border-rose-500/40 bg-rose-500/15 hover:bg-rose-500/30 px-2.5 py-0.5 text-[10px] font-semibold text-rose-400 transition whitespace-nowrap shrink-0"
                              title={
                                ignoreDateRangeForCandles
                                  ? `Delete entire history of ${s.symbol} (${s.timeframe})`
                                  : `Delete ${s.symbol} (${s.timeframe}) bars between ${startDate} and ${endDate}`
                              }
                            >
                              {ignoreDateRangeForCandles ? "Delete All" : "Delete Range"}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 rounded-lg border border-border/50 bg-secondary/20 px-3 py-2 text-xs">
            <input
              type="checkbox"
              id="only-synced-guard"
              checked={onlySyncedToNotion}
              onChange={(e) => setOnlySyncedToNotion(e.target.checked)}
              className="h-3.5 w-3.5 accent-foreground"
            />
            <label htmlFor="only-synced-guard" className="text-muted-foreground cursor-pointer">
              <strong className="text-foreground">Safety Guard on Local Delete:</strong> Only delete
              local trades/journals that already have a linked Notion backup page ID.
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button
              onClick={handlePushRangeToNotion}
              disabled={busyAction !== null || selectedTargets.length === 0}
              className="bg-indigo-600 hover:bg-foreground text-white text-xs font-semibold"
            >
              <CloudUpload className="h-4 w-4 mr-1.5" />
              {busyAction === "push_notion"
                ? "Pushing Substantive Pages to Notion..."
                : "Push Date Range to Notion (Skip Empty/Template)"}
            </Button>

            <Button
              variant="destructive"
              onClick={() => void handleDeleteRangeLocal()}
              disabled={busyAction !== null || selectedTargets.length === 0}
              className="text-xs font-semibold"
            >
              <Trash2 className="h-4 w-4 mr-1.5" />
              {busyAction === "delete_range"
                ? "Deleting & Vacuuming..."
                : "Delete Selected Local Data"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 3. LOSSLESS COMPRESSED ARCHIVE EXPORT & RESTORE */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-bold flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
            <span>Lossless Compressed Full Backup &amp; Restore (.json.gz)</span>
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Exports all 4 databases (including <code>market_candles.db</code>), settings, templates,
            and high-res WebP chart images using Level-9 Gzip lossless compression (~70% smaller file
            size with zero quality loss).
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2.5">
            <Button asChild variant="secondary" className="border border-border text-foreground text-xs font-semibold">
              <a href="/api/settings/backup" download>
                <Download className="h-4 w-4 mr-1.5" />
                Export Compressed Full Backup (.json.gz)
              </a>
            </Button>

            <Button variant="outline" asChild className="text-xs">
              <a href="/api/export" download="trade-journal-export.json">
                <Download className="h-4 w-4 mr-1.5" />
                Export Uncompressed JSON
              </a>
            </Button>

            <Button variant="outline" asChild className="text-xs">
              <a href="/api/export?format=csv" download>
                <Download className="h-4 w-4 mr-1.5" />
                Export Trades CSV
              </a>
            </Button>
          </div>

          <div className="border-t border-border/50 pt-3 space-y-2.5">
            <div className="text-xs font-semibold text-foreground">
              Restore from Backup File (`.json.gz` or `.json`):
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={restoreMode}
                onChange={(e) => setRestoreMode(e.target.value as "merge" | "replace")}
                className="h-9 rounded-lg border border-border bg-background px-3 text-xs text-foreground"
              >
                <option value="merge">Safe Merge / Upsert (Keep newer local entries)</option>
                <option value="replace">Full Snapshot Replace (Overwrite local tables)</option>
              </select>

              <input
                ref={fileInputRef}
                type="file"
                accept=".gz,.json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleUploadBackup(f);
                  e.target.value = "";
                }}
              />

              <Button
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={busyAction !== null}
                className="text-xs font-semibold"
              >
                <Upload className="h-4 w-4 mr-1.5 text-muted-foreground" />
                {busyAction === "restore" ? "Restoring Archive..." : "Upload & Restore Backup"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 5. INCREMENTAL GOOGLE DRIVE SNAPSHOT BACKUPS (ROLLING 2-3 SNAPSHOTS) */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-bold flex items-center gap-2">
            <CloudUpload className="h-4 w-4 text-emerald-400" />
            <span>Incremental Google Drive Snapshot Backups (Rolling 2–3 Backups)</span>
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Complete disaster-recovery snapshot of all trades, daily/periodic journals, templates,
            custom decision-tree questions, and high-res WebP chart images. Uses SHA-256 change
            detection and automatically keeps the latest {gdriveConfig.keepCount || 3} snapshots.
          </p>
        </CardHeader>
        <CardContent className="space-y-4 text-xs">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-foreground mb-1">
                Google Drive Remote / Folder Path (rclone or local mount)
              </label>
              <input
                type="text"
                value={gdriveConfig.rcloneRemotePath || ""}
                onChange={(e) =>
                  setGdriveConfig((prev: any) => ({
                    ...prev,
                    rcloneRemotePath: e.target.value,
                  }))
                }
                placeholder="gdrive:TradeJournalBackups or ~/GoogleDrive/Backups"
                className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs font-mono text-foreground"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-foreground mb-1">
                Rolling Snapshots to Keep
              </label>
              <select
                value={gdriveConfig.keepCount || 3}
                onChange={(e) =>
                  setGdriveConfig((prev: any) => ({
                    ...prev,
                    keepCount: Number(e.target.value),
                  }))
                }
                className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs text-foreground"
              >
                <option value={2}>Keep Latest 2 Snapshots</option>
                <option value={3}>Keep Latest 3 Snapshots (Recommended)</option>
                <option value={5}>Keep Latest 5 Snapshots</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-foreground mb-1">
                Backup Schedule
              </label>
              <select
                value={gdriveConfig.schedule || "daily"}
                onChange={(e) =>
                  setGdriveConfig((prev: any) => ({
                    ...prev,
                    schedule: e.target.value,
                  }))
                }
                className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs text-foreground"
              >
                <option value="manual">Manual Snapshot Only</option>
                <option value="on_sync">After Every Trade Sync</option>
                <option value="6h">Every 6 Hours (Incremental)</option>
                <option value="daily">Daily Incremental Snapshot</option>
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <Button
              onClick={async () => {
                setBusyAction("gdrive_snap");
                setStatusMsg(null);
                try {
                  await fetch("/api/settings/gdrive-backup", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "save_config", ...gdriveConfig }),
                  });
                  const res = await fetch("/api/settings/gdrive-backup", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "create_snapshot", force: true }),
                  });
                  const data = await res.json();
                  if (data.ok) {
                    setSnapshots(data.snapshots || []);
                    setStatusMsg({ type: "ok", text: data.message });
                  } else {
                    setStatusMsg({ type: "err", text: data.error || "Snapshot failed" });
                  }
                } catch (err: any) {
                  setStatusMsg({ type: "err", text: err?.message || "Backup error" });
                } finally {
                  setBusyAction(null);
                }
              }}
              disabled={busyAction !== null}
              className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold"
            >
              <CloudUpload className="h-4 w-4 mr-1.5" />
              {busyAction === "gdrive_snap"
                ? "Creating & Syncing Snapshot..."
                : "Create Incremental Snapshot & Sync to Google Drive"}
            </Button>

            <Button
              variant="outline"
              onClick={async () => {
                const res = await fetch("/api/settings/gdrive-backup", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: "save_config", ...gdriveConfig }),
                });
                const data = await res.json();
                if (data.ok) {
                  setStatusMsg({ type: "ok", text: data.message });
                }
              }}
              className="text-xs"
            >
              Save Backup Settings
            </Button>
          </div>

          {/* Rolling Snapshot Recovery Points List */}
          <div className="space-y-2 pt-2 border-t border-border/50">
            <div className="text-[11px] font-bold text-foreground">
              Available Rolling Snapshots ({snapshots.length} of {gdriveConfig.keepCount || 3} max):
            </div>
            {snapshots.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border/50 p-4 text-center text-muted-foreground">
                No snapshots created yet. Click{" "}
                <strong>Create Incremental Snapshot &amp; Sync to Google Drive</strong> above.
              </div>
            ) : (
              <div className="divide-y divide-border/40 rounded-lg border border-border/60 bg-background">
                {snapshots.map((snap: any) => (
                  <div
                    key={snap.filename}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                  >
                    <div>
                      <div className="font-mono font-bold text-foreground">{snap.filename}</div>
                      <div className="text-[10px] text-muted-foreground">
                        Created: {snap.createdAt.slice(0, 19).replace("T", " ")} • Size:{" "}
                        {formatBytes(snap.sizeBytes)} • SHA-256: <code>{snap.sha256}</code>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <a
                        href={`/api/settings/gdrive-backup?download=${encodeURIComponent(
                          snap.filename
                        )}`}
                        download
                        className="rounded border border-border bg-secondary/60 hover:bg-secondary px-2.5 py-1 text-[10px] font-semibold text-foreground"
                      >
                        Download
                      </a>
                      <button
                        type="button"
                        onClick={async () => {
                          if (
                            !window.confirm(
                              `Restore all journals, trades, templates, and images from ${snap.filename}?`
                            )
                          )
                            return;
                          setBusyAction("restore");
                          try {
                            const res = await fetch("/api/settings/gdrive-backup", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                action: "restore_snapshot",
                                filename: snap.filename,
                              }),
                            });
                            const data = await res.json();
                            if (data.ok) {
                              setStatusMsg({ type: "ok", text: data.message });
                              void fetchTelemetry();
                            } else {
                              setStatusMsg({ type: "err", text: data.error || "Restore failed" });
                            }
                          } finally {
                            setBusyAction(null);
                          }
                        }}
                        className="rounded border border-emerald-500/40 bg-emerald-500/15 hover:bg-emerald-500/25 px-2.5 py-1 text-[10px] font-semibold text-emerald-300"
                      >
                        Restore Snapshot
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
