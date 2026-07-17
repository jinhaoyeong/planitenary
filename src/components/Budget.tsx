import React, { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Plane, Hotel, Train, Utensils, Ticket, CreditCard, DollarSign, Calendar, Edit2, Save, Plus, X, Wallet, Receipt } from 'lucide-react';
import type { Itinerary } from '../data';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { loadFromStorage, saveToStorage } from '../lib/storageResilience';
import { clsx } from 'clsx';
import { useCurrency } from '../contexts/CurrencyContext';
import { CurrencySelector, CompactCurrencySelector } from './CurrencySelector';
import { getCurrencySymbol } from '../lib/currency';
import { useAuth } from '../contexts/AuthContext';

interface BudgetItem {
  id: string;
  label: string;
  cost: string;
}

interface BudgetCategory {
  min: number;
  max: number;
  items: BudgetItem[];
}

interface BudgetRange {
  min: number;
  max: number;
}

type BudgetCategoryKey = 'flights' | 'accommodation' | 'transportation' | 'food' | 'activities' | 'misc';

export interface ExpenseRecord {
  id: string;
  description: string;
  amountMYR: number;
  amountCNY: number;
  paidBy: 'Traveler 1' | 'Traveler 2';
  category: BudgetCategoryKey | 'general';
  date: string;
}

export interface CustomBudget {
  flights: BudgetCategory;
  accommodation: BudgetCategory;
  transportation: BudgetCategory;
  food: BudgetCategory;
  activities: BudgetCategory;
  misc: BudgetCategory;
  expenses: ExpenseRecord[];
}

interface BudgetStorageMeta {
  updatedAt: string;
}

const getBudgetStorageKey = (itineraryId: string) => `budget-${itineraryId}`;

const getBudgetMetaStorageKey = (itineraryId: string) => `budget-meta-${itineraryId}`;

const getTimestampValue = (value?: string) => {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(parsed) ? 0 : parsed;
};

const persistBudgetToStorage = (itineraryId: string, budget: CustomBudget, updatedAt: string) => {
  saveToStorage(getBudgetStorageKey(itineraryId), budget);
  saveToStorage(getBudgetMetaStorageKey(itineraryId), { updatedAt });
};

const normalizeBudget = (budget: CustomBudget | null | undefined): CustomBudget | null => {
  if (!budget) return null;
  return {
    ...budget,
    expenses: budget.expenses || []
  };
};

const createDefaultBudget = (
  transportMYR: number,
  foodMYR: number,
  activitiesMYR: number,
  costs: {
    transport: { details: BudgetItem[] };
    food: { details: BudgetItem[] };
    activities: { details: BudgetItem[] };
  }
): CustomBudget => ({
  flights: {
    min: 0,
    max: 0,
    items: []
  },
  accommodation: {
    min: 0,
    max: 0,
    items: []
  },
  transportation: { min: transportMYR, max: transportMYR, items: costs.transport.details },
  food: { min: foodMYR, max: foodMYR, items: costs.food.details },
  activities: { min: activitiesMYR, max: activitiesMYR, items: costs.activities.details },
  misc: {
    min: 0,
    max: 0,
    items: []
  },
  expenses: []
});

interface BudgetCardProps {
  title: string;
  range: string;
  description: string;
  icon: React.ElementType;
  color: string;
  percentage?: number;
  details?: BudgetItem[];
  min?: number;
  max?: number;
  parseCost?: (cost: string) => number;
}

