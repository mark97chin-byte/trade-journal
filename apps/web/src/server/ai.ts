import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { APICallError, RetryError, generateText } from "ai";
import Database from "better-sqlite3";
import http from "http";
import https from "https";
import path from "path";
import fs from "fs";
import { getAiKey, getAiModel, getAiProvider } from "./settings";
import { AI_PROVIDER_NAMES } from "@/lib/ai-settings";

export interface PersonaConfig {
  contextSize: number;
  maxOutputTokens: number;
  temperature: number;
  topP: number;
  systemPrompt: string;
}

export interface StrataChatSlotConfig {
  modelsDir: string;
  activeModelFile: string;
  quantKv: string;
  vramBudgetGb: number;
  contextSize: number;
  gpuLayers: number;
  binaryPath: string;
}

export interface LocalAiSettings {
  mode: "local_kobold" | "cloud";
  activeEngineSlot?: "strata_chat" | "kobold_report";
  autoSwitchOnDemand?: boolean;
  idleUnloadMinutes?: number;
  baseUrl: string;
  modelsDir: string;
  activeModelFile: string;
  strataChat?: StrataChatSlotConfig;
  baselineRiskPct?: number;
  accountBalanceOverride?: number;
  general: PersonaConfig;
  coach: PersonaConfig;
}

export type KoboldConfig = LocalAiSettings;

export const DEFAULT_LOCAL_AI_SETTINGS: LocalAiSettings = {
  mode: "local_kobold",
  activeEngineSlot: "strata_chat",
  autoSwitchOnDemand: true,
  idleUnloadMinutes: 30,
  baseUrl: process.env.KOBOLDCPP_URL || "http://100.75.201.34:5001",
  modelsDir: "~/koboldcpp/models",
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
  baselineRiskPct: 1.0,
  accountBalanceOverride: 0,
  general: {
    contextSize: 16384,
    maxOutputTokens: 2048,
    temperature: 0.4,
    topP: 0.90,
    systemPrompt: `You are the reflection layer of a trader's journal.
You see only the trader's own recorded data — trades, stats, and notes. Ground every
statement in those numbers; never invent trades, prices, or market context you weren't given.
Be direct and specific like a good trading coach: name the behavior, cite the numbers,
say what to keep and what to fix. No platitudes, no disclaimers about trading being risky —
the trader knows. Keep it tight.`,
  },
  coach: {
    contextSize: 32768,
    maxOutputTokens: 12288,
    temperature: 0.6,
    topP: 0.95,
    systemPrompt: `You are a longitudinal trading psychology and behavioral performance analyst.
You do NOT evaluate the trader's technical chart model. Your job is to connect the chain of thought across multiple Daily, Weekly, Monthly, and Quarterly journals—especially their End-of-Period Reviews and self-reflection Quote blocks—and correlate their own words with their hard execution telemetry.
Hold the trader strictly accountable to their active process goals without judgment.`,
  },
};

function resolveJournalDbPath(): string {
  const p1 = path.resolve(process.cwd(), "data", "journal.db");
  const p2 = path.resolve(process.cwd(), "apps", "web", "data", "journal.db");
  return fs.existsSync(p1) ? p1 : p2;
}

export function loadLocalAiSettings(): LocalAiSettings {
  try {
    const dbPath = resolveJournalDbPath();
    if (!fs.existsSync(dbPath)) return DEFAULT_LOCAL_AI_SETTINGS;
    const db = new Database(dbPath, { readonly: true });
    try {
      const row = db
        .prepare("SELECT value_json FROM journal_kv_settings WHERE key = 'local_ai_settings'")
        .get() as { value_json: string } | undefined;
      if (!row) return DEFAULT_LOCAL_AI_SETTINGS;
      const parsed = JSON.parse(row.value_json);
      const koboldDir =
        parsed?.modelsDir && !String(parsed.modelsDir).includes("Storage 2")
          ? parsed.modelsDir
          : "~/koboldcpp/models/";
      return {
        ...DEFAULT_LOCAL_AI_SETTINGS,
        ...parsed,
        modelsDir: koboldDir,
        strataChat: {
          ...DEFAULT_LOCAL_AI_SETTINGS.strataChat!,
          ...(parsed?.strataChat || {}),
          modelsDir:
            parsed?.strataChat?.modelsDir && !String(parsed.strataChat.modelsDir).includes("koboldcpp/models/IQ3_S")
              ? parsed.strataChat.modelsDir
              : "/run/media/mark/Storage 2/AI Models/",
        },
        general: { ...DEFAULT_LOCAL_AI_SETTINGS.general, ...(parsed?.general || {}) },
        coach: { ...DEFAULT_LOCAL_AI_SETTINGS.coach, ...(parsed?.coach || {}) },
      };
    } finally {
      db.close();
    }
  } catch {
    return DEFAULT_LOCAL_AI_SETTINGS;
  }
}

