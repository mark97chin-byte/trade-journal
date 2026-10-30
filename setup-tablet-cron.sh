#!/usr/bin/env bash
set -e

TABLET_HOST="${1:-100.73.77.95}"
TABLET_PORT="${2:-8022}"

echo "=== [Tablet Backup Scheduler] Setting up Cronie over SSH ==="
echo "Target: ${TABLET_HOST}:${TABLET_PORT}"

# Probe connection first
if ! nc -z -w 3 "$TABLET_HOST" "$TABLET_PORT" 2>/dev/null; then
    if nc -z -w 3 "$TABLET_HOST" 22 2>/dev/null; then
        TABLET_PORT=22
    else
        echo "[-] Error: Cannot reach ${TABLET_HOST} on port ${TABLET_PORT} or 22."
        echo "    Ensure Termux is open and 'sshd' is running."
        exit 1
    fi
fi

ssh -p "$TABLET_PORT" "$TABLET_HOST" '
  set -e

  echo "[1/4] Ensuring cronie is installed..."
  pkg install -y cronie

  echo "[2/4] Writing daily 3:00 AM backup schedule to crontab..."
  # Clean out existing gdrive-backup entries, then append the new entry
  (crontab -l 2>/dev/null | grep -v "gdrive-backup" || true; echo "0 3 * * * curl -s -X POST http://localhost:3000/api/settings/gdrive-backup -H \"Content-Type: application/json\" -d \"{\\\"action\\\":\\\"create_snapshot\\\"}\" >> ~/backup-cron.log 2>&1") | crontab -

  echo "[3/4] Restarting crond background daemon..."
  pkill -f crond 2>/dev/null || true
  crond

  echo "[4/4] Acquiring Android CPU wake-lock..."
  termux-wake-lock || true

  echo ""
  echo "=== Crontab Schedule ==="
  crontab -l

  echo ""
  echo "=== Running Daemon Verification ==="
  pgrep -fla crond || echo "[-] Warning: crond process not found in process tree"
'

echo ""
echo "=== Success! Tablet is scheduled to run daily incremental backups at 3:00 AM. ==="
