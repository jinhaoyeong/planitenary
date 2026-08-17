/**
 * Which counters may refuse a metered AI attempt.
 *
 * Trip usage is still written on reserve. It is not a refusal boundary: one
 * itinerary may make as many metered calls as global and user allowance allow.
 */

export function meteredAiQuotaExhausted(input: {
  globalCalls: number;
  globalLimit: number;
  userCalls: number;
  userLimit: number;
}): boolean {
  return input.globalCalls + 1 > input.globalLimit
    || input.userCalls + 1 > input.userLimit;
}
