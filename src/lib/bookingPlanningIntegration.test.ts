import { describe, expect, it, vi } from 'vitest';
import { applyProposalToItinerary, canonicalJson, validateStagedChange } from '../../supabase/functions/_shared/itineraryChange';
import {
  buildPlanningMaterial,
  planningMaterialForModel,
  runItineraryProposalEngine,
  type PlanningMaterial,
  type TripItineraryProposal,
} from '../../supabase/functions/_shared/itineraryProposal';
import type { TravelBooking } from './travelBooking';

const START = '2027-01-21';
const hours = [{ opensAt: '08:00', closesAt: '22:00', days: [0, 1, 2, 3, 4, 5, 6] }];

const place = (id: string, name: string, city = 'Osaka', extra: Record<string, unknown> = {}) => ({
  id,
  kind: 'place',
  time: '09:00',
  durationMinutes: 90,
  name,
  description: `${name} description`,
  type: 'sight',
  city,
  location: city,
  provider: 'osm',
  providerPlaceId: id,
  placeRef: { canonicalPlaceId: `place-${id}`, provider: 'osm', providerPlaceId: id },
  coordinates: [34.68, 135.5],
  openingHoursWeek: hours,
  lockedFields: [],
  ...extra,
});

const flightActivity = (extra: Record<string, unknown> = {}) => ({
  id: 'activity-flight',
  kind: 'transport',
  time: '10:55',
  durationMinutes: 445,
  name: 'AK 68',
  description: 'Legacy flight schedule',
  type: 'flight',
  ...extra,
});

const booking = (
  type: TravelBooking['type'],
  status: TravelBooking['status'],
  extra: Partial<TravelBooking> = {},
): TravelBooking => ({
  id: `booking-${type}-${status}`,
  type,
  status,
  title: type === 'stay' ? 'Nikko Osaka' : 'Reserved journey',
  startDate: START,
  ...extra,
});

const itinerary = (bookings?: TravelBooking[], overrides: Record<string, unknown> = {}) => ({
  id: 'trip-1',
  name: 'Booking-aware Kansai',
  cities: ['Osaka'],
  revision: 4,
  tripProfile: {
    startDate: START,
    destinations: [{ city: 'Osaka', countryCode: 'JP' }],
    styles: [],
    transport: ['walking'],
  },
  discoveryState: { decisions: { p1: 'interested', p2: 'interested', p3: 'interested' } },
  bookings,
  days: [
    { day: 1, date: START, stayCity: 'Osaka', city: 'Osaka', title: 'Day 1', activities: [place('p1', 'Castle')] },
    { day: 2, date: '2027-01-22', stayCity: 'Osaka', city: 'Osaka', title: 'Day 2', activities: [place('p2', 'Museum')] },
    { day: 3, date: '2027-01-23', stayCity: 'Osaka', city: 'Osaka', title: 'Day 3', activities: [place('p3', 'Market')] },
  ],
  ...overrides,
});

const materialFor = (bookings?: TravelBooking[], overrides: Record<string, unknown> = {}) =>
  buildPlanningMaterial('trip-1', itinerary(bookings, overrides));

const run = async (material: PlanningMaterial): Promise<TripItineraryProposal> => runItineraryProposalEngine(material, {
  chooseComposition: vi.fn().mockResolvedValue({
    days: material.days.map((day) => ({
      day: day.day,
      placeIds: material.places.filter((candidate) => candidate.currentDay === day.day).map((candidate) => candidate.id),
    })),
  }),
  getRouteMatrix: vi.fn().mockResolvedValue([]),
  now: () => '2027-01-20T08:00:00.000Z',
});

