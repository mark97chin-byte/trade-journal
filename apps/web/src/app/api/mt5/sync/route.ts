import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import os from "os";
import net from "net";

export const dynamic = "force-dynamic";

export interface SyncDevice {
  id: string;
  name: string;
  sshTarget: string; // e.g. mark@100.75.201.34
  osType: "linux" | "windows";
  repoPath?: string;
  enabled: boolean;
}

export interface Mt5SyncSettings {
  selectedDeviceId: string; // "auto_cycle" or a specific device id
  autoCycle: boolean;
  schedule: "manual" | "15m" | "1h" | "4h" | "daily";
  devices: SyncDevice[];
  lastSyncAt?: string;
  lastSyncDevice?: string;
  lastSyncStatus?: string;
}

const DEFAULT_SYNC_SETTINGS: Mt5SyncSettings = {
  selectedDeviceId: "auto_cycle",
  autoCycle: true,
  schedule: "manual",
  devices: [
    {
      id: "fedora-desktop",
      name: "Fedora Linux Desktop",
      sshTarget: "mark@100.75.201.34",
      osType: "linux",
      repoPath: "~/trade-journal-dev",
      enabled: true,
    },
    {
      id: "fedora-laptop",
      name: "Fedora Laptop",
      sshTarget: "mark@100.89.85.57",
      osType: "linux",
      repoPath: "~/trade-journal-dev",
      enabled: true,
    },
    {
      id: "windows-desktop",
      name: "Windows Desktop",
      sshTarget: "mark@100.110.7.93",
      osType: "windows",
      repoPath: "trade-journal-dev",
      enabled: true,
    },
  ],
};

function resolveDbPath(): string {
  const dbPath = path.resolve(process.cwd(), "data", "journal.db");
  const altDbPath = path.resolve(process.cwd(), "apps", "web", "data", "journal.db");
  return fs.existsSync(dbPath) ? dbPath : altDbPath;
}

function loadSyncSettings(): Mt5SyncSettings {
  try {
    const dbPath = resolveDbPath();
    if (!fs.existsSync(dbPath)) return DEFAULT_SYNC_SETTINGS;
    const db = new Database(dbPath, { readonly: true });
    try {
      const row = db
        .prepare("SELECT value_json FROM journal_kv_settings WHERE key = 'mt5_sync_settings'")
        .get() as { value_json: string } | undefined;
      return row ? { ...DEFAULT_SYNC_SETTINGS, ...JSON.parse(row.value_json) } : DEFAULT_SYNC_SETTINGS;
    } finally {
      db.close();
    }
  } catch {
    return DEFAULT_SYNC_SETTINGS;
  }
}

