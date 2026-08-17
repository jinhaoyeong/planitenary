import { describe, expect, it } from 'vitest';
import { applyItineraryChange, stageItineraryChange } from './itineraryChangeClient';
import { emptyItinerary } from './itinerarySanitize';

describe('itinerary change client refusals', () => {
  it('keeps a stage stale envelope instead of collapsing it to unavailable', async () => {
    const result = await stageItineraryChange(
      'trip-1',
      { proposalId: 'p1', materialRevision: 'r1' },
      async () => ({ refusal: 'proposal-stale', detail: 'This trip has changed since the plan was made.' }),
    );
    expect(result).toEqual({
      ok: false,
      refusal: 'proposal-stale',
      detail: 'This trip has changed since the plan was made.',
    });
  });

  it('keeps an apply expiry envelope so the UI can require another review', async () => {
    const result = await applyItineraryChange(
      'stage-1',
      emptyItinerary,
      async () => ({ refusal: 'proposal-expired', detail: 'This plan has expired. Generate it again to apply it.' }),
    );
    expect(result).toEqual({
      ok: false,
      refusal: 'proposal-expired',
      detail: 'This plan has expired. Generate it again to apply it.',
    });
  });

  it('maps a missing source proposal without inventing a new code', async () => {
    const result = await stageItineraryChange(
      'trip-1',
      { proposalId: 'p1', materialRevision: 'r1' },
      async () => ({ refusal: 'proposal-invalid', detail: 'A reviewed plan is required.' }),
    );
    expect(result).toMatchObject({ ok: false, refusal: 'proposal-invalid' });
  });
});
