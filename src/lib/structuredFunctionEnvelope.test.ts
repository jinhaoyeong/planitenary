import { describe, expect, it } from 'vitest';
import { structuredFunctionEnvelope } from './supabase';

describe('structured function envelopes', () => {
  it('returns itinerary-change refusals that have no error field', () => {
    const payload = { refusal: 'proposal-stale', detail: 'This trip has changed since the plan was made.' };
    expect(structuredFunctionEnvelope(payload)).toEqual(payload);
  });

  it('returns a generation kill-switch refusal so the client can show it', () => {
    const payload = {
      status: 'refused',
      refusal: 'generation-disabled',
      detail: 'New AI generation is disabled. No matching cached proposal was available.',
    };
    expect(structuredFunctionEnvelope(payload)).toEqual(payload);
  });

  it('does not treat a history transport error as a successful envelope', () => {
    expect(structuredFunctionEnvelope({
      operation: 'history',
      error: 'Could not embed itinerary_change_proposals',
    })).toBeNull();
  });
});
