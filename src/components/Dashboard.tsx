import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { Plus, LogOut, Calendar, MapPin, Loader2, RefreshCw, Pencil, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Itinerary } from '../data';
import { itineraries } from '../data';
import { loadFromStorage, saveToStorage, listLocalTrips, upsertLocalTrip, removeLocalTrip, writeRawToStorage } from '../lib/storageResilience';

interface TripItem {
  id: string;
  name: string;
  cities: string[];
  days: number;
  updated_at: string;
}

export const Dashboard = ({ onSelectTrip }: { onSelectTrip: (id: string) => void }) => {
  const { user, signOut, isDemoUser, isLocalTestUser } = useAuth();
  const [trips, setTrips] = useState<TripItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const ITEMS_PER_PAGE = 10;

  const loadTrips = async (currentPage: number, append = false) => {
    if (!user) {
      setTrips([]);
      setHasMore(false);
      setLoading(false);
      return;
    }

    if (isDemoUser || isLocalTestUser || !isSupabaseConfigured()) {
      const localTrips = listLocalTrips(user.id)
        .map((entry) => {
          const itinerary = loadFromStorage<Itinerary>(`itinerary-${entry.id}`);
          if (!itinerary) return null;
          return {
            id: entry.id,
            name: itinerary.name || 'Untitled Trip',
            cities: itinerary.cities || [],
            days: itinerary.days?.length || 0,
            updated_at: entry.updatedAt,
          } satisfies TripItem;
        })
        .filter((trip): trip is TripItem => Boolean(trip));

      setTrips(localTrips);
      setHasMore(false);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const { data, error, count } = await supabase
        .from('itineraries')
        .select('id, data, updated_at', { count: 'exact' })
        // RLS should handle this, but adding explicitly for optimization
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false })
        .range(currentPage * ITEMS_PER_PAGE, (currentPage + 1) * ITEMS_PER_PAGE - 1);

      if (error) throw error;

      const parsedTrips: TripItem[] = (data || []).map((row) => {
        const payload = row.data as Partial<Itinerary> | null;
        return {
          id: row.id,
          name: payload?.name || 'Untitled Trip',
          cities: payload?.cities || [],
          days: payload?.days?.length || 0,
          updated_at: row.updated_at || new Date().toISOString(),
        };
      });

      setTrips((prev) => (append ? [...prev, ...parsedTrips] : parsedTrips));
      setHasMore((count || 0) > (currentPage + 1) * ITEMS_PER_PAGE);
    } catch (err: any) {
      setError(err.message || 'Failed to load trips. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTrips(0, false);
  }, [user, isDemoUser, isLocalTestUser]);

  const handleLoadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    loadTrips(nextPage, true);
  };

  const handleCreateTrip = async () => {
    if (!user) return;
    const newId = `trip-${Date.now()}`;
    const starter = {
      ...itineraries[0],
      id: newId,
      cities: [...itineraries[0].cities],
      days: itineraries[0].days.map((day) => ({
        ...day,
        activities: [...day.activities],
        photos: day.photos ? [...day.photos] : undefined,
      })),
    } satisfies Itinerary;

    saveToStorage(`itinerary-${newId}`, starter);
    upsertLocalTrip(user.id, starter);
    onSelectTrip(newId);
  };

  const handleDeleteTrip = async (tripId: string) => {
    if (!user) return;

    const confirmed = window.confirm('Delete this trip? This removes it from the dashboard.');
    if (!confirmed) return;

    try {
      if (!isDemoUser && !isLocalTestUser && isSupabaseConfigured()) {
        await supabase.from('itineraries').delete().eq('id', tripId).eq('user_id', user.id);
        await supabase.from('budgets').delete().eq('id', tripId);
        await supabase.from('draft_items').delete().eq('itinerary_id', tripId);
        await supabase.from('itineraries').delete().eq('id', `drafts-${tripId}`);
      }
    } catch (error) {
      console.error('Failed to delete trip from cloud:', error);
    }

    writeRawToStorage(`itinerary-${tripId}`, null, { preserveCurrent: false });
    writeRawToStorage(`budget-${tripId}`, null, { preserveCurrent: false });
    writeRawToStorage(`drafts-${tripId}`, null, { preserveCurrent: false });
    writeRawToStorage(`trip-settings-${tripId}`, null, { preserveCurrent: false });
    writeRawToStorage(`photos-${tripId}`, null, { preserveCurrent: false });
    removeLocalTrip(user.id, tripId);

    setTrips((prev) => prev.filter((trip) => trip.id !== tripId));
  };

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen p-4 sm:p-6 md:p-10" style={{ backgroundColor: 'var(--bg)', color: 'var(--ink)' }}>
      <div className="max-w-5xl mx-auto">
        <header
          className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-10 pb-6"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <div>
            <h1 className="font-display text-4xl md:text-5xl" style={{ color: 'var(--ink)' }}>Your Dashboard</h1>
            <p className="mt-2 text-sm md:text-base" style={{ color: 'var(--ink-muted)' }}>
              {isDemoUser
                ? 'Demo mode is active. Your test trip data stays on this device only.'
                : isLocalTestUser
                  ? 'Local test account is active. Your sign-up test data stays on this device only.'
                : `Welcome back, ${user.email}. Select a trip or start a new one.`}
            </p>
          </div>
          <button
            onClick={signOut}
            className="flex w-full sm:w-auto justify-center items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-colors"
            style={{ color: 'var(--accent)', backgroundColor: 'var(--accent-soft)' }}
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </header>

        {error && (
          <div className="mb-8 p-4 rounded-2xl bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Create New Trip Card */}
          <motion.div
            whileHover={{ y: -4 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleCreateTrip}
            className="editorial-card p-6 flex flex-col items-center justify-center min-h-[200px] cursor-pointer group border-dashed border-2"
            style={{ backgroundColor: 'transparent' }}
          >
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform"
              style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
            >
              <Plus className="w-6 h-6" />
            </div>
            <h3 className="font-display text-2xl mt-4" style={{ color: 'var(--ink)' }}>Start New Trip</h3>
            <p className="text-sm mt-1" style={{ color: 'var(--ink-muted)' }}>Create a blank canvas</p>
          </motion.div>

          {/* Trip Cards */}
          <AnimatePresence>
            {trips.map((trip, index) => (
              <motion.div
                key={trip.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                whileHover={{ y: -4 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => onSelectTrip(trip.id)}
                className="editorial-card p-5 sm:p-6 cursor-pointer relative overflow-hidden group"
              >
                <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                  <Calendar className="w-24 h-24" style={{ color: 'var(--accent)' }} />
                </div>
                <div className="relative z-10">
                  <div className="flex items-center gap-2 mb-3">
                    <span
                      className="eyebrow px-2 py-1 rounded-md"
                      style={{ backgroundColor: 'var(--bg)' }}
                    >
                      {trip.days} Days
                    </span>
                  </div>
                  <h3 className="font-display text-3xl mb-2 truncate" style={{ color: 'var(--ink)' }}>
                    {trip.name}
                  </h3>
                  <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--ink-muted)' }}>
                    <MapPin className="w-4 h-4 shrink-0" />
                    <span className="truncate">{trip.cities.length > 0 ? trip.cities.join(', ') : 'No cities yet'}</span>
                  </div>
                  <div
                    className="mt-6 pt-4 flex items-center justify-between text-xs"
                    style={{ borderTop: '1px solid var(--border)', color: 'var(--ink-muted)' }}
                  >
                    <span>Last updated</span>
                    <span>{new Date(trip.updated_at).toLocaleDateString()}</span>
                  </div>
                  <div className="mt-4 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelectTrip(trip.id);
                      }}
                      className="pill-btn pill-soft !px-3 !py-2 text-xs justify-center"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleDeleteTrip(trip.id);
                      }}
                      className="pill-btn !px-3 !py-2 text-xs justify-center"
                      style={{ border: '1px solid var(--border)', color: 'var(--warn)', backgroundColor: 'transparent' }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Delete
                    </button>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          {loading && (
            <div className="editorial-card p-6 flex flex-col items-center justify-center min-h-[200px]">
              <Loader2 className="w-8 h-8 animate-spin mb-4" style={{ color: 'var(--accent)' }} />
              <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>Loading your trips...</p>
            </div>
          )}
        </div>

        {!loading && hasMore && (
          <div className="mt-10 flex justify-center">
            <button
              onClick={handleLoadMore}
              className="pill-btn pill-ghost flex items-center gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              Load More
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
