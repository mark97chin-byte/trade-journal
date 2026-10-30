#!/bin/bash
set -e

TABLET_IP="100.73.77.95"
TABLET_USER="u0_a322"
PORT="8022"
WINE_PY="$HOME/.mt5/drive_c/users/mark/AppData/Local/Programs/Python/Python311/python.exe"

# Parse flags
NO_PUSH=false
WIPE_FLAG=""

for arg in "$@"; do
    case "$arg" in
        --no-push|--extract-only)
            NO_PUSH=true
            ;;
        --wipe)
            WIPE_FLAG="--wipe"
            ;;
    esac
done

echo "========================================================"
echo "[1/2] Running MT5 -> Notion & SQLite Self-Healing Sync..."
echo "========================================================"

# 1. Configure display & runtime environment for Wine over SSH
if [ -z "$XDG_RUNTIME_DIR" ]; then
    export XDG_RUNTIME_DIR="/run/user/$(id -u)"
fi

if [ -z "$DISPLAY" ]; then
    # Detect active X11 / Xwayland display socket for user
    ACTIVE_DISP=$(ls /tmp/.X11-unix/ 2>/dev/null | grep -E '^X[0-9]+' | head -n 1 | sed 's/^X/:/')
    export DISPLAY="${ACTIVE_DISP:-:0}"
fi

if [ -z "$XAUTHORITY" ]; then
    for auth in "$XDG_RUNTIME_DIR/.Xauthority" "$HOME/.Xauthority"; do
        if [ -f "$auth" ]; then
            export XAUTHORITY="$auth"
            break
        fi
    done
fi

export WINEPREFIX="$HOME/.mt5"

# 2. Execute Wine Python with Xvfb fallback if direct display fails
run_wine_sync() {
    wine "$WINE_PY" mt5_notion_sync_wine.py $WIPE_FLAG
}

if command -v xvfb-run >/dev/null 2>&1; then
    # If in headless SSH session or DISPLAY is unavailable, run under Xvfb
    if [ -n "$SSH_CLIENT" ] || [ -n "$SSH_CONNECTION" ] || ! xset q >/dev/null 2>&1; then
        echo "[Display] Using xvfb-run virtual display for headless Wine..."
        xvfb-run -a -s "-screen 0 1024x768x24" wine "$WINE_PY" mt5_notion_sync_wine.py $WIPE_FLAG
    else
        run_wine_sync
    fi
else
    run_wine_sync
fi

# 3. Synchronize with tablet if not in --no-push mode
if [ "$NO_PUSH" = true ]; then
    echo "[Sync] Extraction complete. Skipping tablet push (--no-push active)."
    exit 0
fi

echo ""
echo "========================================================"
echo "[2/2] Pushing & Synchronizing Master Database on Tablet..."
echo "========================================================"

# Detect tablet repo path
TARGET_DIR="~/trade-journal/apps/web/data"
ssh -p "$PORT" "$TABLET_USER@$TABLET_IP" "[ -d ~/trade-journal-dev/apps/web/data ]" 2>/dev/null && TARGET_DIR="~/trade-journal-dev/apps/web/data"

scp -P "$PORT" apps/web/data/journal.db "$TABLET_USER@$TABLET_IP:${TARGET_DIR}/mt5_sync_staging.db"

ssh -p "$PORT" "$TABLET_USER@$TABLET_IP" "WIPE_MODE='$WIPE_FLAG' TARGET_DIR='${TARGET_DIR}' python3 - << 'PYEOF'
import sqlite3, os

raw_dir = os.environ.get('TARGET_DIR', '~/trade-journal/apps/web/data')
data_dir = os.path.expanduser(raw_dir)
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

conn.execute('''
    INSERT OR REPLACE INTO main.executions
    SELECT * FROM stg.executions;
''')

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
