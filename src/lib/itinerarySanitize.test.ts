/**
 * The save path. Everything the traveller sees passes through here on its way
 * to storage, and until 2026-08-06 nothing tested it — which is how it came to
 * be discarding two of the planner's fields on every write.
 */
import { describe, expect, it } from 'vitest';
import {
  emptyItinerary,
  isNewerItineraryRevision,
  sanitizeActivity,
  sanitizeItinerary,
} from './itinerarySanitize';
import { candidateToActivity } from './destinationIntelligence';
import type { PlaceCandidate } from './destinationIntelligence';
import type { Activity, Itinerary } from '../data';
import type { PlaceAdmission } from '../../supabase/functions/_shared/placeCost';

const fallbackActivity: Activity = {
  time: '09:00',
  name: 'Unassigned activity',
  description: '',
  type: 'other',
};

/** A discovered place as OpenStreetMap actually supplies it. */
const osmCandidate = (overrides: Partial<PlaceCandidate> = {}): PlaceCandidate => ({
  id: 'osm-node-123',
  name: 'Temple of the Six Banyan Trees',
  city: 'Guangzhou',
  neighbourhood: 'Yue Xiu Qu',
  description: 'Buddhist temple complex first built in 510.',
  categories: ['temple', 'history'],
  experienceTags: ['temples', 'history'],
  estimatedVisitMinutes: 90,
  indoorOutdoor: 'mixed',
  reservationStatus: 'not-needed',
  provider: 'osm',
  providerPlaceId: 'node/123',
  coordinates: [23.1291, 113.2644],
  sourceReferences: [{ label: 'OpenStreetMap', url: 'https://www.openstreetmap.org/node/123' }],
  sourceConfidence: 'medium',
  lastVerifiedAt: '2026-08-06T00:00:00.000Z',
  ...overrides,
} as PlaceCandidate);

const tripWith = (activities: Activity[]): Itinerary => ({
  ...emptyItinerary,
  id: 'trip-1',
  days: [{ day: 1, date: '2027-01-21', city: 'Guangzhou', title: 'Day one', activities }],
});

describe('the planner’s work survives a save', () => {
  it('keeps indoorOutdoor, which is the only input to the rain replan', () => {
    // This field was never copied at all. isOutdoor reads nothing else, so
    // weather-aware ordering lost its data on the first save of any trip.
    const activity = candidateToActivity(osmCandidate({ indoorOutdoor: 'outdoor' }));
    expect(activity.indoorOutdoor).toBe('outdoor');

    const saved = sanitizeActivity(activity, fallbackActivity);
    expect(saved.indoorOutdoor).toBe('outdoor');
  });

  it('keeps the provider for every source that actually finds places', () => {
    // The old check accepted three of seven DiscoveryProvider values, so every
    // real provider was dropped — Google being the one that is not configured.
    for (const provider of ['osm', 'wikivoyage', 'amap', 'baidu'] as const) {
      const saved = sanitizeActivity(candidateToActivity(osmCandidate({ provider })), fallbackActivity);
      expect(saved.provider, `${provider} must survive a save`).toBe(provider);
    }
  });

  it('still refuses a provider that is not a real one', () => {
    const saved = sanitizeActivity({ ...candidateToActivity(osmCandidate()), provider: 'tripadvisor' }, fallbackActivity);
    expect(saved.provider).toBeUndefined();
  });

  it('carries the rest of the scheduling detail through untouched', () => {
    const activity = candidateToActivity(osmCandidate());
    activity.durationMinutes = 90;
    activity.transportMinutes = 15;
    activity.transportMode = 'walking';
    activity.travelEstimateSource = 'provider-route';

    const saved = sanitizeActivity(activity, fallbackActivity);
    expect(saved.durationMinutes).toBe(90);
    expect(saved.transportMinutes).toBe(15);
    expect(saved.transportMode).toBe('walking');
    expect(saved.travelEstimateSource).toBe('provider-route');
    expect(saved.coordinates).toEqual([23.1291, 113.2644]);
    expect(saved.sourceReferences?.[0]?.url).toContain('openstreetmap.org');
    expect(saved.kind).toBe('place');
  });

  it('survives the full round trip through storage', () => {
    // The real journey: build → sanitise → JSON → back. A field lost anywhere
    // along that path is lost for good.
    const trip = tripWith([candidateToActivity(osmCandidate())]);
    const stored = JSON.parse(JSON.stringify(sanitizeItinerary(trip, emptyItinerary)));
    const reloaded = sanitizeItinerary(stored, emptyItinerary);

    const place = reloaded.days[0].activities[0];
    expect(place.indoorOutdoor).toBe('mixed');
    expect(place.provider).toBe('osm');
    expect(place.providerPlaceId).toBe('node/123');
  });
});

