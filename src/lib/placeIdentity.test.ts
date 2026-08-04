import { describe, expect, it } from 'vitest';
import type { CanonicalPlace } from './travelEvidence';
import {
  AUTO_MERGE_THRESHOLD,
  nameSimilarity,
  REVIEW_THRESHOLD,
  resolvePlaceObservation,
  scoreIdentityMatch,
  type PlaceObservation,
} from './placeIdentity';

const kuromon: CanonicalPlace = {
  id: 'place-kuromon',
  primaryName: 'Kuromon Ichiba Market',
  localName: '黒門市場',
  aliases: ['Kuromon Market', '黑门市场', '大阪黑门市场'],
  city: 'Osaka',
  countryCode: 'JP',
  neighbourhood: 'Minami',
  coordinates: [34.6654, 135.5064],
  address: '2-4-1 Nipponbashi, Chuo Ward, Osaka',
  website: 'https://kuromon.com/',
  phone: '+81 6-6631-0007',
  providerIds: { google: 'ChIJ_kuromon' },
};

const observation = (overrides: Partial<PlaceObservation> = {}): PlaceObservation => ({
  evidenceId: 'evidence-1',
  name: 'Kuromon Market',
  ...overrides,
});

describe('name similarity', () => {
  it('scores a shortened listing of the same venue highly', () => {
    expect(nameSimilarity('Kuromon Ichiba Market', 'Kuromon Market')).toBeGreaterThan(0.9);
  });

  it('separates two branches of the same chain', () => {
    expect(nameSimilarity('Ichiran Dotonbori', 'Ichiran Umeda')).toBeLessThan(0.6);
  });

  it('matches identical CJK names that do not tokenise', () => {
    expect(nameSimilarity('黒門市場', '黒門市場')).toBe(1);
  });
});

describe('identity matching', () => {
  it('merges instantly on a shared provider id', () => {
    const match = scoreIdentityMatch(kuromon, observation({
      name: 'Totally Different Listing Name',
      providerIds: { google: 'ChIJ_kuromon' },
    }));
    expect(match.matchConfidence).toBe(1);
    expect(match.matchedBy).toContain('provider-id');
  });

  it('merges a local-language name backed by matching coordinates', () => {
    const match = scoreIdentityMatch(kuromon, observation({
      name: '黑门市场',
      localName: '黑门市场',
      coordinates: [34.6655, 135.5065],
      city: 'Osaka',
    }));
    expect(match.matchConfidence).toBeGreaterThanOrEqual(AUTO_MERGE_THRESHOLD);
    expect(match.matchedBy).toEqual(expect.arrayContaining(['coordinates', 'alias']));
  });

  it('refuses to merge on name similarity alone', () => {
    const match = scoreIdentityMatch(kuromon, observation({ name: 'Kuromon Ichiba Market' }));
    expect(match.matchConfidence).toBeLessThan(REVIEW_THRESHOLD);
    expect(resolvePlaceObservation([kuromon], observation({ name: 'Kuromon Ichiba Market' })).unmatched).toBe(true);
  });

  it('rejects a similarly named place far away', () => {
    const match = scoreIdentityMatch(kuromon, observation({
      name: 'Kuromon Market',
      coordinates: [35.6812, 139.7671],
      city: 'Tokyo',
    }));
    expect(match.matchConfidence).toBeLessThan(REVIEW_THRESHOLD);
  });

  it('merges on a shared official website', () => {
    const match = scoreIdentityMatch(kuromon, observation({
      name: 'Kuromon',
      website: 'http://www.kuromon.com',
      coordinates: [34.6656, 135.5066],
    }));
    expect(match.matchConfidence).toBeGreaterThanOrEqual(AUTO_MERGE_THRESHOLD);
    expect(match.matchedBy).toContain('website');
  });

  it('merges on a shared phone number written differently', () => {
    const match = scoreIdentityMatch(kuromon, observation({
      name: 'Kuromon Ichiba',
      phone: '0666310007',
      coordinates: [34.6654, 135.5064],
    }));
    expect(match.matchedBy).toContain('phone');
    expect(match.matchConfidence).toBeGreaterThanOrEqual(AUTO_MERGE_THRESHOLD);
  });

  it('routes a plausible-but-unverified match to review, not to planning', () => {
    const outcome = resolvePlaceObservation([kuromon], observation({
      name: 'Kuromon Market',
      // ~250m away: close enough to be suspicious, too far to trust.
      coordinates: [34.6676, 135.5064],
      city: 'Osaka',
    }));
    expect(outcome.merged).toBeUndefined();
    expect(outcome.needsReview?.matchConfidence).toBeGreaterThanOrEqual(REVIEW_THRESHOLD);
    expect(outcome.needsReview?.matchConfidence).toBeLessThan(AUTO_MERGE_THRESHOLD);
  });

  it('reports an unknown place as unmatched rather than forcing a merge', () => {
    const outcome = resolvePlaceObservation([kuromon], observation({
      name: 'Nishiki Market',
      coordinates: [35.0050, 135.7649],
      city: 'Kyoto',
    }));
    expect(outcome.unmatched).toBe(true);
  });
});
