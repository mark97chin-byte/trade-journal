#!/bin/bash
set -e

# Always run from the script's repository folder
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

# 1. Grab commit message from command arguments or prompt the user
if [ -n "$1" ]; then
  COMMIT_MSG="$1"
else
  echo -n "Enter commit message: "
  read -r COMMIT_MSG
fi

# Fallback default if user hits Enter without typing anything
if [ -z "$COMMIT_MSG" ]; then
  COMMIT_MSG="Update: $(date '+%Y-%m-%d %H:%M:%S')"
fi

# 2. Stage all modifications and additions
echo "Staging files..."
git add .

# 3. Check if there are staged changes to commit
if git diff --cached --quiet; then
  echo "No changes detected to commit."
else
  echo "Committing with message: '$COMMIT_MSG'"
  git commit -m "$COMMIT_MSG"
fi

# 4. Push to your GitHub fork
echo "Pushing to origin main..."
git push origin main

echo "Push to GitHub completed successfully!"
