#!/bin/bash
set -e

TABLET_IP="100.73.77.95"
TABLET_USER="u0_a322"
PORT="8022"
WINE_PY="$HOME/.mt5/drive_c/users/mark/AppData/Local/Programs/Python/Python311/python.exe"
WIPE_FLAG="$1"

echo "========================================================"
echo "[1/2] Running MT5 -> Notion & SQLite Self-Healing Sync..."
echo "========================================================"
WINEPREFIX="$HOME/.mt5" wine "$WINE_PY" mt5_notion_sync_wine.py $WIPE_FLAG

echo ""
echo "========================================================"
echo "[2/2] Pushing & Synchronizing Master Database on Tablet..."
echo "========================================================"
scp -P "$PORT" apps/web/data/journal.db "$TABLET_USER@$TABLET_IP:~/trade-journal/apps/web/data/mt5_sync_staging.db"

ssh -p "$PORT" "$TABLET_USER@$TABLET_IP" "WIPE_MODE='$WIPE_FLAG' python3 - << 'PYEOF'
import sqlite3, os

data_dir = os.path.expanduser('~/trade-journal/apps/web/data')
tablet_db = os.path.join(data_dir, 'journal.db')
staging_db = os.path.join(data_dir, 'mt5_sync_staging.db')
wipe_mode = os.environ.get('WIPE_MODE', '') == '--wipe'

conn = sqlite3.connect(tablet_db, timeout=30.0)
conn.execute('PRAGMA wal_checkpoint(PASSIVE);')
conn.execute(f\"ATTACH DATABASE '{staging_db}' AS stg;\")

if wipe_mode:
    print('[Tablet Master DB] Wiping old trades & executions for clean re-import...')
    conn.execute('DELETE FROM main.executions;')
    conn.execute('DELETE FROM main.trades;')
else:
    # Even in normal mode, prune any orphaned trades not present in MT5 staging if they came from mt5-main
    conn.execute('''
        DELETE FROM main.trades
        WHERE account_id = 'mt5-main'
          AND key NOT IN (SELECT key FROM stg.trades);
    ''')
    conn.execute('''
        DELETE FROM main.executions
        WHERE account_id = 'mt5-main'
          AND id NOT IN (SELECT id FROM stg.executions);
    ''')

# 1. Upsert all MT5 execution legs
conn.execute('''
    INSERT OR REPLACE INTO main.executions
    SELECT * FROM stg.executions;
''')

# 2. Heal existing trades while preserving any user-written notes/tags/playbook on the tablet
rows = conn.execute('''
    SELECT key, opened_at, closed_at, avg_entry, avg_exit, quantity,
           gross_pnl, net_pnl, execution_ids_json, exits_json,
           partials_breakdown, realized_r, mae_r, mfe_r, capture_eff,
           notion_page_id, notion_url
    FROM stg.trades
''').fetchall()

for row in rows:
    conn.execute('''
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
            capture_eff = COALESCE(?, capture_eff),
            notion_page_id = COALESCE(?, notion_page_id),
            notion_url = COALESCE(?, notion_url)
        WHERE key = ?;
    ''', (
        row[1], row[2], row[3], row[4], row[5],
        row[6], row[7], row[8], row[9], row[10],
        row[11], row[12], row[13], row[14],
        row[15], row[16], row[0]
    ))

# 3. Insert new MT5 trades
conn.execute('''
    INSERT OR IGNORE INTO main.trades
    SELECT * FROM stg.trades;
''')

conn.commit()
conn.execute('DETACH DATABASE stg;')
conn.execute('PRAGMA wal_checkpoint(TRUNCATE);')
conn.close()

if os.path.exists(staging_db):
    os.remove(staging_db)

print('[Tablet Master DB] Cleanly synchronized with MT5!')
PYEOF"
