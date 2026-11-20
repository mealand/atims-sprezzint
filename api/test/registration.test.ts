import { describe, it, expect } from 'vitest';
import {
  SELF_REGISTER_ROLES, parseRegistration, registrationColumns, registrationIdentifiers, type Registration,
} from '@atims/shared';

const account = { name: 'Amina Bello', email: 'Amina@Example.com ', password: 'correct-horse-battery' };

const validProfiles: Record<string, Record<string, unknown>> = {
  farmer: {
    phone: '0803 123 4567', state: 'Kano', lga: 'Dawakin Kudu',
    farm_gps: { lat: 11.84, lng: 8.6 }, farm_size_ha: 2.5, crops: ['sesame', 'soybean'],
  },
  aggregator: { cac_number: 'rc 123456', warehouse_location: { address: '12 Bompai Road, Kano', state: 'Kano' } },
  processor: { cac_number: 'BN1234567', warehouse_location: { address: 'Plot 4 Agbara Estate', state: 'Ogun', gps: { lat: 6.5, lng: 3.1 } } },
  exporter: { cac_number: 'RC7654321', nepc_number: 'NEPC/EXP/2024/0012', tin: '12345678-0001' },
  lab: { iso17025_accreditation_number: 'NiNAS-T-0123' },
  inspector: { organisation: 'NAQS', staff_id: 'NAQS/1234' },
  buyer: { company: 'Gulf Seeds Trading LLC', country: 'ae', import_licence: 'DXB-IMP-998' },
  regulator: { agency: 'NAFDAC', staff_id: 'NF-0042' },
};

const reg = (role: string, profile: Record<string, unknown> = validProfiles[role]) => ({ ...account, role, profile });

describe('registration: valid payload for every self-registrable role', () => {
  it('covers every role except admin', () => {
    expect([...SELF_REGISTER_ROLES].sort()).toEqual(Object.keys(validProfiles).sort());
    expect(SELF_REGISTER_ROLES).not.toContain('admin');
  });

  it.each(Object.keys(validProfiles))('%s parses', (role) => {
    const r = parseRegistration(reg(role));
    if (!r.ok) throw new Error(r.error);
    expect(r.data.role).toBe(role);
    expect(r.data.email).toBe('amina@example.com');
  });
});

describe('registration: admin cannot self-register', () => {
  it('is refused with a specific code', () => {
    const r = parseRegistration({ ...account, role: 'admin', profile: {} });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('ADMIN_NOT_SELF_REGISTRABLE');
  });

  it('unknown and missing roles are refused', () => {
    for (const role of ['superuser', '', undefined, 42]) {
      const r = parseRegistration({ ...account, role, profile: {} });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('UNKNOWN_ROLE');
    }
  });
});

