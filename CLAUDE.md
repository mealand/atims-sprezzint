# ATiMs: guide for Claude Code sessions

ATiMs (Agro-Trace Integrated Management System) is an agricultural export traceability and compliance platform built by **Sprezz Integrated Limited** (Abuja, Nigeria). Batches of produce move through supply-chain stages, and a data-driven **stage-gate engine** blocks a batch from advancing until the required evidence is on file. Every custody event is recorded on an **append-only, hash-chained ledger**, signed in the browser with a device-held ed25519 key, and batch heads are timestamped on Bitcoin through OpenTimestamps. Buyers verify a batch from a QR code.

Live: https://atims.sprezzint.com (frontend) and https://atims-sprezzint-production.up.railway.app (API). Every merge to `main` auto-deploys to Railway.

## Layout (npm workspaces)

| Path | What |
|---|---|
| `api/` | Fastify 5 + TypeScript API on PostgreSQL. Routes in `api/src/routes`, logic in `api/src/services`, SQL migrations in `api/src/db/sql` (numbered, applied in order by `api/src/db/migrate.ts`). |
| `frontend/` | React 18 + Vite app. Pages in `frontend/src/pages`, client libs in `frontend/src/lib`. |
| `shared/` | Types, canonical JSON (`canonical.ts`), hashing, and the independent chain verifier (`verify.ts`). Used by API, frontend and CLI. |
| `verify/` | Standalone verifier CLI. |
| `infra/backup/` | Nightly Railway cron backup (see its README). |
| `docs/` | Product docs. `docs/ATIMS-ASSESSMENT.pdf` lists known defects F1 to F16 (F1 is fixed). |

## Commands

```bash
npm ci                                  # install
bash scripts/cloud-setup.sh             # cloud/dev: start Postgres, create DB, write api/.env, migrate
npm test -w @atims/api                  # API unit tests (vitest)
npm test -w @atims/shared               # shared tests
npm run build                           # type-check all workspaces + build frontend (what CI runs)
npm run dev                             # API on :3000 and frontend on :5173 (needs Postgres)
```

Run `npm test -w @atims/api` and `npm run build` before declaring any change done. CI (`.github/workflows/ci.yml`) runs the same.

## Non-negotiables

1. **The ledger is append-only.** Never UPDATE or DELETE rows in `batch_events`, never edit an applied migration, and never "fix" history. Add a new migration instead.
2. **Signed events.** The client signs the exact wire event the server stores (dry-run, sign, submit with echoed `created_at` and `seq`). The server verifies before insert (`api/src/services/signedEvent.ts`). Never store an unverified client signature, and never change the canonical wire format or `prevHashOf` without a versioned protocol change.
3. **No secrets in the repo.** The repo is public. `api/.env` is gitignored. Real keys belong in Railway variables or cloud network secrets.
4. **Honest claims.** Do not describe features in docs or UI copy that the code does not do (stablecoin settlement is roadmap, not built).
5. **User-facing marketing copy** (website, pitch, applications, LinkedIn) uses **no em dashes or en dashes**.
6. Keep changes covered by tests. New rules (gates, access, signing) get unit tests in `api/test`.

## Current priorities (Nov 2026): "Pilot-Ready" MVP

1. Entity model: roles (farmer, aggregator, processor, exporter, lab, inspector, buyer, regulator, admin), a single permission service `api/src/services/access.ts`, role-specific registration with tiered trust (self-verified by email code, KYB verified by admin or inspector). No admin needed for a new user to start.
2. Role dashboards and a Tailwind-based, mobile-first UI redesign in Sprezz crimson `#A81D1D`.
3. Corridors as data: `NG-EU-SESAME` and `NG-AE-SESAME`, corridor-scoped stage requirements.
4. Trust fixes from the assessment: F4 gates, F5 access, F6 roles, F3/F11 handover, F10 anchoring, in-browser verification on the trace page.
5. Demo seed script and a 3-minute demo guide.

## Working in the cloud

* Postgres 16 runs locally in the VM after `scripts/cloud-setup.sh`; production runs Postgres 18. Avoid SQL that differs between them.
* `gh pr` and `gh issue` do not work behind the cloud proxy; use `gh api` if needed. Prefer the **Create PR** button.
* Railway deploys from `main`, so keep PRs small and tested.
