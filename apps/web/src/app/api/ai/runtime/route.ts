import { NextRequest, NextResponse } from "next/server";
import { getSetting, setSetting } from "@/server/settings";

export const dynamic = "force-dynamic";

const SETTING_KEY = "ai:dualSlotOrchestrator:v1";

function getDefaultConfig() {
  return {
    activeSlot: "none",
    autoSwitchOnDemand: true,
    idleUnloadMinutes: 30,
    orchestratorDaemonUrl: process.env.STRATA_ORCHESTRATOR_URL || "http://100.75.201.34:8765",
    chatSlot: {
      engine: "strata",
      name: "Strata · Qwen3.8-Flash-Next",
      modelsFolder: "~/models/qwen3.8-flash-next",
      activeModelFile: "",
      discoveredModels: [] as string[],
      quantization: "Q3_K_XL",
      kvQuant: "tq3_5s",
      vramBudgetGb: 10.5,
      contextLength: 32768,
      endpointUrl: "http://100.75.201.34:8081/v1",
      startCommand: "strata serve --model ~/models/qwen3.8-flash-next --port 8081 --ctx-size 32768 --cache-type-k tq3_5s --cache-type-v tq3_5s --gpu-layers auto --vram-budget 10.5",
      stopCommand: "pkill -f 'strata serve'",
    },
    reportSlot: {
      engine: "koboldcpp",
      name: "KoboldCPP · Reports & Audits",
      modelsFolder: "~/koboldcpp/models",
      activeModelFile: "Qwen3.8-27B-Q4_K_M.gguf",
      discoveredModels: ["Qwen3.8-27B-Q4_K_M.gguf"] as string[],
      gpuLayers: 30,
      kvCacheQuant: "Q8_0",
      flashAttention: true,
      contextLength: 32768,
      endpointUrl: "http://100.75.201.34:5001/v1",
      startCommand: "python3 /mnt/e/koboldcpp/koboldcpp.py --config /mnt/e/koboldcpp/report_audit.kcpps --port 5001",
      stopCommand: "pkill -f 'koboldcpp.py'",
    },
  };
}

function loadConfig() {
  const raw = getSetting(SETTING_KEY);
  const def = getDefaultConfig();
  if (!raw) return def;
  try {
    const parsed = JSON.parse(raw);
    return {
      ...def,
      ...parsed,
      chatSlot: { ...def.chatSlot, ...(parsed.chatSlot || {}) },
      reportSlot: { ...def.reportSlot, ...(parsed.reportSlot || {}) },
    };
  } catch {
    return def;
  }
}

export async function GET() {
  const config = loadConfig();
  let daemonStatus: Record<string, any> | null = null;
  try {
    const res = await fetch(`${config.orchestratorDaemonUrl.replace(/\/$/, "")}/status`, {
      signal: AbortSignal.timeout(2000),
      cache: "no-store",
    });
    if (res.ok) daemonStatus = await res.json();
  } catch {}

  return NextResponse.json({ config, daemonStatus });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const current = loadConfig();

    if (body.action === "save") {
      const updated = {
        ...current,
        ...(body.config || {}),
        chatSlot: { ...current.chatSlot, ...(body.config?.chatSlot || {}) },
        reportSlot: { ...current.reportSlot, ...(body.config?.reportSlot || {}) },
      };
      setSetting(SETTING_KEY, JSON.stringify(updated));
      return NextResponse.json({ ok: true, config: updated });
    }

    if (body.action === "scan_folder") {
      const folderPath = String(body.folderPath || "").trim();
      let files: string[] = [];
      try {
        const res = await fetch(`${current.orchestratorDaemonUrl.replace(/\/$/, "")}/scan?folder=${encodeURIComponent(folderPath)}`, {
          signal: AbortSignal.timeout(6000),
          cache: "no-store",
        });
        if (res.ok) {
          const data = await res.json();
          files = Array.isArray(data.files) ? data.files : [];
        }
      } catch {}

      return NextResponse.json({ ok: true, folder: folderPath, files });
    }

    if (body.action === "switch") {
      const targetSlot = body.slot as "none" | "chat" | "report";
      const updated = { ...current, activeSlot: targetSlot };
      setSetting(SETTING_KEY, JSON.stringify(updated));

      let daemonRes: any = { status: `Active mode updated to ${targetSlot}` };
      try {
        const res = await fetch(`${current.orchestratorDaemonUrl.replace(/\/$/, "")}/switch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            targetSlot,
            idleUnloadMinutes: updated.idleUnloadMinutes,
            chatSlot: updated.chatSlot,
            reportSlot: updated.reportSlot,
          }),
          signal: AbortSignal.timeout(15_000),
        });
        if (res.ok) daemonRes = await res.json();
      } catch (e: any) {
        daemonRes = { daemonReachable: false, message: e?.message || "Desktop orchestrator daemon offline" };
      }

      return NextResponse.json({ ok: true, config: updated, daemonResponse: daemonRes });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "AI runtime error" }, { status: 500 });
  }
}