describe('registration: account fields', () => {
  it('rejects a short password, a bad email and a missing name', () => {
    const r = parseRegistration({ ...reg('lab'), password: 'short', email: 'nope', name: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.map((i) => i.path).sort()).toEqual(['email', 'name', 'password']);
  });

  it('rejects unknown top-level and profile fields (no smuggling status or trust tier)', () => {
    expect(parseRegistration({ ...reg('lab'), trust_tier: 'kyb_verified' }).ok).toBe(false);
    expect(parseRegistration(reg('lab', { ...validProfiles.lab, status: 'verified' })).ok).toBe(false);
  });
});

/** Each case: role, profile override, the path that must be reported. */
const invalid: Array<[string, Record<string, unknown>, string]> = [
  ['farmer', { phone: undefined }, 'profile.phone'],
  ['farmer', { phone: '12345' }, 'profile.phone'],
  ['farmer', { state: 'Atlantis' }, 'profile.state'],
  ['farmer', { lga: undefined }, 'profile.lga'],
  ['farmer', { farm_gps: { lat: 51.5, lng: -0.12 } }, 'profile.farm_gps'],
  ['farmer', { farm_gps: { lat: 8.6, lng: 11.84 + 10 } }, 'profile.farm_gps'],
  ['farmer', { farm_size_ha: 0 }, 'profile.farm_size_ha'],
  ['farmer', { crops: [] }, 'profile.crops'],
  ['aggregator', { cac_number: 'XYZ' }, 'profile.cac_number'],
  ['aggregator', { warehouse_location: undefined }, 'profile.warehouse_location'],
  ['processor', { warehouse_location: { address: 'Plot 4 Agbara', state: 'Nowhere' } }, 'profile.warehouse_location.state'],
  ['exporter', { nepc_number: undefined }, 'profile.nepc_number'],
  ['exporter', { tin: '123' }, 'profile.tin'],
  ['exporter', { cac_number: undefined }, 'profile.cac_number'],
  ['lab', { iso17025_accreditation_number: '' }, 'profile.iso17025_accreditation_number'],
  ['inspector', { organisation: undefined }, 'profile.organisation'],
  ['inspector', { staff_id: undefined }, 'profile.staff_id'],
  ['buyer', { company: undefined }, 'profile.company'],
  ['buyer', { country: 'United Arab Emirates' }, 'profile.country'],
  ['regulator', { agency: undefined }, 'profile.agency'],
  ['regulator', { staff_id: undefined }, 'profile.staff_id'],
];

describe('registration: role-specific required fields', () => {
  it.each(invalid)('%s %o -> %s', (role, override, path) => {
    const r = parseRegistration(reg(role, { ...validProfiles[role], ...override }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.map((i) => i.path)).toContain(path);
  });

  it('optional fields really are optional', () => {
    expect(parseRegistration(reg('farmer', { ...validProfiles.farmer, cooperative: 'Kano Sesame Co-op' })).ok).toBe(true);
    expect(parseRegistration(reg('farmer', { ...validProfiles.farmer, cooperative: '' })).ok).toBe(true);
    const { import_licence: _omit, ...noLicence } = validProfiles.buyer;
    expect(parseRegistration(reg('buyer', noLicence)).ok).toBe(true);
  });

  it('a farmer profile is not accepted for an exporter', () => {
    expect(parseRegistration(reg('exporter', validProfiles.farmer)).ok).toBe(false);
  });
});

describe('registration: normalisation and identifiers', () => {
  const parse = (role: string, profile?: Record<string, unknown>) => {
    const r = parseRegistration(reg(role, profile));
    if (!r.ok) throw new Error(r.error);
    return r.data as Registration;
  };

  it('normalises phone, CAC and country', () => {
    const f = parse('farmer');
    if (f.role === 'farmer') expect(f.profile.phone).toBe('+2348031234567');
    const a = parse('aggregator');
    if (a.role === 'aggregator') expect(a.profile.cac_number).toBe('RC123456');
    expect(parse('aggregator', { ...validProfiles.aggregator, cac_number: '1234567' }).profile).toMatchObject({ cac_number: 'RC1234567' });
    const b = parse('buyer');
    if (b.role === 'buyer') expect(b.profile.country).toBe('AE');
  });

  it('derives role-scoped unique identifiers', () => {
    expect(registrationIdentifiers(parse('exporter'))).toEqual([
      { kind: 'cac:exporter', value: 'RC7654321' },
      { kind: 'nepc:exporter', value: 'NEPC/EXP/2024/0012' },
      { kind: 'tin:exporter', value: '12345678-0001' },
    ]);
    expect(registrationIdentifiers(parse('inspector'))).toEqual([{ kind: 'staff:inspector:naqs', value: 'NAQS/1234' }]);
    expect(registrationIdentifiers(parse('lab'))).toEqual([{ kind: 'iso17025:lab', value: 'NINAS-T-0123' }]);
    expect(registrationIdentifiers(parse('farmer'))).toEqual([]);
    const { import_licence: _omit, ...noLicence } = validProfiles.buyer;
    expect(registrationIdentifiers(parse('buyer', noLicence))).toEqual([]);
  });

  it('the same CAC spelled differently collides', () => {
    const a = registrationIdentifiers(parse('aggregator', { ...validProfiles.aggregator, cac_number: 'rc123456' }));
    const b = registrationIdentifiers(parse('aggregator', { ...validProfiles.aggregator, cac_number: 'RC 123 456' }));
    expect(a).toEqual(b);
  });

  it('maps entity columns', () => {
    expect(registrationColumns(parse('farmer'))).toEqual({ country: 'NG', state_province: 'Kano', phone: '+2348031234567' });
    expect(registrationColumns(parse('buyer'))).toEqual({ country: 'AE', state_province: null, phone: null });
  });
});
