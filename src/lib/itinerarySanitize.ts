/**
 * Itinerary sanitisation — the gate every stored trip passes through.
 *
 * Extracted from `App.tsx` so it can be tested directly. It had none: the save
 * path silently discarded `indoorOutdoor` entirely, and matched `provider`
 * against three of seven `DiscoveryProvider` values, degrading every saved trip
 * while the suite stayed green. A pure module is the difference between that
 * being catchable and not.
 *
 * Every function here must be **deterministic and idempotent**. Sanitising an
 * already-sanitised itinerary has to produce a deeply equal result, because the
 * realtime sync compares `JSON.stringify` output to decide whether a remote
 * payload differs from local state. A non-deterministic id or timestamp here
 * would make every echo look like a change and loop the sync.
 */
import {
  parseStructuredPlaceRef,
  type StructuredPlaceRef,
} from '../../supabase/functions/_shared/placeReference';
import { parseDayTransfer } from '../../supabase/functions/_shared/dayCitySemantics';
import {
  bookingCityKey,
  isBookingClock,
  isBookingDate,
  isTimeZone,
  sortBookings,
  type PriceSnapshot,
  type PriceSource,
  type TravelBooking,
  type TravelBookingStatus,
  type TravelBookingType,
} from './travelBooking';
import type {
  AdmissionClass,
  AdmissionExpectation,
  AdmissionFare,
  AdmissionSource,
  PlaceAdmission,
} from '../../supabase/functions/_shared/placeCost';
import type {
  Activity,
  ActivityCost,
  ActivityGeneratedMetadata,
  ActivityLockedField,
  ActivitySource,
  ActivityType,
  BookingStatus,
  DayPlan,
  DiscoveryCandidateDecision,
  DiscoveryProvider,
  DiscoveryStage,
  DiscoveryUnscheduledReason,
  IndoorOutdoor,
  Itinerary,
  ItineraryDiscoveryState,
  PlanningConstraints,
  PlannerChangeRecord,
  ScheduleItemKind,
} from '../data';
import { sanitizeTripProfile } from './tripProfile';
import { sanitizeFieldSources } from './identityFields';
import {
  parseTripCoverRef,
  parseVerifiedImageAsset,
  VERIFIED_IMAGE_VALIDATION_VERSION,
} from './verifiedImage';


// Regular accounts start from a genuinely blank handbook. Demo Mode alone
// receives the rich sample itinerary from data.ts.
export const emptyItinerary: Itinerary = {
  id: 'pending-trip',
  name: 'New Trip',
  cities: [],
  description: 'Start with a blank travel handbook and shape every day your way.',
  marqueeItems: ['Travel Handbook', 'Plans', 'Notes', 'Maps', 'Photos'],
  heroEyebrow: 'A personalized travel starter',
  primaryButtonLabel: 'Open the itinerary',
  primaryButtonTab: 'itinerary',
  secondaryButtonLabel: 'See the map',
  secondaryButtonTab: 'maps',
  coverHeadline: 'Add a cover when your story takes shape.',
  coverLabel: 'Custom cover',
  coverYear: String(new Date().getFullYear()),
  days: [],
};

export const DEFAULT_MARQUEE_ITEMS = ['Travel Handbook', 'Plans', 'Notes', 'Maps', 'Photos'];
const VALID_HOME_TABS = ['itinerary', 'maps', 'draft', 'budget', 'checklist', 'documents', 'photos', 'profile', 'settings'] as const;

const VALID_ACTIVITY_TYPES: ActivityType[] = ['food', 'sight', 'culture', 'walk', 'nature', 'travel', 'flight', 'cafe', 'shop', 'nightlife', 'other'];
const VALID_ACTIVITY_SOURCES: ActivitySource[] = ['manual', 'generated', 'imported'];
const VALID_BOOKING_STATUSES: BookingStatus[] = ['none', 'requested', 'confirmed', 'cancelled'];
const VALID_LOCKED_FIELDS: ActivityLockedField[] = ['schedule', 'location', 'duration', 'cost', 'booking', 'all'];
const VALID_SCHEDULE_KINDS: ScheduleItemKind[] = ['place', 'reservation', 'transport', 'meal-window', 'rest-window', 'free-time'];

/**
 * The planner used to write a reserved meal window into every day as an
 * activity named "<meal> — venue not selected". It carried no venue, no cost
 * and no booking — only the fact that the time was held — and repeated on each
 * day of a trip it read as clutter rather than as a plan.
 *
 * It is no longer generated, and plans saved before that change are cleaned on
 * load. Deliberately narrow: only a generated meal window still holding the
 * placeholder name goes. A meal window the traveller has renamed, given a
 * venue, or booked has become their content and is kept.
 */
const isUnfilledGeneratedMealWindow = (activity: unknown): boolean => {
  if (!activity || typeof activity !== 'object') return false;
  const value = activity as { kind?: unknown; source?: unknown; name?: unknown; location?: unknown };
  return value.kind === 'meal-window'
    && value.source === 'generated'
    && typeof value.name === 'string'
    && /—\s*venue not selected\s*$/.test(value.name);
};
/**
 * Written as a keyed record rather than an array so the compiler enforces
 * completeness: adding a provider to {@link DiscoveryProvider} without listing
 * it here fails the build.
 *
 * This was previously an inline three-way comparison that had drifted from the
 * type, so every place found by OpenStreetMap, Wikivoyage, Amap or Baidu —
 * which is all of them, Google being unconfigured — silently lost its
 * attribution on the first save. The same list has drifted twice before; a
 * runtime array would let it happen a fourth time.
 */
