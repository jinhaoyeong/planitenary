/**
 * Live place discovery.
 *
 * Returns PlaceCandidate records for any destination a connected provider can
 * answer for — there is no city whitelist. Every field is copied from the
 * provider response; nothing here is inferred or generated, because a
 * fabricated address or opening time is worse than an absent one.
 */
import {
  expiryFor,
  fetchJson,
  json,
  preflight,
  ProviderError,
  secrets,
} from '../_shared/providers.ts';
import {
  type CanonicalPlaceInput,
  linkCanonicalPlaces,
  readDiscoveryCache,
  serviceClient,
  writeDiscoveryCache,
} from '../_shared/cache.ts';
import { discoveryCityKey } from '../_shared/cacheKeys.ts';
import { attachPlaceRefs } from '../_shared/placeReference.ts';
import {
  categoryAdmission,
  mergeAdmission,
  osmAdmission,
  parseAdmissionText,
  type PlaceAdmission,
} from '../_shared/placeCost.ts';
import {
  isExcludedOsmPlace,
  osmCategories,
  osmDietaryOptions,
  osmElementCoordinates,
  osmIndoorOutdoor,
  osmNames,
  osmNotability,
  osmNotabilitySignals,
  osmOpeningCaveats,
  osmPlaceId,
  osmPriceLevel,
  osmVisitMinutes,
  parseOsmOpeningRules,
  type OsmElement,
} from '../_shared/osmPlaces.ts';
import { osmImageLeads, wikivoyageImageLeads, type ImageLead } from '../_shared/placeImages.ts';
import {
  matchListing,
  WIKIVOYAGE_CATEGORIES,
  parseWikivoyageListings,
  type WikivoyageListing,
} from '../_shared/wikivoyage.ts';
import {
  buildExactDiscoveryQueryPlan,
  buildDiscoveryQueryPlan,
  queryMatchesCandidate,
  selectDiscoveryEntries,
  type DiscoveryQueryEntry,
  type DiscoveryQueryPlan,
  type DiscoveryCandidateLike,
  type DiscoveryTrace,
  type PlannedDiscoveryQuery,
} from '../_shared/discoveryPlan.ts';
import {
  createRequestDeadline,
  DISCOVERY_REQUEST_BUDGET_MS,
  reserving,
  withinBudget,
  emptySourceReport,
  factualDiscoveryOutcome,
  settleFactualSource,
  type DiscoverySourceReport,
  type RequestDeadline,
} from '../_shared/discoveryResilience.ts';

interface DiscoverBody {
  city?: string;
  countryCode?: string;
  provider?: 'google' | 'osm' | 'amap' | 'baidu' | 'fixture';
  interests?: string[];
  /** Server-owned canonical-name lookup. Never used for Browse preferences. */
  exactQuery?: string;
  hiddenGems?: boolean;
  limit?: number;
  travelStartsInDays?: number;
  /**
   * The destination's coordinates, when the client already has them. Saves a
   * geocoding round trip; absent, the city is looked up instead.
   */
  lat?: number;
  lng?: number;
  /**
   * Who is waiting. Smart Plan discovers several cities to answer one press,
   * so it asks for tighter source deadlines than a Browse deck does.
   */
  mode?: DiscoveryMode;
}

const selectPlannedRecords = <T extends DiscoveryCandidateLike>(
  entries: readonly DiscoveryQueryEntry<T>[],
  plan: DiscoveryQueryPlan,
  limit: number,
): Array<T & { discoveryTrace: DiscoveryTrace }> => selectDiscoveryEntries(entries, plan, limit)
  .map(({ candidate, trace }) => ({ ...candidate, discoveryTrace: trace }));

/** Google place types → the app's category vocabulary. */
const TYPE_CATEGORIES: Record<string, string> = {
  tourist_attraction: 'essential',
  museum: 'museum',
  art_gallery: 'art',
  park: 'park',
  restaurant: 'food',
  cafe: 'cafes',
  market: 'market',
  shopping_mall: 'shopping',
  place_of_worship: 'temple',
  hindu_temple: 'temple',
  church: 'temple',
  mosque: 'temple',
  synagogue: 'temple',
  night_club: 'nightlife',
  bar: 'evening',
  zoo: 'wildlife',
  aquarium: 'aquarium',
  amusement_park: 'theme-park',
  performing_arts_theater: 'theatre',
  natural_feature: 'nature',
};

/**
 * Typical visit length by category. A rough default only — real evidence
 * overrides it, and it is never presented as a verified fact.
 */
const DEFAULT_VISIT_MINUTES: Record<string, number> = {
  museum: 120,
  art: 100,
  park: 75,
  market: 90,
  essential: 100,
  temple: 60,
  nightlife: 120,
  'theme-park': 300,
  aquarium: 150,
};

interface GooglePlace {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  types?: string[];
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  websiteUri?: string;
  internationalPhoneNumber?: string;
  editorialSummary?: { text?: string };
  regularOpeningHours?: {
    periods?: Array<{
      // `day` is 0–6 with 0 as Sunday, matching Date.getDay().
      open?: { day?: number; hour?: number; minute?: number };
      close?: { day?: number; hour?: number; minute?: number };
    }>;
  };
  businessStatus?: string;
  addressComponents?: Array<{ longText?: string; types?: string[] }>;
}

interface AmapPoi {
  id?: string;
  name?: string;
  address?: string;
  location?: string;
  type?: string;
  typecode?: string;
  tel?: string;
  website?: string;
  rating?: string;
  biz_ext?: { rating?: string; cost?: string };
}

interface BaiduPoi {
  uid?: string;
  name?: string;
  address?: string;
  location?: { lat?: number; lng?: number };
  telephone?: string;
  detail_info?: { overall_rating?: string; price?: string; detail_url?: string; tag?: string };
}
const PRICE_LEVELS: Record<string, number> = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

/**
 * Amap's `biz_ext.cost` and Baidu's `detail_info.price` are a typical per-head
 * spend, not an entry fee — so this is `spend-based` rather than `ticketed`,
 * and the distinction survives to the card. Both providers only cover mainland
 * China, so the currency is not in doubt.
 */
function regionalSpend(value?: string): PlaceAdmission | undefined {
  const amount = Number(String(value ?? '').trim());
  if (!Number.isFinite(amount) || amount <= 0) return undefined;
  return {
    class: 'spend-based',
    typicalSpend: { audience: 'person', amount, currency: 'CNY' },
    source: 'provider',
    confidence: 'medium',
  };
}

const pad = (value: number) => String(value).padStart(2, '0');

/**
 * Google publishes one period per weekday. Reading only `periods[0]` applied
 * one day's hours to the whole week, so a place shut on Mondays looked open —
 * the same weekly-closure bug the OSM parser now avoids.
 */