describe('sanitising is idempotent', () => {
  it('produces a deeply equal result the second time', () => {
    /**
     * The realtime sync compares JSON output to decide whether a remote payload
     * differs from local state. If sanitising were not idempotent every echo
     * would look like a change, and the sync would loop indefinitely.
     */
    const trip = tripWith([candidateToActivity(osmCandidate())]);
    const once = sanitizeItinerary(trip, emptyItinerary);
    const twice = sanitizeItinerary(JSON.parse(JSON.stringify(once)), emptyItinerary);
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });

  it('gives a day with no activities an empty list rather than inventing one', () => {
    // Generated trip skeletons start blank; a placeholder activity here would
    // read as a real plan.
    const blank = sanitizeItinerary(
      { ...emptyItinerary, id: 'trip-1', days: [{ day: 1, date: '2027-01-21', city: 'Guangzhou', title: 'Day one', activities: [] }] },
      emptyItinerary,
    );
    expect(blank.days[0].activities).toEqual([]);
  });

  it('keeps every day of a long trip against a blank template', () => {
    // emptyItinerary has no days at all, so each generated day sanitises
    // against a fallback that does not exist.
    const days = Array.from({ length: 21 }, (_, index) => ({
      day: index + 1,
      date: `2027-01-${String(index + 1).padStart(2, '0')}`,
      city: 'Melbourne',
      title: `Day ${index + 1}`,
      activities: [],
    }));
    const saved = sanitizeItinerary({ ...emptyItinerary, id: 'trip-1', days }, emptyItinerary);
    expect(saved.days).toHaveLength(21);
    expect(saved.days[20].day).toBe(21);
  });
});

/**
 * Admission is the most nested thing this file has ever had to carry: a class,
 * a list of fares each with its own currency, an expectation, provenance and a
 * confidence. Every one of them is a chance to lose something quietly, which is
 * exactly how `indoorOutdoor` and `provider` were lost before.
 */