const DISCOVERY_PROVIDERS: Record<DiscoveryProvider, true> = {
  google: true,
  osm: true,
  wikivoyage: true,
  amap: true,
  baidu: true,
  'official-tourism': true,
  wikidata: true,
};
const INDOOR_OUTDOOR_VALUES: Record<IndoorOutdoor, true> = {
  indoor: true,
  outdoor: true,
  mixed: true,
};
const isDiscoveryProvider = (value: unknown): value is DiscoveryProvider =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(DISCOVERY_PROVIDERS, value);
const isIndoorOutdoor = (value: unknown): value is IndoorOutdoor =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(INDOOR_OUTDOOR_VALUES, value);
const VALID_DISCOVERY_DECISIONS: DiscoveryCandidateDecision[] = ['must-do', 'interested', 'skip', 'visited'];
const VALID_DISCOVERY_STAGES: DiscoveryStage[] = ['not-started', 'reviewing', 'shortlist-ready', 'itinerary-built', 'needs-review'];
const VALID_DISCOVERY_UNSCHEDULED_REASONS: DiscoveryUnscheduledReason[] = ['opening-hours-conflict', 'daily-capacity-reached', 'incompatible-location', 'insufficient-route-data', 'duplicate', 'no-viable-day'];

/**
 * Keyed records rather than arrays, so the compiler fails the build when a
 * value is added to the union without being listed here. Every drift bug this
 * file documents — the three-way `provider` comparison, the missing
 * `indoorOutdoor` — was a runtime list falling behind a type.
 */
const ADMISSION_CLASSES: Record<AdmissionClass, true> = {
  free: true,
  ticketed: true,
  'spend-based': true,
  unknown: true,
};
const ADMISSION_EXPECTATIONS: Record<AdmissionExpectation, true> = {
  'usually-ticketed': true,
  'often-free': true,
  'spending-inside': true,
};
const ADMISSION_SOURCES: Record<AdmissionSource, true> = {
  'official-website': true,
  provider: true,
  'osm-tag': true,
  wikivoyage: true,
  category: true,
};
const has = (record: Record<string, true>, value: unknown): boolean =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(record, value);

const trimmed = (value: unknown): string | undefined =>
  (typeof value === 'string' && value.trim() ? value.trim() : undefined);

/**
 * One fare, or nothing.
 *
 * A fare without a currency is dropped rather than kept as a bare number: an
 * amount whose unit is unknown is exactly what the old `'¥'.repeat(n)` display
 * was, and letting one through the save path would reintroduce it from storage
 * instead of from a provider.
 */
const sanitizeFare = (value: unknown): AdmissionFare | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const currency = trimmed(raw.currency)?.toUpperCase();
  const audience = trimmed(raw.audience)?.toLowerCase();
  if (!currency || !audience) return undefined;
  if (typeof raw.amount !== 'number' || !Number.isFinite(raw.amount) || raw.amount < 0) return undefined;
  return { audience, amount: raw.amount, currency, note: trimmed(raw.note) };
};

/**
 * Admission through a save and back, unchanged.
 *
 * Nested structure is the risk here. The realtime sync compares
 * `JSON.stringify` output, so this has to be deterministic down to key order
 * and stable under repetition — and a fare list that silently reordered, or a
 * `source` that failed validation and vanished, would strip the provenance that
 * lets a card say where its price came from.
 *
 * Malformed fares are dropped individually. Losing one concession price is
 * better than losing the adult fare with it.
 */
const sanitizeAdmission = (value: unknown): PlaceAdmission | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  if (!has(ADMISSION_CLASSES, raw.class)) return undefined;
  // Without a source there is no provenance, and an admission we cannot
  // attribute is one the panel must not present as sourced.
  if (!has(ADMISSION_SOURCES, raw.source)) return undefined;

  const confidence = raw.confidence === 'high' || raw.confidence === 'medium' || raw.confidence === 'low'
    ? raw.confidence
    : 'low';

  return {
    class: raw.class as AdmissionClass,
    // `[]` is meaningful — a ticket is required and no price was published — so
    // an empty list is preserved rather than collapsed to undefined.
    fares: Array.isArray(raw.fares)
      ? raw.fares.flatMap((fare) => { const parsed = sanitizeFare(fare); return parsed ? [parsed] : []; })
      : undefined,
    typicalSpend: sanitizeFare(raw.typicalSpend),
    expectation: has(ADMISSION_EXPECTATIONS, raw.expectation) ? raw.expectation as AdmissionExpectation : undefined,
    rawText: trimmed(raw.rawText),
    source: raw.source as AdmissionSource,
    sourceUrl: trimmed(raw.sourceUrl),
    confidence,
    retrievedAt: trimmed(raw.retrievedAt),
  };
};

/** One opening window. Shared by the single field and the weekly list. */
const sanitizeActivityHours = (value: unknown) => {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const days = Array.isArray(raw.days)
    ? raw.days.filter((day): day is number => typeof day === 'number' && Number.isInteger(day) && day >= 0 && day <= 6)
    : undefined;
  return {
    label: typeof raw.label === 'string' ? raw.label.trim() : undefined,
    opensAt: typeof raw.opensAt === 'string' ? raw.opensAt.trim() : undefined,
    closesAt: typeof raw.closesAt === 'string' ? raw.closesAt.trim() : undefined,
    days,
    sourceUpdatedAt: typeof raw.sourceUpdatedAt === 'string' ? raw.sourceUpdatedAt : undefined,
  };
};

const stableHash = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const legacyActivityId = (scope: string, name: string, time: string, location: string, index: number) => {
  const seed = `${scope}|${name}|${time}|${location}|${index}`.toLowerCase();
  return `activity-legacy-${stableHash(seed)}`;
};

const normalizeStoredTime = (value: unknown, fallback = '09:00') => {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return fallback;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (Number.isNaN(hours) || Number.isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return fallback;
  }
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
};

