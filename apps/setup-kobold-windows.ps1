# Run with: powershell -ExecutionPolicy Bypass -File .\setup-kobold-windows.ps1
Write-Host "=== [Trade Journal AI] Windows Setup (RTX 4070 Super + 64GB RAM) ===" -ForegroundColor Cyan

$aiDir = "$HOME\koboldcpp"
$modelDir = "$aiDir\models"
if (-not (Test-Path $modelDir)) { New-Item -ItemType Directory -Path $modelDir -Force }

# 1. Download official KoboldCpp Windows CUDA executable
$exePath = "$aiDir\koboldcpp.exe"
if (-not (Test-Path $exePath)) {
    Write-Host "[1/3] Downloading KoboldCpp Windows CUDA release..." -ForegroundColor Yellow
    Invoke-WebRequest -Uri "https://github.com/LostRuins/koboldcpp/releases/latest/download/koboldcpp.exe" -OutFile $exePath
}

# 2. Allow port 5001 through Windows Firewall
New-NetFirewallRule -DisplayName "KoboldCpp AI Server" -Direction Inbound -LocalPort 5001 -Protocol TCP -Action Allow -ErrorAction SilentlyContinue

# 3. Create Windows Launcher: start-kobold.bat
$batPath = "$aiDir\start-kobold.bat"
$batContent = @"
@echo off
set MODEL=%USERPROFILE%\koboldcpp\models\Qwen3.8-27B-Q4_K_M.gguf
set PORT=5001
echo Starting KoboldCpp on 0.0.0.0:%PORT%...
cd /d "%USERPROFILE%\koboldcpp"
koboldcpp.exe --model "%MODEL%" --host 0.0.0.0 --port %PORT% --usecublas --gpulayers 42 --contextsize 32768 --flashattention --quantkv 1 --contextshift --skiplauncher
"@
Set-Content -Path $batPath -Value $batContent

Write-Host "`n=== Windows Setup Complete! ===" -ForegroundColor Green
Write-Host "Run $aiDir\start-kobold.bat to start the AI server on Windows."