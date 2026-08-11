/**
 * What the card actually shows.
 *
 * The server decides what is true; this decides what earns space. Two rules
 * carry most of the weight and both are about the 390px deck rather than about
 * correctness: at most three chips, and never the same fact twice in two
 * forms. A card that is honest but pushes Must do / Interested / Skip below a
 * paragraph has made the product worse, not better.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_VISIBLE_MATCHES,
  buildIntelligenceView,
  matchLabel,
} from './candidateIntelligenceView';
import type { ValidatedIntelligence } from '../../supabase/functions/_shared/candidateIntelligence';

const intelligence = (over: Partial<ValidatedIntelligence> = {}): ValidatedIntelligence => ({
  candidateId: 'place-a',
  personalFitScore: 82,
  recommendation: 'interested',
  reasons: [],
  cautions: [],
  pairWithCandidateIds: [],
  suggestedDurationMinutes: null,
  ...over,
});

describe('match labels', () => {
  it('reads an interest or style back in the traveller own words', () => {
    expect(matchLabel('interest-match', 'food')).toBe('Food');
    expect(matchLabel('style-match', 'local-neighbourhoods')).toBe('Local neighbourhoods');
    expect(matchLabel('pace-fit', 'relaxed')).toBe('Relaxed pace');
  });

  /** Internal identifiers must never reach a screen. */
  it('never exposes an atom name', () => {
    for (const type of ['interest-match', 'style-match', 'pace-fit', 'short-stop', 'indoor-option']) {
      const label = matchLabel(type, 'food');
      expect(label).toBeDefined();
      expect(label).not.toContain('-match');
      expect(label).not.toContain('_');
    }
  });

  /**
   * Some atoms are genuinely useful and make poor chips. "Same planning area"
   * as two words is jargon; it earns its place as a sentence or not at all.
   */
  it('gives no chip to atoms that need a sentence to make sense', () => {
    expect(matchLabel('cluster-fit', 'place-b')).toBeUndefined();
    expect(matchLabel('low-detour')).toBeUndefined();
    expect(matchLabel('weak-profile-match')).toBeUndefined();
  });

  it('gives no chip to an atom whose reference is missing', () => {
    expect(matchLabel('interest-match', undefined)).toBeUndefined();
  });
});

describe('what reaches the main card face', () => {
  const fiveMatches = intelligence({
    reasons: [
      { type: 'interest-match', references: ['food'] },
      { type: 'style-match', references: ['local-neighbourhoods'] },
      { type: 'pace-fit', references: ['relaxed'] },
      { type: 'short-stop', references: [] },
      { type: 'indoor-option', references: [] },
    ],
  });

  /**
   * A layout budget, not a truth budget. A fourth chip wraps at 390px and
   * starts pushing the decision controls down the card.
   */
  it('caps the visible chips and keeps the rest for Details', () => {
    const view = buildIntelligenceView(fiveMatches, [], []);
    expect(view.matches).toHaveLength(MAX_VISIBLE_MATCHES);
    expect(view.matches).toEqual(['Food', 'Local neighbourhoods', 'Relaxed pace']);
    // Nothing is lost, only moved.
    expect(view.overflowMatches).toEqual(['Short stop', 'Indoor option']);
  });

  it('orders chips as the model prioritised them', () => {
    const view = buildIntelligenceView(intelligence({
      reasons: [
        { type: 'pace-fit', references: ['relaxed'] },
        { type: 'interest-match', references: ['food'] },
      ],
    }), [], []);
    expect(view.matches[0]).toBe('Relaxed pace');
  });

  it('does not repeat an identical label', () => {
    const view = buildIntelligenceView(intelligence({
      reasons: [
        { type: 'interest-match', references: ['food'] },
        { type: 'interest-match', references: ['food'] },
      ],
    }), [], []);
    expect(view.matches).toEqual(['Food']);
  });

  it('names the fit in words, never a score', () => {
    expect(buildIntelligenceView(intelligence({ recommendation: 'must-do' }), [], []).fitLabel)
      .toBe('Strong fit for your trip');
    expect(buildIntelligenceView(intelligence({ recommendation: 'weak-fit' }), [], []).fitLabel)
      .toBe('Weaker match for your trip');
  });

  /**
   * The deterministic score is the only number the traveller sees. A second
   * percentage beside it invites the question of which one is right, and the
   * honest answer — "the other one" — is not something a card can convey.
   */
  it('never surfaces the personal fit score', () => {
    const view = buildIntelligenceView(intelligence({ personalFitScore: 82 }), [], []);
    expect(JSON.stringify(view)).not.toContain('82');
  });

  it('offers no fit label when the model recommended nothing', () => {
    expect(buildIntelligenceView(intelligence({ recommendation: null }), [], []).fitLabel)
      .toBeUndefined();
  });
});

describe('the same fact is never shown twice', () => {
  /**
   * A card reading "Food · Relaxed pace" above "You asked for food… It fits
   * the relaxed pace you set." spends four lines saying two things. The
   * repetition reads as padding rather than as care, and on mobile it costs
   * the space the decision buttons need.
   */
  it('drops explanation lines whose atom already became a chip', () => {
    const view = buildIntelligenceView(
      intelligence({
        reasons: [
          { type: 'interest-match', references: ['food'] },
          { type: 'cluster-fit', references: ['place-b'] },
        ],
      }),
      [
        'You asked for food, and this is tagged for it.',
        'It sits in the same planning area as Nezu Shrine.',
      ],
      [],
    );

    expect(view.matches).toEqual(['Food']);
    // The chip covers the first line; the second has no chip and survives.
    expect(view.explanation).toEqual(['It sits in the same planning area as Nezu Shrine.']);
  });

  it('keeps every line when nothing became a chip', () => {
    const copy = [
      'It sits in the same planning area as Nezu Shrine.',
      'Reaching it adds about 6 minutes of travel.',
    ];
    const view = buildIntelligenceView(
      intelligence({
        reasons: [
          { type: 'cluster-fit', references: ['place-b'] },
          { type: 'low-detour', references: [] },
        ],
      }),
      copy,
      [],
    );
    expect(view.explanation).toEqual(copy);
    expect(view.matches).toEqual([]);
  });

  it('carries pairings as resolved names', () => {
    const view = buildIntelligenceView(intelligence(), [], ['Nezu Shrine']);
    expect(view.pairings).toEqual(['Nezu Shrine']);
    // Never a raw identifier.
    expect(JSON.stringify(view)).not.toContain('place-');
  });

  it('produces nothing to render when there is nothing to say', () => {
    const view = buildIntelligenceView(intelligence({ recommendation: null }), [], []);
    expect(view.matches).toEqual([]);
    expect(view.explanation).toEqual([]);
    expect(view.pairings).toEqual([]);
    expect(view.fitLabel).toBeUndefined();
  });
});
