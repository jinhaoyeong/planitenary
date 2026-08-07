import type { Activity, DiscoveryProvider } from '../data';
// Type-only, so the placeRationale ↔ placeIntelligence ↔ here cycle erases at
// runtime rather than becoming a real import loop.
import type { RationalePoint } from './placeRationale';
// The admission shape is declared once, server-side, where currency is
// resolved; the client only ever reads it.
export type {
  AdmissionClass,
  AdmissionExpectation,
  AdmissionFare,
  AdmissionSource,
  PlaceAdmission,
} from '../../supabase/functions/_shared/placeCost';
import {
  categoryAdmission,
  mergeAdmission,
  type PlaceAdmission,
} from '../../supabase/functions/_shared/placeCost';

/**
 * Declared in `../data` so the persisted `Activity.provider` and the in-flight
 * `PlaceCandidate.provider` cannot drift apart. Re-exported here because this
 * is where discovery code naturally looks for it.
 */
export type { DiscoveryProvider };
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
    /**
     * Weekdays this window applies to, as `Date.getDay()` values (0 is Sunday).
     * Absent means every day.
     *
     * Without this, a place open `Tu-Su` reads as open on Monday too, and the
     * planner builds a day around a closed door.
     */
    daysOfWeek?: number[];
    opensAt?: string;
    closesAt?: string;
    closed?: boolean;
  }>;
  sourceConfidence: 'high' | 'medium' | 'low';
  /**
   * What the source published that we could not read — holiday hours, seasonal
   * variation, opening times relative to sunset, windows crossing midnight.
   *
   * The parsers drop these rather than guess, which is right, but it leaves a
   * confident-looking weekly schedule that quietly omits the one clause a
   * traveller needed. Carrying them makes the gap visible.
   */
  caveats?: string[];
}

export interface PlaceCandidate {
  id: string;
  provider: DiscoveryProvider;
  providerPlaceId?: string;
  name: string;
  localName?: string;
  description?: string;
  photoUrl?: string;
  photoAttribution?: string;
  countryCode: string;
  region?: string;
  city: string;
  neighbourhood?: string;
  coordinates?: [number, number];
  categories: string[];
  experienceTags: string[];
  rating?: number;
  reviewCount?: number;
  /**
   * 0–1. How central this place is to understanding the destination, derived
   * from documentation rather than popularity: an encyclopedia article, a
   * heritage listing, a curated guidebook entry.
   *
   * Distinct from `rating` on purpose. A star average measures satisfaction
   * over a venue's whole lifetime; this measures significance, and is the
   * signal available from sources that carry no reviews at all.
   */
  notability?: number;
  /**
   * Why this place is documented, named rather than scored — 'has an
   * encyclopedia entry', 'is a listed heritage site'.
   *
   * `notability` is the number the ranker uses; this is the same evidence in a
   * form that can be shown to a person.
   */
  notabilitySignals?: string[];
  /**
   * A spend *band*, 0–4, and only that. The meal scheduler picks a lunch place
   * against the traveller's budget tier with it, which is a different question
   * from what it costs to get in — see {@link admission} for that.
   */
  priceLevel?: number;
  /**
   * What it costs to get in, from a source that spoke about money.
   *
   * `class` is never set by a category: a market may be free to walk into and a
   * museum may be free on Sundays, and neither is knowable from what kind of
   * place it is. Categories contribute `expectation` only, which the UI renders
   * in hedged language.
   */
  admission?: PlaceAdmission;
  openingHours?: DateAwareOpeningHours;
  /**
   * The operator's own site. Providers already return it; it is declared here
   * because it is the address of the highest-authority evidence source there
   * is — the only one allowed to establish that a place has closed.
   */
  website?: string;
  /**
   * Diets this place can actually cater for, e.g. `vegetarian`, `halal`.
   * Only firm answers are recorded — see `osmDietaryOptions` for why a
   * "limited" option is treated as no answer at all.
   */
  dietaryOptions?: string[];
  estimatedVisitMinutes: number;
  indoorOutdoor: IndoorOutdoor;
  reservationStatus: ReservationStatus;
  bestTimeWindows?: Array<{ start: string; end: string }>;
  sourceConfidence: 'high' | 'medium' | 'low';
  sourceReferences: SourceReference[];
  lastVerifiedAt: string;
}

export type CandidateDecision = 'must-do' | 'interested' | 'skip' | 'visited';

export interface CandidateScoreBreakdown {
  interestFit: number;
  localSignificance: number;
  neighbourhoodFit: number;
  dataCompleteness: number;
  budgetFit: number;
  openingHoursFit: number;
  routeCompatibility: number;
  diversityContribution: number;
}

export interface RankedCandidate {
  candidate: PlaceCandidate;
  score: number;
  breakdown: CandidateScoreBreakdown;
  /**
   * The explanation as structured points, each traceable to the field it came
   * from. `reasons` is the same content flattened, kept for callers that only
   * want strings.
   */
  rationale?: RationalePoint[];
  reasons: string[];
  /**
   * Things the traveller should weigh against the reasons — a reported
   * closure, a long queue, heavily promoted praise. Kept separate so a card can
   * never present a place as pure upside when the evidence says otherwise.
   */
  cautions?: string[];
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
 * The admission a card should show, with the category expectation filled in.
 *
 * Discovery resolves admission server-side, but three paths reach the UI
 * without it: the offline fixtures, Google (whose price band is restaurant
 * spend, not entry), and `discovery_cache` rows written before the field
 * existed. Falling back here means a museum still reads "usually needs a
 * ticket" rather than reverting to the "Cost unknown" this replaced.
 *
 * `mergeAdmission` guarantees the fallback can only ever supply `expectation` —
 * a category never sets the class, wherever it is applied from.
 */
export function admissionFor(candidate: PlaceCandidate): PlaceAdmission | undefined {
  return mergeAdmission(candidate.admission, categoryAdmission(candidate.categories));
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
  const admission = admissionFor(candidate);
  const adultFare = admission?.class === 'ticketed'
    ? admission.fares?.find((fare) => fare.audience === 'adult')
    : undefined;
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
    indoorOutdoor: candidate.indoorOutdoor,
    openingHours: candidate.openingHours?.periods[0],
    // The whole week, not just the first period. `openingHours` above is
    // `periods[0]` and stays that way for the conflict check; a day card asking
    // "is this open on the day I am there" needs all of them.
    openingHoursWeek: candidate.openingHours?.periods.map((period) => ({
      opensAt: period.opensAt,
      closesAt: period.closesAt,
      days: period.daysOfWeek,
      sourceUpdatedAt: candidate.lastVerifiedAt,
    })),
    admission,
    // One number for budgeting, with its currency attached. Only ever the adult
    // fare: a `child` figure here would quietly understate the trip, and an
    // amount without a currency is the bug this whole field exists to avoid.
    estimatedCost: adultFare
      ? { amount: adultFare.amount, currency: adultFare.currency, basis: 'per-person' as const }
      : undefined,
    bookingStatus: candidate.reservationStatus === 'required' ? 'requested' : 'none',
    reservationRequirement: candidate.reservationStatus,
    sourceReferences: candidate.sourceReferences.map((source) => ({ label: source.label, url: source.url })),
    lastVerifiedAt: candidate.lastVerifiedAt,
    lockedFields: [],
    // Records that these came from a provider rather than the traveller, so a
    // later regeneration can tell its own output from hand-entered values.
    fieldProvenance: {
      ...(adultFare ? { estimatedCost: 'imported' as const } : {}),
      ...(candidate.openingHours ? { openingHours: 'imported' as const } : {}),
    },
  };
}
