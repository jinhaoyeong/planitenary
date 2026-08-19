import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadFromStorage, saveToStorage } from './storageResilience';

const createStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (key.endsWith('-history')) {
        const error = new Error('storage quota exceeded') as Error & { name: string };
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
    }
  } satisfies Storage;
};

const createPrimaryQuotaStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (key === 'itinerary-live' && value.includes('second')) {
        const error = new Error('storage quota exceeded') as Error & { name: string };
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
    }
  } satisfies Storage;
};

describe('storage resilience', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps the primary itinerary save when history exceeds browser quota', () => {
    vi.stubGlobal('localStorage', createStorage());

    expect(() => {
      saveToStorage('itinerary-live', { version: 1, places: ['first'] });
      saveToStorage('itinerary-live', { version: 1, places: ['second'] });
    }).not.toThrow();

    expect(loadFromStorage<{ places: string[] }>('itinerary-live')?.places).toEqual(['second']);
    expect(localStorage.getItem('itinerary-live-history')).toBeNull();
  });

  it('does not throw when the primary itinerary exceeds quota after cleanup', () => {
    vi.stubGlobal('localStorage', createPrimaryQuotaStorage());

    expect(() => {
      saveToStorage('itinerary-live', { version: 1, places: ['first'] });
      saveToStorage('itinerary-live', { version: 1, places: ['second'] });
    }).not.toThrow();
  });

  it('keeps a valid primary unless the caller identifies a more complete recovery snapshot', () => {
    vi.stubGlobal('localStorage', createStorage());
    const key = 'itinerary-demo-cq-cd';
    const profile = { destination: 'Osaka', startDate: '2027-04-10', endDate: '2027-04-17' };

    localStorage.setItem(key, JSON.stringify({ id: 'cq-cd', name: 'Osaka', days: [] }));
    localStorage.setItem(`${key}-backup`, JSON.stringify({ id: 'cq-cd', name: 'Osaka', days: [], tripProfile: profile }));

    expect(loadFromStorage<{ tripProfile?: typeof profile }>(key)?.tripProfile).toBeUndefined();
    expect(loadFromStorage<{ tripProfile?: typeof profile }>(key, {
      preferRecovery: (primary, recovery) => !primary.tripProfile && Boolean(recovery.tripProfile),
    })?.tripProfile).toEqual(profile);
    expect(JSON.parse(localStorage.getItem(key) || '{}').tripProfile).toEqual(profile);
  });
});

/**
 * Reproduces the production condition directly: an origin already at the
 * browser quota, so every write fails. Planitenary must still hydrate and
 * still hand callers their data — a cache failure may degrade offline
 * convenience but must never blank the app.
 */
const createFullOriginStorage = (seed: Record<string, string>) => {
  const values = new Map<string, string>(Object.entries(seed));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: () => {
      const error = new Error('storage quota exceeded') as Error & { name: string };
      error.name = 'QuotaExceededError';
      throw error;
    },
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    }
  } satisfies Storage;
};

describe('a browser whose storage is already full', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('still recovers a trip from backup when the promoting write cannot happen', () => {
    const key = 'itinerary-user-1-trip-full';
    const recovered = { id: 'trip-full', name: 'Winter in Tokyo', days: [1, 2] };
    vi.stubGlobal('localStorage', createFullOriginStorage({
      [`${key}-backup`]: JSON.stringify(recovered),
    }));

    let value: typeof recovered | null = null;
    expect(() => {
      value = loadFromStorage<typeof recovered>(key);
    }).not.toThrow();
    expect(value).toEqual(recovered);
  });

  it('never throws out of a save, so render and hydration continue', () => {
    vi.stubGlobal('localStorage', createFullOriginStorage({}));

    expect(() => {
      saveToStorage('itinerary-user-1-trip-full', { id: 'trip-full', days: [] });
      saveToStorage('budget-trip-full', { expenses: [{ amountMYR: 50 }] });
      saveToStorage('checklist-data-trip-full', { items: [] });
    }).not.toThrow();
  });

  it('reads back the in-memory truth even though nothing could be persisted', () => {
    const key = 'itinerary-user-1-trip-full';
    vi.stubGlobal('localStorage', createFullOriginStorage({}));

    saveToStorage(key, { id: 'trip-full', days: [] });

    // Nothing persisted, and that is fine: the server stays authoritative.
    expect(loadFromStorage(key)).toBeNull();
  });
});
