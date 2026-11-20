import { accessEntity, decide, listVisibleBatches, loadBatch } from '../services/access.js';
import { DEFAULT_CORRIDOR, inspectorQueueStatus, type StageRequirementRow } from '../services/gates.js';
import { eventFacts, evidenceFacts, nextGate, requirementsForCorridor } from '../services/gateFacts.js';
import type { FastifyInstance } from 'fastify';

/**
 * Inspector sign-off queue.
 *
 * GET /inspector/queue: batches this inspector may sign off (access.ts
 * `sign_off`: assigned to the batch, or already contributing) that are waiting
 * on it, either because an upcoming corridor gate needs an inspector-issued
 * document (PHYTOSANITARY_CERT) that is not on file, or because evidence was
 * added since the last INSPECTION_SIGNOFF.
 *
 * The inspector acts with POST /batches/:id/evidence (its own report types) and
 * a signed INSPECTION_SIGNOFF on POST /batches/:id/events
 * (payload { decision: 'approved' | 'rejected', note? }).
 */
export default async function inspectorRoutes(app: FastifyInstance) {
  app.get('/inspector/queue', { onRequest: [app.authenticate] }, async (req, reply) => {
    const me = accessEntity(req);
    if (me.role !== 'inspector') {
      return reply.code(403).send({ status: 403, code: 'FORBIDDEN', action: 'sign_off', error: 'only inspectors have a sign-off queue' });
    }
    const corridorReqs = new Map<string, StageRequirementRow[]>();
    const items = [];
    for (const row of await listVisibleBatches(me)) {
      const loaded = await loadBatch(String(row.id));
      if (!loaded || !decide(me, 'sign_off', loaded.parties).allow) continue;
      const corridor = String(row.corridor ?? DEFAULT_CORRIDOR);
      if (!corridorReqs.has(corridor)) corridorReqs.set(corridor, await requirementsForCorridor(corridor));
      const [evidence, events] = await Promise.all([evidenceFacts(String(row.id)), eventFacts(String(row.id))]);
      const status = inspectorQueueStatus({
        current_stage: String(row.current_stage), requirements: corridorReqs.get(corridor)!, evidence, events,
      });
      if (!status.awaiting_documents.length && !status.awaiting_signoff) continue;
      items.push({
        batch: {
          id: row.id, trace_id: row.trace_id, commodity: row.commodity, quantity: row.quantity, unit: row.unit,
          current_stage: row.current_stage, corridor, current_holder_id: row.current_holder_id, updated_at: row.updated_at,
        },
        ...status,
        next_gate: await nextGate(row),
      });
    }
    reply.send({ items });
  });
}
