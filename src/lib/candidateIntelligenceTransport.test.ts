/**
 * The boundary between the card and the model tier.
 *
 * Two properties matter here and neither is about happy paths: a malformed
 * answer must degrade rather than throw, and "could not ask" must stay
 * distinguishable from "asked and got nothing". Collapsing the second pair
 * would let one refused request be remembered as a settled empty answer.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  fetchCandidateIntelligence,
  parseIntelligenceResponse,
} from './candidateIntelligenceTransport';

const trip = { profileRevision: 'p1', interests: ['food'], styles: [], pace: 'relaxed' };
const candidates = [{
  candidateId: 'a', candidateRevision: 'r1', name: 'A', category: 'sight',
  deterministicScore: 60, matchedStyleTags: [], matchedInterestTags: ['food'],
  costKnown: false, pairableCandidateIds: [],
}];

describe('reading the response', () => {
  it('keeps intelligence only on a ready row', () => {
    const rows = parseIntelligenceResponse({
      results: [
        { candidateId: 'a', intelligence: { candidateId: 'a' }, status: 'ready' },
        { candidateId: 'b', intelligence: { candidateId: 'b' }, status: 'unavailable' },
      ],
    });
    expect(rows[0].intelligence).not.toBeNull();
    // Anything beside a non-ready status is not an answer.
    expect(rows[1].intelligence).toBeNull();
  });

  it('treats an unknown status as unavailable rather than ready', () => {
    const [row] = parseIntelligenceResponse({
      results: [{ candidateId: 'a', intelligence: {}, status: 'something-else' }],
    });
    expect(row.status).toBe('unavailable');
    expect(row.intelligence).toBeNull();
  });

  /**
   * A card is decidable without any of this, so a rendering crash would take
   * away something that works to add something optional.
   */
  it('degrades rather than throwing on a malformed payload', () => {
    for (const payload of [null, 42, 'text', {}, { results: null }, { results: {} }]) {
      expect(() => parseIntelligenceResponse(payload)).not.toThrow();
      expect(parseIntelligenceResponse(payload)).toEqual([]);
    }
    expect(parseIntelligenceResponse({ results: [null, 7, { status: 'ready' }] })).toEqual([]);
  });
});

describe('asking', () => {
  it('sends the candidate set under the candidate-intelligence operation', async () => {
    const invoke = vi.fn().mockResolvedValue({ results: [] });
    await fetchCandidateIntelligence(trip, candidates, 'ctx1', invoke);

    const [operation, input] = invoke.mock.calls[0];
    expect(operation).toBe('candidate-intelligence');
    expect(input).toMatchObject({ trip, plannerContextRevision: 'ctx1' });
  });

  /** No model, no token budget, no provider concept crosses this boundary. */
  it('carries no model or provider concept', async () => {
    const invoke = vi.fn().mockResolvedValue({ results: [] });
    await fetchCandidateIntelligence(trip, candidates, undefined, invoke);

    const sent = JSON.stringify(invoke.mock.calls[0][1]).toLowerCase();
    for (const leak of ['openai', 'gpt', 'nano', 'token', 'model', 'gemini']) {
      expect(sent, leak).not.toContain(leak);
    }
  });

  /**
   * `undefined` is "could not ask", which the caller must not store as an
   * answer — the same distinction the server draws, one layer up.
   */
  it('reports a failure as undefined rather than as an empty answer', async () => {
    const invoke = vi.fn().mockRejectedValue(new Error('network'));
    await expect(fetchCandidateIntelligence(trip, candidates, undefined, invoke))
      .resolves.toBeUndefined();
  });

  it('does not retry a failed request', async () => {
    const invoke = vi.fn().mockRejectedValue(new Error('network'));
    await fetchCandidateIntelligence(trip, candidates, undefined, invoke);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('asks nothing when there are no candidates', async () => {
    const invoke = vi.fn();
    expect(await fetchCandidateIntelligence(trip, [], undefined, invoke)).toEqual([]);
    expect(invoke).not.toHaveBeenCalled();
  });
});
