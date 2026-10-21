import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import path from "path";
import fs from "fs";

export const dynamic = "force-dynamic";

function findSyncScriptOnLocalMachine(): string | null {
  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, "sync-mt5.sh"),
    path.resolve(cwd, "..", "sync-mt5.sh"),
    path.resolve(cwd, "..", "..", "sync-mt5.sh"),
    "/home/mark/trade-journal-dev/sync-mt5.sh",
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const desktopHost = String(body.desktopHost || "mark@fedora-mark-desktop").trim();
    const isTermux = process.cwd().includes("com.termux") || Boolean(process.env.TERMUX_VERSION);
    const localSyncScript = findSyncScriptOnLocalMachine();

    let cmd = "";
    if (!isTermux && localSyncScript) {
      // Running directly on Fedora desktop
      const repoDir = path.dirname(localSyncScript);
      cmd = `cd "${repoDir}" && bash "${localSyncScript}"`;
    } else {
      // Running on Samsung Galaxy Tab A (Termux):
      // Trigger sync-mt5.sh on Fedora desktop over Tailscale SSH, then pull updated trades into tablet SQLite
      const tabletDbPath = fs.existsSync(path.resolve(process.cwd(), "data", "journal.db"))
        ? path.resolve(process.cwd(), "data", "journal.db")
        : path.resolve(process.cwd(), "apps", "web", "data", "journal.db");

      cmd = `ssh -o BatchMode=yes -o ConnectTimeout=8 ${desktopHost} "cd ~/trade-journal-dev && ./sync-mt5.sh" && scp -o BatchMode=yes ${desktopHost}:~/trade-journal-dev/apps/web/data/journal.db "${tabletDbPath}.remote" && sqlite3 "${tabletDbPath}" "ATTACH DATABASE '${tabletDbPath}.remote' AS rem; INSERT OR REPLACE INTO trades SELECT * FROM rem.trades; INSERT OR REPLACE INTO executions SELECT * FROM rem.executions; DETACH DATABASE rem;" && rm -f "${tabletDbPath}.remote"`;
    }

    const output = await new Promise<{ stdout: string; stderr: string; code: number }>((resolve) => {
      exec(
        cmd,
        { timeout: 180_000, env: { ...process.env } },
        (error, stdout, stderr) => {
          resolve({
            stdout: String(stdout || ""),
            stderr: String(stderr || ""),
            code: error ? (error as any).code || 1 : 0,
          });
        }
      );
    });

    if (output.code !== 0) {
      return NextResponse.json({
        ok: false,
        error: `MT5 sync exited with code ${output.code}`,
        log: `${output.stdout}\n${output.stderr}`.trim(),
      });
    }

    return NextResponse.json({
      ok: true,
      log: output.stdout.trim() || "MT5 trades synced and merged into local SQLite.",
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "Failed to execute MT5 sync" },
      { status: 500 }
    );
  }
}
