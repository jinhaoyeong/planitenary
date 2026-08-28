/**
 * The seams where a booking meets a model Planitenary already had.
 *
 * Every test here is about authority rather than behaviour: which record owns
 * a fact, and what happens when two of them disagree. They exist because the
 * failure mode is silence — a second source of truth does not throw, it just
 * drifts.
 */
import { describe, expect, it } from 'vitest';
import type { Activity, Itinerary } from '../data';
import { emptyItinerary, sanitizeItinerary } from './itinerarySanitize';
import { bookingDayNumber, elapsedMinutes, hasComparableClocks, isTimeZone, type TravelBooking } from './travelBooking';
import { bookingDayShape, committedBookingsForDay, stayRouteConflicts } from './bookingConstraints';

const TRIP_START = '2027-01-21';

const booking = (overrides: Partial<TravelBooking> & Pick<TravelBooking, 'id' | 'type' | 'startDate'>): TravelBooking => ({
  status: 'confirmed',
  title: 'Booking',
  ...overrides,
} as TravelBooking);

describe('flight authority stays with the itinerary activity', () => {
  it('leaves the scheduling fields of a flight activity untouched by a booking', () => {
    // The Add Flight control writes `type: 'flight'` + `durationMinutes` onto a
    // day. That is what the proposal engine reads. A booking beside it must not
    // change any of it.
    const flightActivity: Activity = {
      id: 'act-flight',
      type: 'flight',
      kind: 'transport',
      time: '10:55',
      durationMinutes: 445,
      name: 'AK 68',
      description: '',
    };
    const trip: Itinerary = {
      ...emptyItinerary,
      id: 'trip-1',
      days: [{
        day: 1, date: 'Jan 21', stayCity: 'Osaka', city: 'Osaka', activityCities: [],
        title: 'Day 1', activities: [flightActivity],
      }],
      bookings: [booking({
        id: 'booking-flight', type: 'flight', title: 'AK 68', startDate: '2027-01-21',
        startTime: '10:55', reference: 'X7QK2M', cabin: 'Economy',
      })],
    };

    const saved = sanitizeItinerary(trip, { ...emptyItinerary, id: 'trip-1' });
    const savedFlight = saved.days[0].activities[0];
    expect(savedFlight.type).toBe('flight');
    expect(savedFlight.time).toBe('10:55');
    expect(savedFlight.durationMinutes).toBe(445);
    // The booking carries the commercial half only.
    expect(saved.bookings?.[0].reference).toBe('X7QK2M');
    expect(saved.bookings?.[0]).not.toHaveProperty('durationMinutes');
  });

  it('gives a booking no field the flight-aware readers look for', () => {
    // `listPersistedFlights` selects on `type === 'flight'` and then reads
    // `time` and `durationMinutes`. A booking has none of those names, so no
    // reader can pick one up by duck typing even if the two lists were ever
    // concatenated by mistake.
    const saved = sanitizeItinerary({
      ...emptyItinerary,
      id: 'trip-1',
      bookings: [booking({ id: 'b', type: 'flight', title: 'AK 68', startDate: '2027-01-21', startTime: '10:55' })],
    }, { ...emptyItinerary, id: 'trip-1' });

    const fields = Object.keys(saved.bookings![0]);
    expect(fields).not.toContain('durationMinutes');
    expect(fields).not.toContain('time');
    expect(fields).not.toContain('activities');
    expect(fields).toContain('startTime');
  });
});

