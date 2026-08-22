/**
 * Integration cover for the claim that matters most: the planner is no longer
 * Osaka-shaped. A city with no fixture, no knowledge pack and no theme table
 * must flow through exactly the same pipeline.
 */
import { describe, expect, it } from 'vitest';
import type { Itinerary } from '../data';
import type { PlaceCandidate } from './destinationIntelligence';
import {
  assignClustersToDays,
  buildDestinationItinerary,
  defaultDiscoveryDecisions,
  rankDestinationCandidates,
  shapeTripEdge,
} from './destinationPlanner';
import { createEmptyProfile, manualDestination, type TripMood, type TripProfile } from './tripProfile';
import { deriveTravelBehaviour } from './travelBehaviour';
import {
  ARRIVAL_SETTLING_MINUTES,
  DEPARTURE_LEAD_MINUTES,
} from '../../supabase/functions/_shared/itineraryEdgeTiming';
import { toMinutes, toTime } from './humanScheduler';

const place = (
  id: string,
  name: string,
  coordinates: [number, number],
  neighbourhood: string,
  categories: string[],
  extra: Partial<PlaceCandidate> = {},
): PlaceCandidate => ({
  id,
  provider: 'google',
  providerPlaceId: `google:${id}`,
  name,
  countryCode: 'AU',
  city: 'Melbourne',
  neighbourhood,
  coordinates,
  categories,
  experienceTags: ['architecture', 'cafes'],
  estimatedVisitMinutes: 90,
  indoorOutdoor: 'mixed',
  reservationStatus: 'not-needed',
  sourceConfidence: 'high',
  sourceReferences: [{ label: 'Visit Victoria', url: 'https://www.visitmelbourne.com/' }],
  lastVerifiedAt: '2026-08-01T00:00:00.000Z',
  openingHours: { periods: [{ opensAt: '09:00', closesAt: '18:00' }], sourceConfidence: 'high' },
  ...extra,
});

/** Twelve Melbourne places across four real areas. No fixture backs these. */
const MELBOURNE: PlaceCandidate[] = [
  place('fed-square', 'Federation Square', [-37.8180, 144.9691], 'CBD', ['essential']),
  place('acmi', 'ACMI', [-37.8177, 144.9686], 'CBD', ['museum', 'art']),
  place('hosier', 'Hosier Lane', [-37.8166, 144.9690], 'CBD', ['local-character']),
  place('block-arcade', 'Block Arcade', [-37.8155, 144.9646], 'CBD', ['shopping', 'architecture']),
  place('ngv', 'NGV International', [-37.8226, 144.9689], 'Southbank', ['museum', 'art']),
  place('arts-centre', 'Arts Centre Melbourne', [-37.8210, 144.9683], 'Southbank', ['architecture']),
  place('botanic', 'Royal Botanic Gardens', [-37.8304, 144.9796], 'South Yarra', ['park', 'garden']),
  place('shrine', 'Shrine of Remembrance', [-37.8305, 144.9733], 'South Yarra', ['history']),
  place('queen-vic', 'Queen Victoria Market', [-37.8076, 144.9568], 'North Melbourne', ['market', 'food'],
    { openingHours: { periods: [{ opensAt: '06:00', closesAt: '15:00' }], sourceConfidence: 'high' } }),
  place('brunswick', 'Brunswick Street', [-37.7987, 144.9784], 'Fitzroy', ['local-character', 'shopping']),
  place('rose-street', 'Rose Street Artists Market', [-37.7969, 144.9800], 'Fitzroy', ['market', 'art']),
  place('st-kilda', 'St Kilda Beach', [-37.8677, 144.9740], 'St Kilda', ['waterfront']),
];

const melbourneProfile = (moods: TripMood[] = []): TripProfile => ({
  ...createEmptyProfile(),
  destinations: [manualDestination('Melbourne', 'Australia')],
  dayCount: 5,
  styles: ['cafes', 'museums'],
  moods,
});

