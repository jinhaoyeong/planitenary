/**
 * The agent loop's bounds, exercised without a model or a network.
 *
 * The loop takes its model caller and its tool executor as dependencies for
 * exactly this reason — the same precedent as `intelligenceService.ts`. What
 * matters here is not that the agent answers well; it is that it **stops**,
 * that every provider round goes through the injected metered door, and that
 * hitting a limit produces a partial answer rather than either an exception or
 * a loop that keeps spending.
 */
import { describe, expect, it, vi } from 'vitest';
import { AGENT_LIMITS } from '../../supabase/functions/_shared/agentContract';
import { runAgent, toolCatalogue } from '../../supabase/functions/_shared/agentRuntime';
import type { AgentModelPayload, ModelCallOutcome, ToolOutcome } from '../../supabase/functions/_shared/agentRuntime';

const ask = { operation: 'ask' as const, question: 'What should we do tonight?', context: { tripId: 't1' } };

/** A model that always asks for one more tool — the shape a cap must survive. */
const insatiable = (tool = 'get_trip') =>
  vi.fn(async (): Promise<ModelCallOutcome> => ({ ok: true, value: { tool_calls: [{ tool, args: {} }] } }));

const answers = (answer: string, citations: string[] = []) =>
  vi.fn(async (): Promise<ModelCallOutcome> => ({ ok: true, value: { answer, citations } }));

const toolOk = (result: unknown = { ok: true }) => vi.fn(async (): Promise<ToolOutcome> => ({ ok: true, result }));

describe('the loop always stops', () => {
  it('fails closed before a model call when the serialised input exceeds its cap', async () => {
    const callModel = answers('Should never be called.');
    const run = await runAgent(
      { ...ask, question: 'x'.repeat(200) },
      { limits: { ...AGENT_LIMITS.ask, maxInputChars: 50 }, callModel, executeTool: toolOk() },
    );
    expect(callModel).not.toHaveBeenCalled();
    expect(run.status).toBe('refused');
    expect(run.detail).toMatch(/input limit/i);
  });

  it('never exceeds its model-round cap, however eager the model is', async () => {
    const limits = AGENT_LIMITS.ask;
    const callModel = insatiable();
    const run = await runAgent(ask, { limits, callModel, executeTool: toolOk() });

    expect(callModel).toHaveBeenCalledTimes(limits.maxModelRounds);
    expect(run.budget.modelRounds).toBe(limits.maxModelRounds);
    // No answer was produced, so the honest outcome is a partial one — not an
    // error, and not a seventh round.
    expect(run.status).toBe('partial');
  });

  it('withdraws the tool catalogue on the final round, so the budget buys an answer', async () => {
    const limits = AGENT_LIMITS['research-place'];
    const payloads: AgentModelPayload[] = [];
    const callModel = vi.fn(async (payload: AgentModelPayload): Promise<ModelCallOutcome> => {
      payloads.push(payload);
      return { ok: true, value: { tool_calls: [{ tool: 'get_trip', args: {} }] } };
    });

    await runAgent(ask, { limits, callModel, executeTool: toolOk() });

    const last = payloads[payloads.length - 1];
    expect(last.finalRound).toBe(true);
    expect(last.tools).toEqual([]);
    // Every earlier round did get the catalogue.
    expect(payloads[0].tools.length).toBe(toolCatalogue().length);
    expect(payloads[0].finalRound).toBe(false);
  });

  it('stops calling tools once the tool budget is spent', async () => {
    const limits = AGENT_LIMITS.ask;
    const executeTool = toolOk();
    await runAgent(ask, { limits, callModel: insatiable(), executeTool });
    expect(executeTool.mock.calls.length).toBeLessThanOrEqual(limits.maxToolCalls);
  });

  it('stops web searching at the cap and tells the model why', async () => {
    const limits = AGENT_LIMITS.ask;
    const executeTool = toolOk({ results: [] });
    const payloads: AgentModelPayload[] = [];
    const callModel = vi.fn(async (payload: AgentModelPayload): Promise<ModelCallOutcome> => {
      payloads.push(payload);
      return { ok: true, value: { tool_calls: [{ tool: 'search_web', args: { query: 'osaka tonight' } }] } };
    });

    const run = await runAgent(ask, { limits, callModel, executeTool });

    expect(executeTool).toHaveBeenCalledTimes(limits.maxWebSearches);
    // The refusal is reported to the model as a finding rather than ending the
    // run, so it can answer with what it has instead of the traveller getting
    // nothing because the third search was one too many.
    const refusals = run.transcript.filter((entry) => entry.detail === 'web-searches-exhausted');
    expect(refusals.length).toBeGreaterThan(0);
    const lastFindings = payloads[payloads.length - 1].findings;
    expect(lastFindings.some((finding) => finding.detail?.includes('web-searches-exhausted'))).toBe(true);
  });
});