export const sanitizeActivity = (value: unknown, fallback: Activity, index = 0, scope = 'activity'): Activity => {
  const source = value && typeof value === 'object' ? value as Partial<Activity> : {};
  const type = typeof source.type === 'string' && VALID_ACTIVITY_TYPES.includes(source.type as ActivityType)
    ? source.type as ActivityType
    : fallback.type;
  const coordinates = Array.isArray(source.coordinates)
    && source.coordinates.length === 2
    && source.coordinates.every((coord) => typeof coord === 'number' && Number.isFinite(coord))
      ? [source.coordinates[0], source.coordinates[1]] as [number, number]
      : undefined;
  const rating = typeof source.rating === 'number' && Number.isFinite(source.rating)
    ? Math.max(0, Math.min(10, Math.round(source.rating)))
    : undefined;
  const name = typeof source.name === 'string' && source.name.trim() ? source.name.trim() : fallback.name;
  const time = normalizeStoredTime(source.time, fallback.time);
  const location = typeof source.location === 'string' ? source.location : undefined;
  const city = typeof source.city === 'string' && source.city.trim()
    ? source.city.trim().slice(0, 120)
    : undefined;
  const estimatedCost = source.estimatedCost && typeof source.estimatedCost === 'object'
    ? (() => {
        const raw = source.estimatedCost as unknown as Record<string, unknown>;
        if (typeof raw.amount !== 'number' || !Number.isFinite(raw.amount) || typeof raw.currency !== 'string' || !raw.currency.trim()) return undefined;
        const basis: ActivityCost['basis'] = raw.basis === 'per-person' || raw.basis === 'per-group' || raw.basis === 'fixed' || raw.basis === 'unknown'
          ? raw.basis
          : undefined;
        return { amount: Math.max(0, raw.amount), currency: raw.currency.trim().toUpperCase(), basis };
      })()
    : undefined;
  const openingHours = sanitizeActivityHours(source.openingHours);
  // Order is preserved, not sorted: the morning window of a place that shuts
  // for lunch must stay before the afternoon one, and re-sorting would make
  // every sync echo look like a change.
  const openingHoursWeek = Array.isArray(source.openingHoursWeek)
    ? source.openingHoursWeek.flatMap((period) => {
        const parsed = sanitizeActivityHours(period);
        return parsed ? [parsed] : [];
      })
    : undefined;
  const admission = sanitizeAdmission(source.admission);
  const sourceValue = typeof source.source === 'string' && VALID_ACTIVITY_SOURCES.includes(source.source as ActivitySource)
    ? source.source as ActivitySource
    : 'manual';
  const bookingStatus = typeof source.bookingStatus === 'string' && VALID_BOOKING_STATUSES.includes(source.bookingStatus as BookingStatus)
    ? source.bookingStatus as BookingStatus
    : 'none';
  const lockedFields = Array.isArray(source.lockedFields)
    ? Array.from(new Set(source.lockedFields.filter((field): field is ActivityLockedField => typeof field === 'string' && VALID_LOCKED_FIELDS.includes(field as ActivityLockedField)).map((field) => field as ActivityLockedField)))
    : [];
  const generatedMetadata = source.generatedMetadata && typeof source.generatedMetadata === 'object'
    ? (() => {
        const raw = source.generatedMetadata as unknown as Record<string, unknown>;
        const generatedSource = typeof raw.source === 'string' && VALID_ACTIVITY_SOURCES.includes(raw.source as ActivitySource)
          ? raw.source as ActivitySource
          : sourceValue;
        const confidence: ActivityGeneratedMetadata['confidence'] = raw.confidence === 'high' || raw.confidence === 'medium' || raw.confidence === 'low'
          ? raw.confidence
          : undefined;
        return {
          source: generatedSource,
          generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt : new Date(0).toISOString(),
          reason: typeof raw.reason === 'string' ? raw.reason : undefined,
          confidence,
          profileRevision: typeof raw.profileRevision === 'string' ? raw.profileRevision : undefined,
        };
      })()
    : undefined;
  const moodVotes = source.moodVotes && typeof source.moodVotes === 'object'
    ? (() => {
        const raw = source.moodVotes as Record<string, unknown>;
        const reaction = (value: unknown) =>
          typeof value === 'string' ? value as NonNullable<Activity['moodVotes']>['self'] : undefined;
        const self = reaction(raw.self ?? raw.ahhao);
        const partner = reaction(raw.partner ?? raw.belle);
        const comment = typeof raw.comment === 'string' && raw.comment.trim() ? raw.comment.trim() : undefined;
        const rawCommentBy = raw.commentBy;
        const commentBy =
          rawCommentBy === 'partner' || rawCommentBy === 'belle'
            ? 'partner' as const
            : rawCommentBy === 'self' || rawCommentBy === 'ahhao'
              ? 'self' as const
              : undefined;
        return { self, partner, comment, commentBy };
      })()
    : undefined;
  const voiceNote = source.voiceNote
    && typeof source.voiceNote === 'object'
    && typeof source.voiceNote.dataUrl === 'string'
    && source.voiceNote.dataUrl
    && typeof source.voiceNote.durationSec === 'number'
    && Number.isFinite(source.voiceNote.durationSec)
    && typeof source.voiceNote.createdAt === 'string'
      ? {
          dataUrl: source.voiceNote.dataUrl,
          durationSec: Math.max(1, Math.min(300, Math.round(source.voiceNote.durationSec))),
          createdAt: source.voiceNote.createdAt,
        }
      : undefined;
  const placeRef = parseStructuredPlaceRef(source.placeRef);
  const verifiedPhoto = parseVerifiedImageAsset({
    imageKey: source.photoImageKey || source.photoSourcePage,
    url: source.photoUrl,
    thumbnailUrl: source.photoThumbnailUrl,
    sourcePageUrl: source.photoSourcePage,
    attribution: source.photoAttribution,
    license: source.photoLicense,
    licenseUrl: source.photoLicenseUrl,
    validationVersion: VERIFIED_IMAGE_VALIDATION_VERSION,
  });

  return {
    id: typeof source.id === 'string' && source.id.trim() ? source.id.trim() : legacyActivityId(scope, name, time, location || '', index),
    kind: typeof source.kind === 'string' && VALID_SCHEDULE_KINDS.includes(source.kind as ScheduleItemKind)
      ? source.kind as ScheduleItemKind
      : undefined,
    time,
    durationMinutes: typeof source.durationMinutes === 'number' && Number.isFinite(source.durationMinutes)
      ? Math.max(5, Math.min(1440, Math.round(source.durationMinutes)))
      : undefined,
    name,
    description: typeof source.description === 'string' ? source.description : fallback.description,
    type,
    city,
    location,
    cost: typeof source.cost === 'string' ? source.cost : undefined,
    estimatedCost,
    admission,
    bookingStatus,
    reservationRequirement: source.reservationRequirement === 'not-needed' || source.reservationRequirement === 'recommended' || source.reservationRequirement === 'required' || source.reservationRequirement === 'unknown'
      ? source.reservationRequirement
      : undefined,
    openingHours,
    openingHoursWeek,
    transportMinutes: typeof source.transportMinutes === 'number' && Number.isFinite(source.transportMinutes)
      ? Math.max(0, Math.min(1440, Math.round(source.transportMinutes)))
      : undefined,
    transportMode: typeof source.transportMode === 'string' ? source.transportMode.trim() : undefined,
    source: sourceValue,
    locked: source.locked === true,
    lockedFields,
    fieldProvenance: source.fieldProvenance && typeof source.fieldProvenance === 'object'
      ? Object.fromEntries(Object.entries(source.fieldProvenance).filter(([, value]) => typeof value === 'string' && VALID_ACTIVITY_SOURCES.includes(value as ActivitySource))) as Activity['fieldProvenance']
      : undefined,
    travelEstimateSource: source.travelEstimateSource === 'provider-route' || source.travelEstimateSource === 'offline-straight-line' || source.travelEstimateSource === 'unknown' ? source.travelEstimateSource : undefined,
    travelEstimateConfidence: source.travelEstimateConfidence === 'high' || source.travelEstimateConfidence === 'medium' || source.travelEstimateConfidence === 'low' ? source.travelEstimateConfidence : undefined,
    generatedMetadata,
    provider: isDiscoveryProvider(source.provider) ? source.provider : undefined,
    // Weather-aware ordering and the rain replan both read this. It was never
    // copied here at all, so the planner's indoor/outdoor knowledge survived
    // exactly one render before the first save erased it.
    indoorOutdoor: isIndoorOutdoor(source.indoorOutdoor) ? source.indoorOutdoor : undefined,
    providerPlaceId: typeof source.providerPlaceId === 'string' && source.providerPlaceId.trim() ? source.providerPlaceId.trim() : undefined,
    placeRef,
    photoUrl: verifiedPhoto?.url,
    photoThumbnailUrl: verifiedPhoto?.thumbnailUrl,
    photoAttribution: verifiedPhoto?.attribution,
    photoSourcePage: verifiedPhoto?.sourcePageUrl,
    photoLicense: verifiedPhoto?.license,
    photoLicenseUrl: verifiedPhoto?.licenseUrl,
    photoImageKey: verifiedPhoto?.imageKey,
    sourceReferences: Array.isArray(source.sourceReferences)
      ? source.sourceReferences.flatMap((reference) => reference && typeof reference === 'object'
        && typeof reference.label === 'string' && typeof reference.url === 'string'
        ? [{ label: reference.label.trim(), url: reference.url.trim() }]
        : [])
      : undefined,
    lastVerifiedAt: typeof source.lastVerifiedAt === 'string' ? source.lastVerifiedAt : undefined,
    rating,
    coordinates,
    moodVotes,
    voiceNote,
  };
};

