/**
 * Data-driven stage-gate engine and event rules.
 *
 * A gate is a row in stage_requirements, scoped by corridor. This code never
 * knows a corridor's specifics: adding a corridor means adding rows, not
 * branching here. Everything in this file is pure, so it is unit-tested
 * without a database (api/test/gates.test.ts, api/test/eventRules.test.ts).
 */
import { STAGES, type Action, type Role, type Stage } from '@atims/shared';

export const DEFAULT_CORRIDOR = 'DEFAULT';

// ── Gate evaluation ───────────────────────────────────────

export interface EvidenceFact {
  evidence_type: string;
  issued_by_role: Role | string | null;
  meta?: unknown;
}

export interface EventFact {
  event_type: string;
  actor_id: string;
  actor_role?: Role | string | null;
}

export interface GateInput {
  to_stage: Stage;
  evidence_present: EvidenceFact[];
  /** Events already on the batch's chain (needed for required_events rules). */
  events_present?: EventFact[];
  /** The buyer named on the batch, for required events `by: 'batch_buyer'`. */
  buyer_id?: string | null;
}

export interface EvidenceRule {
  /** Issuer roles accepted for this type. Overrides the row-level from_roles. */
  roles?: string[];
  /** Every analyte must appear in the evidence meta.analytes (case-insensitive). */
  analytes?: string[];
}

export interface RequiredEvent {
  event_type: string;
  /** 'batch_buyer' = the buyer named on the batch; otherwise a role name. */
  by: string;
}

export interface StageRequirementRow {
  to_stage: string;
  corridor?: string;
  evidence_types: string[];
  /** Legacy, row-level: any of these roles satisfies every type without its own rule. */
  from_roles: string[];
  evidence_rules?: Record<string, EvidenceRule> | null;
  required_events?: RequiredEvent[] | null;
  description: string;
}

export interface ChecklistItem {
  kind: 'evidence' | 'event';
  type: string;
  /** Who must supply it: issuer roles, 'batch_buyer', or [] for anyone holding the batch. */
  supplied_by: string[];
  /** Analytes a lab report must cover. */
  analytes?: string[];
  satisfied: boolean;
  problem?: 'missing' | 'wrong_issuer' | 'missing_analytes' | 'no_buyer_named';
  missing_analytes?: string[];
}

export interface GateResult {
  pass: boolean;
  corridor?: string;
  to_stage?: string;
  missing_evidence: string[];
  /** Required types present, but only from a non-allowed issuer. */
  invalid_issuer: string[];
  /** Required types present from an allowed issuer, but not covering every required analyte. */
  incomplete_evidence: Array<{ evidence_type: string; missing_analytes: string[] }>;
  /** Required events not yet on the chain from the right party. */
  missing_events: string[];
  checklist: ChecklistItem[];
  description: string;
}

function analytesOf(meta: unknown): string[] {
  const a = (meta as { analytes?: unknown } | null | undefined)?.analytes;
  return Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string').map((x) => x.trim().toUpperCase()) : [];
}

