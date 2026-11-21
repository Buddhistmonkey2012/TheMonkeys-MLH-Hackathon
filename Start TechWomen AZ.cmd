@echo off
setlocal
cd /d "%~dp0"
where node.exe >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22.13 or later before starting TechWomen AZ.
  pause
  exit /b 1
)
echo Open the TechWomen AZ address shown below in your browser. Keep this window open while you use the app.
node --env-file-if-exists=.env local.mjs --accounts
if errorlevel 1 pause