describe('Booking V1.1 planning material', () => {
  it('turns a confirmed flight booking into fixed planning material', async () => {
    const material = await materialFor([booking('flight', 'confirmed', {
      startDate: '2027-01-23', startTime: '14:30', endTime: '16:00',
    })]);
    expect(material.days[2].fixedEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ transportKind: 'flight', constraintStatus: 'confirmed', startTime: '14:30' }),
    ]));
    expect(material.bookingTrace?.confirmedBookingsApplied).toBe(1);
  });

  it('protects a requested flight but keeps it labelled pending', async () => {
    const material = await materialFor([booking('flight', 'requested', {
      startDate: '2027-01-23', startTime: '14:30', endTime: '16:00',
    })]);
    const event = material.days[2].fixedEvents?.[0];
    expect(event).toMatchObject({ constraintStatus: 'requested' });
    expect(event?.name).toContain('Requested (pending)');
    expect(material.bookingTrace?.requestedBookingsProtected).toBe(1);
  });

  it.each(['planned', 'cancelled'] as const)('%s flight does not constrain planning', async (status) => {
    const baseline = await materialFor();
    const material = await materialFor([booking('flight', status, {
      startDate: '2027-01-23', startTime: '14:30', endTime: '16:00',
    })]);
    expect(material.days).toEqual(baseline.days);
    expect(material.bookingTrace).toBeUndefined();
  });

  it('turns confirmed rail into a fixed event without authorizing a Stage-4 transfer', async () => {
    const material = await materialFor([booking('rail', 'confirmed', {
      startDate: '2027-01-22', startTime: '14:30', endTime: '15:15', origin: 'Osaka', destination: 'Kyoto',
    })]);
    expect(material.days[1].fixedEvents).toEqual([
      expect.objectContaining({ role: 'fixed', transportKind: 'transport', startTime: '14:30', endTime: '15:15' }),
    ]);
    expect(material.days[1].transfer).toBeUndefined();
    expect(material.days[1].stayCity).toBe('Osaka');
  });

  it('marks requested rail as provisional protected material', async () => {
    const material = await materialFor([booking('rail', 'requested', {
      startDate: '2027-01-22', startTime: '14:30', endTime: '15:15',
    })]);
    expect(material.days[1].fixedEvents?.[0]).toMatchObject({ role: 'fixed', constraintStatus: 'requested' });
    expect(material.bookingTrace).toMatchObject({ requestedBookingsProtected: 1, confirmedBookingsApplied: 0 });
  });

  it('uses explicit hotel check-out as a point boundary', async () => {
    const material = await materialFor([booking('stay', 'confirmed', {
      startDate: START, endDate: '2027-01-22', endTime: '10:00', city: 'Osaka',
    })]);
    expect(material.days[1].fixedEvents).toEqual([
      expect.objectContaining({ role: 'fixed', transportKind: 'reservation', startTime: '10:00', endTime: '10:00' }),
    ]);
    const proposal = await run(material);
    const item = proposal.days[1].items.find((candidate) => candidate.placeId === 'p2');
    expect(item && !(item.startTime < '10:00' && item.endTime > '10:00')).toBe(true);
  });

  it('does not interpret hotel check-in as traveller arrival', async () => {
    const material = await materialFor([booking('stay', 'confirmed', {
      startDate: START, startTime: '15:00', endDate: '2027-01-22', city: 'Osaka',
    })]);
    expect(material.days[0].startTime).toBe('09:15');
    expect(material.days[0].fixedEvents).toBeUndefined();
  });

  it('reports a hotel-city conflict without changing route authority', async () => {
    const material = await materialFor([booking('stay', 'confirmed', {
      startDate: START, endDate: '2027-01-24', city: 'Kyoto', title: 'Kyoto Granbell',
    })]);
    expect(material.days.every((day) => day.stayCity === 'Osaka')).toBe(true);
    expect(material.bookingConflicts).toHaveLength(3);
    const proposal = await run(material);
    expect(proposal.status).toBe('needs-review');
    expect(proposal.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'stay-booking-conflict', severity: 'error' }),
    ]));
  });

  it('splits an overnight timezone flight across departure and arrival days', async () => {
    const material = await materialFor([booking('flight', 'confirmed', {
      startDate: START, startTime: '23:30', endDate: '2027-01-22', endTime: '07:10',
      originTimeZone: 'Asia/Kuala_Lumpur', destinationTimeZone: 'Asia/Tokyo',
    })]);
    expect(material.days[0].fixedEvents?.[0]).toMatchObject({ role: 'departure', elapsedMinutes: 400 });
    expect(material.days[1].fixedEvents?.[0]).toMatchObject({ role: 'arrival', elapsedMinutes: 400 });
    expect(material.days[1].startTime >= '09:10').toBe(true);
  });

  it('keeps an international-date-line flight on actual elapsed time', async () => {
    const material = await materialFor([booking('flight', 'confirmed', {
      startDate: START, startTime: '23:30', endDate: '2027-01-23', endTime: '04:30',
      originTimeZone: 'America/Los_Angeles', destinationTimeZone: 'Asia/Tokyo',
    })]);
    expect(material.days[0].fixedEvents?.[0].elapsedMinutes).toBe(720);
    expect(material.days[1].fixedEvents?.[0]).toMatchObject({
      role: 'fixed', startTime: '00:00', endTime: '23:59', elapsedMinutes: 720,
    });
    expect(material.days[1].maxMainActivities).toBe(0);
    expect(material.days[2].fixedEvents?.[0]).toMatchObject({ role: 'arrival', elapsedMinutes: 720 });
  });

  it('de-duplicates an explicitly linked compatible flight Activity and booking', async () => {
    const source = itinerary([booking('flight', 'confirmed', {
      startTime: '10:55', endTime: '17:20', endDate: START,
      originTimeZone: 'Asia/Tokyo', destinationTimeZone: 'Asia/Kuala_Lumpur', relatedActivityId: 'activity-flight',
    })], {
      days: [
        { day: 1, date: START, stayCity: 'Osaka', city: 'Osaka', title: 'Day 1', activities: [place('p1', 'Castle'), flightActivity()] },
        { day: 2, date: '2027-01-22', stayCity: 'Osaka', city: 'Osaka', title: 'Day 2', activities: [place('p2', 'Museum')] },
      ],
    });
    const material = await buildPlanningMaterial('trip-1', source);
    expect(material.days[0].fixedEvents).toHaveLength(1);
    expect(material.days[0].fixedEvents?.[0]).toMatchObject({ elapsedMinutes: 445, constraintStatus: 'confirmed' });
    expect(material.bookingConflicts).toBeUndefined();
  });

  it('surfaces linked flight schedule disagreement instead of picking silently', async () => {
    const source = itinerary([booking('flight', 'confirmed', {
      startTime: '10:55', endTime: '17:20', endDate: START,
      originTimeZone: 'Asia/Tokyo', destinationTimeZone: 'Asia/Kuala_Lumpur', relatedActivityId: 'activity-flight',
    })], {
      days: [
        { day: 1, date: START, stayCity: 'Osaka', city: 'Osaka', title: 'Day 1', activities: [place('p1', 'Castle'), flightActivity({ time: '12:00' })] },
      ],
    });
    const material = await buildPlanningMaterial('trip-1', source);
    expect(material.days[0].fixedEvents).toHaveLength(1);
    expect(material.bookingConflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'flight-booking-mismatch', message: expect.stringContaining('departure time') }),
    ]));
    expect((await run(material)).status).toBe('needs-review');
  });

  it('lets an unlinked confirmed booking flight constrain Smart Plan directly', async () => {
    const material = await materialFor([booking('flight', 'confirmed', {
      startDate: '2027-01-23', startTime: '10:55', endTime: '17:20',
      originTimeZone: 'Asia/Tokyo', destinationTimeZone: 'Asia/Kuala_Lumpur',
    })]);
    expect(material.days[2].fixedEvents?.some((event) => event.transportKind === 'flight')).toBe(true);
  });

  it('reserves a timed activity ticket without name-matching an Activity', async () => {
    const material = await materialFor([booking('activity-ticket', 'confirmed', {
      startDate: '2027-01-22', startTime: '14:30', endTime: '16:00', title: 'Tea ceremony',
    })]);
    expect(material.days[1].fixedEvents?.[0]).toMatchObject({ role: 'fixed', transportKind: 'reservation' });
    expect(material.days[1].fixedPlaceIds).not.toContain('booking-activity-ticket-confirmed');
  });
});

