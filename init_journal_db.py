import sqlite3
import os
from datetime import datetime, timezone

DB_PATH = os.path.join("apps", "web", "data", "journal.db")

def init_database():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    print(f"Connecting to database at: {DB_PATH}")

    # 1. Create the accounts table
    cur.execute("""
    CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        broker TEXT NOT NULL DEFAULT '',
        kind TEXT NOT NULL,
        currency TEXT NOT NULL DEFAULT 'USD',
        initial_balance REAL NOT NULL DEFAULT 0,
        profit_calc_method TEXT NOT NULL DEFAULT 'fifo',
        credentials_enc TEXT,
        auto_sync INTEGER NOT NULL DEFAULT 0,
        last_sync_at TEXT,
        ibkr_sync_time_zone TEXT,
        snapshot_json TEXT,
        archived_at TEXT,
        created_at TEXT NOT NULL
    );
    """)

    # Insert a default account so trades have a valid account to attach to
    now_iso = datetime.now(timezone.utc).isoformat()
    cur.execute("""
    INSERT OR IGNORE INTO accounts (id, name, broker, kind, currency, initial_balance, created_at)
    VALUES ('mt5-main', 'MetaTrader 5 Account', 'MT5', 'manual', 'USD', 100000.0, ?);
    """, (now_iso,))

    # 2. Create the trades table (matching LuxAlgo's exact schema)
    cur.execute("""
    CREATE TABLE IF NOT EXISTS trades (
        key TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        asset_class TEXT,
        direction TEXT NOT NULL,
        status TEXT NOT NULL,
        opened_at TEXT NOT NULL,
        closed_at TEXT,
        quantity REAL NOT NULL,
        open_quantity REAL NOT NULL DEFAULT 0,
        avg_entry REAL NOT NULL,
        avg_exit REAL,
        gross_pnl REAL NOT NULL,
        fees REAL NOT NULL DEFAULT 0,
        net_pnl REAL NOT NULL,
        execution_count INTEGER NOT NULL DEFAULT 1,
        execution_ids_json TEXT NOT NULL DEFAULT '[]',
        exits_json TEXT NOT NULL DEFAULT '[]',
        duration_ms INTEGER,
        notes TEXT,
        tags_json TEXT,
        mistakes_json TEXT,
        playbook_id TEXT,
        rating INTEGER,
        stop_loss REAL,
        profit_target REAL,
        reviewed_at TEXT,
        
        -- Custom fields for ICT metrics & Notion link
        notion_page_id TEXT,
        notion_url TEXT,
        realized_r REAL,
        planned_r REAL,
        mae_r REAL,
        mfe_r REAL,
        capture_eff REAL,
        risk_percent REAL,
        exit_reason TEXT,
        partials_breakdown TEXT,
        tickets TEXT
    );
    """)

    conn.commit()
    conn.close()
    print("Database tables successfully created and ready!")

if __name__ == "__main__":
    init_database()