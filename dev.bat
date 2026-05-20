@echo off
REM ZATCA dev convenience script — one command to start, stop, or restart both
REM backend (FastAPI on :8001) and frontend (Next.js on :3000).
REM
REM Usage:
REM   dev.bat up       Start both servers (backend in one window, frontend in another)
REM   dev.bat down     Kill both servers
REM   dev.bat restart  Down + up
REM   dev.bat back     Start only the backend
REM   dev.bat front    Start only the frontend
REM
REM Backend runs with --reload, so editing any .py under app\backend\app\
REM auto-restarts uvicorn without re-running this script.

setlocal
set ROOT=%~dp0
set BACKEND_DIR=%ROOT%app\backend
set FRONTEND_DIR=%ROOT%app\frontend

if "%1"=="" goto :usage
if /I "%1"=="up"      goto :up
if /I "%1"=="down"    goto :down
if /I "%1"=="restart" goto :restart
if /I "%1"=="back"    goto :back
if /I "%1"=="front"   goto :front
goto :usage

:up
call :down_silent
call :back
call :front
goto :end

:down
call :down_silent
echo [dev] both servers stopped.
goto :end

:restart
call :down_silent
timeout /t 1 /nobreak >nul
call :back
call :front
goto :end

:back
echo [dev] starting backend on :8001 (auto-reload watching app\)...
start "ZATCA backend (:8001)" cmd /k "cd /d %BACKEND_DIR% && .venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8001 --reload --reload-dir app"
goto :end

:front
echo [dev] starting frontend on :3000...
start "ZATCA frontend (:3000)" cmd /k "cd /d %FRONTEND_DIR% && pnpm run dev"
goto :end

:down_silent
REM Free both ports by killing any python.exe / node.exe processes that own them.
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":8001 " ^| findstr LISTENING') do (
  taskkill /F /PID %%P >nul 2>&1
)
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":3000 " ^| findstr LISTENING') do (
  taskkill /F /PID %%P >nul 2>&1
)
REM Also clear __pycache__ so a stale .pyc never beats fresh source.
if exist "%BACKEND_DIR%\app" (
  for /d /r "%BACKEND_DIR%\app" %%D in (__pycache__) do (
    if exist "%%D" rd /s /q "%%D" 2>nul
  )
)
exit /b 0

:usage
echo.
echo ZATCA dev runner
echo ----------------
echo   dev.bat up        Start backend (:8001) and frontend (:3000)
echo   dev.bat down      Stop both
echo   dev.bat restart   Stop then start both
echo   dev.bat back      Start only the backend
echo   dev.bat front     Start only the frontend
echo.
goto :end

:end
endlocal
