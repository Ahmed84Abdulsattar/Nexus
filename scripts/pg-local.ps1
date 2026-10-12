# Start, stop or check a portable (no-installer, no-admin) PostgreSQL 16 for local dev on Windows.
# The alternative to `docker compose up -d` when Docker is not available. Same setup as docker-compose.yml:
# superuser `nexus`, database `nexus`, localhost:5432 only, trust auth on loopback, server time zone UTC.
#
# Usage:  powershell -ExecutionPolicy Bypass -File scripts/pg-local.ps1 start|stop|status
#
# Defaults (override with env vars):
#   NEXUS_PG_BIN   %LOCALAPPDATA%\Programs\pgsql-16\bin   (bin\ of the EDB "zip binaries" download)
#   NEXUS_PG_DATA  %LOCALAPPDATA%\nexus\pgdata            (created once with initdb, see below)
#
# One-time setup on a new machine:
#   1. Download postgresql-16.x-1-windows-x64-binaries.zip from
#      https://www.enterprisedb.com/download-postgresql-binaries and extract its pgsql\ folder
#      to %LOCALAPPDATA%\Programs\pgsql-16.
#   2. initdb -D %LOCALAPPDATA%\nexus\pgdata -U nexus --auth=trust --encoding=UTF8 --locale=en-US
#   3. In pgdata\pg_hba.conf keep only the two `host all all 127.0.0.1/32|::1/128 trust` lines;
#      in pgdata\postgresql.conf set listen_addresses = 'localhost', timezone = 'UTC', log_timezone = 'UTC'.
#   4. scripts/pg-local.ps1 start, then: psql -h localhost -U nexus -d postgres -c "CREATE DATABASE nexus"

param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet('start', 'stop', 'status')]
  [string]$Command
)

$ErrorActionPreference = 'Stop'

$bin = if ($env:NEXUS_PG_BIN) { $env:NEXUS_PG_BIN } else { Join-Path $env:LOCALAPPDATA 'Programs\pgsql-16\bin' }
$data = if ($env:NEXUS_PG_DATA) { $env:NEXUS_PG_DATA } else { Join-Path $env:LOCALAPPDATA 'nexus\pgdata' }
$pgCtl = Join-Path $bin 'pg_ctl.exe'

if (-not (Test-Path $pgCtl)) { throw "pg_ctl.exe not found in $bin. Set NEXUS_PG_BIN or see the setup steps at the top of this script." }
if (-not (Test-Path (Join-Path $data 'PG_VERSION'))) { throw "No PostgreSQL data directory at $data. Set NEXUS_PG_DATA or see the setup steps at the top of this script." }

switch ($Command) {
  'start' {
    # -w waits until the server accepts connections. Startup errors go to pg_ctl.log; the server log is pgdata\log\.
    & $pgCtl start -D $data -w -t 60 -l (Join-Path $data 'pg_ctl.log')
  }
  'stop' {
    # fast: roll back open transactions and disconnect clients, then shut down cleanly.
    & $pgCtl stop -D $data -w -m fast
  }
  'status' {
    & $pgCtl status -D $data
  }
}
exit $LASTEXITCODE
