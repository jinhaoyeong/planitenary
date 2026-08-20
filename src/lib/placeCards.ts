/**
 * Ask the server what a decision was actually about.
 *
 * Smart Plan already holds a `StructuredPlaceRef` locally — `deriveSmartActions`
 * needs it to decide, deterministically and offline, whether an action *could*
 * show a card. That reference is fine for reasoning about our own UI state and
 * useless as proof, because it reached us through a browser.
 *
 * So the request names a decision, never a place. The server re-reads the
 * traveller's owned trip, recovers the reference stored against that decision,
 * re-checks it against the provider link table and resolves the factual card
 * itself. A client that lies about which place a decision points at changes
 * nothing: it can only ask about a decision, and the answer comes from storage
 * it does not control.
 *
 * Costs no model call. The operation is refused entry to the AI tier by the
 * server's own control flow, not by convention.
 */
import { invokeTravelFunction } from './supabase';
import {
  parseStructuredPlaceCard,
  type StructuredPlaceCard,
} from '../../supabase/functions/_shared/placeReference';
import { isWikimediaImageUrl } from '../../supabase/functions/_shared/placeImages';

/** Matches the server bound; asking for more is silently trimmed there anyway. */
const MAX_DECISION_KEYS = 5;

export interface PlaceCardsInput {
  tripId: string;
  decisionKeys: string[];
}

/**
 * Cards by decision key, holding only what the server could stand behind.
 *
 * A key is simply absent when its decision has no stored reference, when the
 * reference no longer matches the link table, or when nothing authoritative is
 * recorded about the place. Absent is the normal case for every decision made
 * before references existed, and the caller shows its ordinary prose instead.
 */
export async function resolvePlaceCards(
  input: PlaceCardsInput,
  invoke: (name: string, body: unknown) => Promise<unknown> = invokeTravelFunction,
): Promise<Map<string, StructuredPlaceCard>> {
  const cards = new Map<string, StructuredPlaceCard>();
  const decisionKeys = [...new Set(input.decisionKeys.filter(Boolean))].slice(0, MAX_DECISION_KEYS);
  if (!input.tripId || decisionKeys.length === 0) return cards;

  let payload: unknown;
  try {
    payload = await invoke('planitenary-agent', {
      operation: 'resolve-place-cards',
      tripId: input.tripId,
      decisionKeys,
    });
  } catch {
    // A card is an addition to an action, never the action itself.
    return cards;
  }

  const raw = payload && typeof payload === 'object' ? payload as Record<string, unknown> : undefined;
  if (!Array.isArray(raw?.cards)) return cards;

  for (const entry of raw.cards.slice(0, MAX_DECISION_KEYS)) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    const decisionKey = typeof row.decisionKey === 'string' ? row.decisionKey : '';
    /**
     * Re-checked for shape on arrival, and the photograph re-checked for host:
     * an `<img src>` is loaded by the traveller's browser, so a URL outside
     * Wikimedia would hand a stranger the IP address of everyone who sees the
     * card. Same rule the deck and Ask apply.
     */
    const place = parseStructuredPlaceCard(row.place, isWikimediaImageUrl);
    // Only answers to questions we asked. A key we never sent is ignored.
    if (!decisionKey || !place || !decisionKeys.includes(decisionKey)) continue;
    cards.set(decisionKey, place);
  }
  return cards;
}
