import { useEffect, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import { Archive, ArrowRight, CalendarDays, MapPin, Pencil, Plus, RefreshCw, RotateCcw, Trash2, UserRound } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useCurrency } from '../contexts/CurrencyContext';
import { createBlankItinerary, createItineraryFromProfile, toTripSummary, type TripSummary } from '../lib/trips';
import { TripCreateWizard } from './TripCreateWizard';
import type { TripProfile } from '../lib/tripProfile';
import type { Itinerary } from '../data';
import { tripStorageCleanupKeys } from '../lib/tripDeletion';
import { pruneOrphanTripStorage } from '../lib/tripStorageOrphans';
import { safeGetItem, safeRemoveItem, safeSetItem } from '../lib/safeLocalStorage';

interface TripDashboardProps {
  onOpenTrip: (trip: Itinerary) => void;
  onOpenProfile: () => void;
}

const localTripsKey = (userId: string) => `trip-registry-${userId}`;

const readLocalTrips = (userId: string): TripSummary[] => {
  try {
    const parsed = JSON.parse(safeGetItem(localTripsKey(userId)) || '[]');
    return Array.isArray(parsed)
      ? parsed.map((trip) => ({ ...trip, status: trip.status === 'archived' ? 'archived' : 'active' }))
      : [];
  } catch {
    return [];
  }
};

