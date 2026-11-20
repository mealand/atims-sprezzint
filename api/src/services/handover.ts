/**
 * Custody handover (F3, F11). Custody moves only through here: the holder mints
 * a one-time token, the receiver scans it and accepts with a signed
 * CUSTODY_TRANSFER event.
 *
 * Accepting is one transaction on one connection:
 *   BEGIN; lock the token, then the batch (SELECT ... FOR UPDATE); check the
 *   token, the custody chain and the receiver's role; compute the next chain
 *   link; verify the signature; insert the event; mark the token used; move
 *   current_holder_id; COMMIT.
 * Anything else ROLLBACKs, so two scans of one token cannot both win, and a
 * dry-run (the receiver fetching the exact wire event to sign) writes nothing.
 *
 * The signature rules are the same as for every other client event
 * (signedEvent.ts): same wire format, same 10-minute created_at window.
 */
import { canonicalHash } from '@atims/shared';
import { decide, type AccessEntity, type BatchParties } from './access.js';
import { buildWireEvent, checkPubkey, checkSignedSubmission, resolveSignedCreatedAt } from './signedEvent.js';
import { nextLinkOn, type Queryable } from './tx.js';

export interface TokenRow {
  id: string; batch_id: string; token: string; from_holder: string;
  used_at: string | Date | null; used_by: string | null; expires_at: string | Date;
}

export interface AcceptBody {
  dry_run?: boolean;
  actor_pubkey?: string;
  actor_sig?: string;
  created_at?: string;
  /** seq of the dry-run wire event the client signed. */
  seq?: number;
}

export type AcceptOutcome =
  | { kind: 'dry_run'; wire_event: ReturnType<typeof buildWireEvent>; payload_hash: string; prev_hash: string | null }
  | { kind: 'accepted'; event: Record<string, unknown>; batch: Record<string, unknown> }
  | { kind: 'rejected'; status: number; code: string; error: string };

const reject = (status: number, code: string, error: string): AcceptOutcome => ({ kind: 'rejected', status, code, error });

/** Pull the token out of whatever the QR or the user gave us. Mirrors the frontend parser. */
export function extractHandoverToken(input: string): string {
  const text = input.trim();
  if (text.startsWith('atims://handover/')) return decodeURIComponent(text.slice('atims://handover/'.length).split(/[?#]/)[0]);
  const m = text.match(/[?&]token=([^&#\s]+)/);
  if (m) return decodeURIComponent(m[1]);
  return text;
}

/**
 * Accept a handover on `client` (a dedicated connection). Owns BEGIN/COMMIT/ROLLBACK.
 * `loadParties` supplies the batch's parties for the access check; the holder
 * is always taken from the locked row.
 */
export async function acceptHandover(
  client: Queryable,
  args: {
    token: string;
    me: AccessEntity;
    body: AcceptBody;
    loadParties: (batchId: string) => Promise<BatchParties | null>;
    now?: number;
  },
): Promise<AcceptOutcome> {
  const { token, me, body } = args;
  const now = args.now ?? Date.now();

  const badKey = checkPubkey(body.actor_pubkey);
  if (badKey) return reject(badKey.status, badKey.code, badKey.error);

  await client.query('BEGIN');
  let committed = false;
  try {
    const t = (await client.query<TokenRow>(
      `SELECT * FROM handover_tokens WHERE token = $1 FOR UPDATE`, [token],
    )).rows[0];
    if (!t) return reject(404, 'TOKEN_NOT_FOUND', 'handover token not found');
    if (t.used_at) return reject(410, 'TOKEN_USED', 'handover token already used');
    if (new Date(t.expires_at).valueOf() < now) return reject(410, 'TOKEN_EXPIRED', 'handover token expired');
    if (t.from_holder === me.id) return reject(409, 'OWN_HANDOVER', 'cannot accept your own handover');

    const batch = (await client.query<Record<string, unknown>>(
      `SELECT * FROM batches WHERE id = $1 FOR UPDATE`, [t.batch_id],
    )).rows[0];
    if (!batch) return reject(404, 'BATCH_NOT_FOUND', 'batch not found');
    if (String(batch.current_holder_id) !== t.from_holder) {
      return reject(409, 'CUSTODY_MOVED', 'custody has moved since this token was issued');
    }

    const loaded = await args.loadParties(String(batch.id));
    const parties: BatchParties = {
      ...(loaded ?? {
        id: String(batch.id), origin_entity_id: String(batch.origin_entity_id), buyer_id: null,
        past_holder_ids: [], contributor_ids: [], assigned_ids: [],
      }),
      current_holder_id: String(batch.current_holder_id),
      buyer_id: batch.buyer_id ? String(batch.buyer_id) : null,
    };
    const d = decide(me, 'accept_handover', parties);
    if (!d.allow) return reject(403, 'FORBIDDEN', d.reason);
    if (me.role === 'buyer' && parties.buyer_id !== me.id) {
      return reject(403, 'FORBIDDEN', 'a buyer can only take custody of a batch named for it');
    }

    const batchId = String(batch.id);
    const { seq, prev_hash: prevHash } = await nextLinkOn(client, batchId);
    let createdAt: string;
    if (body.dry_run) {
      createdAt = new Date(now).toISOString();
    } else {
      const ts = resolveSignedCreatedAt(body.created_at, now);
      if ('status' in ts) return reject(ts.status, ts.code, ts.error);
      createdAt = ts.value;
    }
    const payload = { to_entity_id: me.id, via: 'handover', token_id: t.id };
    const wire = buildWireEvent({
      batchId, seq, eventType: 'CUSTODY_TRANSFER', actorId: me.id, actorPubkey: body.actor_pubkey as string,
      toStage: null, payload, createdAt,
    });
    const payloadHash = canonicalHash(wire);
    if (body.dry_run) return { kind: 'dry_run', wire_event: wire, payload_hash: payloadHash, prev_hash: prevHash };

    const bad = checkSignedSubmission({ wire, actorSig: body.actor_sig, clientSeq: body.seq });
    if (bad) return reject(bad.status, bad.code, bad.error);

    const event = (await client.query(
      `INSERT INTO batch_events (batch_id, seq, event_type, actor_id, actor_pubkey, actor_sig, prev_hash, payload_hash, to_stage, payload, created_at)
       VALUES ($1,$2,'CUSTODY_TRANSFER',$3,$4,$5,$6,$7,NULL,$8::jsonb,$9) RETURNING *`,
      [batchId, seq, me.id, body.actor_pubkey, body.actor_sig, prevHash, payloadHash, JSON.stringify(payload), createdAt],
    )).rows[0];
    await client.query(`UPDATE handover_tokens SET used_at = now(), used_by = $2 WHERE id = $1`, [t.id, me.id]);
    const updated = (await client.query(
      `UPDATE batches SET current_holder_id = $2, updated_at = now() WHERE id = $1 RETURNING *`,
      [batchId, me.id],
    )).rows[0];
    await client.query('COMMIT');
    committed = true;
    return { kind: 'accepted', event, batch: updated };
  } finally {
    if (!committed) await client.query('ROLLBACK').catch(() => {});
  }
}
