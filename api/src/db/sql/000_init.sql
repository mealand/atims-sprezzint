-- 000_init.sql — entities, auth, batches, append-only batch_events, gates, evidence.
-- Events are the source of truth; batches is a materialised projection.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS entities (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nexus_id    text UNIQUE NOT NULL,
  name        text NOT NULL,
  role        text NOT NULL CHECK (role IN ('farmer','aggregator','processor','exporter','lab','inspector','regulator','admin')),
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','suspended','rejected')),
  password_hash text NOT NULL,
  pubkey      text,
  state_province  text,
  country     text NOT NULL DEFAULT 'NG',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS batches (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trace_id         text UNIQUE NOT NULL,
  origin_entity_id uuid NOT NULL REFERENCES entities(id),
  batch_type       text NOT NULL DEFAULT 'crop',
  commodity        text NOT NULL,
  variety          text,
  quantity         numeric NOT NULL CHECK (quantity > 0),
  unit             text NOT NULL,
  production_date  date NOT NULL,
  origin_state     text,
  current_stage    text NOT NULL,
  current_holder_id uuid NOT NULL REFERENCES entities(id),
  compliance_status text NOT NULL DEFAULT 'pending',
  destination_country text,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS batch_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id     uuid NOT NULL REFERENCES batches(id),
  seq          integer NOT NULL,
  event_type   text NOT NULL CHECK (event_type IN
    ('BATCH_CREATED','CUSTODY_TRANSFER','EVIDENCE_ADDED','INSPECTION_SIGNOFF','STAGE_ADVANCE','GATE_REJECTED','NOTE')),
  actor_id     uuid NOT NULL REFERENCES entities(id),
  actor_pubkey text,
  actor_sig    text,
  prev_hash    text,
  payload_hash text NOT NULL,
  to_stage     text,
  payload      jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_id, seq)
);

-- Append-only enforcement: no UPDATE, no DELETE on the event log.
CREATE RULE batch_events_no_update AS ON UPDATE TO batch_events DO INSTEAD NOTHING;
CREATE RULE batch_events_no_delete AS ON DELETE TO batch_events DO INSTEAD NOTHING;

CREATE TABLE IF NOT EXISTS stage_requirements (
  id          serial PRIMARY KEY,
  to_stage    text NOT NULL,
  evidence_types text[] NOT NULL,
  from_roles  text[] NOT NULL DEFAULT '{}',
  description text NOT NULL,
  UNIQUE (to_stage)
);

CREATE TABLE IF NOT EXISTS evidence (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id     uuid NOT NULL REFERENCES batches(id),
  event_id     uuid REFERENCES batch_events(id),
  actor_id     uuid NOT NULL REFERENCES entities(id),
  evidence_type text NOT NULL,   -- e.g. PHYTOSANITARY_CERT, LAB_RESULT, PACKHOUSE_LOG, PHOTO
  file_hash    text NOT NULL,    -- sha256 of bytes, computed by the client
  object_key   text,             -- MinIO object path (MVP: stored later; hash is authoritative)
  issued_by_role text,
  meta         jsonb NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS merkle_roots (
  id          serial PRIMARY KEY,
  root        text NOT NULL,
  event_count integer NOT NULL,
  anchored_at timestamptz NOT NULL DEFAULT now(),
  ots_proof   text
);

CREATE TABLE IF NOT EXISTS audit_log (
  id          bigserial PRIMARY KEY,
  actor_id    uuid,
  action      text NOT NULL,
  detail      jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── Seed: generic crop corridor stage gates (data-driven, not code) ──
INSERT INTO stage_requirements (to_stage, evidence_types, from_roles, description) VALUES
  ('AGGREGATED', '{}',                           '{}',  'Aggregator confirms physical receipt of the batch'),
  ('PACKED',     '{PHOTO,PACKHOUSE_LOG}',        '{}',  'Packing evidence: packhouse log entry and photos'),
  ('IN_TRANSIT', '{TRANSPORT_DOC}',              '{}',  'Transport manifest required before transit'),
  ('AT_PORT',    '{}',                           '{}',  'Port handler confirms arrival'),
  ('EXPORTED',   '{PHYTOSANITARY_CERT,EXPORT_DECLARATION}', '{inspector,exporter}', 'PHYTO cert + export declaration required for export clearance'),
  ('DELIVERED',  '{DELIVERY_NOTE}',              '{}',  'Destination delivery note required')
ON CONFLICT (to_stage) DO NOTHING;

-- ── Bootstrap admin (dev default: nexus ATIMS-ADMIN-000001 password atims-admin — CHANGE IN PROD) ──
INSERT INTO entities (nexus_id, name, role, status, password_hash, country)
VALUES ('ATIMS-ADMIN-000001', 'ATiMs Administrator', 'admin', 'verified', crypt('atims-admin', gen_salt('bf', 12)), 'NG')
ON CONFLICT (nexus_id) DO NOTHING;