export const loadKoboldConfig = loadLocalAiSettings;

export function saveLocalAiSettings(cfg: Partial<LocalAiSettings>): LocalAiSettings {
  const current = loadLocalAiSettings();
  const merged: LocalAiSettings = {
    ...current,
    ...cfg,
    general: { ...current.general, ...(cfg.general || {}) },
    coach: { ...current.coach, ...(cfg.coach || {}) },
  };
  if (merged.baseUrl) {
    merged.baseUrl = merged.baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
  }
  try {
    const dbPath = resolveJournalDbPath();
    const db = new Database(dbPath);
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS journal_kv_settings (
          key TEXT PRIMARY KEY,
          value_json TEXT NOT NULL
        )
      `);
      db.prepare(`
        INSERT INTO journal_kv_settings (key, value_json)
        VALUES ('local_ai_settings', ?)
        ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json
      `).run(JSON.stringify(merged));
    } finally {
      db.close();
    }
  } catch {}
  return merged;
}

export const saveKoboldConfig = (cfg: any) => saveLocalAiSettings(cfg);

export async function probeKoboldStatus(customUrl?: string): Promise<{
  online: boolean;
  baseUrl: string;
  modelName: string;
  latencyMs?: number;
}> {
  const cfg = loadLocalAiSettings();
  const baseUrl = (customUrl || cfg.baseUrl).replace(/\/+$/, "").replace(/\/v1$/, "");
  const t0 = Date.now();
  try {
    const res = await fetch(`${baseUrl}/api/v1/model`, {
      signal: AbortSignal.timeout(3000),
    });
    const latencyMs = Date.now() - t0;
    if (res.ok) {
      const data = (await res.json()) as { result?: string };
      return {
        online: true,
        baseUrl,
        modelName: (data.result || cfg.activeModelFile).replace(/^.*\//, ""),
        latencyMs,
      };
    }
    const v1Res = await fetch(`${baseUrl}/v1/models`, {
      signal: AbortSignal.timeout(3000),
    });
    if (v1Res.ok) {
      const v1Data = (await v1Res.json()) as any;
      const firstId = v1Data?.data?.[0]?.id || cfg.activeModelFile;
      return { online: true, baseUrl, modelName: firstId, latencyMs };
    }
  } catch {}
  return { online: false, baseUrl, modelName: "Offline" };
}

export async function abortKoboldGeneration(customUrl?: string): Promise<boolean> {
  const cfg = loadLocalAiSettings();
  const baseUrl = (customUrl || cfg.baseUrl).replace(/\/+$/, "").replace(/\/v1$/, "");
  try {
    await fetch(`${baseUrl}/api/extra/abort`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(2500),
    });
    return true;
  } catch {
    return false;
  }
}

export function splitThinkAndAnswer(rawText: string): {
  reasoning: string;
  answer: string;
} {
  if (!rawText) return { reasoning: "", answer: "" };
  const thinkMatches: string[] = [];
  let working = rawText;

  working = working.replace(/<think>([\s\S]*?)<\/think>/gi, (_m, inner) => {
    if (inner && inner.trim()) thinkMatches.push(inner.trim());
    return "";
  });

  if (working.toLowerCase().includes("</think>")) {
    const parts = working.split(/<\/think>/i);
    const tailAnswer = parts.pop() || "";
    const leadingThought = parts.join("\n").replace(/<think>/gi, "").trim();
    if (leadingThought) thinkMatches.push(leadingThought);
    working = tailAnswer;
  }

  if (working.toLowerCase().includes("<think>")) {
    const [before, after] = working.split(/<think>/i);
    if (after && after.trim()) thinkMatches.push(after.trim());
    working = before || "";
  }

  working = working
    .replace(/^\s*\(Reasoning budget exceeded\)\s*/i, "")
    .replace(/^\s*Time to respond now\.?\s*/i, "")
    .trim();

  return {
    reasoning: thinkMatches.join("\n\n").trim(),
    answer: working,
  };
}

// Native Node http.request streaming client with ZERO timeout (runs for hours if needed)
function singleKoboldStreamCall(
  baseUrl: string,
  messages: Array<{ role: string; content: string }>,
  params: {
    maxTokens: number;
    temperature: number;
    topP: number;
    reasoningEffort: string;
    enableThinking: boolean;
    abortSignal?: AbortSignal;
    onDelta?: (rawAcc: string, reasoningAcc: string) => void;
  }
): Promise<{ rawContent: string; explicitReasoning: string; finishReason: string }> {
  return new Promise((resolve, reject) => {
    const targetUrl = new URL(`${baseUrl}/v1/chat/completions`);
    const isHttps = targetUrl.protocol === "https:";
    const transport = isHttps ? https : http;

    const postData = JSON.stringify({
      model: "koboldcpp",
      messages,
      max_tokens: params.maxTokens,
      temperature: params.temperature,
      top_p: params.topP,
      top_k: 20,
      min_p: 0.0,
      reasoning_effort: params.reasoningEffort,
      enable_thinking: params.enableThinking,
      stream: true,
    });

    const req = transport.request(
      {
        hostname: targetUrl.hostname,
        port: targetUrl.port || (isHttps ? 443 : 80),
        path: targetUrl.pathname + targetUrl.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(postData),
          Connection: "keep-alive",
        },
      },
      (res) => {
        if ((res.statusCode || 500) >= 400) {
          let errBody = "";
          res.on("data", (chunk) => {
            errBody += chunk.toString();
          });
          res.on("end", () => {
            reject(
              new Error(`KoboldCpp HTTP ${res.statusCode}: ${errBody.slice(0, 240)}`)
            );
          });
          return;
        }

        let buffer = "";
        let accumulatedRaw = "";
        let accumulatedReasoning = "";
        let finishReason = "stop";
        let lastEmitMs = 0;

        res.on("data", (chunk: Buffer) => {
          buffer += chunk.toString("utf-8");
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const dataStr = trimmed.slice(5).trim();
            if (!dataStr || dataStr === "[DONE]") continue;
            try {
              const parsedChunk = JSON.parse(dataStr);
              const choice = parsedChunk?.choices?.[0];
              if (choice?.finish_reason) {
                finishReason = choice.finish_reason;
              }
              const delta = choice?.delta;
              if (delta) {
                if (delta.content) accumulatedRaw += delta.content;
                if (delta.reasoning_content || delta.reasoning) {
                  accumulatedReasoning += delta.reasoning_content || delta.reasoning;
                }
              }
            } catch {}
          }

          const now = Date.now();
          if (now - lastEmitMs > 1200 && params.onDelta) {
            lastEmitMs = now;
            params.onDelta(accumulatedRaw, accumulatedReasoning);
          }
        });

        res.on("end", () => {
          if (params.onDelta) {
            params.onDelta(accumulatedRaw, accumulatedReasoning);
          }
          resolve({
            rawContent: accumulatedRaw,
            explicitReasoning: accumulatedReasoning,
            finishReason,
          });
        });

        res.on("error", (err) => {
          // If we already generated substantial content before a socket hiccup, resolve with what we have!
          if (accumulatedRaw.length > 100) {
            resolve({
              rawContent: accumulatedRaw,
              explicitReasoning: accumulatedReasoning,
              finishReason: "length",
            });
          } else {
            reject(err);
          }
        });
      }
    );

    // Disable all socket timeouts so 30–120+ minute generations never drop
    req.setTimeout(0);
    req.on("socket", (socket) => {
      socket.setTimeout(0);
      socket.setKeepAlive(true, 30_000);
    });

    if (params.abortSignal) {
      if (params.abortSignal.aborted) {
        req.destroy(new Error("Aborted by user"));
        return;
      }
      params.abortSignal.addEventListener(
        "abort",
        () => {
          req.destroy(new Error("Aborted by user"));
        },
        { once: true }
      );
    }

    req.on("error", (err) => {
      reject(err);
    });

    req.write(postData);
    req.end();
  });
}

export async function runKoboldAi(
  prompt: string,
  options: {
    persona?: "general" | "coach";
    system?: string;
    maxOutputTokens?: number;
    temperature?: number;
    topP?: number;
    keepReasoning?: boolean;
    thinkingMode?: "fast" | "balanced" | "deep";
    autoContinue?: boolean;
    timeoutMs?: number;
    abortSignal?: AbortSignal;
    onPartial?: (partial: { text: string; reasoning: string }) => void;
  } = {}
): Promise<{ text: string; reasoning: string; model: string }> {
  const cfg = loadLocalAiSettings();
  const persona = options.persona === "coach" ? cfg.coach : cfg.general;
  const baseUrl = cfg.baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
  const thinkingMode = options.thinkingMode || "balanced";

  let systemPrompt = options.system || persona.systemPrompt;
  if (thinkingMode === "fast") {
    systemPrompt +=
      "\n\nIMPORTANT: Respond directly with your final Markdown analysis. Do NOT output long internal <think> monologues.";
  } else if (thinkingMode === "balanced") {
    systemPrompt +=
      "\n\nIMPORTANT: Keep your internal <think> reasoning concise (under 350 words) so you have plenty of token budget to complete all 5 report sections and the closing JSON block without cutting off.";
  }

  const maxTokens = Math.max(options.maxOutputTokens ?? persona.maxOutputTokens ?? 12288, 6144);
  const temperature = options.temperature ?? persona.temperature ?? 0.6;
  const topP = options.topP ?? persona.topP ?? 0.95;
  const reasoningEffort =
    thinkingMode === "fast" ? "low" : thinkingMode === "deep" ? "high" : "medium";

  const firstPass = await singleKoboldStreamCall(
    baseUrl,
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt },
    ],
    {
      maxTokens,
      temperature,
      topP,
      reasoningEffort,
      enableThinking: thinkingMode !== "fast",
      abortSignal: options.abortSignal,
      onDelta: (rawAcc, reasonAcc) => {
        if (!options.onPartial) return;
        const split = splitThinkAndAnswer(rawAcc);
        options.onPartial({
          text: split.answer,
          reasoning: [reasonAcc, split.reasoning].filter(Boolean).join("\n\n"),
        });
      },
    }
  );

  const firstSplit = splitThinkAndAnswer(firstPass.rawContent);
  let combinedAnswer = firstSplit.answer;
  let combinedReasoning = [firstPass.explicitReasoning, firstSplit.reasoning]
    .filter(Boolean)
    .join("\n\n");

  // Multi-Pass Auto-Continuation (up to 3 continuation passes if the model stops mid-sentence or before closing JSON)
  for (let pass = 1; pass <= 3; pass++) {
    if (options.autoContinue === false || options.abortSignal?.aborted) break;

    const trimmedAns = combinedAnswer.trim();
    const hasClosingJson = /```json[\s\S]*?```/i.test(trimmedAns);
    const endsMidSentence =
      trimmedAns.length > 80 && !/[.!?>`\]}*]\s*$/.test(trimmedAns);
    const needsMore =
      firstPass.finishReason === "length" ||
      endsMidSentence ||
      (options.persona === "coach" && !hasClosingJson && pass === 1);

    if (!needsMore) break;

    try {
      const contPass = await singleKoboldStreamCall(
        baseUrl,
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
          { role: "assistant", content: combinedAnswer },
          {
            role: "user",
            content:
              "Continue writing seamlessly from the exact word where you stopped above. Do NOT repeat any prior text. Complete the remaining report sections (including Section 4 Action Plan and Section 5 Multi-Level Goals) and finish with the closing ```json block.",
          },
        ],
        {
          maxTokens: 8192,
          temperature,
          topP,
          reasoningEffort: "low",
          enableThinking: false,
          abortSignal: options.abortSignal,
          onDelta: (rawCont) => {
            if (!options.onPartial) return;
            const contSplit = splitThinkAndAnswer(rawCont);
            options.onPartial({
              text: `${combinedAnswer.trimEnd()} ${contSplit.answer.trimStart()}`,
              reasoning: combinedReasoning,
            });
          },
        }
      );

      const contSplit = splitThinkAndAnswer(contPass.rawContent);
      if (contSplit.answer.trim()) {
        combinedAnswer = `${combinedAnswer.trimEnd()} ${contSplit.answer.trimStart()}`;
      } else {
        break;
      }
    } catch {
      // Never lose already-generated text if a continuation pass fails
      break;
    }
  }

  return {
    text:
      options.keepReasoning && combinedReasoning
        ? `<think>\n${combinedReasoning}\n</think>\n\n${combinedAnswer}`
        : combinedAnswer,
    reasoning: combinedReasoning,
    model: cfg.activeModelFile || "koboldcpp",
  };
}

