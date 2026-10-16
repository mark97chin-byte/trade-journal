#!/bin/bash
set -e

TABLET_IP="100.73.77.95"
TABLET_USER="u0_a322"
PORT="8022"
WINE_PY="$HOME/.mt5/drive_c/users/mark/AppData/Local/Programs/Python/Python311/python.exe"

echo "========================================================"
echo "[1/2] Running MT5 -> Notion & SQLite Self-Healing Sync..."
echo "========================================================"
WINEPREFIX="$HOME/.mt5" wine "$WINE_PY" mt5_notion_sync_wine.py

echo ""
echo "========================================================"
echo "[2/2] Pushing & Self-Healing Master Database on Tablet..."
echo "========================================================"
scp -P "$PORT" apps/web/data/journal.db "$TABLET_USER@$TABLET_IP:~/trade-journal/apps/web/data/mt5_sync_staging.db"

ssh -p "$PORT" "$TABLET_USER@$TABLET_IP" 'python3 - << "PYEOF"
import sqlite3, os

data_dir = os.path.expanduser("~/trade-journal/apps/web/data")
tablet_db = os.path.join(data_dir, "journal.db")
staging_db = os.path.join(data_dir, "mt5_sync_staging.db")

conn = sqlite3.connect(tablet_db, timeout=30.0)
conn.execute("PRAGMA wal_checkpoint(PASSIVE);")
conn.execute(f"ATTACH DATABASE \x27{staging_db}\x27 AS stg;")

# 1. Upsert all MT5 execution legs using standard SQLite syntax
conn.execute("""
    INSERT OR REPLACE INTO main.executions
    SELECT * FROM stg.executions;
""")

# 2. Heal trade metrics, timestamps, and execution mappings while keeping tablet notes/tags intact
rows = conn.execute("""
    SELECT key, opened_at, closed_at, avg_entry, avg_exit, quantity,
           gross_pnl, net_pnl, execution_ids_json, exits_json,
           partials_breakdown, realized_r, mae_r, mfe_r, capture_eff
    FROM stg.trades
""").fetchall()

for row in rows:
    conn.execute("""
        UPDATE main.trades
        SET
            opened_at = ?,
            closed_at = ?,
            avg_entry = ?,
            avg_exit = ?,
            quantity = ?,
            gross_pnl = ?,
            net_pnl = ?,
            execution_ids_json = ?,
            exits_json = ?,
            partials_breakdown = ?,
            realized_r = COALESCE(?, realized_r),
            mae_r = COALESCE(?, mae_r),
            mfe_r = COALESCE(?, mfe_r),
            capture_eff = COALESCE(?, capture_eff)
        WHERE key = ?;
    """, (
        row[1], row[2], row[3], row[4], row[5],
        row[6], row[7], row[8], row[9], row[10],
        row[11], row[12], row[13], row[14], row[0]
    ))

# 3. Insert any brand-new MT5 trades
conn.execute("""
    INSERT OR IGNORE INTO main.trades
    SELECT * FROM stg.trades;
""")

conn.commit()
conn.execute("DETACH DATABASE stg;")
conn.execute("PRAGMA wal_checkpoint(TRUNCATE);")
conn.close()

if os.path.exists(staging_db):
    os.remove(staging_db)

print("[Tablet Master DB] Self-healed and synchronized successfully!")
PYEOF'
