import { NextRequest, NextResponse } from "next/server";
import Database from "better-sqlite3";
import crypto from "crypto";
import { exec } from "child_process";
import path from "path";
import fs from "fs";

export const dynamic = "force-dynamic";

export interface GDriveBackupConfig {
  rcloneRemotePath: string;
  keepCount: number;
  schedule: "manual" | "6h" | "daily" | "on_sync";
  includeCandlesDb: boolean;
  lastBackupAt?: string;
  lastBackupHash?: string;
  lastBackupStatus?: string;
}

export interface SnapshotItem {
  filename: string;
  createdAt: string;
  sizeBytes: number;
  sha256: string;
  location: "local+gdrive" | "local";
}

const DEFAULT_GDRIVE_CONFIG: GDriveBackupConfig = {
  rcloneRemotePath: "gdrive:TradeJournalBackups",
  keepCount: 3,
  schedule: "daily",
  includeCandlesDb: false,
};

function resolveDbPath(): string {
  const dbPath = path.resolve(process.cwd(), "data", "journal.db");
  const altDbPath = path.resolve(process.cwd(), "apps", "web", "data", "journal.db");
  return fs.existsSync(dbPath) ? dbPath : altDbPath;
}

function resolveBackupsDir(): string {
  const dir = path.resolve(path.dirname(resolveDbPath()), "backups");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function loadGDriveConfig(): GDriveBackupConfig {
  try {
    const dbPath = resolveDbPath();
    if (!fs.existsSync(dbPath)) return DEFAULT_GDRIVE_CONFIG;
    const db = new Database(dbPath);
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS journal_kv_settings (
          key TEXT PRIMARY KEY,
          value_json TEXT NOT NULL
        )
      `);
      const row = db
        .prepare(`SELECT value_json FROM journal_kv_settings WHERE key = 'gdrive_backup_config'`)
        .get() as { value_json: string } | undefined;
      return row ? { ...DEFAULT_GDRIVE_CONFIG, ...JSON.parse(row.value_json) } : DEFAULT_GDRIVE_CONFIG;
    } finally {
      db.close();
    }
  } catch {
    return DEFAULT_GDRIVE_CONFIG;
  }
}

function saveGDriveConfig(cfg: GDriveBackupConfig) {
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
        VALUES ('gdrive_backup_config', ?)
        ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json
      `).run(JSON.stringify(cfg));
    } finally {
      db.close();
    }
  } catch {}
}

function computeFileHash(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex").slice(0, 12)));
    stream.on("error", reject);
  });
}

function execShell(cmd: string, timeoutMs = 120_000): Promise<{ stdout: string; stderr: string; code: number }> {
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

function listLocalSnapshots(): SnapshotItem[] {
  const dir = resolveBackupsDir();
  if (!fs.existsSync(dir)) return [];
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith("tj-snapshot-") && (f.endsWith(".tar.gz") || f.endsWith(".json.gz")));

  const items: SnapshotItem[] = files.map((filename) => {
    const full = path.join(dir, filename);
    const stat = fs.statSync(full);
    const hashMatch = filename.match(/_([a-f0-9]{12})\.(tar|json)\.gz$/);
    return {
      filename,
      createdAt: stat.mtime.toISOString(),
      sizeBytes: stat.size,
      sha256: hashMatch?.[1] || "unknown",
      location: "local",
    };
  });

  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function pruneOldSnapshots(backupsDir: string, keepLimit = 3): string[] {
  const allSnapshots = listLocalSnapshots();
  const deleted: string[] = [];
  if (allSnapshots.length > keepLimit) {
    const toDelete = allSnapshots.slice(keepLimit);
    for (const item of toDelete) {
      try {
        const fullPath = path.join(backupsDir, item.filename);
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
          deleted.push(item.filename);
        }
      } catch {}
    }
  }
  return deleted;
}

