"use client";

import React, { useEffect, useState } from "react";
import {
  Cpu,
  Zap,
  FileText,
  FolderOpen,
  RefreshCw,
  PowerOff,
  CheckCircle2,
  Loader2,
  Save,
  RotateCcw,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

const QUANT_OPTIONS = [
  { value: "UD-Q3_K_XL", label: "UD-Q3_K_XL · Best for 64GB RAM (~50GB · ~40 tok/s · High Intelligence)" },
  { value: "UD-Q3_K_M", label: "UD-Q3_K_M · Balanced (~48GB · ~45 tok/s)" },
  { value: "UD-Q2_K_XL", label: "UD-Q2_K_XL · Fast (~42GB · ~55 tok/s)" },
  { value: "Custom", label: "Custom Model File / Manual Quant" },
];

export function AiEngineSettingsCard() {
  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [engineTab, setEngineTab] = useState<"chat" | "report">("chat");
  const [scanning, setScanning] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  const [personaTab, setPersonaTab] = useState<"coach" | "journal">("coach");
  const [temperature, setTemperature] = useState(0.0);
  const [topP, setTopP] = useState(0.05);
  const [coachPrompt, setCoachPrompt] = useState(
    `You are a longitudinal trading psychology and behavioral performance analyst.\nYou do not evaluate the trader's technical chart model. Your job is to connect the chain of thought across multiple Daily, Weekly, Monthly, and Quarterly journals—especially their End-of-Period Reviews and self-reflection quote blocks—and correlate their own words with their hard execution telemetry.\nHold the trader strictly accountable to their active process goals without judgment.`
  );

  const fetchConfig = async () => {
    try {
      const res = await fetch("/api/ai/runtime");
      const data = await res.json();
      if (data.config) setConfig(data.config);
    } catch {}
    setLoading(false);
  };

  useEffect(() => {
    void fetchConfig();
  }, []);

  const handleScanFolder = async (slotKey: "chatSlot" | "reportSlot") => {
    if (!config) return;
    setScanning(true);
    setNotice("Scanning desktop folder for .gguf files...");
    try {
      const folderPath = config[slotKey].modelsFolder;
      const res = await fetch("/api/ai/runtime", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "scan_folder", folderPath }),
      });
      const data = await res.json();
      const files: string[] = data.files || [];
      setConfig((prev: any) => ({
        ...prev,
        [slotKey]: {
          ...prev[slotKey],
          discoveredModels: files,
          activeModelFile: files.includes(prev[slotKey].activeModelFile)
            ? prev[slotKey].activeModelFile
            : files[0] || prev[slotKey].activeModelFile,
        },
      }));
      setNotice(`Discovered ${files.length} .gguf file(s) in ${folderPath}`);
    } catch {
      setNotice("Scan completed.");
    } finally {
      setScanning(false);
    }
  };

  const handleSaveAll = async () => {
    if (!config) return;
    setSaving(true);
    setNotice("");
    try {
      const res = await fetch("/api/ai/runtime", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save", config }),
      });
      const data = await res.json();
      if (data.config) setConfig(data.config);
      setNotice("Saved all AI engine, model, and behavioral settings.");
    } catch {
      setNotice("Failed to save settings.");
    } finally {
      setSaving(false);
    }
  };

  const handleSwitchSlot = async (slot: "chat" | "report" | "none") => {
    setSwitching(slot);
    setNotice(
      slot === "chat"
        ? "Stopping Report Engine & loading Strata (Qwen3.8-Flash-Next)..."
        : slot === "report"
        ? "Stopping Strata & loading KoboldCPP Report Engine..."
        : "Unloading model from GPU VRAM..."
    );
    try {
      const res = await fetch("/api/ai/runtime", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "switch", slot }),
      });
      const out = await res.json();
      if (out.config) setConfig(out.config);
      const dMsg = out.daemonResponse?.status || out.daemonResponse?.message || "Slot updated.";
      setNotice(`GPU Engine: ${slot.toUpperCase()} (${dMsg})`);
      void fetchConfig();
    } catch {
      setNotice("Failed to switch active engine.");
    } finally {
      setSwitching(null);
    }
  };

  if (loading || !config) {
    return (
      <Card className="border-border/70 bg-card p-6 text-center text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mx-auto mb-2 text-indigo-400" />
        Loading AI Engine &amp; Behavioral Coach Settings…
      </Card>
    );
  }

  const isChatActive = config.activeSlot === "chat";
  const isReportActive = config.activeSlot === "report";

  return (
    <Card className="border-border/70 bg-card">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 pb-3 border-b border-border/50">
        <div className="space-y-0.5">
          <CardTitle className="text-base font-bold flex items-center gap-2">
            <Cpu className="h-4 w-4 text-indigo-400" />
            <span>AI ENGINE &amp; BEHAVIORAL COACH SETTINGS</span>
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Start/stop your desktop GPU server remotely, select GGUF models, and configure independent persona settings.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={`text-xs font-mono px-3 py-1 ${
              isChatActive
                ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-400"
                : isReportActive
                ? "border-sky-500/50 bg-sky-500/10 text-sky-400"
                : "border-border text-muted-foreground"
            }`}
          >
            {isChatActive
              ? `🟢 ACTIVE: STRATA (${config.chatSlot.quantization} · ~40 tok/s)`
              : isReportActive
              ? "🔵 ACTIVE: KOBOLDCPP (REPORT ENGINE)"
              : "⚪ GPU IDLE (UNLOADED)"}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pt-4 text-xs">
        {/* ENGINE LAUNCHER & MODEL SELECTOR */}
        <div className="rounded-xl border border-border/70 bg-secondary/15 p-3.5 space-y-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 pb-2.5">
            <div className="flex items-center gap-1.5 rounded-lg bg-card border border-border p-1">
              <button
                type="button"
                onClick={() => setEngineTab("chat")}
                className={`rounded px-3 py-1 font-semibold text-xs transition flex items-center gap-1.5 ${
                  engineTab === "chat"
                    ? "bg-secondary text-foreground border border-border shadow-2xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Zap className="h-3.5 w-3.5 text-amber-400" />
                <span>Interactive Chat (Strata · Qwen3.8-Flash-Next)</span>
              </button>

              <button
                type="button"
                onClick={() => setEngineTab("report")}
                className={`rounded px-3 py-1 font-semibold text-xs transition flex items-center gap-1.5 ${
                  engineTab === "report"
                    ? "bg-secondary text-foreground border border-border shadow-2xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <FileText className="h-3.5 w-3.5 text-sky-400" />
                <span>Overnight Reports &amp; Audits (KoboldCPP)</span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              {engineTab === "chat" ? (
                <Button
                  size="sm"
                  variant={isChatActive ? "default" : "outline"}
                  disabled={switching !== null}
                  onClick={() => void handleSwitchSlot("chat")}
                  className="h-8 text-xs font-semibold"
                >
                  {switching === "chat" ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <Zap className="h-3.5 w-3.5 mr-1.5 text-amber-400" />
                  )}
                  {isChatActive ? "Reload Strata" : "Launch Strata Chat"}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant={isReportActive ? "default" : "outline"}
                  disabled={switching !== null}
                  onClick={() => void handleSwitchSlot("report")}
                  className="h-8 text-xs font-semibold"
                >
                  {switching === "report" ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <FileText className="h-3.5 w-3.5 mr-1.5 text-sky-400" />
                  )}
                  {isReportActive ? "Reload KoboldCPP" : "Launch Report Engine"}
                </Button>
              )}

              <Button
                size="sm"
                variant="ghost"
                disabled={switching !== null || config.activeSlot === "none"}
                onClick={() => void handleSwitchSlot("none")}
                className="h-8 text-xs text-muted-foreground hover:text-rose-400"
                title="Unload model from GPU VRAM"
              >
                <PowerOff className="h-3.5 w-3.5 mr-1" />
                Unload VRAM
              </Button>
            </div>
          </div>

          {/* CHAT TAB (STRATA) */}
          {engineTab === "chat" && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">Models Folder on Desktop</Label>
                  <div className="flex gap-1.5">
                    <Input
                      value={config.chatSlot.modelsFolder}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          chatSlot: { ...config.chatSlot, modelsFolder: e.target.value },
                        })
                      }
                      className="h-8 font-mono text-xs"
                      placeholder="~/models/qwen3.8-flash-next"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void handleScanFolder("chatSlot")}
                      disabled={scanning}
                      className="h-8 px-2.5 text-xs shrink-0"
                    >
                      <FolderOpen className="h-3.5 w-3.5 mr-1" />
                      {scanning ? "Scanning..." : "Scan Folder"}
                    </Button>
                  </div>
                </div>

                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">Active GGUF Model File</Label>
                  <select
                    value={config.chatSlot.activeModelFile || ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      const cmd = `strata serve --model ${config.chatSlot.modelsFolder}/${val} --port 8081 --ctx-size ${config.chatSlot.contextLength} --cache-type-k ${config.chatSlot.kvQuant} --cache-type-v ${config.chatSlot.kvQuant} --gpu-layers auto --vram-budget ${config.chatSlot.vramBudgetGb}`;
                      setConfig({
                        ...config,
                        chatSlot: {
                          ...config.chatSlot,
                          activeModelFile: val,
                          startCommand: cmd,
                        },
                      });
                    }}
                    className="h-8 w-full rounded-md border border-border bg-background px-2 font-mono text-xs font-semibold text-foreground"
                  >
                    {config.chatSlot.discoveredModels?.length ? (
                      config.chatSlot.discoveredModels.map((m: string) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))
                    ) : (
                      <option value={config.chatSlot.activeModelFile || ""}>
                        {config.chatSlot.activeModelFile || "Click Scan Folder after downloading"}
                      </option>
                    )}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5 pt-1">
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Target Quantization (~40 tok/s)</Label>
                  <select
                    value={config.chatSlot.quantization}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        chatSlot: { ...config.chatSlot, quantization: e.target.value },
                      })
                    }
                    className="h-7 w-full rounded border border-border bg-background px-1.5 font-mono text-xs"
                  >
                    {QUANT_OPTIONS.map((q) => (
                      <option key={q.value} value={q.value}>
                        {q.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Strata Sub-Bit KV Cache</Label>
                  <select
                    value={config.chatSlot.kvQuant}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        chatSlot: { ...config.chatSlot, kvQuant: e.target.value },
                      })
                    }
                    className="h-7 w-full rounded border border-border bg-background px-1.5 font-mono text-xs"
                  >
                    <option value="tq3_5s">tq3_5s (3.5-bit · Best Precision)</option>
                    <option value="tq3_0">tq3_0 (3.0-bit · Balanced)</option>
                    <option value="q8_0">q8_0 (8-bit · Standard)</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">VRAM Budget (GB)</Label>
                  <Input
                    type="number"
                    step="0.5"
                    value={config.chatSlot.vramBudgetGb}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        chatSlot: { ...config.chatSlot, vramBudgetGb: Number(e.target.value) || 10.5 },
                      })
                    }
                    className="h-7 font-mono text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Context Length (Tokens)</Label>
                  <Input
                    type="number"
                    step="4096"
                    value={config.chatSlot.contextLength}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        chatSlot: { ...config.chatSlot, contextLength: Number(e.target.value) || 32768 },
                      })
                    }
                    className="h-7 font-mono text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
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
                    className="h-7 font-mono text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Desktop Launch Command</Label>
                  <Input
                    value={config.chatSlot.startCommand}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        chatSlot: { ...config.chatSlot, startCommand: e.target.value },
                      })
                    }
                    className="h-7 font-mono text-[11px]"
                  />
                </div>
              </div>
            </div>
          )}

          {/* REPORT TAB (KOBOLDCPP) */}
          {engineTab === "report" && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">Models Folder on Desktop</Label>
                  <div className="flex gap-1.5">
                    <Input
                      value={config.reportSlot.modelsFolder}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          reportSlot: { ...config.reportSlot, modelsFolder: e.target.value },
                        })
                      }
                      className="h-8 font-mono text-xs"
                      placeholder="~/koboldcpp/models"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void handleScanFolder("reportSlot")}
                      disabled={scanning}
                      className="h-8 px-2.5 text-xs shrink-0"
                    >
                      <FolderOpen className="h-3.5 w-3.5 mr-1" />
                      {scanning ? "Scanning..." : "Scan Folder"}
                    </Button>
                  </div>
                </div>

                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">Active GGUF Model File</Label>
                  <select
                    value={config.reportSlot.activeModelFile || ""}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        reportSlot: { ...config.reportSlot, activeModelFile: e.target.value },
                      })
                    }
                    className="h-8 w-full rounded-md border border-border bg-background px-2 font-mono text-xs font-semibold text-foreground"
                  >
                    {config.reportSlot.discoveredModels?.length ? (
                      config.reportSlot.discoveredModels.map((m: string) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))
                    ) : (
                      <option value={config.reportSlot.activeModelFile}>
                        {config.reportSlot.activeModelFile}
                      </option>
                    )}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">
                    GPU Layers (VRAM Offload): {config.reportSlot.gpuLayers || 30} / 64
                  </Label>
                  <input
                    type="range"
                    min={0}
                    max={64}
                    value={config.reportSlot.gpuLayers || 30}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        reportSlot: { ...config.reportSlot, gpuLayers: Number(e.target.value) },
                      })
                    }
                    className="w-full accent-sky-500 cursor-pointer"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">KV Cache &amp; Flash Attn</Label>
                  <select
                    value={config.reportSlot.kvCacheQuant || "Q8_0"}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        reportSlot: { ...config.reportSlot, kvCacheQuant: e.target.value },
                      })
                    }
                    className="h-7 w-full rounded border border-border bg-background px-1.5 font-mono text-xs"
                  >
                    <option value="Q8_0">Q8_0 KV (Recommended)</option>
                    <option value="Q4_0">Q4_0 KV (Max Memory Fit)</option>
                    <option value="F16">F16 KV (Full Precision)</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">KoboldCPP Endpoint URL</Label>
                  <Input
                    value={config.reportSlot.endpointUrl}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        reportSlot: { ...config.reportSlot, endpointUrl: e.target.value },
                      })
                    }
                    className="h-7 font-mono text-xs"
                  />
                </div>
              </div>
            </div>
          )}

          {/* LIFECYCLE, AUTO-UNLOAD & ORCHESTRATOR OPTIONS */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/40 pt-3 text-[11px]">
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer font-medium text-foreground">
                <input
                  type="checkbox"
                  checked={Boolean(config.autoSwitchOnDemand)}
                  onChange={(e) =>
                    setConfig({ ...config, autoSwitchOnDemand: e.target.checked })
                  }
                  className="h-3.5 w-3.5 accent-indigo-500"
                />
                <span>Auto-switch engine on demand (Unload inactive model before loading)</span>
              </label>

              <div className="flex items-center gap-1.5 text-muted-foreground">
                <span>Auto-unload after</span>
                <input
                  type="number"
                  min={5}
                  max={240}
                  value={config.idleUnloadMinutes || 30}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      idleUnloadMinutes: Number(e.target.value) || 30,
                    })
                  }
                  className="w-12 rounded border border-border bg-background px-1 py-0.5 text-center font-mono text-xs text-foreground"
                />
                <span>mins idle</span>
              </div>
            </div>

            <Button
              size="sm"
              onClick={() => void handleSaveAll()}
              disabled={saving}
              className="h-7 text-xs font-semibold ml-auto"
            >
              <Save className="h-3.5 w-3.5 mr-1" />
              {saving ? "Saving..." : "Save AI Settings"}
            </Button>
          </div>
        </div>

        {notice && (
          <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-2 text-xs text-indigo-300 flex items-center gap-2">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            <span>{notice}</span>
          </div>
        )}

        {/* BEHAVIORAL COACH PERSONA & PROMPT TEMPLATE */}
        <div className="rounded-xl border border-border/70 bg-card p-3.5 space-y-3">
          <div className="flex items-center justify-between border-b border-border/50 pb-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPersonaTab("coach")}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                  personaTab === "coach"
                    ? "bg-secondary text-foreground border border-border"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Longitudinal Behavioral Coach
              </button>
              <button
                type="button"
                onClick={() => setPersonaTab("journal")}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                  personaTab === "journal"
                    ? "bg-secondary text-foreground border border-border"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                General Journal (Recaps &amp; Critiques)
              </button>
            </div>

            <div className="flex items-center gap-4 text-xs font-mono">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-muted-foreground">Temp:</span>
                <input
                  type="number"
                  step="0.05"
                  min="0"
                  max="1"
                  value={temperature}
                  onChange={(e) => setTemperature(Number(e.target.value) || 0)}
                  className="w-12 rounded border border-border bg-background px-1 py-0.5 text-center text-xs"
                />
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-muted-foreground">Top-P:</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="1"
                  value={topP}
                  onChange={(e) => setTopP(Number(e.target.value) || 0.05)}
                  className="w-12 rounded border border-border bg-background px-1 py-0.5 text-center text-xs"
                />
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[11px] font-semibold text-foreground">
              Behavioral Coach Persona &amp; Prompt Template
            </Label>
            <textarea
              rows={5}
              value={coachPrompt}
              onChange={(e) => setCoachPrompt(e.target.value)}
              className="w-full rounded-lg border border-border bg-background p-2.5 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
