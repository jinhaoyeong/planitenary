/**
 * Destination capability resolution.
 *
 * The old model asked "is this city in our fixture registry?" and answered
 * "unavailable" for everywhere except three hand-built cities. This module asks
 * the only question that actually matters:
 *
 *   Which live providers can supply reliable information for this destination?
 *
 * Capability is resolved from the destination's *country/region* plus which
 * backends are actually reachable at runtime — never from a hardcoded city
 * whitelist. Fixtures survive only as a labelled fallback for tests, demos and
 * provider outages; they no longer decide which destinations the product
 * supports.
 */

import type { TripDestination } from './tripProfile';

/** How trustworthy a given signal is for a destination, right now. */
export type ProviderAvailability =
  | 'live'
  /** Served from a captured fixture. Honest, but not current. */
  | 'fixture'
  /** Only reachable via links the traveller pastes or shares in. */
  | 'user-shared-only'
  | 'unavailable';

export type PlaceProviderId = 'google' | 'amap' | 'baidu' | 'fixture';
export type RouteProviderId = 'google-routes' | 'amap' | 'baidu' | 'offline';

export interface EvidenceCapability {
  official: ProviderAvailability;
  googleReviews: ProviderAvailability;
  youtube: ProviderAvailability;
  tripadvisor: ProviderAvailability;
  tiktok: ProviderAvailability;
  douyin: ProviderAvailability;
  rednote: ProviderAvailability;
}

export interface DestinationCapability {
  destination: {
    city: string;
    region?: string;
    countryCode: string;
  };
  places: { provider: PlaceProviderId; status: ProviderAvailability };
  routes: { provider: RouteProviderId; status: ProviderAvailability };
  evidence: EvidenceCapability;
  weather: ProviderAvailability;
  events: ProviderAvailability;
  photos: ProviderAvailability;
}

/**
 * Which backends are wired up in this deployment. The client learns this from
 * the server rather than reading provider keys itself — keys stay in Supabase
 * function secrets and must never reach a `VITE_*` variable.
 */
export interface ProviderRuntime {
  googlePlaces: boolean;
  googleRoutes: boolean;
  googleReviews: boolean;
  youtube: boolean;
  tripadvisor: boolean;
  officialSources: boolean;
  weather: boolean;
  events: boolean;
  /** Mainland-China map providers. */
  amap: boolean;
  baidu: boolean;
  /** Approved partner access to short-video platforms, per platform. */
  tiktokPartner: boolean;
  douyinPartner: boolean;
  rednotePartner: boolean;
  /** Captured fixtures available as an offline fallback. */
  fixtures: boolean;
}

/** Nothing connected: the honest default before the server reports back. */
export const EMPTY_PROVIDER_RUNTIME: ProviderRuntime = {
  googlePlaces: false,
  googleRoutes: false,
  googleReviews: false,
  youtube: false,
  tripadvisor: false,
  officialSources: false,
  weather: false,
  events: false,
  amap: false,
  baidu: false,
  tiktokPartner: false,
  douyinPartner: false,
  rednotePartner: false,
  fixtures: true,
};

/**
 * Mainland China. Google map and review products are not dependable there, so
 * these destinations resolve onto regional providers instead. Hong Kong, Macau
 * and Taiwan are deliberately absent — Google works normally in those regions.
 */
const REGIONAL_MAP_COUNTRIES = new Set(['CN']);

/** Countries where Douyin and RedNote are the dominant travel-video sources. */
const CHINESE_SOCIAL_COUNTRIES = new Set(['CN', 'HK', 'MO', 'TW']);

const isMainlandChina = (countryCode: string) => REGIONAL_MAP_COUNTRIES.has(countryCode.toUpperCase());

/**
 * Social platforms are capability-gated, not scraped. Without approved partner
 * access a platform is still useful — the traveller can paste a link and we
 * resolve it — so it reports `user-shared-only` rather than `unavailable`.
 */
const socialAvailability = (partnerApproved: boolean): ProviderAvailability =>
  partnerApproved ? 'live' : 'user-shared-only';

const liveOr = (enabled: boolean, fallback: ProviderAvailability = 'unavailable'): ProviderAvailability =>
  enabled ? 'live' : fallback;

/**
 * Resolve what the product can honestly offer for one destination.
 *
 * `fixtureCities` is the small set of cities with captured place libraries. It
 * only ever *downgrades* to a labelled fallback when the live provider for that
 * region is unreachable — it can never be the reason a destination is called
 * unsupported.
 */
