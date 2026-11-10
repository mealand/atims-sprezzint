/**
 * Data-driven stage-gate engine.
 * A gate = row in stage_requirements. This code never knows specifics — adding
 * a corridor means adding rows, not branching here. 100% unit-tested.
 */
import type { Role, Stage } from '@atims/shared';

export interface GateInput {
  to_stage: Stage;
  evidence_present: Array<{ evidence_type: string; issued_by_role: Role | null }>;
}

export interface StageRequirementRow {
  to_stage: string;
  evidence_types: string[];
  from_roles: string[];
  description: string;
}

export interface GateResult {
  pass: boolean;
  missing_evidence: string[];
  invalid_issuer: string[];      // required types present but from a non-allowed issuer
  description: string;
}

export function evaluateGate(input: GateInput, req: StageRequirementRow | null): GateResult {
  if (!req) {
    return { pass: true, missing_evidence: [], invalid_issuer: [], description: 'no gate defined — free advance' };
  }
  const missing: string[] = [];
  const invalidIssuer: string[] = [];
  for (const type of req.evidence_types) {
    const matches = input.evidence_present.filter((e) => e.evidence_type === type);
    if (matches.length === 0) {
      missing.push(type);
      continue;
    }
    if (req.from_roles.length > 0) {
      const ok = matches.some((m) => m.issued_by_role !== null && (req.from_roles as string[]).includes(m.issued_by_role));
      if (!ok) invalidIssuer.push(type);
    }
  }
  const pass = missing.length === 0 && invalidIssuer.length === 0;
  return { pass, missing_evidence: missing, invalid_issuer: invalidIssuer, description: req.description };
}
