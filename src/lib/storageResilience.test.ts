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
