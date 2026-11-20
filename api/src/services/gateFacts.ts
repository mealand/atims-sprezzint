/**
 * Database side of the gate engine: load a corridor's requirements and a
 * batch's evidence and events, then hand them to the pure functions in gates.ts.
 */
import { DEFAULT_CORRIDOR, evaluateGate, nextStageOf, type EventFact, type EvidenceFact, type GateResult, type StageRequirementRow } from './gates.js';
import type { Stage } from '@atims/shared';
import type { Queryable } from './tx.js';

async function db(): Promise<Queryable> {
  const { pool } = await import('../db/pool.js');
  return pool;
}

const REQ_COLUMNS = `corridor, to_stage, evidence_types, from_roles, evidence_rules, required_events, description`;

export async function requirementFor(corridor: string, toStage: string, q?: Queryable): Promise<StageRequirementRow | null> {
  const c = q ?? await db();
  const { rows } = await c.query<StageRequirementRow>(
    `SELECT ${REQ_COLUMNS} FROM stage_requirements WHERE corridor = $1 AND to_stage = $2`,
    [corridor || DEFAULT_CORRIDOR, toStage],
  );
  return rows[0] ?? null;
}

export async function requirementsForCorridor(corridor: string, q?: Queryable): Promise<StageRequirementRow[]> {
  const c = q ?? await db();
  return (await c.query<StageRequirementRow>(
    `SELECT ${REQ_COLUMNS} FROM stage_requirements WHERE corridor = $1`, [corridor || DEFAULT_CORRIDOR],
  )).rows;
}

export async function evidenceFacts(batchId: string, q?: Queryable): Promise<Array<EvidenceFact & { created_at: string }>> {
  const c = q ?? await db();
  // issued_by_role comes from the uploader's account, never from the client.
  return (await c.query<EvidenceFact & { created_at: string }>(
    `SELECT e.evidence_type, ent.role AS issued_by_role, e.meta, e.created_at
       FROM evidence e JOIN entities ent ON ent.id = e.actor_id
      WHERE e.batch_id = $1 ORDER BY e.created_at`, [batchId],
  )).rows;
}

export async function eventFacts(batchId: string, q?: Queryable): Promise<Array<EventFact & { created_at: string; payload: unknown }>> {
  const c = q ?? await db();
  return (await c.query<EventFact & { created_at: string; payload: unknown }>(
    `SELECT be.event_type, be.actor_id::text AS actor_id, ent.role AS actor_role, be.created_at, be.payload
       FROM batch_events be JOIN entities ent ON ent.id = be.actor_id
      WHERE be.batch_id = $1 ORDER BY be.seq`, [batchId],
  )).rows;
}

/** Evaluate the gate for advancing `batch` to `toStage` on its corridor. */
export async function evaluateBatchGate(
  batch: Record<string, unknown>,
  toStage: Stage,
  q?: Queryable,
): Promise<GateResult> {
  const batchId = String(batch.id);
  const corridor = batch.corridor ? String(batch.corridor) : DEFAULT_CORRIDOR;
  const [req, evidence, events] = await Promise.all([
    requirementFor(corridor, toStage, q), evidenceFacts(batchId, q), eventFacts(batchId, q),
  ]);
  const gate = evaluateGate({
    to_stage: toStage, evidence_present: evidence, events_present: events,
    buyer_id: batch.buyer_id ? String(batch.buyer_id) : null,
  }, req);
  return { ...gate, corridor };
}

/** Gate report for the batch's next stage, or null at the final stage. */
export async function nextGate(batch: Record<string, unknown>) {
  const next = nextStageOf(String(batch.current_stage));
  if (!next) return null;
  return evaluateBatchGate(batch, next);
}
