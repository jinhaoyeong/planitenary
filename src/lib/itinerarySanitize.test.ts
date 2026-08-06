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
