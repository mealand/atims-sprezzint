import { describe, it, expect } from 'vitest';
import { STALE_REGISTRATION_MS, isStaleRegistration, type RegistrationFacts } from '../src/services/staleRegistration.js';

const NOW = new Date('2026-11-20T10:00:00Z');
const HOUR = 60 * 60 * 1000;

function facts(over: Partial<RegistrationFacts> = {}): RegistrationFacts {
  return {
    trust_tier: 'registered',
    status: 'pending',
    email: 'farmer@example.com',
    email_verified_at: null,
    kyb_verified_at: null,
    created_at: new Date(NOW.valueOf() - 25 * HOUR),
    batch_count: 0,
    event_count: 0,
    ...over,
  };
}

describe('isStaleRegistration', () => {
  it('uses a 24 hour window', () => {
    expect(STALE_REGISTRATION_MS).toBe(24 * HOUR);
  });

  it('is stale: unconfirmed, inactive, older than 24 hours', () => {
    expect(isStaleRegistration(facts(), NOW)).toBe(true);
    expect(isStaleRegistration(facts({ created_at: '2026-01-01T00:00:00Z' }), NOW)).toBe(true);
  });

  it('is not stale at or before exactly 24 hours', () => {
    expect(isStaleRegistration(facts({ created_at: new Date(NOW.valueOf() - 24 * HOUR) }), NOW)).toBe(false);
    expect(isStaleRegistration(facts({ created_at: new Date(NOW.valueOf() - 24 * HOUR + 1) }), NOW)).toBe(false);
    expect(isStaleRegistration(facts({ created_at: new Date(NOW.valueOf() - 24 * HOUR - 1) }), NOW)).toBe(true);
    expect(isStaleRegistration(facts({ created_at: new Date(NOW.valueOf() - HOUR) }), NOW)).toBe(false);
  });

  it('is never stale once the email is confirmed', () => {
    expect(isStaleRegistration(facts({ email_verified_at: '2026-11-18T09:00:00Z' }), NOW)).toBe(false);
  });

  it('is never stale above the registered tier or outside pending', () => {
    expect(isStaleRegistration(facts({ trust_tier: 'self_verified' }), NOW)).toBe(false);
    expect(isStaleRegistration(facts({ trust_tier: 'kyb_verified' }), NOW)).toBe(false);
    for (const status of ['verified', 'suspended', 'rejected']) {
      expect(isStaleRegistration(facts({ status }), NOW)).toBe(false);
    }
    expect(isStaleRegistration(facts({ kyb_verified_at: '2026-11-18T09:00:00Z' }), NOW)).toBe(false);
  });

  it('is never stale with any batch activity or ledger event', () => {
    expect(isStaleRegistration(facts({ batch_count: 1 }), NOW)).toBe(false);
    expect(isStaleRegistration(facts({ event_count: 1 }), NOW)).toBe(false);
    expect(isStaleRegistration(facts({ batch_count: 3, event_count: 7 }), NOW)).toBe(false);
  });

  it('leaves legacy pending accounts without an email to the admin', () => {
    expect(isStaleRegistration(facts({ email: null }), NOW)).toBe(false);
    expect(isStaleRegistration(facts({ email: '' }), NOW)).toBe(false);
  });

  it('fails closed on bad timestamps or clock skew', () => {
    expect(isStaleRegistration(facts({ created_at: 'not a date' }), NOW)).toBe(false);
    expect(isStaleRegistration(facts(), new Date('nope'))).toBe(false);
    expect(isStaleRegistration(facts({ created_at: new Date(NOW.valueOf() + 48 * HOUR) }), NOW)).toBe(false);
  });

  it('accepts a custom window', () => {
    expect(isStaleRegistration(facts({ created_at: new Date(NOW.valueOf() - 2 * HOUR) }), NOW, HOUR)).toBe(true);
  });
});