const BudgetCard = ({
  title,
  range,
  description,
  icon: Icon,
  percentage,
  details,
  isEditing,
  onUpdateRange,
  onAddItem,
  onUpdateItem,
  onDeleteItem,
  categoryKey,
  currencySymbol,
  getDisplayItemCost,
  min,
  max,
  parseCost
}: BudgetCardProps & {
  isEditing: boolean;
  onUpdateRange: (type: 'min' | 'max', value: string) => void;
  onAddItem: (category: BudgetCategoryKey) => void;
  onUpdateItem: (id: string, field: 'label' | 'cost', value: string) => void;
  onDeleteItem: (id: string) => void;
  categoryKey: BudgetCategoryKey;
  currencySymbol: string;
  getDisplayItemCost: (item: BudgetItem) => string;
  min?: number;
  max?: number;
  parseCost?: (cost: string) => number;
}) => {
  const [minInput, setMinInput] = React.useState(min?.toString() ?? '');
  const [maxInput, setMaxInput] = React.useState(max?.toString() ?? '');

  React.useEffect(() => {
    if (!isEditing) return;
    setMinInput(min?.toString() ?? '');
  }, [min, isEditing]);

  React.useEffect(() => {
    if (!isEditing) return;
    setMaxInput(max?.toString() ?? '');
  }, [max, isEditing]);

  const handleRangeChange = (type: 'min' | 'max', value: string) => {
    if (!/^\d*$/.test(value)) return;
    if (type === 'min') {
      setMinInput(value);
      onUpdateRange('min', value);
      return;
    }
    setMaxInput(value);
    onUpdateRange('max', value);
  };

  const handleRangeBlur = (type: 'min' | 'max') => {
    if (type === 'min') {
      if (minInput.trim() === '') {
        onUpdateRange('min', '0');
        setMinInput('0');
      }
      return;
    }
    if (maxInput.trim() === '') {
      onUpdateRange('max', '0');
      setMaxInput('0');
    }
  };

  return (
    <div className="bg-white dark:bg-slate-900 p-4 md:p-6 rounded-3xl shadow-sm border border-slate-100 dark:border-slate-800 hover:shadow-lg hover:-translate-y-1 transition-all relative overflow-hidden group h-full flex flex-col">
      <div className="flex justify-between items-start mb-4">
        <div className="p-2.5 md:p-3 rounded-3xl bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 group-hover:bg-rose-50 dark:group-hover:bg-rose-900/30 group-hover:text-rose-500 dark:group-hover:text-rose-400 transition-colors shrink-0">
          <Icon className="w-5 h-5 md:w-6 md:h-6" />
        </div>
        {percentage && (
          <span className="px-2 py-1 bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-[11px] md:text-xs font-bold rounded-xl border border-slate-100 dark:border-slate-700 group-hover:border-rose-100 dark:group-hover:border-rose-900/50 group-hover:text-rose-500 dark:group-hover:text-rose-400 transition-colors shrink-0">
            {percentage}%
          </span>
        )}
      </div>

      <h3 className="text-base md:text-lg font-bold text-slate-800 dark:text-white mb-1 group-hover:text-slate-900 dark:group-hover:text-slate-100 transition-colors leading-tight">{title}</h3>

      {isEditing ? (
        <div className="grid grid-cols-2 gap-2 mb-2 w-full">
          <span className="col-span-2 text-xs text-slate-500 dark:text-slate-400">Range ({currencySymbol})</span>
          <input
            type="text"
            inputMode="numeric"
            value={minInput}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => handleRangeChange('min', e.target.value)}
            onBlur={() => handleRangeBlur('min')}
            className="editorial-input is-compact" style={{ textAlign: 'center', fontWeight: 700 }}
            placeholder="Min"
          />
          <input
            type="text"
            inputMode="numeric"
            value={maxInput}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => handleRangeChange('max', e.target.value)}
            onBlur={() => handleRangeBlur('max')}
            className="editorial-input is-compact" style={{ textAlign: 'center', fontWeight: 700 }}
            placeholder="Max"
          />
        </div>
      ) : (
        <div className="text-xl md:text-2xl font-bold text-slate-900 dark:text-slate-200 mb-2 leading-tight break-words">{range}</div>
      )}
      
      <p className="text-xs md:text-sm text-slate-500 dark:text-slate-400 mb-4 min-h-[40px]">{description}</p>

      <div className="mt-auto pt-4 border-t border-slate-50 dark:border-slate-800 space-y-2">
        <h4 className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2 group-hover:text-rose-400 transition-colors">Estimated Costs</h4>

        {details && details.map((detail, idx) => (
          isEditing && detail.id ? (
            <div key={detail.id} className="flex flex-col sm:flex-row gap-1.5 sm:gap-1 sm:items-center">
              <input
                value={detail.label}
                onChange={(e) => onUpdateItem(detail.id!, 'label', e.target.value)}
                className="editorial-input is-compact flex-1 min-w-0"
                placeholder="Item"
              />
              <div className="flex gap-1.5 sm:gap-1 items-center">
                <input
                  type="number"
                  value={parseCost?.(detail.cost) || 0}
                  onChange={(e) => onUpdateItem(detail.id!, 'cost', `${currencySymbol} ${e.target.value}`)}
                  className="editorial-input is-compact w-full sm:w-20" style={{ textAlign: 'right' }}
                  placeholder={currencySymbol}
                />
                <button onClick={() => onDeleteItem(detail.id!)} className="text-red-400 hover:text-red-600 p-1.5 flex-shrink-0">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          ) : (
            <div key={idx} className="flex justify-between gap-2 text-xs md:text-sm">
              <span className="text-slate-600 dark:text-slate-300 break-words">{detail.label}</span>
              <span className="font-medium text-slate-800 dark:text-slate-200 whitespace-nowrap shrink-0">{getDisplayItemCost(detail)}</span>
            </div>
          )
        ))}

        {isEditing && (
          <button 
            onClick={() => onAddItem(categoryKey)}
            className="w-full py-1.5 text-xs bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-xl flex items-center justify-center gap-1 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 font-medium mt-2"
          >
            <Plus className="w-3 h-3" /> Add Item
          </button>
        )}
      </div>
      
      {/* Progress Bar Visual */}
      {!isEditing && percentage && (
        <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-800 rounded-xl mt-4 overflow-hidden">
          <div 
            className="h-full bg-slate-800 dark:bg-rose-500 group-hover:bg-rose-500 transition-colors duration-500"
            style={{ width: `${percentage}%` }}
          ></div>
        </div>
      )}
    </div>
  );
};