function toOpeningHours(place: GooglePlace) {
  const periods = (place.regularOpeningHours?.periods || []).flatMap((period) => {
    const { open, close } = period;
    if (open?.hour === undefined || close?.hour === undefined) return [];
    // A period that closes on a different day crosses midnight, which the
    // scheduler cannot represent; omitted rather than truncated.
    if (close.day !== undefined && open.day !== undefined && close.day !== open.day) return [];
    return [{
      daysOfWeek: open.day === undefined ? undefined : [open.day],
      opensAt: `${pad(open.hour)}:${pad(open.minute ?? 0)}`,
      closesAt: `${pad(close.hour)}:${pad(close.minute ?? 0)}`,
    }];
  });
  if (periods.length === 0) return undefined;
  return {
    periods,
    // Provider hours are good but not authoritative for a specific date.
    sourceConfidence: 'medium' as const,
  };
}

function categoriesFor(place: GooglePlace): string[] {
  const mapped = (place.types || [])
    .map((type) => TYPE_CATEGORIES[type])
    .filter((category): category is string => Boolean(category));
  return mapped.length > 0 ? [...new Set(mapped)] : ['essential'];
}

/** The most specific administrative area Google gives us, as a neighbourhood. */
function neighbourhoodFor(place: GooglePlace): string | undefined {
  const components = place.addressComponents || [];
  for (const type of ['sublocality_level_1', 'sublocality', 'neighborhood', 'locality']) {
    const hit = components.find((component) => component.types?.includes(type));
    if (hit?.longText) return hit.longText;
  }
  return undefined;
}

function toCandidate(
  place: GooglePlace,
  city: string,
  countryCode: string,
  retrievedAt: string,
  expiresAt: string,
) {
  if (!place.id || !place.displayName?.text) return null;
  if (!place.location?.latitude || !place.location?.longitude) return null;
  // A place the provider says is gone must never enter a plan.
  if (place.businessStatus === 'CLOSED_PERMANENTLY') return null;

  const categories = categoriesFor(place);
  const visitMinutes = DEFAULT_VISIT_MINUTES[categories[0]] ?? 90;

  return {
    id: `google-${place.id}`,
    provider: 'google' as const,
    providerPlaceId: place.id,
    name: place.displayName.text,
    description: place.editorialSummary?.text,
    countryCode,
    city,
    neighbourhood: neighbourhoodFor(place),
    coordinates: [place.location.latitude, place.location.longitude] as [number, number],
    categories,
    experienceTags: categories,
    rating: place.rating,
    reviewCount: place.userRatingCount,
    // Google's band is restaurant spend, not admission — the two are different
    // questions and `priceLevel` keeps answering only the first.
    priceLevel: place.priceLevel ? PRICE_LEVELS[place.priceLevel] : undefined,
    admission: mergeAdmission(categoryAdmission(categories)),
    openingHours: toOpeningHours(place),
    estimatedVisitMinutes: visitMinutes,
    indoorOutdoor: 'mixed' as const,
    reservationStatus: 'unknown' as const,
    address: place.formattedAddress,
    website: place.websiteUri,
    phone: place.internationalPhoneNumber,
    sourceConfidence: (place.rating && place.userRatingCount && place.userRatingCount > 50
      ? 'high'
      : 'medium') as 'high' | 'medium',
    sourceReferences: [{
      label: 'Google Places',
      url: place.websiteUri || `https://www.google.com/maps/place/?q=place_id:${place.id}`,
      retrievedAt,
    }],
    lastVerifiedAt: retrievedAt,
    expiresAt,
  };
}

const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.types',
  'places.rating',
  'places.userRatingCount',
  'places.priceLevel',
  'places.websiteUri',
  'places.internationalPhoneNumber',
  'places.editorialSummary',
  'places.regularOpeningHours',
  'places.businessStatus',
  'places.addressComponents',
].join(',');

/**
 * One text-search query's ceiling, and the point below which starting one
 * buys nothing.
 *
 * Google, Amap and Baidu answer a whole query per round trip, so the ceiling is
 * the old `fetchJson` default made explicit. It is a ceiling, not a duration:
 * every call clamps it to whatever the request deadline actually has left, which
 * is the difference between bounding a source and bounding a request. Seven
 * sequential 8s queries under a 45s budget was the shape of the defect.
 */
const TEXT_SEARCH_TIMEOUT_MS = 8_000;
const TEXT_SEARCH_MINIMUM_VIABLE_MS = 2_000;

/** A cache lookup that takes longer than this is slower than asking the sources. */
const CACHE_READ_TIMEOUT_MS = 3_000;

/**
 * The slice of the budget held back for work that happens after the sources
 * answer: the cache write and the canonical-place link. Both are database round
 * trips with no timeout of their own, so letting the sources spend the whole
 * budget and then running them would put unbounded work after a bounded clock.
 */
const RESPONSE_TAIL_RESERVE_MS = 4_000;

async function searchGoogle(
  city: string,
  countryCode: string,
  limit: number,
  travelStartsInDays: number | undefined,
  plan: DiscoveryQueryPlan,
  deadline: RequestDeadline,
  report: DiscoverySourceReport,
) {
  const key = secrets.google();
  if (!key) throw new ProviderError('Google Places is not configured.', 503);

  const retrievedAt = new Date().toISOString();
  const expiresAt = expiryFor('placeIdentity', travelStartsInDays);
  const entries: Array<DiscoveryQueryEntry<NonNullable<ReturnType<typeof toCandidate>>>> = [];
  let lastProviderError: ProviderError | undefined;

  /**
   * Returns false when the request has no budget left for another query, so the
   * caller stops instead of queueing more work the deadline cannot pay for.
   */
  const run = async (query: PlannedDiscoveryQuery): Promise<boolean> => {
    const budgetMs = deadline.allow(TEXT_SEARCH_TIMEOUT_MS, TEXT_SEARCH_MINIMUM_VIABLE_MS);
    if (budgetMs === null) {
      report.deadlineExceeded = true;
      return false;
    }
    const payload = await fetchJson('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': FIELD_MASK,
      },
      body: JSON.stringify({
        textQuery: `${query.text} in ${city}`,
        maxResultCount: 20,
        languageCode: 'en',
      }),
    }, budgetMs).catch((error) => {
      // One failed intent must not sink the whole discovery run.
      console.warn(`Discovery query "${query.text}" failed:`, error.message);
      if (error instanceof ProviderError) lastProviderError = error;
      return null;
    });

    for (const place of ((payload as { places?: GooglePlace[] } | null)?.places) || []) {
      const candidate = toCandidate(place, city, countryCode, retrievedAt, expiresAt);
      if (candidate) entries.push({ candidate, query });
    }
    return true;
  };

  // Preference queries run first. Once validated and deduped preferred results
  // fill the target, no generic query is sent at all.
  for (const query of plan.preferredQueries) {
    if (!(await run(query))) break;
    if (selectDiscoveryEntries(entries, plan, limit).length >= limit) break;
  }
  if (selectDiscoveryEntries(entries, plan, limit).length < limit) {
    for (const query of plan.fallbackQueries) {
      if (!(await run(query))) break;
      if (selectDiscoveryEntries(entries, plan, limit).length >= limit) break;
    }
  }

  // If every intent failed, preserve the provider failure rather than
  // mislabelling a credentials/API restriction problem as an empty city.
  if (entries.length === 0 && lastProviderError) throw lastProviderError;
  return selectPlannedRecords(entries, plan, limit);
}

