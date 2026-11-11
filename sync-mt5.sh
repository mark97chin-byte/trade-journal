#!/bin/bash
set -e

TABLET_IP="100.73.77.95"
TABLET_USER="u0_a322"
PORT="8022"
WINE_PY="$HOME/.mt5/drive_c/users/mark/AppData/Local/Programs/Python/Python311/python.exe"

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

if [ -z "$XDG_RUNTIME_DIR" ]; then
    export XDG_RUNTIME_DIR="/run/user/$(id -u)"
fi

if [ -z "$DISPLAY" ]; then
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

run_wine_sync() {
    wine "$WINE_PY" mt5_notion_sync_wine.py $WIPE_FLAG
}

if command -v xvfb-run >/dev/null 2>&1; then
    if [ -n "$SSH_CLIENT" ] || [ -n "$SSH_CONNECTION" ] || ! xset q >/dev/null 2>&1; then
        echo "[Display] Using xvfb-run virtual display for headless Wine..."
        xvfb-run -a -s "-screen 0 1024x768x24" wine "$WINE_PY" mt5_notion_sync_wine.py $WIPE_FLAG
    else
        run_wine_sync
    fi
else
    run_wine_sync
fi

if [ "$NO_PUSH" = true ]; then
    echo "[Sync] Extraction complete. Skipping tablet push (--no-push active)."
    exit 0
fi

echo ""
echo "========================================================"
echo "[2/2] Pushing & Synchronizing Master Database on Tablet..."
echo "========================================================"

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
conn.row_factory = sqlite3.Row
conn.execute('PRAGMA wal_checkpoint(PASSIVE);')
conn.execute(f\"ATTACH DATABASE '{staging_db}' AS stg;\")

def shared_cols(tbl):
    m = [r['name'] for r in conn.execute(f'PRAGMA main.table_info({tbl});').fetchall()]
    s = {r['name'] for r in conn.execute(f'PRAGMA stg.table_info({tbl});').fetchall()}
    return [c for c in m if c in s]

if wipe_mode:
    print('[Tablet Master DB] Wiping old trades & executions for clean re-import...')
    conn.execute('DELETE FROM main.executions;')
    conn.execute('DELETE FROM main.trades;')

acc_cols = shared_cols('accounts')
if acc_cols:
    cols_sql = ', '.join(acc_cols)
    conn.execute(f'INSERT OR IGNORE INTO main.accounts ({cols_sql}) SELECT {cols_sql} FROM stg.accounts;')

exec_cols = shared_cols('executions')
if exec_cols:
    cols_sql = ', '.join(exec_cols)
    conn.execute(f'INSERT OR REPLACE INTO main.executions ({cols_sql}) SELECT {cols_sql} FROM stg.executions;')

t_cols = shared_cols('trades')
main_rows = conn.execute('SELECT key, account_id, symbol, direction, opened_at, quantity, net_pnl FROM main.trades;').fetchall()
existing_keys = {r['key'] for r in main_rows}
sig_map = {
    (str(r['account_id'] or 'mt5-main').strip(), str(r['symbol']).strip(), str(r['direction']).strip().lower(), str(r['opened_at'])[:16], round(float(r['quantity'] or 0), 2), round(float(r['net_pnl'] or 0), 2)): r['key']
    for r in main_rows
}

telemetry_cols = [c for c in [
    'opened_at', 'closed_at', 'status', 'avg_entry', 'avg_exit', 'quantity', 'open_quantity',
    'gross_pnl', 'fees', 'net_pnl', 'execution_count', 'execution_ids_json', 'exits_json',
    'duration_ms', 'partials_breakdown', 'exit_reason', 'tickets', 'risk_percent'
] if c in t_cols]

coalesce_cols = [c for c in ['realized_r', 'planned_r', 'mae_r', 'mfe_r', 'capture_eff', 'notion_page_id', 'notion_url'] if c in t_cols]

for stg_r in conn.execute('SELECT * FROM stg.trades;').fetchall():
    sig = (str(stg_r['account_id'] or 'mt5-main').strip(), str(stg_r['symbol']).strip(), str(stg_r['direction']).strip().lower(), str(stg_r['opened_at'])[:16], round(float(stg_r['quantity'] or 0), 2), round(float(stg_r['net_pnl'] or 0), 2))
    target_key = stg_r['key'] if stg_r['key'] in existing_keys else sig_map.get(sig)
    if target_key:
        sets = [f'{c} = ?' for c in telemetry_cols] + [f'{c} = COALESCE(?, {c})' for c in coalesce_cols]
        vals = [stg_r[c] for c in telemetry_cols] + [stg_r[c] for c in coalesce_cols] + [target_key]
        conn.execute(f\"UPDATE main.trades SET {', '.join(sets)} WHERE key = ?;\", vals)
    else:
        cols_sql = ', '.join(t_cols)
        ph = ', '.join(['?'] * len(t_cols))
        conn.execute(f'INSERT OR IGNORE INTO main.trades ({cols_sql}) VALUES ({ph});', [stg_r[c] for c in t_cols])
        existing_keys.add(stg_r['key'])
        sig_map[sig] = stg_r['key']

conn.commit()
conn.execute('DETACH DATABASE stg;')
conn.execute('PRAGMA wal_checkpoint(TRUNCATE);')
conn.close()

if os.path.exists(staging_db):
    os.remove(staging_db)

print('[Tablet Master DB] Cleanly synchronized with MT5!')
PYEOF"
