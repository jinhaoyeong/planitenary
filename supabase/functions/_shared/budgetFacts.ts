/**
 * Deterministic wallet facts from the stored `public.budgets.data` document.
 *
 * Ask and Smart Plan consume this summary. Browser localStorage is never
 * authority here. Missing storage is reported, never guessed, and never filled
 * from the itinerary as a ceiling. Missing itinerary prices stay unknown —
 * they are not converted to zero and are not estimated.
 */

import {
  BUDGET_CURRENCY,
  budgetConfiguredTotals,
  sanitizeBudgetDocument,
} from './budgetDocument.ts';

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
  const knownList: Array<{ name: string; amount: number; currency: string }> = [];
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
      knownList.push({ name: name.slice(0, 160), amount, currency: currency.slice(0, 8) });
      return;
    }
    unknownCostCount += 1;
  };
  for (const rawDay of asArray(itinerary?.days)) {
    const day = asRecord(rawDay);
    for (const activity of asArray(day?.activities)) consider(activity);
  }
  for (const activity of asArray(itinerary?.unassignedActivities)) consider(activity);
  return { known: knownList.slice(0, 40), unknownCostCount };
};

/**
 * Summarise stored wallet data. Missing or unreadable storage is reported, never guessed.
 */
export function summarizeBudgetFacts(
  stored: unknown,
  itinerary: Record<string, unknown> | null = null,
): BudgetFacts {
  const costs = itineraryKnownCosts(itinerary);
  if (stored == null) {
    return {
      present: false,
      unknownCostCount: costs.unknownCostCount,
      itineraryKnownCosts: costs.known,
      note: 'You have not set a trip budget yet. Itinerary prices that are missing stay unknown — they are not estimated.',
    };
  }

  const document = sanitizeBudgetDocument(stored);
  if (!document) {
    return {
      present: false,
      unknownCostCount: costs.unknownCostCount,
      itineraryKnownCosts: costs.known,
      note: 'I can’t verify a trip budget from the stored records right now.',
    };
  }

  const totals = budgetConfiguredTotals(document);
  return {
    present: true,
    currency: BUDGET_CURRENCY,
    spent: totals.spent,
    plannedCeiling: totals.plannedCeiling,
    remainingKnownBudget: totals.remainingKnownBudget,
    categoryBreakdown: totals.categoryBreakdown,
    expenseCount: totals.expenseCount,
    unknownCostCount: costs.unknownCostCount,
    itineraryKnownCosts: costs.known,
    note: 'Wallet amounts are stored in MYR. Missing itinerary prices stay unknown and are not estimated.',
  };
}