const emptyItinerary = (days: number): Itinerary => ({
  id: 'melbourne-trip',
  name: 'Melbourne Winter 2026',
  description: 'Each day leans into buildings to stand under and nights that run late.',
  cities: ['Melbourne'],
  days: Array.from({ length: days }, (_, index) => ({
    day: index + 1,
    date: '',
    stayCity: 'Melbourne',
    activityCities: [],
    city: 'Melbourne',
    title: `Day ${index + 1}`,
    activities: [],
  })),
});

const build = (profile: TripProfile, days = 5) => {
  const ranked = rankDestinationCandidates(MELBOURNE, profile);
  return buildDestinationItinerary(emptyItinerary(days), profile, ranked, defaultDiscoveryDecisions(ranked));
};

describe('the planner is city-agnostic', () => {
  it('builds a real Melbourne itinerary with no fixture and no theme table', () => {
    const result = build(melbourneProfile());
    const scheduled = result.days.flatMap((day) => day.activities.filter((activity) => activity.kind === 'place'));
    expect(scheduled.length).toBeGreaterThanOrEqual(8);
    expect(result.days.every((day) => day.city === 'Melbourne')).toBe(true);
  });

  it('never leaks another destination into the output', () => {
    const serialised = JSON.stringify(build(melbourneProfile()));
    expect(serialised).not.toMatch(/Osaka|Kansai|fixture mode|vertical slice/i);
  });

  it('names days after the areas they actually visit, all distinct', () => {
    const result = build(melbourneProfile());
    const titles = result.days
      .filter((day) => day.activities.some((activity) => activity.kind === 'place'))
      .map((day) => day.title);
    expect(new Set(titles).size).toBe(titles.length);
    // Titles come from the real neighbourhoods in the data.
    expect(titles.join(' ')).toMatch(/CBD|Southbank|Fitzroy|South Yarra|North Melbourne|St Kilda/);
  });

  it('explains a rejection specifically, not just by category', () => {
    /**
     * The category ("Opening hours don't fit") is the same for two places that
     * were blocked for entirely different reasons. The scheduler's own sentence
     * names the constraint — a closing time, a walking limit, a weekday — and
     * that is what reaches the traveller.
     */
    const profile = melbourneProfile();
    const ranked = rankDestinationCandidates(MELBOURNE, profile);
    // Two days for twelve places guarantees some cannot fit.
    const result = buildDestinationItinerary(emptyItinerary(2), profile, ranked, defaultDiscoveryDecisions(ranked));
    expect(result.unscheduledReasons.length).toBeGreaterThan(0);
    for (const rejection of result.unscheduledReasons) {
      expect(rejection.detail.length).toBeGreaterThan(0);
    }
    // At least one names a concrete limit rather than restating the category.
    expect(result.unscheduledReasons.some((rejection) => /\d/.test(rejection.detail))).toBe(true);
  });

  it('accounts for every accepted place — scheduled or explained', () => {
    const profile = melbourneProfile();
    const ranked = rankDestinationCandidates(MELBOURNE, profile);
    const decisions = defaultDiscoveryDecisions(ranked);
    const accepted = Object.values(decisions).filter((d) => d === 'must-do' || d === 'interested').length;
    const result = buildDestinationItinerary(emptyItinerary(5), profile, ranked, decisions);
    expect(result.scheduledCandidates.length + result.unscheduledCandidates.length).toBe(accepted);
    for (const rejection of result.unscheduledReasons) {
      expect(rejection.detail.length).toBeGreaterThan(0);
    }
  });
});

