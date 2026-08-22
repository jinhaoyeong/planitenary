/**
 * A saved place keeps its own city.
 *
 * Nothing that rebuilds or improves an itinerary — "Plan my trip", any Smart
 * Plan action, the deterministic fallback — may relocate a stop into a city the
 * traveller cannot be in that day. Before this guard the only thing standing
 * between an Osaka place and a Kyoto day was a sentence in the model prompt,
 * which is advice rather than a constraint, and the deterministic fallback
 * would do it too once the Osaka days filled up.
 *
 * The harder half of the requirement is what must keep working: a day trip is
 * not a relocation. A traveller based in Osaka spending Tuesday in Kyoto is the
 * single most common shape of a Kansai trip, and a guard that refused every
 * cross-city placement would "pass" while quietly deleting all of them. Both
 * directions are asserted here.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  defaultComposition,
  runItineraryProposalEngine,
  validateItineraryProposal,
  type ModelItineraryComposition,
  type PlanningMaterial,
  type PlanningPlace,
  type ProposedItineraryDay,
  type RouteMatrixLeg,
} from '../../supabase/functions/_shared/itineraryProposal';

const hours = [{ opensAt: '09:00', closesAt: '20:00', days: [1, 2, 3, 4, 5, 6, 0] }];

/** Real Kansai coordinates: the threshold is meaningless against invented ones. */
const CITY_POINTS: Record<string, [number, number]> = {
  Osaka: [34.6687, 135.5013],
  Kyoto: [34.9671, 135.7727],
  Nara: [34.6851, 135.8048],
  Kobe: [34.6901, 135.1955],
  Hiroshima: [34.3853, 132.4553],
  Tokyo: [35.6762, 139.6503],
};

const place = (id: string, city: string, override: Partial<PlanningPlace> = {}): PlanningPlace => ({
  id,
  name: `${city} ${id}`,
  city,
  cluster: `${city.toLowerCase()}::central`,
  coordinates: CITY_POINTS[city],
  categories: ['sight'],
  priority: 'interested',
  durationRangeMinutes: [60, 90],
  openingHours: hours,
  sourceUrls: [`https://example.test/${id}`],
  locked: false,
  reservation: false,
  ...override,
});

/** Four days based in Osaka, then two based in Kyoto — the shape on screen. */
const kansai = (override: Partial<PlanningMaterial> = {}): PlanningMaterial => ({
  version: 1,
  tripId: 'trip-kansai',
  revision: 'plan-v1-city',
  name: 'Osaka to Kyoto',
  cities: ['Osaka', 'Kyoto'],
  pace: 'balanced',
  styles: ['history'],
  tripTypes: ['couple'],
  moods: ['calm'],
  transportModes: ['public-transport'],
  preferences: {},
  days: [
    { day: 1, date: '2026-08-11', stayCity: 'Osaka', activityCities: [], city: 'Osaka', startTime: '09:00', endTime: '21:00', maxMainActivities: 3, fixedPlaceIds: [] },
    { day: 2, date: '2026-08-12', stayCity: 'Osaka', activityCities: [], city: 'Osaka', startTime: '09:00', endTime: '21:00', maxMainActivities: 3, fixedPlaceIds: [] },
    { day: 5, date: '2026-08-15', stayCity: 'Kyoto', activityCities: [], city: 'Kyoto', startTime: '09:00', endTime: '21:00', maxMainActivities: 3, fixedPlaceIds: [] },
  ],
  places: [place('dotonbori', 'Osaka'), place('fushimi', 'Kyoto'), place('todaiji', 'Nara')],
  excludedRequiredPlaces: [],
  clusters: [],
  limits: { maxPlaces: 25, maxDays: 21, maxRepairIterations: 2 },
  ...override,
});

const item = (placeId: string, name: string, startTime: string, endTime: string) => ({
  id: placeId, placeId, type: 'place' as const, name,
  arrivalTime: startTime, startTime, endTime,
  visitDurationMinutes: 60, bufferMinutes: 0, rationale: '', warnings: [], evidence: [],
});

