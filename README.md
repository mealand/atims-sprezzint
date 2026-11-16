# ATiMs — Agro-Trace Integrated Management System

> **Product of Sprezz Integrated Limited** — signature-verified agricultural
> traceability with *active* compliance gates. 100% open-source stack, zero paid services.

**Live:** https://atims.sprezzint.com · **API health:** https://atims-sprezzint-production.up.railway.app/health

**Docs:** [`docs/ATIMS-OVERVIEW.md`](docs/ATIMS-OVERVIEW.md) (product blueprint) ·
[`docs/ALLIANCE-PITCH.md`](docs/ALLIANCE-PITCH.md) (Alliance pitch) ·
[`docs/VIDEO-SCRIPT.md`](docs/VIDEO-SCRIPT.md) (1-minute founder video script)

## What makes it different

- **Active compliance**: stage gates *block* batch progression — a batch physically
  cannot advance (HARVESTED → AGGREGATED → PACKED → IN_TRANSIT → …) without the
  required evidence. Existing systems merely log; ATiMs enforces.
- **Verifiable without trusting us**: every event is a canonical-JSON payload hashed
  (SHA-256) and ed25519-signed by its actor's device-held key, chained via `prev_hash`.
  The daily Merkle root is anchored publicly via **OpenTimestamps** (Bitcoin-backed,
  free). Anyone can verify with the standalone `@atims/verify` CLI.
- **Evidence that exists**: certificate and lab files are hashed in the browser,
  uploaded directly to MinIO via presigned URLs, and referenced on the ledger by hash.
  A stored file is re-downloadable through a short-lived presigned URL; a hash-only
  registration is honest history, never faked.
- **Data-driven gates**: corridor rules live in `stage_requirements` rows — adding a
  corridor means adding data, not code.

## Architecture

```
            ┌─────────────────────────── Railway (production) ───────────────────────────┐
 Browser ──▶│  atims-frontend (React PWA) ──▶ atims-sprezzint (Fastify API)              │
   │        │                                     │              │                       │
   │        │                                     ▼              ▼                       │
 QR scan ──│  /trace/:id (public)          PostgreSQL 16     MinIO (evidence files)        │
   │        │                               append-only       presigned up/down,           │
   │        │                               event ledger      atims-backups bucket         │
   │        │                                     │                                     │
   │        │                                     ▼  nightly cron                        │
   └────────│  verify: recompute hashes      pg_dump ──▶ MinIO atims-backups (7-day      │
            │  against ledger                retention)                                 │
            └───────────────────────────────────────────────────────────────────────────-┘
                                              │
                                              ▼ nightly Merkle root
                                     OpenTimestamps (public, Bitcoin-anchored)
```

See it live: scan a batch's QR, or open `/trace/:trace_id` — the page **recomputes
every hash and signature in your browser** before showing you a single event.

## Monorepo

```
├── api/           Fastify 5 + TypeScript + PostgreSQL 16 (append-only event ledger)
├── frontend/      React 18 + Vite PWA (offline-tolerant, mobile-first)
├── shared/        Domain types + canonical JSON + hashing (property-tested)
├── verify/        Standalone third-party chain verifier CLI
├── infra/         docker-compose (local dev) + backup job (infra/backup)
└── docs/
```

## Quick start (local dev)

```bash
npm install
cp api/.env.example api/.env           # then set JWT_SECRET (64 hex chars)
docker compose up -d postgres minio    # postgres on :5433, minio on :9000/:9001
npm run migrate -w @atims/api
npm run dev                            # API on :3000, frontend on :5173
```

## Deployment (Railway, all free-tier/open-source)

| Service | Image/Build | Notes |
|---|---|---|
| `atims-sprezzint` | `Dockerfile.api` | Fastify API; env from Railway variables |
| `atims-frontend` | `Dockerfile.frontend` | Custom domain `atims.sprezzint.com`, TLS via Railway |
| Postgres | Railway plugin | `${{Postgres.DATABASE_URL}}` referenced by API & backup job |
| MinIO | community rebuild image | Explicit start command; volume at `/data`; private endpoint (API) + public endpoint (presigned browser traffic) |
| backup (cron) | `infra/backup/Dockerfile` | Nightly `pg_dump` → gzip → MinIO `atims-backups`, 7-day retention |

Auto-deploys from `main` on every push.

## API surface (MVP)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/auth/register` | — | Self-register (pending until admin verifies) |
| POST | `/auth/login` | — | JWT issuance |
| POST | `/auth/password` | ✓ | Change password (bcrypt, min 10 chars) |
| GET | `/entities/me` | ✓ | Current entity |
| POST | `/entities/:id/lifecycle` | admin | verify / suspend / reject |
| POST | `/batches` | farmer | Create batch + genesis event |
| GET | `/batches`, `/batches/:id` | ✓ | Own batches, full history |
| POST | `/batches/:id/events` | holder | Append signed event; **enforces stage gates** |
| POST | `/batches/:id/evidence/upload-url` | holder | Presigned MinIO upload |
| GET | `/batches/:id/evidence/:eid/url` | holder | Presigned download (10-min expiry) |
| GET | `/trace/:trace_id` | **public** | QR-scannable, signature-verified history |
| GET | `/verify/:batch_id` | **public** | Chain integrity verdict |
| GET | `/health` | public | Uptime + storage diagnostics |

## Integrity guarantees

1. Appending is the *only* mutation — `batch_events` has DB-level rules blocking UPDATE/DELETE.
2. `payload_hash` = SHA-256(canonical JSON of the signed wire event).
3. `prev_hash` = SHA-256 over the documented prior-event summary format (see `api/src/services/chain.ts`).
4. Chain verifier (`GET /verify/:id`, `@atims/verify` CLI) detects any tampering.
5. Nightly Merkle root → **OpenTimestamps** — live in production.

## Brand

**Sprezz Integrated Limited** — logo palette drives the product palette:
| Token | Hex | Use |
|---|---|---|
| Crimson (diamond) | `#A81D1D` | Primary actions, headers, admin |
| Green | `#4CAF50` | Verified/success, farmer role |
| Purple | `#A349A4` | Inspector/lab/certification |
| Yellow | `#F5C51D` | Pending/attention, aggregator |
| Blue | `#2392DF` | Info/trace links, regulator |

Tokens live in `frontend/src/lib/brand.ts` and `frontend/src/styles.css`.
