import { describe, it, expect } from 'vitest';
import { can, decide, type AccessEntity, type BatchParties } from '../src/services/access.js';
import { ROLES, type Action, type Role } from '@atims/shared';

const ent = (role: Role, id: string = role, extra: Partial<AccessEntity> = {}): AccessEntity =>
  ({ id, role, status: 'verified', trust_tier: 'self_verified', ...extra });

/** A batch created by farmer F, handed to aggregator A, now held by exporter X, sold to buyer B, with lab L assigned. */
const batch: BatchParties = {
  id: 'batch-1',
  origin_entity_id: 'F',
  current_holder_id: 'X',
  buyer_id: 'B',
  past_holder_ids: ['F', 'A', 'X'],
  contributor_ids: ['F', 'A', 'X', 'I'],
  assigned_ids: ['L'],
};

const farmer = ent('farmer', 'F');
const aggregator = ent('aggregator', 'A');
const exporter = ent('exporter', 'X');
const buyer = ent('buyer', 'B');
const lab = ent('lab', 'L');
const inspector = ent('inspector', 'I');
const regulator = ent('regulator', 'R');
const admin = ent('admin', 'ADM', { trust_tier: 'kyb_verified' });

// Outsiders: same roles, no relationship to the batch.
const otherFarmer = ent('farmer', 'F2');
const otherBuyer = ent('buyer', 'B2');
const otherLab = ent('lab', 'L2');
const otherInspector = ent('inspector', 'I2');
const processor = ent('processor', 'P');

describe('access: view_batch', () => {
  it.each([
    ['origin farmer', farmer],
    ['past holder', aggregator],
    ['current holder', exporter],
    ['named buyer', buyer],
    ['assigned lab', lab],
    ['contributing inspector', inspector],
    ['regulator', regulator],
    ['admin', admin],
  ])('%s can view', (_label, e) => {
    expect(can(e, 'view_batch', batch)).toBe(true);
    expect(can(e, 'view_evidence_file', batch)).toBe(true);
  });

  it.each([
    ['unrelated farmer', otherFarmer],
    ['unrelated buyer', otherBuyer],
    ['unassigned lab', otherLab],
    ['unassigned inspector', otherInspector],
    ['unrelated processor', processor],
  ])('%s cannot view', (_label, e) => {
    expect(can(e, 'view_batch', batch)).toBe(false);
    expect(can(e, 'view_evidence_file', batch)).toBe(false);
  });

  it('a non-reviewer role does not gain view by having appended an event', () => {
    const b = { ...batch, contributor_ids: [...batch.contributor_ids, 'P'] };
    expect(can(processor, 'view_batch', b)).toBe(false);
  });
});

describe('access: create_batch', () => {
  it.each(ROLES.map((r) => [r, r === 'farmer'] as const))('%s -> %s', (role, expected) => {
    expect(can(ent(role), 'create_batch')).toBe(expected);
  });
});

describe('access: append_event and handover', () => {
  it('only the current holder appends', () => {
    expect(can(exporter, 'append_event', batch)).toBe(true);
    for (const e of [farmer, aggregator, buyer, lab, inspector, regulator, admin]) {
      expect(can(e, 'append_event', batch)).toBe(false);
    }
  });

  it('only the current holder starts a handover', () => {
    expect(can(exporter, 'start_handover', batch)).toBe(true);
    expect(can(aggregator, 'start_handover', batch)).toBe(false);
    expect(can(admin, 'start_handover', batch)).toBe(false);
  });

  it('custody roles can accept; others cannot; nor can the holder', () => {
    for (const e of [farmer, aggregator, processor, buyer, otherBuyer]) expect(can(e, 'accept_handover', batch)).toBe(true);
    for (const e of [lab, inspector, regulator, admin]) expect(can(e, 'accept_handover', batch)).toBe(false);
    expect(can(exporter, 'accept_handover', batch)).toBe(false);
  });
});

describe('access: add_evidence', () => {
  it('current holder may add any type', () => {
    expect(can(exporter, 'add_evidence', batch, { evidence_type: 'EXPORT_DECLARATION' })).toBe(true);
    expect(can(exporter, 'add_evidence', batch, { evidence_type: 'PHOTO' })).toBe(true);
  });

  it('assigned lab adds lab reports only', () => {
    expect(can(lab, 'add_evidence', batch, { evidence_type: 'LAB_REPORT' })).toBe(true);
    expect(can(lab, 'add_evidence', batch, { evidence_type: 'PHYTOSANITARY_CERT' })).toBe(false);
    expect(can(lab, 'add_evidence', batch, {})).toBe(false);
  });

  it('contributing inspector adds inspection reports only', () => {
    expect(can(inspector, 'add_evidence', batch, { evidence_type: 'PHYTOSANITARY_CERT' })).toBe(true);
    expect(can(inspector, 'add_evidence', batch, { evidence_type: 'LAB_REPORT' })).toBe(false);
  });

  it('never for anyone else', () => {
    expect(can(otherLab, 'add_evidence', batch, { evidence_type: 'LAB_REPORT' })).toBe(false);
    expect(can(otherInspector, 'add_evidence', batch, { evidence_type: 'PHYTOSANITARY_CERT' })).toBe(false);
    for (const e of [farmer, aggregator, buyer, regulator, admin]) {
      expect(can(e, 'add_evidence', batch, { evidence_type: 'PHOTO' })).toBe(false);
    }
  });
});

