import { query } from '../db/pool.js';

/**
 * Argon2 hashing via pgcrypto (no native node module needed — zero build
 * issues on Windows/CI, one proven implementation server-side).
 * Form: stored as the pgcrypto `crypt` result with per-user salt.
 */
export async function hashPassword(plain: string): Promise<string> {
  const { rows } = await query<{ h: string }>(
    `SELECT crypt($1, gen_salt('bf', 12)) AS h`, // bcrypt cost 12 inside Postgres
    [plain],
  );
  return rows[0].h;
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  const { rows } = await query<{ ok: boolean }>(`SELECT crypt($1, $2) = $2 AS ok`, [plain, hash]);
  return rows[0].ok;
}
