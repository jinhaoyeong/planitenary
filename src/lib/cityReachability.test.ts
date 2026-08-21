/**
 * The rule that separates a day trip from a misplacement.
 *
 * These two situations are the same shape in the data — a place whose city is
 * not the day's city — and telling them apart is the entire point. The tests
 * that matter most here are the ones asserting what is *allowed*: a guard that
 * refused every cross-city placement would pass a naive "never move a place"
 * test suite while deleting every day trip in a Kansai itinerary.
 *
 * Real coordinates throughout, because the threshold is meaningless against
 * invented ones.
 */
import { describe, expect, it } from 'vitest';
import {
  DAY_TRIP_RADIUS_KM,
  cityReachability,
  isPlacementAllowed,
  placementConflictMessage,
  type PlaceLocation,
} from '../../supabase/functions/_shared/cityReachability';

/** Kansai, as a traveller actually moves through it. */
const OSAKA: PlaceLocation = { city: 'Osaka', coordinates: [34.6937, 135.5023] };
const DOTONBORI: PlaceLocation = { city: 'Osaka', coordinates: [34.6687, 135.5013] };
const KYOTO: PlaceLocation = { city: 'Kyoto', coordinates: [35.0116, 135.7681] };
const FUSHIMI_INARI: PlaceLocation = { city: 'Kyoto', coordinates: [34.9671, 135.7727] };
const NARA: PlaceLocation = { city: 'Nara', coordinates: [34.6851, 135.8048] };
const KOBE: PlaceLocation = { city: 'Kobe', coordinates: [34.6901, 135.1955] };
const HIMEJI: PlaceLocation = { city: 'Himeji', coordinates: [34.8394, 134.6939] };
const TOKYO: PlaceLocation = { city: 'Tokyo', coordinates: [35.6762, 139.6503] };
const HIROSHIMA: PlaceLocation = { city: 'Hiroshima', coordinates: [34.3853, 132.4553] };

const KANSAI = [OSAKA, DOTONBORI, KYOTO, FUSHIMI_INARI, NARA, KOBE, HIMEJI, TOKYO, HIROSHIMA];

describe('day trips are allowed, because they are most of the trip', () => {
  const reach = cityReachability(KANSAI);

  it('lets an Osaka base reach every city a person actually day-trips to', () => {
    for (const place of [KYOTO, FUSHIMI_INARI, NARA, KOBE, HIMEJI]) {
      expect(reach.verdictFor('Osaka', place)).toBe('day-trip');
      expect(isPlacementAllowed(reach.verdictFor('Osaka', place))).toBe(true);
    }
  });

  it('treats a place in the base city as simply where the traveller is', () => {
    expect(reach.verdictFor('Osaka', DOTONBORI)).toBe('same-city');
    expect(reach.verdictFor('Kyoto', FUSHIMI_INARI)).toBe('same-city');
  });

  it('ignores casing and stray whitespace in a city name', () => {
    expect(reach.verdictFor('  osaka ', { city: 'OSAKA', coordinates: [34.66, 135.50] }))
      .toBe('same-city');
  });

  /** The relationship holds in both directions; a base is not privileged. */
  it('works from a Kyoto base too', () => {
    expect(reach.verdictFor('Kyoto', DOTONBORI)).toBe('day-trip');
    expect(reach.verdictFor('Kyoto', NARA)).toBe('day-trip');
  });
});

describe('the placements this guard exists to stop', () => {
  const reach = cityReachability(KANSAI);

  it('refuses a city nobody could visit and return from in a day', () => {
    expect(reach.verdictFor('Osaka', TOKYO)).toBe('unreachable');
    expect(reach.verdictFor('Osaka', HIROSHIMA)).toBe('unreachable');
    expect(isPlacementAllowed('unreachable')).toBe(false);
  });

  it('names the place, its city and the day base, so the message is actionable', () => {
    const message = placementConflictMessage('Dotonbori', 'Osaka', 5, 'Kyoto');
    expect(message).toContain('Dotonbori');
    expect(message).toContain('Osaka');
    expect(message).toContain('Kyoto');
    expect(message).toContain('Day 5');
  });
});

