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
  const rawRepo = (targetDev.repoPath || (isWin ? "trade-journal-dev" : "~/trade-journal-dev")).trim();
  const sshHost = targetDev.sshTarget;

  // Locate the authoritative mt5_notion_sync_wine.py on the Tablet to keep desktops in sync
  const localPyCandidates = [
    path.resolve(process.cwd(), "mt5_notion_sync_wine.py"),
    path.resolve(process.cwd(), "..", "..", "mt5_notion_sync_wine.py"),
    path.resolve(process.env.HOME || "", "trade-journal-dev", "mt5_notion_sync_wine.py"),
    path.resolve(process.env.HOME || "", "trade-journal", "mt5_notion_sync_wine.py"),
  ];
  const localPyScript = localPyCandidates.find((p) => fs.existsSync(p)) || null;

  let remoteCmd = "";
  let remoteDbCandidates: string[] = [];

  if (isWin) {
    const cleanWinRepo = rawRepo.replace(/^~[\\/]+/, "");
    // 1. Push latest mt5_notion_sync_wine.py to Windows so Windows never runs outdated Python code
    if (localPyScript) {
      await execShell(
        `scp -o BatchMode=yes -o StrictHostKeyChecking=accept-new "${localPyScript}" "${sshHost}:F:/trade-journal-dev/trade-journal/mt5_notion_sync_wine.py"`,
        15_000
      );
    }
    // 2. Wipe any stale/broken local staging journal.db on Windows (both F: and C:) before extracting live MT5 deals
    const cleanWinDbCmd = `del /f /q "F:\\trade-journal-dev\\trade-journal\\apps\\web\\data\\journal.db*" "%USERPROFILE%\\trade-journal-dev\\data\\journal.db*" >nul 2>&1`;
    remoteCmd = `${cleanWinDbCmd} & if exist "F:\\trade-journal-dev\\trade-journal\\sync-mt5.bat" (cd /d "F:\\trade-journal-dev\\trade-journal" && call sync-mt5.bat --no-push) else if exist "%USERPROFILE%\\${cleanWinRepo}\\sync-mt5.bat" (cd /d "%USERPROFILE%\\${cleanWinRepo}" && call sync-mt5.bat --no-push) else (cd /d "F:\\trade-journal-dev\\trade-journal" && python mt5_notion_sync_wine.py --no-push)`;
    remoteDbCandidates = [
      `${sshHost}:trade-journal-dev/data/journal.db`,
      `${sshHost}:F:/trade-journal-dev/trade-journal/apps/web/data/journal.db`,
      `${sshHost}:trade-journal-dev/apps/web/data/journal.db`,
    ];
  } else {
    if (localPyScript) {
      await execShell(
        `scp -o BatchMode=yes -o StrictHostKeyChecking=accept-new "${localPyScript}" "${sshHost}:${rawRepo}/mt5_notion_sync_wine.py"`,
        15_000
      );
    }
    remoteCmd = `cd ${rawRepo} && rm -f apps/web/data/journal.db* data/journal.db* && ./sync-mt5.sh --no-push`;
    remoteDbCandidates = [
      `${sshHost}:${rawRepo}/apps/web/data/journal.db`,
      `${sshHost}:${rawRepo}/data/journal.db`,
    ];
  }

  const fullSshCmd = `ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=5 ${sshHost} "${remoteCmd}"`;
  const execRes = await execShell(fullSshCmd, 90_000);
  if (execRes.code !== 0) {
    return {
      ok: false,
      log: `[Error on ${targetDev.name}] Exit ${execRes.code}: ${execRes.stderr || execRes.stdout}`,
    };
  }

  let scpOk = false;
  let lastScpErr = "";
  for (const candidate of remoteDbCandidates) {
    const scpRes = await execShell(
      `scp -o BatchMode=yes -o StrictHostKeyChecking=accept-new "${candidate}" "${stagingDbPath}"`,
      30_000
    );
    if (scpRes.code === 0 && fs.existsSync(stagingDbPath) && fs.statSync(stagingDbPath).size > 0) {
      scpOk = true;
      break;
    }
    lastScpErr = scpRes.stderr || scpRes.stdout;
  }

  if (!scpOk) {
    return {
      ok: false,
      log: `${execRes.stdout}\n[SCP Error] Failed to retrieve journal.db: ${lastScpErr}`,
    };
  }

  return {
    ok: true,
    log: `${execRes.stdout}\n[Success] Retrieved and synchronized database from ${targetDev.name}!`,
  };
}

function createPreSyncBackup(targetDbPath: string) {
  try {
    if (!fs.existsSync(targetDbPath)) return;
    const backupDir = path.join(path.dirname(targetDbPath), "backups");
    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const dest = path.join(backupDir, `journal.pre_sync_${stamp}.db`);
    fs.copyFileSync(targetDbPath, dest);

    const files = fs
      .readdirSync(backupDir)
      .filter((f) => f.startsWith("journal.pre_sync_") && f.endsWith(".db"))
      .sort()
      .reverse();
    for (const oldFile of files.slice(5)) {
      try {
        fs.unlinkSync(path.join(backupDir, oldFile));
      } catch {}
    }
  } catch {}
}

