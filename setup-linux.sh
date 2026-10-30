#!/usr/bin/env bash
set -e

echo "=== [Trade Journal] Linux Setup & Update ==="

# 1. Check and pull latest Git commits
if [ -d .git ]; then
    echo "[1/5] Checking Git remote for updates..."
    git fetch origin main
    LOCAL_HASH=$(git rev-parse HEAD)
    REMOTE_HASH=$(git rev-parse origin/main)

    if [ "$LOCAL_HASH" != "$REMOTE_HASH" ]; then
        echo "Updating repository to latest main..."
        git pull --rebase origin main
    else
        echo "Repository is already up to date ($LOCAL_HASH)."
    fi
fi

# 2. Verify OpenSSH Server
echo "[2/5] Checking SSH daemon..."
if command -v systemctl >/dev/null 2>&1; then
    if systemctl is-active --quiet sshd; then
        echo "sshd is active."
    else
        echo "Enabling and starting sshd..."
        sudo systemctl enable --now sshd
    fi
fi

# 3. Verify Tailscale SSH
echo "[3/5] Checking Tailscale SSH..."
if command -v tailscale >/dev/null 2>&1; then
    sudo tailscale set --ssh || echo "Tailscale SSH already configured or requires login."
fi

# 4. Set up Python Environment for MT5 / scripts
echo "[4/5] Checking Python virtual environment..."
if [ ! -d ".venv" ]; then
    echo "Creating python virtual environment in .venv..."
    python3 -m venv .venv
fi
source .venv/bin/activate
pip install --upgrade pip >/dev/null 2>&1

if [ -f "requirements.txt" ]; then
    echo "Installing Python dependencies..."
    pip install -r requirements.txt
fi

# 5. Make scripts executable
echo "[5/5] Ensuring execution permissions..."
[ -f "sync-mt5.sh" ] && chmod +x sync-mt5.sh
[ -f "deploy.sh" ] && chmod +x deploy.sh

echo "=== Linux Setup Complete! ==="
