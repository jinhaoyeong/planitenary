import { describe, expect, it } from 'vitest';
import type { Itinerary } from '../data';
import { removeActivityFromDay } from './activityMutations';

const itinerary: Itinerary = {
  id: 'trip-bangkok',
  name: 'Bangkok',
  cities: ['Bangkok'],
  description: '',
  days: [{
    day: 1,
    date: 'Apr 2',
    stayCity: 'Bangkok',
    activityCities: [],
    city: 'Bangkok',
    title: 'Day one',
    activities: [
      { id: 'manual-a', time: '09:00', name: 'Grand Palace Test', description: '', type: 'sight', source: 'manual' },
      { id: 'manual-b', time: '11:00', name: 'Lunch', description: '', type: 'food', source: 'manual' },
    ],
  }],
};

describe('explicit activity deletion', () => {
  it('removes only the activity the traveller approved', () => {
    const next = removeActivityFromDay(itinerary, 1, 0);
    expect(next.days[0].activities.map((activity) => activity.id)).toEqual(['manual-b']);
  });

  it('does nothing when the target no longer exists', () => {
    expect(removeActivityFromDay(itinerary, 1, 99)).toBe(itinerary);
  });
});