function mergeStagingDb(targetDbPath: string, stagingDbPath: string): { tradesMerged: number; accountsSynced: number } {
  createPreSyncBackup(targetDbPath);

  const conn = new Database(targetDbPath);
  try {
    conn.exec("PRAGMA wal_checkpoint(PASSIVE);");
    conn.exec(`ATTACH DATABASE '${stagingDbPath}' AS stg;`);

    const getSharedCols = (tableName: string): string[] => {
      const mainCols = (conn.prepare(`PRAGMA main.table_info(${tableName})`).all() as Array<{ name: string }>).map(
        (c) => c.name
      );
      const stgCols = new Set(
        (conn.prepare(`PRAGMA stg.table_info(${tableName})`).all() as Array<{ name: string }>).map((c) => c.name)
      );
      return mainCols.filter((c) => stgCols.has(c));
    };

    // 1. Multi-Account MT5 Resolution:
    //    - If stg has 'mt5-main' (Login #2853845) or a new 'mt5-<login>' account, auto-create it if not present!
    //    - Never force a different MT5 account's trades into 'mt5-main'.
    let accountsSynced = 0;
    try {
      const sharedAccCols = getSharedCols("accounts");
      if (sharedAccCols.length > 0) {
        const beforeAccs = (conn.prepare("SELECT COUNT(*) as c FROM main.accounts").get() as any)?.c || 0;
        const colList = sharedAccCols.join(", ");
        conn.exec(`
          INSERT OR IGNORE INTO main.accounts (${colList})
          SELECT ${colList} FROM stg.accounts;
        `);
        const afterAccs = (conn.prepare("SELECT COUNT(*) as c FROM main.accounts").get() as any)?.c || 0;
        accountsSynced = Math.max(0, afterAccs - beforeAccs);
      }
    } catch {}

    // 2. Schema-agnostic upsert of executions (preserves each execution's account_id)
    const sharedExecCols = getSharedCols("executions");
    if (sharedExecCols.length > 0) {
      const execColList = sharedExecCols.join(", ");
      conn.exec(`
        INSERT OR REPLACE INTO main.executions (${execColList})
        SELECT ${execColList} FROM stg.executions;
      `);
    }

    // 3. Schema-agnostic, account-scoped signature-deduplicated merge of trades
    const sharedTradeCols = getSharedCols("trades");
    const stgTrades = conn.prepare("SELECT * FROM stg.trades").all() as any[];

    const mainTrades = conn
      .prepare("SELECT key, account_id, symbol, direction, opened_at, closed_at, quantity, avg_entry, net_pnl FROM main.trades")
      .all() as any[];

    // Include account_id in signature so same-account duplicates are blocked while separate MT5 accounts stay independent
    const makeSig = (r: any) =>
      `${String(r.account_id || "mt5-main").trim()}|${String(r.symbol || "").trim()}|${String(r.direction || "").trim().toLowerCase()}|${String(r.opened_at || "").slice(0, 16)}|${Number(r.quantity || 0).toFixed(2)}|${Number(r.net_pnl || 0).toFixed(2)}`;

    const existingByKey = new Set(mainTrades.map((t) => String(t.key)));
    const existingKeyBySig = new Map<string, string>();
    for (const t of mainTrades) {
      existingKeyBySig.set(makeSig(t), String(t.key));
    }

    const telemetryUpdateCols = [
      "account_id", "opened_at", "closed_at", "status", "avg_entry", "avg_exit", "quantity", "open_quantity",
      "gross_pnl", "fees", "net_pnl", "execution_count", "execution_ids_json", "exits_json",
      "duration_ms", "partials_breakdown", "exit_reason", "tickets", "risk_percent"
    ].filter((c) => sharedTradeCols.includes(c));

    const coalesceCols = ["realized_r", "planned_r", "mae_r", "mfe_r", "capture_eff", "notion_page_id", "notion_url"]
      .filter((c) => sharedTradeCols.includes(c));

    const tx = conn.transaction(() => {
      for (const stgRow of stgTrades) {
        const sig = makeSig(stgRow);
        const targetKey = existingByKey.has(String(stgRow.key))
          ? String(stgRow.key)
          : existingKeyBySig.get(sig) || null;

        if (targetKey) {
          const setClauses: string[] = [];
          const params: any[] = [];
          for (const col of telemetryUpdateCols) {
            setClauses.push(`${col} = ?`);
            params.push(stgRow[col]);
          }
          for (const col of coalesceCols) {
            setClauses.push(`${col} = COALESCE(?, ${col})`);
            params.push(stgRow[col]);
          }
          if (setClauses.length > 0) {
            params.push(targetKey);
            conn.prepare(`UPDATE main.trades SET ${setClauses.join(", ")} WHERE key = ?`).run(...params);
          }
        } else {
          const insertCols = sharedTradeCols.filter((c) => stgRow[c] !== undefined);
          const placeholders = insertCols.map(() => "?").join(", ");
          const values = insertCols.map((c) => stgRow[c]);
          conn
            .prepare(`INSERT OR IGNORE INTO main.trades (${insertCols.join(", ")}) VALUES (${placeholders})`)
            .run(...values);
          existingByKey.add(String(stgRow.key));
          existingKeyBySig.set(sig, String(stgRow.key));
        }
      }
    });
    tx();

    conn.exec("DETACH DATABASE stg;");
    conn.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    return { tradesMerged: stgTrades.length, accountsSynced };
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