describe('sending the sheltered part of the city to the wet day', () => {
  const indoor = (id: string) => place(id, id, [-37.81, 144.96], 'Roofed', ['museum'], { indoorOutdoor: 'indoor' });
  const outdoor = (id: string) => place(id, id, [-37.83, 144.98], 'Open Air', ['park'], { indoorOutdoor: 'outdoor' });
  const sheltered = [indoor('m1'), indoor('m2')];
  const exposed = [outdoor('p1'), outdoor('p2')];

  it('gives the rainy day the indoor cluster', () => {
    // Ordering within a day can only shuffle what the day was given. If the wet
    // day got the gardens and the beach, there is nothing to bring forward.
    const assigned = assignClustersToDays([exposed, sheltered], 2, [1]);
    expect(assigned[0]).toBe(sheltered);
    expect(assigned[1]).toBe(exposed);
  });

  it('keeps the usual order when no rain is forecast', () => {
    const assigned = assignClustersToDays([exposed, sheltered], 2, []);
    expect(assigned[0]).toBe(exposed);
  });

  it('does not trade a coherent day for a marginal difference', () => {
    // Both clusters are equally exposed; swapping would gain nothing and lose
    // the largest-first ordering that makes days hang together.
    const assigned = assignClustersToDays([exposed, [outdoor('p3'), outdoor('p4')]], 2, [1]);
    expect(assigned[0]).toBe(exposed);
  });

  it('handles more days than clusters without inventing one', () => {
    const assigned = assignClustersToDays([sheltered], 3, [2]);
    expect(assigned).toHaveLength(3);
    expect(assigned[1]).toEqual([]);
    expect(assigned[2]).toEqual([]);
  });

  it('reaches the finished plan, not just the assignment', () => {
    const profile = melbourneProfile();
    const ranked = rankDestinationCandidates(MELBOURNE, profile);
    const result = buildDestinationItinerary(emptyItinerary(4), profile, ranked, defaultDiscoveryDecisions(ranked), {
      weatherRiskDays: [1],
    });
    expect(result.days).toHaveLength(4);
    // Every accepted place still finds a home; weather changes the order, not
    // whether the trip works.
    expect(result.scheduledCandidates.length).toBeGreaterThan(0);
  });
});

describe('the edges of a trip are not ordinary days', () => {
  it('starts day one after the plane lands, with time to drop bags', () => {
    const arrivalTime = '11:00';
    const shape = shapeTripEdge(0, 4, { arrivalTime });
    expect(shape.startTimeOverride).toBe(toTime(toMinutes(arrivalTime) + ARRIVAL_SETTLING_MINUTES));
    expect(shape.maxMainOverride).toBe(1);
  });

  it('gives up on an evening arrival rather than pretending it is a day', () => {
    const shape = shapeTripEdge(0, 4, { arrivalTime: '19:30' });
    expect(shape.maxMainOverride).toBe(0);
  });

  it('ends the last day in time to leave for the airport', () => {
    const departureTime = '20:00';
    const shape = shapeTripEdge(3, 4, { departureTime });
    expect(shape.returnTimeOverride).toBe(toTime(toMinutes(departureTime) - DEPARTURE_LEAD_MINUTES));
  });

  it('leaves the days in the middle alone', () => {
    expect(shapeTripEdge(1, 4, { arrivalTime: '11:00', departureTime: '20:00' })).toEqual({});
  });

  it('eases the first days of a long-haul trip', () => {
    const jetLagged = shapeTripEdge(1, 6, { timezoneShiftHours: -8 });
    expect(jetLagged.maxMainOverride).toBe(2);
    expect(jetLagged.note).toContain('8-hour time difference');
  });

  it('ignores a time difference the body would not notice', () => {
    expect(shapeTripEdge(1, 6, { timezoneShiftHours: 2 })).toEqual({});
  });

  it('stops easing off once the traveller has adjusted', () => {
    expect(shapeTripEdge(3, 6, { timezoneShiftHours: -8 })).toEqual({});
  });

  it('does nothing at all when no flight times are known', () => {
    // The common case: a trip planned before the flights are booked.
    expect(shapeTripEdge(0, 4, {})).toEqual({});
  });

  it('treats a single-day trip as an arrival, never a departure', () => {
    const shape = shapeTripEdge(0, 1, { arrivalTime: '09:00', departureTime: '22:00' });
    expect(shape.startTimeOverride).toBe('11:00');
    expect(shape.returnTimeOverride).toBeUndefined();
  });

  it('shapes the real plan, and says why', () => {
    const profile = melbourneProfile();
    const ranked = rankDestinationCandidates(MELBOURNE, profile);
    const result = buildDestinationItinerary(emptyItinerary(4), profile, ranked, defaultDiscoveryDecisions(ranked), {
      tripEdges: { arrivalTime: '14:00', departureTime: '19:00' },
    });
    // Day one cannot start before 16:00, so it holds at most one stop.
    expect(result.dayLoads[0].mainActivities).toBeLessThanOrEqual(1);
    expect(result.warnings.some((warning) => warning.includes('14:00 arrival'))).toBe(true);
    expect(result.warnings.some((warning) => warning.includes('19:00 departure'))).toBe(true);
  });
});

