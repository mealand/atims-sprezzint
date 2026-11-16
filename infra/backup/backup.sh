#!/bin/sh
# ATiMs nightly Postgres backup: pg_dump -> gzip -> MinIO bucket.
# Runs as a Railway cron service. Required env:
#   DATABASE_URL, MINIO_ENDPOINT (private), MINIO_ACCESS_KEY, MINIO_SECRET_KEY,
#   BACKUP_BUCKET (default atims-backups), RETENTION_DAYS (default 7)
set -e

TS="$(date -u +%Y%m%dT%H%M%SZ)"
BUCKET="${BACKUP_BUCKET:-atims-backups}"
DUMP="/tmp/atims-${TS}.sql.gz"

echo "▶ dumping database..."
pg_dump "$DATABASE_URL" --no-owner --no-privileges | gzip > "$DUMP"
SIZE=$(du -k "$DUMP" | cut -f1)
echo "▶ dump size: ${SIZE} KB"

echo "▶ configuring MinIO client..."
mcli alias set atims "$MINIO_ENDPOINT" "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY" --api S3v4 >/dev/null
mcli mb --ignore-existing "atims/${BUCKET}" >/dev/null

echo "▶ uploading..."
mcli cp "$DUMP" "atims/${BUCKET}/"

echo "▶ pruning backups older than ${RETENTION_DAYS:-7} days..."
mcli rm --recursive --force --older-than "${RETENTION_DAYS:-7}d" "atims/${BUCKET}/" || true

rm -f "$DUMP"
echo "✓ backup complete: ${BUCKET}/atims-${TS}.sql.gz"
