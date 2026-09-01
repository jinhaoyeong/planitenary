/**
 * Generation must not invent authorship either.
 *
 * The sanitizer stopped recording an unknown source as `manual`, but the
 * initial-itinerary generator kept its own `|| 'manual'` fallbacks. A row that
 * passed through generation came out claiming the traveller wrote it, which is
 * the same defect one layer up.
 */
import { describe, expect, it } from 'vitest';
import type { Activity, Itinerary } from '../data';
import { generateInitialItinerary } from './tripIntelligence';
import { createEmptyProfile, manualDestination, type TripProfile } from './tripProfile';

const profile: TripProfile = {
  ...createEmptyProfile(),
  destinations: [manualDestination('Osaka', 'Japan')],
  startDate: '2027-04-02',
  endDate: '2027-04-03',
  dayCount: 2,
};

/** A row from before `source` existed: no provenance, and none can be invented. */
const sourceless = (id: string, name: string): Activity => ({
  id,
  name,
  time: '09:00',
  durationMinutes: 60,
} as Activity);

const trip = (): Itinerary => ({
  id: 'trip-provenance',
  name: 'Osaka',
  cities: ['Osaka'],
  description: '',
  tripProfile: profile,
  days: [
    { day: 1, date: 'Apr 2', stayCity: 'Osaka', activityCities: [], city: 'Osaka', title: 'Day 1 in Osaka', activities: [sourceless('a1', 'Osaka Castle')] },
    { day: 2, date: 'Apr 3', stayCity: 'Osaka', activityCities: [], city: 'Osaka', title: 'Day 2 in Osaka', activities: [] },
  ],
  unassignedActivities: [sourceless('u1', 'Dotonbori')],
});

const sourcesOf = (activities: Activity[]) => activities
  .filter((activity) => activity.id === 'a1' || activity.id === 'u1')
  .map((activity) => activity.source);

describe('generateInitialItinerary provenance', () => {
  it('does not promote a sourceless day activity to manual', () => {
    const proposal = generateInitialItinerary(trip(), profile);
    const found = proposal.afterDays.flatMap((day) => sourcesOf(day.activities));

    expect(found.length).toBeGreaterThan(0);
    expect(found).not.toContain('manual');
    expect(new Set(found)).toEqual(new Set(['legacy-unknown']));
  });

  it('does not promote a sourceless inbox activity to manual when it is placed', () => {
    const proposal = generateInitialItinerary(trip(), profile);
    const inbox = proposal.afterDays.flatMap((day) => day.activities).find((activity) => activity.id === 'u1');

    expect(inbox?.source).toBe('legacy-unknown');
  });

  it('leaves an explicitly authored source alone', () => {
    const authored = trip();
    authored.days[0].activities = [{ ...sourceless('a1', 'Osaka Castle'), source: 'manual' } as Activity];

    const proposal = generateInitialItinerary(authored, profile);
    const kept = proposal.afterDays.flatMap((day) => day.activities).find((activity) => activity.id === 'a1');

    expect(kept?.source).toBe('manual');
  });
});
