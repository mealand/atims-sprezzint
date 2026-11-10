import pg from 'pg';
import { env } from '../config.js';

export const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 10 });

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params as never[]);
}

/** Authenticated entity id from a verified JWT. */
export function actor(req: { user?: unknown }): string {
  return String((req.user as { sub: string })?.sub ?? '');
}