const dayWith = (
  day: number,
  date: string,
  items: ReturnType<typeof item>[],
  city = 'Osaka',
): ProposedItineraryDay => ({
  day, date, stayCity: city, activityCities: [], city, startTime: '09:00', endTime: '21:00', warnings: [],
  metrics: { placeCount: items.length, travelMinutes: 0, freeMinutes: 0, clusterChanges: 0 },
  items,
});

const matrix = (ids: string[]): RouteMatrixLeg[] => ids.flatMap((from) =>
  ids.flatMap((to) => from === to ? [] : [{
    fromPlaceId: from, toPlaceId: to, status: 'ok' as const,
    durationMinutes: 30, distanceMeters: 3_000,
    mode: 'public-transport' as const, source: 'provider' as const,
  }]));

const run = (source: PlanningMaterial, composition: ModelItineraryComposition) =>
  runItineraryProposalEngine(source, {
    chooseComposition: vi.fn().mockResolvedValue(composition),
    getRouteMatrix: vi.fn().mockResolvedValue(matrix(source.places.map((entry) => entry.id))),
    now: () => '2026-08-10T08:00:00.000Z',
  });

/** Kansai plus a Tokyo place, so Tokyo has a location to be judged against. */
const withTokyo = (override: Partial<PlanningMaterial> = {}): PlanningMaterial => kansai({
  cities: ['Osaka', 'Kyoto', 'Tokyo'],
  places: [place('dotonbori', 'Osaka'), place('fushimi', 'Kyoto'), place('skytree', 'Tokyo')],
  ...override,
});

describe('a place may not be relocated into a city it cannot be reached from', () => {
  it('refuses a Tokyo place on a day based in Osaka', () => {
    const conflicts = validateItineraryProposal(
      [dayWith(1, '2026-08-11', [item('skytree', 'Skytree', '10:00', '11:00')])],
      withTokyo(),
    );
    expect(conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'incompatible-location', day: 1, placeId: 'skytree', severity: 'error' }),
    ]));
  });

  /** The message is what a traveller reads and what the repair pass acts on. */
  it('explains which place, which city and which day', () => {
    const [conflict] = validateItineraryProposal(
      [dayWith(1, '2026-08-11', [item('skytree', 'Skytree', '10:00', '11:00')])],
      withTokyo(),
    ).filter((entry) => entry.code === 'incompatible-location');
    expect(conflict.message).toContain('Skytree');
    expect(conflict.message).toContain('Tokyo');
    expect(conflict.message).toContain('Osaka');
    expect(conflict.message).toContain('Day 1');
  });

  it('refuses it from a Kyoto base too — no base is privileged', () => {
    const conflicts = validateItineraryProposal(
      [dayWith(5, '2026-08-15', [item('skytree', 'Skytree', '10:00', '11:00')])],
      withTokyo(),
    );
    expect(conflicts.some((entry) => entry.code === 'incompatible-location' && entry.placeId === 'skytree')).toBe(true);
  });

  it('surfaces the conflict through the whole engine, not just the validator', async () => {
    const proposal = await run(withTokyo(), {
      days: [{ day: 1, placeIds: ['skytree'] }, { day: 2, placeIds: [] }, { day: 5, placeIds: [] }],
    });
    expect(proposal.conflicts.some((entry) => entry.code === 'incompatible-location')).toBe(true);
    expect(proposal.status).toBe('needs-review');
  });
});

