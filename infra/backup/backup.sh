#!/bin/sh
# ATiMs nightly Postgres backup: pg_dump -> verify -> gzip -> MinIO bucket -> prune.
# Runs as a Railway cron service (see README.md in this folder). Required env:
#   DATABASE_URL, MINIO_ENDPOINT (private), MINIO_ACCESS_KEY, MINIO_SECRET_KEY
# Optional env:
#   BACKUP_BUCKET (default atims-backups), RETENTION_DAYS (default 7)
#
# Safety rules: any failure exits non-zero (Railway marks the run failed),
# nothing is uploaded unless the dump is verified complete, and old backups
# are pruned only after the new one is confirmed in the bucket.
set -eu
set -o pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${MINIO_ENDPOINT:?MINIO_ENDPOINT is required}"
: "${MINIO_ACCESS_KEY:?MINIO_ACCESS_KEY is required}"
: "${MINIO_SECRET_KEY:?MINIO_SECRET_KEY is required}"
BUCKET="${BACKUP_BUCKET:-atims-backups}"
RETENTION="${RETENTION_DAYS:-7}"

TS="$(date -u +%Y%m%dT%H%M%SZ)"
NAME="atims-${TS}.sql.gz"
WORK="$(mktemp -d)"
RAW="${WORK}/atims-${TS}.sql"
DUMP="${WORK}/${NAME}"
trap 'rm -rf "$WORK"' EXIT

log() { echo "[backup $(date -u +%H:%M:%S)] $*"; }
fail() { log "FAILED: $*"; exit 1; }

log "pg_dump client: $(pg_dump --version)"
SERVER_VERSION="$(psql "$DATABASE_URL" -Atc 'show server_version' 2>&1)" \
  || fail "cannot connect to database: ${SERVER_VERSION}"
log "database server: ${SERVER_VERSION}"

log "dumping database..."
pg_dump "$DATABASE_URL" --no-owner --no-privileges --file "$RAW" \
  || fail "pg_dump exited with an error (check that the image's PG_MAJOR >= server version)"

# A complete plain-format dump always ends with this marker.
tail -n 5 "$RAW" | grep -q -- "-- PostgreSQL database dump complete" \
  || fail "dump is incomplete (completion marker missing)"

gzip "$RAW"               # produces $RAW.gz
mv "${RAW}.gz" "$DUMP"
gzip -t "$DUMP" || fail "compressed dump failed integrity check"
SIZE_KB="$(du -k "$DUMP" | cut -f1)"
log "dump verified: ${NAME} (${SIZE_KB} KB)"

log "connecting to object storage..."
mcli alias set atims "$MINIO_ENDPOINT" "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY" --api S3v4 >/dev/null 2>&1 \
  || fail "invalid MinIO endpoint or credentials format"
# `alias set` does not always connect; the first real request is the bucket check.
# Retry it to ride out private-network DNS warming up in a fresh container.
i=1
until ERR="$(mcli mb --ignore-existing "atims/${BUCKET}" 2>&1)"; do
  [ "$i" -ge 5 ] && fail "cannot reach MinIO bucket ${BUCKET} at ${MINIO_ENDPOINT} after 5 attempts: ${ERR}"
  log "storage not reachable yet (attempt ${i}/5), retrying in 5s..."
  i=$((i + 1))
  sleep 5
done

log "uploading..."
mcli cp --quiet "$DUMP" "atims/${BUCKET}/${NAME}" >/dev/null || fail "upload failed"
mcli stat "atims/${BUCKET}/${NAME}" >/dev/null || fail "uploaded object not found in bucket"
log "upload confirmed: ${BUCKET}/${NAME}"

# Prune only now that today's backup is safely stored.
log "pruning backups older than ${RETENTION} days..."
mcli rm --recursive --force --older-than "${RETENTION}d" "atims/${BUCKET}/" >/dev/null 2>&1 \
  || log "prune step reported an error (new backup is safe; check bucket manually)"

COUNT="$(mcli ls "atims/${BUCKET}/" | grep -c '\.sql\.gz' || true)"
log "backup complete: ${BUCKET}/${NAME} (${SIZE_KB} KB, ${COUNT} backups retained)"
