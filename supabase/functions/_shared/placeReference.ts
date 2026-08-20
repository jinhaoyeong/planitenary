/**
 * One structured reference to one real place, shared by every surface that
 * shows a place card.
 *
 * ## What is deliberately absent
 *
 * There is no `name` here, and no `category`. Both are presentation, resolved
 * from the canonical record at render time — the rule `decisionTarget.ts`
 * already states plainly: *names are never consulted*. Two places can share a
 * display name, and a reference that carried one would invite somebody to
 * match on it later. A card built from a name is the failure this project
 * spent several rounds removing from the image path; it must not re-enter
 * through the card.
 *
 * ## Which `provider` this is
 *
 * The **link** provider — the one `place_provider_links` is keyed by, which is
 * the provider discovery ran under. It is *not* the provider a candidate
 * displays as its own provenance. A Wikivoyage listing found on an OSM
 * discovery run carries `provider: 'wikivoyage'` on the candidate and is
 * linked under `'osm'`; asking the image service for it under the former
 * returns nothing at all, silently. That is why this field is filled in by the
 * resolver, from the link table, rather than copied off a candidate.
 */

/** The trusted half of a place card. Never assembled from model output. */
export interface StructuredPlaceRef {
  canonicalPlaceId: string;
  /** The provider `place_provider_links` is keyed by. See the module note. */
  provider: string;
  providerPlaceId: string;
}

/**
 * The presentation half, resolved server-side from the reference.
 *
 * Every field here comes from a record the server already holds. A field the
 * server cannot answer is absent rather than guessed — the same standard the
 * rest of the app applies to prices, hours and photographs.
 */
export interface StructuredPlaceCard {
  ref: StructuredPlaceRef;
  /** Canonical display name. Presentation only; never an identifier. */
  name: string;
  city?: string;
  /** Neighbourhood or area, when one is recorded. */
  area?: string;
  coordinates?: [number, number];
  category?: string;
  /** A real photograph, or nothing. Never generated — see `placeImages.ts`. */
  image?: {
    url: string;
    /** Required alongside the photograph: CC BY and CC BY-SA both demand it. */
    attribution: string;
    sourcePage: string;
  };
  /** The traveller's existing decision, read from canonical decision state. */
  decision?: 'must-do' | 'interested' | 'skip' | 'visited';
  /** Which day this place already sits on, when it is on the plan. */
  onDay?: number;
}

/**
 * How many cards one answer may carry.
 *
 * A bound rather than a truncation policy: prose keeps every recommendation it
 * made, and the cards are the handful worth showing a picture of. Twenty cards
 * in a chat drawer is a second discovery page nobody asked for.
 */
export const MAX_PLACE_CARDS = 5;

const text = (value: unknown, max: number): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;

/**
 * Validate a reference that has crossed a network boundary.
 *
 * Shape only. Whether the reference names a place this traveller may see is a
 * question for the resolver, which answers it against the database rather than
 * against the payload.
 */
export function parseStructuredPlaceRef(value: unknown): StructuredPlaceRef | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const canonicalPlaceId = text(raw.canonicalPlaceId, 120);
  const provider = text(raw.provider, 40);
  const providerPlaceId = text(raw.providerPlaceId, 200);
  if (!canonicalPlaceId || !provider || !providerPlaceId) return undefined;
  return { canonicalPlaceId, provider, providerPlaceId };
}

/** Stable identity for de-duplicating cards within one response. */
export const placeRefKey = (ref: StructuredPlaceRef): string => ref.canonicalPlaceId;

const DECISIONS = ['must-do', 'interested', 'skip', 'visited'] as const;

/**
 * Validate a card that has crossed a network boundary.
 *
 * The image is held to the same host rule an `<img src>` is held to
 * everywhere else: a photograph is accepted only from a Wikimedia host, and
 * only with the credit that licences it. A card whose picture fails either
 * test keeps the place and loses the picture, which is the honest outcome.
 */
export function parseStructuredPlaceCard(
  value: unknown,
  isAllowedImageUrl: (url: string | undefined) => boolean,
): StructuredPlaceCard | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const ref = parseStructuredPlaceRef(raw.ref);
  const name = text(raw.name, 160);
  if (!ref || !name) return undefined;

  const rawImage = raw.image && typeof raw.image === 'object' ? raw.image as Record<string, unknown> : undefined;
  const url = text(rawImage?.url, 600);
  const attribution = text(rawImage?.attribution, 300);
  const sourcePage = text(rawImage?.sourcePage, 600);
  const image = url && attribution && sourcePage && isAllowedImageUrl(url) && /^https:\/\//i.test(sourcePage)
    ? { url, attribution, sourcePage }
    : undefined;

  const coordinates = Array.isArray(raw.coordinates)
    && raw.coordinates.length === 2
    && raw.coordinates.every((part) => typeof part === 'number' && Number.isFinite(part))
    ? [raw.coordinates[0], raw.coordinates[1]] as [number, number]
    : undefined;

  const decision = typeof raw.decision === 'string'
    && (DECISIONS as readonly string[]).includes(raw.decision)
    ? raw.decision as StructuredPlaceCard['decision']
    : undefined;

  return {
    ref,
    name,
    city: text(raw.city, 120),
    area: text(raw.area, 120),
    coordinates,
    category: text(raw.category, 60),
    image,
    decision,
    onDay: typeof raw.onDay === 'number' && Number.isInteger(raw.onDay) && raw.onDay > 0
      ? raw.onDay
      : undefined,
  };
}