/**
 * Place references survive a reload only in their exact shape.
 *
 * `parseStructuredPlaceRef` is the same validator the Ask card path uses, so
 * there is one definition of what a trusted reference looks like. A ref whose
 * key has no decision is dropped rather than kept: identity outlasting the
 * decision it was captured for is how a withdrawn choice comes back as a card.
 */
const sanitizePlaceRefs = (
  value: unknown,
  decisions: Record<string, DiscoveryCandidateDecision>,
): Record<string, StructuredPlaceRef> | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const refs: Record<string, StructuredPlaceRef> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!key || decisions[key] === undefined) continue;
    const ref = parseStructuredPlaceRef(raw);
    if (ref) refs[key] = ref;
  }
  return Object.keys(refs).length > 0 ? refs : undefined;
};

const sanitizeDiscoveryState = (value: unknown): ItineraryDiscoveryState | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const source = value as Partial<ItineraryDiscoveryState>;
  if (typeof source.city !== 'string' || !source.city.trim() || (source.mode !== 'fixture' && source.mode !== 'live')) return undefined;
  const decisions = source.decisions && typeof source.decisions === 'object'
    ? Object.fromEntries(Object.entries(source.decisions).filter((entry): entry is [string, DiscoveryCandidateDecision] => (
        Boolean(entry[0]) && VALID_DISCOVERY_DECISIONS.includes(entry[1] as DiscoveryCandidateDecision)
      )))
    : {};
  return {
    city: source.city.trim(),
    mode: source.mode,
    candidateIds: Array.isArray(source.candidateIds) ? source.candidateIds.filter((id): id is string => typeof id === 'string' && Boolean(id.trim())) : [],
    decisions,
    discoveredAt: typeof source.discoveredAt === 'string' ? source.discoveredAt : new Date(0).toISOString(),
    updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : new Date(0).toISOString(),
    stage: VALID_DISCOVERY_STAGES.includes(source.stage as DiscoveryStage) ? source.stage as DiscoveryStage : undefined,
    scheduledCandidateIds: Array.isArray(source.scheduledCandidateIds)
      ? source.scheduledCandidateIds.filter((id): id is string => typeof id === 'string' && Boolean(id.trim()))
      : undefined,
    placeRefs: sanitizePlaceRefs(source.placeRefs, decisions),
    unscheduledCandidates: Array.isArray(source.unscheduledCandidates)
      ? source.unscheduledCandidates.flatMap((item) => {
          if (!item || typeof item !== 'object') return [];
          const candidate = item as { candidateId?: unknown; reason?: unknown; detail?: unknown };
          return typeof candidate.candidateId === 'string'
            && typeof candidate.reason === 'string'
            && VALID_DISCOVERY_UNSCHEDULED_REASONS.includes(candidate.reason as DiscoveryUnscheduledReason)
            ? [{
              candidateId: candidate.candidateId,
              reason: candidate.reason as DiscoveryUnscheduledReason,
              // Older records predate the detail, so it stays optional and the
              // UI falls back to the category label.
              detail: typeof candidate.detail === 'string' && candidate.detail.trim()
                ? candidate.detail.trim()
                : undefined,
            }]
            : [];
        })
      : undefined,
  };
};

