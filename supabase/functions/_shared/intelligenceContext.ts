/**
 * Shared trip-intelligence context: what the browser may hint, and what the
 * server is allowed to believe.
 *
 * Both header entrances — Smart Plan and Ask Planitenary — send the same
 * envelope. It names *where the traveller is looking*. It is never the source
 * of a time, price, coordinate, decision, flight duration, or schedule. Those
 * are rehydrated from the owned itinerary after `readOwnedTrip`.
 */

export const INTELLIGENCE_SURFACES = [
  'itinerary',
  'map',
  'budget',
  'documents',
  'saved',
  'draft',
  'checklist',
  'photos',
  'profile',
  'settings',
] as const;

export type IntelligenceSurface = typeof INTELLIGENCE_SURFACES[number];

export const isIntelligenceSurface = (value: unknown): value is IntelligenceSurface =>
  typeof value === 'string' && (INTELLIGENCE_SURFACES as readonly string[]).includes(value);

/** Hints the browser may send. Identifiers only — never authoritative facts. */
export interface IntelligenceUiEnvelope {
  tripId?: string;
  surface?: IntelligenceSurface;
  dayNumber?: number;
  selectedActivityId?: string;
  selectedPlaceId?: string;
  selectedDocumentId?: string;
  selectedMapPoint?: { lat: number; lng: number };
}

export interface ConversationTurn {
  question: string;
  answer: string;
  /**
   * Opaque server-signed references to places this answer showed cards for.
   *
   * The shape is the security property. There is no `canonicalPlaceId`,
   * `provider`, `providerPlaceId` or coordinate field on a turn, so a browser
   * has nowhere to put a fabricated identity — the only thing it can offer is
   * a string this server signed, and it cannot alter one without breaking it.
   *
   * Ordered as the cards were shown, which is what makes "the second one"
   * answerable. A token is a claim to re-check, never a fact: the agent still
   * re-resolves the provider link before any of it becomes authority.
   */
  trustedPlaceTokens?: string[];
}

/** What the model may see as "the thing the traveller is looking at". */
export interface IntelligenceFocus {
  surface: IntelligenceSurface;
  dayNumber?: number;
  selectedActivity?: {
    id: string;
    name: string;
    time?: string;
    durationMinutes?: number;
    type?: string;
    day?: number;
  };
  selectedPlace?: { id: string; name: string };
  selectedDocumentId?: string;
  mapView?: { lat: number; lng: number };
  note: string;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const text = (value: unknown, max: number): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max ? trimmed : undefined;
};

const dayNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 60 ? value : undefined;

const finiteCoord = (value: unknown, min: number, max: number): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : undefined;

/**
 * Parse a client envelope, dropping anything that looks like a fact.
 *
 * Unknown keys are ignored. A supplied `time`, `price`, `coordinates` on an
 * activity, `decision`, or `durationMinutes` never survives — those belong to
 * the owned itinerary.
 */
export function parseUiContextEnvelope(value: unknown): IntelligenceUiEnvelope | undefined {
  const raw = asRecord(value);
  if (!raw) return undefined;
  const surface = isIntelligenceSurface(raw.surface) ? raw.surface : undefined;
  const tripId = text(raw.tripId, 180);
  const selectedActivityId = text(raw.selectedActivityId, 120);
  const selectedPlaceId = text(raw.selectedPlaceId, 120);
  const selectedDocumentId = text(raw.selectedDocumentId, 80);
  const point = asRecord(raw.selectedMapPoint);
  const lat = finiteCoord(point?.lat, -90, 90);
  const lng = finiteCoord(point?.lng, -180, 180);
  const envelope: IntelligenceUiEnvelope = {};
  if (tripId) envelope.tripId = tripId;
  if (surface) envelope.surface = surface;
  const day = dayNumber(raw.dayNumber);
  if (day !== undefined) envelope.dayNumber = day;
  if (selectedActivityId) envelope.selectedActivityId = selectedActivityId;
  if (selectedPlaceId) envelope.selectedPlaceId = selectedPlaceId;
  if (selectedDocumentId) envelope.selectedDocumentId = selectedDocumentId;
  if (lat !== undefined && lng !== undefined) envelope.selectedMapPoint = { lat, lng };
  return Object.keys(envelope).length > 0 ? envelope : undefined;
}

/**
 * One token is a signature plus a small payload, and nothing longer is one.
 * The cap stops a caller using the field as a channel for bulk data that the
 * request-size limit would otherwise have to absorb.
 */
