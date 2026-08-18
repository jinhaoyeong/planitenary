/**
 * The client half of Ask Planitenary.
 *
 * Everything factual in an answer was already checked server-side against the
 * tool results that produced it. This module re-checks *shape* only, for the
 * reason `parseBrief` does on the evidence path: the payload crosses a network
 * boundary, and a malformed one must degrade to "no answer" rather than to a
 * panel that throws while a traveller is mid-question.
 *
 * It also enforces the one thing a client can enforce on its own — that a
 * proposal is never mistaken for a change. `applied` is read from the payload
 * and asserted false rather than assumed, so the day Phase 2 starts writing,
 * this layer has to be edited deliberately instead of quietly beginning to
 * misdescribe what happened.
 */

import { invokeTravelFunction } from './supabase';
import type { IntelligenceUiEnvelope, ConversationTurn } from '../../supabase/functions/_shared/intelligenceContext';
import { askSuggestionsFor } from '../../supabase/functions/_shared/smartPlannerActions';

export type AskStatus = 'answered' | 'partial' | 'refused';

export interface AskProposal {
  summary: string;
  day?: number;
  /** Only ever a figure a routing tool returned; the server drops the rest. */
  travelMinutes?: number;
  placeNames?: string[];
  replan?: {
    objective: string;
    affectedDays: number[];
    moves: Array<{ placeName: string; fromDay?: number; toDay: number }>;
  };
}

/** One tool the assistant ran, so the panel can show what it actually did. */
export interface AskStep {
  tool: string;
  ok: boolean;
  detail?: string;
}

export interface AskResult {
  status: AskStatus;
  answer?: string;
  citations: string[];
  proposal?: AskProposal;
  /** Always false in Phase 1. Read, never assumed — see the module comment. */
  applied: boolean;
  steps: AskStep[];
  /** Why the assistant stopped short, when it did. */
  detail?: string;
  refusal?: string;
  /** What the server refused to let the answer claim. Shown in dev surfaces. */
  rejectedClaims: number;
}

const text = (value: unknown, max = 4_000): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;

/**
 * A citation is only shown when it is a real, absolute http(s) URL.
 *
 * The server already dropped any URL no tool returned. This is the narrower
 * question of whether the string is safe to put in an `href` at all — the same
 * posture `parsePlaceImage` takes about an `<img src>`.
 */
const citable = (value: unknown): value is string =>
  typeof value === 'string' && /^https?:\/\//i.test(value.trim());

function parseProposal(value: unknown): AskProposal | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const summary = text(raw.summary, 500);
  if (!summary) return undefined;
  const replanRaw = raw.replan && typeof raw.replan === 'object'
    ? raw.replan as Record<string, unknown>
    : undefined;
  const objective = text(replanRaw?.objective, 300);
  const affectedDays = Array.isArray(replanRaw?.affectedDays)
    ? replanRaw.affectedDays.filter((day): day is number =>
      typeof day === 'number' && Number.isInteger(day) && day > 0 && day <= 60).slice(0, 10)
    : [];
  const moves = Array.isArray(replanRaw?.moves)
    ? replanRaw.moves.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const move = entry as Record<string, unknown>;
      const placeName = text(move.placeName, 160);
      const toDay = typeof move.toDay === 'number' && Number.isInteger(move.toDay) ? move.toDay : undefined;
      const fromDay = typeof move.fromDay === 'number' && Number.isInteger(move.fromDay) ? move.fromDay : undefined;
      return placeName && toDay && toDay > 0 ? [{ placeName, fromDay, toDay }] : [];
    }).slice(0, 12)
    : [];
  return {
    summary,
    day: typeof raw.day === 'number' && Number.isInteger(raw.day) ? raw.day : undefined,
    travelMinutes: typeof raw.travelMinutes === 'number' && Number.isFinite(raw.travelMinutes)
      ? Math.round(raw.travelMinutes)
      : undefined,
    placeNames: Array.isArray(raw.placeNames)
      ? raw.placeNames.filter((name): name is string => typeof name === 'string' && Boolean(name.trim())).slice(0, 8)
      : undefined,
    replan: objective && affectedDays.length > 0 ? { objective, affectedDays, moves } : undefined,
  };
}

