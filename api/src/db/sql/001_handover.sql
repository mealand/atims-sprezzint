-- 001_handover.sql — one-time custody-handover tokens (M3.1)
CREATE TABLE IF NOT EXISTS handover_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id    uuid NOT NULL REFERENCES batches(id),
  token       text UNIQUE NOT NULL,
  from_holder uuid NOT NULL REFERENCES entities(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL DEFAULT now() + interval '1 hour',
  used_at     timestamptz,
  used_by     uuid REFERENCES entities(id)
);
