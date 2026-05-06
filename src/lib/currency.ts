// Free exchange rate API - no API key required
const EXCHANGE_API_URL = 'https://api.frankfurter.app';

export type Currency = 'MYR' | 'CNY';

export interface ExchangeRates {
  MYR: number;
  CNY: number;
  lastUpdated: number;
  isLoading: boolean;
}

const CACHE_KEY = 'exchange-rates';
const CACHE_DURATION = 5 * 60 * 1000;

// Fallback rates (used if API fails)
const FALLBACK_RATES = {
  MYR: 1, // Base currency
  CNY: 1.51 // 1 MYR = ~1.51 CNY (approximate)
};

export async function fetchExchangeRates(): Promise<ExchangeRates> {
  const fromCache = (allowExpired = false): ExchangeRates | null => {
    const cached = localStorage.getItem(CACHE_KEY);
    if (!cached) return null;
    try {
      const data = JSON.parse(cached) as ExchangeRates;
      if (allowExpired || Date.now() - data.lastUpdated < CACHE_DURATION) {
        return { ...data, isLoading: false };
      }
    } catch {
      return null;
    }
    return null;
  };

  const requestWithTimeout = async (url: string, timeoutMs = 8000) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error('API request failed');
      return response.json();
    } finally {
      clearTimeout(timeoutId);
    }
  };

  const normalizeRate = (value: unknown) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return FALLBACK_RATES.CNY;
    return parsed;
  };

  try {
    const validCached = fromCache(false);
    if (validCached) {
      return validCached;
    }

    let cnyRate = FALLBACK_RATES.CNY;
    try {
      const data = await requestWithTimeout(`${EXCHANGE_API_URL}/latest?from=MYR&to=CNY`);
      cnyRate = normalizeRate((data as { rates?: { CNY?: unknown } }).rates?.CNY);
    } catch {
      const backupData = await requestWithTimeout('https://open.er-api.com/v6/latest/MYR');
      cnyRate = normalizeRate((backupData as { rates?: { CNY?: unknown } }).rates?.CNY);
    }

    const rates: ExchangeRates = {
      MYR: 1,
      CNY: cnyRate,
      lastUpdated: Date.now(),
      isLoading: false
    };

    localStorage.setItem(CACHE_KEY, JSON.stringify(rates));
    return rates;
  } catch (error) {
    console.error('Failed to fetch exchange rates:', error);

    const staleCached = fromCache(true);
    if (staleCached) {
      return staleCached;
    }

    return {
      ...FALLBACK_RATES,
      lastUpdated: Date.now(),
      isLoading: false
    };
  }
}

export function formatCurrency(amount: number, currency: Currency): string {
  const formatter = new Intl.NumberFormat('en-MY', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });

  return formatter.format(amount);
}

export function convertCurrency(
  amount: number,
  fromCurrency: Currency,
  toCurrency: Currency,
  rates: ExchangeRates
): number {
  if (fromCurrency === toCurrency) return amount;

  // Convert to base (MYR) first, then to target
  const amountInMYR = fromCurrency === 'MYR' ? amount : amount / rates[fromCurrency];
  const result = toCurrency === 'MYR' ? amountInMYR : amountInMYR * rates[toCurrency];

  return Math.round(result);
}

export function parseCurrencyValue(value: string): number {
  if (!value) return 0;

  // Remove currency symbols and format characters
  const cleaned = value
    .replace(/[¥₹$€£]/g, '')
    .replace(/[MYR|CNY|RMB]/gi, '')
    .replace(/,/g, '')
    .trim();

  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
}
