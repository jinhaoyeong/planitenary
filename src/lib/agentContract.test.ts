/**
 * The agent's contract, imported straight from the Deno `_shared` module
 * (which has no Deno APIs) — the precedent set by `placeCost.test.ts`.
 *
 * Four invariants carry this file, and each closes a way the agent could stop
 * being safe without anybody noticing:
 *
 * 1. **It cannot write.** Not "does not"; cannot. The dispatch table has no
 *    mutating tool, and adding one has to fail here before it can ship.
 * 2. **It cannot invent a fact.** A travel time, a citation or a place name in
 *    the answer must be one a tool actually returned.
 * 3. **A route number may only come from a routing tool.** A duration that
 *    appeared in a search snippet must not become quotable as a travel time.
 * 4. **No image is ever generated.** The image tool resolves real photographs
 *    and nothing in the catalogue offers an alternative.
 */
import { describe, expect, it } from 'vitest';
import {
  AGENT_LIMITS,
  AGENT_MAX_OUTPUT_TOKENS,
  AGENT_OPENAI_MODEL,
  AGENT_OPENAI_MODELS_BY_OPERATION,
  AGENT_OPERATIONS,
  AGENT_TOOLS,
  AGENT_TOOL_NAMES,
  agentModelRefusal,
  chargeTool,
  collectEvidence,
  emptyBudget,
  emptyEvidence,
  isAgentOperation,
  isFinalRound,
  isMutatingToolName,
  parseAgentTurn,
  validateAgentAnswer,
} from '../../supabase/functions/_shared/agentContract';

describe('the agent cannot write anything', () => {
  it('exposes no tool whose name is a mutation', () => {
    // The guarantee is structural: the runtime dispatches from AGENT_TOOLS
    // alone, so a name absent here cannot be reached however the model spells
    // it. This test is what stops a future "just one convenient write tool"
    // from shipping quietly.
    const mutating = AGENT_TOOL_NAMES.filter((name) => isMutatingToolName(name));
    expect(mutating).toEqual([]);
  });

  it('has no tool that persists, books or applies anything', () => {
    const forbidden = ['save_itinerary', 'update_activity', 'delete_place', 'move_day', 'book', 'apply_changes'];
    for (const name of forbidden) expect(AGENT_TOOL_NAMES).not.toContain(name);
  });

  it('refuses a write tool name the model asks for anyway', () => {
    const turn = parseAgentTurn({ tool_calls: [{ tool: 'save_itinerary', args: { day: 1 } }] });
    // Recorded as a rejected call, never dispatched.
    expect(turn).toEqual({ kind: 'tools', calls: [], rejected: 1 });
  });
});

describe('no photograph is ever generated', () => {
  it('offers exactly one image tool, and it fetches real ones', () => {
    const imageTools = AGENT_TOOL_NAMES.filter((name) => name.includes('image'));
    expect(imageTools).toEqual(['get_place_images']);
    expect(AGENT_TOOLS.get_place_images.description).toMatch(/Wikimedia Commons/);
    expect(AGENT_TOOLS.get_place_images.description).toMatch(/never generated/i);
  });

  it('offers no tool that could produce an image', () => {
    for (const name of ['generate_image', 'create_image', 'render_image', 'imagine']) {
      expect(AGENT_TOOL_NAMES).not.toContain(name);
    }
  });
});

describe('only gpt-5-nano, and never corrected to it', () => {
  it('approves nano for every operation', () => {
    for (const operation of AGENT_OPERATIONS) {
      expect(AGENT_OPENAI_MODELS_BY_OPERATION[operation]).toEqual([AGENT_OPENAI_MODEL]);
      expect(agentModelRefusal(operation, AGENT_OPENAI_MODEL)).toBeUndefined();
    }
  });

  it('refuses any other model rather than silently downgrading', () => {
    // A deployment that set an expensive model and was quietly corrected to
    // nano would look identical to one that chose nano deliberately — and the
    // same mistake in the other direction is the expensive one.
    const refusal = agentModelRefusal('ask', 'gpt-5-sol');
    expect(refusal).toContain('gpt-5-sol');
    expect(refusal).toContain('not approved');
  });

  it('rejects an operation nobody declared', () => {
    expect(isAgentOperation('ask')).toBe(true);
    expect(isAgentOperation('build-itinerary')).toBe(true);
    expect(isAgentOperation('save-itinerary')).toBe(false);
    expect(isAgentOperation('candidate-intelligence')).toBe(false);
  });
});