describe('what happens when the geography is missing', () => {
  /**
   * Silence means yes. This guard sits in front of a traveller's own saved
   * trip, so refusing on absent coordinates would delete real plans over a
   * data gap. An unlocatable place is exactly as misplaceable as it was before
   * this module existed — nothing regresses, and the judgable cases improve.
   */
  it('allows a placement it cannot judge rather than guessing', () => {
    const sparse = cityReachability([{ city: 'Osaka' }, { city: 'Kyoto' }]);
    expect(sparse.verdictFor('Osaka', { city: 'Kyoto' })).toBe('unknown');
    expect(isPlacementAllowed(sparse.verdictFor('Osaka', { city: 'Kyoto' }))).toBe(true);
  });

  it('treats a missing city on either side as unjudgable, never as a mismatch', () => {
    const reach = cityReachability(KANSAI);
    expect(reach.verdictFor('', KYOTO)).toBe('unknown');
    expect(reach.verdictFor('Osaka', { city: '', coordinates: [35.0, 135.7] })).toBe('unknown');
  });

  it('ignores places whose coordinates are not finite instead of dragging a centroid', () => {
    const reach = cityReachability([
      OSAKA,
      { city: 'Osaka', coordinates: [Number.NaN, Number.NaN] },
      KYOTO,
    ]);
    const centroid = reach.centroidOf('Osaka');
    expect(centroid?.lat).toBeCloseTo(OSAKA.coordinates![0], 5);
    expect(reach.verdictFor('Osaka', KYOTO)).toBe('day-trip');
  });

  it('has no centroid for a city with nothing located in it', () => {
    expect(cityReachability([{ city: 'Osaka' }]).centroidOf('Osaka')).toBeUndefined();
  });
});

describe('the threshold itself', () => {
  const reach = cityReachability(KANSAI);

  /**
   * Asserted as real distances rather than against the constant, so that
   * moving the constant has to be a deliberate decision measured against the
   * trips it governs.
   */
  it('sits above every Kansai day trip and below the journeys that are not', () => {
    const osakaKyoto = reach.distanceBetween('Osaka', 'Kyoto')!;
    const osakaHimeji = reach.distanceBetween('Osaka', 'Himeji')!;
    const osakaHiroshima = reach.distanceBetween('Osaka', 'Hiroshima')!;
    const osakaTokyo = reach.distanceBetween('Osaka', 'Tokyo')!;

    expect(osakaKyoto).toBeLessThan(DAY_TRIP_RADIUS_KM);
    expect(osakaHimeji).toBeLessThan(DAY_TRIP_RADIUS_KM);
    expect(osakaHiroshima).toBeGreaterThan(DAY_TRIP_RADIUS_KM);
    expect(osakaTokyo).toBeGreaterThan(DAY_TRIP_RADIUS_KM);
    // And the ordering is the one a map would show.
    expect(osakaKyoto).toBeLessThan(osakaHimeji);
    expect(osakaHimeji).toBeLessThan(osakaHiroshima);
    expect(osakaHiroshima).toBeLessThan(osakaTokyo);
  });

  it('is undefined between cities it cannot locate, not zero', () => {
    expect(reach.distanceBetween('Osaka', 'Atlantis')).toBeUndefined();
  });

  /**
   * A place near a city edge is judged on its own point rather than its
   * city's average, which is the more accurate answer and the reason the
   * place's coordinates are preferred over the centroid.
   */
  it('prefers the place’s own coordinates over its city centroid', () => {
    const edgeOfKyoto: PlaceLocation = { city: 'Kyoto', coordinates: [34.88, 135.70] };
    expect(reach.verdictFor('Osaka', edgeOfKyoto)).toBe('day-trip');
  });
});