describe('flight timezone semantics', () => {
  const overnight = booking({
    id: 'red-eye',
    type: 'flight',
    title: 'AK 12',
    startDate: '2027-01-21',
    startTime: '23:30',
    endDate: '2027-01-22',
    endTime: '07:10',
    origin: 'KUL',
    destination: 'KIX',
  });

  it('recognises a real zone and rejects a made-up one', () => {
    expect(isTimeZone('Asia/Kuala_Lumpur')).toBe(true);
    expect(isTimeZone('Asia/Tokyo')).toBe(true);
    expect(isTimeZone('Mars/Olympus')).toBe(false);
    expect(isTimeZone('')).toBe(false);
  });

  it('computes a real duration once both zones are known', () => {
    // KUL is UTC+8, KIX is UTC+9. 23:30 in KL is 15:30 UTC; 07:10 in Osaka is
    // 22:10 UTC. Six hours forty, not the seven forty the clocks suggest.
    const zoned = { ...overnight, originTimeZone: 'Asia/Kuala_Lumpur', destinationTimeZone: 'Asia/Tokyo' };
    expect(elapsedMinutes(zoned)).toBe(400);
  });

  it('gets the famous case right rather than an hour wrong', () => {
    // KIX 10:55 to KUL 17:20 is 7h25m. Naive subtraction says 6h25m.
    const kixKul = booking({
      id: 'ak68', type: 'flight', title: 'AK 68', startDate: '2027-01-31',
      startTime: '10:55', endTime: '17:20', endDate: '2027-01-31',
      originTimeZone: 'Asia/Tokyo', destinationTimeZone: 'Asia/Kuala_Lumpur',
    });
    expect(elapsedMinutes(kixKul)).toBe(445);
  });

  it('refuses to guess when the zones are missing', () => {
    // Silence is the correct answer. Being an hour wrong about a flight is
    // worse than declining to say.
    expect(elapsedMinutes(overnight)).toBeUndefined();
    expect(hasComparableClocks(overnight)).toBe(false);
  });

  it('refuses when only one side names a zone', () => {
    expect(elapsedMinutes({ ...overnight, originTimeZone: 'Asia/Kuala_Lumpur' })).toBeUndefined();
    expect(hasComparableClocks({ ...overnight, originTimeZone: 'Asia/Kuala_Lumpur' })).toBe(false);
  });

  it('still subtracts a same-day domestic hop with no zones at all', () => {
    const domestic = booking({
      id: 'hop', type: 'rail', title: 'Nozomi', startDate: '2027-01-21',
      startTime: '09:40', endTime: '11:05', endDate: '2027-01-21',
    });
    expect(elapsedMinutes(domestic)).toBe(85);
    expect(hasComparableClocks(domestic)).toBe(true);
  });

  it('handles a two-calendar-day crossing', () => {
    const laxHnd = booking({
      id: 'lax', type: 'flight', title: 'NH 105', startDate: '2027-01-21',
      startTime: '23:30', endDate: '2027-01-23', endTime: '04:30',
      originTimeZone: 'America/Los_Angeles', destinationTimeZone: 'Asia/Tokyo',
    });
    // 23:30 PST = 07:30 UTC on the 22nd; 04:30 JST on the 23rd = 19:30 UTC on
    // the 22nd. Twelve hours.
    expect(elapsedMinutes(laxHnd)).toBe(720);
  });

  it('does not derive an arrival-day start from a flight that lands on another date', () => {
    // The overnight case the four fields cannot describe: no start override is
    // invented from a landing time that belongs to a different day.
    expect(bookingDayShape([overnight]).startTimeOverride).toBeUndefined();
  });

  it('keeps a valid zone through a save and drops an invented one', () => {
    const trip = sanitizeItinerary({
      ...emptyItinerary,
      id: 'trip-1',
      bookings: [{ ...overnight, originTimeZone: 'Asia/Kuala_Lumpur', destinationTimeZone: 'Mars/Olympus' }],
    }, { ...emptyItinerary, id: 'trip-1' });
    expect(trip.bookings?.[0].originTimeZone).toBe('Asia/Kuala_Lumpur');
    expect(trip.bookings?.[0].destinationTimeZone).toBeUndefined();
  });
});

