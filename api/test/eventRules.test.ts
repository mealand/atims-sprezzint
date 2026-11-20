/** F4: stage order, unknown stages, server-only event types, and which access action each client event needs. */
import { describe, it, expect } from 'vitest';
import { STAGES } from '@atims/shared';
import {
  checkClientEvent, checkStageTransition, inspectorQueueStatus, nextStageOf, SERVER_ONLY_EVENT_TYPES,
} from '../src/services/gates.js';

const advance = (to_stage: unknown) => ({ event_type: 'STAGE_ADVANCE', to_stage, payload: {} });

describe('stage order', () => {
  it('next stage follows STAGES and ends at DELIVERED', () => {
    expect(nextStageOf('HARVESTED')).toBe('AGGREGATED');
    expect(nextStageOf('EXPORTED')).toBe('DELIVERED');
    expect(nextStageOf('DELIVERED')).toBeNull();
    expect(nextStageOf('NOPE')).toBeNull();
  });

  it('only the next stage is allowed', () => {
    for (let i = 0; i < STAGES.length - 1; i++) expect(checkStageTransition(STAGES[i], STAGES[i + 1])).toBeNull();
  });

  it('rejects skipping ahead, going back and staying put', () => {
    expect(checkStageTransition('HARVESTED', 'EXPORTED')).toMatchObject({ status: 409, code: 'STAGE_ORDER' });
    expect(checkStageTransition('PACKED', 'AGGREGATED')).toMatchObject({ code: 'STAGE_ORDER' });
    expect(checkStageTransition('PACKED', 'PACKED')).toMatchObject({ code: 'STAGE_ORDER' });
  });

  it('rejects unknown stages and advancing past the end', () => {
    expect(checkStageTransition('HARVESTED', 'TELEPORTED')).toMatchObject({ status: 400, code: 'UNKNOWN_STAGE' });
    expect(checkStageTransition('HARVESTED', 'packed')).toMatchObject({ code: 'UNKNOWN_STAGE' });
    expect(checkStageTransition('HARVESTED', 42)).toMatchObject({ code: 'UNKNOWN_STAGE' });
    expect(checkStageTransition('DELIVERED', 'DELIVERED')).toMatchObject({ code: 'FINAL_STAGE' });
  });
});

describe('client event types', () => {
  it.each([...SERVER_ONLY_EVENT_TYPES])('%s is server-only', (t) => {
    expect(checkClientEvent({ event_type: t, payload: { to_entity_id: 'x' } }, 'HARVESTED')).toMatchObject({ status: 403, code: 'SERVER_ONLY_EVENT' });
  });

  it('server-only list covers the four system types', () => {
    expect([...SERVER_ONLY_EVENT_TYPES].sort()).toEqual(['BATCH_CREATED', 'CUSTODY_TRANSFER', 'EVIDENCE_ADDED', 'GATE_REJECTED']);
  });

  it('CUSTODY_TRANSFER points at the handover flow', () => {
    const r = checkClientEvent({ event_type: 'CUSTODY_TRANSFER', payload: {} }, 'HARVESTED');
    expect('error' in r && r.error).toMatch(/handover/);
  });

  it('rejects unknown and missing event types', () => {
    expect(checkClientEvent({ event_type: 'MAGIC', payload: {} }, 'HARVESTED')).toMatchObject({ status: 400, code: 'UNKNOWN_EVENT_TYPE' });
    expect(checkClientEvent({ payload: {} }, 'HARVESTED')).toMatchObject({ code: 'EVENT_TYPE_REQUIRED' });
  });

  it('needs an object payload', () => {
    expect(checkClientEvent({ event_type: 'NOTE' }, 'HARVESTED')).toMatchObject({ code: 'PAYLOAD_REQUIRED' });
    expect(checkClientEvent({ event_type: 'NOTE', payload: [1] }, 'HARVESTED')).toMatchObject({ code: 'PAYLOAD_REQUIRED' });
  });

  it('maps each client event to its access action', () => {
    expect(checkClientEvent(advance('AGGREGATED'), 'HARVESTED')).toEqual({ action: 'append_event', eventType: 'STAGE_ADVANCE' });
    expect(checkClientEvent({ event_type: 'NOTE', payload: { text: 'hi' } }, 'HARVESTED')).toEqual({ action: 'append_event', eventType: 'NOTE' });
    expect(checkClientEvent({ event_type: 'INSPECTION_SIGNOFF', payload: { decision: 'approved' } }, 'PACKED')).toEqual({ action: 'sign_off', eventType: 'INSPECTION_SIGNOFF' });
    expect(checkClientEvent({ event_type: 'DELIVERY_CONFIRMED', payload: {} }, 'EXPORTED')).toEqual({ action: 'confirm_delivery', eventType: 'DELIVERY_CONFIRMED' });
  });

  it('STAGE_ADVANCE needs the next stage; other events may not carry a stage', () => {
    expect(checkClientEvent({ event_type: 'STAGE_ADVANCE', payload: {} }, 'HARVESTED')).toMatchObject({ code: 'STAGE_REQUIRED' });
    expect(checkClientEvent(advance('PACKED'), 'HARVESTED')).toMatchObject({ code: 'STAGE_ORDER' });
    expect(checkClientEvent(advance('LOST'), 'HARVESTED')).toMatchObject({ code: 'UNKNOWN_STAGE' });
    expect(checkClientEvent({ event_type: 'NOTE', to_stage: 'AGGREGATED', payload: {} }, 'HARVESTED')).toMatchObject({ code: 'STAGE_NOT_ALLOWED' });
    expect(checkClientEvent({ event_type: 'DELIVERY_CONFIRMED', to_stage: 'DELIVERED', payload: {} }, 'EXPORTED')).toMatchObject({ code: 'STAGE_NOT_ALLOWED' });
  });

  it('INSPECTION_SIGNOFF needs a decision', () => {
    expect(checkClientEvent({ event_type: 'INSPECTION_SIGNOFF', payload: {} }, 'PACKED')).toMatchObject({ code: 'BAD_DECISION' });
    expect(checkClientEvent({ event_type: 'INSPECTION_SIGNOFF', payload: { decision: 'maybe' } }, 'PACKED')).toMatchObject({ code: 'BAD_DECISION' });
    expect(checkClientEvent({ event_type: 'INSPECTION_SIGNOFF', payload: { decision: 'rejected' } }, 'PACKED')).not.toHaveProperty('status');
  });
});

