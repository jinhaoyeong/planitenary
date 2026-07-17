const EXCHANGE_API_URL = 'https://open.er-api.com/v6/latest/MYR';

export const SUPPORTED_CURRENCIES = [
  { code: 'MYR', name: 'Malaysian Ringgit', symbol: 'RM' },
  { code: 'CNY', name: 'Chinese Yuan', symbol: '¥' },
  { code: 'USD', name: 'US Dollar', symbol: '$' },
  { code: 'EUR', name: 'Euro', symbol: '€' },
  { code: 'GBP', name: 'British Pound', symbol: '£' },
  { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$' },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥' },
  { code: 'KRW', name: 'South Korean Won', symbol: '₩' },
  { code: 'THB', name: 'Thai Baht', symbol: '฿' },
  { code: 'IDR', name: 'Indonesian Rupiah', symbol: 'Rp' },
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$' },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$' },
] as const;

export type Currency = typeof SUPPORTED_CURRENCIES[number]['code'];

export interface ExchangeRates {
  values: Record<Currency, number>;
  lastUpdated: number;
  fetchedAt: number;
  isLoading: boolean;
  isFallback?: boolean;
}

const CACHE_KEY = 'exchange-rates-v2';
const CACHE_DURATION = 15 * 60 * 1000;
const FALLBACK_VALUES: Record<Currency, number> = {
  MYR: 1, CNY: 1.66, USD: 0.23, EUR: 0.20, GBP: 0.17, SGD: 0.29,
  JPY: 35.5, KRW: 334, THB: 7.3, IDR: 3800, AUD: 0.33, CAD: 0.31,
};

const readCache = (allowExpired = false): ExchangeRates | null => {
  const cached = localStorage.getItem(CACHE_KEY);
  if (!cached) return null;
  try {
    const data = JSON.parse(cached) as ExchangeRates;
    const complete = SUPPORTED_CURRENCIES.every(({ code }) => Number.isFinite(data.values?.[code]));
    if (complete && (allowExpired || Date.now() - (data.fetchedAt || data.lastUpdated) < CACHE_DURATION)) {
      return { ...data, isLoading: false };
    }
  } catch { return null; }
  return null;
};

export const createInitialRates = (): ExchangeRates => ({
  values: { ...FALLBACK_VALUES }, lastUpdated: 0, fetchedAt: 0, isLoading: true, isFallback: true,
});

export async function fetchExchangeRates(ignoreCache = false): Promise<ExchangeRates> {
  if (!ignoreCache) {
    const cached = readCache();
    if (cached) return cached;
  }
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(EXCHANGE_API_URL, { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) throw new Error(`Exchange-rate request failed (${response.status})`);
    const data = await response.json() as { result?: string; rates?: Record<string, unknown>; time_last_update_unix?: number };
    if (data.result !== 'success' || !data.rates) throw new Error('Exchange-rate response was invalid');
    const values = Object.fromEntries(SUPPORTED_CURRENCIES.map(({ code }) => {
      const value = code === 'MYR' ? 1 : Number(data.rates?.[code]);
      if (!Number.isFinite(value) || value <= 0) throw new Error(`Missing exchange rate for ${code}`);
      return [code, value];
    })) as Record<Currency, number>;
    const rates: ExchangeRates = {
      values,
      lastUpdated: data.time_last_update_unix ? data.time_last_update_unix * 1000 : Date.now(),
      fetchedAt: Date.now(),
      isLoading: false,
      isFallback: false,
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(rates));
    return rates;
  } catch (error) {
    console.error('Failed to fetch current exchange rates:', error);
    const staleCache = readCache(true);
    return staleCache
      ? { ...staleCache, isFallback: true }
      : { ...createInitialRates(), lastUpdated: Date.now(), fetchedAt: Date.now(), isLoading: false };
  } finally { window.clearTimeout(timeoutId); }
}

export const getCurrencySymbol = (currency: Currency) =>
  SUPPORTED_CURRENCIES.find(({ code }) => code === currency)?.symbol ?? currency;

export function formatCurrency(amount: number, currency: Currency): string {
  return new Intl.NumberFormat('en-MY', {
    style: 'currency', currency,
    maximumFractionDigits: ['JPY', 'KRW', 'IDR'].includes(currency) ? 0 : 2,
  }).format(amount);
}

export function convertCurrency(amount: number, fromCurrency: Currency, toCurrency: Currency, rates: ExchangeRates): number {
  if (fromCurrency === toCurrency) return amount;
  return (amount / rates.values[fromCurrency]) * rates.values[toCurrency];
}

export function parseCurrencyValue(value: string): number {
  if (!value) return 0;
  const match = value.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}
