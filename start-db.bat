@echo off
REM Start (or ensure) the ZATCA-dedicated PostgreSQL 16 cluster on port 5433.
REM Native (no Docker). Data lives in pgdata5433\ under the project so it stays
REM isolated from the other ERP project's Postgres on 5432.
REM
REM Idempotent: if 5433 is already listening it just reports and exits 0, so it
REM is safe to call as a pre-step before launching the backend.
REM
REM Usage:  start-db.bat        (start / ensure)
REM         start-db.bat stop   (stop)
REM         start-db.bat status (status)

set PGBIN=H:\PostgreSQL\16\bin
set PGDATA=%~dp0pgdata5433

if /I "%1"=="stop" (
    "%PGBIN%\pg_ctl.exe" -D "%PGDATA%" stop
    goto :eof
)
if /I "%1"=="status" (
    "%PGBIN%\pg_ctl.exe" -D "%PGDATA%" status
    goto :eof
)

REM Already running? netstat for a 5433 LISTENING socket.
netstat -ano | findstr ":5433 " | findstr LISTENING >nul 2>&1
if %ERRORLEVEL%==0 (
    echo [db] ZATCA Postgres already running on 127.0.0.1:5433
    exit /b 0
)

"%PGBIN%\pg_ctl.exe" -D "%PGDATA%" -l "%PGDATA%\server.log" start
echo [db] ZATCA Postgres started on 127.0.0.1:5433 (db: zatca, user: postgres)
exit /b 0
