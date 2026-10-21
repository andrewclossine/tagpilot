@echo off
rem Tangira Konti AI kuri iyi mudasobwa / Start Konti AI on this computer.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js ntirimo kuri iyi mudasobwa. Yishyiremo uvuye kuri https://nodejs.org hanyuma wongere ugerageze.
  echo Node.js is not installed. Install it from https://nodejs.org and try again.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Turimo gushyiramo ibikenewe bwa mbere... / Installing for the first time...
  call npm install
)
if not exist .env.local copy .env.example .env.local >nul
echo.
echo Konti AI irimo gutangira. Fungura http://localhost:3000 muri browser.
echo Konti AI is starting. Open http://localhost:3000 in your browser.
echo Kugira ngo uyihagarike, kanda Ctrl+C. / Press Ctrl+C to stop.
start "" http://localhost:3000
call npm run dev
