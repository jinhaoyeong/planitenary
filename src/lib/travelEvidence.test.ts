import { describe, expect, it } from 'vitest';
import {
  claimIsPresentableAsFact,
  evidenceWeight,
  freshnessWeight,
  isStale,
  promotionRisk,
  summarisePlaceEvidence,
  trendStrength,
  type SourceEvidence,
  type TravelClaim,
} from './travelEvidence';

const NOW = new Date('2026-08-04T00:00:00.000Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

const claim = (overrides: Partial<TravelClaim> = {}): TravelClaim => ({
  type: 'worth-visiting',
  summary: 'Worth the trip',
  strength: 0.8,
  ...overrides,
});

const evidence = (overrides: Partial<SourceEvidence> = {}): SourceEvidence => ({
  id: `evidence-${Math.random()}`,
  canonicalPlaceId: 'place-1',
  source: 'youtube',
  sourceUrl: 'https://example.com/video',
  retrievedAt: NOW.toISOString(),
  publishedAt: daysAgo(30),
  authorType: 'traveller',
  disclosure: 'organic',
  claims: [claim()],
  confidence: 0.8,
  ...overrides,
});

describe('evidence weighting', () => {
  it('decays with age so an old video cannot outrank a recent one', () => {
    const fresh = freshnessWeight(evidence({ publishedAt: daysAgo(5) }), NOW);
    const old = freshnessWeight(evidence({ publishedAt: daysAgo(900) }), NOW);
    expect(fresh).toBeGreaterThan(old);
    expect(old).toBeGreaterThan(0);
  });

  it('treats undated evidence as weak rather than fresh', () => {
    const undated = freshnessWeight(evidence({ publishedAt: undefined }), NOW);
    const recent = freshnessWeight(evidence({ publishedAt: daysAgo(2) }), NOW);
    expect(undated).toBeLessThan(recent);
  });

  it('ranks an official page above a traveller video', () => {
    const official = evidenceWeight(evidence({ source: 'official-website' }), NOW);
    const video = evidenceWeight(evidence({ source: 'tiktok' }), NOW);
    expect(official).toBeGreaterThan(video);
  });

  it('discounts but does not discard stale records', () => {
    const stale = evidence({ expiresAt: daysAgo(1) });
    expect(isStale(stale, NOW)).toBe(true);
    expect(evidenceWeight(stale, NOW)).toBeGreaterThan(0);
    expect(evidenceWeight(stale, NOW)).toBeLessThan(evidenceWeight(evidence(), NOW));
  });
});

describe('operational fact gating', () => {
  it('lets an official source establish a closure', () => {
    const official = evidence({ source: 'official-website', claims: [claim({ type: 'closed', summary: 'Closed for renovation' })] });
    expect(claimIsPresentableAsFact(official, official.claims[0])).toBe(true);
  });

  it('refuses to present a closure claimed only by a social video as fact', () => {
    const social = evidence({ source: 'rednote', claims: [claim({ type: 'closed', summary: 'Looked shut' })] });
    expect(claimIsPresentableAsFact(social, social.claims[0])).toBe(false);
  });

  it('still allows opinion claims from any source', () => {
    const social = evidence({ source: 'tiktok', claims: [claim({ type: 'overrated', summary: 'Overrated' })] });
    expect(claimIsPresentableAsFact(social, social.claims[0])).toBe(true);
  });

  it('will not let a forum thread establish that a venue has closed', () => {
    // Reddit is good evidence for judgement and poor evidence for operational
    // fact. Someone saying "I think it shut down" must not close a place.
    const thread = evidence({ source: 'reddit', claims: [claim({ type: 'closed', summary: 'Heard it shut' })] });
    expect(claimIsPresentableAsFact(thread, thread.claims[0])).toBe(false);
  });
});

describe('forum discussion as evidence', () => {
  it('weighs a thread above a video and below a map provider', () => {
    const at = (source: SourceEvidence['source']) => evidenceWeight(evidence({ source }), NOW);
    expect(at('reddit')).toBeGreaterThan(at('youtube'));
    expect(at('reddit')).toBeLessThan(at('google-places'));
  });

  it('does not attach the platform promotion penalty that social video carries', () => {
    // The whole point of adding Reddit: no sponsorship incentive, so it is not
    // pre-penalised the way TikTok and RedNote are.
    const thread = evidence({ source: 'reddit' });
    const video = evidence({ source: 'rednote' });
    expect(promotionRisk(thread)).toBeLessThan(promotionRisk(video));
  });

  it('still flags a thread that reads as promotional', () => {
    const advertised = evidence({ source: 'reddit', disclosure: 'sponsored' });
    expect(promotionRisk(advertised)).toBe(1);
  });

  it('counts a thread as an independent source for corroboration', () => {
    const summary = summarisePlaceEvidence('place-1', [
      evidence({ source: 'google-places', claims: [claim({ type: 'overrated', summary: 'Described as overrated' })] }),
      evidence({ source: 'reddit', claims: [claim({ type: 'overrated', summary: 'Described as overrated' })] }),
    ], NOW);
    expect(summary.distinctSources).toContain('reddit');
    expect(summary.sourceCount).toBe(2);
    expect(summary.negativeThemes).toContain('Described as overrated');
  });
});

describe('promotion risk', () => {
  it('maxes out on a declared sponsorship', () => {
    expect(promotionRisk(evidence({ disclosure: 'sponsored' }))).toBe(1);
  });

  it('rates a business account above an organic traveller post', () => {
    const business = promotionRisk(evidence({ authorType: 'business' }));
    const traveller = promotionRisk(evidence({ authorType: 'traveller' }));
    expect(business).toBeGreaterThan(traveller);
  });

  it('stays within 0 and 1', () => {
    const risk = promotionRisk(evidence({ disclosure: 'possible-promotion', authorType: 'business', source: 'rednote' }));
    expect(risk).toBeGreaterThanOrEqual(0);
    expect(risk).toBeLessThanOrEqual(1);
  });
});

describe('place evidence summary', () => {
  it('reports a median queue travellers actually reported', () => {
    const summary = summarisePlaceEvidence('place-1', [
      evidence({ claims: [claim({ type: 'queue-time', summary: '30 minutes', value: 30, unit: 'minutes' })] }),
      evidence({ claims: [claim({ type: 'queue-time', summary: '50 minutes', value: 50, unit: 'minutes' })] }),
      evidence({ claims: [claim({ type: 'queue-time', summary: '40 minutes', value: 40, unit: 'minutes' })] }),
    ], NOW);
    expect(summary.typicalQueueMinutes).toBe(40);
    expect(summary.sourceCount).toBe(3);
  });

  it('gains confidence from independent sources agreeing', () => {
    const single = summarisePlaceEvidence('place-1', [
      evidence({ source: 'youtube' }),
      evidence({ source: 'youtube' }),
      evidence({ source: 'youtube' }),
    ], NOW);
    const varied = summarisePlaceEvidence('place-1', [
      evidence({ source: 'youtube' }),
      evidence({ source: 'google-places' }),
      evidence({ source: 'official-website' }),
    ], NOW);
    expect(varied.evidenceConfidence).toBeGreaterThan(single.evidenceConfidence);
  });

  it('warns when an authoritative source reports a closure', () => {
    const summary = summarisePlaceEvidence('place-1', [
      evidence({ source: 'official-website', claims: [claim({ type: 'closed', summary: 'Permanently closed' })] }),
    ], NOW);
    expect(summary.warnings.join(' ')).toContain('closed');
  });

  it('ignores evidence attached to a different place', () => {
    const summary = summarisePlaceEvidence('place-1', [
      evidence({ canonicalPlaceId: 'place-2' }),
    ], NOW);
    expect(summary.sourceCount).toBe(0);
  });
});

describe('agreeing on when a place is best', () => {
  const timed = (start: string, end: string, source: SourceEvidence['source'] = 'reddit') => evidence({
    source,
    claims: [claim({ type: 'best-time', summary: 'Best early', appliesTo: { start, end }, strength: 0.6 })],
  });

  it('names a window once independent sources agree', () => {
    const summary = summarisePlaceEvidence('place-1', [
      timed('07:00', '10:30'), timed('07:00', '10:30', 'youtube'),
    ], NOW);
    expect(summary.bestTimeWindow).toEqual({ start: '07:00', end: '10:30' });
  });

  it('will not act on one stranger’s opinion', () => {
    // The scheduler declines to place a venue outside its window, so a single
    // unverified remark could quietly drop a place from the trip.
    expect(summarisePlaceEvidence('place-1', [timed('07:00', '10:30')], NOW).bestTimeWindow).toBeUndefined();
  });

  it('reports no window when sources disagree', () => {
    const summary = summarisePlaceEvidence('place-1', [
      timed('07:00', '10:30'), timed('16:30', '19:30', 'youtube'),
    ], NOW);
    expect(summary.bestTimeWindow).toBeUndefined();
  });

  it('lets a clear majority win over a lone dissenter', () => {
    const summary = summarisePlaceEvidence('place-1', [
      timed('07:00', '10:30'), timed('07:00', '10:30', 'youtube'), timed('07:00', '10:30', 'google-places'),
      timed('16:30', '19:30', 'tiktok'),
    ], NOW);
    expect(summary.bestTimeWindow).toEqual({ start: '07:00', end: '10:30' });
  });

  it('says nothing when nobody mentioned timing', () => {
    expect(summarisePlaceEvidence('place-1', [evidence()], NOW).bestTimeWindow).toBeUndefined();
  });
});

describe('trend strength', () => {
  it('rates a recent cross-platform surge above a single old mention', () => {
    const trending = trendStrength([
      evidence({ source: 'tiktok', publishedAt: daysAgo(10) }),
      evidence({ source: 'youtube', publishedAt: daysAgo(20) }),
      evidence({ source: 'rednote', publishedAt: daysAgo(30) }),
      evidence({ source: 'google-places', publishedAt: daysAgo(15) }),
    ], NOW);
    const dormant = trendStrength([
      evidence({ source: 'youtube', publishedAt: daysAgo(1200) }),
    ], NOW);
    expect(trending).toBeGreaterThan(dormant);
    expect(dormant).toBe(0);
  });

  it('does not let a coordinated sponsored push manufacture a trend', () => {
    const organic = trendStrength([
      evidence({ source: 'tiktok', publishedAt: daysAgo(10), disclosure: 'organic' }),
      evidence({ source: 'youtube', publishedAt: daysAgo(12), disclosure: 'organic' }),
      evidence({ source: 'rednote', publishedAt: daysAgo(14), disclosure: 'organic' }),
    ], NOW);
    const sponsored = trendStrength([
      evidence({ source: 'tiktok', publishedAt: daysAgo(10), disclosure: 'sponsored' }),
      evidence({ source: 'youtube', publishedAt: daysAgo(12), disclosure: 'sponsored' }),
      evidence({ source: 'rednote', publishedAt: daysAgo(14), disclosure: 'sponsored' }),
    ], NOW);
    expect(organic).toBeGreaterThan(sponsored);
  });

  it('returns zero when nothing is dated', () => {
    expect(trendStrength([evidence({ publishedAt: undefined })], NOW)).toBe(0);
  });
});
