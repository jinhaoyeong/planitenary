/**
 * The rule that a recommendation must be searched for before it is made.
 *
 * This file exists because of one production answer. Asked "find one place
 * worth visiting near Shinjuku", the model called no tools at all: it named a
 * place it already knew from the trip's own prose and invented the id
 * `PlaceID_JCII_CAMERA_Museum` to cite for it. The invention gate rejected the
 * id and no card was built, so nothing false reached the traveller — but
 * nothing had *required* the search either, which left the card path depending
 * on whether the model felt like searching.
 *
 * The fix is not a firmer sentence in the system prompt. Tools here are asked
 * for in prose JSON rather than through the provider's function-calling, so
 * there is no `tool_choice` to set and no request-level way to compel a call.
 * What the server does own is whether it *accepts* an answer, and that is the
 * gate these tests hold: for a discovery question the loop declines the answer
 * turn until `search_places` has actually run.
 *
 * The distinction that matters most is between a search that found nothing and
 * a search that never happened. The first is evidence — "there is nowhere" is
 * a truthful answer to "find me somewhere" — and the second is the absence of
 * it. Only the first may finish.
 */
import { describe, expect, it, vi } from 'vitest';
import { AGENT_LIMITS } from '../../supabase/functions/_shared/agentContract';
import { runAgent } from '../../supabase/functions/_shared/agentRuntime';
import type { AgentModelPayload, ModelCallOutcome, ToolOutcome } from '../../supabase/functions/_shared/agentRuntime';
import { deriveAskGroundingPlan } from '../../supabase/functions/_shared/askGrounding';

/** The exact question that failed in production. */
const PRODUCTION_QUESTION = 'Find one place worth visiting near Shinjuku and explain why it fits this trip.';

const FABRICATED_ID = 'PlaceID_JCII_CAMERA_Museum';
const TRUSTED_ID = 'osm:n1234567';

const ask = (question = PRODUCTION_QUESTION) => ({
  operation: 'ask' as const,
  question,
  context: { tripId: 'trip-3fcf3214' },
});

/** What a real `search_places` run returns: records carrying id *and* name. */
const SEARCH_RESULT = {
  places: [{ id: TRUSTED_ID, name: 'Shinjuku Gyoen National Garden', city: 'Tokyo' }],
};

const searchHit = (): ToolOutcome => ({ ok: true, result: SEARCH_RESULT });

const searchEmpty = (): ToolOutcome => ({ ok: true, result: { places: [] } });

const searchFailed = (): ToolOutcome => ({ ok: false, detail: 'The place search failed.' });

/** Drive the loop round by round, so each test reads as a transcript. */
const scripted = (script: Array<(payload: AgentModelPayload) => unknown>) => {
  const seen: AgentModelPayload[] = [];
  const fn = vi.fn(async (payload: AgentModelPayload): Promise<ModelCallOutcome> => {
    seen.push(payload);
    const step = script[Math.min(payload.round - 1, script.length - 1)];
    return { ok: true, value: step(payload) };
  });
  return { fn, seen };
};

// `city` is required by the tool's own arg parser; a call without it never
// reaches the adapter, which is a different failure from the one under test.
const searchCall = () => ({
  tool_calls: [{ tool: 'search_places', args: { city: 'Tokyo', query: 'near Shinjuku' } }],
});

