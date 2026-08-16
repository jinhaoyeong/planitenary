import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { readOwnedTrip } from '../../supabase/functions/_shared/tripOwnership';

const clientWith = (registry: unknown, itinerary: unknown) => {
  const filters: Array<[string, string, unknown]> = [];
  const from = vi.fn((table: string) => {
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn((column: string, value: unknown) => {
        filters.push([table, column, value]);
        return chain;
      }),
      maybeSingle: vi.fn(async () => ({
        data: table === 'trip_registry' ? registry : itinerary,
        error: null,
      })),
    };
    return chain;
  });
  return { client: { from } as unknown as SupabaseClient, from, filters };
};

describe('owned-trip lookup', () => {
  it('scopes both registry and itinerary reads to the verified user', async () => {
    const { client, filters } = clientWith(
      { id: 'trip-1', user_id: 'user-1', status: 'active' },
      { data: { name: 'Osaka' } },
    );
    await expect(readOwnedTrip(client, 'trip-1', 'user-1')).resolves.toEqual({
      kind: 'owned',
      tripId: 'trip-1',
      userId: 'user-1',
      itineraryData: { name: 'Osaka' },
    });
    expect(filters).toContainEqual(['trip_registry', 'id', 'trip-1']);
    expect(filters).toContainEqual(['trip_registry', 'user_id', 'user-1']);
    expect(filters).toContainEqual(['trip_registry', 'status', 'active']);
    expect(filters).toContainEqual(['itineraries', 'id', 'trip-1']);
    expect(filters).toContainEqual(['itineraries', 'user_id', 'user-1']);
  });

  it('does not read private itinerary data when ownership is absent', async () => {
    const { client, from } = clientWith(null, { data: { secret: true } });
    await expect(readOwnedTrip(client, 'trip-1', 'other-user')).resolves.toEqual({ kind: 'missing' });
    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith('trip_registry');
  });
});