function regionalCandidate(
  provider: 'amap' | 'baidu',
  place: AmapPoi | BaiduPoi,
  city: string,
  countryCode: string,
  retrievedAt: string,
  expiresAt: string,
) {
  const isAmap = provider === 'amap';
  const amap = place as AmapPoi;
  const baidu = place as BaiduPoi;
  const id = isAmap ? amap.id : baidu.uid;
  const name = isAmap ? amap.name : baidu.name;
  const coordinates = isAmap
    ? (amap.location || '').split(',').map(Number)
    : [Number(baidu.location?.lat), Number(baidu.location?.lng)];
  if (!id || !name || coordinates.length !== 2 || coordinates.some((value) => !Number.isFinite(value))) return null;
  const url = isAmap
    ? (amap.website || `https://www.amap.com/search?query=${encodeURIComponent(name)}`)
    : (baidu.detail_info?.detail_url || `https://map.baidu.com/search/${encodeURIComponent(name)}`);
  const rating = Number(isAmap ? (amap.biz_ext?.rating || amap.rating) : baidu.detail_info?.overall_rating);
  const providerDescription = String(isAmap ? (amap.type || '') : (baidu.detail_info?.tag || '')).toLowerCase();
  const categories = providerCategories(providerDescription);
  return {
    id: `${provider}-${id}`,
    provider,
    providerPlaceId: id,
    name,
    description: isAmap ? amap.type : baidu.detail_info?.tag,
    countryCode,
    city,
    address: isAmap ? amap.address : baidu.address,
    coordinates: [coordinates[0], coordinates[1]] as [number, number],
    categories,
    experienceTags: [...categories, 'regional-provider'],
    rating: Number.isFinite(rating) ? rating : undefined,
    notability: Number.isFinite(rating) && rating >= 4.5 ? 0.65 : undefined,
    // Both providers publish a typical per-head spend, declared in the
    // interfaces above and never read until now. It is spending, not admission,
    // and it says so — but a source stated it, so it is a fact rather than an
    // inference from the category. Currency is unambiguous for these two.
    admission: regionalSpend(isAmap ? amap.biz_ext?.cost : baidu.detail_info?.price),
    estimatedVisitMinutes: 90,
    indoorOutdoor: 'mixed' as const,
    reservationStatus: 'unknown' as const,
    sourceConfidence: 'medium' as const,
    sourceReferences: [{ label: provider === 'amap' ? 'Amap' : 'Baidu Maps', url, retrievedAt }],
    lastVerifiedAt: retrievedAt,
    expiresAt,
  };
}

/** Regional providers expose free-form type strings instead of Google types. */
function providerCategories(description: string): string[] {
  const categories: string[] = [];
  const add = (test: RegExp, category: string) => { if (test.test(description)) categories.push(category); };
  add(/food|restaurant|cafe|coffee|market|餐饮|美食|咖啡|市场/, 'food');
  add(/shop|mall|retail|shopping|商场|购物/, 'shopping');
  add(/museum|gallery|art|博物馆|美术|艺术/, 'museum');
  add(/temple|shrine|church|mosque|寺|庙|神社|教堂/, 'temple');
  add(/history|historic|heritage|historical|历史|古迹/, 'history');
  add(/park|garden|nature|mountain|hiking|自然|公园|花园|山/, 'nature');
  add(/beach|waterfront|coast|海滩|海滨/, 'waterfront');
  add(/night|bar|club|夜|酒吧/, 'nightlife');
  add(/theatre|theater|opera/, 'theatre');
  add(/market/, 'market');
  return [...new Set(categories.length > 0 ? categories : ['essential'])];
}

async function searchAmap(
  city: string,
  countryCode: string,
  limit: number,
  travelStartsInDays: number | undefined,
  plan: DiscoveryQueryPlan,
  deadline: RequestDeadline,
  report: DiscoverySourceReport,
) {
  const key = secrets.amap();
  if (!key) throw new ProviderError('Amap is not configured.', 503);
  const retrievedAt = new Date().toISOString();
  const expiresAt = expiryFor('placeIdentity', travelStartsInDays);
  const entries: Array<DiscoveryQueryEntry<NonNullable<ReturnType<typeof regionalCandidate>>>> = [];
  /** Returns false when no budget remains for another query. */
  const run = async (query: PlannedDiscoveryQuery): Promise<boolean> => {
    const budgetMs = deadline.allow(TEXT_SEARCH_TIMEOUT_MS, TEXT_SEARCH_MINIMUM_VIABLE_MS);
    if (budgetMs === null) {
      report.deadlineExceeded = true;
      return false;
    }
    const params = new URLSearchParams({ key, keywords: query.text, city, citylimit: 'true', offset: '20', page: '1', extensions: 'all' });
    const payload = await fetchJson(`https://restapi.amap.com/v5/place/text?${params}`, {}, budgetMs) as { status?: string; pois?: AmapPoi[] };
    for (const place of payload.pois || []) {
      const candidate = regionalCandidate('amap', place, city, countryCode, retrievedAt, expiresAt);
      if (candidate) entries.push({ candidate, query });
    }
    return true;
  };
  for (const query of plan.preferredQueries) {
    if (!(await run(query))) break;
    if (selectDiscoveryEntries(entries, plan, limit).length >= limit) break;
  }
  if (selectDiscoveryEntries(entries, plan, limit).length < limit) {
    for (const query of plan.fallbackQueries) {
      if (!(await run(query))) break;
      if (selectDiscoveryEntries(entries, plan, limit).length >= limit) break;
    }
  }
  return selectPlannedRecords(entries, plan, limit);
}

