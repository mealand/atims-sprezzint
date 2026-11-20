import { describe, it, expect } from 'vitest';
import { evaluateGate } from '../src/services/gates.js';

const req = {
  to_stage: 'EXPORTED',
  evidence_types: ['PHYTOSANITARY_CERT', 'EXPORT_DECLARATION'],
  from_roles: ['inspector', 'exporter'],
  description: 'export clearance',
};

describe('stage gates', () => {
  it('free advance when no gate defined', () => {
    const r = evaluateGate({ to_stage: 'DELIVERED', evidence_present: [] }, null);
    expect(r.pass).toBe(true);
  });

  it('fails when evidence missing', () => {
    const r = evaluateGate(
      { to_stage: 'EXPORTED', evidence_present: [{ evidence_type: 'PHYTOSANITARY_CERT', issued_by_role: 'inspector' }] },
      req,
    );
    expect(r.pass).toBe(false);
    expect(r.missing_evidence).toEqual(['EXPORT_DECLARATION']);
  });

  it('fails when issuer role not allowed', () => {
    const r = evaluateGate(
      {
        to_stage: 'EXPORTED',
        evidence_present: [
          { evidence_type: 'PHYTOSANITARY_CERT', issued_by_role: 'farmer' },
          { evidence_type: 'EXPORT_DECLARATION', issued_by_role: 'exporter' },
        ],
      },
      req,
    );
    expect(r.pass).toBe(false);
    expect(r.invalid_issuer).toEqual(['PHYTOSANITARY_CERT']);
  });

  it('passes with sufficient evidence from allowed roles', () => {
    const r = evaluateGate(
      {
        to_stage: 'EXPORTED',
        evidence_present: [
          { evidence_type: 'PHYTOSANITARY_CERT', issued_by_role: 'inspector' },
          { evidence_type: 'EXPORT_DECLARATION', issued_by_role: 'exporter' },
        ],
      },
      req,
    );
    expect(r.pass).toBe(true);
  });
});

// ── Corridor rules (rows mirror api/src/db/sql/005_corridors.sql) ──

const EU_PACKED = {
  corridor: 'NG-EU-SESAME', to_stage: 'PACKED',
  evidence_types: ['PHOTO', 'PACKHOUSE_LOG', 'LAB_REPORT'], from_roles: [],
  evidence_rules: { LAB_REPORT: { roles: ['lab'], analytes: ['MRL', 'AFLATOXIN', 'ETHYLENE_OXIDE'] } },
  required_events: [], description: 'EU packing',
};
const EXPORTED = {
  corridor: 'NG-EU-SESAME', to_stage: 'EXPORTED',
  evidence_types: ['PHYTOSANITARY_CERT', 'EXPORT_DECLARATION', 'CERTIFICATE_OF_ORIGIN'], from_roles: [],
  evidence_rules: { PHYTOSANITARY_CERT: { roles: ['inspector'] }, EXPORT_DECLARATION: { roles: ['exporter'] } },
  required_events: [], description: 'export',
};
const UAE_PACKED = {
  corridor: 'NG-AE-SESAME', to_stage: 'PACKED', evidence_types: ['PHOTO', 'PACKHOUSE_LOG'], from_roles: [],
  evidence_rules: {}, required_events: [], description: 'UAE packing',
};
const UAE_DELIVERED = {
  corridor: 'NG-AE-SESAME', to_stage: 'DELIVERED', evidence_types: [], from_roles: [], evidence_rules: {},
  required_events: [{ event_type: 'DELIVERY_CONFIRMED', by: 'batch_buyer' }], description: 'buyer confirms',
};

const ev = (evidence_type: string, issued_by_role: string, meta?: unknown) => ({ evidence_type, issued_by_role, meta });
const fullLab = ev('LAB_REPORT', 'lab', { analytes: ['MRL', 'aflatoxin', 'Ethylene_Oxide'] });

