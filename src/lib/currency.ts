import { CURRENCIES, currencyDecimals, currencyMeta } from './currencyCatalog';

const PRIMARY_API_URL = 'https://open.er-api.com/v6/latest/MYR';
const BACKUP_API_URL = 'https://api.frankfurter.app/latest?from=MYR';

/** ISO 4217 code. Any code in the catalog can be used as home or trip currency. */
export type Currency = string;

/** Where the numbers on screen actually came from. */
export type RateSource = 'live' | 'cache' | 'static-fallback';

export interface ExchangeRates {
  /** Accounting base every stored amount is expressed in. */
  base: 'MYR';
  /** Units of each currency per 1 unit of base. */
  rates: Record<string, number>;
  source: RateSource;
  /** Hostname of the provider these rates came from, when they came from one. */
  provider?: string;
  /** When the provider itself says the rates were last revised. */
  providerUpdatedAt?: number;
  /** When this app last reached the provider successfully. */
  fetchedAt?: number;
  /** When the copy being shown was written to the local cache. */
  cachedAt?: number;
  isLoading: boolean;
}

const CACHE_KEY = 'exchange-rates-v2';
const CACHE_DURATION = 5 * 60 * 1000;

/** Rough offline rates per 1 MYR so the wallet still renders without network. */
const FALLBACK_RATES: Record<string, number> = {
  MYR: 1, SGD: 0.3, USD: 0.22, EUR: 0.21, GBP: 0.18, JPY: 33.2, KRW: 300, CNY: 1.6,
  TWD: 7.1, HKD: 1.75, THB: 7.7, VND: 5600, IDR: 3500, PHP: 12.7, INR: 18.6, NPR: 29.8,
  LKR: 66, MVR: 3.4, KHR: 900, LAK: 4800, AUD: 0.34, NZD: 0.37, CHF: 0.19, ISK: 30,
  NOK: 2.4, SEK: 2.4, DKK: 1.55, CZK: 5.2, PLN: 0.9, HUF: 81, TRY: 7.6, AED: 0.82,
  QAR: 0.81, SAR: 0.84, ILS: 0.82, JOD: 0.16, EGP: 10.8, MAD: 2.2, ZAR: 4.1, KES: 29,
  CAD: 0.31, MXN: 4.2, BRL: 1.2, ARS: 220, PEN: 0.83, CLP: 210,
};

const SUPPORTED_CODES = CURRENCIES.map((currency) => currency.code);

const normalizeRates = (input: unknown): Record<string, number> => {
  const source = (input || {}) as Record<string, unknown>;
  const rates: Record<string, number> = { MYR: 1 };
  for (const code of SUPPORTED_CODES) {
    const value = Number(source[code]);
    rates[code] = Number.isFinite(value) && value > 0 ? value : FALLBACK_RATES[code] ?? 1;
  }
  return rates;
};

/**
 * Offline estimates. These carry no timestamps on purpose: they were never
 * fetched, so nothing about them is fresh and the UI must not imply otherwise.
 */
export const createFallbackRates = (isLoading = true): ExchangeRates => ({
  base: 'MYR',
  rates: { ...FALLBACK_RATES },
  source: 'static-fallback',
  isLoading,
});

const providerHost = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
};

