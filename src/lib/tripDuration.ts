/**
 * Shared trip-duration policy.
 *
 * Declared duration (profile dates / dayCount) may be up to
 * {@link MAX_TRIP_DURATION_DAYS}. Automatically generated day cards stop at
 * {@link MAX_GENERATED_DAYS}. Longer stays keep their real length in
 * badge/budget/copy, but only the first block of daily pages is created.
 */

export const MAX_TRIP_DURATION_DAYS = 365;
export const MAX_GENERATED_DAYS = 90;

export const TRIP_DURATION_TOO_LONG_MESSAGE =
  'Trips can be up to 365 days. Check that the start and end year are correct.';

export const TRIP_DATES_REVERSED_MESSAGE =
  'The end date is before the start date. Fix either one and the days will add up again.';

export function longTripPartialGenerationMessage(days: number): string {
  return `This trip lasts ${days} days. We'll create the first ${MAX_GENERATED_DAYS} daily planning pages. You can add later days as needed.`;
}

export function longTripItineraryNotice(declaredDays: number, generatedDays: number): string {
  const remaining = Math.max(0, declaredDays - generatedDays);
  if (remaining <= 0) return '';
  return `This trip lasts ${declaredDays} days. ${generatedDays} daily planning ${generatedDays === 1 ? 'page is' : 'pages are'} ready now — add the remaining ${remaining} later as you need them.`;
}

export function plannerExistingDaysNotice(declaredDays: number, generatedDays: number): string {
  if (declaredDays <= generatedDays || generatedDays <= 0) return '';
  return `Smart Itinerary plans the ${generatedDays} daily pages already created — not all ${declaredDays} days of the trip.`;
}

export type DurationFields = {
  startDate?: string;
  endDate?: string;
  dayCount?: number;
};

export type DurationValidationOk = {
  ok: true;
  days: number;
  nights: number;
  /** True when the declared span is longer than the auto-generated day-card cap. */
  generatesPartialDays: boolean;
  source: 'dates' | 'dayCount' | 'none';
};

export type DurationValidationError = {
  ok: false;
  reason: 'reversed' | 'too_long';
  /** Raw span when known (for messaging); 0 for reversed ranges. */
  days: number;
  message: string;
};

export type DurationValidation = DurationValidationOk | DurationValidationError;

