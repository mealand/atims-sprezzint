/**
 * The single permission service. Every route asks `can(entity, action, batch?)`
 * (or `requireAccess`, which answers 403 for it) instead of checking roles
 * inline. docs/ENTITY-MODEL.md is the human-readable version of these rules;
 * api/test/access.test.ts pins them down.
 *
 * Kept free of top-level database imports so the rules can be unit-tested
 * without a database; the loaders import the pool lazily.
 */
import {
  ASSIGNABLE_ROLES, BATCH_CREATORS, CUSTODY_ROLES, REPORT_EVIDENCE_TYPES,
  type Action, type Role, type TrustTier,
} from '@atims/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';

export interface AccessEntity {
  id: string;
  role: Role;
  /** Account lifecycle; anything other than 'verified' is denied everything. */
  status?: string;
  trust_tier?: TrustTier;
}

/** Everyone with a relationship to a batch. Built by `loadBatch`. */
export interface BatchParties {
  id: string;
  origin_entity_id: string;
  current_holder_id: string;
  buyer_id: string | null;
  /** Entities that have held custody: origin plus every CUSTODY_TRANSFER recipient. */
  past_holder_ids: string[];
  /** Entities that appended an event or registered evidence. */
  contributor_ids: string[];
  /** Labs and inspectors assigned by a holder. */
  assigned_ids: string[];
}

export interface AccessDetail {
  /** add_evidence: the type being added. Labs and inspectors may only add their own report types. */
  evidence_type?: string;
  /** review_kyb and assign_party: the entity acted upon. */
  target?: { id: string; role: Role };
}

export interface Decision { allow: boolean; reason: string }

const allow = (reason: string): Decision => ({ allow: true, reason });
const deny = (reason: string): Decision => ({ allow: false, reason });

const isHolder = (e: AccessEntity, b: BatchParties) => b.current_holder_id === e.id;

/** Labs and inspectors join a batch by assignment or by having contributed to it. */
const isAttachedReviewer = (e: AccessEntity, b: BatchParties) =>
  (e.role === 'lab' || e.role === 'inspector')
  && (b.assigned_ids.includes(e.id) || b.contributor_ids.includes(e.id));

function canView(e: AccessEntity, b: BatchParties | undefined): Decision {
  if (e.role === 'admin' || e.role === 'regulator') return allow(`${e.role} oversight`);
  if (!b) return deny('batch required');
  if (b.origin_entity_id === e.id) return allow('origin entity');
  if (isHolder(e, b)) return allow('current holder');
  if (b.past_holder_ids.includes(e.id)) return allow('past holder');
  if (b.buyer_id && b.buyer_id === e.id) return allow('named buyer');
  if (isAttachedReviewer(e, b)) return allow(`assigned or contributing ${e.role}`);
  return deny('no relationship to this batch');
}

