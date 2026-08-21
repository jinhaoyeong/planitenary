/**
 * What a signature buys, and what it does not.
 *
 * The token exists so a browser can carry a place reference across turns
 * without ever holding the authority to name a place. These tests are mostly
 * the negative half of that: every way a device could try to turn a stored
 * string into authority it was not given.
 */
import { describe, expect, it } from 'vitest';
import {
  ASK_PLACE_REF_TTL_SECONDS,
  MAX_ASK_PLACE_TOKENS_PER_REQUEST,
  MIN_SIGNING_SECRET_CHARS,
  isUsableSigningSecret,
  recentPlaceAlias,
  signAskPlaceRef,
  verifyAskPlaceRef,
  type AskPlaceRef,
} from '../../supabase/functions/_shared/askPlaceToken';

const SECRET = 'a'.repeat(48);
const OTHER_SECRET = 'b'.repeat(48);

const ref = (over: Partial<AskPlaceRef> = {}): AskPlaceRef => ({
  userId: 'user-1',
  tripId: 'trip-tokyo',
  canonicalPlaceId: 'canon-gyoen',
  provider: 'osm',
  providerPlaceId: 'n1420780980',
  ...over,
});

const expected = { userId: 'user-1', tripId: 'trip-tokyo' };

/** Rebuild a token around an edited payload, keeping the original signature. */
const withTamperedPayload = (token: string, edit: (payload: Record<string, unknown>) => void): string => {
  const [version, body, signature] = token.split('.');
  const decoded = JSON.parse(atob(body.replace(/-/g, '+').replace(/_/g, '/')));
  edit(decoded);
  const reencoded = btoa(JSON.stringify(decoded))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${version}.${reencoded}.${signature}`;
};

describe('a token round-trips', () => {
  it('verifies for the user and trip it was issued to', async () => {
    const token = await signAskPlaceRef(SECRET, ref());
    expect(token).toBeDefined();

    const outcome = await verifyAskPlaceRef(SECRET, token, expected);
    expect(outcome).toMatchObject({ ok: true, ref: ref() });
  });

  /** Authenticity, not secrecy: the payload is readable and that is fine. */
  it('is opaque only in the sense that it cannot be forged', async () => {
    const token = await signAskPlaceRef(SECRET, ref()) as string;
    expect(token.startsWith('v1.')).toBe(true);
    expect(token.split('.')).toHaveLength(3);
  });

  it('expires roughly thirty days out', async () => {
    const now = new Date('2026-08-21T00:00:00.000Z');
    const token = await signAskPlaceRef(SECRET, ref(), now);
    const outcome = await verifyAskPlaceRef(SECRET, token, { ...expected, now });
    if (!outcome.ok) throw new Error('expected a valid token');
    expect(outcome.expiresAt).toBe(Math.floor(now.getTime() / 1_000) + ASK_PLACE_REF_TTL_SECONDS);
  });
});

describe('tampering', () => {
  /** A. The identity a follow-up would act on. */
  it('rejects an edited canonicalPlaceId', async () => {
    const token = await signAskPlaceRef(SECRET, ref()) as string;
    const forged = withTamperedPayload(token, (payload) => { payload.c = 'canon-somewhere-else'; });
    expect(await verifyAskPlaceRef(SECRET, forged, expected)).toEqual({ ok: false, reason: 'bad-signature' });
  });

  /** B. The id the link table is keyed by. */
  it('rejects an edited providerPlaceId', async () => {
    const token = await signAskPlaceRef(SECRET, ref()) as string;
    const forged = withTamperedPayload(token, (payload) => { payload.pp = 'n999'; });
    expect(await verifyAskPlaceRef(SECRET, forged, expected)).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('rejects an edited provider', async () => {
    const token = await signAskPlaceRef(SECRET, ref()) as string;
    const forged = withTamperedPayload(token, (payload) => { payload.pr = 'google'; });
    expect(await verifyAskPlaceRef(SECRET, forged, expected)).toEqual({ ok: false, reason: 'bad-signature' });
  });

  /** An extended lifetime is the most valuable edit, so it must be signed too. */
  it('rejects an extended expiry', async () => {
    const token = await signAskPlaceRef(SECRET, ref()) as string;
    const forged = withTamperedPayload(token, (payload) => { payload.exp = 4_102_444_800; });
    expect(await verifyAskPlaceRef(SECRET, forged, expected)).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await signAskPlaceRef(OTHER_SECRET, ref());
    expect(await verifyAskPlaceRef(SECRET, token, expected)).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it.each([
    ['not a token at all', 'hello'],
    ['a plausible shape', 'v1.abc.def'],
    ['an empty string', ''],
    ['the wrong version', 'v9.abc.def'],
  ])('rejects %s', async (_label, candidate) => {
    const outcome = await verifyAskPlaceRef(SECRET, candidate, expected);
    expect(outcome.ok).toBe(false);
  });

  it('rejects a non-string', async () => {
    expect(await verifyAskPlaceRef(SECRET, { c: 'canon-gyoen' }, expected))
      .toEqual({ ok: false, reason: 'malformed' });
  });

  /**
   * A signing secret that ever gains a second use must not let a token minted
   * for one purpose be replayed as another.
   */
  it('rejects a token whose purpose was changed', async () => {
    const token = await signAskPlaceRef(SECRET, ref()) as string;
    const forged = withTamperedPayload(token, (payload) => { payload.p = 'something-else'; });
    expect(await verifyAskPlaceRef(SECRET, forged, expected)).toEqual({ ok: false, reason: 'bad-signature' });
  });
});

describe('scope', () => {
  /** C. A real token, moved to another trip on the same account. */
  it('rejects a valid token presented for a different trip', async () => {
    const token = await signAskPlaceRef(SECRET, ref({ tripId: 'trip-tokyo' }));
    expect(await verifyAskPlaceRef(SECRET, token, { userId: 'user-1', tripId: 'trip-osaka' }))
      .toEqual({ ok: false, reason: 'wrong-trip' });
  });

  /** D. A real token, moved to another account. */
  it('rejects a valid token presented by a different user', async () => {
    const token = await signAskPlaceRef(SECRET, ref({ userId: 'user-1' }));
    expect(await verifyAskPlaceRef(SECRET, token, { userId: 'user-2', tripId: 'trip-tokyo' }))
      .toEqual({ ok: false, reason: 'wrong-user' });
  });

  /** E. Time is the one bound a device cannot argue with. */
  it('rejects an expired token', async () => {
    const issued = new Date('2026-01-01T00:00:00.000Z');
    const token = await signAskPlaceRef(SECRET, ref(), issued);
    const later = new Date(issued.getTime() + (ASK_PLACE_REF_TTL_SECONDS + 60) * 1_000);
    expect(await verifyAskPlaceRef(SECRET, token, { ...expected, now: later }))
      .toEqual({ ok: false, reason: 'expired' });
  });

  it('still accepts a token a minute before it expires', async () => {
    const issued = new Date('2026-01-01T00:00:00.000Z');
    const token = await signAskPlaceRef(SECRET, ref(), issued);
    const nearly = new Date(issued.getTime() + (ASK_PLACE_REF_TTL_SECONDS - 60) * 1_000);
    expect((await verifyAskPlaceRef(SECRET, token, { ...expected, now: nearly })).ok).toBe(true);
  });
});

describe('the signing secret', () => {
  /**
   * A short secret has a long secret's shape without its strength. Refusing to
   * sign with one beats discovering the difference by having tokens forged.
   */
  it('refuses to sign with a secret too short to be one', async () => {
    expect(isUsableSigningSecret(undefined)).toBe(false);
    expect(isUsableSigningSecret('short')).toBe(false);
    expect(isUsableSigningSecret('x'.repeat(MIN_SIGNING_SECRET_CHARS))).toBe(true);

    expect(await signAskPlaceRef('short', ref())).toBeUndefined();
    expect(await signAskPlaceRef(undefined, ref())).toBeUndefined();
  });

  /**
   * With no secret the feature is simply off — Ask keeps working and a
   * follow-up is researched afresh. It must never fail *open*.
   */
  it('verifies nothing when no secret is configured', async () => {
    const token = await signAskPlaceRef(SECRET, ref());
    expect(await verifyAskPlaceRef(undefined, token, expected))
      .toEqual({ ok: false, reason: 'no-secret' });
  });
});

describe('what may not be signed', () => {
  it('refuses a reference missing any part of its identity', async () => {
    for (const missing of ['userId', 'tripId', 'canonicalPlaceId', 'provider', 'providerPlaceId'] as const) {
      expect(await signAskPlaceRef(SECRET, ref({ [missing]: '' }))).toBeUndefined();
    }
  });

  /** A token is a reference, never a data channel. */
  it('refuses to sign an over-long field', async () => {
    expect(await signAskPlaceRef(SECRET, ref({ canonicalPlaceId: 'x'.repeat(5_000) }))).toBeUndefined();
  });
});

describe('aliases the model uses', () => {
  it('numbers from one, in the order cards were shown', () => {
    expect(recentPlaceAlias(0)).toBe('recent-place-1');
    expect(recentPlaceAlias(1)).toBe('recent-place-2');
  });

  it('is bounded by how many cards one answer can carry', () => {
    expect(MAX_ASK_PLACE_TOKENS_PER_REQUEST).toBe(5);
  });
});
