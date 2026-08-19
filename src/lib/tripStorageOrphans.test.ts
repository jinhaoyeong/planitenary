import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseTripIdFromKey, pruneOrphanTripStorage } from './tripStorageOrphans';

const USER = 'f6c86c71-d9f7-4362-91cd-2364f62faf91';

const createStorage = () => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  } satisfies Storage);
  return values;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseTripIdFromKey', () => {
  it('reads every trip-scoped key shape', () => {
    expect(parseTripIdFromKey(`itinerary-${USER}-trip-a`, USER)).toBe('trip-a');
    expect(parseTripIdFromKey('itinerary-trip-a', USER)).toBe('trip-a');
    expect(parseTripIdFromKey('itinerary-demo-trip-a', USER)).toBe('trip-a');
    expect(parseTripIdFromKey('budget-trip-a', USER)).toBe('trip-a');
    expect(parseTripIdFromKey('budget-meta-trip-a', USER)).toBe('trip-a');
    expect(parseTripIdFromKey('photos-trip-a-history', USER)).toBe('trip-a');
    expect(parseTripIdFromKey('budget-trip-a-cleared', USER)).toBe('trip-a');
  });

  it('refuses to parse anything it does not own or cannot resolve exactly', () => {
    expect(parseTripIdFromKey('sb-project-auth-token', USER)).toBeNull();
    expect(parseTripIdFromKey('theme', USER)).toBeNull();
    expect(parseTripIdFromKey(`theme-${USER}`, USER)).toBeNull();
    expect(parseTripIdFromKey(`trip-currency-${USER}`, USER)).toBeNull();
    expect(parseTripIdFromKey(`trip-registry-${USER}`, USER)).toBeNull();
    // A cache key whose remainder is not a trip id is left strictly alone.
    expect(parseTripIdFromKey('itinerary-something-else', USER)).toBeNull();
  });
});

describe('pruneOrphanTripStorage', () => {
  it('keeps owned trips and removes only the deleted one', () => {
    const values = createStorage();
    values.set(`itinerary-${USER}-trip-a`, 'a');
    values.set('budget-trip-a', 'a-wallet');
    values.set(`itinerary-${USER}-trip-b`, 'b');
    values.set('itinerary-trip-c', 'c-legacy');
    values.set('itinerary-trip-c-history', 'c-history');
    values.set('budget-trip-c-backup', 'c-backup');

    const result = pruneOrphanTripStorage(USER, ['trip-a', 'trip-b']);

    expect(values.has(`itinerary-${USER}-trip-a`)).toBe(true);
    expect(values.has('budget-trip-a')).toBe(true);
    expect(values.has(`itinerary-${USER}-trip-b`)).toBe(true);
    expect(values.has('itinerary-trip-c')).toBe(false);
    expect(values.has('itinerary-trip-c-history')).toBe(false);
    expect(values.has('budget-trip-c-backup')).toBe(false);
    expect(result.removed).toHaveLength(3);
  });

  it('never touches auth, preference or third-party keys', () => {
    const values = createStorage();
    values.set('sb-fymdyzxufkducfxfjdrr-auth-token', 'session');
    values.set('theme', 'dark');
    values.set(`trip-currency-${USER}`, 'MYR');
    values.set(`trip-registry-${USER}`, '[]');
    values.set('some-other-app-state', 'x');
    values.set('itinerary-trip-gone', 'orphan');

    pruneOrphanTripStorage(USER, ['trip-a']);

    expect(values.has('sb-fymdyzxufkducfxfjdrr-auth-token')).toBe(true);
    expect(values.has('theme')).toBe(true);
    expect(values.has(`trip-currency-${USER}`)).toBe(true);
    expect(values.has(`trip-registry-${USER}`)).toBe(true);
    expect(values.has('some-other-app-state')).toBe(true);
    expect(values.has('itinerary-trip-gone')).toBe(false);
  });

  it('does nothing when the owned registry is empty', () => {
    const values = createStorage();
    values.set('itinerary-trip-a', 'a');

    // An empty registry may mean "the query failed", never "delete everything".
    const result = pruneOrphanTripStorage(USER, []);

    expect(result.removed).toEqual([]);
    expect(values.has('itinerary-trip-a')).toBe(true);
  });

  it('retains archived trips that the registry still lists', () => {
    const values = createStorage();
    values.set('itinerary-trip-archived', 'kept');

    pruneOrphanTripStorage(USER, ['trip-active', 'trip-archived']);

    expect(values.has('itinerary-trip-archived')).toBe(true);
  });
});
