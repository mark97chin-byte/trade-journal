"use client";

import React, { useEffect, useState } from "react";
import {
  Terminal,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  FileText,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { NotebookTradeMatcherModal } from "@/components/notebook/notebook-trade-matcher-modal";

export function Mt5TailscaleSyncCard() {
  const [syncSettings, setSyncSettings] = useState<any>(null);
  const [tailscaleInfo, setTailscaleInfo] = useState<any>(null);
  const [busySync, setBusySync] = useState(false);
  const [mt5Log, setMt5Log] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [newDevName, setNewDevName] = useState("");
  const [newDevTarget, setNewDevTarget] = useState("");
  const [newDevOs, setNewDevOs] = useState<"linux" | "windows">("linux");

  const [unarchivedDraftCount, setUnarchivedDraftCount] = useState(0);
  const [matcherOpen, setMatcherOpen] = useState(false);

  const fetchSyncStatus = async () => {
    try {
      const [sRes, bRes] = await Promise.all([
        fetch("/api/mt5/sync").then((r) => r.json()),
        fetch("/api/notebook-bridge").then((r) => r.json()).catch(() => ({ notes: [] })),
      ]);
      if (sRes?.ok) {
        setSyncSettings(sRes.settings);
        setTailscaleInfo(sRes.tailscale);
      }
      if (Array.isArray(bRes?.notes)) {
        setUnarchivedDraftCount(bRes.notes.length);
      }
    } catch {}
  };

  useEffect(() => {
    void fetchSyncStatus();
  }, []);

  const handleTriggerMt5Sync = async () => {
    setBusySync(true);
    setMt5Log(null);
    setStatusMsg(null);
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
        void fetchSyncStatus();
      } else {
        setStatusMsg({
          type: "err",
          text: data.error || "MT5 sync returned an error (see log below).",
        });
      }
    } catch (err: any) {
      setStatusMsg({ type: "err", text: err?.message || "Failed to trigger MT5 sync" });
    } finally {
      setBusySync(false);
    }
  };

  return (
    <div className="space-y-4">
      <NotebookTradeMatcherModal
        open={matcherOpen}
        onOpenChange={setMatcherOpen}
        onCompleted={(msg) => {
          setStatusMsg({ type: "ok", text: msg });
          void fetchSyncStatus();
        }}
      />

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

      {/* SMART NOTIFICATION IF UNARCHIVED NOTEBOOK DRAFTS EXIST */}
      {unarchivedDraftCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-indigo-500/40 bg-indigo-500/10 px-4 py-3 text-xs">
          <div className="flex items-center gap-2.5">
            <FileText className="h-4 w-4 text-indigo-400 shrink-0" />
            <div>
              <span className="font-bold text-indigo-200">
                {unarchivedDraftCount} Unarchived Notebook Trade Draft{unarchivedDraftCount === 1 ? "" : "s"} Ready
              </span>
              <p className="text-[11px] text-muted-foreground">
                Once you sync your MT5 trades, click here to match and confirm which Notebook draft goes to which trade.
              </p>
            </div>
          </div>
          <Button
            size="sm"
            onClick={() => setMatcherOpen(true)}
            className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold"
          >
            Match Drafts to Synced Trades ({unarchivedDraftCount})
          </Button>
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
          <div>
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <Terminal className="h-4 w-4 text-indigo-400" />
              <span>Multi-Device Tailscale Trade Sync &amp; Auto-Failover Scheduler</span>
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Automatically detects devices on your Tailscale network (Fedora Desktop, Linux Laptop,
              Windows Desktop, Tablet). Cycles through your enabled machines in priority order until
              it finds an online host ready to sync.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void fetchSyncStatus()}
            className="h-8 text-xs"
          >
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            Scan Tailscale Network
          </Button>
        </CardHeader>
        <CardContent className="space-y-4 text-xs">
          {tailscaleInfo?.peers !== undefined && (
            <div className="rounded-xl border border-border/60 bg-secondary/20 p-3 space-y-2">
              <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Live Tailscale Network Devices ({tailscaleInfo?.peers?.length || 0} discovered •{" "}
                {tailscaleInfo?.mode === "direct_probe" ? "Direct TCP Mode" : "Tailscale CLI Mode"})
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {tailscaleInfo.peers.map((peer: any, idx: number) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-background px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="font-bold text-foreground truncate flex items-center gap-1.5">
                        <span
                          className={`h-2 w-2 rounded-full ${
                            peer.online ? "bg-emerald-400" : "bg-rose-400"
                          }`}
                        />
                        <span>{peer.hostname}</span>
                        {peer.isSelf && (
                          <span className="rounded bg-indigo-500/20 px-1.5 py-0.5 text-[9px] text-indigo-300">
                            THIS DEVICE
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-muted-foreground font-mono">
                        {peer.ip} • {peer.os} •{" "}
                        {peer.isSelf
                          ? "Local Exec Ready"
                          : peer.sshReachable
                          ? "SSH Port 22 Ready"
                          : "Port 22 Closed"}
                      </div>
                    </div>
                    {!peer.isSelf && (
                      <button
                        type="button"
                        onClick={() => {
                          if (!syncSettings) return;
                          const exists = (syncSettings.devices || []).some(
                            (d: any) =>
                              d.sshTarget.includes(peer.hostname) || d.sshTarget.includes(peer.ip)
                          );
                          if (exists) return;
                          const nextDevs = [
                            ...(syncSettings.devices || []),
                            {
                              id: `dev_${Date.now()}`,
                              name: `${peer.hostname} (${peer.os})`,
                              sshTarget: `mark@${peer.ip}`,
                              osType: peer.os.toLowerCase().includes("win") ? "windows" : "linux",
                              repoPath: "~/trade-journal-dev",
                              enabled: true,
                            },
                          ];
                          const next = { ...syncSettings, devices: nextDevs };
                          setSyncSettings(next);
                          void fetch("/api/mt5/sync", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ action: "save_settings", ...next }),
                          });
                        }}
                        className="rounded border border-border bg-secondary hover:bg-secondary/80 px-2 py-1 text-[10px] font-semibold text-foreground shrink-0"
                      >
                        + Add to Sync List
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-muted-foreground mb-1">
                Sync Device Selection Mode
              </label>
              <select
                value={syncSettings?.selectedDeviceId || "auto_cycle"}
                onChange={(e) => {
                  const val = e.target.value;
                  const next = {
                    ...(syncSettings || {}),
                    selectedDeviceId: val,
                    autoCycle: val === "auto_cycle",
                  };
                  setSyncSettings(next);
                  void fetch("/api/mt5/sync", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "save_settings", ...next }),
                  });
                }}
                className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs text-foreground"
              >
                <option value="auto_cycle">
                  Auto-Cycle Priority List (Try each online device)
                </option>
                {(syncSettings?.devices || []).map((d: any) => (
                  <option key={d.id} value={d.id}>
                    Pin to: {d.name} ({d.sshTarget})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-muted-foreground mb-1">
                Automated Sync Schedule
              </label>
              <select
                value={syncSettings?.schedule || "manual"}
                onChange={(e) => {
                  const next = { ...(syncSettings || {}), schedule: e.target.value };
                  setSyncSettings(next);
                  void fetch("/api/mt5/sync", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "save_settings", ...next }),
                  });
                }}
                className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs text-foreground"
              >
                <option value="manual">Manual Trigger Only</option>
                <option value="15m">Every 15 Minutes</option>
                <option value="1h">Every 1 Hour</option>
                <option value="4h">Every 4 Hours</option>
                <option value="daily">Daily at NY Session Close</option>
              </select>
            </div>

            <div className="flex flex-col justify-end">
              <Button
                onClick={() => void handleTriggerMt5Sync()}
                disabled={busySync}
                className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold h-9 w-full"
              >
                <RefreshCw className={`h-4 w-4 mr-1.5 ${busySync ? "animate-spin" : ""}`} />
                {busySync ? "Cycling Devices & Syncing..." : "Sync MT5 Trades Now"}
              </Button>
            </div>
          </div>

          {syncSettings?.devices && (
            <div className="space-y-2 pt-1">
              <div className="text-[11px] font-semibold text-foreground">
                Configured Sync Machines (Priority Order for Auto-Cycle):
              </div>
              <div className="divide-y divide-border/40 rounded-lg border border-border/60 bg-background">
                {syncSettings.devices.map((dev: any, idx: number) => (
                  <div
                    key={dev.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                  >
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(dev.enabled)}
                        onChange={(e) => {
                          const updated = syncSettings.devices.map((d: any, i: number) =>
                            i === idx ? { ...d, enabled: e.target.checked } : d
                          );
                          const next = { ...syncSettings, devices: updated };
                          setSyncSettings(next);
                          void fetch("/api/mt5/sync", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ action: "save_settings", ...next }),
                          });
                        }}
                        className="h-3.5 w-3.5 accent-foreground"
                      />
                      <span className="font-mono text-[10px] text-muted-foreground">
                        #{idx + 1}
                      </span>
                      <span className="font-bold text-foreground">{dev.name}</span>
                      <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-foreground">
                        {dev.sshTarget}
                      </span>
                      <span className="rounded bg-muted/40 px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                        {dev.osType}
                      </span>
                    </label>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          if (idx === 0) return;
                          const copy = [...syncSettings.devices];
                          const temp = copy[idx - 1];
                          copy[idx - 1] = copy[idx];
                          copy[idx] = temp;
                          const next = { ...syncSettings, devices: copy };
                          setSyncSettings(next);
                          void fetch("/api/mt5/sync", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ action: "save_settings", ...next }),
                          });
                        }}
                        className="rounded border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                        title="Move up priority"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const updated = syncSettings.devices.filter(
                            (_: any, i: number) => i !== idx
                          );
                          const next = { ...syncSettings, devices: updated };
                          setSyncSettings(next);
                          void fetch("/api/mt5/sync", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ action: "save_settings", ...next }),
                          });
                        }}
                        className="rounded bg-rose-500/15 hover:bg-rose-500/25 px-2 py-0.5 text-[10px] text-rose-400"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <input
                  type="text"
                  value={newDevName}
                  onChange={(e) => setNewDevName(e.target.value)}
                  placeholder="Device Label (e.g. Linux Laptop or Windows PC)"
                  className="h-8 flex-1 min-w-[160px] rounded-lg border border-border bg-background px-2.5 text-xs"
                />
                <input
                  type="text"
                  value={newDevTarget}
                  onChange={(e) => setNewDevTarget(e.target.value)}
                  placeholder="SSH Target (e.g. mark@100.x.y.z)"
                  className="h-8 flex-1 min-w-[160px] rounded-lg border border-border bg-background px-2.5 text-xs font-mono"
                />
                <select
                  value={newDevOs}
                  onChange={(e) => setNewDevOs(e.target.value as "linux" | "windows")}
                  className="h-8 rounded-lg border border-border bg-background px-2 text-xs"
                >
                  <option value="linux">Linux (Fedora / Laptop)</option>
                  <option value="windows">Windows Desktop</option>
                </select>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    if (!newDevName.trim() || !newDevTarget.trim() || !syncSettings) return;
                    const nextDevs = [
                      ...syncSettings.devices,
                      {
                        id: `dev_${Date.now()}`,
                        name: newDevName.trim(),
                        sshTarget: newDevTarget.trim(),
                        osType: newDevOs,
                        repoPath: "~/trade-journal-dev",
                        enabled: true,
                      },
                    ];
                    const next = { ...syncSettings, devices: nextDevs };
                    setSyncSettings(next);
                    setNewDevName("");
                    setNewDevTarget("");
                    void fetch("/api/mt5/sync", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ action: "save_settings", ...next }),
                    });
                  }}
                  className="h-8 text-xs font-semibold"
                >
                  + Add Machine
                </Button>
              </div>
            </div>
          )}

          {syncSettings?.lastSyncAt && (
            <div className="text-[11px] text-muted-foreground">
              Last Synced: <strong className="text-foreground">{syncSettings.lastSyncAt}</strong>{" "}
              via <strong className="text-emerald-400">{syncSettings.lastSyncDevice}</strong>
            </div>
          )}

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
