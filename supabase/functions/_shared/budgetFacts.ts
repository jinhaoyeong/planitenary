/**
 * Deterministic wallet facts from the stored `budgets.data` document.
 *
 * The Budget UI currently persists category ceilings and expenses primarily in
 * browser localStorage (`budget-trip-…-backup`). This adapter reads
 * `public.budgets` only. Those stores can diverge; Ask must not treat
 * browser-local numbers as authority. Missing server storage is reported,
 * never guessed, and never filled from the itinerary as a ceiling.
 */

const CATEGORIES = [
  'flights',
  'accommodation',
  'transportation',
  'food',
  'activities',
  'misc',
] as const;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const finite = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 100) / 100 : undefined;

export interface BudgetFacts {
  present: boolean;
  currency?: string;
  spent?: number;
  plannedCeiling?: number;
  remainingKnownBudget?: number;
  categoryBreakdown?: Array<{ category: string; min: number; max: number }>;
  expenseCount?: number;
  unknownCostCount?: number;
  itineraryKnownCosts?: Array<{ name: string; amount: number; currency: string }>;
  note: string;
}

const itineraryKnownCosts = (itinerary: Record<string, unknown> | null): {
  known: Array<{ name: string; amount: number; currency: string }>;
  unknownCostCount: number;
} => {
  const known: Array<{ name: string; amount: number; currency: string }> = [];
  let unknownCostCount = 0;
  const consider = (raw: unknown) => {
    const activity = asRecord(raw);
    if (!activity) return;
    const name = typeof activity.name === 'string' ? activity.name.trim() : '';
    if (!name) return;
    const type = typeof activity.type === 'string' ? activity.type : '';
    if (type === 'flight' || type === 'transport') return;
    const estimated = asRecord(activity.estimatedCost);
    const admission = asRecord(activity.admission);
    const adult = asRecord(admission?.adult);
    const amount = finite(estimated?.amount) ?? finite(adult?.amount);
    const currency = typeof estimated?.currency === 'string'
      ? estimated.currency
      : typeof adult?.currency === 'string' ? adult.currency : typeof admission?.currency === 'string' ? admission.currency : undefined;
    if (amount !== undefined && currency) {
      known.push({ name: name.slice(0, 160), amount, currency: currency.slice(0, 8) });
      return;
    }
    unknownCostCount += 1;
  };
  for (const rawDay of asArray(itinerary?.days)) {
    const day = asRecord(rawDay);
    for (const activity of asArray(day?.activities)) consider(activity);
  }
  for (const activity of asArray(itinerary?.unassignedActivities)) consider(activity);
  return { known: known.slice(0, 40), unknownCostCount };
};

/**
 * Summarise stored wallet data. Missing storage is reported, never guessed.
 */
export function summarizeBudgetFacts(
  stored: unknown,
  itinerary: Record<string, unknown> | null = null,
): BudgetFacts {
  const costs = itineraryKnownCosts(itinerary);
  const data = asRecord(stored);
  if (!data) {
    return {
      present: false,
      unknownCostCount: costs.unknownCostCount,
      itineraryKnownCosts: costs.known,
      note: 'You have not set a trip budget yet. Itinerary prices that are missing stay unknown — they are not estimated.',
    };
  }

  const breakdown: Array<{ category: string; min: number; max: number }> = [];
  let plannedCeiling = 0;
  for (const category of CATEGORIES) {
    const row = asRecord(data[category]);
    const min = finite(row?.min) ?? 0;
    const max = finite(row?.max) ?? 0;
    breakdown.push({ category, min, max });
    plannedCeiling += max;
  }
  const expenses = asArray(data.expenses);
  let spent = 0;
  for (const entry of expenses) {
    const row = asRecord(entry);
    spent += finite(row?.amountMYR) ?? 0;
  }

  return {
    present: true,
    currency: 'MYR',
    spent,
    plannedCeiling,
    remainingKnownBudget: plannedCeiling - spent,
    categoryBreakdown: breakdown,
    expenseCount: expenses.length,
    unknownCostCount: costs.unknownCostCount,
    itineraryKnownCosts: costs.known,
    note: 'Wallet amounts are stored in MYR. Missing itinerary prices stay unknown and are not estimated.',
  };
}
