/**
 * What the browser is allowed to say about a place: nothing.
 *
 * Smart Plan holds a `StructuredPlaceRef` locally, and it needs one — that is
 * how `deriveSmartActions` decides offline whether an action could show a card
 * at all. The temptation is to send it and let the server resolve it, which
 * would be one line shorter and would make every card exactly as trustworthy as
 * the client that asked for it.
 *
 * So the request names a *decision* and the server answers with the place that
 * decision was actually made about, read from the traveller's own trip. These
 * tests hold that boundary from the client side: what leaves the browser, and
 * what it is willing to believe on the way back.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolvePlaceCards } from './placeCards';
import type { StructuredPlaceCard } from '../../supabase/functions/_shared/placeReference';

const CARD: StructuredPlaceCard = {
  ref: { canonicalPlaceId: 'c-1111', provider: 'osm', providerPlaceId: 'n250668618' },
  name: 'Shinjuku Gyoen National Garden',
  city: 'Tokyo',
  decision: 'must-do',
  image: {
    url: 'https://upload.wikimedia.org/a/b.jpg',
    attribution: 'someone · CC BY 2.0 · Wikimedia Commons',
    sourcePage: 'https://commons.wikimedia.org/wiki/File:b.jpg',
  },
};

describe('the request names a decision, never a place', () => {
  it('sends the decision key and nothing that could identify a place', async () => {
    const invoke = vi.fn(async () => ({ cards: [{ decisionKey: 'osm-n250668618', place: CARD }] }));
    await resolvePlaceCards({ tripId: 'trip-1', decisionKeys: ['osm-n250668618'] }, invoke);

    // The mock records untyped args; naming them here is clearer than
    // declaring parameters the implementation never uses.
    const [name, body] = invoke.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(name).toBe('planitenary-agent');
    expect(body).toEqual({
      operation: 'resolve-place-cards',
      tripId: 'trip-1',
      decisionKeys: ['osm-n250668618'],
    });

    // The whole point, stated as an assertion: no reference of any kind leaves
    // the browser, so there is nothing for the server to be tempted to trust.
    const wire = JSON.stringify(body);
    for (const forbidden of ['canonicalPlaceId', 'providerPlaceId', 'placeRef', 'provider']) {
      expect(wire).not.toContain(forbidden);
    }
  });

  it('returns the card the server resolved for that decision', async () => {
    const invoke = vi.fn(async () => ({ cards: [{ decisionKey: 'osm-n250668618', place: CARD }] }));
    const cards = await resolvePlaceCards({ tripId: 'trip-1', decisionKeys: ['osm-n250668618'] }, invoke);
    expect(cards.get('osm-n250668618')?.name).toBe('Shinjuku Gyoen National Garden');
  });

  it('ignores an answer to a decision it never asked about', async () => {
    // A response that volunteers other decisions is not permitted to populate
    // the map for them.
    const invoke = vi.fn(async () => ({
      cards: [{ decisionKey: 'someone-elses-decision', place: CARD }],
    }));
    const cards = await resolvePlaceCards({ tripId: 'trip-1', decisionKeys: ['osm-n250668618'] }, invoke);
    expect(cards.size).toBe(0);
  });

  it('drops a card whose photograph is not hosted where it must be', async () => {
    const offsite: StructuredPlaceCard = {
      ...CARD,
      image: { ...CARD.image!, url: 'https://tracker.example/pixel.jpg' },
    };
    const invoke = vi.fn(async () => ({ cards: [{ decisionKey: 'k', place: offsite }] }));
    const cards = await resolvePlaceCards({ tripId: 'trip-1', decisionKeys: ['k'] }, invoke);
    // The place survives; the off-host image does not, because an <img src> is
    // loaded by the traveller's browser.
    expect(cards.get('k')?.name).toBe('Shinjuku Gyoen National Garden');
    expect(cards.get('k')?.image).toBeUndefined();
  });

  it('asks for nothing when there is nothing to ask about', async () => {
    const invoke = vi.fn(async () => ({ cards: [] }));
    expect((await resolvePlaceCards({ tripId: 'trip-1', decisionKeys: [] }, invoke)).size).toBe(0);
    expect((await resolvePlaceCards({ tripId: '', decisionKeys: ['k'] }, invoke)).size).toBe(0);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('degrades to no cards when the call fails', async () => {
    const invoke = vi.fn(async () => { throw new Error('offline'); });
    const cards = await resolvePlaceCards({ tripId: 'trip-1', decisionKeys: ['k'] }, invoke);
    expect(cards.size).toBe(0);
  });

  it('survives a malformed response without throwing', async () => {
    for (const payload of [null, {}, { cards: 'nope' }, { cards: [null, 42, {}] }]) {
      const invoke = vi.fn(async () => payload);
      const cards = await resolvePlaceCards({ tripId: 'trip-1', decisionKeys: ['k'] }, invoke);
      expect(cards.size).toBe(0);
    }
  });
});

describe('the operation cannot reach the model tier', () => {
  const agentSource = readFileSync('supabase/functions/planitenary-agent/index.ts', 'utf8');

  it('answers and returns before any AI code is reachable', () => {
    /**
     * Structural, deliberately. "This operation costs nothing" is worth more as
     * a property of the control flow than as a promise in a comment: the branch
     * returns above every line that could resolve a model, reserve quota or
     * open a spend session.
     */
    // Scoped to the request handler, so an import at the top of the file is
    // not mistaken for a call site.
    const handler = agentSource.slice(agentSource.indexOf('Deno.serve(async (request) =>'));
    const branch = handler.indexOf('=== RESOLVE_PLACE_CARDS');
    expect(branch).toBeGreaterThan(0);

    for (const aiGate of [
      'resolveAgentReasoning(operation)',
      'reserveAiReasoningAttempt(cache',
      'await meteredModelCall(',
      'new SpendSession(',
    ]) {
      const at = handler.indexOf(aiGate);
      // Every AI entry point exists, and every one of them sits after the
      // point where this operation has already returned.
      expect(at, `${aiGate} should exist`).toBeGreaterThan(0);
      expect(at, `${aiGate} must come after the resolve-place-cards branch`).toBeGreaterThan(branch);
    }
  });

  it('never reads the model configuration on this path', () => {
    const operation = agentSource.slice(
      agentSource.indexOf('async function resolvePlaceCardsOperation'),
      agentSource.indexOf('Deno.serve(async (request) =>'),
    );
    expect(operation.length).toBeGreaterThan(200);
    for (const forbidden of ['openaiModel', 'callModel', 'SpendSession', 'reserveAi', 'meteredModelCall']) {
      expect(operation).not.toContain(forbidden);
    }
  });
});

describe('an operator’s problem is not shown to a traveller', () => {
  const agentSource = readFileSync('supabase/functions/planitenary-agent/index.ts', 'utf8');

  it('never returns the reasoning misconfiguration detail to the client', () => {
    /**
     * With the kill switch on, production answered "can you suggest a place to
     * go" with: OPENAI_MODEL "disabled" is not approved for the agent operation
     * ask. Allowed: gpt-5-nano. That names an environment variable and tells
     * the reader nothing they can act on.
     */
    expect(agentSource).not.toContain('json({ error: resolution.error }');
    expect(agentSource).toContain("'The assistant is unavailable right now.'");
    // The detail still reaches the operator who can fix it.
    expect(agentSource).toContain('reasoning misconfigured:');
  });
});
