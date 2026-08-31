import { useState, useEffect, useRef, useMemo, useCallback, lazy, Suspense } from 'react';
import { itineraries } from './data';
import type {
  Itinerary,
  DayPhoto,
} from './data';
import { ItineraryView } from './components/ItineraryView';
import { Draft } from './components/Handbook';
import { Budget } from './components/Budget';
import { Maps } from './components/Maps';
import { Checklist } from './components/Checklist';
import { Documents } from './components/Documents';
import { PhotoWall } from './components/PhotoWall';
import { ProfilePanel } from './components/ProfilePanel';
import { AppSettingsPanel } from './components/AppSettingsPanel';
import { AskPlanitenaryPanel } from './components/AskPlanitenaryPanel';
import { PlanTripProposalPanel } from './components/PlanTripProposalPanel';
import { TripIntelligenceUiProvider } from './lib/tripIntelligenceUi';
import { surfaceFromAppTab } from '../supabase/functions/_shared/intelligenceContext';
import { TripDashboard } from './components/TripDashboard';
import { JourneyContextBar } from './components/JourneyContextBar';
import { InstallPrompt } from './components/InstallPrompt';
import { WelcomeScreen } from './components/WelcomeScreen';
import { Auth } from './components/Auth';
import { PasswordResetScreen } from './components/PasswordResetScreen';
import { ReloadPrompt } from './components/ReloadPrompt';
import { Map, BookOpen, Calendar, Wallet, Menu, X, CheckSquare, Moon, Sun, RefreshCw, FileText, Image as ImageIcon, LayoutDashboard, UserRound, Settings, Save } from 'lucide-react';
import { motion, AnimatePresence, useScroll, useSpring } from 'framer-motion';
import { clsx } from 'clsx';
import { CustomCursor } from './components/motion/CustomCursor';
import { GrainOverlay } from './components/motion/GrainOverlay';
import { useTheme } from './contexts/ThemeContext';
import { useCurrency } from './contexts/CurrencyContext';
import { hasAuthCallbackUrl, useAuth } from './contexts/AuthContext';
import { supabase, isSupabaseConfigured } from './lib/supabase';
import { loadFromStorage, saveToStorage, writeRawToStorage, getRestorePreview, restoreSelectedTripData, createRestoreSnapshot, restoreLastSnapshot } from './lib/storageResilience';
import { saveTripBudget } from './lib/tripBudget';
import { sanitizeBudgetDocument } from '../supabase/functions/_shared/budgetDocument';
import type { RestoreDatasetId, RestoreDatasetPreview } from './lib/storageResilience';
import { getAllPhotosForItinerary, restorePhotosForItinerary } from './lib/photoStorage';
import { Marquee } from './components/ui/Marquee';
import { Pets } from './components/Pets';
import { hapticMedium } from './lib/haptics';
import { sanitizeTripProfile } from './lib/tripProfile';
import { resolveVisualIdentity } from './lib/visualIdentity';

/** Capture/QA boards are local/preview only — never free in production. */
const qaEnabled =
  import.meta.env.DEV ||
  import.meta.env.VITE_ENABLE_HANDBOOK_QA === 'true';

// Ternary keeps the dynamic imports out of production builds when qaEnabled is false.
const VisualIdentityQa = qaEnabled
  ? lazy(() =>
      import('./components/VisualIdentityQa').then((module) => ({
        default: module.VisualIdentityQa,
      })),
    )
  : null;

const HandbookCapture = qaEnabled
  ? lazy(() =>
      import('./components/HandbookCapture').then((module) => ({
        default: module.HandbookCapture,
      })),
    )
  : null;

import {
  markManualFieldEdits,
} from './lib/identityFields';
import {
  DEFAULT_MARQUEE_ITEMS,
  emptyItinerary,
  isNewerItineraryRevision,
  logItinerarySync,
  sanitizeItinerary,
} from './lib/itinerarySanitize';
import { resolveDisplayedDayBadge } from './lib/trips';
import { resolveTripCover, tripCoverSurface } from './lib/verifiedImage';
import { useTripIdentityTheme } from './hooks/useTripIdentityTheme';
import { usePullToRefresh } from './hooks/usePullToRefresh';
import { safeGetItem, safeSetItem } from './lib/safeLocalStorage';

/**
 * Short decorative travel marks for the immersive hero. These are visual
 * signatures only; the editable trip name remains the accessible headline.
 */
const immersiveTravelMarks: Record<string, string> = {
  JP: '旅',
  KR: '여행',
  CN: '旅',
  TW: '旅',
  TH: 'เที่ยว',
  VN: 'hành trình',
  IN: 'यात्रा',
  AE: 'رحلة',
  FR: 'voyage',
  ES: 'viaje',
  IT: 'viaggio',
  PT: 'viagem',
  DE: 'reise',
  GR: 'ταξίδι',
  TR: 'yolculuk',
};

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


