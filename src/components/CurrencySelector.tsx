import { useCurrency } from '../contexts/CurrencyContext';
import { RefreshCw, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';
import { motion, AnimatePresence } from 'framer-motion';

export function CurrencySelector() {
  const { currency, setCurrency, rates, refreshRates } = useCurrency();

  const currencies = [
    { code: 'MYR' as const, label: 'MYR', flag: '🇲🇾', name: 'Malaysian Ringgit' },
    { code: 'CNY' as const, label: 'CNY', flag: '🇨🇳', name: 'Chinese Yuan' }
  ];

  return (
    <div className="flex items-center gap-2 sm:gap-3">
      {/* Currency Toggle */}
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-1 flex gap-1 shrink-0">
        {currencies.map((curr) => (
          <button
            key={curr.code}
            onClick={() => setCurrency(curr.code)}
            className={clsx(
              "px-2.5 sm:px-3 py-2 rounded-lg text-xs sm:text-sm font-bold transition-all flex items-center gap-1.5 sm:gap-2 min-w-[60px] sm:min-w-[80px] justify-center",
              currency === curr.code
                ? "bg-emerald-500 text-white shadow-md shadow-emerald-500/20"
                : "text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
            )}
          >
            <span className="text-base sm:text-lg">{curr.flag}</span>
            <span className="text-xs sm:text-sm">{curr.code}</span>
          </button>
        ))}
      </div>

      {/* Rate Display & Refresh */}
      <div className="relative group shrink-0">
        <button
          onClick={refreshRates}
          disabled={rates.isLoading}
          className={clsx(
            "bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 sm:px-3 py-2 text-xs sm:text-sm font-medium transition-all",
            "hover:border-emerald-300 dark:hover:border-emerald-600 flex items-center gap-1.5 sm:gap-2",
            rates.isLoading && "opacity-50 cursor-not-allowed"
          )}
          title={`1 MYR = ${rates.CNY.toFixed(2)} CNY`}
        >
          {rates.isLoading ? (
            <Loader2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-400 animate-spin" />
          ) : (
            <RefreshCw className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-400 group-hover:text-emerald-500 transition-colors" />
          )}
          <span className="text-slate-600 dark:text-slate-300 text-xs sm:text-sm">
            1 MYR = {rates.CNY.toFixed(2)} CNY
          </span>
        </button>

        {/* Last Updated Tooltip */}
        <AnimatePresence>
          {!rates.isLoading && (
            <motion.div
              initial={{ opacity: 0, y: -5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 whitespace-nowrap hidden sm:block"
            >
              <div className="bg-slate-900 text-white text-xs px-2 py-1 rounded-lg">
                Updated {getTimeAgo(rates.lastUpdated)}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function getTimeAgo(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return '1d+ ago';
}

export function CompactCurrencySelector() {
  const { currency, setCurrency, rates, refreshRates } = useCurrency();

  return (
    <div className="flex items-center gap-2 justify-center w-full">
      {/* Compact Toggle */}
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-0.5 flex shrink-0">
        <button
          onClick={() => setCurrency('MYR')}
          className={clsx(
            "px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1",
            currency === 'MYR'
              ? "bg-emerald-500 text-white"
              : "text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
          )}
        >
          <span>🇲🇾</span>
          <span>MYR</span>
        </button>
        <button
          onClick={() => setCurrency('CNY')}
          className={clsx(
            "px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1",
            currency === 'CNY'
              ? "bg-emerald-500 text-white"
              : "text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
          )}
        >
          <span>🇨🇳</span>
          <span>CNY</span>
        </button>
      </div>

      {/* Rate Display */}
      <div className="relative group shrink-0">
        <button
          onClick={refreshRates}
          disabled={rates.isLoading}
          className={clsx(
            "bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 text-xs font-medium transition-all",
            "hover:border-emerald-300 dark:hover:border-emerald-600 flex items-center gap-1",
            rates.isLoading && "opacity-50 cursor-not-allowed"
          )}
        >
          {rates.isLoading ? (
            <Loader2 className="w-3 h-3 text-slate-400 animate-spin" />
          ) : (
            <RefreshCw className="w-3 h-3 text-slate-400" />
          )}
          <span className="text-slate-600 dark:text-slate-300">
            {rates.CNY.toFixed(2)}
          </span>
        </button>
      </div>
    </div>
  );
}