export function parseAskResult(payload: unknown): AskResult {
  const empty: AskResult = { status: 'refused', citations: [], applied: false, steps: [], rejectedClaims: 0 };
  if (!payload || typeof payload !== 'object') return empty;
  const raw = payload as Record<string, unknown>;

  // Phase 1 has no write path. Treat an unexpected mutation claim as a bad
  // payload instead of reflecting it into the UI as something that happened.
  if (raw.applied === true) {
    return { ...empty, detail: 'The assistant returned an unexpected mutation state, so the response was not shown.' };
  }

  const status = raw.status === 'answered' || raw.status === 'partial' || raw.status === 'refused'
    ? raw.status
    : 'refused';

  return {
    status,
    answer: text(raw.answer),
    citations: Array.isArray(raw.citations) ? raw.citations.filter(citable).slice(0, 12) : [],
    proposal: parseProposal(raw.proposal),
    // Asserted, not assumed. Phase 1 has no write path; if this were ever true
    // the panel would be describing something that did not happen.
    applied: false,
    steps: Array.isArray(raw.transcript)
      ? raw.transcript.flatMap((entry): AskStep[] => {
        const step = entry as Record<string, unknown>;
        const tool = text(step?.tool, 80);
        return tool ? [{ tool, ok: step?.ok === true, detail: text(step?.detail, 200) }] : [];
      }).slice(0, 20)
      : [],
    detail: text(raw.detail, 400),
    refusal: text(raw.refusal, 80),
    rejectedClaims: Array.isArray(raw.rejected) ? raw.rejected.length : 0,
  };
}

/**
 * Ask the assistant one question about one owned trip.
 *
 * Never throws. A traveller asking "what should we do tonight" must not see a
 * stack trace, and every failure — an unreachable function, a refused quota, a
 * malformed payload — resolves to a stated `refused` result the panel can
 * render as a sentence.
 */
export async function askPlanitenary(
  input: {
    tripId: string;
    question: string;
    operation?: 'ask' | 'research-trip' | 'research-place';
    uiContext?: IntelligenceUiEnvelope;
    conversation?: ConversationTurn[];
  },
  invoke: (name: string, body: unknown) => Promise<unknown> = invokeTravelFunction,
): Promise<AskResult> {
  const question = input.question.trim();
  if (!question || !input.tripId) {
    return { status: 'refused', citations: [], applied: false, steps: [], rejectedClaims: 0, detail: 'A question is required.' };
  }
  if (question.length > 600) {
    return {
      status: 'refused',
      citations: [],
      applied: false,
      steps: [],
      rejectedClaims: 0,
      detail: 'Keep the question under 600 characters.',
    };
  }

  try {
    const payload = await invoke('planitenary-agent', {
      operation: input.operation ?? 'ask',
      tripId: input.tripId,
      question,
      ...(input.uiContext ? { uiContext: input.uiContext } : {}),
      ...(input.conversation && input.conversation.length > 0 ? { conversation: input.conversation } : {}),
    });
    return parseAskResult(payload);
  } catch (error) {
    return {
      status: 'refused',
      citations: [],
      applied: false,
      steps: [],
      rejectedClaims: 0,
      detail: error instanceof Error ? error.message : 'The assistant is unavailable right now.',
    };
  }
}

/**
 * Openers offered before the traveller has typed anything.
 *
 * Read-only by construction: each one is answerable by looking, and none of
 * them asks the assistant to change the trip — which would set an expectation
 * Phase 1 cannot meet.
 */
export const ASK_SUGGESTIONS = askSuggestionsFor('itinerary');
