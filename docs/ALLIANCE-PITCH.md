# ATiMs: Alliance Pitch

**Sprezz Integrated Limited** · atims.sprezzint.com · open-source code, built in Abuja

---

## The one-liner

ATiMs makes a sack of sesame as provable as a bank transfer. Every custody event is
signed on the device of the person who made it, chained by hash and timestamped on
Bitcoin, and a batch **cannot move** to its next supply-chain stage until the export
corridor's required documents are on file from the right parties.

## The problem

Export agriculture loses value to rejected consignments:

- paperwork that is inconsistent and custody chains nobody can check,
- quality gates that exist on paper but are never enforced,
- opaque non-tariff measures that buyers and regulators settle by rejecting whole lots.

Most traceability tools record what happened. They do not stop an under-documented
batch from moving.

## What ATiMs does differently

1. **Gates that block.** Each corridor's rules are data. On the Nigeria to EU sesame
   corridor, a batch cannot be marked PACKED until a lab has reported pesticide
   residues, aflatoxin and ethylene oxide, and it cannot be EXPORTED without a
   phytosanitary certificate from an inspector, an export declaration from the exporter
   and a certificate of origin. On the Nigeria to UAE corridor, it cannot be DELIVERED
   until the named buyer confirms delivery. A blocked batch shows exactly what is
   missing and who must supply it. A new corridor is new rows, not new code.
2. **Verifiable without trusting us.** Each event is canonical JSON, hashed with SHA-256
   and linked to the one before it. Stage moves, handovers, inspector sign-offs and
   delivery confirmations are signed with an ed25519 key held in the user's browser,
   and the server checks the signature before it stores anything. A buyer scans the QR
   code and the trace page recomputes every hash, link and signature on the buyer's own
   phone before it shows the history. Batch heads are timestamped through
   OpenTimestamps, which anchors them in Bitcoin, and anyone can check the proof with
   the standard `ots` tool. An open-source command line verifier does the same check
   without our server.
3. **Accounts that start in minutes.** Farmers, aggregators, processors, exporters,
   labs, inspectors, buyers and regulators register themselves with the details their
   role needs, confirm a code sent by email and start work. No admin has to approve
   them first. The public trace shows each party's trust level: self-verified, or
   KYB-verified after a document review.
4. **Documents by fingerprint.** Certificates and lab reports are fingerprinted in the
   browser, stored in object storage, and recorded on the batch history by their hash,
   so a swapped file is detectable.

## Where it stands today

- **Live** at atims.sprezzint.com with a public API, deployed automatically from the
  main branch.
- **A working demo you can open now:** three sesame batches created through the real
  product. One reached the EU, one reached the UAE with the buyer's confirmation, and
  one is blocked at packing because its lab report is missing. Each trace verifies in
  your browser.
- Two corridors configured: Nigeria to EU sesame and Nigeria to UAE sesame.
- Role dashboards for all eight self-registering roles, mobile first.
- The history table refuses edits and deletions at the database level.
- Nightly database backups to object storage, kept for 7 days.
- Every change runs through automated tests, including an end-to-end test that drives
  the whole flow against a real database.
- No pilot customers yet. That is what we are asking for.

## Why open source helps

- Traceability is a trust product. A system that buyers, regulators and partners can
  audit line by line is more credible than a black box.
- The record format and the verifier are open, so third parties can check our data
  without asking us.
- The code runs on open-source components (PostgreSQL, MinIO, OpenTimestamps), so a
  ministry, cooperative or development partner could host its own copy in its own
  jurisdiction.

## On the roadmap, not built

- Settlement in stablecoins or any other payment rail.
- An installable offline app for areas with no signal.
- Encrypted backups.
- More corridors and commodities (ginger, cashew, hibiscus) and livestock.

## The ask

A partnership to pilot one real corridor end to end: load the corridor's actual
requirements with the regulators and labs involved, onboard a cooperative of growers
and one exporter, and measure whether a gate-enforced, verifiable custody chain reduces
rejected consignments and inspection time.

**Contact:** Sprezz Integrated Limited · dev@sprezzint.com