async function syncBackupsDirToRcloneOrDrive(
  backupsDir: string,
  remoteTarget: string
): Promise<{ synced: boolean; log: string }> {
  if (!remoteTarget.trim()) {
    return { synced: false, log: "No Google Drive remote configured (saved locally)." };
  }

  if (remoteTarget.startsWith("/") || remoteTarget.startsWith("~/")) {
    const resolvedDest = remoteTarget.startsWith("~/")
      ? path.join(process.env.HOME || "/home/mark", remoteTarget.slice(2))
      : remoteTarget;
    try {
      if (!fs.existsSync(resolvedDest)) fs.mkdirSync(resolvedDest, { recursive: true });
      const localFiles = new Set(
        fs.readdirSync(backupsDir).filter((f) => f.endsWith(".tar.gz") || f.endsWith(".json.gz"))
      );
      for (const f of localFiles) {
        fs.copyFileSync(path.join(backupsDir, f), path.join(resolvedDest, f));
      }
      for (const existing of fs.readdirSync(resolvedDest)) {
        if (existing.startsWith("tj-snapshot-") && !localFiles.has(existing)) {
          fs.unlinkSync(path.join(resolvedDest, existing));
        }
      }
      return { synced: true, log: `Mirrored rolling snapshots to ${resolvedDest}` };
    } catch (err: any) {
      return { synced: false, log: `Local folder mirror notice: ${err?.message}` };
    }
  }

  return new Promise((resolve) => {
    exec(
      `rclone sync "${backupsDir}" "${remoteTarget}" --include "tj-snapshot-*.tar.gz" --include "tj-snapshot-*.json.gz"`,
      { timeout: 180_000 },
      (err, stdout, stderr) => {
        if (err) {
          resolve({
            synced: false,
            log: `Saved locally. (rclone warning: ${(stderr || err.message).trim()})`,
          });
        } else {
          resolve({
            synced: true,
            log: `Synced rolling snapshots to Google Drive (${remoteTarget})! ${stdout.trim()}`,
          });
        }
      }
    );
  });
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const downloadFile = url.searchParams.get("download");
    if (downloadFile) {
      const safeName = path.basename(downloadFile);
      const fullPath = path.join(resolveBackupsDir(), safeName);
      if (!fs.existsSync(fullPath)) {
        return NextResponse.json({ ok: false, error: "Snapshot not found" }, { status: 404 });
      }
      const stat = fs.statSync(fullPath);
      const stream = fs.createReadStream(fullPath);
      return new NextResponse(stream as any, {
        headers: {
          "Content-Type": "application/gzip",
          "Content-Length": String(stat.size),
          "Content-Disposition": `attachment; filename="${safeName}"`,
        },
      });
    }

    const config = loadGDriveConfig();
    const backupsDir = resolveBackupsDir();
    pruneOldSnapshots(backupsDir, config.keepCount || 3);
    const snapshots = listLocalSnapshots();
    return NextResponse.json({ ok: true, config, snapshots });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "Failed to load Google Drive backup status" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const config = loadGDriveConfig();

    if (body.action === "save_config") {
      const next: GDriveBackupConfig = {
        ...config,
        rcloneRemotePath:
          body.rcloneRemotePath !== undefined
            ? String(body.rcloneRemotePath).trim()
            : config.rcloneRemotePath,
        keepCount: Math.max(1, Math.min(10, Number(body.keepCount || config.keepCount || 3))),
        schedule: body.schedule || config.schedule,
        includeCandlesDb:
          body.includeCandlesDb !== undefined
            ? Boolean(body.includeCandlesDb)
            : config.includeCandlesDb,
      };
      saveGDriveConfig(next);
      const backupsDir = resolveBackupsDir();
      pruneOldSnapshots(backupsDir, next.keepCount || 3);
      void syncBackupsDirToRcloneOrDrive(backupsDir, next.rcloneRemotePath).catch(() => {});
      return NextResponse.json({
        ok: true,
        config: next,
        snapshots: listLocalSnapshots(),
        message: "Google Drive backup configuration saved.",
      });
    }

    if (body.action === "create_snapshot") {
      const force = Boolean(body.force);
      const dbPath = resolveDbPath();
      const dataDir = path.dirname(dbPath);
      const backupsDir = resolveBackupsDir();

      if (!fs.existsSync(dbPath)) {
        return NextResponse.json({ ok: false, error: "Database file not found." }, { status: 404 });
      }

      const stagingDir = path.join(backupsDir, `.tmp_stage_${Date.now()}`);
      fs.mkdirSync(stagingDir, { recursive: true });
      const stagedDb = path.join(stagingDir, "journal.db");

      try {
        // 1. Create clean SQLite snapshot on disk using atomic VACUUM INTO
        const vacRes = await execShell(`sqlite3 "${dbPath}" "VACUUM INTO '${stagedDb}'"`);
        if (vacRes.code !== 0 || !fs.existsSync(stagedDb)) {
          // Fallback to online .backup if VACUUM INTO fails
          await execShell(`sqlite3 "${dbPath}" ".backup '${stagedDb}'"`);
        }

        // 2. Stream-hash the database to detect incremental changes (<64KB RAM)
        const contentHash = await computeFileHash(stagedDb);

        if (!force && config.lastBackupHash === contentHash && listLocalSnapshots().length > 0) {
          fs.rmSync(stagingDir, { recursive: true, force: true });
          return NextResponse.json({
            ok: true,
            skipped: true,
            config,
            snapshots: listLocalSnapshots(),
            message: `No changes detected since last snapshot (hash ${contentHash}). Incremental backup skipped.`,
          });
        }

        // 3. Package archive using native tar-streaming (<25MB RAM)
        const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        const filename = `tj-snapshot-${ts}_${contentHash}.tar.gz`;
        const fullPath = path.join(backupsDir, filename);

        const attDir = path.join(dataDir, "attachments");
        const hasAttachments = fs.existsSync(attDir) && fs.readdirSync(attDir).length > 0;

        let tarCmd = `tar -czf "${fullPath}" -C "${stagingDir}" journal.db`;
        if (hasAttachments) {
          tarCmd += ` -C "${dataDir}" attachments`;
        }
        const candleDbFile = path.join(dataDir, "market_candles.db");
        if (config.includeCandlesDb && fs.existsSync(candleDbFile)) {
          tarCmd += ` -C "${dataDir}" market_candles.db`;
        }

        const tarRes = await execShell(tarCmd);
        if (tarRes.code !== 0 || !fs.existsSync(fullPath)) {
          throw new Error(`tar archive creation failed: ${tarRes.stderr || tarRes.stdout}`);
        }

        // Clean up temporary stage directory
        fs.rmSync(stagingDir, { recursive: true, force: true });

        // 4. Prune older local snapshots beyond keepCount
        const allSnapshots = listLocalSnapshots();
        const keepLimit = Math.max(1, config.keepCount || 3);
        if (allSnapshots.length > keepLimit) {
          const toDelete = allSnapshots.slice(keepLimit);
          for (const oldItem of toDelete) {
            try {
              fs.unlinkSync(path.join(backupsDir, oldItem.filename));
            } catch {}
          }
        }

        // 5. Sync to Google Drive via rclone
        const syncRes = await syncBackupsDirToRcloneOrDrive(backupsDir, config.rcloneRemotePath);

        const updatedCfg: GDriveBackupConfig = {
          ...config,
          lastBackupAt: new Date().toISOString(),
          lastBackupHash: contentHash,
          lastBackupStatus: syncRes.log,
        };
        saveGDriveConfig(updatedCfg);

        return NextResponse.json({
          ok: true,
          config: updatedCfg,
          snapshots: listLocalSnapshots(),
          message: `Created streaming snapshot ${filename} (keeping latest ${keepLimit}). ${syncRes.log}`,
        });
      } catch (err: any) {
        if (fs.existsSync(stagingDir)) {
          fs.rmSync(stagingDir, { recursive: true, force: true });
        }
        throw err;
      }
    }

    if (body.action === "restore_snapshot") {
      const safeName = path.basename(String(body.filename || ""));
      const backupsDir = resolveBackupsDir();
      const fullPath = path.join(backupsDir, safeName);

      if (!fs.existsSync(fullPath)) {
        return NextResponse.json({ ok: false, error: `Snapshot ${safeName} not found.` }, { status: 404 });
      }

      const dbPath = resolveDbPath();
      const dataDir = path.dirname(dbPath);
      const restoreStage = path.join(backupsDir, `.tmp_restore_${Date.now()}`);
      fs.mkdirSync(restoreStage, { recursive: true });

      try {
        const untarRes = await execShell(`tar -xzf "${fullPath}" -C "${restoreStage}"`);
        if (untarRes.code !== 0) {
          throw new Error(`Extraction failed: ${untarRes.stderr || untarRes.stdout}`);
        }

        const stagedDb = path.join(restoreStage, "journal.db");
        if (fs.existsSync(stagedDb)) {
          // Restore database atomically using SQLite online restore
          const restRes = await execShell(`sqlite3 "${dbPath}" ".restore '${stagedDb}'"`);
          if (restRes.code !== 0) {
            // Direct replacement fallback
            fs.copyFileSync(stagedDb, dbPath);
            try {
              fs.unlinkSync(`${dbPath}-wal`);
              fs.unlinkSync(`${dbPath}-shm`);
            } catch {}
          }
        }

        // Restore chart attachment images
        const stagedAtt = path.join(restoreStage, "attachments");
        if (fs.existsSync(stagedAtt)) {
          const targetAtt = path.join(dataDir, "attachments");
          if (!fs.existsSync(targetAtt)) fs.mkdirSync(targetAtt, { recursive: true });
          await execShell(`cp -r "${stagedAtt}/." "${targetAtt}/"`);
        }

        fs.rmSync(restoreStage, { recursive: true, force: true });

        return NextResponse.json({
          ok: true,
          message: `Restored database and chart attachments from ${safeName}!`,
        });
      } catch (err: any) {
        if (fs.existsSync(restoreStage)) {
          fs.rmSync(restoreStage, { recursive: true, force: true });
        }
        throw err;
      }
    }

    return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "Google Drive backup action failed" },
      { status: 500 }
    );
  }
}

