"use client";

import React, { useEffect, useState } from "react";
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
} from "lucide-react";

interface PersonaConfig {
  contextSize: number;
  maxOutputTokens: number;
  temperature: number;
  topP: number;
  systemPrompt: string;
}

interface LocalAiSettingsPayload {
  mode: "local_kobold" | "cloud";
  baseUrl: string;
  modelsDir: string;
  activeModelFile: string;
  general: PersonaConfig;
  coach: PersonaConfig;
}

const CONTEXT_WINDOW_OPTIONS = [
  { value: 8192, label: "8,192 tokens (8K - Fast)" },
  { value: 16384, label: "16,384 tokens (16K - Standard)" },
  { value: 32768, label: "32,768 tokens (32K - Recommended)" },
  { value: 65536, label: "65,536 tokens (64K - Deep)" },
  { value: 98304, label: "98,304 tokens (96K - Extended)" },
  { value: 131072, label: "131,072 tokens (128K - Massive)" },
  { value: 262144, label: "262,144 tokens (262K - Full Native)" },
];

const MAX_OUTPUT_OPTIONS = [
  { value: 1024, label: "1,024 tokens (Brief)" },
  { value: 2048, label: "2,048 tokens (Standard)" },
  { value: 4096, label: "4,096 tokens (Detailed)" },
  { value: 6144, label: "6,144 tokens (Deep Reasoning)" },
  { value: 8192, label: "8,192 tokens (Extended CoT)" },
  { value: 12288, label: "12,288 tokens (Heavy Synthesis)" },
  { value: 16384, label: "16,384 tokens (Maximum Output)" },
];

const DEFAULT_GENERAL_PROMPT = `You are the reflection layer of a trader's journal.
You see only the trader's own recorded data — trades, stats, and notes. Ground every statement in those numbers; never invent trades, prices, or market context you weren't given.
Be direct and specific like a good trading coach: name the behavior, cite the numbers, say what to keep and what to fix. No platitudes, no disclaimers about trading being risky — the trader knows. Keep it tight.`;

const DEFAULT_COACH_PROMPT = `You are a longitudinal trading psychology and behavioral performance analyst.
You do NOT evaluate the trader's technical chart model. Your job is to connect the chain of thought across multiple Daily, Weekly, Monthly, and Quarterly journals—especially their End-of-Period Reviews and self-reflection Quote blocks—and correlate their own words with their hard execution telemetry.
Hold the trader strictly accountable to their active process goals without judgment.`;

