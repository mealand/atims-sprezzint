-- 003_anchors.sql — OpenTimestamps attestations for batch chain heads (M5).
-- Anchors are external proof-of-existence, not chain events: the append-only
-- ledger stays untouched, and the public trace exposes the attestation.
CREATE TABLE IF NOT EXISTS chain_anchors (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id     uuid NOT NULL REFERENCES batches(id),
  head_hash    text NOT NULL,             -- prev_hash-style head of the chain at submit time
  ots_proof    text,                      -- base64 .ots file (pending until upgraded)
  confirmed_at timestamptz,               -- when Bitcoin block attestation observed
  block_height integer,                   -- parsed from the upgraded proof
  submitted_at timestamptz NOT NULL DEFAULT now(),
  upgraded_at  timestamptz,
  UNIQUE (batch_id, head_hash)
);
CREATE INDEX IF NOT EXISTS chain_anchors_batch_idx ON chain_anchors (batch_id);
