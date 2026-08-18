import { describe, expect, it } from 'vitest';
import {
  parseConversationTurns,
  parseUiContextEnvelope,
  rehydrateIntelligenceFocus,
  surfaceFromAppTab,
} from '../../supabase/functions/_shared/intelligenceContext';
import { summarizeBudgetFacts } from '../../supabase/functions/_shared/budgetFacts';
import { summarizeDocumentFacts } from '../../supabase/functions/_shared/documentFacts';
import { askSuggestionsFor, deriveSmartActions } from '../../supabase/functions/_shared/smartPlannerActions';
import { AGENT_TOOL_NAMES, isMutatingToolName } from '../../supabase/functions/_shared/agentContract';

const park = { id: 'park', name: 'Ōhori Park', type: 'sight', time: '15:00', durationMinutes: 90 };
const shrine = { id: 'kushida', name: 'Kushida Shrine', type: 'culture', time: '10:00', durationMinutes: 60 };

describe('shared trip intelligence context', () => {
  it('keeps UI hints and drops browser-supplied facts', () => {
    const envelope = parseUiContextEnvelope({
      tripId: 'trip-1',
      surface: 'map',
      dayNumber: 2,
      selectedActivityId: 'activity-123',
      selectedMapPoint: { lat: 33.59, lng: 130.4 },
      time: '12:00',
      price: 900,
      decision: 'skip',
      durationMinutes: 90,
      coordinates: [33.59, 130.4],
    });
    expect(envelope).toEqual({
      tripId: 'trip-1',
      surface: 'map',
      dayNumber: 2,
      selectedActivityId: 'activity-123',
      selectedMapPoint: { lat: 33.59, lng: 130.4 },
    });
    expect(envelope).not.toHaveProperty('time');
    expect(envelope).not.toHaveProperty('price');
    expect(envelope).not.toHaveProperty('decision');
  });

  it('rehydrates a selected activity from the owned itinerary and drops unknown ids', () => {
    const itinerary = { days: [{ day: 1, activities: [park] }] };
    const found = rehydrateIntelligenceFocus(
      itinerary,
      { selectedActivityId: 'park', dayNumber: 1, surface: 'itinerary' },
      'trip-1',
    );
    expect(found.selectedActivity).toMatchObject({ id: 'park', name: 'Ōhori Park', time: '15:00', day: 1 });
    const missing = rehydrateIntelligenceFocus(
      itinerary,
      { selectedActivityId: 'activity-missing', dayNumber: 9 },
      'trip-1',
    );
    expect(missing.selectedActivity).toBeUndefined();
    expect(missing.dayNumber).toBeUndefined();
  });

  it('ignores an envelope trip id that does not match the owned trip', () => {
    const focus = rehydrateIntelligenceFocus(
      { days: [] },
      { tripId: 'someone-else', surface: 'itinerary' },
      'trip-1',
    );
    expect(focus.note).toMatch(/did not match the owned trip/i);
  });

  it('maps app tabs onto intelligence surfaces', () => {
    expect(surfaceFromAppTab('itinerary')).toBe('itinerary');
    expect(surfaceFromAppTab('maps')).toBe('map');
    expect(surfaceFromAppTab('budget')).toBe('budget');
    expect(surfaceFromAppTab('documents')).toBe('documents');
    expect(surfaceFromAppTab('draft')).toBe('saved');
  });

  it('bounds conversation memory to four turns', () => {
    const turns = parseConversationTurns(
      Array.from({ length: 6 }, (_, index) => ({ question: `Q${index + 1}`, answer: `A${index + 1}` })),
    );
    expect(turns.map((turn) => turn.question)).toEqual(['Q3', 'Q4', 'Q5', 'Q6']);
  });
});