/** Full decision with a reason, for 403 messages and tests. */
export function decide(entity: AccessEntity, action: Action, batch?: BatchParties, detail: AccessDetail = {}): Decision {
  if (entity.status !== undefined && entity.status !== 'verified') return deny(`account is ${entity.status}`);
  if (entity.trust_tier === 'registered') return deny('confirm your email before acting');

  const needBatch = (): Decision | null => (batch ? null : deny('batch required'));

  switch (action) {
    case 'create_batch':
      return BATCH_CREATORS.includes(entity.role) ? allow('batch creator role') : deny(`a ${entity.role} cannot create batches`);

    case 'view_batch':
    case 'view_evidence_file':
      return canView(entity, batch);

    case 'append_event':
      return needBatch() ?? (isHolder(entity, batch!) ? allow('current holder') : deny('only the current holder can append events'));

    case 'add_evidence': {
      const b = batch;
      if (!b) return deny('batch required');
      if (isHolder(entity, b)) return allow('current holder');
      const own = REPORT_EVIDENCE_TYPES[entity.role];
      if (!own) return deny('only the current holder, or an assigned lab or inspector, can add evidence');
      if (!isAttachedReviewer(entity, b)) return deny(`this ${entity.role} is not assigned to the batch`);
      if (!detail.evidence_type || !own.includes(detail.evidence_type)) {
        return deny(`a ${entity.role} may only add its own reports: ${own.join(', ')}`);
      }
      return allow(`assigned ${entity.role} adding its own report`);
    }

    case 'start_handover':
      if (!batch) return deny('batch required');
      if (!isHolder(entity, batch)) return deny('only the current holder can start a handover');
      return allow('current holder');

    case 'accept_handover':
      if (!batch) return deny('batch required');
      if (!CUSTODY_ROLES.includes(entity.role)) return deny(`a ${entity.role} cannot take custody of a batch`);
      if (isHolder(entity, batch)) return deny('you already hold this batch');
      return allow('eligible custody role');

    case 'sign_off':
      if (!batch) return deny('batch required');
      if (entity.role !== 'inspector') return deny('only inspectors sign off');
      return isAttachedReviewer(entity, batch) ? allow('assigned inspector') : deny('this inspector is not assigned to the batch');

    case 'confirm_delivery':
      if (!batch) return deny('batch required');
      if (entity.role !== 'buyer') return deny('only the buyer confirms delivery');
      return batch.buyer_id === entity.id ? allow('named buyer') : deny('you are not the buyer named on this batch');

    case 'assign_party':
      if (!batch) return deny('batch required');
      if (!isHolder(entity, batch)) return deny('only the current holder can assign a lab or inspector');
      if (detail.target && !ASSIGNABLE_ROLES.includes(detail.target.role)) {
        return deny(`only ${ASSIGNABLE_ROLES.join(' and ')} accounts can be assigned`);
      }
      return allow('current holder');

    case 'review_kyb': {
      const t = detail.target;
      if (!t) return deny('target entity required');
      if (t.id === entity.id) return deny('you cannot review your own account');
      if (t.role === 'admin') return deny('admin accounts are not KYB reviewed');
      if (entity.role === 'admin') return allow('admin');
      if (entity.role === 'inspector') {
        if (t.role !== 'farmer') return deny('inspectors may only KYB-verify farmers');
        if (entity.trust_tier !== 'kyb_verified') return deny('only a KYB-verified inspector may KYB-verify farmers');
        return allow('KYB-verified inspector reviewing a farmer');
      }
      return deny(`a ${entity.role} cannot review KYB`);
    }

    case 'list_entities':
      if (entity.role === 'admin') return allow('admin');
      if (entity.role === 'inspector' && entity.trust_tier === 'kyb_verified') return allow('KYB-verified inspector (farmers only)');
      return deny('only admins and KYB-verified inspectors can list accounts');

    case 'manage_entities':
      return entity.role === 'admin' ? allow('admin') : deny('admin only');

    case 'ai_assistant':
      return batch ? canView(entity, batch) : allow('any active account');

    case 'ai_inspector_summary':
      if (!(['inspector', 'regulator', 'admin'] as Role[]).includes(entity.role)) return deny('inspectors, regulators and admins only');
      return batch ? canView(entity, batch) : deny('batch required');
  }
}

export function can(entity: AccessEntity, action: Action, batch?: BatchParties, detail?: AccessDetail): boolean {
  return decide(entity, action, batch, detail).allow;
}

// ── Route helpers ──────────────────────────────────────────

/** The authenticated entity as the access service sees it. */
export function accessEntity(req: FastifyRequest): AccessEntity {
  const e = req.entity;
  if (!e) throw new Error('accessEntity called before authenticate');
  return { id: e.id, role: e.role, status: e.status, trust_tier: (e as { trust_tier?: TrustTier }).trust_tier };
}

/** Answer 403 (and return false) unless the action is allowed. */
export function requireAccess(
  req: FastifyRequest, reply: FastifyReply, action: Action, batch?: BatchParties, detail?: AccessDetail,
  entity: AccessEntity = accessEntity(req),
): boolean {
  const d = decide(entity, action, batch, detail);
  if (!d.allow) {
    reply.code(403).send({ status: 403, code: 'FORBIDDEN', action, error: d.reason });
    return false;
  }
  return true;
}

