import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import type { MarketBar } from "@/lib/market-data";

function getDbPath(): string {
  const rootData = path.resolve(process.cwd(), "apps/web/data");
  const localData = path.resolve(process.cwd(), "data");
  const targetDir = fs.existsSync(path.resolve(process.cwd(), "apps/web")) ? rootData : localData;
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
  return path.join(targetDir, "market_candles.db");
}

let dbInstance: Database.Database | null = null;

export function getCandleDb(): Database.Database {
  if (!dbInstance) {
    dbInstance = new Database(getDbPath());
    dbInstance.pragma("journal_mode = WAL");
    dbInstance.pragma("synchronous = NORMAL");
    
    // Provider is part of primary key to keep data strictly partitioned
    dbInstance.exec(`
      CREATE TABLE IF NOT EXISTS candles (
        provider TEXT NOT NULL,
        symbol TEXT NOT NULL,
        timeframe TEXT NOT NULL,
        time INTEGER NOT NULL,
        open REAL NOT NULL,
        high REAL NOT NULL,
        low REAL NOT NULL,
        close REAL NOT NULL,
        volume REAL NOT NULL,
        PRIMARY KEY (provider, symbol, timeframe, time)
      ) WITHOUT ROWID;

      CREATE INDEX IF NOT EXISTS idx_candles_lookup
      ON candles (provider, symbol, timeframe, time ASC);
    `);
  }
  return dbInstance;
}

/** Check the recorded time boundaries for this provider + symbol + timeframe */
export function getCachedBounds(
  provider: string,
  symbol: string,
  timeframe: string
): { minTime: number | null; maxTime: number | null } {
  const db = getCandleDb();
  const stmt = db.prepare(`
    SELECT MIN(time) as minTime, MAX(time) as maxTime
    FROM candles
    WHERE provider = ? AND symbol = ? AND timeframe = ?
  `);
  const row = stmt.get(provider, symbol, timeframe) as {
    minTime: number | null;
    maxTime: number | null;
  } | undefined;
  return { minTime: row?.minTime ?? null, maxTime: row?.maxTime ?? null };
}

/** Fetch cached candles directly via indexed range scan */
export function getCachedCandles(
  provider: string,
  symbol: string,
  timeframe: string,
  fromTime: number,
  toTime: number
): MarketBar[] {
  const db = getCandleDb();
  const stmt = db.prepare(`
    SELECT time, open, high, low, close, volume
    FROM candles
    WHERE provider = ? AND symbol = ? AND timeframe = ? AND time BETWEEN ? AND ?
    ORDER BY time ASC
  `);
  return stmt.all(provider, symbol, timeframe, fromTime, toTime) as MarketBar[];
}

/** Atomically insert or update candle batches */
export function saveCachedCandles(
  provider: string,
  symbol: string,
  timeframe: string,
  bars: MarketBar[]
): void {
  if (!bars.length) return;
  const db = getCandleDb();
  const insert = db.prepare(`
    INSERT OR REPLACE INTO candles (provider, symbol, timeframe, time, open, high, low, close, volume)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((rows: MarketBar[]) => {
    for (const b of rows) {
      insert.run(provider, symbol, timeframe, b.time, b.open, b.high, b.low, b.close, b.volume);
    }
  });

  insertMany(bars);
}