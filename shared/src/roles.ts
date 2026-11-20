/**
 * Roles, trust tiers and access actions: the shared vocabulary of the entity
 * model. The permission rules themselves live in api/src/services/access.ts;
 * docs/ENTITY-MODEL.md is the human-readable matrix.
 */

export const ROLES = [
  'farmer',
  'aggregator',
  'processor',
  'exporter',
  'lab',
  'inspector',
  'buyer',
  'regulator',
  'admin',
] as const;

export type Role = (typeof ROLES)[number];

/** Every role except admin. Admins are created only by bootstrap or by another admin. */
export const SELF_REGISTER_ROLES = ROLES.filter((r) => r !== 'admin') as Exclude<Role, 'admin'>[];
export type SelfRegisterRole = Exclude<Role, 'admin'>;

/**
 * Trust tiers, lowest to highest.
 * - registered:    account exists, email not yet confirmed. Cannot log in.
 * - self_verified: email code confirmed and automatic checks passed. Can log in and act. No admin step.
 * - kyb_verified:  documents reviewed by an admin (or by a KYB-verified inspector, for farmers).
 */
export const TRUST_TIERS = ['registered', 'self_verified', 'kyb_verified'] as const;
export type TrustTier = (typeof TRUST_TIERS)[number];

export const TRUST_TIER_LABELS: Record<TrustTier, string> = {
  registered: 'Registered',
  self_verified: 'Self-verified',
  kyb_verified: 'KYB verified',
};

export const ACTIONS = [
  'create_batch',
  'view_batch',
  'append_event',
  'add_evidence',
  'view_evidence_file',
  'start_handover',
  'accept_handover',
  'sign_off',
  'confirm_delivery',
  'assign_party',
  'review_kyb',
  'list_entities',
  'manage_entities',
  'ai_assistant',
  'ai_inspector_summary',
] as const;
export type Action = (typeof ACTIONS)[number];

/** Roles that may create a batch (the origin of the chain). */
export const BATCH_CREATORS: Role[] = ['farmer'];

/** Roles that may take physical custody of a batch through a handover. */
export const CUSTODY_ROLES: Role[] = ['farmer', 'aggregator', 'processor', 'exporter', 'buyer'];

/** Roles that can be assigned to a batch to contribute reports without holding custody. */
export const ASSIGNABLE_ROLES: Role[] = ['lab', 'inspector'];

/**
 * Evidence types a lab or inspector may add as its own report on a batch it
 * does not hold. The current holder may add any type; the gate engine still
 * checks the server-derived issuer role.
 */
export const REPORT_EVIDENCE_TYPES: Partial<Record<Role, readonly string[]>> = {
  lab: ['LAB_REPORT', 'LAB_RESULT'],
  inspector: ['PHYTOSANITARY_CERT', 'INSPECTION_REPORT'],
};

/** Two-letter prefix used in Nexus IDs (NX-<prefix>-<hex>). */
export const NEXUS_PREFIX: Record<Role, string> = {
  farmer: 'FA',
  aggregator: 'AG',
  processor: 'PR',
  exporter: 'EX',
  lab: 'LA',
  inspector: 'IN',
  buyer: 'BU',
  regulator: 'RE',
  admin: 'AD',
};
