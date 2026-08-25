import { parseStructuredPlaceRef, type StructuredPlaceRef } from '../../supabase/functions/_shared/placeReference';
import { parsePlaceImage } from '../../supabase/functions/_shared/placeImages';
import type { Activity, Itinerary } from '../data';

export const VERIFIED_IMAGE_VALIDATION_VERSION = 3;

export interface VerifiedImageAsset {
  imageKey: string;
  url: string;
  thumbnailUrl?: string;
  sourcePageUrl: string;
  attribution: string;
  license: string;
  licenseUrl?: string;
  validationVersion: typeof VERIFIED_IMAGE_VALIDATION_VERSION;
}

export interface TripCoverRef {
  type: 'user' | 'place' | 'destination' | 'illustration' | 'generated-surface';
  selectedAt: string;
  canonicalPlaceId?: string;
  city?: string;
  asset?: VerifiedImageAsset;
  placeRef?: StructuredPlaceRef;
}

const text = (value: unknown, max: number): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;

export function parseVerifiedImageAsset(value: unknown): VerifiedImageAsset | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const parsed = parsePlaceImage({
    url: raw.url,
    thumbnailUrl: raw.thumbnailUrl,
    sourcePage: raw.sourcePageUrl,
    attribution: raw.attribution,
    licence: raw.license,
    licenceUrl: raw.licenseUrl,
    source: 'wikimedia-commons',
    lead: 'wikidata',
  });
  const imageKey = text(raw.imageKey, 300);
  const attribution = text(raw.attribution, 500);
  if (!parsed || !imageKey || !attribution || raw.validationVersion !== VERIFIED_IMAGE_VALIDATION_VERSION) return undefined;
  return {
    imageKey,
    url: parsed.url,
    thumbnailUrl: parsed.thumbnailUrl,
    sourcePageUrl: parsed.sourcePage,
    // `parsePlaceImage` proves the asset and licence, but older records do not
    // retain a separate author field from which it can rebuild the same credit.
    // Keep the bounded original credit line so attribution survives surfaces.
    attribution,
    license: parsed.licence,
    licenseUrl: parsed.licenceUrl,
    validationVersion: VERIFIED_IMAGE_VALIDATION_VERSION,
  };
}

export function parseTripCoverRef(value: unknown): TripCoverRef | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const type = ['user', 'place', 'destination', 'illustration', 'generated-surface']
    .find((candidate) => candidate === raw.type) as TripCoverRef['type'] | undefined;
  const selectedAt = text(raw.selectedAt, 80);
  if (!type || !selectedAt) return undefined;
  const asset = parseVerifiedImageAsset(raw.asset);
  if ((type === 'place' || type === 'destination') && !asset) return undefined;
  return {
    type,
    selectedAt,
    canonicalPlaceId: text(raw.canonicalPlaceId, 120),
    city: text(raw.city, 120),
    asset,
    placeRef: parseStructuredPlaceRef(raw.placeRef),
  };
}

export function verifiedImageFromActivity(activity: Activity): VerifiedImageAsset | undefined {
  if (!activity.photoUrl || !activity.photoSourcePage || !activity.photoAttribution || !activity.photoLicense) return undefined;
  return parseVerifiedImageAsset({
    imageKey: activity.photoImageKey || activity.photoSourcePage,
    url: activity.photoUrl,
    thumbnailUrl: activity.photoThumbnailUrl,
    sourcePageUrl: activity.photoSourcePage,
    attribution: activity.photoAttribution,
    license: activity.photoLicense,
    licenseUrl: activity.photoLicenseUrl,
    validationVersion: VERIFIED_IMAGE_VALIDATION_VERSION,
  });
}

const candidateActivities = (itinerary: Itinerary): Activity[] => [
  ...itinerary.days.flatMap((day) => day.activities),
  ...(itinerary.unassignedActivities ?? []),
];

const stableHash = (value: string): number => {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

/**
 * Pick a stable factual cover. Diversity is a tie-breaker only: a correct
 * repeated photograph wins over an unrelated photograph every time.
 */
export function resolveTripCover(
  itinerary: Itinerary,
  usedImageKeys: ReadonlySet<string> = new Set(),
): TripCoverRef {
  const explicit = parseTripCoverRef(itinerary.tripCover);
  if (explicit?.type === 'user') return explicit;

  const primaryCity = itinerary.cities[0]?.trim();
  const tripCities = new Set(itinerary.cities.map((city) => city.trim().toLowerCase()).filter(Boolean));
  const factual = candidateActivities(itinerary).flatMap((activity) => {
    const asset = verifiedImageFromActivity(activity);
    const ref = parseStructuredPlaceRef(activity.placeRef);
    const activityCity = activity.city?.trim().toLowerCase();
    // Diversity is never permission to put an unrelated city's photograph on
    // the trip. Multi-city trips may use any city they explicitly contain.
    if (!asset || !ref || (tripCities.size > 0 && (!activityCity || !tripCities.has(activityCity)))) return [];
    const decision = itinerary.discoveryState?.decisions ?? {};
    const activityId = activity.id ?? '';
    const candidateId = activityId.startsWith('discovered-') ? activityId.slice('discovered-'.length) : activityId;
    const mustDo = Boolean(candidateId && decision[candidateId] === 'must-do');
    const cityMatch = Boolean(primaryCity && activity.city?.toLowerCase() === primaryCity.toLowerCase());
    const unused = !usedImageKeys.has(asset.imageKey);
    return [{
      activity,
      asset,
      ref,
      score: (mustDo ? 8 : 0) + (cityMatch ? 4 : 0) + (unused ? 2 : 0),
      tie: stableHash(`${itinerary.id}:${asset.imageKey}`),
    }];
  }).sort((left, right) => right.score - left.score
    || right.tie - left.tie);

  const selected = factual[0];
  if (selected) {
    return {
      type: 'place',
      selectedAt: itinerary.tripCover?.selectedAt || new Date(0).toISOString(),
      canonicalPlaceId: selected.ref.canonicalPlaceId,
      city: selected.activity.city,
      asset: selected.asset,
      placeRef: selected.ref,
    };
  }

  return {
    type: 'generated-surface',
    selectedAt: itinerary.tripCover?.selectedAt || new Date(0).toISOString(),
    city: primaryCity,
  };
}

/** Stable, non-photographic fallback identity used by both hero and dashboard. */
export function tripCoverSurface(itineraryId: string, city?: string) {
  const hash = stableHash(`${itineraryId}:${city ?? ''}`);
  const hue = Math.abs(hash) % 360;
  return {
    backgroundColor: `hsl(${hue} 28% 88%)`,
    color: `hsl(${hue} 30% 22%)`,
  };
}