describe('inspector sign-off queue status', () => {
  const requirements = [
    { to_stage: 'PACKED', evidence_types: ['PHOTO'], from_roles: [], description: '' },
    {
      to_stage: 'EXPORTED', evidence_types: ['PHYTOSANITARY_CERT', 'EXPORT_DECLARATION'], from_roles: [],
      evidence_rules: { PHYTOSANITARY_CERT: { roles: ['inspector'] }, EXPORT_DECLARATION: { roles: ['exporter'] } },
      description: '',
    },
  ];
  const t = (m: number) => new Date(Date.UTC(2026, 10, 20, 10, m)).toISOString();

  it('flags a missing inspector phyto for an upcoming gate', () => {
    const s = inspectorQueueStatus({ current_stage: 'PACKED', requirements, evidence: [], events: [] });
    expect(s.awaiting_documents).toEqual([{ to_stage: 'EXPORTED', evidence_type: 'PHYTOSANITARY_CERT' }]);
    expect(s.awaiting_signoff).toBe(false);
  });

  it('a holder-uploaded phyto does not clear the queue', () => {
    const s = inspectorQueueStatus({
      current_stage: 'PACKED', requirements,
      evidence: [{ evidence_type: 'PHYTOSANITARY_CERT', issued_by_role: 'exporter', created_at: t(1) }], events: [],
    });
    expect(s.awaiting_documents).toHaveLength(1);
  });

  it('evidence since the last sign-off needs a new sign-off', () => {
    const evidence = [
      { evidence_type: 'PHOTO', issued_by_role: 'processor', created_at: t(1) },
      { evidence_type: 'PHYTOSANITARY_CERT', issued_by_role: 'inspector', created_at: t(2) },
    ];
    const none = inspectorQueueStatus({ current_stage: 'AT_PORT', requirements, evidence, events: [] });
    expect(none).toMatchObject({ awaiting_documents: [], awaiting_signoff: true, evidence_since_signoff: 2, last_signoff_at: null });

    const signed = inspectorQueueStatus({
      current_stage: 'AT_PORT', requirements, evidence,
      events: [{ event_type: 'INSPECTION_SIGNOFF', actor_id: 'i', actor_role: 'inspector', created_at: t(3) }],
    });
    expect(signed).toMatchObject({ awaiting_signoff: false, evidence_since_signoff: 0, last_signoff_at: t(3) });

    const newer = inspectorQueueStatus({
      current_stage: 'AT_PORT', requirements, evidence: [...evidence, { evidence_type: 'PHOTO', issued_by_role: 'exporter', created_at: t(4) }],
      events: [{ event_type: 'INSPECTION_SIGNOFF', actor_id: 'i', actor_role: 'inspector', created_at: t(3) }],
    });
    expect(newer).toMatchObject({ awaiting_signoff: true, evidence_since_signoff: 1 });
  });

  it('exported and delivered batches leave the queue', () => {
    const s = inspectorQueueStatus({ current_stage: 'EXPORTED', requirements, evidence: [{ evidence_type: 'PHOTO', issued_by_role: 'x', created_at: t(1) }], events: [] });
    expect(s.awaiting_documents).toEqual([]);
    expect(s.awaiting_signoff).toBe(false);
  });
});
