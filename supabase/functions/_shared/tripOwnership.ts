import type { SupabaseClient } from '@supabase/supabase-js';
import type { TripLookup } from './reasoningRequest.ts';

/**
 * The app's actual ownership model is text ids shared by these two tables.
 * Querying with both id and verified user id prevents a service-role lookup
 * from turning into an existence oracle for somebody else's trip.
 */
export async function readOwnedTrip(
  client: SupabaseClient | null,
  tripId: string,
  userId: string,
): Promise<TripLookup> {
  if (!client) return { kind: 'error' };
  try {
    const { data: registry, error: registryError } = await client
      .from('trip_registry')
      .select('id,user_id,status')
      .eq('id', tripId)
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle();
    if (registryError) return { kind: 'error' };
    if (!registry) return { kind: 'missing' };

    const { data: itinerary, error: itineraryError } = await client
      .from('itineraries')
      .select('data')
      .eq('id', tripId)
      .eq('user_id', userId)
      .maybeSingle();
    if (itineraryError) return { kind: 'error' };
    return {
      kind: 'owned',
      tripId: String(registry.id),
      userId: String(registry.user_id),
      itineraryData: itinerary?.data ?? null,
    };
  } catch {
    return { kind: 'error' };
  }
}
