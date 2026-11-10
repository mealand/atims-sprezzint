import { query, actor } from '../db/pool.js';
import { farmerAssistant, inspectorSummarise } from '../services/ai.js';

/** AI routes — local Ollama only. Deterministic core never depends on these. */
export default async function aiRoutes(app: import('fastify').FastifyInstance) {
  app.post<{ Body: { question: string; batch_id?: string } }>(
    '/ai/farmer-assistant',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { question, batch_id } = req.body ?? {};
      if (!question) return reply.code(400).send({ error: 'question required' });
      let batchContext = {};
      if (batch_id) {
        const { rows } = await query(
          `SELECT trace_id, commodity, quantity, unit, current_stage, compliance_status, destination_country
           FROM batches WHERE id = $1 OR trace_id = $1`,
          [batch_id],
        );
        batchContext = rows[0] ?? {};
      }
      try {
        const answer = await farmerAssistant(question, batchContext);
        reply.send({ answer, generated: true, model: 'local' });
      } catch {
        reply.code(502).send({ error: 'AI assistant unavailable (is Ollama running?)' });
      }
    },
  );

  app.post<{ Body: { batch_id: string } }>(
    '/ai/inspector-summary',
    { onRequest: [app.authenticate, app.requireRole('inspector', 'regulator', 'admin')] },
    async (req, reply) => {
      const { batch_id } = req.body ?? {};
      if (!batch_id) return reply.code(400).send({ error: 'batch_id required' });
      const events = (await query(
        `SELECT seq, event_type, to_stage, payload, created_at, actor_id FROM batch_events
         WHERE batch_id = (SELECT id FROM batches WHERE id = $1 OR trace_id = $1) ORDER BY seq ASC`,
        [batch_id],
      )).rows;
      try {
        const answer = await inspectorSummarise(events);
        reply.send({ summary: answer, generated: true, model: 'local' });
      } catch {
        reply.code(502).send({ error: 'AI assistant unavailable (is Ollama running?)' });
      }
    },
  );
}
