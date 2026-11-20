/**
 * Role-specific registration schemas. One source of truth for the API
 * (POST /auth/register) and the frontend registration wizard.
 *
 * These are the "automatic checks" for the self_verified tier: format and
 * completeness here, uniqueness in the API against `registrationIdentifiers`.
 * Browser-safe: no node imports.
 */
import { z } from 'zod';
import { SELF_REGISTER_ROLES, type SelfRegisterRole } from './roles.js';

// ── Reference data ─────────────────────────────────────────

export const NIGERIAN_STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno',
  'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'FCT', 'Gombe', 'Imo',
  'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos', 'Nasarawa',
  'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba',
  'Yobe', 'Zamfara',
] as const;

/** Generous bounding box around Nigeria, used to catch swapped or mistyped farm coordinates. */
export const NIGERIA_BOUNDS = { minLat: 4, maxLat: 14, minLng: 2.5, maxLng: 15 } as const;

// ── Field helpers ──────────────────────────────────────────

const text = (min: number, max: number, label: string) =>
  z.string({ required_error: `${label} is required` }).trim()
    .min(min, `${label} must be at least ${min} characters`)
    .max(max, `${label} must be at most ${max} characters`);

const optionalText = (max: number, label: string) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    text(1, max, label).optional(),
  );

/** Upper-case and strip spaces, so "rc 123 456" and "RC123456" are the same number. */
const compactUpper = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, '').toUpperCase() : v);

/** Accepts +2348031234567, 2348031234567 or 08031234567; stores E.164. */
export const phoneSchema = z.preprocess((v) => {
  if (typeof v !== 'string') return v;
  const s = v.replace(/[\s\-().]/g, '');
  if (/^0\d{10}$/.test(s)) return `+234${s.slice(1)}`;
  if (/^234\d{10}$/.test(s)) return `+${s}`;
  return s;
}, z.string({ required_error: 'phone is required' }).regex(/^\+[1-9]\d{7,14}$/, 'phone must be a valid number, e.g. 08031234567 or +2348031234567'));

export const stateSchema = z.enum(NIGERIAN_STATES, {
  errorMap: () => ({ message: 'state must be a Nigerian state or FCT' }),
});

export const gpsSchema = z.object({
  lat: z.number({ required_error: 'latitude is required' }).min(-90).max(90),
  lng: z.number({ required_error: 'longitude is required' }).min(-180).max(180),
});

const nigeriaGpsSchema = gpsSchema.refine(
  (p) => p.lat >= NIGERIA_BOUNDS.minLat && p.lat <= NIGERIA_BOUNDS.maxLat
    && p.lng >= NIGERIA_BOUNDS.minLng && p.lng <= NIGERIA_BOUNDS.maxLng,
  { message: 'farm GPS must be inside Nigeria (check that latitude and longitude are not swapped)' },
);

/** CAC number: RC (company), BN (business name), IT (incorporated trustee) or LP/LLP, then digits. Bare digits are read as RC. */
export const cacNumberSchema = z.preprocess(
  (v) => {
    const s = compactUpper(v);
    return typeof s === 'string' && /^\d+$/.test(s) ? `RC${s}` : s;
  },
  z.string({ required_error: 'CAC registration number is required' })
    .regex(/^(RC|BN|IT|LP|LLP)\d{4,8}$/, 'CAC number must look like RC1234567 or BN1234567'),
);

/** FIRS TIN: 12345678-0001 (legacy) or a 10 to 13 digit TIN. */
export const tinSchema = z.preprocess(
  compactUpper,
  z.string({ required_error: 'TIN is required' })
    .regex(/^(\d{8}-\d{4}|\d{10,13})$/, 'TIN must look like 12345678-0001 or be 10 to 13 digits'),
);

const referenceNumber = (label: string) => z.preprocess(
  compactUpper,
  z.string({ required_error: `${label} is required` })
    .regex(/^[A-Z0-9][A-Z0-9/\-.]{2,39}$/, `${label} must be 3 to 40 letters, digits, "/", "-" or "."`),
);

const countrySchema = z.preprocess(
  compactUpper,
  z.string({ required_error: 'country is required' }).regex(/^[A-Z]{2}$/, 'country must be a two-letter ISO code, e.g. AE or NL'),
);

// ── Role profiles ──────────────────────────────────────────

export const farmerProfileSchema = z.object({
  phone: phoneSchema,
  state: stateSchema,
  lga: text(2, 80, 'LGA'),
  farm_gps: nigeriaGpsSchema,
  farm_size_ha: z.number({ required_error: 'farm size is required' }).positive('farm size must be more than 0').max(100_000),
  crops: z.array(text(2, 40, 'crop'), { required_error: 'at least one crop is required' })
    .min(1, 'at least one crop is required').max(20),
  cooperative: optionalText(120, 'cooperative'),
}).strict();

export const warehouseSchema = z.object({
  address: text(5, 200, 'warehouse address'),
  state: stateSchema,
  gps: gpsSchema.optional(),
}).strict();

export const handlerProfileSchema = z.object({
  cac_number: cacNumberSchema,
  warehouse_location: warehouseSchema,
}).strict();

export const exporterProfileSchema = z.object({
  cac_number: cacNumberSchema,
  nepc_number: referenceNumber('NEPC exporter number'),
  tin: tinSchema,
}).strict();

export const labProfileSchema = z.object({
  iso17025_accreditation_number: referenceNumber('ISO 17025 accreditation number'),
  accreditation_body: optionalText(120, 'accreditation body'),
}).strict();

