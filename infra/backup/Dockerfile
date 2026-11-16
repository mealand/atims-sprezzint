# ATiMs nightly backup job: pg_dump + MinIO client, run as a Railway cron service.
# Context: infra/backup
FROM postgres:16-alpine

# mc binary was pulled from dl.min.io; Alpine's packaged minio-client (as `mcli`) is the stable source.
RUN apk add --no-cache curl bash minio-client

COPY backup.sh /backup.sh
RUN chmod +x /backup.sh

# Railway cron services run the start command on schedule and exit.
CMD ["/bin/sh", "/backup.sh"]
