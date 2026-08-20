/**
 * Trusted identity in, factual card out.
 *
 * This is the half of place-card resolution that has nothing to do with *how*
 * a reference was established. It takes references whose trust has already been
 * settled elsewhere and answers the separate question: what is true about this
 * place, and may we show a photograph of it?
 *
 * The two surfaces that use it prove trust in completely different ways, and
 * keeping that proof out of here is the point:
 *
 * - **Ask** earns a reference within one turn. A model may only point at ids a
 *   place-bearing tool returned during that same turn, checked against the
 *   server-owned index. Nothing is persisted and nothing is remembered.
 * - **Smart Plan** reads a reference that was captured, months ago perhaps,
 *   when discovery could prove it — recovered here from the traveller's own
 *   owned trip, never from the browser that is asking.
 *
 * Both then arrive at the same door with the same three strings, and from that
 * point the rules are identical. One resolver means a place cannot be more
 * loosely identified on one screen than another.
 *
 * ## Nothing here resolves by name
 *
 * Not as a fallback, not as a tiebreak, not when a lookup comes back empty. Two
 * places share a display name far more often than anyone expects — production
 * returned two `Tully's Coffee` in one Shinjuku search — and a card carries a
 * photograph, a location and the traveller's own decision, so attaching those
 * to the wrong place is the exact failure the image work has already had to
 * undo twice.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { readCanonicalPlaceRecords, readPlaceProviderLinks } from './cache.ts';
import { parsePlaceImage } from './placeImages.ts';
import { MAX_PLACE_CARDS, type StructuredPlaceCard, type StructuredPlaceRef } from './placeReference.ts';

/**
 * Presentation the caller already holds, used only where the canonical record
 * is silent. Never identity: nothing here can decide *which* place this is.
 */
export interface PlaceCardExtras {
  city?: string;
  area?: string;
  coordinates?: [number, number];
  category?: string;
  decision?: StructuredPlaceCard['decision'];
  onDay?: number;
}

/**
 * One place to resolve.
 *
 * `expect` is the whole difference between the two callers. Ask omits it: it
 * has a provider place id the index vouched for this turn, and the link table
 * is the authority on which canonical place that is. Smart Plan supplies it,
 * because its reference came out of stored JSON — and stored JSON can be stale,
 * hand-edited or corrupted. Three syntactically valid strings are not a proof,
 * so the relationship is re-checked against the link table rather than assumed
 * to still hold.
 */
export interface PlaceCardRequest {
  providerPlaceId: string;
  /** When present, the link table must still agree with it. */
  expect?: { canonicalPlaceId: string; provider: string };
  extras?: PlaceCardExtras;
}

/** How the caller reaches sibling functions. Injected so this stays testable. */
export type CallFunction = (name: string, body: unknown) => Promise<unknown>;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/**
 * Photographs, from canonical identity alone.
 *
 * No leads are sent, which is what makes this free: with nothing to look up,
 * `travel-images` answers out of the validated cache and makes zero provider
 * calls. Grouped by link provider because the function takes one provider per
 * request; in practice that is one request for the whole screen.
 */
async function readPhotographs(
  callFunction: CallFunction,
  byProvider: Map<string, string[]>,
): Promise<Map<string, NonNullable<StructuredPlaceCard['image']>>> {
  const photos = new Map<string, NonNullable<StructuredPlaceCard['image']>>();
  for (const [provider, providerPlaceIds] of byProvider) {
    try {
      const payload = asRecord(await callFunction('travel-images', { placeIds: providerPlaceIds, provider }));
      const images = asRecord(payload?.images);
      for (const providerPlaceId of providerPlaceIds) {
        const image = parsePlaceImage(asArray(images?.[providerPlaceId])[0]);
        // The credit is part of the permission to show the photograph, so a
        // picture without one is not shown at all.
        if (image?.attribution) {
          photos.set(providerPlaceId, {
            url: image.url,
            attribution: image.attribution,
            sourcePage: image.sourcePage,
          });
        }
      }
    } catch {
      // A card without a photograph is still a true card.
    }
  }
  return photos;
}

/**
 * Resolve trusted references into cards, dropping anything unprovable.
 *
 * Returns fewer cards than requests whenever something cannot be stood behind,
 * and never throws. A missing card costs a picture; a wrong one costs the
 * truth.
 */
export async function resolveStructuredPlaceCards(
  client: SupabaseClient | null,
  callFunction: CallFunction,
  requests: PlaceCardRequest[],
): Promise<StructuredPlaceCard[]> {
  const wanted = requests.filter((request) => request.providerPlaceId).slice(0, MAX_PLACE_CARDS);
  if (wanted.length === 0 || !client) return [];

  try {
    /**
     * The link table decides which provider a place is filed under — the
     * request does not get to assert it. A Wikivoyage listing found on an OSM
     * run is linked as OSM, and asking under 'wikivoyage' returns nothing at
     * all, silently.
     */
    const links = await readPlaceProviderLinks(client, wanted.map((request) => request.providerPlaceId));
    if (links.size === 0) return [];

    const resolved: Array<{ ref: StructuredPlaceRef; extras?: PlaceCardExtras }> = [];
    for (const request of wanted) {
      const link = links.get(request.providerPlaceId);
      if (!link) continue;
      /**
       * A stored reference must still describe the same relationship it did
       * when it was captured. If the link table now maps this provider place
       * id somewhere else, the stored canonical id is stale and the honest
       * answer is no card — not a card built on the newer mapping, which the
       * traveller never decided anything about.
       */
      if (request.expect
        && (request.expect.canonicalPlaceId !== link.canonicalPlaceId || request.expect.provider !== link.provider)) {
        continue;
      }
      resolved.push({
        ref: {
          canonicalPlaceId: link.canonicalPlaceId,
          provider: link.provider,
          providerPlaceId: request.providerPlaceId,
        },
        extras: request.extras,
      });
    }
    if (resolved.length === 0) return [];

    const records = await readCanonicalPlaceRecords(client, resolved.map((entry) => entry.ref.canonicalPlaceId));

    const byProvider = new Map<string, string[]>();
    for (const { ref } of resolved) {
      byProvider.set(ref.provider, [...(byProvider.get(ref.provider) || []), ref.providerPlaceId]);
    }
    const photos = await readPhotographs(callFunction, byProvider);

    const cards: StructuredPlaceCard[] = [];
    for (const { ref, extras } of resolved) {
      const record = records.get(ref.canonicalPlaceId);
      // No canonical record means nothing authoritative to display. The place
      // stays wherever it was mentioned; it does not become a card.
      if (!record) continue;
      cards.push({
        ref,
        name: record.name,
        city: record.city ?? extras?.city,
        area: record.area ?? extras?.area,
        coordinates: record.coordinates ?? extras?.coordinates,
        category: extras?.category,
        image: photos.get(ref.providerPlaceId),
        decision: extras?.decision,
        onDay: extras?.onDay,
      });
    }
    return cards.slice(0, MAX_PLACE_CARDS);
  } catch {
    // Cards are an enhancement. A screen without them still works.
    return [];
  }
}