describe('every operation is bounded on every axis', () => {
  it('caps rounds, tools, searches, routes and lookups for each operation', () => {
    for (const operation of AGENT_OPERATIONS) {
      const limits = AGENT_LIMITS[operation];
      for (const [name, value] of Object.entries(limits)) {
        if (operation === 'build-itinerary' && name === 'maxWebSearches') expect(value).toBe(0);
        else expect(value).toBeGreaterThan(0);
        expect(Number.isFinite(value)).toBe(true);
      }
      // Ask stays smaller; the complete-planning operation gets a hard eight
      // round ceiling but normally uses one composition plus at most 2 repairs.
      expect(limits.maxModelRounds).toBeLessThanOrEqual(operation === 'build-itinerary' ? 8 : 6);
      expect(limits.maxWebSearches).toBeLessThanOrEqual(2);
      expect(AGENT_MAX_OUTPUT_TOKENS[operation]).toBeLessThanOrEqual(operation === 'build-itinerary' ? 3_000 : 1_600);
    }
    expect(AGENT_LIMITS['build-itinerary']).toMatchObject({
      maxModelRounds: 8,
      maxWebSearches: 0,
      maxRouteCalls: 3,
    });
  });

  it('stops charging once a budget line is spent', () => {
    const limits = AGENT_LIMITS.ask;
    let budget = emptyBudget();
    for (let i = 0; i < limits.maxWebSearches; i += 1) {
      const charge = chargeTool(budget, 'search_web', limits);
      expect(charge.ok).toBe(true);
      if (charge.ok) budget = charge.budget;
    }
    expect(chargeTool(budget, 'search_web', limits)).toEqual({ ok: false, refusal: 'web-searches-exhausted' });
    // A different budget line is unaffected — one exhausted axis must not
    // silently disable the others.
    expect(chargeTool(budget, 'get_trip', limits).ok).toBe(true);
  });

  it('charges a route matrix once however many pairs it covers', () => {
    // This is what makes consolidating pairs into one call worth doing.
    const limits = AGENT_LIMITS.ask;
    const charge = chargeTool(emptyBudget(), 'get_route_matrix', limits);
    expect(charge.ok && charge.budget.routeCalls).toBe(1);
  });

  it('marks the last affordable round as final, so the budget always buys an answer', () => {
    const limits = AGENT_LIMITS['research-place'];
    const budget = { ...emptyBudget(), modelRounds: limits.maxModelRounds - 1 };
    expect(isFinalRound(budget, limits)).toBe(true);
    expect(isFinalRound(emptyBudget(), limits)).toBe(false);
  });
});

describe('malformed model output fails safely', () => {
  it('treats unreadable turns as unusable rather than throwing', () => {
    for (const value of [null, undefined, 'a string', [], 42, {}]) {
      expect(parseAgentTurn(value).kind).toBe('unusable');
    }
  });

  it('drops a tool call with invalid arguments and keeps the valid ones', () => {
    const turn = parseAgentTurn({
      tool_calls: [
        { tool: 'get_route', args: { fromPlaceId: 'a' } }, // missing destination
        { tool: 'get_trip', args: {} },
      ],
    });
    expect(turn.kind).toBe('tools');
    if (turn.kind === 'tools') {
      expect(turn.calls.map((call) => call.tool)).toEqual(['get_trip']);
      expect(turn.rejected).toBe(1);
    }
  });

  it('bounds an unbounded argument rather than passing it to a provider', () => {
    const turn = parseAgentTurn({ tool_calls: [{ tool: 'search_web', args: { query: 'x'.repeat(500) } }] });
    expect(turn).toEqual({ kind: 'tools', calls: [], rejected: 1 });
  });

  it('prefers tool calls over an answer when a turn claims both', () => {
    // Acting on a half-informed answer is the worse of the two mistakes.
    const turn = parseAgentTurn({ tool_calls: [{ tool: 'get_trip', args: {} }], answer: 'Go to the park.' });
    expect(turn.kind).toBe('tools');
  });
});

