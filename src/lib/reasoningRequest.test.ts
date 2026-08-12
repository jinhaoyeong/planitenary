import { describe, expect, it, vi } from 'vitest';
import {
  authorizeCandidateTrip,
  authoritativeTripMaterial,
  type TripLookup,
} from '../../supabase/functions/_shared/reasoningRequest';

const profile = {
  styles: ['temples', 'history'],
  moods: ['calm'],
  tripTypes: [],
};

const storedItinerary = { tripProfile: profile };
const authoritative = authoritativeTripMaterial(storedItinerary)!;
const matchingInput = {
  trip: {
    tripId: 'trip-1',
    styles: [...authoritative.styles],
    pace: authoritative.pace,
    tripMaterialRevision: authoritative.tripMaterialRevision,
  },
  candidates: [],
};

const owned: TripLookup = {
  kind: 'owned',
  tripId: 'trip-1',
  userId: 'user-1',
  itineraryData: storedItinerary,
};

describe('the reasoning request authorization boundary', () => {
  it('rejects missing authentication before looking up a trip', async () => {
    const lookup = vi.fn();
    await expect(authorizeCandidateTrip(matchingInput, null, lookup)).resolves.toMatchObject({
      ok: false,
      code: 'unauthorized',
    });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('does not treat another account or an unknown trip as owned', async () => {
    const lookup = vi.fn(async (): Promise<TripLookup> => ({ kind: 'missing' }));
    await expect(authorizeCandidateTrip(matchingInput, 'user-2', lookup)).resolves.toMatchObject({
      ok: false,
      code: 'trip-not-owned',
    });
    expect(lookup).toHaveBeenCalledWith('trip-1', 'user-2');
  });

  it('surfaces lookup failure as an unavailable safety dependency, not authorization', async () => {
    const lookup = vi.fn(async (): Promise<TripLookup> => ({ kind: 'error' }));
    await expect(authorizeCandidateTrip(matchingInput, 'user-1', lookup)).resolves.toMatchObject({
      ok: false,
      code: 'trip-lookup-failed',
    });
  });

  it('uses the persisted profile as the authoritative trip material', async () => {
    const lookup = vi.fn(async (): Promise<TripLookup> => owned);
    const result = await authorizeCandidateTrip(matchingInput, 'user-1', lookup);
    expect(result).toMatchObject({ ok: true, tripId: 'trip-1' });
    if (result.ok) {
      expect(result.trip.styles).toEqual(['history', 'temples']);
      expect(result.trip.pace).toBe('relaxed');
      expect(result.trip.source).toBe('persisted-itinerary-profile');
    }
  });

  it('rejects client material that does not match the saved profile', async () => {
    const lookup = vi.fn(async (): Promise<TripLookup> => owned);
    const tampered = {
      ...matchingInput,
      trip: { ...matchingInput.trip, styles: ['beaches'] },
    };
    await expect(authorizeCandidateTrip(tampered, 'user-1', lookup)).resolves.toMatchObject({
      ok: false,
      code: 'trip-material-mismatch',
    });
  });

  it('refuses a trip whose persisted profile cannot provide authoritative material', async () => {
    const lookup = vi.fn(async (): Promise<TripLookup> => ({ ...owned, itineraryData: {} }));
    await expect(authorizeCandidateTrip(matchingInput, 'user-1', lookup)).resolves.toMatchObject({
      ok: false,
      code: 'trip-material-unavailable',
    });
  });
});