describe('a discovery question may not be answered until the search has run', () => {
  it('refuses the production answer, then accepts one built on a searched id', async () => {
    const { fn: callModel, seen } = scripted([
      // Round 1: exactly what production did.
      () => ({ answer: 'JCII Camera Museum fits well near Shinjuku.', placeIds: [FABRICATED_ID] }),
      () => searchCall(),
      // Round 3: the real id, and the invented one again for good measure.
      () => ({ answer: 'Shinjuku Gyoen is worth the detour.', placeIds: [TRUSTED_ID, FABRICATED_ID] }),
    ]);
    const executeTool = vi.fn(async () => searchHit());

    const run = await runAgent(ask(), {
      limits: AGENT_LIMITS.ask,
      callModel,
      executeTool,
      requiresPlaceDiscovery: true,
    });

    expect(run.status).toBe('answered');
    expect(run.placeDiscovery).toEqual({ required: true, attempted: true, succeeded: true, source: 'model-tool' });

    // The searched id survives; the invented one is still rejected by name.
    expect(run.answer?.placeIds).toEqual([TRUSTED_ID]);
    expect(run.answer?.rejected).toContainEqual({ value: FABRICATED_ID, reason: 'unreferenced-place-id' });

    // The refusal was reported back rather than silently retried.
    const told = seen[1].findings.some((f) => f.tool === 'model' && (f.detail || '').includes('search_places'));
    expect(told).toBe(true);
    // And the model was told up front, so compliance need not cost three rounds.
    expect(seen[0].requiresPlaceDiscovery).toBe(true);
  });

  it('lets a search that found nothing finish, because that is a true answer', async () => {
    const { fn: callModel } = scripted([
      () => ({ answer: 'Try the Camera Museum.', placeIds: [FABRICATED_ID] }),
      () => searchCall(),
      () => ({ answer: 'I could not find a verified place matching that request.' }),
    ]);

    const run = await runAgent(ask(), {
      limits: AGENT_LIMITS.ask,
      callModel,
      executeTool: vi.fn(async () => searchEmpty()),
      requiresPlaceDiscovery: true,
    });

    expect(run.status).toBe('answered');
    expect(run.placeDiscovery).toEqual({ required: true, attempted: true, succeeded: true, source: 'model-tool' });
    // Nothing to card, and nothing invented to fill the gap.
    expect(run.answer?.placeIds).toEqual([]);
  });

  it('will not dress a failed search as a recommendation', async () => {
    const { fn: callModel } = scripted([
      () => ({ answer: 'JCII Camera Museum.', placeIds: [FABRICATED_ID] }),
      () => searchCall(),
    ]);

    const run = await runAgent(ask(), {
      limits: AGENT_LIMITS.ask,
      callModel,
      executeTool: vi.fn(async () => searchFailed()),
      requiresPlaceDiscovery: true,
    });

    expect(run.status).not.toBe('answered');
    expect(run.status).toBe('partial');
    expect(run.placeDiscovery).toEqual({ required: true, attempted: true, succeeded: false, source: 'model-tool' });
    expect(run.answer).toBeUndefined();
    expect(run.detail).toMatch(/could not confirm a real place/i);
  });

  it('gives up after two wasted rounds instead of paying for six', async () => {
    // A model that never searches, however many times it is asked.
    const { fn: callModel } = scripted([
      () => ({ answer: 'JCII Camera Museum.', placeIds: [FABRICATED_ID] }),
    ]);
    const executeTool = vi.fn(async (): Promise<ToolOutcome> => searchHit());

    const run = await runAgent(ask(), {
      limits: AGENT_LIMITS.ask,
      callModel,
      executeTool,
      requiresPlaceDiscovery: true,
    });

    /**
     * The cost bound, and the reason it exists: one UI Ask is not one metered
     * call. Production spent all six rounds on exactly this input, and each
     * round was separately reserved, priced and counted against the daily
     * quota. Two refusals establish the model will not comply.
     */
    expect(callModel).toHaveBeenCalledTimes(2);
    expect(callModel.mock.calls.length).toBeLessThan(AGENT_LIMITS.ask.maxModelRounds);
    expect(executeTool).not.toHaveBeenCalled();

    // Still fails closed: the unsearched answer never becomes a recommendation.
    expect(run.status).toBe('partial');
    expect(run.answer).toBeUndefined();
    expect(run.placeDiscovery).toEqual({ required: true, attempted: false, succeeded: false, source: undefined });
    expect(run.detail).toMatch(/could not confirm a real place/i);
    // Both rounds are visible, and both say why they were refused.
    expect(run.diagnostics.map((d) => d.answerGate)).toEqual([
      'place-discovery-required',
      'place-discovery-required',
    ]);
  });

  it('names a malformed search call instead of counting it', async () => {
    // The hypothesis production could not distinguish: the model *did* ask for
    // search_places, but omitted the city the tool requires.
    const { fn: callModel } = scripted([
      () => ({ answer: 'JCII Camera Museum.', placeIds: [FABRICATED_ID] }),
      () => ({ tool_calls: [{ tool: 'search_places', args: { query: 'near Shinjuku' } }] }),
    ]);
    const executeTool = vi.fn(async (): Promise<ToolOutcome> => searchHit());

    const run = await runAgent(ask(), {
      limits: AGENT_LIMITS.ask,
      callModel,
      executeTool,
      requiresPlaceDiscovery: true,
    });

    // Rejected before dispatch, so the adapter never saw it.
    expect(executeTool).not.toHaveBeenCalled();
    expect(run.placeDiscovery).toEqual({ required: true, attempted: false, succeeded: false, source: undefined });
    expect(run.status).toBe('partial');
    expect(run.answer).toBeUndefined();

    // The whole point: this is now distinguishable from "never asked at all".
    const second = run.diagnostics[1];
    expect(second.turnKind).toBe('tools');
    expect(second.proposedToolCalls).toBe(1);
    expect(second.acceptedToolCalls).toBe(0);
    expect(second.rejectedToolCalls).toEqual([
      { tool: 'search_places', reason: 'invalid-args', argKeys: ['query'] },
    ]);
    // Round one is the other hypothesis, and reads differently.
    expect(run.diagnostics[0].turnKind).toBe('answer');
    expect(run.diagnostics[0].answerGate).toBe('place-discovery-required');
  });

  it('distinguishes a model that never proposes a tool at all', async () => {
    const { fn: callModel } = scripted([
      () => ({ answer: 'Somewhere nice.', placeIds: [] }),
    ]);

    const run = await runAgent(ask(), {
      limits: AGENT_LIMITS.ask,
      callModel,
      executeTool: vi.fn(async (): Promise<ToolOutcome> => searchHit()),
      requiresPlaceDiscovery: true,
    });

    expect(run.diagnostics.every((d) => d.turnKind === 'answer')).toBe(true);
    expect(run.diagnostics.every((d) => d.proposedToolCalls === 0)).toBe(true);
    expect(run.diagnostics.every((d) => d.rejectedToolCalls.length === 0)).toBe(true);
  });

  it('does not charge the recovery round that actually searches', async () => {
    // answer -> search -> answer must never be cut short by the cost bound,
    // because its middle round dispatches a tool.
    const { fn: callModel } = scripted([
      () => ({ answer: 'JCII Camera Museum.', placeIds: [FABRICATED_ID] }),
      () => searchCall(),
      () => ({ answer: 'Shinjuku Gyoen is worth the detour.', placeIds: [TRUSTED_ID] }),
    ]);

    const run = await runAgent(ask(), {
      limits: AGENT_LIMITS.ask,
      callModel,
      executeTool: vi.fn(async () => searchHit()),
      requiresPlaceDiscovery: true,
    });

    expect(callModel).toHaveBeenCalledTimes(3);
    expect(run.status).toBe('answered');
    expect(run.answer?.placeIds).toEqual([TRUSTED_ID]);
  });

  it('is not satisfied by re-reading the places the trip already holds', async () => {
    const { fn: callModel } = scripted([
      () => ({ tool_calls: [{ tool: 'get_saved_places', args: {} }] }),
      () => ({ answer: 'One of your saved places will do.', placeIds: [TRUSTED_ID] }),
    ]);

    const run = await runAgent(ask(), {
      limits: AGENT_LIMITS.ask,
      callModel,
      executeTool: vi.fn(async (): Promise<ToolOutcome> => ({
        ok: true,
        result: { places: [{ id: TRUSTED_ID, name: 'Shinjuku Gyoen National Garden' }] },
      })),
      requiresPlaceDiscovery: true,
    });

    // The id is genuinely referenceable, so the *answer* would have validated.
    // It is the request that was not honoured: somewhere new was asked for.
    expect(run.status).toBe('partial');
    expect(run.placeDiscovery.succeeded).toBe(false);
  });

  it('leaves every other question exactly as it was', async () => {
    const { fn: callModel } = scripted([() => ({ answer: 'Day 2 looks fine.' })]);
    const executeTool = vi.fn(async () => searchHit());

    const run = await runAgent(ask('Is day 2 too busy?'), {
      limits: AGENT_LIMITS.ask,
      callModel,
      executeTool,
    });

    expect(run.status).toBe('answered');
    expect(callModel).toHaveBeenCalledTimes(1);
    expect(executeTool).not.toHaveBeenCalled();
    expect(run.placeDiscovery).toEqual({ required: false, attempted: false, succeeded: false, source: undefined });
  });
});

