-- 002_fix_updated_at.sql — batches/audit used updated_at in API but schema missed it.
ALTER TABLE batches ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
