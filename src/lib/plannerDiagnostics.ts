/**
 * Developer diagnostics for the planner. Never traveller-facing.
 *
 * `SHORTLIST_HEADROOM` is a guess, and the only way it stops being one is real
 * builds reporting what they actually rejected. This gathers those samples
 * without putting a rejection rate in front of someone planning a holiday, and
 * without touching scheduling behaviour: it reads a finished
 * {@link DestinationBuildResult} and writes nothing back.
 *
 * Gated the same way the QA surfaces in `App.tsx` are — dev builds, or an
 * explicit opt-in — so a production traveller never pays for it.
 */
import { measureShortlistFit, type DestinationBuildResult } from './destinationPlanner';

export const plannerDiagnosticsEnabled = (): boolean =>
  import.meta.env.DEV || import.meta.env.VITE_PLANNER_DIAGNOSTICS === 'true';

/** How many samples to keep in memory. Enough for a tuning session, bounded. */
const SAMPLE_LIMIT = 50;

export interface ShortlistDiagnostic {
  city: string;
  /** Days the plan covered, the denominator behind capacity. */
  days: number;
  /**
   * The pace actually used, not the one requested — `applyTravellerConstraints`
   * can lower it. Headroom is expected to differ by pace, so samples are only
   * comparable within one.
   */
  pace: string;
  accepted: number;
  scheduled: number;
  /** accepted ÷ scheduled: the headroom this build actually needed. */
  impliedHeadroom: number;
  byReason: Record<string, number>;
  at: string;
}

/**
 * Pure: turns a finished build into one tuning sample. Separated from the
 * logging so the shape can be tested without a console.
 */
export function shortlistDiagnostic(
  result: DestinationBuildResult,
  context: { city: string; days: number },
): ShortlistDiagnostic {
  const measured = measureShortlistFit(result);
  return {
    city: context.city,
    days: context.days,
    pace: result.behaviour.pace,
    accepted: measured.accepted,
    scheduled: measured.scheduled,
    impliedHeadroom: Number(measured.impliedHeadroom.toFixed(3)),
    byReason: measured.byReason,
    at: new Date().toISOString(),
  };
}

/**
 * Samples from this session, newest last. Exposed on `window` so a tuning pass
 * is `copy(__plannerDiagnostics)` in the console rather than scraping log
 * lines — the numbers are only useful in bulk.
 */
const samples: ShortlistDiagnostic[] = [];

export function recordShortlistDiagnostic(
  result: DestinationBuildResult,
  context: { city: string; days: number },
): ShortlistDiagnostic | null {
  if (!plannerDiagnosticsEnabled()) return null;

  const sample = shortlistDiagnostic(result, context);
  samples.push(sample);
  if (samples.length > SAMPLE_LIMIT) samples.shift();

  if (typeof window !== 'undefined') {
    (window as unknown as Record<string, unknown>).__plannerDiagnostics = samples;
  }

  // A build that scheduled nothing reports impliedHeadroom 0, which is not a
  // measurement — it is a failure, and calling it out beats averaging it in.
  console.info(
    `[planner] ${sample.city} · ${sample.days}d · ${sample.pace} — `
    + `accepted ${sample.accepted}, scheduled ${sample.scheduled}, `
    + `implied headroom ${sample.scheduled === 0 ? 'n/a (nothing scheduled)' : `${sample.impliedHeadroom}×`}`,
    sample.byReason,
  );

  return sample;
}