// Global in-memory auto-backup scheduler for continuous background execution
let gdriveAutoSchedulerTimer: any = null;
function startAutoBackupScheduler() {
  if (gdriveAutoSchedulerTimer) return;
  gdriveAutoSchedulerTimer = setInterval(async () => {
    try {
      const cfg = loadGDriveConfig();
      if (!cfg || cfg.schedule === "manual") return;

      const now = Date.now();
      const last = cfg.lastBackupAt ? new Date(cfg.lastBackupAt).getTime() : 0;
      const hoursSince = (now - last) / (1000 * 60 * 60);

      let shouldRun = false;
      if (cfg.schedule === "daily" && hoursSince >= 23.5) shouldRun = true;
      if (cfg.schedule === "6h" && hoursSince >= 5.8) shouldRun = true;

      if (shouldRun) {
        console.log("[Auto-Backup Scheduler] Creating scheduled incremental snapshot...");
        const dbPath = resolveDbPath();
        const backupsDir = resolveBackupsDir();
        if (!fs.existsSync(dbPath)) return;

        const stagingDir = path.join(backupsDir, `.tmp_stage_${Date.now()}`);
        fs.mkdirSync(stagingDir, { recursive: true });
        const stagedDb = path.join(stagingDir, "journal.db");

        const vacRes = await execShell(`sqlite3 "${dbPath}" "VACUUM INTO '${stagedDb}'"`);
        if (vacRes.code !== 0 || !fs.existsSync(stagedDb)) {
          await execShell(`sqlite3 "${dbPath}" ".backup '${stagedDb}'"`);
        }

        const contentHash = await computeFileHash(stagedDb);
        if (cfg.lastBackupHash === contentHash && listLocalSnapshots().length > 0) {
          fs.rmSync(stagingDir, { recursive: true, force: true });
          return;
        }

        const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        const filename = `tj-snapshot-${ts}_${contentHash}.tar.gz`;
        const fullPath = path.join(backupsDir, filename);

        const dataDir = path.dirname(dbPath);
        const attDir = path.join(dataDir, "attachments");
        const hasAtt = fs.existsSync(attDir) && fs.readdirSync(attDir).length > 0;

        let tarCmd = `tar -czf "${fullPath}" -C "${stagingDir}" journal.db`;
        if (hasAtt) tarCmd += ` -C "${dataDir}" attachments`;
        await execShell(tarCmd);

        fs.rmSync(stagingDir, { recursive: true, force: true });

        pruneOldSnapshots(backupsDir, cfg.keepCount || 3);
        const syncRes = await syncBackupsDirToRcloneOrDrive(backupsDir, cfg.rcloneRemotePath);
        saveGDriveConfig({
          ...cfg,
          lastBackupAt: new Date().toISOString(),
          lastBackupHash: contentHash,
          lastBackupStatus: syncRes.log,
        });
      }
    } catch (e) {
      console.warn("[Auto-Backup Scheduler] Error:", e);
    }
  }, 15 * 60 * 1000);
}
startAutoBackupScheduler();