async function searchBaidu(
  city: string,
  countryCode: string,
  limit: number,
  travelStartsInDays: number | undefined,
  plan: DiscoveryQueryPlan,
  deadline: RequestDeadline,
  report: DiscoverySourceReport,
) {
  const key = secrets.baidu();
  if (!key) throw new ProviderError('Baidu Maps is not configured.', 503);
  const retrievedAt = new Date().toISOString();
  const expiresAt = expiryFor('placeIdentity', travelStartsInDays);
  const entries: Array<DiscoveryQueryEntry<NonNullable<ReturnType<typeof regionalCandidate>>>> = [];
  /** Returns false when no budget remains for another query. */
  const run = async (query: PlannedDiscoveryQuery): Promise<boolean> => {
    const budgetMs = deadline.allow(TEXT_SEARCH_TIMEOUT_MS, TEXT_SEARCH_MINIMUM_VIABLE_MS);
    if (budgetMs === null) {
      report.deadlineExceeded = true;
      return false;
    }
    const params = new URLSearchParams({ query: query.text, region: city, city_limit: 'true', output: 'json', ak: key, scope: '2' });
    const payload = await fetchJson(`https://api.map.baidu.com/place/v3/region?${params}`, {}, budgetMs) as { status?: number; results?: BaiduPoi[] };
    for (const place of payload.results || []) {
      const candidate = regionalCandidate('baidu', place, city, countryCode, retrievedAt, expiresAt);
      if (candidate) entries.push({ candidate, query });
    }
    return true;
  };
  for (const query of plan.preferredQueries) {
    if (!(await run(query))) break;
    if (selectDiscoveryEntries(entries, plan, limit).length >= limit) break;
  }
  if (selectDiscoveryEntries(entries, plan, limit).length < limit) {
    for (const query of plan.fallbackQueries) {
      if (!(await run(query))) break;
      if (selectDiscoveryEntries(entries, plan, limit).length >= limit) break;
    }
  }
  return selectPlannedRecords(entries, plan, limit);
}

// ---------------------------------------------------------------------------
// OpenStreetMap + Wikivoyage
// ---------------------------------------------------------------------------

/**
 * Wikimedia and Nominatim both require a descriptive User-Agent and will block
 * anonymous traffic. Identifying the app is a condition of using them.
 */
const USER_AGENT = 'Planitenary/1.0 (travel itinerary planner; +https://github.com/planitenary)';

interface CityArea {
  centre: [number, number];
  radiusMetres: number;
}

/**
 * A candidate from the keyless sources. Written out rather than inferred so the
 * OSM and Wikivoyage builders are held to one shape.
 */
interface OpenCandidate {
  id: string;
  provider: 'osm' | 'wikivoyage';
  providerPlaceId: string;
  name: string;
  localName?: string;
  description?: string;
  countryCode: string;
  city: string;
  neighbourhood?: string;
  coordinates: [number, number];
  categories: string[];
  experienceTags: string[];
  notability: number;
  notabilitySignals?: string[];
  /** Pointers to a real photograph, resolved later — see `osmImageLeads`. */
  imageLeads?: ImageLead[];
  dietaryOptions?: string[];
  priceLevel?: number;
  admission?: PlaceAdmission;
  openingHours?: {
    periods: Array<{ daysOfWeek: number[]; opensAt: string; closesAt: string }>;
    sourceConfidence: 'low';
    caveats?: string[];
  };
  estimatedVisitMinutes: number;
  indoorOutdoor: 'indoor' | 'outdoor' | 'mixed';
  reservationStatus: 'unknown';
  address?: string;
  website?: string;
  phone?: string;
  sourceConfidence: 'high' | 'medium';
  sourceReferences: Array<{ label: string; url: string; retrievedAt: string }>;
  lastVerifiedAt: string;
  expiresAt: string;
}

/**
 * Where to search, and how wide.
 *
 * The client already knows its destination's coordinates, so the common path
 * costs nothing. Nominatim is the fallback, and its bounding box gives a far
 * better radius than a fixed guess — a city state and a small town should not
 * be searched at the same scale.
 */
async function resolveCityArea(
  city: string,
  countryCode: string,
  lat?: number,
  lng?: number,
  budgetMs: number = GEOCODE_TIMEOUT_MS,
): Promise<CityArea> {
  if (typeof lat === 'number' && typeof lng === 'number') {
    return { centre: [lat, lng], radiusMetres: 12_000 };
  }

  const params = new URLSearchParams({ q: city, format: 'json', limit: '1' });
  if (countryCode) params.set('countrycodes', countryCode.toLowerCase());
  const payload = await fetchJson(
    `https://nominatim.openstreetmap.org/search?${params}`,
    { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } },
    budgetMs,
  ).catch(() => null);

  const hit = Array.isArray(payload) ? payload[0] as Record<string, unknown> : null;
  const centreLat = Number(hit?.lat);
  const centreLng = Number(hit?.lon);
  if (!Number.isFinite(centreLat) || !Number.isFinite(centreLng)) {
    throw new ProviderError(`Could not locate ${city}.`, 404);
  }

  // boundingbox is [southLat, northLat, westLng, eastLng] as strings.
  const box = (hit?.boundingbox as string[] | undefined)?.map(Number);
  let radiusMetres = 12_000;
  if (box?.length === 4 && box.every(Number.isFinite)) {
    const latSpanMetres = Math.abs(box[1] - box[0]) * 111_320;
    const lngSpanMetres = Math.abs(box[3] - box[2]) * 111_320 * Math.cos(centreLat * Math.PI / 180);
    radiusMetres = Math.max(latSpanMetres, lngSpanMetres) / 2;
  }
  return {
    centre: [centreLat, centreLng],
    // Clamped: a country-sized relation must not trigger a continent-wide query.
    radiusMetres: Math.round(Math.max(4_000, Math.min(25_000, radiusMetres))),
  };
}

/**
 * One Overpass query for the whole shortlist.
 *
 * The paid path needed seven text searches because it had to *describe* what it
 * wanted. OSM objects carry their own classification, so a single query asks
 * for every kind of place at once and the tags say which is which — seven
 * billed requests become one free one.
 *
 * Restaurants and cafés are deliberately absent. A city holds thousands, and an
 * unranked list of them is noise; curated food comes from Wikivoyage's `eat`
 * listings instead, which is a better answer than the first 200 by proximity.
 */
const overpassClausesFor = (categories: readonly string[], scope: string): string[] => {
  const wanted = new Set(categories);
  const clauses: string[] = [];
  const add = (clause: string) => { if (!clauses.includes(clause)) clauses.push(clause); };
  if (wanted.has('essential') || wanted.has('architecture')) {
    add(`nwr["tourism"="attraction"]["name"]${scope};`);
  }
  if (wanted.has('museum')) add(`nwr["tourism"="museum"]["name"]${scope};`);
  if (wanted.has('art')) {
    add(`nwr["tourism"~"^(gallery|artwork)$"]["name"]${scope};`);
    add(`nwr["amenity"="arts_centre"]["name"]${scope};`);
  }
  if (wanted.has('view')) add(`nwr["tourism"="viewpoint"]["name"]${scope};`);
  if (wanted.has('wildlife')) add(`nwr["tourism"="zoo"]["name"]${scope};`);
  if (wanted.has('aquarium')) add(`nwr["tourism"="aquarium"]["name"]${scope};`);
  if (wanted.has('theme-park')) add(`nwr["tourism"="theme_park"]["name"]${scope};`);
  if (wanted.has('history')) add(`nwr["historic"]["name"]${scope};`);
  if (wanted.has('temple') || wanted.has('shrine')) add(`nwr["amenity"="place_of_worship"]["name"]${scope};`);
  if (wanted.has('market') || wanted.has('local-character')) add(`nwr["amenity"="marketplace"]["name"]${scope};`);
  if (wanted.has('nightlife') || wanted.has('evening')) {
    add(`nwr["amenity"~"^(nightclub|bar|pub|theatre)$"]["name"]${scope};`);
  }
  if (wanted.has('park') || wanted.has('garden') || wanted.has('nature')) {
    add(`nwr["leisure"~"^(park|garden|nature_reserve)$"]["name"]${scope};`);
    add(`nwr["natural"~"^(peak|volcano|wood)$"]["name"]${scope};`);
  }
  if (wanted.has('beaches')) add(`nwr["natural"="beach"]["name"]${scope};`);
  if (wanted.has('waterfront')) add(`nwr["natural"~"^(water|bay)$"]["name"]${scope};`);
  if (wanted.has('shopping')) add(`nwr["shop"~"^(mall|department_store)$"]["name"]${scope};`);
  return clauses;
};

