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
});
