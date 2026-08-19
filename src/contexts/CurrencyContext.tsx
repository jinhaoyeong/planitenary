import { createContext, useCallback, useContext, useState, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import type { Currency, ExchangeRates, RateFreshness } from '../lib/currency';
import {
  convertCurrency,
  createFallbackRates,
  describeRateFreshness,
  fetchExchangeRates,
  formatCurrency,
  formatRateLabel,
} from '../lib/currency';
import { isSupportedCurrency } from '../lib/currencyCatalog';
import { detectHomeCurrency } from '../lib/locale';
import { useAuth } from './AuthContext';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { safeGetItem, safeSetItem } from '../lib/safeLocalStorage';

/**
 * The open trip and the callback that writes a change back into its profile.
 * While a trip is bound its profile is the only owner of the currency pair;
 * this context is a read-through view of it, never a second source of truth.
 */
export interface TripCurrencyBinding {
  tripId: string;
  homeCurrency: Currency;
  tripCurrency: Currency;
  /** Persists the pair onto the trip profile. */
  persist: (next: { homeCurrency: Currency; tripCurrency: Currency }) => void;
}

interface CurrencyContextType {
  /** Currently displayed currency on the wallet. */
  currency: Currency;
  setCurrency: (currency: Currency) => void;
  /** User's local / home currency. */
  homeCurrency: Currency;
  setHomeCurrency: (currency: Currency) => void;
  /** Destination / trip currency. */
  tripCurrency: Currency;
  setTripCurrency: (currency: Currency) => void;
  /** Points the context at the open trip, or clears it with null. */
  bindTrip: (binding: TripCurrencyBinding | null) => void;
  /** True while a trip profile owns the pair. */
  isTripBound: boolean;
  rates: ExchangeRates;
  refreshRates: () => Promise<void>;
  format: (amount: number) => string;
  formatIn: (amount: number, currency: Currency) => string;
  convert: (amount: number, fromCurrency?: Currency) => number;
  toBase: (amount: number, fromCurrency?: Currency) => number;
  /** e.g. "1 RM = ¥33.20" for the active home → trip pair. */
  rateLabel: string;
  /** Where the rate came from and when, in plain words. */
  rateFreshness: RateFreshness;
}

const CurrencyContext = createContext<CurrencyContextType | undefined>(undefined);

const DISPLAY_KEY = 'selected-currency';
const DISPLAY_BY_TRIP_KEY = 'display-currency-by-trip';
const HOME_KEY = 'home-currency';
const TRIP_KEY = 'trip-currency';
const BASE: Currency = 'MYR';

const readCurrency = (key: string, fallback: Currency): Currency => {
  const saved = safeGetItem(key);
  return saved && isSupportedCurrency(saved) ? saved.toUpperCase() : fallback;
};

/**
 * Which of the two currencies each trip's wallet was last showing. Kept per
 * trip because one global choice cannot be right for a Japan trip and an Italy
 * trip at the same time.
 */
const readDisplayByTrip = (): Record<string, Currency> => {
  try {
    const raw = safeGetItem(DISPLAY_BY_TRIP_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string' && isSupportedCurrency(entry[1]),
      ),
    );
  } catch {
    return {};
  }
};

