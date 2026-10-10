#!/bin/bash
set -e

TABLET_IP="100.73.77.95"
TABLET_USER="u0_a322"
PORT="8022"

echo "========================================================"
echo "[1/4] Building Next.js on desktop..."
echo "========================================================"
pnpm build

echo ""
echo "========================================================"
echo "[2/4] Syncing build artifacts to tablet..."
echo "========================================================"
# Sync .next build directory; exclude cache to save bandwidth/wear
rsync -avz --delete \
  --exclude="cache/" \
  -e "ssh -p $PORT" \
  apps/web/.next/ "$TABLET_USER@$TABLET_IP:~/trade-journal/apps/web/.next/"

echo ""
echo "========================================================"
echo "[3/4] Ensuring port 3000 is completely released..."
echo "========================================================"
ssh -p $PORT "$TABLET_USER@$TABLET_IP" 'bash -s' << 'EOF'
  # 1. Kill any tmux session named "journal"
  tmux kill-session -t journal 2>/dev/null || true

  # 2. Kill whatever process is holding port 3000 (fuser / lsof)
  if command -v fuser >/dev/null 2>&1; then
    fuser -k -9 3000/tcp 2>/dev/null || true
  fi
  if command -v lsof >/dev/null 2>&1; then
    lsof -ti:3000 | xargs -r kill -9 2>/dev/null || true
  fi

  # 3. Fallback kill on any remaining next-server or node instances
  pkill -9 -f 'next-server|node|pnpm' 2>/dev/null || true

  # 4. Wait up to 5 seconds to ensure port 3000 is completely free
  for i in {1..5}; do
    if ! ss -tuln 2>/dev/null | grep -q ':3000 ' && ! netstat -tuln 2>/dev/null | grep -q ':3000 '; then
      echo "Port 3000 successfully freed."
      exit 0
    fi
    sleep 1
  done
  echo "Warning: Port 3000 might still have TIME_WAIT sockets, proceeding..."
EOF

echo ""
echo "========================================================"
echo "[4/4] Starting fresh server in tmux..."
echo "========================================================"
ssh -p $PORT "$TABLET_USER@$TABLET_IP" 'bash -s' << 'EOF'
  # Create a clean new tmux session
  tmux new-session -d -s journal
  # Send start command
  tmux send-keys -t journal "cd ~/trade-journal && HOST=0.0.0.0 PORT=3000 pnpm start" C-m
EOF

echo ""
echo "Deployment complete! Verify with: ssh -p $PORT $TABLET_USER@$TABLET_IP 'tmux a -t journal'"