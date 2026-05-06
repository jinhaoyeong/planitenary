import { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import type { Currency, ExchangeRates } from '../lib/currency';
import { fetchExchangeRates, formatCurrency, convertCurrency } from '../lib/currency';

interface CurrencyContextType {
  currency: Currency;
  setCurrency: (currency: Currency) => void;
  rates: ExchangeRates;
  refreshRates: () => Promise<void>;
  format: (amount: number) => string;
  convert: (amount: number, fromCurrency?: Currency) => number;
}

const CurrencyContext = createContext<CurrencyContextType | undefined>(undefined);

const CURRENCY_STORAGE_KEY = 'selected-currency';

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [currency, setCurrencyState] = useState<Currency>(() => {
    const saved = localStorage.getItem(CURRENCY_STORAGE_KEY);
    return (saved === 'MYR' || saved === 'CNY') ? saved : 'MYR';
  });

  const [rates, setRates] = useState<ExchangeRates>({
    MYR: 1,
    CNY: 1.51,
    lastUpdated: 0,
    isLoading: true
  });

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

    const intervalId = setInterval(loadRates, 5 * 60 * 1000);
    const handleFocus = () => {
      void loadRates();
    };
    window.addEventListener('focus', handleFocus);

    return () => {
      mounted = false;
      clearInterval(intervalId);
      window.removeEventListener('focus', handleFocus);
    };
  }, []);

  const refreshRates = async () => {
    localStorage.removeItem('exchange-rates'); // Clear cache
    const newRates = await fetchExchangeRates();
    setRates(newRates);
  };

  const format = (amount: number): string => {
    return formatCurrency(amount, currency);
  };

  const convert = (amount: number, fromCurrency?: Currency): number => {
    return convertCurrency(amount, fromCurrency || 'MYR', currency, rates);
  };

  return (
    <CurrencyContext.Provider value={{ currency, setCurrency, rates, refreshRates, format, convert }}>
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
