# ATiMs: Agro-Trace Integrated Management System

> **A product of Sprezz Integrated Limited.** Agricultural export traceability where
> every custody event is signed on the actor's device, and a batch cannot move to its
> next stage until the trade corridor's required documents are on file from the right parties.

**Live:** https://atims.sprezzint.com · **API health:** https://atims-sprezzint-production.up.railway.app/health

**Docs:** [`docs/DEMO-GUIDE.md`](docs/DEMO-GUIDE.md) (3-minute demo) ·
[`docs/ENTITY-MODEL.md`](docs/ENTITY-MODEL.md) (roles, trust tiers, permissions) ·
[`docs/ALLIANCE-PITCH.md`](docs/ALLIANCE-PITCH.md) (pitch) ·
[`docs/MVP-PLAN.md`](docs/MVP-PLAN.md) (pilot-ready MVP plan) ·
[`docs/ATIMS-OVERVIEW.md`](docs/ATIMS-OVERVIEW.md) (product blueprint: what the MVP has
built and what is planned)

## What it does

- **Gates that block, not just log.** Each trade corridor has stage requirements stored
  as rows in `stage_requirements` (`api/src/db/sql/005_corridors.sql`). A batch moves
  only to the next stage (HARVESTED, AGGREGATED, PACKED, IN_TRANSIT, AT_PORT, EXPORTED,
  DELIVERED), and only when the gate passes. Rules can require a document type, a
  specific issuer role (a phytosanitary certificate must come from an inspector, a lab
  report from a lab), the analytes a lab report covers, and events from a named party
  (the buyer's delivery confirmation). A failed gate returns a checklist that says what
  is missing and who must supply it. Two corridors are live: `NG-EU-SESAME` and
  `NG-AE-SESAME`. Adding a corridor means adding rows, not code.
- **Signed, hash-chained history.** Every event is canonical JSON, hashed with SHA-256
  and linked to the previous event by `prev_hash`. Client events (stage advances,
  handover acceptances, inspector sign-offs, delivery confirmations) are signed in the
  browser with an ed25519 key held on the device: the server returns the exact event it
  will store (dry-run), the device signs those bytes, and the server verifies the
  signature before inserting. Batch creation, document registration and gate rejections
  are recorded by the server, unsigned but hash-linked like the rest. The
  `batch_events` table rejects UPDATE and DELETE at the database level.
- **Custody only by handover.** The holder shows a one-time QR; the receiver accepts
  with a signed `CUSTODY_TRANSFER`, in one database transaction.
- **Verification in the buyer's browser.** The public trace page (`/trace/:trace_id`,
  no login) downloads the raw chain from `GET /verify/:id`, recomputes every hash, link
  and signature on the viewer's device with `shared/src/verify.ts`, and checks every
  item it shows against that verified chain. The `verify/` CLI does the same from a
  terminal.
- **Bitcoin timestamps.** Every few minutes (5 by default) the API submits the current
  head hash of each batch whose chain changed to public OpenTimestamps calendars, and
  later upgrades the proofs once they are in a Bitcoin block. The trace page offers the
  `.ots` file for `ots verify`. Anchoring is per batch head; there is no Merkle root.
- **Documents by fingerprint.** Files are hashed in the browser. When object storage is
  configured (production uses MinIO) the file is uploaded with a presigned URL and can be
  downloaded later by parties to the batch; otherwise only the hash is registered, and
  the page says so.
- **Accounts without an admin.** Nine roles: farmer, aggregator, processor, exporter,
  lab, inspector, buyer, regulator, admin. Anyone except an admin can self-register with
  role-specific fields, confirm a 6-digit email code and start work (`self_verified`).
  `kyb_verified` is set by an admin, or by a KYB-verified inspector for farmers. All
  access decisions go through `api/src/services/access.ts`. See
  [`docs/ENTITY-MODEL.md`](docs/ENTITY-MODEL.md).

Not built yet (roadmap): stablecoin or any other payment settlement, encrypted backups,
an installable offline app (the batch page can queue events in the browser while
offline and submit them on "Sync now", but there is no service worker), single sign-on,
livestock batches.

## Architecture

```
 Browser (React SPA) ──────────▶ Fastify API (Railway) ──────────▶ PostgreSQL
  device ed25519 key              access.ts, gates, signature         append-only batch_events
  in-browser chain verify         check, handover, trace views
         │                              │            │
         │ presigned PUT/GET            │            └── anchor job ──▶ OpenTimestamps calendars
         └──────────────────────▶ MinIO (optional)                      (Bitcoin-anchored)

 Nightly Railway cron (infra/backup): pg_dump ──▶ MinIO bucket atims-backups, 7-day retention, not encrypted
```

## Monorepo

```
├── api/        Fastify 5 + TypeScript on PostgreSQL. Routes, services, SQL migrations, tests.
├── frontend/   React 18 + Vite + Tailwind. Registration wizard, role dashboards, batch detail, public trace.
├── shared/     Types, canonical JSON (property-tested with fast-check), hashing, the independent verifier.
├── verify/     Standalone chain verifier CLI.
├── scripts/    cloud-setup.sh (dev database), seed-demo.ts (live demo data).
├── infra/      Nightly backup job (infra/backup).
└── docs/
```

