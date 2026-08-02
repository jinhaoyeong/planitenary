import { createContext, useContext, useState, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import type { Currency, ExchangeRates } from '../lib/currency';
import { fetchExchangeRates, formatCurrency, convertCurrency } from '../lib/currency';
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
  rates: ExchangeRates;
  refreshRates: () => Promise<void>;
  format: (amount: number) => string;
  convert: (amount: number, fromCurrency?: Currency) => number;
  toBase: (amount: number, fromCurrency?: Currency) => number;
}

const CurrencyContext = createContext<CurrencyContextType | undefined>(undefined);

const DISPLAY_KEY = 'selected-currency';
const HOME_KEY = 'home-currency';
const TRIP_KEY = 'trip-currency';
const SUPPORTED: Currency[] = ['MYR', 'CNY'];
const createInitialRates = (): ExchangeRates => ({ MYR: 1, CNY: 1.51, lastUpdated: 0, isLoading: true });

const readCurrency = (key: string, fallback: Currency): Currency => {
  const saved = localStorage.getItem(key);
  return SUPPORTED.includes(saved as Currency) ? (saved as Currency) : fallback;
};

const otherCurrency = (code: Currency): Currency => (code === 'MYR' ? 'CNY' : 'MYR');

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const { user, isDemoUser, isLocalTestUser } = useAuth();
  const cloudReadyRef = useRef(false);
  const [currency, setCurrencyState] = useState<Currency>(() => readCurrency(DISPLAY_KEY, 'MYR'));
  const [homeCurrency, setHomeCurrencyState] = useState<Currency>(() => readCurrency(HOME_KEY, 'MYR'));
  const [tripCurrency, setTripCurrencyState] = useState<Currency>(() => {
    const home = readCurrency(HOME_KEY, 'MYR');
    const trip = readCurrency(TRIP_KEY, otherCurrency(home));
    return trip === home ? otherCurrency(home) : trip;
  });
  const [rates, setRates] = useState<ExchangeRates>(createInitialRates);

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
    const nextTrip = tripCurrency === nextHome ? otherCurrency(nextHome) : tripCurrency;
    const nextDisplay =
      currency === nextHome || currency === nextTrip ? currency : nextHome;
    persistPair(nextHome, nextTrip, nextDisplay);
  };

  const setTripCurrency = (nextTrip: Currency) => {
    const nextHome = homeCurrency === nextTrip ? otherCurrency(nextTrip) : homeCurrency;
    const nextDisplay =
      currency === nextHome || currency === nextTrip ? currency : nextTrip;
    persistPair(nextHome, nextTrip, nextDisplay);
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

  const convert = (amount: number, fromCurrency?: Currency): number =>
    convertCurrency(amount, fromCurrency || 'MYR', currency, rates);

  useEffect(() => {
    cloudReadyRef.current = false;
    if (!user) return;

    const accountDisplay = localStorage.getItem(`selected-currency-${user.id}`);
    const accountHome = localStorage.getItem(`home-currency-${user.id}`);
    const accountTrip = localStorage.getItem(`trip-currency-${user.id}`);

    const nextHome = SUPPORTED.includes(accountHome as Currency) ? (accountHome as Currency) : homeCurrency;
    let nextTrip = SUPPORTED.includes(accountTrip as Currency) ? (accountTrip as Currency) : tripCurrency;
    if (nextTrip === nextHome) nextTrip = otherCurrency(nextHome);
    const nextDisplay = SUPPORTED.includes(accountDisplay as Currency)
      && (accountDisplay === nextHome || accountDisplay === nextTrip)
      ? (accountDisplay as Currency)
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
      if (SUPPORTED.includes(data?.currency as Currency)) {
        const cloudCurrency = data!.currency as Currency;
        // Cloud only stores display currency today — keep home/trip local, snap display if valid.
        if (cloudCurrency === homeCurrency || cloudCurrency === tripCurrency) {
          setCurrencyState(cloudCurrency);
          localStorage.setItem(DISPLAY_KEY, cloudCurrency);
          localStorage.setItem(`selected-currency-${user.id}`, cloudCurrency);
        }
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
    convertCurrency(amount, fromCurrency, 'MYR', rates);

  return (
    <CurrencyContext.Provider
      value={{
        currency,
        setCurrency,
        homeCurrency,
        setHomeCurrency,
        tripCurrency,
        setTripCurrency,
        rates,
        refreshRates,
        format,
        convert,
        toBase,
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
