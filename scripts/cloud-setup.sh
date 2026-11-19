#!/usr/bin/env bash
# Prepare a development environment for ATiMs (Claude Code cloud VM, Codespaces, or any Ubuntu box).
# Safe to run repeatedly. Uses the VM's preinstalled PostgreSQL; never touches production.
#
#   bash scripts/cloud-setup.sh
#
set -euo pipefail
cd "$(dirname "$0")/.."

say() { echo "[setup] $*"; }

# 1. Dependencies
if [ ! -d node_modules ] || [ package-lock.json -nt node_modules ]; then
  say "installing npm dependencies"
  npm ci --no-audit --no-fund
else
  say "dependencies already installed"
fi

# 2. PostgreSQL (preinstalled in the Claude Code cloud image; installed here if missing)
if ! command -v pg_ctlcluster >/dev/null 2>&1 && ! command -v psql >/dev/null 2>&1; then
  say "installing postgresql"
  if [ "$(id -u)" -eq 0 ]; then apt-get update -qq && apt-get install -y -qq postgresql >/dev/null
  else sudo apt-get update -qq && sudo apt-get install -y -qq postgresql >/dev/null; fi
fi
as_root() { if [ "$(id -u)" -eq 0 ]; then "$@"; else sudo "$@"; fi; }
as_postgres() { if [ "$(id -u)" -eq 0 ]; then su postgres -c "$*"; else sudo -u postgres bash -c "$*"; fi; }

say "starting postgresql"
as_root service postgresql start >/dev/null 2>&1 || true
for i in $(seq 1 20); do
  as_postgres "pg_isready -q" && break
  sleep 1
done
as_postgres "pg_isready -q" || { say "postgresql did not start"; exit 1; }

say "ensuring role and database 'atims'"
as_postgres "psql -qtAc \"SELECT 1 FROM pg_roles WHERE rolname='atims'\" | grep -q 1 || psql -qc \"CREATE ROLE atims LOGIN PASSWORD 'atims' CREATEDB\""
as_postgres "psql -qtAc \"SELECT 1 FROM pg_database WHERE datname='atims'\" | grep -q 1 || psql -qc \"CREATE DATABASE atims OWNER atims\""
as_postgres "psql -q -d atims -c 'CREATE EXTENSION IF NOT EXISTS pgcrypto'"

# 3. api/.env for local development (gitignored; throwaway values only)
if [ ! -f api/.env ]; then
  say "writing api/.env (dev only)"
  sed \
    -e "s#^DATABASE_URL=.*#DATABASE_URL=postgres://atims:atims@localhost:5432/atims#" \
    -e "s#^JWT_SECRET=.*#JWT_SECRET=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')#" \
    -e "s#^ATIMS_ADMIN_PASSWORD=.*#ATIMS_ADMIN_PASSWORD=dev-admin-password#" \
    -e "s#^MINIO_ENDPOINT=.*#MINIO_ENDPOINT=#" \
    api/.env.example > api/.env
else
  say "api/.env exists, leaving it"
fi

# 4. Migrations (+ dev admin bootstrap: NX id ATIMS-ADMIN-000001 / dev-admin-password, local only)
say "running migrations"
npm run migrate -w @atims/api

say "done. Try: npm test -w @atims/api && npm run build"