export function resolveDestinationCapability(
  destination: Pick<TripDestination, 'city' | 'region' | 'countryCode'>,
  runtime: ProviderRuntime = EMPTY_PROVIDER_RUNTIME,
  fixtureCities: readonly string[] = [],
): DestinationCapability {
  const countryCode = (destination.countryCode || '').toUpperCase();
  const city = destination.city.trim();
  const regional = isMainlandChina(countryCode);
  const hasFixture = runtime.fixtures
    && fixtureCities.some((fixtureCity) => fixtureCity.toLowerCase() === city.toLowerCase());

  // --- Places -------------------------------------------------------------
  let places: DestinationCapability['places'];
  if (regional && runtime.amap) {
    places = { provider: 'amap', status: 'live' };
  } else if (regional && runtime.baidu) {
    places = { provider: 'baidu', status: 'live' };
  } else if (!regional && runtime.googlePlaces) {
    places = { provider: 'google', status: 'live' };
  } else if (hasFixture) {
    places = { provider: 'fixture', status: 'fixture' };
  } else {
    places = { provider: 'fixture', status: 'unavailable' };
  }

  // --- Routes -------------------------------------------------------------
  let routes: DestinationCapability['routes'];
  if (regional && runtime.amap) {
    routes = { provider: 'amap', status: 'live' };
  } else if (regional && runtime.baidu) {
    routes = { provider: 'baidu', status: 'live' };
  } else if (!regional && runtime.googleRoutes) {
    routes = { provider: 'google-routes', status: 'live' };
  } else {
    // Straight-line estimation always works, and is always labelled as such.
    routes = { provider: 'offline', status: 'fixture' };
  }

  // --- Evidence -----------------------------------------------------------
  const chineseSocial = CHINESE_SOCIAL_COUNTRIES.has(countryCode);
  const evidence: EvidenceCapability = {
    official: liveOr(runtime.officialSources, hasFixture ? 'fixture' : 'unavailable'),
    // Google review coverage follows the same regional split as Google places.
    googleReviews: liveOr(runtime.googleReviews && !regional),
    youtube: liveOr(runtime.youtube),
    tripadvisor: liveOr(runtime.tripadvisor && !regional),
    tiktok: socialAvailability(runtime.tiktokPartner),
    douyin: chineseSocial || runtime.douyinPartner
      ? socialAvailability(runtime.douyinPartner)
      : 'user-shared-only',
    rednote: chineseSocial || runtime.rednotePartner
      ? socialAvailability(runtime.rednotePartner)
      : 'user-shared-only',
  };

  return {
    destination: { city, region: destination.region, countryCode },
    places,
    routes,
    evidence,
    weather: liveOr(runtime.weather),
    events: liveOr(runtime.events),
    photos: places.status === 'live' ? 'live' : places.status,
  };
}

/** True when we can put real, current places in front of the traveller. */
export const hasLiveDiscovery = (capability: DestinationCapability): boolean =>
  capability.places.status === 'live';

/** True when discovery can run at all, live or from a labelled fixture. */
export const canDiscover = (capability: DestinationCapability): boolean =>
  capability.places.status === 'live' || capability.places.status === 'fixture';

/**
 * Every evidence stream the traveller could contribute to by pasting a link.
 * Drives the "share a link" affordance instead of a dead end.
 */
export function userSharedEvidenceSources(capability: DestinationCapability): string[] {
  return Object.entries(capability.evidence)
    .filter(([, status]) => status === 'user-shared-only')
    .map(([source]) => source);
}

/**
 * One honest sentence about how current the plan can be. Never claims a source
 * is live when it is a fixture, and never hides a gap behind silence.
 */
export function describeCapability(capability: DestinationCapability): string {
  const { city } = capability.destination;
  if (capability.places.status === 'live') {
    const streams = [
      capability.evidence.googleReviews === 'live' && 'traveller reviews',
      capability.evidence.youtube === 'live' && 'recent videos',
      capability.evidence.official === 'live' && 'official sources',
    ].filter((entry): entry is string => Boolean(entry));
    return streams.length > 0
      ? `Live places for ${city}, checked against ${streams.join(', ')}.`
      : `Live places for ${city}.`;
  }
  if (capability.places.status === 'fixture') {
    return `Showing captured places for ${city}. These are real but may be out of date.`;
  }
  return `Smart discovery isn’t available for ${city} yet. You can still add places manually.`;
}
