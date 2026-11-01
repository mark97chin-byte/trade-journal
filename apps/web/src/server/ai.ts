import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { APICallError, RetryError, generateText } from "ai";
import Database from "better-sqlite3";
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

export interface LocalAiSettings {
  mode: "local_kobold" | "cloud";
  baseUrl: string;
  modelsDir: string;
  activeModelFile: string;
  general: PersonaConfig;
  coach: PersonaConfig;
}

export type KoboldConfig = LocalAiSettings;

export const DEFAULT_LOCAL_AI_SETTINGS: LocalAiSettings = {
  mode: "local_kobold",
  baseUrl: process.env.KOBOLDCPP_URL || "http://100.75.201.34:5001",
  modelsDir: "~/koboldcpp/models",
  activeModelFile: "Qwen3.8-27B-Q4_K_M.gguf",
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
    maxOutputTokens: 6144,
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
      return {
        ...DEFAULT_LOCAL_AI_SETTINGS,
        ...parsed,
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

// Backward-compatible alias exports
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

export function splitThinkAndAnswer(rawText: string): {
  reasoning: string;
  answer: string;
} {
  if (!rawText) return { reasoning: "", answer: "" };
  const thinkMatches: string[] = [];
  let working = rawText;

  // 1. Handle standard <think>...</think> blocks
  working = working.replace(/<think>([\s\S]*?)<\/think>/gi, (_m, inner) => {
    if (inner && inner.trim()) thinkMatches.push(inner.trim());
    return "";
  });

  // 2. Handle orphaned closing </think> (when KoboldCpp AutoGuess adapter puts <think> in prompt)
  if (working.toLowerCase().includes("</think>")) {
    const parts = working.split(/<\/think>/i);
    const tailAnswer = parts.pop() || "";
    const leadingThought = parts.join("\n").replace(/<think>/gi, "").trim();
    if (leadingThought) thinkMatches.push(leadingThought);
    working = tailAnswer;
  }

  // 3. Handle unclosed <think> (still streaming thought)
  if (working.toLowerCase().includes("<think>")) {
    const [before, after] = working.split(/<think>/i);
    if (after && after.trim()) thinkMatches.push(after.trim());
    working = before || "";
  }

  // Strip any leftover "(Reasoning budget exceeded) Time to respond now." artifacts
  working = working
    .replace(/^\s*\(Reasoning budget exceeded\)\s*/i, "")
    .replace(/^\s*Time to respond now\.?\s*/i, "")
    .trim();

  return {
    reasoning: thinkMatches.join("\n\n").trim(),
    answer: working,
  };
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
    systemPrompt += "\n\nIMPORTANT: Respond directly with your final analysis. Keep internal <think> reasoning brief (under 150 words) or skip it entirely.";
  }

  const maxTokens = options.maxOutputTokens ?? persona.maxOutputTokens ?? 4096;
  const temperature = options.temperature ?? persona.temperature ?? 0.6;
  const topP = options.topP ?? persona.topP ?? 0.95;
  // 30-minute timeout ceiling so deep CPU/GPU hybrid audits NEVER get cut off at 480s!
  const timeoutMs = options.timeoutMs ?? (options.persona === "coach" ? 1_800_000 : 180_000);

  const reasoningEffort =
    thinkingMode === "fast" ? "low" : thinkingMode === "deep" ? "high" : "medium";

  const useStream = Boolean(options.onPartial);

  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "koboldcpp",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      max_tokens: maxTokens,
      temperature,
      top_p: topP,
      top_k: 20,
      min_p: 0.0,
      reasoning_effort: reasoningEffort,
      enable_thinking: thinkingMode !== "fast",
      stream: useStream,
    }),
    signal: options.abortSignal
      ? AbortSignal.any([options.abortSignal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`KoboldCpp error (${res.status}): ${errText.slice(0, 240)}`);
  }

  if (useStream && res.body) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let accumulatedRaw = "";
    let accumulatedReasoning = "";
    let lastEmitMs = 0;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const dataStr = trimmed.slice(5).trim();
        if (!dataStr || dataStr === "[DONE]") continue;
        try {
          const parsedChunk = JSON.parse(dataStr);
          const delta = parsedChunk?.choices?.[0]?.delta;
          if (delta) {
            if (delta.content) accumulatedRaw += delta.content;
            if (delta.reasoning_content || delta.reasoning) {
              accumulatedReasoning += delta.reasoning_content || delta.reasoning;
            }
          }
        } catch {}
      }

      const now = Date.now();
      if (now - lastEmitMs > 1200 && options.onPartial) {
        lastEmitMs = now;
        const split = splitThinkAndAnswer(accumulatedRaw);
        options.onPartial({
          text: split.answer,
          reasoning: [accumulatedReasoning, split.reasoning].filter(Boolean).join("\n\n"),
        });
      }
    }

    const finalSplit = splitThinkAndAnswer(accumulatedRaw);
    const finalReasoning = [accumulatedReasoning, finalSplit.reasoning].filter(Boolean).join("\n\n");
    const finalAnswer = finalSplit.answer || accumulatedRaw;

    return {
      text:
        options.keepReasoning && finalReasoning
          ? `<think>\n${finalReasoning}\n</think>\n\n${finalAnswer}`
          : finalAnswer,
      reasoning: finalReasoning,
      model: cfg.activeModelFile || "koboldcpp",
    };
  }

  const json = (await res.json()) as any;
  const choice = json?.choices?.[0]?.message;
  const rawContent: string = choice?.content || "";
  const explicitReasoning: string = choice?.reasoning_content || choice?.reasoning || "";

  const parsed = splitThinkAndAnswer(rawContent);
  const finalReasoning = [explicitReasoning, parsed.reasoning].filter(Boolean).join("\n\n");
  const finalAnswer = parsed.answer || rawContent;

  return {
    text:
      options.keepReasoning && finalReasoning
        ? `<think>\n${finalReasoning}\n</think>\n\n${finalAnswer}`
        : finalAnswer,
    reasoning: finalReasoning,
    model: json?.model || cfg.activeModelFile || "koboldcpp",
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
        maxOutputTokens: Math.max(maxOutputTokens + 1500, 2500),
      });
      if (result.text.trim()) return result.text.trim();
    } catch (koboldErr) {
      const fallbackProvider = getAiProvider();
      const fallbackKey = getAiKey(fallbackProvider);
      if (!fallbackKey) {
        throw new Error(
          `KoboldCpp server (${local.baseUrl}) is unreachable. Run ~/koboldcpp/start-kobold.sh on your Fedora desktop.`
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
