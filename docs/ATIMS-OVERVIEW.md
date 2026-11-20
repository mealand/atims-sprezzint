# ATiMs: Agro-Trace Integrated Management System
**Product of Sprezz Integrated Limited** · atims.sprezzint.com
*Signature-verified agricultural traceability and compliance platform, with an assistive AI layer*

Version: Product blueprint v1, updated with MVP status · Date: Nov 2026

> **How to read this document.** This is the product blueprint: where ATiMs is going.
> Some of it is built and live in the Pilot-Ready MVP; some of it is the plan and has
> **not been built yet**. Every section marks which is which:
>
> * **Built** means it is in the code and running at atims.sprezzint.com today.
> * **Partly built** means a working first version exists, smaller than the blueprint.
> * **Planned** means it is part of the blueprint but not built yet.
>
> For exactly what runs today, see [`README.md`](../README.md). For the MVP work plan, see
> [`MVP-PLAN.md`](MVP-PLAN.md). Where the MVP took a different route from the original
> blueprint (for example JWT accounts instead of Keycloak, or per-batch Bitcoin
> timestamps instead of a nightly Merkle root), both are described below.

---

## 1. One-paragraph summary

ATiMs tracks agricultural produce (crops first) from farm to destination market through
**cryptographically signed, hash-chained custody events**. Batches are governed by
**active compliance gates**: a batch cannot advance to its next supply-chain stage
(HARVESTED, AGGREGATED, PACKED, IN_TRANSIT, AT_PORT, EXPORTED, DELIVERED) unless the
corridor's required evidence (certificates, lab results, handover, inspection sign-off,
buyer confirmation) is on file from the right parties. Events are signed by their actor's
device-held key and can be verified by anyone, with no blockchain platform and no need to
trust our server. An **AI layer** (assistants for farmers and inspectors, document parsing,
quality drafting) is planned as a convenience over deterministic core logic, never as the
source of truth.

**Where the MVP is (Nov 2026):** the signed, hash-chained ledger, corridor gates, QR
handover, evidence upload, self-registration with tiered trust, role dashboards, the
public trace page with in-browser verification, and Bitcoin timestamping are built and
live on two corridors (Nigeria to EU sesame, Nigeria to UAE sesame). No pilot customers
yet; the next step is one real corridor pilot.

---

## 2. Why it matters

Export-bound agriculture loses enormous value to consignment rejections: inconsistent
paperwork, unverifiable custody, unenforced quality gates, and opaque non-tariff
measures (NTMs). Existing systems are passive ledgers; ATiMs **enforces** the rules at
the point of stage transition, and produces a trace any buyer, regulator, or consumer
can verify with a QR scan.

## 3. Core product concepts

| Concept | Definition | Status |
|---|---|---|
| **Entity** | A registered actor: farmer, aggregator, processor, exporter, lab, inspector, buyer, regulator, admin. | **Built.** Anyone except an admin self-registers with role-specific fields and confirms an email code (`self_verified`, can work at once). An admin, or an inspector for farmers, can raise an account to `kyb_verified` after a document review. See [`ENTITY-MODEL.md`](ENTITY-MODEL.md). |
| **Nexus ID** | Unique human-readable entity identifier (e.g. `NX-FA-1A2B3C4D`). | **Built.** |
| **Batch** | A quantity of one commodity from one origin. The genesis event gives it a trace ID (`CROP-2026-...`). | **Built** for crops. Livestock **planned**. |
| **Event log** | Append-only `batch_events`: `prev_hash`, `payload_hash`, `actor_pubkey`, `actor_sig`. Batches are a projection of events. | **Built.** UPDATE and DELETE are blocked by database rules. |
| **Stage gate** | Data-driven rule: to move into stage X, evidence of types {T1, T2...} must exist, from issuer roles {R1...}, with required lab analytes and required events. Adding a corridor means adding rows, not code. | **Built**, corridor-scoped, with two live corridors. |
| **Handover scan** | QR shown by the current holder, scanned by the receiver, who accepts with a signed custody transfer. | **Built.** The blueprint had two signed events per handover; the MVP has one, signed by the party taking custody, in a single locked transaction. |
| **Evidence** | Certificate and lab PDFs and photos, hashed in the browser, uploaded to object storage, referenced by events. | **Built.** Without storage configured, evidence is registered by hash only. |
| **Chain anchor** | Blueprint: a nightly Merkle root of all events, published to OpenTimestamps. | **Partly built, differently.** The MVP timestamps each batch's current chain head on OpenTimestamps (Bitcoin-anchored) every few minutes after it changes, and shows the proof on the trace page. A Merkle root over all batches is **planned** (it would cut the number of submissions as volume grows). |
| **Public trace page** | Anyone scans a batch QR and gets a read-only history verified in their own browser. | **Built.** |

