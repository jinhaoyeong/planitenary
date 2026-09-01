/**
 * One trip's content must never become another trip's.
 *
 * Driven through real deferred promises rather than by asserting on pure
 * functions in isolation: the defects here were ordering defects — a response
 * landing after the traveller moved on, and an identity checked after the
 * sanitiser had already overwritten it — and ordering is the thing under test.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Itinerary } from '../data';
import { emptyItinerary } from './itinerarySanitize';
import { createTripScopedItineraryStore } from './tripScopedItinerary';
import { currentTripFirst, rawPayloadBelongsToTrip } from './tripSelection';
import type { TripSummary } from './trips';

const BANGKOK = 'trip-bangkok';
const PHUKET = 'trip-phuket';

const trip = (id: string, city: string, revision: number): Itinerary => ({
  ...emptyItinerary,
  id,
  name: `${city} trip`,
  cities: [city],
  revision,
  days: [{ day: 1, date: 'Apr 2', stayCity: city, activityCities: [], city, title: city, activities: [] }],
});

/** A request whose resolution the test controls. */
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
};

describe('a response that arrives after the traveller moved on', () => {
  it('leaves Phuket alone when Bangkok’s slow fetch finally answers', async () => {
    const store = createTripScopedItineraryStore(BANGKOK, trip(BANGKOK, 'Bangkok', 5));
    const bangkokFetch = deferred<Itinerary>();

    // The fetch for Bangkok is in flight...
    const inFlight = bangkokFetch.promise.then((raw) => store.consider({
      arrivedForTripId: BANGKOK,
      raw,
      fallback: trip(BANGKOK, 'Bangkok', 5),
    }));

    // ...and the traveller opens Phuket before it lands.
    store.select(PHUKET, trip(PHUKET, 'Phuket', 3));

    bangkokFetch.resolve(trip(BANGKOK, 'Bangkok', 20));
    const result = await inFlight;

    expect(result.outcome).toBe('stale-selection');
    expect(store.activeTripId).toBe(PHUKET);
    expect(store.latest?.id).toBe(PHUKET);
    expect(store.latest?.cities).toEqual(['Phuket']);
  });

  it('survives rapid A → B → A switching with A active and A’s content held', async () => {
    const store = createTripScopedItineraryStore(BANGKOK, trip(BANGKOK, 'Bangkok', 1));
    const slow = deferred<Itinerary>();
    const inFlight = slow.promise.then((raw) => store.consider({
      arrivedForTripId: PHUKET,
      raw,
      fallback: trip(PHUKET, 'Phuket', 1),
    }));

    store.select(PHUKET, trip(PHUKET, 'Phuket', 1));
    store.select(BANGKOK, trip(BANGKOK, 'Bangkok', 1));

    slow.resolve(trip(PHUKET, 'Phuket', 9));
    expect((await inFlight).outcome).toBe('stale-selection');
    expect(store.activeTripId).toBe(BANGKOK);
    expect(store.latest?.cities).toEqual(['Bangkok']);
  });

  it('ignores a realtime event for a trip that is no longer open', () => {
    const store = createTripScopedItineraryStore(PHUKET, trip(PHUKET, 'Phuket', 3));
    const result = store.consider({
      arrivedForTripId: BANGKOK,
      raw: trip(BANGKOK, 'Bangkok', 40),
      fallback: trip(BANGKOK, 'Bangkok', 40),
    });
    expect(result.outcome).toBe('stale-selection');
    expect(store.latest?.cities).toEqual(['Phuket']);
  });
});

describe('a payload that does not belong to the trip it arrived for', () => {
  it('rejects Phuket’s content offered under Bangkok’s id, before sanitisation', () => {
    const store = createTripScopedItineraryStore(BANGKOK, trip(BANGKOK, 'Bangkok', 2));
    const result = store.consider({
      arrivedForTripId: BANGKOK,
      raw: trip(PHUKET, 'Phuket', 99),
      fallback: trip(BANGKOK, 'Bangkok', 2),
    });

    expect(result.outcome).toBe('identity-mismatch');
    expect(result.itinerary).toBeUndefined();
    expect(store.latest?.cities).toEqual(['Bangkok']);
  });

  it('rejects a local-storage payload whose id disagrees with the key it was under', () => {
    const store = createTripScopedItineraryStore(BANGKOK, null);
    const fromStorage = JSON.parse(JSON.stringify(trip(PHUKET, 'Phuket', 4)));

    const result = store.consider({
      arrivedForTripId: BANGKOK,
      raw: fromStorage,
      fallback: trip(BANGKOK, 'Bangkok', 0),
    });

    expect(result.outcome).toBe('identity-mismatch');
    expect(store.latest).toBeNull();
  });

  it('accepts a legacy payload that carries no id of its own', () => {
    const store = createTripScopedItineraryStore(BANGKOK, null);
    const legacy = { name: 'Bangkok Food Journey', cities: ['Bangkok'], revision: 3, days: [] };

    const result = store.consider({
      arrivedForTripId: BANGKOK,
      raw: legacy,
      fallback: trip(BANGKOK, 'Bangkok', 0),
    });

    expect(result.outcome).toBe('adopted');
    expect(result.itinerary?.id).toBe(BANGKOK);
    expect(result.itinerary?.name).toBe('Bangkok Food Journey');
  });

  it('states the raw rule directly', () => {
    expect(rawPayloadBelongsToTrip(BANGKOK, { id: BANGKOK })).toBe(true);
    expect(rawPayloadBelongsToTrip(BANGKOK, { id: PHUKET })).toBe(false);
    expect(rawPayloadBelongsToTrip(BANGKOK, { name: 'no id here' })).toBe(true);
    expect(rawPayloadBelongsToTrip(BANGKOK, null)).toBe(false);
    expect(rawPayloadBelongsToTrip(BANGKOK, 'not an object')).toBe(false);
  });
});

