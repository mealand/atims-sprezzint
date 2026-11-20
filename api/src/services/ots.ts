/**
 * OpenTimestamps anchoring (M5, fixed in F10): free, Bitcoin-anchored proof of existence.
 * No API keys; uses the public OTS calendars over HTTPS. No external dependencies.
 *
 * Proof format (python-opentimestamps, `Timestamp.serialize`): a tree that starts at
 * a message (here the batch head digest). Each node is a list of items; every item
 * except the last is prefixed with 0xff. An item is either
 *   0x00 <8-byte attestation tag> <varbytes payload>     an attestation, or
 *   <op tag> [<varbytes arg>] <child timestamp>           an operation on the message.
 * varuint is little-endian base-128 (7 bits per byte, high bit = more follows);
 * varbytes is varuint(length) + bytes.
 *
 * Attestations used here:
 *   Bitcoin  05 88 96 0d 73 d7 19 01, payload = varuint(block height)
 *   Pending  83 df e3 0d 2e f9 0c 8e, payload = varbytes(calendar URI)
 * So a Bitcoin attestation on the wire is: 00, the 8-byte tag, a varuint payload
 * length, then the varuint block height.
 *
 * Lifecycle:
 *  - submit:  POST {calendar}/digest with the 32-byte digest. The calendar answers
 *    with a timestamp for that digest: ops (append a nonce, sha256, ...) ending in a
 *    *pending* attestation that names the calendar URI.
 *  - upgrade: for every pending attestation, compute its commitment (the message at
 *    that node, i.e. the digest after the ops above it) and GET
 *    {uri}/timestamp/{commitment hex}. 404 means not yet in a Bitcoin block (normal
 *    for hours). 200 returns the timestamp from that commitment to a Bitcoin
 *    attestation, which is merged into the proof at that node.
 *
 * Docs: https://opentimestamps.org. Pools: a/b.pool.opentimestamps.org
 */
import { createHash } from 'node:crypto';

export const OTS_CALENDARS = (process.env.OTS_CALENDARS ??
  'https://a.pool.opentimestamps.org,https://b.pool.opentimestamps.org,https://a.pool.eternitywall.com,https://ots.btc.catallaxy.com')
  .split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);

const SUBMIT_TIMEOUT_MS = 60_000; // public calendars are sometimes slow; be patient on submit
/** Per request on upgrade. Kept short so one unresponsive calendar cannot hold up a run. */
export const UPGRADE_TIMEOUT_MS = Number(process.env.OTS_UPGRADE_TIMEOUT_MS ?? 15_000);

/** The 8-byte tag of a Bitcoin block header attestation. */
export const BTC_ATTESTATION_TAG = Uint8Array.from([0x05, 0x88, 0x96, 0x0d, 0x73, 0xd7, 0x19, 0x01]);
/** Kept for older imports: the full 8-byte tag (earlier code matched only its first 5 bytes). */
export const BTC_ATTESTATION_MARKER = [...BTC_ATTESTATION_TAG];
/** The 8-byte tag of a pending (calendar) attestation. */
export const PENDING_ATTESTATION_TAG = Uint8Array.from([0x83, 0xdf, 0xe3, 0x0d, 0x2e, 0xf9, 0x0c, 0x8e]);

/** Detached .ots file header (python-opentimestamps DetachedTimestampFile.HEADER_MAGIC). */
const OTS_FILE_MAGIC = Uint8Array.from([
  0x00, 0x4f, 0x70, 0x65, 0x6e, 0x54, 0x69, 0x6d, 0x65, 0x73, 0x74, 0x61, 0x6d, 0x70, 0x73, 0x00,
  0x00, 0x50, 0x72, 0x6f, 0x6f, 0x66, 0x00, 0xbf, 0x89, 0xe2, 0xe8, 0x84, 0xe8, 0x92, 0x94,
]);

// Limits from python-opentimestamps.
const MAX_MSG_LENGTH = 4096;
const MAX_PAYLOAD_LENGTH = 8192;
const MAX_DEPTH = 256;

export function hexToBytes(hex: string): Uint8Array {
  if (!/^[a-f0-9]{64}$/.test(hex)) throw new Error('head digest must be 64 hex chars');
  return Uint8Array.from(hex.match(/../g)!.map((h) => parseInt(h, 16)));
}

export const bytesToHex = (b: Uint8Array) => Buffer.from(b).toString('hex');

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

// ── Wire primitives ───────────────────────────────────────

export class OtsParseError extends Error {}