function saveSyncSettings(settings: Mt5SyncSettings) {
  try {
    const dbPath = resolveDbPath();
    if (!fs.existsSync(dbPath)) return;
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
        VALUES ('mt5_sync_settings', ?)
        ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json
      `).run(JSON.stringify(settings));
    } finally {
      db.close();
    }
  } catch {}
}

function checkTcpPort(host: string, port = 22, timeoutMs = 1200): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let called = false;
    socket.setTimeout(timeoutMs);

    const done = (ok: boolean) => {
      if (!called) {
        called = true;
        socket.destroy();
        resolve(ok);
      }
    };

    socket.on("connect", () => done(true));
    socket.on("timeout", () => done(false));
    socket.on("error", () => done(false));
    socket.connect(port, host);
  });
}

function execShell(cmd: string, timeoutMs = 90_000): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    exec(cmd, { timeout: timeoutMs, env: { ...process.env } }, (error, stdout, stderr) => {
      resolve({
        stdout: String(stdout || ""),
        stderr: String(stderr || ""),
        code: error ? (error as any).code || 1 : 0,
      });
    });
  });
}

function extractHost(target: string): string {
  const parts = target.split("@");
  const host = parts[1] ?? target;
  return host.trim();
}

function isLocalMachine(target: string, selfIps: string[]): boolean {
  const host = extractHost(target);
  if (["localhost", "127.0.0.1", os.hostname()].includes(host)) return true;
  return selfIps.includes(host);
}

function findLocalSyncScript(): string | null {
  const candidates = [
    path.resolve(process.cwd(), "sync-mt5.sh"),
    path.resolve(process.cwd(), "..", "..", "sync-mt5.sh"),
    path.resolve(process.env.HOME || "", "trade-journal-dev", "sync-mt5.sh"),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

async function discoverTailscalePeers(): Promise<{
  selfHostname: string;
  selfIps: string[];
  mode: "cli" | "direct_probe";
  peers: Array<{
    hostname: string;
    dnsName: string;
    ip: string;
    os: string;
    online: boolean;
    isSelf: boolean;
    sshReachable?: boolean;
    latencyMs?: number;
  }>;
}> {
  const localHn = os.hostname();
  const settings = loadSyncSettings();

  const cliResult = await new Promise<any>((resolve) => {
    exec("tailscale status --json", { timeout: 3500 }, (err, stdout) => {
      if (err || !stdout) return resolve(null);
      try {
        resolve(JSON.parse(stdout));
      } catch {
        resolve(null);
      }
    });
  });

  if (cliResult && (cliResult.Peer || cliResult.Self)) {
    const selfNode = cliResult.Self || {};
    const selfIps: string[] = selfNode.TailscaleIPs || [];
    const peerMap = cliResult.Peer || {};
    const rawPeers = Object.values(peerMap) as any[];

    const peers = await Promise.all(
      rawPeers.map(async (p) => {
        const ip = (p.TailscaleIPs || [])[0] || "";
        const hn = p.HostName || ip;
        const online = Boolean(p.Online);
        let sshOk = false;
        if (online && ip) {
          sshOk = await checkTcpPort(ip, 22, 1200);
        }
        return {
          hostname: hn,
          dnsName: (p.DNSName || "").replace(/\.$/, ""),
          ip,
          os: p.OS || "unknown",
          online,
          isSelf: false,
          sshReachable: sshOk,
        };
      })
    );

    if (selfNode.HostName) {
      peers.unshift({
        hostname: selfNode.HostName,
        dnsName: (selfNode.DNSName || "").replace(/\.$/, ""),
        ip: selfIps[0] || "127.0.0.1",
        os: selfNode.OS || os.platform(),
        online: true,
        isSelf: true,
        sshReachable: Boolean(findLocalSyncScript()),
      });
    }

    return { selfHostname: selfNode.HostName || localHn, selfIps, mode: "cli", peers };
  }

  // Fallback for Android / Termux: probe configured machines directly
  const directPeers = await Promise.all(
    (settings.devices || []).map(async (dev) => {
      const host = extractHost(dev.sshTarget);
      const isSelf = isLocalMachine(dev.sshTarget, []);
      const t0 = Date.now();
      const reachable = isSelf ? true : await checkTcpPort(host, 22, 1200);
      const latencyMs = Date.now() - t0;

      return {
        hostname: dev.name,
        dnsName: dev.sshTarget,
        ip: host,
        os: dev.osType,
        online: reachable,
        isSelf,
        sshReachable: reachable,
        latencyMs: reachable ? latencyMs : undefined,
      };
    })
  );

  return { selfHostname: localHn, selfIps: [], mode: "direct_probe", peers: directPeers };
}

async function runRemoteSyncOnDevice(
  targetDev: SyncDevice,
  stagingDbPath: string
): Promise<{ ok: boolean; log: string }> {
  const isWin = targetDev.osType === "windows";
  const repo = targetDev.repoPath || (isWin ? "trade-journal-dev" : "~/trade-journal-dev");
  const sshHost = targetDev.sshTarget;

  let remoteCmd = "";
  let remoteDbPath = "";

  if (isWin) {
    remoteCmd = `cd /d "%USERPROFILE%\\${repo}" && if exist sync-mt5.bat (call sync-mt5.bat --no-push) else (python mt5_notion_sync_wine.py --no-push)`;
    remoteDbPath = `${sshHost}:trade-journal-dev/apps/web/data/journal.db`;
  } else {
    remoteCmd = `cd "${repo}" && ./sync-mt5.sh --no-push`;
    remoteDbPath = `${sshHost}:${repo}/apps/web/data/journal.db`;
  }

  const fullSshCmd = `ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=5 ${sshHost} "${remoteCmd}"`;
  const execRes = await execShell(fullSshCmd, 90_000);
  if (execRes.code !== 0) {
    return {
      ok: false,
      log: `[Error on ${targetDev.name}] Exit ${execRes.code}: ${execRes.stderr || execRes.stdout}`,
    };
  }

  const scpCmd = `scp -o BatchMode=yes -o StrictHostKeyChecking=accept-new "${remoteDbPath}" "${stagingDbPath}"`;
  let scpRes = await execShell(scpCmd, 30_000);

  if (scpRes.code !== 0) {
    const altRemoteDb = isWin
      ? `${sshHost}:trade-journal-dev/data/journal.db`
      : `${sshHost}:${repo}/data/journal.db`;
    scpRes = await execShell(`scp -o BatchMode=yes "${altRemoteDb}" "${stagingDbPath}"`, 30_000);
    if (scpRes.code !== 0) {
      return {
        ok: false,
        log: `${execRes.stdout}\n[SCP Error] Failed to retrieve journal.db: ${scpRes.stderr}`,
      };
    }
  }

  return {
    ok: true,
    log: `${execRes.stdout}\n[Success] Retrieved and synchronized database from ${targetDev.name}!`,
  };
}

function mergeStagingDb(targetDbPath: string, stagingDbPath: string): { tradesMerged: number; accountsSynced: number } {
  const conn = new Database(targetDbPath);
  try {
    conn.exec("PRAGMA wal_checkpoint(PASSIVE);");
    conn.exec(`ATTACH DATABASE '${stagingDbPath}' AS stg;`);

    // 1. Automatically create any new MT5 accounts (e.g. Stage 2 prop firm or new account login)
    let accountsSynced = 0;
    try {
      const stgAccounts = conn.prepare("SELECT * FROM stg.accounts").all() as any[];
      const importCols = (conn.prepare("PRAGMA main.table_info(accounts)").all() as Array<{ name: string }>).map(
        (c) => c.name
      );
      for (const acc of stgAccounts) {
        const exists = conn.prepare("SELECT id FROM main.accounts WHERE id = ?").get(acc.id);
        if (!exists && importCols.length > 0) {
          const validKeys = Object.keys(acc).filter((k) => importCols.includes(k));
          const placeholders = validKeys.map(() => "?").join(", ");
          conn
            .prepare(`INSERT OR IGNORE INTO main.accounts (${validKeys.join(", ")}) VALUES (${placeholders})`)
            .run(...validKeys.map((k) => acc[k]));
          accountsSynced += 1;
        }
      }
    } catch {}

    // 2. Upsert executions without wiping historical accounts
    conn.exec(`
      INSERT OR REPLACE INTO main.executions
      SELECT * FROM stg.executions;
    `);

    const rows = conn
      .prepare(`
        SELECT key, opened_at, closed_at, avg_entry, avg_exit, quantity,
               gross_pnl, net_pnl, execution_ids_json, exits_json,
               partials_breakdown, realized_r, mae_r, mfe_r, capture_eff,
               notion_page_id, notion_url
        FROM stg.trades
      `)
      .all() as any[];

    const upd = conn.prepare(`
      UPDATE main.trades
      SET
        opened_at = ?, closed_at = ?, avg_entry = ?, avg_exit = ?, quantity = ?,
        gross_pnl = ?, net_pnl = ?, execution_ids_json = ?, exits_json = ?,
        partials_breakdown = ?, realized_r = COALESCE(?, realized_r),
        mae_r = COALESCE(?, mae_r), mfe_r = COALESCE(?, mfe_r),
        capture_eff = COALESCE(?, capture_eff), notion_page_id = COALESCE(?, notion_page_id),
        notion_url = COALESCE(?, notion_url)
      WHERE key = ?
    `);

    for (const r of rows) {
      upd.run(
        r.opened_at, r.closed_at, r.avg_entry, r.avg_exit, r.quantity,
        r.gross_pnl, r.net_pnl, r.execution_ids_json, r.exits_json,
        r.partials_breakdown, r.realized_r, r.mae_r, r.mfe_r,
        r.capture_eff, r.notion_page_id, r.notion_url, r.key
      );
    }

    conn.exec(`
      INSERT OR IGNORE INTO main.trades
      SELECT * FROM stg.trades;
    `);

    conn.exec("DETACH DATABASE stg;");
    conn.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    return { tradesMerged: rows.length, accountsSynced };
  } finally {
    conn.close();
  }
}

export async function GET() {
  try {
    const settings = loadSyncSettings();
    const tailscale = await discoverTailscalePeers();
    return NextResponse.json({ ok: true, settings, tailscale });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const settings = loadSyncSettings();
    const dbPath = resolveDbPath();
    const dataDir = path.dirname(dbPath);
    const stagingDb = path.join(dataDir, `mt5_sync_staging_${Date.now()}.db`);

    if (body.action === "save_settings") {
      const nextSettings: Mt5SyncSettings = {
        ...settings,
        selectedDeviceId: body.selectedDeviceId || settings.selectedDeviceId,
        autoCycle: body.autoCycle !== undefined ? Boolean(body.autoCycle) : settings.autoCycle,
        schedule: body.schedule || settings.schedule,
        devices: Array.isArray(body.devices) ? body.devices : settings.devices,
      };
      saveSyncSettings(nextSettings);
      return NextResponse.json({ ok: true, settings: nextSettings });
    }

    let devicesToTry: SyncDevice[] = [];
    if (settings.selectedDeviceId && settings.selectedDeviceId !== "auto_cycle") {
      const pinned = settings.devices.find((d) => d.id === settings.selectedDeviceId && d.enabled);
      if (pinned) devicesToTry.push(pinned);
    }

    if (devicesToTry.length === 0) {
      devicesToTry = settings.devices.filter((d) => d.enabled);
    }

    if (devicesToTry.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No enabled sync devices configured in settings." },
        { status: 400 }
      );
    }

    let combinedLog = "";
    let syncSuccess = false;
    let successfulDevice = "";

    for (const dev of devicesToTry) {
      const host = extractHost(dev.sshTarget);
      combinedLog += `[Probe] Checking ${dev.name} (${dev.sshTarget}:22)...\n`;

      const reachable = await checkTcpPort(host, 22, 1200);
      if (!reachable) {
        combinedLog += `[Skip] ${dev.name} (${host}:22) is offline or sshd is closed. Trying next device...\n`;
        continue;
      }

      combinedLog += `[Connect] ${dev.name} is online! Running remote MT5 sync...\n`;
      const res = await runRemoteSyncOnDevice(dev, stagingDb);
      combinedLog += res.log + "\n";

      if (res.ok && fs.existsSync(stagingDb)) {
        try {
          const mergeInfo = mergeStagingDb(dbPath, stagingDb);
          combinedLog += `[Database] Merged ${mergeInfo.tradesMerged} setups (${(mergeInfo as any).accountsSynced || 0} new account(s) auto-created) into active SQLite journal!\n`;
          syncSuccess = true;
          successfulDevice = dev.name;
          break;
        } finally {
          if (fs.existsSync(stagingDb)) {
            try { fs.unlinkSync(stagingDb); } catch {}
          }
        }
      }
    }

    const updatedSettings: Mt5SyncSettings = {
      ...settings,
      lastSyncAt: new Date().toISOString(),
      lastSyncDevice: successfulDevice || "None",
      lastSyncStatus: syncSuccess ? "Success" : "Failed",
    };
    saveSyncSettings(updatedSettings);

    if (fs.existsSync(stagingDb)) {
      try { fs.unlinkSync(stagingDb); } catch {}
    }

    return NextResponse.json({
      ok: syncSuccess,
      log: combinedLog,
      settings: updatedSettings,
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message }, { status: 500 });
  }
}
