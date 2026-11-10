# ATiMs — Agro-Trace Integrated Management System

> **Product of Sprezz Integrated Limited** — AI-native, signature-verified agricultural
> traceability with *active* compliance gates. Fully open-source stack, zero paid services.

**Docs:** [`docs/ATIMS-OVERVIEW.md`](docs/ATIMS-OVERVIEW.md) — full product overview.

## What makes it different

- **Active compliance**: stage gates *block* batch progression — they do not merely log.
- **Verifiable without trusting us**: every event is a canonical-JSON payload hashed (SHA-256)
  and ed25519-signed by its actor's device-held key, chained via `prev_hash`, and the daily
  Merkle root is anchored publicly via OpenTimestamps. Verify with the standalone `@atims/verify` CLI.
- **AI-native, locally**: farmer assistant and inspector copilot run on **local Ollama** —
  no external AI service, no data leakage, no cost per token. AI advises; it never mutates state.
- **Data-driven gates**: corridor rules live in `stage_requirements` rows — adding a corridor
  means adding data, not code.

## Monorepo

```
├── api/       Fastify 5 + TypeScript + PostgreSQL 16 (append-only event ledger)
├── frontend/  React 18 + Vite PWA (offline-tolerant, mobile-first)
├── shared/    Domain types + canonical JSON + hashing (property-tested)
├── verify/    Standalone third-party chain verifier CLI
├── infra/     docker compose (postgres, redis, api, frontend, caddy, optional ollama)
└── docs/
```

## Quick start (local dev)

```bash
npm install
cp api/.env.example api/.env           # then set JWT_SECRET
docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=atims -e POSTGRES_USER=atims -e POSTGRES_DB=atims postgres:16
npm run migrate -w @atims/api
npm run dev                             # API on :3000, frontend on :5173
```

Full stack (with caddy + optional local AI):

```bash
cd infra && JWT_SECRET=… CORS_ORIGINS=http://localhost:5173 docker compose up -d
```

## API surface (MVP)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/auth/register` | — | Self-register (pending until admin verifies) |
| POST | `/auth/login` | — | JWT issuance |
| GET | `/entities/me` | ✓ | Current entity |
| POST | `/entities/:id/lifecycle` | admin | verify / suspend / reject |
| POST | `/batches` | farmer | Create batch + genesis event |
| GET | `/batches`, `/batches/:id` | ✓ | Own batches, full history |
| POST | `/batches/:id/events` | holder | Append signed event; **enforces stage gates** |
| POST | `/batches/:id/evidence` | holder | Register hash-verified evidence (also an event) |
| GET | `/trace/:trace_id` | **public** | QR-scannable, signature-verified history |
| GET | `/verify/:batch_id` | **public** | Chain integrity verdict |
| POST | `/ai/farmer-assistant` | ✓ | Local Ollama assistant |
| POST | `/ai/inspector-summary` | inspector+ | Local Ollama anomaly summary |

## Integrity guarantees

1. Appending is the *only* mutation — `batch_events` has DB-level rules blocking UPDATE/DELETE.
2. `payload_hash` = SHA-256(canonical JSON of the signed wire event).
3. `prev_hash` = SHA-256 over the documented prior-event summary format (see `api/src/services/chain.ts`).
4. Chain verifier (`GET /verify/:id`, `@atims/verify` CLI) detects any tampering.
5. Nightly Merkle root → OpenTimestamps (planned job, week 8).

## License & branding

© Sprezz Integrated Limited. Built on 100% open-source components (MIT/Apache-2/BSD/PostgreSQL licence).
Aspiring to the [Alliance](https://alliance.xyz) accelerator: verifiable, open, accessible infrastructure for real-world supply chains.
