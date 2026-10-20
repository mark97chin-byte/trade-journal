#!/usr/bin/env bash
# ==============================================================================
# Tablet & Linux MT5 Trade Sync Controller (Termux PRoot / Box64 / Wine / Xvfb)
# Modes:
#   ./scripts/tablet-mt5.sh login   -> Opens MT5 with GUI (Termux-X11 / Display :0) for one-time account login
#   ./scripts/tablet-mt5.sh sync    -> Runs MT5 headlessly via Xvfb :99 in tmux, syncs trades to SQLite & Notion, then exits
#   ./scripts/tablet-mt5.sh status  -> Checks if headless MT5 tmux session or Wine prefix is configured
# ==============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MODE="${1:-sync}"
PROOT_DISTRO="${MT5_PROOT_DISTRO:-ubuntu}"

run_sync_command() {
  cd "$REPO_ROOT"
  # 1. If running inside Termux host (Android), delegate into proot-distro if wine/xvfb is inside proot
  if command -v proot-distro >/dev/null 2>&1 && ! command -v wine >/dev/null 2>&1 && ! command -v wine64 >/dev/null 2>&1; then
    echo "[Tablet MT5] Detected Termux host. Launching headless MT5 sync inside proot-distro ($PROOT_DISTRO)..."
    proot-distro login "$PROOT_DISTRO" --shared-tmp -- bash -c "cd '$REPO_ROOT' && ./scripts/tablet-mt5.sh '$MODE'"
    exit $?
  fi

  WINE_CMD="wine"
  if command -v box64 >/dev/null 2>&1 && command -v wine64 >/dev/null 2>&1; then
    WINE_CMD="box64 wine64"
  elif command -v wine64 >/dev/null 2>&1; then
    WINE_CMD="wine64"
  fi

  if [ "$MODE" = "login" ]; then
    echo "[Tablet MT5] Starting GUI mode on DISPLAY=${DISPLAY:-:0} for one-time MT5 account login..."
    echo "Log into your broker account in the MT5 window, then close MT5 when finished."
    export DISPLAY="${DISPLAY:-:0}"
    $WINE_CMD "C:\Program Files\MetaTrader 5\terminal64.exe" &
    exit 0
  fi

  if [ "$MODE" = "sync" ]; then
    # Use existing sync-mt5.sh if on Desktop and X11 is already active, otherwise spawn Xvfb :99 headlessly
    if [ -z "$DISPLAY" ] && command -v Xvfb >/dev/null 2>&1; then
      export DISPLAY=":99"
      if ! pgrep -f "Xvfb :99" >/dev/null 2>&1; then
        echo "[Tablet MT5] Starting headless virtual display (Xvfb :99)..."
        Xvfb :99 -screen 0 1024x768x16 -nolisten tcp >/dev/null 2>&1 &
        sleep 1.5
      fi
    fi

    echo "[Tablet MT5] Running MT5 -> SQLite + Notion trade sync..."
    if [ -x "$REPO_ROOT/sync-mt5.sh" ]; then
      "$REPO_ROOT/sync-mt5.sh"
    else
      $WINE_CMD python.exe "$REPO_ROOT/mt5_notion_sync_wine.py"
    fi
    echo "[Tablet MT5] Sync finished."
    exit 0
  fi
}

run_sync_command
