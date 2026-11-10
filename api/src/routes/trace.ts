import { query } from '../db/pool.js';
import { verifyChain, type EventRow } from '../services/chain.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

export default async function traceRoutes(app: FastifyInstance) {
  /**
   * GET /trace/:trace_id — public, read-only, rate-limited.
   * Consumers scan a batch QR and get the signature-verified history.
   */
  app.get<{ Params: { trace_id: string } }>(
    '/trace/:trace_id',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req: FastifyRequest<{ Params: { trace_id: string } }>, reply: FastifyReply) => {
      const { rows } = await query<Record<string, unknown>>(
        `SELECT id, trace_id, commodity, variety, quantity, unit, production_date, origin_state,
                current_stage, destination_country, created_at
         FROM batches WHERE trace_id = $1`,
        [String(req.params.trace_id).toUpperCase()],
      );
      const batch = rows[0];
      if (!batch) return reply.code(404).send({ error: 'batch not found' });

      const events = (await query<EventRow>(
        `SELECT be.batch_id, be.seq, be.event_type, be.actor_id, be.actor_pubkey, be.actor_sig,
                be.prev_hash, be.payload_hash, be.to_stage, be.payload, be.created_at,
                e.nexus_id AS actor_nexus_id, e.role AS actor_role
         FROM batch_events be JOIN entities e ON e.id = be.actor_id
         WHERE be.batch_id = $1 ORDER BY be.seq ASC`,
        [batch.id],
      )).rows;

      reply.send({
        batch,
        history: events.map((e) => ({
          seq: e.seq, event_type: e.event_type, to_stage: e.to_stage, created_at: e.created_at,
        })),
        integrity: verifyChain(events),
      });
    },
  );

  /** GET /verify/:batch_id — integrity-first view used by the atims-verify CLI. */
  app.get<{ Params: { batch_id: string } }>('/verify/:batch_id', async (req, reply) => {
    const rows = (await query<{ id: string }>(
      `SELECT id FROM batches WHERE id::text = $1 OR trace_id = $1`, [req.params.batch_id],
    )).rows;
    if (!rows[0]) return reply.code(404).send({ error: 'not found' });
    const full = (await query<EventRow>(
      `SELECT batch_id, seq, event_type, actor_id, actor_pubkey, actor_sig, prev_hash,
              payload_hash, to_stage, payload, created_at
       FROM batch_events WHERE batch_id::text = $1 ORDER BY seq ASC`, [rows[0].id],
    )).rows;
    reply.send(verifyChain(full));
  });
}
