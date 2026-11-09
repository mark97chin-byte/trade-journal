"use client";

import React, { useEffect, useState } from "react";
import { Cpu, Zap, FileText, PowerOff, CheckCircle2, Loader2, Save } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

export function AiModelOrchestratorCard() {
  const [config, setConfig] = useState<any>(null);
  const [presets, setPresets] = useState<any[]>([]);
  const [daemonStatus, setDaemonStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  const fetchStatus = async () => {
    try {
      const res = await fetch("/api/ai/runtime");
      const data = await res.json();
      if (data.config) setConfig(data.config);
      if (data.presets) setPresets(data.presets);
      setDaemonStatus(data.daemonStatus ?? null);
    } catch {}
    setLoading(false);
  };

  useEffect(() => {
    void fetchStatus();
  }, []);

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    setNotice("");
    try {
      const res = await fetch("/api/ai/runtime", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save", config }),
      });
      const out = await res.json();
      if (out.config) setConfig(out.config);
      setNotice("Saved AI Orchestrator configuration.");
    } catch {
      setNotice("Failed to save configuration.");
    } finally {
      setSaving(false);
    }
  };

  const handleSwitchSlot = async (slot: "chat" | "report" | "none") => {
    setSwitching(slot);
    setNotice(
      slot === "chat"
        ? "Unloading Report Engine & loading Strata (Qwen3.8-Flash-Next)..."
        : slot === "report"
        ? "Unloading Strata & loading Report/Audit Engine..."
        : "Unloading all models from GPU VRAM..."
    );
    try {
      const res = await fetch("/api/ai/runtime", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "switch", slot }),
      });
      const out = await res.json();
      if (out.config) setConfig(out.config);
      const dMsg = out.daemonResponse?.status || out.daemonResponse?.message || "Switched active slot.";
      setNotice(`Active Mode: ${slot.toUpperCase()} (${dMsg})`);
      void fetchStatus();
    } catch {
      setNotice("Failed to switch slot.");
    } finally {
      setSwitching(null);
    }
  };

  if (loading || !config) return null;

  const updateChatQuant = (quant: string) => {
    const nextModelFile = `Qwen3.8-Flash-Next-${quant}.gguf`;
    const nextCmd = `strata serve --model /mnt/e/models/${nextModelFile} --port 8081 --ctx-size ${config.chatSlot.contextLength} --cache-type-k ${config.chatSlot.kvQuant} --cache-type-v ${config.chatSlot.kvQuant} --gpu-layers auto --vram-budget ${config.chatSlot.vramBudgetGb}`;
    setConfig({
      ...config,
      chatSlot: {
        ...config.chatSlot,
        quantization: quant,
        modelId: nextModelFile,
        startCommand: nextCmd,
      },
    });
  };

  return (
    <Card className="border-border/70 bg-card">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-3">
        <div className="space-y-0.5">
          <CardTitle className="text-base font-bold flex items-center gap-2">
            <Cpu className="h-4 w-4 text-indigo-400" />
            <span>On-Demand AI Model Orchestrator (Mutual-Exclusion GPU Switcher)</span>
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Ensures your <strong>Interactive Chat (Strata · Qwen3.8-Flash-Next)</strong> and{" "}
            <strong>Overnight Report Engine</strong> never run at the same time on your RTX 4070 Super (12GB VRAM + 64GB RAM).
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={`text-xs font-mono px-2.5 py-1 ${
              config.activeSlot === "chat"
                ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-400"
                : config.activeSlot === "report"
                ? "border-sky-500/50 bg-sky-500/10 text-sky-400"
                : "border-border text-muted-foreground"
            }`}
          >
            {config.activeSlot === "chat"
              ? `🟢 ACTIVE: CHAT (${config.chatSlot.quantization} · ~40 tok/s)`
              : config.activeSlot === "report"
              ? "🔵 ACTIVE: REPORT / AUDIT ENGINE"
              : "⚪ GPU IDLE (UNLOADED)"}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 text-xs">
        {/* ONE-CLICK ON-DEMAND MODE SWITCHER */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/70 bg-secondary/20 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant={config.activeSlot === "chat" ? "default" : "outline"}
              disabled={switching !== null}
              onClick={() => void handleSwitchSlot("chat")}
              className="h-8 text-xs font-semibold"
            >
              {switching === "chat" ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <Zap className="h-3.5 w-3.5 mr-1.5 text-amber-400" />
              )}
              Load Chat Model (Strata · Qwen3.8-Flash-Next)
            </Button>

            <Button
              size="sm"
              variant={config.activeSlot === "report" ? "default" : "outline"}
              disabled={switching !== null}
              onClick={() => void handleSwitchSlot("report")}
              className="h-8 text-xs font-semibold"
            >
              {switching === "report" ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <FileText className="h-3.5 w-3.5 mr-1.5 text-sky-400" />
              )}
              Load Report &amp; Audit Model (KoboldCPP)
            </Button>

            <Button
              size="sm"
              variant="ghost"
              disabled={switching !== null || config.activeSlot === "none"}
              onClick={() => void handleSwitchSlot("none")}
              className="h-8 text-xs text-muted-foreground hover:text-rose-400"
            >
              <PowerOff className="h-3.5 w-3.5 mr-1" />
              Unload GPU VRAM
            </Button>
          </div>

          <label className="flex items-center gap-2 cursor-pointer font-medium text-foreground">
            <input
              type="checkbox"
              checked={Boolean(config.autoSwitchOnDemand)}
              onChange={(e) =>
                setConfig({ ...config, autoSwitchOnDemand: e.target.checked })
              }
              className="h-3.5 w-3.5 accent-indigo-500"
            />
            <span>Auto-load on demand &amp; unload other model</span>
          </label>
        </div>

        {notice && (
          <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-2 text-xs text-indigo-300 flex items-center gap-2">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            <span>{notice}</span>
          </div>
        )}

        {/* TWO-COLUMN SLOT CONFIGURATION */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* SLOT 1: INTERACTIVE CHAT (STRATA QWEN3.8-FLASH-NEXT) */}
          <div className="rounded-xl border border-border/70 bg-background p-3.5 space-y-3">
            <div className="flex items-center justify-between border-b border-border/50 pb-2">
              <span className="font-bold text-foreground flex items-center gap-1.5">
                <Zap className="h-3.5 w-3.5 text-amber-400" />
                Slot 1 · Interactive Chat Engine (niko1221/strata)
              </span>
              <span className="rounded bg-amber-500/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-amber-300">
                ~40 tok/s Target
              </span>
            </div>

            <div className="space-y-1">
              <Label className="text-[11px]">
                Quantization Tier (Optimized for Intelligence vs. Speed)
              </Label>
              <select
                value={config.chatSlot.quantization}
                onChange={(e) => updateChatQuant(e.target.value)}
                className="h-8 w-full rounded-md border border-border bg-card px-2 text-xs font-mono font-semibold text-foreground"
              >
                {presets.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label className="text-[10px] text-muted-foreground">Strata KV Cache</Label>
                <select
                  value={config.chatSlot.kvQuant}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      chatSlot: { ...config.chatSlot, kvQuant: e.target.value },
                    })
                  }
                  className="h-7 w-full rounded border border-border bg-card px-1.5 font-mono text-xs"
                >
                  <option value="tq3_5s">tq3_5s (3.5-bit Quality)</option>
                  <option value="tq3_0">tq3_0 (3.0-bit Balanced)</option>
                  <option value="q8_0">q8_0 (8-bit Standard)</option>
                </select>
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">VRAM Budget (GB)</Label>
                <Input
                  type="number"
                  step="0.5"
                  value={config.chatSlot.vramBudgetGb}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      chatSlot: {
                        ...config.chatSlot,
                        vramBudgetGb: Number(e.target.value) || 10.5,
                      },
                    })
                  }
                  className="h-7 text-xs font-mono"
                />
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">Context Window</Label>
                <Input
                  type="number"
                  step="4096"
                  value={config.chatSlot.contextLength}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      chatSlot: {
                        ...config.chatSlot,
                        contextLength: Number(e.target.value) || 32768,
                      },
                    })
                  }
                  className="h-7 text-xs font-mono"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">Strata Endpoint URL</Label>
              <Input
                value={config.chatSlot.endpointUrl}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    chatSlot: { ...config.chatSlot, endpointUrl: e.target.value },
                  })
                }
                className="h-7 text-xs font-mono"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">
                Strata Launch Command (on fedora-mark-desktop)
              </Label>
              <Input
                value={config.chatSlot.startCommand}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    chatSlot: { ...config.chatSlot, startCommand: e.target.value },
                  })
                }
                className="h-7 text-[11px] font-mono"
              />
            </div>
          </div>

          {/* SLOT 2: REPORT & AUDIT ENGINE (EXISTING SETUP) */}
          <div className="rounded-xl border border-border/70 bg-background p-3.5 space-y-3">
            <div className="flex items-center justify-between border-b border-border/50 pb-2">
              <span className="font-bold text-foreground flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5 text-sky-400" />
                Slot 2 · Overnight Report &amp; Audit Engine (Current Setup)
              </span>
              <span className="rounded bg-sky-500/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-sky-300">
                Batch Synthesis
              </span>
            </div>

            <div className="space-y-1">
              <Label className="text-[11px]">Engine Label / Model Profile</Label>
              <Input
                value={config.reportSlot.modelId}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    reportSlot: { ...config.reportSlot, modelId: e.target.value },
                  })
                }
                className="h-8 text-xs font-mono"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-[10px] text-muted-foreground">Report Endpoint URL</Label>
                <Input
                  value={config.reportSlot.endpointUrl}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      reportSlot: { ...config.reportSlot, endpointUrl: e.target.value },
                    })
                  }
                  className="h-7 text-xs font-mono"
                />
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">
                  Desktop Orchestrator Daemon URL
                </Label>
                <Input
                  value={config.orchestratorDaemonUrl}
                  onChange={(e) =>
                    setConfig({ ...config, orchestratorDaemonUrl: e.target.value })
                  }
                  className="h-7 text-xs font-mono"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">
                Report Engine Launch Command (on fedora-mark-desktop)
              </Label>
              <Input
                value={config.reportSlot.startCommand}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    reportSlot: { ...config.reportSlot, startCommand: e.target.value },
                  })
                }
                className="h-7 text-[11px] font-mono"
              />
            </div>

            <div className="flex items-center justify-between pt-2">
              <span className="text-[11px] text-muted-foreground">
                Auto-unload after{" "}
                <input
                  type="number"
                  value={config.idleUnloadMinutes}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      idleUnloadMinutes: Number(e.target.value) || 30,
                    })
                  }
                  className="w-14 rounded border border-border bg-card px-1 py-0.5 text-center font-mono text-xs text-foreground"
                />{" "}
                mins idle
              </span>

              <Button
                size="sm"
                onClick={() => void handleSave()}
                disabled={saving}
                className="h-7 text-xs font-semibold"
              >
                <Save className="h-3.5 w-3.5 mr-1" />
                {saving ? "Saving..." : "Save AI Settings"}
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
