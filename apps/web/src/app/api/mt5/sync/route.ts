import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import path from "path";
import fs from "fs";

export const dynamic = "force-dynamic";

function resolveRepoRoot(): string {
  const cwd = process.cwd();
  if (fs.existsSync(path.join(cwd, "mt5_notion_sync_wine.py"))) return cwd;
  const parent = path.resolve(cwd, "..", "..");
  if (fs.existsSync(path.join(parent, "mt5_notion_sync_wine.py"))) return parent;
  return cwd;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const mode = body.mode === "login" ? "login" : "sync";
    const rootDir = resolveRepoRoot();
    const scriptPath = path.join(rootDir, "scripts", "tablet-mt5.sh");

    const cmd = fs.existsSync(scriptPath)
      ? `bash "${scriptPath}" ${mode}`
      : `bash "${path.join(rootDir, "sync-mt5.sh")}"`;

    const output = await new Promise<{ stdout: string; stderr: string; code: number }>((resolve) => {
      exec(
        cmd,
        { cwd: rootDir, timeout: 120_000, env: { ...process.env } },
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
      log: output.stdout.trim() || "MT5 sync completed successfully.",
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "Failed to execute MT5 sync" },
      { status: 500 }
    );
  }
}
