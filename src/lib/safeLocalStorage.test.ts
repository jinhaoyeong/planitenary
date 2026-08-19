import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LOCAL_STORAGE_SOFT_LIMIT_BYTES,
  listAppOwnedKeys,
  measureAppStorage,
  pruneOptionalStorage,
  safeGetItem,
  safeRemoveItem,
  safeSetItem,
  safeSetItemWithBudget,
} from './safeLocalStorage';

const createStorage = (options?: { rejectAll?: boolean }) => {
  const values = new Map<string, string>();
  return {
    values,
    storage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (options?.rejectAll) {
          const error = new Error('quota') as Error & { name: string };
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
    } satisfies Storage,
  };
};

const useStorage = (storage: Storage) => {
  vi.stubGlobal('localStorage', storage);
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('safeLocalStorage', () => {
  it('reports a structured failure instead of throwing when the origin is full', () => {
    const { storage } = createStorage({ rejectAll: true });
    useStorage(storage);

    expect(() => safeSetItem('itinerary-trip-1', 'x')).not.toThrow();
    expect(safeSetItem('itinerary-trip-1', 'x')).toEqual({ ok: false, reason: 'quota' });
  });

  it('survives a storage accessor that throws on access', () => {
    vi.stubGlobal('localStorage', {
      get getItem(): never {
        throw new Error('blocked');
      },
    });

    expect(() => safeGetItem('itinerary-trip-1')).not.toThrow();
    expect(safeGetItem('itinerary-trip-1')).toBeNull();
    expect(safeSetItem('itinerary-trip-1', 'x').ok).toBe(false);
    expect(safeRemoveItem('itinerary-trip-1')).toBe(false);
  });

  it('only ever sees Planitenary-owned keys', () => {
    const { storage, values } = createStorage();
    useStorage(storage);
    values.set('sb-fymdyzxufkducfxfjdrr-auth-token', 'session');
    values.set('theme', 'dark');
    values.set('itinerary-trip-1', 'trip');
    values.set('budget-trip-1', 'wallet');

    const owned = listAppOwnedKeys();
    expect(owned).toContain('itinerary-trip-1');
    expect(owned).toContain('budget-trip-1');
    expect(owned).not.toContain('sb-fymdyzxufkducfxfjdrr-auth-token');
    expect(owned).not.toContain('theme');
  });

  it('never prunes an auth token to make room', () => {
    const { storage, values } = createStorage();
    useStorage(storage);
    values.set('sb-fymdyzxufkducfxfjdrr-auth-token', 'x'.repeat(400_000));
    values.set('itinerary-trip-1-history', 'y'.repeat(400_000));

    const result = pruneOptionalStorage({ targetBytes: 0 });

    expect(result.removed).toEqual(['itinerary-trip-1-history']);
    expect(values.get('sb-fymdyzxufkducfxfjdrr-auth-token')).toBeDefined();
  });

  it('discards history before backups and never the primary value', () => {
    const { storage, values } = createStorage();
    useStorage(storage);
    values.set('itinerary-trip-1', 'primary');
    values.set('itinerary-trip-1-backup', 'b'.repeat(100_000));
    values.set('itinerary-trip-1-history', 'h'.repeat(100_000));

    // Enough room is reclaimed by dropping history alone, so the backup stays.
    pruneOptionalStorage({ targetBytes: 250_000 });

    expect(values.get('itinerary-trip-1')).toBe('primary');
    expect(values.has('itinerary-trip-1-history')).toBe(false);
    expect(values.has('itinerary-trip-1-backup')).toBe(true);
  });

  it('keeps the app under its own soft budget by pruning optional data first', () => {
    const { storage, values } = createStorage();
    useStorage(storage);
    values.set('itinerary-trip-old-history', 'h'.repeat(1_200_000));

    const result = safeSetItemWithBudget('itinerary-trip-new', 'n'.repeat(1_200_000));

    expect(result.ok).toBe(true);
    expect(values.has('itinerary-trip-old-history')).toBe(false);
    expect(measureAppStorage().totalBytes).toBeLessThanOrEqual(LOCAL_STORAGE_SOFT_LIMIT_BYTES);
  });

  it('gives up quietly rather than looping when the browser rejects everything', () => {
    const { storage } = createStorage({ rejectAll: true });
    useStorage(storage);

    const result = safeSetItemWithBudget('itinerary-trip-1', 'value');

    expect(result).toEqual({ ok: false, reason: 'quota' });
  });
});