/** First run has no saved preference, so start from the device region. */
const initialHomeCurrency = (): Currency => readCurrency(HOME_KEY, detectHomeCurrency(BASE));

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const { user, isDemoUser, isLocalTestUser } = useAuth();
  const cloudReadyRef = useRef(false);
  const [displayPreference, setDisplayPreference] = useState<Currency>(() => readCurrency(DISPLAY_KEY, initialHomeCurrency()));
  // Defaults used before any trip is open, and for seeding new trips.
  const [defaultHome, setDefaultHome] = useState<Currency>(initialHomeCurrency);
  const [defaultTrip, setDefaultTrip] = useState<Currency>(() => readCurrency(TRIP_KEY, initialHomeCurrency()));
  const [displayByTrip, setDisplayByTrip] = useState<Record<string, Currency>>(readDisplayByTrip);
  const [binding, setBinding] = useState<TripCurrencyBinding | null>(null);
  const [rates, setRates] = useState<ExchangeRates>(() => createFallbackRates(true));

  // A bound trip's profile wins; otherwise the account-level defaults apply.
  const homeCurrency = binding?.homeCurrency ?? defaultHome;
  const tripCurrency = binding?.tripCurrency ?? defaultTrip;
  // With a trip open the wallet shows the money being spent there unless the
  // traveller chose otherwise for that trip specifically.
  const preferredDisplay = binding
    ? displayByTrip[binding.tripId] ?? tripCurrency
    : displayPreference;
  const currency = preferredDisplay === homeCurrency || preferredDisplay === tripCurrency
    ? preferredDisplay
    : homeCurrency;

  const bindTrip = useCallback((next: TripCurrencyBinding | null) => {
    setBinding((previous) => {
      if (!next) return previous === null ? previous : null;
      if (
        previous &&
        previous.tripId === next.tripId &&
        previous.homeCurrency === next.homeCurrency &&
        previous.tripCurrency === next.tripCurrency
      ) {
        return previous;
      }
      return next;
    });
  }, []);

  const persistDefaults = (home: Currency, trip: Currency) => {
    safeSetItem(HOME_KEY, home);
    safeSetItem(TRIP_KEY, trip);
    setDefaultHome(home);
    setDefaultTrip(trip);
    if (user) {
      safeSetItem(`home-currency-${user.id}`, home);
      safeSetItem(`trip-currency-${user.id}`, trip);
    }
  };

  const setCurrency = (newCurrency: Currency) => {
    if (newCurrency !== homeCurrency && newCurrency !== tripCurrency) return;
    if (binding) {
      const next = { ...displayByTrip, [binding.tripId]: newCurrency };
      setDisplayByTrip(next);
      safeSetItem(DISPLAY_BY_TRIP_KEY, JSON.stringify(next));
      return;
    }
    setDisplayPreference(newCurrency);
    safeSetItem(DISPLAY_KEY, newCurrency);
    if (user) safeSetItem(`selected-currency-${user.id}`, newCurrency);
  };

  const setHomeCurrency = (value: Currency) => {
    if (!isSupportedCurrency(value)) return;
    const nextHome = value.toUpperCase();
    // Home currency is a property of the traveller, so it also updates the
    // default that future trips start from.
    persistDefaults(nextHome, binding ? defaultTrip : tripCurrency);
    binding?.persist({ homeCurrency: nextHome, tripCurrency: binding.tripCurrency });
  };

  const setTripCurrency = (value: Currency) => {
    if (!isSupportedCurrency(value)) return;
    const nextTrip = value.toUpperCase();
    if (binding) {
      binding.persist({ homeCurrency: binding.homeCurrency, tripCurrency: nextTrip });
      return;
    }
    persistDefaults(defaultHome, nextTrip);
  };

  useEffect(() => {
    let mounted = true;

    const loadRates = async () => {
      if (!mounted) return;
      const newRates = await fetchExchangeRates();
      if (mounted) setRates(newRates);
    };

    void loadRates();
    const intervalId = setInterval(() => void loadRates(), 15 * 60 * 1000);
    const handleFocus = () => {
      void loadRates();
    };
    window.addEventListener('focus', handleFocus);
    window.addEventListener('online', handleFocus);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void loadRates();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      mounted = false;
      clearInterval(intervalId);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('online', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  const refreshRates = async () => {
    setRates((prev) => ({ ...prev, isLoading: true }));
    const newRates = await fetchExchangeRates();
    setRates(newRates);
  };

  const format = (amount: number): string => formatCurrency(amount, currency);
  const formatIn = (amount: number, target: Currency): string =>
    formatCurrency(convertCurrency(amount, BASE, target, rates), target);

  const convert = (amount: number, fromCurrency?: Currency): number =>
    convertCurrency(amount, fromCurrency || BASE, currency, rates);

  useEffect(() => {
    cloudReadyRef.current = false;
    if (!user) return;

    const accountDisplay = safeGetItem(`selected-currency-${user.id}`);
    const accountHome = safeGetItem(`home-currency-${user.id}`);
    const accountTrip = safeGetItem(`trip-currency-${user.id}`);

    const nextHome = accountHome && isSupportedCurrency(accountHome) ? accountHome.toUpperCase() : defaultHome;
    const nextTrip = accountTrip && isSupportedCurrency(accountTrip) ? accountTrip.toUpperCase() : defaultTrip;
    persistDefaults(nextHome, nextTrip);
    if (accountDisplay && isSupportedCurrency(accountDisplay)) {
      setDisplayPreference(accountDisplay.toUpperCase());
      safeSetItem(DISPLAY_KEY, accountDisplay.toUpperCase());
    }

    if (!isSupabaseConfigured() || isDemoUser || isLocalTestUser) {
      cloudReadyRef.current = true;
      return;
    }

    let mounted = true;
    void supabase.from('user_preferences').select('currency').eq('user_id', user.id).maybeSingle().then(({ data, error }) => {
      if (!mounted) return;
      if (error) console.error('Failed to load cloud currency preference:', error);
      const cloudCurrency = typeof data?.currency === 'string' ? data.currency.toUpperCase() : null;
      // Cloud only stores the display preference; the pair belongs to the trip.
      if (cloudCurrency && isSupportedCurrency(cloudCurrency)) {
        setDisplayPreference(cloudCurrency);
        safeSetItem(DISPLAY_KEY, cloudCurrency);
        safeSetItem(`selected-currency-${user.id}`, cloudCurrency);
      }
      cloudReadyRef.current = true;
    });
    return () => {
      mounted = false;
    };
    // Intentionally run on auth identity changes only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, isDemoUser, isLocalTestUser]);

  // Only the account-level defaults are synced. A trip's own pair lives in its
  // profile, and its wallet view lives with the trip.
  useEffect(() => {
    if (!user || !cloudReadyRef.current) return;
    safeSetItem(`selected-currency-${user.id}`, displayPreference);
    safeSetItem(`home-currency-${user.id}`, defaultHome);
    safeSetItem(`trip-currency-${user.id}`, defaultTrip);
    if (!isSupabaseConfigured() || isDemoUser || isLocalTestUser) return;
    const timeoutId = window.setTimeout(async () => {
      const { error } = await supabase.from('user_preferences').upsert({
        user_id: user.id,
        currency: displayPreference,
        updated_at: new Date().toISOString(),
      });
      if (error) console.error('Failed to save cloud currency preference:', error);
    }, 500);
    return () => window.clearTimeout(timeoutId);
  }, [displayPreference, defaultHome, defaultTrip, user?.id, isDemoUser, isLocalTestUser]);

  const toBase = (amount: number, fromCurrency: Currency = currency): number =>
    convertCurrency(amount, fromCurrency, BASE, rates);

  return (
    <CurrencyContext.Provider
      value={{
        currency,
        setCurrency,
        homeCurrency,
        setHomeCurrency,
        tripCurrency,
        setTripCurrency,
        bindTrip,
        isTripBound: binding !== null,
        rates,
        refreshRates,
        format,
        formatIn,
        convert,
        toBase,
        rateLabel: formatRateLabel(homeCurrency, tripCurrency, rates),
        rateFreshness: describeRateFreshness(rates),
      }}
    >
      {children}
    </CurrencyContext.Provider>
  );
}

export const useCurrency = () => {
  const context = useContext(CurrencyContext);
  if (context === undefined) {
    throw new Error('useCurrency must be used within a CurrencyProvider');
  }
  return context;
};
