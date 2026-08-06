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
  const openingHours = source.openingHours && typeof source.openingHours === 'object'
    ? (() => {
        const raw = source.openingHours as unknown as Record<string, unknown>;
        const days = Array.isArray(raw.days) ? raw.days.filter((day): day is number => typeof day === 'number' && Number.isInteger(day) && day >= 0 && day <= 6) : undefined;
        return {
          label: typeof raw.label === 'string' ? raw.label.trim() : undefined,
          opensAt: typeof raw.opensAt === 'string' ? raw.opensAt.trim() : undefined,
          closesAt: typeof raw.closesAt === 'string' ? raw.closesAt.trim() : undefined,
          days,
          sourceUpdatedAt: typeof raw.sourceUpdatedAt === 'string' ? raw.sourceUpdatedAt : undefined,
        };
      })()
    : undefined;
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
    location,
    cost: typeof source.cost === 'string' ? source.cost : undefined,
    estimatedCost,
    bookingStatus,
    reservationRequirement: source.reservationRequirement === 'not-needed' || source.reservationRequirement === 'recommended' || source.reservationRequirement === 'required' || source.reservationRequirement === 'unknown'
      ? source.reservationRequirement
      : undefined,
    openingHours,
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
  city: '',
  title: `Day ${index + 1}`,
  activities: [],
});

export const sanitizeDay = (value: unknown, fallbackDay: DayPlan | undefined, index: number, tripId = 'trip'): DayPlan => {
  const source = value && typeof value === 'object' ? value as Partial<DayPlan> : {};
  // Generated trips have more days than the blank template they sanitize against.
  const fallback = fallbackDay ?? blankDay(index);
  const activityFallbacks = fallback.activities.length > 0
    ? fallback.activities
    : [{ time: '09:00', name: 'Untitled activity', description: '', type: 'other' as ActivityType }];
  // An explicitly empty day is valid (generated trip skeletons start blank).
  const sourceActivities = Array.isArray(source.activities) ? source.activities : activityFallbacks;

  return {
    day: index + 1,
    date: typeof source.date === 'string' && source.date.trim() ? source.date : fallback.date,
    city: typeof source.city === 'string' && source.city.trim() ? source.city : fallback.city,
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
 */
export const isNewerItineraryRevision = (incoming: Itinerary, current: Itinerary | null): boolean =>
  !current || (incoming.revision || 0) > (current.revision || 0);

export const sanitizeItinerary = (value: unknown, fallback: Itinerary): Itinerary => {
  const source = value && typeof value === 'object' ? value as Partial<Itinerary> : {};
  const sourceDays = Array.isArray(source.days) && source.days.length > 0 ? source.days : fallback.days;
  const sanitizedDays = sourceDays.map((day, index) => sanitizeDay(day, fallback.days[index] || fallback.days[fallback.days.length - 1], index, fallback.id));
  const fallbackActivity = { time: '09:00', name: 'Unassigned activity', description: '', type: 'other' as ActivityType };
  const unassignedActivities = Array.isArray(source.unassignedActivities)
    ? source.unassignedActivities.map((activity, index) => sanitizeActivity(activity, fallbackActivity, index, `${fallback.id}|inbox`))
    : (Array.isArray(fallback.unassignedActivities) ? fallback.unassignedActivities : []);
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
    tripProfile: sanitizeTripProfile(source.tripProfile) ?? sanitizeTripProfile(fallback.tripProfile) ?? undefined,
    fieldSources: sanitizeFieldSources(source.fieldSources) ?? sanitizeFieldSources(fallback.fieldSources),
    schemaVersion: typeof source.schemaVersion === 'number' ? Math.max(1, Math.round(source.schemaVersion)) : 1,
    revision: typeof source.revision === 'number' ? Math.max(0, Math.round(source.revision)) : (fallback.revision || 0),
    planningConstraints: sanitizePlanningConstraints(source.planningConstraints) ?? sanitizePlanningConstraints(fallback.planningConstraints),
    plannerSuggestions: Array.isArray(source.plannerSuggestions) ? source.plannerSuggestions.slice(-20) : (fallback.plannerSuggestions || []),
    discoveryState: sanitizeDiscoveryState(source.discoveryState) ?? sanitizeDiscoveryState(fallback.discoveryState),
    plannerHistory: sanitizePlannerHistory(source.plannerHistory) ?? sanitizePlannerHistory(fallback.plannerHistory),
    unassignedActivities,
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
