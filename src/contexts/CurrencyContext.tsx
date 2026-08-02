import { createContext, useContext, useState, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import type { Currency, ExchangeRates } from '../lib/currency';
import {
  convertCurrency,
  createFallbackRates,
  fetchExchangeRates,
  formatCurrency,
  formatRateLabel,
} from '../lib/currency';
import { isSupportedCurrency } from '../lib/currencyCatalog';
import { useAuth } from './AuthContext';
import { isSupabaseConfigured, supabase } from '../lib/supabase';

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
  /** Adopts the currency pair a trip profile was created with. */
  adoptTripCurrencies: (home: Currency, trip: Currency) => void;
  rates: ExchangeRates;
  refreshRates: () => Promise<void>;
  format: (amount: number) => string;
  formatIn: (amount: number, currency: Currency) => string;
  convert: (amount: number, fromCurrency?: Currency) => number;
  toBase: (amount: number, fromCurrency?: Currency) => number;
  /** e.g. "1 RM = ¥33.20" for the active home → trip pair. */
  rateLabel: string;
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

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const { user, isDemoUser, isLocalTestUser } = useAuth();
  const cloudReadyRef = useRef(false);
  const [currency, setCurrencyState] = useState<Currency>(() => readCurrency(DISPLAY_KEY, BASE));
  const [homeCurrency, setHomeCurrencyState] = useState<Currency>(() => readCurrency(HOME_KEY, BASE));
  const [tripCurrency, setTripCurrencyState] = useState<Currency>(() => {
    const home = readCurrency(HOME_KEY, BASE);
    return readCurrency(TRIP_KEY, home);
  });
  const [rates, setRates] = useState<ExchangeRates>(createFallbackRates);

  const persistPair = (home: Currency, trip: Currency, display?: Currency) => {
    localStorage.setItem(HOME_KEY, home);
    localStorage.setItem(TRIP_KEY, trip);
    const nextDisplay = display && (display === home || display === trip) ? display : home;
    localStorage.setItem(DISPLAY_KEY, nextDisplay);
    setHomeCurrencyState(home);
    setTripCurrencyState(trip);
    setCurrencyState(nextDisplay);
    if (user) {
      localStorage.setItem(`selected-currency-${user.id}`, nextDisplay);
      localStorage.setItem(`home-currency-${user.id}`, home);
      localStorage.setItem(`trip-currency-${user.id}`, trip);
    }
  };

  const setCurrency = (newCurrency: Currency) => {
    if (newCurrency !== homeCurrency && newCurrency !== tripCurrency) return;
    setCurrencyState(newCurrency);
    localStorage.setItem(DISPLAY_KEY, newCurrency);
    if (user) localStorage.setItem(`selected-currency-${user.id}`, newCurrency);
  };

  const setHomeCurrency = (nextHome: Currency) => {
    if (!isSupportedCurrency(nextHome)) return;
    persistPair(nextHome.toUpperCase(), tripCurrency, currency);
  };

  const setTripCurrency = (nextTrip: Currency) => {
    if (!isSupportedCurrency(nextTrip)) return;
    persistPair(homeCurrency, nextTrip.toUpperCase(), currency);
  };

  const adoptTripCurrencies = (home: Currency, trip: Currency) => {
    const nextHome = isSupportedCurrency(home) ? home.toUpperCase() : homeCurrency;
    const nextTrip = isSupportedCurrency(trip) ? trip.toUpperCase() : tripCurrency;
    if (nextHome === homeCurrency && nextTrip === tripCurrency) return;
    persistPair(nextHome, nextTrip, nextHome);
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

    const nextHome = accountHome && isSupportedCurrency(accountHome) ? accountHome.toUpperCase() : homeCurrency;
    const nextTrip = accountTrip && isSupportedCurrency(accountTrip) ? accountTrip.toUpperCase() : tripCurrency;
    const nextDisplay = accountDisplay && (accountDisplay === nextHome || accountDisplay === nextTrip)
      ? accountDisplay
      : nextHome;
    persistPair(nextHome, nextTrip, nextDisplay);

    if (!isSupabaseConfigured() || isDemoUser || isLocalTestUser) {
      cloudReadyRef.current = true;
      return;
    }

    let mounted = true;
    void supabase.from('user_preferences').select('currency').eq('user_id', user.id).maybeSingle().then(({ data, error }) => {
      if (!mounted) return;
      if (error) console.error('Failed to load cloud currency preference:', error);
      const cloudCurrency = typeof data?.currency === 'string' ? data.currency.toUpperCase() : null;
      // Cloud only stores display currency today — keep home/trip local, snap display if valid.
      if (cloudCurrency && (cloudCurrency === nextHome || cloudCurrency === nextTrip)) {
        setCurrencyState(cloudCurrency);
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
        adoptTripCurrencies,
        rates,
        refreshRates,
        format,
        formatIn,
        convert,
        toBase,
        rateLabel: formatRateLabel(homeCurrency, tripCurrency, rates),
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
