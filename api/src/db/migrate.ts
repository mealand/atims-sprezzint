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

await migrate();
await pool.end();