describe('evening out the trip', () => {
  /**
   * A trip the greedy pass genuinely gets wrong: one area strung out over
   * walkable distances, another packed into a single corner. Filling days in
   * order gives one day all the walking.
   */
  const LOPSIDED: PlaceCandidate[] = [
    place('walk-1', 'Walk One', [-37.8100, 144.9600], 'Strung Out', ['museum']),
    place('walk-2', 'Walk Two', [-37.8195, 144.9600], 'Strung Out', ['museum']),
    place('walk-3', 'Walk Three', [-37.8290, 144.9600], 'Strung Out', ['museum']),
    place('tight-1', 'Tight One', [-37.7500, 145.0500], 'One Corner', ['museum']),
    place('tight-2', 'Tight Two', [-37.7501, 145.0501], 'One Corner', ['museum']),
  ];

  const buildLopsided = (days: number) => {
    const profile = melbourneProfile();
    const ranked = rankDestinationCandidates(LOPSIDED, profile);
    return buildDestinationItinerary(emptyItinerary(days), profile, ranked, defaultDiscoveryDecisions(ranked));
  };

  const spreadOf = (result: ReturnType<typeof buildLopsided>) => {
    const scores = result.dayLoads.filter((load) => load.mainActivities > 0).map((load) => load.fatigueScore);
    return scores.length < 2 ? 0 : Math.max(...scores) - Math.min(...scores);
  };

  it('moves a stop off the hardest day, and says that it did', () => {
    // Proves the mechanism actually engages — not merely that it stayed quiet.
    const result = buildLopsided(2);
    expect(result.warnings.some((warning) => warning.includes('lighter day'))).toBe(true);
  });

  it('leaves the trip more even than it found it', () => {
    // Filling days in order gives this set a spread of 0.247 — one day twice as
    // demanding as the other. Rebalancing must improve on that. It is not
    // required to reach the tolerance: it makes the best moves it can find
    // within its budget and stops when none of them help.
    expect(spreadOf(buildLopsided(2))).toBeLessThan(0.247);
  });

  it('spreads the walking rather than loading it all onto one day', () => {
    // The measure the traveller actually feels. On the full Melbourne set the
    // greedy pass produces 34 walking minutes on day one against 9 on day four.
    const walking = build(melbourneProfile(), 4).dayLoads
      .filter((load) => load.mainActivities > 0)
      .map((load) => load.walkingMinutes);
    expect(Math.max(...walking) - Math.min(...walking)).toBeLessThan(25);
  });

  it('never loses a place while evening days out', () => {
    // A move onto a day that cannot absorb the stop would silently drop it,
    // which is far worse than an uneven trip.
    const profile = melbourneProfile();
    const ranked = rankDestinationCandidates(LOPSIDED, profile);
    const decisions = defaultDiscoveryDecisions(ranked);
    const accepted = Object.values(decisions).filter((d) => d === 'must-do' || d === 'interested').length;
    const result = buildDestinationItinerary(emptyItinerary(2), profile, ranked, decisions);
    expect(result.scheduledCandidates.length + result.unscheduledCandidates.length).toBe(accepted);
  });

  it('leaves an already-even trip alone rather than churning it', () => {
    // Three days over this set already sit within tolerance at 0.140.
    const result = build(melbourneProfile(), 3);
    expect(result.warnings.some((warning) => warning.includes('lighter day'))).toBe(false);
  });

  it('does not quietly consume a free day', () => {
    // Five days, four days' worth of places. The empty day stays empty:
    // rebalancing evens out the days already being spent.
    const result = build(melbourneProfile(), 5);
    expect(result.dayLoads.filter((load) => load.mainActivities === 0).length).toBeGreaterThan(0);
  });

  it('still produces a plan when there is only one day to fill', () => {
    // Nothing to balance against; the rebalancer must simply do nothing.
    const result = build(melbourneProfile(), 1);
    expect(result.days).toHaveLength(1);
    expect(result.days[0].activities.some((activity) => activity.kind === 'place')).toBe(true);
  });
});

