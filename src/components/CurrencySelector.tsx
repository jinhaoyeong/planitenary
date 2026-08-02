import { Loader2, RefreshCw } from 'lucide-react';
import { clsx } from 'clsx';
import { useCurrency } from '../contexts/CurrencyContext';
import { CURRENCIES, currencyMeta } from '../lib/currencyCatalog';
import type { Currency } from '../lib/currency';

function CurrencySelect({
  value,
  onChange,
  ariaLabel,
}: {
  value: Currency;
  onChange: (currency: Currency) => void;
  ariaLabel: string;
}) {
  return (
    <select
      className="editorial-input w-full"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label={ariaLabel}
    >
      {CURRENCIES.map((option) => (
        <option key={option.code} value={option.code}>
          {option.code} — {option.name}
        </option>
      ))}
    </select>
  );
}

/** Settings: choose home + trip currencies and refresh the rate. */
export function CurrencyPairSettings() {
  const {
    homeCurrency,
    tripCurrency,
    setHomeCurrency,
    setTripCurrency,
    rates,
    refreshRates,
    rateLabel,
  } = useCurrency();

  const homeMeta = currencyMeta(homeCurrency);
  const tripMeta = currencyMeta(tripCurrency);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
            Home currency
          </label>
          <CurrencySelect value={homeCurrency} onChange={setHomeCurrency} ariaLabel="Home currency" />
          <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
            {homeMeta.name} ({homeMeta.symbol})
          </p>
        </div>
        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
            Trip currency
          </label>
          <CurrencySelect value={tripCurrency} onChange={setTripCurrency} ariaLabel="Trip currency" />
          <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
            {tripMeta.name} ({tripMeta.symbol})
          </p>
        </div>
      </div>

      <div
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl px-4 py-3"
        style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)' }}
      >
        <div>
          <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>{rateLabel}</p>
          <p className="text-xs mt-1" style={{ color: 'var(--ink-muted)' }}>
            New trips set this pair automatically from the destination.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refreshRates()}
          disabled={rates.isLoading}
          className="pill-btn pill-soft justify-center shrink-0"
        >
          {rates.isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Refresh rate
        </button>
      </div>
    </div>
  );
}

/** Budget page: compact home/trip display toggle with quiet rate text. */
export function BudgetCurrencyToggle() {
  const { currency, setCurrency, homeCurrency, tripCurrency, rates, rateLabel } = useCurrency();

  const options: Array<{ code: Currency; role: 'Home' | 'Trip' }> =
    homeCurrency === tripCurrency
      ? [{ code: homeCurrency, role: 'Home' }]
      : [
          { code: homeCurrency, role: 'Home' },
          { code: tripCurrency, role: 'Trip' },
        ];

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className="inline-flex rounded-full p-1 gap-1"
        style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)' }}
        role="group"
        aria-label="Show wallet in"
      >
        {options.map((option) => {
          const selected = currency === option.code;
          return (
            <button
              key={`${option.role}-${option.code}`}
              type="button"
              onClick={() => setCurrency(option.code)}
              className={clsx(
                'min-h-9 px-3.5 rounded-full text-xs font-semibold transition-colors inline-flex items-center gap-1.5',
              )}
              style={{
                backgroundColor: selected ? 'var(--accent)' : 'transparent',
                color: selected ? 'var(--accent-ink)' : 'var(--ink-muted)',
              }}
              aria-pressed={selected}
            >
              <span>{option.code}</span>
              <span className="opacity-70 font-medium normal-case tracking-normal">{option.role}</span>
            </button>
          );
        })}
      </div>
      <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
        {rates.isLoading ? 'Updating rate…' : rateLabel}
      </p>
    </div>
  );
}
