import { describe, expect, it } from 'vitest';
import type { Activity, Itinerary } from '../data';
import { createEmptyProfile, manualDestination, type TripProfile } from './tripProfile';
import {
  applyItineraryProposal,
  generateInitialItinerary,
  optimiseDay,
  optimiseTrip,
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
  it('leaves empty days empty instead of inventing attraction-like placeholders', () => {
    const proposal = generateInitialItinerary(itinerary([]), profile());
    expect(proposal.afterDays.every((day) => day.activities.length === 0)).toBe(true);
    expect(proposal.changes).toEqual([]);
    expect(proposal.confidence).toBe('low');
    expect(proposal.coverage.coordinates).toBe(0);
    expect(proposal.reason).toContain('confirmed places');
  });

  it('orders coordinate-known places and includes travel estimates', () => {
    const current = itinerary([
      activity({ id: 'a', name: 'Far place', time: '13:00', coordinates: [35.02, 135.8] }),
      activity({ id: 'b', name: 'Near place', time: '09:00', coordinates: [35.01, 135.76] }),
    ]);
    const tripProfile = profile();
    const proposal = optimiseDay(current, tripProfile, 1);
    expect(proposal.afterDays[0].activities[0].id).toBe('b');
    expect(proposal.afterDays[0].activities[1].transportMinutes).toBeGreaterThan(0);
  });

  it('keeps locked activities protected in the proposal and apply path', () => {
    const current = itinerary([
      activity({ id: 'locked', name: 'Booked temple', time: '11:00', lockedFields: ['schedule'], coordinates: [35.02, 135.8] }),
      activity({ id: 'move', name: 'Flexible place', time: '09:00', coordinates: [35.01, 135.76] }),
    ]);
    const tripProfile = profile();
    const proposal = optimiseDay(current, tripProfile, 1);
    const result = applyItineraryProposal(current, tripProfile, proposal);
    expect(result.itinerary.days[0].activities.find((item) => item.id === 'locked')?.time).toBe('11:00');
  });

  it('supports selective apply and undo without affecting other days', () => {
    const current = itinerary([
      activity({ id: 'a', name: 'Flexible place', time: '09:00', coordinates: [35.02, 135.8] }),
      activity({ id: 'b', name: 'Second place', time: '13:00', coordinates: [35.01, 135.76] }),
    ]);
    const tripProfile = profile();
    const proposal = optimiseDay(current, tripProfile, 1);
    const firstChange = proposal.changes.find((change) => !change.protected);
    expect(firstChange).toBeDefined();
    const result = applyItineraryProposal(current, tripProfile, proposal, firstChange ? [firstChange.id] : []);
    expect(result.history!.affectedDayNumbers).toEqual([1]);
    const undone = undoPlannerChange(result.itinerary, result.history!.id);
    expect(undone.days[0].activities[0].time).toBe('09:00');
    expect(undone.days[1].activities).toEqual([]);

    const manuallyEdited = { ...result.itinerary, days: result.itinerary.days.map((day) => day.day === 1 ? { ...day, title: 'My edited day' } : day) };
    expect(undoPlannerChange(manuallyEdited, result.history!.id).days[0].title).toBe('My edited day');
  });

  it('assigns inbox activities across days and clears only the applied inbox entries', () => {
    const current = { ...itinerary([]), unassignedActivities: [
      activity({ id: 'inbox-a', name: 'Confirmed temple' }),
      activity({ id: 'inbox-b', name: 'Confirmed market' }),
    ] };
    const tripProfile = profile();
    const proposal = generateInitialItinerary(current, tripProfile);
    expect(proposal.afterDays.some((day) => day.activities.some((item) => item.id === 'inbox-a'))).toBe(true);
    const result = applyItineraryProposal(current, tripProfile, proposal);
    expect(result.itinerary.unassignedActivities).toEqual([]);
    expect(result.itinerary.days.flatMap((day) => day.activities).map((item) => item.id)).toEqual(expect.arrayContaining(['inbox-a', 'inbox-b']));
  });

  it('rejects a proposal when the itinerary revision changes after preview', () => {
    const current = { ...itinerary([activity({ id: 'a', coordinates: [35.02, 135.8] }), activity({ id: 'b', coordinates: [35.01, 135.76] })]), revision: 4 };
    const tripProfile = profile();
    const proposal = optimiseDay(current, tripProfile, 1);
    const changed = { ...current, revision: 5 };
    const result = applyItineraryProposal(changed, tripProfile, proposal);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('itinerary-changed');
  });

  it('applies an individually selected move instead of only applying time fields', () => {
    const current = itinerary([
      activity({ id: 'far', name: 'Far place', time: '13:00', coordinates: [35.02, 135.8] }),
      activity({ id: 'near', name: 'Near place', time: '09:00', coordinates: [35.01, 135.76] }),
    ]);
    const tripProfile = profile();
    const proposal = optimiseDay(current, tripProfile, 1);
    const move = proposal.changes.find((change) => change.kind === 'move' && change.activityId === 'near');
    expect(move).toBeDefined();
    const result = applyItineraryProposal(current, tripProfile, proposal, move ? [move.id] : []);
    expect(result.itinerary.days[0].activities[0].id).toBe('near');
  });

  it('places a selected generated insertion at its proposed position', () => {
    const current = itinerary([
      activity({ id: 'a', name: 'Morning place', time: '09:00' }),
      activity({ id: 'b', name: 'Afternoon place', time: '14:00' }),
      activity({ id: 'c', name: 'Evening place', time: '17:00' }),
    ]);
    const tripProfile = profile();
    const proposal = generateInitialItinerary(current, tripProfile);
    const insert = proposal.changes.find((change) => change.kind === 'insert');
    expect(insert).toBeDefined();
    const result = applyItineraryProposal(current, tripProfile, proposal, insert ? [insert.id] : []);
    const ids = result.itinerary.days[0].activities.map((item) => item.id);
    expect(ids.indexOf(insert?.activityId || '')).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(insert?.activityId || '')).toBeLessThan(ids.length - 1);
  });

  it('preserves unrelated lock fields when toggling schedule lock data', () => {
    const locked = activity({ id: 'locked', lockedFields: ['location', 'schedule'] });
    const remaining = locked.lockedFields?.filter((field) => field !== 'schedule');
    expect(remaining).toEqual(['location']);
  });

  it('moves unlocked activities between days while respecting daily capacity', () => {
    const constrained = { ...profile(), moods: [], destinations: [manualDestination('Kyoto', 'Japan')] };
    const current = {
      ...itinerary([
        activity({ id: 'a', name: 'A', coordinates: [35.01, 135.76] }),
        activity({ id: 'b', name: 'B', coordinates: [35.02, 135.77] }),
      ]),
      planningConstraints: { maxMainActivitiesPerDay: 1 },
    };
    const proposal = optimiseTrip(current, constrained);
    expect(proposal.afterDays[0].activities.filter((item) => item.type === 'sight')).toHaveLength(1);
    expect(proposal.afterDays[1].activities.some((item) => item.id === 'b')).toBe(true);
  });

  it('is repeatable for identical inputs and reports planning conflicts honestly', () => {
    const base = {
      ...itinerary([activity({ id: 'a', name: 'Museum', time: '19:00', durationMinutes: 120, lockedFields: ['schedule'], estimatedCost: { amount: 100, currency: 'JPY' }, openingHours: { opensAt: '09:00', closesAt: '18:00' } })]),
      planningConstraints: {
        preferredEndTime: '20:00',
        unavailableTimes: [{ start: '18:00', end: '19:30', reason: 'Dinner booking' }],
        maxBudgetAmount: 50,
        maxBudgetCurrency: 'JPY',
      },
      unassignedActivities: [activity({ id: 'usd', name: 'Imported ticket', estimatedCost: { amount: 20, currency: 'USD' } })],
    };
    const first = generateInitialItinerary(base, profile());
    const second = generateInitialItinerary(base, profile());
    expect(first.id).toBe(second.id);
    expect(first.afterDays).toEqual(second.afterDays);
    expect(first.warnings.some((warning) => warning.includes('opening hours'))).toBe(true);
    expect(first.warnings.some((warning) => warning.includes('budget'))).toBe(true);
    expect(first.warnings.some((warning) => warning.includes('currencies'))).toBe(true);
  });
});