/**
 * How long a factual source may hold a request, by what is waiting on it.
 *
 * Browse can afford a slow, thorough sweep: the traveller asked for a deck and
 * is watching it load. Smart Plan cannot. Planning discovers several cities to
 * answer one press of "Plan day 1", so a 45s ceiling per city is not a slow
 * request, it is an abandoned one — production showed ~47s Overpass failures
 * three times over inside a single 149s planning call.
 */
const OVERPASS_TIMEOUT_MS = { browse: 45_000, planning: 22_000 } as const;
/** Geocoding and Wikivoyage ceilings, named so the request budget can add them up. */
const GEOCODE_TIMEOUT_MS = 8_000;
const WIKIVOYAGE_TIMEOUT_MS = 12_000;
/**
 * Planning fits one full round — geocode, Wikivoyage, one Overpass round — with
 * enough left for a fallback round only when the earlier sources were quick.
 * The number itself is shared, because the browser derives its deadline from it.
 */
/** Below this there is not enough left for an Overpass round to return anything. */
const OVERPASS_MINIMUM_VIABLE_MS = 8_000;
const OVERPASS_FOOD_TIMEOUT_MS = { browse: 35_000, planning: 12_000 } as const;
/**
 * Planning asks for fewer results as well as sooner.
 *
 * Waiting less only helps if the query is also cheaper — a measured Overpass
 * run for one city took 10.8s and 19.0s for a query lighter than Browse's, so
 * a short deadline over a heavy query is just a guaranteed timeout. Smart Plan
 * fills a handful of gaps, not a deck, so it asks for a fraction of the rows.
 */
const OVERPASS_RESULT_CAP = { browse: 400, planning: 120 } as const;
export type DiscoveryMode = keyof typeof OVERPASS_TIMEOUT_MS;

async function fetchOverpassPlaces(
  area: CityArea,
  categories: readonly string[],
  mode: DiscoveryMode = 'browse',
  budgetMs: number = OVERPASS_TIMEOUT_MS[mode],
): Promise<OsmElement[]> {
  const [lat, lng] = area.centre;
  const scope = `(around:${area.radiusMetres},${lat},${lng})`;
  const clauses = overpassClausesFor(categories, scope);
  if (clauses.length === 0) return [];
  // Keep Overpass's own budget under our abort, so it answers rather than hangs.
  const serverTimeout = Math.max(5, Math.round(budgetMs / 1000) - 5);
  const query = `[out:json][timeout:${serverTimeout}];
(
  ${clauses.join('\n  ')}
);
out center tags ${OVERPASS_RESULT_CAP[mode]};`;

  const payload = await fetchJson(
    secrets.overpassEndpoint(),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
      body: `data=${encodeURIComponent(query)}`,
    },
    budgetMs,
  );
  const elements = (payload as { elements?: OsmElement[] } | null)?.elements;
  return Array.isArray(elements) ? elements : [];
}

/**
 * Somewhere to eat, as a separate and much smaller query.
 *
 * The sights query excludes food on purpose: a city holds thousands of
 * restaurants and an unranked list of them is noise. But a plan that reserves
 * eighty-five minutes for lunch and names no restaurant is not a plan, so food
 * is fetched deliberately, with two filters that cut the volume to something
 * useful:
 *
 *   - a `cuisine` tag, which is what lets a day match a traveller's taste and
 *     is absent from the long tail of unmaintained entries;
 *   - a name, so it can be put in front of a person.
 *
 * Wikivoyage's `eat` listings are merged on top of this and rank higher, being
 * hand-picked rather than merely present.
 */
async function fetchOverpassFood(
  area: CityArea,
  mode: DiscoveryMode = 'browse',
  budgetMs: number = OVERPASS_FOOD_TIMEOUT_MS[mode],
): Promise<OsmElement[]> {
  const [lat, lng] = area.centre;
  // Tighter than the sights radius: nobody crosses a city for an average lunch.
  const radius = Math.min(area.radiusMetres, 8_000);
  const serverTimeout = Math.max(5, Math.round(budgetMs / 1000) - 5);
  const query = `[out:json][timeout:${serverTimeout}];
(
  nwr["amenity"~"^(restaurant|cafe|fast_food)$"]["name"]["cuisine"](around:${radius},${lat},${lng});
  nwr["amenity"="marketplace"]["name"](around:${radius},${lat},${lng});
);
out center tags 150;`;

  const payload = await fetchJson(
    secrets.overpassEndpoint(),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
      body: `data=${encodeURIComponent(query)}`,
    },
    budgetMs,
  ).catch(() => null);

  const elements = (payload as { elements?: OsmElement[] } | null)?.elements;
  return Array.isArray(elements) ? elements : [];
}

/**
 * Wikivoyage's curated listings for one city. One request per city, never per
 * place — per-place enrichment is exactly the fan-out that made the previous
 * provider expensive.
 *
 * A missing page is normal (not every town has one) and returns an empty list
 * rather than failing discovery.
 */
async function fetchWikivoyageListings(
  city: string,
  budgetMs: number = WIKIVOYAGE_TIMEOUT_MS,
): Promise<WikivoyageListing[]> {
  const params = new URLSearchParams({
    action: 'parse',
    page: city,
    prop: 'wikitext',
    format: 'json',
    formatversion: '2',
    redirects: '1',
  });
  const payload = await fetchJson(
    `https://en.wikivoyage.org/w/api.php?${params}`,
    { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } },
    budgetMs,
  ).catch(() => null);

  const wikitext = (payload as { parse?: { wikitext?: string } } | null)?.parse?.wikitext;
  return typeof wikitext === 'string' ? parseWikivoyageListings(wikitext) : [];
}

const WIKIVOYAGE_URL = (city: string) => `https://en.wikivoyage.org/wiki/${encodeURIComponent(city)}`;

/**
 * Discovery from sources that cannot be billed.
 *
 * OSM supplies coverage and structure; Wikivoyage supplies editorial judgement
 * and prose. Neither has a rating, so significance comes from `notability` —
 * see `osmNotability` for why documentation is a defensible substitute.
 */
