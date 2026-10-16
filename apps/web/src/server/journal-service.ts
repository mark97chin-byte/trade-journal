import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

export interface DBJournalTrade {
  key: string;
  symbol: string;
  direction: string;
  opened_at: string;
  closed_at: string | null;
  net_pnl: number;
  gross_pnl: number | null;
  fees: number | null;
  quantity: number;
  avg_entry: number | null;
  avg_exit: number | null;
  realized_r: number | null;
  strategy: string | null;
  notes: string | null;
  tags_json: string | null;
}

export async function getJournalTrades() {
  const dbPath = path.resolve(process.cwd(), "data", "journal.db");
  const altDbPath = path.resolve(process.cwd(), "apps", "web", "data", "journal.db");
  const finalPath = fs.existsSync(dbPath) ? dbPath : altDbPath;

  if (!fs.existsSync(finalPath)) {
    console.warn("journal.db not found at", finalPath);
    return [];
  }

  const db = new Database(finalPath, { readonly: true });
  try {
    const rows = db
      .prepare(
        `SELECT key, symbol, direction, opened_at, closed_at, net_pnl, gross_pnl, fees, quantity,
                avg_entry, avg_exit, realized_r, notes, tags_json
         FROM trades
         WHERE status != 'open'
         ORDER BY opened_at DESC`
      )
      .all() as DBJournalTrade[];

    return rows.map((r) => {
      let tags: string[] = [];
      try {
        if (r.tags_json) tags = JSON.parse(r.tags_json);
      } catch {}

      return {
        key: r.key,
        symbol: r.symbol,
        direction: r.direction,
        openedAt: r.opened_at,
        closedAt: r.closed_at,
        netPnl: r.net_pnl ?? 0,
        grossPnl: r.gross_pnl ?? r.net_pnl ?? 0,
        fees: r.fees ?? 0,
        quantity: r.quantity ?? 1,
        avgEntry: r.avg_entry ?? undefined,
        avgExit: r.avg_exit ?? undefined,
        realizedR: r.realized_r ?? null,
        notes: r.notes ?? null,
        tags,
      };
    });
  } finally {
    db.close();
  }
}
