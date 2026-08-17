import { describe, expect, it } from 'vitest';
import { presentBlockedPlan, presentPlanTripWriteRefusal } from './planTripWritePresentation';

describe('plan trip write presentation', () => {
  it('maps a stale source proposal to traveller-facing stale copy', () => {
    const notice = presentPlanTripWriteRefusal('stage', 'proposal-stale');
    expect(notice).toMatchObject({
      kind: 'stale',
      title: 'Your itinerary changed since this plan was created.',
      body: 'Create a fresh plan so it matches your latest itinerary.',
      actionLabel: 'Create fresh plan',
      action: 'fresh-plan',
    });
    expect(JSON.stringify(notice)).not.toMatch(/material revision|source proposal|hash mismatch|409/i);
  });

  it('keeps an expired staged confirmation distinct from a stale source proposal', () => {
    const expired = presentPlanTripWriteRefusal('apply', 'proposal-expired');
    expect(expired).toMatchObject({
      kind: 'expired',
      title: 'This confirmation expired.',
      body: 'Review the latest plan again before applying it.',
      actionLabel: 'Review this plan again',
      action: 'review-again',
    });

    const staleAfterStage = presentPlanTripWriteRefusal('apply', 'proposal-stale');
    expect(staleAfterStage?.kind).toBe('stale');
    expect(staleAfterStage?.action).toBe('fresh-plan');

    expect(presentPlanTripWriteRefusal('stage', 'proposal-expired')).toBeNull();
  });

  it('maps a missing source proposal to unavailable recovery copy', () => {
    expect(presentPlanTripWriteRefusal('stage', 'proposal-invalid')).toMatchObject({
      kind: 'unavailable',
      title: 'This plan is no longer available.',
      body: 'Generate a fresh plan based on your current trip.',
      actionLabel: 'Create fresh plan',
      action: 'fresh-plan',
    });
  });

  it('surfaces blocked reasons without inventing a new backend state', () => {
    const notice = presentBlockedPlan(['Glico Man Sign is a Must do and was left out.']);
    expect(notice.kind).toBe('blocked');
    expect(notice.title).toBe("This plan can't be applied yet.");
    expect(notice.reasons).toEqual(['Glico Man Sign is a Must do and was left out.']);
  });
});
