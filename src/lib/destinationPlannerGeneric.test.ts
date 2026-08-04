/**
 * Integration cover for the claim that matters most: the planner is no longer
 * Osaka-shaped. A city with no fixture, no knowledge pack and no theme table
 * must flow through exactly the same pipeline.
 */
import { describe, expect, it } from 'vitest';
import type { Itinerary } from '../data';
import type { PlaceCandidate } from './destinationIntelligence';
import { buildDestinationItinerary, defaultDiscoveryDecisions, rankDestinationCandidates } from './destinationPlanner';
import { createEmptyProfile, manualDestination, type TripMood, type TripProfile } from './tripProfile';
import { deriveTravelBehaviour } from './travelBehaviour';

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
