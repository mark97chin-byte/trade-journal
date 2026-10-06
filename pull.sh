#!/bin/bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "Fetching latest changes from GitHub..."
git pull --rebase origin main

echo "Your local folder is up to date!"
