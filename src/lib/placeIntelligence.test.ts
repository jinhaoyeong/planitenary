import { describe, expect, it } from 'vitest';
import type { PlaceCandidate } from './destinationIntelligence';
import { scorePlace, scorePlaces } from './placeIntelligence';
import { deriveTravelBehaviour, type RecommendationMix } from './travelBehaviour';
import { createEmptyProfile, manualDestination, type TripProfile } from './tripProfile';
import type { PlaceEvidenceSummary } from './travelEvidence';

const profile = (styles: TripProfile['styles'] = ['museums']): TripProfile => ({
  ...createEmptyProfile(),
  destinations: [manualDestination('Melbourne', 'Australia')],
  dayCount: 5,
  styles,
});

const behaviour = (mix: RecommendationMix = 'balanced') =>
  deriveTravelBehaviour({ moods: [], tripTypes: [] }, { recommendationMix: mix });

const place = (overrides: Partial<PlaceCandidate> & { id: string }): PlaceCandidate => ({
  provider: 'google',
  providerPlaceId: `g:${overrides.id}`,
  name: overrides.id,
  countryCode: 'AU',
  city: 'Melbourne',
  neighbourhood: 'CBD',
  coordinates: [-37.8136, 144.9631],
  categories: ['museum'],
  experienceTags: ['museums'],
  estimatedVisitMinutes: 90,
  indoorOutdoor: 'indoor',
  reservationStatus: 'not-needed',
  sourceConfidence: 'high',
  sourceReferences: [{ label: 'Visit Victoria', url: 'https://www.visitmelbourne.com/' }],
  lastVerifiedAt: '2026-08-01T00:00:00.000Z',
  openingHours: { periods: [{ opensAt: '09:00', closesAt: '18:00' }], sourceConfidence: 'high' },
  ...overrides,
});

const summary = (overrides: Partial<PlaceEvidenceSummary> = {}): PlaceEvidenceSummary => ({
  canonicalPlaceId: 'p',
  sourceCount: 4,
  distinctSources: ['google-places', 'youtube'],
  positiveThemes: ['Worth the trip'],
  negativeThemes: [],
  evidenceConfidence: 0.7,
  promotionRisk: 0.1,
  warnings: [],
  ...overrides,
});

const inputs = (over: Partial<Parameters<typeof scorePlace>[1]> = {}) => ({
  profile: profile(),
  behaviour: behaviour(),
  ...over,
});

describe('dimensions are computed independently', () => {
  it('rewards a place matching the traveller’s stated interests', () => {
    const matching = scorePlace(place({ id: 'a', categories: ['museum'], experienceTags: ['museums'] }), inputs());
    const unrelated = scorePlace(place({ id: 'b', categories: ['nightlife'], experienceTags: ['nightlife'] }), inputs());
    expect(matching.dimensions.travellerFit).toBeGreaterThan(unrelated.dimensions.travellerFit);
  });

  it('treats a lifetime star rating as weaker than recent visitor evidence', () => {
    const ratingOnly = scorePlace(place({ id: 'a', rating: 5, reviewCount: 900 }), inputs());
    const recentlyPraised = scorePlace(place({ id: 'a' }), inputs({
      evidence: { a: summary({ positiveThemes: ['Great now', 'Worth it', 'Lovely'] }) },
    }));
    expect(recentlyPraised.dimensions.currentQuality).toBeGreaterThan(ratingOnly.dimensions.currentQuality);
    // A perfect lifetime average is still pulled toward neutral.
    expect(ratingOnly.dimensions.currentQuality).toBeLessThan(0.9);
  });

  it('marks an unreachable, unbookable place as less practical', () => {
    const easy = scorePlace(place({ id: 'a' }), inputs());
    const awkward = scorePlace(
      place({ id: 'b', coordinates: undefined, openingHours: undefined, reservationStatus: 'required' }),
      inputs(),
    );
    expect(awkward.dimensions.practicality).toBeLessThan(easy.dimensions.practicality);
  });

  it('drops practicality when the queue exceeds what the traveller will accept', () => {
    const patient = scorePlace(place({ id: 'a' }), inputs({
      behaviour: deriveTravelBehaviour({ moods: [], tripTypes: [] }, {
        meals: { breakfastRequired: false, dietaryNeeds: [], maximumQueueMinutes: 120 },
      }),
      evidence: { a: summary({ typicalQueueMinutes: 90 }) },
    }));
    const impatient = scorePlace(place({ id: 'a' }), inputs({
      behaviour: deriveTravelBehaviour({ moods: [], tripTypes: [] }, {
        meals: { breakfastRequired: false, dietaryNeeds: [], maximumQueueMinutes: 10 },
      }),
      evidence: { a: summary({ typicalQueueMinutes: 90 }) },
    }));
    expect(impatient.dimensions.practicality).toBeLessThan(patient.dimensions.practicality);
  });
});