describe('pace visibly reshapes the itinerary', () => {
  it('produces a lighter, later, roomier trip when the traveller chose Calm', () => {
    const relaxed = build(melbourneProfile(['calm']));
    const active = build(melbourneProfile(['fast-paced']));

    const count = (result: typeof relaxed) =>
      result.days.reduce((total, day) => total + day.activities.filter((a) => a.kind === 'place').length, 0);

    expect(count(active)).toBeGreaterThan(count(relaxed));
    expect(relaxed.behaviour.pace).toBe('relaxed');
    expect(active.behaviour.pace).toBe('active');

    const relaxedStart = relaxed.dayLoads[0].departureTime;
    const activeStart = active.dayLoads[0].departureTime;
    expect(relaxedStart > activeStart).toBe(true);

    // Absolute exertion, not fatigueScore: that is normalised to each
    // traveller's own limits and so is not comparable across pace profiles.
    const exertion = (result: typeof relaxed) =>
      result.dayLoads.reduce((total, load) => total + load.walkingMinutes + load.transportMinutes, 0);
    expect(exertion(active)).toBeGreaterThan(exertion(relaxed));

    // Density, not raw free minutes: an active profile has a longer available
    // day, so with a limited candidate pool it can leave more minutes unfilled
    // while still being the busier trip. Stops-per-day is the honest signal.
    const busiestDay = (result: typeof relaxed) =>
      Math.max(...result.dayLoads.map((load) => load.mainActivities));
    expect(busiestDay(relaxed)).toBeLessThan(busiestDay(active));

    // Every relaxed day stays at or under its 2-stop ceiling; every active day
    // is allowed more. This is the difference a traveller actually feels.
    expect(relaxed.dayLoads.every((load) => load.mainActivities <= 2)).toBe(true);
    expect(active.dayLoads.some((load) => load.mainActivities >= 3)).toBe(true);
  });

  it('reads fatigue against the traveller’s own limits, not an absolute scale', () => {
    // A relaxed traveller at 2 of 2 stops is genuinely at their ceiling, and
    // should be told so — even though an active traveller doing more is fine.
    const relaxed = build(melbourneProfile(['calm']));
    const busiest = Math.max(...relaxed.dayLoads.map((load) => load.fatigueScore));
    expect(busiest).toBeGreaterThan(0.3);
    expect(busiest).toBeLessThanOrEqual(1);
  });

  it('reports the human load of every day', () => {
    const result = build(melbourneProfile());
    expect(result.dayLoads).toHaveLength(result.days.length);
    for (const load of result.dayLoads) {
      expect(load.departureTime).toMatch(/^\d{2}:\d{2}$/);
      expect(load.expectedReturnTime).toMatch(/^\d{2}:\d{2}$/);
      expect(load.fatigueScore).toBeGreaterThanOrEqual(0);
      expect(load.fatigueScore).toBeLessThanOrEqual(1);
      expect(load.walkingDistanceMeters).toBeGreaterThanOrEqual(0);
    }
  });

  it('honours an explicit behaviour override above any inferred mood', () => {
    const profile = melbourneProfile(['fast-paced']);
    const ranked = rankDestinationCandidates(MELBOURNE, profile);
    const result = buildDestinationItinerary(
      emptyItinerary(5),
      profile,
      ranked,
      defaultDiscoveryDecisions(ranked),
      { behaviour: deriveTravelBehaviour(profile, { pace: 'very-relaxed' }) },
    );
    expect(result.behaviour.pace).toBe('very-relaxed');
  });
});