describe('Booking V1.1 proposal and Apply boundaries', () => {
  it('does not mutate bookings while producing a proposal', async () => {
    const bookings = [booking('rail', 'confirmed', { startDate: '2027-01-22', startTime: '14:30', endTime: '15:15' })];
    const source = itinerary(bookings);
    const before = canonicalJson(source.bookings);
    await run(await buildPlanningMaterial('trip-1', source));
    expect(canonicalJson(source.bookings)).toBe(before);
  });

  it('preserves every booking byte-for-byte through proposal Apply', async () => {
    const bookings = [
      booking('rail', 'confirmed', { startDate: '2027-01-22', startTime: '14:30', endTime: '15:15', reference: 'PRIVATE-REF', price: { amount: 10, currency: 'MYR', source: 'manual', retrievedAt: '2027-01-20T00:00:00Z' } }),
      booking('stay', 'planned', { city: 'Kyoto', notes: 'private note' }),
      booking('flight', 'cancelled', { startTime: '12:00' }),
    ];
    const source = itinerary(bookings);
    const proposal = await run(await buildPlanningMaterial('trip-1', source));
    const applied = applyProposalToItinerary(source, proposal);
    expect(applied.bookingsPreserved).toBe(true);
    expect(canonicalJson(applied.itinerary.bookings)).toBe(canonicalJson(bookings));
    expect(validateStagedChange(proposal, applied).blocking).not.toContain('Smart Plan changed booking facts it has no authority to edit.');
  });

  it('turns a fixed booking overlap into needs-review', async () => {
    const locked = place('p2', 'Timed museum', 'Osaka', { locked: true, time: '14:00', durationMinutes: 120 });
    const source = itinerary([booking('rail', 'confirmed', {
      startDate: '2027-01-22', startTime: '14:30', endTime: '15:15', title: 'Haruka',
    })], {
      days: [
        { day: 1, date: START, stayCity: 'Osaka', city: 'Osaka', title: 'Day 1', activities: [place('p1', 'Castle')] },
        { day: 2, date: '2027-01-22', stayCity: 'Osaka', city: 'Osaka', title: 'Day 2', activities: [locked] },
      ],
    });
    const material = await buildPlanningMaterial('trip-1', source);
    const chooseComposition = vi.fn().mockResolvedValue({
      days: material.days.map((day) => ({
        day: day.day,
        placeIds: material.places.filter((candidate) => candidate.currentDay === day.day).map((candidate) => candidate.id),
      })),
    });
    const proposal = await runItineraryProposalEngine(material, {
      chooseComposition,
      getRouteMatrix: vi.fn().mockResolvedValue([]),
      now: () => '2027-01-20T08:00:00.000Z',
    });
    expect(proposal.status).toBe('needs-review');
    expect(proposal.conflicts.some((conflict) => /overlaps.*Haruka|overlaps.*train/i.test(conflict.message))).toBe(true);
    expect(proposal.conflicts.some((conflict) => conflict.source === 'booking')).toBe(true);
    expect(chooseComposition).toHaveBeenCalledTimes(1);
  });

  it('ignores a cancelled booking when checking proposal conflicts', async () => {
    const material = await materialFor([booking('rail', 'cancelled', {
      startDate: '2027-01-22', startTime: '14:30', endTime: '15:15', title: 'Cancelled train',
    })]);
    const proposal = await run(material);
    expect(JSON.stringify(proposal.conflicts)).not.toContain('Cancelled train');
    expect(material.bookingConflicts).toBeUndefined();
  });

  it('never sends booking references, provider IDs, prices, or private notes into planning/model material', async () => {
    const material = await materialFor([booking('flight', 'confirmed', {
      startDate: '2027-01-23', startTime: '14:30', endTime: '16:00',
      reference: 'SECRET-REF', providerBookingId: 'provider-private-id', notes: 'passport detail',
      price: { amount: 900, currency: 'MYR', source: 'manual', retrievedAt: '2027-01-20T00:00:00Z' },
    })]);
    const serialized = JSON.stringify(material);
    expect(serialized).not.toContain('SECRET-REF');
    expect(serialized).not.toContain('provider-private-id');
    expect(serialized).not.toContain('passport detail');
    expect(serialized).not.toContain('"amount":900');
    expect(JSON.stringify(planningMaterialForModel(material))).not.toContain('bookingConflicts');

    const chooseComposition = vi.fn().mockResolvedValue({ days: material.days.map((day) => ({ day: day.day, placeIds: [] })) });
    await runItineraryProposalEngine(material, {
      chooseComposition,
      getRouteMatrix: vi.fn().mockResolvedValue([]),
      now: () => '2027-01-20T08:00:00.000Z',
    });
    expect(JSON.stringify(chooseComposition.mock.calls[0][0].material)).not.toContain('SECRET-REF');
  });

  it('keeps an itinerary with no active bookings byte-identical at the planning-material boundary', async () => {
    const absent = await materialFor();
    const empty = await materialFor([]);
    const inactive = await materialFor([
      booking('flight', 'planned', { startTime: '12:00' }),
      booking('rail', 'cancelled', { startTime: '14:30', endTime: '15:15' }),
    ]);
    expect(canonicalJson(empty)).toBe(canonicalJson(absent));
    expect(canonicalJson(inactive)).toBe(canonicalJson(absent));
  });
});
