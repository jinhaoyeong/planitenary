import { describe, expect, it } from 'vitest';
import {
  ARRIVAL_SETTLING_MINUTES,
  DEPARTURE_LEAD_MINUTES,
  bookingConflicts,
  bookingDayShape,
  checkoutShapeForDay,
  committedBookingMutations,
  committedBookingsForDay,
  preserveCommittedBookings,
} from './bookingConstraints';
import type { TravelBooking } from './travelBooking';

const TRIP_START = '2027-01-21';
const DAY_COUNT = 11;

const booking = (overrides: Partial<TravelBooking> & Pick<TravelBooking, 'id' | 'type' | 'startDate'>): TravelBooking => ({
  status: 'confirmed',
  title: 'Booking',
  ...overrides,
} as TravelBooking);

const departingFlight = booking({
  id: 'flight-out',
  type: 'flight',
  title: 'AK 68',
  status: 'confirmed',
  startDate: '2027-01-31',
  startTime: '10:55',
  origin: 'KIX',
  destination: 'KUL',
});

const nightInNara = booking({
  id: 'stay-nara',
  type: 'stay',
  title: 'Nara Hotel',
  status: 'confirmed',
  startDate: '2027-01-29',
  startTime: '15:00',
  endDate: '2027-01-30',
  endTime: '10:00',
  city: 'Nara',
});

const todaiji = booking({
  id: 'ticket-todaiji',
  type: 'activity-ticket',
  title: 'Todai-ji',
  status: 'confirmed',
  startDate: '2027-01-29',
  startTime: '14:30',
  endTime: '15:30',
});

describe('constraints a confirmed booking puts on its day', () => {
  it('ends a departure day in time to leave for the airport, reusing the existing lead', () => {
    const shape = bookingDayShape([departingFlight]);
    // 10:55 minus the product-wide departure lead. Not a second copy of the
    // rule: the same constant the destination planner and the proposal engine
    // already share.
    expect(DEPARTURE_LEAD_MINUTES).toBe(210);
    expect(shape.returnTimeOverride).toBe('07:25');
    expect(shape.maxMainOverride).toBe(1);
    expect(shape.notes[0]).toContain('10:55 departure');
  });

  it('opens an arrival day only after the airport is cleared', () => {
    const arriving = booking({
      id: 'flight-in',
      type: 'flight',
      title: 'AK 67',
      startDate: '2027-01-21',
      endTime: '08:30',
    });
    expect(ARRIVAL_SETTLING_MINUTES).toBe(120);
    expect(bookingDayShape([arriving]).startTimeOverride).toBe('10:30');
  });

  it('records a fixed window for a timed ticket', () => {
    const shape = bookingDayShape([todaiji]);
    expect(shape.fixedWindows).toContainEqual({ startMinutes: 870, endMinutes: 930, label: 'Todai-ji' });
  });

  it('records a rail journey as the window it occupies', () => {
    const train = booking({
      id: 'rail-1',
      type: 'rail',
      title: 'JR Nara Line',
      startDate: '2027-01-29',
      startTime: '10:30',
      endTime: '11:15',
      origin: 'Kyoto',
      destination: 'Nara',
    });
    expect(bookingDayShape([train]).fixedWindows).toContainEqual({
      startMinutes: 630,
      endMinutes: 675,
      label: 'Kyoto → Nara',
    });
  });

  it('leaves a day with nothing booked exactly as it was', () => {
    const shape = bookingDayShape([]);
    expect(shape.startTimeOverride).toBeUndefined();
    expect(shape.returnTimeOverride).toBeUndefined();
    expect(shape.maxMainOverride).toBeUndefined();
    expect(shape.fixedWindows).toEqual([]);
  });

  it('ignores a booking the traveller has only sketched', () => {
    // `planned` is a note to self. Letting one narrow the day would mean an
    // idea typed at midnight silently shortened the sightseeing.
    const idea = { ...departingFlight, status: 'planned' as const };
    expect(committedBookingsForDay([idea], 11, TRIP_START, DAY_COUNT)).toEqual([]);
    expect(committedBookingsForDay([departingFlight], 11, TRIP_START, DAY_COUNT)).toHaveLength(1);
  });

  it('puts check-out on the day the stay ends, not the day it began', () => {
    expect(checkoutShapeForDay([nightInNara], 9, TRIP_START, DAY_COUNT).checkoutTime).toBeUndefined();
    const checkout = checkoutShapeForDay([nightInNara], 10, TRIP_START, DAY_COUNT);
    expect(checkout.checkoutTime).toBe('10:00');
    expect(checkout.note).toContain('Nara Hotel');
  });
});

