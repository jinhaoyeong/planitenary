import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { itineraries } from './data';
import type {
  Itinerary,
  DayPhoto,
  Activity,
  ActivityType,
  ActivitySource,
  ActivityCost,
  ActivityGeneratedMetadata,
  BookingStatus,
  DayPlan,
  PlanningConstraints,
  PlannerChangeRecord,
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
import { TripDashboard } from './components/TripDashboard';
import { InstallPrompt } from './components/InstallPrompt';
import { WelcomeScreen } from './components/WelcomeScreen';
import { Auth } from './components/Auth';
import { PasswordResetScreen } from './components/PasswordResetScreen';
import { ReloadPrompt } from './components/ReloadPrompt';
import { Map, BookOpen, Calendar, Wallet, Menu, X, CheckSquare, Moon, Sun, RefreshCw, FileText, Image as ImageIcon, LayoutDashboard, UserRound, Settings, Save } from 'lucide-react';
import { motion, AnimatePresence, animate, useScroll, useSpring } from 'framer-motion';
import { clsx } from 'clsx';
import { CustomCursor } from './components/motion/CustomCursor';
import { GrainOverlay } from './components/motion/GrainOverlay';
import { useTheme } from './contexts/ThemeContext';
import { useCurrency } from './contexts/CurrencyContext';
import { hasAuthCallbackUrl, useAuth } from './contexts/AuthContext';
import { supabase, isSupabaseConfigured } from './lib/supabase';
import { loadFromStorage, saveToStorage, writeRawToStorage, getRestorePreview, restoreSelectedTripData, createRestoreSnapshot, restoreLastSnapshot } from './lib/storageResilience';
import type { RestoreDatasetId, RestoreDatasetPreview } from './lib/storageResilience';
import { getAllPhotosForItinerary, restorePhotosForItinerary } from './lib/photoStorage';
import { Marquee } from './components/ui/Marquee';
import { Pets } from './components/Pets';
import { hapticMedium } from './lib/haptics';
import { sanitizeTripProfile } from './lib/tripProfile';
import { markManualFieldEdits, sanitizeFieldSources } from './lib/identityFields';
import { resolveDisplayedDayBadge } from './lib/trips';
import { useTripIdentityTheme } from './hooks/useTripIdentityTheme';
import { usePullToRefresh } from './hooks/usePullToRefresh';
import cqCdHero from './assets/6-DayIn-DepthPureTourofChongqingChengdu.jpg';
import defaultTravelHero from './assets/default-travel-hero.jpg';

const heroImages = {
  'cq-cd': cqCdHero
};

// Regular accounts start from a genuinely blank handbook. Demo Mode alone
// receives the rich sample itinerary from data.ts.
const emptyItinerary: Itinerary = {
  id: 'pending-trip',
  name: 'New Trip',
  cities: [],
  description: 'Start with a blank travel handbook and shape every day your way.',
  marqueeItems: ['Travel Handbook', 'Plans', 'Notes', 'Maps', 'Photos'],
  heroEyebrow: 'A personalized travel starter',
  primaryButtonLabel: 'Open the itinerary',
  primaryButtonTab: 'itinerary',
  secondaryButtonLabel: 'See the map',
  secondaryButtonTab: 'maps',
  coverHeadline: 'Add a cover when your story takes shape.',
  coverLabel: 'Custom cover',
  coverYear: String(new Date().getFullYear()),
  days: [],
};

const DEFAULT_MARQUEE_ITEMS = ['Travel Handbook', 'Plans', 'Notes', 'Maps', 'Photos'];
const VALID_HOME_TABS = ['itinerary', 'maps', 'draft', 'budget', 'checklist', 'documents', 'photos', 'profile', 'settings'] as const;

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

const VALID_ACTIVITY_TYPES: ActivityType[] = ['food', 'sight', 'culture', 'walk', 'nature', 'travel', 'flight', 'cafe', 'shop', 'nightlife', 'other'];
const VALID_ACTIVITY_SOURCES: ActivitySource[] = ['manual', 'generated', 'imported'];
const VALID_BOOKING_STATUSES: BookingStatus[] = ['none', 'requested', 'confirmed', 'cancelled'];

const legacyActivityId = (name: string, time: string, location: string, index: number) => {
  const seed = `${name}-${time}-${location}-${index}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `activity-legacy-${seed || index}`;
};

const normalizeStoredTime = (value: unknown, fallback = '09:00') => {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return fallback;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (Number.isNaN(hours) || Number.isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return fallback;
  }
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
};

const sanitizeActivity = (value: unknown, fallback: Activity, index = 0): Activity => {
  const source = value && typeof value === 'object' ? value as Partial<Activity> : {};
  const type = typeof source.type === 'string' && VALID_ACTIVITY_TYPES.includes(source.type as ActivityType)
    ? source.type as ActivityType
    : fallback.type;
  const coordinates = Array.isArray(source.coordinates)
    && source.coordinates.length === 2
    && source.coordinates.every((coord) => typeof coord === 'number' && Number.isFinite(coord))
      ? [source.coordinates[0], source.coordinates[1]] as [number, number]
      : undefined;
  const rating = typeof source.rating === 'number' && Number.isFinite(source.rating)
    ? Math.max(0, Math.min(10, Math.round(source.rating)))
    : undefined;
  const name = typeof source.name === 'string' && source.name.trim() ? source.name.trim() : fallback.name;
  const time = normalizeStoredTime(source.time, fallback.time);
  const location = typeof source.location === 'string' ? source.location : undefined;
  const estimatedCost = source.estimatedCost && typeof source.estimatedCost === 'object'
    ? (() => {
        const raw = source.estimatedCost as unknown as Record<string, unknown>;
        if (typeof raw.amount !== 'number' || !Number.isFinite(raw.amount) || typeof raw.currency !== 'string' || !raw.currency.trim()) return undefined;
        const basis: ActivityCost['basis'] = raw.basis === 'per-person' || raw.basis === 'per-group' || raw.basis === 'fixed' || raw.basis === 'unknown'
          ? raw.basis
          : undefined;
        return { amount: Math.max(0, raw.amount), currency: raw.currency.trim().toUpperCase(), basis };
      })()
    : undefined;
  const openingHours = source.openingHours && typeof source.openingHours === 'object'
    ? (() => {
        const raw = source.openingHours as unknown as Record<string, unknown>;
        const days = Array.isArray(raw.days) ? raw.days.filter((day): day is number => typeof day === 'number' && Number.isInteger(day) && day >= 0 && day <= 6) : undefined;
        return {
          label: typeof raw.label === 'string' ? raw.label.trim() : undefined,
          opensAt: typeof raw.opensAt === 'string' ? raw.opensAt.trim() : undefined,
          closesAt: typeof raw.closesAt === 'string' ? raw.closesAt.trim() : undefined,
          days,
          sourceUpdatedAt: typeof raw.sourceUpdatedAt === 'string' ? raw.sourceUpdatedAt : undefined,
        };
      })()
    : undefined;
  const sourceValue = typeof source.source === 'string' && VALID_ACTIVITY_SOURCES.includes(source.source as ActivitySource)
    ? source.source as ActivitySource
    : 'manual';
  const bookingStatus = typeof source.bookingStatus === 'string' && VALID_BOOKING_STATUSES.includes(source.bookingStatus as BookingStatus)
    ? source.bookingStatus as BookingStatus
    : 'none';
  const lockedFields = Array.isArray(source.lockedFields)
    ? Array.from(new Set(source.lockedFields.filter((field): field is string => typeof field === 'string' && field.trim().length > 0).map((field) => field.trim())))
    : [];
  const generatedMetadata = source.generatedMetadata && typeof source.generatedMetadata === 'object'
    ? (() => {
        const raw = source.generatedMetadata as unknown as Record<string, unknown>;
        const generatedSource = typeof raw.source === 'string' && VALID_ACTIVITY_SOURCES.includes(raw.source as ActivitySource)
          ? raw.source as ActivitySource
          : sourceValue;
        const confidence: ActivityGeneratedMetadata['confidence'] = raw.confidence === 'high' || raw.confidence === 'medium' || raw.confidence === 'low'
          ? raw.confidence
          : undefined;
        return {
          source: generatedSource,
          generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt : new Date(0).toISOString(),
          reason: typeof raw.reason === 'string' ? raw.reason : undefined,
          confidence,
          profileRevision: typeof raw.profileRevision === 'string' ? raw.profileRevision : undefined,
        };
      })()
    : undefined;
  const moodVotes = source.moodVotes && typeof source.moodVotes === 'object'
    ? (() => {
        const raw = source.moodVotes as Record<string, unknown>;
        const reaction = (value: unknown) =>
          typeof value === 'string' ? value as NonNullable<Activity['moodVotes']>['self'] : undefined;
        const self = reaction(raw.self ?? raw.ahhao);
        const partner = reaction(raw.partner ?? raw.belle);
        const comment = typeof raw.comment === 'string' && raw.comment.trim() ? raw.comment.trim() : undefined;
        const rawCommentBy = raw.commentBy;
        const commentBy =
          rawCommentBy === 'partner' || rawCommentBy === 'belle'
            ? 'partner' as const
            : rawCommentBy === 'self' || rawCommentBy === 'ahhao'
              ? 'self' as const
              : undefined;
        return { self, partner, comment, commentBy };
      })()
    : undefined;
  const voiceNote = source.voiceNote
    && typeof source.voiceNote === 'object'
    && typeof source.voiceNote.dataUrl === 'string'
    && source.voiceNote.dataUrl
    && typeof source.voiceNote.durationSec === 'number'
    && Number.isFinite(source.voiceNote.durationSec)
    && typeof source.voiceNote.createdAt === 'string'
      ? {
          dataUrl: source.voiceNote.dataUrl,
          durationSec: Math.max(1, Math.min(300, Math.round(source.voiceNote.durationSec))),
          createdAt: source.voiceNote.createdAt,
        }
      : undefined;

  return {
    id: typeof source.id === 'string' && source.id.trim() ? source.id.trim() : legacyActivityId(name, time, location || '', index),
    time,
    durationMinutes: typeof source.durationMinutes === 'number' && Number.isFinite(source.durationMinutes)
      ? Math.max(5, Math.min(1440, Math.round(source.durationMinutes)))
      : undefined,
    name,
    description: typeof source.description === 'string' ? source.description : fallback.description,
    type,
    location,
    cost: typeof source.cost === 'string' ? source.cost : undefined,
    estimatedCost,
    bookingStatus,
    openingHours,
    transportMinutes: typeof source.transportMinutes === 'number' && Number.isFinite(source.transportMinutes)
      ? Math.max(0, Math.min(1440, Math.round(source.transportMinutes)))
      : undefined,
    transportMode: typeof source.transportMode === 'string' ? source.transportMode.trim() : undefined,
    source: sourceValue,
    lockedFields,
    generatedMetadata,
    rating,
    coordinates,
    moodVotes,
    voiceNote,
  };
};

const blankDay = (index: number): DayPlan => ({
  day: index + 1,
  date: `Day ${index + 1}`,
  city: '',
  title: `Day ${index + 1}`,
  activities: [],
});

const sanitizeDay = (value: unknown, fallbackDay: DayPlan | undefined, index: number): DayPlan => {
  const source = value && typeof value === 'object' ? value as Partial<DayPlan> : {};
  // Generated trips have more days than the blank template they sanitize against.
  const fallback = fallbackDay ?? blankDay(index);
  const activityFallbacks = fallback.activities.length > 0
    ? fallback.activities
    : [{ time: '09:00', name: 'Untitled activity', description: '', type: 'other' as ActivityType }];
  // An explicitly empty day is valid (generated trip skeletons start blank).
  const sourceActivities = Array.isArray(source.activities) ? source.activities : activityFallbacks;

  return {
    day: index + 1,
    date: typeof source.date === 'string' && source.date.trim() ? source.date : fallback.date,
    city: typeof source.city === 'string' && source.city.trim() ? source.city : fallback.city,
    title: typeof source.title === 'string' && source.title.trim() ? source.title : fallback.title,
    activities: sourceActivities.map((activity, activityIndex) =>
      sanitizeActivity(activity, activityFallbacks[activityIndex] || activityFallbacks[activityFallbacks.length - 1], activityIndex)
    ),
    photos: Array.isArray(source.photos) ? source.photos : fallback.photos,
  };
};

const sanitizePlanningConstraints = (value: unknown): PlanningConstraints | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const source = value as Partial<PlanningConstraints>;
  const coordinatePair = (candidate: unknown): [number, number] | undefined =>
    Array.isArray(candidate) && candidate.length === 2 && candidate.every((item) => typeof item === 'number' && Number.isFinite(item))
      ? [candidate[0], candidate[1]]
      : undefined;
  return {
    preferredStartTime: typeof source.preferredStartTime === 'string' ? source.preferredStartTime : undefined,
    preferredEndTime: typeof source.preferredEndTime === 'string' ? source.preferredEndTime : undefined,
    maxMainActivitiesPerDay: typeof source.maxMainActivitiesPerDay === 'number' ? Math.max(1, Math.min(12, Math.round(source.maxMainActivitiesPerDay))) : undefined,
    includeMealBreaks: typeof source.includeMealBreaks === 'boolean' ? source.includeMealBreaks : undefined,
    includeRestBreaks: typeof source.includeRestBreaks === 'boolean' ? source.includeRestBreaks : undefined,
    accommodationLocation: typeof source.accommodationLocation === 'string' ? source.accommodationLocation : undefined,
    accommodationCoordinates: coordinatePair(source.accommodationCoordinates),
    mustDoActivityIds: Array.isArray(source.mustDoActivityIds) ? source.mustDoActivityIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0) : undefined,
    unavailableTimes: Array.isArray(source.unavailableTimes)
      ? source.unavailableTimes.filter((entry): entry is NonNullable<PlanningConstraints['unavailableTimes']>[number] => Boolean(entry && typeof entry === 'object' && typeof entry.start === 'string' && typeof entry.end === 'string'))
      : undefined,
  };
};

const sanitizePlannerHistory = (value: unknown): PlannerChangeRecord[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  return value.slice(-10).filter((entry): entry is PlannerChangeRecord => Boolean(entry && typeof entry === 'object' && typeof (entry as PlannerChangeRecord).id === 'string' && Array.isArray((entry as PlannerChangeRecord).beforeDays) && Array.isArray((entry as PlannerChangeRecord).afterDays))).map((entry) => ({
    ...entry,
    affectedDayNumbers: Array.isArray(entry.affectedDayNumbers) ? entry.affectedDayNumbers : [],
  }));
};

const sanitizeItinerary = (value: unknown, fallback: Itinerary): Itinerary => {
  const source = value && typeof value === 'object' ? value as Partial<Itinerary> : {};
  const sourceDays = Array.isArray(source.days) && source.days.length > 0 ? source.days : fallback.days;
  const sanitizedDays = sourceDays.map((day, index) => sanitizeDay(day, fallback.days[index] || fallback.days[fallback.days.length - 1], index));
  const sanitizedCities = Array.isArray(source.cities)
    ? source.cities.filter((city): city is string => typeof city === 'string' && city.trim().length > 0)
    : [];
  const sanitizedMarqueeItems = Array.isArray(source.marqueeItems)
    ? Array.from(new Set(source.marqueeItems.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())))
    : undefined;
  const primaryButtonTab = typeof source.primaryButtonTab === 'string' && VALID_HOME_TABS.includes(source.primaryButtonTab as typeof VALID_HOME_TABS[number])
    ? source.primaryButtonTab as typeof VALID_HOME_TABS[number]
    : fallback.primaryButtonTab || 'itinerary';
  const secondaryButtonTab = typeof source.secondaryButtonTab === 'string' && VALID_HOME_TABS.includes(source.secondaryButtonTab as typeof VALID_HOME_TABS[number])
    ? source.secondaryButtonTab as typeof VALID_HOME_TABS[number]
    : fallback.secondaryButtonTab || 'maps';

  const optionalText = (value: unknown, fallbackValue?: string) =>
    typeof value === 'string' && value.trim() ? value.trim() : fallbackValue;

  return {
    id: fallback.id,
    tripProfile: sanitizeTripProfile(source.tripProfile) ?? sanitizeTripProfile(fallback.tripProfile) ?? undefined,
    fieldSources: sanitizeFieldSources(source.fieldSources) ?? sanitizeFieldSources(fallback.fieldSources),
    schemaVersion: typeof source.schemaVersion === 'number' ? Math.max(1, Math.round(source.schemaVersion)) : 1,
    planningConstraints: sanitizePlanningConstraints(source.planningConstraints) ?? sanitizePlanningConstraints(fallback.planningConstraints),
    plannerSuggestions: Array.isArray(source.plannerSuggestions) ? source.plannerSuggestions.slice(-20) : (fallback.plannerSuggestions || []),
    plannerHistory: sanitizePlannerHistory(source.plannerHistory) ?? sanitizePlannerHistory(fallback.plannerHistory),
    lastPlannerProfileRevision: typeof source.lastPlannerProfileRevision === 'string' ? source.lastPlannerProfileRevision : fallback.lastPlannerProfileRevision,
    brandTitle: optionalText(source.brandTitle, fallback.brandTitle),
    overviewEyebrow: optionalText(source.overviewEyebrow, fallback.overviewEyebrow),
    overviewDescription: optionalText(source.overviewDescription, fallback.overviewDescription),
    searchPlaceholder: optionalText(source.searchPlaceholder, fallback.searchPlaceholder),
    name: typeof source.name === 'string' && source.name.trim() ? source.name : fallback.name,
    description: typeof source.description === 'string' && source.description.trim() ? source.description : fallback.description,
    marqueeItems: sanitizedMarqueeItems?.length ? sanitizedMarqueeItems : (fallback.marqueeItems || DEFAULT_MARQUEE_ITEMS),
    heroEyebrow: typeof source.heroEyebrow === 'string' && source.heroEyebrow.trim() ? source.heroEyebrow.trim() : (fallback.heroEyebrow || 'A personalized travel starter'),
    primaryButtonLabel: typeof source.primaryButtonLabel === 'string' && source.primaryButtonLabel.trim() ? source.primaryButtonLabel.trim() : (fallback.primaryButtonLabel || 'Open the itinerary'),
    primaryButtonTab,
    secondaryButtonLabel: typeof source.secondaryButtonLabel === 'string' && source.secondaryButtonLabel.trim() ? source.secondaryButtonLabel.trim() : (fallback.secondaryButtonLabel || 'See the map'),
    secondaryButtonTab,
    coverHeadline: typeof source.coverHeadline === 'string' && source.coverHeadline.trim() ? source.coverHeadline.trim() : (fallback.coverHeadline || 'Add a cover when your story takes shape.'),
    coverLabel: typeof source.coverLabel === 'string' && source.coverLabel.trim() ? source.coverLabel.trim() : (fallback.coverLabel || 'Custom cover'),
    coverYear: typeof source.coverYear === 'string' && source.coverYear.trim() ? source.coverYear.trim() : (fallback.coverYear || String(new Date().getFullYear())),
    // Empty string means "no badge" and must survive sanitisation; falling
    // back to days.length would resurrect a stale count after dates are cleared.
    heroDayBadge: typeof source.heroDayBadge === 'string'
      ? source.heroDayBadge.trim()
      : (typeof fallback.heroDayBadge === 'string' ? fallback.heroDayBadge : undefined),
    heroDayBadgeUnit: typeof source.heroDayBadgeUnit === 'string'
      ? source.heroDayBadgeUnit.trim()
      : optionalText(fallback.heroDayBadgeUnit),
    cities: sanitizedCities.length > 0 ? Array.from(new Set(sanitizedCities)) : Array.from(new Set(sanitizedDays.map((day) => day.city).filter(Boolean))),
    days: sanitizedDays,
  };
};

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
  const [showWelcome, setShowWelcome] = useState(() => !localStorage.getItem('hasVisited'));
  const [showPets, setShowPets] = useState(() => {
    const stored = localStorage.getItem('showPets');
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
  const { bindTrip } = useCurrency();
  const [customItinerary, setCustomItinerary] = useState<Itinerary | null>(null);
  useTripIdentityTheme(customItinerary?.tripProfile, theme);

  // A trip carries its own home → destination currency pair.
  const activeTripProfile = useMemo(
    () => sanitizeTripProfile(customItinerary?.tripProfile),
    [customItinerary?.tripProfile],
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
    localStorage.setItem('hasVisited', 'true');
  };

  const togglePets = () => {
    setShowPets(prev => {
      const next = !prev;
      localStorage.setItem('showPets', next.toString());
      return next;
    });
  };

  const itinerarySyncReadyRef = useRef(false);
  const hasLocalItineraryRef = useRef(false);
  const remoteItineraryLoadedRef = useRef(false);

  const demoItinerary = itineraries.find((i) => i.id === activeItineraryId) ?? itineraries[0];
  const activeItinerary = useMemo(
    () => isDemoUser ? demoItinerary : { ...emptyItinerary, id: activeItineraryId },
    [isDemoUser, demoItinerary, activeItineraryId],
  );
  const displayItinerary = customItinerary || activeItinerary;
  const dayBadge = resolveDisplayedDayBadge(displayItinerary);
  const dayBadgeValue = dayBadge.value;
  const showDayBadge = dayBadge.visible || isHomeHeroEditing;
  const brandWords = (displayItinerary.brandTitle || 'Travel Handbook').trim().split(/\s+/);
  const brandAccent = brandWords[brandWords.length - 1];
  const brandLead = brandWords.slice(0, -1).join(' ');
  const itineraryStorageKey = isDemoUser
    ? `itinerary-demo-${activeItineraryId}`
    : `itinerary-${user?.id ?? 'account'}-${activeItineraryId}`;
  const handleItineraryChange = (nextItinerary: Itinerary) => {
    setCustomItinerary(sanitizeItinerary(nextItinerary, activeItinerary));
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
    const storageKey = itineraryStorageKey;
    try {
      const recovered = loadFromStorage<Itinerary>(storageKey);
      if (recovered) {
        setCustomItinerary(sanitizeItinerary(recovered, activeItinerary));
        hasLocalItineraryRef.current = true;
      } else if (isDemoUser) {
        // Keep edits made before account-scoped storage was introduced.
        const legacyDemoData = loadFromStorage<Itinerary>(`itinerary-${activeItineraryId}`);
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
        setCustomItinerary(sanitized);
        hasLocalItineraryRef.current = true;
        saveToStorage(itineraryStorageKey, sanitized);
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
          hasLocalItineraryRef.current = true;
          setCustomItinerary((prev) => {
            if (prev && JSON.stringify(prev) === JSON.stringify(sanitized)) return prev;
            saveToStorage(itineraryStorageKey, sanitized);
            return sanitized;
          });
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      channel.unsubscribe();
    };
  }, [activeItineraryId, activeItinerary, isDemoUser, itineraryStorageKey, user, selectedTripId]);

  useEffect(() => {
    const itineraryToSync = customItinerary;
    if (!itineraryToSync || !itinerarySyncReadyRef.current || !remoteItineraryLoadedRef.current) return;

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
        updated_at: new Date().toISOString(),
      });
      if (registryError) console.error('Error syncing trip registry:', registryError);
    }, 800);

    return () => clearTimeout(timeoutId);
  }, [customItinerary, activeItinerary, itineraryStorageKey, isDemoUser, user]);

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
    setHasRestoreSnapshot(Boolean(localStorage.getItem(`restore-snapshot-${activeItineraryId}`)));
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
          updated_at: new Date().toISOString(),
        });
      }
    }
    if (datasetIds.includes('budget')) {
      const budgetData = loadFromStorage<Record<string, unknown>>(`budget-${activeItineraryId}`);
      if (budgetData) {
        await supabase.from('budgets').upsert({ id: activeItineraryId, user_id: user.id, data: budgetData, updated_at: new Date().toISOString() });
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
      return (
        <div className="min-h-screen" style={{ backgroundColor: 'var(--bg)', color: 'var(--ink)' }}>
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
    <div className="min-h-screen font-sans pb-24 md:pb-0 overflow-x-hidden" style={{ backgroundColor: 'var(--bg)', color: 'var(--ink)' }}>

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
        className="sticky top-0 z-40 backdrop-blur-md"
        style={{
          backgroundColor: 'color-mix(in srgb, var(--bg) 85%, transparent)',
          borderBottom: '1px solid var(--border)',
          paddingTop: 'var(--app-safe-top)',
          willChange: 'transform',
        }}
      >
        <div className="app-header-inner max-w-7xl mx-auto px-4 sm:px-6 md:px-10 py-3 md:py-4 flex items-center justify-between gap-3">
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
              {brandLead && `${brandLead} `}
              <span className="font-display-italic" style={{ color: 'var(--accent)' }}>{brandAccent}</span>
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
              onClick={openRestoreModal}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-semibold"
              style={{ color: 'var(--ink)', border: '1px solid var(--border)' }}
              whileTap={{ scale: 0.95 }}
              whileHover={{ y: -1 }}
              aria-label="Restore backup"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span className="hidden xl:inline">Restore</span>
            </motion.button>
            <motion.button
              onClick={toggleTheme}
              className="p-2 rounded-full"
              style={{ color: 'var(--ink)', border: '1px solid var(--border)' }}
              aria-label="Toggle theme"
              whileTap={{ scale: 0.9, rotate: -12 }}
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </motion.button>
            <motion.button
              onClick={() => handleTabChange('settings')}
              className="inline-flex p-2 rounded-full"
              style={{ color: activeTab === 'settings' ? 'var(--accent)' : 'var(--ink)', border: '1px solid var(--border)' }}
              whileTap={{ scale: 0.9 }}
              aria-label="Open app settings"
              title="App settings"
            >
              <Settings className="w-4 h-4" />
            </motion.button>
            <motion.button
              onClick={() => handleTabChange('profile')}
              className="inline-flex p-2 rounded-full"
              style={{ color: activeTab === 'profile' ? 'var(--accent)' : 'var(--ink)', border: '1px solid var(--border)' }}
              whileTap={{ scale: 0.9 }}
              aria-label="Open profile settings"
              title="Profile settings"
            >
              <UserRound className="w-4 h-4" />
            </motion.button>
            <motion.button
              className="xl:hidden p-2 rounded-full"
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
      <section className="max-w-7xl mx-auto px-4 sm:px-6 md:px-10 pt-10 md:pt-20 pb-8 md:pb-16">
        {isHomeHeroEditing && (
          <div className="flex justify-end gap-2 mb-5">
            <button type="button" onClick={() => setIsHomeHeroEditing(false)} className="pill-btn pill-ghost">Cancel</button>
            <button type="button" onClick={saveHomeHero} className="pill-btn pill-primary"><Save className="w-4 h-4" /> Save banner</button>
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-10 md:gap-12 items-center">
          {/* Left copy */}
          <div className="md:col-span-7">
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}>
              <span
                className="eyebrow cursor-text rounded px-1 outline-none focus:bg-white/10"
                contentEditable={isHomeHeroEditing}
                suppressContentEditableWarning
                onBlur={(event) => commitHeroText('heroEyebrow', event.currentTarget.textContent || '')}
                title="Click to edit"
              >{displayItinerary.heroEyebrow || 'A personalized travel starter'}</span>
            </motion.div>
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
              className="mt-6 font-display text-5xl sm:text-6xl md:text-[5.5rem] lg:text-[6.5rem] leading-[0.95] tracking-tight"
              style={{ color: 'var(--ink)' }}
            >
              <span
                contentEditable={isHomeHeroEditing}
                suppressContentEditableWarning
                className="cursor-text rounded px-1 outline-none focus:bg-white/10"
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
                onClick={() => handleTabChange(displayItinerary.primaryButtonTab || 'itinerary')}
                className="pill-btn pill-primary accent-button"
                style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-ink)' }}
              >
                <span
                  contentEditable={isHomeHeroEditing}
                  suppressContentEditableWarning
                  className="cursor-text rounded px-1 outline-none focus:bg-black/10"
                  onClick={(event) => event.stopPropagation()}
                  onBlur={(event) => commitHeroText('primaryButtonLabel', event.currentTarget.textContent || '')}
                  title="Click text to edit"
                >{displayItinerary.primaryButtonLabel || 'Open the itinerary'}</span>
              </button>
              <button onClick={() => handleTabChange(displayItinerary.secondaryButtonTab || 'maps')} className="pill-btn pill-ghost">
                <span
                  contentEditable={isHomeHeroEditing}
                  suppressContentEditableWarning
                  className="cursor-text rounded px-1 outline-none focus:bg-white/10"
                  onClick={(event) => event.stopPropagation()}
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
              className="editorial-card p-3 md:p-4 rotate-[-2deg]"
              style={{ backgroundColor: 'var(--bg-elevated)' }}
            >
              <div className="relative overflow-hidden rounded-2xl">
                {displayItinerary.cities.length > 0 ? (
                  <img
                    src={heroImages[activeItineraryId as keyof typeof heroImages] || defaultTravelHero}
                    alt={displayItinerary.cities.join(' & ')}
                    className="w-full h-[280px] md:h-[420px] object-cover"
                  />
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
              <div className="flex items-center justify-between px-2 pt-3 pb-1">
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
      <main id="main-content" className="max-w-7xl mx-auto px-4 md:px-10 pt-8 md:pt-14 pb-24 md:pb-20 relative z-10">
        
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
  );
}

export default App;