const blankDay = (index: number): DayPlan => ({
  day: index + 1,
  date: `Day ${index + 1}`,
  stayCity: '',
  activityCities: [],
  city: '',
  title: `Day ${index + 1}`,
  activities: [],
});

/**
 * Cities a stored day claims its activities were in.
 *
 * Re-derived rather than trusted, like every other field here: a malformed
 * entry costs the list, never the day. Deliberately never falls back to the
 * stay city — "we did not record this" and "it was the same as the base" are
 * different statements, and only one of them is true of a migrated trip.
 */
const sanitizeActivityCities = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const kept: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const city = entry.trim().slice(0, 120);
    if (city && !kept.some((held) => held.toLowerCase() === city.toLowerCase())) kept.push(city);
  }
  return kept.slice(0, 6);
};

export const sanitizeDay = (value: unknown, fallbackDay: DayPlan | undefined, index: number, tripId = 'trip'): DayPlan => {
  const source = value && typeof value === 'object' ? value as Partial<DayPlan> : {};
  // Generated trips have more days than the blank template they sanitize against.
  const fallback = fallbackDay ?? blankDay(index);
  const activityFallbacks = fallback.activities.length > 0
    ? fallback.activities
    : [{ time: '09:00', name: 'Untitled activity', description: '', type: 'other' as ActivityType }];
  // An explicitly empty day is valid (generated trip skeletons start blank).
  const sourceActivities = (Array.isArray(source.activities) ? source.activities : activityFallbacks)
    .filter((activity) => !isUnfilledGeneratedMealWindow(activity));

  /**
   * The overnight base, preferring what the day says about itself.
   *
   * An explicit `stayCity` wins over `city` because a trip written after this
   * change means the former; a trip written before it only ever had the
   * latter, and reading it as the base is exactly what it meant. The two are
   * then forced equal below, so a stored pair that disagrees — however it got
   * that way — cannot survive a read as two competing truths.
   */
  const stayCity = typeof source.stayCity === 'string' && source.stayCity.trim()
    ? source.stayCity.trim()
    : typeof source.city === 'string' && source.city.trim()
      ? source.city.trim()
      : fallback.stayCity || fallback.city;

  return {
    day: index + 1,
    date: typeof source.date === 'string' && source.date.trim() ? source.date : fallback.date,
    stayCity,
    /**
     * Never inferred here. Coordinates could suggest that a stop sits nearer
     * Kyoto than Osaka, but "reachable from" is not "belongs to", and a
     * migration that guessed would write a plausible answer the traveller
     * never gave into their saved trip. Stage 2 producers record this where
     * the planner actually knows it.
     */
    activityCities: sanitizeActivityCities(source.activityCities),
    transfer: parseDayTransfer(source.transfer, stayCity),
    // Alias, forced. Nothing may write it independently of the line above.
    city: stayCity,
    title: typeof source.title === 'string' && source.title.trim() ? source.title : fallback.title,
    activities: sourceActivities.map((activity, activityIndex) =>
      sanitizeActivity(activity, activityFallbacks[activityIndex] || activityFallbacks[activityFallbacks.length - 1], activityIndex, `${tripId}|day-${index + 1}`)
    ),
    photos: Array.isArray(source.photos) ? source.photos : fallback.photos,
  };
};

const sanitizePlanningConstraints = (value: unknown): PlanningConstraints | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const source = value as Partial<PlanningConstraints>;
  const coordinatePair = (candidate: unknown): [number, number] | undefined =>
    Array.isArray(candidate) && candidate.length === 2 && candidate.every((item) => typeof item === 'number' && Number.isFinite(item))
      ? [candidate[0], candidate[1]]
      : undefined;
  return {
    preferredStartTime: typeof source.preferredStartTime === 'string' ? source.preferredStartTime : undefined,
    preferredEndTime: typeof source.preferredEndTime === 'string' ? source.preferredEndTime : undefined,
    maxMainActivitiesPerDay: typeof source.maxMainActivitiesPerDay === 'number' ? Math.max(1, Math.min(12, Math.round(source.maxMainActivitiesPerDay))) : undefined,
    includeMealBreaks: typeof source.includeMealBreaks === 'boolean' ? source.includeMealBreaks : undefined,
    includeRestBreaks: typeof source.includeRestBreaks === 'boolean' ? source.includeRestBreaks : undefined,
    accommodationLocation: typeof source.accommodationLocation === 'string' ? source.accommodationLocation : undefined,
    accommodationCoordinates: coordinatePair(source.accommodationCoordinates),
    mustDoActivityIds: Array.isArray(source.mustDoActivityIds) ? source.mustDoActivityIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0) : undefined,
    unavailableTimes: Array.isArray(source.unavailableTimes)
      ? source.unavailableTimes.filter((entry): entry is NonNullable<PlanningConstraints['unavailableTimes']>[number] => Boolean(entry && typeof entry === 'object' && typeof entry.start === 'string' && typeof entry.end === 'string'))
      : undefined,
    maxBudgetAmount: typeof source.maxBudgetAmount === 'number' && Number.isFinite(source.maxBudgetAmount) ? Math.max(0, source.maxBudgetAmount) : undefined,
    maxBudgetCurrency: typeof source.maxBudgetCurrency === 'string' ? source.maxBudgetCurrency.toUpperCase() : undefined,
  };
};

