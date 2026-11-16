# ATiMs — Alliance Pitch

**Sprezz Integrated Limited** · atims.sprezzint.com · 100% open-source stack · zero paid services

---

## The one-liner

ATiMs makes a sack of ginger as provable as a bank transaction: every custody event
is cryptographically signed, hash-chained, and publicly timestamped — and a batch
**physically cannot advance** to its next supply-chain stage without the required
evidence.

## The problem

Export-bound agriculture loses enormous value to consignment rejections:

- inconsistent paperwork and unverifiable custody chains,
- quality gates that exist on paper but are never *enforced*,
- opaque non-tariff measures (NTMs) that buyers and regulators resolve by rejecting
  whole consignments.

Existing traceability tools are **passive ledgers**: they record what happened.
None of them stop an under-documented batch from moving.

## What ATiMs does differently

1. **Active compliance gates.** Stage requirements are data (`stage_requirements`
   rows): to move HARVESTED → AGGREGATED → PACKED → IN_TRANSIT → EXPORTED, the batch
   must carry evidence of the required types from the required roles. The gate blocks
   the transition — no evidence, no movement. Adding a new corridor is adding data,
   not code.
2. **Verifiable without trusting us.** Each event is canonical JSON, SHA-256 hashed,
   and ed25519-signed with a key held on the actor's device. Events chain via
   `prev_hash`. The daily Merkle root is anchored to **OpenTimestamps**
   (Bitcoin-backed, free). A buyer, regulator, or consumer can scan a QR and the
   public trace page **recomputes every hash and signature in their own browser**
   before displaying anything. A standalone CLI (`@atims/verify`) audits the chain
   without our server.
3. **Evidence that provably exists.** Certificates and lab files are hashed in the
   browser, uploaded directly to MinIO (S3-compatible, self-hosted) via presigned
   URLs, and referenced on the ledger by hash. Files are re-obtainable through
   short-lived signed URLs; nothing is overwritten or silently deleted.

## Traction & current state

- **Deployed and live** at `atims.sprezzint.com` (production, TLS, custom domain).
- Full flow proven end-to-end: farmer registration → admin verification → batch
  creation → handovers → evidence upload → public trace + independent verification
  → OpenTimestamps anchoring.
- Append-only ledger enforced at the database level (UPDATE/DELETE blocked by rules).
- Nightly encrypted-path backups of the ledger (`pg_dump` → object storage,
  7-day retention).
- Monorepo, TypeScript strict, property-tested core (canonical hashing, gates).

## Why the open-source commitment is the moat, not the risk

- Traceability *is* a trust product: an operator who can be audited byte-for-byte
  is more credible to buyers, regulators, and development partners than a black box.
- **Zero paid services.** Everything — Postgres, MinIO, OpenTimestamps, the app
  itself — runs on open-source software. A ministry, cooperative, or NGO can stand
  up the whole system with `docker compose up`, in their own jurisdiction, keeping
  their data sovereign.
- The ledger format and verifier are open: third parties can build their own
  audits on top of our data rather than being locked into us.

## The ask

Partnership through the Alliance to pilot one real export corridor end-to-end:
seeding the corridor's actual stage requirements (certificates, lab standards,
port checks), onboarding a cooperative of growers, and proving that a
signature-verified, gate-enforced custody chain reduces consignment rejections
and inspection time.

**Contact:** Sprezz Integrated Limited · dev@sprezzint.com
