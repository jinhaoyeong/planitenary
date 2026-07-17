import { createContext, useContext, useState, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import type { Currency, ExchangeRates } from '../lib/currency';
import { SUPPORTED_CURRENCIES, createInitialRates, fetchExchangeRates, formatCurrency, convertCurrency } from '../lib/currency';
import { useAuth } from './AuthContext';
import { isSupabaseConfigured, supabase } from '../lib/supabase';

interface CurrencyContextType {
  currency: Currency;
  setCurrency: (currency: Currency) => void;
  rates: ExchangeRates;
  refreshRates: () => Promise<void>;
  format: (amount: number) => string;
  convert: (amount: number, fromCurrency?: Currency) => number;
  toBase: (amount: number, fromCurrency?: Currency) => number;
}

const CurrencyContext = createContext<CurrencyContextType | undefined>(undefined);

const CURRENCY_STORAGE_KEY = 'selected-currency';

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const { user, isDemoUser, isLocalTestUser } = useAuth();
  const cloudReadyRef = useRef(false);
  const [currency, setCurrencyState] = useState<Currency>(() => {
    const saved = localStorage.getItem(CURRENCY_STORAGE_KEY);
    return SUPPORTED_CURRENCIES.some(({ code }) => code === saved) ? saved as Currency : 'MYR';
  });

  const [rates, setRates] = useState<ExchangeRates>(createInitialRates);

  // Save currency preference
  const setCurrency = (newCurrency: Currency) => {
    setCurrencyState(newCurrency);
    localStorage.setItem(CURRENCY_STORAGE_KEY, newCurrency);
  };

  // Fetch exchange rates on mount
  useEffect(() => {
    let mounted = true;

    const loadRates = async () => {
      if (!mounted) return;
      const newRates = await fetchExchangeRates();
      if (mounted) {
        setRates(newRates);
      }
    };

    loadRates();

    const intervalId = setInterval(loadRates, 15 * 60 * 1000);
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
    const newRates = await fetchExchangeRates(true);
    setRates(newRates);
  };

  const format = (amount: number): string => {
    return formatCurrency(amount, currency);
  };

  const convert = (amount: number, fromCurrency?: Currency): number => {
    return convertCurrency(amount, fromCurrency || 'MYR', currency, rates);
  };

  useEffect(() => {
    cloudReadyRef.current = false;
    if (!user) return;
    const accountKey = `selected-currency-${user.id}`;
    const accountCurrency = localStorage.getItem(accountKey);
    if (SUPPORTED_CURRENCIES.some(({ code }) => code === accountCurrency)) {
      setCurrencyState(accountCurrency as Currency);
    }
    if (!isSupabaseConfigured() || isDemoUser || isLocalTestUser) {
      cloudReadyRef.current = true;
      return;
    }
    let mounted = true;
    void supabase.from('user_preferences').select('currency').eq('user_id', user.id).maybeSingle().then(({ data, error }) => {
      if (!mounted) return;
      if (error) console.error('Failed to load cloud currency preference:', error);
      if (SUPPORTED_CURRENCIES.some(({ code }) => code === data?.currency)) {
        const cloudCurrency = data!.currency as Currency;
        setCurrencyState(cloudCurrency);
        localStorage.setItem(accountKey, cloudCurrency);
        localStorage.setItem(CURRENCY_STORAGE_KEY, cloudCurrency);
      }
      cloudReadyRef.current = true;
    });
    return () => { mounted = false; };
  }, [user?.id, isDemoUser, isLocalTestUser]);

  useEffect(() => {
    if (!user || !cloudReadyRef.current) return;
    localStorage.setItem(`selected-currency-${user.id}`, currency);
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
  }, [currency, user?.id, isDemoUser, isLocalTestUser]);

  const toBase = (amount: number, fromCurrency: Currency = currency): number => {
    return convertCurrency(amount, fromCurrency, 'MYR', rates);
  };

  return (
    <CurrencyContext.Provider value={{ currency, setCurrency, rates, refreshRates, format, convert, toBase }}>
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency() {
  const context = useContext(CurrencyContext);
  if (context === undefined) {
    throw new Error('useCurrency must be used within a CurrencyProvider');
  }
  return context;
}