describe('stay authority', () => {
  const days = [
    { day: 1, stayCity: 'Osaka' },
    { day: 2, stayCity: 'Osaka' },
    { day: 3, stayCity: 'Osaka' },
    { day: 4, stayCity: 'Kyoto' },
    { day: 5, stayCity: 'Osaka' },
  ];

  it('says nothing when the hotel agrees with the route', () => {
    const nikko = booking({
      id: 'nikko', type: 'stay', title: 'Hotel Nikko Osaka',
      startDate: '2027-01-21', endDate: '2027-01-24', city: 'Osaka', cityKey: 'osaka',
    });
    expect(stayRouteConflicts([nikko], days, TRIP_START)).toEqual([]);
  });

  it('surfaces a hotel booked in the wrong city instead of moving the route', () => {
    const wrong = booking({
      id: 'granbell', type: 'stay', title: 'Kyoto Granbell',
      startDate: '2027-01-21', endDate: '2027-01-24', city: 'Kyoto', cityKey: 'kyoto',
    });
    const conflicts = stayRouteConflicts([wrong], days, TRIP_START);
    expect(conflicts).toHaveLength(3);
    expect(conflicts[0].message).toBe('Day 1 is planned in Osaka, but Kyoto Granbell is booked in Kyoto.');
    // The route itself is untouched — this function returns findings, not edits.
    expect(days[0].stayCity).toBe('Osaka');
  });

  it('counts nights, not dates: a 21st-to-24th booking is three nights', () => {
    const nikko = booking({
      id: 'nikko', type: 'stay', title: 'Hotel Nikko Osaka',
      startDate: '2027-01-21', endDate: '2027-01-24', city: 'Kyoto', cityKey: 'kyoto',
    });
    // Days 1, 2 and 3 — never day 4, which is the morning they check out.
    expect(stayRouteConflicts([nikko], days, TRIP_START).map((c) => c.dayNumber)).toEqual([1, 2, 3]);
  });

  it('attaches a repeated-city hotel to the right visit by date', () => {
    // Osaka is visited twice: days 1-3 and day 5. A hotel on the second visit
    // must not be compared against the first.
    const second = booking({
      id: 'second-osaka', type: 'stay', title: 'Osaka Return',
      startDate: '2027-01-25', endDate: '2027-01-26', city: 'Osaka', cityKey: 'osaka',
    });
    expect(bookingDayNumber(second, TRIP_START, days.length)).toBe(5);
    expect(stayRouteConflicts([second], days, TRIP_START)).toEqual([]);
  });

  it('ignores a hotel the traveller has only sketched', () => {
    const idea = booking({
      id: 'idea', type: 'stay', title: 'Maybe Kyoto', status: 'planned',
      startDate: '2027-01-21', endDate: '2027-01-22', city: 'Kyoto', cityKey: 'kyoto',
    });
    expect(stayRouteConflicts([idea], days, TRIP_START)).toEqual([]);
  });
});

describe('status decides what constrains a day', () => {
  const flight = (status: TravelBooking['status']) => booking({
    id: `f-${status}`, type: 'flight', title: 'AK 68', status,
    startDate: '2027-01-31', startTime: '10:55',
  });

  it.each([
    ['confirmed', true],
    ['requested', true],
    ['planned', false],
    ['cancelled', false],
  ] as const)('%s booking constrains the day: %s', (status, constrains) => {
    const held = committedBookingsForDay([flight(status)], 11, TRIP_START, 11);
    expect(held.length > 0).toBe(constrains);
    const shape = bookingDayShape(held);
    expect(shape.returnTimeOverride !== undefined).toBe(constrains);
  });

  it('never lets a planned booking act like a confirmed one', () => {
    const planned = bookingDayShape(committedBookingsForDay([flight('planned')], 11, TRIP_START, 11));
    const confirmed = bookingDayShape(committedBookingsForDay([flight('confirmed')], 11, TRIP_START, 11));
    expect(planned).not.toEqual(confirmed);
    expect(confirmed.returnTimeOverride).toBe('07:25');
  });
});

describe('a plan revision cannot quietly drop what the traveller booked', () => {
  const held = booking({
    id: 'held', type: 'flight', title: 'AK 68', startDate: '2027-01-31',
    startTime: '10:55', reference: 'X7QK2M',
  });
  const current: Itinerary = { ...emptyItinerary, id: 'trip-1', bookings: [held] };

  it('keeps bookings when a server payload does not mention them', () => {
    // The itinerary-change Edge function predates bookings and returns a
    // document with no `bookings` key at all. `adopt` replaces local state
    // wholesale, so absence must mean "unchanged", not "deleted".
    const fromServer = { ...emptyItinerary, id: 'trip-1', name: 'Replanned', revision: 4 };
    expect('bookings' in fromServer).toBe(false);

    const adopted = sanitizeItinerary(fromServer, current);
    expect(adopted.name).toBe('Replanned');
    expect(adopted.bookings).toHaveLength(1);
    expect(adopted.bookings?.[0].reference).toBe('X7QK2M');
  });

  it('survives the spread a replan builds its result from', () => {
    // `tripIntelligence` rebuilds days with `{ ...itinerary, days }`, which
    // carries bookings through by construction.
    const replanned = sanitizeItinerary({ ...current, days: [] }, current);
    expect(replanned.bookings).toHaveLength(1);
  });

  it('honours a deliberate removal, which is the traveller editing their own list', () => {
    // An explicit empty array is a real instruction and must not be confused
    // with the absence above.
    const cleared = sanitizeItinerary({ ...current, bookings: [] }, current);
    expect(cleared.bookings).toBeUndefined();
  });
});

