/**
 * A trip through several cities, which is what the traveller actually reported:
 *
 * > "I select Japan, then for the cities I selected Osaka, Nara, Kyoto, Kobe
 * > … the itinerary card has day 1 in Osaka then until day 8 in Kyoto and day 6
 * > in Nara, and the location is all Osaka only."
 *
 * Every day was stamped with `profile.destinations[0].city` regardless of where
 * its places were, and the day cards were titled at creation from an even split
 * that nothing downstream honoured. These tests hold the fixed behaviour: days
 * belong to stays, stays are as long as the traveller's own shortlist says, and
 * nothing crosses between them by accident.
 */
import { describe, expect, it } from 'vitest';
import type { Itinerary } from '../data';
import { OSAKA_PLACE_FIXTURE } from './destinationFixtures';
import { buildDestinationItinerary, rankDestinationCandidates } from './destinationPlanner';
import { createEmptyProfile, manualDestination, type TripProfile } from './tripProfile';
import type { CandidateDecision, PlaceCandidate } from './destinationIntelligence';

const KANSAI_CITIES = ['Osaka', 'Nara', 'Kyoto', 'Kobe'] as const;

const kansaiProfile = (overrides: Partial<TripProfile> = {}): TripProfile => ({
  ...createEmptyProfile('MYR'),
  destinations: KANSAI_CITIES.map((city) => manualDestination(city, 'Japan')),
  startDate: '2026-10-01',
  endDate: '2026-10-09',
  dayCount: 8,
  styles: ['street-food', 'history', 'architecture'],
  transport: ['public-transport'],
  ...overrides,
});

const kansaiTrip = (dayCount = 8): Itinerary => ({
  id: 'kansai-8-day',
  name: 'Kansai 2026',
  cities: [...KANSAI_CITIES],
  description: '',
  days: Array.from({ length: dayCount }, (_, index) => ({
    day: index + 1,
    date: `Oct ${index + 1}`,
    // Neutral, which is what `buildDaysFromProfile` now produces for a
    // multi-city trip: no city is claimed before the plan knows one.
    city: '',
    title: `Day ${index + 1}`,
    activities: [],
  })),
});

/**
 * The Osaka fixture carries real places in all four cities — Nara Park,
 * Fushimi Inari, Kobe Harborland — which is why it can stand in for a Kansai
 * deck without inventing data.
 */
const acceptAll = (candidates: PlaceCandidate[]): Record<string, CandidateDecision> =>
  Object.fromEntries(candidates.map((candidate) => [candidate.id, 'interested' as const]));

const build = (profile = kansaiProfile(), itinerary = kansaiTrip()) => {
  const ranked = rankDestinationCandidates(OSAKA_PLACE_FIXTURE, profile);
  return buildDestinationItinerary(itinerary, profile, ranked, acceptAll(OSAKA_PLACE_FIXTURE));
};

describe('a four-city trip is not eight days in Osaka', () => {
  it('gives each chosen city days of its own', () => {
    const result = build();
    const cities = new Set(result.days.map((day) => day.city).filter(Boolean));

    // The reported bug in one assertion: this used to be exactly {'Osaka'}.
    expect(cities.size).toBeGreaterThan(1);
    for (const city of cities) expect(KANSAI_CITIES).toContain(city as typeof KANSAI_CITIES[number]);
  });

  it('reports the legs it planned, in travel order', () => {
    const { cityLegs } = build();

    expect(cityLegs.length).toBeGreaterThan(1);
    expect(cityLegs.map((leg) => leg.city)).toEqual(
      KANSAI_CITIES.filter((city) => cityLegs.some((leg) => leg.city === city)),
    );
  });

  it('keeps each stay continuous rather than hopping back and forth', () => {
    // Osaka, Nara, Osaka again is a plan nobody would book.
    const { days } = build();
    const sequence = days.map((day) => day.city).filter(Boolean);
    const visits = sequence.filter((city, index) => index === 0 || sequence[index - 1] !== city);

    expect(new Set(visits).size).toBe(visits.length);
  });

  it('spends every day of the trip', () => {
    const { days, cityLegs } = build();
    expect(days).toHaveLength(8);
    expect(cityLegs.reduce((total, leg) => total + leg.days, 0)).toBe(8);
  });
});

describe('what a day may draw from', () => {
  it('never schedules a place from another stay onto a day', () => {
    const result = build();

    for (const day of result.days) {
      if (!day.city) continue;
      const places = day.activities.filter((activity) => activity.kind === 'place');
      for (const place of places) {
        const candidate = OSAKA_PLACE_FIXTURE.find((entry) => entry.name === place.name);
        if (!candidate?.city) continue;
        // A day may hold its own city, or a day trip out of it — never a place
        // belonging to a *different* stay on the itinerary.
        const belongsElsewhere = KANSAI_CITIES.includes(candidate.city as typeof KANSAI_CITIES[number])
          && candidate.city !== day.city;
        expect(belongsElsewhere).toBe(false);
      }
    }
  });

  it('tells the traveller how the days were split, and what decided it', () => {
    const { warnings } = build();
    const split = warnings.find((warning) => warning.includes('split'));

    expect(split).toBeDefined();
    expect(split).toContain('Osaka');
    expect(split).toMatch(/how many places you kept/);
  });
});