export function evaluateGate(input: GateInput, req: StageRequirementRow | null): GateResult {
  const base = { corridor: req?.corridor, to_stage: input.to_stage };
  if (!req) {
    return {
      ...base, pass: true, missing_evidence: [], invalid_issuer: [], incomplete_evidence: [],
      missing_events: [], checklist: [], description: 'no gate defined: free advance',
    };
  }
  const rules = req.evidence_rules ?? {};
  const missing: string[] = [];
  const invalidIssuer: string[] = [];
  const incomplete: GateResult['incomplete_evidence'] = [];
  const checklist: ChecklistItem[] = [];

  for (const type of req.evidence_types) {
    const rule = rules[type] ?? {};
    const roles = rule.roles ?? req.from_roles ?? [];
    const analytes = (rule.analytes ?? []).map((a) => a.toUpperCase());
    const item: ChecklistItem = { kind: 'evidence', type, supplied_by: [...roles], satisfied: false };
    if (analytes.length) item.analytes = analytes;
    checklist.push(item);

    const matches = input.evidence_present.filter((e) => e.evidence_type === type);
    if (matches.length === 0) {
      missing.push(type);
      item.problem = 'missing';
      continue;
    }
    const fromAllowed = roles.length === 0
      ? matches
      : matches.filter((m) => m.issued_by_role !== null && roles.includes(String(m.issued_by_role)));
    if (fromAllowed.length === 0) {
      invalidIssuer.push(type);
      item.problem = 'wrong_issuer';
      continue;
    }
    if (analytes.length) {
      // One document must cover every analyte; report the closest one's gaps.
      let best: string[] | null = null;
      for (const m of fromAllowed) {
        const have = new Set(analytesOf(m.meta));
        const gaps = analytes.filter((a) => !have.has(a));
        if (!best || gaps.length < best.length) best = gaps;
      }
      if (best && best.length) {
        incomplete.push({ evidence_type: type, missing_analytes: best });
        item.problem = 'missing_analytes';
        item.missing_analytes = best;
        continue;
      }
    }
    item.satisfied = true;
  }

  const missingEvents: string[] = [];
  for (const re of req.required_events ?? []) {
    const item: ChecklistItem = { kind: 'event', type: re.event_type, supplied_by: [re.by], satisfied: false };
    checklist.push(item);
    const events = input.events_present ?? [];
    let ok: boolean;
    if (re.by === 'batch_buyer') {
      if (!input.buyer_id) {
        item.problem = 'no_buyer_named';
        missingEvents.push(re.event_type);
        continue;
      }
      ok = events.some((e) => e.event_type === re.event_type && e.actor_id === input.buyer_id);
    } else {
      ok = events.some((e) => e.event_type === re.event_type && e.actor_role === re.by);
    }
    if (ok) item.satisfied = true;
    else { item.problem = 'missing'; missingEvents.push(re.event_type); }
  }

  const pass = missing.length === 0 && invalidIssuer.length === 0 && incomplete.length === 0 && missingEvents.length === 0;
  return {
    ...base, pass, missing_evidence: missing, invalid_issuer: invalidIssuer,
    incomplete_evidence: incomplete, missing_events: missingEvents, checklist, description: req.description,
  };
}

// ── Stage order (F4) ──────────────────────────────────────

export function isStage(s: unknown): s is Stage {
  return typeof s === 'string' && (STAGES as readonly string[]).includes(s);
}

/** The only stage a batch may advance to from `current`, or null at the end of the line. */
export function nextStageOf(current: string): Stage | null {
  const i = (STAGES as readonly string[]).indexOf(current);
  if (i < 0 || i + 1 >= STAGES.length) return null;
  return STAGES[i + 1];
}

export type Rejection = { status: 400 | 403 | 409 | 422; code: string; error: string };

/** A stage advance must name a known stage, and exactly the next one. */
export function checkStageTransition(current: string, toStage: unknown): Rejection | null {
  if (!isStage(toStage)) {
    return { status: 400, code: 'UNKNOWN_STAGE', error: `unknown stage: ${String(toStage)}. Stages: ${STAGES.join(', ')}` };
  }
  const next = nextStageOf(current);
  if (!next) return { status: 409, code: 'FINAL_STAGE', error: `batch is already at ${current}, the final stage` };
  if (toStage !== next) {
    return { status: 409, code: 'STAGE_ORDER', error: `a batch at ${current} can only advance to ${next}, not ${toStage}` };
  }
  return null;
}

// ── Event types (F4) ──────────────────────────────────────

/** Written only by the server: genesis, gate rejections, handover and evidence registration. */
export const SERVER_ONLY_EVENT_TYPES = ['BATCH_CREATED', 'GATE_REJECTED', 'CUSTODY_TRANSFER', 'EVIDENCE_ADDED'] as const;

/** Client-signed event types, and the access action each needs. */
export const CLIENT_EVENT_ACTIONS = {
  STAGE_ADVANCE: 'append_event',
  NOTE: 'append_event',
  INSPECTION_SIGNOFF: 'sign_off',
  DELIVERY_CONFIRMED: 'confirm_delivery',
} as const satisfies Record<string, Action>;

export type ClientEventType = keyof typeof CLIENT_EVENT_ACTIONS;

export const SIGNOFF_DECISIONS = ['approved', 'rejected'] as const;

/**
 * Validate the shape of a client event before any access or gate check.
 * Returns the access action to check, or a rejection.
 */
