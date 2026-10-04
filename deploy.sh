#!/bin/bash
set -e

TABLET_IP="100.73.77.95"
TABLET_USER="u0_a322"
PORT="8022"

echo "Building on desktop..."
pnpm build

echo "Syncing build artifacts to tablet..."
rsync -avz --delete -e "ssh -p $PORT" apps/web/.next/ "$TABLET_USER@$TABLET_IP:~/trade-journal/apps/web/.next/"

echo "Restarting service on tablet..."
ssh -p $PORT "$TABLET_USER@$TABLET_IP" "tmux send-keys -t journal C-c 'HOST=0.0.0.0 PORT=3000 pnpm start' C-m"

echo "Deployment complete!"
