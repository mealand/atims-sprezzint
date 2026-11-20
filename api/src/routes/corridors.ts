import { query } from '../db/pool.js';
import { requirementsForCorridor } from '../services/gateFacts.js';
import { STAGES } from '@atims/shared';
import type { FastifyInstance } from 'fastify';

/**
 * Corridor reference data (public: it says what a corridor demands, nothing
 * about any batch). Used by the batch creation form and the trace page.
 */
export default async function corridorRoutes(app: FastifyInstance) {
  /** GET /corridors: active corridors with their stage requirements in stage order. */
  app.get('/corridors', async (_req, reply) => {
    const corridors = (await query<{ code: string }>(
      `SELECT code, name, origin_country, destination_country, commodity, requires_buyer, description
         FROM corridors WHERE active ORDER BY (code = 'DEFAULT'), code`,
    )).rows;
    const out = await Promise.all(corridors.map(async (c) => ({ ...c, requirements: sortByStage(await requirementsForCorridor(c.code)) })));
    reply.send({ corridors: out });
  });

  /** GET /corridors/:code: one corridor and its requirements. */
  app.get<{ Params: { code: string } }>('/corridors/:code', async (req, reply) => {
    const c = (await query(
      `SELECT code, name, origin_country, destination_country, commodity, requires_buyer, description, active
         FROM corridors WHERE code = upper($1)`, [req.params.code],
    )).rows[0];
    if (!c) return reply.code(404).send({ error: 'corridor not found' });
    reply.send({ corridor: { ...c, requirements: sortByStage(await requirementsForCorridor(String(c.code))) } });
  });
}

function sortByStage<T extends { to_stage: string }>(rows: T[]): T[] {
  const idx = (s: string) => (STAGES as readonly string[]).indexOf(s);
  return [...rows].sort((a, b) => idx(a.to_stage) - idx(b.to_stage));
}
