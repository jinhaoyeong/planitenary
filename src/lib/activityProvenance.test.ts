/**
 * Who wrote an activity, and what a rebuild is therefore allowed to do to it.
 *
 * The defect these cover: the sanitiser answered "unknown" with `manual`, which
 * told the planner every pre-provenance row was the traveller's own work. Old
 * discovered places became permanent, and the traveller appeared to have typed
 * in results they never touched.
 */
import { describe, expect, it } from 'vitest';
import type { Activity, Itinerary } from '../data';
import { emptyItinerary, sanitizeActivity, sanitizeItinerary } from './itinerarySanitize';
import { OSAKA_PLACE_FIXTURE } from './destinationFixtures';
import { buildDestinationItinerary, rankDestinationCandidates } from './destinationPlanner';
import { reviewCandidatesForItinerary } from './decisionTarget';
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
    stayCity: 'Osaka',
    activityCities: [],
    city: 'Osaka',
    title: `Day ${index + 1}`,
    activities: [],
  })),
});

/** A trip as it comes back from storage: every row through the sanitiser. */
const loadedWith = (rows: unknown[]): Itinerary => sanitizeItinerary(
  { ...itinerary(), days: itinerary().days.map((day, index) => (index === 0 ? { ...day, activities: rows } : day)) },
  { ...emptyItinerary, id: 'osaka-11-day' },
);

const replan = (current: Itinerary, count: number): Itinerary => {
  const ranked = rankDestinationCandidates(
    reviewCandidatesForItinerary(OSAKA_PLACE_FIXTURE.slice(0, count), current, { city: 'Osaka' }),
    profile(),
  );
  const decisions = Object.fromEntries(ranked.map(({ candidate }) => [candidate.id, 'interested' as const]));
  return { ...current, days: buildDestinationItinerary(current, profile(), ranked, decisions).days };
};

const named = (trip: Itinerary, name: string) =>
  trip.days.flatMap((day) => day.activities).filter((activity) => activity.name === name);

const LEGACY_ROW = {
  id: 'discovered-wikivoyage-Old%20Museum',
  kind: 'place',
  time: '10:00',
  durationMinutes: 90,
  name: 'Old Museum',
  description: 'Written by a planner that predates provenance',
  type: 'sight',
  // No `source`. This is what the production evidence trips actually hold.
};

describe('unknown provenance is recorded as unknown', () => {
  it('never claims the traveller wrote a row whose author cannot be established', () => {
    const activity = sanitizeActivity(LEGACY_ROW, { time: '09:00', name: 'x', description: '', type: 'other' }, 0, 'trip');
    expect(activity.source).toBe('legacy-unknown');
    expect(activity.source).not.toBe('manual');
  });

  it('keeps a real authorship claim exactly as it was made', () => {
    const cases: Array<[unknown, Activity['source']]> = [
      [{ ...LEGACY_ROW, source: 'manual' }, 'manual'],
      [{ ...LEGACY_ROW, source: 'generated' }, 'generated'],
      [{ ...LEGACY_ROW, source: 'imported' }, 'imported'],
    ];
    for (const [row, expected] of cases) {
      const activity = sanitizeActivity(row, { time: '09:00', name: 'x', description: '', type: 'other' }, 0, 'trip');
      expect(activity.source).toBe(expected);
    }
  });

  it('treats an unreadable source as unknown rather than as authorship', () => {
    const activity = sanitizeActivity(
      { ...LEGACY_ROW, source: 'not-a-source' },
      { time: '09:00', name: 'x', description: '', type: 'other' },
      0,
      'trip',
    );
    expect(activity.source).toBe('legacy-unknown');
  });
});

describe('what a rebuild may replace', () => {
  it('preserves an unknown-provenance row rather than risk deleting the traveller’s work', () => {
    const next = replan(loadedWith([LEGACY_ROW]), 3);
    expect(named(next, 'Old Museum')).toHaveLength(1);
  });

  it('preserves the traveller’s own activity', () => {
    const next = replan(loadedWith([{ ...LEGACY_ROW, name: 'Grand Palace Test', source: 'manual' }]), 3);
    expect(named(next, 'Grand Palace Test')).toHaveLength(1);
  });

  it('replaces the planner’s own previous output', () => {
    const next = replan(loadedWith([{ ...LEGACY_ROW, name: 'Stale Generated Place', source: 'generated' }]), 3);
    expect(named(next, 'Stale Generated Place')).toHaveLength(0);
  });

  it('preserves a generated place the traveller locked', () => {
    const next = replan(loadedWith([{ ...LEGACY_ROW, name: 'Kept On Purpose', source: 'generated', locked: true }]), 3);
    expect(named(next, 'Kept On Purpose')).toHaveLength(1);
  });

  it('does not multiply an unknown-provenance row across repeated replans', () => {
    let next = loadedWith([LEGACY_ROW]);
    const counts: number[] = [];
    for (let round = 0; round < 4; round += 1) {
      next = replan(next, 3);
      counts.push(next.days.flatMap((day) => day.activities).length);
      expect(named(next, 'Old Museum')).toHaveLength(1);
    }
    // Replanning is idempotent: the generated layer is rebuilt, not accumulated.
    expect(new Set(counts).size).toBe(1);
  });
});