## 4. Supply-chain track

HARVESTED, AGGREGATED, PACKED, IN_TRANSIT, AT_PORT, EXPORTED, DELIVERED

**Built** for crops, with corridor rules for `NG-EU-SESAME` (lab panel at PACKED; inspector
phytosanitary certificate, exporter export declaration and certificate of origin at
EXPORTED) and `NG-AE-SESAME` (packing evidence, the same export documents, and the named
buyer's delivery confirmation at DELIVERED). More corridors and commodities are **planned**.

## 5. AI layer (assistive, not authoritative)

| Feature | What AI does | What it never does | Status |
|---|---|---|---|
| Farmer assistant | Explains the next gate, lists missing documents, answers "what does the EU MRL mean for my batch?" | Affects batch state | **Partly built:** `POST /ai/farmer-assistant`, backed by a self-hosted Ollama model. It needs an Ollama server, and is not part of the demo. Chat or WhatsApp delivery **planned**. |
| Inspector copilot | Summarizes a batch's history, flags anomalies (long transit gaps, quantity jumps, repeated actors) | Replaces inspector sign-off | **Partly built:** `POST /ai/inspector-summary` (same Ollama backend). Anomaly flags **planned**. |
| Document parser | Extracts fields from uploaded lab reports and certificates into a draft evidence record for human confirmation | Auto-marks evidence as valid | **Planned** |
| Quality draft | Compares lab values against the standards table and drafts a verdict rationale; the numbers stay deterministic rules | Runs the verdict itself | **Planned** |
| Corridor advisor | Maps HS codes to destination-country requirements as draft gate rows (human-approved) | Auto-creates gates | **Planned** |

Blueprint: AI is provider-abstracted (per-provider adapters plus a local fallback),
cost-metered per entity, and every AI output is labelled "generated". **Today:** one local
provider (Ollama) behind a small service module, under the API's general rate limit.
Multiple provider adapters and per-entity cost metering are **planned**.

## 6. Integrity model

1. Every event is canonical JSON, hashed with SHA-256. Client events (stage advances,
   handover acceptances, inspector sign-offs, delivery confirmations) are signed with an
   ed25519 key held on the actor's device and never sent to the server. The server returns
   the exact event it will store, the device signs those bytes, and the server checks the
   signature before inserting. **Built.** Batch creation, document registration and gate
   rejections are recorded by the server, unsigned but hash-linked like the rest.
2. Chain: `prev_hash` links events per batch, so any edit, deletion or reordering is
   detectable. **Built.**
3. Public timestamp: **built** as per-batch head anchoring on OpenTimestamps; a nightly
   Merkle root over all events is **planned** (see section 3).
4. Independent audit: the public trace page verifies the chain in the viewer's browser,
   and the standalone `verify/` CLI does the same from a terminal. **Built.**

> Marketing phrasing: "signature-verified, hash-chained, publicly timestamped", *not*
> "blockchain". (Hyperledger Fabric would be considered only if a real dispute proves
> the need.)

## 7. Scope: where the MVP is, and where it aims to be

**Built in the Pilot-Ready MVP:**
self-registration with email codes and tiered trust (no admin needed to start), one
permission service for every route, KYB review by admins and inspectors, batch creation
on a corridor with a named buyer, signed append-only event chain, QR handover, evidence
upload with browser-side hashing, the corridor gate engine, role dashboards for every role
(mobile first), inspector sign-off queue, buyer delivery confirmation, public trace page
with in-browser verification, Bitcoin timestamping, a verifier CLI, nightly database
backups (7-day retention), a demo seed script, and unit plus end-to-end tests in CI.

**Partly built:**
- Offline use: the batch page can queue events in the browser while offline and send them
  on "Sync now". An installable offline app (PWA with a service worker) is **planned**.
- AI assistants: see section 5.

**Planned (not built yet):**
- Keycloak or other single sign-on (the MVP uses its own JWT accounts).
- Nightly Merkle-root anchoring across all batches.
- Encrypted backups.
- Livestock track, more corridors and commodities (for example ginger, cashew, hibiscus).
- Full NTM advisor, document parser, quality drafting.
- Cold-chain and IoT ingestion.
- SMS and WhatsApp notifications.
- Payments and stablecoin settlement.
- Observability stack (metrics, logs, uptime dashboards).
- Hyperledger, only if a real need appears.

## 8. Stack

| Layer | Blueprint | MVP today |
|---|---|---|
| Runtime | Node 20 LTS, TypeScript strict, pnpm workspaces | Node 22 in CI (Node 20 or later), TypeScript strict, npm workspaces |
| API | Fastify 4 + Zod, pino logging, RFC 7807 errors | Fastify 5 + Zod, pino logging, JSON errors with stable codes |
| DB | PostgreSQL 16 with RLS, append-only via triggers, pgBouncer, node-pg-migrate | PostgreSQL (16 in development and CI, 18 in production), append-only via rules, numbered SQL migrations with a small built-in runner. RLS and pgBouncer **planned** |
| Auth | Keycloak (OIDC) + CASL RBAC | JWT accounts, email codes, tiered trust, one permission service (`access.ts`). Keycloak **not built** |
| Storage | MinIO, presigned uploads, client-side hashing | Same |
| Frontend | React 18 + Vite 5 (PWA) + Tailwind + TanStack Query + Dexie | React 18 + Vite 5 + Tailwind + Radix + TanStack Query + Dexie (offline queue). PWA **planned** |
| QR | @zxing/browser (scan) + qrcode (display) | Same |
| Integrity | node:crypto, @noble/ed25519, OpenTimestamps | Same |
| Jobs | BullMQ + Redis | In-process timer for anchoring, with a Postgres advisory lock. A queue is **planned** if volume needs it |
| AI | Provider-adapter module | Ollama (self-hosted) behind a small service module |
| Observability | Prometheus, Grafana, Loki, Uptime Kuma | `/health` endpoint and Railway logs. The stack is **planned** |
| Deploy | Docker Compose + Caddy on a VPS; GitHub Actions to GHCR | Railway, deployed from `main`; GitHub Actions CI. Docker Compose for local Postgres and MinIO |
| Tests | Vitest + fast-check + testcontainers + Playwright | Vitest unit tests, fast-check property tests for canonical JSON, and an end-to-end suite on a real Postgres service in CI. Browser (Playwright) tests **planned** |

## 9. Build history and what comes next

The original blueprint proposed a 9-week build. The MVP was delivered as six tasks
(T1 to T6 in [`MVP-PLAN.md`](MVP-PLAN.md)): entity model and tiered trust; UI foundation;
registration wizard and role dashboards; corridors and trust fixes; batch detail, public
trace and anchoring; demo seed, integration test and honest docs.

Next, in order:

1. **Pilot corridor.** Load one corridor's real requirements with the regulators and labs
   involved, onboard a cooperative and an exporter, and field-test on low-cost Android
   phones with patchy network.
2. **Offline app.** Installable PWA with a service worker, so field users can work with no
   signal.
3. **AI that saves time.** Document parser and quality drafts, always confirmed by a person.
4. **Scale the integrity layer.** Merkle-root anchoring, encrypted backups, observability.
5. **More corridors and commodities.** Then livestock.
6. **Settlement.** Payments and stablecoin settlement, once custody and compliance are proven.

## 10. Brand

Product: **Sprezz Integrated Limited** · App: ATiMs

The MVP uses the Sprezz logo palette: crimson `#A81D1D` as primary, with green, purple,
yellow and blue as role colours (see `frontend/src/lib/brand.ts`). The original blueprint
palette (Forest Green `#1A5C2A`, Harvest Amber `#E07C24`, Deep Blue `#185FA5`; Sora and
DM Sans) is no longer used.

## 11. Success criteria for the MVP

| Criterion | Status |
|---|---|
| A farmer creates a batch and hands it off by QR scan on a cheap Android phone with patchy network | **Partly met.** The flow works on mobile browsers; field testing on low-end phones and offline use are still to do |
| An inspector sees the complete, signature-verified history with the actual certificate files | **Met**, when object storage is configured (it is in production) |
| A batch cannot advance without its stage's required evidence | **Met**, per corridor, including issuer roles, lab analytes and buyer confirmation |
| A third party can verify the chain independently | **Met**: in the browser on the trace page, and with the verifier CLI |
| Anyone can run the whole thing with open-source components | **Partly met.** The code and every component are open source, and Docker Compose starts Postgres and MinIO locally; production runs on Railway, and real email delivery uses Resend |
| Core gate logic and chain verifier are fully unit and property tested | **Partly met.** Gates, access, signing, handover and the chain are unit tested, canonical JSON is property tested, and the whole flow has an end-to-end test; there is no coverage target yet |
