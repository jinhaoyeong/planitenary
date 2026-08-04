import type { Activity } from '../data';

export type DiscoveryProvider = 'google' | 'official-tourism' | 'wikidata';
export type ReservationStatus = 'not-needed' | 'recommended' | 'required' | 'unknown';
export type IndoorOutdoor = 'indoor' | 'outdoor' | 'mixed';

export interface DiscoveryQuery {
  query: string;
  categories: string[];
  neighbourhood?: string;
}

export interface DiscoveryRequest {
  city: string;
  countryCode?: string;
  queries: DiscoveryQuery[];
  interests: string[];
  startDate?: string;
  endDate?: string;
  language?: string;
  limit?: number;
}

export interface SourceReference {
  label: string;
  url: string;
  retrievedAt?: string;
}

export interface DateAwareOpeningHours {
  timezone?: string;
  periods: Array<{
    date?: string;
    opensAt?: string;
    closesAt?: string;
    closed?: boolean;
  }>;
  sourceConfidence: 'high' | 'medium' | 'low';
}

export interface PlaceCandidate {
  id: string;
  provider: DiscoveryProvider;
  providerPlaceId?: string;
  name: string;
  localName?: string;
  description?: string;
  countryCode: string;
  region?: string;
  city: string;
  neighbourhood?: string;
  coordinates?: [number, number];
  categories: string[];
  experienceTags: string[];
  rating?: number;
  reviewCount?: number;
  priceLevel?: number;
  openingHours?: DateAwareOpeningHours;
  estimatedVisitMinutes: number;
  indoorOutdoor: IndoorOutdoor;
  reservationStatus: ReservationStatus;
  bestTimeWindows?: Array<{ start: string; end: string }>;
  sourceConfidence: 'high' | 'medium' | 'low';
  sourceReferences: SourceReference[];
  lastVerifiedAt: string;
}

export interface PlaceCandidateDetails extends PlaceCandidate {
  website?: string;
  accessibility?: {
    wheelchairAccessible?: boolean;
    notes?: string;
  };
}

export interface RouteMatrixRequest {
  origins: Array<{ placeId?: string; coordinates?: [number, number] }>;
  destinations: Array<{ placeId?: string; coordinates?: [number, number] }>;
  mode: 'walking' | 'public-transport' | 'cycling' | 'driving';
}

export interface RouteMatrixResult {
  durationMinutes?: number;
  distanceMeters?: number;
  status: 'ok' | 'unknown' | 'unavailable';
  source: 'provider' | 'offline-fallback';
}

export interface NeighbourhoodProfile {
  id: string;
  label: string;
  themes: string[];
  centre?: [number, number];
}

export interface NearbyDestination {
  city: string;
  countryCode: string;
  themes: string[];
  minimumRecommendedDays?: number;
}

export interface DestinationKnowledgePack {
  countryCode: string;
  city?: string;
  region?: string;
  discoveryQueries: DiscoveryQuery[];
  signatureCategories: string[];
  neighbourhoods: NeighbourhoodProfile[];
  nearbyDestinations: NearbyDestination[];
  officialSources: SourceReference[];
}

export interface PlaceDiscoveryProvider {
  search(request: DiscoveryRequest): Promise<PlaceCandidate[]>;
  details(providerPlaceId: string): Promise<PlaceCandidateDetails>;
}

export interface RouteMatrixProvider {
  matrix(request: RouteMatrixRequest): Promise<RouteMatrixResult[][]>;
}

export interface DestinationKnowledgeProvider {
  getPack(countryCode: string, city?: string): Promise<DestinationKnowledgePack | null>;
}

export interface DestinationIntelligenceProviders {
  places?: PlaceDiscoveryProvider;
  routes?: RouteMatrixProvider;
  knowledge?: DestinationKnowledgeProvider;
}

/**
 * A provider candidate must have factual identity before it can become an
 * itinerary activity. This prevents a future discovery UI from converting a
 * partial search result into an apparently verified plan item.
 */
export function isSchedulableCandidate(candidate: PlaceCandidate): boolean {
  return Boolean(
    candidate.providerPlaceId
      && candidate.name.trim()
      && candidate.city.trim()
      && candidate.coordinates
      && candidate.categories.length > 0
      && candidate.estimatedVisitMinutes > 0,
  );
}

export function candidateToActivity(candidate: PlaceCandidate): Activity {
  if (!isSchedulableCandidate(candidate)) {
    throw new Error(`Candidate ${candidate.id} is missing schedulable factual data.`);
  }
  return {
    id: `discovered-${candidate.id}`,
    kind: 'place',
    time: '09:00',
    durationMinutes: candidate.estimatedVisitMinutes,
    name: candidate.name,
    description: candidate.description || `${candidate.categories.join(', ')} in ${candidate.city}.`,
    type: 'sight',
    location: candidate.neighbourhood || candidate.city,
    source: 'imported',
    provider: candidate.provider,
    providerPlaceId: candidate.providerPlaceId,
    coordinates: candidate.coordinates,
    openingHours: candidate.openingHours?.periods[0],
    bookingStatus: candidate.reservationStatus === 'required' ? 'requested' : 'none',
    sourceReferences: candidate.sourceReferences.map((source) => ({ label: source.label, url: source.url })),
    lastVerifiedAt: candidate.lastVerifiedAt,
    lockedFields: [],
  };
}
