/**
 * Stale registrations: an account that self-registered but never confirmed its
 * email code must not reserve its email and registration numbers forever.
 *
 * After STALE_REGISTRATION_MS, a new registration may reclaim them. The rule is
 * a pure function (`isStaleRegistration`) so it is unit-tested without a
 * database; the helpers below apply it inside the register transaction.
 *
 * Reclaiming never touches the ledger (batch_events is append-only) and an
 * account with any batch, event, evidence, assignment or handover is never
 * stale, so nothing on the ledger can point at a reclaimed account.
 */
import type pg from 'pg';

// No top-level import of config or pool: this module is unit-tested in CI without a full env.

/** How long an unconfirmed registration holds its email and identifiers. */
export const STALE_REGISTRATION_MS = 24 * 60 * 60 * 1000;

/** What the rule needs to know about an existing account. */
export interface RegistrationFacts {
  trust_tier: string;
  status: string;
  email: string | null;
  email_verified_at: Date | string | null;
  kyb_verified_at: Date | string | null;
  created_at: Date | string;
  /** Batches the account originated, holds, buys, or is assigned to, plus evidence and handovers it is party to. */
  batch_count: number;
  /** Ledger events the account signed (batch_events.actor_id). */
  event_count: number;
}

/**
 * True only when the account is still a bare self-registration: tier
 * 'registered', status 'pending', an email on file that was never confirmed,
 * never KYB'd, no batch activity and no ledger events, and created strictly
 * more than STALE_REGISTRATION_MS before `now`. Anything unexpected (an
 * unparseable timestamp, a negative age) is treated as not stale.
 */
export function isStaleRegistration(f: RegistrationFacts, now: Date = new Date(), ttlMs: number = STALE_REGISTRATION_MS): boolean {
  if (f.trust_tier !== 'registered' || f.status !== 'pending') return false;
  // Pending accounts without an email predate email codes and wait for an admin; leave them alone.
  if (!f.email) return false;
  if (f.email_verified_at || f.kyb_verified_at) return false;
  if (Number(f.batch_count) !== 0 || Number(f.event_count) !== 0) return false;
  const created = new Date(f.created_at).valueOf();
  if (!Number.isFinite(created) || !Number.isFinite(now.valueOf())) return false;
  return now.valueOf() - created > ttlMs;
}

// ── Transaction helpers ─────────────────────────────────────

type Db = Pick<pg.PoolClient, 'query'>;

export interface Holder extends RegistrationFacts {
  id: string;
  nexus_id: string;
  stale: boolean;
}

/**
 * Lock every account holding `email` or any of `ids` (FOR UPDATE, in id order
 * so concurrent registrations cannot deadlock) and classify each one. Locking
 * first means a concurrent verify-email or resend-code, which lock the same
 * row, is serialised with the reclaim.
 */
export async function lockHolders(db: Db, email: string, ids: Array<{ kind: string; value: string }>): Promise<Holder[]> {
  const candidates = (await db.query<{ id: string }>(
    `SELECT id FROM entities WHERE lower(email) = lower($1)
     UNION
     SELECT entity_id FROM entity_identifiers
      WHERE (kind, value) IN (SELECT * FROM unnest($2::text[], $3::text[]))`,
    [email, ids.map((i) => i.kind), ids.map((i) => i.value)],
  )).rows.map((r) => r.id);
  if (!candidates.length) return [];

  await db.query(`SELECT id FROM entities WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`, [candidates]);
  const rows = (await db.query<Omit<Holder, 'stale'> & { db_now: Date }>(
    `SELECT e.id, e.nexus_id, e.trust_tier, e.status, e.email, e.email_verified_at, e.kyb_verified_at, e.created_at,
            (  (SELECT count(*) FROM batches b WHERE e.id IN (b.origin_entity_id, b.current_holder_id, b.buyer_id))
             + (SELECT count(*) FROM batch_assignments a WHERE e.id IN (a.entity_id, a.assigned_by))
             + (SELECT count(*) FROM evidence v WHERE v.actor_id = e.id)
             + (SELECT count(*) FROM handover_tokens h WHERE e.id IN (h.from_holder, h.used_by))
            )::int AS batch_count,
            (SELECT count(*) FROM batch_events ev WHERE ev.actor_id = e.id)::int AS event_count,
            now() AS db_now
       FROM entities e WHERE e.id = ANY($1::uuid[]) ORDER BY e.id`,
    [candidates],
  )).rows;
  // Judge age by the database clock, the same clock that stamped created_at.
  return rows.map(({ db_now, ...h }) => ({ ...h, stale: isStaleRegistration(h, new Date(db_now)) }));
}

export interface Reclaimed {
  reclaimed_entity_id: string;
  reclaimed_nexus_id: string;
  registered_at: string;
  outcome: 'deleted' | 'email_released';
  identifiers_released: string[];
}

/**
 * Free a stale account's email and identifiers: delete its entity_identifiers
 * and email_codes, then delete the entity row, or, if some row still references
 * it, keep the row and null its email. Call only for a holder `lockHolders`
 * marked stale, within the same transaction. The caller writes the audit entry.
 */
export async function reclaimStale(db: Db, h: Holder): Promise<Reclaimed> {
  const released = (await db.query<{ kind: string }>(
    `DELETE FROM entity_identifiers WHERE entity_id = $1 RETURNING kind`, [h.id],
  )).rows.map((r) => r.kind).sort();
  await db.query(`DELETE FROM email_codes WHERE entity_id = $1`, [h.id]);

  let outcome: Reclaimed['outcome'] = 'deleted';
  await db.query('SAVEPOINT reclaim_entity');
  try {
    await db.query(`DELETE FROM entities WHERE id = $1`, [h.id]);
    await db.query('RELEASE SAVEPOINT reclaim_entity');
  } catch (err) {
    // 23503: a foreign key still points at the row. Keep it, release the email.
    if ((err as { code?: string }).code !== '23503') throw err;
    await db.query('ROLLBACK TO SAVEPOINT reclaim_entity');
    await db.query(`UPDATE entities SET email = NULL, updated_at = now() WHERE id = $1`, [h.id]);
    outcome = 'email_released';
  }
  return {
    reclaimed_entity_id: h.id,
    reclaimed_nexus_id: h.nexus_id,
    registered_at: new Date(h.created_at).toISOString(),
    outcome,
    identifiers_released: released,
  };
}