describe('admission survives a save and reload', () => {
  const ticketed = (): PlaceAdmission => ({
    class: 'ticketed',
    fares: [
      { audience: 'adult', amount: 1500, currency: 'JPY' },
      { audience: 'student', amount: 1100, currency: 'JPY' },
      { audience: 'child', amount: 0, currency: 'JPY' },
    ],
    expectation: 'usually-ticketed',
    rawText: 'Adults ¥1,500 · students ¥1,100 · under 16 free',
    source: 'official-website',
    sourceUrl: 'https://example.museum/tickets',
    confidence: 'high',
    retrievedAt: '2026-08-04T00:00:00.000Z',
  });

  const reload = (activity: Activity): Activity => {
    // JSON round trip, because that is literally what storage does to it.
    const saved = sanitizeItinerary(tripWith([activity]), emptyItinerary);
    const reloaded = sanitizeItinerary(JSON.parse(JSON.stringify(saved)), emptyItinerary);
    return reloaded.days[0].activities[0];
  };

  it('keeps every fare, in order, with its currency', () => {
    const place = reload(candidateToActivity(osmCandidate({ admission: ticketed() })));
    expect(place.admission?.fares).toEqual([
      { audience: 'adult', amount: 1500, currency: 'JPY', note: undefined },
      { audience: 'student', amount: 1100, currency: 'JPY', note: undefined },
      { audience: 'child', amount: 0, currency: 'JPY', note: undefined },
    ]);
  });

  it('keeps the raw text, the source and the confidence', () => {
    // Provenance is what lets a card say where a price came from. Dropping it
    // would leave a number on screen with nothing behind it.
    const place = reload(candidateToActivity(osmCandidate({ admission: ticketed() })));
    expect(place.admission).toMatchObject({
      class: 'ticketed',
      expectation: 'usually-ticketed',
      rawText: 'Adults ¥1,500 · students ¥1,100 · under 16 free',
      source: 'official-website',
      sourceUrl: 'https://example.museum/tickets',
      confidence: 'high',
      retrievedAt: '2026-08-04T00:00:00.000Z',
    });
  });

  it('carries the adult fare into estimatedCost with its currency attached', () => {
    // A bare 1500 is the failure mode: it reads as dollars, ringgit or yen
    // depending on who is looking.
    const place = reload(candidateToActivity(osmCandidate({ admission: ticketed() })));
    expect(place.estimatedCost).toEqual({ amount: 1500, currency: 'JPY', basis: 'per-person' });
  });

  it('never takes a child fare as the budget figure', () => {
    const childOnly: PlaceAdmission = {
      class: 'ticketed',
      fares: [{ audience: 'child', amount: 300, currency: 'JPY' }],
      source: 'osm-tag',
      confidence: 'medium',
    };
    const place = reload(candidateToActivity(osmCandidate({ admission: childOnly })));
    expect(place.estimatedCost).toBeUndefined();
    expect(place.admission?.fares).toHaveLength(1);
  });

  it('keeps an empty fare list, because it means something', () => {
    // "A ticket is required, no source published the price" is a real answer
    // and must not collapse into "no admission information".
    const bare: PlaceAdmission = { class: 'ticketed', fares: [], source: 'osm-tag', confidence: 'medium' };
    const place = reload(candidateToActivity(osmCandidate({ admission: bare })));
    expect(place.admission?.class).toBe('ticketed');
    expect(place.admission?.fares).toEqual([]);
  });

  it('keeps a spend-based typical spend', () => {
    const spend: PlaceAdmission = {
      class: 'spend-based',
      typicalSpend: { audience: 'person', amount: 80, currency: 'CNY' },
      source: 'provider',
      confidence: 'medium',
    };
    const place = reload(candidateToActivity(osmCandidate({ admission: spend })));
    expect(place.admission?.typicalSpend).toEqual({ audience: 'person', amount: 80, currency: 'CNY', note: undefined });
  });

  it('drops one malformed fare without losing the rest', () => {
    const messy = {
      class: 'ticketed',
      fares: [
        { audience: 'adult', amount: 600, currency: 'jpy' },
        { audience: 'student', amount: 400 },              // no currency
        { audience: 'child', amount: 'free', currency: 'JPY' }, // not a number
        { amount: 200, currency: 'JPY' },                   // no audience
      ],
      source: 'wikivoyage',
      confidence: 'medium',
    };
    const activity = { ...candidateToActivity(osmCandidate()), admission: messy as unknown as PlaceAdmission };
    const place = reload(activity);
    // Only the well-formed fare survives, normalised.
    expect(place.admission?.fares).toEqual([{ audience: 'adult', amount: 600, currency: 'JPY', note: undefined }]);
  });

  it('refuses an admission with no attributable source', () => {
    const orphan = { class: 'ticketed', fares: [{ audience: 'adult', amount: 600, currency: 'JPY' }] };
    const activity = { ...candidateToActivity(osmCandidate()), admission: orphan as unknown as PlaceAdmission };
    expect(reload(activity).admission).toBeUndefined();
  });

  it('refuses a class it does not recognise', () => {
    const bogus = { class: 'donation', source: 'osm-tag', confidence: 'high' };
    const activity = { ...candidateToActivity(osmCandidate()), admission: bogus as unknown as PlaceAdmission };
    expect(reload(activity).admission).toBeUndefined();
  });

  it('persists a category expectation as an expectation, never as a price', () => {
    /**
     * A candidate with no sourced price still reaches the day card, and the
     * card should be able to say "spending happens inside" rather than nothing.
     * So the expectation is persisted — but it is stored as what it is:
     * `class: 'unknown'`, `source: 'category'`, no fares, no cost. A reader
     * cannot mistake it for something a source said.
     */
    const market = osmCandidate({ categories: ['market', 'food'], experienceTags: ['street-food'] });
    expect(market.admission).toBeUndefined();
    const place = reload(candidateToActivity(market));
    expect(place.admission).toMatchObject({
      class: 'unknown',
      expectation: 'spending-inside',
      source: 'category',
      confidence: 'low',
    });
    expect(place.admission?.fares).toBeUndefined();
    expect(place.admission?.typicalSpend).toBeUndefined();
    expect(place.estimatedCost).toBeUndefined();
  });

  it('is idempotent, key order included', () => {
    // The realtime sync compares JSON.stringify output. A reordered fare list
    // or a shifted key would make every echo of our own write look like a
    // remote change and loop the sync.
    const trip = tripWith([candidateToActivity(osmCandidate({ admission: ticketed() }))]);
    const once = sanitizeItinerary(trip, emptyItinerary);
    const twice = sanitizeItinerary(JSON.parse(JSON.stringify(once)), emptyItinerary);
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });
});