describe('access: sign_off, confirm_delivery, assign_party', () => {
  it('sign_off: assigned or contributing inspector only', () => {
    expect(can(inspector, 'sign_off', batch)).toBe(true);
    expect(can(otherInspector, 'sign_off', batch)).toBe(false);
    expect(can(lab, 'sign_off', batch)).toBe(false);
    expect(can(admin, 'sign_off', batch)).toBe(false);
  });

  it('confirm_delivery: only the named buyer', () => {
    expect(can(buyer, 'confirm_delivery', batch)).toBe(true);
    expect(can(otherBuyer, 'confirm_delivery', batch)).toBe(false);
    expect(can(exporter, 'confirm_delivery', batch)).toBe(false);
    expect(can(buyer, 'confirm_delivery', { ...batch, buyer_id: null })).toBe(false);
  });

  it('assign_party: current holder assigns labs and inspectors', () => {
    expect(can(exporter, 'assign_party', batch, { target: { id: 'L2', role: 'lab' } })).toBe(true);
    expect(can(exporter, 'assign_party', batch, { target: { id: 'I2', role: 'inspector' } })).toBe(true);
    expect(can(exporter, 'assign_party', batch, { target: { id: 'B2', role: 'buyer' } })).toBe(false);
    expect(can(aggregator, 'assign_party', batch, { target: { id: 'L2', role: 'lab' } })).toBe(false);
  });
});

describe('access: review_kyb', () => {
  const target = (role: Role, id = `t-${role}`) => ({ target: { id, role } });
  const kybInspector = ent('inspector', 'IK', { trust_tier: 'kyb_verified' });

  it('admin reviews any non-admin role', () => {
    for (const r of ROLES.filter((x) => x !== 'admin')) expect(can(admin, 'review_kyb', undefined, target(r))).toBe(true);
    expect(can(admin, 'review_kyb', undefined, target('admin'))).toBe(false);
  });

  it('KYB-verified inspector reviews farmers only', () => {
    expect(can(kybInspector, 'review_kyb', undefined, target('farmer'))).toBe(true);
    expect(can(kybInspector, 'review_kyb', undefined, target('exporter'))).toBe(false);
  });

  it('self-verified inspector cannot review', () => {
    expect(can(inspector, 'review_kyb', undefined, target('farmer'))).toBe(false);
  });

  it('no one reviews themselves, and other roles never review', () => {
    expect(can(admin, 'review_kyb', undefined, { target: { id: 'ADM', role: 'regulator' } })).toBe(false);
    expect(can(kybInspector, 'review_kyb', undefined, { target: { id: 'IK', role: 'farmer' } })).toBe(false);
    for (const e of [farmer, exporter, buyer, lab, regulator]) expect(can(e, 'review_kyb', undefined, target('farmer'))).toBe(false);
    expect(can(admin, 'review_kyb')).toBe(false);
  });
});

describe('access: account state', () => {
  const every: Action[] = ['create_batch', 'view_batch', 'append_event', 'add_evidence', 'start_handover', 'accept_handover', 'manage_entities'];

  it.each(['pending', 'suspended', 'rejected'])('a %s account is denied everything', (status) => {
    for (const a of every) expect(can(ent('admin', 'ADM', { status }), a, batch)).toBe(false);
    expect(can(ent('farmer', 'F', { status }), 'create_batch')).toBe(false);
  });

  it('a registered (email unconfirmed) account is denied, with a reason', () => {
    const d = decide(ent('farmer', 'F', { trust_tier: 'registered' }), 'create_batch');
    expect(d.allow).toBe(false);
    expect(d.reason).toMatch(/email/);
  });

  it('self_verified and kyb_verified both act without an admin step', () => {
    expect(can(ent('farmer', 'F', { trust_tier: 'self_verified' }), 'create_batch')).toBe(true);
    expect(can(ent('farmer', 'F', { trust_tier: 'kyb_verified' }), 'create_batch')).toBe(true);
  });

  it('management and listing are admin-only (plus KYB inspectors for listing)', () => {
    expect(can(admin, 'manage_entities')).toBe(true);
    expect(can(regulator, 'manage_entities')).toBe(false);
    expect(can(admin, 'list_entities')).toBe(true);
    expect(can(ent('inspector', 'IK', { trust_tier: 'kyb_verified' }), 'list_entities')).toBe(true);
    expect(can(inspector, 'list_entities')).toBe(false);
  });

  it('AI summary: oversight roles with view access', () => {
    expect(can(inspector, 'ai_inspector_summary', batch)).toBe(true);
    expect(can(otherInspector, 'ai_inspector_summary', batch)).toBe(false);
    expect(can(regulator, 'ai_inspector_summary', batch)).toBe(true);
    expect(can(exporter, 'ai_inspector_summary', batch)).toBe(false);
    expect(can(otherFarmer, 'ai_assistant', batch)).toBe(false);
    expect(can(otherFarmer, 'ai_assistant')).toBe(true);
  });
});
