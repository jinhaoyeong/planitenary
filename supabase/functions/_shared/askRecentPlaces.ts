/**
 * Turning last turn's tokens into this turn's trusted places.
 *
 * `askPlaceToken` answers "did this server issue this?". This module answers
 * the separate and larger question: "is it still true, and what is it called?"
 *
 * A signature is a statement about the past. Link tables get corrected, merged
 * and repaired, so a perfectly valid token can name a relationship that no
 * longer holds — and acting on it would be presenting yesterday's identity as
 * today's fact. Every reference is therefore re-resolved against
 * `place_provider_links` and required to land on the same canonical place it
 * was signed with. This is the same re-check Smart Plan performs on a reference
 * recovered from stored JSON, for the same reason: three syntactically valid
 * strings are not a proof.
 *
 * Names come from `canonical_places`, never from the conversation. The browser
 * may hold a card that says "Shinjuku Gyoen"; what the model is told this place
 * is called comes out of the server's own record, so a renamed card cannot
 * rename a place.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { readCanonicalPlaceRecords, readPlaceProviderLinks } from './cache.ts';
import type { ConversationTurn } from './intelligenceContext.ts';
import {
  MAX_ASK_PLACE_TOKENS_PER_REQUEST,
  recentPlaceAlias,
  verifyAskPlaceRef,
  type AskPlaceRefFailure,
} from './askPlaceToken.ts';

/** One previous-turn place the server is willing to vouch for again. */
export interface RecentTrustedPlace {
  /** `recent-place-1`, `recent-place-2`… the only handle the model needs. */
  alias: string;
  canonicalPlaceId: string;
  provider: string;
  providerPlaceId: string;
  /** From `canonical_places`, never from the client. */
  name: string;
  city?: string;
  area?: string;
  coordinates?: [number, number];
}

/** Why a reference did not survive. Operator diagnostics only — never shown. */
export type RecentPlaceRejection = AskPlaceRefFailure | 'link-missing' | 'link-mismatch' | 'no-record';

export interface RecentTrustedPlaceResult {
  places: RecentTrustedPlace[];
  /** Counted by reason, with no token contents and no place identity. */
  rejected: Partial<Record<RecentPlaceRejection, number>>;
}

/**
 * The tokens a follow-up may act on: the most recent answer's, and only those.
 *
 * "The second one" means the second place in the answer directly above the
 * question. Gathering tokens from several turns would make that phrase
 * genuinely ambiguous — two answers, two different second places — so reaching
 * further back would trade a correct answer for a wider one.
 */
export function latestTurnPlaceTokens(conversation: ConversationTurn[]): string[] {
  for (let index = conversation.length - 1; index >= 0; index -= 1) {
    const tokens = conversation[index].trustedPlaceTokens;
    if (tokens && tokens.length > 0) return tokens.slice(0, MAX_ASK_PLACE_TOKENS_PER_REQUEST);
  }
  return [];
}

/**
 * Verify, re-resolve, and name the places a follow-up refers to.
 *
 * Fails quietly and per-reference. One token that cannot be re-established
 * costs that one place its alias; it never fails the request, and the
 * traveller is never told which of their previous cards could not be verified.
 * The answer simply proceeds with whatever the server can still stand behind —
 * which may be nothing, in which case the model researches afresh.
 */
export async function resolveRecentTrustedPlaces(input: {
  client: SupabaseClient | null;
  secret: string | undefined;
  tokens: string[];
  userId: string;
  tripId: string;
  now?: Date;
}): Promise<RecentTrustedPlaceResult> {
  const rejected: Partial<Record<RecentPlaceRejection, number>> = {};
  const note = (reason: RecentPlaceRejection) => { rejected[reason] = (rejected[reason] ?? 0) + 1; };

  if (!input.client || input.tokens.length === 0) return { places: [], rejected };

  /**
   * Signature first, database second. An unverified token must never become a
   * database query: that would let anyone with the origin enumerate the link
   * table by sending ids and watching what came back.
   */
  const verified: Array<{ canonicalPlaceId: string; provider: string; providerPlaceId: string }> = [];
  for (const token of input.tokens.slice(0, MAX_ASK_PLACE_TOKENS_PER_REQUEST)) {
    const outcome = await verifyAskPlaceRef(input.secret, token, {
      userId: input.userId,
      tripId: input.tripId,
      now: input.now,
    });
    if (!outcome.ok) {
      note(outcome.reason);
      continue;
    }
    // Order is preserved and duplicates collapse: two cards for one place would
    // otherwise consume two aliases and make "the second one" wrong.
    if (verified.some((held) => held.canonicalPlaceId === outcome.ref.canonicalPlaceId)) continue;
    verified.push({
      canonicalPlaceId: outcome.ref.canonicalPlaceId,
      provider: outcome.ref.provider,
      providerPlaceId: outcome.ref.providerPlaceId,
    });
  }
  if (verified.length === 0) return { places: [], rejected };

  const links = await readPlaceProviderLinks(input.client, verified.map((entry) => entry.providerPlaceId));

  /**
   * The signature said what this place was when the card was issued. The link
   * table says what it is now. Only a reference where those still agree is
   * allowed to carry authority into this turn.
   */
  const current = verified.filter((entry) => {
    const link = links.get(entry.providerPlaceId);
    if (!link) {
      note('link-missing');
      return false;
    }
    if (link.canonicalPlaceId !== entry.canonicalPlaceId || link.provider !== entry.provider) {
      note('link-mismatch');
      return false;
    }
    return true;
  });
  if (current.length === 0) return { places: [], rejected };

  const records = await readCanonicalPlaceRecords(input.client, current.map((entry) => entry.canonicalPlaceId));

  const places: RecentTrustedPlace[] = [];
  for (const entry of current) {
    const record = records.get(entry.canonicalPlaceId);
    // Without a canonical record there is no server-owned name, and the client's
    // is not an acceptable substitute. A place nobody can name is not offered.
    if (!record) {
      note('no-record');
      continue;
    }
    places.push({
      alias: recentPlaceAlias(places.length),
      canonicalPlaceId: entry.canonicalPlaceId,
      provider: entry.provider,
      providerPlaceId: entry.providerPlaceId,
      name: record.name,
      city: record.city,
      area: record.area,
      coordinates: record.coordinates,
    });
  }

  return { places, rejected };
}

/**
 * What the model is told about them.
 *
 * An alias and a name, in the order the cards were shown. Enough to resolve
 * "the second one" to a handle the tools understand, and deliberately not
 * enough to state a fact — no opening hours, no travel time, no coordinates.
 * Those still require a tool call, exactly as they do for a place found this
 * turn.
 */
export const presentRecentPlaces = (places: RecentTrustedPlace[]) =>
  places.map((place) => ({
    ref: place.alias,
    name: place.name,
    ...(place.area || place.city ? { where: [place.area, place.city].filter(Boolean).join(', ') } : {}),
  }));
