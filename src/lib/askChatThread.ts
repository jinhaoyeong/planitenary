/**
 * The Ask Planitenary conversation, as the browser holds it.
 *
 * Three separate bounds run through this module, and conflating any two of
 * them is how a chat feature quietly becomes expensive or unsafe:
 *
 * **What the traveller sees** is the longest — tens of messages, so scrolling
 * back to reread an answer works. It lives here, in this browser.
 *
 * **What the model sees** is much shorter, and is not decided here at all. The
 * client offers recent turns; `parseConversationTurns` on the server is what
 * actually bounds them. That direction matters: a bound enforced only by the
 * sender is not a bound, because the sender is a browser.
 *
 * **What is trusted** is narrower still, and is nothing this file holds. A
 * message restored from `localStorage` is text a browser had write access to.
 * It may be displayed and it may remind the model what "that place" referred
 * to, but it can never establish a canonical place, a coordinate, or an
 * opening time — those come from the server's own grounding on every request.
 *
 * The structural guarantee is what {@link conversationTurnsFrom} may emit:
 * two strings, plus opaque tokens this server signed. There is no field on
 * the wire for a `canonicalPlaceId`, a provider id or a coordinate, so a
 * fabricated identity has nowhere to travel — and a token altered here stops
 * verifying rather than starting to lie. The browser carries a reference it
 * cannot read; only the server that signed it can turn it back into a place.
 *
 * No React and no direct `localStorage` access: every touch goes through the
 * safe wrappers, and the logic stays testable without a DOM.
 */

import {
  approximateEntryBytes,
  safeGetItem,
  safeRemoveItem,
  safeSetItemWithBudget,
} from './safeLocalStorage';
import type { ConversationTurn } from '../../supabase/functions/_shared/intelligenceContext';
import {
  MAX_PLACE_CARDS,
  parseStructuredPlaceCard,
  type StructuredPlaceCard,
} from '../../supabase/functions/_shared/placeReference';
import { isWikimediaImageUrl } from '../../supabase/functions/_shared/placeImages';
import {
  parseAskPriceFacts,
  type AskPriceFact,
} from '../../supabase/functions/_shared/askPriceFacts';

/** How an assistant turn ended, so a refusal can read differently from an answer. */
export type AskChatStatus = 'answered' | 'partial' | 'refused';

/**
 * One message in the visible conversation.
 *
 * Deliberately smaller than `AskResult`. What an answer *said* and what it
 * *pointed at* is conversation; how it was produced is diagnostics, and
 * diagnostics do not belong in a store the traveller cannot see or clear
 * field-by-field. See {@link serialiseAskChat} for what is left out and why.
 */
export interface AskChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** ISO 8601. Ordering comes from array position; this is for display only. */
  createdAt: string;
  /** Assistant turns only. */
  status?: AskChatStatus;
  /**
   * Cards the *server* resolved for this answer, kept beside the message they
   * belong to so a follow-up does not scroll them off the record.
   *
   * Re-checked on every read by the same parser the network path uses. That
   * check establishes shape and image host — never authority. A card read back
   * from storage is a picture of a place, not proof of one.
   */
  places?: StructuredPlaceCard[];
  /** Sources the answer cited. Re-checked as absolute http(s) on read. */
  citations?: string[];
  /**
   * Opaque server-signed references, one per card, matched by canonical id.
   *
   * Capability metadata, not content: never rendered, never inspected, and
   * meaningless to anything but the server that signed it. This is what lets
   * "is the second one open late?" work for a place that was never saved to
   * the trip — the browser carries the reference without ever holding the
   * identity inside it.
   *
   * Editing one here does not promote a fabricated place; it invalidates a
   * signature, and the server drops it. See {@link conversationTurnsFrom}.
   */
  placeTokens?: Array<{ canonicalPlaceId: string; token: string }>;
  /** Source price facts kept with the answer for refresh/reopen. */
  priceFacts?: AskPriceFact[];
  currency?: { selected?: string; home?: string; trip?: string; source?: string };
  budgetStatus?: { requested: boolean; present: boolean };
}