export function checkClientEvent(
  ev: { event_type?: unknown; to_stage?: unknown; payload?: unknown },
  currentStage: string,
): { action: Action; eventType: ClientEventType } | Rejection {
  const t = ev.event_type;
  if (typeof t !== 'string' || !t) return { status: 400, code: 'EVENT_TYPE_REQUIRED', error: 'event_type required' };
  if ((SERVER_ONLY_EVENT_TYPES as readonly string[]).includes(t)) {
    const hint = t === 'CUSTODY_TRANSFER' ? ': custody moves only through the handover flow (POST /batches/:id/handover/start)' : '';
    return { status: 403, code: 'SERVER_ONLY_EVENT', error: `${t} events are recorded by the server only${hint}` };
  }
  if (!(t in CLIENT_EVENT_ACTIONS)) {
    return { status: 400, code: 'UNKNOWN_EVENT_TYPE', error: `unknown event_type ${t}. Allowed: ${Object.keys(CLIENT_EVENT_ACTIONS).join(', ')}` };
  }
  const eventType = t as ClientEventType;
  if (!ev.payload || typeof ev.payload !== 'object' || Array.isArray(ev.payload)) {
    return { status: 400, code: 'PAYLOAD_REQUIRED', error: 'payload must be a JSON object' };
  }
  const hasStage = ev.to_stage !== undefined && ev.to_stage !== null && ev.to_stage !== '';
  if (eventType === 'STAGE_ADVANCE') {
    if (!hasStage) return { status: 400, code: 'STAGE_REQUIRED', error: 'STAGE_ADVANCE needs to_stage' };
    const bad = checkStageTransition(currentStage, ev.to_stage);
    if (bad) return bad;
  } else if (hasStage) {
    return { status: 400, code: 'STAGE_NOT_ALLOWED', error: `only STAGE_ADVANCE may carry to_stage, not ${eventType}` };
  }
  if (eventType === 'INSPECTION_SIGNOFF') {
    const d = (ev.payload as { decision?: unknown }).decision;
    if (!(SIGNOFF_DECISIONS as readonly unknown[]).includes(d)) {
      return { status: 400, code: 'BAD_DECISION', error: `INSPECTION_SIGNOFF payload.decision must be ${SIGNOFF_DECISIONS.join(' or ')}` };
    }
  }
  return { action: CLIENT_EVENT_ACTIONS[eventType], eventType };
}

// ── Inspector sign-off queue ──────────────────────────────

/** Evidence types an inspector issues or signs off. */
export const INSPECTOR_EVIDENCE = ['PHYTOSANITARY_CERT', 'INSPECTION_REPORT'] as const;

export interface QueueFacts {
  current_stage: string;
  /** Corridor requirements for every stage of the batch's corridor. */
  requirements: StageRequirementRow[];
  evidence: Array<EvidenceFact & { created_at: string | Date }>;
  events: Array<EventFact & { created_at: string | Date; payload?: unknown }>;
}

export interface QueueStatus {
  /** An upcoming gate needs an inspector-issued document that is not on file yet. */
  awaiting_documents: Array<{ to_stage: string; evidence_type: string }>;
  /** Evidence added since the last inspector sign-off (or ever, if never signed off). */
  awaiting_signoff: boolean;
  evidence_since_signoff: number;
  last_signoff_at: string | null;
}

const ts = (v: string | Date) => new Date(v).valueOf();

/**
 * What an inspector still has to do on a batch. Pure: the route feeds it facts
 * for batches the inspector may sign off (access.ts `sign_off`).
 */
export function inspectorQueueStatus(f: QueueFacts): QueueStatus {
  const currentIdx = (STAGES as readonly string[]).indexOf(f.current_stage);
  const awaiting: QueueStatus['awaiting_documents'] = [];
  for (const r of f.requirements) {
    const idx = (STAGES as readonly string[]).indexOf(r.to_stage);
    if (idx <= currentIdx) continue; // gate already passed
    const rules = r.evidence_rules ?? {};
    for (const type of r.evidence_types) {
      const roles = rules[type]?.roles ?? r.from_roles ?? [];
      if (!roles.includes('inspector')) continue;
      const have = f.evidence.some((e) => e.evidence_type === type && e.issued_by_role === 'inspector');
      if (!have) awaiting.push({ to_stage: r.to_stage, evidence_type: type });
    }
  }
  const signoffs = f.events
    .filter((e) => e.event_type === 'INSPECTION_SIGNOFF' && (e.actor_role ?? 'inspector') === 'inspector')
    .map((e) => ts(e.created_at));
  const last = signoffs.length ? Math.max(...signoffs) : null;
  const since = f.evidence.filter((e) => last === null || ts(e.created_at) > last).length;
  const finished = f.current_stage === 'EXPORTED' || f.current_stage === 'DELIVERED';
  return {
    awaiting_documents: finished ? [] : awaiting,
    awaiting_signoff: !finished && since > 0,
    evidence_since_signoff: since,
    last_signoff_at: last === null ? null : new Date(last).toISOString(),
  };
}