describe('date placement at the edges of a trip', () => {
  const days = 11;

  it.each([
    ['first day', '2027-01-21', 1],
    ['last day', '2027-01-31', 11],
    ['day before the trip', '2027-01-20', undefined],
    ['day after the trip', '2027-02-01', undefined],
  ])('%s', (_label, startDate, expected) => {
    expect(bookingDayNumber({ startDate }, TRIP_START, days)).toBe(expected);
  });

  it('keeps a hotel that starts inside the trip and ends after it', () => {
    // The check-in is what places the card; an overrun check-out does not
    // discard the booking.
    const overrun = booking({
      id: 'overrun', type: 'stay', title: 'Late checkout',
      startDate: '2027-01-31', endDate: '2027-02-03', city: 'Osaka', cityKey: 'osaka',
    });
    expect(bookingDayNumber(overrun, TRIP_START, days)).toBe(11);
  });

  it('places nothing at all when the trip has no dates', () => {
    expect(bookingDayNumber({ startDate: '2027-01-25' }, undefined, days)).toBeUndefined();
  });
});

describe('bookings do not disturb fields the sanitizer already carried', () => {
  it('keeps place identity, verified media and day semantics intact', () => {
    // This allow-list has lost newer fields before. Adding bookings must not
    // be the next time.
    const activity: Activity = {
      id: 'act-1', type: 'culture', time: '09:00', name: 'Todai-ji', description: '',
      placeRef: { canonicalPlaceId: 'place-todaiji', provider: 'osm', providerPlaceId: 'w123' },
      photoUrl: 'https://upload.wikimedia.org/a.jpg',
      photoThumbnailUrl: 'https://upload.wikimedia.org/a-thumb.jpg',
      photoAttribution: 'A Photographer',
      photoSourcePage: 'https://commons.wikimedia.org/wiki/File:A.jpg',
      photoLicense: 'CC BY-SA 4.0',
      photoLicenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
      photoImageKey: 'File:A.jpg',
      city: 'Nara',
    };
    const source = {
      ...emptyItinerary,
      id: 'trip-1',
      cities: ['Osaka', 'Nara'],
      days: [{
        // A transfer must end at the day's own stay city — the Stage-4 rule
        // `parseDayTransfer` enforces. The fixture honours it so this test
        // measures the booking change, not that rule.
        day: 1, date: 'Jan 21', stayCity: 'Nara', city: 'Nara',
        activityCities: ['Osaka', 'Nara'],
        transfer: { from: 'Osaka', to: 'Nara' },
        title: 'Moving on', activities: [activity],
      }],
      bookings: [booking({ id: 'b', type: 'stay', title: 'Nikko', startDate: '2027-01-21', city: 'Osaka' })],
    };

    const saved = sanitizeItinerary(source, { ...emptyItinerary, id: 'trip-1' });
    const day = saved.days[0];
    const kept = day.activities[0];

    expect(day.stayCity).toBe('Nara');
    expect(day.city).toBe('Nara');
    expect(day.activityCities).toEqual(['Osaka', 'Nara']);
    expect(day.transfer).toBeDefined();
    expect(kept.placeRef).toBeDefined();
    expect(kept.photoUrl).toBe('https://upload.wikimedia.org/a.jpg');
    expect(kept.photoLicense).toBe('CC BY-SA 4.0');
    expect(kept.photoImageKey).toBe('File:A.jpg');
    expect(kept.city).toBe('Nara');
    expect(saved.bookings).toHaveLength(1);
  });
});

describe('activity booking state and reservation records do not cross', () => {
  it('leaves Activity.bookingStatus alone when a ticket booking exists', () => {
    // The two answer different questions and are deliberately unlinked in V1:
    // there is no shared id, so neither can silently override the other. What
    // this proves is that adding one does not mutate the other.
    const activity: Activity = {
      id: 'act-1', type: 'culture', time: '14:30', name: 'Todai-ji',
      description: '', bookingStatus: 'confirmed', reservationRequirement: 'required',
    };
    const trip = sanitizeItinerary({
      ...emptyItinerary,
      id: 'trip-1',
      days: [{ day: 1, date: 'Jan 21', stayCity: 'Nara', city: 'Nara', activityCities: [], title: 'D1', activities: [activity] }],
      bookings: [booking({ id: 'ticket', type: 'activity-ticket', title: 'Todai-ji', status: 'cancelled', startDate: '2027-01-21', startTime: '14:30' })],
    }, { ...emptyItinerary, id: 'trip-1' });

    expect(trip.days[0].activities[0].bookingStatus).toBe('confirmed');
    expect(trip.bookings?.[0].status).toBe('cancelled');
    // A cancelled reservation stops constraining the day; the activity flag is
    // untouched because it was never a reservation in the first place.
    expect(committedBookingsForDay(trip.bookings || [], 1, TRIP_START, 1)).toEqual([]);
  });
});
