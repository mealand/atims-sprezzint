/** ATiMs shared domain types — single source of truth for api + frontend. */

export type Role = 'farmer' | 'aggregator' | 'processor' | 'exporter' | 'lab' | 'inspector' | 'regulator' | 'admin';
export type EntityStatus = 'pending' | 'verified' | 'suspended' | 'rejected';
export type BatchType = 'crop'; // livestock arrives in a later phase
export type ComplianceStatus = 'pending' | 'compliant' | 'non_compliant' | 'blocked';

export const STAGES = [
  'HARVESTED',
  'AGGREGATED',
  'PACKED',
  'IN_TRANSIT',
  'AT_PORT',
  'EXPORTED',
  'DELIVERED',
] as const;

export type Stage = (typeof STAGES)[number];

export type EventType =
  | 'BATCH_CREATED'
  | 'CUSTODY_TRANSFER'
  | 'EVIDENCE_ADDED'
  | 'INSPECTION_SIGNOFF'
  | 'STAGE_ADVANCE'
  | 'GATE_REJECTED'
  | 'NOTE';

export interface Entity {
  id: string;
  nexus_id: string;
  name: string;
  role: Role;
  status: EntityStatus;
  state?: string | null;
  country: string;
  created_at: string;
}

export interface Batch {
  id: string;
  trace_id: string;
  origin_entity_id: string;
  commodity: string;
  variety?: string | null;
  quantity: number;
  unit: string;
  production_date: string;
  origin_state?: string | null;
  current_stage: Stage;
  current_holder_id: string;
  compliance_status: ComplianceStatus;
  destination_country?: string | null;
  notes?: string | null;
  created_at: string;
}

export interface BatchEvent {
  id: string;
  batch_id: string;
  seq: number;
  event_type: EventType;
  actor_id: string;
  actor_pubkey: string;
  actor_sig: string;
  prev_hash: string | null;
  payload_hash: string;
  to_stage?: Stage | null;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface StageRequirement {
  id: number;
  to_stage: Stage;
  evidence_types: string[];   // e.g. ['PHYTOSANITARY_CERT', 'PACKHOUSE_LOG']
  from_roles: Role[];         // roles whose evidence counts (empty = any)
  description: string;
}

export const ROLE_LABELS: Record<Role, string> = {
  farmer: 'Farmer',
  aggregator: 'Aggregator',
  processor: 'Processor',
  exporter: 'Exporter',
  lab: 'Laboratory',
  inspector: 'Inspector',
  regulator: 'Regulator',
  admin: 'Administrator',
};

export const BATCH_CREATORS: Role[] = ['farmer'];
