@echo off
cd /d "%~dp0"
if exist ".venv\Scripts\python.exe" (
    ".venv\Scripts\python.exe" mt5_notion_sync_wine.py %*
) else (
    python mt5_notion_sync_wine.py %*
)
EOF