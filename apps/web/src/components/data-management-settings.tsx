"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Database,
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

interface TelemetryResponse {
  ok: boolean;
  totalDiskBytes: number;
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

  // Date range & target database checkboxes
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
  const [onlySyncedToNotion, setOnlySyncedToNotion] = useState(true);

  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<{
    type: "ok" | "err";
    text: string;
  } | null>(null);

  // Backup restore state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [restoreMode, setRestoreMode] = useState<"merge" | "replace">("merge");

  // Tablet MT5 direct sync state
  const [mt5Log, setMt5Log] = useState<string | null>(null);

  const fetchTelemetry = async () => {
    setLoadingStats(true);
    try {
      const res = await fetch("/api/settings/data-management");
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
    void fetchTelemetry();
  }, []);

  const toggleTarget = (id: string) => {
    setSelectedTargets((prev) =>
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

  const handleDeleteRangeLocal = async () => {
    if (selectedTargets.length === 0) return;
    const confirmed = window.confirm(
      `Are you sure you want to delete local data from ${startDate} to ${endDate} for [${selectedTargets.join(
        ", "
      )}]${onlySyncedToNotion ? " (only entries already synced to Notion)" : ""}?`
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
          targets: selectedTargets,
          onlySyncedToNotion,
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

  const handleTriggerMt5Sync = async (mode: "sync" | "login") => {
    setBusyAction(`mt5_${mode}`);
    setMt5Log(null);
    setStatusMsg(null);
    try {
      const res = await fetch("/api/mt5/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const data = await res.json();
      setMt5Log(data.log || data.error || "Finished");
      if (data.ok) {
        setStatusMsg({
          type: "ok",
          text:
            mode === "login"
              ? "Launched MT5 GUI window for account login."
              : "MT5 trades synced to SQLite & Notion!",
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
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400 mt-0.5" />
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
              <HardDrive className="h-4 w-4 text-indigo-400" />
              <span>Database Storage &amp; Attachment Telemetry</span>
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Total SQLite Disk Footprint (including WAL &amp; binary WebP attachments):{" "}
              <strong className="text-foreground">
                {telemetry ? formatBytes(telemetry.totalDiskBytes) : "Calculating..."}
              </strong>
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={fetchTelemetry}
            disabled={loadingStats}
            className="h-8 text-xs"
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loadingStats ? "animate-spin" : ""}`} />
            Refresh Stats
          </Button>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {dbCards.map(({ key, metric }) => {
              const pct =
                telemetry && telemetry.totalDiskBytes > 0 && metric
                  ? Math.min(100, Math.round((metric.totalBytes / telemetry.totalDiskBytes) * 100))
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
                    <span className="rounded-md bg-indigo-500/15 border border-indigo-500/30 px-2 py-0.5 font-mono text-xs font-bold text-indigo-300 shrink-0">
                      {metric ? formatBytes(metric.totalBytes) : "—"}
                    </span>
                  </div>

                  <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
                    <div
                      style={{ width: `${Math.max(3, pct)}%` }}
                      className="h-full bg-indigo-500 rounded-full transition-all"
                    />
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground pt-1">
                    <span className="font-medium text-foreground/90">
                      {metric?.subCountLabel || "0 records"}
                    </span>
                    <span>
                      Text/Data: <strong>{metric ? formatBytes(metric.dataBytes) : "0 B"}</strong>
                      {" • "}
                      Images/Attachments:{" "}
                      <strong>{metric ? formatBytes(metric.attachmentBytes) : "0 B"}</strong>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* 2. CLOUD BACKUP SYNC TO NOTION & LOCAL RANGE CLEANUP */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-bold flex items-center gap-2">
            <CloudUpload className="h-4 w-4 text-sky-400" />
            <span>Date-Range Cloud Sync to Notion &amp; Local Cleanup</span>
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Push local journals &amp; trades to Notion as a cloud backup, or prune local data by date range.
            Empty pages and pages containing only unmodified default templates are automatically skipped so
            they never overwrite your Notion cloud backups.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Date Range Selectors */}
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

          {/* Target Databases Selector */}
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
                    onClick={() => toggleTarget(t.id)}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                      checked
                        ? "border-indigo-500 bg-indigo-600/20 text-indigo-200"
                        : "border-border/60 bg-secondary/30 text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      readOnly
                      className="h-3.5 w-3.5 accent-indigo-500 pointer-events-none"
                    />
                    <span>{t.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-lg border border-border/50 bg-secondary/20 px-3 py-2 text-xs">
            <input
              type="checkbox"
              id="only-synced-guard"
              checked={onlySyncedToNotion}
              onChange={(e) => setOnlySyncedToNotion(e.target.checked)}
              className="h-3.5 w-3.5 accent-indigo-500"
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
              className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold"
            >
              <CloudUpload className="h-4 w-4 mr-1.5" />
              {busyAction === "push_notion"
                ? "Pushing Substantive Pages to Notion..."
                : "Push Date Range to Notion (Skip Empty/Template)"}
            </Button>

            <Button
              variant="destructive"
              onClick={handleDeleteRangeLocal}
              disabled={busyAction !== null || selectedTargets.length === 0}
              className="text-xs font-semibold"
            >
              <Trash2 className="h-4 w-4 mr-1.5" />
              {busyAction === "delete_range"
                ? "Deleting & Vacuuming..."
                : "Delete Selected Local Data in Range"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 3. LOSSLESS COMPRESSED ARCHIVE EXPORT & RESTORE */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-bold flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
            <span>Lossless Compressed Full Backup &amp; Restore (.json.gz)</span>
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Exports all 4 databases, settings, templates, candlesticks, and high-res WebP chart images
            using Level-9 Gzip lossless compression (~70% smaller file size with zero quality loss).
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2.5">
            <Button asChild className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold">
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
                <Upload className="h-4 w-4 mr-1.5 text-indigo-400" />
                {busyAction === "restore" ? "Restoring Archive..." : "Upload & Restore Backup"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 4. DIRECT TABLET / TERMUX HEADLESS MT5 TRADE SYNC */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-bold flex items-center gap-2">
            <Terminal className="h-4 w-4 text-amber-400" />
            <span>Direct Tablet MT5 Sync (Termux PRoot / Headless Xvfb)</span>
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Sync MT5 trades directly on your tablet without a PC. Use <strong>Launch MT5 Login GUI</strong>{" "}
            once to sign into your broker account; afterward, click <strong>Sync MT5 Trades Headlessly</strong>{" "}
            anytime to pull deals and M1 MAE/MFE in the background via Xvfb.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <Button
              onClick={() => void handleTriggerMt5Sync("sync")}
              disabled={busyAction !== null}
              className="bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold"
            >
              <RefreshCw
                className={`h-4 w-4 mr-1.5 ${busyAction === "mt5_sync" ? "animate-spin" : ""}`}
              />
              {busyAction === "mt5_sync"
                ? "Syncing MT5 Headlessly..."
                : "Sync MT5 Trades Now (Headless)"}
            </Button>

            <Button
              variant="outline"
              onClick={() => void handleTriggerMt5Sync("login")}
              disabled={busyAction !== null}
              className="text-xs"
            >
              <Terminal className="h-4 w-4 mr-1.5" />
              Launch MT5 GUI (One-Time Account Login)
            </Button>
          </div>

          {mt5Log && (
            <pre className="max-h-48 overflow-y-auto rounded-lg border border-border/60 bg-[#0d0f14] p-3 font-mono text-[11px] text-slate-300 whitespace-pre-wrap">
              {mt5Log}
            </pre>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