describe('safety guarantees survive the rewrite', () => {
  it('preserves a locked activity and plans around it', () => {
    const itinerary = emptyItinerary(5);
    itinerary.days[0].activities = [{
      id: 'booked-dinner',
      kind: 'place',
      time: '19:00',
      name: 'Booked dinner',
      type: 'food',
      source: 'manual',
      locked: true,
      lockedFields: ['all'],
    } as never];

    const profile = melbourneProfile();
    const ranked = rankDestinationCandidates(MELBOURNE, profile);
    const result = buildDestinationItinerary(itinerary, profile, ranked, defaultDiscoveryDecisions(ranked));
    const kept = result.days[0].activities.find((activity) => activity.id === 'booked-dinner');
    expect(kept).toBeDefined();
    expect(kept?.time).toBe('19:00');
  });

  it('uses live routing when a provider answers, and says so', () => {
    const profile = melbourneProfile();
    const ranked = rankDestinationCandidates(MELBOURNE, profile);
    const result = buildDestinationItinerary(
      emptyItinerary(5),
      profile,
      ranked,
      defaultDiscoveryDecisions(ranked),
      { routeResolver: () => ({ durationMinutes: 11, distanceMeters: 800, mode: 'walking', source: 'provider' }) },
    );
    expect(result.routeMode).toBe('provider');
  });

  it('labels straight-line estimates honestly when no provider is connected', () => {
    const result = build(melbourneProfile());
    expect(result.routeMode).toBe('offline-straight-line');
    expect(result.warnings.join(' ')).toMatch(/straight-line/);
  });

  it('carries current event facts into the plan as a reviewable warning', () => {
    const profile = melbourneProfile();
    const ranked = rankDestinationCandidates(MELBOURNE, profile);
    const result = buildDestinationItinerary(
      emptyItinerary(5),
      profile,
      ranked,
      defaultDiscoveryDecisions(ranked),
      { currentEventNotes: ['Laneway Festival (2026-08-05)'] },
    );
    expect(result.warnings.join(' ')).toContain('Laneway Festival (2026-08-05)');
    expect(result.warnings.join(' ')).toContain('before locking');
  });

  it('flags a timed live event that overlaps a proposed activity', () => {
    const profile = melbourneProfile();
    const ranked = rankDestinationCandidates(MELBOURNE, profile);
    const result = buildDestinationItinerary(
      emptyItinerary(5),
      profile,
      ranked,
      defaultDiscoveryDecisions(ranked),
      {
        currentEvents: [{ id: 'event-1', name: 'Laneway Festival', date: '2026-08-05', startTime: '10:00', endTime: '15:00' }],
      },
    );
    expect(result.warnings.join(' ')).toContain('Laneway Festival overlaps');
  });

  it('drops a place whose reported queue exceeds the traveller tolerance', () => {
    const profile = melbourneProfile(['calm']);
    const ranked = rankDestinationCandidates(MELBOURNE, profile);
    const result = buildDestinationItinerary(
      emptyItinerary(5),
      profile,
      ranked,
      defaultDiscoveryDecisions(ranked),
      { queueEvidence: { 'fed-square': 120 } },
    );
    const rejection = result.unscheduledReasons.find((item) => item.candidate.id === 'fed-square');
    expect(rejection?.reason).toBe('queue-exceeds-tolerance');
  });
});

/**
 * The roadmap's §9.2 and §9.4 verification pass, run through real builds
 * rather than by hand.
 *
 * §7's first success criterion — "selecting Calm produces a visibly different
 * itinerary from Fast paced" — had never been demonstrated on a real plan, only
 * inferred from the pace table. The `indoorOutdoor` loss is the reason that
 * distinction matters: the code path looked right there too, and had been dead
 * since the first save.
 */
