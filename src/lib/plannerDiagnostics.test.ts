/**
 * The diagnostic record is the input to tuning `SHORTLIST_HEADROOM`, so its
 * shape matters as much as the arithmetic: a sample that loses which pace it
 * came from cannot be compared with any other.
 */
import { describe, expect, it } from 'vitest';
import { shortlistDiagnostic } from './plannerDiagnostics';
import type { DestinationBuildResult } from './destinationPlanner';

const build = (scheduled: number, reasons: string[], pace = 'balanced') => ({
  scheduledCandidates: Array.from({ length: scheduled }, (_, i) => ({ id: `s-${i}` })),
  unscheduledReasons: reasons.map((reason, i) => ({ candidate: { id: `u-${i}` }, reason, detail: '' })),
  behaviour: { pace },
} as unknown as DestinationBuildResult);

describe('a build becomes one tuning sample', () => {
  it('carries the four numbers the tuning needs', () => {
    const sample = shortlistDiagnostic(
      build(8, ['opening-hours-conflict', 'duplicate']),
      { city: 'Melbourne', days: 11 },
    );

    expect(sample.accepted).toBe(10);
    expect(sample.scheduled).toBe(8);
    expect(sample.impliedHeadroom).toBe(1.25);
    expect(sample.byReason).toEqual({ 'opening-hours-conflict': 1, duplicate: 1 });
  });

  it('records the pace that was used, not the one asked for', () => {
    // applyTravellerConstraints can lower the pace, and headroom is expected to
    // differ by pace — samples are only comparable within one.
    const sample = shortlistDiagnostic(build(4, [], 'relaxed'), { city: 'Kyoto', days: 5 });
    expect(sample.pace).toBe('relaxed');
  });

  it('keeps the trip context, so samples can be grouped rather than averaged blind', () => {
    const sample = shortlistDiagnostic(build(4, []), { city: 'Kyoto', days: 5 });
    expect(sample.city).toBe('Kyoto');
    expect(sample.days).toBe(5);
    expect(Date.parse(sample.at)).not.toBeNaN();
  });

  it('rounds headroom to something readable without losing the signal', () => {
    // 7 accepted / 3 scheduled = 2.333…
    const sample = shortlistDiagnostic(
      build(3, ['duplicate', 'duplicate', 'duplicate', 'duplicate']),
      { city: 'Osaka', days: 2 },
    );
    expect(sample.impliedHeadroom).toBe(2.333);
  });

  it('reports zero headroom for a build that scheduled nothing', () => {
    // Not 1: a failed build is not evidence that no margin was needed, and
    // must be excluded from the average rather than flattening it.
    const sample = shortlistDiagnostic(build(0, ['duplicate']), { city: 'Osaka', days: 2 });
    expect(sample.impliedHeadroom).toBe(0);
    expect(sample.scheduled).toBe(0);
  });
});
