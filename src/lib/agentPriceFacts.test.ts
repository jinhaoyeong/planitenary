/**
 * Verified prices have to survive the run that established them.
 *
 * `AgentRunResult.evidence` is deliberately counts — how much was gathered,
 * for diagnostics — so anything projected into it loses its contents. Price
 * facts were being read back out of it, which meant the response carried
 * `undefined` on exactly the questions the feature exists for, and the
 * verified-price panel silently never rendered. Nothing caught it because
 * every existing test asserted the *shape* of a price fact or the grounding
 * packet, and none followed one all the way through `runAgent` to what a
 * caller receives.
 *
 * That is what these cover: the seam, not the ends.
 */
import { describe, expect, it, vi } from 'vitest';
import { AGENT_LIMITS, emptyEvidence } from '../../supabase/functions/_shared/agentContract';
import { runAgent } from '../../supabase/functions/_shared/agentRuntime';
import type { ModelCallOutcome, ToolOutcome } from '../../supabase/functions/_shared/agentRuntime';
import type { AskPriceFact } from '../../supabase/functions/_shared/askPriceFacts';

const ask = {
  operation: 'ask' as const,
  question: 'How much are Universal Studios Japan tickets?',
  context: { tripId: 't1' },
};

const usj: AskPriceFact = {
  name: 'Universal Studios Japan',
  kind: 'admission',
  fares: [{ audience: 'adult', amount: 8_600, currency: 'JPY' }],
  source: 'official-website',
  sourceUrl: 'https://www.usj.co.jp/en/tickets/',
  retrievedAt: '2026-08-20T00:00:00.000Z',
};

const answers = (answer: string, citations: string[] = []) =>
  vi.fn(async (): Promise<ModelCallOutcome> => ({ ok: true, value: { answer, citations } }));

/** Evidence as the grounding packet hands it over, before the run starts. */
const seededWith = (facts: AskPriceFact[]) => ({ ...emptyEvidence(), priceFacts: facts });

describe('a price the run established reaches the caller', () => {
  it('carries seeded grounding fares out of the run', async () => {
    const run = await runAgent(ask, {
      limits: AGENT_LIMITS.ask,
      callModel: answers('Adult admission is ¥8,600.'),
      executeTool: vi.fn(async (): Promise<ToolOutcome> => ({ ok: true, result: {} })),
      seededEvidence: seededWith([usj]),
    });

    expect(run.priceFacts).toHaveLength(1);
    expect(run.priceFacts[0]).toMatchObject({
      name: 'Universal Studios Japan',
      kind: 'admission',
      sourceUrl: 'https://www.usj.co.jp/en/tickets/',
    });
    expect(run.priceFacts[0].fares[0]).toMatchObject({ audience: 'adult', amount: 8_600, currency: 'JPY' });
  });

  /**
   * The regression in one assertion. `evidence` counts; it has never held the
   * facts, and reading them from there is what produced `undefined`.
   */
  it('does not hide them inside the counts summary', async () => {
    const run = await runAgent(ask, {
      limits: AGENT_LIMITS.ask,
      callModel: answers('Adult admission is ¥8,600.'),
      executeTool: vi.fn(async (): Promise<ToolOutcome> => ({ ok: true, result: {} })),
      seededEvidence: seededWith([usj]),
    });

    expect(run.evidence).not.toHaveProperty('priceFacts');
    expect(Object.values(run.evidence).every((value) => typeof value === 'number')).toBe(true);
  });

  it('is an empty list, never undefined, when nothing priced was found', async () => {
    const run = await runAgent(ask, {
      limits: AGENT_LIMITS.ask,
      callModel: answers('I could not find a published fare.'),
      executeTool: vi.fn(async (): Promise<ToolOutcome> => ({ ok: true, result: {} })),
    });

    expect(run.priceFacts).toEqual([]);
  });

  /**
   * A caller must not be able to reach back into the run's own accumulator —
   * the result is a report of what happened, not a live handle on it.
   */
  it('hands out a copy rather than the run’s own array', async () => {
    const seeded = seededWith([usj]);
    const run = await runAgent(ask, {
      limits: AGENT_LIMITS.ask,
      callModel: answers('Adult admission is ¥8,600.'),
      executeTool: vi.fn(async (): Promise<ToolOutcome> => ({ ok: true, result: {} })),
      seededEvidence: seeded,
    });

    run.priceFacts[0].name = 'Mutated';
    run.priceFacts[0].fares[0].amount = 1;
    expect(seeded.priceFacts[0].name).toBe('Universal Studios Japan');
    expect(seeded.priceFacts[0].fares[0].amount).toBe(8_600);
  });

  /** A refusal still reports honestly rather than dropping the field. */
  it('is present even when the run refuses', async () => {
    const run = await runAgent(
      { ...ask, question: 'x'.repeat(200) },
      {
        limits: { ...AGENT_LIMITS.ask, maxInputChars: 50 },
        callModel: answers('Should never be called.'),
        executeTool: vi.fn(async (): Promise<ToolOutcome> => ({ ok: true, result: {} })),
      },
    );

    expect(run.status).toBe('refused');
    expect(run.priceFacts).toEqual([]);
  });
});
