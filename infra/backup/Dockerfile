# ATiMs nightly backup job: pg_dump + MinIO client, run as a Railway cron service.
# Build context: infra/backup (set the Railway service Root Directory to /infra/backup).
#
# PG_MAJOR must be >= the Postgres server's major version, or pg_dump refuses to run.
# On Railway, set a service variable PG_MAJOR (e.g. 16 or 17); it is passed as a build arg.
ARG PG_MAJOR=16
FROM postgres:${PG_MAJOR}-alpine

# Alpine's packaged MinIO client installs as `mcli`.
RUN apk add --no-cache minio-client

COPY backup.sh /backup.sh
RUN chmod +x /backup.sh

# Railway cron services run the start command on schedule; the script exits when done.
CMD ["/bin/sh", "/backup.sh"]
