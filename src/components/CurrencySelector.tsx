import { useCurrency } from '../contexts/CurrencyContext';
import { SUPPORTED_CURRENCIES } from '../lib/currency';
import { RefreshCw, Loader2 } from 'lucide-react';
import { ThemedSelect } from './ui/ThemedSelect';

export function CurrencySelector({ compact = false }: { compact?: boolean }) {
  const { currency, setCurrency, rates, refreshRates } = useCurrency();
  const rate = rates.values[currency];

  return (
    <div className={`flex ${compact ? 'flex-col' : 'flex-col sm:flex-row'} items-stretch sm:items-center gap-2`}>
      <label className="sr-only" htmlFor={`currency-selector-${compact ? 'compact' : 'full'}`}>Budget currency</label>
      <ThemedSelect
        id={`currency-selector-${compact ? 'compact' : 'full'}`}
        value={currency}
        onChange={(event) => setCurrency(event.target.value as typeof currency)}
        className="is-compact w-full sm:min-w-[220px] font-semibold"
      >
        {SUPPORTED_CURRENCIES.map(({ code, name, symbol }) => (
          <option key={code} value={code}>{symbol} {code} — {name}</option>
        ))}
      </ThemedSelect>
      <button
        type="button"
        onClick={() => void refreshRates()}
        disabled={rates.isLoading}
        className="pill-btn pill-soft !py-2 !px-3 justify-center text-xs"
        title={rates.lastUpdated ? `Updated ${new Date(rates.lastUpdated).toLocaleString()}` : 'Loading current rates'}
      >
        {rates.isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        <span>1 MYR = {rate.toLocaleString(undefined, { maximumFractionDigits: 4 })} {currency}</span>
        {rates.isFallback && <span className="text-amber-600">cached</span>}
      </button>
      <a
        href="https://www.exchangerate-api.com"
        target="_blank"
        rel="noreferrer"
        className="self-center text-[10px] underline opacity-60 hover:opacity-100"
      >
        Rates by ExchangeRate-API
      </a>
    </div>
  );
}

export function CompactCurrencySelector() {
  return <CurrencySelector compact />;
}
