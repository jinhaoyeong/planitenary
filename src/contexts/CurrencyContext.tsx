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
const HOME_KEY = 'home-currency';
const TRIP_KEY = 'trip-currency';
const BASE: Currency = 'MYR';

const readCurrency = (key: string, fallback: Currency): Currency => {
  const saved = localStorage.getItem(key);
  return saved && isSupportedCurrency(saved) ? saved.toUpperCase() : fallback;
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
  const [binding, setBinding] = useState<TripCurrencyBinding | null>(null);
  const [rates, setRates] = useState<ExchangeRates>(() => createFallbackRates(true));

  // A bound trip's profile wins; otherwise the account-level defaults apply.
  const homeCurrency = binding?.homeCurrency ?? defaultHome;
  const tripCurrency = binding?.tripCurrency ?? defaultTrip;
  const currency = displayPreference === homeCurrency || displayPreference === tripCurrency
    ? displayPreference
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
    localStorage.setItem(HOME_KEY, home);
    localStorage.setItem(TRIP_KEY, trip);
    setDefaultHome(home);
    setDefaultTrip(trip);
    if (user) {
      localStorage.setItem(`home-currency-${user.id}`, home);
      localStorage.setItem(`trip-currency-${user.id}`, trip);
    }
  };

  const setCurrency = (newCurrency: Currency) => {
    if (newCurrency !== homeCurrency && newCurrency !== tripCurrency) return;
    setDisplayPreference(newCurrency);
    localStorage.setItem(DISPLAY_KEY, newCurrency);
    if (user) localStorage.setItem(`selected-currency-${user.id}`, newCurrency);
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

    const accountDisplay = localStorage.getItem(`selected-currency-${user.id}`);
    const accountHome = localStorage.getItem(`home-currency-${user.id}`);
    const accountTrip = localStorage.getItem(`trip-currency-${user.id}`);

    const nextHome = accountHome && isSupportedCurrency(accountHome) ? accountHome.toUpperCase() : defaultHome;
    const nextTrip = accountTrip && isSupportedCurrency(accountTrip) ? accountTrip.toUpperCase() : defaultTrip;
    persistDefaults(nextHome, nextTrip);
    if (accountDisplay && isSupportedCurrency(accountDisplay)) {
      setDisplayPreference(accountDisplay.toUpperCase());
      localStorage.setItem(DISPLAY_KEY, accountDisplay.toUpperCase());
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
        localStorage.setItem(DISPLAY_KEY, cloudCurrency);
        localStorage.setItem(`selected-currency-${user.id}`, cloudCurrency);
      }
      cloudReadyRef.current = true;
    });
    return () => {
      mounted = false;
    };
    // Intentionally run on auth identity changes only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, isDemoUser, isLocalTestUser]);

  useEffect(() => {
    if (!user || !cloudReadyRef.current) return;
    localStorage.setItem(`selected-currency-${user.id}`, currency);
    localStorage.setItem(`home-currency-${user.id}`, homeCurrency);
    localStorage.setItem(`trip-currency-${user.id}`, tripCurrency);
    if (!isSupabaseConfigured() || isDemoUser || isLocalTestUser) return;
    const timeoutId = window.setTimeout(async () => {
      const { error } = await supabase.from('user_preferences').upsert({
        user_id: user.id,
        currency,
        updated_at: new Date().toISOString(),
      });
      if (error) console.error('Failed to save cloud currency preference:', error);
    }, 500);
    return () => window.clearTimeout(timeoutId);
  }, [currency, homeCurrency, tripCurrency, user?.id, isDemoUser, isLocalTestUser]);

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
