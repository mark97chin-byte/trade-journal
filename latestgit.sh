#!/usr/bin/env bash
set -e

echo "=========================================="
echo " Syncing Trade Journal Repository"
echo "=========================================="

# 1. Check for uncommitted work
if ! git diff-index --quiet HEAD --; then
  echo "⚠️  You have uncommitted changes. Stashing them temporarily..."
  git stash push -m "auto-stash-before-sync-$(date +%s)"
  STASHED=1
else
  STASHED=0
fi

# 2. Fetch and pull latest main
echo "--> Fetching and pulling latest changes from origin/main..."
git checkout main
git pull origin main

# 3. Restore stashed changes if any were present
if [ "$STASHED" -eq 1 ]; then
  echo "--> Restoring stashed changes..."
  git stash pop || echo "⚠️  Merge conflict while popping stash. Please review git status."
fi

# 4. Install updated dependencies
echo "--> Installing dependencies via pnpm..."
pnpm install

# 5. Typecheck & build
echo "--> Verifying Next.js build..."
pnpm --filter web build

echo ""
echo "=========================================="
echo " Sync complete. Repository is up to date!"
echo "=========================================="