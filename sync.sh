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
# Sync .next build directory; exclude cache to save bandwidth and card wear
rsync -avz --delete \
  --exclude="cache/" \
  -e "ssh -p $PORT" \
  apps/web/.next/ "$TABLET_USER@$TABLET_IP:~/trade-journal/apps/web/.next/"

# Sync public directory if it exists
if [ -d "apps/web/public" ]; then
  rsync -avz --delete \
    -e "ssh -p $PORT" \
    apps/web/public/ "$TABLET_USER@$TABLET_IP:~/trade-journal/apps/web/public/"
fi

echo ""
echo "========================================================"
echo "[3/4] Ensuring port 3000 is completely released..."
echo "========================================================"
ssh -p $PORT "$TABLET_USER@$TABLET_IP" 'bash -s' << 'EOF'
  tmux kill-session -t journal 2>/dev/null || true

  if command -v fuser >/dev/null 2>&1; then
    fuser -k -9 3000/tcp 2>/dev/null || true
  fi
  if command -v lsof >/dev/null 2>&1; then
    lsof -ti:3000 | xargs -r kill -9 2>/dev/null || true
  fi

  pkill -9 -f 'next-server|node|pnpm' 2>/dev/null || true

  for i in {1..5}; do
    if ! ss -tuln 2>/dev/null | grep -q ':3000 ' && ! netstat -tuln 2>/dev/null | grep -q ':3000 '; then
      echo "Port 3000 successfully freed."
      exit 0
    fi
    sleep 1
  done
  echo "Proceeding..."
EOF

echo ""
echo "========================================================"
echo "[4/4] Starting fresh server in tmux..."
echo "========================================================"
ssh -p $PORT "$TABLET_USER@$TABLET_IP" 'bash -s' << 'EOF'
  tmux new-session -d -s journal
  tmux send-keys -t journal "cd ~/trade-journal && HOST=0.0.0.0 PORT=3000 pnpm start" C-m
EOF

echo "Waiting for Next.js to initialize..."
sleep 4

# Automated HTTP Verification
HTTP_CODE=$(ssh -p $PORT "$TABLET_USER@$TABLET_IP" "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/ || true")
if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "307" ] || [ "$HTTP_CODE" = "308" ]; then
  echo "Server is live and healthy (HTTP $HTTP_CODE)!"
else
  echo "Server started. Verify output with: ssh -p $PORT $TABLET_USER@$TABLET_IP 'tmux a -t journal'"
fi

echo "Deployment complete!"