export const inspectorProfileSchema = z.object({
  organisation: text(2, 120, 'organisation'),
  staff_id: referenceNumber('staff ID'),
}).strict();

export const buyerProfileSchema = z.object({
  company: text(2, 120, 'company'),
  country: countrySchema,
  import_licence: z.preprocess((v) => (v === '' ? undefined : v), referenceNumber('import licence').optional()),
}).strict();

export const regulatorProfileSchema = z.object({
  agency: text(2, 120, 'agency'),
  staff_id: referenceNumber('staff ID'),
}).strict();

export const PROFILE_SCHEMAS = {
  farmer: farmerProfileSchema,
  aggregator: handlerProfileSchema,
  processor: handlerProfileSchema,
  exporter: exporterProfileSchema,
  lab: labProfileSchema,
  inspector: inspectorProfileSchema,
  buyer: buyerProfileSchema,
  regulator: regulatorProfileSchema,
} as const satisfies Record<SelfRegisterRole, z.ZodTypeAny>;

// ── Account (common to all roles) ──────────────────────────

export const PASSWORD_MIN_LENGTH = 10;

export const accountSchema = z.object({
  name: text(2, 120, 'name'),
  email: z.string({ required_error: 'email is required' }).trim().toLowerCase().max(254).email('email must be a valid address'),
  password: z.string({ required_error: 'password is required' })
    .min(PASSWORD_MIN_LENGTH, `password must be at least ${PASSWORD_MIN_LENGTH} characters`).max(200),
});

const withRole = <R extends SelfRegisterRole>(role: R) =>
  accountSchema.extend({ role: z.literal(role), profile: PROFILE_SCHEMAS[role] as (typeof PROFILE_SCHEMAS)[R] }).strict();

/** Full registration payload, discriminated on role. `admin` is deliberately absent. */
export const registrationSchema = z.discriminatedUnion('role', [
  withRole('farmer'),
  withRole('aggregator'),
  withRole('processor'),
  withRole('exporter'),
  withRole('lab'),
  withRole('inspector'),
  withRole('buyer'),
  withRole('regulator'),
]);

export type Registration = z.infer<typeof registrationSchema>;
export type RegistrationProfile<R extends SelfRegisterRole> = z.infer<(typeof PROFILE_SCHEMAS)[R]>;

export type RegistrationResult =
  | { ok: true; data: Registration }
  | { ok: false; code: 'ADMIN_NOT_SELF_REGISTRABLE' | 'UNKNOWN_ROLE' | 'INVALID'; error: string; issues: Array<{ path: string; message: string }> };

/** Validate a registration body, with clear errors for admin and unknown roles. */
export function parseRegistration(input: unknown): RegistrationResult {
  const role = (input as { role?: unknown } | null)?.role;
  if (role === 'admin') {
    return { ok: false, code: 'ADMIN_NOT_SELF_REGISTRABLE', error: 'admin accounts cannot be self-registered', issues: [] };
  }
  if (typeof role !== 'string' || !(SELF_REGISTER_ROLES as string[]).includes(role)) {
    return {
      ok: false, code: 'UNKNOWN_ROLE',
      error: `role must be one of: ${SELF_REGISTER_ROLES.join(', ')}`,
      issues: [{ path: 'role', message: 'unknown role' }],
    };
  }
  const r = registrationSchema.safeParse(input);
  if (r.success) return { ok: true, data: r.data };
  const issues = r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
  return { ok: false, code: 'INVALID', error: issues.map((i) => `${i.path}: ${i.message}`).join('; '), issues };
}

/** Normalise free text for identifier keys: lower case, single spaces. */
const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Identifiers that must be unique across accounts (the "uniqueness" automatic
 * check). Kinds are scoped by role, so one company may hold, say, both a
 * processor and an exporter account under the same CAC number.
 */
export function registrationIdentifiers(reg: Registration): Array<{ kind: string; value: string }> {
  const ids: Array<{ kind: string; value: string }> = [];
  switch (reg.role) {
    case 'aggregator':
    case 'processor':
      ids.push({ kind: `cac:${reg.role}`, value: reg.profile.cac_number });
      break;
    case 'exporter':
      ids.push({ kind: 'cac:exporter', value: reg.profile.cac_number });
      ids.push({ kind: 'nepc:exporter', value: reg.profile.nepc_number });
      ids.push({ kind: 'tin:exporter', value: reg.profile.tin });
      break;
    case 'lab':
      ids.push({ kind: 'iso17025:lab', value: reg.profile.iso17025_accreditation_number });
      break;
    case 'inspector':
      ids.push({ kind: `staff:inspector:${key(reg.profile.organisation)}`, value: reg.profile.staff_id });
      break;
    case 'regulator':
      ids.push({ kind: `staff:regulator:${key(reg.profile.agency)}`, value: reg.profile.staff_id });
      break;
    case 'buyer':
      if (reg.profile.import_licence) {
        ids.push({ kind: `import_licence:${reg.profile.country}`, value: reg.profile.import_licence });
      }
      break;
    case 'farmer':
      break;
  }
  return ids;
}

/** Entity-level columns derived from a registration (the rest lives in `profile`). */
export function registrationColumns(reg: Registration): { country: string; state_province: string | null; phone: string | null } {
  switch (reg.role) {
    case 'farmer':
      return { country: 'NG', state_province: reg.profile.state, phone: reg.profile.phone };
    case 'aggregator':
    case 'processor':
      return { country: 'NG', state_province: reg.profile.warehouse_location.state, phone: null };
    case 'buyer':
      return { country: reg.profile.country, state_province: null, phone: null };
    default:
      return { country: 'NG', state_province: null, phone: null };
  }
}