/**
 * Visible history, in messages.
 *
 * Generous on purpose: rereading what was said four questions ago is most of
 * why a conversation beats a one-shot box. It costs nothing per request,
 * because the model never sees this far back.
 */
export const ASK_CHAT_MAX_MESSAGES = 40;

/**
 * Visible history, in bytes, measured the way the storage layer measures.
 *
 * The message cap alone is not a size bound: one answer may carry four
 * thousand characters and five place cards, so forty of them could take far
 * more of the origin quota than a chat log deserves. Whichever bound bites
 * first wins.
 */
export const ASK_CHAT_SOFT_LIMIT_BYTES = 128_000;

/**
 * Turns offered to the model with a follow-up.
 *
 * Four, matching what `parseConversationTurns` already keeps, so the client
 * does not build a payload the server will silently discard the front of. The
 * server remains the authority on this number; changing it here alone changes
 * nothing.
 */
export const ASK_CHAT_CONTEXT_TURNS = 4;

const STORAGE_PREFIX = 'ask-chat-';

/**
 * The storage scope for one account, matching the itinerary key convention.
 *
 * A demo session is its own scope rather than sharing `account`, because the
 * demo trip is seeded identically for everyone and its chat must not survive
 * into a real sign-in on the same browser.
 */
export const askChatStorageScope = (input: { userId?: string; isDemoUser?: boolean }): string => {
  if (input.isDemoUser) return 'demo';
  return input.userId || 'account';
};

/**
 * Where one trip's conversation lives.
 *
 * `ask-chat-<scope>-<tripId>`, so `parseTripIdFromKey` can attribute it and
 * the orphan sweep can reclaim it when the trip is gone. Trip id is last for
 * that reason — the parser reads the scope off the front.
 */
export const askChatStorageKey = (input: {
  tripId: string;
  userId?: string;
  isDemoUser?: boolean;
}): string => `${STORAGE_PREFIX}${askChatStorageScope(input)}-${input.tripId}`;

/** Ids only have to be unique within one browser list, never guessed. */
export const askChatMessageId = (): string => {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // Some privacy modes throw on `crypto` access. A weaker id is still fine.
  }
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

const text = (value: unknown, max: number): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
};

/** A signature plus a small payload. Nothing longer is one. */
const MAX_PLACE_TOKEN_CHARS = 1_024;

const citable = (value: unknown): value is string =>
  typeof value === 'string' && /^https?:\/\//i.test(value.trim());

/**
 * Turn one stored entry back into a message, or drop it.
 *
 * Every field is re-derived rather than trusted, including the ones that look
 * harmless. This is not defence against a hostile user — it is their own
 * browser — but against a half-written entry, an older build's shape, and an
 * extension that edited the origin. A malformed message must cost one message,
 * never the conversation and never a render crash.
 */