describe('§9.2 — the chosen pace visibly reshapes the plan', () => {
  const planFor = (moods: TripMood[]) => {
    const result = build(melbourneProfile(moods), 3);
    const day = result.days[0];
    return {
      pace: result.behaviour.pace,
      placesPerDay: result.days.map((d) => d.activities.filter((a) => a.kind === 'place').length),
      firstStart: day.activities[0]?.time ?? '',
      mealMinutes: day.activities.find((a) => a.kind === 'meal-window')?.durationMinutes ?? 0,
      walking: result.dayLoads[0]?.walkingMinutes ?? 0,
    };
  };

  it('routes the three moods onto three different paces', () => {
    expect(planFor(['calm']).pace).toBe('relaxed');
    expect(planFor([]).pace).toBe('balanced');
    expect(planFor(['fast-paced']).pace).toBe('active');
  });

  it('gives a calm trip fewer stops on its busiest day', () => {
    const calm = planFor(['calm']);
    const fast = planFor(['fast-paced']);
    expect(Math.max(...calm.placesPerDay)).toBeLessThan(Math.max(...fast.placesPerDay));
  });

  it('starts a calm day later than a fast-paced one', () => {
    // Verified: 10:13 against 09:13.
    expect(planFor(['calm']).firstStart > planFor(['fast-paced']).firstStart).toBe(true);
  });

  it('gives a calm trip longer meals', () => {
    // Verified: 85 minutes against 55. PACE_DEFAULTS.diningMinutes reaching
    // the plan, not merely being declared.
    expect(planFor(['calm']).mealMinutes).toBeGreaterThan(planFor(['fast-paced']).mealMinutes);
  });

  it('walks a calm traveller less far', () => {
    expect(planFor(['calm']).walking).toBeLessThan(planFor(['fast-paced']).walking);
  });
});

describe('§9.4 — flight times reshape the edges of a real plan', () => {
  const buildWithEdges = (tripEdges: Record<string, string>, days = 3) => {
    const profile = melbourneProfile();
    const ranked = rankDestinationCandidates(MELBOURNE, profile);
    return buildDestinationItinerary(
      emptyItinerary(days), profile, ranked, defaultDiscoveryDecisions(ranked), { tripEdges },
    );
  };

  it('leaves no room for sightseeing on the day a 19:30 flight lands', () => {
    /**
     * The arrival edge keeps the day at dinner-only capacity. The dinner may
     * be a real venue or the flexible fallback, but no main sight is invented
     * after 21:30.
     */
    const result = buildWithEdges({ arrivalTime: '19:30' });
    expect(result.days[0].activities.filter((activity) => activity.kind === 'place')).toHaveLength(0);
    expect(result.days[0].activities.filter((activity) => activity.kind === 'meal-window')).toHaveLength(1);
  });

  it('tells the traveller why day one is empty rather than looking broken', () => {
    const result = buildWithEdges({ arrivalTime: '19:30' });
    expect(result.warnings.join(' ')).toContain('19:30 arrival');
  });

  it('still accounts for every place it could not fit', () => {
    // The "nothing is dropped silently" guarantee has to survive an edge that
    // removes a whole day of capacity.
    const result = buildWithEdges({ arrivalTime: '19:30' });
    expect(result.unscheduledReasons.length).toBeGreaterThan(0);
    expect(result.unscheduledReasons.every((entry) => entry.detail.trim().length > 0)).toBe(true);
  });

  it('shortens the last day for a 20:00 departure instead of filling it', () => {
    const shaped = buildWithEdges({ departureTime: '20:00' });
    const plain = buildWithEdges({});
    const lastOf = (r: typeof shaped) => r.days[r.days.length - 1].activities.filter((a) => a.kind === 'place');
    expect(lastOf(shaped).length).toBeLessThanOrEqual(lastOf(plain).length);
    expect(shaped.warnings.join(' ')).toContain('20:00 departure');
  });

  it('survives a departure so early the day ends before it starts', () => {
    /**
     * A 12:33 flight means leaving by 09:03, which is earlier than the 09:30 a
     * balanced day begins — an inverted window. This was untested and is the
     * case most likely to throw or to silently produce nonsense.
     */
    const result = buildWithEdges({ departureTime: '12:33' });
    expect(result.days[result.days.length - 1].activities).toHaveLength(0);
    // And it says so, rather than pretending the day worked out.
    expect(result.warnings.join(' ')).toMatch(/09:03 target/);
  });
});
