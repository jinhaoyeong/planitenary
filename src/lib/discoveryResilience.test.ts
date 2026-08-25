import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  emptySourceReport,
  factualDiscoveryOutcome,
  mapWithConcurrency,
  settleFactualSource,
} from '../../supabase/functions/_shared/discoveryResilience';
import {
  buildPlanningMaterial,
  planningPlaceFromDiscoveryCandidate,
} from '../../supabase/functions/_shared/itineraryProposal';

const discoverSource = readFileSync(
  new URL('../../supabase/functions/travel-discover/index.ts', import.meta.url),
  'utf8',
);
const agentSource = readFileSync(
  new URL('../../supabase/functions/planitenary-agent/index.ts', import.meta.url),
  'utf8',
);

/** Stand-ins for the two factual sources, so an outage can be produced on demand. */
const overpass = (elements: string[]) => vi.fn().mockResolvedValue(elements);
const downSource = () => vi.fn().mockRejectedValue(new Error('Request timed out'));

describe('factual source independence', () => {
  it('keeps Wikivoyage candidates when Overpass fails', async () => {
    const report = emptySourceReport();
    const [elements, listings] = await Promise.all([
      settleFactualSource(downSource(), [] as string[], () => { report.overpassFailed = true; }),
      settleFactualSource(overpass(['wv:Ohori Park']), [] as string[], () => { report.wikivoyageFailed = true; }),
    ]);

    expect(elements).toEqual([]);
    expect(listings).toEqual(['wv:Ohori Park']);
    expect(report).toEqual({ overpassFailed: true, wikivoyageFailed: false });
    expect(factualDiscoveryOutcome({ candidateCount: listings.length, report })).toBe('ok');
  });

  it('keeps OSM candidates when Wikivoyage fails', async () => {
    const report = emptySourceReport();
    const [elements] = await Promise.all([
      settleFactualSource(overpass(['osm:node/1']), [] as string[], () => { report.overpassFailed = true; }),
      settleFactualSource(downSource(), [] as string[], () => { report.wikivoyageFailed = true; }),
    ]);

    expect(elements).toEqual(['osm:node/1']);
    expect(report).toEqual({ overpassFailed: false, wikivoyageFailed: true });
    expect(factualDiscoveryOutcome({ candidateCount: elements.length, report })).toBe('ok');
  });

  it('reports an outage, not an absence, when every source fails', () => {
    const report = { overpassFailed: true, wikivoyageFailed: true };
    expect(factualDiscoveryOutcome({ candidateCount: 0, report })).toBe('sources-unavailable');
  });

  it('reports a genuine absence only when the sources actually answered', () => {
    expect(factualDiscoveryOutcome({ candidateCount: 0, report: emptySourceReport() })).toBe('no-candidates');
  });

  it('never lets a failing food source sink the sights that succeeded', async () => {
    const food = await settleFactualSource(downSource(), [] as string[]);
    const sights = await settleFactualSource(overpass(['osm:way/9']), [] as string[]);
    expect(food).toEqual([]);
    expect(sights).toEqual(['osm:way/9']);
  });
});

describe('bounded multi-city discovery', () => {
  it('never runs more cities at once than the width allows', async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency(['Osaka', 'Kyoto', 'Nara', 'Fukuoka'], 2, async (city) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return city;
    });

    expect(peak).toBe(2);
  });

  it('does not wait serially for every slow city', async () => {
    vi.useFakeTimers();
    try {
      const slow = (city: string) => new Promise<string>((resolve) => setTimeout(() => resolve(city), 10_000));
      const run = mapWithConcurrency(['Osaka', 'Kyoto', 'Nara', 'Fukuoka'], 2, (city) => slow(city));
      // Four cities at 10s each: serial would need 40s, two-wide needs 20s.
      await vi.advanceTimersByTimeAsync(20_000);
      await expect(run).resolves.toEqual(['Osaka', 'Kyoto', 'Nara', 'Fukuoka']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a successful city when another city fails', async () => {
    const results = await mapWithConcurrency(['Osaka', 'Kyoto'], 2, async (city) => {
      if (city === 'Kyoto') return { city, ok: false as const };
      return { city, ok: true as const };
    });

    expect(results.filter((entry) => entry.ok)).toEqual([{ city: 'Osaka', ok: true }]);
  });
});

describe('canonical identity stays mandatory while photography stays optional', () => {
  const candidate = (over: Record<string, unknown> = {}) => ({
    id: 'osm-n42',
    name: 'Ohori Park',
    city: 'Fukuoka',
    coordinates: [33.5859, 130.3792],
    categories: ['park'],
    estimatedVisitMinutes: 75,
    placeRef: { canonicalPlaceId: 'canonical-n42', provider: 'osm', providerPlaceId: 'n42' },
    sourceReferences: [{ label: 'OSM', url: 'https://www.openstreetmap.org/n42' }],
    ...over,
  });

  it('accepts a verified candidate that has no photograph', () => {
    const place = planningPlaceFromDiscoveryCandidate(candidate());
    expect(place).toMatchObject({ name: 'Ohori Park', city: 'Fukuoka', source: 'suggested' });
    expect(place?.image).toBeUndefined();
    expect(place?.placeRef?.canonicalPlaceId).toBe('canonical-n42');
  });

  it('still refuses a candidate with no canonical identity', () => {
    expect(planningPlaceFromDiscoveryCandidate(candidate({ placeRef: undefined }))).toBeUndefined();
  });

  it('still refuses a candidate with no coordinates', () => {
    expect(planningPlaceFromDiscoveryCandidate(candidate({ coordinates: undefined }))).toBeUndefined();
  });

  it('still refuses a candidate with no city', () => {
    expect(planningPlaceFromDiscoveryCandidate(candidate({ city: '' }))).toBeUndefined();
  });
});