const parseDate = (value?: string): Date | null => {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

/** Inclusive day span between two ISO dates, or null when incomplete/unparseable. */
export function inclusiveDaySpan(startDate?: string, endDate?: string): number | null {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  if (!start || !end) return null;
  return Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

/**
 * Single source of truth for whether a duration entry is acceptable.
 * Does not mutate or truncate — callers decide whether to reject or clear.
 */
export function validateTripDuration(fields: DurationFields): DurationValidation {
  const hasStart = Boolean(fields.startDate);
  const hasEnd = Boolean(fields.endDate);

  if (hasStart && hasEnd) {
    const start = parseDate(fields.startDate);
    const end = parseDate(fields.endDate);
    if (!start || !end) {
      return { ok: true, days: 0, nights: 0, generatesPartialDays: false, source: 'none' };
    }
    const diffDays = Math.round((end.getTime() - start.getTime()) / 86_400_000);
    if (diffDays < 0) {
      return { ok: false, reason: 'reversed', days: 0, message: TRIP_DATES_REVERSED_MESSAGE };
    }
    const days = diffDays + 1;
    if (days > MAX_TRIP_DURATION_DAYS) {
      return { ok: false, reason: 'too_long', days, message: TRIP_DURATION_TOO_LONG_MESSAGE };
    }
    return {
      ok: true,
      days,
      nights: Math.max(0, days - 1),
      generatesPartialDays: days > MAX_GENERATED_DAYS,
      source: 'dates',
    };
  }

  // Incomplete date pair is allowed while editing; duration comes from dayCount only
  // when neither date is set. A lone start/end does not invent a span here.
  if (hasStart || hasEnd) {
    return { ok: true, days: 0, nights: 0, generatesPartialDays: false, source: 'none' };
  }

  const days = Math.max(0, Math.round(fields.dayCount || 0));
  if (days > MAX_TRIP_DURATION_DAYS) {
    return { ok: false, reason: 'too_long', days, message: TRIP_DURATION_TOO_LONG_MESSAGE };
  }
  return {
    ok: true,
    days,
    nights: Math.max(0, days - 1),
    generatesPartialDays: days > MAX_GENERATED_DAYS,
    source: days > 0 ? 'dayCount' : 'none',
  };
}

/**
 * How many day cards should be auto-created for a declared duration.
 * Caps at {@link MAX_GENERATED_DAYS}; never invents days for an invalid range.
 */
export function generatedDayCardCount(declaredDays: number): number {
  if (!Number.isFinite(declaredDays) || declaredDays <= 0) return 0;
  return Math.min(Math.round(declaredDays), MAX_GENERATED_DAYS);
}

/**
 * Declared trip length for budget / badge math. Prefers a valid dated span,
 * then dayCount. Returns 0 when the duration is invalid or unset — callers
 * may fall back to itinerary.days.length.
 */
export function declaredTripDays(fields: DurationFields): number {
  const hasStart = Boolean(fields.startDate);
  const hasEnd = Boolean(fields.endDate);

  if (hasStart && hasEnd) {
    const span = inclusiveDaySpan(fields.startDate, fields.endDate);
    if (span === null) return 0;
    if (span < 1) return 0; // reversed
    if (span > MAX_TRIP_DURATION_DAYS) return 0; // excessive — do not feed budget/badge
    return span;
  }

  if (hasStart || hasEnd) return 0;

  const days = Math.max(0, Math.round(fields.dayCount || 0));
  if (days > MAX_TRIP_DURATION_DAYS) return 0;
  return days;
}

/**
 * Budget divisor: real declared duration when present, otherwise the number of
 * day cards already on the itinerary.
 */
export function plannedBudgetDays(fields: DurationFields | null | undefined, itineraryDayCount: number): number {
  if (!fields) return Math.max(0, itineraryDayCount);
  const declared = declaredTripDays(fields);
  return declared > 0 ? declared : Math.max(0, itineraryDayCount);
}

/**
 * Clears invalid or excessive duration fields. Never silently truncates a
 * 999-day span down to 365 — the dates are rejected so the UI can ask again.
 * Valid dated ranges sync dayCount to the inclusive span.
 */
export function sanitizeDurationFields(fields: DurationFields): {
  startDate?: string;
  endDate?: string;
  dayCount: number;
} {
  const startDate = typeof fields.startDate === 'string' && fields.startDate.trim()
    ? fields.startDate.trim()
    : undefined;
  const endDate = typeof fields.endDate === 'string' && fields.endDate.trim()
    ? fields.endDate.trim()
    : undefined;
  const rawDayCount = typeof fields.dayCount === 'number' && Number.isFinite(fields.dayCount)
    ? Math.max(0, Math.round(fields.dayCount))
    : 0;

  const validation = validateTripDuration({ startDate, endDate, dayCount: rawDayCount });
  if (!validation.ok) {
    return { startDate: undefined, endDate: undefined, dayCount: 0 };
  }

  if (validation.source === 'dates') {
    return { startDate, endDate, dayCount: validation.days };
  }

  // Incomplete date pair: keep the typed dates for editing, but do not invent
  // a dayCount from them. Preserve a previously valid manual count only when
  // neither date is set.
  if (startDate || endDate) {
    return { startDate, endDate, dayCount: 0 };
  }

  return { startDate: undefined, endDate: undefined, dayCount: validation.days };
}

/** Apply a validated duration onto a profile-shaped object, syncing dayCount. */
export function withValidatedDuration<T extends DurationFields>(
  profile: T,
): { ok: true; profile: T } | { ok: false; message: string; reason: 'reversed' | 'too_long' } {
  const validation = validateTripDuration(profile);
  if (!validation.ok) {
    return { ok: false, message: validation.message, reason: validation.reason };
  }
  if (validation.source === 'dates' || validation.source === 'dayCount') {
    return { ok: true, profile: { ...profile, dayCount: validation.days } };
  }
  // Incomplete date pair or empty — do not keep a stale dayCount hanging off a
  // half-filled range.
  return { ok: true, profile: { ...profile, dayCount: 0 } };
}
