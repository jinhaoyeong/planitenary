/**
 * The explanation layer.
 *
 * The complaint that produced this file was not that the reasons were wrong.
 * It was that they were identical: six fixed sentences, threshold 0.7, top
 * three — so most of a thirty-place shortlist carried the same three lines and
 * the panel appeared to be reading from a script. A reason shared by everything
 * explains nothing, and these tests are mostly about that.
 */
import { describe, expect, it } from 'vitest';
import { OSAKA_PLACE_FIXTURE } from './destinationFixtures';
import type { PlaceCandidate } from './destinationIntelligence';
import { rankWithIntelligence } from './destinationPlanner';
import { matchedStyleTags, type PlaceIntelligenceScore } from './placeIntelligence';
import { buildRationale, collectShortlistStats, opensLate, type ShortlistStats } from './placeRationale';
import { createEmptyProfile, manualDestination, type TripProfile } from './tripProfile';

const profile = (styles: TripProfile['styles'] = ['temples', 'history']): TripProfile => ({
  ...createEmptyProfile('MYR'),
  destinations: [manualDestination('Osaka', 'Japan')],
  startDate: '2026-10-01',
  endDate: '2026-10-11',
  dayCount: 11,
  styles,
  transport: ['public-transport'],
});

const place = (over: Partial<PlaceCandidate> = {}): PlaceCandidate => ({
  id: 'p1',
  provider: 'osm',
  providerPlaceId: 'osm:1',
  name: 'A Place',
  countryCode: 'JP',
  city: 'Osaka',
  coordinates: [34.6, 135.5],
  categories: ['temple'],
  experienceTags: ['history'],
  estimatedVisitMinutes: 60,
  indoorOutdoor: 'mixed',
  reservationStatus: 'unknown',
  sourceConfidence: 'medium',
  sourceReferences: [{ label: 'OSM', url: 'https://osm.org/1' }],
  lastVerifiedAt: '2026-08-04T00:00:00Z',
  ...over,
});

const dimensions = (over: Partial<PlaceIntelligenceScore> = {}): PlaceIntelligenceScore => ({
  travellerFit: 0.4,
  destinationSignificance: 0.4,
  currentQuality: 0.4,
  trendStrength: 0,
  localRelevance: 0.4,
  practicality: 0.4,
  evidenceConfidence: 0.4,
  promotionRisk: 0,
  ...over,
});

const WEIGHTS = {
  travellerFit: 0.24,
  destinationSignificance: 0.16,
  currentQuality: 0.15,
  practicality: 0.15,
  trendStrength: 0.08,
  localRelevance: 0.07,
  evidenceConfidence: 0.05,
};

/** A shortlist big enough for percentiles, deliberately mediocre. */
const backdrop = (size = 12, over: Partial<PlaceIntelligenceScore> = {}): ShortlistStats =>
  collectShortlistStats(
    Array.from({ length: size }, (_, index) => ({
      candidate: place({ id: `bg-${index}` }),
      dimensions: dimensions(over),
    })),
    'Osaka',
  );

describe('naming what the traveller asked for', () => {
  it('quotes their own style words instead of "matches what you said you like"', () => {
    const points = buildRationale({
      candidate: place({ categories: ['temple'], experienceTags: ['history'] }),
      dimensions: dimensions({ travellerFit: 0.9 }),
      weights: WEIGHTS,
      matchedStyles: ['temples', 'history'],
      shortlist: backdrop(),
    });
    const text = points.map((point) => point.text).join(' ');
    expect(text).toContain('temples');
    expect(text).toContain('history');
    expect(text).not.toMatch(/what you said you like/i);
  });

  it('says nothing about style when none of theirs matched', () => {
    const points = buildRationale({
      candidate: place(),
      dimensions: dimensions({ travellerFit: 0.9 }),
      weights: WEIGHTS,
      matchedStyles: [],
      shortlist: backdrop(),
    });
    expect(points.some((point) => point.kind === 'style-match')).toBe(false);
  });

  it('reads the intersection off the real fixture, not a hand-built one', () => {
    const shitennoji = OSAKA_PLACE_FIXTURE.find((entry) => entry.name === 'Shitennoji Temple')!;
    expect(matchedStyleTags(shitennoji, profile(['temples', 'history', 'beaches'])).sort())
      .toEqual(['history', 'temples']);
  });

  it('never names a style the place does not actually have', () => {
    // `STYLE_TAGS.temples` includes `history` so that a shrine scores for a
    // history-minded traveller. Fine inside a number; said out loud it told
    // someone the Osaka Museum of History was one of the temples they asked
    // for — a false claim about their own input.
    const museum = OSAKA_PLACE_FIXTURE.find((entry) => entry.name === 'Osaka Museum of History')!;
    const matched = matchedStyleTags(museum, profile(['temples', 'history', 'museums']));
    expect(matched).not.toContain('temples');
    expect(matched.sort()).toEqual(['history', 'museums']);
  });

  it('still names a style from its own vocabulary, not only its exact word', () => {
    // A live OSM temple is categorised `temple`, singular. Requiring the style
    // word itself would have silently stopped matching real data.
    const hozenji = OSAKA_PLACE_FIXTURE.find((entry) => entry.name === 'Hozenji Temple')!;
    expect(hozenji.categories).toContain('temple');
    expect(hozenji.experienceTags).not.toContain('temples');
    expect(matchedStyleTags(hozenji, profile(['temples']))).toEqual(['temples']);
  });

  it('gives a shared tag to the style that owns it', () => {
    // `mountains` reaches for `nature`. When the traveller asked for both, a
    // park is nature; calling it a mountain would be the same over-claim.
    const park = place({ categories: ['park'], experienceTags: ['nature'] });
    expect(matchedStyleTags(park, profile(['mountains', 'nature']))).toEqual(['nature']);
    // Asked for mountains alone, `nature` is the best signal there is.
    expect(matchedStyleTags(park, profile(['mountains']))).toEqual(['mountains']);
  });
});

