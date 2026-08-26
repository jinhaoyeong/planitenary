import type { Itinerary } from '../data';
import { findCountry } from './destinations';
import { sanitizeTripProfile } from './tripProfile';

export interface TripCountry {
  code: string;
  name: string;
}

export function resolveCountryIdentity(
  countryCode?: string | null,
  countryName?: string | null,
): TripCountry | undefined {
  const country = findCountry(countryCode) || findCountry(countryName);
  return country ? { code: country.code, name: country.name } : undefined;
}

/**
 * Cover art follows the first destination the traveller entered. That makes a
 * multi-country trip deterministic while preserving the route order they
 * chose in the setup flow.
 */
export function resolveTripCountry(
  itinerary?: Pick<Itinerary, 'tripProfile'> | null,
): TripCountry | undefined {
  const profile = sanitizeTripProfile(itinerary?.tripProfile);
  const destination = profile?.destinations[0];
  return resolveCountryIdentity(destination?.countryCode, destination?.country);
}
