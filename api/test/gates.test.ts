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
