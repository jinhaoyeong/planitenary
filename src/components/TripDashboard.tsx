import { useEffect, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import { Archive, ArrowRight, CalendarDays, MapPin, Pencil, Plus, RefreshCw, Sparkles, RotateCcw, UserRound } from 'lucide-react';
import { motion } from 'framer-motion';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { createBlankItinerary, toTripSummary, type TripSummary } from '../lib/trips';
import type { Itinerary } from '../data';

interface TripDashboardProps {
  onOpenTrip: (trip: Itinerary) => void;
  onOpenProfile: () => void;
}

const localTripsKey = (userId: string) => `trip-registry-${userId}`;

const readLocalTrips = (userId: string): TripSummary[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(localTripsKey(userId)) || '[]');
    return Array.isArray(parsed)
      ? parsed.map((trip) => ({ ...trip, status: trip.status === 'archived' ? 'archived' : 'active' }))
      : [];
  } catch {
    return [];
  }
};

export function TripDashboard({ onOpenTrip, onOpenProfile }: TripDashboardProps) {
  const { user, isDemoUser, isLocalTestUser } = useAuth();
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shelf, setShelf] = useState<'active' | 'archived'>('active');

  const localOnly = isDemoUser || isLocalTestUser || !isSupabaseConfigured();

  const persistLocalTrips = (next: TripSummary[]) => {
    if (!user) return;
    localStorage.setItem(localTripsKey(user.id), JSON.stringify(next));
  };

  const loadTrips = async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    if (localOnly) {
      setTrips(readLocalTrips(user.id));
      setLoading(false);
      return;
    }

    const { data, error: queryError } = await supabase
      .from('trip_registry')
      .select('id,title,description,status,updated_at,day_count,city_count')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false });

    if (queryError) {
      setError('Your trip dashboard could not load. Please try again.');
      console.error('Failed to load trip dashboard:', queryError);
    } else {
      setTrips((data || []).map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description,
        status: row.status === 'archived' ? 'archived' : 'active',
        updatedAt: row.updated_at,
        dayCount: row.day_count,
        cityCount: row.city_count,
      })));
    }
    setLoading(false);
  };

  useEffect(() => { void loadTrips(); }, [user?.id, localOnly]);

  const openTrip = async (summary: TripSummary) => {
    if (!user) return;
    if (localOnly) {
      const stored = localStorage.getItem(`itinerary-${user.id}-${summary.id}`);
      onOpenTrip(stored ? JSON.parse(stored) as Itinerary : createBlankItinerary(summary.id));
      return;
    }
    const { data, error: queryError } = await supabase
      .from('itineraries')
      .select('data')
      .eq('id', summary.id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (queryError) {
      setError('That trip could not be opened.');
      return;
    }
    onOpenTrip(data?.data as Itinerary || createBlankItinerary(summary.id));
  };

  const createTrip = async () => {
    if (!user || creating) return;
    setCreating(true);
    setError(null);
    const itinerary = createBlankItinerary();
    const summary = toTripSummary(itinerary);

    if (localOnly) {
      const next = [summary, ...readLocalTrips(user.id)];
      persistLocalTrips(next);
      localStorage.setItem(`itinerary-${user.id}-${itinerary.id}`, JSON.stringify(itinerary));
      setTrips(next);
      onOpenTrip(itinerary);
      setCreating(false);
      return;
    }

    const { error: registryError } = await supabase.from('trip_registry').insert({
      id: itinerary.id,
      user_id: user.id,
      title: itinerary.name,
      description: itinerary.description,
      status: 'active',
      day_count: 0,
      city_count: 0,
    });
    const { error: itineraryError } = await supabase.from('itineraries').insert({
      id: itinerary.id,
      user_id: user.id,
      data: itinerary,
    });
    if (registryError || itineraryError) {
      setError('The new trip could not be saved. Please try again.');
      console.error('Failed to create trip:', registryError || itineraryError);
    } else {
      setTrips((current) => [summary, ...current]);
      onOpenTrip(itinerary);
    }
    setCreating(false);
  };

  const renameTrip = async (event: MouseEvent<HTMLElement>, trip: TripSummary) => {
    event.stopPropagation();
    if (!user) return;
    const title = window.prompt('Name this trip', trip.title)?.trim();
    if (!title || title === trip.title) return;
    const next = trips.map((item) => item.id === trip.id ? { ...item, title } : item);
    if (localOnly) {
      persistLocalTrips(next);
      const key = `itinerary-${user.id}-${trip.id}`;
      const raw = localStorage.getItem(key);
      if (raw) {
        const itinerary = JSON.parse(raw) as Itinerary;
        localStorage.setItem(key, JSON.stringify({ ...itinerary, name: title }));
      }
      setTrips(next);
      return;
    }
    const { error: updateError } = await supabase.from('trip_registry').update({ title, updated_at: new Date().toISOString() }).eq('id', trip.id).eq('user_id', user.id);
    if (updateError) {
      setError('The trip name could not be updated.');
      return;
    }
    const { data } = await supabase.from('itineraries').select('data').eq('id', trip.id).eq('user_id', user.id).maybeSingle();
    if (data?.data) await supabase.from('itineraries').update({ data: { ...(data.data as Itinerary), name: title }, updated_at: new Date().toISOString() }).eq('id', trip.id).eq('user_id', user.id);
    setTrips(next);
  };

  const archiveTrip = async (event: MouseEvent<HTMLElement>, trip: TripSummary) => {
    event.stopPropagation();
    if (!user || !window.confirm(`Archive “${trip.title}”? It will leave your active trip shelf.`)) return;
    if (localOnly) {
      const next = trips.map((item) => item.id === trip.id ? { ...item, status: 'archived' as const, updatedAt: new Date().toISOString() } : item);
      persistLocalTrips(next);
      setTrips(next);
      return;
    }
    const { error: archiveError } = await supabase.from('trip_registry').update({ status: 'archived', updated_at: new Date().toISOString() }).eq('id', trip.id).eq('user_id', user.id);
    if (archiveError) {
      setError('The trip could not be archived.');
      return;
    }
    setTrips((current) => current.map((item) => item.id === trip.id ? { ...item, status: 'archived' as const, updatedAt: new Date().toISOString() } : item));
  };

  const restoreTrip = async (event: MouseEvent<HTMLElement>, trip: TripSummary) => {
    event.stopPropagation();
    if (!user) return;
    if (localOnly) {
      const next = trips.map((item) => item.id === trip.id ? { ...item, status: 'active' as const, updatedAt: new Date().toISOString() } : item);
      persistLocalTrips(next);
      setTrips(next);
      setShelf('active');
      return;
    }
    const { error: restoreError } = await supabase
      .from('trip_registry')
      .update({ status: 'active', updated_at: new Date().toISOString() })
      .eq('id', trip.id)
      .eq('user_id', user.id);
    if (restoreError) {
      setError('The trip could not be restored. Please try again.');
      return;
    }
    setTrips((current) => current.map((item) => item.id === trip.id ? { ...item, status: 'active' as const, updatedAt: new Date().toISOString() } : item));
    setShelf('active');
  };

  const onCardKeyDown = (event: KeyboardEvent<HTMLElement>, trip: TripSummary) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      void openTrip(trip);
    }
  };

  const visibleTrips = trips.filter((trip) => trip.status === shelf);
  const activeCount = trips.filter((trip) => trip.status === 'active').length;
  const archivedCount = trips.filter((trip) => trip.status === 'archived').length;

  return (
    <main className="min-h-screen max-w-6xl mx-auto px-4 sm:px-6 md:px-10 py-6 md:py-16" style={{ color: 'var(--ink)', backgroundColor: 'var(--bg)' }}>
      <div className="flex items-center justify-end mb-6 md:mb-8">
        <button
          type="button"
          onClick={onOpenProfile}
          className="inline-flex p-2.5 rounded-full"
          style={{ color: 'var(--ink)', border: '1px solid var(--border)', backgroundColor: 'var(--bg-elevated)' }}
          aria-label="Open profile settings"
          title="Profile settings"
        >
          <UserRound className="w-5 h-5" />
        </button>
      </div>

      <div className="flex flex-col gap-5 mb-8 md:mb-10">
        <div>
          <p className="eyebrow">Your travel shelf</p>
          <h1 className="font-display text-5xl md:text-7xl leading-none mt-4">Choose a trip.</h1>
          <p className="mt-5 max-w-xl text-base md:text-lg leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
            Keep each journey in its own handbook, then shape the details at your own pace.
          </p>
        </div>

        <div className="flex flex-col gap-3 w-full max-w-xl">
          <div className="shelf-toggle" role="tablist" aria-label="Trip shelf filter">
            {([
              { id: 'active' as const, label: 'Active trips', count: activeCount },
              { id: 'archived' as const, label: 'Archived', count: archivedCount },
            ]).map((option) => {
              const selected = shelf === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setShelf(option.id)}
                  className={selected ? 'shelf-toggle-option is-selected' : 'shelf-toggle-option'}
                >
                  <span>{option.label}</span>
                  <span className="shelf-toggle-count">{option.count}</span>
                </button>
              );
            })}
          </div>

          {shelf === 'active' && (
            <button
              type="button"
              className="pill-btn pill-primary w-full inline-flex items-center justify-center gap-2 min-h-11"
              onClick={() => void createTrip()}
              disabled={creating}
            >
              {creating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Create new trip
            </button>
          )}
        </div>
      </div>

      {error && <div className="mb-6 rounded-2xl border px-4 py-3 text-sm" style={{ borderColor: 'var(--accent)', color: 'var(--ink)' }} role="alert">{error}</div>}

      {loading ? (
        <div className="flex items-center gap-3 py-16" style={{ color: 'var(--ink-muted)' }}><RefreshCw className="w-5 h-5 animate-spin" /> Loading your trips…</div>
      ) : visibleTrips.length === 0 ? (
        <div className="editorial-card p-8 md:p-12 text-center" style={{ backgroundColor: 'var(--bg-elevated)' }}>
          {shelf === 'active' ? <>
            <Sparkles className="mx-auto w-8 h-8 mb-4" style={{ color: 'var(--accent)' }} />
            <h2 className="font-display text-3xl">Your first trip starts here.</h2>
            <p className="max-w-md mx-auto mt-3" style={{ color: 'var(--ink-muted)' }}>Create a blank handbook for dates, places, ideas, costs, and memories.</p>
            <button type="button" className="pill-btn pill-primary mt-6" onClick={() => void createTrip()}>Create a blank trip</button>
          </> : <>
            <Archive className="mx-auto w-8 h-8 mb-4" style={{ color: 'var(--accent)' }} />
            <h2 className="font-display text-3xl">No archived trips.</h2>
            <p className="max-w-md mx-auto mt-3" style={{ color: 'var(--ink-muted)' }}>Archived trips will stay here until you restore them.</p>
          </>}
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {visibleTrips.map((trip, index) => (
            <motion.div
              key={trip.id}
              whileHover={{ y: -4 }}
              whileTap={{ scale: 0.99 }}
              role="button"
              tabIndex={0}
              onClick={() => void openTrip(trip)}
              onKeyDown={(event) => onCardKeyDown(event, trip)}
              className="text-left editorial-card p-6 cursor-pointer"
              style={{ backgroundColor: 'var(--bg-elevated)' }}
            >
              <div className="flex items-start justify-between gap-4">
                <span className="font-display text-5xl" style={{ color: 'var(--accent)' }}>{String(index + 1).padStart(2, '0')}</span>
                <div className="flex items-center gap-1">
                  <span className="p-2 rounded-full" style={{ color: 'var(--ink-muted)' }}><ArrowRight className="w-5 h-5" /></span>
                </div>
              </div>
              <h2 className="font-display text-3xl mt-8">{trip.title}</h2>
              <p className="mt-2 line-clamp-2" style={{ color: 'var(--ink-muted)' }}>{trip.description}</p>
              <div className="flex flex-wrap gap-3 mt-6 text-xs font-semibold" style={{ color: 'var(--ink-muted)' }}>
                <span className="inline-flex items-center gap-1"><CalendarDays className="w-3.5 h-3.5" /> {trip.dayCount} days</span>
                <span className="inline-flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> {trip.cityCount} cities</span>
              </div>
              <div className="flex gap-2 mt-5 pt-4" style={{ borderTop: '1px solid var(--border)' }}>
                <button
                  type="button"
                  onClick={(event) => void renameTrip(event, trip)}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold"
                  style={{ color: 'var(--ink-muted)' }}
                >
                  <Pencil className="w-3.5 h-3.5" /> Rename
                </button>
                {shelf === 'active' ? (
                  <button
                    type="button"
                    onClick={(event) => void archiveTrip(event, trip)}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold"
                    style={{ color: 'var(--ink-muted)' }}
                  >
                    <Archive className="w-3.5 h-3.5" /> Archive
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={(event) => void restoreTrip(event, trip)}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold"
                    style={{ color: 'var(--ink-muted)' }}
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> Restore
                  </button>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      )}

      <div className="mt-10 flex items-center gap-2 text-xs" style={{ color: 'var(--ink-muted)' }}>
        <Archive className="w-4 h-4" /> Legacy trips remain preserved separately until you choose to import them.
      </div>
    </main>
  );
}