describe('every round goes through the injected metered door', () => {
  it('makes exactly one model call per round and no more', async () => {
    const callModel = answers('Dotonbori is lively after dark.');
    const run = await runAgent(ask, { limits: AGENT_LIMITS.ask, callModel, executeTool: toolOk() });
    expect(callModel).toHaveBeenCalledTimes(1);
    expect(run.budget.modelRounds).toBe(1);
    expect(run.status).toBe('answered');
  });

  it('surfaces a metered refusal instead of retrying it', async () => {
    // Retrying a refused call would convert a quota stop into a bill, which is
    // the shape this project has already paid for once.
    const callModel = vi.fn(async (): Promise<ModelCallOutcome> => ({
      ok: false, refusal: 'quota-exhausted', detail: 'Daily limit reached.',
    }));
    const run = await runAgent(ask, { limits: AGENT_LIMITS.ask, callModel, executeTool: toolOk() });

    expect(callModel).toHaveBeenCalledTimes(1);
    expect(run.status).toBe('refused');
    expect(run.refusal).toBe('quota-exhausted');
  });

  it('keeps what it already gathered when the budget stops it mid-run', async () => {
    let round = 0;
    const callModel = vi.fn(async (): Promise<ModelCallOutcome> => {
      round += 1;
      if (round === 1) return { ok: true, value: { tool_calls: [{ tool: 'get_trip', args: {} }] } };
      return { ok: false, refusal: 'budget-reached', detail: 'Ceiling reached.' };
    });

    const run = await runAgent(ask, { limits: AGENT_LIMITS.ask, callModel, executeTool: toolOk() });

    // Findings already cost something; discarding them helps nobody.
    expect(run.status).toBe('partial');
    expect(run.transcript).toContainEqual({ tool: 'get_trip', ok: true });
  });
});

describe('failures degrade rather than throw', () => {
  it('survives a tool that throws', async () => {
    const executeTool = vi.fn(async () => { throw new Error('provider exploded'); });
    const run = await runAgent(ask, {
      limits: AGENT_LIMITS.ask,
      callModel: insatiable(),
      executeTool,
    });
    expect(run.status).toBe('partial');
    expect(run.transcript.every((entry) => entry.ok === false)).toBe(true);
  });

  it('reports a failing tool to the model rather than hiding it', async () => {
    const payloads: AgentModelPayload[] = [];
    let round = 0;
    const callModel = vi.fn(async (payload: AgentModelPayload): Promise<ModelCallOutcome> => {
      payloads.push(payload);
      round += 1;
      if (round === 1) return { ok: true, value: { tool_calls: [{ tool: 'get_weather', args: {} }] } };
      return { ok: true, value: { answer: 'I could not read the forecast.', citations: [] } };
    });
    const executeTool = vi.fn(async (): Promise<ToolOutcome> => ({ ok: false, detail: 'No coordinates on this trip.' }));

    const run = await runAgent(ask, { limits: AGENT_LIMITS.ask, callModel, executeTool });

    expect(payloads[1].findings).toContainEqual({
      tool: 'get_weather', ok: false, detail: 'No coordinates on this trip.',
    });
    expect(run.status).toBe('answered');
  });

  it('recovers from one unreadable reply instead of ending the run', async () => {
    let round = 0;
    const callModel = vi.fn(async (): Promise<ModelCallOutcome> => {
      round += 1;
      if (round === 1) return { ok: true, value: 'not json at all' };
      return { ok: true, value: { answer: 'Try Dotonbori.', citations: [] } };
    });
    const run = await runAgent(ask, { limits: AGENT_LIMITS.ask, callModel, executeTool: toolOk() });
    expect(run.status).toBe('answered');
    expect(run.answer?.answer).toBe('Try Dotonbori.');
  });
});

describe('nothing the loop can do changes the trip', () => {
  it('never dispatches a tool outside the read-only catalogue', async () => {
    const dispatched: string[] = [];
    const executeTool = vi.fn(async (call: { tool: string }): Promise<ToolOutcome> => {
      dispatched.push(call.tool);
      return { ok: true, result: {} };
    });
    let round = 0;
    const callModel = vi.fn(async (): Promise<ModelCallOutcome> => {
      round += 1;
      if (round === 1) {
        return {
          ok: true,
          value: {
            tool_calls: [
              { tool: 'save_itinerary', args: { day: 1 } },
              { tool: 'delete_place', args: { id: 'x' } },
            ],
          },
        };
      }
      return { ok: true, value: { answer: 'Here is a proposal you can apply yourself.', citations: [] } };
    });

    const run = await runAgent(ask, { limits: AGENT_LIMITS.ask, callModel, executeTool });

    expect(dispatched).toEqual([]);
    expect(run.status).toBe('answered');
  });
});