describe('conflicts, computed rather than asked', () => {
  it('says when the day does not leave enough airport time', () => {
    const day = {
      day: 11,
      activities: [{ id: 'a1', name: 'Osaka Castle', time: '06:30', durationMinutes: 120 }],
    };
    const conflicts = bookingConflicts(day, [departingFlight], TRIP_START, DAY_COUNT);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].message).toBe(
      'Osaka Castle runs to 08:30, but a 10:55 departure means leaving by 07:25.',
    );
  });

  it('says when sightseeing overlaps a reservation', () => {
    const day = {
      day: 9,
      activities: [{ id: 'a1', name: 'Nara Park', time: '14:00', durationMinutes: 90 }],
    };
    const conflicts = bookingConflicts(day, [todaiji], TRIP_START, DAY_COUNT);
    expect(conflicts[0].message).toBe('Nara Park overlaps your 14:30 Todai-ji reservation.');
  });

  it('says when the plan runs past check-out', () => {
    const day = {
      day: 10,
      activities: [{ id: 'a1', name: 'Slow breakfast', time: '09:00', durationMinutes: 95 }],
    };
    const conflicts = bookingConflicts(day, [nightInNara], TRIP_START, DAY_COUNT);
    expect(conflicts[0].message).toContain('checks out at 10:00');
    expect(conflicts[0].message).toContain('ends at 10:35');
  });

  it('finds nothing to complain about in a day that fits', () => {
    const day = {
      day: 11,
      activities: [{ id: 'a1', name: 'Coffee', time: '05:30', durationMinutes: 45 }],
    };
    expect(bookingConflicts(day, [departingFlight], TRIP_START, DAY_COUNT)).toEqual([]);
  });
});

describe('what a plan revision may not do', () => {
  const before = [departingFlight, nightInNara];

  it('reports a silently moved flight', () => {
    const after = [{ ...departingFlight, startTime: '14:30' }, nightInNara];
    const mutations = committedBookingMutations(before, after);
    expect(mutations).toEqual([
      { bookingId: 'flight-out', field: 'startTime', before: '10:55', after: '14:30' },
    ]);
  });

  it('reports a silently removed hotel', () => {
    const mutations = committedBookingMutations(before, [departingFlight]);
    expect(mutations).toEqual([
      { bookingId: 'stay-nara', field: 'removed', before: 'Nara Hotel', after: undefined },
    ]);
  });

  it('reports changed dates', () => {
    const after = [departingFlight, { ...nightInNara, endDate: '2027-02-01' }];
    expect(committedBookingMutations(before, after)).toEqual([
      { bookingId: 'stay-nara', field: 'endDate', before: '2027-01-30', after: '2027-02-01' },
    ]);
  });

  it('says nothing when a revision left the bookings alone', () => {
    expect(committedBookingMutations(before, [...before])).toEqual([]);
  });

  it('restores what the traveller holds while keeping the rest of the revision', () => {
    const idea = booking({ id: 'idea', type: 'stay', title: 'Maybe Kyoto', status: 'planned', startDate: '2027-01-25' });
    const revision = [
      { ...departingFlight, startTime: '14:30' },
      { ...idea, title: 'Kyoto Granbell' },
    ];
    const restored = preserveCommittedBookings([...before, idea], revision);

    // The confirmed facts come back exactly as they were.
    expect(restored.find((entry) => entry.id === 'flight-out')?.startTime).toBe('10:55');
    expect(restored.find((entry) => entry.id === 'stay-nara')).toEqual(nightInNara);
    // The planner's edit to a merely planned record is kept.
    expect(restored.find((entry) => entry.id === 'idea')?.title).toBe('Kyoto Granbell');
    expect(committedBookingMutations([...before, idea], restored)).toEqual([]);
  });

  it('keeps a booking the revision legitimately added', () => {
    const added = booking({ id: 'new-rail', type: 'rail', title: 'Haruka', startDate: '2027-01-22' });
    const restored = preserveCommittedBookings(before, [...before, added]);
    expect(restored.map((entry) => entry.id)).toContain('new-rail');
    expect(restored).toHaveLength(3);
  });

  it('lets the traveller cancel their own booking without it counting as a mutation', () => {
    // Status is deliberately outside the owned fields: cancelling a hotel is an
    // edit the traveller is entitled to make.
    const after = [{ ...departingFlight, status: 'cancelled' as const }, nightInNara];
    expect(committedBookingMutations(before, after)).toEqual([]);
  });
});
