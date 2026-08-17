/**
 * Trip usage is telemetry. Global and user daily caps remain the refusal
 * boundaries, together with the dollar budget reservation.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { meteredAiQuotaExhausted } from '../../supabase/functions/_shared/aiQuotaPolicy';
import {
  isGenerationKillSwitch,
  paidGenerationShouldRun,
} from '../../supabase/functions/_shared/itineraryProposalCache';

const reservationSql = readFileSync(
  new URL('../../supabase/migrations/20260817132822_trip_ai_quota_is_telemetry.sql', import.meta.url),
  'utf8',
);
const quotaTs = readFileSync(
  new URL('../../supabase/functions/_shared/quota.ts', import.meta.url),
  'utf8',
);
const limitsTs = readFileSync(
  new URL('../../supabase/functions/_shared/providers.ts', import.meta.url),
  'utf8',
);

describe('metered AI quota policy', () => {
  it('lets a trip continue after four calls when global and user allowance remain', () => {
    expect(meteredAiQuotaExhausted({
      globalCalls: 5,
      globalLimit: 10,
      userCalls: 4,
      userLimit: 8,
    })).toBe(false);
  });

  it('blocks the 11th global call', () => {
    expect(meteredAiQuotaExhausted({
      globalCalls: 10,
      globalLimit: 10,
      userCalls: 4,
      userLimit: 8,
    })).toBe(true);
  });

  it('still blocks when the user daily cap is spent', () => {
    expect(meteredAiQuotaExhausted({
      globalCalls: 5,
      globalLimit: 10,
      userCalls: 8,
      userLimit: 8,
    })).toBe(true);
  });
});

describe('trip usage is recorded, not a refusal', () => {
  it('still writes the trip counter on reserve', () => {
    expect(reservationSql).toContain("dimension = 'trip'");
    expect(reservationSql).toContain("set calls = calls + 1");
    expect(reservationSql).toContain('dimension_key = p_trip_id');
  });

  it('does not refuse because a trip has already made four calls', () => {
    expect(reservationSql).not.toContain('v_trip_calls + 1 > p_trip_limit');
    expect(reservationSql).not.toContain('p_trip_limit is null or p_trip_limit <= 0');
  });

  it('still refuses on global and user daily caps and on the dollar budget', () => {
    expect(reservationSql).toContain('v_global_calls + 1 > p_global_limit');
    expect(reservationSql).toContain('v_user_calls + 1 > p_user_limit');
    expect(reservationSql).toContain('v_spend + p_reserved_cost_usd > p_budget_usd');
    expect(reservationSql).toContain("'quota-exhausted'");
    expect(reservationSql).toContain("'budget-reached'");
  });

  it('does not treat a trip setting as required to enable the paid path', () => {
    expect(limitsTs).not.toContain('AI_TRIP_DAILY_CALL_LIMIT');
    expect(quotaTs).toContain('p_trip_limit: null');
    expect(quotaTs).toContain("p_trip_id: request.tripId ?? null");
  });

  it('leaves ledger reservation and unknown-cost handling in the same function', () => {
    expect(reservationSql).toContain('insert into public.ai_spend_ledger');
    expect(reservationSql).toContain("cost_status, attempt_status");
    expect(reservationSql).toContain("'reserved'");
  });
});

describe('unchanged neighbouring safety', () => {
  it('keeps cache hits off the paid path', () => {
    expect(paidGenerationShouldRun('hit')).toBe(false);
    expect(paidGenerationShouldRun('miss')).toBe(true);
  });

  it('keeps the generation kill switch', () => {
    expect(isGenerationKillSwitch('disabled')).toBe(true);
    expect(isGenerationKillSwitch('gpt-5-nano')).toBe(false);
  });
});