const sanitizePlannerHistory = (value: unknown): PlannerChangeRecord[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  return value.slice(-10).filter((entry): entry is PlannerChangeRecord => Boolean(entry && typeof entry === 'object' && typeof (entry as PlannerChangeRecord).id === 'string' && Array.isArray((entry as PlannerChangeRecord).beforeDays) && Array.isArray((entry as PlannerChangeRecord).afterDays))).map((entry) => ({
    ...entry,
    affectedDayNumbers: Array.isArray(entry.affectedDayNumbers) ? entry.affectedDayNumbers : [],
  }));
};

const BOOKING_TYPES: Record<TravelBookingType, true> = {
  flight: true,
  stay: true,
  rail: true,
  transfer: true,
  'activity-ticket': true,
};
const BOOKING_STATUSES: Record<TravelBookingStatus, true> = {
  planned: true,
  requested: true,
  confirmed: true,
  cancelled: true,
};
const PRICE_SOURCE_VALUES: Record<PriceSource, true> = {
  manual: true,
  provider: true,
  'official-website': true,
  unspecified: true,
};

const bookingText = (value: unknown, limit = 160): string | undefined => {
  const text = trimmed(value);
  return text ? text.slice(0, limit) : undefined;
};

const bookingDate = (value: unknown): string | undefined =>
  (isBookingDate(value) ? value : undefined);

const bookingClock = (value: unknown): string | undefined => {
  if (!isBookingClock(value)) return undefined;
  // `9:05` and `09:05` are the same minute and must not be two saved values,
  // or an idempotence check comparing stringified output would fail on the
  // second pass.
  const [hours, minutes] = value.split(':');
  return `${hours.padStart(2, '0')}:${minutes}`;
};

/**
 * A stored price, or nothing.
 *
 * Deliberately strict about the two fields that make a price a fact: an amount
 * needs a currency, and a figure needs the moment it was read. A snapshot
 * missing either is dropped whole rather than kept as a bare number — the same
 * rule `sanitizeFare` enforces, and for the same reason.
 *
 * `expiresAt` is carried through untouched and never synthesised. Inventing one
 * would make every manually entered fare expire on a schedule nothing can
 * refresh.
 */
const sanitizePriceSnapshot = (value: unknown): PriceSnapshot | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.amount !== 'number' || !Number.isFinite(raw.amount) || raw.amount < 0) return undefined;
  const currency = trimmed(raw.currency)?.toUpperCase();
  if (!currency) return undefined;
  const retrievedAt = trimmed(raw.retrievedAt);
  if (!retrievedAt) return undefined;
  // An unreadable source is not a manual one. Defaulting to 'manual' claimed
  // the traveller typed a figure they may never have seen — invented provenance
  // in the opposite direction from trusting a provider. The amount survives;
  // the claim about who supplied it does not.
  const source = has(PRICE_SOURCE_VALUES, raw.source) ? raw.source as PriceSource : 'unspecified';
  return {
    amount: raw.amount,
    currency,
    source,
    sourceUrl: bookingText(raw.sourceUrl, 500),
    retrievedAt,
    expiresAt: trimmed(raw.expiresAt),
  };
};

/**
 * Identity for a booking that arrived without one.
 *
 * Derived from what the record already says rather than generated, because
 * `sanitizeItinerary` has to be idempotent down to `JSON.stringify` output —
 * a `crypto.randomUUID()` here would produce a different id on every read and
 * make the realtime sync treat its own echo as a remote change, forever.
 */
const derivedBookingId = (scope: string, type: string, startDate: string, title: string, index: number) =>
  `booking-${stableHash(`${scope}|${type}|${startDate}|${title}|${index}`.toLowerCase())}`;

/**
 * One booking through a save and back, unchanged.
 *
 * Fails closed. A record without a valid type or start date is not a booking
 * with gaps — it is something else that happened to be in the array, and
 * keeping it would put a card on the timeline claiming an arrangement the
 * traveller never made.
 *
 * Note what cannot survive this function: any field not named below, `legId`
 * included. `CityLeg.legId` is derived inside a single build and renumbers when
 * a route is reordered, so a persisted one would silently retarget to a
 * different stay. The allow-list is what guarantees it can never be stored,
 * whatever a future writer passes in.
 */
