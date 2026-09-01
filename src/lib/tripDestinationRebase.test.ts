/**
 * Converting a trip to a single destination.
 *
 * The header, the profile and the day cards are three views of one fact, and a
 * production trip was found holding two of them: profile and title said Tokyo
 * while every stored day said Osaka. The first fix rebased only when the new
 * city had never appeared on the route, which missed the commonest case —
 * removing Kyoto from an Osaka + Kyoto trip left days still based in Kyoto.
 */
import { describe, expect, it } from 'vitest';
import type { Activity, Itinerary } from '../data';
import { emptyItinerary } from './itinerarySanitize';
import { syncDurationDependentFields } from './trips';
import { createEmptyProfile, manualDestination, type TripProfile } from './tripProfile';

const japan = (cities: string[]): TripProfile => ({
  ...createEmptyProfile('MYR'),
  destinations: cities.map((city) => manualDestination(city, 'Japan')),
  startDate: '2026-10-01',
  endDate: '2026-10-04',
  dayCount: 4,
});

const activity = (name: string): Activity => ({
  id: `activity-${name}`,
  kind: 'place',
  name,
  time: '10:00',
  description: '',
  type: 'sight',
  source: 'manual',
});

const tripOf = (profile: TripProfile, days: Array<{ city: string; title: string; activities?: Activity[] }>): Itinerary => ({
  ...emptyItinerary,
  id: 'trip-jp',
  cities: [...new Set(days.map((day) => day.city))],
  tripProfile: profile,
  days: days.map((day, index) => ({
    day: index + 1,
    date: `Oct ${index + 1}`,
    stayCity: day.city,
    activityCities: [],
    city: day.city,
    title: day.title,
    activities: day.activities ?? [],
  })),
});

const osakaAndKyoto = () => tripOf(japan(['Osaka', 'Kyoto']), [
  { city: 'Osaka', title: 'Arrive in Osaka' },
  { city: 'Osaka', title: 'Day 2 in Osaka', activities: [activity('Dotonbori')] },
  { city: 'Kyoto', title: 'Day 3 in Kyoto', activities: [activity('Fushimi Inari')] },
  { city: 'Kyoto', title: 'Last morning in Kyoto' },
]);

describe('converting a multi-city trip to one destination', () => {
  it('rebases every day when Kyoto is removed, even though Osaka was already on the route', () => {
    const saved = syncDurationDependentFields(osakaAndKyoto(), japan(['Osaka']));

    expect(saved.cities).toEqual(['Osaka']);
    expect(saved.days.map((day) => day.stayCity)).toEqual(['Osaka', 'Osaka', 'Osaka', 'Osaka']);
    expect(saved.days.every((day) => day.city === day.stayCity)).toBe(true);
    expect(saved.days.some((day) => day.title.includes('Kyoto'))).toBe(false);
  });

  it('rebases to Kyoto just as readily when Osaka is the city removed', () => {
    const saved = syncDurationDependentFields(osakaAndKyoto(), japan(['Kyoto']));

    expect(saved.cities).toEqual(['Kyoto']);
    expect(saved.days.map((day) => day.stayCity)).toEqual(['Kyoto', 'Kyoto', 'Kyoto', 'Kyoto']);
    expect(saved.days.some((day) => day.title.includes('Osaka'))).toBe(false);
  });

  it('rebases a single-city trip moved to a city it has never been in', () => {
    const osaka = tripOf(japan(['Osaka']), [
      { city: 'Osaka', title: 'Arrive in Osaka' },
      { city: 'Osaka', title: 'Day 2 in Osaka' },
      { city: 'Osaka', title: 'Day 3 in Osaka' },
      { city: 'Osaka', title: 'Last morning in Osaka' },
    ]);
    const saved = syncDurationDependentFields(osaka, japan(['Tokyo']));

    expect(saved.days.every((day) => day.stayCity === 'Tokyo')).toBe(true);
    expect(saved.days[0].title).toBe('Arrive in Tokyo');
    expect(saved.days[3].title).toBe('Last morning in Tokyo');
  });

  it('keeps every activity through the rebase', () => {
    const saved = syncDurationDependentFields(osakaAndKyoto(), japan(['Osaka']));
    const names = saved.days.flatMap((day) => day.activities).map((entry) => entry.name);
    expect(names).toEqual(['Dotonbori', 'Fushimi Inari']);
  });
});