describe('which questions are discovery questions', () => {
  const requires = (question: string) => deriveAskGroundingPlan({ question }).requiresPlaceDiscovery;

  it('classifies the question that failed in production', () => {
    expect(requires(PRODUCTION_QUESTION)).toBe(true);
  });

  it.each([
    'recommend somewhere to visit near Shinjuku',
    'suggest a restaurant around Ginza',
    'where should I go near here?',
    'find an attraction nearby',
    'any good cafes around Shibuya?',
  ])('asks for somewhere new: %s', (question) => {
    expect(requires(question)).toBe(true);
  });

  it.each([
    'How much budget do I have left?',
    'Why is Kushida Shrine not in my plan?',
    'What time can sightseeing start after my flight?',
    'What can I fit after this?',
    'Should I move Tokyo Tower to day 3?',
  ])('is about the plan that exists: %s', (question) => {
    expect(requires(question)).toBe(false);
  });

  it('needs a target before a verb counts as discovery', () => {
    // "find" alone is not a request for a place.
    expect(requires('find my booking confirmation')).toBe(false);
  });
});

/**
 * The server-owned pre-search.
 *
 * The gate above proves an unsearched recommendation cannot be accepted. It
 * does not make the search happen, and production showed the model will not
 * reliably start one: six metered rounds, zero dispatches. So discovery stops
 * being the model's decision. The server runs the search before the first
 * round and hands the results in as findings, which is the same channel a
 * model-requested tool result arrives on.
 *
 * Identity is untouched by this. Ids still originate in the provider result and
 * are still validated against the server-owned index; the only thing that
 * changed is who decided to look.
 */