describe('the shortlist decides the length of each stay', () => {
  it('gives more days to the city the traveller kept more places in', () => {
    const profile = kansaiProfile();
    const ranked = rankDestinationCandidates(OSAKA_PLACE_FIXTURE, profile);
    // Keep everything in Osaka, and exactly one place in Kyoto.
    const kyotoPlaces = OSAKA_PLACE_FIXTURE.filter((candidate) => candidate.city === 'Kyoto');
    const decisions: Record<string, CandidateDecision> = {};
    for (const candidate of OSAKA_PLACE_FIXTURE) {
      if (candidate.city === 'Osaka') decisions[candidate.id] = 'interested';
      else if (candidate.id === kyotoPlaces[0]?.id) decisions[candidate.id] = 'must-do';
      else decisions[candidate.id] = 'skip';
    }

    const { cityLegs } = buildDestinationItinerary(kansaiTrip(), profile, ranked, decisions);
    const osaka = cityLegs.find((leg) => leg.city === 'Osaka');
    const kyoto = cityLegs.find((leg) => leg.city === 'Kyoto');

    expect(osaka?.days).toBeGreaterThan(kyoto?.days ?? 0);
    // A city with nothing kept in it gets no days at all, rather than an empty
    // day that reads as a planning failure.
    expect(cityLegs.map((leg) => leg.city)).not.toContain('Kobe');
  });

  it('says which city lost out when there are more cities than days', () => {
    const profile = kansaiProfile({ dayCount: 3, endDate: '2026-10-04' });
    const ranked = rankDestinationCandidates(OSAKA_PLACE_FIXTURE, profile);
    const result = buildDestinationItinerary(
      kansaiTrip(3),
      profile,
      ranked,
      acceptAll(OSAKA_PLACE_FIXTURE),
    );

    expect(result.cityLegs.length).toBeLessThanOrEqual(3);
    expect(result.warnings.some((warning) => warning.includes('no day of its own')
      || warning.includes('no days of their own'))).toBe(true);
  });
});