async function searchOsm(
  city: string,
  countryCode: string,
  limit: number,
  travelStartsInDays: number | undefined,
  plan: DiscoveryQueryPlan,
  coordinates?: { lat?: number; lng?: number },
  mode: DiscoveryMode = 'browse',
  report?: DiscoverySourceReport,
  deadline: RequestDeadline = createRequestDeadline(DISCOVERY_REQUEST_BUDGET_MS[mode]),
) {
  const retrievedAt = new Date().toISOString();
  const expiresAt = expiryFor('placeIdentity', travelStartsInDays);
  const area = await resolveCityArea(
    city,
    countryCode,
    coordinates?.lat,
    coordinates?.lng,
    deadline.allow(GEOCODE_TIMEOUT_MS, 0) ?? GEOCODE_TIMEOUT_MS,
  );

  const usedListings = new Set<WikivoyageListing>();
  const wikivoyageBudget = deadline.allow(WIKIVOYAGE_TIMEOUT_MS, 1_000);
  const listings = wikivoyageBudget === null ? [] : await settleFactualSource(
    () => fetchWikivoyageListings(city, wikivoyageBudget),
    [] as WikivoyageListing[],
    (error) => {
      if (report) report.wikivoyageFailed = true;
      console.warn(`[travel-discover] wikivoyage_error city=${city}:`, error);
    },
  );

  const fetchBatch = async (queries: readonly PlannedDiscoveryQuery[]): Promise<Array<DiscoveryQueryEntry<OpenCandidate>>> => {
    if (queries.length === 0) return [];
    const categories = [...new Set(queries.flatMap((query) => query.categories))];
    const wantsFood = categories.some((category) => FOOD_CATEGORIES.includes(category));
    /**
     * What is left of the request, not what this source would like.
     *
     * Starting a 22s round with 4s to run cannot return anything and still
     * spends the 4s, so below the viable minimum the round is not attempted and
     * the request says so rather than reporting the city as empty.
     */
    const placesBudget = deadline.allow(OVERPASS_TIMEOUT_MS[mode], OVERPASS_MINIMUM_VIABLE_MS);
    if (placesBudget === null) {
      if (report) report.deadlineExceeded = true;
      console.warn(`[travel-discover] deadline_exceeded city=${city} mode=${mode}`);
      return [];
    }
    const foodBudget = Math.min(OVERPASS_FOOD_TIMEOUT_MS[mode], placesBudget);
    /**
     * Independent sources, so one being down must not sink the other.
     *
     * This comment was here before the catch was. `fetchOverpassPlaces` sat
     * unprotected inside the `Promise.all` while only the food query was
     * guarded, so an Overpass timeout rejected the batch and threw away the
     * Wikivoyage listings already fetched above — turning a single source
     * outage into a total discovery failure, a 502, and, upstream, a Smart
     * Plan that silently believed no verified place existed.
     */
    const [elements, food] = await Promise.all([
      settleFactualSource(
        () => fetchOverpassPlaces(area, categories, mode, placesBudget),
        [] as OsmElement[],
        (error) => {
          if (report) report.overpassFailed = true;
          console.warn(`[travel-discover] overpass_error city=${city}:`, error);
        },
      ),
      wantsFood
        ? settleFactualSource(() => fetchOverpassFood(area, mode, foodBudget), [] as OsmElement[])
        : Promise.resolve([] as OsmElement[]),
    ]);
    const byKey = new Map<string, OpenCandidate>();

    for (const element of [...elements, ...food]) {
      const candidate = buildOsmCandidate(element, city, countryCode, retrievedAt, expiresAt, listings);
      if (!candidate || !queries.some((query) => queryMatchesCandidate(candidate, query))) continue;
      const listing = matchListing({ name: candidate.name, coordinates: candidate.coordinates }, listings);
      if (listing) usedListings.add(listing);
      // OSM often holds the same place as both a node and an enclosing way.
      const key = `${candidate.name.toLowerCase()}|${candidate.coordinates[0].toFixed(3)},${candidate.coordinates[1].toFixed(3)}`;
      const existing = byKey.get(key);
      if (!existing || candidate.notability > existing.notability) byKey.set(key, candidate);
    }

    // Curated places OSM did not return — most usefully the food listings, which
    // the Overpass query deliberately skips.
    for (const listing of listings) {
    if (usedListings.has(listing) || !listing.coordinates) continue;
    const categories = WIKIVOYAGE_CATEGORIES[listing.kind];
    if (!queries.some((query) => queryMatchesCandidate({ categories, experienceTags: categories }, query))) continue;
    // Wikivoyage `hours` is free text written by an editor, but it follows the
    // same shapes often enough ("Tu-Su 10:00-18:00") to be worth reading, and
    // anything unrecognised yields no rule rather than a guess.
    const hours = parseOsmOpeningRules(listing.hours);
    const hoursCaveats = osmOpeningCaveats(listing.hours);
    byKey.set(`wv|${listing.name.toLowerCase()}`, {
      id: `wikivoyage-${encodeURIComponent(listing.name)}`,
      provider: 'wikivoyage' as const,
      providerPlaceId: `wv:${listing.name}`,
      name: listing.name,
      description: listing.content,
      countryCode,
      city,
      coordinates: listing.coordinates,
      categories,
      experienceTags: categories,
      /**
       * The listing's own pointers at a photograph of itself, which cost no
       * request: they came down with the city page above.
       *
       * Until this line every Wikivoyage-sourced candidate reached the card
       * with no leads at all and therefore always showed the placard — 28 of
       * the 60 places on a Fukuoka deck, half of which state a Wikidata item,
       * an article or a file name right there in the listing. Nothing here is
       * derived from the listing's *name*: only fields an editor wrote.
       */
      imageLeads: wikivoyageImageLeads(listing),
      // A hand-written guidebook entry is a strong significance signal on its own.
      notability: 0.6,
      priceLevel: undefined,
      // `listing.price` has been parsed by `wikivoyage.ts` all along and
      // discarded here — this branch used to hardcode `priceLevel: undefined`
      // with the price sitting in scope one line away.
      admission: mergeAdmission(
        parseAdmissionText(listing.price, countryCode, 'wikivoyage'),
        categoryAdmission(categories),
      ),
      openingHours: hours.length > 0
        ? { periods: hours, sourceConfidence: 'low' as const, caveats: hoursCaveats }
        : undefined,
      estimatedVisitMinutes: osmVisitMinutes(categories),
      indoorOutdoor: 'mixed' as const,
      reservationStatus: 'unknown' as const,
      address: listing.address,
      website: listing.url,
      phone: undefined,
      sourceConfidence: 'medium' as const,
      sourceReferences: [{ label: 'Wikivoyage', url: listing.url || WIKIVOYAGE_URL(city), retrievedAt }],
      lastVerifiedAt: retrievedAt,
      expiresAt,
    });
    }

    /**
     * Preserve the query group that admitted each candidate. The shared selector
     * applies preference-first ordering, deduplication and bounded fallback
     * after this provider-specific enrichment is complete.
     */
    return [...byKey.values()].flatMap((candidate) => {
      const query = queries.find((entry) => queryMatchesCandidate(candidate, entry));
      return query ? [{ candidate, query }] : [];
    });
    };

  const preferredEntries = await fetchBatch(plan.preferredQueries);
  let entries = preferredEntries;
  /**
   * A second round is a second whole Overpass timeout, and it is only worth
   * starting when both things are true: the source is still answering, and
   * there is enough of the request budget left to hear the answer.
   *
   * A timeout is evidence the source is unavailable for this request, not a
   * reason to ask it again with fallback categories — that retry is what
   * produced the 55-76s 503s in production. Budget is the other half: without
   * it the fallback round ran regardless, which is how a legitimately
   * progressing request reached 56-64s while the client had already given up.
   */
  const canRetry = !report?.overpassFailed
    && deadline.allow(OVERPASS_TIMEOUT_MS[mode], OVERPASS_MINIMUM_VIABLE_MS) !== null;
  if (selectDiscoveryEntries(entries, plan, limit).length < limit && canRetry) {
    entries = [...entries, ...(await fetchBatch(plan.fallbackQueries))];
  }
  return selectPlannedRecords(entries, plan, limit);
}