describe('the whole week of opening hours survives a save', () => {
  const splitWeek = {
    periods: [
      { daysOfWeek: [2, 3, 4, 5, 6, 0], opensAt: '08:30', closesAt: '12:00' },
      { daysOfWeek: [2, 3, 4, 5, 6, 0], opensAt: '13:00', closesAt: '16:30' },
    ],
    sourceConfidence: 'medium' as const,
  };

  const reloadedPlace = () => {
    const activity = candidateToActivity(osmCandidate({ openingHours: splitWeek }));
    const saved = sanitizeItinerary(tripWith([activity]), emptyItinerary);
    return sanitizeItinerary(JSON.parse(JSON.stringify(saved)), emptyItinerary).days[0].activities[0];
  };

  it('keeps both windows of a day that shuts for lunch', () => {
    // `openingHours` is `periods[0]` and always was, so the afternoon — most of
    // the visiting day — never reached the day card at all.
    expect(reloadedPlace().openingHoursWeek).toHaveLength(2);
  });

  it('keeps the weekdays each window applies to', () => {
    // Without these a Monday closure is invisible on the itinerary.
    expect(reloadedPlace().openingHoursWeek?.[0].days).toEqual([2, 3, 4, 5, 6, 0]);
  });

  it('preserves order rather than sorting', () => {
    const windows = reloadedPlace().openingHoursWeek;
    expect(windows?.[0].opensAt).toBe('08:30');
    expect(windows?.[1].opensAt).toBe('13:00');
  });

  it('leaves the single-window field alone for the conflict check', () => {
    expect(reloadedPlace().openingHours).toMatchObject({ opensAt: '08:30', closesAt: '12:00' });
  });

  it('drops a malformed window without losing the others', () => {
    const activity = {
      ...candidateToActivity(osmCandidate()),
      openingHoursWeek: [{ opensAt: '09:00', closesAt: '17:00', days: [1, 99, 'Tue'] }, null, 'nonsense'],
    };
    const saved = sanitizeItinerary(tripWith([activity as unknown as Activity]), emptyItinerary);
    const place = saved.days[0].activities[0];
    expect(place.openingHoursWeek).toHaveLength(1);
    expect(place.openingHoursWeek?.[0].days).toEqual([1]);
  });
});

describe('records written before any of this existed', () => {
  it('reloads without admission or weekly hours rather than failing', () => {
    // Every trip already saved predates both fields. Absent must stay absent.
    const legacy: Activity = {
      id: 'legacy-1',
      time: '10:00',
      name: 'Panda Base',
      description: 'From an older record.',
      type: 'sight',
      cost: '55 RMB',
    };
    const saved = sanitizeItinerary(tripWith([legacy]), emptyItinerary);
    const place = saved.days[0].activities[0];
    expect(place.admission).toBeUndefined();
    expect(place.openingHoursWeek).toBeUndefined();
    // The legacy display string is still readable, and still never written to.
    expect(place.cost).toBe('55 RMB');
  });

  it('stays idempotent for an old record too', () => {
    const legacy: Activity = { id: 'legacy-2', time: '10:00', name: 'Old stop', description: '', type: 'other', cost: '10 RMB' };
    const once = sanitizeItinerary(tripWith([legacy]), emptyItinerary);
    const twice = sanitizeItinerary(JSON.parse(JSON.stringify(once)), emptyItinerary);
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });
});

describe('revision ordering decides which write wins', () => {
  const at = (revision: number): Itinerary => ({ ...emptyItinerary, revision });

  it('accepts anything when there is nothing in hand yet', () => {
    expect(isNewerItineraryRevision(at(0), null)).toBe(true);
  });

  it('rejects the echo of a write already applied', () => {
    // The common case: our own debounced upsert coming back to us.
    expect(isNewerItineraryRevision(at(4), at(4))).toBe(false);
  });

  it('rejects a payload describing an older trip', () => {
    // The reported bug: a fetch resolving after a rebuild must not undo it.
    expect(isNewerItineraryRevision(at(3), at(7))).toBe(false);
  });

  it('accepts a genuinely newer one', () => {
    expect(isNewerItineraryRevision(at(8), at(7))).toBe(true);
  });

  it('treats a missing revision as the oldest possible', () => {
    const legacy = { ...emptyItinerary } as Itinerary;
    delete (legacy as { revision?: number }).revision;
    expect(isNewerItineraryRevision(legacy, at(1))).toBe(false);
  });
});

describe('flight duration survives sanitisation', () => {
  it('keeps a positive flight durationMinutes through save and reload', () => {
    const flight: Activity = {
      time: '10:00',
      name: 'HND → KIX',
      description: 'Arrival',
      type: 'flight',
      durationMinutes: 150,
    };
    const stored = JSON.parse(JSON.stringify(sanitizeItinerary(tripWith([flight]), emptyItinerary)));
    const reloaded = sanitizeItinerary(stored, emptyItinerary);
    expect(reloaded.days[0].activities[0]).toMatchObject({
      type: 'flight',
      time: '10:00',
      durationMinutes: 150,
    });
  });

  it('still loads a legacy flight that has no durationMinutes', () => {
    const flight: Activity = {
      time: '10:00',
      name: 'HND → KIX',
      description: 'Arrival',
      type: 'flight',
    };
    const saved = sanitizeItinerary(tripWith([flight]), emptyItinerary);
    expect(saved.days).toHaveLength(1);
    expect(saved.days[0].activities[0]).toMatchObject({ type: 'flight', time: '10:00', name: 'HND → KIX' });
    expect(saved.days[0].activities[0].durationMinutes).toBeUndefined();
  });
});
