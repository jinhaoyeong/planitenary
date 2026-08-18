import { summarizeBudgetFacts } from '../../supabase/functions/_shared/budgetFacts';
import {
  browserBudgetLocalStore,
  readBudgetAuthority,
  readLocalBudgetDocument,
  type BudgetLocalStore,
} from './tripBudget';

/**
 * Client-side Smart Plan peek. Only a cache marked as server-authoritative
 * counts — a leftover localStorage wallet is not a verified account fact.
 */
export function tripBudgetHint(
  tripId: string,
  itinerary: Record<string, unknown> | null,
  local: BudgetLocalStore = browserBudgetLocalStore,
): {
  hasBudget: boolean;
  remainingKnown?: number;
  ceilingKnown?: number;
} {
  if (!tripId) return { hasBudget: false };
  if (readBudgetAuthority(tripId, local) !== 'server') return { hasBudget: false };
  const stored = readLocalBudgetDocument(tripId, local);
  const facts = summarizeBudgetFacts(stored, itinerary);
  if (!facts.present) return { hasBudget: false };
  return {
    hasBudget: true,
    remainingKnown: facts.remainingKnownBudget,
    ceilingKnown: facts.plannedCeiling,
  };
}