/** Categories that make a place somewhere to eat rather than somewhere to see. */
const FOOD_CATEGORIES = ['food', 'cafes', 'street-food', 'market'];

function buildOsmCandidate(
  element: OsmElement,
  city: string,
  countryCode: string,
  retrievedAt: string,
  expiresAt: string,
  listings: WikivoyageListing[],
): OpenCandidate | null {
  const tags = element.tags || {};
  if (isExcludedOsmPlace(tags)) return null;

  const placeId = osmPlaceId(element);
  const coordinates = osmElementCoordinates(element);
  const { name, localName } = osmNames(tags);
  if (!placeId || !coordinates || !name) return null;

  const categories = osmCategories(tags);
  // Nothing in the tags says what kind of place this is, so nothing here can
  // honestly describe it to a traveller.
  if (categories.length === 0) return null;

  const listing = matchListing({ name, coordinates }, listings);

  // "japanese;sushi" → two tags the ranker can match a traveller's styles to.
  const cuisines = (tags.cuisine || '')
    .split(';')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  const hours = parseOsmOpeningRules(tags.opening_hours);
  // A guidebook entry is independent corroboration, so it lifts significance.
  const notability = Math.min(1, osmNotability(tags) + (listing ? 0.35 : 0));

  return {
    id: `osm-${placeId}`,
    provider: 'osm' as const,
    providerPlaceId: placeId,
    name,
    localName,
    // Wikivoyage prose beats a bare tag list for explaining why to go.
    description: listing?.content,
    countryCode,
    city,
    neighbourhood: tags['addr:suburb'] || tags['addr:district'] || tags['addr:city'] || undefined,
    coordinates,
    categories,
    experienceTags: [...new Set([...categories, ...cuisines])],
    notability,
    // The same signals `notability` sums, kept by name so the panel can say
    // *why* a place is significant instead of asserting that it is.
    notabilitySignals: [
      ...osmNotabilitySignals(tags),
      ...(listing ? ['appears in the Wikivoyage city guide'] : []),
    ],
    /**
     * Where a real photograph of this place might be found — pointers only,
     * resolved later by `travel-images` for the handful of cards a traveller
     * actually reaches.
     *
     * Derived from tags already in this Overpass response, so it costs no
     * extra request. Resolving images *here* would mean one lookup per place
     * across a sixty-place shortlist, which is the fan-out shape that made the
     * previous provider expensive.
     */
    imageLeads: osmImageLeads(tags),
    dietaryOptions: osmDietaryOptions(tags),
    priceLevel: osmPriceLevel(tags),
    // `osmPriceLevel` answers one question — is entry free — and this branch
    // read only that, ignoring both the `charge` tag already in the Overpass
    // payload and any price the matched guidebook listing carried.
    admission: mergeAdmission(
      osmAdmission(tags, countryCode),
      parseAdmissionText(listing?.price, countryCode, 'wikivoyage'),
      categoryAdmission(categories),
    ),
    openingHours: hours.length > 0
      // Low, deliberately: OSM hours are community-maintained, and this parser
      // reads weekdays but not holidays, seasons or sunrise-relative times.
      // `caveats` names whichever of those the source actually published, so
      // the omission is stated rather than silent.
      ? { periods: hours, sourceConfidence: 'low' as const, caveats: osmOpeningCaveats(tags.opening_hours) }
      : undefined,
    estimatedVisitMinutes: osmVisitMinutes(categories),
    indoorOutdoor: osmIndoorOutdoor(tags),
    reservationStatus: 'unknown' as const,
    address: [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ') || undefined,
    website: tags.website || tags['contact:website'],
    phone: tags.phone || tags['contact:phone'],
    sourceConfidence: (listing || tags.wikidata ? 'high' : 'medium') as 'high' | 'medium',
    sourceReferences: [
      { label: 'OpenStreetMap', url: `https://www.openstreetmap.org/${element.type}/${element.id}`, retrievedAt },
      ...(listing ? [{ label: 'Wikivoyage', url: WIKIVOYAGE_URL(city), retrievedAt }] : []),
    ],
    lastVerifiedAt: retrievedAt,
    expiresAt,
  };
}

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const body = (await request.json().catch(() => ({}))) as DiscoverBody;
  const city = typeof body.city === 'string' ? body.city.trim() : '';
  if (!city) return json({ error: 'A destination city is required.' }, 400);

  const countryCode = (body.countryCode || '').toUpperCase();
  const limit = Math.max(1, Math.min(120, body.limit ?? 60));
  const interests = Array.isArray(body.interests)
    ? body.interests.filter((interest): interest is string => typeof interest === 'string')
    : [];
  const exactQuery = typeof body.exactQuery === 'string'
    ? body.exactQuery.trim().replace(/\s+/g, ' ').slice(0, 160)
    : '';
  const plan = exactQuery
    ? buildExactDiscoveryQueryPlan(exactQuery, limit)
    : buildDiscoveryQueryPlan(interests, limit, { hiddenGems: body.hiddenGems === true });

  // Mainland China needs a regional provider; say so plainly rather than
  // returning thin Google results that look like a working answer.
  if (countryCode === 'CN' && !secrets.amap() && !secrets.baidu()) {
    return json({ error: 'No mapping provider is configured for mainland China.' }, 503);
  }

  try {
    // The client's capability model already chose a provider; honour it. Only
    // when it asks for nothing specific does the server pick, preferring a
    // configured commercial provider and falling back to the keyless one —
    // which always works, so there is no unavailable case left outside China.
    const requested = body.provider;
    const selectedProvider = requested === 'amap' || requested === 'baidu' || requested === 'osm'
      ? requested
      : requested === 'google' && secrets.google() ? 'google'
        : countryCode === 'CN' && secrets.amap() ? 'amap'
          : countryCode === 'CN' && secrets.baidu() ? 'baidu'
            : secrets.google() ? 'google' : 'osm';

    // Read-through: repeating a search for the same city must not re-buy the
    // provider's results. Place identity is the slowest-moving data the app
    // holds — 30 days normally, 7 near travel — so this is the single largest
    // reduction in provider calls available.
    const cache = serviceClient();
    const cityKey = discoveryCityKey(
      city,
      countryCode,
      exactQuery ? [`exact:${exactQuery}`] : plan.selectedStyles,
    );

    /**
     * Give every candidate a canonical identity while we hold the full record.
     * The evidence cache keys on canonical place id and has no coordinates of
     * its own to create one from later, so a place that never gets linked here
     * can never have its (expensive) reviews cached.
     *
     * Runs on the cache-hit path too: linking is best-effort, and if it failed
     * once, leaving it unrepaired would mean paying for that place's reviews on
     * every single run until the discovery cache expires.
     */
    const withPlaceRefs = async (records: unknown[]): Promise<unknown[]> => {
      if (!cache) return records;
      const places: CanonicalPlaceInput[] = records.flatMap((record) => {
        const candidate = record as Partial<CanonicalPlaceInput> & { coordinates?: [number, number] };
        if (!candidate.providerPlaceId || !candidate.name || !candidate.coordinates) return [];
        return [{
          providerPlaceId: candidate.providerPlaceId,
          name: candidate.name,
          city: candidate.city || city,
          countryCode: candidate.countryCode || countryCode,
          coordinates: candidate.coordinates,
          neighbourhood: candidate.neighbourhood,
          address: candidate.address,
          website: candidate.website,
          phone: candidate.phone,
        }];
      });
      if (places.length === 0) return records;

      /**
       * The one moment the server can prove all three parts of a place's
       * identity at once, so this is where the reference is made.
       *
       * `provider` is `selectedProvider` — the provider the link table is
       * keyed by — and never `candidate.provider`, which records where the
       * *listing* came from. A Wikivoyage listing found on an OSM run carries
       * `provider: 'wikivoyage'` and is linked under `'osm'`; the ACROS case
       * proved those diverge, and asking under the wrong one returns nothing
       * at all, silently.
       *
       * Attached at serve time rather than stored in the discovery cache. That
       * is deliberate: a stored field would be absent from every row written
       * before it existed and stay absent for the row's full TTL — the exact
       * month-long silence `DISCOVERY_SCHEMA_VERSION` v4 was bumped for. A
       * reference derived on the way out cannot go stale, so cached rows from
       * before this change serve references from their first request.
       */
      /**
       * Enrichment, not the answer. If the link cannot be made inside what the
       * request has left, the records go back without refs rather than holding
       * the response open on a database call nothing can abort.
       */
      const canonical = await withinBudget(
        deadline.remainingMs(),
        new Map<string, string>(),
        () => linkCanonicalPlaces(cache, selectedProvider, places),
      );
      return attachPlaceRefs(records, selectedProvider, canonical);
    };

    const mode: DiscoveryMode = body.mode === 'planning' ? 'planning' : 'browse';
    const sourceReport: DiscoverySourceReport = emptySourceReport();
    /**
     * One clock for the whole request, started before the cache is read.
     *
     * It used to start after it. That made the advertised budget describe the
     * source work rather than the request, and left three untimed database
     * round trips - the cache read here, the write and the canonical link
     * below - outside the only deadline the client was told about.
     */
    const deadline = createRequestDeadline(DISCOVERY_REQUEST_BUDGET_MS[mode]);
    /** Sources stop early enough to leave the tail its reserved slice. */
    const sourceDeadline = reserving(deadline, RESPONSE_TAIL_RESERVE_MS);

    if (cache) {
      const cached = await withinBudget(
        deadline.allow(CACHE_READ_TIMEOUT_MS, 0) ?? 0,
        null,
        () => readDiscoveryCache(cache, cityKey, selectedProvider),
      );
      if (cached && cached.length > 0) {
        return json(await withPlaceRefs(cached.slice(0, limit)));
      }
    }
    const candidates = selectedProvider === 'amap'
      ? await searchAmap(city, countryCode, limit, body.travelStartsInDays, plan, sourceDeadline, sourceReport)
      : selectedProvider === 'baidu'
        ? await searchBaidu(city, countryCode, limit, body.travelStartsInDays, plan, sourceDeadline, sourceReport)
        : selectedProvider === 'osm'
          ? await searchOsm(
            city,
            countryCode,
            limit,
            body.travelStartsInDays,
            plan,
            { lat: body.lat, lng: body.lng },
            mode,
            sourceReport,
            sourceDeadline,
          )
          : await searchGoogle(city, countryCode, limit, body.travelStartsInDays, plan, sourceDeadline, sourceReport);
    if (candidates.length === 0) {
      /**
       * An outage is not an absence, and the difference is the whole point.
       *
       * "No places were returned" is a factual claim about the city. It may
       * only be made when the sources actually answered. When they failed,
       * say so, so the planner can tell a traveller the sources were
       * unreachable rather than that their city holds nothing worth seeing.
       */
      const verdict = factualDiscoveryOutcome({ candidateCount: candidates.length, report: sourceReport });
      console.warn(
        `[travel-discover] ${verdict === 'sources-unavailable' ? 'sources_unavailable' : 'no_candidates'}`
        + ` city=${city} provider=${selectedProvider} mode=${mode}`
        + ` overpassFailed=${sourceReport.overpassFailed} wikivoyageFailed=${sourceReport.wikivoyageFailed}`
        + ` deadlineExceeded=${sourceReport.deadlineExceeded} remainingMs=${deadline.remainingMs()}`,
      );
      return verdict === 'sources-unavailable'
        ? json({
          error: `Place sources could not be reached for ${city}.`,
          code: 'discovery-sources-unavailable',
          sourceReport,
        }, 503)
        : json({ error: `No places were returned for ${city}.` }, 404);
    }

    if (cache) {
      // Best effort: a slow write must not delay places the traveller already has.
      await withinBudget(deadline.remainingMs(), undefined, () => writeDiscoveryCache(
        cache,
        cityKey,
        selectedProvider,
        candidates,
        expiryFor('placeIdentity', body.travelStartsInDays),
      ));
      return json(await withPlaceRefs(candidates));
    }

    return json(candidates);
  } catch (error) {
    const status = error instanceof ProviderError ? error.status : 502;
    return json({ error: error instanceof Error ? error.message : 'Discovery failed.' }, status);
  }
});
