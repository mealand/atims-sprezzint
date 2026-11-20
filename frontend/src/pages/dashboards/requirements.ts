/**
 * Client-side mirror of the stage gates, used only to show checklists ("what
 * is still missing, and who supplies it"). The server's gate engine
 * (api/src/services/gates.ts + stage_requirements) is the authority: if the
 * two disagree, the server wins and the batch page shows its gate report.
 *
 * DEFAULT mirrors the seed rows in api/src/db/sql/000_init.sql. The two
 * corridors follow docs/MVP-PLAN.md (task T4); stages a corridor does not
 * override fall back to DEFAULT.
 */
import { STAGES, type Stage } from '@atims/shared';

export type CorridorId = 'DEFAULT' | 'NG-EU-SESAME' | 'NG-AE-SESAME';

export interface Requirement {
  /** Evidence type, or an event type when `kind` is 'event'. */
  type: string;
  kind?: 'evidence' | 'event';
  /** Issuer roles accepted by the gate; empty or missing means any. */
  from?: string[];
}

export const CORRIDORS: Record<CorridorId, { label: string; short: string; destination: string }> = {
  'NG-EU-SESAME': { label: 'Nigeria to EU, sesame', short: 'NG to EU', destination: 'European Union' },
  'NG-AE-SESAME': { label: 'Nigeria to UAE, sesame', short: 'NG to UAE', destination: 'United Arab Emirates' },
  DEFAULT: { label: 'Default rules', short: 'Default', destination: 'Any' },
};

const DEFAULT_RULES: Partial<Record<Stage, Requirement[]>> = {
  AGGREGATED: [],
  PACKED: [{ type: 'PHOTO' }, { type: 'PACKHOUSE_LOG' }],
  IN_TRANSIT: [{ type: 'TRANSPORT_DOC' }],
  AT_PORT: [],
  EXPORTED: [
    { type: 'PHYTOSANITARY_CERT', from: ['inspector', 'exporter'] },
    { type: 'EXPORT_DECLARATION', from: ['inspector', 'exporter'] },
  ],
  DELIVERED: [{ type: 'DELIVERY_NOTE' }],
};

const EXPORT_DOCS: Requirement[] = [
  { type: 'PHYTOSANITARY_CERT', from: ['inspector'] },
  { type: 'EXPORT_DECLARATION', from: ['exporter'] },
  { type: 'CERTIFICATE_OF_ORIGIN' },
];

const RULES: Record<CorridorId, Partial<Record<Stage, Requirement[]>>> = {
  DEFAULT: DEFAULT_RULES,
  'NG-EU-SESAME': {
    PACKED: [{ type: 'PHOTO' }, { type: 'PACKHOUSE_LOG' }, { type: 'LAB_REPORT', from: ['lab'] }],
    EXPORTED: EXPORT_DOCS,
  },
  'NG-AE-SESAME': {
    PACKED: [{ type: 'PHOTO' }, { type: 'PACKHOUSE_LOG' }],
    EXPORTED: EXPORT_DOCS,
    DELIVERED: [{ type: 'DELIVERY_CONFIRMED', kind: 'event', from: ['buyer'] }],
  },
};

/** Human label and the role that normally supplies each document. */
export const DOC_META: Record<string, { label: string; supplier: string }> = {
  PHOTO: { label: 'Photos', supplier: 'holder' },
  PACKHOUSE_LOG: { label: 'Packhouse log', supplier: 'processor' },
  LAB_REPORT: { label: 'Lab report (MRL, aflatoxin, ethylene oxide)', supplier: 'lab' },
  LAB_RESULT: { label: 'Lab result', supplier: 'lab' },
  TRANSPORT_DOC: { label: 'Transport manifest', supplier: 'holder' },
  PHYTOSANITARY_CERT: { label: 'Phytosanitary certificate', supplier: 'inspector' },
  INSPECTION_REPORT: { label: 'Inspection report', supplier: 'inspector' },
  EXPORT_DECLARATION: { label: 'Export declaration', supplier: 'exporter' },
  CERTIFICATE_OF_ORIGIN: { label: 'Certificate of origin', supplier: 'exporter' },
  DELIVERY_NOTE: { label: 'Delivery note', supplier: 'holder' },
  DELIVERY_CONFIRMED: { label: 'Buyer confirms delivery', supplier: 'buyer' },
};

export const docLabel = (t: string) => DOC_META[t]?.label ?? t.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

export function corridorOf(batch: { corridor?: string | null }): CorridorId {
  const c = batch.corridor;
  return c === 'NG-EU-SESAME' || c === 'NG-AE-SESAME' ? c : 'DEFAULT';
}

export function requirementsFor(corridor: CorridorId, stage: Stage): Requirement[] {
  return RULES[corridor][stage] ?? DEFAULT_RULES[stage] ?? [];
}

export function nextStage(stage: string): Stage | null {
  const i = STAGES.indexOf(stage as Stage);
  return i >= 0 && i < STAGES.length - 1 ? STAGES[i + 1] : null;
}

export interface ChecklistItem extends Requirement {
  label: string;
  supplier: string;
  done: boolean;
  /** Present, but from an issuer the gate does not accept. */
  wrongIssuer: boolean;
}

export interface EvidenceLite { evidence_type: string; issued_by_role?: string | null; issuer_role?: string | null }
export interface EventLite { event_type: string; actor_role?: string | null }

/** Evaluate a stage's requirements against what is on file (same rule as the server gate). */
export function checklist(
  corridor: CorridorId, stage: Stage, evidence: EvidenceLite[], events: EventLite[] = [],
): ChecklistItem[] {
  return requirementsFor(corridor, stage).map((r) => {
    const meta = DOC_META[r.type];
    const supplier = r.from?.length === 1 ? r.from[0] : meta?.supplier ?? 'holder';
    if (r.kind === 'event') {
      const done = events.some((e) => e.event_type === r.type);
      return { ...r, label: docLabel(r.type), supplier, done, wrongIssuer: false };
    }
    const matches = evidence.filter((e) => e.evidence_type === r.type);
    const okIssuer = matches.some((m) => !r.from?.length || r.from.includes(String(m.issued_by_role ?? m.issuer_role ?? '')));
    return { ...r, label: docLabel(r.type), supplier, done: okIssuer, wrongIssuer: matches.length > 0 && !okIssuer };
  });
}
