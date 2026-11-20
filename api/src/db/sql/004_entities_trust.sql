-- 004_entities_trust.sql: entity model v2 (T1).
--   * buyer role
--   * tiered trust: registered -> self_verified (email code + automatic checks) -> kyb_verified
--   * role-specific registration profile, unique registration identifiers
--   * hashed, expiring email verification codes
--   * batch parties: named buyer and assigned labs/inspectors (used by access.ts)
-- The ledger (batch_events) is not touched.

-- ── Roles: add buyer ────────────────────────────────────────
ALTER TABLE entities DROP CONSTRAINT IF EXISTS entities_role_check;
ALTER TABLE entities ADD CONSTRAINT entities_role_check CHECK (role IN
  ('farmer','aggregator','processor','exporter','lab','inspector','buyer','regulator','admin'));

-- ── Trust tier and profile ──────────────────────────────────
ALTER TABLE entities ADD COLUMN IF NOT EXISTS email             text;
ALTER TABLE entities ADD COLUMN IF NOT EXISTS phone             text;
ALTER TABLE entities ADD COLUMN IF NOT EXISTS profile           jsonb NOT NULL DEFAULT '{}';
ALTER TABLE entities ADD COLUMN IF NOT EXISTS trust_tier        text NOT NULL DEFAULT 'registered';
ALTER TABLE entities ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;
ALTER TABLE entities ADD COLUMN IF NOT EXISTS kyb_verified_at   timestamptz;
ALTER TABLE entities ADD COLUMN IF NOT EXISTS verified_by       uuid REFERENCES entities(id);

ALTER TABLE entities ADD CONSTRAINT entities_trust_tier_check
  CHECK (trust_tier IN ('registered','self_verified','kyb_verified'));

-- Existing accounts: verified ones were approved by an admin, so they are KYB verified.
-- Pending (and suspended/rejected) accounts stay 'registered'.
UPDATE entities
   SET trust_tier = 'kyb_verified', kyb_verified_at = COALESCE(kyb_verified_at, updated_at)
 WHERE status = 'verified' AND trust_tier = 'registered';

-- A row inserted already 'verified' comes from a privileged path (the bootstrap
-- admin in migrate.ts, or an admin), never from self-registration, so it is KYB
-- verified. Runs before the CHECK below is evaluated.
CREATE OR REPLACE FUNCTION entities_verified_insert_trust() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'verified' AND NEW.trust_tier = 'registered' THEN
    NEW.trust_tier := 'kyb_verified';
    NEW.kyb_verified_at := COALESCE(NEW.kyb_verified_at, now());
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS entities_verified_insert_trust ON entities;
CREATE TRIGGER entities_verified_insert_trust BEFORE INSERT ON entities
  FOR EACH ROW EXECUTE FUNCTION entities_verified_insert_trust();

-- Invariant: an active ('verified' status) account is never at the 'registered' tier.
-- The auth guard checks status = 'verified', so this is what makes "email
-- confirmed or KYB'd" the only way to log in.
ALTER TABLE entities ADD CONSTRAINT entities_active_requires_trust
  CHECK (status <> 'verified' OR trust_tier IN ('self_verified','kyb_verified'));

CREATE UNIQUE INDEX IF NOT EXISTS entities_email_uq ON entities (lower(email)) WHERE email IS NOT NULL;

-- ── Unique registration identifiers (CAC, NEPC, TIN, ISO 17025, staff IDs) ──
CREATE TABLE IF NOT EXISTS entity_identifiers (
  entity_id  uuid NOT NULL REFERENCES entities(id),
  kind       text NOT NULL,           -- role-scoped, e.g. 'cac:exporter', 'staff:inspector:naqs'
  value      text NOT NULL,           -- normalised by shared/src/registration.ts
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, value)
);
CREATE INDEX IF NOT EXISTS entity_identifiers_entity_idx ON entity_identifiers (entity_id);

-- ── Email verification codes (6 digits, stored as HMAC, 15 minute expiry) ──
CREATE TABLE IF NOT EXISTS email_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id   uuid NOT NULL REFERENCES entities(id),
  code_hash   text NOT NULL,
  attempts    integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz
);
CREATE INDEX IF NOT EXISTS email_codes_entity_idx ON email_codes (entity_id, created_at DESC);

-- ── Batch parties ───────────────────────────────────────────
-- The buyer named on the batch (set at creation by T4; may be null).
ALTER TABLE batches ADD COLUMN IF NOT EXISTS buyer_id uuid REFERENCES entities(id);

-- Labs and inspectors assigned to a batch by its holder, so they can see it and add reports.
CREATE TABLE IF NOT EXISTS batch_assignments (
  batch_id    uuid NOT NULL REFERENCES batches(id),
  entity_id   uuid NOT NULL REFERENCES entities(id),
  assigned_by uuid NOT NULL REFERENCES entities(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (batch_id, entity_id)
);
CREATE INDEX IF NOT EXISTS batch_assignments_entity_idx ON batch_assignments (entity_id);