export const Budget = ({ itinerary }: { itinerary: Itinerary }) => {
  const { user, isDemoUser, isLocalTestUser } = useAuth();
  const cloudEnabled = Boolean(user?.id && isSupabaseConfigured() && !isDemoUser && !isLocalTestUser);
  const [activeView, setActiveView] = React.useState<'budget' | 'expenses'>('budget');
  const { currency, convert, toBase, rates } = useCurrency();
  const currencySymbol = getCurrencySymbol(currency);
  const [customBudget, setCustomBudget] = React.useState<CustomBudget>(createDefaultBudget(0, 0, 0, {
    transport: { details: [] },
    food: { details: [] },
    activities: { details: [] }
  }));

  const [isEditing, setIsEditing] = React.useState(false);
  const [showAddItemModal, setShowAddItemModal] = React.useState(false);
  const [addItemCategory, setAddItemCategory] = React.useState<BudgetCategoryKey | null>(null);
  const [draftItem, setDraftItem] = React.useState({ label: '', cost: '' });
  const budgetSyncReadyRef = React.useRef(false);
  const hasLocalBudgetRef = React.useRef(false);

  const costs = React.useMemo(() => {
    let transportCost = 0;
    let foodCost = 0;
    let activityCost = 0;

    const transportDetails: BudgetItem[] = [];
    const foodDetails: BudgetItem[] = [];
    const activityDetails: BudgetItem[] = [];

    itinerary.days.forEach(day => {
      day.activities.forEach((activity, i) => {
        if (activity.cost) {
          const matches = activity.cost.match(/(\d+(\.\d+)?)/g);
          if (matches && matches.length > 0) {
            const values = matches.map(parseFloat);
            // Cost in itinerary is in RMB
            const costInRMB = values.reduce((a, b) => a + b, 0) / values.length;
            const costInMYR = toBase(costInRMB, 'CNY');

            const item = { id: `auto-${day.day}-${i}`, label: activity.name, cost: activity.cost };
            if (activity.type === 'travel') {
              transportCost += costInMYR;
              transportDetails.push(item);
            } else if (activity.type === 'food') {
              foodCost += costInMYR;
              foodDetails.push(item);
            } else if (activity.type === 'sight' || activity.type === 'culture' || activity.type === 'nature') {
              activityCost += costInMYR;
              activityDetails.push(item);
            }
          }
        }
      });
    });

    return {
      transport: { total: transportCost, details: transportDetails },
      food: { total: foodCost, details: foodDetails },
      activities: { total: activityCost, details: activityDetails }
    };
  }, [itinerary, toBase]);

  const transportMYR = Math.ceil(costs.transport.total);
  const foodMYR = Math.ceil(costs.food.total);
  const activitiesMYR = Math.ceil(costs.activities.total);

  useEffect(() => {
    budgetSyncReadyRef.current = false;
    hasLocalBudgetRef.current = false;
    const storageKey = getBudgetStorageKey(itinerary.id);
    const saved = normalizeBudget(loadFromStorage<CustomBudget>(storageKey));
    const savedMeta = loadFromStorage<BudgetStorageMeta>(getBudgetMetaStorageKey(itinerary.id));
    const localUpdatedAt = savedMeta?.updatedAt;
    const defaultBudget = createDefaultBudget(transportMYR, foodMYR, activitiesMYR, costs);
    const initialBudget = saved || defaultBudget;
    
    // Set initial budget immediately
    setCustomBudget(initialBudget);

    const syncBudgetToSupabase = async (budget: CustomBudget, updatedAt: string) => {
      const { error } = await supabase
        .from('budgets')
        .upsert({ id: itinerary.id, user_id: user?.id, data: budget, updated_at: updatedAt });
      if (error) console.error('Error syncing budget:', error);
    };

    if (saved) {
      hasLocalBudgetRef.current = true;
    }

    if (cloudEnabled) {
      const fetchBudget = async () => {
        const { data, error } = await supabase
          .from('budgets')
          .select('data, updated_at')
          .eq('id', itinerary.id)
          .single();

        if (data && data.data) {
          const remoteBudget = normalizeBudget(data.data as CustomBudget) || defaultBudget;
          const remoteUpdatedAt = data.updated_at || new Date().toISOString();
          const shouldPreferLocal = Boolean(saved) && (!localUpdatedAt || getTimestampValue(localUpdatedAt) >= getTimestampValue(remoteUpdatedAt));

          if (shouldPreferLocal && saved) {
            const localSnapshotUpdatedAt = localUpdatedAt || new Date().toISOString();
            persistBudgetToStorage(itinerary.id, saved, localSnapshotUpdatedAt);
            hasLocalBudgetRef.current = true;
            budgetSyncReadyRef.current = true;
            await syncBudgetToSupabase(saved, localSnapshotUpdatedAt);
            return;
          }

          setCustomBudget(remoteBudget);
          persistBudgetToStorage(itinerary.id, remoteBudget, remoteUpdatedAt);
          hasLocalBudgetRef.current = true;
          budgetSyncReadyRef.current = true;
        } else if (error && error.code === 'PGRST116') {
          const fallbackBudget = saved || defaultBudget;
          const fallbackUpdatedAt = localUpdatedAt || new Date().toISOString();
          persistBudgetToStorage(itinerary.id, fallbackBudget, fallbackUpdatedAt);
          hasLocalBudgetRef.current = true;
          budgetSyncReadyRef.current = true;
          await syncBudgetToSupabase(fallbackBudget, fallbackUpdatedAt);
        } else if (error && error.code !== 'PGRST116') {
          console.error('Error fetching budget:', error);
          budgetSyncReadyRef.current = true; // allow local saving to proceed
        }
      };
      fetchBudget();

      const subscription = supabase
        .channel('budgets')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'budgets', filter: `id=eq.${itinerary.id}` }, (payload) => {
          const nextPayload = payload.new as { data?: CustomBudget } | null;
          if (nextPayload?.data) {
            const newData = nextPayload.data;
            const nextUpdatedAt = payload.commit_timestamp || new Date().toISOString();
            setCustomBudget(prev => {
              const isDifferent = JSON.stringify(newData) !== JSON.stringify(prev);
              if (!isDifferent) return prev;
              persistBudgetToStorage(itinerary.id, newData, nextUpdatedAt);
              return newData;
            });
          }
        })
        .subscribe();

      return () => {
        subscription.unsubscribe();
      };
    }
    if (!saved) {
      persistBudgetToStorage(itinerary.id, defaultBudget, new Date().toISOString());
      hasLocalBudgetRef.current = true;
    }
    // Delay marking ready to prevent the defaultBudget re-triggering the save hook below
    // before the async loads complete.
    setTimeout(() => {
      budgetSyncReadyRef.current = true;
    }, 100);
  }, [itinerary.id, transportMYR, foodMYR, activitiesMYR, costs]); // Explicitly include dependencies

  useEffect(() => {
    if (!budgetSyncReadyRef.current) return;
    const updatedAt = new Date().toISOString();
    
    // Prevent overriding real data with defaults just because the initial sync isn't ready
    if (!hasLocalBudgetRef.current && 
        JSON.stringify(customBudget.food.items) === '[]' && 
        JSON.stringify(customBudget.transportation.items) === '[]' && 
        JSON.stringify(customBudget.activities.items) === '[]') return;
        
    persistBudgetToStorage(itinerary.id, customBudget, updatedAt);
    hasLocalBudgetRef.current = true;
    
    if (cloudEnabled) {
      const syncToSupabase = async () => {
        const { error } = await supabase
          .from('budgets')
          .upsert({ id: itinerary.id, user_id: user?.id, data: customBudget, updated_at: updatedAt });
        
        if (error) console.error('Error syncing budget:', error);
      };
      const timeout = setTimeout(syncToSupabase, 1000);
      return () => clearTimeout(timeout);
    }
  }, [customBudget, itinerary.id, cloudEnabled, user?.id]);

  const updateRange = (category: BudgetCategoryKey, type: 'min' | 'max', value: string) => {
    const numValue = parseInt(value) || 0;
    // Convert from selected currency back to MYR for storage
    const valueInMYR = Math.round(toBase(numValue));
    setCustomBudget(prev => ({
      ...prev,
      [category]: {
        ...prev[category],
        [type]: valueInMYR
      }
    }));
  };

  const updateCustomItem = (category: BudgetCategoryKey, id: string, field: 'label' | 'cost', value: string) => {
    setCustomBudget(prev => ({
      ...prev,
      [category]: {
        ...prev[category],
        items: prev[category].items.map(item => 
          item.id === id ? { ...item, [field]: value } : item
        )
      }
    }));
  };

  const [showAddExpenseModal, setShowAddExpenseModal] = React.useState(false);
  const [expenseDraft, setExpenseDraft] = React.useState<Partial<ExpenseRecord>>({
    description: '',
    amountMYR: 0,
    paidBy: 'Traveler 1',
    category: 'general',
  });
  
  const handleAddExpense = () => {
    if (!expenseDraft.description || !expenseDraft.amountMYR) return;
    
    const newExpense: ExpenseRecord = {
      id: Date.now().toString(),
      description: expenseDraft.description,
      amountMYR: expenseDraft.amountMYR,
      amountCNY: expenseDraft.amountMYR * rates.values.CNY,
      paidBy: expenseDraft.paidBy as 'Traveler 1' | 'Traveler 2',
      category: expenseDraft.category as BudgetCategoryKey | 'general',
      date: new Date().toISOString(),
    };

    setCustomBudget(prev => ({
      ...prev,
      expenses: [...(prev.expenses || []), newExpense]
    }));
    
    setShowAddExpenseModal(false);
    setExpenseDraft({
      description: '',
      amountMYR: 0,
      paidBy: 'Traveler 1',
      category: 'general',
    });
  };

  const deleteExpense = (id: string) => {
    setCustomBudget(prev => ({
      ...prev,
      expenses: (prev.expenses || []).filter(e => e.id !== id)
    }));
  };

  const getExpensesTotal = () => {
    const expenses = customBudget.expenses || [];
    return expenses.reduce((sum, expense) => sum + convert(expense.amountMYR, 'MYR'), 0);
  };

  const deleteCustomItem = (category: BudgetCategoryKey, id: string) => {
    setCustomBudget(prev => ({
      ...prev,
      [category]: {
        ...prev[category],
        items: prev[category].items.filter((item) => item.id !== id)
      }
    }));
  };
  const openAddItemModal = (category: BudgetCategoryKey) => {
    setAddItemCategory(category);
    setDraftItem({ label: '', cost: '' });
    setShowAddItemModal(true);
  };

  const confirmAddCategoryItem = () => {
    if (!addItemCategory || !draftItem.label.trim()) return;
    const formattedCost = draftItem.cost.trim()
      ? draftItem.cost.trim().startsWith(currencySymbol)
        ? draftItem.cost.trim()
        : `${currencySymbol} ${draftItem.cost.trim()}`
      : `${currencySymbol} 0`;

    setCustomBudget(prev => ({
      ...prev,
      [addItemCategory]: {
        ...prev[addItemCategory],
        items: [...prev[addItemCategory].items, { id: Date.now().toString(), label: draftItem.label.trim(), cost: formattedCost }]
      }
    }));
    setShowAddItemModal(false);
    setAddItemCategory(null);
    setDraftItem({ label: '', cost: '' });
  };

  const getCategoryItems = (category: BudgetCategoryKey) => {
    return customBudget[category]?.items || [];
  };

  const parseBudgetItemCost = (value: string) => {
    if (!value) return 0;
    const normalized = value.replace(/,/g, '').trim();
    if (/^\d+(\.\d+)?$/.test(normalized)) return Number(normalized);
    if (!/rm/i.test(normalized)) return 0;
    const match = normalized.match(/(\d+(\.\d+)?)/);
    if (!match) return 0;
    return Number(match[1]) || 0;
  };

  const getItemsTotal = (items: BudgetItem[]) => {
    return items.reduce((sum, item) => sum + parseBudgetItemCost(item.cost), 0);
  };

  // Helper to convert budget item cost to selected currency for display
  const getDisplayCost = (cost: string): string => {
    const costValue = parseBudgetItemCost(cost);
    // Budget items are stored in MYR format, so we convert to selected currency
    const convertedValue = convert(costValue, 'MYR');
    if (cost.includes('/ pax')) {
      return `${currencySymbol} ${convertedValue.toLocaleString()} / pax`;
    }
    if (cost.includes('Nights')) {
      return `${cost.replace('RM ', '').replace('RM', '')} Nights`;
    }
    return `${currencySymbol} ${convertedValue.toLocaleString()}`;
  };

  // Helper to get raw cost for display in non-editing mode
  const getDisplayItemCost = (item: BudgetItem): string => {
    return getDisplayCost(item.cost);
  };

  const getCategoryRange = (category: BudgetCategoryKey, fallbackMin: number, fallbackMax: number): BudgetRange => {
    const categoryData = customBudget[category];
    const baseMin = categoryData?.min ?? fallbackMin;
    const baseMax = categoryData?.max ?? fallbackMax;
    const itemsTotal = getItemsTotal(categoryData?.items || []);
    const adjustedMax = Math.max(baseMax, itemsTotal);
    const adjustedMin = Math.min(baseMin, adjustedMax);
    return { min: adjustedMin, max: adjustedMax };
  };

  const flightsRange = getCategoryRange('flights', customBudget.flights.min, customBudget.flights.max);
  const accommodationRange = getCategoryRange('accommodation', customBudget.accommodation.min, customBudget.accommodation.max);
  const transportationRange = getCategoryRange(
    'transportation',
    customBudget.transportation?.min || transportMYR,
    customBudget.transportation?.max || (transportMYR + 300)
  );
  const foodRange = getCategoryRange(
    'food',
    customBudget.food?.min || foodMYR,
    customBudget.food?.max || (foodMYR + 500)
  );
  const activitiesRange = getCategoryRange(
    'activities',
    customBudget.activities?.min || activitiesMYR,
    customBudget.activities?.max || (activitiesMYR + 200)
  );
  const miscRange = getCategoryRange('misc', customBudget.misc.min, customBudget.misc.max);

  const categoryLabels: Record<BudgetCategoryKey, string> = {
    flights: 'Flights',
    accommodation: 'Accommodation',
    transportation: 'Transportation',
    food: 'Food & Dining',
    activities: 'Activities',
    misc: 'Misc & Shopping'
  };

  const totalMin = flightsRange.min + accommodationRange.min + transportationRange.min + foodRange.min + activitiesRange.min + miscRange.min;
  const totalMax = flightsRange.max + accommodationRange.max + transportationRange.max + foodRange.max + activitiesRange.max + miscRange.max;

  return (
    <div className="space-y-6 md:space-y-8 pb-20">

      {/* Header Section */}
      <div className="text-center max-w-4xl mx-auto mb-6 md:mb-10 px-4">
        <div className="py-4">
          <span className="eyebrow">The wallet · what it'll cost</span>
          <h2
            className="mt-4 font-display text-5xl md:text-7xl leading-[0.95] tracking-tight"
            style={{ color: 'var(--ink)' }}
          >
            Where the <span className="font-display-italic" style={{ color: 'var(--accent)' }}>money</span> goes.
          </h2>
          <p className="mt-5 max-w-2xl mx-auto text-base md:text-lg leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
            {activeView === 'budget'
              ? `Plan the budget for ${itinerary.cities.length > 0 ? itinerary.cities.join(' & ') : 'your trip'}.`
              : 'Track expenses as your trip takes shape.'}
            <span className="block text-sm mt-1 font-display-italic">
              shown in {currencySymbol} ({currency})
            </span>
          </p>

          {/* Segmented Control for Views */}
          <div className="flex justify-center mb-6">
            <div className="bg-slate-100 dark:bg-slate-800 p-1 rounded-2xl flex items-center shadow-inner inline-flex">
              <button
                onClick={() => setActiveView('budget')}
                className={clsx(
                  "px-4 md:px-6 py-2.5 rounded-xl text-sm font-bold transition-all duration-200 flex items-center gap-2",
                  activeView === 'budget'
                    ? "bg-white dark:bg-slate-700 text-emerald-600 dark:text-emerald-400 shadow-sm"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                )}
              >
                <DollarSign className="w-4 h-4" />
                Budget Plan
              </button>
              <button
                onClick={() => setActiveView('expenses')}
                className={clsx(
                  "px-4 md:px-6 py-2.5 rounded-xl text-sm font-bold transition-all duration-200 flex items-center gap-2",
                  activeView === 'expenses'
                    ? "bg-white dark:bg-slate-700 text-emerald-600 dark:text-emerald-400 shadow-sm"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                )}
              >
                <Receipt className="w-4 h-4" />
                Actual Expenses
              </button>
            </div>
          </div>

          {/* Currency Selector and Edit Button - Separate section below title */}
          <div className="flex flex-col sm:flex-row justify-center items-stretch sm:items-center gap-3 sm:gap-4 w-full">
            {/* Mobile: Compact Selector | Desktop: Full Selector */}
            <div className="sm:hidden w-full flex justify-center">
              <CompactCurrencySelector />
            </div>
            <div className="hidden sm:block max-w-full overflow-x-auto">
              <CurrencySelector />
            </div>
            {/* Edit Button */}
            {activeView === 'budget' && (
              <button
                onClick={() => setIsEditing(!isEditing)}
                className={clsx(
                  "flex items-center justify-center gap-2 px-4 py-2.5 rounded-3xl text-xs font-bold transition-all border shrink-0 w-full sm:w-auto",
                  isEditing
                    ? "bg-rose-500 text-white shadow-lg shadow-rose-500/30 border-rose-600"
                    : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-emerald-200 dark:hover:border-emerald-500/50 hover:text-emerald-600 dark:hover:text-emerald-400"
                )}
              >
                {isEditing ? <Save className="w-4 h-4" /> : <Edit2 className="w-4 h-4" />}
                {isEditing ? 'Done' : 'Edit'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Total Budget Banner */}
      {activeView === 'budget' && (
        <div className="editorial-card p-6 md:p-12 text-center relative overflow-hidden">
          <div className="relative z-10">
            <div className="eyebrow justify-center mb-4">Total estimate</div>
            <div
              className="font-display text-5xl sm:text-6xl md:text-[7rem] leading-[0.92] break-words tracking-tight"
              style={{ color: 'var(--ink)' }}
            >
              {currencySymbol}{convert(totalMin, 'MYR').toLocaleString()}
              <span className="font-display-italic mx-2 md:mx-4" style={{ color: 'var(--accent)' }}>—</span>
              {currencySymbol}{convert(totalMax, 'MYR').toLocaleString()}
            </div>
            <div className="text-base md:text-lg mt-6 mb-8" style={{ color: 'var(--ink-muted)' }}>
              A flexible budget range based on the current handbook details.
            </div>

            <div className="flex flex-col sm:flex-row justify-center gap-3 md:gap-4 text-xs md:text-sm font-medium">
              <span className="bg-slate-50 dark:bg-slate-800 px-3 md:px-4 py-1.5 rounded-xl flex items-center justify-center gap-2 border-2 border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300">
                <Calendar className="w-4 h-4 text-slate-400 dark:text-slate-500" /> {itinerary.days.length} Day{itinerary.days.length === 1 ? '' : 's'}
              </span>
              <span className="bg-slate-50 dark:bg-slate-800 px-3 md:px-4 py-1.5 rounded-xl flex items-center justify-center gap-2 border-2 border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300">
                <CreditCard className="w-4 h-4 text-slate-400 dark:text-slate-500" /> Editable starter
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Actual Expenses Tracker */}
      {activeView === 'expenses' && (
        <div className="bg-white dark:bg-slate-900 rounded-3xl p-4 md:p-6 border border-slate-100 dark:border-slate-800 shadow-sm">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 md:p-3 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-3xl">
                <Wallet className="w-5 h-5 md:w-6 md:h-6" />
              </div>
              <div>
                <h3 className="text-lg md:text-xl font-bold text-slate-900 dark:text-white">Actual Expenses</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400">Track your total spending during the trip</p>
              </div>
            </div>
            <button
              onClick={() => setShowAddExpenseModal(true)}
              className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-2xl text-sm font-bold transition-colors w-full sm:w-auto justify-center"
            >
              <Plus className="w-4 h-4" /> Add Expense
            </button>
          </div>

          {/* Settlement Summary */}
          <div className="grid grid-cols-1 gap-3 mb-4">
            <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl border border-slate-100 dark:border-slate-700/50 text-center">
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Total Spent</div>
              <div className="text-xl font-bold text-slate-900 dark:text-white">
                {currencySymbol} {getExpensesTotal().toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>
          </div>

          {/* Expenses List */}
          <div className="space-y-2.5">
            {(customBudget.expenses || []).length === 0 ? (
              <div className="text-center py-4 text-slate-400 dark:text-slate-500 text-sm">
                No expenses recorded yet. Start tracking your spending!
              </div>
            ) : (
              [...(customBudget.expenses || [])].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map(expense => (
                <div key={expense.id} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-700/50 group">
                  <div className="flex-1 min-w-0 pr-3">
                    <div className="font-bold text-slate-900 dark:text-white text-sm truncate">
                      {expense.description}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-2">
                      <span>{new Date(expense.date).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 sm:gap-4 shrink-0">
                    <div className="text-right">
                      <div className="font-bold text-slate-900 dark:text-white text-sm sm:text-base">
                        {currencySymbol} {convert(expense.amountMYR, 'MYR').toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                    </div>
                    <button 
                      onClick={() => deleteExpense(expense.id)}
                      className="p-2 text-slate-300 hover:text-red-500 dark:text-slate-600 dark:hover:text-red-400 transition-colors"
                      title="Delete expense"
                    >
                      <X className="w-4 h-4 sm:w-5 sm:h-5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Breakdown Cards Grid */}
      {activeView === 'budget' && (
        <motion.div 
          initial="hidden"
          animate="visible"
          variants={{
            hidden: { opacity: 0 },
            visible: { opacity: 1, transition: { staggerChildren: 0.1 } }
          }}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6 mt-8"
        >
        <motion.div variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: 'easeOut' } } }} className="relative group">
          <BudgetCard
            title="Flights"
            range={`${currencySymbol} ${convert(flightsRange.min, 'MYR').toLocaleString()} - ${currencySymbol} ${convert(flightsRange.max, 'MYR').toLocaleString()}`}
            description="Add your expected flights or leave this empty until plans are confirmed."
            icon={Plane}
            color="text-slate-900"
            percentage={35}
            details={getCategoryItems('flights')}
            isEditing={isEditing}
            onUpdateRange={(t, v) => updateRange('flights', t, v)}
            onAddItem={openAddItemModal}
            onUpdateItem={(id, f, v) => updateCustomItem('flights', id, f, v)}
            onDeleteItem={(id) => deleteCustomItem('flights', id)}
            categoryKey="flights"
            currencySymbol={currencySymbol}
            getDisplayItemCost={getDisplayItemCost}
            min={Math.round(convert(customBudget.flights.min, 'MYR'))}
            max={Math.round(convert(customBudget.flights.max, 'MYR'))}
            parseCost={parseBudgetItemCost}
          />
        </motion.div>

        <motion.div variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: 'easeOut' } } }} className="relative group">
          <BudgetCard
            title="Accommodation"
            range={`${currencySymbol} ${convert(accommodationRange.min, 'MYR').toLocaleString()} - ${currencySymbol} ${convert(accommodationRange.max, 'MYR').toLocaleString()}`}
            description="10 nights in 3-4 star hotels or premium Airbnbs. Approx RM 150-300 per night."
            icon={Hotel}
            color="text-slate-900"
            percentage={25}
            details={getCategoryItems('accommodation')}
            isEditing={isEditing}
            onUpdateRange={(t, v) => updateRange('accommodation', t, v)}
            onAddItem={openAddItemModal}
            onUpdateItem={(id, f, v) => updateCustomItem('accommodation', id, f, v)}
            onDeleteItem={(id) => deleteCustomItem('accommodation', id)}
            categoryKey="accommodation"
            currencySymbol={currencySymbol}
            getDisplayItemCost={getDisplayItemCost}
            min={Math.round(convert(customBudget.accommodation.min, 'MYR'))}
            max={Math.round(convert(customBudget.accommodation.max, 'MYR'))}
            parseCost={parseBudgetItemCost}
          />
        </motion.div>

        <motion.div variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: 'easeOut' } } }} className="relative group">
          <BudgetCard
            title="Transportation"
            range={`${currencySymbol} ${convert(transportationRange.min, 'MYR').toLocaleString()} - ${currencySymbol} ${convert(transportationRange.max, 'MYR').toLocaleString()}`}
            description="Intercity high-speed trains, Metro, and Didi rides."
            icon={Train}
            color="text-slate-900"
            percentage={15}
            details={getCategoryItems('transportation')}
            isEditing={isEditing}
            onUpdateRange={(t, v) => updateRange('transportation', t, v)}
            onAddItem={openAddItemModal}
            onUpdateItem={(id, f, v) => updateCustomItem('transportation', id, f, v)}
            onDeleteItem={(id) => deleteCustomItem('transportation', id)}
            categoryKey="transportation"
            currencySymbol={currencySymbol}
            getDisplayItemCost={getDisplayItemCost}
            min={Math.round(convert(customBudget.transportation.min, 'MYR'))}
            max={Math.round(convert(customBudget.transportation.max, 'MYR'))}
            parseCost={parseBudgetItemCost}
          />
        </motion.div>

        <motion.div variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: 'easeOut' } } }} className="relative group">
          <BudgetCard
            title="Food & Dining"
            range={`${currencySymbol} ${convert(foodRange.min, 'MYR').toLocaleString()} - ${currencySymbol} ${convert(foodRange.max, 'MYR').toLocaleString()}`}
            description="Daily meals including street food, casual dining, and a few nice dinners."
            icon={Utensils}
            color="text-slate-900"
            percentage={18}
            details={getCategoryItems('food')}
            isEditing={isEditing}
            onUpdateRange={(t, v) => updateRange('food', t, v)}
            onAddItem={openAddItemModal}
            onUpdateItem={(id, f, v) => updateCustomItem('food', id, f, v)}
            onDeleteItem={(id) => deleteCustomItem('food', id)}
            categoryKey="food"
            currencySymbol={currencySymbol}
            getDisplayItemCost={getDisplayItemCost}
            min={Math.round(convert(customBudget.food.min, 'MYR'))}
            max={Math.round(convert(customBudget.food.max, 'MYR'))}
            parseCost={parseBudgetItemCost}
          />
        </motion.div>

        <motion.div variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: 'easeOut' } } }} className="relative group">
          <BudgetCard
            title="Activities"
            range={`${currencySymbol} ${convert(activitiesRange.min, 'MYR').toLocaleString()} - ${currencySymbol} ${convert(activitiesRange.max, 'MYR').toLocaleString()}`}
            description="Entrance fees to parks, museums, and cultural experiences."
            icon={Ticket}
            color="text-slate-900"
            percentage={7}
            details={getCategoryItems('activities')}
            isEditing={isEditing}
            onUpdateRange={(t, v) => updateRange('activities', t, v)}
            onAddItem={openAddItemModal}
            onUpdateItem={(id, f, v) => updateCustomItem('activities', id, f, v)}
            onDeleteItem={(id) => deleteCustomItem('activities', id)}
            categoryKey="activities"
            currencySymbol={currencySymbol}
            getDisplayItemCost={getDisplayItemCost}
            min={Math.round(convert(customBudget.activities.min, 'MYR'))}
            max={Math.round(convert(customBudget.activities.max, 'MYR'))}
            parseCost={parseBudgetItemCost}
          />
        </motion.div>

        <motion.div variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: 'easeOut' } } }} className="relative group">
          <BudgetCard
            title="Misc & Shopping"
            range={`${currencySymbol} ${convert(miscRange.min, 'MYR').toLocaleString()} - ${currencySymbol} ${convert(miscRange.max, 'MYR').toLocaleString()}`}
            description="Souvenirs, snacks, SIM cards, and unexpected expenses."
            icon={CreditCard}
            color="text-slate-900"
            percentage={5}
            details={getCategoryItems('misc')}
            isEditing={isEditing}
            onUpdateRange={(t, v) => updateRange('misc', t, v)}
            onAddItem={openAddItemModal}
            onUpdateItem={(id, f, v) => updateCustomItem('misc', id, f, v)}
            onDeleteItem={(id) => deleteCustomItem('misc', id)}
            categoryKey="misc"
            currencySymbol={currencySymbol}
            getDisplayItemCost={getDisplayItemCost}
            min={Math.round(convert(customBudget.misc.min, 'MYR'))}
            max={Math.round(convert(customBudget.misc.max, 'MYR'))}
            parseCost={parseBudgetItemCost}
          />
        </motion.div>
      </motion.div>
      )}

      <AnimatePresence>
        {showAddItemModal && addItemCategory && (
          <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-2 sm:p-4 pt-10 sm:pt-4 overflow-y-auto">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm"
              onClick={() => setShowAddItemModal(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white dark:bg-slate-900 w-full max-w-md rounded-3xl shadow-2xl p-4 sm:p-6 relative z-10 border border-slate-100 dark:border-slate-800 my-auto mb-[20vh] sm:mb-auto"
            >
              <button
                onClick={() => setShowAddItemModal(false)}
                className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>

              <h3 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white mb-5 sm:mb-6 pr-8">
                Add Item to {categoryLabels[addItemCategory]}
              </h3>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Item Name</label>
                  <input
                    value={draftItem.label}
                    onChange={(e) => setDraftItem(prev => ({ ...prev, label: e.target.value }))}
                    placeholder="Example: Metro top-up"
                    className="editorial-input"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Cost ({currencySymbol})</label>
                  <input
                    value={draftItem.cost}
                    onChange={(e) => setDraftItem(prev => ({ ...prev, cost: e.target.value }))}
                    placeholder={`Example: ${currency === 'MYR' ? '30' : '45'}`}
                    className="editorial-input"
                  />
                </div>

                <button
                  onClick={confirmAddCategoryItem}
                  className="w-full bg-slate-900 dark:bg-emerald-600 text-white font-bold py-3.5 rounded-3xl hover:scale-[1.02] active:scale-[0.98] transition-all shadow-lg shadow-slate-900/20 flex items-center justify-center gap-2 mt-4"
                >
                  <Save className="w-5 h-5" />
                  Save Item
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showAddExpenseModal && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
              onClick={() => setShowAddExpenseModal(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white dark:bg-slate-900 w-full max-w-md rounded-3xl shadow-2xl p-6 relative z-10 border border-slate-100 dark:border-slate-800"
            >
              <button
                onClick={() => setShowAddExpenseModal(false)}
                className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>

              <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-6">
                Add New Expense
              </h3>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Description</label>
                  <input
                    value={expenseDraft.description || ''}
                    onChange={(e) => setExpenseDraft(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="e.g., Hotpot Dinner"
                    className="editorial-input"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Amount ({currencySymbol})</label>
                  <input
                    type="number"
                    value={expenseDraft.amountMYR ? convert(expenseDraft.amountMYR, 'MYR') : ''}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0;
                      // If user is in CNY mode, convert input back to MYR for storage
                      const amountMYR = toBase(val);
                      setExpenseDraft(prev => ({ ...prev, amountMYR }));
                    }}
                    placeholder="0.00"
                    className="editorial-input"
                  />
                </div>

                <button
                  onClick={handleAddExpense}
                  disabled={!expenseDraft.description || !expenseDraft.amountMYR}
                  className="w-full bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 disabled:hover:bg-emerald-500 text-white font-bold py-3.5 rounded-3xl transition-all shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2 mt-4"
                >
                  <Save className="w-5 h-5" />
                  Save Expense
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
};