const MAX_TOKEN_CHARS = 1_024;
const MAX_TOKENS_PER_TURN = 5;

/**
 * Read the bounded conversation a follow-up may carry.
 *
 * Note what is *not* read. Any other property on a turn — a place id, a
 * coordinate, a card, a name — is dropped here by construction rather than
 * rejected by a rule, because this builds a new object out of the three
 * fields it recognises. A browser adding `canonicalPlaceId` to a turn does
 * not get it refused; it gets it ignored, which is the same outcome with no
 * rule to forget to write.
 */
export function parseConversationTurns(value: unknown): ConversationTurn[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const row = asRecord(entry);
    const question = text(row?.question, 400);
    const answer = text(row?.answer, 800);
    if (!question || !answer) return [];
    const tokens = asArray(row?.trustedPlaceTokens)
      .filter((token): token is string =>
        typeof token === 'string' && token.length > 0 && token.length <= MAX_TOKEN_CHARS)
      .slice(0, MAX_TOKENS_PER_TURN);
    return [tokens.length > 0
      ? { question, answer, trustedPlaceTokens: tokens }
      : { question, answer }];
  }).slice(-4);
}

const findActivity = (
  itinerary: Record<string, unknown> | null,
  id: string,
): IntelligenceFocus['selectedActivity'] | undefined => {
  if (!itinerary) return undefined;
  const consider = (raw: unknown, day?: number) => {
    const activity = asRecord(raw);
    if (!activity || activity.id !== id) return undefined;
    const name = text(activity.name, 160);
    if (!name) return undefined;
    return {
      id,
      name,
      time: text(activity.time, 5),
      durationMinutes: typeof activity.durationMinutes === 'number' && Number.isFinite(activity.durationMinutes)
        ? activity.durationMinutes
        : undefined,
      type: text(activity.type, 40),
      day,
    };
  };
  for (const rawDay of asArray(itinerary.days)) {
    const day = asRecord(rawDay);
    const number = typeof day?.day === 'number' ? day.day : undefined;
    for (const activity of asArray(day?.activities)) {
      const match = consider(activity, number);
      if (match) return match;
    }
  }
  for (const activity of asArray(itinerary.unassignedActivities)) {
    const match = consider(activity);
    if (match) return match;
  }
  return undefined;
};

/**
 * Rehydrate a UI hint against the owned itinerary.
 *
 * A selected id that is not on this trip is dropped rather than trusted. Map
 * coordinates stay labelled as a view hint — they are "here" for the current
 * tab, not a saved place's coordinates.
 */
export function rehydrateIntelligenceFocus(
  itinerary: Record<string, unknown> | null,
  envelope: IntelligenceUiEnvelope | undefined,
  ownedTripId: string,
): IntelligenceFocus {
  const surface = envelope?.surface ?? 'itinerary';
  const activityId = envelope?.selectedActivityId || envelope?.selectedPlaceId;
  const selectedActivity = activityId ? findActivity(itinerary, activityId) : undefined;
  const dayFromTrip = selectedActivity?.day;
  const dayNumberHint = envelope?.dayNumber;
  const days = asArray(itinerary?.days).map(asRecord);
  const dayExists = (value?: number) =>
    value !== undefined && days.some((day) => day?.day === value);
  const dayNumber = dayExists(dayFromTrip) ? dayFromTrip : dayExists(dayNumberHint) ? dayNumberHint : undefined;

  const focus: IntelligenceFocus = {
    surface,
    note: 'Focus is a hint for default referents. Load facts with tools. Current itinerary wins over conversation.',
  };
  if (dayNumber !== undefined) focus.dayNumber = dayNumber;
  if (selectedActivity) {
    focus.selectedActivity = selectedActivity;
    focus.selectedPlace = { id: selectedActivity.id, name: selectedActivity.name };
  }
  if (envelope?.selectedDocumentId) focus.selectedDocumentId = envelope.selectedDocumentId;
  if (surface === 'map' && envelope?.selectedMapPoint) focus.mapView = envelope.selectedMapPoint;
  if (envelope?.tripId && envelope.tripId !== ownedTripId) {
    focus.note = 'The envelope trip id did not match the owned trip and was ignored.';
  }
  return focus;
}

/** Map the app shell tab onto an intelligence surface. */
export const surfaceFromAppTab = (tab: string): IntelligenceSurface => {
  if (tab === 'maps') return 'map';
  if (tab === 'draft') return 'saved';
  return isIntelligenceSurface(tab) ? tab : 'itinerary';
};
