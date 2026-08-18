/**
 * Pre-model Ask grounding. The production failure this locks is a one-round
 * Ask with zero tool calls that invented Skip, Flight, and a third day.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  ASK_GROUNDING_REFUSAL,
  bindSavedPlaceDecisions,
  collectAskGrounding,
  deriveAskGroundingPlan,
  presentAskEvidence,
} from '../../supabase/functions/_shared/askGrounding';
import {
  AGENT_LIMITS,
  AGENT_TOOL_NAMES,
  isMutatingToolName,
  validateAgentAnswer,
} from '../../supabase/functions/_shared/agentContract';
import { runAgent } from '../../supabase/functions/_shared/agentRuntime';
import { rehydrateIntelligenceFocus } from '../../supabase/functions/_shared/intelligenceContext';
import { summarizeBudgetFacts } from '../../supabase/functions/_shared/budgetFacts';

const PRODUCTION_QUESTION =
  'Why isn’t Kushida Shrine in my plan, and what time can sightseeing start after my flight?';

const kushida = {
  id: 'activity-legacy-iwbmuz',
  time: '09:00',
  name: 'Kushida Shrine',
  description: 'Added manually',
  type: 'sight',
  source: 'manual',
  coordinates: [33.59307, 130.4106837],
};

const inboundFlight = {
  id: 'activity-legacy-1vpjtl3',
  type: 'flight',
  name: 'HAN → FUK',
  time: '10:00',
  durationMinutes: 120,
};

const productionItinerary = (over: Record<string, unknown> = {}) => ({
  id: 'trip-f5262604-cb74-4d39-af90-0d8a233c9906',
  name: 'Flight Acceptance Test',
  cities: ['Fukuoka'],
  revision: 12,
  days: [
    {
      day: 1,
      date: '2026-08-20',
      city: 'Fukuoka',
      title: 'Arrive in Fukuoka',
      activities: [inboundFlight, kushida],
    },
    {
      day: 2,
      date: '2026-08-21',
      city: 'Fukuoka',
      title: 'Fukuoka day 2',
      activities: [{ id: 'park', name: 'Ohori Park', type: 'sight', time: '11:00', durationMinutes: 90 }],
    },
  ],
  discoveryState: {
    city: 'Fukuoka',
    mode: 'live',
    candidateIds: ['wikivoyage-Kushida%20Shrine'],
    decisions: {
      'wikivoyage-Kushida%20Shrine': 'skip',
      'activity-legacy-iwbmuz': 'skip',
    },
  },
  ...over,
});

const ground = (
  question: string,
  itinerary: Record<string, unknown> = productionItinerary(),
  extra: {
    surface?: 'itinerary' | 'map' | 'budget' | 'documents';
    dayNumber?: number;
    conversation?: Array<{ question: string; answer: string }>;
    extras?: Parameters<typeof collectAskGrounding>[0]['extras'];
  } = {},
) => {
  const uiContext = {
    tripId: String(itinerary.id ?? 'trip-1'),
    surface: extra.surface ?? 'itinerary',
    dayNumber: extra.dayNumber,
  };
  const uiFocus = rehydrateIntelligenceFocus(itinerary, uiContext, uiContext.tripId);
  const plan = deriveAskGroundingPlan({ question, surface: uiFocus.surface, uiContext });
  const result = collectAskGrounding({
    itinerary,
    tripId: uiContext.tripId,
    question,
    plan,
    uiFocus,
    conversation: extra.conversation,
    extras: extra.extras,
  });
  return { plan, result, uiFocus };
};

describe('Ask grounding planner', () => {
  it('A. every trip-factual Ask requires base trip/itinerary/day grounding', () => {
    const { plan } = ground('What should we do tonight?');
    expect(plan.required).toEqual(expect.arrayContaining(['trip', 'itinerary', 'day']));
  });

  it('B. a decision question requires decision grounding', () => {
    const { plan } = ground('Why isn’t Kushida Shrine in my plan?');
    expect(plan.required).toEqual(expect.arrayContaining(['decisions']));
  });

  it('C. a Flight question requires Flight and schedule grounding', () => {
    const { plan } = ground('When can sightseeing start after my flight?');
    expect(plan.required).toEqual(expect.arrayContaining(['flights', 'schedule']));
  });

  it('D. the combined production question merges scopes without duplicate reads', () => {
    const { plan, result } = ground(PRODUCTION_QUESTION);
    expect(plan.required).toEqual(expect.arrayContaining([
      'itinerary',
      'day',
      'decisions',
      'flights',
      'schedule',
    ]));
    expect(result.ok).toBe(true);
    const keys = result.reads.map((read) => `${read.scope}:${read.reader}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('production-shaped Kushida / Flight Ask', () => {
  it('E. pre-model evidence has Skip, 10:00–12:00, 14:00, and two days', () => {
    const { result } = ground(PRODUCTION_QUESTION);
    expect(result.ok).toBe(true);
    if (!result.ok || !result.packet) return;

    expect(result.packet.trip.dayCount).toBe(2);
    expect(result.packet.decisions).toContainEqual(expect.objectContaining({
      placeName: 'Kushida Shrine',
      decision: 'skip',
    }));
    expect(result.packet.fixedEvents).toContainEqual(expect.objectContaining({
      start: '10:00',
      end: '12:00',
      durationMinutes: 120,
      sightseeingAfter: '14:00',
      settlingMinutes: 120,
    }));
    expect(result.packet.scheduleFacts.some((fact) => fact.earliestSightseeing === '14:00')).toBe(true);

    const bound = bindSavedPlaceDecisions(productionItinerary());
    expect(bound.find((entry) => entry.name === 'Kushida Shrine')?.keysUsed).toEqual(['activity-legacy-iwbmuz']);
    expect(bound.some((entry) => entry.keysUsed.includes('wikivoyage-Kushida%20Shrine'))).toBe(false);

    const presented = presentAskEvidence(result.packet);
    const serialised = JSON.stringify(presented);
    expect(serialised).not.toContain('wikivoyage-Kushida');
    expect(serialised).not.toContain('activity-legacy-iwbmuz');
    expect(serialised).not.toContain('discoveryState');
    expect(Array.isArray((presented.days as Array<Record<string, unknown>>)[0].activities)).toBe(false);

    const good = validateAgentAnswer(
      {
        answer: 'Kushida Shrine is skipped, so it is not in the sightseeing plan. After the 10:00–12:00 flight, sightseeing can start from 14:00.',
        citations: [],
      },
      result.evidence,
      { dayCount: result.dayCount },
    );
    expect(good.rejected).toEqual([]);
    expect(good.answer).toMatch(/skip/i);
    expect(good.answer).toContain('14:00');
    expect(good.answer).not.toMatch(/\bDay 3\b/i);
  });

  it('F. a Day 3 claim is rejected on a 2-day trip', () => {
    const { result } = ground(PRODUCTION_QUESTION);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const validated = validateAgentAnswer(
      { answer: 'Move sightseeing to Day 3 after the flight.', citations: [] },
      result.evidence,
      { dayCount: 2 },
    );
    expect(validated.rejected).toContainEqual({ value: 'Day 3', reason: 'impossible-day' });
    expect(validated.answer).toMatch(/could not verify that day/i);
  });

  it('G. missing Flight grounding fails closed', () => {
    const itinerary = productionItinerary({
      days: [
        { day: 1, date: '2026-08-20', city: 'Fukuoka', activities: [kushida] },
        { day: 2, date: '2026-08-21', city: 'Fukuoka', activities: [] },
      ],
    });
    const { result } = ground(PRODUCTION_QUESTION, itinerary);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.missing).toContain('flights');
    expect(result.detail).toMatch(/flight timing/i);
  });

  it('H. missing canonical decision grounding fails closed', () => {
    const withoutState = productionItinerary({ discoveryState: undefined });
    const missingState = ground(PRODUCTION_QUESTION, withoutState);
    expect(missingState.result.ok).toBe(false);
    if (!missingState.result.ok) {
      expect(missingState.result.missing).toContain('decisions');
    }

    const listingOnly = productionItinerary({
      discoveryState: {
        city: 'Fukuoka',
        candidateIds: ['wikivoyage-Kushida%20Shrine'],
        decisions: { 'wikivoyage-Kushida%20Shrine': 'skip' },
      },
    });
    const listing = ground(PRODUCTION_QUESTION, listingOnly);
    expect(listing.result.ok).toBe(false);
    if (!listing.result.ok) {
      expect(listing.result.missing).toContain('decisions');
      expect(listing.result.detail).toMatch(/omitted/i);
    }
  });

  it('I. stale conversation Interested is overridden by current Skip', () => {
    const { result } = ground('Why isn’t it included?', productionItinerary(), {
      conversation: [{
        question: 'What about Kushida Shrine?',
        answer: 'Kushida Shrine is marked Interested.',
      }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.packet) return;
    expect(result.packet.decisions).toContainEqual(expect.objectContaining({
      placeName: 'Kushida Shrine',
      decision: 'skip',
    }));
    expect(result.packet.decisions.some((entry) => entry.decision === 'interested')).toBe(false);
  });

  it('J. selected day and surface still influence relevant context', () => {
    const { result, uiFocus } = ground('What is on this day?', productionItinerary(), {
      surface: 'itinerary',
      dayNumber: 2,
    });
    expect(uiFocus.dayNumber).toBe(2);
    expect(result.ok).toBe(true);
    if (!result.ok || !result.packet) return;
    expect(result.packet.currentDay?.day).toBe(2);
    expect(result.packet.focus?.dayNumber).toBe(2);
    expect(result.packet.currentDay?.activityNames).toContain('Ohori Park');
  });

  it('K. weather, budget, and document tools are not pre-loaded for this question', () => {
    const { plan, result } = ground(PRODUCTION_QUESTION);
    expect(plan.required).not.toContain('budget');
    expect(plan.required).not.toContain('documents');
    expect(result.reads.map((read) => read.reader)).not.toEqual(
      expect.arrayContaining(['get_budget_summary', 'get_trip_documents', 'get_weather']),
    );
  });

  it('L. deterministic grounding is a sync in-process read with no network or quota', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { result } = ground(PRODUCTION_QUESTION);
    expect(result.ok).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('M. the model receives bounded evidence, not the raw itinerary JSON', () => {
    const { result } = ground(PRODUCTION_QUESTION);
    expect(result.ok).toBe(true);
    if (!result.ok || !result.packet) return;
    const presented = presentAskEvidence(result.packet);
    expect(presented).not.toHaveProperty('discoveryState');
    expect(presented).not.toHaveProperty('unassignedActivities');
    const days = presented.days as Array<Record<string, unknown>>;
    expect(days[0]).toEqual(expect.objectContaining({ day: 1, city: 'Fukuoka' }));
    expect(days[0]).not.toHaveProperty('activities');
  });
});

describe('fail-closed extras and write safety', () => {
  it('budget questions fail closed when public.budgets is absent', () => {
    const { plan, result } = ground('How much budget is remaining?');
    expect(plan.required).toContain('budget');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.missing).toContain('budget');
    expect(summarizeBudgetFacts(null).present).toBe(false);
  });

  it('O. write-shaped questions still have no mutating tools', () => {
    const { plan, result } = ground('Move Ohori later.');
    expect(plan.required).toEqual(expect.arrayContaining(['trip', 'itinerary', 'day']));
    expect(result.ok).toBe(true);
    expect(AGENT_TOOL_NAMES.filter((name) => isMutatingToolName(name))).toEqual([]);
  });

  it('exposes a distinct grounding-unavailable refusal', () => {
    expect(ASK_GROUNDING_REFUSAL).toBe('grounding-unavailable');
  });
});

describe('pre-grounded model answers', () => {
  it('O. the model can answer without optional tools when evidence is already supplied', async () => {
    const { result } = ground(PRODUCTION_QUESTION);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const executeTool = vi.fn(async (): Promise<{ ok: true; result: unknown }> => ({ ok: true, result: {} }));
    const run = await runAgent(
      {
        operation: 'ask',
        question: PRODUCTION_QUESTION,
        context: { authoritativeEvidence: presentAskEvidence(result.packet!) },
      },
      {
        limits: AGENT_LIMITS.ask,
        seededEvidence: result.evidence,
        answerConstraints: { dayCount: result.dayCount },
        executeTool,
        callModel: async () => ({
          ok: true,
          value: {
            answer: 'Kushida Shrine is skipped. Sightseeing can start from 14:00 after the 10:00–12:00 flight.',
            citations: [],
          },
        }),
      },
    );
    expect(executeTool).not.toHaveBeenCalled();
    expect(run.budget.modelRounds).toBe(1);
    expect(run.status).toBe('answered');
    expect(run.answer?.answer).toContain('14:00');
    expect(run.answer?.rejected).toEqual([]);
  });

  it('still lets the model request extra tools after grounding', async () => {
    const { result } = ground(PRODUCTION_QUESTION);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const executeTool = vi.fn(async (): Promise<{ ok: true; result: unknown }> => ({
      ok: true,
      result: { results: [{ name: 'Ichiran', url: 'https://example.org/ramen' }] },
    }));
    let round = 0;
    const run = await runAgent(
      { operation: 'ask', question: `${PRODUCTION_QUESTION} Nearby ramen?`, context: {} },
      {
        limits: AGENT_LIMITS.ask,
        seededEvidence: result.evidence,
        answerConstraints: { dayCount: result.dayCount },
        executeTool,
        callModel: async () => {
          round += 1;
          if (round === 1) return { ok: true, value: { tool_calls: [{ tool: 'search_web', args: { query: 'ramen fukuoka' } }] } };
          return {
            ok: true,
            value: {
              answer: 'Kushida Shrine is skipped. Sightseeing starts at 14:00. Ichiran is nearby.',
              citations: ['https://example.org/ramen'],
            },
          };
        },
      },
    );
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(run.status).toBe('answered');
    expect(run.answer?.citations).toEqual(['https://example.org/ramen']);
  });

  it('rejects an invented airport transfer after grounding', async () => {
    const { result } = ground(PRODUCTION_QUESTION);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const run = await runAgent(
      { operation: 'ask', question: PRODUCTION_QUESTION, context: {} },
      {
        limits: AGENT_LIMITS.ask,
        seededEvidence: result.evidence,
        answerConstraints: { dayCount: result.dayCount },
        executeTool: async () => ({ ok: true, result: {} }),
        callModel: async () => ({
          ok: true,
          value: {
            answer: 'The airport transfer takes 9 minutes, then add Kushida on Day 3.',
            citations: [],
          },
        }),
      },
    );
    expect(run.answer?.rejected.some((row) => row.reason === 'invented-travel-time-in-answer')).toBe(true);
  });
});