describe('an answer is held to what the tools returned', () => {
  const evidenceFrom = (tool: 'get_route' | 'search_web', result: unknown) =>
    collectEvidence(emptyEvidence(), tool, result);

  it('keeps a structured replan preview read-only and drops invented move targets', () => {
    const evidence = collectEvidence(emptyEvidence(), 'get_current_itinerary', {
      days: [{ activities: [{ name: 'Osaka Castle' }] }],
    });
    const turn = parseAgentTurn({
      answer: 'Move the castle to Day 3.',
      citations: [],
      proposal: {
        summary: 'A lighter Day 2.',
        replan: {
          objective: 'Make Day 2 less tiring.',
          affectedDays: [2, 3],
          moves: [
            { placeName: 'Osaka Castle', fromDay: 2, toDay: 3 },
            { placeName: 'Invented Palace', fromDay: 2, toDay: 3 },
          ],
        },
      },
    });
    expect(turn.kind).toBe('answer');
    if (turn.kind !== 'answer') return;
    const validated = validateAgentAnswer(turn.answer, evidence);
    expect(validated.proposal?.replan?.moves).toEqual([
      { placeName: 'Osaka Castle', fromDay: 2, toDay: 3 },
    ]);
    expect(validated.rejected).toContainEqual({ value: 'Invented Palace', reason: 'invented-place' });
  });

  it('keeps a citation a tool returned and drops one it did not', () => {
    const evidence = evidenceFrom('search_web', {
      results: [{ title: 'Osaka guide', url: 'https://en.wikivoyage.org/wiki/Osaka' }],
    });
    const validated = validateAgentAnswer(
      {
        answer: 'Osaka Castle is worth the morning.',
        citations: ['https://en.wikivoyage.org/wiki/Osaka', 'https://invented.example/osaka'],
      },
      evidence,
    );
    expect(validated.citations).toEqual(['https://en.wikivoyage.org/wiki/Osaka']);
    // A composed link is worse than no link: it looks checkable and is not.
    expect(validated.rejected).toEqual([{ value: 'https://invented.example/osaka', reason: 'uncited-url' }]);
  });

  it('keeps a travel time a routing tool returned', () => {
    const evidence = evidenceFrom('get_route', { matrix: [{ durationMinutes: 27 }] });
    const validated = validateAgentAnswer(
      { answer: 'Take the train.', citations: [], proposal: { summary: 'Train', travelMinutes: 27 } },
      evidence,
    );
    expect(validated.proposal?.travelMinutes).toBe(27);
    expect(validated.rejected).toEqual([]);
  });

  it('drops a travel time the model estimated', () => {
    // The architecture rule, made mechanical: the model may choose between 27
    // minutes by train and 51 on foot. It may not offer 18.
    const evidence = evidenceFrom('get_route', { matrix: [{ durationMinutes: 27 }, { durationMinutes: 51 }] });
    const validated = validateAgentAnswer(
      { answer: 'About 18 minutes.', citations: [], proposal: { summary: 'Walk', travelMinutes: 18 } },
      evidence,
    );
    expect(validated.proposal?.travelMinutes).toBeUndefined();
    expect(validated.rejected).toEqual([
      { value: '18 minutes', reason: 'invented-travel-time' },
      { value: '18 minutes', reason: 'invented-travel-time-in-answer' },
    ]);
    // The prose is never rewritten — only the structured claim is withdrawn.
    expect(validated.answer).toMatch(/could not verify the travel time/i);
  });

  it('keeps route-time prose only when the routing tool returned that value', () => {
    const evidence = evidenceFrom('get_route', { matrix: [[{ durationMinutes: 27 }]] });
    const validated = validateAgentAnswer(
      { answer: 'The transfer takes 27 minutes.', citations: [] },
      evidence,
    );
    expect(validated.answer).toBe('The transfer takes 27 minutes.');
    expect(validated.rejected).toEqual([]);
  });

  it('refuses to let a duration from a web snippet become a travel time', () => {
    // The substitution this rule exists to prevent: a number that appeared in
    // somebody's blog post is not a routing result.
    const evidence = evidenceFrom('search_web', {
      results: [{ title: 'Blog', url: 'https://example.org/a', durationMinutes: 18 }],
    });
    expect(evidence.routeMinutes.size).toBe(0);
    const validated = validateAgentAnswer(
      { answer: 'Quick trip.', citations: [], proposal: { summary: 'Walk', travelMinutes: 18 } },
      evidence,
    );
    expect(validated.proposal?.travelMinutes).toBeUndefined();
  });

  it('drops a place no tool ever mentioned', () => {
    const evidence = evidenceFrom('search_web', { results: [{ title: 'Osaka Castle', url: 'https://x.test/1' }] });
    const validated = validateAgentAnswer(
      {
        answer: 'Two options.',
        citations: [],
        proposal: { summary: 'Swap', placeNames: ['Osaka Castle', 'The Invented Pagoda'] },
      },
      evidence,
    );
    expect(validated.proposal?.placeNames).toEqual(['Osaka Castle']);
    expect(validated.rejected).toContainEqual({ value: 'The Invented Pagoda', reason: 'invented-place' });
  });

  it('drops a money amount the model invented without budget evidence', () => {
    const evidence = collectEvidence(emptyEvidence(), 'get_current_itinerary', {
      days: [{ activities: [{ name: 'Osaka Castle' }] }],
    });
    const validated = validateAgentAnswer(
      { answer: 'You’ll probably spend RM900.', citations: [] },
      evidence,
    );
    expect(validated.rejected).toContainEqual({ value: '900', reason: 'invented-budget-amount' });
    expect(validated.answer).toMatch(/could not verify that money amount/i);
  });

  it('keeps a recorded spend a budget tool returned', () => {
    const evidence = collectEvidence(emptyEvidence(), 'get_budget_summary', {
      present: true,
      currency: 'MYR',
      spent: 420,
      remainingKnownBudget: 180,
    });
    const validated = validateAgentAnswer(
      { answer: 'Your recorded spending is RM420.', citations: [] },
      evidence,
    );
    expect(validated.rejected).toEqual([]);
    expect(validated.answer).toBe('Your recorded spending is RM420.');
  });
});
