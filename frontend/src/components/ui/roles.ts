import {
  Sprout, Warehouse, Factory, Ship, FlaskConical, ClipboardCheck, ShoppingBag, Landmark, ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { brand } from '../../lib/brand';

/**
 * Presentation metadata for every role, including `buyer` (added by T1).
 * Colours come from lib/brand.ts; buyer falls back to the blue arrow.
 */
export type RoleKey =
  | 'farmer' | 'aggregator' | 'processor' | 'exporter' | 'lab'
  | 'inspector' | 'buyer' | 'regulator' | 'admin';

export interface RoleMeta { label: string; color: string; icon: LucideIcon; blurb: string; selfRegister: boolean }

const colors = brand.roleColors as Record<string, string>;
const c = (r: RoleKey) => colors[r] ?? brand.colors.blue;

export const ROLE_META: Record<RoleKey, RoleMeta> = {
  farmer:     { label: 'Farmer',      color: c('farmer'),     icon: Sprout,         selfRegister: true,  blurb: 'Register farms, create batches and hand over produce.' },
  aggregator: { label: 'Aggregator',  color: c('aggregator'), icon: Warehouse,      selfRegister: true,  blurb: 'Receive batches from farmers and consolidate stock.' },
  processor:  { label: 'Processor',   color: c('processor'),  icon: Factory,        selfRegister: true,  blurb: 'Clean, sort and pack, with packhouse records.' },
  exporter:   { label: 'Exporter',    color: c('exporter'),   icon: Ship,           selfRegister: true,  blurb: 'Track the pipeline and file export documents.' },
  lab:        { label: 'Laboratory',  color: c('lab'),        icon: FlaskConical,   selfRegister: true,  blurb: 'Upload residue and aflatoxin test results.' },
  inspector:  { label: 'Inspector',   color: c('inspector'),  icon: ClipboardCheck, selfRegister: true,  blurb: 'Inspect batches and sign off phytosanitary checks.' },
  buyer:      { label: 'Buyer',       color: c('buyer'),      icon: ShoppingBag,    selfRegister: true,  blurb: 'Follow inbound batches and confirm delivery.' },
  regulator:  { label: 'Regulator',   color: c('regulator'),  icon: Landmark,       selfRegister: true,  blurb: 'Read-only oversight of corridors and batches.' },
  admin:      { label: 'Administrator', color: c('admin'),    icon: ShieldCheck,    selfRegister: false, blurb: 'Reviews business verification (KYB).' },
};

export function roleMeta(role: string | undefined | null): RoleMeta {
  return ROLE_META[(role ?? '') as RoleKey] ?? {
    label: role ? role[0].toUpperCase() + role.slice(1) : 'Guest',
    color: brand.colors.blue, icon: ShieldCheck, blurb: '', selfRegister: false,
  };
}

export const SELF_REGISTER_ROLES = (Object.keys(ROLE_META) as RoleKey[]).filter((r) => ROLE_META[r].selfRegister);
