import { NextRequest, NextResponse } from "next/server";
import { getSetting, setSetting } from "@/server/settings";

export const dynamic = "force-dynamic";

export interface AiSlotConfig {
  engine: "strata" | "koboldcpp" | "openai-compatible";
  name: string;
  modelId: string;
  quantization: string;
  kvQuant: string;
  vramBudgetGb: number;
  contextLength: number;
  endpointUrl: string;
  startCommand: string;
  stopCommand: string;
}

export interface AiOrchestratorConfig {
  activeSlot: "none" | "chat" | "report";
  autoSwitchOnDemand: boolean;
  idleUnloadMinutes: number;
  orchestratorDaemonUrl: string;
  chatSlot: AiSlotConfig;
  reportSlot: AiSlotConfig;
}

const SETTING_KEY = "ai:dualSlotOrchestrator:v1";

export const QUANTIZATION_PRESETS = [
  {
    value: "Q5_K_M",
    label: "Q5_K_M · High Intelligence (~40 tok/s · Recommended for RTX 4070S 12GB + 64GB RAM)",
    estSpeed: "~38–48 tok/s",
    quality: "Near-FP16 Reasoning & Coding",
  },
  {
    value: "Q6_K",
    label: "Q6_K · Maximum Intelligence (~28 tok/s · Highest Precision)",
    estSpeed: "~25–35 tok/s",
    quality: "Maximum Precision",
  },
  {
    value: "Q4_K_M",
    label: "Q4_K_M · Balanced High Speed (~65 tok/s)",
    estSpeed: "~55–75 tok/s",
    quality: "Standard 4-bit",
  },
];

function getDefaultConfig(): AiOrchestratorConfig {
  return {
    activeSlot: "none",
    autoSwitchOnDemand: true,
    idleUnloadMinutes: 30,
    orchestratorDaemonUrl: process.env.STRATA_ORCHESTRATOR_URL || "http://100.115.247.10:8765",
    chatSlot: {
      engine: "strata",
      name: "Strata · Qwen3.8-Flash-Next (Interactive Chat)",
      modelId: "Qwen3.8-Flash-Next-Q5_K_M.gguf",
      quantization: "Q5_K_M",
      kvQuant: "tq3_5s",
      vramBudgetGb: 10.5,
      contextLength: 32768,
      endpointUrl: "http://100.115.247.10:8081/v1",
      startCommand:
        "strata serve --model /mnt/e/models/Qwen3.8-Flash-Next-Q5_K_M.gguf --port 8081 --ctx-size 32768 --cache-type-k tq3_5s --cache-type-v tq3_5s --gpu-layers auto --vram-budget 10.5",
      stopCommand: "pkill -f 'strata serve'",
    },
    reportSlot: {
      engine: "koboldcpp",
      name: "KoboldCPP · Deep Audit & Overnight Report Engine",
      modelId: "Current Report & Audit GGUF",
      quantization: "Q4_K_M",
      kvQuant: "f16",
      vramBudgetGb: 11.0,
      contextLength: 32768,
      endpointUrl: "http://100.115.247.10:5001/v1",
      startCommand: "python3 /mnt/e/koboldcpp/koboldcpp.py --config /mnt/e/koboldcpp/report_audit.kcpps --port 5001",
      stopCommand: "pkill -f 'koboldcpp.py'",
    },
  };
}

export function loadAiConfig(): AiOrchestratorConfig {
  const raw = getSetting(SETTING_KEY);
  const defaults = getDefaultConfig();
  if (!raw) return defaults;
  try {
    const parsed = JSON.parse(raw);
    return {
      ...defaults,
      ...parsed,
      chatSlot: { ...defaults.chatSlot, ...(parsed.chatSlot || {}) },
      reportSlot: { ...defaults.reportSlot, ...(parsed.reportSlot || {}) },
    };
  } catch {
    return defaults;
  }
}

export async function GET() {
  const config = loadAiConfig();
  let daemonStatus: Record<string, any> | null = null;
  try {
    const res = await fetch(`${config.orchestratorDaemonUrl.replace(/\/$/, "")}/status`, {
      signal: AbortSignal.timeout(2500),
      cache: "no-store",
    });
    if (res.ok) {
      daemonStatus = await res.json();
    }
  } catch {}

  return NextResponse.json({
    config,
    presets: QUANTIZATION_PRESETS,
    daemonStatus,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const current = loadAiConfig();

    // 1. Save updated configuration
    if (body.action === "save") {
      const updated: AiOrchestratorConfig = {
        ...current,
        ...(body.config || {}),
        chatSlot: { ...current.chatSlot, ...(body.config?.chatSlot || {}) },
        reportSlot: { ...current.reportSlot, ...(body.config?.reportSlot || {}) },
      };
      setSetting(SETTING_KEY, JSON.stringify(updated));
      return NextResponse.json({ ok: true, config: updated });
    }

    // 2. Mutual-Exclusion Slot Switch ("chat" | "report" | "none")
    if (body.action === "switch") {
      const targetSlot = body.slot as "none" | "chat" | "report";
      const updated: AiOrchestratorConfig = {
        ...current,
        activeSlot: targetSlot,
      };
      setSetting(SETTING_KEY, JSON.stringify(updated));

      let daemonResponse: any = { simulated: true, note: "Saved active slot; start strata-orchestrator.py on desktop for hardware process switching." };
      try {
        const res = await fetch(`${current.orchestratorDaemonUrl.replace(/\/$/, "")}/switch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            targetSlot,
            chatSlot: updated.chatSlot,
            reportSlot: updated.reportSlot,
          }),
          signal: AbortSignal.timeout(15_000),
        });
        if (res.ok) {
          daemonResponse = await res.json();
        }
      } catch (e: any) {
        daemonResponse = { daemonReachable: false, message: e?.message || "Orchestrator daemon offline" };
      }

      return NextResponse.json({
        ok: true,
        config: updated,
        daemonResponse,
      });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Failed to update AI runtime" }, { status: 500 });
  }
}
