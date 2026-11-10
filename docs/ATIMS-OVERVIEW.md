# ATiMs — Agro-Trace Integrated Management System
**Product of Sprezz Integrated Limited** · atims.sprezzint.com
*AI-native, signature-verified agricultural traceability & compliance platform*

Version: MVP Blueprint v1 · Status: Pre-build planning · Date: Nov 2026

---

## 1. One-paragraph summary

ATiMs tracks agricultural produce (crops first) from farm to destination market through
**cryptographically signed, hash-chained custody events**. Batches are governed by
**active compliance gates**: a batch physically cannot advance to its next supply-chain
stage (HARVESTED → AGGREGATED → PACKED → IN_TRANSIT → EXPORTED → DELIVERED) unless the
required evidence (certificate, lab result, handover scan, inspection signoff) is on file.
Every event is signed by its actor's device-held key and independently verifiable by
anyone — no blockchain platform required, no trust in our server needed. An **AI-native
layer** (assistants for farmers and inspectors, document parsing, quality drafting)
is woven in as a convenience layer over deterministic core logic — never as the source
of truth.

---

## 2. Why it matters

Export-bound agriculture loses enormous value to consignment rejections: inconsistent
paperwork, unverifiable custody, unenforced quality gates, and opaque non-tariff
measures (NTMs). Existing systems are passive ledgers; ATiMs **enforces** the rules at
the point of stage transition, and produces a trace any buyer, regulator, or consumer
can verify with a QR scan.

## 3. Core product concepts

| Concept | Definition |
|---|---|
| **Entity** | A registered actor: farmer, aggregator, processor, exporter, lab, inspector, regulator. Owned by one auth account. Verified by an admin before issuing. |
| **Nexus ID** | Unique human-readable entity identifier (e.g. `NX-FR-0423`). |
| **Batch** | A quantity of one commodity from one origin farm/ranch. Genesis event creates it with a trace ID (`CROP-2026-000001`). |
| **Event log** | Append-only `batch_events` table. Each event: `prev_hash`, `payload_hash`, `actor_pubkey`, `ed25519_sig`. Batches are a *materialized view* of events, never updated in place. |
| **Stage gate** | Data-driven rule: to move into stage X, evidence of types {T1, T2…} must exist, issued by roles {R1…}. Adding a corridor = adding rows, not code. |
| **Handover scan** | QR shown by current holder, scanned by receiver. Two signed events = custody transfer. Ties digital to physical. |
| **Evidence** | Certificate/lab PDFs & photos uploaded to object storage, hashed client-side, referenced by events. |
| **Chain anchor** | Nightly Merkle root of all events, published to OpenTimestamps (free, Bitcoin-anchored) → public third-party verifiability. |
| **Public trace page** | Anyone scans a batch QR → read-only, signature-verified history. |

## 4. Supply-chain track (MVP scope: crop only, one corridor)

HARVESTED → AGGREGATED → PACKED → IN_TRANSIT → AT_PORT → EXPORTED → DELIVERED

## 5. AI-native layer (assistive, not authoritative)

| Feature | What AI does | What it never does |
|---|---|---|
| Farmer assistant (chat/WhatsApp-style) | Explains the next gate, lists missing docs, answers "what does the EU MRL mean for my tomato batch?" | Affects batch state |
| Inspector copilot | Summarizes a batch's event history, flags anomalies (long transit gaps, quantity jumps, repeated actors) | Replaces inspector signoff |
| Document parser | Extracts fields from uploaded lab reports/certs into a draft evidence record for human confirmation | Auto-marks evidence as valid |
| Quality draft | Compares lab values against the standards table and *drafts* a verdict rationale; the numbers stay deterministic if/then rules | Runs the verdict itself |
| Corridor advisor (v2) | Maps hs codes → destination-country requirements into gate rows (human-approved) | Auto-creates gates |

AI is provider-abstracted (adapter pattern: per-provider connectors + a local fallback), cost-metered per entity, and all AI output is labeled "generated" in the UI and DB.

## 6. Integrity model (open-source, honest version)

1. Every event → canonical JSON (RFC 8785-style) → SHA-256 → ed25519 signature (key held on actor device, never sent to server).
2. Chain: `prev_hash` links events per batch; verifier detects any tamper.
3. Nightly Merkle root → OpenTimestamps → publicly attestable.
4. Standalone `atims-verify` CLI lets third parties audit without trusting ATiMs.

> Marketing phrasing: "signature-verified, hash-chained, publicly timestamped" — *not* "blockchain" (Fabric considered for Phase 4 only if a real dispute proves need).

## 7. MVP scopes

**In (v0.1):** auth + entity registration/verification, batch creation, event chain with
signatures, QR handover scan, certificate upload + hashing, data-driven stage-gate
engine, inspector dashboard, public trace page, offline-tolerant PWA (draft + sync),
farmer AI assistant (1 provider), nightly anchoring, full test suite.

**Out (v0.1):** livestock track, NTM advisor full engine, cold-chain/IoT ingestion,
Hyperledger, multi-corridor UI, payments, notifications via SMS/WhatsApp gateway.

## 8. Stack (100% open source)

| Layer | Choice |
|---|---|
| Runtime | Node 20 LTS, TypeScript strict, pnpm workspaces |
| API | Fastify 4 + Zod, pino logging, RFC-7807 errors |
| DB | PostgreSQL 16 (+ RLS, + append-only batch_events via triggers), pgBouncer, node-pg-migrate |
| Auth | Keycloak (OIDC) + CASL RBAC |
| Storage | MinIO (S3-comp.), presigned uploads, client-side hashing |
| Frontend | React 18 + Vite 5 (PWA) + Tailwind + TanStack Query + Dexie (offline) |
| QR | @zxing/browser (scan) + qrcode (display) |
| Integrity | node:crypto, @noble/ed25519, OpenTimestamps |
| Jobs | BullMQ + Redis |
| AI | Provider-adapter service module (`services/ai/adapters/*`), rate-limited |
| Observability | Prom + Grafana + Loki + Uptime Kuma |
| Deploy | Docker Compose + Caddy (auto-TLS) on VPS; GitHub Actions CI/CD → GHCR |
| Tests | Vitest + fast-check + testcontainers + Playwright |

## 9. Suggested build order (~9 weeks, 1–2 devs)

| Week | Deliverable |
|---|---|
| 1 | Docker Compose stack, CI green, DB migrations, Keycloak realm, shared types |
| 2 | Auth → entity registration → admin verification flow |
| 3 | Batch creation + signed append-only event chain |
| 4 | QR handover flow (mobile-first PWA) |
| 5 | Certs upload + data-driven gate engine |
| 6 | Inspector dashboard + public trace page |
| 7 | AI farmer assistant + inspector copilot (adapter layer) |
| 8 | Anchoring job + verifier CLI + reports |
| 9 | Pilot corridor seeding (real requirements rows) + field testing |

## 10. Brand

Product: **Sprezz Integrated Limited** · App: ATiMs
Colors (from original): Forest Green `#1A5C2A` · Harvest Amber `#E07C24` · Deep Blue `#185FA5`
Type: Sora (display) · DM Sans (body)

## 11. Success criteria for MVP

- ✅ One farmer creates a batch and hands it off via QR scan on a cheap Android with patchy network
- ✅ Inspector sees complete signature-verified history with the actual certificate files
- ✅ A batch cannot advance without its stage's required evidence
- ✅ Third party can verify the chain independently
- ✅ Anyone can `docker compose up` the whole thing; zero paid services required to run
- ✅ Core gate logic and chain verifier are 100% unit + property tested