const parseAskChatMessage = (value: unknown): AskChatMessage | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;

  const role = raw.role === 'user' || raw.role === 'assistant' ? raw.role : undefined;
  const body = text(raw.text, 4_000);
  if (!role || !body) return undefined;

  const status = raw.status === 'answered' || raw.status === 'partial' || raw.status === 'refused'
    ? raw.status
    : undefined;

  const createdAt = text(raw.createdAt, 40);
  const parsedDate = createdAt ? new Date(createdAt) : undefined;

  return {
    id: text(raw.id, 80) ?? askChatMessageId(),
    role,
    text: body,
    createdAt: parsedDate && !Number.isNaN(parsedDate.getTime())
      ? parsedDate.toISOString()
      : new Date(0).toISOString(),
    // A user turn carries neither, whatever the stored entry claims.
    ...(role === 'assistant' && status ? { status } : {}),
    ...(role === 'assistant' && Array.isArray(raw.places)
      ? {
        places: raw.places
          .map((entry) => parseStructuredPlaceCard(entry, isWikimediaImageUrl))
          .filter((card): card is StructuredPlaceCard => Boolean(card))
          .slice(0, MAX_PLACE_CARDS),
      }
      : {}),
    ...(role === 'assistant' && Array.isArray(raw.citations)
      ? { citations: raw.citations.filter(citable).slice(0, 12) }
      : {}),
    ...(role === 'assistant' && Array.isArray(raw.priceFacts)
      ? { priceFacts: parseAskPriceFacts(raw.priceFacts) }
      : {}),
    ...(role === 'assistant' && raw.currency && typeof raw.currency === 'object' && !Array.isArray(raw.currency)
      ? {
        currency: {
          selected: text((raw.currency as Record<string, unknown>).selected, 3),
          home: text((raw.currency as Record<string, unknown>).home, 3),
          trip: text((raw.currency as Record<string, unknown>).trip, 3),
          source: text((raw.currency as Record<string, unknown>).source, 40),
        },
      }
      : {}),
    ...(role === 'assistant' && raw.budgetStatus && typeof raw.budgetStatus === 'object' && !Array.isArray(raw.budgetStatus)
      ? {
        budgetStatus: {
          requested: (raw.budgetStatus as Record<string, unknown>).requested === true,
          present: (raw.budgetStatus as Record<string, unknown>).present === true,
        },
      }
      : {}),
    ...(role === 'assistant' && Array.isArray(raw.places) && Array.isArray(raw.placeTokens)
      ? {
        placeTokens: raw.placeTokens.flatMap((entry) => {
          const row = entry as Record<string, unknown> | null;
          const canonicalPlaceId = text(row?.canonicalPlaceId, 200);
          /**
           * Length-checked, never truncated. Slicing a signature produces a
           * different string that cannot verify, so a too-long entry is
           * dropped outright rather than kept as something that will fail
           * later while occupying a slot a real reference could have used.
           * The contents are the server’s business either way.
           */
          const raw = row?.token;
          const token = typeof raw === 'string' && raw.length > 0 && raw.length <= MAX_PLACE_TOKEN_CHARS
            ? raw
            : undefined;
          return canonicalPlaceId && token ? [{ canonicalPlaceId, token }] : [];
        }).slice(0, MAX_PLACE_CARDS),
      }
      : {}),
  };
};

/**
 * The index the conversation may be cut at without splitting a turn.
 *
 * A turn starts at a user message, so the next safe cut is the next user
 * message. Cutting anywhere else leaves an answer with no question above it,
 * which reads as the assistant having said something unprompted.
 */
const nextTurnStart = (messages: AskChatMessage[], from: number): number => {
  for (let index = from; index < messages.length; index += 1) {
    if (messages[index].role === 'user') return index;
  }
  return messages.length;
};

const serialisedBytes = (messages: AskChatMessage[]): number =>
  approximateEntryBytes('', JSON.stringify(messages));

/**
 * Bring a conversation back inside both bounds, oldest turns first.
 *
 * The last turn is kept whatever it costs. A single long answer that exceeds
 * the byte budget on its own is still the answer the traveller is looking at,
 * and discarding it to satisfy a cache limit would be the storage layer
 * deciding what the conversation was about.
 */
export function trimAskChat(messages: AskChatMessage[]): AskChatMessage[] {
  let kept = messages;

  if (kept.length > ASK_CHAT_MAX_MESSAGES) {
    // Cut to a turn boundary at or after the plain message cap, so the result
    // is never longer than asked for and never starts mid-turn.
    kept = kept.slice(nextTurnStart(kept, kept.length - ASK_CHAT_MAX_MESSAGES));
  }

  while (kept.length > 0 && serialisedBytes(kept) > ASK_CHAT_SOFT_LIMIT_BYTES) {
    const next = nextTurnStart(kept, 1);
    if (next >= kept.length) break;
    kept = kept.slice(next);
  }

  return kept;
}

