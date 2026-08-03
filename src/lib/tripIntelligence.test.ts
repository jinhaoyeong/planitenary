import { describe, expect, it } from 'vitest';
import type { Activity, Itinerary } from '../data';
import { createEmptyProfile, manualDestination, type TripProfile } from './tripProfile';
import {
  applyItineraryProposal,
  generateInitialItinerary,
  optimiseDay,
  undoPlannerChange,
} from './tripIntelligence';

const profile = (): TripProfile => ({
  ...createEmptyProfile('MYR'),
  destinations: [manualDestination('Kyoto', 'Japan')],
  startDate: '2026-10-10',
  endDate: '2026-10-12',
  dayCount: 3,
  transport: ['walking'],
  styles: ['temples', 'cafes'],
  moods: ['slow-living'],
});

const activity = (overrides: Partial<Activity>): Activity => ({
  id: 'activity-default',
  time: '09:00',
  durationMinutes: 60,
  name: 'Place',
  description: '',
  type: 'sight',
  source: 'manual',
  bookingStatus: 'none',
  ...overrides,
});

const itinerary = (activities: Activity[]): Itinerary => ({
  id: 'trip-test',
  name: 'Kyoto',
  cities: ['Kyoto'],
  description: '',
  tripProfile: profile(),
  days: [
    { day: 1, date: 'Oct 10', city: 'Kyoto', title: 'Day 1', activities },
    { day: 2, date: 'Oct 11', city: 'Kyoto', title: 'Day 2', activities: [] },
    { day: 3, date: 'Oct 12', city: 'Kyoto', title: 'Day 3', activities: [] },
  ],
});

describe('trip intelligence', () => {
  it('builds a practical structure without inventing attractions', () => {
    const proposal = generateInitialItinerary(itinerary([]), profile());
    expect(proposal.afterDays[0].activities.map((item) => item.source)).toEqual(['generated', 'generated']);
    expect(proposal.afterDays[0].activities.map((item) => item.name)).toContain('Lunch near your base');
    expect(proposal.reason).toContain('unknown travel details');
  });

  it('orders coordinate-known places and includes travel estimates', () => {
    const current = itinerary([
      activity({ id: 'a', name: 'Far place', time: '13:00', coordinates: [35.02, 135.8] }),
      activity({ id: 'b', name: 'Near place', time: '09:00', coordinates: [35.01, 135.76] }),
    ]);
    const proposal = optimiseDay(current, profile(), 1);
    expect(proposal.afterDays[0].activities[0].id).toBe('b');
    expect(proposal.afterDays[0].activities[1].transportMinutes).toBeGreaterThan(0);
  });

  it('keeps locked activities protected in the proposal and apply path', () => {
    const current = itinerary([
      activity({ id: 'locked', name: 'Booked temple', time: '11:00', lockedFields: ['schedule'], coordinates: [35.02, 135.8] }),
      activity({ id: 'move', name: 'Flexible place', time: '09:00', coordinates: [35.01, 135.76] }),
    ]);
    const proposal = optimiseDay(current, profile(), 1);
    expect(proposal.changes.some((change) => change.activityId === 'locked' && change.protected)).toBe(true);
    const result = applyItineraryProposal(current, proposal);
    expect(result.itinerary.days[0].activities.find((item) => item.id === 'locked')?.time).toBe('11:00');
  });

  it('supports selective apply and undo without affecting other days', () => {
    const current = itinerary([
      activity({ id: 'a', name: 'Flexible place', time: '09:00', coordinates: [35.02, 135.8] }),
      activity({ id: 'b', name: 'Second place', time: '13:00', coordinates: [35.01, 135.76] }),
    ]);
    const proposal = optimiseDay(current, profile(), 1);
    const firstChange = proposal.changes.find((change) => !change.protected);
    expect(firstChange).toBeDefined();
    const result = applyItineraryProposal(current, proposal, firstChange ? [firstChange.id] : []);
    expect(result.history.affectedDayNumbers).toEqual([1]);
    const undone = undoPlannerChange(result.itinerary, result.history.id);
    expect(undone.days[0].activities[0].time).toBe('09:00');
    expect(undone.days[1].activities).toEqual([]);

    const manuallyEdited = { ...result.itinerary, days: result.itinerary.days.map((day) => day.day === 1 ? { ...day, title: 'My edited day' } : day) };
    expect(undoPlannerChange(manuallyEdited, result.history.id).days[0].title).toBe('My edited day');
  });
});
