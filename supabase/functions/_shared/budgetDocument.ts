/**
 * The Budget tab document persisted in `public.budgets.data`.
 *
 * This is the existing production shape — not a new schema. Category min/max
 * and expense `amountMYR` are MYR. Item `cost` is a display string. Ask,
 * Smart Plan, and the Budget UI must share this document and the same
 * deterministic totals. Missing itinerary prices stay unknown here; they are
 * not stored on the wallet and are not treated as zero.
 */

export const BUDGET_CATEGORY_KEYS = [
  'flights',
  'accommodation',
  'transportation',
  'food',
  'activities',
  'misc',
] as const;

export type BudgetCategoryKey = typeof BUDGET_CATEGORY_KEYS[number];

export const BUDGET_CURRENCY = 'MYR';

export interface BudgetItem {
  id: string;
  label: string;
  cost: string;
}

export interface BudgetCategory {
  min: number;
  max: number;
  items: BudgetItem[];
}

export type ExpensePaidBy = 'You' | 'Travel partner';
export type ExpenseCategoryKey = BudgetCategoryKey | 'general';

export interface ExpenseRecord {
  id: string;
  description: string;
  amountMYR: number;
  amountCNY: number;
  paidBy: ExpensePaidBy;
  category: ExpenseCategoryKey;
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

export interface BudgetCategoryRange {
  category: BudgetCategoryKey;
  min: number;
  max: number;
}

export interface BudgetConfiguredTotals {
  currency: typeof BUDGET_CURRENCY;
  plannedCeiling: number;
  spent: number;
  remainingKnownBudget: number;
  categoryBreakdown: BudgetCategoryRange[];
  expenseCount: number;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const finiteMoney = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value * 100) / 100;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.round(parsed * 100) / 100;
  }
  return undefined;
};

const text = (value: unknown, max: number): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;

/**
 * Item costs are display strings. Only an explicit MYR amount or a bare
 * number counts; "Add estimate" and other placeholders are not money.
 */
export function parseBudgetItemCost(value: string): number {
  if (!value) return 0;
  const normalized = value.replace(/,/g, '').trim();
  if (/^\d+(\.\d+)?$/.test(normalized)) return Number(normalized);
  if (!/rm/i.test(normalized)) return 0;
  const match = normalized.match(/(\d+(\.\d+)?)/);
  if (!match) return 0;
  return Number(match[1]) || 0;
}

export function categoryRange(category: BudgetCategory): { min: number; max: number } {
  const itemsTotal = category.items.reduce((sum, item) => sum + parseBudgetItemCost(item.cost), 0);
  const max = Math.max(category.max, itemsTotal);
  const min = Math.min(category.min, max);
  return { min, max };
}

const sanitizeItem = (value: unknown): BudgetItem | null => {
  const row = asRecord(value);
  if (!row) return null;
  const id = text(row.id, 80);
  const label = text(row.label, 160) ?? '';
  const cost = typeof row.cost === 'string' ? row.cost.slice(0, 80) : '';
  if (!id) return null;
  return { id, label, cost };
};

const sanitizeCategory = (value: unknown): BudgetCategory | null => {
  const row = asRecord(value);
  if (!row) return null;
  const min = finiteMoney(row.min);
  const max = finiteMoney(row.max);
  if (min === undefined || max === undefined) return null;
  const items = asArray(row.items).flatMap((entry) => {
    const item = sanitizeItem(entry);
    return item ? [item] : [];
  }).slice(0, 40);
  return { min: Math.max(0, min), max: Math.max(0, max), items };
};

