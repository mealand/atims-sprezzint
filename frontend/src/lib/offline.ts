/**
 * Offline event queue (M2.7) — events created while offline are stored in
 * IndexedDB and drained with "Sync now". Chain causality is respected by
 * ordering: queue drains FIFO and the server re-computes seq/hashes per
 * event, so a queued handover still lands in order.
 */
import Dexie, { type EntityTable } from 'dexie';
import { api } from './api';
import { ensureKey, signCanonical } from './keys';

interface QueuedEvent {
  id?: number;
  batch_id: string;
  event_type: string;
  to_stage?: string;
  payload: unknown;
  queued_at: string;
  attempts: number;
}

const db = new Dexie('atims') as Dexie & { events: EntityTable<QueuedEvent, 'id'> };
db.version(1).stores({ events: '++id, batch_id, queued_at' });

export async function queueEvent(batch_id: string, event_type: string, payload: unknown, to_stage?: string) {
  await db.events.add({ batch_id, event_type, to_stage, payload, queued_at: new Date().toISOString(), attempts: 0 });
}

export async function pendingCount(): Promise<number> {
  return db.events.count();
}

/** Drain the FIFO queue. Stops at the first network failure; keeps the rest. */
export async function syncQueue(): Promise<{ sent: number; remaining: number }> {
  let sent = 0;
  // eslint-disable-next-line no-restricted-syntax
  for (;;) {
    const next = await db.events.orderBy('id').first();
    if (!next) break;
    try {
      // Re-run signing if a device key exists (signature computed fresh against latest wire event).
      const dry = await api<{ wire_event: unknown }>(`/batches/${next.batch_id}/events`, {
        method: 'POST',
        body: { event_type: next.event_type, to_stage: next.to_stage, payload: next.payload, dry_run: true },
      });
      const key = await ensureKey();
      const actor_sig = await signCanonical(dry.wire_event);
      await api(`/batches/${next.batch_id}/events`, {
        method: 'POST',
        body: {
          event_type: next.event_type, to_stage: next.to_stage, payload: next.payload,
          actor_pubkey: key.pubkeyB64, actor_sig, created_at: next.queued_at,
        },
      });
      await db.events.delete(next.id!);
      sent++;
    } catch (err) {
      await db.events.update(next.id!, { attempts: next.attempts + 1 });
      // 4xx business errors (gate, holder) are terminal-ish: keep for inspection, stop draining.
      break;
    }
  }
  return { sent, remaining: await db.events.count() };
}
