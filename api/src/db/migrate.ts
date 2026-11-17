/** Minimal, ordered, in-code migrations runner (no external tooling needed). */
import { readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pool } from './pool.js';

const here = join(import.meta.dirname, 'sql');

async function ensureSchemaMigrations() {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
}

async function migrate() {
  await ensureSchemaMigrations();
  const files = readdirSync(here).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const applied = await pool.query('SELECT 1 FROM schema_migrations WHERE name = $1', [file]);
    if (applied.rowCount) {
      console.log(`▸ ${file} — already applied`);
      continue;
    }
    console.log(`▸ ${file} — applying…`);
    await pool.query('BEGIN');
    try {
      const sql = await readFile(join(here, file), 'utf8');
      await pool.query(sql);
      await pool.query('INSERT INTO schema_migrations(name) VALUES ($1)', [file]);
      await pool.query('COMMIT');
    } catch (err) {
      await pool.query('ROLLBACK');
      console.error(`✗ ${file} failed`, err);
      process.exit(1);
    }
  }
  console.log('✓ migrations complete');
}

/**
 * Create the first admin from env, only if no admin exists. Never overwrites an
 * existing admin, so it is a no-op on any database that already has one.
 */
async function bootstrapAdmin() {
  const existing = await pool.query(`SELECT 1 FROM entities WHERE role = 'admin' LIMIT 1`);
  if (existing.rowCount) return;
  const password = process.env.ATIMS_ADMIN_PASSWORD;
  if (!password || password.length < 12) {
    console.warn('⚠ no admin exists — set ATIMS_ADMIN_PASSWORD (min 12 chars) and re-run migrations to create one');
    return;
  }
  const nexusId = process.env.ATIMS_ADMIN_NEXUS_ID || 'ATIMS-ADMIN-000001';
  await pool.query(
    `INSERT INTO entities (nexus_id, name, role, status, password_hash, country)
     VALUES ($1, 'ATiMs Administrator', 'admin', 'verified', crypt($2, gen_salt('bf', 12)), 'NG')
     ON CONFLICT (nexus_id) DO NOTHING`,
    [nexusId, password],
  );
  console.log(`✓ bootstrap admin ${nexusId} created — unset ATIMS_ADMIN_PASSWORD now`);
}

await migrate();
await bootstrapAdmin();
await pool.end();
