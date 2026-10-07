@echo off
setlocal enabledelayedexpansion

set MSG=%~1

if "%MSG%"=="" (
    set /p MSG="Enter commit message: "
)

if "%MSG%"=="" (
    set MSG="Update: %date% %time%"
)

echo Staging files...
git add .

echo Committing with message: "!MSG!"
git commit -m "!MSG!"

echo Pushing to origin main...
git push origin main

echo Push completed!