import { describe, expect, it } from 'vitest';
import type { Itinerary } from '../data';
import { OSAKA_PLACE_FIXTURE, ROME_PLACE_FIXTURE, SEOUL_PLACE_FIXTURE } from './destinationFixtures';
import { buildDestinationItinerary, rankDestinationCandidates } from './destinationPlanner';
import { createEmptyProfile, manualDestination, type TripProfile } from './tripProfile';

const profile = (): TripProfile => ({
  ...createEmptyProfile('MYR'),
  destinations: [manualDestination('Osaka', 'Japan')],
  startDate: '2026-10-01',
  endDate: '2026-10-11',
  dayCount: 11,
  styles: ['street-food', 'history', 'nightlife', 'architecture'],
  transport: ['public-transport'],
});

const itinerary = (): Itinerary => ({
  id: 'osaka-11-day',
  name: 'Osaka 2026',
  cities: ['Osaka'],
  description: '',
  days: Array.from({ length: 11 }, (_, index) => ({
    day: index + 1,
    date: `Oct ${index + 1}`,
    city: 'Osaka',
    title: `Day ${index + 1}`,
    activities: [],
  })),
});

describe('destination planner vertical slice', () => {
  it('ships at least 25 source-backed Osaka candidates with factual identity', () => {
    expect(OSAKA_PLACE_FIXTURE.length).toBeGreaterThanOrEqual(25);
    for (const candidate of OSAKA_PLACE_FIXTURE) {
      expect(candidate.providerPlaceId).toMatch(/^osaka-info:/);
      expect(candidate.coordinates).toHaveLength(2);
      expect(candidate.neighbourhood).toBeTruthy();
      expect(candidate.sourceReferences[0]?.url).toMatch(/^https:\/\//);
      expect(candidate.lastVerifiedAt).toBeTruthy();
    }
  });

  it('ranks candidates with inspectable score explanations', () => {
    const ranked = rankDestinationCandidates(OSAKA_PLACE_FIXTURE, profile());
    expect(ranked).toHaveLength(OSAKA_PLACE_FIXTURE.length);
    expect(ranked[0].score).toBeGreaterThan(60);
    expect(ranked[0].reasons).toHaveLength(3);
    expect(ranked[0].breakdown.dataCompleteness).toBeGreaterThan(0.5);
  });

  it('builds eleven distinct neighbourhood-led days without generic filler places', () => {
    const ranked = rankDestinationCandidates(OSAKA_PLACE_FIXTURE, profile());
    const decisions = Object.fromEntries(ranked.map(({ candidate }) => [candidate.id, 'interested' as const]));
    const result = buildDestinationItinerary(itinerary(), profile(), ranked, decisions);
    const daysWithPlaces = result.days.filter((day) => day.activities.some((activity) => activity.kind === 'place'));
    const scheduledPlaces = result.days.flatMap((day) => day.activities.filter((activity) => activity.kind === 'place'));
    const placeNames = scheduledPlaces.map((activity) => activity.name);

    expect(daysWithPlaces).toHaveLength(11);
    expect(new Set(daysWithPlaces.map((day) => day.title)).size).toBe(11);
    expect(scheduledPlaces.length).toBeGreaterThanOrEqual(24);
    expect(new Set(scheduledPlaces.map((activity) => activity.providerPlaceId)).size).toBe(scheduledPlaces.length);
    expect(placeNames).not.toContain('Lunch near your base');
    expect(placeNames).not.toContain('Café and rest');
    expect(result.routeMode).toBe('offline-straight-line');
  });

  it('preserves locked activities while building around them', () => {
    const current = itinerary();
    current.days[0].activities.push({
      id: 'locked-arrival',
      kind: 'reservation',
      time: '13:00',
      durationMinutes: 60,
      name: 'Hotel check-in',
      description: '',
      type: 'other',
      source: 'manual',
      lockedFields: ['schedule'],
    });
    const ranked = rankDestinationCandidates(OSAKA_PLACE_FIXTURE, profile());
    const decisions = Object.fromEntries(ranked.map(({ candidate }) => [candidate.id, 'interested' as const]));
    const result = buildDestinationItinerary(current, profile(), ranked, decisions);
    expect(result.days[0].activities.find((activity) => activity.id === 'locked-arrival')?.time).toBe('13:00');
  });

  it.each([
    ['Seoul', 'South Korea', SEOUL_PLACE_FIXTURE],
    ['Rome', 'Italy', ROME_PLACE_FIXTURE],
  ])('runs the same ranking and grouping pipeline for a shorter %s trip', (city, country, candidates) => {
    const otherProfile: TripProfile = {
      ...createEmptyProfile('MYR'),
      destinations: [manualDestination(city, country)],
      dayCount: 3,
      styles: ['history', 'architecture'],
      transport: ['public-transport'],
    };
    const otherItinerary: Itinerary = {
      id: `${city.toLowerCase()}-test`,
      name: city,
      cities: [city],
      description: '',
      days: Array.from({ length: 3 }, (_, index) => ({ day: index + 1, date: `Day ${index + 1}`, city, title: `Day ${index + 1}`, activities: [] })),
    };
    const ranked = rankDestinationCandidates(candidates, otherProfile);
    const decisions = Object.fromEntries(ranked.map(({ candidate }) => [candidate.id, 'interested' as const]));
    const result = buildDestinationItinerary(otherItinerary, otherProfile, ranked, decisions);
    expect(result.days.filter((day) => day.activities.some((activity) => activity.kind === 'place'))).toHaveLength(3);
    expect(result.scheduledCandidates.every((candidate) => candidate.city === city)).toBe(true);
  });
});
