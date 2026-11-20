/**
 * Creates a fresh database and applies the real migrations with the real
 * migrator (api/src/db/migrate.ts), exactly as a deploy does.
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import pg from 'pg';
import { INTEGRATION_DATABASE_URL, assertDisposable, integrationEnv } from './env.js';

export default async function setup() {
  const name = assertDisposable(INTEGRATION_DATABASE_URL);
  const admin = new URL(INTEGRATION_DATABASE_URL);
  admin.pathname = '/postgres';
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const quoted = `"${name.replace(/"/g, '""')}"`;
    await client.query(`DROP DATABASE IF EXISTS ${quoted} WITH (FORCE)`);
    await client.query(`CREATE DATABASE ${quoted}`);
  } finally {
    await client.end();
  }

  const apiDir = resolve(import.meta.dirname, '../..');
  execFileSync(process.execPath, ['--import', 'tsx', 'src/db/migrate.ts'], {
    cwd: apiDir,
    env: { ...process.env, ...integrationEnv },
    stdio: 'inherit',
  });
}