describe('the traveller\'s stay plan overrules the planner', () => {
  /**
   * The correction that produced this section: *"You don't get to decide user
   * days on which cities."* Weighing the shortlist is the right answer for a
   * trip that was never asked. It is never the right answer for one that was.
   */
  const withStays = (stays: Array<{ city: string; days: number }>) => kansaiProfile({ cityStays: stays });

  it('follows a plan that contradicts every signal in the shortlist', () => {
    // Everything is shortlisted, and Osaka has by far the most places — the
    // inference would give it five days. The traveller said one.
    const profile = withStays([
      { city: 'Osaka', days: 1 },
      { city: 'Nara', days: 1 },
      { city: 'Kyoto', days: 5 },
      { city: 'Kobe', days: 1 },
    ]);
    const { cityLegs } = build(profile);

    expect(cityLegs).toEqual([
      { city: 'Osaka', startDay: 1, endDay: 1, days: 1 },
      { city: 'Nara', startDay: 2, endDay: 2, days: 1 },
      { city: 'Kyoto', startDay: 3, endDay: 7, days: 5 },
      { city: 'Kobe', startDay: 8, endDay: 8, days: 1 },
    ]);
  });

  it('follows the route order the traveller set, not the order they added cities', () => {
    const profile = withStays([
      { city: 'Kobe', days: 2 },
      { city: 'Kyoto', days: 2 },
      { city: 'Nara', days: 2 },
      { city: 'Osaka', days: 2 },
    ]);
    expect(build(profile).cityLegs.map((leg) => leg.city)).toEqual(['Kobe', 'Kyoto', 'Nara', 'Osaka']);
  });

  it('keeps a city with nothing shortlisted in it, because they asked for it', () => {
    // The inference drops an empty city. A stated plan must not: those days are
    // booked, and an empty day there is a real day the traveller chose.
    const profile = withStays([
      { city: 'Osaka', days: 6 },
      { city: 'Kobe', days: 2 },
    ]);
    const ranked = rankDestinationCandidates(OSAKA_PLACE_FIXTURE, profile);
    const decisions: Record<string, CandidateDecision> = {};
    for (const candidate of OSAKA_PLACE_FIXTURE) {
      decisions[candidate.id] = candidate.city === 'Osaka' ? 'interested' : 'skip';
    }

    const { cityLegs, days } = buildDestinationItinerary(kansaiTrip(), profile, ranked, decisions);

    expect(cityLegs.map((leg) => leg.city)).toEqual(['Osaka', 'Kobe']);
    expect(days.slice(6).map((day) => day.city)).toEqual(['Kobe', 'Kobe']);
  });

  it('says it followed the plan rather than explaining a split it chose', () => {
    const { warnings } = build(withStays([
      { city: 'Osaka', days: 4 },
      { city: 'Kyoto', days: 4 },
    ]));

    expect(warnings.some((warning) => warning.startsWith('Built to your stay plan:'))).toBe(true);
    expect(warnings.some((warning) => warning.includes('how many places you kept'))).toBe(false);
  });

  it('falls back to inference for a plan that was never finished', () => {
    // Three days placed on an eight-day trip, and no record of it ever having
    // added up. Half-answered is not answered, and dumping the five unplaced
    // days on Osaka would be a decision nobody made.
    const { cityLegs, warnings } = build(withStays([{ city: 'Osaka', days: 3 }]));

    expect(cityLegs.reduce((total, leg) => total + leg.days, 0)).toBe(8);
    expect(warnings.some((warning) => warning.includes('how many places you kept'))).toBe(true);
  });

  describe('when the trip changes length afterwards', () => {
    /**
     * The traveller's question: *"What if user add one more day in the app
     * after building and setting up the trip?"* A finished plan must survive
     * it. Discarding eight deliberate nights because a ninth day appeared
     * would be the app forgetting a decision it had just been given.
     */
    const finished = (stays: Array<{ city: string; days: number }>, plannedFor: number) =>
      kansaiProfile({ cityStays: stays, cityStayDayCount: plannedFor });

    it('keeps the plan and puts the extra day on the last stay', () => {
      const profile = finished([
        { city: 'Osaka', days: 4 },
        { city: 'Kyoto', days: 4 },
      ], 8);
      const { cityLegs } = buildDestinationItinerary(
        kansaiTrip(9),
        { ...profile, dayCount: 9, endDate: '2026-10-10' },
        rankDestinationCandidates(OSAKA_PLACE_FIXTURE, profile),
        acceptAll(OSAKA_PLACE_FIXTURE),
      );

      expect(cityLegs).toEqual([
        { city: 'Osaka', startDay: 1, endDay: 4, days: 4 },
        { city: 'Kyoto', startDay: 5, endDay: 9, days: 5 },
      ]);
    });

    it('says where the extra day went, so it can be moved', () => {
      const profile = finished([{ city: 'Osaka', days: 4 }, { city: 'Kyoto', days: 4 }], 8);
      const { warnings } = buildDestinationItinerary(
        kansaiTrip(9),
        { ...profile, dayCount: 9, endDate: '2026-10-10' },
        rankDestinationCandidates(OSAKA_PLACE_FIXTURE, profile),
        acceptAll(OSAKA_PLACE_FIXTURE),
      );

      expect(warnings.some((warning) => warning.includes('1 day longer than your stay plan')
        && warning.includes('added to Kyoto'))).toBe(true);
    });

    it('takes days off the end when the trip is shortened, and says so', () => {
      const profile = finished([{ city: 'Osaka', days: 4 }, { city: 'Kyoto', days: 4 }], 8);
      const { cityLegs, warnings } = buildDestinationItinerary(
        kansaiTrip(6),
        { ...profile, dayCount: 6, endDate: '2026-10-07' },
        rankDestinationCandidates(OSAKA_PLACE_FIXTURE, profile),
        acceptAll(OSAKA_PLACE_FIXTURE),
      );

      expect(cityLegs).toEqual([
        { city: 'Osaka', startDay: 1, endDay: 4, days: 4 },
        { city: 'Kyoto', startDay: 5, endDay: 6, days: 2 },
      ]);
      expect(warnings.some((warning) => warning.includes('2 days shorter than your stay plan'))).toBe(true);
    });

    it('says nothing about drift when the plan still fits exactly', () => {
      const { warnings } = build(finished([{ city: 'Osaka', days: 4 }, { city: 'Kyoto', days: 4 }], 8));
      expect(warnings.some((warning) => warning.includes('longer than your stay plan')
        || warning.includes('shorter than your stay plan'))).toBe(false);
    });
  });

  it('ignores a plan naming a city the trip no longer has', () => {
    const profile = withStays([
      { city: 'Osaka', days: 4 },
      { city: 'Kyoto', days: 4 },
      { city: 'Tokyo', days: 4 },
    ]);
    const { cityLegs } = build(profile);

    expect(cityLegs.map((leg) => leg.city)).not.toContain('Tokyo');
    expect(cityLegs.reduce((total, leg) => total + leg.days, 0)).toBe(8);
  });
});

describe('a single-city trip is unchanged', () => {
  it('keeps one leg, and lets day trips stay day trips', () => {
    const profile: TripProfile = {
      ...kansaiProfile(),
      destinations: [manualDestination('Osaka', 'Japan')],
    };
    const itinerary: Itinerary = { ...kansaiTrip(), cities: ['Osaka'] };
    const ranked = rankDestinationCandidates(OSAKA_PLACE_FIXTURE, profile);
    const result = buildDestinationItinerary(itinerary, profile, ranked, acceptAll(OSAKA_PLACE_FIXTURE));

    expect(result.cityLegs.map((leg) => leg.city)).toEqual(['Osaka']);
    expect(new Set(result.days.map((day) => day.city))).toEqual(new Set(['Osaka']));
    // Kyoto and Nara places are still *offered* — the pace decides whether a
    // day out of Osaka is scheduled, which is `allowCrossCityDays`.
    expect(result.warnings.some((warning) => warning.includes('split'))).toBe(false);
  });
});
