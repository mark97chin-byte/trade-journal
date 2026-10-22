import { NextRequest, NextResponse } from "next/server";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

export const dynamic = "force-dynamic";

function resolveDbPath(): string {
  const dbPath = path.resolve(process.cwd(), "data", "journal.db");
  const altDbPath = path.resolve(process.cwd(), "apps", "web", "data", "journal.db");
  return fs.existsSync(dbPath) ? dbPath : altDbPath;
}

function ensureMissedTradesSchemaLocal(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS missed_trades (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      direction TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      exit_at TEXT,
      outcome TEXT DEFAULT 'WIN',
      playbook_id TEXT,
      entry REAL,
      stop REAL,
      target REAL,
      partials_json TEXT DEFAULT '[]',
      account_size REAL DEFAULT 100000,
      risk_percent REAL DEFAULT 1.0,
      risk_amount REAL DEFAULT 1000,
      contract_multiplier REAL DEFAULT 1,
      quantity REAL DEFAULT 1,
      planned_r REAL,
      realized_r REAL,
      theoretical_pnl REAL DEFAULT 0,
      mae_r REAL,
      mfe_r REAL,
      miss_reason TEXT DEFAULT 'Hesitation / Fear',
      session TEXT DEFAULT 'NY AM',
      tags_json TEXT DEFAULT '[]',
      mistakes_json TEXT DEFAULT '[]',
      notes TEXT NOT NULL DEFAULT '',
      review_notes TEXT DEFAULT '',
      rating INTEGER,
      notion_page_id TEXT,
      notion_url TEXT,
      created_at TEXT NOT NULL,
      archived_at TEXT
    );
  `);
}

function classifyNySessionLocal(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return "NY AM";
    const hourStr = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      hour12: false,
    }).format(d);
    const h = parseInt(hourStr, 10) % 24;
    if (h >= 2 && h < 8) return "London";
    if (h >= 8 && h < 12) return "NY AM";
    if (h >= 12 && h < 18) return "NY PM";
    return "Asia";
  } catch {
    return "NY AM";
  }
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const from = url.searchParams.get("from") || "2000-01-01";
    const to = url.searchParams.get("to") || "2099-12-31";

    const dbPath = resolveDbPath();
    if (!fs.existsSync(dbPath)) {
      return NextResponse.json({ ok: true, missed: [], executed: [] });
    }

    const db = new Database(dbPath);
    try {
      ensureMissedTradesSchemaLocal(db);

      const missedRows = db
        .prepare(
          `SELECT * FROM missed_trades
           WHERE archived_at IS NULL
             AND substr(observed_at, 1, 10) >= ?
             AND substr(observed_at, 1, 10) <= ?
           ORDER BY observed_at DESC`
        )
        .all(from, to) as any[];

      const executedRows = db
        .prepare(
          `SELECT key, symbol, direction, status, opened_at, closed_at, net_pnl, realized_r, planned_r
           FROM trades
           WHERE status != 'open'
             AND substr(opened_at, 1, 10) >= ?
             AND substr(opened_at, 1, 10) <= ?
           ORDER BY opened_at DESC`
        )
        .all(from, to) as any[];

      const execCount = executedRows.length;
      const execWins = executedRows.filter((t) => Number(t.net_pnl) > 0).length;
      const execNetPnl = executedRows.reduce((s, t) => s + Number(t.net_pnl || 0), 0);
      const execNetR = executedRows.reduce((s, t) => s + Number(t.realized_r || 0), 0);
      const execWinRate = execCount > 0 ? (execWins / execCount) * 100 : 0;

      const missedCount = missedRows.length;
      const missedWins = missedRows.filter((t) => (t.outcome || "WIN") === "WIN").length;
      const missedNetPnl = missedRows.reduce((s, t) => s + Number(t.theoretical_pnl || 0), 0);
      const missedNetR = missedRows.reduce(
        (s, t) => s + Number(t.realized_r ?? t.planned_r ?? 0),
        0
      );
      const missedWinRate = missedCount > 0 ? (missedWins / missedCount) * 100 : 0;

      const combinedCount = execCount + missedCount;
      const combinedWins = execWins + missedWins;
      const combinedNetPnl = execNetPnl + missedNetPnl;
      const combinedNetR = execNetR + missedNetR;
      const combinedWinRate = combinedCount > 0 ? (combinedWins / combinedCount) * 100 : 0;

      const reasonMap = new Map<
        string,
        { reason: string; count: number; wins: number; pnl: number; r: number }
      >();
      const sessionMap = new Map<
        string,
        { session: string; count: number; wins: number; pnl: number; r: number }
      >();
      const hourMap = new Map<
        string,
        { hour: string; count: number; wins: number; pnl: number; r: number }
      >();
      const dowMap = new Map<
        string,
        { day: string; count: number; wins: number; pnl: number; r: number }
      >();

      for (const m of missedRows) {
        const reason = m.miss_reason || "Hesitation / Fear";
        const sess = m.session || classifyNySessionLocal(m.observed_at);
        const isWin = (m.outcome || "WIN") === "WIN" ? 1 : 0;
        const pnl = Number(m.theoretical_pnl || 0);
        const r = Number(m.realized_r ?? m.planned_r ?? 0);

        const rEntry = reasonMap.get(reason) || { reason, count: 0, wins: 0, pnl: 0, r: 0 };
        rEntry.count++;
        rEntry.wins += isWin;
        rEntry.pnl += pnl;
        rEntry.r += r;
        reasonMap.set(reason, rEntry);

        const sEntry = sessionMap.get(sess) || { session: sess, count: 0, wins: 0, pnl: 0, r: 0 };
        sEntry.count++;
        sEntry.wins += isWin;
        sEntry.pnl += pnl;
        sEntry.r += r;
        sessionMap.set(sess, sEntry);

        try {
          const d = new Date(m.observed_at);
          if (!isNaN(d.getTime())) {
            const nyHour = new Intl.DateTimeFormat("en-US", {
              timeZone: "America/New_York",
              hour: "2-digit",
              hour12: false,
            }).format(d);
            const hKey = `${nyHour}:00 NY`;
            const hEntry = hourMap.get(hKey) || { hour: hKey, count: 0, wins: 0, pnl: 0, r: 0 };
            hEntry.count++;
            hEntry.wins += isWin;
            hEntry.pnl += pnl;
            hEntry.r += r;
            hourMap.set(hKey, hEntry);

            const nyDay = new Intl.DateTimeFormat("en-US", {
              timeZone: "America/New_York",
              weekday: "long",
            }).format(d);
            const dEntry = dowMap.get(nyDay) || { day: nyDay, count: 0, wins: 0, pnl: 0, r: 0 };
            dEntry.count++;
            dEntry.wins += isWin;
            dEntry.pnl += pnl;
            dEntry.r += r;
            dowMap.set(nyDay, dEntry);
          }
        } catch {}
      }

      const byReason = Array.from(reasonMap.values()).sort((a, b) => b.count - a.count);
      const bySession = Array.from(sessionMap.values()).sort((a, b) => b.count - a.count);
      const byHour = Array.from(hourMap.values()).sort((a, b) => b.count - a.count);
      const byDayOfWeek = Array.from(dowMap.values()).sort((a, b) => b.count - a.count);

      // 8. Breakdown by Playbook & Matched Rules
      try {
        db.exec(`ALTER TABLE missed_trades ADD COLUMN rules_followed_json TEXT DEFAULT '[]'`);
      } catch {}
      let playbooksList: Array<{ id: string; name: string; rules_json: string }> = [];
      try {
        playbooksList = db.prepare(`SELECT id, name, rules_json FROM playbooks`).all() as any[];
      } catch {}
      const pbNameMap = new Map<string, string>();
      for (const pb of playbooksList) pbNameMap.set(pb.id, pb.name);

      const ruleMap = new Map<
        string,
        { rule: string; playbookName: string; count: number; wins: number; pnl: number; r: number }
      >();

      for (const m of missedRows) {
        const pbName = m.playbook_id ? pbNameMap.get(m.playbook_id) || "Playbook" : "General";
        let rules: string[] = [];
        try {
          rules = JSON.parse(m.rules_followed_json || "[]");
        } catch {}
        const isWin = (m.outcome || "WIN") === "WIN" ? 1 : 0;
        const pnl = Number(m.theoretical_pnl || 0);
        const r = Number(m.realized_r ?? m.planned_r ?? 0);

        for (const ruleText of rules) {
          const key = `${pbName}::${ruleText}`;
          const cur = ruleMap.get(key) || {
            rule: ruleText,
            playbookName: pbName,
            count: 0,
            wins: 0,
            pnl: 0,
            r: 0,
          };
          cur.count++;
          cur.wins += isWin;
          cur.pnl += pnl;
          cur.r += r;
          ruleMap.set(key, cur);
        }
      }

      const byPlaybookRule = Array.from(ruleMap.values()).sort((a, b) => b.count - a.count);

      return NextResponse.json({
        ok: true,
        byPlaybookRule,
        summary: {
          executed: {
            count: execCount,
            wins: execWins,
            winRate: Number(execWinRate.toFixed(1)),
            netPnl: Number(execNetPnl.toFixed(2)),
            netR: Number(execNetR.toFixed(2)),
          },
          missed: {
            count: missedCount,
            wins: missedWins,
            winRate: Number(missedWinRate.toFixed(1)),
            netPnl: Number(missedNetPnl.toFixed(2)),
            netR: Number(missedNetR.toFixed(2)),
          },
          combinedModel: {
            count: combinedCount,
            wins: combinedWins,
            winRate: Number(combinedWinRate.toFixed(1)),
            netPnl: Number(combinedNetPnl.toFixed(2)),
            netR: Number(combinedNetR.toFixed(2)),
          },
        },
        byReason,
        bySession,
        byHour,
        byDayOfWeek,
        missedTrades: missedRows,
      });
    } finally {
      db.close();
    }
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "Failed to compute missed trade analytics" },
      { status: 500 }
    );
  }
}