describe('ordering by what actually carried the score', () => {
  it('leads with the dimension that contributed most, not the largest number', () => {
    // significance 0.90 × 0.16 = 0.144; fit 0.80 × 0.24 = 0.192. Sorting on the
    // raw value put significance first and so misdescribed the ranking it was
    // meant to explain.
    const points = buildRationale({
      candidate: place({ notabilitySignals: ['has an encyclopedia entry'] }),
      dimensions: dimensions({ travellerFit: 0.8, destinationSignificance: 0.9 }),
      weights: WEIGHTS,
      matchedStyles: ['temples'],
      shortlist: backdrop(),
    });
    expect(points[0].kind).toBe('style-match');
  });
});

describe('suppressing what does not distinguish', () => {
  it('drops a dimension that is high across most of the shortlist', () => {
    // If almost everything on the list is significant, saying so about one card
    // tells the traveller nothing about that card.
    const everythingSignificant = backdrop(12, { destinationSignificance: 0.95 });
    const points = buildRationale({
      candidate: place({ notabilitySignals: ['is a listed heritage site'] }),
      dimensions: dimensions({ destinationSignificance: 0.95 }),
      weights: WEIGHTS,
      matchedStyles: [],
      shortlist: everythingSignificant,
    });
    expect(points.some((point) => point.kind === 'significance')).toBe(false);
  });

  it('keeps it when the place is genuinely unusual on the list', () => {
    const points = buildRationale({
      candidate: place({ notabilitySignals: ['is a listed heritage site'] }),
      dimensions: dimensions({ destinationSignificance: 0.95 }),
      weights: WEIGHTS,
      matchedStyles: [],
      shortlist: backdrop(12, { destinationSignificance: 0.3 }),
    });
    expect(points.some((point) => point.kind === 'significance')).toBe(true);
  });
});

describe('not overclaiming in comparative copy', () => {
  const openLate = place({
    id: 'late',
    openingHours: { periods: [{ opensAt: '17:00', closesAt: '23:00' }], sourceConfidence: 'medium' },
  });

  const withLateCount = (count: number, size = 12): ShortlistStats => ({
    ...backdrop(size),
    openLateCount: count,
    size,
  });

  it('says "the only one" only when there is exactly one', () => {
    const points = buildRationale({
      candidate: openLate,
      dimensions: dimensions({ practicality: 0.9 }),
      weights: WEIGHTS,
      matchedStyles: [],
      shortlist: withLateCount(1),
    });
    expect(points.find((point) => point.id === 'practical-open-late')?.text).toMatch(/the only place/i);
  });

  it('softens to "one of the few" when it is not alone', () => {
    const points = buildRationale({
      candidate: openLate,
      dimensions: dimensions({ practicality: 0.9 }),
      weights: WEIGHTS,
      matchedStyles: [],
      shortlist: withLateCount(4),
    });
    expect(points.find((point) => point.id === 'practical-open-late')?.text).toMatch(/one of the few/i);
  });

  it('never says "the most" when the top is a tie', () => {
    // Three places tied at 0.95. None of them is "the most documented".
    const tied = collectShortlistStats(
      Array.from({ length: 12 }, (_, index) => ({
        candidate: place({ id: `t-${index}` }),
        dimensions: dimensions({ destinationSignificance: index < 3 ? 0.95 : 0.2 }),
      })),
      'Osaka',
    );
    const points = buildRationale({
      candidate: place(),
      dimensions: dimensions({ destinationSignificance: 0.95 }),
      weights: WEIGHTS,
      matchedStyles: [],
      shortlist: tied,
    });
    const significance = points.find((point) => point.kind === 'significance');
    expect(significance?.text).toMatch(/^Among the/);
    expect(significance?.text).not.toMatch(/^The most/);
  });

  it('drops percentile claims entirely on a short list', () => {
    // "Top 20% of five places" means "second", which the score already says.
    const points = buildRationale({
      candidate: place(),
      dimensions: dimensions({ destinationSignificance: 0.95 }),
      weights: WEIGHTS,
      matchedStyles: [],
      shortlist: backdrop(5, { destinationSignificance: 0.2 }),
    });
    expect(points.some((point) => point.comparative)).toBe(false);
  });

  it('makes no comparison at all with no shortlist to compare against', () => {
    const points = buildRationale({
      candidate: place(),
      dimensions: dimensions({ destinationSignificance: 0.95, practicality: 0.95 }),
      weights: WEIGHTS,
      matchedStyles: [],
    });
    expect(points.every((point) => !point.comparative)).toBe(true);
  });
});

