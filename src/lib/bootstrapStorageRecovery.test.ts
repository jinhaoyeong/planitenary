import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BOOTSTRAP_PROBE_BYTES,
  canWriteBootstrapProbe,
  reclaimOptionalStorageForBootstrap,
} from './bootstrapStorageRecovery';
import { LOCAL_STORAGE_SOFT_LIMIT_BYTES, measureAppStorage } from './safeLocalStorage';

/** Chrome's per-origin ceiling. The app cannot raise it; it can only stay under it. */
const ORIGIN_QUOTA_BYTES = 5_242_880;

const AUTH_KEY = 'sb-fymdyzxufkducfxfjdrr-auth-token';
const TRIP_A = 'itinerary-trip-82522acd-1111-2222-3333-444455556666';
const TRIP_B = 'itinerary-trip-b8479169-7777-8888-9999-aaaabbbbcccc';

const entryBytes = (key: string, value: string) => (key.length + value.length) * 2;

/**
 * A storage that enforces a real byte ceiling, so `setItem` throws the same
 * QuotaExceededError Chrome raises rather than a simulated one.
 */
const createQuotaStorage = () => {
  const values = new Map<string, string>();
  const used = () => [...values.entries()].reduce((sum, [k, v]) => sum + entryBytes(k, v), 0);

  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      const existing = values.has(key) ? entryBytes(key, values.get(key)!) : 0;
      if (used() - existing + entryBytes(key, value) > ORIGIN_QUOTA_BYTES) {
        const error = new Error('quota exceeded') as Error & { name: string };
        error.name = 'QuotaExceededError';
        throw error;
      }
      values.set(key, value);
    },
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  } satisfies Storage;

  const seed = (key: string, bytes: number) => {
    values.set(key, 'x'.repeat(Math.max(0, Math.floor(bytes / 2) - key.length)));
  };

  return { storage, values, used, seed };
};

/**
 * Byte-for-byte the technique `@supabase/auth-js` uses in `supportsLocalStorage`.
 * If this returns false the client swaps to an empty memory store and the
 * existing session is never read.
 */
const supabaseWritabilityProbe = (): boolean => {
  const randomKey = `lswt-${Math.random()}${Math.random()}`;
  try {
    globalThis.localStorage.setItem(randomKey, randomKey);
    globalThis.localStorage.removeItem(randomKey);
    return true;
  } catch {
    return false;
  }
};

/**
 * The production profile that failed, at its observed size: ~5,242,805 bytes of
 * a 5,242,880 ceiling. The margin matters — Supabase's probe is only ~164 bytes,
 * so a reproduction that leaves kilobytes free does not reproduce anything.
 */
const seedFrozenProfile = () => {
  const store = createQuotaStorage();
  store.seed(`${TRIP_A}-history`, 3_960_973);
  store.seed(`${TRIP_B}-history`, 530_883);
  store.seed(`${TRIP_A}-backup`, 153_815);
  store.seed(TRIP_A, 592_668);
  store.values.set(AUTH_KEY, 'a'.repeat(2_200));
  vi.stubGlobal('localStorage', store.storage);
  return store;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('bootstrap storage recovery', () => {
  it('reproduces the production failure: a full origin defeats Supabase session restore', () => {
    const store = seedFrozenProfile();

    expect(store.used()).toBeGreaterThan(5_000_000);
    // This is the exact reason the frozen profile appeared signed out.
    expect(supabaseWritabilityProbe()).toBe(false);
  });

  it('frees enough room for auth before the Supabase client would be constructed', () => {
    seedFrozenProfile();
    expect(canWriteBootstrapProbe()).toBe(false);

    const result = reclaimOptionalStorageForBootstrap();

    expect(result.ran).toBe(true);
    expect(result.writable).toBe(true);
    expect(result.freedBytes).toBeGreaterThan(3_000_000);
    // The decisive assertion: Supabase would now keep localStorage.
    expect(supabaseWritabilityProbe()).toBe(true);
  });

  it('never touches the auth token while reclaiming', () => {
    const store = seedFrozenProfile();
    const before = store.values.get(AUTH_KEY);

    const result = reclaimOptionalStorageForBootstrap();

    expect(store.values.get(AUTH_KEY)).toBe(before);
    expect(result.removed).not.toContain(AUTH_KEY);
    expect(result.removed.every((key) => key.endsWith('-history') || key.endsWith('-backup'))).toBe(true);
  });

  it('discards orphaned history but keeps the primary trip cache', () => {
    const store = seedFrozenProfile();

    reclaimOptionalStorageForBootstrap();

    expect(store.values.has(`${TRIP_A}-history`)).toBe(false);
    // The primary cache is not optional data and survives the emergency pass;
    // ownership-aware cleanup decides its fate later, once a session exists.
    expect(store.values.has(TRIP_A)).toBe(true);
  });

  it('brings Planitenary back inside its own soft budget', () => {
    seedFrozenProfile();

    const result = reclaimOptionalStorageForBootstrap();

    expect(result.afterBytes).toBeLessThanOrEqual(LOCAL_STORAGE_SOFT_LIMIT_BYTES);
    expect(measureAppStorage().totalBytes).toBeLessThanOrEqual(LOCAL_STORAGE_SOFT_LIMIT_BYTES);
  });

  it('stops as soon as the origin is healthy instead of wiping every backup', () => {
    const store = createQuotaStorage();
    // One oversized orphan; freeing it alone is enough.
    store.seed(`${TRIP_A}-history`, 4_000_000);
    store.seed(`${TRIP_B}-backup`, 20_000);
    store.values.set(AUTH_KEY, 'a'.repeat(2_200));
    vi.stubGlobal('localStorage', store.storage);

    const result = reclaimOptionalStorageForBootstrap();

    expect(result.removed).toEqual([`${TRIP_A}-history`]);
    expect(store.values.has(`${TRIP_B}-backup`)).toBe(true);
  });

  it('does nothing on a healthy origin', () => {
    const store = createQuotaStorage();
    store.seed(`${TRIP_A}-history`, 4_000);
    store.values.set(AUTH_KEY, 'a'.repeat(2_200));
    vi.stubGlobal('localStorage', store.storage);

    const result = reclaimOptionalStorageForBootstrap();

    expect(result.ran).toBe(false);
    expect(result.removed).toEqual([]);
    expect(store.values.has(`${TRIP_A}-history`)).toBe(true);
  });

  it('leaves no probe key behind', () => {
    const store = seedFrozenProfile();

    reclaimOptionalStorageForBootstrap();

    expect([...store.values.keys()].some((key) => key.includes('bootstrap-probe'))).toBe(false);
    expect(BOOTSTRAP_PROBE_BYTES).toBeGreaterThan(4_500);
  });
});
