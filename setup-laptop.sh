#!/usr/bin/env bash
set -e

TABLET_HOST="100.73.77.95"
TABLET_PORT="8022"

echo "=== [Trade Journal] Linux Laptop Auto-Setup ==="

# 1. Update repository
if [ -d .git ]; then
    echo "[1/6] Updating Git repository to latest main..."
    git pull origin main
fi

# 2. Install dependencies (OpenSSH Server & Xvfb)
echo "[2/6] Installing OpenSSH Server & Virtual Display (Xvfb)..."
sudo dnf install -y openssh-server xorg-x11-server-Xvfb

# 3. Enable and Start SSH Daemon
echo "[3/6] Starting SSH service..."
sudo systemctl enable --now sshd

# 4. Enable Tailscale SSH
echo "[4/6] Configuring Tailscale SSH..."
if command -v tailscale >/dev/null 2>&1; then
    sudo tailscale set --ssh || true
fi

# 5. Authorize Tablet's SSH Key for Passwordless Sync
echo "[5/6] Authorizing Tablet (100.73.77.95) for passwordless sync..."
mkdir -p ~/.ssh && chmod 700 ~/.ssh
touch ~/.ssh/authorized_keys

# Try fetching public key from tablet over Tailscale
if nc -z -w 3 "$TABLET_HOST" "$TABLET_PORT" 2>/dev/null; then
    TABLET_KEY=$(ssh -p "$TABLET_PORT" "$TABLET_HOST" "cat ~/.ssh/id_ed25519.pub 2>/dev/null" || true)
    if [ -n "$TABLET_KEY" ] && ! grep -q "$TABLET_KEY" ~/.ssh/authorized_keys; then
        echo "$TABLET_KEY" >> ~/.ssh/authorized_keys
        echo "[+] Added Tablet public key to authorized_keys."
    fi
fi
chmod 600 ~/.ssh/authorized_keys
restorecon -R -v ~/.ssh 2>/dev/null || true

# 6. Set execution permissions on scripts
echo "[6/6] Setting script permissions..."
chmod +x sync-mt5.sh setup-linux.sh 2>/dev/null || true

echo ""
echo "=== Success! Linux Laptop is ready to sync MT5 trades headlessly over Tailscale. ==="