describe('always saying something', () => {
  it('is honest rather than empty when nothing stands out', () => {
    const points = buildRationale({
      candidate: place({ neighbourhood: 'Minami' }),
      dimensions: dimensions(),
      weights: WEIGHTS,
      matchedStyles: [],
      shortlist: backdrop(),
    });
    expect(points).toHaveLength(1);
    expect(points[0].text).toMatch(/Minami/);
  });

  it('caps at three, so the section stays readable', () => {
    const points = buildRationale({
      candidate: place({
        categories: ['local-character'],
        notabilitySignals: ['has an encyclopedia entry', 'is a listed heritage site'],
      }),
      dimensions: dimensions({
        travellerFit: 0.95,
        destinationSignificance: 0.95,
        currentQuality: 0.95,
        localRelevance: 0.95,
      }),
      weights: WEIGHTS,
      matchedStyles: ['temples'],
      evidence: {
        positiveThemes: ['the quiet', 'the garden'],
        sourceCount: 4,
      } as never,
      shortlist: backdrop(),
    });
    expect(points.length).toBeLessThanOrEqual(3);
  });

  it('every point records what it is traceable to', () => {
    // `basis` is what lets a later rephrasing layer select from these without
    // being able to invent a new one.
    const points = buildRationale({
      candidate: place({ notabilitySignals: ['is a listed heritage site'] }),
      dimensions: dimensions({ travellerFit: 0.9, destinationSignificance: 0.9 }),
      weights: WEIGHTS,
      matchedStyles: ['temples'],
      shortlist: backdrop(12, { destinationSignificance: 0.2 }),
    });
    for (const point of points) {
      expect(point.basis.length).toBeGreaterThan(0);
      expect(point.id.length).toBeGreaterThan(0);
    }
  });
});

describe('the whole point: a real shortlist stops reading alike', () => {
  it('gives the Osaka fixture more than a handful of distinct explanations', () => {
    // The old table could produce at most a few combinations of six fixed
    // sentences across thirty places. This is the regression guard for that.
    const ranked = rankWithIntelligence(OSAKA_PLACE_FIXTURE, profile(['temples', 'history', 'museums']));
    const distinct = new Set(ranked.map((entry) => entry.reasons.join('|')));
    expect(ranked.length).toBeGreaterThan(20);
    expect(distinct.size).toBeGreaterThan(8);
  });

  it('does not hand the top two cards the same explanation', () => {
    const ranked = rankWithIntelligence(OSAKA_PLACE_FIXTURE, profile(['temples', 'history', 'museums']));
    expect(ranked[0].reasons.join('|')).not.toBe(ranked[1].reasons.join('|'));
  });

  it('exposes the structured points alongside the flattened strings', () => {
    const ranked = rankWithIntelligence(OSAKA_PLACE_FIXTURE, profile());
    expect(ranked[0].rationale?.length).toBeGreaterThan(0);
    expect(ranked[0].reasons).toEqual(expect.arrayContaining([ranked[0].rationale![0].text]));
  });
});

describe('opensLate', () => {
  it('reads every period, not just the first', () => {
    expect(opensLate(place({
      openingHours: {
        periods: [
          { opensAt: '09:00', closesAt: '12:00' },
          { opensAt: '18:00', closesAt: '22:00' },
        ],
        sourceConfidence: 'medium',
      },
    }))).toBe(true);
    expect(opensLate(place({
      openingHours: { periods: [{ opensAt: '09:00', closesAt: '17:00' }], sourceConfidence: 'medium' },
    }))).toBe(false);
    expect(opensLate(place())).toBe(false);
  });
});
