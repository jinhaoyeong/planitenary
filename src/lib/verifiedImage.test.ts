import { describe, expect, it } from 'vitest';
import type { Activity, Itinerary } from '../data';
import { emptyItinerary, sanitizeItinerary } from './itinerarySanitize';
import { resolveTripCover, VERIFIED_IMAGE_VALIDATION_VERSION } from './verifiedImage';

const commonsPhoto = (key: string) => ({
  photoUrl: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/${key}.jpg/1280px-${key}.jpg`,
  photoThumbnailUrl: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/${key}.jpg/480px-${key}.jpg`,
  photoSourcePage: `https://commons.wikimedia.org/wiki/File:${key}.jpg`,
  photoAttribution: `Photo ${key} · CC BY-SA 4.0 · Wikimedia Commons`,
  photoLicense: 'CC BY-SA 4.0',
  photoLicenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
  photoImageKey: `commons:${key}`,
});

const activity = (id: string, city: string): Activity => ({
  id,
  kind: 'place',
  time: '10:00',
  durationMinutes: 60,
  name: id,
  description: '',
  type: 'sight',
  city,
  placeRef: { canonicalPlaceId: `canonical-${id}`, provider: 'osm', providerPlaceId: id },
  ...commonsPhoto(id),
});

const trip = (id: string, activities: Activity[]): Itinerary => ({
  ...emptyItinerary,
  id,
  name: `Trip ${id}`,
  cities: ['Tokyo'],
  days: [{ day: 1, date: '2026-08-12', title: 'Tokyo', stayCity: 'Tokyo', activityCities: [], city: 'Tokyo', activities }],
});

describe('shared verified trip covers', () => {
  it('prefers an unused verified image when another correct image exists', () => {
    const itinerary = trip('one', [activity('tower', 'Tokyo'), activity('garden', 'Tokyo')]);
    const first = resolveTripCover(itinerary);
    const second = resolveTripCover({ ...itinerary, id: 'two' }, new Set([first.asset!.imageKey]));

    expect(first.asset).toBeDefined();
    expect(second.asset).toBeDefined();
    expect(second.asset?.imageKey).not.toBe(first.asset?.imageKey);
  });

  it('repeats the one correct image instead of substituting a wrong photograph', () => {
    const itinerary = trip('one', [activity('tower', 'Tokyo')]);
    const first = resolveTripCover(itinerary);
    const repeated = resolveTripCover({ ...itinerary, id: 'two' }, new Set([first.asset!.imageKey]));

    expect(repeated.asset?.imageKey).toBe(first.asset?.imageKey);
  });

  it('never selects an activity photo from a city outside the trip', () => {
    const cover = resolveTripCover(trip('wrong-city', [activity('castle', 'Osaka')]));
    expect(cover).toMatchObject({ type: 'generated-surface', city: 'Tokyo' });
    expect(cover.asset).toBeUndefined();
  });

  it('preserves attribution and licence through itinerary sanitization', () => {
    const itinerary = trip('licensed', [activity('tower', 'Tokyo')]);
    const cover = resolveTripCover(itinerary);
    const sanitized = sanitizeItinerary({ ...itinerary, tripCover: cover }, emptyItinerary);

    expect(sanitized.tripCover?.asset).toMatchObject({
      imageKey: 'commons:tower',
      attribution: 'Photo tower · CC BY-SA 4.0 · Wikimedia Commons',
      license: 'CC BY-SA 4.0',
      validationVersion: VERIFIED_IMAGE_VALIDATION_VERSION,
    });
  });
});
