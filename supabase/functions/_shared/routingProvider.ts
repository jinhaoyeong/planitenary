/**
 * Deterministic routing-provider and endpoint-identity rules.
 *
 * This module deliberately has no imports and no Deno APIs. Both the agent
 * adapter and `travel-route-matrix` use these exact rules, while Vitest can
 * exercise them without loading provider credentials or making a request.
 */

export type DeterministicRoutingProvider = 'amap' | 'openrouteservice';
export type RequestedRoutingMode = 'walking' | 'driving' | 'cycling' | 'public-transport';
export type ProviderRoutingMode = 'walking' | 'foot-walking' | 'driving-car' | 'cycling-regular';

export interface RoutingProviderAvailability {
  amap: boolean;
  openRouteService: boolean;
}

export type RoutingProviderSelection =
  | {
    status: 'selected';
    provider: DeterministicRoutingProvider;
    requestedMode: RequestedRoutingMode;
    providerMode: ProviderRoutingMode;
  }
  | { status: 'route-unavailable'; reason: string };

/** The modes implemented by the hosted providers this application calls. */
export function providerModeFor(
  provider: DeterministicRoutingProvider,
  requestedMode: RequestedRoutingMode,
): ProviderRoutingMode | undefined {
  if (provider === 'amap') return requestedMode === 'walking' ? 'walking' : undefined;
  if (requestedMode === 'walking') return 'foot-walking';
  if (requestedMode === 'driving') return 'driving-car';
  if (requestedMode === 'cycling') return 'cycling-regular';
  return undefined;
}

const countryCode = (value: string | undefined): string | undefined => {
  const normalised = value?.trim().toUpperCase();
  return normalised && /^[A-Z]{2}$/.test(normalised) ? normalised : undefined;
};

/**
 * Choose a provider from server-owned geography, never from model output.
 *
 * Mainland China is deliberately isolated from the general ORS path. A mixed
 * China/non-China request crosses provider coverage boundaries and is refused
 * rather than routed by whichever credential happens to exist. Multiple
 * known non-China countries are safe for ORS because it follows the global
 * OpenStreetMap road graph; an unknown country is not silently guessed.
 */
export function selectRoutingProvider(
  countryCodes: ReadonlyArray<string | undefined>,
  requestedMode: RequestedRoutingMode,
  available: RoutingProviderAvailability,
): RoutingProviderSelection {
  const normalised = countryCodes.map(countryCode);
  if (normalised.length === 0 || normalised.some((entry) => !entry)) {
    return {
      status: 'route-unavailable',
      reason: 'The route geography is unknown, so no provider can be selected safely.',
    };
  }

  const hasChina = normalised.includes('CN');
  const hasNonChina = normalised.some((entry) => entry !== 'CN');
  if (hasChina && hasNonChina) {
    return {
      status: 'route-unavailable',
      reason: 'This route crosses China and non-China provider regions.',
    };
  }

  if (hasChina) {
    if (!available.amap) {
      return { status: 'route-unavailable', reason: 'Amap routing is not configured for this China trip.' };
    }
    const providerMode = providerModeFor('amap', requestedMode);
    return providerMode
      ? { status: 'selected', provider: 'amap', requestedMode, providerMode }
      : {
        status: 'route-unavailable',
        reason: `Amap does not support ${requestedMode} in Planitenary's current routing adapter.`,
      };
  }

  if (!available.openRouteService) {
    return {
      status: 'route-unavailable',
      reason: 'OpenRouteService routing is not configured for this non-China trip.',
    };
  }
  const providerMode = providerModeFor('openrouteservice', requestedMode);
  return providerMode
    ? { status: 'selected', provider: 'openrouteservice', requestedMode, providerMode }
    : {
      status: 'route-unavailable',
      reason: `Hosted OpenRouteService does not support ${requestedMode} in Planitenary.`,
    };
}

export interface RoutingPointIdentity {
  placeId?: string;
  coordinates?: [number, number];
}

/** About one metre at the equator, matching the route-cache coordinate key. */
const COORDINATE_EQUALITY_TOLERANCE = 0.00001;

/**
 * Whether two endpoints are the same logical place.
 *
 * Array indexes are intentionally irrelevant. A 1x1 A -> B request has index
 * zero on both axes but is not a diagonal. Stable place IDs win when equal;
 * tightly equal coordinates also cover the same place represented by two
 * provider identifiers. Missing identity is never treated as equality.
 */
export function sameRoutingPoint(
  origin: RoutingPointIdentity,
  destination: RoutingPointIdentity,
): boolean {
  const originId = origin.placeId?.trim();
  const destinationId = destination.placeId?.trim();
  if (originId && destinationId && originId === destinationId) return true;

  const originCoordinates = origin.coordinates;
  const destinationCoordinates = destination.coordinates;
  if (!originCoordinates || !destinationCoordinates) return false;
  return Math.abs(originCoordinates[0] - destinationCoordinates[0]) <= COORDINATE_EQUALITY_TOLERANCE
    && Math.abs(originCoordinates[1] - destinationCoordinates[1]) <= COORDINATE_EQUALITY_TOLERANCE;
}
