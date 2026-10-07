@echo off
setlocal enabledelayedexpansion

set TABLET_IP=100.73.77.95
set TABLET_PORT=8022
set LOCAL_DATA=apps\web\data
set REMOTE_DATA=~/trade-journal/apps/web/data

echo ========================================================
echo [1/5] Stopping tablet server to release SQLite locks...
echo ========================================================
ssh -p %TABLET_PORT% markc@%TABLET_IP% "pkill -f node"

echo.
echo ========================================================
echo [2/5] PULLING latest database (including WAL) to PC...
echo ========================================================
if not exist "%LOCAL_DATA%" mkdir "%LOCAL_DATA%"

:: Pull journal.db and any active journal.db-wal / journal.db-shm
scp -P %TABLET_PORT% markc@%TABLET_IP%:%REMOTE_DATA%/journal.db* %LOCAL_DATA%\

:: Local safety backup
copy /Y "%LOCAL_DATA%\journal.db" "%LOCAL_DATA%\journal_backup.db" >nul

echo.
echo ========================================================
echo [3/5] Merging MT5 trades & preserving journal notes...
echo ========================================================
python mt5_notion_sync_wine.py

echo.
echo ========================================================
echo [4/5] PUSHING consolidated database back to tablet...
echo ========================================================
:: Push the consolidated main database
scp -P %TABLET_PORT% %LOCAL_DATA%\journal.db markc@%TABLET_IP%:%REMOTE_DATA%/journal.db

:: Clean up old WAL files on tablet now that everything is merged into journal.db
ssh -p %TABLET_PORT% markc@%TABLET_IP% "rm -f %REMOTE_DATA%/journal.db-wal %REMOTE_DATA%/journal.db-shm"

echo.
echo ========================================================
echo [5/5] Restarting journal server on tablet...
echo ========================================================
ssh -p %TABLET_PORT% markc@%TABLET_IP% "cd ~/trade-journal && nohup npm run start > server.log 2>&1 &"

echo.
echo === Sync Complete! All notes and manual edits preserved. ===
pause