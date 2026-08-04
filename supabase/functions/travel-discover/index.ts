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

interface DiscoverBody {
  city?: string;
  countryCode?: string;
  provider?: 'google' | 'amap' | 'baidu' | 'fixture';
  interests?: string[];
  limit?: number;
  travelStartsInDays?: number;
}

/** Search phrases that between them cover how people actually plan a trip. */
const DISCOVERY_QUERIES = [
  { text: 'top attractions', categories: ['essential'] },
  { text: 'museums and galleries', categories: ['museum', 'art'] },
  { text: 'markets and street food', categories: ['market', 'food'] },
  { text: 'historic sites', categories: ['history'] },
  { text: 'parks and gardens', categories: ['park', 'nature'] },
  { text: 'nightlife and evening', categories: ['evening', 'nightlife'] },
  { text: 'neighbourhoods to walk', categories: ['local-character'] },
];

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
      open?: { hour?: number; minute?: number };
      close?: { hour?: number; minute?: number };
    }>;
  };
  businessStatus?: string;
  addressComponents?: Array<{ longText?: string; types?: string[] }>;
}

const PRICE_LEVELS: Record<string, number> = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

const pad = (value: number) => String(value).padStart(2, '0');

function toOpeningHours(place: GooglePlace) {
  const period = place.regularOpeningHours?.periods?.[0];
  if (!period?.open || period.close === undefined) return undefined;
  const { open, close } = period;
  if (open.hour === undefined || close?.hour === undefined) return undefined;
  return {
    periods: [{
      opensAt: `${pad(open.hour)}:${pad(open.minute ?? 0)}`,
      closesAt: `${pad(close.hour)}:${pad(close.minute ?? 0)}`,
    }],
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
    priceLevel: place.priceLevel ? PRICE_LEVELS[place.priceLevel] : undefined,
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

async function searchGoogle(city: string, countryCode: string, limit: number, travelStartsInDays?: number) {
  const key = secrets.google();
  if (!key) throw new ProviderError('Google Places is not configured.', 503);

  const retrievedAt = new Date().toISOString();
  const expiresAt = expiryFor('placeIdentity', travelStartsInDays);
  const seen = new Map<string, ReturnType<typeof toCandidate>>();

  // One request per intent, so the shortlist spans a real trip rather than
  // returning twenty variations of the single most famous landmark.
  for (const query of DISCOVERY_QUERIES) {
    if (seen.size >= limit) break;
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
    }).catch((error) => {
      // One failed intent must not sink the whole discovery run.
      console.warn(`Discovery query "${query.text}" failed:`, error.message);
      return null;
    });

    for (const place of ((payload as { places?: GooglePlace[] } | null)?.places) || []) {
      if (seen.size >= limit) break;
      const candidate = toCandidate(place, city, countryCode, retrievedAt, expiresAt);
      if (candidate && !seen.has(candidate.providerPlaceId)) {
        seen.set(candidate.providerPlaceId, candidate);
      }
    }
  }

  return [...seen.values()];
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

  // Mainland China needs a regional provider; say so plainly rather than
  // returning thin Google results that look like a working answer.
  if (countryCode === 'CN' && !secrets.amap() && !secrets.baidu()) {
    return json({ error: 'No mapping provider is configured for mainland China.' }, 503);
  }

  try {
    const candidates = await searchGoogle(city, countryCode, limit, body.travelStartsInDays);
    if (candidates.length === 0) {
      return json({ error: `No places were returned for ${city}.` }, 404);
    }
    return json(candidates);
  } catch (error) {
    const status = error instanceof ProviderError ? error.status : 502;
    return json({ error: error instanceof Error ? error.message : 'Discovery failed.' }, status);
  }
});