export const sanitizeTravelBooking = (value: unknown, index: number, scope = 'trip'): TravelBooking | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  if (!has(BOOKING_TYPES, raw.type)) return undefined;
  const startDate = bookingDate(raw.startDate);
  if (!startDate) return undefined;
  const type = raw.type as TravelBookingType;
  const title = bookingText(raw.title) || 'Booking';
  const status = has(BOOKING_STATUSES, raw.status) ? raw.status as TravelBookingStatus : 'planned';
  const city = bookingText(raw.city, 120);
  const endDate = bookingDate(raw.endDate);
  // An end before its start is a typo, not a booking that travels backwards.
  const orderedEnd = endDate && endDate >= startDate ? endDate : undefined;
  const partySize = typeof raw.partySize === 'number' && Number.isFinite(raw.partySize)
    ? Math.max(1, Math.min(99, Math.round(raw.partySize)))
    : undefined;

  return {
    id: trimmed(raw.id) || derivedBookingId(scope, type, startDate, title, index),
    type,
    status,
    title,
    startDate,
    startTime: bookingClock(raw.startTime),
    endDate: orderedEnd,
    endTime: bookingClock(raw.endTime),
    city,
    // Recomputed from the city rather than trusted, so the two can never
    // disagree about which stay a booking belongs to.
    cityKey: city ? bookingCityKey(city) : undefined,
    origin: bookingText(raw.origin, 120),
    destination: bookingText(raw.destination, 120),
    // A zone this runtime cannot resolve is dropped rather than stored. A bad
    // name would make `elapsedMinutes` refuse forever while the record looked
    // complete — worse than an honestly empty field.
    originTimeZone: isTimeZone(raw.originTimeZone) ? raw.originTimeZone : undefined,
    destinationTimeZone: isTimeZone(raw.destinationTimeZone) ? raw.destinationTimeZone : undefined,
    relatedActivityId: bookingText(raw.relatedActivityId, 120),
    operator: bookingText(raw.operator, 120),
    serviceNumber: bookingText(raw.serviceNumber, 40),
    cabin: bookingText(raw.cabin, 60),
    roomDescription: bookingText(raw.roomDescription, 200),
    partySize,
    reference: bookingText(raw.reference, 60),
    price: sanitizePriceSnapshot(raw.price),
    provider: bookingText(raw.provider, 60),
    providerBookingId: bookingText(raw.providerBookingId, 120),
    providerOfferId: bookingText(raw.providerOfferId, 120),
    notes: bookingText(raw.notes, 500),
  };
};

/**
 * Every booking on a trip, in a stable order.
 *
 * Sorted by date and clock rather than by arrival in the array: two devices
 * that added the same two bookings in a different order would otherwise
 * produce two different `JSON.stringify` outputs for the same trip, and the
 * realtime sync would ping-pong between them.
 */
export const sanitizeTravelBookings = (value: unknown, scope = 'trip'): TravelBooking[] => {
  if (!Array.isArray(value)) return [];
  const bookings = value
    .slice(0, 200)
    .map((entry, index) => sanitizeTravelBooking(entry, index, scope))
    .filter((entry): entry is TravelBooking => Boolean(entry));
  return sortBookings(bookings);
};

/**
 * TEMPORARY. Traces which of the three writers last touched `customItinerary`.
 * Remove once the flicker report is confirmed closed; it is deliberately one
 * flag and one function so stripping it is a two-line change.
 */
const ITINERARY_SYNC_DEBUG = true;
export const logItinerarySync = (writer: string, detail: Record<string, unknown>) => {
  if (!ITINERARY_SYNC_DEBUG) return;
  console.info(`[itinerary-sync] ${writer}`, detail);
};

/**
 * Version ordering across the three writers into `customItinerary`.
 *
 * Local edits increment `revision`; a remote payload is only worth applying if
 * it carries a higher one. Without this the debounced upsert and the realtime
 * echo of that same upsert race each other, and a payload describing the state
 * *before* a rebuild can land after it — which is how a freshly built 21-day
 * plan flickered and then emptied.
 *
 * Equal revisions are treated as "already have it", which is what an echo of
 * our own write is. The trade-off: a second device editing concurrently can
 * produce two different itineraries at the same revision, and the lower-numbered
 * write is dropped rather than merged. Ordering by a number cannot fix that —
 * only a real merge could — but silently losing the newer plan is the worse
 * failure, and it is the one being reported.
 *
 * The one exception is the blank slate. A trip saved before revisions existed
 * carries none, so it reads as 0 — and the placeholder `App` shows while the
 * fetch is in flight is `emptyItinerary`, which is also 0. Ordering alone then
 * says "already have it" and the real trip is discarded, leaving the traveller
 * looking at "New Trip" on any device that has no local copy. Nothing is lost
 * on the server, but the trip cannot be opened at all.
 *
 * So an equal revision defers to content: an itinerary holding nothing has no
 * claim to outrank one that does. This deliberately does not extend to a real
 * local trip — that keeps the ordering rule above, because two genuine plans at
 * the same revision are the concurrent-edit case, where dropping the incoming
 * copy is the safer half of a choice a number cannot make correctly.
 */
const hasTripContent = (itinerary: Itinerary): boolean =>
  itinerary.days.length > 0
  || (itinerary.unassignedActivities?.length ?? 0) > 0
  || (itinerary.bookings?.length ?? 0) > 0
  || itinerary.cities.length > 0
  || Boolean(itinerary.tripProfile);

export const isNewerItineraryRevision = (incoming: Itinerary, current: Itinerary | null): boolean => {
  if (!current) return true;
  const incomingRevision = incoming.revision || 0;
  const currentRevision = current.revision || 0;
  if (incomingRevision !== currentRevision) return incomingRevision > currentRevision;
  return !hasTripContent(current) && hasTripContent(incoming);
};

