@echo off
title SPACE-JAY-LAUNCHER

:: Kill any existing Chrome instances (kiosk won't work if Chrome is already open)
taskkill /F /IM chrome.exe >nul 2>&1
timeout /t 1 /nobreak >nul

:: Kill any leftover server on port 8765
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8765"') do taskkill /F /PID %%a >nul 2>&1

:: Wipe the kiosk profile so Chrome never sees a "didn't shut down cleanly" state
if exist "%TEMP%\space-jay-chrome" rmdir /s /q "%TEMP%\space-jay-chrome"

:: Start no-cache Python server silently in background
start "" /B python "C:\Users\jcerc\OneDrive\Documents\GitHub\space-jay\server.py"
timeout /t 2 /nobreak >nul

:: Launch Chrome in true kiosk mode
:: --no-first-run                   skip first-run dialogs
:: --disable-infobars               no "Chrome is being controlled" bar
:: --disable-session-crashed-bubble suppress crash restore prompt
:: --restore-last-session=0         don't restore previous session
:: --hide-crash-restore-bubble      hide the restore bubble if it appears
"C:\Program Files\Google\Chrome\Application\chrome.exe" ^
  --kiosk ^
  --no-first-run ^
  --disable-infobars ^
  --disable-session-crashed-bubble ^
  --hide-crash-restore-bubble ^
  --disable-features=TranslateUI ^
  --user-data-dir="%TEMP%\space-jay-chrome" ^
  "http://localhost:8765/index.html"

:: Chrome has exited — clean up server and wipe the profile for next time
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8765"') do taskkill /F /PID %%a >nul 2>&1
if exist "%TEMP%\space-jay-chrome" rmdir /s /q "%TEMP%\space-jay-chrome"
exit