describe('deterministic Smart Plan actions', () => {
  it('does not show a conflict action when the day has no overlap', () => {
    const actions = deriveSmartActions({
      itinerary: { days: [{ day: 1, activities: [park] }] },
      surface: 'itinerary',
      dayNumber: 1,
    });
    expect(actions.map((action) => action.id)).not.toContain('fix-conflict');
    expect(actions.some((action) => action.mode === 'proposal')).toBe(true);
    expect(actions.at(-1)).toMatchObject({ id: 'ask', mode: 'read' });
    expect(actions.length).toBeLessThanOrEqual(5);
  });

  it('offers Plan after arrival when a flight lands on an underplanned day', () => {
    const actions = deriveSmartActions({
      itinerary: {
        days: [{
          day: 1,
          activities: [
            { id: 'flight', name: 'HAN → FUK', type: 'flight', time: '10:00', durationMinutes: 120 },
          ],
        }],
      },
      surface: 'itinerary',
      dayNumber: 1,
    });
    expect(actions.map((action) => action.id)).toContain('plan-after-arrival');
    expect(actions.find((action) => action.id === 'plan-after-arrival')?.reason).toMatch(/12:00 PM/);
    expect(actions.find((action) => action.id === 'plan-after-arrival')?.mode).toBe('proposal');
  });

  it('offers Fit a Must do when a Must do is not scheduled, and never recommends Skip or Visited', () => {
    const actions = deriveSmartActions({
      itinerary: {
        days: [{ day: 1, activities: [park] }],
        discoveryState: {
          decisions: { castle: 'must-do', kushida: 'skip', tower: 'visited', park: 'interested' },
        },
      },
      surface: 'itinerary',
      dayNumber: 1,
    });
    expect(actions.map((action) => action.id)).toContain('fit-must-do');
    expect(actions.every((action) => !/skip|visited/i.test(`${action.title} ${action.reason}`))).toBe(true);
  });

  it('does not show a budget action without stored budget facts', () => {
    const actions = deriveSmartActions({
      itinerary: { days: [{ day: 1, activities: [park] }] },
      surface: 'itinerary',
      hasBudget: false,
    });
    expect(actions.map((action) => action.id)).not.toContain('review-budget');
  });

  it('shows Review budget on the budget surface only when a wallet exists', () => {
    const without = deriveSmartActions({
      itinerary: { days: [{ day: 1, activities: [park] }] },
      surface: 'budget',
      hasBudget: false,
    });
    expect(without.map((action) => action.id)).not.toContain('review-budget');
    const withWallet = deriveSmartActions({
      itinerary: { days: [{ day: 1, activities: [park] }] },
      surface: 'budget',
      hasBudget: true,
      budgetCeilingKnown: 1000,
      budgetRemainingKnown: 800,
    });
    expect(withWallet.map((action) => action.id)).toContain('review-budget');
  });

  it('changes suggested Ask questions with the current surface', () => {
    expect(askSuggestionsFor('itinerary')[0]).toMatch(/fit after this/i);
    expect(askSuggestionsFor('map')).toEqual(expect.arrayContaining(['What is nearby?']));
    expect(askSuggestionsFor('budget')).toEqual(expect.arrayContaining(['Where am I spending most?']));
    expect(askSuggestionsFor('documents')[0]).toMatch(/documents/i);
  });
});

describe('budget and document adapters', () => {
  it('reports known spend and leaves unknown itinerary prices unknown', () => {
    const facts = summarizeBudgetFacts(
      {
        flights: { min: 0, max: 1000 },
        accommodation: { min: 0, max: 0 },
        transportation: { min: 0, max: 0 },
        food: { min: 0, max: 0 },
        activities: { min: 0, max: 0 },
        misc: { min: 0, max: 0 },
        expenses: [{ amountMYR: 420 }],
      },
      {
        days: [{
          day: 1,
          activities: [
            { name: 'Castle', type: 'sight', estimatedCost: { amount: 180, currency: 'MYR' } },
            { name: 'Ramen', type: 'food' },
          ],
        }],
      },
    );
    expect(facts).toMatchObject({
      present: true,
      currency: 'MYR',
      spent: 420,
      plannedCeiling: 1000,
      remainingKnownBudget: 580,
      unknownCostCount: 1,
    });
    expect(facts.itineraryKnownCosts).toEqual([{ name: 'Castle', amount: 180, currency: 'MYR' }]);
  });

  it('does not invent a budget when none is stored', () => {
    const facts = summarizeBudgetFacts(null, { days: [{ day: 1, activities: [shrine] }] });
    expect(facts.present).toBe(false);
    expect(facts.spent).toBeUndefined();
    expect(facts.note).toMatch(/have not set a trip budget/i);
  });

  it('exposes document metadata and an explicit extraction gap', () => {
    const facts = summarizeDocumentFacts([
      { id: 'doc-1', title: 'Flight booking', file_name: 'ticket.pdf', mime_type: 'application/pdf' },
    ], 'doc-1');
    expect(facts.extraction).toBe('unavailable');
    expect(facts.selected).toMatchObject({ id: 'doc-1', title: 'Flight booking', fileName: 'ticket.pdf' });
    expect(facts.note).toMatch(/does not extract/i);
  });
});

describe('intelligence tools stay read-only', () => {
  it('adds trip-wide read tools without a write path', () => {
    expect(AGENT_TOOL_NAMES).toEqual(expect.arrayContaining([
      'get_current_day',
      'get_flights',
      'get_budget_summary',
      'get_trip_documents',
      'get_change_history',
      'get_current_proposal',
      'check_schedule_fit',
    ]));
    expect(AGENT_TOOL_NAMES.filter((name) => isMutatingToolName(name))).toEqual([]);
  });
});