describe('day trips are not relocations, and must keep working', () => {
  it('accepts a Kyoto place on a day based in Osaka', () => {
    const conflicts = validateItineraryProposal(
      [dayWith(1, '2026-08-11', [item('fushimi', 'Fushimi Inari', '10:00', '11:00')])],
      kansai(),
    );
    expect(conflicts.some((entry) => entry.code === 'incompatible-location')).toBe(false);
  });

  it('accepts a Nara day trip from an Osaka base', () => {
    const conflicts = validateItineraryProposal(
      [dayWith(2, '2026-08-12', [item('todaiji', 'Todai-ji', '10:00', '11:00')])],
      kansai(),
    );
    expect(conflicts.some((entry) => entry.code === 'incompatible-location')).toBe(false);
  });

  /**
   * Osaka and Kyoto are about 37 km apart, so the relationship is symmetric:
   * a traveller based in Kyoto can spend a day in Osaka just as easily. The
   * rule is reachability, not "the place's city must equal the day's city" —
   * which is why this is allowed even though it looks like the misplacement
   * the guard was built for.
   */
  it('accepts an Osaka place on a Kyoto-based day, because Osaka is a day trip from Kyoto', () => {
    const conflicts = validateItineraryProposal(
      [dayWith(5, '2026-08-15', [item('dotonbori', 'Dotonbori', '10:00', '11:00')])],
      kansai(),
    );
    expect(conflicts.some((entry) => entry.code === 'incompatible-location')).toBe(false);
  });

  /**
   * A transfer day carries two cities in its windows: the traveller really is
   * in both. Neither may be reported as a misplacement.
   */
  it('accepts both cities on a transfer day', () => {
    const source = kansai({
      days: [{
        day: 4, date: '2026-08-14', stayCity: 'Osaka', activityCities: [], city: 'Osaka', startTime: '09:00', endTime: '21:00',
        maxMainActivities: 3, fixedPlaceIds: [],
        windows: [
          { startTime: '09:00', endTime: '12:00', city: 'Osaka' },
          { startTime: '15:00', endTime: '21:00', city: 'Kyoto' },
        ],
      }],
    });
    const conflicts = validateItineraryProposal([dayWith(4, '2026-08-14', [
      item('dotonbori', 'Dotonbori', '10:00', '11:00'),
      item('fushimi', 'Fushimi Inari', '16:00', '17:00'),
    ])], source);
    expect(conflicts.some((entry) => entry.code === 'incompatible-location')).toBe(false);
  });
});

/**
 * The rule, stated as the traveller's own scenarios.
 *
 * These exist to be hard to "fix" by accident. The obvious-looking correction
 * to this guard is to make it strict — a place's city must equal the day's
 * city — and that change would pass a suite testing only the refusals while
 * silently deleting every day trip in a Kansai itinerary. Each case below
 * names the trip it protects, so anyone tightening the rule has to delete a
 * sentence describing a real holiday before the build goes green.
 */
describe('acceptance: which cities a base may reach', () => {
  const base = (city: string, places: PlanningPlace[]) => kansai({
    cities: [...new Set(places.map((entry) => entry.city))],
    days: [{
      day: 1, date: '2026-08-11', stayCity: city, activityCities: [], city, startTime: '09:00', endTime: '21:00',
      maxMainActivities: 3, fixedPlaceIds: [],
    }],
    places,
  });

  const verdictFor = (dayCity: string, target: PlanningPlace, places: PlanningPlace[]) =>
    validateItineraryProposal(
      [dayWith(1, '2026-08-11', [item(target.id, target.name, '10:00', '11:00')], dayCity)],
      base(dayCity, places),
    ).some((entry) => entry.code === 'incompatible-location') ? 'rejected' : 'allowed';

  /** Test 1 — an Osaka base, the standard Kansai hub. */
  it('Osaka base: allows Kyoto, Nara and Kobe; refuses Tokyo and Hiroshima', () => {
    const kyoto = place('fushimi', 'Kyoto');
    const nara = place('todaiji', 'Nara');
    const kobe = place('ikuta', 'Kobe');
    const tokyo = place('skytree', 'Tokyo');
    const hiroshima = place('miyajima', 'Hiroshima');
    const all = [place('dotonbori', 'Osaka'), kyoto, nara, kobe, tokyo, hiroshima];

    expect(verdictFor('Osaka', kyoto, all)).toBe('allowed');
    expect(verdictFor('Osaka', nara, all)).toBe('allowed');
    expect(verdictFor('Osaka', kobe, all)).toBe('allowed');
    expect(verdictFor('Osaka', tokyo, all)).toBe('rejected');
    expect(verdictFor('Osaka', hiroshima, all)).toBe('rejected');
  });

  /** Test 2 — a Kyoto base. The relationship is symmetric, not hub-and-spoke. */
  it('Kyoto base: allows an Osaka day trip; refuses Tokyo', () => {
    const osaka = place('dotonbori', 'Osaka');
    const tokyo = place('skytree', 'Tokyo');
    const all = [place('fushimi', 'Kyoto'), osaka, tokyo];

    expect(verdictFor('Kyoto', osaka, all)).toBe('allowed');
    expect(verdictFor('Kyoto', tokyo, all)).toBe('rejected');
  });

  /**
   * Test 3 — the exact case that prompted this work, and the one most likely
   * to be "corrected" later. Four nights in a Kyoto hotel with a day out in
   * Osaka is an ordinary holiday, not a planner defect.
   */
  it('Kyoto stay, Dotonbori in Osaka: allowed, because a day trip is not a relocation', () => {
    const dotonbori = place('dotonbori', 'Osaka');
    const all = [place('fushimi', 'Kyoto'), dotonbori];
    expect(verdictFor('Kyoto', dotonbori, all)).toBe('allowed');
  });
});

