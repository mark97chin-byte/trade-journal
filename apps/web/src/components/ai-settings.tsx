"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  AI_DEFAULT_MODELS,
  AI_PROVIDER_NAMES,
  AI_PROVIDERS,
  type AiProvider,
  type AiSettingsPayload,
} from "@/lib/ai-settings";
import { postJson, useApi } from "@/lib/use-api";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { OptionSelect } from "./ui/option-select";
import {
  Cpu,
  Sparkles,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  RotateCcw,
  FolderOpen,
  Brain,
  FileText,
  Play,
  Square,
  Terminal,
  Zap,
  Clock,
} from "lucide-react";

interface PersonaConfig {
  contextSize: number;
  maxOutputTokens: number;
  temperature: number;
  topP: number;
  systemPrompt: string;
}

interface StrataChatSlotConfig {
  modelsDir: string;
  activeModelFile: string;
  quantKv: string;
  vramBudgetGb: number;
  contextSize: number;
  gpuLayers: number;
  binaryPath: string;
}

interface LocalAiSettingsPayload {
  mode: "local_kobold" | "cloud";
  activeEngineSlot?: "strata_chat" | "kobold_report";
  autoSwitchOnDemand?: boolean;
  idleUnloadMinutes?: number;
  baseUrl: string;
  modelsDir: string;
  activeModelFile: string;
  strataChat?: StrataChatSlotConfig;
  general: PersonaConfig;
  coach: PersonaConfig;
}

interface DaemonHardwareState {
  engineType: "strata_chat" | "kobold_report";
  gpuLayers: number;
  contextSize: number;
  quantKv: string;
  vramBudgetGb: number;
  flashAttention: boolean;
  useMtp: boolean;
  idleUnloadMinutes: number;
  autoSwitchOnDemand: boolean;
}

const DEFAULT_GENERAL_PROMPT = `You are the reflection layer of a trader's journal.
You see only the trader's own recorded data — trades, stats, and notes. Ground every statement in those numbers; never invent trades, prices, or market context you weren't given.
Be direct and specific like a good trading coach: name the behavior, cite the numbers, say what to keep and what to fix. No platitudes, no disclaimers about trading being risky — the trader knows. Keep it tight.`;

const DEFAULT_COACH_PROMPT = `You are a longitudinal trading psychology and behavioral performance analyst.
You do NOT evaluate the trader's technical chart model. Your job is to connect the chain of thought across multiple Daily, Weekly, Monthly, and Quarterly journals—especially their End-of-Period Reviews and self-reflection Quote blocks—and correlate their own words with their hard execution telemetry.
Hold the trader strictly accountable to their active process goals without judgment.`;