describe('revision ordering never crosses trips', () => {
  it('adopts Phuket revision 3 even though Bangkok revision 20 was open', () => {
    const store = createTripScopedItineraryStore(BANGKOK, trip(BANGKOK, 'Bangkok', 20));
    store.select(PHUKET, null);

    const result = store.consider({
      arrivedForTripId: PHUKET,
      raw: trip(PHUKET, 'Phuket', 3),
      fallback: trip(PHUKET, 'Phuket', 0),
    });

    expect(result.outcome).toBe('adopted');
    expect(result.itinerary?.revision).toBe(3);
  });

  it('still orders by revision within one trip', () => {
    const store = createTripScopedItineraryStore(BANGKOK, trip(BANGKOK, 'Bangkok', 7));
    expect(store.consider({
      arrivedForTripId: BANGKOK,
      raw: trip(BANGKOK, 'Bangkok', 4),
      fallback: trip(BANGKOK, 'Bangkok', 0),
    }).outcome).toBe('older-revision');
    expect(store.consider({
      arrivedForTripId: BANGKOK,
      raw: trip(BANGKOK, 'Bangkok', 8),
      fallback: trip(BANGKOK, 'Bangkok', 0),
    }).outcome).toBe('adopted');
  });

  it('drops the previous trip’s content when the selected id changes elsewhere', () => {
    const store = createTripScopedItineraryStore(BANGKOK, trip(BANGKOK, 'Bangkok', 20));
    store.syncActiveTripId(PHUKET);
    expect(store.latest).toBeNull();
  });
});

describe('a write may only go to the trip that is open', () => {
  it('refuses to persist Bangkok’s itinerary once Phuket is selected', () => {
    const store = createTripScopedItineraryStore(BANGKOK, trip(BANGKOK, 'Bangkok', 2));
    const bangkok = trip(BANGKOK, 'Bangkok', 2);
    expect(store.canPersist(bangkok)).toBe(true);

    store.select(PHUKET, trip(PHUKET, 'Phuket', 1));
    expect(store.canPersist(bangkok)).toBe(false);
    expect(store.canPersist(trip(PHUKET, 'Phuket', 1))).toBe(true);
    expect(store.canPersist(null)).toBe(false);
  });

  it('does not write a pending autosave into the trip the traveller switched to', () => {
    vi.useFakeTimers();
    try {
      const store = createTripScopedItineraryStore(BANGKOK, trip(BANGKOK, 'Bangkok', 2));
      const pending = trip(BANGKOK, 'Bangkok', 2);
      const written: string[] = [];

      // The debounced save the app schedules while Bangkok is open.
      setTimeout(() => {
        if (store.canPersist(pending)) written.push(pending.id);
      }, 800);

      store.select(PHUKET, trip(PHUKET, 'Phuket', 1));
      vi.advanceTimersByTime(1000);

      expect(written).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('remembering which trip is current', () => {
  const summary = (id: string, title: string, updatedAt: string): TripSummary => ({
    id,
    title,
    description: '',
    status: 'active',
    dayCount: 1,
    cityCount: 1,
    updatedAt,
  } as TripSummary);

  const trips = [
    summary(PHUKET, 'Phuket', '2026-09-01T10:00:00Z'),
    summary(BANGKOK, 'Bangkok', '2026-08-01T10:00:00Z'),
  ];

  it('puts the remembered trip first, ahead of a more recently touched one', () => {
    expect(currentTripFirst(trips, BANGKOK)[0].id).toBe(BANGKOK);
  });

  it('falls back deterministically when the remembered trip is gone', () => {
    expect(currentTripFirst(trips, 'trip-deleted').map((entry) => entry.id))
      .toEqual([PHUKET, BANGKOK]);
  });

  it('distinguishes two trips that share a city and a name, by id', () => {
    const twins = [
      summary('trip-a', 'Osaka 2026', '2026-09-02T10:00:00Z'),
      summary('trip-b', 'Osaka 2026', '2026-09-01T10:00:00Z'),
    ];
    expect(currentTripFirst(twins, 'trip-b')[0].id).toBe('trip-b');
  });
});
