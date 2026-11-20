/**
 * T5: the public trace view lists the corridor route, which gate items were met
 * (by whom, at what trust tier), custody and anchors, and leaks no private data.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { StageRequirementRow } from '../src/services/gates.js';

process.env.JWT_SECRET ??= 'test-secret-at-least-16-chars';
process.env.NODE_ENV ??= 'test';

let buildTraceView: typeof import('../src/routes/trace.js')['buildTraceView'];
beforeAll(async () => { ({ buildTraceView } = await import('../src/routes/trace.js')); });

const FARMER = '11111111-1111-4111-8111-111111111111';
const AGG = '22222222-2222-4222-8222-222222222222';
const BATCH = '99999999-9999-4999-8999-999999999999';
const OBJECT_KEY = `evidence/${AGG}/${BATCH}/abcdef`;
const t = (m: number) => new Date(Date.UTC(2026, 10, 20, 8, m)).toISOString();

const requirements: StageRequirementRow[] = [
  { corridor: 'NG-EU-SESAME', to_stage: 'AGGREGATED', evidence_types: [], from_roles: [], evidence_rules: {}, required_events: [], description: 'handover' },
  {
    corridor: 'NG-EU-SESAME', to_stage: 'PACKED', evidence_types: ['PHOTO', 'LAB_REPORT'], from_roles: [],
    evidence_rules: { LAB_REPORT: { roles: ['lab'], analytes: ['MRL', 'AFLATOXIN'] } }, required_events: [], description: 'photos and lab',
  },
  {
    corridor: 'NG-EU-SESAME', to_stage: 'DELIVERED', evidence_types: [], from_roles: [], evidence_rules: {},
    required_events: [{ event_type: 'DELIVERY_CONFIRMED', by: 'batch_buyer' }], description: 'buyer confirms',
  },
];

const ev = (seq: number, event_type: string, actor_role: string, extra: Record<string, unknown> = {}) => ({
  seq, event_type, to_stage: null as string | null, created_at: t(seq), payload: {}, payload_hash: `ph${seq}`,
  actor_sig: seq === 0 ? null : 'sig', actor_role, actor_trust_tier: 'self_verified', ...extra,
});

function view() {
  return buildTraceView({
    batch: { id: BATCH, trace_id: 'CROP-2026-ABCD', commodity: 'sesame', quantity: 1000, unit: 'kg', production_date: '2026-11-01', current_stage: 'PACKED', origin_entity_id: FARMER, current_holder_id: AGG },
    corridor: { code: 'NG-EU-SESAME', name: 'Nigeria to EU: sesame', origin_country: 'NG', destination_country: 'EU', commodity: 'sesame', description: 'EU' },
    requirements,
    events: [
      ev(0, 'BATCH_CREATED', 'farmer', { to_stage: 'HARVESTED', payload: { created: {} } }),
      ev(1, 'CUSTODY_TRANSFER', 'aggregator', { payload: { to_entity_id: AGG, via: 'handover', token_id: 'tok' } }),
      ev(2, 'STAGE_ADVANCE', 'aggregator', { to_stage: 'AGGREGATED', payload: { advanced_by: 'NX-AG-1' } }),
      ev(3, 'EVIDENCE_ADDED', 'aggregator', { actor_sig: null, payload: { evidence_type: 'PHOTO', file_hash: 'f'.repeat(64), issued_by_role: 'aggregator', object_key: OBJECT_KEY, meta: { file_name: 'secret.pdf' } } }),
      ev(4, 'EVIDENCE_ADDED', 'lab', { actor_sig: null, actor_trust_tier: 'kyb_verified', payload: { evidence_type: 'LAB_REPORT', file_hash: 'e'.repeat(64), issued_by_role: 'lab', object_key: null, meta: {} } }),
      ev(5, 'NOTE', 'aggregator', { payload: { text: 'call me on +234...' } }),
      ev(6, 'STAGE_ADVANCE', 'aggregator', { to_stage: 'PACKED', payload: {} }),
    ],
    evidence: [
      { seq: 3, evidence_type: 'PHOTO', file_hash: 'f'.repeat(64), created_at: t(3), issuer_role: 'aggregator', issuer_trust_tier: 'self_verified', meta: { file_name: 'secret.pdf' } },
      { seq: 4, evidence_type: 'LAB_REPORT', file_hash: 'e'.repeat(64), created_at: t(4), issuer_role: 'lab', issuer_trust_tier: 'kyb_verified', meta: { analytes: ['mrl', 'aflatoxin'], reference: 'LAB-77' } },
    ],
    anchors: [
      { head_hash: 'a'.repeat(64), ots_proof: Buffer.from([0x08, 0x00, 0x05, 0x88, 0x96, 0x0d, 0x73, 0xd7, 0x19, 0x01, 0x03, 0xf0, 0x8c, 0x35]).toString('base64'), block_height: 870000, submitted_at: t(10), confirmed_at: t(50) },
      { head_hash: 'c'.repeat(64), ots_proof: null, block_height: null, submitted_at: t(60), confirmed_at: null },
    ],
    head_hash: 'c'.repeat(64),
  });
}

describe('public trace view', () => {
  it('exposes no entity ids, batch id, object keys, notes or document metadata', () => {
    const json = JSON.stringify(view());
    for (const secret of [FARMER, AGG, BATCH, OBJECT_KEY, 'secret.pdf', 'LAB-77', '+234', 'NX-AG-1', 'tok']) {
      expect(json).not.toContain(secret);
    }
    expect(json).not.toMatch(/object_key|to_entity_id|actor_id|token_id/);
  });

  it('shows each gate passed, when, and which document from which issuer met it', () => {
    const v = view();
    const packed = v.route.find((r) => r.stage === 'PACKED')!;
    expect(packed.reached).toBe(true);
    expect(packed.reached_at).toBe(t(6));
    expect(packed.gate?.passed).toBe(true);
    const lab = packed.gate!.items.find((i) => i.type === 'LAB_REPORT')!;
    expect(lab.satisfied).toBe(true);
    expect(lab.satisfied_by).toMatchObject({ seq: 4, issuer_role: 'lab', issuer_trust_tier: 'kyb_verified' });
    expect(v.route[0]).toMatchObject({ stage: 'HARVESTED', reached: true, reached_at: t(0) });
  });

  it('evaluates future gates against what is on file now', () => {
    const delivered = view().route.find((r) => r.stage === 'DELIVERED')!;
    expect(delivered.reached).toBe(false);
    expect(delivered.gate?.passed).toBe(false);
    expect(delivered.gate?.items[0]).toMatchObject({ kind: 'event', type: 'DELIVERY_CONFIRMED', satisfied: false });
  });

  it('records custody as roles and tiers', () => {
    expect(view().custody).toEqual([
      { seq: 0, at: t(0), from_role: null, to_role: 'farmer', to_trust_tier: 'self_verified' },
      { seq: 1, at: t(1), from_role: 'farmer', to_role: 'aggregator', to_trust_tier: 'self_verified' },
    ]);
  });

  it('lists evidence with hashes, issuer tier and analytes only', () => {
    const lab = view().evidence.find((e) => e.evidence_type === 'LAB_REPORT')!;
    expect(lab).toEqual({
      seq: 4, evidence_type: 'LAB_REPORT', file_hash: 'e'.repeat(64), created_at: t(4),
      issuer_role: 'lab', issuer_trust_tier: 'kyb_verified', analytes: ['MRL', 'AFLATOXIN'],
    });
  });

  it('marks which anchor covers the current head and attaches a detached .ots file', () => {
    const [newest, older] = view().anchors;
    expect(newest).toMatchObject({ head_hash: 'c'.repeat(64), confirmed: false, is_current_head: true, ots_file: null });
    expect(older).toMatchObject({ confirmed: true, block_height: 870000, is_current_head: false });
    expect(Buffer.from(older.ots_file!, 'base64').subarray(1, 15).toString()).toBe('OpenTimestamps');
  });

  it('keeps the event summary to safe fields', () => {
    const h = view().history;
    expect(h.find((e) => e.seq === 3)?.detail).toEqual({ evidence_type: 'PHOTO', file_hash: 'f'.repeat(64), issued_by_role: 'aggregator' });
    expect(h.find((e) => e.seq === 5)?.detail).toEqual({});
    expect(h.every((e) => typeof e.payload_hash === 'string')).toBe(true);
  });
});