describe('writes that are not a destination change', () => {
  it('does not rewrite anything when the destination is unchanged', () => {
    const before = osakaAndKyoto();
    const saved = syncDurationDependentFields(before, japan(['Osaka', 'Kyoto']));
    expect(saved.days.map((day) => day.stayCity)).toEqual(['Osaka', 'Osaka', 'Kyoto', 'Kyoto']);
    expect(saved.days.map((day) => day.title)).toEqual(before.days.map((day) => day.title));
  });

  it('does not rewrite a single-city trip re-saved with the same city', () => {
    const tokyo = tripOf(japan(['Tokyo']), [
      { city: 'Tokyo', title: 'Arrive in Tokyo' },
      { city: 'Tokyo', title: 'Grandma’s birthday' },
      { city: 'Tokyo', title: 'Day 3 in Tokyo' },
      { city: 'Tokyo', title: 'Last morning in Tokyo' },
    ]);
    const saved = syncDurationDependentFields(tokyo, japan(['Tokyo']));
    expect(saved.days.map((day) => day.title)).toEqual(tokyo.days.map((day) => day.title));
  });

  it('does not flatten a multi-city trip into one city when it stays multi-city', () => {
    const saved = syncDurationDependentFields(osakaAndKyoto(), japan(['Osaka', 'Nara', 'Kyoto']));
    expect(saved.days.map((day) => day.stayCity)).toEqual(['Osaka', 'Osaka', 'Kyoto', 'Kyoto']);
  });

  it('leaves repeated stays alone: Osaka → Kyoto → Osaka keeps its shape', () => {
    const repeated = tripOf(japan(['Osaka', 'Kyoto']), [
      { city: 'Osaka', title: 'Arrive in Osaka' },
      { city: 'Kyoto', title: 'Day 2 in Kyoto' },
      { city: 'Osaka', title: 'Day 3 in Osaka' },
      { city: 'Osaka', title: 'Last morning in Osaka' },
    ]);
    const saved = syncDurationDependentFields(repeated, japan(['Osaka', 'Kyoto']));
    expect(saved.days.map((day) => day.stayCity)).toEqual(['Osaka', 'Kyoto', 'Osaka', 'Osaka']);
  });
});

describe('day titles the traveller wrote', () => {
  it('keeps a named empty day through a destination change', () => {
    const trip = tripOf(japan(['Osaka']), [
      { city: 'Osaka', title: 'Arrive in Osaka' },
      { city: 'Osaka', title: 'Grandma’s birthday' },
      { city: 'Osaka', title: 'Day 3 in Osaka' },
      { city: 'Osaka', title: 'Last morning in Osaka' },
    ]);
    const saved = syncDurationDependentFields(trip, japan(['Tokyo']));

    // Emptiness is not evidence the title was generated.
    expect(saved.days[1].activities).toEqual([]);
    expect(saved.days[1].title).toBe('Grandma’s birthday');
    expect(saved.days[1].stayCity).toBe('Tokyo');
    // The generated ones around it are refreshed.
    expect(saved.days[0].title).toBe('Arrive in Tokyo');
    expect(saved.days[2].title).toBe('Day 3 in Tokyo');
  });

  it('refreshes a generated title on a day that has activities', () => {
    const trip = tripOf(japan(['Osaka']), [
      { city: 'Osaka', title: 'Arrive in Osaka' },
      { city: 'Osaka', title: 'Day 2 in Osaka', activities: [activity('Dotonbori')] },
      { city: 'Osaka', title: 'Day 3 in Osaka' },
      { city: 'Osaka', title: 'Last morning in Osaka' },
    ]);
    const saved = syncDurationDependentFields(trip, japan(['Tokyo']));
    expect(saved.days[1].title).toBe('Day 2 in Tokyo');
    expect(saved.days[1].activities.map((entry) => entry.name)).toEqual(['Dotonbori']);
  });
});