const sanitizeExpense = (value: unknown): ExpenseRecord | null => {
  const row = asRecord(value);
  if (!row) return null;
  const id = text(row.id, 80);
  const description = text(row.description, 200);
  const amountMYR = finiteMoney(row.amountMYR);
  if (!id || !description || amountMYR === undefined) return null;
  const paidBy = row.paidBy === 'Travel partner' ? 'Travel partner' : 'You';
  const category = typeof row.category === 'string' && (
    row.category === 'general' || (BUDGET_CATEGORY_KEYS as readonly string[]).includes(row.category)
  )
    ? row.category as ExpenseCategoryKey
    : 'general';
  const date = text(row.date, 40) ?? '';
  const amountCNY = finiteMoney(row.amountCNY) ?? 0;
  return {
    id,
    description,
    amountMYR: Math.max(0, amountMYR),
    amountCNY: Math.max(0, amountCNY),
    paidBy,
    category,
    date,
  };
};

/** Reject anything that is not the current Budget UI document. */
export function sanitizeBudgetDocument(value: unknown): CustomBudget | null {
  const row = asRecord(value);
  if (!row) return null;
  const categories: Partial<CustomBudget> = {};
  for (const key of BUDGET_CATEGORY_KEYS) {
    const category = sanitizeCategory(row[key]);
    if (!category) return null;
    categories[key] = category;
  }
  if (!Array.isArray(row.expenses) && row.expenses !== undefined) return null;
  const expenses = asArray(row.expenses).flatMap((entry) => {
    const expense = sanitizeExpense(entry);
    return expense ? [expense] : [];
  }).slice(0, 200);
  return {
    flights: categories.flights!,
    accommodation: categories.accommodation!,
    transportation: categories.transportation!,
    food: categories.food!,
    activities: categories.activities!,
    misc: categories.misc!,
    expenses,
  };
}

/** MYR totals the Budget tab represents: category ceilings and recorded spend. */
export function budgetConfiguredTotals(budget: CustomBudget): BudgetConfiguredTotals {
  const categoryBreakdown = BUDGET_CATEGORY_KEYS.map((category) => {
    const range = categoryRange(budget[category]);
    return { category, min: range.min, max: range.max };
  });
  const plannedCeiling = categoryBreakdown.reduce((sum, row) => sum + row.max, 0);
  const spent = Math.round(budget.expenses.reduce((sum, expense) => sum + expense.amountMYR, 0) * 100) / 100;
  return {
    currency: BUDGET_CURRENCY,
    plannedCeiling: Math.round(plannedCeiling * 100) / 100,
    spent,
    remainingKnownBudget: Math.round((plannedCeiling - spent) * 100) / 100,
    categoryBreakdown,
    expenseCount: budget.expenses.length,
  };
}

/** Production-shaped local backup used by persistence tests. Not live wallet data. */
export function productionShapedBudgetFixture(): CustomBudget {
  return {
    flights: {
      min: 1200,
      max: 2000,
      items: [
        { id: 'def-flight-1', label: 'Round-trip transport', cost: 'RM 1800' },
        { id: 'def-flight-2', label: 'Baggage & extras', cost: 'RM 120' },
      ],
    },
    accommodation: {
      min: 1500,
      max: 3000,
      items: [
        { id: 'def-acc-1', label: 'Average nightly rate', cost: 'RM 280' },
        { id: 'def-acc-2', label: 'Number of nights', cost: '5 Nights' },
      ],
    },
    transportation: {
      min: 200,
      max: 500,
      items: [{ id: 'train-1', label: 'Airport train', cost: 'RM 80' }],
    },
    food: {
      min: 600,
      max: 1200,
      items: [{ id: 'food-1', label: 'Daily meals', cost: 'RM 150' }],
    },
    activities: {
      min: 200,
      max: 500,
      items: [{ id: 'act-1', label: 'Day tours', cost: 'RM 200' }],
    },
    misc: {
      min: 500,
      max: 1000,
      items: [
        { id: 'def-misc-1', label: 'eSIM / Roaming', cost: 'RM 80' },
        { id: 'def-misc-2', label: 'Souvenirs', cost: 'RM 300' },
      ],
    },
    expenses: [
      {
        id: 'exp-dinner-1',
        description: 'Ichiran dinner',
        amountMYR: 85,
        amountCNY: 0,
        paidBy: 'You',
        category: 'food',
        date: '2026-08-20T12:00:00.000Z',
      },
    ],
  };
}