export const aiConfigured = (): boolean => {
  const local = loadLocalAiSettings();
  if (local.mode === "local_kobold" && local.baseUrl) return true;
  return getAiKey(getAiProvider()) !== null;
};

const SYSTEM = `You are the reflection layer of a trader's journal.
You see only the trader's own recorded data — trades, stats, and notes. Ground every
statement in those numbers; never invent trades, prices, or market context you weren't given.
Be direct and specific like a good trading coach: name the behavior, cite the numbers,
say what to keep and what to fix. No platitudes, no disclaimers about trading being risky —
the trader knows. Keep it tight.`;

export const runAi = async (prompt: string, maxOutputTokens = 1200): Promise<string> => {
  const local = loadLocalAiSettings();
  if (local.mode === "local_kobold" && local.baseUrl) {
    try {
      const result = await runKoboldAi(prompt, {
        persona: "general",
        thinkingMode: "fast",
        autoContinue: false,
        maxOutputTokens: Math.max(maxOutputTokens + 1500, 2500),
      });
      if (result.text.trim()) return result.text.trim();
    } catch {
      const fallbackProvider = getAiProvider();
      const fallbackKey = getAiKey(fallbackProvider);
      if (!fallbackKey) {
        throw new Error(
          `KoboldCpp server (${local.baseUrl}) is unreachable. Start the server in Settings -> AI.`
        );
      }
    }
  }

  const provider = getAiProvider();
  const apiKey = getAiKey(provider);
  if (!apiKey) {
    throw new Error(
      `AI is not configured — start KoboldCpp on desktop or add your ${AI_PROVIDER_NAMES[provider]} API key in Settings.`
    );
  }
  const model = getAiModel(provider);
  try {
    const result = await generateText({
      model:
        provider === "openai"
          ? createOpenAI({ apiKey }).responses(model)
          : createAnthropic({ apiKey })(model),
      ...(provider === "openai" ? { providerOptions: { openai: { store: false } } } : {}),
      system: SYSTEM,
      prompt,
      maxOutputTokens,
    });
    if (!result.text.trim()) throw new Error("AI returned no text. Check the model or try again.");
    return result.text;
  } catch (error) {
    if (RetryError.isInstance(error)) error = error.lastError;
    if (APICallError.isInstance(error)) {
      if (error.statusCode === 401 || error.statusCode === 403)
        throw new Error(
          "AI authentication_error: check your provider key and permissions in Settings.",
        );
      if (
        /credit balance|billing|insufficient_quota|exceeded your current quota/i.test(error.message)
      )
        throw new Error("AI billing: check your provider account's credits and quota.");
      if (error.statusCode === 429 || error.statusCode === 529)
        throw new Error("AI rate limit: please try again shortly.");
      if (
        error.statusCode === 404 ||
        /model.*(?:not found|does not exist|access)/i.test(error.message)
      )
        throw new Error(
          "AI model unavailable: check the model ID and your provider access in Settings.",
        );
    }
    throw new Error("AI request failed. Check your provider settings or try again shortly.");
  }
};


export function getControlDaemonUrl(baseUrl?: string): string {
  try {
    if (!baseUrl) return "http://127.0.0.1:5002";
    const u = new URL(baseUrl);
    return `${u.protocol}//${u.hostname}:5002`;
  } catch {
    return "http://127.0.0.1:5002";
  }
}