describe('the deterministic fallback obeys the same rule', () => {
  /**
   * This is where it used to go wrong without any model involved: the last
   * resort was "any day with room at all", so a full Osaka schedule pushed
   * Osaka places onto Kyoto days.
   */
  it('leaves a place unscheduled rather than putting it in an unreachable city', () => {
    const source = kansai({
      cities: ['Osaka', 'Tokyo'],
      days: [
        { day: 1, date: '2026-08-11', stayCity: 'Osaka', activityCities: [], city: 'Osaka', startTime: '09:00', endTime: '21:00', maxMainActivities: 1, fixedPlaceIds: [] },
        { day: 2, date: '2026-08-12', stayCity: 'Tokyo', activityCities: [], city: 'Tokyo', startTime: '09:00', endTime: '21:00', maxMainActivities: 3, fixedPlaceIds: [] },
      ],
      // A Tokyo place has to exist for Tokyo to have a location at all; see
      // the "city nobody shortlisted" case below for what happens when it does not.
      places: [place('dotonbori', 'Osaka'), place('namba', 'Osaka'), place('skytree', 'Tokyo')],
    });
    const composition = defaultComposition(source);
    const tokyoDay = composition.days.find((entry) => entry.day === 2)!;
    // Only the Tokyo place belongs on the Tokyo day. The spare Osaka stop is
    // left unplaced rather than flown across the country to fill a gap.
    expect(tokyoDay.placeIds).toEqual(['skytree']);
    expect(composition.days.find((entry) => entry.day === 1)!.placeIds).toHaveLength(1);
    expect(composition.days.flatMap((entry) => entry.placeIds)).not.toContain('namba');
  });

  /**
   * The documented cost of deriving city locations from the places themselves:
   * a day based in a city nobody shortlisted has no coordinates to judge, so
   * the guard cannot rule on it and allows it. That is the same outcome as
   * before this guard existed — it never makes anything worse — but it is a
   * real limit and is asserted rather than left to be discovered.
   */
  it('allows what it cannot locate, when a day’s city has no shortlisted places', () => {
    const source = kansai({
      cities: ['Osaka', 'Sapporo'],
      days: [
        { day: 1, date: '2026-08-11', stayCity: 'Osaka', activityCities: [], city: 'Osaka', startTime: '09:00', endTime: '21:00', maxMainActivities: 1, fixedPlaceIds: [] },
        { day: 2, date: '2026-08-12', stayCity: 'Sapporo', activityCities: [], city: 'Sapporo', startTime: '09:00', endTime: '21:00', maxMainActivities: 3, fixedPlaceIds: [] },
      ],
      places: [place('dotonbori', 'Osaka'), place('namba', 'Osaka')],
    });
    expect(defaultComposition(source).days.flatMap((entry) => entry.placeIds)).toHaveLength(2);
  });

  it('still uses a reachable day when the place’s own city is full', () => {
    const source = kansai({
      days: [
        { day: 1, date: '2026-08-11', stayCity: 'Osaka', activityCities: [], city: 'Osaka', startTime: '09:00', endTime: '21:00', maxMainActivities: 1, fixedPlaceIds: [] },
        { day: 5, date: '2026-08-15', stayCity: 'Kyoto', activityCities: [], city: 'Kyoto', startTime: '09:00', endTime: '21:00', maxMainActivities: 3, fixedPlaceIds: [] },
      ],
      places: [place('dotonbori', 'Osaka'), place('namba', 'Osaka')],
    });
    const composition = defaultComposition(source);
    const placed = composition.days.flatMap((entry) => entry.placeIds);
    // Kyoto is a day trip from Osaka, so the overflow is allowed to land there.
    expect(placed).toHaveLength(2);
  });
});
