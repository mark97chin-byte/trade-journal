import { NextResponse } from "next/server";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

export const dynamic = "force-dynamic";

function resolveDbPath(): string {
  const dbPath = path.resolve(process.cwd(), "data", "journal.db");
  const altDbPath = path.resolve(process.cwd(), "apps", "web", "data", "journal.db");
  return fs.existsSync(dbPath) ? dbPath : altDbPath;
}

export async function GET() {
  try {
    const dbPath = resolveDbPath();
    if (!fs.existsSync(dbPath)) {
      return NextResponse.json({ symbols: ["NAS100", "US500", "US30", "XAUUSD", "EURUSD", "GBPUSD"] });
    }
    const db = new Database(dbPath, { readonly: true });
    try {
      const set = new Set<string>();
      
      try {
        const tradeRows = db
          .prepare(`SELECT DISTINCT symbol FROM trades WHERE symbol IS NOT NULL AND TRIM(symbol) != ''`)
          .all() as Array<{ symbol: string }>;
        for (const r of tradeRows) set.add(r.symbol.toUpperCase().trim());
      } catch {}

      try {
        const execRows = db
          .prepare(`SELECT DISTINCT symbol FROM executions WHERE symbol IS NOT NULL AND TRIM(symbol) != ''`)
          .all() as Array<{ symbol: string }>;
        for (const r of execRows) set.add(r.symbol.toUpperCase().trim());
      } catch {}

      try {
        const missedRows = db
          .prepare(`SELECT DISTINCT symbol FROM missed_trades WHERE symbol IS NOT NULL AND TRIM(symbol) != ''`)
          .all() as Array<{ symbol: string }>;
        for (const r of missedRows) set.add(r.symbol.toUpperCase().trim());
      } catch {}

      // Default standards
      ["NAS100", "US500", "US30", "XAUUSD"].forEach((s) => set.add(s));

      const symbols = Array.from(set).sort();
      return NextResponse.json({ symbols });
    } finally {
      db.close();
    }
  } catch {
    return NextResponse.json({ symbols: ["NAS100", "US500", "US30", "XAUUSD"] });
  }
}
