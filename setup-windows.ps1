# Run with: powershell -ExecutionPolicy Bypass -File .\setup-windows.ps1
Write-Host "=== [Trade Journal] Windows Turnkey Setup ===" -ForegroundColor Cyan

$TABLET_HOST = "100.73.77.95"
$TABLET_PORT = 8022

# 1. Update Repository
if (Test-Path ".git") {
    Write-Host "[1/5] Pulling latest repository updates..." -ForegroundColor Yellow
    git pull origin main
}

# 2. Install and Start Windows OpenSSH Server
Write-Host "[2/5] Enabling Windows OpenSSH Server..." -ForegroundColor Yellow
$sshService = Get-Service -Name sshd -ErrorAction SilentlyContinue
if (-not $sshService) {
    Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
}
Set-Service -Name sshd -StartupType 'Automatic'
Start-Service sshd

# Ensure firewall allows port 22
New-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -DisplayName 'OpenSSH SSH Server (sshd)' -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22 -ErrorAction SilentlyContinue

# 3. Setup Python Virtual Environment and MetaTrader5 package
Write-Host "[3/5] Setting up native Python & MetaTrader5..." -ForegroundColor Yellow
if (-not (Test-Path ".venv")) {
    python -m venv .venv
}
& .\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install MetaTrader5

if (Test-Path "requirements.txt") {
    pip install -r requirements.txt
}

# 4. Authorize Tablet SSH Key for Passwordless Remote Sync
Write-Host "[4/5] Authorizing Tablet SSH Key..." -ForegroundColor Yellow
$sshDir = "$HOME\.ssh"
if (-not (Test-Path $sshDir)) {
    New-Item -ItemType Directory -Path $sshDir | Out-Null
}
$authKeys = "$sshDir\authorized_keys"

# Fetch tablet public key over Tailscale
try {
    $tabletKey = (ssh -p $TABLET_PORT $TABLET_HOST "cat ~/.ssh/id_ed25519.pub 2>/dev/null")
    if ($tabletKey -and (-not (Test-Path $authKeys) -or -not (Select-String -Path $authKeys -Pattern $tabletKey -Quiet))) {
        Add-Content -Path $authKeys -Value $tabletKey
        Write-Host "[+] Tablet public key added." -ForegroundColor Green
    }
} catch {
    Write-Host "[!] Could not fetch key automatically from tablet. You can paste it into $authKeys manually." -ForegroundColor DarkYellow
}

# Apply strict Windows ACLs to authorized_keys (required by OpenSSH on Windows)
if (Test-Path $authKeys) {
    icacls $authKeys /inheritance:r /grant "Administrators:F" "${env:USERNAME}:F" "SYSTEM:F" | Out-Null
}

# 5. Enable Tailscale SSH
Write-Host "[5/5] Checking Tailscale SSH..." -ForegroundColor Yellow
if (Get-Command tailscale -ErrorAction SilentlyContinue) {
    tailscale set --ssh
}

Write-Host "`n=== Success! Windows Desktop is configured and ready for headless sync! ===" -ForegroundColor Green
EOF