## Quick start (local dev)

```bash
npm ci
bash scripts/cloud-setup.sh          # local Postgres, database, api/.env, migrations
npm run dev                          # API on :3000, frontend on :5173
```

With Docker instead: `docker compose up -d postgres minio` starts Postgres on port
**5433**, so set `DATABASE_URL=postgres://atims:atims@localhost:5433/atims` in `api/.env`
before `npm run migrate -w @atims/api`.

Without `RESEND_API_KEY`, the API returns the email code in the registration response
(`verification.dev_code`). That is for development and demos only.

## Demo data

```bash
npx tsx scripts/seed-demo.ts --api http://localhost:3000
```

Registers a DEMO account for every role through the public API, then creates three
batches with signed events and handovers: an EU batch delivered, a UAE batch delivered
after the buyer's confirmation, and an EU batch blocked at PACKED for a missing lab
report. It prints the trace URLs and writes logins to `scripts/.demo-credentials.json`
(gitignored). Safe to rerun. Walkthrough: [`docs/DEMO-GUIDE.md`](docs/DEMO-GUIDE.md).

## Tests

```bash
npm test -w @atims/api               # unit tests, no database
npm test -w @atims/shared
npm run build                        # type-check everything, build the frontend
cd api && npx vitest run --config test/integration/vitest.config.ts   # needs Postgres
```

The integration suite (`api/test/integration`) starts the real app on a fresh database,
runs the migrations, and drives registration, email codes, signed events, handovers, the
buyer's confirmation, the public trace with independent chain verification, the blocked
gate, and the demo seed script. CI runs it against a PostgreSQL 16 service container.

## Deployment (Railway)

| Service | Build | Notes |
|---|---|---|
| `atims-sprezzint` | `Dockerfile.api` | Fastify API, runs the anchor job; env from Railway variables |
| `atims-frontend` | `Dockerfile.frontend` | Custom domain `atims.sprezzint.com` |
| Postgres | Railway | `${{Postgres.DATABASE_URL}}` for the API and the backup job |
| MinIO | community image | Evidence files; private endpoint for the API, public endpoint for presigned browser traffic |
| backup (cron) | `infra/backup/Dockerfile` | Nightly `pg_dump` to MinIO `atims-backups`, 7-day retention |

Every merge to `main` deploys.

## API surface

| Method | Path | Who | Purpose |
|---|---|---|---|
| POST | `/auth/register` | anyone (not admin) | Role-specific registration; emails a 6-digit code |
| POST | `/auth/verify-email`, `/auth/resend-code` | anyone | Confirm the code: account becomes `self_verified` and gets a token |
| POST | `/auth/login`, `/auth/password` | account | Log in by email or Nexus ID; change password |
| GET | `/entities/me` | account | Role, profile, trust tier |
| GET | `/entities`, POST `/entities/:id/kyb` | admin, KYB-verified inspector (farmers) | KYB review |
| POST | `/entities/:id/lifecycle` | admin | Verify, suspend, reject |
| GET | `/corridors`, `/corridors/:code` | public | Corridors and their stage requirements |
| POST | `/batches` | farmer | Create a batch on a corridor, naming its buyer |
| GET | `/batches`, `/batches/:id`, `/batches/:id/gate` | parties to the batch | Batches, history, gate checklist |
| POST | `/batches/:id/events` | holder, assigned inspector, named buyer | Signed event (dry-run, then signed submit); enforces the gate |
| POST | `/batches/:id/assignments` | holder | Assign a lab or inspector |
| POST | `/batches/:id/evidence/upload-url`, `/batches/:id/evidence` | holder, assigned lab or inspector | Upload and register a document |
| GET | `/batches/:id/evidence/:eid/url` | parties to the batch | Presigned download (10 minutes) |
| POST | `/batches/:id/handover/start` | holder | One-time handover token and QR URL |
| POST | `/handover/:token/accept` | receiving custody role | Signed `CUSTODY_TRANSFER` |
| GET | `/inspector/queue` | inspector | Batches awaiting sign-off |
| GET | `/trace/:trace_id` | **public** | Buyer-facing view: route, gates, documents, custody, anchors |
| GET | `/verify/:id` | **public** | The raw signed chain, for independent verification |
| POST | `/ai/farmer-assistant`, `/ai/inspector-summary` | account | Optional; needs an Ollama server (`OLLAMA_URL`) |
| GET | `/health` | public | Uptime and storage status |

## Brand

**Sprezz Integrated Limited**. The logo palette drives the product palette:

| Token | Hex | Use |
|---|---|---|
| Crimson (diamond) | `#A81D1D` | Primary actions, headers, admin |
| Green | `#4CAF50` | Verified and success, farmer role |
| Purple | `#A349A4` | Inspector, lab, certification |
| Yellow | `#F5C51D` | Pending and attention, aggregator |
| Blue | `#2392DF` | Info and trace links, regulator |

Tokens live in `frontend/src/lib/brand.ts` and `frontend/src/styles.css`.
