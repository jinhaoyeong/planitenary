import { describe, expect, it } from 'vitest';
import { candidateToActivity, isSchedulableCandidate, type PlaceCandidate } from './destinationIntelligence';

const candidate = (overrides: Partial<PlaceCandidate> = {}): PlaceCandidate => ({
  id: 'osaka-castle',
  provider: 'official-tourism',
  providerPlaceId: 'place-osaka-castle',
  name: 'Osaka Castle',
  city: 'Osaka',
  countryCode: 'JP',
  coordinates: [34.6873, 135.5262],
  categories: ['history', 'landmark'],
  experienceTags: ['culture'],
  estimatedVisitMinutes: 150,
  indoorOutdoor: 'mixed',
  reservationStatus: 'not-needed',
  sourceConfidence: 'high',
  sourceReferences: [{ label: 'Official Osaka tourism', url: 'https://example.com/osaka-castle' }],
  lastVerifiedAt: '2026-08-04T00:00:00.000Z',
  ...overrides,
});

describe('destination intelligence contracts', () => {
  it('rejects partial provider candidates before scheduling', () => {
    expect(isSchedulableCandidate(candidate({ providerPlaceId: undefined }))).toBe(false);
    expect(isSchedulableCandidate(candidate({ coordinates: undefined }))).toBe(false);
    expect(isSchedulableCandidate(candidate())).toBe(true);
  });

  it('preserves provider identity and source references on activities', () => {
    const activity = candidateToActivity(candidate());
    expect(activity.kind).toBe('place');
    expect(activity.providerPlaceId).toBe('place-osaka-castle');
    expect(activity.sourceReferences?.[0].label).toBe('Official Osaka tourism');
    expect(activity.coordinates).toEqual([34.6873, 135.5262]);
  });
});