/**
 * What actually goes to disk.
 *
 * `steps` (which tools ran) and `proposal` are deliberately absent, for two
 * different reasons. Tool transcripts are diagnostics about how an answer was
 * produced, and this store holds the conversation rather than its machinery. A
 * proposal is a preview computed against the itinerary as it stood at the
 * time; restoring one a week later would describe a plan that has since
 * changed, and a stale preview presented as current is worse than no preview.
 *
 * Nothing here has ever held a prompt, a tool argument, a credential, or the
 * accounting ledger — those live server-side and never reach this type.
 */
const serialiseAskChat = (messages: AskChatMessage[]): string => JSON.stringify(
  messages.map((message) => ({
    id: message.id,
    role: message.role,
    text: message.text,
    createdAt: message.createdAt,
    ...(message.status ? { status: message.status } : {}),
    ...(message.places?.length ? { places: message.places } : {}),
    ...(message.citations?.length ? { citations: message.citations } : {}),
    ...(message.placeTokens?.length ? { placeTokens: message.placeTokens } : {}),
    ...(message.priceFacts?.length ? { priceFacts: message.priceFacts } : {}),
    ...(message.currency ? { currency: message.currency } : {}),
    ...(message.budgetStatus ? { budgetStatus: message.budgetStatus } : {}),
  })),
);

/** Every stored message, re-checked. Unreadable storage reads as no history. */
export function parseAskChat(raw: string | null): AskChatMessage[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return trimAskChat(
      parsed
        .map(parseAskChatMessage)
        .filter((message): message is AskChatMessage => Boolean(message)),
    );
  } catch {
    // A truncated or hand-edited entry is not a reason to break the panel.
    return [];
  }
}

export const readAskChat = (key: string): AskChatMessage[] => parseAskChat(safeGetItem(key));

/**
 * Persist one trip's conversation.
 *
 * An empty conversation removes the key rather than storing `[]`, so "New
 * chat" leaves nothing behind and a browser that never used Ask carries no
 * entry per trip. Failure is silent by design: this is a cache, and a
 * traveller mid-question must not be interrupted because the origin is full.
 */
export const writeAskChat = (key: string, messages: AskChatMessage[]): void => {
  if (messages.length === 0) {
    safeRemoveItem(key);
    return;
  }
  safeSetItemWithBudget(key, serialiseAskChat(trimAskChat(messages)));
};

export const clearAskChat = (key: string): void => { safeRemoveItem(key); };

/**
 * The bounded context a follow-up carries, newest turns last.
 *
 * Pairs each user message with the assistant reply that followed it, and skips
 * turns that have no usable answer — a refusal tells the model nothing about
 * what the traveller meant, and spending input tokens to say "that failed"
 * only crowds out the turns that do carry the referent.
 *
 * The return type is the whole security story: `ConversationTurn` is two
 * strings. There is no field here for a canonical place id, a coordinate or an
 * opening time to travel in, so history can say *what* the traveller is
 * referring to and can never say what is true about it.
 */
export function conversationTurnsFrom(
  messages: AskChatMessage[],
  limit: number = ASK_CHAT_CONTEXT_TURNS,
): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role !== 'user') continue;
    const reply = messages[index + 1];
    if (!reply || reply.role !== 'assistant') continue;
    if (reply.status === 'refused') continue;
    /**
     * Tokens travel in the order their cards were shown, which is what makes
     * "the second one" resolvable. A card with no token is skipped rather
     * than padded: a hole would shift every later ordinal by one and make
     * the model confidently answer about the wrong place.
     */
    const tokens = (reply.places ?? [])
      .map((card) => reply.placeTokens?.find(
        (entry) => entry.canonicalPlaceId === card.ref.canonicalPlaceId,
      )?.token)
      .filter((token): token is string => Boolean(token));
    turns.push(tokens.length > 0
      ? { question: message.text, answer: reply.text, trustedPlaceTokens: tokens }
      : { question: message.text, answer: reply.text });
  }
  return limit > 0 ? turns.slice(-limit) : [];
}