class Reader {
  pos = 0;
  constructor(readonly buf: Uint8Array) {}
  byte(): number {
    if (this.pos >= this.buf.length) throw new OtsParseError('unexpected end of proof');
    return this.buf[this.pos++];
  }
  bytes(n: number): Uint8Array {
    if (this.pos + n > this.buf.length) throw new OtsParseError('unexpected end of proof');
    const out = this.buf.slice(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
  varuint(): number {
    let value = 0;
    let shift = 0;
    for (;;) {
      const b = this.byte();
      value += (b & 0x7f) * 2 ** shift;
      if (!(b & 0x80)) break;
      shift += 7;
      if (shift > 49) throw new OtsParseError('varuint too large');
    }
    return value;
  }
  varbytes(max: number): Uint8Array {
    const n = this.varuint();
    if (n > max) throw new OtsParseError(`varbytes length ${n} exceeds ${max}`);
    return this.bytes(n);
  }
  get done() { return this.pos >= this.buf.length; }
}

export function readVaruint(buf: Uint8Array, pos = 0): { value: number; next: number } {
  const r = new Reader(buf);
  r.pos = pos;
  const value = r.varuint();
  return { value, next: r.pos };
}

export function encodeVaruint(n: number): number[] {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error('varuint must be a non-negative integer');
  const out: number[] = [];
  do {
    let b = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) b |= 0x80;
    out.push(b);
  } while (n > 0);
  return out;
}

const encodeVarbytes = (b: Uint8Array) => [...encodeVaruint(b.length), ...b];

// ── Timestamp tree ────────────────────────────────────────

export interface OtsAttestation { tag: Uint8Array; payload: Uint8Array }
export interface OtsOp { tag: number; arg?: Uint8Array }
export interface OtsTimestamp {
  /** The message at this node, or null below an operation this code cannot compute (keccak256). */
  msg: Uint8Array | null;
  attestations: OtsAttestation[];
  ops: Array<{ op: OtsOp; stamp: OtsTimestamp }>;
}

const BINARY_OPS = new Set([0xf0 /* append */, 0xf1 /* prepend */]);
const UNARY_OPS = new Set([0xf2 /* reverse */, 0xf3 /* hexlify */, 0x02 /* sha1 */, 0x03 /* ripemd160 */, 0x08 /* sha256 */, 0x67 /* keccak256 */]);

function hashWith(alg: string, msg: Uint8Array): Uint8Array | null {
  try { return new Uint8Array(createHash(alg).update(msg).digest()); } catch { return null; }
}

/** Apply an operation to a message, or null when it cannot be computed here. */
export function applyOp(op: OtsOp, msg: Uint8Array): Uint8Array | null {
  switch (op.tag) {
    case 0xf0: return Uint8Array.from([...msg, ...op.arg!]);
    case 0xf1: return Uint8Array.from([...op.arg!, ...msg]);
    case 0xf2: return Uint8Array.from(msg).reverse();
    case 0xf3: return new TextEncoder().encode(bytesToHex(msg));
    case 0x02: return hashWith('sha1', msg);
    case 0x03: return hashWith('ripemd160', msg);
    case 0x08: return hashWith('sha256', msg);
    default: return null; // keccak256 is not in node:crypto; the subtree is still parsed.
  }
}

function readTimestamp(r: Reader, msg: Uint8Array | null, depth: number): OtsTimestamp {
  if (depth > MAX_DEPTH) throw new OtsParseError('proof nested too deeply');
  const node: OtsTimestamp = { msg, attestations: [], ops: [] };
  const item = (tag: number) => {
    if (tag === 0x00) {
      node.attestations.push({ tag: r.bytes(8), payload: r.varbytes(MAX_PAYLOAD_LENGTH) });
      return;
    }
    let op: OtsOp;
    if (BINARY_OPS.has(tag)) op = { tag, arg: r.varbytes(MAX_MSG_LENGTH) };
    else if (UNARY_OPS.has(tag)) op = { tag };
    else throw new OtsParseError(`unknown op tag 0x${tag.toString(16)}`);
    const next = msg ? applyOp(op, msg) : null;
    node.ops.push({ op, stamp: readTimestamp(r, next, depth + 1) });
  };
  let tag = r.byte();
  while (tag === 0xff) {
    item(r.byte());
    tag = r.byte();
  }
  item(tag);
  return node;
}

/**
 * Parse a calendar timestamp (no file header) or a detached .ots file.
 * `digest` is the message at the root; for a .ots file the file's own digest is used.
 */
export function parseTimestamp(bytes: Uint8Array, digest: Uint8Array | null = null): OtsTimestamp {
  const r = new Reader(bytes);
  let msg = digest;
  if (bytes.length >= OTS_FILE_MAGIC.length && sameBytes(bytes.slice(0, OTS_FILE_MAGIC.length), OTS_FILE_MAGIC)) {
    r.pos = OTS_FILE_MAGIC.length;
    if (r.varuint() !== 1) throw new OtsParseError('unsupported .ots major version');
    const hashOp = r.byte();
    const len = hashOp === 0x08 ? 32 : hashOp === 0x02 || hashOp === 0x03 ? 20 : hashOp === 0x67 ? 32 : -1;
    if (len < 0) throw new OtsParseError('unknown file hash op');
    msg = r.bytes(len);
  }
  const ts = readTimestamp(r, msg, 0);
  if (!r.done) throw new OtsParseError('trailing bytes after proof');
  return ts;
}

function writeTimestamp(ts: OtsTimestamp, out: number[]): void {
  const items: Array<() => void> = [
    ...ts.attestations.map((a) => () => { out.push(0x00, ...a.tag, ...encodeVarbytes(a.payload)); }),
    ...ts.ops.map(({ op, stamp }) => () => {
      out.push(op.tag);
      if (op.arg) out.push(...encodeVarbytes(op.arg));
      writeTimestamp(stamp, out);
    }),
  ];
  if (items.length === 0) throw new Error('cannot serialize an empty timestamp');
  items.forEach((write, i) => {
    if (i < items.length - 1) out.push(0xff);
    write();
  });
}

export function serializeTimestamp(ts: OtsTimestamp): Uint8Array {
  const out: number[] = [];
  writeTimestamp(ts, out);
  return Uint8Array.from(out);
}

/** A detached .ots file for `digestHex` (sha256), for the OpenTimestamps client: `ots verify -d <digest> file.ots`. */
export function toDetachedOtsFile(digestHex: string, timestamp: Uint8Array): Uint8Array {
  return Uint8Array.from([...OTS_FILE_MAGIC, ...encodeVaruint(1), 0x08, ...hexToBytes(digestHex), ...timestamp]);
}

const sameOp = (a: OtsOp, b: OtsOp) => a.tag === b.tag && (a.arg && b.arg ? sameBytes(a.arg, b.arg) : !a.arg && !b.arg);

/** Merge `src` into `dst` (both timestamps of the same message). */
export function mergeTimestamp(dst: OtsTimestamp, src: OtsTimestamp): void {
  for (const a of src.attestations) {
    if (!dst.attestations.some((d) => sameBytes(d.tag, a.tag) && sameBytes(d.payload, a.payload))) dst.attestations.push(a);
  }
  for (const s of src.ops) {
    const d = dst.ops.find((x) => sameOp(x.op, s.op));
    if (d) mergeTimestamp(d.stamp, s.stamp);
    else dst.ops.push(s);
  }
}

function* nodes(ts: OtsTimestamp): Generator<OtsTimestamp> {
  yield ts;
  for (const { stamp } of ts.ops) yield* nodes(stamp);
}

/** Every Bitcoin block height attested anywhere in the proof. */
export function bitcoinHeights(ts: OtsTimestamp): number[] {
  const out: number[] = [];
  for (const n of nodes(ts)) {
    for (const a of n.attestations) {
      if (!sameBytes(a.tag, BTC_ATTESTATION_TAG)) continue;
      try {
        const h = readVaruint(a.payload).value;
        if (h > 0 && h < 1e8) out.push(h);
      } catch { /* malformed payload: not an attestation we can use */ }
    }
  }
  return out;
}

export interface PendingAttestation { uri: string; commitment: Uint8Array; node: OtsTimestamp }

/** Pending calendar attestations whose commitment can be computed. */
export function pendingAttestations(ts: OtsTimestamp): PendingAttestation[] {
  const out: PendingAttestation[] = [];
  for (const n of nodes(ts)) {
    if (!n.msg) continue;
    for (const a of n.attestations) {
      if (!sameBytes(a.tag, PENDING_ATTESTATION_TAG)) continue;
      try {
        const r = new Reader(a.payload);
        const uri = new TextDecoder().decode(r.varbytes(1000));
        // Same character rule as python-opentimestamps PendingAttestation.
        if (/^[A-Za-z0-9.\-_/:]+$/.test(uri)) out.push({ uri, commitment: n.msg, node: n });
      } catch { /* malformed: skip */ }
    }
  }
  return out;
}

/**
 * Block height of the earliest Bitcoin attestation in a proof, or null.
 * Parses the proof tree; if the bytes are not a well-formed proof, falls back to
 * scanning for the full 8-byte tag followed by a varuint length and a varuint height.
 */
export function findBitcoinHeight(ots: Uint8Array): number | null {
  try {
    const hs = bitcoinHeights(parseTimestamp(ots));
    return hs.length ? Math.min(...hs) : null;
  } catch { /* fall through to the scan */ }
  const found: number[] = [];
  outer: for (let i = 0; i + BTC_ATTESTATION_TAG.length < ots.length; i++) {
    for (let j = 0; j < BTC_ATTESTATION_TAG.length; j++) if (ots[i + j] !== BTC_ATTESTATION_TAG[j]) continue outer;
    try {
      const len = readVaruint(ots, i + BTC_ATTESTATION_TAG.length);
      if (len.value < 1 || len.value > 9 || len.next + len.value > ots.length) continue;
      const h = readVaruint(ots.slice(len.next, len.next + len.value));
      if (h.next === len.value && h.value > 0 && h.value < 1e8) found.push(h.value);
    } catch { /* not a real attestation */ }
  }
  return found.length ? Math.min(...found) : null;
}

// ── Calendar allowlist ────────────────────────────────────

/**
 * Pending attestations name the calendar to ask. The URI comes from a remote
 * response, so only well-known calendars are contacted (as the reference client
 * does), plus the configured submit calendars and OTS_UPGRADE_HOSTS.
 */
const CALENDAR_SUFFIXES = ['.calendar.opentimestamps.org', '.calendar.eternitywall.com', '.calendar.catallaxy.com'];

function hostOf(u: string): string | null {
  try { return new URL(u).hostname.toLowerCase(); } catch { return null; }
}

export function isAllowedCalendar(uri: string): boolean {
  let u: URL;
  try { u = new URL(uri); } catch { return false; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return false;
  const host = u.hostname.toLowerCase();
  const extra = (process.env.OTS_UPGRADE_HOSTS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const configured = OTS_CALENDARS.map(hostOf).filter((h): h is string => Boolean(h));
  return configured.includes(host) || extra.includes(host) || CALENDAR_SUFFIXES.some((s) => host.endsWith(s));
}

// ── Network ───────────────────────────────────────────────

type FetchFn = typeof fetch;

/** Submit a head digest; returns base64 timestamp (pending) or null when all calendars fail. */
export async function submitDigest(headHashHex: string, fetchFn: FetchFn = fetch): Promise<string | null> {
  const digest = hexToBytes(headHashHex);
  for (const cal of OTS_CALENDARS) {
    try {
      const res = await fetchFn(`${cal}/digest`, {
        method: 'POST', body: digest as unknown as BodyInit, signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
      });
      if (!res.ok) continue;
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.length === 0) continue;
      parseTimestamp(buf, digest); // reject garbage before storing it
      return Buffer.from(buf).toString('base64');
    } catch { /* try next calendar */ }
  }
  return null;
}

/** Merge two base64 proofs of the same digest (a resubmission keeps the earlier calendar paths). */
export function mergeProofs(headHashHex: string, aB64: string | null, bB64: string): string {
  const digest = hexToBytes(headHashHex);
  const b = parseTimestamp(Buffer.from(bB64, 'base64'), digest);
  if (!aB64) return bB64;
  try {
    const a = parseTimestamp(Buffer.from(aB64, 'base64'), digest);
    mergeTimestamp(a, b);
    return Buffer.from(serializeTimestamp(a)).toString('base64');
  } catch {
    return bB64; // the old proof was unreadable: keep only the new one
  }
}

/**
 * Ask the calendars named in the proof's pending attestations for their Bitcoin
 * path. Returns the merged proof and the earliest block height once a Bitcoin
 * attestation is present, otherwise null (still pending; normal for hours).
 * Throws OtsParseError when the stored proof itself is unreadable.
 */
export async function upgradeDigest(
  headHashHex: string, currentProofB64: string,
  { fetchFn = fetch, timeoutMs = UPGRADE_TIMEOUT_MS }: { fetchFn?: FetchFn; timeoutMs?: number } = {},
): Promise<{ proof: string; height: number } | null> {
  const digest = hexToBytes(headHashHex);
  const root = parseTimestamp(Buffer.from(currentProofB64, 'base64'), digest);

  const already = bitcoinHeights(root);
  if (already.length) return { proof: currentProofB64, height: Math.min(...already) };

  for (const p of pendingAttestations(root)) {
    if (!isAllowedCalendar(p.uri)) continue;
    try {
      const res = await fetchFn(`${p.uri.replace(/\/$/, '')}/timestamp/${bytesToHex(p.commitment)}`, {
        headers: { accept: 'application/vnd.opentimestamps.v1' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) continue; // 404: not in a block yet
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.length === 0) continue;
      mergeTimestamp(p.node, parseTimestamp(buf, p.commitment));
    } catch { /* unreachable or malformed: ask again next run */ }
  }

  const heights = bitcoinHeights(root);
  if (!heights.length) return null;
  return { proof: Buffer.from(serializeTimestamp(root)).toString('base64'), height: Math.min(...heights) };
}
