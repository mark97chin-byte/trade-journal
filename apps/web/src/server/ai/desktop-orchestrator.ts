import { exec } from "child_process";
import { promisify } from "util";
import { getSetting, setSetting } from "@/server/settings";

const execAsync = promisify(exec);

export interface DiscoveredGgufModel {
  file: string;        // relative path from modelsFolder (always the -00001-of-0000N.gguf head file for shards)
  displayName: string; // e.g. "IQ3_S/Qwen3.8-Flash-Next... [5 shards · 50420.0 MB]"
  sizeMb: number;      // total summed size across all shards
  isSharded: boolean;
  shardCount: number;
}

export interface DualEngineState {
  activeLane: "chat" | "report";
  runningLane: "none" | "chat" | "report";
  autoSwitchOnDemand: boolean;
  idleUnloadMinutes: number;
  lastActivityAt: number;
  chatConfig: {
    endpointUrl: string;
    modelsFolder: string;
    activeModelFile: string;
    quantPreset: string;
    kvCacheType: "tq3_5s" | "tq3_0" | "q8_0" | "f16";
    vramBudgetGb: number;
    ctxSize: number;
    ngaOffload: boolean;
  };
  reportConfig: {
    endpointUrl: string;
    modelsFolder: string;
    activeModelFile: string;
    gpuLayers: number;
    kvCacheType: string;
    flashAttention: boolean;
  };
}

const STATE_KEY = "ai:unifiedDualLaneConfig:v1";

export function getDualEngineState(): DualEngineState {
  const raw = getSetting(STATE_KEY);
  const defaults: DualEngineState = {
    activeLane: "chat",
    runningLane: "none",
    autoSwitchOnDemand: true,
    idleUnloadMinutes: 30,
    lastActivityAt: Date.now(),
    chatConfig: {
      endpointUrl: "http://100.75.201.34:8081",
      modelsFolder: "~/koboldcpp/models",
      activeModelFile: "IQ3_S/Qwen3.8-Flash-Next-GSQ-RCO-IQ3_S-00001-of-00005.gguf",
      quantPreset: "IQ3_S (ISTA-DASLab GSQ-RCO)",
      kvCacheType: "tq3_5s",
      vramBudgetGb: 10.5,
      ctxSize: 32768,
      ngaOffload: true,
    },
    reportConfig: {
      endpointUrl: "http://100.75.201.34:5001",
      modelsFolder: "~/koboldcpp/models",
      activeModelFile: "Qwen3.8-27B-Q4_K_M.gguf",
      gpuLayers: 30,
      kvCacheType: "Q8_0",
      flashAttention: true,
    },
  };
  if (!raw) return defaults;
  try {
    const parsed = JSON.parse(raw);
    return {
      ...defaults,
      ...parsed,
      chatConfig: { ...defaults.chatConfig, ...(parsed.chatConfig || {}) },
      reportConfig: { ...defaults.reportConfig, ...(parsed.reportConfig || {}) },
    };
  } catch {
    return defaults;
  }
}

export function saveDualEngineState(next: Partial<DualEngineState>): DualEngineState {
  const cur = getDualEngineState();
  const merged: DualEngineState = {
    ...cur,
    ...next,
    chatConfig: { ...cur.chatConfig, ...(next.chatConfig || {}) },
    reportConfig: { ...cur.reportConfig, ...(next.reportConfig || {}) },
  };
  setSetting(STATE_KEY, JSON.stringify(merged));
  return merged;
}

/**
 * Groups raw GGUF file list (with relative path & size in bytes) so multi-part shards
 * (`...-00001-of-00005.gguf` .. `...-00005-of-00005.gguf`) collapse into a single selectable entry
 * pointing to shard 00001 with the summed total size!
 */
export function groupShardedGgufFiles(
  entries: Array<{ relPath: string; sizeBytes: number }>
): DiscoveredGgufModel[] {
  const shardRegex = /^(.*)-(\d{5})-of-(\d{5})\.gguf$/i;
  const groups = new Map<
    string,
    { headPath: string; totalBytes: number; count: number; expected: number }
  >();
  const singles: DiscoveredGgufModel[] = [];

  for (const item of entries) {
    const m = item.relPath.match(shardRegex);
    if (m) {
      const prefix = m[1]!;
      const partNum = parseInt(m[2]!, 10);
      const totalParts = parseInt(m[3]!, 10);
      const existing = groups.get(prefix) || {
        headPath: `${prefix}-00001-of-${m[3]}.gguf`,
        totalBytes: 0,
        count: 0,
        expected: totalParts,
      };
      if (partNum === 1) {
        existing.headPath = item.relPath;
      }
      existing.totalBytes += item.sizeBytes;
      existing.count += 1;
      groups.set(prefix, existing);
    } else {
      const sizeMb = Math.round((item.sizeBytes / (1024 * 1024)) * 10) / 10;
      singles.push({
        file: item.relPath,
        displayName: `${item.relPath} (${sizeMb} MB)`,
        sizeMb,
        isSharded: false,
        shardCount: 1,
      });
    }
  }

  const shardedList: DiscoveredGgufModel[] = [];
  for (const [, grp] of groups.entries()) {
    const sizeMb = Math.round((grp.totalBytes / (1024 * 1024)) * 10) / 10;
    const sizeGb = (sizeMb / 1024).toFixed(1);
    shardedList.push({
      file: grp.headPath,
      displayName: `${grp.headPath} [Sharded · ${grp.count}/${grp.expected} parts · ${sizeGb} GB]`,
      sizeMb,
      isSharded: true,
      shardCount: grp.count,
    });
  }

  return [...shardedList, ...singles].sort((a, b) => a.file.localeCompare(b.file));
}