export function TripDashboard({ onOpenTrip, onOpenProfile }: TripDashboardProps) {
  const { user, isDemoUser, isLocalTestUser } = useAuth();
  const { homeCurrency } = useCurrency();
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shelf, setShelf] = useState<'active' | 'archived'>('active');
  const [wizardOpen, setWizardOpen] = useState(false);
  const [deletingTripId, setDeletingTripId] = useState<string | null>(null);

  const localOnly = isDemoUser || isLocalTestUser || !isSupabaseConfigured();

  const persistLocalTrips = (next: TripSummary[]) => {
    if (!user) return;
    safeSetItem(localTripsKey(user.id), JSON.stringify(next));
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
      const rows = (data || []).map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description,
        status: (row.status === 'archived' ? 'archived' : 'active') as TripSummary['status'],
        updatedAt: row.updated_at,
        dayCount: row.day_count,
        cityCount: row.city_count,
      }));
      setTrips(rows);
      // The registry is authoritative here, and it lists archived trips too, so
      // anything trip-scoped left in this browser for an id outside it belongs
      // to a trip this account no longer has. Deleting a trip on another device
      // is what strands those snapshots. Only runs on a successful load — a
      // failed query must never be mistaken for "owns nothing".
      pruneOrphanTripStorage(user.id, rows.map((row) => row.id));
    }
    setLoading(false);
  };

  useEffect(() => { void loadTrips(); }, [user?.id, localOnly]);

  const openTrip = async (summary: TripSummary) => {
    if (!user) return;
    if (localOnly) {
      const stored = safeGetItem(`itinerary-${user.id}-${summary.id}`);
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

  const createTrip = async (profile?: TripProfile) => {
    if (!user || creating) return;
    setCreating(true);
    setError(null);
    const itinerary = profile ? createItineraryFromProfile(profile) : createBlankItinerary();
    const summary = toTripSummary(itinerary);
    // Cache locally either way so the handbook opens with its identity intact
    // before any cloud round trip completes.
    safeSetItem(`itinerary-${user.id}-${itinerary.id}`, JSON.stringify(itinerary));

    if (localOnly) {
      const next = [summary, ...readLocalTrips(user.id)];
      persistLocalTrips(next);
      setTrips(next);
      setWizardOpen(false);
      onOpenTrip(itinerary);
      setCreating(false);
      return;
    }

    const { error: registryError } = await supabase.from('trip_registry').insert({
      id: itinerary.id,
      user_id: user.id,
      title: summary.title,
      description: summary.description,
      status: 'active',
      day_count: summary.dayCount,
      city_count: summary.cityCount,
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
      setWizardOpen(false);
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
      const raw = safeGetItem(key);
      if (raw) {
        const itinerary = JSON.parse(raw) as Itinerary;
        safeSetItem(key, JSON.stringify({ ...itinerary, name: title }));
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

  const deleteTrip = async (event: MouseEvent<HTMLElement>, trip: TripSummary) => {
    event.stopPropagation();
    if (!user || deletingTripId) return;
    if (!window.confirm(`Delete “${trip.title}”? This permanently removes the trip and its handbook data.`)) return;

    setDeletingTripId(trip.id);
    setError(null);
    try {
      if (!localOnly) {
        const results = await Promise.all([
          supabase.from('draft_items').delete().eq('itinerary_id', trip.id).eq('user_id', user.id),
          supabase.from('budgets').delete().eq('id', trip.id).eq('user_id', user.id),
          supabase.from('checklists').delete().eq('id', `checklist-${trip.id}`).eq('user_id', user.id),
          supabase.from('trip_documents').delete().eq('trip_id', trip.id).eq('user_id', user.id),
          supabase.from('day_photos').delete().eq('itinerary_id', trip.id).eq('user_id', user.id),
          supabase.from('itineraries').delete().eq('id', trip.id).eq('user_id', user.id),
          supabase.from('trip_registry').delete().eq('id', trip.id).eq('user_id', user.id),
        ]);
        const failed = results.find((result) => result.error);
        if (failed?.error) throw failed.error;
      }

      for (const key of tripStorageCleanupKeys(user.id, trip.id)) {
        safeRemoveItem(key);
      }
      const next = trips.filter((item) => item.id !== trip.id);
      persistLocalTrips(next);
      setTrips(next);
    } catch (deleteError) {
      console.error('Failed to delete trip:', deleteError);
      setError('The trip could not be fully deleted from the cloud. Your local copy was kept. Please try again.');
    } finally {
      setDeletingTripId(null);
    }
  };

  const onCardKeyDown = (event: KeyboardEvent<HTMLElement>, trip: TripSummary) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      void openTrip(trip);
    }
  };

  const visibleTrips = trips.filter((trip) => trip.status === shelf);

  return (
    <main
      className="trip-dashboard min-h-screen max-w-6xl xl:max-w-7xl mx-auto px-5 sm:px-8 lg:px-10 pb-10 md:pb-16"
      style={{
        color: 'var(--ink)',
        backgroundColor: 'var(--bg)',
        paddingTop: 'max(1.25rem, var(--app-safe-top))',
      }}
    >
      <div className="trip-dashboard-hero mb-8 md:mb-10">
        <div className="flex items-center justify-between gap-3">
          <p className="eyebrow m-0">Your travel shelf</p>
          <button
            type="button"
            onClick={onOpenProfile}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full shrink-0"
            style={{ color: 'var(--ink)', border: '1px solid var(--border)', backgroundColor: 'var(--bg-elevated)' }}
            aria-label="Open profile settings"
            title="Profile settings"
          >
            <UserRound className="w-5 h-5" />
          </button>
        </div>

        <div className="trip-dashboard-intro">
          <h1 className="font-display text-5xl md:text-7xl leading-none">Choose a trip.</h1>
          <p className="mt-4 text-base md:text-lg leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
            Keep each journey in its own handbook, then shape the details at your own pace.
          </p>
        </div>

        <div className="trip-dashboard-actions">
          <div className="shelf-toggle" role="tablist" aria-label="Trip shelf filter">
            {([
              { id: 'active' as const, label: 'Active trips' },
              { id: 'archived' as const, label: 'Archived' },
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
                  style={{ color: selected ? 'var(--accent-ink)' : 'var(--ink-muted)' }}
                >
                  {selected && (
                    <motion.span
                      layoutId="shelf-toggle-indicator"
                      className="shelf-toggle-indicator"
                      transition={{ type: 'spring', stiffness: 420, damping: 32, mass: 0.7 }}
                      aria-hidden="true"
                    />
                  )}
                  <span className="relative z-10">{option.label}</span>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            className="pill-btn pill-primary accent-button w-full inline-flex items-center justify-center gap-2 min-h-11"
            style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-ink)' }}
            onClick={() => setWizardOpen(true)}
            disabled={creating}
          >
            {creating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Create new trip
          </button>
        </div>
      </div>

      {error && <div className="mb-6 rounded-2xl border px-4 py-3 text-sm" style={{ borderColor: 'var(--accent)', color: 'var(--ink)' }} role="alert">{error}</div>}

      {loading ? (
        <div className="flex items-center gap-3 py-16" style={{ color: 'var(--ink-muted)' }}><RefreshCw className="w-5 h-5 animate-spin" /> Loading your trips…</div>
      ) : visibleTrips.length === 0 ? (
        shelf === 'active' ? (
          <section className="trip-empty-state" data-testid="first-trip-empty-state">
            <div className="trip-empty-state-copy">
              <h2 className="font-display text-4xl md:text-5xl leading-[1.02]">Your first trip starts here.</h2>
              <p className="mt-4 max-w-md text-base md:text-lg leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
                Choose where and when you are going. Planitenary will shape the first pages around your journey.
              </p>
              <button
                type="button"
                className="pill-btn pill-primary mt-7"
                style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-ink)' }}
                onClick={() => setWizardOpen(true)}
              >
                Plan a new trip
              </button>
            </div>
            <div
              className="future-illustration-slot future-illustration-slot-trip"
              data-future-illustration="trip-empty"
              aria-hidden="true"
            />
          </section>
        ) : (
          <div className="editorial-card p-8 md:p-12 text-center" style={{ backgroundColor: 'var(--bg-elevated)' }}>
            <Archive className="mx-auto w-8 h-8 mb-4" style={{ color: 'var(--accent)' }} />
            <h2 className="font-display text-3xl">No archived trips.</h2>
            <p className="max-w-md mx-auto mt-3" style={{ color: 'var(--ink-muted)' }}>Archived trips will stay here until you restore them.</p>
          </div>
        )
      ) : (
        <motion.div layout className="trip-grid grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <AnimatePresence mode="popLayout" initial={false}>
            {visibleTrips.map((trip, index) => (
              <motion.div
                key={`${shelf}-${trip.id}`}
                layout
                initial={{ opacity: 0, y: 16, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.97 }}
                transition={{
                  opacity: { duration: 0.18 },
                  scale: { duration: 0.22, ease: [0.22, 1, 0.36, 1] },
                  y: { duration: 0.28, ease: [0.22, 1, 0.36, 1], delay: index * 0.035 },
                  layout: { type: 'spring', stiffness: 360, damping: 30 },
                }}
                whileHover={{ y: -4 }}
                whileTap={{ scale: 0.99 }}
                role="button"
                tabIndex={0}
                onClick={() => void openTrip(trip)}
                onKeyDown={(event) => onCardKeyDown(event, trip)}
                className="trip-card text-left editorial-card p-5 sm:p-6 cursor-pointer"
                style={{ backgroundColor: 'var(--bg-elevated)' }}
              >
              <div className="flex items-start justify-between gap-4">
                <span className="font-display text-5xl" style={{ color: 'var(--accent)' }} data-accent-swatch="trip-number">{String(index + 1).padStart(2, '0')}</span>
                <div className="flex items-center gap-1">
                  <span className="p-2 rounded-full" style={{ color: 'var(--ink-muted)' }}><ArrowRight className="w-5 h-5" /></span>
                </div>
              </div>
              <h2 className="trip-card-title font-display text-3xl mt-8">{trip.title}</h2>
              <p className="mt-2 line-clamp-2" style={{ color: 'var(--ink-muted)' }}>{trip.description}</p>
              <div className="trip-card-metrics flex flex-wrap gap-3 mt-6 text-xs font-semibold" style={{ color: 'var(--ink-muted)' }}>
                <span className="inline-flex items-center gap-1"><CalendarDays className="w-3.5 h-3.5" /> {trip.dayCount} days</span>
                <span className="inline-flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> {trip.cityCount} cities</span>
              </div>
              <div className="trip-card-actions flex flex-wrap mt-5">
                <button
                  type="button"
                  onClick={(event) => void renameTrip(event, trip)}
                  className="trip-card-action inline-flex items-center gap-1.5 text-xs font-semibold"
                  style={{ color: 'var(--ink-muted)' }}
                >
                  <Pencil className="w-3.5 h-3.5" /> Rename
                </button>
                {shelf === 'active' ? (
                  <button
                    type="button"
                    onClick={(event) => void archiveTrip(event, trip)}
                    className="trip-card-action inline-flex items-center gap-1.5 text-xs font-semibold"
                    style={{ color: 'var(--ink-muted)' }}
                  >
                    <Archive className="w-3.5 h-3.5" /> Archive
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={(event) => void restoreTrip(event, trip)}
                    className="trip-card-action inline-flex items-center gap-1.5 text-xs font-semibold"
                    style={{ color: 'var(--ink-muted)' }}
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> Restore
                  </button>
                )}
                <button
                  type="button"
                  onClick={(event) => void deleteTrip(event, trip)}
                  className="trip-card-action inline-flex items-center gap-1.5 text-xs font-semibold"
                  style={{ color: 'var(--warn)' }}
                  disabled={deletingTripId === trip.id}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {deletingTripId === trip.id ? 'Deleting…' : 'Delete'}
                </button>
              </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      <div className="mt-10 flex items-center gap-2 text-xs" style={{ color: 'var(--ink-muted)' }}>
        <Archive className="w-4 h-4" /> Legacy trips remain preserved separately until you choose to import them.
      </div>

      <TripCreateWizard
        open={wizardOpen}
        busy={creating}
        defaultHomeCurrency={homeCurrency}
        onCancel={() => setWizardOpen(false)}
        onCreate={(profile) => void createTrip(profile)}
      />
    </main>
  );
}