export const sanitizeItinerary = (value: unknown, fallback: Itinerary): Itinerary => {
  const source = value && typeof value === 'object' ? value as Partial<Itinerary> : {};
  const sourceDays = Array.isArray(source.days) && source.days.length > 0 ? source.days : fallback.days;
  const sanitizedDays = sourceDays.map((day, index) => sanitizeDay(day, fallback.days[index] || fallback.days[fallback.days.length - 1], index, fallback.id));
  const fallbackActivity = { time: '09:00', name: 'Unassigned activity', description: '', type: 'other' as ActivityType };
  const unassignedActivities = Array.isArray(source.unassignedActivities)
    ? source.unassignedActivities.map((activity, index) => sanitizeActivity(activity, fallbackActivity, index, `${fallback.id}|inbox`))
    : (Array.isArray(fallback.unassignedActivities) ? fallback.unassignedActivities : []);
  const sanitizedBookings = sanitizeTravelBookings(
    source.bookings ?? fallback.bookings,
    fallback.id,
  );
  const sanitizedCities = Array.isArray(source.cities)
    ? source.cities.filter((city): city is string => typeof city === 'string' && city.trim().length > 0)
    : [];
  const sanitizedMarqueeItems = Array.isArray(source.marqueeItems)
    ? Array.from(new Set(source.marqueeItems.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())))
    : undefined;
  const primaryButtonTab = typeof source.primaryButtonTab === 'string' && VALID_HOME_TABS.includes(source.primaryButtonTab as typeof VALID_HOME_TABS[number])
    ? source.primaryButtonTab as typeof VALID_HOME_TABS[number]
    : fallback.primaryButtonTab || 'itinerary';
  const secondaryButtonTab = typeof source.secondaryButtonTab === 'string' && VALID_HOME_TABS.includes(source.secondaryButtonTab as typeof VALID_HOME_TABS[number])
    ? source.secondaryButtonTab as typeof VALID_HOME_TABS[number]
    : fallback.secondaryButtonTab || 'maps';

  const optionalText = (value: unknown, fallbackValue?: string) =>
    typeof value === 'string' && value.trim() ? value.trim() : fallbackValue;

  return {
    id: fallback.id,
    tripCover: parseTripCoverRef(source.tripCover) ?? parseTripCoverRef(fallback.tripCover),
    tripProfile: sanitizeTripProfile(source.tripProfile) ?? sanitizeTripProfile(fallback.tripProfile) ?? undefined,
    fieldSources: sanitizeFieldSources(source.fieldSources) ?? sanitizeFieldSources(fallback.fieldSources),
    schemaVersion: typeof source.schemaVersion === 'number' ? Math.max(1, Math.round(source.schemaVersion)) : 1,
    revision: typeof source.revision === 'number' ? Math.max(0, Math.round(source.revision)) : (fallback.revision || 0),
    planningConstraints: sanitizePlanningConstraints(source.planningConstraints) ?? sanitizePlanningConstraints(fallback.planningConstraints),
    plannerSuggestions: Array.isArray(source.plannerSuggestions) ? source.plannerSuggestions.slice(-20) : (fallback.plannerSuggestions || []),
    discoveryState: sanitizeDiscoveryState(source.discoveryState) ?? sanitizeDiscoveryState(fallback.discoveryState),
    plannerHistory: sanitizePlannerHistory(source.plannerHistory) ?? sanitizePlannerHistory(fallback.plannerHistory),
    unassignedActivities,
    // Undefined rather than `[]` when there are none, so a trip that predates
    // bookings serialises byte-for-byte as it did before — the realtime sync
    // compares `JSON.stringify` output, and an empty array appearing on every
    // existing trip would look like an edit to every one of them.
    bookings: sanitizedBookings.length ? sanitizedBookings : undefined,
    lastPlannerProfileRevision: typeof source.lastPlannerProfileRevision === 'string' ? source.lastPlannerProfileRevision : fallback.lastPlannerProfileRevision,
    brandTitle: optionalText(source.brandTitle, fallback.brandTitle),
    overviewEyebrow: optionalText(source.overviewEyebrow, fallback.overviewEyebrow),
    overviewDescription: optionalText(source.overviewDescription, fallback.overviewDescription),
    searchPlaceholder: optionalText(source.searchPlaceholder, fallback.searchPlaceholder),
    name: typeof source.name === 'string' && source.name.trim() ? source.name : fallback.name,
    description: typeof source.description === 'string' && source.description.trim() ? source.description : fallback.description,
    marqueeItems: sanitizedMarqueeItems?.length ? sanitizedMarqueeItems : (fallback.marqueeItems || DEFAULT_MARQUEE_ITEMS),
    heroEyebrow: typeof source.heroEyebrow === 'string' && source.heroEyebrow.trim() ? source.heroEyebrow.trim() : (fallback.heroEyebrow || 'A personalized travel starter'),
    primaryButtonLabel: typeof source.primaryButtonLabel === 'string' && source.primaryButtonLabel.trim() ? source.primaryButtonLabel.trim() : (fallback.primaryButtonLabel || 'Open the itinerary'),
    primaryButtonTab,
    secondaryButtonLabel: typeof source.secondaryButtonLabel === 'string' && source.secondaryButtonLabel.trim() ? source.secondaryButtonLabel.trim() : (fallback.secondaryButtonLabel || 'See the map'),
    secondaryButtonTab,
    coverHeadline: typeof source.coverHeadline === 'string' && source.coverHeadline.trim() ? source.coverHeadline.trim() : (fallback.coverHeadline || 'Add a cover when your story takes shape.'),
    coverLabel: typeof source.coverLabel === 'string' && source.coverLabel.trim() ? source.coverLabel.trim() : (fallback.coverLabel || 'Custom cover'),
    coverYear: typeof source.coverYear === 'string' && source.coverYear.trim() ? source.coverYear.trim() : (fallback.coverYear || String(new Date().getFullYear())),
    // Empty string means "no badge" and must survive sanitisation; falling
    // back to days.length would resurrect a stale count after dates are cleared.
    heroDayBadge: typeof source.heroDayBadge === 'string'
      ? source.heroDayBadge.trim()
      : (typeof fallback.heroDayBadge === 'string' ? fallback.heroDayBadge : undefined),
    heroDayBadgeUnit: typeof source.heroDayBadgeUnit === 'string'
      ? source.heroDayBadgeUnit.trim()
      : optionalText(fallback.heroDayBadgeUnit),
    cities: sanitizedCities.length > 0 ? Array.from(new Set(sanitizedCities)) : Array.from(new Set(sanitizedDays.map((day) => day.city).filter(Boolean))),
    days: sanitizedDays,
  };
};
