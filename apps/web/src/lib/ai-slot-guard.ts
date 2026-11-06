export async function ensureAiSlotBeforeTask(
  requiredSlot: "strata_chat" | "kobold_report",
  taskDescription: string
): Promise<{ proceed: boolean; switched: boolean; message?: string }> {
  try {
    const stRes = await fetch("/api/ai/coach", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "daemon_status" }),
    });
    if (!stRes.ok) return { proceed: true, switched: false };
    const status = await stRes.json();

    const runningSlot: string = status.runningSlot || "none";
    const daemonState = status.daemonState || {};
    const autoSwitch = daemonState.autoSwitchOnDemand !== false;

    // If the required slot is already running and online, proceed immediately!
    if (runningSlot === requiredSlot && status.online) {
      return { proceed: true, switched: false };
    }

    if (!autoSwitch) {
      return { proceed: true, switched: false };
    }

    const targetName =
      requiredSlot === "strata_chat"
        ? "Slot 1 · Strata (Qwen3.8-Flash-Next)"
        : "Slot 2 · KoboldCPP (Reports & Audits)";
    const currentName =
      runningSlot === "strata_chat"
        ? "Slot 1 · Strata (Qwen3.8-Flash-Next)"
        : runningSlot === "kobold_report"
        ? "Slot 2 · KoboldCPP (Reports & Audits)"
        : "None (GPU Idle)";

    const confirmSwitch = window.confirm(
      `On-Demand GPU Slot Switch (${taskDescription}):\n\n` +
        `• Current GPU Engine: ${currentName}\n` +
        `• Required Engine: ${targetName}\n\n` +
        `Would you like to unload ${currentName} and load ${targetName} now?\n` +
        `(Click Cancel to abort the switch)`
    );

    if (!confirmSwitch) {
      return {
        proceed: false,
        switched: false,
        message: "Aborted GPU model switch.",
      };
    }

    const launchState =
      requiredSlot === "strata_chat"
        ? {
            engineType: "strata_chat",
            modelsDir: daemonState.strataModelsDir || "/run/media/mark/Storage 2/AI Models/",
            modelFile:
              daemonState.strataModelFile ||
              "Qwen3.8-Flash-Next-GSQ-RCO-IQ3_S-00001-of-00002.gguf",
            quantKv: daemonState.strataQuantKv || "int8",
            contextSize: daemonState.strataContextSize || 32768,
          }
        : {
            engineType: "kobold_report",
            modelsDir: daemonState.modelsDir || "~/koboldcpp/models/",
            modelFile: daemonState.modelFile || "Qwen3.8-27B-Q4_K_M.gguf",
            gpuLayers: daemonState.gpuLayers || 30,
            quantKv: daemonState.quantKv || "q8_0",
            contextSize: daemonState.contextSize || 32768,
            flashAttention: daemonState.flashAttention ?? true,
          };

    await fetch("/api/ai/coach", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "control_kobold",
        command: "start",
        launchState,
      }),
    });

    return {
      proceed: true,
      switched: true,
      message: `Switching GPU to ${targetName}...`,
    };
  } catch {
    return { proceed: true, switched: false };
  }
}
