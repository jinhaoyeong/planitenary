import { findCountry, listCountries } from './destinations';
import { isSupportedCurrency } from './currencyCatalog';

/** Currencies for regions the destination catalog does not cover. */
const EXTRA_REGION_CURRENCIES: Record<string, string> = {
  BE: 'EUR', LU: 'EUR', SK: 'EUR', SI: 'EUR', EE: 'EUR', LV: 'EUR', LT: 'EUR',
  CY: 'EUR', MT: 'EUR', HR: 'EUR', GB: 'GBP', PR: 'USD', GU: 'USD', BN: 'SGD',
};

const readRegion = (locale: string | undefined): string | null => {
  if (!locale) return null;
  try {
    const region = new Intl.Locale(locale).region;
    return region ? region.toUpperCase() : null;
  } catch {
    const parts = locale.split(/[-_]/);
    const candidate = parts[parts.length - 1];
    return candidate && candidate.length === 2 ? candidate.toUpperCase() : null;
  }
};

/** Best guess at the traveller's home region from the browser locale. */
export function detectHomeRegion(): string | null {
  if (typeof navigator === 'undefined') return null;
  const candidates = [...(navigator.languages || []), navigator.language];
  for (const locale of candidates) {
    const region = readRegion(locale);
    if (region) return region;
  }
  try {
    return readRegion(Intl.DateTimeFormat().resolvedOptions().locale);
  } catch {
    return null;
  }
}

export function detectHomeCountryName(): string | null {
  const region = detectHomeRegion();
  if (!region) return null;
  return listCountries().find((country) => country.code === region)?.name ?? null;
}

/** Home currency guessed from the device region, falling back to the given default. */
export function detectHomeCurrency(fallback = 'USD'): string {
  const region = detectHomeRegion();
  if (!region) return fallback;

  const fromCatalog = findCountry(region)?.currency;
  if (fromCatalog && isSupportedCurrency(fromCatalog)) return fromCatalog;

  const extra = EXTRA_REGION_CURRENCIES[region];
  return extra && isSupportedCurrency(extra) ? extra : fallback;
}