describe('legacy saved-place identity recovery', () => {
  const legacyTrip = (activity: Record<string, unknown>) => ({
    id: 'trip-1',
    revision: 2,
    name: 'Fukuoka',
    cities: ['Fukuoka'],
    tripProfile: { destinations: [{ city: 'Fukuoka', countryCode: 'JP' }], styles: ['cafes'] },
    days: [{ day: 1, date: '2026-08-12', stayCity: 'Fukuoka', city: 'Fukuoka', activities: [activity] }],
  });

  const legacyActivity = (over: Record<string, unknown> = {}) => ({
    id: 'a1',
    kind: 'place',
    time: '10:00',
    durationMinutes: 60,
    name: 'Ohori Park',
    city: 'Fukuoka',
    type: 'sight',
    // Written before canonical refs existed: provider identity, no placeRef.
    provider: 'osm',
    providerPlaceId: 'n42',
    ...over,
  });

  it('carries provider identity so an unlinked saved place can still be recovered', async () => {
    const material = await buildPlanningMaterial('trip-1', legacyTrip(legacyActivity()));
    const place = material.places.find((entry) => entry.name === 'Ohori Park');

    expect(place).toBeDefined();
    expect(place?.placeRef).toBeUndefined();
    expect(place).toMatchObject({ provider: 'osm', providerPlaceId: 'n42' });
  });

  it('leaves a place with no provider identity genuinely unresolvable', async () => {
    const material = await buildPlanningMaterial(
      'trip-1',
      legacyTrip(legacyActivity({ provider: undefined, providerPlaceId: undefined })),
    );
    const place = material.places.find((entry) => entry.name === 'Ohori Park');

    expect(place?.placeRef).toBeUndefined();
    expect(place?.providerPlaceId).toBeUndefined();
  });

  it('repairs only from the provider link table, never by name', () => {
    expect(agentSource).toContain('readCanonicalPlaceIds(cache, provider, ids)');
    expect(agentSource).toContain('readCanonicalPlaceCoordinates(cache, [...canonicalByKey.values()])');
    // No name-similarity fallback, and no model in the repair path.
    expect(agentSource).not.toMatch(/repairSavedPlaceIdentity[\s\S]{0,2600}?callModel/);
    expect(agentSource).toContain('if (!canonicalPlaceId) return place;');
    expect(agentSource).toContain('if (!nextCoordinates) return place;');
  });
});

describe('deployed discovery boundaries', () => {
  it('protects the Overpass sights call that used to reject the whole batch', () => {
    expect(discoverSource).toContain('settleFactualSource(\n        () => fetchOverpassPlaces(area, categories, mode)');
    expect(discoverSource).not.toMatch(/Promise\.all\(\[\s*fetchOverpassPlaces\(/);
  });

  it('gives interactive planning a shorter source deadline than browsing', () => {
    expect(discoverSource).toContain('OVERPASS_TIMEOUT_MS = { browse: 45_000, planning: 12_000 }');
    expect(discoverSource).toContain('OVERPASS_FOOD_TIMEOUT_MS = { browse: 35_000, planning: 9_000 }');
  });

  it('separates an unreachable source from a city with nothing in it', () => {
    expect(discoverSource).toContain("code: 'discovery-sources-unavailable'");
    expect(discoverSource).toContain('}, 503)');
    expect(discoverSource).toContain('No places were returned for ${city}.` }, 404)');
  });

  it('reuses known destination coordinates instead of geocoding again', () => {
    expect(agentSource).toContain('lat: facts?.lat');
    expect(agentSource).toContain('lng: facts?.lng');
    expect(discoverSource).toContain('if (typeof lat === \'number\' && typeof lng === \'number\')');
  });

  it('bounds planning discovery by width and by one shared deadline', () => {
    expect(agentSource).toContain('PLANNING_DISCOVERY_CONCURRENCY = 2');
    expect(agentSource).toContain('PLANNING_DISCOVERY_DEADLINE_MS');
    expect(agentSource).toContain('mapWithConcurrency(cities, PLANNING_DISCOVERY_CONCURRENCY');
    expect(agentSource).not.toMatch(/for \(const city of cities\) \{/);
  });

  it('tells the traveller the sources failed rather than blaming their places', () => {
    expect(agentSource).toContain("? 'discovery_unavailable' as const");
    expect(agentSource).toContain('The place sources could not be reached just now');
    // The outage must be decided before the saved-place complaint.
    expect(agentSource.indexOf("'discovery_unavailable' as const"))
      .toBeLessThan(agentSource.indexOf("'unresolvable_places' as const"));
  });

  it('logs a diagnosable category for each planning discovery attempt', () => {
    for (const category of ['planning_discovery success', 'sources_unavailable', 'deadline_exceeded']) {
      expect(agentSource).toContain(category);
    }
  });
});
