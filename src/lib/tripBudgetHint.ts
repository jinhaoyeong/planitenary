import { summarizeBudgetFacts } from '../../supabase/functions/_shared/budgetFacts';
import { loadFromStorage } from './storageResilience';

/** Client-side wallet peek for Smart Plan buttons. Server tools remain authoritative. */
export function tripBudgetHint(tripId: string, itinerary: Record<string, unknown> | null): {
  hasBudget: boolean;
  remainingKnown?: number;
  ceilingKnown?: number;
} {
  if (!tripId) return { hasBudget: false };
  const stored = loadFromStorage<Record<string, unknown>>(`budget-${tripId}`);
  const facts = summarizeBudgetFacts(stored, itinerary);
  if (!facts.present) return { hasBudget: false };
  return {
    hasBudget: true,
    remainingKnown: facts.remainingKnownBudget,
    ceilingKnown: facts.plannedCeiling,
  };
}