describe('penalties bite regardless of other strengths', () => {
  it('demotes a strong place reported closed', () => {
    const open = scorePlace(place({ id: 'a', categories: ['essential', 'museum'] }), inputs({
      evidence: { a: summary() },
    }));
    const closed = scorePlace(place({ id: 'a', categories: ['essential', 'museum'] }), inputs({
      evidence: { a: summary({ warnings: ['An authoritative source reports this place as closed.'] }) },
    }));
    expect(closed.score).toBeLessThan(open.score);
    expect(closed.cautions.join(' ')).toContain('closed');
  });

  it('penalises heavily promoted praise without accusing anyone', () => {
    const organic = scorePlace(place({ id: 'a' }), inputs({ evidence: { a: summary({ promotionRisk: 0.1 }) } }));
    const promoted = scorePlace(place({ id: 'a' }), inputs({ evidence: { a: summary({ promotionRisk: 0.95 }) } }));
    expect(promoted.score).toBeLessThan(organic.score);
    const caution = promoted.cautions.join(' ');
    expect(caution).toMatch(/looks promotional/);
    // Hedged language: a risk signal, never a verdict about the business.
    expect(caution).not.toMatch(/fake|dishonest|lying|scam/i);
  });

  it('tolerates ordinary commercial signal without punishing it', () => {
    const neutral = scorePlace(place({ id: 'a' }), inputs({ evidence: { a: summary({ promotionRisk: 0.3 }) } }));
    const clean = scorePlace(place({ id: 'a' }), inputs({ evidence: { a: summary({ promotionRisk: 0 }) } }));
    expect(neutral.score).toBe(clean.score);
  });

  it('warns about a long queue and unverified hours', () => {
    const scored = scorePlace(place({ id: 'a', openingHours: undefined }), inputs({
      evidence: { a: summary({ typicalQueueMinutes: 60 }) },
    }));
    expect(scored.cautions.join(' ')).toContain('60 minutes');
    expect(scored.cautions.join(' ')).toContain('Opening hours are unverified');
  });
});

describe('the recommendation mix re-balances what wins', () => {
  const trending = place({ id: 'trending', categories: ['cafes'], experienceTags: ['cafes'] });
  const landmark = place({ id: 'landmark', categories: ['essential'], experienceTags: ['history'], reviewCount: 50_000 });
  const local = place({ id: 'local', categories: ['local-character'], experienceTags: ['hidden-gems'] });

  const rank = (mix: RecommendationMix) => scorePlaces([trending, landmark, local], {
    profile: profile([]),
    behaviour: behaviour(mix),
    trends: { trending: 1, landmark: 0, local: 0.1 },
  }).map((scored) => scored.candidate.id);

  it('puts the landmark first for a classic traveller', () => {
    expect(rank('classic')[0]).toBe('landmark');
  });

  it('lifts the trending place for a trend-seeking traveller', () => {
    expect(rank('trendy').indexOf('trending')).toBeLessThan(rank('classic').indexOf('trending'));
  });

  it('lifts the local place for someone chasing hidden gems', () => {
    expect(rank('hidden-local').indexOf('local')).toBeLessThan(rank('classic').indexOf('local'));
  });

  it('keeps the overall scale stable across mixes', () => {
    // Re-weighting must not silently inflate scores; weights are renormalised.
    for (const mix of ['classic', 'balanced', 'trendy', 'hidden-local'] as RecommendationMix[]) {
      for (const scored of scorePlaces([landmark], { profile: profile([]), behaviour: behaviour(mix) })) {
        expect(scored.score).toBeGreaterThanOrEqual(0);
        expect(scored.score).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe('every score is explainable', () => {
  it('gives plain-language reasons rather than a bare number', () => {
    const scored = scorePlace(place({ id: 'a', categories: ['essential', 'museum'] }), inputs({
      evidence: { a: summary({ sourceCount: 6 }) },
    }));
    expect(scored.reasons.length).toBeGreaterThan(0);
    expect(scored.reasons.join(' ')).toContain('6 sources');
    for (const reason of scored.reasons) expect(reason).not.toMatch(/\d\.\d{3}/);
  });

  it('always says something, even for an unremarkable place', () => {
    const scored = scorePlace(
      place({ id: 'a', categories: ['other'], experienceTags: [], rating: undefined }),
      inputs({ profile: profile([]) }),
    );
    expect(scored.reasons.length).toBeGreaterThan(0);
  });

  it('exposes every dimension for the explanation panel', () => {
    const { dimensions } = scorePlace(place({ id: 'a' }), inputs());
    for (const value of Object.values(dimensions)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('orders a shortlist by score, deterministically', () => {
    const scored = scorePlaces([place({ id: 'b' }), place({ id: 'a' })], inputs());
    for (let i = 1; i < scored.length; i += 1) {
      expect(scored[i - 1].score).toBeGreaterThanOrEqual(scored[i].score);
    }
  });
});