describe('the server searches before the model speaks', () => {
  const seeded = (outcome: ToolOutcome) => ({
    seededFindings: [outcome.ok === true
      ? { tool: 'search_places', ok: true, result: outcome.result }
      : { tool: 'search_places', ok: false, detail: outcome.detail }],
    seededPlaceDiscovery: { attempted: true, succeeded: outcome.ok === true },
  });

  it('answers the production question in a single model round', async () => {
    const { fn: callModel, seen } = scripted([
      () => ({ answer: 'Shinjuku Gyoen is the one I would pick.', placeIds: [TRUSTED_ID] }),
    ]);
    const executeTool = vi.fn(async () => searchHit());

    const run = await runAgent(ask(), {
      limits: AGENT_LIMITS.ask,
      callModel,
      executeTool,
      requiresPlaceDiscovery: true,
      ...seeded(searchHit()),
    });

    // One paid round, where the old flow needed three at best and six at worst.
    expect(callModel).toHaveBeenCalledTimes(1);
    expect(run.status).toBe('answered');
    expect(run.answer?.placeIds).toEqual([TRUSTED_ID]);
    expect(run.placeDiscovery).toEqual({
      required: true, attempted: true, succeeded: true, source: 'server-presearch',
    });
    // The model saw the results on its very first round.
    expect(seen[0].findings).toEqual([
      { tool: 'search_places', ok: true, result: SEARCH_RESULT },
    ]);
    // The model never had to ask for the search itself.
    expect(executeTool).not.toHaveBeenCalled();
  });

  it('still rejects an invented id even with trusted results in hand', async () => {
    const { fn: callModel } = scripted([
      () => ({ answer: 'Both of these are good.', placeIds: [FABRICATED_ID, TRUSTED_ID] }),
    ]);

    const run = await runAgent(ask(), {
      limits: AGENT_LIMITS.ask,
      callModel,
      executeTool: vi.fn(async () => searchHit()),
      requiresPlaceDiscovery: true,
      ...seeded(searchHit()),
    });

    expect(run.status).toBe('answered');
    expect(run.answer?.placeIds).toEqual([TRUSTED_ID]);
    expect(run.answer?.rejected).toContainEqual({
      value: FABRICATED_ID, reason: 'unreferenced-place-id',
    });
  });

  it('produces no card when the model ignores every trusted result', async () => {
    const { fn: callModel } = scripted([
      () => ({ answer: 'I like the Camera Museum.', placeIds: [FABRICATED_ID] }),
    ]);

    const run = await runAgent(ask(), {
      limits: AGENT_LIMITS.ask,
      callModel,
      executeTool: vi.fn(async () => searchHit()),
      requiresPlaceDiscovery: true,
      ...seeded(searchHit()),
    });

    // The search succeeded, so the answer is allowed to stand as prose.
    expect(run.status).toBe('answered');
    // But nothing it pointed at was real, so nothing becomes a card.
    expect(run.answer?.placeIds).toEqual([]);
  });

  it('lets a pre-search that found nothing finish truthfully', async () => {
    const { fn: callModel } = scripted([
      () => ({ answer: 'I could not find a verified place matching that request.' }),
    ]);

    const run = await runAgent(ask(), {
      limits: AGENT_LIMITS.ask,
      callModel,
      executeTool: vi.fn(async () => searchEmpty()),
      requiresPlaceDiscovery: true,
      ...seeded(searchEmpty()),
    });

    expect(callModel).toHaveBeenCalledTimes(1);
    expect(run.status).toBe('answered');
    expect(run.answer?.placeIds).toEqual([]);
    expect(run.placeDiscovery.succeeded).toBe(true);
  });

  it('will not recommend from memory when the pre-search failed', async () => {
    const { fn: callModel, seen } = scripted([
      () => ({ answer: 'The Camera Museum is lovely.', placeIds: [FABRICATED_ID] }),
    ]);

    const run = await runAgent(ask(), {
      limits: AGENT_LIMITS.ask,
      callModel,
      executeTool: vi.fn(async () => searchFailed()),
      requiresPlaceDiscovery: true,
      ...seeded(searchFailed()),
    });

    expect(run.status).toBe('partial');
    expect(run.answer).toBeUndefined();
    expect(run.placeDiscovery).toEqual({
      required: true, attempted: true, succeeded: false, source: 'server-presearch',
    });
    // Bounded, not six rounds.
    expect(callModel.mock.calls.length).toBeLessThanOrEqual(2);
    // The model was told the search failed rather than left to guess.
    expect(seen[0].findings[0]).toEqual({
      tool: 'search_places', ok: false, detail: 'The place search failed.',
    });
  });
});

describe('where the server looks', () => {
  const areaFor = (question: string) => deriveAskGroundingPlan({ question }).placeDiscoveryArea;

  it('takes the area from the production question', () => {
    expect(areaFor(PRODUCTION_QUESTION)).toBe('shinjuku');
  });

  it.each([
    ['suggest a restaurant around Ginza', 'ginza'],
    ['find a cafe near Shibuya, please', 'shibuya'],
    ['recommend somewhere to visit in Asakusa', 'asakusa'],
  ])('%s', (question, expected) => {
    expect(areaFor(question)).toBe(expected);
  });

  it.each([
    'where should I go near here?',
    'find one place worth visiting in this trip',
  ])('refuses a non-place as a search area: %s', (question) => {
    // Falls back to the trip's own city rather than searching for "here".
    expect(areaFor(question)).toBeUndefined();
  });

  it('has no area to offer for a non-discovery question', () => {
    expect(areaFor('How much budget do I have left?')).toBeUndefined();
  });
});