/** Fastify onRequest hook for actions that need no batch (create_batch, manage_entities, ...). */
export const guard = (action: Action) => async (req: FastifyRequest, reply: FastifyReply) => {
  requireAccess(req, reply, action);
};

// ── Loaders ────────────────────────────────────────────────

/** Load a batch row (by uuid or trace_id) together with its parties. */
export async function loadBatch(idOrTrace: string): Promise<{ row: Record<string, unknown>; parties: BatchParties } | null> {
  const { query } = await import('../db/pool.js');
  const { rows } = await query<Record<string, unknown> & {
    _past: string[]; _contributors: string[]; _assigned: string[];
  }>(
    `SELECT b.*,
       ARRAY(SELECT DISTINCT be.payload->>'to_entity_id' FROM batch_events be
              WHERE be.batch_id = b.id AND be.event_type = 'CUSTODY_TRANSFER'
                AND be.payload->>'to_entity_id' IS NOT NULL) AS _past,
       ARRAY(SELECT be.actor_id::text FROM batch_events be WHERE be.batch_id = b.id
             UNION SELECT ev.actor_id::text FROM evidence ev WHERE ev.batch_id = b.id) AS _contributors,
       ARRAY(SELECT ba.entity_id::text FROM batch_assignments ba WHERE ba.batch_id = b.id) AS _assigned
     FROM batches b WHERE b.id::text = $1 OR b.trace_id = upper($1)
     LIMIT 1`,
    [idOrTrace],
  );
  const r = rows[0];
  if (!r) return null;
  const { _past, _contributors, _assigned, ...row } = r;
  const origin = String(row.origin_entity_id);
  return {
    row,
    parties: {
      id: String(row.id),
      origin_entity_id: origin,
      current_holder_id: String(row.current_holder_id),
      buyer_id: row.buyer_id ? String(row.buyer_id) : null,
      past_holder_ids: [...new Set([origin, ..._past])],
      contributor_ids: _contributors,
      assigned_ids: _assigned,
    },
  };
}

/**
 * Batches the entity may view: the SQL form of `can(entity, 'view_batch', batch)`.
 * Keep the two in step; the access tests document the rule.
 */
export async function listVisibleBatches(entity: AccessEntity, limit = 200): Promise<Record<string, unknown>[]> {
  const { query } = await import('../db/pool.js');
  if (entity.role === 'admin' || entity.role === 'regulator') {
    return (await query(`SELECT * FROM batches ORDER BY created_at DESC LIMIT $1`, [limit])).rows;
  }
  const reviewer = entity.role === 'lab' || entity.role === 'inspector';
  return (await query(
    `SELECT b.* FROM batches b
      WHERE b.origin_entity_id = $1 OR b.current_holder_id = $1 OR b.buyer_id = $1
         OR EXISTS (SELECT 1 FROM batch_events be WHERE be.batch_id = b.id
                     AND be.event_type = 'CUSTODY_TRANSFER' AND be.payload->>'to_entity_id' = $1::text)
         OR ($2 AND (
              EXISTS (SELECT 1 FROM batch_assignments ba WHERE ba.batch_id = b.id AND ba.entity_id = $1)
           OR EXISTS (SELECT 1 FROM batch_events be WHERE be.batch_id = b.id AND be.actor_id = $1)
           OR EXISTS (SELECT 1 FROM evidence ev WHERE ev.batch_id = b.id AND ev.actor_id = $1)))
      ORDER BY b.created_at DESC LIMIT $3`,
    [entity.id, reviewer, limit],
  )).rows;
}

/** Load trust_tier for an entity when a rule needs it (review_kyb, list_entities). */
export async function withTrustTier(entity: AccessEntity): Promise<AccessEntity> {
  if (entity.trust_tier) return entity;
  const { query } = await import('../db/pool.js');
  const { rows } = await query<{ trust_tier: TrustTier }>(`SELECT trust_tier FROM entities WHERE id = $1`, [entity.id]);
  return { ...entity, trust_tier: rows[0]?.trust_tier };
}