export function AiSettings() {
  const { data, refresh } = useApi<AiSettingsPayload & { localAi?: LocalAiSettingsPayload }>("/api/settings");

  const [activePersonaTab, setActivePersonaTab] = useState<"general" | "coach">("coach");
  const [selectedSlot, setSelectedSlot] = useState<"strata_chat" | "kobold_report">("strata_chat");

  const [localSettings, setLocalSettings] = useState<LocalAiSettingsPayload>({
    mode: "local_kobold",
    activeEngineSlot: "strata_chat",
    autoSwitchOnDemand: true,
    idleUnloadMinutes: 30,
    baseUrl: "http://100.75.201.34:5001",
    modelsDir: "~/koboldcpp/models/",
    activeModelFile: "Qwen3.8-27B-Q4_K_M.gguf",
    strataChat: {
      modelsDir: "/run/media/mark/Storage 2/AI Models/",
      activeModelFile: "Qwen3.8-Flash-Next-GSQ-RCO-IQ3_S-00001-of-00002.gguf",
      quantKv: "int8",
      vramBudgetGb: 10.5,
      contextSize: 32768,
      gpuLayers: 99,
      binaryPath: "strata",
    },
    general: {
      contextSize: 16384,
      maxOutputTokens: 2048,
      temperature: 0.4,
      topP: 0.90,
      systemPrompt: DEFAULT_GENERAL_PROMPT,
    },
    coach: {
      contextSize: 32768,
      maxOutputTokens: 6144,
      temperature: 0.6,
      topP: 0.95,
      systemPrompt: DEFAULT_COACH_PROMPT,
    },
  });

  const [hwState, setHwState] = useState<DaemonHardwareState>({
    engineType: "strata_chat",
    gpuLayers: 30,
    contextSize: 32768,
    quantKv: "q8_0",
    vramBudgetGb: 10.5,
    flashAttention: true,
    useMtp: false,
    idleUnloadMinutes: 30,
    autoSwitchOnDemand: true,
  });

  const [discoveredModels, setDiscoveredModels] = useState<
    Array<{ name: string; sizeMb: number; shards?: number }>
  >([]);
  const [scanningDir, setScanningDir] = useState(false);
  const [scanMessage, setScanMessage] = useState("");

  const [serverStatus, setServerStatus] = useState<{
    daemonOnline: boolean;
    online: boolean;
    loading: boolean;
    processRunning: boolean;
    activeEngine: string;
    model: string;
    logTail: string;
  }>({
    daemonOnline: false,
    online: false,
    loading: false,
    processRunning: false,
    activeEngine: "",
    model: "",
    logTail: "",
  });

  const [controllingServer, setControllingServer] = useState(false);
  const [showLogs, setShowLogs] = useState(false);

  const [provider, setProvider] = useState<AiProvider>("anthropic");
  const [model, setModel] = useState(AI_DEFAULT_MODELS.anthropic);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ error?: string; success?: string }>({});

  useEffect(() => {
    if (!data) return;
    setProvider(data.aiProvider);
    setModel(data.aiModel);
    if (data.localAi) {
      const slot = data.localAi.activeEngineSlot || "strata_chat";
      setSelectedSlot(slot);
      setLocalSettings((prev) => ({
        ...prev,
        ...data.localAi,
        strataChat: { ...prev.strataChat!, ...(data.localAi?.strataChat || {}) },
        general: { ...prev.general, ...(data.localAi?.general || {}) },
        coach: { ...prev.coach, ...(data.localAi?.coach || {}) },
      }));
    }
  }, [data]);

  const currentSlotFolder =
    selectedSlot === "strata_chat"
      ? localSettings.strataChat?.modelsDir || "/run/media/mark/Storage 2/AI Models/"
      : localSettings.modelsDir || "~/koboldcpp/models/";

  const currentSlotModel =
    selectedSlot === "strata_chat"
      ? localSettings.strataChat?.activeModelFile || ""
      : localSettings.activeModelFile || "";

  const syncWithDesktopDaemon = useCallback(
    async (dirToScan?: string, customBaseUrl?: string) => {
      setScanningDir(true);
      const targetFolder = dirToScan ?? currentSlotFolder;
      try {
        const res = await fetch("/api/ai/coach", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "scan_models",
            engineType: selectedSlot,
            dir: targetFolder,
            baseUrl: customBaseUrl || localSettings.baseUrl,
          }),
        });
        const json = await res.json();
        if (json.ok) {
          if (Array.isArray(json.models)) {
            setDiscoveredModels(json.models);
            const shardNote = json.models.some((m: any) => m.shards && m.shards > 1)
              ? " (multi-part shards grouped automatically)"
              : "";
            setScanMessage(
              json.models.length > 0
                ? `Discovered ${json.models.length} .gguf model${json.models.length === 1 ? "" : "s"} in ${targetFolder}${shardNote}`
                : `No .gguf files found in ${targetFolder}`
            );
            if (json.models.length > 0) {
              const firstModel = json.models[0].name;
              if (selectedSlot === "strata_chat") {
                const cur = localSettings.strataChat?.activeModelFile || "";
                if (!json.models.some((m: any) => m.name === cur)) {
                  setLocalSettings((prev) => ({
                    ...prev,
                    strataChat: { ...prev.strataChat!, activeModelFile: firstModel },
                  }));
                }
              } else {
                const cur = localSettings.activeModelFile || "";
                if (!json.models.some((m: any) => m.name === cur)) {
                  setLocalSettings((prev) => ({ ...prev, activeModelFile: firstModel }));
                }
              }
            }
          }
          if (json.daemonState) {
            if (json.daemonState.strataModelsDir && !dirToScan) {
              setLocalSettings((prev) => ({
                ...prev,
                strataChat: { ...prev.strataChat!, modelsDir: json.daemonState.strataModelsDir },
              }));
            }
            if (json.daemonState.modelsDir && !String(json.daemonState.modelsDir).includes("Storage 2") && !dirToScan) {
              setLocalSettings((prev) => ({
                ...prev,
                modelsDir: json.daemonState.modelsDir,
              }));
            }
            const rawGl = Number(json.daemonState.gpuLayers ?? 30);
            const safeGl = rawGl > 64 || rawGl <= 0 ? 30 : rawGl;
            const rawKv = String(json.daemonState.quantKv || "q8_0").toLowerCase();
            const safeKv = ["q8_0", "q4_0", "f16"].includes(rawKv) ? rawKv : "q8_0";
            setHwState((prev) => ({
              ...prev,
              gpuLayers: safeGl,
              contextSize: json.daemonState.contextSize ?? prev.contextSize,
              quantKv: safeKv,
              vramBudgetGb: json.daemonState.vramBudgetGb ?? prev.vramBudgetGb,
              flashAttention: json.daemonState.flashAttention ?? prev.flashAttention,
              useMtp: json.daemonState.useMtp ?? prev.useMtp,
              idleUnloadMinutes: json.daemonState.idleUnloadMinutes ?? prev.idleUnloadMinutes,
            }));
          }
          setServerStatus({
            daemonOnline: Boolean(json.daemonOnline),
            online: Boolean(json.online),
            loading: Boolean(json.loading),
            processRunning: Boolean(json.processRunning),
            activeEngine: json.runningSlot || json.daemonState?.engineType || "",
            model: json.loadedModel || currentSlotModel,
            logTail: json.logTail || "",
          });
        }
      } catch {
        setScanMessage("Could not reach desktop daemon.");
      } finally {
        setScanningDir(false);
      }
    },
    [currentSlotFolder, localSettings.baseUrl, currentSlotModel, selectedSlot, localSettings.strataChat, localSettings.activeModelFile]
  );

  useEffect(() => {
    void syncWithDesktopDaemon(currentSlotFolder);
  }, [selectedSlot]);

  useEffect(() => {
    if (!serverStatus.loading && !controllingServer) return;
    const t = setInterval(() => {
      void syncWithDesktopDaemon();
    }, 3000);
    return () => clearInterval(t);
  }, [serverStatus.loading, controllingServer, syncWithDesktopDaemon]);

  const handleRemoteControl = async (
    command: "start" | "stop",
    slotOverride?: "strata_chat" | "kobold_report"
  ) => {
    const targetSlot = slotOverride || selectedSlot;
    if (command === "start" && (serverStatus.online || serverStatus.processRunning)) {
      const activeEng = serverStatus.activeEngine;
      if (activeEng && activeEng !== "none" && activeEng !== targetSlot) {
        const fromLabel =
          activeEng === "strata_chat"
            ? "Slot 1 · Strata (Qwen3.8-Flash-Next)"
            : "Slot 2 · KoboldCPP (Report Engine)";
        const toLabel =
          targetSlot === "strata_chat"
            ? "Slot 1 · Strata (Qwen3.8-Flash-Next)"
            : "Slot 2 · KoboldCPP (Report Engine)";
        const ok = window.confirm(
          `GPU Slot Switch Confirmation:

Currently running: ${fromLabel}
Switch to: ${toLabel}

This will unload ${fromLabel} from VRAM first. Click OK to switch, or Cancel to abort.`
        );
        if (!ok) return;
      }
    }
    setControllingServer(true);
    setFeedback({});

    const isStrata = targetSlot === "strata_chat";
    const folder = isStrata
      ? localSettings.strataChat?.modelsDir || "/run/media/mark/Storage 2/AI Models/"
      : localSettings.modelsDir;
    const modelFile = isStrata
      ? localSettings.strataChat?.activeModelFile || ""
      : localSettings.activeModelFile;

    try {
      const res = await fetch("/api/ai/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "control_kobold",
          command,
          baseUrl: localSettings.baseUrl,
          launchState: {
            engineType: targetSlot,
            modelsDir: folder,
            modelFile,
            gpuLayers: isStrata ? 30 : (hwState.gpuLayers > 64 ? 30 : hwState.gpuLayers),
            contextSize: isStrata
              ? (localSettings.strataChat?.contextSize ?? 32768)
              : hwState.contextSize,
            quantKv: isStrata ? (localSettings.strataChat?.quantKv ?? "tq3_5s") : hwState.quantKv,
            vramBudgetGb: localSettings.strataChat?.vramBudgetGb ?? 10.5,
            flashAttention: hwState.flashAttention,
            useMtp: hwState.useMtp,
            idleUnloadMinutes: localSettings.idleUnloadMinutes ?? 30,
            autoSwitchOnDemand: localSettings.autoSwitchOnDemand ?? true,
          },
        }),
      });
      const json = await res.json();
      if (json.ok) {
        setFeedback({
          success:
            command === "start"
              ? isStrata
                ? `Unloaded Report Engine & starting Strata (${modelFile}) with ${localSettings.strataChat?.quantKv || "tq3_5s"} KV cache...`
                : `Unloaded Strata & starting KoboldCPP Report Engine (${modelFile})...`
              : "Unloaded active model from Desktop GPU VRAM.",
        });
        setTimeout(() => void syncWithDesktopDaemon(folder), 1500);
      } else {
        setFeedback({ error: json.error || "Remote control command failed." });
      }
    } catch (e: any) {
      setFeedback({ error: e?.message || "Failed to contact desktop daemon." });
    } finally {
      setControllingServer(false);
    }
  };

  const handleSelectModel = async (fileName: string) => {
    if (selectedSlot === "strata_chat") {
      setLocalSettings((prev) => ({
        ...prev,
        strataChat: { ...prev.strataChat!, activeModelFile: fileName },
      }));
    } else {
      setLocalSettings((prev) => ({ ...prev, activeModelFile: fileName }));
    }
    try {
      await fetch("/api/ai/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set_active_model",
          modelFile: fileName,
          engineType: selectedSlot,
        }),
      });
    } catch {}
  };

  const handleSaveAll = async () => {
    setBusy(true);
    setFeedback({});
    try {
      await postJson(
        "/api/settings",
        {
          localAi: {
            ...localSettings,
            activeEngineSlot: selectedSlot,
          },
          aiProvider: provider,
          aiModel: model.trim(),
          ...(apiKey.trim() ? { [`${provider}Key`]: apiKey.trim() } : {}),
        },
        "PATCH"
      );
      setApiKey("");
      setFeedback({ success: "AI Engine, On-Demand Orchestrator & Persona settings saved." });
      refresh();
    } catch (err: any) {
      setFeedback({ error: err?.message || "Failed to save AI configuration." });
    } finally {
      setBusy(false);
    }
  };

  const curPersona = activePersonaTab === "general" ? localSettings.general : localSettings.coach;

  const updateCurrentPersona = (patch: Partial<PersonaConfig>) => {
    setLocalSettings((prev) => ({
      ...prev,
      [activePersonaTab]: {
        ...prev[activePersonaTab],
        ...patch,
      },
    }));
  };

  return (
    <Card id="ai-settings" className="scroll-mt-24 border-border/70 bg-[#12141d]">
      <CardHeader className="border-b border-border/40 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-500/15 border border-indigo-500/30">
              <Cpu className="h-4.5 w-4.5 text-indigo-400" />
            </div>
            <div>
              <CardTitle className="text-base font-bold text-foreground">
                AI Engine &amp; Behavioral Coach Settings
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                On-demand mutual-exclusion GPU launcher (Strata Chat vs. KoboldCPP Reports), sharded GGUF selector, and persona tuning.
              </p>
            </div>
          </div>

          <div className="flex items-center rounded-xl bg-[#0d0f14] p-1 border border-border/60 text-xs">
            <button
              type="button"
              onClick={() => setLocalSettings((prev) => ({ ...prev, mode: "local_kobold" }))}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1 font-semibold transition ${
                localSettings.mode === "local_kobold"
                  ? "bg-secondary text-foreground border border-border shadow"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Cpu className="h-3.5 w-3.5 text-indigo-400" />
              <span>Local Desktop GPU</span>
            </button>
            <button
              type="button"
              onClick={() => setLocalSettings((prev) => ({ ...prev, mode: "cloud" }))}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1 font-semibold transition ${
                localSettings.mode === "cloud"
                  ? "bg-secondary text-foreground border border-border shadow"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Sparkles className="h-3.5 w-3.5 text-amber-400" />
              <span>Cloud API (BYOK)</span>
            </button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5 pt-5 text-xs">
        {feedback.error && (
          <p role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/15 px-3 py-2 text-rose-300">
            {feedback.error}
          </p>
        )}
        {feedback.success && (
          <p role="status" className="rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-2 text-emerald-300">
            {feedback.success}
          </p>
        )}

        {localSettings.mode === "local_kobold" && (
          <div className="space-y-4 rounded-xl border border-indigo-500/25 bg-[#0d0f14] p-4">
            {/* TOP CONTROL ROW: STATUS BADGE + START / STOP / LOGS */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 pb-3">
              <div className="flex flex-wrap items-center gap-2">
                <FolderOpen className="h-4 w-4 text-indigo-400" />
                <span className="font-bold text-foreground">
                  Desktop GPU Server &amp; On-Demand Model Orchestrator
                </span>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
                    serverStatus.online
                      ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                      : serverStatus.loading
                      ? "border-amber-500/40 bg-amber-500/15 text-amber-300 animate-pulse"
                      : "border-rose-500/40 bg-rose-500/15 text-rose-300"
                  }`}
                >
                  {serverStatus.online ? (
                    <>
                      <CheckCircle2 className="h-3 w-3" />
                      <span>
                        Online ({serverStatus.activeEngine === "strata_chat" ? "Strata" : "KoboldCPP"}) · {serverStatus.model}
                      </span>
                    </>
                  ) : serverStatus.loading ? (
                    <>
                      <RefreshCw className="h-3 w-3 animate-spin" />
                      <span>Loading Tensors into VRAM...</span>
                    </>
                  ) : (
                    <>
                      <AlertCircle className="h-3 w-3" />
                      <span>GPU Idle (Unloaded)</span>
                    </>
                  )}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  disabled={controllingServer}
                  onClick={() => void handleRemoteControl("start", selectedSlot)}
                  className="h-7 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold"
                >
                  <Play className="mr-1 h-3 w-3 fill-current" />
                  {selectedSlot === "strata_chat"
                    ? "Load Strata Chat Model"
                    : "Load KoboldCPP Report Model"}
                </Button>

                {(serverStatus.online || serverStatus.processRunning) && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={controllingServer}
                    onClick={() => void handleRemoteControl("stop")}
                    className="h-7 border-rose-500/40 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 text-xs"
                  >
                    <Square className="mr-1 h-3 w-3 fill-current" />
                    Unload GPU VRAM
                  </Button>
                )}

                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={scanningDir}
                  onClick={() => void syncWithDesktopDaemon(currentSlotFolder)}
                  className="h-7 text-xs"
                >
                  <RefreshCw className={`mr-1 h-3 w-3 ${scanningDir ? "animate-spin" : ""}`} />
                  Refresh Status
                </Button>

                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowLogs((v) => !v)}
                  className="h-7 text-xs text-muted-foreground hover:text-foreground"
                >
                  <Terminal className="mr-1 h-3.5 w-3.5" />
                  Logs
                </Button>
              </div>
            </div>

            {/* DUAL-SLOT ENGINE SELECTOR TABS (MUTUAL EXCLUSION) */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-[#141722] p-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setSelectedSlot("strata_chat")}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                    selectedSlot === "strata_chat"
                      ? "bg-indigo-600 text-white shadow"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary/40"
                  }`}
                >
                  <Zap className="h-3.5 w-3.5 text-amber-300" />
                  <span>Slot 1 · Interactive Chat (Strata · Qwen3.8-Flash-Next)</span>
                </button>

                <button
                  type="button"
                  onClick={() => setSelectedSlot("kobold_report")}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                    selectedSlot === "kobold_report"
                      ? "bg-indigo-600 text-white shadow"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary/40"
                  }`}
                >
                  <FileText className="h-3.5 w-3.5 text-sky-300" />
                  <span>Slot 2 · Reports &amp; Audits (KoboldCPP · Original Setup)</span>
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-4 px-2 text-[11px]">
                <label className="flex items-center gap-1.5 cursor-pointer text-foreground font-medium">
                  <input
                    type="checkbox"
                    checked={localSettings.autoSwitchOnDemand ?? true}
                    onChange={(e) =>
                      setLocalSettings((prev) => ({
                        ...prev,
                        autoSwitchOnDemand: e.target.checked,
                      }))
                    }
                    className="accent-indigo-500 h-3.5 w-3.5"
                  />
                  <span>Auto-load on demand (Never run both at once)</span>
                </label>

                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Clock className="h-3.5 w-3.5 text-indigo-400" />
                  <span>Auto-unload after</span>
                  <input
                    type="number"
                    min={5}
                    max={240}
                    value={localSettings.idleUnloadMinutes ?? 30}
                    onChange={(e) =>
                      setLocalSettings((prev) => ({
                        ...prev,
                        idleUnloadMinutes: Math.max(5, Number(e.target.value) || 30),
                      }))
                    }
                    className="w-12 rounded border border-border bg-[#0d0f14] px-1.5 py-0.5 text-center font-mono text-xs text-foreground"
                  />
                  <span>mins idle</span>
                </div>
              </div>
            </div>

            {showLogs && (
              <div className="rounded-lg border border-border/60 bg-black/80 p-3 font-mono text-[10px] text-emerald-300 max-h-48 overflow-y-auto whitespace-pre-wrap">
                {serverStatus.logTail || "No console output yet. Click 'Load Model' above."}
              </div>
            )}

            {/* FOLDER & ENDPOINT CONFIGURATION FOR SELECTED SLOT */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="kobold-url">Desktop Endpoint URL</Label>
                <Input
                  id="kobold-url"
                  value={localSettings.baseUrl}
                  onChange={(e) =>
                    setLocalSettings((prev) => ({ ...prev, baseUrl: e.target.value }))
                  }
                  placeholder="http://100.75.201.34:5001"
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="models-dir">
                  {selectedSlot === "strata_chat"
                    ? "Strata Models / Shards Folder on Desktop"
                    : "KoboldCPP Models Folder on Desktop"}
                </Label>
                <div className="flex items-center gap-1.5">
                  <Input
                    id="models-dir"
                    value={currentSlotFolder}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (selectedSlot === "strata_chat") {
                        setLocalSettings((prev) => ({
                          ...prev,
                          strataChat: { ...prev.strataChat!, modelsDir: val },
                        }));
                      } else {
                        setLocalSettings((prev) => ({ ...prev, modelsDir: val }));
                      }
                    }}
                    placeholder={
                      selectedSlot === "strata_chat"
                        ? "~/koboldcpp/models/IQ3_S"
                        : "~/koboldcpp/models"
                    }
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={scanningDir}
                    onClick={() => void syncWithDesktopDaemon(currentSlotFolder)}
                    className="h-9 px-3 shrink-0"
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                    <span className="ml-1.5">{scanningDir ? "Scanning..." : "Scan Folder"}</span>
                  </Button>
                </div>
                {scanMessage && (
                  <p className="text-[10px] text-indigo-300 font-medium">{scanMessage}</p>
                )}
              </div>
            </div>

            {/* ACTIVE GGUF MODEL FILE + SLOT-SPECIFIC HARDWARE PARAMETERS */}
            <div className="grid gap-3 sm:grid-cols-4 pt-2 border-t border-border/30">
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="active-model-select">
                  {selectedSlot === "strata_chat"
                    ? "Active Strata GGUF Model / First Shard (-00001-of-0000N.gguf)"
                    : "Active KoboldCPP Report GGUF Model File"}
                </Label>
                {discoveredModels.length > 0 ? (
                  <select
                    id="active-model-select"
                    value={currentSlotModel}
                    onChange={(e) => void handleSelectModel(e.target.value)}
                    className="h-9 w-full rounded-lg border border-border/70 bg-[#141722] px-3 text-xs text-foreground outline-none focus:border-indigo-500 font-mono"
                  >
                    {discoveredModels.map((m) => {
                      const sizeLabel =
                        m.sizeMb >= 1024
                          ? `${(m.sizeMb / 1024).toFixed(1)} GB`
                          : `${m.sizeMb} MB`;
                      const shardTag =
                        m.shards && m.shards > 1 ? ` [${m.shards} shards · ${sizeLabel}]` : ` (${sizeLabel})`;
                      return (
                        <option key={m.name} value={m.name}>
                          {m.name}
                          {m.sizeMb > 0 ? shardTag : ""}
                        </option>
                      );
                    })}
                  </select>
                ) : (
                  <Input
                    id="active-model-select"
                    value={currentSlotModel}
                    onChange={(e) => void handleSelectModel(e.target.value)}
                    placeholder={
                      selectedSlot === "strata_chat"
                        ? "Qwen3.8-Flash-Next-GSQ-RCO-IQ3_S-00001-of-00005.gguf"
                        : "Qwen3.8-27B-Q4_K_M.gguf"
                    }
                  />
                )}
                <p className="text-[10px] text-muted-foreground">
                  {selectedSlot === "strata_chat"
                    ? "Sharded GGUFs automatically group by their 00001 shard and load all parts together."
                    : "Choose any GGUF in your desktop folder for overnight reports & audits."}
                </p>
              </div>

              {selectedSlot === "strata_chat" ? (
                <>
                  <div className="space-y-1">
                    <div className="flex justify-between">
                      <Label>VRAM Budget (RTX 4070S)</Label>
                      <span className="font-mono text-amber-300 font-bold">
                        {localSettings.strataChat?.vramBudgetGb ?? 10.5} / 12 GB
                      </span>
                    </div>
                    <input
                      type="range"
                      min="6"
                      max="11.5"
                      step="0.5"
                      value={localSettings.strataChat?.vramBudgetGb ?? 10.5}
                      onChange={(e) =>
                        setLocalSettings((prev) => ({
                          ...prev,
                          strataChat: {
                            ...prev.strataChat!,
                            vramBudgetGb: Number(e.target.value),
                          },
                        }))
                      }
                      className="w-full accent-indigo-500 mt-1.5"
                    />
                    <p className="text-[10px] text-muted-foreground">
                      Pins hot routers in 12GB VRAM, streams cold experts from 64GB RAM.
                    </p>
                  </div>

                  <div className="space-y-1">
                    <Label>Strata TurboQuant KV Cache</Label>
                    <OptionSelect
                      value={
                        ["int8", "k8v4", "q4_0"].includes(localSettings.strataChat?.quantKv || "")
                          ? localSettings.strataChat!.quantKv
                          : "int8"
                      }
                      onValueChange={(v) =>
                        setLocalSettings((prev) => ({
                          ...prev,
                          strataChat: { ...prev.strataChat!, quantKv: v },
                        }))
                      }
                    >
                      <option value="int8">int8 (8-bit KV · Best Intelligence &amp; Speed)</option>
                      <option value="k8v4">k8v4 (8-bit K / 4-bit V · More Experts in VRAM)</option>
                      <option value="q4_0">q4_0 (4-bit Hadamard · Max Context Save)</option>
                    </OptionSelect>
                    <p className="text-[10px] text-muted-foreground pt-0.5">
                      Sub-bit KV cache (~40 tok/s with ISTA-DASLab IQ3_S).
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-1">
                    <div className="flex justify-between">
                      <Label>GPU Layers (VRAM)</Label>
                      <span className="font-mono text-indigo-300 font-bold">
                        {hwState.gpuLayers} / 64
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="65"
                      step="1"
                      value={hwState.gpuLayers}
                      onChange={(e) =>
                        setHwState((prev) => ({ ...prev, gpuLayers: Number(e.target.value) }))
                      }
                      className="w-full accent-indigo-500 mt-1.5"
                    />
                    <p className="text-[10px] text-muted-foreground">
                      28–32 fits 12GB VRAM cleanly with 32K ctx.
                    </p>
                  </div>

                  <div className="space-y-1">
                    <Label>KV Cache &amp; Flash Attn</Label>
                    <div className="flex items-center gap-1.5">
                      <OptionSelect
                        value={hwState.quantKv}
                        onValueChange={(v) => setHwState((prev) => ({ ...prev, quantKv: v }))}
                      >
                        <option value="q8_0">Q8_0 KV (Recommended)</option>
                        <option value="q4_0">Q4_0 KV (Max VRAM Save)</option>
                        <option value="f16">FP16 KV (Uncompressed)</option>
                      </OptionSelect>
                    </div>
                    <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground pt-0.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={hwState.flashAttention}
                        onChange={(e) =>
                          setHwState((prev) => ({ ...prev, flashAttention: e.target.checked }))
                        }
                        className="accent-indigo-500"
                      />
                      <span>Enable Flash Attention</span>
                    </label>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* PERSONA TUNING TABS */}
        <div className="rounded-xl border border-border/60 bg-[#0d0f14] overflow-hidden">
          <div className="flex items-center justify-between border-b border-border/40 bg-[#161925] px-4 py-2.5">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setActivePersonaTab("coach")}
                className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                  activePersonaTab === "coach"
                    ? "bg-indigo-600 text-white shadow"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/40"
                }`}
              >
                <Brain className="h-3.5 w-3.5" />
                <span>Longitudinal Behavioral Coach (Uses Slot 2 · Reports)</span>
              </button>
              <button
                type="button"
                onClick={() => setActivePersonaTab("general")}
                className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                  activePersonaTab === "general"
                    ? "bg-indigo-600 text-white shadow"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/40"
                }`}
              >
                <FileText className="h-3.5 w-3.5" />
                <span>Interactive Chat &amp; Recaps (Uses Slot 1 · Strata)</span>
              </button>
            </div>
          </div>

          <div className="p-4 space-y-4">
            <div className="grid gap-4 sm:grid-cols-3 items-center">
              <div className="rounded-lg border border-indigo-500/25 bg-indigo-950/15 px-3 py-2 text-[11px] text-indigo-200">
                <div className="font-bold text-indigo-300">Unified Token &amp; Reasoning Control</div>
                <div className="text-muted-foreground mt-0.5">
                  Server Context is fixed at <strong>{hwState.contextSize.toLocaleString()} tokens</strong>. Output budgets (8K Fast / 12K Balanced / 16K Deep) are selected directly in the <strong>Progress</strong> tab.
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex justify-between">
                  <Label>Temperature</Label>
                  <span className="font-mono text-muted-foreground">{curPersona.temperature}</span>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="1.0"
                  step="0.05"
                  value={curPersona.temperature}
                  onChange={(e) => updateCurrentPersona({ temperature: parseFloat(e.target.value) })}
                  className="w-full accent-indigo-500"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between">
                  <Label>Top-P</Label>
                  <span className="font-mono text-muted-foreground">{curPersona.topP}</span>
                </div>
                <input
                  type="range"
                  min="0.7"
                  max="1.0"
                  step="0.01"
                  value={curPersona.topP}
                  onChange={(e) => updateCurrentPersona({ topP: parseFloat(e.target.value) })}
                  className="w-full accent-indigo-500"
                />
              </div>
            </div>

            <div className="space-y-1.5 pt-2 border-t border-border/30">
              <div className="flex items-center justify-between">
                <Label className="font-semibold text-foreground">
                  {activePersonaTab === "coach"
                    ? "Behavioral Coach Persona & Prompt Template"
                    : "General Journal Reflection Prompt Template"}
                </Label>
                <button
                  type="button"
                  onClick={() =>
                    updateCurrentPersona({
                      systemPrompt:
                        activePersonaTab === "coach"
                          ? DEFAULT_COACH_PROMPT
                          : DEFAULT_GENERAL_PROMPT,
                    })
                  }
                  className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-indigo-400"
                >
                  <RotateCcw className="h-3 w-3" />
                  <span>Reset Prompt</span>
                </button>
              </div>
              <textarea
                rows={6}
                value={curPersona.systemPrompt}
                onChange={(e) => updateCurrentPersona({ systemPrompt: e.target.value })}
                className="w-full rounded-lg border border-border/70 bg-[#141722] p-3 font-mono text-[11px] text-foreground outline-none focus:border-indigo-500 leading-relaxed"
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <Button disabled={busy} onClick={() => void handleSaveAll()} className="px-6 font-semibold">
            {busy ? "Saving Settings..." : "Save AI Settings"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
