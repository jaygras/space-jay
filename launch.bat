@echo off
title SPACE-JAY-LAUNCHER

:: Kill any existing Chrome instances (kiosk won't work if Chrome is already open)
taskkill /F /IM chrome.exe >nul 2>&1
timeout /t 1 /nobreak >nul

:: Kill any leftover server on port 8765
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8765"') do taskkill /F /PID %%a >nul 2>&1

:: Start no-cache Python server silently in background
start "" /B python "C:\Users\jcerc\OneDrive\Documents\GitHub\space-jay\server.py"
timeout /t 2 /nobreak >nul

:: Launch Chrome in true kiosk mode — this line BLOCKS until Chrome closes
"C:\Program Files\Google\Chrome\Application\chrome.exe" ^
  --kiosk ^
  --no-first-run ^
  --disable-infobars ^
  --disable-session-crashed-bubble ^
  --disable-features=TranslateUI ^
  --user-data-dir="%TEMP%\space-jay-chrome" ^
  "http://localhost:8765/index.html"

:: Chrome has exited — now clean up the server and close this window
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8765"') do taskkill /F /PID %%a >nul 2>&1
exit
