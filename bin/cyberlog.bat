@echo off
rem Open Cyberlog in its own window. Starts the local Rust server if it is not already up.
setlocal EnableExtensions

set "HERE=%~dp0"
if defined CYBERLOG_PORT (set "PORT=%CYBERLOG_PORT%") else (set "PORT=47660")
set "STATE=%LOCALAPPDATA%\cyberlog"
set "PROFILE=%STATE%\profile"
if not exist "%PROFILE%" mkdir "%PROFILE%"

set "BIN="
if exist "%HERE%cyberlog.exe" set "BIN=%HERE%cyberlog.exe"
if not defined BIN if exist "%HERE%..\target\release\cyberlog.exe" set "BIN=%HERE%..\target\release\cyberlog.exe"
if not defined BIN (
  where cargo >nul 2>&1
  if errorlevel 1 (
    echo Cyberlog needs Rust. Install it from https://rustup.rs, then run this again.
    pause
    exit /b 1
  )
  cargo build --release --manifest-path "%HERE%..\Cargo.toml"
  if errorlevel 1 (
    echo Cargo build failed.
    pause
    exit /b 1
  )
  set "BIN=%HERE%..\target\release\cyberlog.exe"
)

"%BIN%" --ping --port %PORT%
if not errorlevel 1 goto open
start "Cyberlog server" /min cmd /c ""%BIN%" --port %PORT% >> "%STATE%\server.log" 2>&1"
for /l %%i in (1,1,50) do (
  "%BIN%" --ping --port %PORT%
  if not errorlevel 1 goto open
  ping -n 1 -w 100 127.0.0.1 >nul
)
echo Cyberlog did not start. See %STATE%\server.log
pause
exit /b 1

:open
if /i "%~1"=="--no-open" exit /b 0
set "URL=http://127.0.0.1:%PORT%/"
set "FLAGS=--app=%URL% --user-data-dir="%PROFILE%" --no-first-run --no-default-browser-check"
for %%B in (
  "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
  "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
  "%ProgramFiles%\Google\Chrome\Application\chrome.exe"
  "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
  "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
) do (
  if exist "%%~B" (
    start "" "%%~B" %FLAGS%
    exit /b 0
  )
)
start "" "%URL%"
exit /b 0
