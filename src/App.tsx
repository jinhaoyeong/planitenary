import { useState, useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { itineraries } from './data';
import type { Itinerary, DayPhoto } from './data';
import { ItineraryView } from './components/ItineraryView';
import { Draft } from './components/Handbook';
import { Budget } from './components/Budget';
import { Maps } from './components/Maps';
import { Checklist } from './components/Checklist';
import { Documents } from './components/Documents';
import { PhotoWall } from './components/PhotoWall';
import { InstallPrompt } from './components/InstallPrompt';
import { WelcomeScreen } from './components/WelcomeScreen';
import { ReloadPrompt } from './components/ReloadPrompt';
import { Map, BookOpen, Calendar, Wallet, Menu, X, CheckSquare, Moon, Sun, RefreshCw, FileText, Image as ImageIcon, SlidersHorizontal, ChevronLeft, LogOut } from 'lucide-react';
import { motion, AnimatePresence, animate, useScroll, useSpring } from 'framer-motion';
import { clsx } from 'clsx';
import { CustomCursor } from './components/motion/CustomCursor';
import { GrainOverlay } from './components/motion/GrainOverlay';
import { useTheme } from './contexts/ThemeContext';
import { supabase, isSupabaseConfigured } from './lib/supabase';
import { loadFromStorage, saveToStorage, writeRawToStorage, getRestorePreview, restoreSelectedTripData, createRestoreSnapshot, restoreLastSnapshot, upsertLocalTrip } from './lib/storageResilience';
import type { RestoreDatasetId, RestoreDatasetPreview } from './lib/storageResilience';
import { getAllPhotosForItinerary, restorePhotosForItinerary } from './lib/photoStorage';
import { Marquee } from './components/ui/Marquee';
import { hapticMedium } from './lib/haptics';
import { usePullToRefresh } from './hooks/usePullToRefresh';
import { useAuth } from './contexts/AuthContext';
import { Auth } from './components/Auth';
import { Dashboard } from './components/Dashboard';
import { SettingsPanel } from './components/SettingsPanel';
import { ProfilePanel } from './components/ProfilePanel';
import { DEFAULT_TRIP_SETTINGS, applyTemplate, mergeTripSettings } from './lib/tripSettings';
import type { TripAppSettings } from './lib/tripSettings';

interface CloudBackupSnapshot {
  kind: 'trip-backup-v1';
  itineraryId: string;
  createdAt: string;
  source: 'manual';
  summary: {
    dayCount: number;
    checklistCount: number;
    draftCount: number;
    photoCount: number;
  };
  datasets: {
    itinerary: Itinerary | null;
    budget: Record<string, unknown> | null;
    checklist: unknown[] | null;
    drafts: unknown[] | null;
    photos: Record<number, DayPhoto[]>;
  };
}

interface CloudBackupVersion {
  id: string;
  createdAt: string;
  summaryText: string;
}

const createStarterItinerary = (id: string): Itinerary => ({
  ...itineraries[0],
  id,
  cities: [...itineraries[0].cities],
  days: itineraries[0].days.map((day) => ({
    ...day,
    activities: [...day.activities],
    photos: day.photos ? [...day.photos] : undefined,
  })),
});

function App() {
  const { user, isLoading, isDemoUser, isLocalTestUser, signOut } = useAuth();
  const [activeItineraryId, setActiveItineraryId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'itinerary' | 'draft' | 'budget' | 'maps' | 'checklist' | 'documents' | 'photos' | 'settings'>('itinerary');
  const [settingsView, setSettingsView] = useState<'handbook' | 'profile'>('handbook');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [showWelcome, setShowWelcome] = useState(() => !localStorage.getItem('hasVisited'));
  const [showRestoreModal, setShowRestoreModal] = useState(false);
  const [restorePreview, setRestorePreview] = useState<RestoreDatasetPreview[]>([]);
  const [selectedRestoreIds, setSelectedRestoreIds] = useState<RestoreDatasetId[]>([]);
  const [restorePushCloud, setRestorePushCloud] = useState(false);
  const [hasRestoreSnapshot, setHasRestoreSnapshot] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [cloudBackups, setCloudBackups] = useState<CloudBackupVersion[]>([]);
  const [selectedCloudBackupId, setSelectedCloudBackupId] = useState('');
  const [isCloudBackupsLoading, setIsCloudBackupsLoading] = useState(false);
  const [isCloudBackupSaving, setIsCloudBackupSaving] = useState(false);
  const [isCloudBackupRestoring, setIsCloudBackupRestoring] = useState(false);

  const { theme, toggleTheme } = useTheme();

  const handleStart = () => {
    setShowWelcome(false);
    localStorage.setItem('hasVisited', 'true');
  };

  const [customItinerary, setCustomItinerary] = useState<Itinerary | null>(null);
  const [tripSettings, setTripSettings] = useState<TripAppSettings>(DEFAULT_TRIP_SETTINGS);
  const itinerarySyncReadyRef = useRef(false);
  const hasLocalItineraryRef = useRef(false);
  const remoteItineraryLoadedRef = useRef(false);
  const settingsHydratedRef = useRef(false);

  const activeItinerary = activeItineraryId ? itineraries.find((i) => i.id === activeItineraryId) ?? itineraries[0] : itineraries[0];
  const displayItinerary = customItinerary || activeItinerary;

  useEffect(() => {
    document.title = displayItinerary.name || 'Travel Handbook';
  }, [displayItinerary.name]);
  const settingsStorageKey = activeItineraryId ? `trip-settings-${activeItineraryId}` : '';

  // Scroll-driven motion
  const { scrollYProgress: pageProgress } = useScroll();
  const scaleProgress = useSpring(pageProgress, { stiffness: 140, damping: 32, mass: 0.4 });

  // Pull-to-refresh — re-fetch itinerary from Supabase on mobile
  const { pulling, pullDistance, refreshing, progress: pullProgress } = usePullToRefresh({
    onRefresh: async () => {
      if (!isSupabaseConfigured() || isDemoUser || isLocalTestUser || !activeItineraryId) return;
      const { data } = await supabase
        .from('itineraries')
        .select('data')
        .eq('id', activeItineraryId)
        .single();
      if (data?.data) {
        setCustomItinerary(data.data as Itinerary);
        saveToStorage(`itinerary-${activeItineraryId}`, data.data);
      }
    },
  });

  useEffect(() => {
    if (!activeItineraryId) return;
    itinerarySyncReadyRef.current = false;
    remoteItineraryLoadedRef.current = false;
    hasLocalItineraryRef.current = false;
    const storageKey = `itinerary-${activeItineraryId}`;
    try {
      const recovered = loadFromStorage<Itinerary>(storageKey);
      if (recovered) {
        setCustomItinerary(recovered);
        hasLocalItineraryRef.current = true;
      } else {
        setCustomItinerary(createStarterItinerary(activeItineraryId));
      }
    } catch (e) {
      console.error("Failed to load itinerary", e);
      setCustomItinerary(createStarterItinerary(activeItineraryId));
    }
  }, [activeItineraryId, activeItinerary]);

  useEffect(() => {
    if (!settingsStorageKey) return;
    const storedSettings = loadFromStorage<TripAppSettings>(settingsStorageKey);
    setTripSettings(mergeTripSettings(storedSettings));
    settingsHydratedRef.current = true;
  }, [settingsStorageKey]);

  useEffect(() => {
    if (!settingsHydratedRef.current || !settingsStorageKey) return;
    saveToStorage(settingsStorageKey, tripSettings);
  }, [settingsStorageKey, tripSettings]);

  useEffect(() => {
    if (!isSupabaseConfigured() || isDemoUser || isLocalTestUser || !activeItineraryId) return;
    let isMounted = true;
    itinerarySyncReadyRef.current = false;
    remoteItineraryLoadedRef.current = false;

    const fetchRemoteItinerary = async () => {
      const { data, error } = await supabase
        .from('itineraries')
        .select('data')
        .eq('id', activeItineraryId)
        .single();

      if (!isMounted) return;

      if (data?.data) {
        setCustomItinerary(data.data as Itinerary);
        hasLocalItineraryRef.current = true;
        saveToStorage(`itinerary-${activeItineraryId}`, data.data);
      } else if (error && error.code !== 'PGRST116') {
        console.error('Error fetching itinerary:', error);
      }
      remoteItineraryLoadedRef.current = true;
      itinerarySyncReadyRef.current = true;
    };

    fetchRemoteItinerary();

    const channel = supabase
      .channel(`itinerary-sync-${activeItineraryId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'itineraries', filter: `id=eq.${activeItineraryId}` },
        (payload) => {
          const nextData = payload.new && 'data' in payload.new ? (payload.new.data as Itinerary | undefined) : undefined;
          if (!nextData) return;
          hasLocalItineraryRef.current = true;
          setCustomItinerary((prev) => {
            if (prev && JSON.stringify(prev) === JSON.stringify(nextData)) return prev;
            saveToStorage(`itinerary-${activeItineraryId}`, nextData);
            return nextData;
          });
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      channel.unsubscribe();
    };
  }, [activeItineraryId]);

  useEffect(() => {
    const itineraryToSync = customItinerary;
    if (!itineraryToSync || !activeItineraryId) return;

    saveToStorage(`itinerary-${itineraryToSync.id}`, itineraryToSync);
    if (user?.id) {
      upsertLocalTrip(user.id, itineraryToSync);
    }

    if (!itinerarySyncReadyRef.current || !remoteItineraryLoadedRef.current) return;
    if (!hasLocalItineraryRef.current && JSON.stringify(itineraryToSync) === JSON.stringify(activeItinerary)) return;
    hasLocalItineraryRef.current = true;

    if (!isSupabaseConfigured() || isDemoUser || isLocalTestUser) return;

    const timeoutId = setTimeout(async () => {
      const { error } = await supabase
        .from('itineraries')
        .upsert({ 
          id: itineraryToSync.id, 
          data: itineraryToSync, 
          updated_at: new Date().toISOString(),
          user_id: user?.id 
        });
      if (error) {
        console.error('Error syncing itinerary:', error);
      }
    }, 800);

    return () => clearTimeout(timeoutId);
  }, [customItinerary, activeItinerary, activeItineraryId, isDemoUser, isLocalTestUser, user?.id]);

  useEffect(() => {
    if (!activeItineraryId) return;
    const key = `itinerary-${activeItineraryId}`;
    const onStorage = (event: StorageEvent) => {
      if (event.key !== key || !event.newValue) return;
      try {
        const incoming = JSON.parse(event.newValue) as Itinerary;
        setCustomItinerary((prev) => {
          if (prev && JSON.stringify(prev) === JSON.stringify(incoming)) return prev;
          return incoming;
        });
      } catch (error) {
        console.error('Failed to sync itinerary from storage', error);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [activeItineraryId]);

  const handleTabChange = (newTab: typeof activeTab) => {
    hapticMedium();
    setActiveTab(newTab);
    
    // Defer scroll until React has committed the DOM changes and Framer Motion has begun its mount
    setTimeout(() => {
      const mainContent = document.getElementById('main-content');
      const header = document.querySelector('header');
      const headerHeight = header ? header.getBoundingClientRect().height : 0;
      
      const targetY = mainContent
        ? Math.max(0, mainContent.getBoundingClientRect().top + window.scrollY - headerHeight - 8)
        : 0;
        
      const startY = window.scrollY;
      const distance = Math.abs(targetY - startY);

      if (distance < 2) return;

      const lenis = (window as unknown as { __lenis?: { scrollTo: (y: number, o?: object) => void } }).__lenis;
      
      // Determine how we want to scroll based on current position
      const isNearTop = startY < targetY - 100;

      if (lenis && typeof lenis.scrollTo === 'function') {
        lenis.scrollTo(targetY, { 
          duration: isNearTop ? 0.8 : 0, 
          easing: (t: number) => 1 - Math.pow(1 - t, 4) 
        });
      } else {
        // Detect if the user is on a mobile device
        const isMobile = window.matchMedia('(max-width: 768px)').matches || ('ontouchstart' in window);
        
        if (isNearTop) {
          if (isMobile) {
            // Mobile devices natively handle CSS smooth scrolling beautifully with momentum
            window.scrollTo({
              top: targetY,
              behavior: 'smooth'
            });
          } else {
            // Framer Motion's animate function creates a buttery smooth, 
            // perfectly-eased JS scroll that bypasses the choppy native CSS smooth scrolling on PC browsers.
            animate(startY, targetY, {
              duration: 0.6,
              ease: [0.22, 1, 0.36, 1], // Premium easing curve
              onUpdate: (v) => window.scrollTo(0, v)
            });
          }
        } else {
          // If we are deep in the content, instantly snap to the top of the tab
          window.scrollTo({
            top: targetY,
            behavior: 'instant'
          });
        }
      }
    }, 50); // 50ms delay lets the new tab's DOM render first so heights are accurate
  };

  const tabs = [
    { id: 'itinerary', label: tripSettings.labels.itineraryTab, icon: Calendar },
    { id: 'maps', label: tripSettings.labels.mapsTab, icon: Map },
    { id: 'draft', label: tripSettings.labels.draftTab, icon: BookOpen },
    { id: 'budget', label: tripSettings.labels.budgetTab, icon: Wallet },
    { id: 'checklist', label: tripSettings.labels.checklistTab, icon: CheckSquare },
    { id: 'documents', label: tripSettings.labels.documentsTab, icon: FileText },
    { id: 'photos', label: tripSettings.labels.photosTab, icon: ImageIcon },
  ] as const;

  /** Documents only appear in the hamburger Quick Menu on small screens, not the bottom pill. */
  const tabsMobileBottom = tabs.filter((tab) => tab.id !== 'documents' && tab.id !== 'photos');

  const handleSaveTripSettings = (nextItinerary: Itinerary, nextSettings: TripAppSettings) => {
    setCustomItinerary(nextItinerary);
    setTripSettings(nextSettings);
  };

  const buildCloudSnapshot = async (): Promise<CloudBackupSnapshot> => {
    if (!activeItineraryId) throw new Error('No active itinerary');
    const itineraryData = loadFromStorage<Itinerary>(`itinerary-${activeItineraryId}`) || customItinerary || activeItinerary;
    const budgetData = loadFromStorage<Record<string, unknown>>(`budget-${activeItineraryId}`);
    const checklistData = loadFromStorage<unknown[]>('checklist-data');
    const draftsData = loadFromStorage<unknown[]>(`drafts-${activeItineraryId}`);
    const photosByDay = await getAllPhotosForItinerary(activeItineraryId);
    const photoCount = Object.values(photosByDay).reduce<number>((count, dayPhotos) => count + dayPhotos.length, 0);
    return {
      kind: 'trip-backup-v1',
      itineraryId: activeItineraryId,
      createdAt: new Date().toISOString(),
      source: 'manual',
      summary: {
        dayCount: itineraryData?.days?.length || 0,
        checklistCount: checklistData?.length || 0,
        draftCount: draftsData?.length || 0,
        photoCount,
      },
      datasets: {
        itinerary: itineraryData || null,
        budget: budgetData || null,
        checklist: checklistData || null,
        drafts: draftsData || null,
        photos: photosByDay,
      }
    };
  };

  const saveCloudBackupVersion = async () => {
    if (!activeItineraryId) return false;
    if (!isSupabaseConfigured() || isDemoUser || isLocalTestUser) {
      window.alert('Cloud backup needs Supabase to be configured.');
      return false;
    }
    setIsCloudBackupSaving(true);
    try {
      const snapshot = await buildCloudSnapshot();
      const backupId = `backup-${activeItineraryId}-${Date.now()}`;
      const { error } = await supabase
        .from('itineraries')
        .upsert({ id: backupId, data: snapshot, updated_at: snapshot.createdAt });
      if (error) {
        window.alert('Unable to save cloud backup version.');
        return false;
      }
      return true;
    } finally {
      setIsCloudBackupSaving(false);
    }
  };

  const loadCloudBackupVersions = async () => {
    if (!activeItineraryId) return;
    if (!isSupabaseConfigured() || isDemoUser || isLocalTestUser) {
      setCloudBackups([]);
      setSelectedCloudBackupId('');
      return;
    }
    setIsCloudBackupsLoading(true);
    try {
      const { data, error } = await supabase
        .from('itineraries')
        .select('id,data,updated_at')
        .like('id', `backup-${activeItineraryId}-%`)
        .order('updated_at', { ascending: false });
      if (error) {
        setCloudBackups([]);
        setSelectedCloudBackupId('');
        return;
      }
      const parsed = (data || [])
        .map((row) => {
          const payload = row.data as Partial<CloudBackupSnapshot> | null;
          if (!payload || payload.kind !== 'trip-backup-v1') return null;
          const createdAt = payload.createdAt || row.updated_at || '';
          const summary = payload.summary;
          const summaryText = summary
            ? `${summary.dayCount}d • ${summary.photoCount}p • ${summary.checklistCount}c • ${summary.draftCount}dr`
            : 'Backup snapshot';
          return {
            id: row.id as string,
            createdAt,
            summaryText,
          } satisfies CloudBackupVersion;
        })
        .filter((item): item is CloudBackupVersion => Boolean(item));
      setCloudBackups(parsed);
      setSelectedCloudBackupId((prev) => (prev && parsed.some((item) => item.id === prev) ? prev : parsed[0]?.id || ''));
    } finally {
      setIsCloudBackupsLoading(false);
    }
  };

  const openRestoreModal = async () => {
    if (!activeItineraryId) return;
    const preview = await getRestorePreview(activeItineraryId);
    setRestorePreview(preview);
    setSelectedRestoreIds(preview.filter((item) => item.hasBackup).map((item) => item.id));
    setRestorePushCloud(false);
    setHasRestoreSnapshot(Boolean(localStorage.getItem(`restore-snapshot-${activeItineraryId}`)));
    await loadCloudBackupVersions();
    setShowRestoreModal(true);
  };

  const toggleRestoreItem = (id: RestoreDatasetId) => {
    setSelectedRestoreIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const pushRestoredDataToCloud = async (datasetIds: RestoreDatasetId[]) => {
    if (!isSupabaseConfigured() || isDemoUser || isLocalTestUser || !activeItineraryId) return;
    if (datasetIds.includes('itinerary')) {
      const itineraryData = loadFromStorage<Itinerary>(`itinerary-${activeItineraryId}`);
      if (itineraryData) {
        await supabase.from('itineraries').upsert({ id: activeItineraryId, data: itineraryData, updated_at: new Date().toISOString(), user_id: user?.id });
      }
    }
    if (datasetIds.includes('budget')) {
      const budgetData = loadFromStorage<Record<string, unknown>>(`budget-${activeItineraryId}`);
      if (budgetData) {
        await supabase.from('budgets').upsert({ id: activeItineraryId, data: budgetData, updated_at: new Date().toISOString() });
      }
    }
    if (datasetIds.includes('checklist')) {
      const checklistData = loadFromStorage<unknown[]>('checklist-data');
      if (checklistData) {
        await supabase.from('checklists').upsert({ id: 'default', data: checklistData, updated_at: new Date().toISOString() });
      }
    }
    if (datasetIds.includes('drafts')) {
      const draftsData = loadFromStorage<unknown[]>(`drafts-${activeItineraryId}`);
      if (draftsData) {
        await supabase
          .from('itineraries')
          .upsert({ id: `drafts-${activeItineraryId}`, data: { items: draftsData }, updated_at: new Date().toISOString() });
      }
    }
  };

  const handleRestoreBackup = async () => {
    if (!activeItineraryId) return;
    if (selectedRestoreIds.length === 0) {
      window.alert('Select at least one dataset to restore.');
      return;
    }
    const confirmed = window.confirm(`Restore ${selectedRestoreIds.length} selected dataset(s)?`);
    if (!confirmed) return;
    const shouldCreateSnapshot = window.confirm('Create snapshot before restore so you can undo restore later?');
    setIsRestoring(true);
    try {
      if (shouldCreateSnapshot) {
        await createRestoreSnapshot(activeItineraryId);
      }
      const restoredCount = await restoreSelectedTripData(activeItineraryId, selectedRestoreIds);
      if (restoredCount === 0) {
        window.alert('No backup found for selected dataset(s).');
        setIsRestoring(false);
        return;
      }
      if (restorePushCloud) {
        await pushRestoredDataToCloud(selectedRestoreIds);
      }
      window.alert(`Restored ${restoredCount} dataset(s). Reloading now.`);
      window.location.reload();
    } finally {
      setIsRestoring(false);
    }
  };

  const handleCloudBackupNow = async () => {
    const ok = await saveCloudBackupVersion();
    if (!ok) return;
    await loadCloudBackupVersions();
    window.alert('Cloud backup version saved with timestamp.');
  };

  const handleRestoreCloudBackup = async () => {
    if (!activeItineraryId) return;
    if (!selectedCloudBackupId) {
      window.alert('Select a cloud backup version first.');
      return;
    }
    if (!isSupabaseConfigured() || isDemoUser || isLocalTestUser) {
      window.alert('Cloud restore needs Supabase to be configured.');
      return;
    }
    const confirmed = window.confirm('Restore selected cloud backup version to this device now?');
    if (!confirmed) return;
    setIsCloudBackupRestoring(true);
    try {
      await createRestoreSnapshot(activeItineraryId);
      const { data, error } = await supabase
        .from('itineraries')
        .select('data')
        .eq('id', selectedCloudBackupId)
        .single();
      if (error || !data?.data) {
        window.alert('Unable to load selected cloud backup.');
        return;
      }
      const snapshot = data.data as CloudBackupSnapshot;
      if (snapshot.kind !== 'trip-backup-v1' || snapshot.itineraryId !== activeItineraryId) {
        window.alert('Invalid backup version for this itinerary.');
        return;
      }
      const keyMap = {
        itinerary: `itinerary-${activeItineraryId}`,
        budget: `budget-${activeItineraryId}`,
        checklist: 'checklist-data',
        drafts: `drafts-${activeItineraryId}`,
        photos: `photos-${activeItineraryId}`,
      };
      const writeRaw = (key: string, value: unknown) => {
        if (value === null || value === undefined) {
          writeRawToStorage(key, null);
          return;
        }
        const serialized = JSON.stringify(value);
        writeRawToStorage(key, serialized);
      };
      writeRaw(keyMap.itinerary, snapshot.datasets.itinerary);
      writeRaw(keyMap.budget, snapshot.datasets.budget);
      writeRaw(keyMap.checklist, snapshot.datasets.checklist);
      writeRaw(keyMap.drafts, snapshot.datasets.drafts);
      writeRaw(keyMap.photos, snapshot.datasets.photos);
      await restorePhotosForItinerary(activeItineraryId, snapshot.datasets.photos || {});
      window.alert('Cloud backup restored. Reloading now.');
      window.location.reload();
    } finally {
      setIsCloudBackupRestoring(false);
    }
  };

  const handleUndoRestore = async () => {
    if (!activeItineraryId) return;
    const ok = await restoreLastSnapshot(activeItineraryId);
    if (!ok) {
      window.alert('No restore snapshot found yet.');
      return;
    }
    window.alert('Previous snapshot restored. Reloading now.');
    window.location.reload();
  };

  if (isLoading) {
    return <div className="min-h-screen bg-[color:var(--bg)] flex items-center justify-center"><div className="animate-spin w-8 h-8 border-4 border-rose-500 border-t-transparent rounded-full" /></div>;
  }

  if (showWelcome) {
    return <WelcomeScreen onStart={handleStart} />;
  }

  if (!user) {
    return <Auth />;
  }

  if (!activeItineraryId) {
    return <Dashboard onSelectTrip={setActiveItineraryId} />;
  }

  const tripThemeStyle = {
    '--bg': tripSettings.theme.bg,
    '--bg-elevated': tripSettings.theme.bgElevated,
    '--ink': tripSettings.theme.ink,
    '--ink-muted': tripSettings.theme.inkMuted,
    '--accent': tripSettings.theme.accent,
    '--accent-soft': tripSettings.theme.accentSoft,
  } as CSSProperties;

  const coverStatusLabel =
    displayItinerary.cities.length > 0
      ? applyTemplate(tripSettings.coverStatusFilled, { cities: displayItinerary.cities.join(' · ') })
      : tripSettings.coverStatusEmpty;
  const coverModeLabel = displayItinerary.cities.length > 0 ? tripSettings.coverModeFilled : tripSettings.coverModeEmpty;

  return (
    <div className="min-h-screen font-sans pb-24 md:pb-0 overflow-x-hidden" style={{ ...tripThemeStyle, backgroundColor: 'var(--bg)', color: 'var(--ink)' }}>

      {/* Scroll progress bar */}
      <motion.div
        className="fixed top-0 left-0 right-0 h-[2px] origin-left z-[70]"
        style={{ backgroundColor: 'var(--accent)', scaleX: scaleProgress }}
      />

      {/* Pull-to-refresh indicator (mobile) */}
      {(pulling || refreshing) && (
        <div
          className="fixed left-1/2 z-[80] flex items-center justify-center"
          style={{
            top: Math.min(pullDistance, 100),
            transform: 'translateX(-50%)',
            transition: refreshing ? 'top 0.3s ease' : undefined,
          }}
        >
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center"
            style={{
              backgroundColor: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              boxShadow: 'var(--shadow-lift)',
              transform: `rotate(${pullProgress * 360}deg)`,
              transition: refreshing ? 'transform 0.3s ease' : undefined,
            }}
          >
            {refreshing ? (
              <RefreshCw className="w-4 h-4 animate-spin" style={{ color: 'var(--accent)' }} />
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ color: 'var(--accent)' }}>
                <path d="M8 2v10M4 8l4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </div>
        </div>
      )}

      {/* Grain + Custom cursor — desktop only, self-gated */}
      {tripSettings.immersiveEffects && <GrainOverlay />}
      {tripSettings.immersiveEffects && <CustomCursor />}

      {/* Global Overlays */}
      <InstallPrompt />
      <ReloadPrompt />
      <AnimatePresence>
        {showWelcome && <WelcomeScreen onStart={handleStart} />}
      </AnimatePresence>

      {/* Top Nav — editorial minimal */}
      <header
        className="sticky top-0 z-40 backdrop-blur-md"
        style={{
          backgroundColor: 'color-mix(in srgb, var(--bg) 85%, transparent)',
          borderBottom: '1px solid var(--border)',
          paddingTop: 'env(safe-area-inset-top)',
          willChange: 'transform',
        }}
      >
        <div className="max-w-7xl mx-auto px-3 sm:px-6 md:px-10 py-3 md:py-4 flex items-center justify-between gap-2 sm:gap-3">
          <div className="flex items-center gap-3 shrink min-w-0">
            <button 
              onClick={() => setActiveItineraryId(null)}
              className="p-2 -ml-2 rounded-xl text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              aria-label="Back to Dashboard"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <span className="font-display text-lg sm:text-2xl md:text-3xl leading-none tracking-tight truncate" style={{ color: 'var(--ink)' }}>
              {(() => {
                const title = displayItinerary.name || 'Travel Handbook';
                const words = title.trim().split(' ');
                const lastWord = words.pop() || '';
                return (
                  <>
                    {words.join(' ')}{words.length > 0 ? ' ' : ''}
                    <span className="font-display-italic" style={{ color: 'var(--accent)' }}>{lastWord}</span>
                  </>
                );
              })()}
            </span>
          </div>

          <motion.nav 
            initial="hidden"
            animate="visible"
            variants={{
              hidden: { opacity: 0 },
              visible: {
                opacity: 1,
                transition: { staggerChildren: 0.05, delayChildren: 0.1 }
              }
            }}
            className="hidden md:flex items-center gap-1"
          >
            {tabs.map(tab => (
              <motion.button
                key={tab.id}
                variants={{
                  hidden: { opacity: 0, y: -10 },
                  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] } }
                }}
                onClick={() => handleTabChange(tab.id as any)}
                className="relative px-4 py-2 text-sm font-semibold tracking-tight transition-colors"
                style={{ color: activeTab === tab.id ? 'var(--ink)' : 'var(--ink-muted)' }}
              >
                {tab.label}
                {activeTab === tab.id && (
                  <motion.span
                    layoutId="nav-underline"
                    className="absolute left-3 right-3 -bottom-1 h-[3px] rounded-full"
                    style={{ backgroundColor: 'var(--accent)' }}
                  />
                )}
              </motion.button>
            ))}
          </motion.nav>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <motion.button
              onClick={() => handleTabChange('settings')}
              className="p-2 rounded-full"
              style={{
                color: activeTab === 'settings' ? 'var(--accent)' : 'var(--ink)',
                border: '1px solid var(--border)',
                backgroundColor: activeTab === 'settings' ? 'var(--bg-elevated)' : 'transparent',
              }}
              aria-label="Open settings"
              whileTap={{ scale: 0.9 }}
            >
              <SlidersHorizontal className="w-4 h-4" />
            </motion.button>
            <motion.button
              onClick={signOut}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-semibold"
              style={{ color: 'var(--ink)', border: '1px solid var(--border)' }}
              whileTap={{ scale: 0.95 }}
              whileHover={{ y: -1 }}
              aria-label="Sign out"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Sign Out</span>
            </motion.button>
            <motion.button
              onClick={openRestoreModal}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-semibold"
              style={{ color: 'var(--ink)', border: '1px solid var(--border)' }}
              whileTap={{ scale: 0.95 }}
              whileHover={{ y: -1 }}
              aria-label="Restore backup"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Restore</span>
            </motion.button>
            <motion.button
              onClick={toggleTheme}
              className="hidden sm:inline-flex p-2 rounded-full"
              style={{ color: 'var(--ink)', border: '1px solid var(--border)' }}
              aria-label="Toggle theme"
              whileTap={{ scale: 0.9, rotate: -12 }}
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </motion.button>
            <motion.button
              className="md:hidden p-2 rounded-full"
              style={{ color: 'var(--ink)', border: '1px solid var(--border)' }}
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              whileTap={{ scale: 0.9 }}
              aria-label="Menu"
            >
              {isMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </motion.button>
          </div>
        </div>
      </header>

      {/* Hero — split editorial layout */}
      <section className="max-w-7xl mx-auto px-3 sm:px-6 md:px-10 pt-8 md:pt-20 pb-8 md:pb-16">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-10 md:gap-12 items-center">
          {/* Left copy */}
          <div className="md:col-span-7">
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}>
              <span className="eyebrow">{tripSettings.heroEyebrow}</span>
            </motion.div>
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
              className="mt-5 font-display text-[clamp(2.8rem,12vw,4.6rem)] sm:text-6xl md:text-[5.5rem] lg:text-[6.5rem] leading-[0.95] tracking-tight whitespace-pre-line"
              style={{ color: 'var(--ink)' }}
            >
              {tripSettings.heroHeadline}
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
              className="mt-6 max-w-xl text-base md:text-lg leading-relaxed"
              style={{ color: 'var(--ink-muted)' }}
            >
              {displayItinerary.description || tripSettings.heroDescription}
            </motion.p>
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
              className="mt-8 flex flex-wrap items-center gap-3"
            >
              <button onClick={() => handleTabChange('itinerary')} className="pill-btn pill-primary">
                {tripSettings.heroPrimaryCta}
              </button>
              <button onClick={() => handleTabChange('maps')} className="pill-btn pill-ghost">
                {tripSettings.heroSecondaryCta}
              </button>
            </motion.div>
          </div>

          {/* Right photo card */}
          <motion.div
            initial={{ opacity: 0, y: 24, rotate: -2 }}
            animate={{ opacity: 1, y: 0, rotate: -2 }}
            transition={{ delay: 0.1, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="md:col-span-5 relative"
          >
            <div
              className="editorial-card p-3 md:p-4 rotate-[-2deg]"
              style={{ backgroundColor: 'var(--bg-elevated)' }}
            >
              {tripSettings.coverImage ? (
                <div className="relative overflow-hidden rounded-2xl">
                  <img
                    src={tripSettings.coverImage}
                    alt={displayItinerary.name || 'Trip cover'}
                    className="w-full h-[220px] sm:h-[280px] md:h-[420px] object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-black/10 to-transparent" />
                  <div className="absolute top-5 left-5 eyebrow justify-center bg-black/20 px-3 py-1 rounded-full backdrop-blur-sm text-white">
                    {tripSettings.coverLabel}
                  </div>
                </div>
              ) : (
                <div
                  className="relative overflow-hidden rounded-2xl w-full h-[220px] sm:h-[280px] md:h-[420px] flex items-center justify-center text-center px-6"
                  style={{ background: 'linear-gradient(135deg, var(--accent-soft), color-mix(in srgb, var(--bg-elevated) 60%, var(--accent-soft)))' }}
                >
                  <div>
                    <div className="eyebrow justify-center">{tripSettings.coverLabel}</div>
                    <div className="mt-4 font-display text-3xl sm:text-4xl md:text-5xl whitespace-pre-line" style={{ color: 'var(--ink)' }}>
                      {tripSettings.coverHeadline}
                    </div>
                  </div>
                </div>
              )}
              <div className="flex items-center justify-between px-2 pt-3 pb-1">
                <span className="font-display-italic text-lg" style={{ color: 'var(--ink)' }}>
                  {coverStatusLabel}
                </span>
                <span className="text-xs font-semibold tracking-widest uppercase" style={{ color: 'var(--ink-muted)' }}>
                  {coverModeLabel}
                </span>
              </div>
            </div>
            {/* Sticker badge */}
            <motion.div
              initial={{ scale: 0, rotate: -10 }}
              animate={{ scale: 1, rotate: 8 }}
              transition={{ delay: 0.5, type: 'spring', stiffness: 180, damping: 12 }}
              className="absolute -top-4 -right-2 sm:-top-6 sm:-right-4 md:-top-8 md:-right-6 w-20 h-20 sm:w-24 sm:h-24 md:w-32 md:h-32 rounded-full flex flex-col items-center justify-center text-center shadow-xl"
              style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-ink)' }}
            >
              <span className="font-display text-2xl sm:text-3xl md:text-4xl leading-none">{displayItinerary.days.length}</span>
              <span className="text-[10px] font-bold uppercase tracking-widest mt-1">{tripSettings.labels.daysLabel}</span>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* Marquee strip */}
      <Marquee
        items={
          displayItinerary.cities.length > 0
            ? [...displayItinerary.cities, ...(tripSettings.marqueeItems.length > 0 ? tripSettings.marqueeItems : DEFAULT_TRIP_SETTINGS.marqueeItems)]
            : (tripSettings.marqueeItems.length > 0 ? tripSettings.marqueeItems : DEFAULT_TRIP_SETTINGS.marqueeItems)
        }
      />

      {/* Main Content Area */}
      <main
        id="main-content"
        className={clsx(
          'mx-auto px-3 sm:px-6 md:px-10 pt-8 md:pt-14 pb-24 md:pb-20 relative z-10',
          activeTab === 'settings' ? 'max-w-[1500px]' : 'max-w-7xl'
        )}
      >
        
        {/* Tab Content Wrapper with Glass Effect for overlapping sections */}
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className="w-full"
          >
            {activeTab === 'itinerary' && (
              <ItineraryView 
                itinerary={displayItinerary} 
                onItineraryChange={setCustomItinerary}
                settings={tripSettings}
              />
            )}
            {activeTab === 'maps' && <Maps itinerary={displayItinerary} onItineraryChange={setCustomItinerary} />}
            {activeTab === 'draft' && (
              <Draft
                itinerary={displayItinerary}
                onItineraryChange={setCustomItinerary}
              />
            )}
            {activeTab === 'budget' && <Budget itinerary={displayItinerary} />}
            {activeTab === 'checklist' && <Checklist />}
            {activeTab === 'documents' && <Documents />}
            {activeTab === 'photos' && <PhotoWall itinerary={displayItinerary} />}
            {activeTab === 'settings' && (
              <div className="space-y-4">
                <div className="xl:hidden flex gap-2">
                  <button
                    type="button"
                    onClick={() => setSettingsView('handbook')}
                    className="pill-btn justify-center flex-1"
                    style={{
                      backgroundColor: settingsView === 'handbook' ? 'var(--accent)' : 'var(--bg-elevated)',
                      color: settingsView === 'handbook' ? '#0F0E0D' : 'var(--ink)',
                      border: settingsView === 'handbook' ? '1px solid var(--accent)' : '1px solid var(--border)',
                    }}
                  >
                    Handbook Settings
                  </button>
                  <button
                    type="button"
                    onClick={() => setSettingsView('profile')}
                    className="pill-btn justify-center flex-1"
                    style={{
                      backgroundColor: settingsView === 'profile' ? 'var(--accent)' : 'var(--bg-elevated)',
                      color: settingsView === 'profile' ? '#0F0E0D' : 'var(--ink)',
                      border: settingsView === 'profile' ? '1px solid var(--accent)' : '1px solid var(--border)',
                    }}
                  >
                    Profile
                  </button>
                </div>

                <div className="flex flex-col gap-6 xl:gap-10 items-start max-w-[1200px] mx-auto">
                  <div className={settingsView === 'handbook' ? 'w-full block' : 'hidden xl:block w-full'}>
                    <SettingsPanel
                      itinerary={displayItinerary}
                      settings={tripSettings}
                      onSave={handleSaveTripSettings}
                    />
                  </div>
                  <div className={settingsView === 'profile' ? 'w-full block' : 'hidden xl:block w-full'}>
                    <ProfilePanel />
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      <AnimatePresence>
        {showRestoreModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] flex items-center justify-center p-4"
          >
            <button className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" onClick={() => setShowRestoreModal(false)} />
            <motion.div
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              className="relative w-full max-w-xl max-h-[90dvh] overflow-y-auto rounded-2xl sm:rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl p-3 sm:p-4 md:p-6 will-change-transform"
            >
              <div className="flex items-start justify-between gap-3 mb-3 sm:mb-4">
                <div>
                  <h3 className="text-base sm:text-lg md:text-xl font-bold text-slate-900 dark:text-white">Restore Backup Preview</h3>
                  <p className="text-[11px] sm:text-xs md:text-sm text-slate-500 dark:text-slate-400 mt-1 leading-tight">Select only what you want to restore.</p>
                </div>
                <button onClick={() => setShowRestoreModal(false)} className="p-2 rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-2 max-h-[40dvh] sm:max-h-[45vh] overflow-auto pr-1">
                {restorePreview.map((item) => (
                  <label
                    key={item.id}
                    className={clsx(
                      "flex items-start gap-2.5 rounded-xl border p-2.5 sm:p-3 transition-colors",
                      item.hasBackup
                        ? "border-slate-200 dark:border-slate-700 hover:border-emerald-300 dark:hover:border-emerald-600"
                        : "border-slate-100 dark:border-slate-800 opacity-60"
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={selectedRestoreIds.includes(item.id)}
                      disabled={!item.hasBackup}
                      onChange={() => toggleRestoreItem(item.id)}
                      className="mt-1 w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-sm sm:text-base text-slate-800 dark:text-slate-200">{item.label}</span>
                        <span className={clsx("text-[10px] px-2 py-0.5 rounded-xl", item.changed ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300")}>
                          {item.changed ? 'Restore available' : 'Same as current'}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 break-words">
                        Current: {item.primarySummary} · Restore: {item.backupSummary}
                        {item.historyCount > 0 ? ` · History: ${item.historyCount}` : ''}
                      </div>
                    </div>
                  </label>
                ))}
              </div>

              <div className="mt-3 sm:mt-4 space-y-2.5 sm:space-y-3">
                <label className="flex items-start gap-2 text-xs sm:text-sm text-slate-700 dark:text-slate-300 leading-tight">
                  <input
                    type="checkbox"
                    checked={restorePushCloud}
                    onChange={(e) => setRestorePushCloud(e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span>Restore + push selected data to cloud (all devices will sync this restored version)</span>
                </label>
                <motion.div
                  className="rounded-xl border border-slate-200 dark:border-slate-700 p-2.5 sm:p-3 space-y-2"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25 }}
                >
                  <div className="text-xs font-semibold text-slate-600 dark:text-slate-300">Cloud Backup Versions</div>
                  <select
                    value={selectedCloudBackupId}
                    onChange={(e) => setSelectedCloudBackupId(e.target.value)}
                    disabled={isCloudBackupsLoading || cloudBackups.length === 0}
                    className="editorial-input is-compact"
                  >
                    {cloudBackups.length === 0 ? (
                      <option value="">No cloud backups yet</option>
                    ) : (
                      cloudBackups.map((version) => (
                        <option key={version.id} value={version.id}>
                          {new Date(version.createdAt).toLocaleString()} · {version.summaryText}
                        </option>
                      ))
                    )}
                  </select>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <motion.button
                      onClick={handleCloudBackupNow}
                      disabled={isCloudBackupSaving || isCloudBackupRestoring || isRestoring}
                      className="flex-1 inline-flex items-center justify-center rounded-xl border border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300 font-semibold px-3 py-2 hover:bg-blue-50 dark:hover:bg-blue-900/30 disabled:opacity-60 text-xs md:text-sm"
                      whileTap={{ scale: 0.98 }}
                    >
                      {isCloudBackupSaving ? 'Saving cloud backup...' : 'Backup to Cloud Now'}
                    </motion.button>
                    <motion.button
                      onClick={handleRestoreCloudBackup}
                      disabled={!selectedCloudBackupId || isCloudBackupRestoring || isCloudBackupsLoading || isRestoring}
                      className="flex-1 inline-flex items-center justify-center rounded-xl border border-purple-300 dark:border-purple-700 text-purple-700 dark:text-purple-300 font-semibold px-3 py-2 hover:bg-purple-50 dark:hover:bg-purple-900/30 disabled:opacity-60 text-xs md:text-sm"
                      whileTap={{ scale: 0.98 }}
                    >
                      {isCloudBackupRestoring ? 'Restoring cloud backup...' : 'Restore Selected Cloud Version'}
                    </motion.button>
                  </div>
                </motion.div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <motion.button
                    onClick={handleRestoreBackup}
                    disabled={isRestoring}
                    className="flex-1 inline-flex items-center justify-center rounded-xl bg-emerald-600 text-white font-semibold px-4 py-2.5 hover:bg-emerald-700 disabled:opacity-60"
                    whileTap={{ scale: 0.98 }}
                    animate={{ boxShadow: ['0 0 0 rgba(16,185,129,0.0)', '0 0 18px rgba(16,185,129,0.25)', '0 0 0 rgba(16,185,129,0.0)'] }}
                    transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
                  >
                    {isRestoring ? 'Restoring...' : 'Confirm Restore'}
                  </motion.button>
                  <motion.button
                    onClick={handleUndoRestore}
                    disabled={!hasRestoreSnapshot || isRestoring}
                    className="flex-1 inline-flex items-center justify-center rounded-xl border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 font-semibold px-4 py-2.5 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
                    whileTap={{ scale: 0.98 }}
                  >
                    Undo Last Restore
                  </motion.button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mobile Bottom Nav — cream pill with pink active circle */}
      {!isMenuOpen && (
      <div className="md:hidden fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] left-4 right-4 z-50">
        <nav
          className="flex justify-between items-center p-2 rounded-full"
          style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-lift)' }}
        >
          {tabsMobileBottom.map(tab => {
            const active = activeTab === tab.id;
            return (
              <motion.button
                key={tab.id}
                onClick={() => handleTabChange(tab.id as any)}
                className="relative flex-1 flex flex-col items-center justify-center py-1.5 rounded-full min-w-0"
                whileTap={{ scale: 0.9 }}
                aria-label={tab.label}
              >
                <div
                  className="w-10 h-10 sm:w-11 sm:h-11 rounded-full flex items-center justify-center transition-colors shrink-0"
                  style={{
                    backgroundColor: active ? 'var(--accent)' : 'transparent',
                    color: active ? 'var(--accent-ink)' : 'var(--ink-muted)',
                  }}
                >
                  <tab.icon className="w-5 h-5" strokeWidth={active ? 2.5 : 2} />
                </div>
              </motion.button>
            );
          })}
        </nav>
      </div>
      )}
      
      {/* Mobile Menu Overlay */}
      <AnimatePresence>
        {isMenuOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 md:hidden flex items-start justify-center px-4 pt-[calc(5rem+env(safe-area-inset-top))]"
            onClick={() => setIsMenuOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, y: -10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.98 }}
              className="w-full max-w-sm rounded-3xl border border-slate-200 dark:border-slate-700 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl shadow-2xl p-4 space-y-3"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold text-slate-900 dark:text-white">Quick Menu</h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Navigation shortcuts</p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsMenuOpen(false)}
                  className="inline-flex items-center justify-center rounded-full p-2 transition-colors hover:bg-slate-100 dark:hover:bg-white/10"
                  style={{
                    color: 'var(--ink)',
                    border: '1px solid var(--border)',
                    backgroundColor: 'color-mix(in srgb, var(--bg-elevated) 70%, transparent)',
                  }}
                  aria-label="Close menu"
                >
                  <X className="w-4 h-4" strokeWidth={2.5} color="currentColor" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {tabs.map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => {
                      handleTabChange(tab.id as any);
                      setIsMenuOpen(false);
                    }}
                    className="bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 p-3 rounded-xl flex flex-col items-center gap-2 transition-colors border border-slate-200 dark:border-slate-700"
                  >
                    <tab.icon className="w-5 h-5 text-rose-500" />
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">{tab.label}</span>
                  </button>
                ))}
              </div>

              <button
                onClick={() => {
                  handleTabChange('settings');
                  setIsMenuOpen(false);
                }}
                className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-sm font-semibold hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors flex items-center justify-center gap-2"
              >
                <SlidersHorizontal className="w-4 h-4 text-rose-500" />
                Settings & Profile
              </button>

              <button
                onClick={() => {
                  openRestoreModal();
                  setIsMenuOpen(false);
                }}
                className="w-full px-4 py-2.5 bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300 rounded-xl text-sm font-semibold hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors flex items-center justify-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                Restore Backup Data
              </button>

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => {
                    toggleTheme();
                    setIsMenuOpen(false);
                  }}
                  className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-sm font-semibold hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors flex items-center justify-center gap-2"
                >
                  {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                  Theme
                </button>

                <button
                  onClick={() => {
                    void signOut();
                    setIsMenuOpen(false);
                  }}
                  className="w-full px-4 py-2.5 bg-rose-50 dark:bg-rose-900/30 border border-rose-200 dark:border-rose-700 text-rose-700 dark:text-rose-300 rounded-xl text-sm font-semibold hover:bg-rose-100 dark:hover:bg-rose-900/40 transition-colors flex items-center justify-center gap-2"
                >
                  <LogOut className="w-4 h-4" />
                  Sign Out
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;
