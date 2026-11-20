-- 005_corridors.sql: trade corridors and corridor-scoped stage gates (T4).
--   * corridors: DEFAULT (the generic rules from 000), NG-EU-SESAME, NG-AE-SESAME
--   * batches.corridor, chosen at creation (existing batches stay on DEFAULT)
--   * stage_requirements scoped by corridor, with per-evidence issuer rules,
--     required lab analytes and required events (a buyer's DELIVERY_CONFIRMED)
--   * DELIVERY_CONFIRMED joins the allowed event types
-- No batch_events row is updated or deleted.

-- ── Corridors ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS corridors (
  code                text PRIMARY KEY,
  name                text NOT NULL,
  origin_country      text,
  destination_country text,
  commodity           text,
  -- A batch on this corridor must name a buyer at creation (the buyer confirms delivery).
  requires_buyer      boolean NOT NULL DEFAULT false,
  description         text NOT NULL DEFAULT '',
  active              boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now()
);

INSERT INTO corridors (code, name, origin_country, destination_country, commodity, requires_buyer, description, active) VALUES
  ('DEFAULT', 'Generic crop export', NULL, NULL, NULL, false,
   'The original generic crop rules. Kept so batches created before corridors existed keep working.', true),
  ('NG-EU-SESAME', 'Nigeria to EU: sesame', 'NG', 'EU', 'sesame', false,
   'Strict EU entry: lab-tested for pesticide MRLs, aflatoxin and ethylene oxide; phytosanitary certificate from an inspector.', true),
  ('NG-AE-SESAME', 'Nigeria to UAE: sesame', 'NG', 'AE', 'sesame', true,
   'UAE entry: packing evidence, export documents with an inspector phytosanitary certificate, and delivery confirmed by the named buyer.', true)
ON CONFLICT (code) DO NOTHING;

-- ── Batches: corridor (buyer_id was added in 004) ───────────
ALTER TABLE batches ADD COLUMN IF NOT EXISTS corridor text NOT NULL DEFAULT 'DEFAULT' REFERENCES corridors(code);
CREATE INDEX IF NOT EXISTS batches_corridor_idx ON batches (corridor);
CREATE INDEX IF NOT EXISTS batches_buyer_idx ON batches (buyer_id) WHERE buyer_id IS NOT NULL;

-- ── Corridor-scoped stage requirements ─────────────────────
-- evidence_rules: { "<EVIDENCE_TYPE>": { "roles": [issuer roles], "analytes": [required in meta.analytes] } }
--   A type with its own "roles" ignores the row-level from_roles (legacy, any-of for all types).
-- required_events: [ { "event_type": "...", "by": "batch_buyer" | "<role>" } ]
ALTER TABLE stage_requirements ADD COLUMN IF NOT EXISTS corridor text NOT NULL DEFAULT 'DEFAULT' REFERENCES corridors(code);
ALTER TABLE stage_requirements ADD COLUMN IF NOT EXISTS evidence_rules jsonb NOT NULL DEFAULT '{}';
ALTER TABLE stage_requirements ADD COLUMN IF NOT EXISTS required_events jsonb NOT NULL DEFAULT '[]';
ALTER TABLE stage_requirements DROP CONSTRAINT IF EXISTS stage_requirements_to_stage_key;
ALTER TABLE stage_requirements ADD CONSTRAINT stage_requirements_corridor_stage_key UNIQUE (corridor, to_stage);

INSERT INTO stage_requirements (corridor, to_stage, evidence_types, from_roles, evidence_rules, required_events, description) VALUES
  -- Nigeria to EU, sesame
  ('NG-EU-SESAME', 'AGGREGATED', '{}', '{}', '{}', '[]', 'Aggregator receives the batch by handover; no documents required'),
  ('NG-EU-SESAME', 'PACKED', '{PHOTO,PACKHOUSE_LOG,LAB_REPORT}', '{}',
   '{"LAB_REPORT": {"roles": ["lab"], "analytes": ["MRL", "AFLATOXIN", "ETHYLENE_OXIDE"]}}', '[]',
   'Packing photos, packhouse log, and a lab report from a lab covering pesticide MRLs, aflatoxin and ethylene oxide'),
  ('NG-EU-SESAME', 'IN_TRANSIT', '{}', '{}', '{}', '[]', 'No documents required by this corridor'),
  ('NG-EU-SESAME', 'AT_PORT', '{}', '{}', '{}', '[]', 'No documents required by this corridor'),
  ('NG-EU-SESAME', 'EXPORTED', '{PHYTOSANITARY_CERT,EXPORT_DECLARATION,CERTIFICATE_OF_ORIGIN}', '{}',
   '{"PHYTOSANITARY_CERT": {"roles": ["inspector"]}, "EXPORT_DECLARATION": {"roles": ["exporter"]}}', '[]',
   'Phytosanitary certificate issued by an inspector, export declaration issued by the exporter, and a certificate of origin'),
  ('NG-EU-SESAME', 'DELIVERED', '{}', '{}', '{}', '[]', 'No documents required by this corridor'),
  -- Nigeria to UAE, sesame
  ('NG-AE-SESAME', 'AGGREGATED', '{}', '{}', '{}', '[]', 'Aggregator receives the batch by handover; no documents required'),
  ('NG-AE-SESAME', 'PACKED', '{PHOTO,PACKHOUSE_LOG}', '{}', '{}', '[]', 'Packing photos and a packhouse log'),
  ('NG-AE-SESAME', 'IN_TRANSIT', '{}', '{}', '{}', '[]', 'No documents required by this corridor'),
  ('NG-AE-SESAME', 'AT_PORT', '{}', '{}', '{}', '[]', 'No documents required by this corridor'),
  ('NG-AE-SESAME', 'EXPORTED', '{PHYTOSANITARY_CERT,EXPORT_DECLARATION,CERTIFICATE_OF_ORIGIN}', '{}',
   '{"PHYTOSANITARY_CERT": {"roles": ["inspector"]}, "EXPORT_DECLARATION": {"roles": ["exporter"]}}', '[]',
   'Phytosanitary certificate issued by an inspector, export declaration issued by the exporter, and a certificate of origin'),
  ('NG-AE-SESAME', 'DELIVERED', '{}', '{}', '{}', '[{"event_type": "DELIVERY_CONFIRMED", "by": "batch_buyer"}]',
   'The buyer named on the batch confirms delivery')
ON CONFLICT (corridor, to_stage) DO NOTHING;

-- ── Event types: buyer delivery confirmation ───────────────
-- Replaces the CHECK constraint only; existing rows are validated, never changed.
ALTER TABLE batch_events DROP CONSTRAINT IF EXISTS batch_events_event_type_check;
ALTER TABLE batch_events ADD CONSTRAINT batch_events_event_type_check CHECK (event_type IN
  ('BATCH_CREATED','CUSTODY_TRANSFER','EVIDENCE_ADDED','INSPECTION_SIGNOFF','STAGE_ADVANCE','GATE_REJECTED','NOTE','DELIVERY_CONFIRMED'));

-- ── Handover lookups ────────────────────────────────────────
CREATE INDEX IF NOT EXISTS handover_tokens_batch_idx ON handover_tokens (batch_id);
