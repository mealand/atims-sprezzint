# ATiMs nightly database backup

A Railway cron service that runs once a night:

1. Checks it can reach Postgres and logs the client and server versions.
2. Dumps the whole database with `pg_dump` (plain SQL, no owners or privileges).
3. Verifies the dump is complete (end-of-dump marker) and the gzip file is intact.
4. Uploads `atims-<UTC timestamp>.sql.gz` to the MinIO bucket `atims-backups` and confirms it is there.
5. Only then deletes backups older than `RETENTION_DAYS` (default 7).

Any failure stops the run with a non-zero exit, so Railway shows it as failed, and nothing is pruned.

## Environment variables

| Variable | Required | Value on Railway |
|---|---|---|
| `DATABASE_URL` | yes | `${{Postgres.DATABASE_URL}}` (private URL, not `DATABASE_PUBLIC_URL`) |
| `MINIO_ENDPOINT` | yes | `${{atims-sprezzint.MINIO_ENDPOINT}}` (private endpoint) |
| `MINIO_ACCESS_KEY` | yes | `${{atims-sprezzint.MINIO_ACCESS_KEY}}` |
| `MINIO_SECRET_KEY` | yes | `${{atims-sprezzint.MINIO_SECRET_KEY}}` |
| `BACKUP_BUCKET` | no | `atims-backups` |
| `RETENTION_DAYS` | no | `7` |
| `PG_MAJOR` | build | Postgres server major version, e.g. `16` or `17` |

`atims-sprezzint` is the API service name and `Postgres` the database service name in the Railway project. If yours differ, use your names inside `${{ }}`.

## Railway setup (one time)

1. **Find the Postgres major version.** Open the Postgres service, go to **Database**, then **Query**, and run `SHOW server_version;`. The number before the first dot (16, 17, 18) is `PG_MAJOR`.
2. **Create the service.** In the project canvas, click **+ Create**, choose **GitHub Repo**, and pick `mealand/atims-sprezzint`. Rename the new service `atims-backup`. It will try to deploy straight away; you can ignore that first attempt.
3. **Settings > Source.**
   * **Root Directory:** `/infra/backup`. This is required: the repo root `.dockerignore` hides `infra/`, so a root build cannot see the script.
   * **Branch:** `main`.
   * **Watch Paths:** `/infra/backup/**`, so pushes to the API or frontend do not rebuild this service.
4. **Settings > Build.** The builder should show **Dockerfile** (found automatically in the root directory).
5. **Variables.** Open **Variables**, then **Raw Editor**, and paste the following (replace 16 with your version from step 1):
   ```
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   MINIO_ENDPOINT=${{atims-sprezzint.MINIO_ENDPOINT}}
   MINIO_ACCESS_KEY=${{atims-sprezzint.MINIO_ACCESS_KEY}}
   MINIO_SECRET_KEY=${{atims-sprezzint.MINIO_SECRET_KEY}}
   BACKUP_BUCKET=atims-backups
   RETENTION_DAYS=7
   PG_MAJOR=16
   ```
   Click **Update Variables**. After saving, each reference should resolve to a value (hover to check). An empty value means the service name inside `${{ }}` is wrong.
6. **Settings > Deploy.**
   * **Cron Schedule:** `*/5 * * * *` for the first test (every 5 minutes). Railway schedules are in UTC.
   * **Restart Policy:** **Never**. A failed backup should wait for the next scheduled run, not loop.
   * **Networking:** do not generate a public domain. The job only talks over the private network.
7. **Deploy.** Click **Deploy** (or **Apply changes**). Watch the **Build Logs** until the image builds, then wait for the first cron run.
8. **Check the run.** Open the latest run's **Deploy Logs**. A healthy run looks like:
   ```
   [backup 02:00:03] pg_dump client: pg_dump (PostgreSQL) 16.x
   [backup 02:00:03] database server: 16.x
   [backup 02:00:03] dumping database...
   [backup 02:00:05] dump verified: atims-20261120T020003Z.sql.gz (42 KB)
   [backup 02:00:05] connecting to object storage...
   [backup 02:00:06] uploading...
   [backup 02:00:06] upload confirmed: atims-backups/atims-20261120T020003Z.sql.gz
   [backup 02:00:06] pruning backups older than 7 days...
   [backup 02:00:07] backup complete: atims-backups/atims-20261120T020003Z.sql.gz (42 KB, 1 backups retained)
   ```
9. **Check the bucket.** Open the MinIO console (the MinIO service's public URL, logged in with the MinIO root user and password from the MinIO service variables). Bucket `atims-backups` should contain the file.
10. **Set the real schedule.** Change **Cron Schedule** to `0 2 * * *` (02:00 UTC, 03:00 in Nigeria) and save.
11. **Do a restore drill** (below) within the first week.

## Troubleshooting

| Log message | Cause and fix |
|---|---|
| `cannot connect to database` | `DATABASE_URL` is empty or wrong. Check the reference resolves to the private URL. |
| `pg_dump exited with an error` with `server version mismatch` | `PG_MAJOR` is lower than the server version. Set it to the server's major version and redeploy. |
| `cannot reach MinIO ... after 5 attempts` | `MINIO_ENDPOINT` is wrong, or MinIO is down. It must be the private endpoint the API uses, e.g. `http://<minio-service>.railway.internal:9000`. |
| `cannot create or open bucket` | The access key cannot create buckets. Use the MinIO root credentials or create `atims-backups` by hand in the console. |
| Run never starts | Cron Schedule not saved, or the service failed to build. Check Build Logs. |

## Restore

Restoring overwrites data, so **always rehearse on a scratch database first**.

### Drill: restore into a scratch database

1. In the Railway project, add a temporary Postgres: **+ Create > Database > PostgreSQL**. Name it `restore-test`.
2. Download the newest backup from the MinIO console (bucket `atims-backups`, select the file, **Download**).
3. On your computer, with the PostgreSQL client tools installed and using the scratch database's **public** URL (`DATABASE_PUBLIC_URL` on `restore-test`):
   ```bash
   gunzip -c atims-<timestamp>.sql.gz | psql "<restore-test DATABASE_PUBLIC_URL>"
   ```
4. Check the data arrived:
   ```bash
   psql "<restore-test DATABASE_PUBLIC_URL>" -c "select (select count(*) from entities) entities, (select count(*) from batches) batches, (select count(*) from batch_events) events;"
   ```
   Compare with the same query on production.
5. Delete the `restore-test` service when done.

### Real recovery

1. Stop the API service (scale it down or remove its deployment) so nothing writes during the restore.
2. Restore into a **new** Postgres service, exactly as in the drill.
3. Verify the counts, then point the API's `DATABASE_URL` at the new database (`${{<new service>.DATABASE_URL}}`) and redeploy the API.
4. Keep the old database until you are sure the new one is correct.

## Known limitations

* Backups live on the same MinIO instance as the evidence files and use the same root credentials. If that volume is lost, both are lost. An off-site copy is a planned follow-up.
* Dumps are not encrypted at rest. Encryption is a planned follow-up.
