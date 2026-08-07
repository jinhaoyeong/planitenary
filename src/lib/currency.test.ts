import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  convertCurrency,
  createFallbackRates,
  describeRateFreshness,
  fetchExchangeRates,
  formatRelativeTime,
  hasRate,
  rateFor,
  type ExchangeRates,
} from './currency';

const CACHE_KEY = 'exchange-rates-v2';

const memoryStorage = () => {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
};

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('rate freshness', () => {
  it('never presents static estimates as freshly updated', () => {
    const fallback = createFallbackRates(false);
    expect(fallback.source).toBe('static-fallback');
    expect(fallback.fetchedAt).toBeUndefined();
    expect(fallback.providerUpdatedAt).toBeUndefined();

    const described = describeRateFreshness(fallback);
    expect(described.tone).toBe('offline');
    expect(described.isEstimate).toBe(true);
    expect(described.label).toMatch(/unavailable/i);
    expect(described.label).not.toMatch(/updated \d/);
  });

  it('reports live rates with the provider timestamp', () => {
    const now = Date.parse('2026-03-04T12:00:00Z');
    const rates: ExchangeRates = {
      base: 'MYR',
      rates: { MYR: 1, JPY: 33 },
      source: 'live',
      provider: 'open.er-api.com',
      providerUpdatedAt: now - 2 * 3_600_000,
      fetchedAt: now - 60_000,
      cachedAt: now - 60_000,
      isLoading: false,
    };
    const described = describeRateFreshness(rates, now);
    expect(described.tone).toBe('live');
    expect(described.isEstimate).toBe(false);
    expect(described.label).toBe('Live rate · updated 2 hours ago');
  });

  it('says plainly when a rate came from the local cache', () => {
    const now = Date.parse('2026-03-04T12:00:00Z');
    const described = describeRateFreshness(
      {
        base: 'MYR',
        rates: { MYR: 1 },
        source: 'cache',
        cachedAt: now - 30 * 60_000,
        isLoading: false,
      },
      now,
    );
    expect(described.tone).toBe('cached');
    expect(described.label).toBe('Saved rate from 30 minutes ago');
  });

  it('formats elapsed time in the largest sensible unit', () => {
    const now = Date.parse('2026-03-04T12:00:00Z');
    expect(formatRelativeTime(now - 5_000, now)).toBe('just now');
    expect(formatRelativeTime(now - 60_000, now)).toBe('1 minute ago');
    expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe('3 hours ago');
    expect(formatRelativeTime(now - 2 * 86_400_000, now)).toBe('2 days ago');
  });
});

describe('fetchExchangeRates', () => {
  it('marks a successful fetch as live and records both timestamps', async () => {
    const providerSeconds = Math.floor(Date.parse('2026-03-04T00:00:00Z') / 1000);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ rates: { JPY: 33.2, MYR: 1 }, time_last_update_unix: providerSeconds }),
      })),
    );

    const rates = await fetchExchangeRates();

    expect(rates.source).toBe('live');
    expect(rates.provider).toBe('open.er-api.com');
    expect(rates.providerUpdatedAt).toBe(providerSeconds * 1000);
    expect(rates.fetchedAt).toBeTypeOf('number');
    expect(rateFor(rates, 'JPY')).toBe(33.2);
  });

  it('falls back to the cached copy when the service is unavailable', async () => {
    const cachedAt = Date.now() - 6 * 3_600_000;
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        base: 'MYR',
        rates: { MYR: 1, JPY: 30 },
        source: 'live',
        cachedAt,
        fetchedAt: cachedAt,
        isLoading: false,
      }),
    );
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('offline');
    }));

    const rates = await fetchExchangeRates();

    expect(rates.source).toBe('cache');
    expect(rateFor(rates, 'JPY')).toBe(30);
    expect(describeRateFreshness(rates).tone).toBe('cached');
  });

  it('falls back to honest estimates when there is no cache either', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('offline');
    }));

    const rates = await fetchExchangeRates();

    expect(rates.source).toBe('static-fallback');
    expect(rates.fetchedAt).toBeUndefined();
    expect(rates.isLoading).toBe(false);
    // Still usable: the wallet keeps working without a network.
    expect(rateFor(rates, 'JPY')).toBeGreaterThan(0);
    expect(convertCurrency(100, 'MYR', 'JPY', rates)).toBeGreaterThan(0);
  });

  it('reuses a recent cache without calling the provider', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        base: 'MYR',
        rates: { MYR: 1, JPY: 31 },
        source: 'live',
        cachedAt: Date.now() - 1000,
        isLoading: false,
      }),
    );

    const rates = await fetchExchangeRates();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(rateFor(rates, 'JPY')).toBe(31);
  });
});

/**
 * `rateFor` ends in `?? 1`, which is a sane wallet default and a silent lie
 * beside a published fare: a currency the catalog has never heard of would
 * convert at par. `placeCost` can emit 57 currencies and a dozen of them —
 * COP, RUB, NGN, PKR among them — have no catalog entry at all.
 */
describe('knowing when there is no rate to convert at', () => {
  it('reports a currency the catalog carries', () => {
    expect(hasRate(createFallbackRates(false), 'JPY')).toBe(true);
    expect(hasRate(createFallbackRates(false), 'EUR')).toBe(true);
  });

  it('reports a currency it has never heard of, rather than converting at par', () => {
    expect(hasRate(createFallbackRates(false), 'COP')).toBe(false);
    expect(rateFor(createFallbackRates(false), 'COP')).toBe(1);
  });

  it('accepts a live rate for a currency with no fallback', () => {
    const base = createFallbackRates(false);
    const live = { ...base, rates: { ...base.rates, COP: 1100 } };
    expect(hasRate(live, 'COP')).toBe(true);
  });
});