function App() {
  const {
    user,
    isLoading,
    isDemoUser,
    isLocalTestUser,
    needsMfaVerification,
    mfaStatusReady,
    isPasswordRecovery,
  } = useAuth();
  const [selectedTripId, setSelectedTripId] = useState<string | null>(() => isDemoUser ? 'cq-cd' : null);
  const activeItineraryId = isDemoUser ? 'cq-cd' : (selectedTripId ?? 'pending-trip');
  const [activeTab, setActiveTab] = useState<'itinerary' | 'draft' | 'budget' | 'maps' | 'checklist' | 'documents' | 'photos' | 'profile' | 'settings'>('itinerary');
  const [showAccountSettings, setShowAccountSettings] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [showWelcome, setShowWelcome] = useState(() => !safeGetItem('hasVisited'));
  const [showPets, setShowPets] = useState(() => {
    const stored = safeGetItem('showPets');
    return stored !== null ? stored === 'true' : false;
  });
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
  const [isHomeHeroEditing, setIsHomeHeroEditing] = useState(false);
  const [heroDraft, setHeroDraft] = useState({
    eyebrow: '', headline: '', description: '', marqueeItems: [] as string[],
    primaryLabel: '', primaryTab: 'itinerary' as typeof activeTab,
    secondaryLabel: '', secondaryTab: 'maps' as typeof activeTab,
    coverHeadline: '', coverLabel: '', coverYear: '', dayBadge: '',
  });

  const { theme, toggleTheme } = useTheme();
  const { bindTrip, currency } = useCurrency();
  const [customItinerary, setCustomItinerary] = useState<Itinerary | null>(null);
  /**
   * Persistence must wait until the current storage key has been read. On an
   * auth transition into Demo Mode, the previous account-scoped seed can
   * otherwise be saved to the new demo key before the load effect applies the
   * profile that is already there.
   */
  const [hydratedItineraryStorageKey, setHydratedItineraryStorageKey] = useState<string | null>(null);
  useTripIdentityTheme(customItinerary?.tripProfile, theme);

  // A trip carries its own home → destination currency pair.
  const activeTripProfile = useMemo(
    () => sanitizeTripProfile(customItinerary?.tripProfile),
    [customItinerary?.tripProfile],
  );
  const visualIdentity = useMemo(
    () => (activeTripProfile ? resolveVisualIdentity(activeTripProfile, { theme }) : null),
    [activeTripProfile, theme],
  );

  // Currency edits are written back into the profile, which is the only place
  // the pair is stored. Opening a trip reads it; it never rewrites it.
  const persistTripCurrencies = useCallback(
    ({ homeCurrency, tripCurrency }: { homeCurrency: string; tripCurrency: string }) => {
      setCustomItinerary((previous) => {
        if (!previous) return previous;
        const profile = sanitizeTripProfile(previous.tripProfile);
        if (!profile) return previous;
        if (profile.homeCurrency === homeCurrency && profile.tripCurrency === tripCurrency) return previous;
        return { ...previous, tripProfile: { ...profile, homeCurrency, tripCurrency } };
      });
    },
    [],
  );

  useEffect(() => {
    if (!activeTripProfile) {
      bindTrip(null);
      return;
    }
    bindTrip({
      tripId: activeItineraryId,
      homeCurrency: activeTripProfile.homeCurrency,
      tripCurrency: activeTripProfile.tripCurrency,
      persist: persistTripCurrencies,
    });
  }, [
    activeTripProfile,
    activeItineraryId,
    bindTrip,
    persistTripCurrencies,
  ]);

  useEffect(() => {
    setSelectedTripId(isDemoUser ? 'cq-cd' : null);
    setCustomItinerary(null);
    setShowAccountSettings(false);
  }, [user?.id, isDemoUser]);

  const handleStart = () => {
    setShowWelcome(false);
    safeSetItem('hasVisited', 'true');
  };

  const togglePets = () => {
    setShowPets(prev => {
      const next = !prev;
      safeSetItem('showPets', next.toString());
      return next;
    });
  };

  const itinerarySyncReadyRef = useRef(false);
  const hasLocalItineraryRef = useRef(false);
  const remoteItineraryLoadedRef = useRef(false);
  /**
   * Mirrors `customItinerary` for the async sync callbacks. They are created by
   * an effect that does not depend on it, so their closure would otherwise hold
   * whichever itinerary existed when the subscription was opened.
   */
  const latestItineraryRef = useRef<Itinerary | null>(null);

  const demoItinerary = itineraries.find((i) => i.id === activeItineraryId) ?? itineraries[0];
  const activeItinerary = useMemo(
    () => isDemoUser ? demoItinerary : { ...emptyItinerary, id: activeItineraryId },
    [isDemoUser, demoItinerary, activeItineraryId],
  );
  const displayItinerary = customItinerary || activeItinerary;
  const displayCover = resolveTripCover(displayItinerary);
  const dayBadge = resolveDisplayedDayBadge(displayItinerary);
  const dayBadgeValue = dayBadge.value;
  const showDayBadge = dayBadge.visible || isHomeHeroEditing;
  const isImmersiveHero = visualIdentity?.intensity === 'immersive';
  const immersiveTravelMark = visualIdentity
    ? immersiveTravelMarks[visualIdentity.country.code] || visualIdentity.country.name
    : '';
  const immersiveMotif = visualIdentity?.country.motifs[0] || displayItinerary.cities[0] || 'new streets';
  const itineraryStorageKey = isDemoUser
    ? `itinerary-demo-${activeItineraryId}`
    : `itinerary-${user?.id ?? 'account'}-${activeItineraryId}`;
  const handleItineraryChange = (nextItinerary: Itinerary) => {
    setCustomItinerary((current) => {
      const next = sanitizeItinerary({
        ...nextItinerary,
        revision: Math.max(nextItinerary.revision || 0, (current?.revision || 0) + 1),
      }, activeItinerary);
      latestItineraryRef.current = next;
      logItinerarySync('local-edit', {
        applied: true,
        incomingRevision: next.revision,
        currentRevision: current?.revision,
        incomingDays: next.days.length,
        currentDays: current?.days.length,
      });
      return next;
    });
  };

  /**
   * Adopt an itinerary the server has already written.
   *
   * Deliberately not `handleItineraryChange`: that one bumps the revision for a
   * local edit, and doing so here would change the trip away from the exact
   * bytes the apply stored — the next autosave would write the altered version
   * and Undo would refuse, having been asked to restore over an itinerary it no
   * longer recognises. This is a write that already happened, so local state
   * copies it rather than re-deriving it.
   */
  const adoptWrittenItinerary = (written: Itinerary) => {
    setCustomItinerary(() => {
      latestItineraryRef.current = written;
      logItinerarySync('applied-proposal', {
        applied: true,
        incomingRevision: written.revision,
        incomingDays: written.days.length,
      });
      return written;
    });
  };

  const commitHeroText = (field: keyof Itinerary, value: string) => {
    if (!isHomeHeroEditing) return;
    const draftField = field === 'name' ? 'headline' : field === 'heroEyebrow' ? 'eyebrow' : field === 'coverHeadline' ? 'coverHeadline' : field === 'coverLabel' ? 'coverLabel' : field === 'coverYear' ? 'coverYear' : field === 'heroDayBadge' ? 'dayBadge' : field === 'description' ? 'description' : field === 'primaryButtonLabel' ? 'primaryLabel' : field === 'secondaryButtonLabel' ? 'secondaryLabel' : null;
    if (draftField) setHeroDraft((draft) => ({ ...draft, [draftField]: value }));
  };

  const commitMarqueeItem = (index: number, value: string) => {
    if (!isHomeHeroEditing) return;
    const items = [...heroDraft.marqueeItems];
    items[index] = value.trim() || items[index];
    setHeroDraft((draft) => ({ ...draft, marqueeItems: items }));
  };

  const beginHomeHeroEditing = () => {
    setHeroDraft({
      eyebrow: displayItinerary.heroEyebrow || 'A personalized travel starter',
      headline: displayItinerary.name,
      description: displayItinerary.description,
      marqueeItems: [...(displayItinerary.marqueeItems || DEFAULT_MARQUEE_ITEMS)],
      primaryLabel: displayItinerary.primaryButtonLabel || 'Open the itinerary',
      primaryTab: displayItinerary.primaryButtonTab || 'itinerary',
      secondaryLabel: displayItinerary.secondaryButtonLabel || 'See the map',
      secondaryTab: displayItinerary.secondaryButtonTab || 'maps',
      coverHeadline: displayItinerary.coverHeadline || 'Add a cover when your story takes shape.',
      coverLabel: displayItinerary.coverLabel || 'Custom cover',
      coverYear: displayItinerary.coverYear || String(new Date().getFullYear()),
      dayBadge: String(displayItinerary.days.length),
    });
    setIsHomeHeroEditing(true);
    setActiveTab('itinerary');
    window.setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 0);
  };

  const saveHomeHero = () => {
    // Only fields whose wording actually changed become "manual", so saving the
    // banner never locks copy the traveller left alone.
    const edited = markManualFieldEdits(displayItinerary, {
      name: heroDraft.headline,
      description: heroDraft.description,
      heroEyebrow: heroDraft.eyebrow,
      heroPrimaryButton: heroDraft.primaryLabel,
      heroSecondaryButton: heroDraft.secondaryLabel,
      coverHeadline: heroDraft.coverHeadline,
      coverLabel: heroDraft.coverLabel,
      coverYear: heroDraft.coverYear,
      dayBadge: heroDraft.dayBadge,
      marquee: heroDraft.marqueeItems.join('\n'),
    });
    const next = sanitizeItinerary({
      ...edited,
      primaryButtonTab: heroDraft.primaryTab,
      secondaryButtonTab: heroDraft.secondaryTab,
    }, activeItinerary);
    handleItineraryChange(next);
    setIsHomeHeroEditing(false);
  };


  const handleOpenTrip = (trip: Itinerary) => {
    setShowAccountSettings(false);
    setSelectedTripId(trip.id);
    setCustomItinerary(trip);
  };

  // Scroll-driven motion
  const { scrollYProgress: pageProgress } = useScroll();
  const scaleProgress = useSpring(pageProgress, { stiffness: 140, damping: 32, mass: 0.4 });

  // Pull-to-refresh — re-fetch itinerary from Supabase on mobile
  const { pulling, pullDistance, refreshing, progress: pullProgress } = usePullToRefresh({
    onRefresh: async () => {
      if (!isSupabaseConfigured() || isDemoUser || !user) return;
      if (!selectedTripId) return;
      const { data } = await supabase
        .from('itineraries')
        .select('data')
        .eq('user_id', user.id)
        .eq('id', activeItineraryId)
        .single();
      if (data?.data) {
        const sanitized = sanitizeItinerary(data.data, activeItinerary);
        setCustomItinerary(sanitized);
        saveToStorage(itineraryStorageKey, sanitized);
      }
    },
  });

  useEffect(() => {
    itinerarySyncReadyRef.current = false;
    remoteItineraryLoadedRef.current = false;
    hasLocalItineraryRef.current = false;
    setHydratedItineraryStorageKey(null);
    const storageKey = itineraryStorageKey;
    try {
      const preferProfileRecovery = isDemoUser
        ? (primary: Itinerary, recovery: Itinerary) =>
          !sanitizeTripProfile(primary.tripProfile) && Boolean(sanitizeTripProfile(recovery.tripProfile))
        : undefined;
      const recovered = loadFromStorage<Itinerary>(storageKey, { preferRecovery: preferProfileRecovery });
      if (recovered) {
        setCustomItinerary(sanitizeItinerary(recovered, activeItinerary));
        hasLocalItineraryRef.current = true;
      } else if (isDemoUser) {
        // Keep edits made before account-scoped storage was introduced.
        const legacyDemoData = loadFromStorage<Itinerary>(`itinerary-${activeItineraryId}`, { preferRecovery: preferProfileRecovery });
        if (legacyDemoData) {
          setCustomItinerary(sanitizeItinerary(legacyDemoData, activeItinerary));
          hasLocalItineraryRef.current = true;
        } else {
          setCustomItinerary(activeItinerary);
        }
      } else {
        setCustomItinerary(activeItinerary);
      }
    } catch (e) {
      console.error("Failed to load itinerary", e);
      setCustomItinerary(activeItinerary);
    }
    setHydratedItineraryStorageKey(storageKey);
  }, [activeItineraryId, activeItinerary, isDemoUser, itineraryStorageKey, selectedTripId]);

  useEffect(() => {
    if (!isSupabaseConfigured() || isDemoUser || !user) {
      itinerarySyncReadyRef.current = true;
      remoteItineraryLoadedRef.current = true;
      return;
    }
    if (!selectedTripId) return;
    let isMounted = true;
    itinerarySyncReadyRef.current = false;
    remoteItineraryLoadedRef.current = false;

    const fetchRemoteItinerary = async () => {
      const { data, error } = await supabase
        .from('itineraries')
        .select('data')
        .eq('user_id', user.id)
        .eq('id', activeItineraryId)
        .single();

      if (!isMounted) return;

      if (data?.data) {
        const sanitized = sanitizeItinerary(data.data, activeItinerary);
        const current = latestItineraryRef.current;
        // A fetch that resolves after a local rebuild describes an older trip,
        // and must not be allowed to undo it.
        const applied = isNewerItineraryRevision(sanitized, current);
        logItinerarySync('remote-fetch', {
          applied,
          incomingRevision: sanitized.revision,
          currentRevision: current?.revision,
          incomingDays: sanitized.days.length,
          currentDays: current?.days.length,
        });
        hasLocalItineraryRef.current = true;
        if (applied) {
          setCustomItinerary(sanitized);
          saveToStorage(itineraryStorageKey, sanitized);
        }
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
          const sanitized = sanitizeItinerary(nextData, activeItinerary);
          const current = latestItineraryRef.current;
          hasLocalItineraryRef.current = true;
          /**
           * Most of these events are the echo of this client's own debounced
           * upsert. Applying one is at best a no-op and at worst a rollback,
           * because the echo describes whatever was written 800ms ago.
           */
          const applied = isNewerItineraryRevision(sanitized, current)
            && JSON.stringify(current) !== JSON.stringify(sanitized);
          logItinerarySync('realtime-echo', {
            applied,
            incomingRevision: sanitized.revision,
            currentRevision: current?.revision,
            incomingDays: sanitized.days.length,
            currentDays: current?.days.length,
          });
          if (!applied) return;
          saveToStorage(itineraryStorageKey, sanitized);
          setCustomItinerary(sanitized);
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      channel.unsubscribe();
    };
  }, [activeItineraryId, activeItinerary, isDemoUser, itineraryStorageKey, user, selectedTripId]);

  // Keeps the mirror authoritative for writers other than handleItineraryChange.
  useEffect(() => {
    latestItineraryRef.current = customItinerary;
  }, [customItinerary]);

  useEffect(() => {
    const itineraryToSync = customItinerary;
    if (
      !itineraryToSync ||
      hydratedItineraryStorageKey !== itineraryStorageKey ||
      !itinerarySyncReadyRef.current ||
      !remoteItineraryLoadedRef.current
    ) return;

    saveToStorage(itineraryStorageKey, itineraryToSync);
    if (!hasLocalItineraryRef.current && JSON.stringify(itineraryToSync) === JSON.stringify(activeItinerary)) return;
    hasLocalItineraryRef.current = true;

    if (!isSupabaseConfigured() || isDemoUser || !user) return;

    const timeoutId = setTimeout(async () => {
      const { error } = await supabase
        .from('itineraries')
        .upsert({ id: itineraryToSync.id, user_id: user.id, data: itineraryToSync, updated_at: new Date().toISOString() });
      if (error) {
        console.error('Error syncing itinerary:', error);
        return;
      }
      const { error: registryError } = await supabase.from('trip_registry').upsert({
        id: itineraryToSync.id,
        user_id: user.id,
        title: itineraryToSync.name || 'Untitled trip',
        description: itineraryToSync.description || '',
        status: 'active',
        day_count: itineraryToSync.days.length,
        city_count: itineraryToSync.cities.length,
        cover_ref: resolveTripCover(itineraryToSync),
        updated_at: new Date().toISOString(),
      });
      if (registryError) console.error('Error syncing trip registry:', registryError);
    }, 800);

    return () => clearTimeout(timeoutId);
  }, [customItinerary, activeItinerary, hydratedItineraryStorageKey, itineraryStorageKey, isDemoUser, user]);

  useEffect(() => {
    const key = itineraryStorageKey;
    const onStorage = (event: StorageEvent) => {
      if (event.key !== key || !event.newValue) return;
      try {
        const incoming = sanitizeItinerary(JSON.parse(event.newValue), activeItinerary);
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
  }, [activeItineraryId, activeItinerary, itineraryStorageKey]);

  const handleTabChange = (newTab: typeof activeTab, targetId?: string) => {
    hapticMedium();
    setActiveTab(newTab);

    // Every handbook section follows one navigation contract. Waiting for two
    // frames lets React and AnimatePresence mount the new section before its
    // position is measured; using one smooth path in both directions avoids
    // the snap/glitch that appeared when moving between long and empty tabs.
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      const mainContent = document.getElementById('main-content');
      const header = document.querySelector('.editorial-journey-header');
      const headerHeight = header ? header.getBoundingClientRect().height : 0;
      
      const targetElement = targetId ? document.getElementById(targetId) : null;
      const targetY = targetElement
        ? Math.max(0, targetElement.getBoundingClientRect().top + window.scrollY - headerHeight - 16)
        : mainContent
          ? Math.max(0, mainContent.getBoundingClientRect().top + window.scrollY - headerHeight - 8)
        : 0;
        
      const startY = window.scrollY;
      const distance = Math.abs(targetY - startY);

      if (distance < 2) return;

      const lenis = (window as unknown as { __lenis?: { scrollTo: (y: number, o?: object) => void } }).__lenis;
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      if (lenis && typeof lenis.scrollTo === 'function') {
        lenis.scrollTo(targetY, {
          duration: reducedMotion ? 0 : 0.72,
          easing: (t: number) => 1 - Math.pow(1 - t, 4) 
        });
      } else {
        window.scrollTo({ top: targetY, behavior: reducedMotion ? 'auto' : 'smooth' });
      }
    }));
  };

  const tabs = [
    { id: 'itinerary', label: 'Itinerary', icon: Calendar },
    { id: 'maps', label: 'Maps', icon: Map },
    { id: 'draft', label: 'Draft', icon: BookOpen },
    { id: 'budget', label: 'Budget', icon: Wallet },
    { id: 'checklist', label: 'Checklist', icon: CheckSquare },
    { id: 'documents', label: 'Documents', icon: FileText },
    { id: 'photos', label: 'Photo Wall', icon: ImageIcon },
    { id: 'settings', label: 'Settings', icon: Settings },
    { id: 'profile', label: 'Profile', icon: UserRound },
  ] as const;

  /** Documents/settings/profile appear in the hamburger Quick Menu on small screens, not the bottom pill. */
  const tabsMobileBottom = tabs.filter((tab) => tab.id !== 'documents' && tab.id !== 'photos' && tab.id !== 'profile' && tab.id !== 'settings');
  const desktopTabs = tabs.filter((tab) => tab.id !== 'settings' && tab.id !== 'profile');

  const buildCloudSnapshot = async (): Promise<CloudBackupSnapshot> => {
    const itineraryData = loadFromStorage<Itinerary>(itineraryStorageKey) || customItinerary || activeItinerary;
    const budgetData = loadFromStorage<Record<string, unknown>>(`budget-${activeItineraryId}`);
    const checklistData = loadFromStorage<unknown[]>(`checklist-data-${activeItineraryId}`);
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
        itinerary: itineraryData ? sanitizeItinerary(itineraryData, activeItinerary) : null,
        budget: budgetData || null,
        checklist: checklistData || null,
        drafts: draftsData || null,
        photos: photosByDay,
      }
    };
  };

  const saveCloudBackupVersion = async () => {
    if (!isSupabaseConfigured() || !user || isDemoUser || isLocalTestUser) {
      window.alert('Cloud backup needs Supabase to be configured.');
      return false;
    }
    setIsCloudBackupSaving(true);
    try {
      const snapshot = await buildCloudSnapshot();
      const backupId = `backup-${activeItineraryId}-${Date.now()}`;
      const { error } = await supabase
        .from('itineraries')
        .upsert({ id: backupId, user_id: user.id, data: snapshot, updated_at: snapshot.createdAt });
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
    if (!isSupabaseConfigured() || !user || isDemoUser || isLocalTestUser) {
      setCloudBackups([]);
      setSelectedCloudBackupId('');
      return;
    }
    setIsCloudBackupsLoading(true);
    try {
      const { data, error } = await supabase
        .from('itineraries')
        .select('id,data,updated_at')
        .eq('user_id', user.id)
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
    const preview = await getRestorePreview(activeItineraryId);
    setRestorePreview(preview);
    setSelectedRestoreIds(preview.filter((item) => item.hasBackup).map((item) => item.id));
    setRestorePushCloud(false);
    setHasRestoreSnapshot(Boolean(safeGetItem(`restore-snapshot-${activeItineraryId}`)));
    await loadCloudBackupVersions();
    setShowRestoreModal(true);
  };

  const toggleRestoreItem = (id: RestoreDatasetId) => {
    setSelectedRestoreIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const pushRestoredDataToCloud = async (datasetIds: RestoreDatasetId[]) => {
    if (!isSupabaseConfigured() || !user || isDemoUser || isLocalTestUser) return;
    if (datasetIds.includes('itinerary')) {
      const itineraryData = loadFromStorage<Itinerary>(itineraryStorageKey);
      if (itineraryData) {
        await supabase.from('itineraries').upsert({ id: activeItineraryId, user_id: user.id, data: itineraryData, updated_at: new Date().toISOString() });
        await supabase.from('trip_registry').upsert({
          id: activeItineraryId,
          user_id: user.id,
          title: itineraryData.name || 'Untitled trip',
          description: itineraryData.description || '',
          status: 'active',
          day_count: itineraryData.days?.length || 0,
          city_count: itineraryData.cities?.length || 0,
          cover_ref: resolveTripCover(itineraryData),
          updated_at: new Date().toISOString(),
        });
      }
    }
    if (datasetIds.includes('budget')) {
      const budgetData = loadFromStorage<Record<string, unknown>>(`budget-${activeItineraryId}`);
      const sanitized = sanitizeBudgetDocument(budgetData);
      if (sanitized) {
        await saveTripBudget({ tripId: activeItineraryId, budget: sanitized, mode: 'server' });
      }
    }
    if (datasetIds.includes('checklist')) {
      const checklistData = loadFromStorage<unknown[]>(`checklist-data-${activeItineraryId}`);
      if (checklistData) {
        await supabase.from('checklists').upsert({ id: `checklist-${activeItineraryId}`, user_id: user.id, data: checklistData, updated_at: new Date().toISOString() });
      }
    }
    if (datasetIds.includes('drafts')) {
      const draftsData = loadFromStorage<unknown[]>(`drafts-${activeItineraryId}`);
      if (draftsData) {
        await supabase
          .from('itineraries')
          .upsert({ id: `drafts-${activeItineraryId}`, user_id: user.id, data: { items: draftsData }, updated_at: new Date().toISOString() });
      }
    }
  };

  const handleRestoreBackup = async () => {
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
    if (!selectedCloudBackupId) {
      window.alert('Select a cloud backup version first.');
      return;
    }
    if (!isSupabaseConfigured() || !user) {
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
        .eq('user_id', user.id)
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
        itinerary: itineraryStorageKey,
        budget: `budget-${activeItineraryId}`,
        checklist: `checklist-data-${activeItineraryId}`,
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
    const ok = await restoreLastSnapshot(activeItineraryId);
    if (!ok) {
      window.alert('No restore snapshot found yet.');
      return;
    }
    window.alert('Previous snapshot restored. Reloading now.');
    window.location.reload();
  };

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--bg)' }}><div className="animate-spin w-8 h-8 border-4 border-rose-500 border-t-transparent rounded-full" /></div>;
  }

  if (isPasswordRecovery && user) {
    return <PasswordResetScreen />;
  }

  // Real handbook surfaces for visual acceptance screenshots.
  // Enabled only in DEV or when VITE_ENABLE_HANDBOOK_QA=true (preview builds).
  // ?handbookQa=japan&intensity=balanced&view=home&theme=light
  // Production ignores these params and continues through the normal app flow.
  if (
    qaEnabled &&
    HandbookCapture &&
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).has('handbookQa')
  ) {
    return (
      <Suspense
        fallback={
          <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--bg)' }}>
            <div className="animate-spin w-8 h-8 border-4 border-rose-500 border-t-transparent rounded-full" />
          </div>
        }
      >
        <HandbookCapture />
      </Suspense>
    );
  }

  // Schematic token board (optional). Prefer handbookQa for acceptance evidence.
  if (
    qaEnabled &&
    VisualIdentityQa &&
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).has('visualQa')
  ) {
    return (
      <Suspense
        fallback={
          <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--bg)' }}>
            <div className="animate-spin w-8 h-8 border-4 border-rose-500 border-t-transparent rounded-full" />
          </div>
        }
      >
        <VisualIdentityQa
          theme={theme}
          onClose={() => {
            const url = new URL(window.location.href);
            url.searchParams.delete('visualQa');
            window.history.replaceState({}, '', url.toString());
            window.location.reload();
          }}
        />
      </Suspense>
    );
  }

  // The welcome page is the public front door. Auth owns the next step until
  // a real, local-test, or demo session is available.
  if (showWelcome && !hasAuthCallbackUrl()) {
    return <WelcomeScreen onStart={handleStart} />;
  }

  if (!user || needsMfaVerification) {
    return <Auth />;
  }

  if (isSupabaseConfigured() && !isDemoUser && !isLocalTestUser && !mfaStatusReady) {
    return <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--bg)' }}><div className="animate-spin w-8 h-8 border-4 border-rose-500 border-t-transparent rounded-full" /></div>;
  }

  if (!selectedTripId) {
    if (showAccountSettings) {
      /*
       * `journey-trips-page` carries the journey tokens. Without it this page
       * sits outside every token root and `--accent` falls back to the legacy
       * pink, so Profile settings kept rendering in the old palette while the
       * rest of the app followed the chosen one. The class injects variables
       * only — no layout of its own.
       */
      return (
        <div className="journey-trips-page min-h-screen" style={{ backgroundColor: 'var(--bg)', color: 'var(--ink)' }}>
          <header
            className="sticky top-0 z-40 backdrop-blur-md"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--bg) 85%, transparent)',
              borderBottom: '1px solid var(--border)',
              paddingTop: 'var(--app-safe-top)',
            }}
          >
            <div className="max-w-6xl mx-auto px-4 sm:px-6 md:px-10 py-3 md:py-4 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setShowAccountSettings(false)}
                className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-full text-xs font-semibold"
                style={{ color: 'var(--ink)', border: '1px solid var(--border)' }}
                aria-label="Back to trips"
              >
                <LayoutDashboard className="w-3.5 h-3.5" />
                <span>All trips</span>
              </button>
              <span className="font-display text-xl sm:text-2xl leading-none tracking-tight" style={{ color: 'var(--ink)' }}>
                Profile <span className="font-display-italic" style={{ color: 'var(--accent)' }}>settings</span>
              </span>
              <span className="w-10" aria-hidden="true" />
            </div>
          </header>
          <div className="max-w-6xl mx-auto px-4 sm:px-6 md:px-10 py-8 md:py-12">
            <ProfilePanel />
          </div>
        </div>
      );
    }

    return (
      <TripDashboard
        onOpenTrip={handleOpenTrip}
        onOpenProfile={() => setShowAccountSettings(true)}
      />
    );
  }

  return (
    <TripIntelligenceUiProvider key={activeItineraryId} tripId={activeItineraryId} surface={surfaceFromAppTab(activeTab)} selectedCurrency={currency}>
    <div
      className="adaptive-handbook-root editorial-journey-shell min-h-screen font-sans pb-24 md:pb-0 overflow-x-clip"
      data-adaptive-handbook="true"
      style={{ backgroundColor: 'var(--bg)', color: 'var(--ink)' }}
    >

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
      <GrainOverlay />
      <CustomCursor />

      {/* Global Overlays */}
      <InstallPrompt />
      <ReloadPrompt />
      {showPets && <Pets />}
      {/* Top Nav — editorial minimal */}
      <header
        className="editorial-journey-header sticky top-0 z-40 backdrop-blur-md"
        style={{
          backgroundColor: 'color-mix(in srgb, var(--bg) 85%, transparent)',
          borderBottom: '1px solid var(--border)',
          paddingTop: 'var(--app-safe-top)',
          willChange: 'transform',
        }}
      >
        {/*
          Wider than the page content at 2xl only, which is where the action
          buttons reveal their labels. The header is a utility bar rather than
          reading content, and the extra 96px is what lets all seven tabs stay
          visible instead of scrolling once those labels appear.
        */}
        <div className="app-header-inner max-w-7xl 2xl:max-w-[92rem] mx-auto px-4 sm:px-6 md:px-10 py-3 md:py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 shrink min-w-0">
            {!isDemoUser && (
              <button
                onClick={() => { setSelectedTripId(null); setCustomItinerary(null); }}
                className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-full text-xs font-semibold shrink-0"
                style={{ color: 'var(--ink)', border: '1px solid var(--border)' }}
                aria-label="Back to trips"
              >
                <LayoutDashboard className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">All trips</span>
              </button>
            )}
            <span className="app-brand font-display text-xl sm:text-2xl md:text-3xl leading-none tracking-tight" style={{ color: 'var(--ink)' }}>
              Planitenary
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
            className="app-primary-nav hidden xl:flex items-center gap-1"
          >
            {desktopTabs.map(tab => (
              <motion.button
                key={tab.id}
                variants={{
                  hidden: { opacity: 0, y: -10 },
                  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] } }
                }}
                onClick={() => handleTabChange(tab.id)}
                className="relative shrink-0 whitespace-nowrap px-3 py-2 text-sm font-semibold tracking-tight transition-colors"
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

          {/*
            `relative z-10` keeps the actions above the tab strip. The tabs are
            positioned for their active underline, so without this they paint
            over these controls the moment the header is tight — which is how a
            click on "Plan my trip" ended up hitting a tab instead.
          */}
          <div className="relative z-10 flex items-center gap-2 shrink-0">
            {/*
              One segmented control rather than a row of identical pills, so the
              two things a traveller actually came for — plan, and ask — read as
              the actions and everything else reads as settings.

              Restore, app settings and profile only appear from `xl`, which is
              exactly where the menu button disappears. Below that they are all
              reachable from Quick Menu, and duplicating them in the bar was what
              squeezed the trip name into three wrapped lines on a phone.
            */}
            <div className="app-utility-cluster">
              <motion.button
                onClick={toggleTheme}
                className="hidden sm:inline-flex"
                style={{ color: 'var(--ink)' }}
                aria-label="Toggle theme"
                whileTap={{ scale: 0.9, rotate: -12 }}
              >
                {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </motion.button>
              <motion.button
                onClick={openRestoreModal}
                className="hidden xl:inline-flex"
                style={{ color: 'var(--ink)' }}
                whileTap={{ scale: 0.95 }}
                aria-label="Restore backup"
                title="Restore backup"
              >
                <RefreshCw className="w-4 h-4" />
              </motion.button>
              <motion.button
                onClick={() => handleTabChange('settings')}
                className="hidden xl:inline-flex"
                style={{ color: activeTab === 'settings' ? 'var(--accent)' : 'var(--ink)' }}
                whileTap={{ scale: 0.9 }}
                aria-label="Open app settings"
                title="App settings"
              >
                <Settings className="w-4 h-4" />
              </motion.button>
              <motion.button
                onClick={() => handleTabChange('profile')}
                className="hidden xl:inline-flex"
                style={{ color: activeTab === 'profile' ? 'var(--accent)' : 'var(--ink)' }}
                whileTap={{ scale: 0.9 }}
                aria-label="Open profile settings"
                title="Profile settings"
              >
                <UserRound className="w-4 h-4" />
              </motion.button>
              <motion.button
                className="inline-flex xl:hidden"
                style={{ color: 'var(--ink)' }}
                onClick={() => setIsMenuOpen(!isMenuOpen)}
                whileTap={{ scale: 0.9 }}
                aria-label="Menu"
                aria-expanded={isMenuOpen}
              >
                {/*
                  Stays the menu icon while open. The panel carries its own
                  close button a few pixels below this one, and swapping this to
                  an X put two identical X's in the same corner. Tapping here
                  still closes the menu; `aria-expanded` carries the state.
                */}
                <Menu className="w-4 h-4" />
              </motion.button>
            </div>
          </div>
        </div>
      </header>

      {/*
        The dock is fixed at z-60 and the Quick Menu overlay sits at z-40, so
        the two action buttons painted straight over the open menu. The menu is
        the layer that should cover them — and the mobile nav pill below already
        steps aside the same way while it is open.
      */}
      {!isDemoUser && !isLocalTestUser && user && !isMenuOpen && (
        <div className="journey-action-dock">
          <PlanTripProposalPanel
            tripId={activeItineraryId}
            tripName={displayItinerary.name}
            itinerary={customItinerary || activeItinerary}
            onApplied={adoptWrittenItinerary}
            onNavigate={(tab) => handleTabChange(tab)}
          />
          <AskPlanitenaryPanel tripId={activeItineraryId} tripName={displayItinerary.name} itinerary={displayItinerary} />
        </div>
      )}

      {/* Hero — split editorial layout */}
      {activeTab === 'itinerary' && <JourneyContextBar itinerary={displayItinerary} />}

      <section
        className="handbook-home-hero max-w-7xl mx-auto px-4 sm:px-6 md:px-10 pt-10 md:pt-20 pb-8 md:pb-16"
        data-immersive={isImmersiveHero ? 'true' : undefined}
      >
        {isHomeHeroEditing && (
          <div className="flex justify-end gap-2 mb-5">
            <button type="button" onClick={() => setIsHomeHeroEditing(false)} className="pill-btn pill-ghost">Cancel</button>
            <button type="button" onClick={saveHomeHero} className="pill-btn pill-primary"><Save className="w-4 h-4" /> Save banner</button>
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-10 md:gap-12 items-center">
          {/* Left copy */}
          <div className="md:col-span-7 relative">
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}>
              <span
                className="eyebrow cursor-text rounded px-1 outline-none focus:bg-white/10"
                contentEditable={isHomeHeroEditing}
                suppressContentEditableWarning
                onBlur={(event) => commitHeroText('heroEyebrow', event.currentTarget.textContent || '')}
                title="Click to edit"
              >{displayItinerary.heroEyebrow || 'A personalized travel starter'}</span>
            </motion.div>
            {isImmersiveHero && visualIdentity && (
              <motion.div
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.08, duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
                className="handbook-hero-immersive-signature"
                aria-hidden="true"
              >
                <span className="handbook-hero-immersive-index">01</span>
                <span className="handbook-hero-immersive-rule" />
                <span className="handbook-hero-immersive-mark">{immersiveTravelMark}</span>
                <span className="handbook-hero-immersive-meta">
                  {visualIdentity.country.name}
                  <span aria-hidden="true"> / </span>
                  {immersiveMotif}
                </span>
              </motion.div>
            )}
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
              className="handbook-home-hero-title handbook-hero-title mt-6 font-display handbook-display text-5xl sm:text-6xl md:text-[5.5rem] lg:text-[6.5rem] leading-[0.95] tracking-tight"
              data-immersive={isImmersiveHero ? 'true' : undefined}
              data-recipe={isImmersiveHero ? visualIdentity?.recipe.id : undefined}
              data-mark-length={isImmersiveHero ? (immersiveTravelMark.length > 2 ? 'long' : 'short') : undefined}
              style={{ color: 'var(--ink)' }}
            >
              {isImmersiveHero && (
                <span className="handbook-hero-title-mark" aria-hidden="true">{immersiveTravelMark}</span>
              )}
              <span
                contentEditable={isHomeHeroEditing}
                suppressContentEditableWarning
                className="relative z-[1] cursor-text rounded px-1 outline-none focus:bg-white/10"
                onBlur={(event) => commitHeroText('name', event.currentTarget.textContent || '')}
                title="Click to edit"
              >{displayItinerary.name || 'Your next trip'}</span>
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
              className="mt-6 max-w-xl text-base md:text-lg leading-relaxed"
              style={{ color: 'var(--ink-muted)' }}
            >
              <span
                contentEditable={isHomeHeroEditing}
                suppressContentEditableWarning
                className="cursor-text rounded px-1 outline-none focus:bg-white/10"
                onBlur={(event) => commitHeroText('description', event.currentTarget.textContent || '')}
                title="Click to edit"
              >{displayItinerary.description}</span>
            </motion.p>
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
              className="mt-8 flex flex-wrap items-center gap-3"
            >
              <button
                onClick={() => handleTabChange(displayItinerary.primaryButtonTab || 'itinerary', 'itinerary-first-day')}
                className="pill-btn pill-primary accent-button"
                style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-ink)' }}
              >
                <span
                  contentEditable={isHomeHeroEditing}
                  suppressContentEditableWarning
                  className="cursor-text rounded px-1 outline-none focus:bg-black/10"
                  onClick={(event) => {
                    if (isHomeHeroEditing) event.stopPropagation();
                  }}
                  onBlur={(event) => commitHeroText('primaryButtonLabel', event.currentTarget.textContent || '')}
                  title="Click text to edit"
                >{displayItinerary.primaryButtonLabel || 'Open the itinerary'}</span>
              </button>
              <button onClick={() => handleTabChange(displayItinerary.secondaryButtonTab || 'maps')} className="pill-btn pill-ghost">
                <span
                  contentEditable={isHomeHeroEditing}
                  suppressContentEditableWarning
                  className="cursor-text rounded px-1 outline-none focus:bg-white/10"
                  onClick={(event) => {
                    if (isHomeHeroEditing) event.stopPropagation();
                  }}
                  onBlur={(event) => commitHeroText('secondaryButtonLabel', event.currentTarget.textContent || '')}
                  title="Click text to edit"
                >{displayItinerary.secondaryButtonLabel || 'See the map'}</span>
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
              className="editorial-card p-3 md:p-4 rotate-[-2deg] relative overflow-hidden"
              style={{ backgroundColor: 'var(--bg-elevated)' }}
              data-cover-layout={visualIdentity?.coverLayout || 'journal'}
            >
              <div
                className="handbook-motif"
                data-motif={visualIdentity?.motifSet && visualIdentity.motifSet !== 'none' ? visualIdentity.motifSet : undefined}
                aria-hidden="true"
              />
              <div
                className="relative overflow-hidden handbook-cover-frame z-[1]"
                data-cover-layout={visualIdentity?.coverLayout || 'journal'}
              >
                {displayItinerary.cities.length > 0 && displayCover.asset ? (
                  <div className="relative h-[280px] md:h-[420px]">
                    <img
                      src={displayCover.asset.url}
                      alt={`${displayCover.city || displayItinerary.cities[0]} trip cover`}
                      className="h-full w-full object-cover"
                    />
                    <a
                      href={displayCover.asset.sourcePageUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="absolute inset-x-0 bottom-0 bg-slate-950/75 px-3 py-2 text-[10px] leading-tight text-white underline-offset-2 hover:underline"
                    >
                      {displayCover.asset.attribution} · {displayCover.asset.license}
                    </a>
                  </div>
                ) : displayItinerary.cities.length > 0 ? (
                  <div
                    className="flex h-[280px] items-end px-7 py-8 md:h-[420px] md:px-10 md:py-11"
                    style={tripCoverSurface(displayItinerary.id, displayCover.city || displayItinerary.cities[0])}
                  >
                    <span className="font-display text-5xl leading-none md:text-7xl">
                      {displayCover.city || displayItinerary.cities[0]}
                    </span>
                  </div>
                ) : (
                  <div className="w-full h-[280px] md:h-[420px] flex items-center justify-center text-center px-8" style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--ink-muted)' }}>
                    <span
                      className="font-display-italic text-3xl cursor-text rounded px-1 outline-none focus:bg-white/10"
                      contentEditable={isHomeHeroEditing}
                      suppressContentEditableWarning
                      onBlur={(event) => commitHeroText('coverHeadline', event.currentTarget.textContent || '')}
                      title="Click to edit"
                    >{displayItinerary.coverHeadline || 'Add a cover when your story takes shape.'}</span>
                  </div>
                )}
              </div>
              <div className="relative z-[2] flex items-center justify-between px-2 pt-3 pb-1">
                <span className="font-display-italic text-lg" style={{ color: 'var(--ink)' }}>
                  <span
                    contentEditable={isHomeHeroEditing}
                    suppressContentEditableWarning
                    className="cursor-text rounded px-1 outline-none focus:bg-white/10"
                    onBlur={(event) => commitHeroText('coverLabel', event.currentTarget.textContent || '')}
                    title="Click to edit"
                  >{displayItinerary.coverLabel || displayItinerary.cities.join(' · ')}</span>
                </span>
                <span className="text-xs font-semibold tracking-widest uppercase" style={{ color: 'var(--ink-muted)' }}>
                  <span
                    contentEditable={isHomeHeroEditing}
                    suppressContentEditableWarning
                    className="cursor-text rounded px-1 outline-none focus:bg-white/10"
                    onBlur={(event) => commitHeroText('coverYear', event.currentTarget.textContent || '')}
                    title="Click to edit"
                  >{displayItinerary.coverYear || new Date().getFullYear()}</span>
                </span>
              </div>
            </div>
            {/* Sticker badge — hidden until the trip has a duration */}
            {showDayBadge && (
              <motion.div
                initial={{ scale: 0, rotate: -10 }}
                animate={{ scale: 1, rotate: 8 }}
                transition={{ delay: 0.5, type: 'spring', stiffness: 180, damping: 12 }}
                className="absolute -top-6 -right-4 md:-top-8 md:-right-6 w-24 h-24 md:w-32 md:h-32 rounded-full flex flex-col items-center justify-center text-center shadow-xl"
                style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-ink)' }}
              >
                <span
                  className="font-display text-3xl md:text-4xl leading-none cursor-text rounded px-1 outline-none focus:bg-black/10"
                  contentEditable={isHomeHeroEditing}
                  suppressContentEditableWarning
                  onBlur={(event) => commitHeroText('heroDayBadge', event.currentTarget.textContent || '')}
                  title={isHomeHeroEditing ? 'Click to edit' : undefined}
                >{dayBadgeValue || '—'}</span>
                <span className="text-[10px] font-bold uppercase tracking-widest mt-1">{dayBadge.unit || displayItinerary.heroDayBadgeUnit || 'days'}</span>
              </motion.div>
            )}
          </motion.div>
        </div>
      </section>

      {/* Marquee strip */}
      <Marquee
        items={displayItinerary.marqueeItems?.length ? displayItinerary.marqueeItems : DEFAULT_MARQUEE_ITEMS}
        onItemChange={isHomeHeroEditing ? (index, value) => commitMarqueeItem(index, value) : undefined}
      />

      {/* Main Content Area */}
      <main id="main-content" data-adaptive-handbook-content="true" className="max-w-7xl mx-auto px-4 md:px-10 pt-8 md:pt-14 pb-24 md:pb-20 relative z-10">
        
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
                itinerary={customItinerary || activeItinerary} 
                onItineraryChange={handleItineraryChange}
                // Adding a destination changes the shape of the trip, so the
                // day header hands that decision to the settings screen that
                // already owns it rather than answering it in a dropdown.
                onOpenTripSettings={() => setActiveTab('settings')}
                planChanges={!isDemoUser && !isLocalTestUser && user
                  ? { tripId: activeItineraryId, tripName: displayItinerary.name }
                  : undefined}
              />
            )}
            {activeTab === 'maps' && <Maps itinerary={customItinerary || activeItinerary} onItineraryChange={handleItineraryChange} />}
            {activeTab === 'draft' && (
              <Draft
                itinerary={customItinerary || activeItinerary}
                onItineraryChange={handleItineraryChange}
              />
            )}
            {activeTab === 'budget' && <Budget itinerary={customItinerary || activeItinerary} />}
            {activeTab === 'checklist' && <Checklist itineraryId={activeItineraryId} />}
            {activeTab === 'documents' && <Documents itineraryId={activeItineraryId} />}
            {activeTab === 'photos' && <PhotoWall itinerary={customItinerary || activeItinerary} />}
            {activeTab === 'settings' && (
              <AppSettingsPanel
                showPets={showPets}
                onTogglePets={togglePets}
                itinerary={customItinerary || activeItinerary}
                onItineraryChange={handleItineraryChange}
              />
            )}
            {activeTab === 'profile' && <ProfilePanel onEditHomeHero={beginHomeHeroEditing} />}
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
      <div className="md:hidden fixed bottom-[calc(1rem+var(--app-safe-bottom))] left-4 right-4 z-50">
        <nav
          className="flex justify-between items-center p-2 rounded-full"
          style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-lift)' }}
        >
          {tabsMobileBottom.map(tab => {
            const active = activeTab === tab.id;
            return (
              <motion.button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
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
            className="fixed inset-0 z-40 xl:hidden flex items-start justify-center px-4 pt-[calc(5rem+var(--app-safe-top))]"
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
                      handleTabChange(tab.id);
                      setIsMenuOpen(false);
                    }}
                    className="bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 p-3 rounded-xl flex flex-col items-center gap-2 transition-colors border border-slate-200 dark:border-slate-700"
                  >
                    <tab.icon className="w-5 h-5 text-rose-500" />
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">{tab.label}</span>
                  </button>
                ))}
              </div>

              {/* The header hides the theme toggle on phones, so it lives here. */}
              <button
                onClick={toggleTheme}
                className="w-full px-4 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 border transition-colors"
                style={{ color: 'var(--ink)', borderColor: 'var(--border)' }}
              >
                {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                {theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
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
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
    </TripIntelligenceUiProvider>
  );
}

export default App;