/** er-api reports a unix timestamp; frankfurter reports a plain date. */
const readProviderTimestamp = (data: unknown): number | undefined => {
  const record = (data || {}) as Record<string, unknown>;
  const unix = Number(record.time_last_update_unix);
  if (Number.isFinite(unix) && unix > 0) return unix * 1000;
  if (typeof record.date === 'string') {
    const parsed = Date.parse(`${record.date}T00:00:00Z`);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

export async function fetchExchangeRates(): Promise<ExchangeRates> {
  const readCache = (): ExchangeRates | null => {
    const cached = localStorage.getItem(CACHE_KEY);
    if (!cached) return null;
    try {
      const data = JSON.parse(cached) as ExchangeRates;
      if (!data?.rates || typeof data.cachedAt !== 'number') return null;
      return { ...data, source: 'cache', isLoading: false };
    } catch {
      return null;
    }
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

  const cached = readCache();
  if (cached && Date.now() - (cached.cachedAt ?? 0) < CACHE_DURATION) return cached;

  try {
    let payload: Record<string, unknown> | null = null;
    let provider = providerHost(PRIMARY_API_URL);
    let providerUpdatedAt: number | undefined;
    try {
      const data = await requestWithTimeout(PRIMARY_API_URL);
      payload = (data as { rates?: Record<string, unknown> }).rates ?? null;
      providerUpdatedAt = readProviderTimestamp(data);
    } catch {
      const backup = await requestWithTimeout(BACKUP_API_URL);
      payload = (backup as { rates?: Record<string, unknown> }).rates ?? null;
      providerUpdatedAt = readProviderTimestamp(backup);
      provider = providerHost(BACKUP_API_URL);
    }
    if (!payload) throw new Error('No rates returned');

    const now = Date.now();
    const rates: ExchangeRates = {
      base: 'MYR',
      rates: normalizeRates(payload),
      source: 'live',
      provider,
      providerUpdatedAt,
      fetchedAt: now,
      cachedAt: now,
      isLoading: false,
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(rates));
    return rates;
  } catch (error) {
    console.error('Failed to fetch exchange rates:', error);
    // A stale cache is still real data; static estimates are not, and say so.
    return cached ?? createFallbackRates(false);
  }
}

const RELATIVE_UNITS: Array<[label: string, ms: number]> = [
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

export function formatRelativeTime(timestamp: number, now = Date.now()): string {
  const elapsed = Math.max(0, now - timestamp);
  for (const [label, size] of RELATIVE_UNITS) {
    const count = Math.floor(elapsed / size);
    if (count >= 1) return `${count} ${label}${count === 1 ? '' : 's'} ago`;
  }
  return 'just now';
}

export interface RateFreshness {
  label: string;
  tone: 'live' | 'cached' | 'offline';
  /** True when the figures are estimates rather than fetched rates. */
  isEstimate: boolean;
}

/** Honest one-line description of where the current rates came from. */
export function describeRateFreshness(rates: ExchangeRates, now = Date.now()): RateFreshness {
  if (rates.isLoading && rates.source === 'static-fallback') {
    return { label: 'Checking today’s rate…', tone: 'cached', isEstimate: true };
  }

  if (rates.source === 'live') {
    const stamp = rates.providerUpdatedAt ?? rates.fetchedAt;
    return {
      label: stamp ? `Live rate · updated ${formatRelativeTime(stamp, now)}` : 'Live rate',
      tone: 'live',
      isEstimate: false,
    };
  }

  if (rates.source === 'cache') {
    const stamp = rates.providerUpdatedAt ?? rates.cachedAt;
    return {
      label: stamp ? `Saved rate from ${formatRelativeTime(stamp, now)}` : 'Saved rate',
      tone: 'cached',
      isEstimate: false,
    };
  }

  return {
    label: 'Offline estimate · rate service unavailable',
    tone: 'offline',
    isEstimate: true,
  };
}

export const rateFor = (rates: ExchangeRates, currency: Currency): number => {
  const value = rates.rates?.[currency.toUpperCase()];
  return Number.isFinite(value) && value > 0 ? value : FALLBACK_RATES[currency.toUpperCase()] ?? 1;
};

/**
 * Whether a real rate exists for this currency, live or as a fallback.
 *
 * `rateFor` ends in `?? 1`, which is a sane default for a wallet total but a
 * silent lie beside a published fare: `COP 50,000` would render as
 * `≈ RM 50,000` when the true figure is about RM 55. A traveller shown that is
 * being told a price a thousand times out — the same failure the currency
 * discipline in `placeCost` exists to prevent, arriving through the back door.
 *
 * `placeCost` can emit 57 currencies; a dozen of them (COP, RUB, NGN, PKR and
 * friends) have no entry in the catalog at all. Callers that *display* a
 * conversion must check here first and simply omit it — a missing
 * approximation costs the traveller nothing, and a wrong one costs them the
 * trust in every other number on the card.
 */
export const hasRate = (rates: ExchangeRates, currency: Currency): boolean => {
  const code = currency.toUpperCase();
  const live = rates.rates?.[code];
  return (Number.isFinite(live) && (live as number) > 0) || FALLBACK_RATES[code] !== undefined;
};

export interface FormatCurrencyOptions {
  /**
   * Show the figure exactly as published, sub-units and all.
   *
   * The default rounds to whole units, which is right for a converted
   * approximation or a budget total — nobody needs `≈ RM 78.34`. It is wrong
   * for a **published** price: an operator charging €6.50 displayed as `€7` is
   * a figure that matches nothing on their page, and `admissionCopy`'s whole
   * contract is that a fare is shown as its source published it.
   *
   * Trailing zeros are still dropped for a whole amount, so `$10` does not
   * become `$10.00` — the decimals appear only when the price actually has
   * them.
   */
  exact?: boolean;
}

export function formatCurrency(
  amount: number,
  currency: Currency,
  options: FormatCurrencyOptions = {},
): string {
  const code = currency.toUpperCase();
  const hasFraction = options.exact && !Number.isInteger(amount);
  const digits = hasFraction ? currencyDecimals(code) : 0;
  try {
    return new Intl.NumberFormat('en-MY', {
      style: 'currency',
      currency: code,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(amount);
  } catch {
    const rendered = digits > 0 ? amount.toFixed(digits) : Math.round(amount).toLocaleString();
    return `${currencyMeta(code).symbol}${rendered}`;
  }
}

/** Compact "1 RM = ¥33.20" style label for the wallet. */
export function formatRateLabel(from: Currency, to: Currency, rates: ExchangeRates): string {
  const fromMeta = currencyMeta(from);
  const toMeta = currencyMeta(to);
  const ratio = rateFor(rates, to) / rateFor(rates, from);
  const digits = ratio >= 100 ? 0 : currencyDecimals(to) === 0 ? 2 : 3;
  return `1 ${fromMeta.symbol} = ${toMeta.symbol}${ratio.toFixed(digits)}`;
}

export function convertCurrency(
  amount: number,
  fromCurrency: Currency,
  toCurrency: Currency,
  rates: ExchangeRates,
): number {
  if (fromCurrency === toCurrency) return amount;
  const amountInBase = amount / rateFor(rates, fromCurrency);
  return Math.round(amountInBase * rateFor(rates, toCurrency));
}

export function parseCurrencyValue(value: string): number {
  if (!value) return 0;

  const cleaned = value
    .replace(/[¥₹$€£₩฿₫₱₺₪៛₭]/g, '')
    .replace(/[A-Za-z]/g, '')
    .replace(/,/g, '')
    .trim();

  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
}