describe('EU corridor: PACKED', () => {
  it('passes with photo, packhouse log and a lab report covering MRL, aflatoxin and ethylene oxide', () => {
    const r = evaluateGate({ to_stage: 'PACKED', evidence_present: [ev('PHOTO', 'processor'), ev('PACKHOUSE_LOG', 'processor'), fullLab] }, EU_PACKED);
    expect(r.pass).toBe(true);
    expect(r.checklist.every((c) => c.satisfied)).toBe(true);
  });

  it('fails without a lab report and says a lab must supply it', () => {
    const r = evaluateGate({ to_stage: 'PACKED', evidence_present: [ev('PHOTO', 'processor'), ev('PACKHOUSE_LOG', 'processor')] }, EU_PACKED);
    expect(r.pass).toBe(false);
    expect(r.missing_evidence).toEqual(['LAB_REPORT']);
    expect(r.checklist.find((c) => c.type === 'LAB_REPORT')).toMatchObject({ satisfied: false, problem: 'missing', supplied_by: ['lab'] });
  });

  it('rejects a lab report uploaded by the holder instead of a lab', () => {
    const r = evaluateGate({
      to_stage: 'PACKED',
      evidence_present: [ev('PHOTO', 'processor'), ev('PACKHOUSE_LOG', 'processor'), ev('LAB_REPORT', 'processor', { analytes: ['MRL', 'AFLATOXIN', 'ETHYLENE_OXIDE'] })],
    }, EU_PACKED);
    expect(r.pass).toBe(false);
    expect(r.invalid_issuer).toEqual(['LAB_REPORT']);
  });

  it('rejects a lab report that does not cover every analyte, naming the gaps', () => {
    const r = evaluateGate({
      to_stage: 'PACKED',
      evidence_present: [ev('PHOTO', 'processor'), ev('PACKHOUSE_LOG', 'processor'), ev('LAB_REPORT', 'lab', { analytes: ['MRL'] })],
    }, EU_PACKED);
    expect(r.pass).toBe(false);
    expect(r.incomplete_evidence).toEqual([{ evidence_type: 'LAB_REPORT', missing_analytes: ['AFLATOXIN', 'ETHYLENE_OXIDE'] }]);
  });

  it('two partial reports do not add up to one complete report', () => {
    const r = evaluateGate({
      to_stage: 'PACKED',
      evidence_present: [ev('PHOTO', 'p'), ev('PACKHOUSE_LOG', 'p'), ev('LAB_REPORT', 'lab', { analytes: ['MRL', 'AFLATOXIN'] }), ev('LAB_REPORT', 'lab', { analytes: ['ETHYLENE_OXIDE'] })],
    }, EU_PACKED);
    expect(r.pass).toBe(false);
    expect(r.incomplete_evidence[0].missing_analytes).toEqual(['ETHYLENE_OXIDE']);
  });

  it('a lab report with no analytes listed fails', () => {
    const r = evaluateGate({ to_stage: 'PACKED', evidence_present: [ev('PHOTO', 'p'), ev('PACKHOUSE_LOG', 'p'), ev('LAB_REPORT', 'lab')] }, EU_PACKED);
    expect(r.pass).toBe(false);
  });
});

describe('UAE corridor: PACKED', () => {
  it('needs only photo and packhouse log', () => {
    expect(evaluateGate({ to_stage: 'PACKED', evidence_present: [ev('PHOTO', 'p'), ev('PACKHOUSE_LOG', 'p')] }, UAE_PACKED).pass).toBe(true);
    expect(evaluateGate({ to_stage: 'PACKED', evidence_present: [ev('PHOTO', 'p')] }, UAE_PACKED).missing_evidence).toEqual(['PACKHOUSE_LOG']);
  });
});