export function AiSettings() {
  const { data, refresh } = useApi<AiSettingsPayload & { localAi?: LocalAiSettingsPayload }>("/api/settings");

  const [activePersonaTab, setActivePersonaTab] = useState<"general" | "coach">("coach");

  const [localSettings, setLocalSettings] = useState<LocalAiSettingsPayload>({
    mode: "local_kobold",
    baseUrl: "http://100.75.201.34:5001",
    modelsDir: "~/koboldcpp/models",
    activeModelFile: "Qwen3.8-27B-Q4_K_M.gguf",
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

  const [discoveredModels, setDiscoveredModels] = useState<Array<{ name: string; sizeMb: number }>>([]);
  const [scanningDir, setScanningDir] = useState(false);
  const [scanMessage, setScanMessage] = useState("");

  const [probing, setProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<{
    tested: boolean;
    online: boolean;
    model: string;
  }>({ tested: false, online: false, model: "" });

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
      setLocalSettings((prev) => ({
        ...prev,
        ...data.localAi,
        general: { ...prev.general, ...(data.localAi?.general || {}) },
        coach: { ...prev.coach, ...(data.localAi?.coach || {}) },
      }));
    }
  }, [data]);

  const scanModelsFolder = async (dirToScan = localSettings.modelsDir) => {
    setScanningDir(true);
    setScanMessage("");
    try {
      const res = await fetch("/api/ai/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "scan_models", dir: dirToScan }),
      });
      const json = await res.json();
      if (json.ok && Array.isArray(json.models)) {
        setDiscoveredModels(json.models);
        setScanMessage(
          json.models.length > 0
            ? `Discovered ${json.models.length} .gguf model${json.models.length === 1 ? "" : "s"}`
            : "No .gguf files found in this folder."
        );
        if (json.models.length > 0 && !json.models.some((m: any) => m.name === localSettings.activeModelFile)) {
          setLocalSettings((prev) => ({ ...prev, activeModelFile: json.models[0].name }));
        }
      } else {
        setScanMessage("Could not scan directory.");
      }
    } catch {
      setScanMessage("Folder scan failed.");
    } finally {
      setScanningDir(false);
    }
  };

  useEffect(() => {
    void scanModelsFolder();
  }, []);

  const handleSelectModel = async (fileName: string) => {
    setLocalSettings((prev) => ({ ...prev, activeModelFile: fileName }));
    try {
      await fetch("/api/ai/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_active_model", modelFile: fileName }),
      });
    } catch {}
  };

  const testDesktopConnection = async (targetUrl = localSettings.baseUrl) => {
    setProbing(true);
    setProbeResult({ tested: false, online: false, model: "" });
    try {
      const res = await fetch("/api/ai/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save_kobold_config", baseUrl: targetUrl }),
      });
      const json = await res.json();
      if (json.ok && json.kobold) {
        setProbeResult({
          tested: true,
          online: Boolean(json.kobold.online),
          model: json.kobold.modelName || "Online",
        });
      } else {
        setProbeResult({ tested: true, online: false, model: "Unreachable" });
      }
    } catch {
      setProbeResult({ tested: true, online: false, model: "Connection failed" });
    } finally {
      setProbing(false);
    }
  };

  const handleSaveAll = async () => {
    setBusy(true);
    setFeedback({});
    try {
      await postJson(
        "/api/settings",
        {
          localAi: localSettings,
          aiProvider: provider,
          aiModel: model.trim(),
          ...(apiKey.trim() ? { [`${provider}Key`]: apiKey.trim() } : {}),
        },
        "PATCH"
      );
      setApiKey("");
      setFeedback({ success: "AI settings saved successfully." });
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

  // Safe option arrays that always include the active value even if custom
  const currentCtxOptions = CONTEXT_WINDOW_OPTIONS.some((o) => o.value === curPersona.contextSize)
    ? CONTEXT_WINDOW_OPTIONS
    : [{ value: curPersona.contextSize, label: `${curPersona.contextSize.toLocaleString()} tokens (Custom)` }, ...CONTEXT_WINDOW_OPTIONS];

  const currentOutOptions = MAX_OUTPUT_OPTIONS.some((o) => o.value === curPersona.maxOutputTokens)
    ? MAX_OUTPUT_OPTIONS
    : [{ value: curPersona.maxOutputTokens, label: `${curPersona.maxOutputTokens.toLocaleString()} tokens (Current)` }, ...MAX_OUTPUT_OPTIONS];

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
                Manage your local GPU endpoints, GGUF models directory, context windows, and persona prompts.
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
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 pb-3">
              <span className="font-bold text-foreground flex items-center gap-2">
                <FolderOpen className="h-4 w-4 text-indigo-400" />
                <span>GGUF Model Directory &amp; Desktop Server</span>
              </span>
              <div className="flex items-center gap-2">
                {probeResult.tested && (
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
                      probeResult.online
                        ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                        : "border-rose-500/40 bg-rose-500/15 text-rose-300"
                    }`}
                  >
                    {probeResult.online ? (
                      <>
                        <CheckCircle2 className="h-3 w-3" />
                        <span>Online · {probeResult.model}</span>
                      </>
                    ) : (
                      <>
                        <AlertCircle className="h-3 w-3" />
                        <span>Offline</span>
                      </>
                    )}
                  </span>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={probing}
                  onClick={() => testDesktopConnection()}
                  className="h-7 text-xs"
                >
                  <RefreshCw className={`mr-1.5 h-3 w-3 ${probing ? "animate-spin" : ""}`} />
                  {probing ? "Testing..." : "Test Connection"}
                </Button>
              </div>
            </div>

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
                <Label htmlFor="models-dir">Models Folder on Desktop</Label>
                <div className="flex items-center gap-1.5">
                  <Input
                    id="models-dir"
                    value={localSettings.modelsDir}
                    onChange={(e) =>
                      setLocalSettings((prev) => ({ ...prev, modelsDir: e.target.value }))
                    }
                    placeholder="~/koboldcpp/models"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={scanningDir}
                    onClick={() => scanModelsFolder()}
                    className="h-9 px-3 shrink-0"
                    title="Scan folder for .gguf files"
                  >
                    <FolderOpen className={`h-3.5 w-3.5 ${scanningDir ? "animate-pulse" : ""}`} />
                    <span className="ml-1.5">{scanningDir ? "Scanning..." : "Scan Folder"}</span>
                  </Button>
                </div>
                {scanMessage && (
                  <p className="text-[10px] text-indigo-300 font-medium">{scanMessage}</p>
                )}
              </div>
            </div>

            <div className="pt-2 border-t border-border/30 space-y-1">
              <Label htmlFor="active-model-select">Active GGUF Model</Label>
              {discoveredModels.length > 0 ? (
                <div className="flex items-center gap-2">
                  <select
                    id="active-model-select"
                    value={localSettings.activeModelFile}
                    onChange={(e) => handleSelectModel(e.target.value)}
                    className="h-9 w-full rounded-lg border border-border/70 bg-[#141722] px-3 text-xs text-foreground outline-none focus:border-indigo-500 font-mono"
                  >
                    {discoveredModels.map((m) => (
                      <option key={m.name} value={m.name}>
                        {m.name} {m.sizeMb > 0 ? `(${m.sizeMb} MB)` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Input
                    id="active-model-select"
                    value={localSettings.activeModelFile}
                    onChange={(e) => handleSelectModel(e.target.value)}
                    placeholder="Qwen3.8-27B-Q4_K_M.gguf"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => scanModelsFolder()}
                    className="h-9 text-[11px] text-muted-foreground hover:text-foreground shrink-0"
                  >
                    Click &ldquo;Scan Folder&rdquo; to populate dropdown
                  </Button>
                </div>
              )}
              <p className="text-[10px] text-muted-foreground">
                Selecting a model from the dropdown automatically updates your desktop launcher.
              </p>
            </div>
          </div>
        )}

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
                <span>Longitudinal Behavioral Coach</span>
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
                <span>General Journal (Recaps &amp; Critiques)</span>
              </button>
            </div>

            <span className="text-[11px] text-muted-foreground hidden sm:inline">
              {activePersonaTab === "coach"
                ? "Used for Weekly/Monthly audits & Progress accountability"
                : "Used for daily trade critique, session recap & ask journal"}
            </span>
          </div>

          <div className="p-4 space-y-4">
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="space-y-1">
                <Label>Context Window</Label>
                <OptionSelect
                  value={String(curPersona.contextSize)}
                  onValueChange={(val) => updateCurrentPersona({ contextSize: Number(val) })}
                >
                  {currentCtxOptions.map((opt) => (
                    <option key={opt.value} value={String(opt.value)}>
                      {opt.label}
                    </option>
                  ))}
                </OptionSelect>
                <p className="text-[10px] text-muted-foreground">
                  {curPersona.contextSize >= 65536
                    ? "Covers months of multi-week journals."
                    : "32K fits 18 multi-week journals."}
                </p>
              </div>

              <div className="space-y-1">
                <Label>Max Output Allowance</Label>
                <OptionSelect
                  value={String(curPersona.maxOutputTokens)}
                  onValueChange={(val) => updateCurrentPersona({ maxOutputTokens: Number(val) })}
                >
                  {currentOutOptions.map((opt) => (
                    <option key={opt.value} value={String(opt.value)}>
                      {opt.label}
                    </option>
                  ))}
                </OptionSelect>
                <p className="text-[10px] text-muted-foreground">
                  {curPersona.maxOutputTokens >= 6144
                    ? "Full reasoning chain + long report."
                    : "Standard response allowance."}
                </p>
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
                <p className="text-[10px] text-muted-foreground">
                  {activePersonaTab === "coach" ? "0.6 for pattern synthesis." : "0.4 for strict factual recaps."}
                </p>
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
                <p className="text-[10px] text-muted-foreground">Nucleus sampling cutoff.</p>
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
                  <span>Reset {activePersonaTab === "coach" ? "Coach" : "General"} Prompt</span>
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
          <Button disabled={busy} onClick={() => handleSaveAll()} className="px-6 font-semibold">
            {busy ? "Saving Settings..." : "Save AI Settings"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
