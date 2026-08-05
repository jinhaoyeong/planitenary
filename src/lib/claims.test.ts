/**
 * Tests for claim extraction, imported straight from the Deno `_shared` module
 * — the same precedent as `cacheKeys.test.ts`.
 *
 * This is the code that turns what a stranger wrote into something the planner
 * acts on, so the standard it is held to here is: report what was said, and
 * never assert what was not.
 */
import { describe, expect, it } from 'vitest';
import { assessDisclosure, extractClaims } from '../../supabase/functions/_shared/claims';

const types = (text: string) => extractClaims(text).map((claim) => claim.type);

describe('reading opinion out of a review', () => {
  it('hears criticism as clearly as praise', () => {
    expect(types('Honestly overrated, we queued for nothing')).toContain('overrated');
    expect(types('Genuinely worth the trip, we loved it')).toContain('worth-visiting');
  });

  it('separates a tourist trap from a local favourite', () => {
    expect(types('Complete tourist trap, avoid')).toContain('tourist-trap');
    expect(types('A hidden gem the locals love')).toContain('local-favourite');
  });

  it('notices crowding, which changes how a day is planned', () => {
    expect(types('Extremely crowded on a Saturday')).toContain('crowded');
    expect(types('Packed shoulder to shoulder')).toContain('crowded');
  });

  it('notices that booking ahead is expected', () => {
    expect(types('You need to book ahead, it sells out')).toContain('reservation-needed');
  });

  it('says nothing about a review that says nothing', () => {
    // Silence is the correct output. A default claim would be an invention.
    expect(extractClaims('We went here on Tuesday.')).toEqual([]);
    expect(extractClaims('')).toEqual([]);
  });
});

describe('reading a queue time a traveller can be scheduled around', () => {
  it('reads minutes stated either way round', () => {
    expect(extractClaims('There was a 40 min queue')[0]).toMatchObject({ type: 'queue-time', value: 40, unit: 'minutes' });
    expect(extractClaims('We waited about 25 minutes')[0]).toMatchObject({ type: 'queue-time', value: 25 });
  });

  it('converts hours to minutes so the scheduler gets one unit', () => {
    expect(extractClaims('A 2 hour queue, brutal')[0]).toMatchObject({ type: 'queue-time', value: 120 });
  });

  it('reads the hedged phrasing people actually write', () => {
    // "the line was about 50 min" is far more common than "line of 50 min".
    expect(extractClaims('The line was about 50 min long')[0]).toMatchObject({ value: 50 });
    expect(extractClaims('Wait was roughly 20 min')[0]).toMatchObject({ value: 20 });
    expect(extractClaims('We waited like 15 min')[0]).toMatchObject({ value: 15 });
  });

  it('does not stretch across a sentence to find a number', () => {
    // The hedge run is bounded so the pattern cannot wander into unrelated prose.
    expect(types('There was no queue. It cost 30 min of driving to get there'))
      .not.toContain('queue-time');
  });

  it('discards a reading too large to be a queue', () => {
    // Beyond four hours this is far more likely a misparse than a wait, and a
    // wrong number here silently reshapes a day.
    expect(types('Open 300 minutes wait')).not.toContain('queue-time');
  });

  it('reports at most one queue time rather than stacking guesses', () => {
    const queueClaims = extractClaims('A 30 min queue, then another 45 minute wait')
      .filter((claim) => claim.type === 'queue-time');
    expect(queueClaims).toHaveLength(1);
  });
});

describe('every claim can be traced back to what was written', () => {
  it('quotes the source verbatim', () => {
    const text = 'We went early. Honestly overrated for the price, but the view is fine.';
    const claim = extractClaims(text).find((entry) => entry.type === 'overrated');
    expect(claim?.excerpt).toBeDefined();
    // The excerpt must be a real substring, or the evidence drawer would be
    // showing the traveller something nobody actually said.
    expect(text).toContain(claim!.excerpt!);
  });

  it('quotes the queue phrase itself', () => {
    const claim = extractClaims('The line was about 50 min long')[0];
    expect(claim.excerpt?.toLowerCase()).toContain('50 min');
  });
});

describe('spotting commercial motivation', () => {
  it('takes a declared sponsorship at its word', () => {
    expect(assessDisclosure('#ad — gifted stay, thank you!')).toBe('sponsored');
    expect(assessDisclosure('Paid partnership with the museum')).toBe('sponsored');
  });

  it('flags a softer commercial signal without calling it sponsorship', () => {
    // The app describes what it observed; it does not accuse anyone.
    expect(assessDisclosure('Use my code TRAVEL10 for a discount')).toBe('possible-promotion');
  });

  it('treats an ordinary post as organic', () => {
    expect(assessDisclosure('We visited last weekend and had a great time')).toBe('organic');
  });
});
