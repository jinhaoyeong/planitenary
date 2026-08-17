/**
 * Traveller-facing copy for Plan my trip write refusals.
 *
 * The server still owns the codes. This module only decides how those existing
 * refusals are titled and recovered from, without inventing new backend states.
 */
import type { ChangeRefusalCode } from './itineraryChangeClient';

export type PlanTripWriteNoticeKind = 'stale' | 'expired' | 'unavailable' | 'blocked';
export type PlanTripWriteAction = 'fresh-plan' | 'review-again';

export interface PlanTripWriteNotice {
  kind: PlanTripWriteNoticeKind;
  title: string;
  body: string;
  actionLabel: string;
  action: PlanTripWriteAction;
  reasons: string[];
}

export const PLAN_TRIP_WRITE_COPY = {
  stale: {
    title: 'Your itinerary changed since this plan was created.',
    body: 'Create a fresh plan so it matches your latest itinerary.',
    actionLabel: 'Create fresh plan',
    action: 'fresh-plan' as const,
  },
  expired: {
    title: 'This confirmation expired.',
    body: 'Review the latest plan again before applying it.',
    actionLabel: 'Review this plan again',
    action: 'review-again' as const,
  },
  unavailable: {
    title: 'This plan is no longer available.',
    body: 'Generate a fresh plan based on your current trip.',
    actionLabel: 'Create fresh plan',
    action: 'fresh-plan' as const,
  },
  blocked: {
    title: "This plan can't be applied yet.",
    body: 'The conflicts below need a decision first. Nothing was saved.',
    actionLabel: 'Create fresh plan',
    action: 'fresh-plan' as const,
  },
} as const;

/**
 * Stage refusals are about the displayed Phase 2A proposal.
 * Apply refusals are about the already-staged confirmation.
 */
export function presentPlanTripWriteRefusal(
  origin: 'stage' | 'apply',
  refusal: ChangeRefusalCode,
  reasons: string[] = [],
): PlanTripWriteNotice | null {
  if (refusal === 'proposal-blocked') {
    return { kind: 'blocked', ...PLAN_TRIP_WRITE_COPY.blocked, reasons };
  }
  if (origin === 'apply' && refusal === 'proposal-expired') {
    return { kind: 'expired', ...PLAN_TRIP_WRITE_COPY.expired, reasons: [] };
  }
  if (refusal === 'proposal-stale') {
    return { kind: 'stale', ...PLAN_TRIP_WRITE_COPY.stale, reasons: [] };
  }
  if (refusal === 'proposal-invalid' || refusal === 'proposal-not-pending') {
    return { kind: 'unavailable', ...PLAN_TRIP_WRITE_COPY.unavailable, reasons: [] };
  }
  return null;
}

export function presentBlockedPlan(reasons: string[]): PlanTripWriteNotice {
  return { kind: 'blocked', ...PLAN_TRIP_WRITE_COPY.blocked, reasons };
}