describe('EXPORTED (both corridors)', () => {
  const docs = [ev('PHYTOSANITARY_CERT', 'inspector'), ev('EXPORT_DECLARATION', 'exporter'), ev('CERTIFICATE_OF_ORIGIN', 'exporter')];

  it('passes with inspector phyto, exporter declaration and a certificate of origin', () => {
    expect(evaluateGate({ to_stage: 'EXPORTED', evidence_present: docs }, EXPORTED).pass).toBe(true);
  });

  it('phyto is inspector-only: an exporter-issued phyto does not count', () => {
    const r = evaluateGate({ to_stage: 'EXPORTED', evidence_present: [ev('PHYTOSANITARY_CERT', 'exporter'), ...docs.slice(1)] }, EXPORTED);
    expect(r.pass).toBe(false);
    expect(r.invalid_issuer).toEqual(['PHYTOSANITARY_CERT']);
  });

  it('export declaration must come from the exporter', () => {
    const r = evaluateGate({ to_stage: 'EXPORTED', evidence_present: [docs[0], ev('EXPORT_DECLARATION', 'inspector'), docs[2]] }, EXPORTED);
    expect(r.invalid_issuer).toEqual(['EXPORT_DECLARATION']);
  });

  it('certificate of origin is required from anyone', () => {
    const r = evaluateGate({ to_stage: 'EXPORTED', evidence_present: docs.slice(0, 2) }, EXPORTED);
    expect(r.missing_evidence).toEqual(['CERTIFICATE_OF_ORIGIN']);
  });

  it('legacy rows (from_roles any-of) still behave as before', () => {
    const r = evaluateGate({ to_stage: 'EXPORTED', evidence_present: [ev('PHYTOSANITARY_CERT', 'exporter'), ev('EXPORT_DECLARATION', 'exporter')] }, req);
    expect(r.pass).toBe(true);
  });
});

describe('UAE corridor: DELIVERED needs the named buyer to confirm', () => {
  const buyer = 'buyer-1';
  it('passes with DELIVERY_CONFIRMED from the batch buyer', () => {
    const r = evaluateGate({ to_stage: 'DELIVERED', evidence_present: [], buyer_id: buyer, events_present: [{ event_type: 'DELIVERY_CONFIRMED', actor_id: buyer, actor_role: 'buyer' }] }, UAE_DELIVERED);
    expect(r.pass).toBe(true);
  });

  it('a confirmation from anyone else does not count', () => {
    const r = evaluateGate({ to_stage: 'DELIVERED', evidence_present: [], buyer_id: buyer, events_present: [{ event_type: 'DELIVERY_CONFIRMED', actor_id: 'other-buyer', actor_role: 'buyer' }] }, UAE_DELIVERED);
    expect(r.pass).toBe(false);
    expect(r.missing_events).toEqual(['DELIVERY_CONFIRMED']);
  });

  it('fails without a confirmation, and says why when no buyer is named', () => {
    expect(evaluateGate({ to_stage: 'DELIVERED', evidence_present: [], buyer_id: buyer, events_present: [] }, UAE_DELIVERED).pass).toBe(false);
    const r = evaluateGate({ to_stage: 'DELIVERED', evidence_present: [], buyer_id: null, events_present: [] }, UAE_DELIVERED);
    expect(r.pass).toBe(false);
    expect(r.checklist[0]).toMatchObject({ kind: 'event', problem: 'no_buyer_named' });
  });

  it('a required event by role matches the actor role', () => {
    const row = { ...UAE_DELIVERED, required_events: [{ event_type: 'INSPECTION_SIGNOFF', by: 'inspector' }] };
    expect(evaluateGate({ to_stage: 'DELIVERED', evidence_present: [], events_present: [{ event_type: 'INSPECTION_SIGNOFF', actor_id: 'x', actor_role: 'inspector' }] }, row).pass).toBe(true);
    expect(evaluateGate({ to_stage: 'DELIVERED', evidence_present: [], events_present: [{ event_type: 'INSPECTION_SIGNOFF', actor_id: 'x', actor_role: 'farmer' }] }, row).pass).toBe(false);
  });
});
