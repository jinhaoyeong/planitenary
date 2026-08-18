import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { MapPin, Utensils, Camera, Landmark, Footprints, Train, Search, ChevronLeft, Edit2, Plus, Save, Plane, Coffee, ShoppingBag, Music, RefreshCw, Loader2, ExternalLink, X, GripVertical, Image as ImageIcon, Heart, MessageSquare, AlertTriangle, Mic, Square, Trash2, Star, Lock, Unlock, Clock } from 'lucide-react';
import { itineraries } from '../data';
import type { Itinerary, Activity, ActivityType, DayPhoto } from '../data';
import { clsx } from 'clsx';
import { getPhotos, subscribeToPhotoChanges, syncAllPhotosFromRemote } from '../lib/photoStorage';
import { PhotoGallery } from './PhotoGallery';
import { PlannerPreview } from './PlannerPreview';
import { ItineraryChangeHistoryPanel } from './ItineraryChangeHistoryPanel';
import { hapticSuccess } from '../lib/haptics';
import { useSwipe } from '../hooks/useSwipe';
import { admissionChip } from '../lib/admissionCopy';
import { activityHoursToDateAware, describeOpeningHours } from '../lib/openingHours';
import { convertCurrency, formatCurrency, hasRate } from '../lib/currency';
import { addDays } from '../lib/dateRange';
import { countryTimezone } from '../lib/destinations';
import { useCurrency } from '../contexts/CurrencyContext';
import { sanitizeTripProfile } from '../lib/tripProfile';
import { declaredTripDays, longTripItineraryNotice } from '../lib/tripDuration';
import { resolveVisualIdentity } from '../lib/visualIdentity';
import { markManualFieldEdits } from '../lib/identityFields';
import { applyActivityDuration, durationFieldsFromMinutes, formatFlightDuration } from '../lib/flightDuration';
import { FlightDurationFields } from './FlightDurationFields';
import { useTripIntelligenceUi } from '../lib/tripIntelligenceUi';

const ICON_OPTIONS: { id: ActivityType, icon: any, label: string }[] = [
  { id: 'sight', icon: Camera, label: 'Sightseeing' },
  { id: 'food', icon: Utensils, label: 'Food' },
  { id: 'culture', icon: Landmark, label: 'Culture' },
  { id: 'walk', icon: Footprints, label: 'Walking' },
  { id: 'travel', icon: Train, label: 'Transport' },
  { id: 'flight', icon: Plane, label: 'Flight' },
  { id: 'cafe', icon: Coffee, label: 'Cafe' },
  { id: 'shop', icon: ShoppingBag, label: 'Shopping' },
  { id: 'nightlife', icon: Music, label: 'Nightlife' },
  { id: 'other', icon: MapPin, label: 'Other' },
];

type MoodReaction = 'see_first' | 'must_go' | 'maybe' | 'skip' | 'love' | 'funny' | 'surprised' | 'pray';
type MoodVoter = 'self' | 'partner';

const REACTION_OPTIONS: { id: MoodReaction; label: string }[] = [
  { id: 'see_first', label: 'See First' },
  { id: 'must_go', label: 'Must Go' },
  { id: 'maybe', label: 'Maybe' },
  { id: 'skip', label: 'Skip' },
  { id: 'love', label: 'Love' },
  { id: 'funny', label: 'Funny' },
  { id: 'surprised', label: 'Surprised' },
  { id: 'pray', label: 'Pray' },
];

const REACTION_EMOJI: Record<MoodReaction, string> = {
  see_first: '👀',
  must_go: '🔥',
  maybe: '🤔',
  skip: '⛔',
  love: '❤️',
  funny: '😂',
  surprised: '😮',
  pray: '🙏',
};

const RATING_OPTIONS = Array.from({ length: 11 }, (_, index) => index);

const normalizeActivityRating = (rating?: number) => {
  if (typeof rating !== 'number' || Number.isNaN(rating)) return undefined;
  return Math.max(0, Math.min(10, Math.round(rating)));
};

const getMoodReactionTone = (reaction: MoodReaction) => {
  switch (reaction) {
    case 'see_first':
      return 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300';
    case 'must_go':
      return 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300';
    case 'maybe':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300';
    case 'love':
      return 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300';
    case 'funny':
      return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300';
    case 'surprised':
      return 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300';
    case 'pray':
      return 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300';
    default:
      return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
  }
};

const getTimeSortValue = (time?: string) => {
  if (!time) return Number.MAX_SAFE_INTEGER;
  const normalized = normalizeTimeInput(time);
  if (!normalized) return Number.MAX_SAFE_INTEGER;
  const match = normalized.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return Number.MAX_SAFE_INTEGER;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return Number.MAX_SAFE_INTEGER;
  return (hours * 60) + minutes;
};

const normalizeTimeInput = (time?: string) => {
  if (!time) return '';
  const value = time.trim();
  const fullMatch = value.match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/);
  if (fullMatch) {
    const rawHour = Number(fullMatch[1]);
    const minutes = fullMatch[2];
    const period = fullMatch[3].toUpperCase();
    if (Number.isNaN(rawHour) || rawHour < 1 || rawHour > 12) return '';
    let hour24 = rawHour % 12;
    if (period === 'PM') hour24 += 12;
    return `${String(hour24).padStart(2, '0')}:${minutes}`;
  }

  const simpleMatch = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!simpleMatch) return '';
  const hours = Number(simpleMatch[1]);
  const minutes = Number(simpleMatch[2]);
  if (Number.isNaN(hours) || Number.isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return '';
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
};

const sortActivitiesByTime = (activities: Activity[]) => {
  return [...activities].sort((a, b) => getTimeSortValue(a.time) - getTimeSortValue(b.time));
};

const haversineDistanceKm = (from: [number, number], to: [number, number]) => {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const [lat1, lon1] = from;
  const [lat2, lon2] = to;
  const earthRadiusKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
};

const ActivityIcon = ({ type }: { type: string }) => {
  switch (type) {
    case 'food': return <Utensils className="w-4 h-4 text-orange-500" />;
    case 'sight': return <Camera className="w-4 h-4 text-rose-500" />;
    case 'culture': return <Landmark className="w-4 h-4 text-purple-500" />;
    case 'walk': return <Footprints className="w-4 h-4 text-green-500" />;
    case 'travel': return <Train className="w-4 h-4" style={{ color: 'var(--ink-muted)' }} />;
    case 'flight': return <Plane className="w-4 h-4 text-sky-500" />;
    case 'cafe': return <Coffee className="w-4 h-4 text-amber-600" />;
    case 'shop': return <ShoppingBag className="w-4 h-4 text-rose-400" />;
    case 'nightlife': return <Music className="w-4 h-4 text-indigo-500" />;
    default: return <MapPin className="w-4 h-4" style={{ color: 'var(--ink-muted)' }} />;
  }
};

const ActivityItem = ({ activity, isEditing, onEdit, onDelete, dayDate, timezone }: {
  activity: Activity;
  isEditing: boolean;
  onEdit?: (updated: Activity) => void;
  onDelete?: () => void;
  /**
   * The real date this day falls on, ISO. `DayPlan.date` is a display string
   * ("12 Apr"), so the question "is this open on the day I am there" cannot be
   * answered from it.
   */
  dayDate?: string;
  timezone?: string;
}) => {
  const [editedActivity, setEditedActivity] = useState(activity);
  const [durationHours, setDurationHours] = useState('');
  const [durationMinutesPart, setDurationMinutesPart] = useState('');
  const [durationError, setDurationError] = useState('');
  const wasEditingRef = useRef(false);
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [searchResults, setSearchResults] = useState<{display_name: string, lat: string, lon: string}[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isMoodOpen, setIsMoodOpen] = useState(false);
  const [isRatingOpen, setIsRatingOpen] = useState(false);
  const [isMobileActionsOpen, setIsMobileActionsOpen] = useState(false);
  const [activeVoter, setActiveVoter] = useState<MoodVoter>('self');
  const [moodDraft, setMoodDraft] = useState<NonNullable<Activity['moodVotes']>>({
    self: activity.moodVotes?.self,
    partner: activity.moodVotes?.partner,
    comment: activity.moodVotes?.comment,
    commentBy: activity.moodVotes?.commentBy,
  });
  const { homeCurrency, rates } = useCurrency();

  /**
   * Cost and hours for this card, using the same modules the discovery panel
   * uses — so a place cannot describe itself one way while the traveller is
   * choosing it and another way once it is in the plan.
   */
  const costChip = useMemo(() => {
    const chip = admissionChip(activity.admission, {
      // Same rule as the discovery card: without a real rate there is no
      // approximation to offer, and a 1:1 fallback would print a wrong price.
      toHomeCurrency: (amount, currency) => (
        currency === homeCurrency || !hasRate(rates, currency) || !hasRate(rates, homeCurrency)
          ? undefined
          : formatCurrency(convertCurrency(amount, currency, homeCurrency, rates), homeCurrency)),
    });
    // Records written before admission existed still carry a free-text `cost`.
    // It renders as the traveller typed it — never with a currency glyph
    // bolted on, which is what the old `¥ {activity.cost}` did.
    return chip ?? (activity.cost?.trim() || undefined);
  }, [activity.admission, activity.cost, homeCurrency, rates]);

  const dayHours = useMemo(() => describeOpeningHours(
    activityHoursToDateAware(
      activity.openingHoursWeek ?? (activity.openingHours ? [activity.openingHours] : []),
      // The saved activity carries no confidence of its own, and the day card
      // shows no provenance line, so nothing is presented as better sourced
      // than it is.
      'medium',
      timezone,
    ),
    { onDate: dayDate, timezone },
  ), [activity.openingHoursWeek, activity.openingHours, dayDate, timezone]);

  /**
   * The chip says "this day", so it may only appear when we know which day
   * that is.
   *
   * `dayDate` comes from `profile.startDate + (day − 1)`, and the profile is
   * null for any itinerary saved without one — including the bundled demo
   * trip. With no date, `describeOpeningHours` falls back to the *reader's*
   * today, so a plan opened on a Monday would put a red "Closed this day" on a
   * Saturday card for a place that is open on Saturdays. A chip about the
   * wrong day is worse than no chip, so it is omitted.
   */
  const hoursChip = !dayDate || dayHours.unknown
    ? undefined
    : dayHours.closedToday
      ? 'Closed this day'
      : dayHours.todayLine?.replace(/^Open /, '');

  const cardRef = useRef<HTMLDivElement | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const voiceMimeTypeRef = useRef('');
  const recordingTimerRef = useRef<number | null>(null);
  const recordingSecondsRef = useRef(0);
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [voiceError, setVoiceError] = useState('');
  const recordingTimeLabel = `${Math.floor(recordingSeconds / 60)
    .toString()
    .padStart(2, '0')}:${(recordingSeconds % 60).toString().padStart(2, '0')}`;

  const searchLocation = async (query: string) => {
    if (!query || query.length < 3) {
      setSearchResults([]);
      return;
    }
    setIsSearching(true);
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`);
      const data = await response.json();
      setSearchResults(data);
    } catch (e) {
      console.error("Search failed", e);
    } finally {
      setIsSearching(false);
    }
  };

  const selectLocation = (result: {display_name: string, lat: string, lon: string}) => {
    setEditedActivity({
      ...editedActivity,
      location: result.display_name.split(',')[0], // Use first part of address for brevity
      coordinates: [parseFloat(result.lat), parseFloat(result.lon)]
    });
    setSearchResults([]);
  };

  const updateMoodVotes = (next: NonNullable<Activity['moodVotes']>) => {
    const normalizedComment = next.comment?.trim();
    const normalizedVotes: NonNullable<Activity['moodVotes']> = {
      self: next.self,
      partner: next.partner,
      comment: normalizedComment || undefined,
      commentBy: normalizedComment ? next.commentBy : undefined,
    };
    const hasMoodValue = Boolean(normalizedVotes.self || normalizedVotes.partner || normalizedVotes.comment);
    onEdit?.({
      ...activity,
      moodVotes: hasMoodValue ? normalizedVotes : undefined,
    });
  };

  const openMoodBoard = () => {
    setMoodDraft({
      self: activity.moodVotes?.self,
      partner: activity.moodVotes?.partner,
      comment: activity.moodVotes?.comment,
      commentBy: activity.moodVotes?.commentBy,
    });
    setIsMobileActionsOpen(false);
    setIsMoodOpen(true);
  };

  const setVoterReaction = (voter: MoodVoter, reaction?: MoodReaction) => {
    setMoodDraft((current) => ({
      ...current,
      [voter]: reaction,
    }));
  };

  const selectMoodReaction = (reaction: MoodReaction) => {
    const currentReaction = moodDraft[activeVoter];
    setVoterReaction(activeVoter, currentReaction === reaction ? undefined : reaction);
  };

  const saveMoodBoard = () => {
    updateMoodVotes({
      ...moodDraft,
      commentBy: moodDraft.comment?.trim() ? (moodDraft.commentBy || activeVoter) : undefined,
    });
    setIsMoodOpen(false);
  };

  const updateActivityRating = (nextRating?: number) => {
    onEdit?.({
      ...activity,
      rating: normalizeActivityRating(nextRating),
    });
    setIsRatingOpen(false);
  };

  const clearLongPressTimer = () => {
    if (!longPressTimerRef.current) return;
    window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  };

  const isInteractiveTarget = (target: EventTarget | null) => {
    return target instanceof HTMLElement && Boolean(target.closest('a,button,input,textarea,audio,select'));
  };

  const handleCardClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (isInteractiveTarget(event.target)) return;
    if (typeof window === 'undefined' || window.innerWidth >= 768) return;
    setIsMoodOpen(false);
    setIsRatingOpen(false);
    setIsMobileActionsOpen((current) => !current);
  };

  const stopVoiceRecording = () => {
    if (recordingTimerRef.current) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecordingVoice(false);
  };

  const startVoiceRecording = async () => {
    if (isRecordingVoice) return;
    if (!navigator.mediaDevices || typeof MediaRecorder === 'undefined') {
      window.alert('Voice recording is not supported on this device/browser.');
      return;
    }
    try {
      setVoiceError('');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const mimeCandidates = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/ogg;codecs=opus',
      ];
      const supportedMimeType = mimeCandidates.find(
        (mimeType) => typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(mimeType)
      );
      let recorder: MediaRecorder;
      try {
        recorder = supportedMimeType
          ? new MediaRecorder(stream, { mimeType: supportedMimeType, audioBitsPerSecond: 64000 })
          : new MediaRecorder(stream, { audioBitsPerSecond: 64000 });
      } catch {
        recorder = new MediaRecorder(stream);
      }
      voiceMimeTypeRef.current = recorder.mimeType || supportedMimeType || 'audio/webm';
      mediaRecorderRef.current = recorder;
      const chunks: BlobPart[] = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };

      recorder.onerror = () => {
        setVoiceError('Recording failed. Please try again.');
      };

      recorder.onstop = () => {
        if (chunks.length === 0) {
          setVoiceError('No audio captured. Try recording again.');
          if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach((track) => track.stop());
            mediaStreamRef.current = null;
          }
          return;
        }
        const firstChunk = chunks[0];
        const fallbackType = typeof firstChunk === 'object' && 'type' in firstChunk ? String((firstChunk as Blob).type || '') : '';
        const blobType = voiceMimeTypeRef.current || fallbackType || 'audio/webm';
        const blob = new Blob(chunks, { type: blobType });
        if (blob.size < 256) {
          setVoiceError('Recorded audio is too short. Please try again.');
          if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach((track) => track.stop());
            mediaStreamRef.current = null;
          }
          return;
        }
        const reader = new FileReader();
        reader.onloadend = () => {
          const dataUrl = reader.result as string;
          if (!dataUrl) {
            setVoiceError('Failed to save audio. Please try again.');
            return;
          }
          onEdit?.({
            ...activity,
            voiceNote: {
              dataUrl,
              durationSec: Math.max(1, Math.min(recordingSecondsRef.current || 0, 300)),
              createdAt: new Date().toISOString(),
            },
          });
          setVoiceError('');
        };
        reader.readAsDataURL(blob);
        if (mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach((track) => track.stop());
          mediaStreamRef.current = null;
        }
      };

      setRecordingSeconds(0);
      recordingSecondsRef.current = 0;
      setIsRecordingVoice(true);
      recorder.start();
      recordingTimerRef.current = window.setInterval(() => {
        setRecordingSeconds((current) => {
          if (current >= 299) {
            recordingSecondsRef.current = 300;
            stopVoiceRecording();
            return 300;
          }
          recordingSecondsRef.current = current + 1;
          return current + 1;
        });
      }, 1000);
    } catch (error) {
      console.error('Failed to start voice recording', error);
      setVoiceError('Microphone permission is required for voice notes.');
    }
  };

  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('a,button,input,textarea')) return;
    clearLongPressTimer();
    longPressTimerRef.current = window.setTimeout(() => {
      openMoodBoard();
    }, 420);
  };

  const moodVotes = activity.moodVotes || {};
  const reactionA = moodVotes.self;
  const reactionB = moodVotes.partner;
  const hasConflict = Boolean(reactionA && reactionB && reactionA !== reactionB);
  const activityRating = normalizeActivityRating(activity.rating);
  const editedActivityRating = normalizeActivityRating(editedActivity.rating);

  useEffect(() => {
    if (!isMoodOpen && !isRatingOpen && !isMobileActionsOpen) return;
    const onDocumentPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!cardRef.current || !target) return;
      if (!cardRef.current.contains(target)) {
        setIsMoodOpen(false);
        setIsRatingOpen(false);
        setIsMobileActionsOpen(false);
      }
    };
    document.addEventListener('pointerdown', onDocumentPointerDown);
    return () => {
      document.removeEventListener('pointerdown', onDocumentPointerDown);
    };
  }, [isMoodOpen, isRatingOpen, isMobileActionsOpen]);

  useEffect(() => {
    setIsMobileActionsOpen(false);
  }, [isEditing]);

  useEffect(() => {
    if (isEditing && !wasEditingRef.current) {
      setEditedActivity(activity);
      const fields = durationFieldsFromMinutes(activity.type === 'flight' ? activity.durationMinutes : undefined);
      setDurationHours(fields.hours);
      setDurationMinutesPart(fields.minutes);
      setDurationError('');
    }
    wasEditingRef.current = isEditing;
  }, [isEditing, activity]);

  useEffect(() => {
    return () => {
      clearLongPressTimer();
      stopVoiceRecording();
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      }
      recordingSecondsRef.current = 0;
    };
  }, []);

  if (isEditing) {
    return (
      <div className="flex flex-col gap-3 p-4 bg-white dark:bg-slate-900 rounded-3xl shadow-sm border border-rose-100 dark:border-rose-900/30">
        <div className="flex gap-2">
          <input 
            value={editedActivity.time}
            onChange={(e) => setEditedActivity({...editedActivity, time: e.target.value})}
            className="editorial-input is-compact w-20" style={{ textAlign: 'center', fontWeight: 700 }}
            placeholder="Time"
          />
          <input 
            value={editedActivity.name}
            onChange={(e) => setEditedActivity({...editedActivity, name: e.target.value})}
            className="editorial-input is-compact flex-1" style={{ fontWeight: 700 }}
            placeholder="Activity Name"
          />
        </div>
        
        <div className="relative">
          <button 
            onClick={() => setShowIconPicker(!showIconPicker)}
            className="flex items-center gap-2 p-2 border rounded-xl text-sm w-full text-left hover:bg-slate-50 dark:hover:bg-slate-800 dark:bg-slate-800 dark:border-slate-700 dark:text-white"
          >
            <ActivityIcon type={editedActivity.type} />
            <span className="text-slate-500 dark:text-slate-400">Change Icon: {ICON_OPTIONS.find(i => i.id === editedActivity.type)?.label || 'Select'}</span>
          </button>
          
          {showIconPicker && (
            <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-3xl shadow-xl z-20 p-2 grid grid-cols-5 gap-2">
              {ICON_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => {
                    setEditedActivity({...editedActivity, type: opt.id});
                    if (opt.id === 'flight') {
                      const fields = durationFieldsFromMinutes(editedActivity.durationMinutes);
                      setDurationHours(fields.hours);
                      setDurationMinutesPart(fields.minutes);
                    }
                    setDurationError('');
                    setShowIconPicker(false);
                  }}
                  className={clsx(
                    "p-2 rounded-xl flex flex-col items-center justify-center gap-1 hover:bg-slate-100 dark:hover:bg-slate-700",
                    editedActivity.type === opt.id ? "bg-rose-50 dark:bg-rose-900/30 text-rose-500 dark:text-rose-400" : "text-slate-600 dark:text-slate-300"
                  )}
                >
                  <opt.icon className="w-4 h-4" />
                  <span className="text-[8px]">{opt.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {editedActivity.type === 'flight' && (
          <FlightDurationFields
            idPrefix="edit-flight-duration"
            hours={durationHours}
            minutes={durationMinutesPart}
            onHoursChange={(value) => {
              setDurationHours(value);
              setDurationError('');
            }}
            onMinutesChange={(value) => {
              setDurationMinutesPart(value);
              setDurationError('');
            }}
            error={durationError}
          />
        )}

        <textarea 
          value={editedActivity.description}
          onChange={(e) => setEditedActivity({...editedActivity, description: e.target.value})}
          className="editorial-textarea is-compact"
          rows={2}
          placeholder="Description"
        />

        <div className="rounded-2xl border border-amber-100 bg-amber-50/70 px-3 py-3 dark:border-amber-900/40 dark:bg-amber-950/20">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Star className="w-4 h-4 text-amber-500 fill-amber-400/80" />
              <span className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-300">Activity rating</span>
            </div>
            <span className="text-sm font-bold text-amber-600 dark:text-amber-300">
              {editedActivityRating !== undefined ? `${editedActivityRating}/10` : 'Not rated'}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {RATING_OPTIONS.map((rating) => (
              <button
                key={rating}
                type="button"
                onClick={() => setEditedActivity({ ...editedActivity, rating })}
                className={clsx(
                  "min-w-9 rounded-xl px-2.5 py-1.5 text-xs font-bold transition-colors",
                  editedActivityRating === rating
                    ? "bg-amber-500 text-white shadow-sm shadow-amber-500/20"
                    : "bg-white text-slate-600 hover:bg-amber-100 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                )}
              >
                {rating}
              </button>
            ))}
            {editedActivityRating !== undefined && (
              <button
                type="button"
                onClick={() => setEditedActivity({ ...editedActivity, rating: undefined })}
                className="rounded-xl px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Clear
              </button>
            )}
          </div>
        </div>
        
        <div className="relative">
            <div className="flex gap-2 relative">
              <input 
                value={editedActivity.location || ''}
                onChange={(e) => {
                  setEditedActivity({...editedActivity, location: e.target.value});
                  searchLocation(e.target.value);
                }}
                className="editorial-input is-compact flex-1"
                placeholder="Search Location..."
              />
              {isSearching && (
                <div className="absolute right-28 top-2.5">
                  <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
                </div>
              )}
              <input 
                value={editedActivity.cost || ''}
                onChange={(e) => setEditedActivity({...editedActivity, cost: e.target.value})}
                className="editorial-input is-compact w-24" style={{ textAlign: 'right' }}
                placeholder="Cost (Optional)"
              />
            </div>
            
            {searchResults.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-3xl shadow-xl z-30 max-h-40 overflow-y-auto">
                {searchResults.map((result, i) => (
                  <button
                    key={i}
                    onClick={() => selectLocation(result)}
                    className="w-full text-left p-2 text-xs hover:bg-slate-50 dark:hover:bg-slate-700 border-b dark:border-slate-700 last:border-0 text-slate-900 dark:text-white"
                  >
                    {result.display_name}
                  </button>
                ))}
              </div>
            )}
          </div>

        {/* Google Links for Editing */}
        {editedActivity.name && (
          <div className="flex gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <a 
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(editedActivity.name + ' ' + (editedActivity.location || ''))}`}
              target="_blank" 
              rel="noopener noreferrer"
              className="flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-bold transition-colors"
              style={{
                backgroundColor: 'var(--bg)',
                color: 'var(--accent)',
              }}
            >
              <ExternalLink className="w-3.5 h-3.5" /> Google Maps
            </a>
            <a 
              href={`https://www.google.com/search?q=${encodeURIComponent(editedActivity.name + ' ' + (editedActivity.location || ''))}&tbm=isch`}
              target="_blank" 
              rel="noopener noreferrer"
              className="flex-1 flex items-center justify-center gap-2 py-2 bg-slate-50 dark:bg-slate-800 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
            >
              <Camera className="w-3.5 h-3.5" /> Photos
            </a>
          </div>
        )}

        <div className="flex justify-end gap-2 mt-2">
          <button
            onClick={onDelete}
            className="px-3 py-1.5 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg"
          >
            Delete
          </button>
          <button
            onClick={() => {
              const committed = applyActivityDuration(editedActivity, durationHours, durationMinutesPart);
              if (!committed.ok) {
                setDurationError(committed.error);
                return;
              }
              onEdit?.({ ...committed.activity, rating: normalizeActivityRating(committed.activity.rating) });
            }}
            className="px-3 py-1.5 text-xs bg-slate-900 dark:bg-rose-600 text-white rounded-lg"
          >
            Save
          </button>
        </div>
      </div>
    );
  }

  const actionButtonClass = "flex items-center px-2.5 py-1.5 rounded-lg text-xs font-bold border border-transparent transition-all duration-300 group/btn";
  const isScheduleLocked = activity.lockedFields?.includes('schedule');
  const isActivityLocked = activity.locked === true || activity.lockedFields?.includes('all');
  const renderActionButtons = () => (
    <>
      <a
        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(activity.name + ' ' + (activity.location || ''))}`}
        target="_blank"
        rel="noopener noreferrer"
        className={actionButtonClass}
        style={{
          backgroundColor: 'var(--bg)',
          color: 'var(--accent)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <ExternalLink className="w-3 h-3 shrink-0" />
        <span className="max-w-xs ml-1.5 md:max-w-0 md:ml-0 md:overflow-hidden md:group-hover/btn:max-w-xs md:group-hover/btn:ml-1.5 transition-all duration-300 ease-in-out whitespace-nowrap">
          Map
        </span>
      </a>
      <a
        href={`https://www.google.com/search?q=${encodeURIComponent(activity.name + ' ' + (activity.location || ''))}&tbm=isch`}
        target="_blank"
        rel="noopener noreferrer"
        className={`${actionButtonClass} bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 hover:border-slate-200 dark:hover:border-slate-600`}
        onClick={(e) => e.stopPropagation()}
      >
        <Camera className="w-3 h-3 shrink-0" />
        <span className="max-w-xs ml-1.5 md:max-w-0 md:ml-0 md:overflow-hidden md:group-hover/btn:max-w-xs md:group-hover/btn:ml-1.5 transition-all duration-300 ease-in-out whitespace-nowrap">
          Photos
        </span>
      </a>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          const fields = new Set(activity.lockedFields || []);
          if (isScheduleLocked) fields.delete('schedule');
          else fields.add('schedule');
          onEdit?.({ ...activity, lockedFields: Array.from(fields) });
        }}
        className={`${actionButtonClass} ${isScheduleLocked ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' : 'bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}
        aria-label={isScheduleLocked ? `Unlock schedule for ${activity.name}` : `Lock schedule for ${activity.name}`}
      >
        {isScheduleLocked ? <Unlock className="w-3 h-3 shrink-0" /> : <Lock className="w-3 h-3 shrink-0" />}
        <span className="max-w-xs ml-1.5 md:max-w-0 md:ml-0 md:overflow-hidden md:group-hover/btn:max-w-xs md:group-hover/btn:ml-1.5 transition-all duration-300 ease-in-out whitespace-nowrap">
          {isScheduleLocked ? 'Unlock schedule' : 'Lock schedule'}
        </span>
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          const fields = new Set(activity.lockedFields || []);
          if (isActivityLocked) fields.delete('all');
          else fields.add('all');
          onEdit?.({ ...activity, locked: !isActivityLocked, lockedFields: Array.from(fields) });
        }}
        className={`${actionButtonClass} ${isActivityLocked ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300' : 'bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}
        aria-label={isActivityLocked ? `Unlock entire activity ${activity.name}` : `Lock entire activity ${activity.name}`}
      >
        {isActivityLocked ? <Unlock className="w-3 h-3 shrink-0" /> : <Lock className="w-3 h-3 shrink-0" />}
        <span className="max-w-xs ml-1.5 md:max-w-0 md:ml-0 md:overflow-hidden md:group-hover/btn:max-w-xs md:group-hover/btn:ml-1.5 transition-all duration-300 ease-in-out whitespace-nowrap">
          {isActivityLocked ? 'Unlock activity' : 'Lock activity'}
        </span>
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setIsMobileActionsOpen(false);
          setIsMoodOpen(false);
          setIsRatingOpen((current) => !current);
        }}
        className={`${actionButtonClass} bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40 hover:border-amber-200 dark:hover:border-amber-700`}
      >
        <Star className="w-3 h-3 fill-current shrink-0" />
        <span className="max-w-xs ml-1.5 md:max-w-0 md:ml-0 md:overflow-hidden md:group-hover/btn:max-w-xs md:group-hover/btn:ml-1.5 transition-all duration-300 ease-in-out whitespace-nowrap">
          {activityRating !== undefined ? `${activityRating}/10` : 'Rate'}
        </span>
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setIsMobileActionsOpen(false);
          if (isMoodOpen) {
            setIsMoodOpen(false);
            return;
          }
          setIsRatingOpen(false);
          openMoodBoard();
        }}
        className={`${actionButtonClass} bg-rose-50 dark:bg-rose-900/30 text-rose-600 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/40 hover:border-rose-200 dark:hover:border-rose-700`}
      >
        <Heart className="w-3 h-3 shrink-0" />
        <span className="max-w-xs ml-1.5 md:max-w-0 md:ml-0 md:overflow-hidden md:group-hover/btn:max-w-xs md:group-hover/btn:ml-1.5 transition-all duration-300 ease-in-out whitespace-nowrap">
          Mood
        </span>
      </button>
      {!isRecordingVoice ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setIsMobileActionsOpen(false);
            startVoiceRecording();
          }}
          className={`${actionButtonClass} bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 hover:border-emerald-200 dark:hover:border-emerald-700`}
        >
          <Mic className="w-3 h-3 shrink-0" />
          <span className="max-w-xs ml-1.5 md:max-w-0 md:ml-0 md:overflow-hidden md:group-hover/btn:max-w-xs md:group-hover/btn:ml-1.5 transition-all duration-300 ease-in-out whitespace-nowrap">
            Voice (max 5m)
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setIsMobileActionsOpen(false);
            stopVoiceRecording();
          }}
          className={`${actionButtonClass} bg-rose-100 dark:bg-rose-900/40 text-rose-600 dark:text-rose-300 border-rose-200 dark:border-rose-700`}
        >
          <Square className="w-3 h-3 shrink-0" />
          <span className="max-w-xs ml-1.5 md:max-w-0 md:ml-0 md:overflow-hidden md:group-hover/btn:max-w-xs md:group-hover/btn:ml-1.5 transition-all duration-300 ease-in-out whitespace-nowrap">
            Stop ({recordingTimeLabel})
          </span>
        </button>
      )}
    </>
  );

  return (
    <motion.div
      ref={cardRef}
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      // z-[41] keeps the roaming pet overlay (fixed, z-40 — see Pets.tsx)
      // walking behind this card instead of across the description text.
      className="flex gap-4 p-5 bg-white dark:bg-slate-900 rounded-3xl shadow-sm border border-slate-100 dark:border-slate-800 hover:shadow-lg hover:-translate-y-0.5 transition-all group relative z-[41]"
      onTouchStart={handleTouchStart}
      onTouchEnd={clearLongPressTimer}
      onTouchCancel={clearLongPressTimer}
      onClick={handleCardClick}
    >
      <div className="flex flex-col items-center min-w-[60px]">
        <span className="text-sm font-bold text-slate-400 group-hover:text-rose-500 dark:group-hover:text-rose-400 transition-colors">{activity.time}</span>
        {activity.type === 'flight' && formatFlightDuration(activity.durationMinutes) && (
          <span className="mt-1 text-center text-[10px] font-semibold leading-tight text-slate-400 dark:text-slate-500">
            {formatFlightDuration(activity.durationMinutes)}
          </span>
        )}
        <div className="h-full w-0.5 bg-slate-100 dark:bg-slate-800 mt-2 mb-2 group-hover:bg-rose-100 dark:group-hover:bg-rose-900 transition-colors"></div>
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 bg-slate-50 dark:bg-slate-800 rounded-xl group-hover:bg-rose-50 dark:group-hover:bg-rose-900/30 transition-colors">
            <ActivityIcon type={activity.type} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="font-bold text-lg text-slate-800 dark:text-white group-hover:text-rose-600 dark:group-hover:text-rose-400 transition-colors">{activity.name}</h4>
            {(isScheduleLocked || isActivityLocked) && <Lock className="w-3.5 h-3.5 text-amber-600 dark:text-amber-300" aria-label={isActivityLocked ? 'Activity locked' : 'Schedule locked'} />}
            {activityRating !== undefined && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                <Star className="w-3 h-3 fill-current" />
                {activityRating}/10
              </span>
            )}
          </div>
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed mb-3">{activity.description}</p>

        {(reactionA || reactionB) && (
          <div className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-slate-100/90 dark:bg-slate-800/90 px-2 py-1">
            {reactionA && (
              <span className={clsx("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold", getMoodReactionTone(reactionA))}>
                <span>{REACTION_EMOJI[reactionA]}</span>
                <span>You</span>
              </span>
            )}
            {reactionB && (
              <span className={clsx("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold", getMoodReactionTone(reactionB))}>
                <span>{REACTION_EMOJI[reactionB]}</span>
                <span>Travel partner</span>
              </span>
            )}
            {reactionA && reactionB && (
              <span className={clsx("inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold", hasConflict ? "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300")}>
                {hasConflict ? 'Needs talk' : 'In sync'}
              </span>
            )}
            {activity.moodVotes?.comment && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-white/90 dark:bg-slate-700 text-slate-700 dark:text-slate-200 max-w-[220px]">
                <MessageSquare className="w-3 h-3 shrink-0" />
                <span className="truncate">
                  {activity.moodVotes.commentBy === 'partner' ? 'Travel partner' : 'You'}: {activity.moodVotes.comment}
                </span>
              </span>
            )}
          </div>
        )}

        {activity.voiceNote?.dataUrl && (
          <div className="mb-3 flex flex-col sm:flex-row sm:items-center gap-2 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/60 px-2.5 py-2">
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-300 whitespace-nowrap">Voice note ({activity.voiceNote.durationSec}s)</span>
            <audio controls src={activity.voiceNote.dataUrl} className="w-full h-8" />
            <button
              type="button"
              onClick={() => {
                onEdit?.({ ...activity, voiceNote: undefined });
                setVoiceError('');
              }}
              className="inline-flex items-center justify-center gap-1 rounded-xl px-2 py-1 text-[11px] font-semibold text-rose-600 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-900/30"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Remove
            </button>
          </div>
        )}

        {/**
         * One row, deliberately. The day card is a timeline the traveller
         * scans, not a place-details panel — the full record lives in
         * discovery. What earns a place here is what would change the plan:
         * where it is, what it costs, whether it is open on *this* day, and
         * whether it has to be booked.
         *
         * The cost chip used to be a hardcoded `¥ {activity.cost}` — the yen
         * glyph applied to every country, in front of a free-text string.
         */}
        <div className="flex flex-wrap gap-3 text-xs mb-3">
          {activity.location && (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-medium">
              <MapPin className="w-3.5 h-3.5" /> {activity.location}
            </span>
          )}
          {costChip && (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 font-bold border border-emerald-100/50 dark:border-emerald-800/50">
              {costChip}
            </span>
          )}
          {hoursChip && (
            <span
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-bold border ${
                dayHours.closedToday
                  ? 'bg-rose-50 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400 border-rose-100/50 dark:border-rose-800/50'
                  : 'bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-transparent'
              }`}
            >
              <Clock className="w-3.5 h-3.5" /> {hoursChip}
            </span>
          )}
          {activity.reservationRequirement === 'required' && (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 font-bold border border-amber-100/50 dark:border-amber-800/50">
              Booking required
            </span>
          )}
        </div>

        <div className="hidden md:flex flex-wrap gap-2 opacity-0 group-hover:opacity-100 transition-all duration-300 md:opacity-0 min-h-[32px]">
          {renderActionButtons()}
        </div>
        <AnimatePresence>
          {isMobileActionsOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0, y: -6 }}
              animate={{ opacity: 1, height: 'auto', y: 0 }}
              exit={{ opacity: 0, height: 0, y: -6 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="md:hidden overflow-hidden"
            >
              <div className="flex flex-wrap gap-2 rounded-2xl border border-slate-200/80 bg-slate-50/80 p-2.5 dark:border-slate-700 dark:bg-slate-800/60">
                {renderActionButtons()}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        {voiceError && (
          <div className="mt-2 text-[11px] font-semibold text-rose-600 dark:text-rose-300">
            {voiceError}
          </div>
        )}
        <AnimatePresence>
          {isRatingOpen && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              transition={{ duration: 0.16, ease: 'easeOut' }}
              className="mt-3 rounded-2xl border border-amber-200/70 bg-amber-50/80 p-3 dark:border-amber-700/50 dark:bg-amber-950/20"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-700 dark:text-slate-200">Rate this activity</span>
                <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                  {activityRating !== undefined ? `${activityRating}/10 saved` : 'Pick 0 to 10'}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {RATING_OPTIONS.map((rating) => (
                  <button
                    key={rating}
                    type="button"
                    onClick={() => updateActivityRating(rating)}
                    className={clsx(
                      "min-w-9 rounded-xl px-2.5 py-1.5 text-xs font-bold transition-colors",
                      activityRating === rating
                        ? "bg-amber-500 text-white shadow-sm shadow-amber-500/20"
                        : "bg-white text-slate-600 hover:bg-amber-100 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                    )}
                  >
                    {rating}
                  </button>
                ))}
                {activityRating !== undefined && (
                  <button
                    type="button"
                    onClick={() => updateActivityRating(undefined)}
                    className="rounded-xl px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    Clear
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
      {isMoodOpen && (
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.97 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="absolute left-3 right-3 top-3 z-30 rounded-2xl border border-rose-200/70 dark:border-rose-700/60 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md p-3 shadow-xl"
        >
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-xs font-bold text-slate-700 dark:text-slate-300">Couple Sync Mood Board</span>
            <button
              type="button"
              onClick={() => setIsMoodOpen(false)}
              className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2 mb-2">
            <button
              type="button"
              onClick={() => setActiveVoter('self')}
              className={clsx("px-2 py-1.5 rounded-lg text-xs font-semibold", activeVoter === 'self' ? "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300")}
            >
              You
            </button>
            <button
              type="button"
              onClick={() => setActiveVoter('partner')}
              className={clsx("px-2 py-1.5 rounded-lg text-xs font-semibold", activeVoter === 'partner' ? "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300")}
            >
              Travel partner
            </button>
          </div>
          <div className="mb-2 rounded-2xl bg-slate-100 dark:bg-slate-800 px-2 py-1.5 flex flex-wrap items-center gap-1.5">
            {REACTION_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => selectMoodReaction(option.id)}
                className={clsx(
                  "w-9 h-9 rounded-full text-base border inline-flex items-center justify-center",
                  moodDraft[activeVoter] === option.id
                    ? "border-rose-400 bg-gradient-to-br from-rose-50 to-pink-50 shadow-sm shadow-rose-200/60 dark:border-rose-500 dark:bg-rose-900/30"
                    : "border-transparent bg-transparent hover:bg-white/80 dark:hover:bg-slate-700"
                )}
                title={option.label}
              >
                {REACTION_EMOJI[option.id]}
              </button>
            ))}
            {moodDraft[activeVoter] && (
              <button
                type="button"
                onClick={() => setVoterReaction(activeVoter, undefined)}
                className="px-2.5 py-1.5 rounded-full text-[11px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-white/80 dark:hover:bg-slate-700"
              >
                Remove
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <input
              value={moodDraft.comment || ''}
              onChange={(e) => setMoodDraft((current) => ({ ...current, comment: e.target.value, commentBy: activeVoter }))}
              placeholder={`Add a note as ${activeVoter === 'self' ? 'You' : 'Travel partner'}...`}
              className="editorial-input is-compact flex-1"
            />
            <button
              type="button"
              onClick={saveMoodBoard}
              className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-900 text-white dark:bg-rose-600"
            >
              Save
            </button>
          </div>
          <div className="mt-2 text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1">
            <MessageSquare className="w-3 h-3" /> Tap same reaction again or Remove to clear vote
          </div>
        </motion.div>
      )}
      </AnimatePresence>
    </motion.div>
  );
};

export const ItineraryView = ({ itinerary: initialItinerary, onItineraryChange, planChanges }: {
  itinerary: Itinerary;
  onItineraryChange?: (itinerary: Itinerary) => void;
  planChanges?: { tripId: string; tripName?: string };
}) => {
  const [showAddModal, setShowAddModal] = useState(false);
  const [newActivity, setNewActivity] = useState<Partial<Activity>>({
    type: 'sight',
    time: '10:00',
    description: '',
    cost: ''
  });
  const [addFlightHours, setAddFlightHours] = useState('');
  const [addFlightMinutes, setAddFlightMinutes] = useState('');
  const [addFlightDurationError, setAddFlightDurationError] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [dayForModal, setDayForModal] = useState<number>(1); // Separate state for modal day selection
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    
    setIsSearching(true);
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&limit=5&addressdetails=1`);
      const data = await response.json();
      setSearchResults(data);
    } catch (err) {
      console.error("Search failed", err);
    } finally {
      setIsSearching(false);
    }
  };

  const [isEditingMode, setIsEditingMode] = useState(false);
  const [editingActivityIndex, setEditingActivityIndex] = useState<number | null>(null);
  const [isTitleEditing, setIsTitleEditing] = useState(false);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
  const [editedTitle, setEditedTitle] = useState('');
  const [editedDescription, setEditedDescription] = useState('');
  const [editedCities, setEditedCities] = useState('');
  const [editedMarqueeItems, setEditedMarqueeItems] = useState('');
  const [editedOverviewEyebrow, setEditedOverviewEyebrow] = useState('');
  const [editedOverviewDescription, setEditedOverviewDescription] = useState('');
  const [editingDateIndex, setEditingDateIndex] = useState<number | null>(null);
  const [editedDate, setEditedDate] = useState('');
  const [editingCityIndex, setEditingCityIndex] = useState<number | null>(null);
  const [editedCity, setEditedCity] = useState('');
  // Photo Gallery State
  const [galleryDay, setGalleryDay] = useState<number | null>(null);
  const [dayPhotos, setDayPhotos] = useState<Record<number, DayPhoto[]>>({});

  // Use the prop as the source of truth; parent handles persistence and Supabase sync
  const [customItinerary, setCustomItinerary] = useState<Itinerary>(initialItinerary);
  const plannerProfile = useMemo(() => sanitizeTripProfile(customItinerary.tripProfile), [customItinerary.tripProfile]);
  /**
   * The real date a day number falls on. `DayPlan.date` is a display string
   * ("12 Apr"), so a card cannot ask "is this open that day" from it — and
   * whether a museum is shut on the day you are standing outside it is the
   * whole question.
   */
  const isoDateForDay = useCallback(
    (dayNumber: number) => (plannerProfile?.startDate
      ? addDays(plannerProfile.startDate, Math.max(0, dayNumber - 1))
      : undefined),
    [plannerProfile?.startDate],
  );
  /** The destination's zone, so "open now" means open there. */
  const tripTimezone = useMemo(
    () => countryTimezone(plannerProfile?.destinations?.[0]?.countryCode),
    [plannerProfile?.destinations],
  );
  const visualIdentity = useMemo(
    () => (plannerProfile ? resolveVisualIdentity(plannerProfile) : null),
    [plannerProfile],
  );
  const declaredDays = useMemo(
    () => (plannerProfile ? declaredTripDays(plannerProfile) : 0),
    [plannerProfile],
  );
  const longTripNotice = useMemo(
    () => longTripItineraryNotice(declaredDays, customItinerary.days.length),
    [declaredDays, customItinerary.days.length],
  );
  // Sync internal state when parent prop changes (from Supabase realtime or other sources)
  useEffect(() => {
    setCustomItinerary(initialItinerary);
  }, [initialItinerary]);

  // Reset selection states when itinerary id changes
  useEffect(() => {
    setSelectedDay(null);
    setEditingActivityIndex(null);
    setGalleryDay(null);
    setDayPhotos({});
  }, [initialItinerary.id]);

  // Load photos for all days when itinerary changes
  useEffect(() => {
    const loadAllPhotos = async () => {
      const photos: Record<number, DayPhoto[]> = {};
      for (const day of customItinerary.days) {
        try {
          const dayPhotos = await getPhotos(customItinerary.id, day.day);
          if (dayPhotos.length > 0) {
            photos[day.day] = dayPhotos;
          }
        } catch (e) {
          console.error(`Failed to load photos for day ${day.day}:`, e);
        }
      }
      setDayPhotos(photos);
    };
    loadAllPhotos();
  }, [customItinerary.id, customItinerary.days]);

  // Subscribe to real-time photo changes from other devices
  useEffect(() => {
    const loadAllPhotos = async () => {
      const photos: Record<number, DayPhoto[]> = {};
      for (const day of customItinerary.days) {
        try {
          const dayPhotos = await getPhotos(customItinerary.id, day.day);
          if (dayPhotos.length > 0) {
            photos[day.day] = dayPhotos;
          }
        } catch (e) {
          console.error(`Failed to load photos for day ${day.day}:`, e);
        }
      }
      setDayPhotos(photos);
    };

    // Sync all photos from remote on mount
    syncAllPhotosFromRemote(customItinerary.id).then(() => {
      loadAllPhotos();
    });

    // Subscribe to real-time changes
    const unsubscribe = subscribeToPhotoChanges(customItinerary.id, () => {
      loadAllPhotos();
    });

    return () => {
      unsubscribe();
    };
  }, [customItinerary.id]);


  const getDayIndexByNumber = (dayNumber: number | null) => {
    if (dayNumber === null) return -1;
    return customItinerary.days.findIndex((day) => day.day === dayNumber);
  };

  const handleUpdateActivity = (dayNumber: number, activityIndex: number, updated: Activity) => {
    const dayIndex = getDayIndexByNumber(dayNumber);
    if (dayIndex < 0) {
      setEditingActivityIndex(null);
      return;
    }

    const targetDay = customItinerary.days[dayIndex];
    if (!targetDay || activityIndex < 0 || activityIndex >= targetDay.activities.length) {
      setEditingActivityIndex(null);
      return;
    }

    const updatedTime = normalizeTimeInput(updated.time) || '09:00';
    const updatedDays = customItinerary.days.map((day, idx) => {
      if (idx !== dayIndex) return day;
      const updatedActivities = day.activities.map((activity, activityIdx) =>
        activityIdx === activityIndex ? { ...updated, time: updatedTime } : activity
      );
      return {
        ...day,
        activities: sortActivitiesByTime(updatedActivities)
      };
    });
    const updatedItinerary = { ...customItinerary, days: updatedDays };
    setCustomItinerary(updatedItinerary);
    onItineraryChange?.(updatedItinerary);
    setEditingActivityIndex(null);
  };

  const confirmAddActivity = () => {
    if (!newActivity.name) return;
    const targetDayNumber = customItinerary.days.some((day) => day.day === dayForModal)
      ? dayForModal
      : (customItinerary.days[0]?.day ?? null);
    if (targetDayNumber === null) {
      setShowAddModal(false);
      return;
    }

    const normalizedTime = normalizeTimeInput(newActivity.time) || '09:00';

    const activityToAdd: Activity = {
      name: newActivity.name!,
      type: newActivity.type as ActivityType || 'other',
      time: normalizedTime,
      description: newActivity.description || 'Added manually',
      location: newActivity.location || '',
      cost: newActivity.cost || '',
      coordinates: newActivity.coordinates // Include coordinates if available
    };
    const committed = applyActivityDuration(activityToAdd, addFlightHours, addFlightMinutes);
    if (!committed.ok) {
      setAddFlightDurationError(committed.error);
      return;
    }

    const updatedDays = customItinerary.days.map(day => {
      if (day.day === targetDayNumber) {
        return {
          ...day,
          activities: sortActivitiesByTime([...day.activities, committed.activity])
        };
      }
      return day;
    });

    const updatedItinerary = { ...customItinerary, days: updatedDays };
    setCustomItinerary(updatedItinerary);
    onItineraryChange?.(updatedItinerary); // Ensure this propagates up
    setShowAddModal(false);
    setSearchQuery('');
    setSearchResults([]);
  };

  const handleDeleteActivity = (dayNumber: number, activityIndex: number) => {
    const dayIndex = getDayIndexByNumber(dayNumber);
    if (dayIndex < 0) {
      setEditingActivityIndex(null);
      return;
    }

    const targetDay = customItinerary.days[dayIndex];
    if (!targetDay || activityIndex < 0 || activityIndex >= targetDay.activities.length) {
      setEditingActivityIndex(null);
      return;
    }

    if (window.confirm('Delete this activity?')) {
      const updatedDays = customItinerary.days.map((day, idx) => {
        if (idx !== dayIndex) return day;
        return {
          ...day,
          activities: day.activities.filter((_, activityIdx) => activityIdx !== activityIndex)
        };
      });
      const updatedItinerary = { ...customItinerary, days: updatedDays };
      setCustomItinerary(updatedItinerary);
      onItineraryChange?.(updatedItinerary);
      setEditingActivityIndex(null);
    }
  };

  const handleAddActivity = (dayNumber: number) => {
    // Open modal with default values for this day
    const targetDayNumber = customItinerary.days.some((day) => day.day === dayNumber)
      ? dayNumber
      : (customItinerary.days[0]?.day ?? 1);
    setDayForModal(targetDayNumber);
    setNewActivity({
      name: '',
      location: '',
      type: 'sight',
      time: '09:00',
      description: '',
      cost: ''
    });
    setAddFlightHours('');
    setAddFlightMinutes('');
    setAddFlightDurationError('');
    setShowAddModal(true);
  };

  const resetToDefault = () => {
    if (window.confirm('Reset all changes to default itinerary? This cannot be undone.')) {
      const defaultItinerary = itineraries.find(i => i.id === initialItinerary.id) || initialItinerary;
      setCustomItinerary(defaultItinerary);
      onItineraryChange?.(defaultItinerary);
      localStorage.removeItem(`itinerary-${initialItinerary.id}`);
      setIsEditingMode(false);
    }
  };

  // Filter days based on search query
  const filteredDays = useMemo(() => {
    if (!searchQuery) return customItinerary.days;
    const lowerQuery = searchQuery.toLowerCase();
    return customItinerary.days.filter(day => 
      day.title.toLowerCase().includes(lowerQuery) ||
      day.city.toLowerCase().includes(lowerQuery) ||
      day.activities.some(act => 
        act.name.toLowerCase().includes(lowerQuery) || 
        act.description.toLowerCase().includes(lowerQuery)
      )
    );
  }, [customItinerary, searchQuery]);

  const currentDayIndex = getDayIndexByNumber(selectedDay);
  const currentDay = currentDayIndex >= 0 ? customItinerary.days[currentDayIndex] : null;
  const totalDays = customItinerary.days.length;

  useEffect(() => {
    const firstDayNumber = customItinerary.days[0]?.day ?? null;

    if (selectedDay !== null && getDayIndexByNumber(selectedDay) < 0) {
      setSelectedDay(firstDayNumber);
      setEditingActivityIndex(null);
    }

    if (getDayIndexByNumber(dayForModal) < 0 && firstDayNumber !== null) {
      setDayForModal(firstDayNumber);
    }

    if (galleryDay !== null && getDayIndexByNumber(galleryDay) < 0) {
      setGalleryDay(firstDayNumber);
    }
  }, [customItinerary.days, selectedDay, dayForModal, galleryDay]);

  useEffect(() => {
    if (!currentDay || editingActivityIndex === null) return;
    if (editingActivityIndex < 0 || editingActivityIndex >= currentDay.activities.length) {
      setEditingActivityIndex(null);
    }
  }, [currentDay, editingActivityIndex]);

  const intelligenceReport = useTripIntelligenceUi()?.report;
  useEffect(() => {
    const activity = currentDay && editingActivityIndex !== null
      ? currentDay.activities[editingActivityIndex]
      : undefined;
    intelligenceReport?.({
      dayNumber: selectedDay ?? undefined,
      selectedActivityId: activity?.id,
      selectedPlaceId: activity?.id,
    });
  }, [intelligenceReport, selectedDay, editingActivityIndex, currentDay]);

  const swipeHandlers = useSwipe({
    onSwipeLeft: () => {
      if (currentDayIndex >= 0 && currentDayIndex < totalDays - 1) {
        setSelectedDay(customItinerary.days[currentDayIndex + 1].day);
      }
    },
    onSwipeRight: () => {
      if (currentDayIndex > 0) {
        setSelectedDay(customItinerary.days[currentDayIndex - 1].day);
      }
    },
  });
  const sortedCurrentActivities = currentDay
    ? currentDay.activities
      .map((activity, originalIndex) => ({ activity, originalIndex }))
      .sort((a, b) => getTimeSortValue(a.activity.time) - getTimeSortValue(b.activity.time))
    : [];

  const routeRealityChecks = useMemo(() => {
    const visitingActivities = sortedCurrentActivities
      .map((item) => item.activity)
      .filter((activity) => activity.type !== 'food' && activity.type !== 'cafe');
    const result: Array<{
      fromName: string;
      toName: string;
      distanceKm: number | null;
      gapMinutes: number | null;
      estimatedTravelMinutes: number | null;
      isWarning: boolean;
      missingCoordinates: boolean;
    }> = [];

    for (let i = 0; i < visitingActivities.length - 1; i += 1) {
      const from = visitingActivities[i];
      const to = visitingActivities[i + 1];
      const fromTime = getTimeSortValue(from.time);
      const toTime = getTimeSortValue(to.time);
      const gapMinutes =
        Number.isFinite(fromTime) && Number.isFinite(toTime) && toTime > fromTime
          ? toTime - fromTime
          : null;

      if (!from.coordinates || !to.coordinates) {
        result.push({
          fromName: from.name,
          toName: to.name,
          distanceKm: null,
          gapMinutes,
          estimatedTravelMinutes: null,
          isWarning: false,
          missingCoordinates: true,
        });
        continue;
      }

      const distanceKm = haversineDistanceKm(from.coordinates, to.coordinates);
      const estimatedTravelMinutes = Math.max(5, Math.round(distanceKm * 3));
      const isWarning = gapMinutes !== null && gapMinutes < estimatedTravelMinutes + 15;

      result.push({
        fromName: from.name,
        toName: to.name,
        distanceKm,
        gapMinutes,
        estimatedTravelMinutes,
        isWarning,
        missingCoordinates: false,
      });
    }

    return result;
  }, [sortedCurrentActivities]);

  const handleTitleEdit = (newTitle: string) => {
    if (!newTitle.trim()) return;
    
    // Check if we are editing the plan name (Overview) or a specific day title (Detail)
    if (selectedDay === null) {
      // Editing Plan Name
      const updatedItinerary = markManualFieldEdits(customItinerary, { name: newTitle });
      setCustomItinerary(updatedItinerary);
      // Itinerary name is not in the 'itineraries' array in data.ts structure directly as a mutable field for the list, 
      // but here we are editing the 'customItinerary' object which is what's displayed.
      // We also need to update the parent if possible, but 'onItineraryChange' expects an Itinerary object.
      onItineraryChange?.(updatedItinerary);
    } else {
      // Editing Day Title
      const updatedDays = customItinerary.days.map(day => 
        day.day === selectedDay ? { ...day, title: newTitle } : day
      );
      const updatedItinerary = { ...customItinerary, days: updatedDays };
      setCustomItinerary(updatedItinerary);
      onItineraryChange?.(updatedItinerary);
    }
    setIsTitleEditing(false);
  };

  const handleOverviewDetailsSave = () => {
    const name = customItinerary.name.trim() || 'Untitled trip';
    const description = editedDescription.trim() || 'Add a short description for this trip.';
    const cities = Array.from(new Set(
      editedCities
        .split(',')
        .map((city) => city.trim())
        .filter(Boolean),
    ));
    const marqueeItems = Array.from(new Set(
      editedMarqueeItems
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ));
    const updatedCopy = markManualFieldEdits(customItinerary, {
      description,
      marquee: marqueeItems.join('\n'),
      overviewHeading: editedOverviewEyebrow.trim() || customItinerary.overviewEyebrow || '',
      overviewDescription: editedOverviewDescription.trim() || customItinerary.overviewDescription || '',
    });
    const updatedItinerary = {
      ...updatedCopy,
      name,
      description,
      cities,
      marqueeItems,
    };
    setCustomItinerary(updatedItinerary);
    onItineraryChange?.(updatedItinerary);
  };

  const handleDateEdit = (dayIndex: number) => {
    setEditingDateIndex(null);
    const targetDay = customItinerary.days[dayIndex];
    if (!targetDay) return;
    if (!editedDate.trim()) return;
    if (targetDay.date === editedDate) return;
    
    const updatedDays = customItinerary.days.map((day, idx) => 
      idx === dayIndex ? { ...day, date: editedDate } : day
    );
    const updatedItinerary = { ...customItinerary, days: updatedDays };
    setCustomItinerary(updatedItinerary);
    onItineraryChange?.(updatedItinerary);
  };

  const handleCityEdit = (dayIndex: number) => {
    setEditingCityIndex(null);
    const targetDay = customItinerary.days[dayIndex];
    if (!targetDay) return;
    if (!editedCity.trim()) return;
    if (targetDay.city === editedCity) return;
    
    const updatedDays = customItinerary.days.map((day, idx) => 
      idx === dayIndex ? { ...day, city: editedCity } : day
    );
    const updatedItinerary = { ...customItinerary, days: updatedDays };
    setCustomItinerary(updatedItinerary);
    onItineraryChange?.(updatedItinerary);
  };

  const onDragEnd = (result: any) => {
    if (!result.destination) return;

    const sourceIndex = result.source.index;
    const destinationIndex = result.destination.index;

    if (sourceIndex === destinationIndex) return;
    hapticSuccess();

    const newDays = Array.from(customItinerary.days);
    const [reorderedItem] = newDays.splice(sourceIndex, 1);
    newDays.splice(destinationIndex, 0, reorderedItem);

    // Update the 'day' number property to match new order
    const updatedDays = newDays.map((day, index) => ({
      ...day,
      day: index + 1
    }));

    const updatedItinerary = { ...customItinerary, days: updatedDays };
    setCustomItinerary(updatedItinerary);
    
    // Defer the parent state update and localStorage write 
    // so the drop animation can complete smoothly without main-thread stutter
    setTimeout(() => {
      onItineraryChange?.(updatedItinerary);
    }, 50);
  };

  // Overview Mode (Default)
  if (selectedDay === null) {
    return (
      <div className="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
        {/* Search Bar */}
        <div className="max-w-2xl mx-auto relative">
          <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
            <Search className="h-5 w-5 text-slate-400" />
          </div>
          <input
            type="text"
            className="editorial-input block w-full" style={{ paddingLeft: '2.75rem' }}
            placeholder={customItinerary.searchPlaceholder || 'Search itinerary, phrases, locations...'}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="text-center space-y-4">
          <span className="eyebrow">{customItinerary.overviewEyebrow || 'The itinerary · day by day'}</span>
          {isEditingMode && isTitleEditing ? (
            <div className="flex items-center justify-center gap-2">
              <input
                autoFocus
                type="text"
                value={editedTitle}
                onChange={(e) => setEditedTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleTitleEdit(editedTitle)}
                className="font-display text-5xl md:text-6xl bg-transparent border-b-2 border-[color:var(--accent)] text-center focus:outline-none"
                style={{ color: 'var(--ink)' }}
              />
              <button
                onClick={() => handleTitleEdit(editedTitle)}
                className="p-1 rounded-xl"
                style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-ink)' }}
              >
                <Save className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <h2
              className={clsx(
                "font-display text-5xl md:text-7xl leading-[0.95] tracking-tight flex items-center justify-center gap-3",
                isEditingMode && "cursor-pointer transition-colors"
              )}
              style={{ color: 'var(--ink)' }}
              onClick={() => {
                if (isEditingMode) {
                  setEditedTitle(customItinerary.name || `${customItinerary.days.length}-Day Adventure`);
                  setIsTitleEditing(true);
                }
              }}
            >
              {customItinerary.name || `${customItinerary.days.length}-Day Adventure`}
              {isEditingMode && <Edit2 className="w-5 h-5 opacity-50" />}
            </h2>
          )}

          <p className="text-base md:text-lg max-w-2xl mx-auto leading-relaxed flex items-center justify-center gap-2" style={{ color: 'var(--ink-muted)' }}>
            <span>
              {customItinerary.overviewDescription ? (
                customItinerary.overviewDescription
              ) : (
                <>
                  A slow, day-by-day field guide for <span className="font-display-italic">{customItinerary.cities.join(' & ')}</span> — good food, quiet sights, and enough breathing room to just wander.
                </>
              )}
            </span>
            {isEditingMode && (
              <button
                type="button"
                onClick={() => {
                  setEditedDescription(customItinerary.description);
                  setEditedCities(customItinerary.cities.join(', '));
                  setEditedMarqueeItems((customItinerary.marqueeItems || ['Travel Handbook', 'Plans', 'Notes', 'Maps', 'Photos']).join(', '));
                  setEditedOverviewEyebrow(customItinerary.overviewEyebrow || '');
                  setEditedOverviewDescription(customItinerary.overviewDescription || '');
                  setIsDetailsModalOpen(true);
                }}
                className="shrink-0 p-1 rounded-lg opacity-60 hover:opacity-100 transition-opacity"
                style={{ color: 'var(--accent)' }}
                aria-label="Edit trip details"
              >
                <Edit2 className="w-4 h-4" />
              </button>
            )}
          </p>

          {longTripNotice && (
            <p
              className="text-sm max-w-2xl mx-auto rounded-2xl px-4 py-3"
              style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--ink-muted)' }}
            >
              {longTripNotice}
            </p>
          )}

          <AnimatePresence>
            {isEditingMode && isDetailsModalOpen && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="fixed inset-0 z-50 flex items-center justify-center p-4"
                style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}
                onClick={() => setIsDetailsModalOpen(false)}
              >
                <motion.div
                  initial={{ opacity: 0, y: 12, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 8, scale: 0.98 }}
                  transition={{ duration: 0.18, ease: 'easeOut' }}
                  className="w-full max-w-lg rounded-2xl border p-4 text-left shadow-xl max-h-[85vh] overflow-y-auto"
                  style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-elevated)' }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-bold" style={{ color: 'var(--ink)' }}>Edit trip details</span>
                    <button
                      type="button"
                      onClick={() => setIsDetailsModalOpen(false)}
                      className="p-1 rounded-lg opacity-60 hover:opacity-100 transition-opacity"
                      style={{ color: 'var(--ink-muted)' }}
                      aria-label="Close"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="grid gap-3">
                    <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
                      Home banner description
                      <textarea
                        value={editedDescription}
                        onChange={(event) => setEditedDescription(event.target.value)}
                        rows={3}
                        className="editorial-input mt-1 w-full resize-y text-sm normal-case tracking-normal"
                        placeholder="Describe the feeling or purpose of this trip."
                      />
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
                        Itinerary eyebrow
                        <input
                          value={editedOverviewEyebrow}
                          onChange={(event) => setEditedOverviewEyebrow(event.target.value)}
                          className="editorial-input mt-1 w-full text-sm normal-case tracking-normal"
                          placeholder="The itinerary · day by day"
                        />
                      </label>
                      <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
                        Itinerary description
                        <input
                          value={editedOverviewDescription}
                          onChange={(event) => setEditedOverviewDescription(event.target.value)}
                          className="editorial-input mt-1 w-full text-sm normal-case tracking-normal"
                          placeholder="Sixteen days planned around wandering after dark."
                        />
                      </label>
                    </div>
                    <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
                      Cities or regions
                      <input
                        value={editedCities}
                        onChange={(event) => setEditedCities(event.target.value)}
                        className="editorial-input mt-1 w-full text-sm normal-case tracking-normal"
                        placeholder="Lisbon, Porto, Sintra"
                      />
                      <span className="mt-1 block text-xs normal-case tracking-normal" style={{ color: 'var(--ink-muted)' }}>Separate multiple places with commas.</span>
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
                      Scrolling strip labels
                      <input
                        value={editedMarqueeItems}
                        onChange={(event) => setEditedMarqueeItems(event.target.value)}
                        className="editorial-input mt-1 w-full text-sm normal-case tracking-normal"
                        placeholder="Travel Handbook, Plans, Notes, Maps, Photos"
                      />
                      <span className="mt-1 block text-xs normal-case tracking-normal" style={{ color: 'var(--ink-muted)' }}>Use commas to separate the labels shown in the marquee.</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        handleOverviewDetailsSave();
                        setIsDetailsModalOpen(false);
                      }}
                      className="pill-btn pill-primary justify-self-center"
                    >
                      Save trip details
                    </button>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex flex-wrap justify-center gap-2 sm:gap-4 mt-4">
            <button
              onClick={() => {
                const nextEditingMode = !isEditingMode;
                if (nextEditingMode) {
                  setEditedDescription(customItinerary.description);
                  setEditedCities(customItinerary.cities.join(', '));
                  setEditedMarqueeItems((customItinerary.marqueeItems || ['Travel Handbook', 'Plans', 'Notes', 'Maps', 'Photos']).join(', '));
                  setEditedOverviewEyebrow(customItinerary.overviewEyebrow || '');
                  setEditedOverviewDescription(customItinerary.overviewDescription || '');
                } else {
                  setIsDetailsModalOpen(false);
                }
                setIsEditingMode(nextEditingMode);
              }}
              className={clsx(
                "w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2 rounded-3xl text-sm font-medium transition-all",
                isEditingMode 
                  ? "bg-rose-500 text-white shadow-lg shadow-rose-500/30" 
                  : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:border-rose-200 dark:hover:border-rose-500/50"
              )}
            >
              {isEditingMode ? <Save className="w-4 h-4" /> : <Edit2 className="w-4 h-4" />}
              {isEditingMode ? 'Done Customizing' : 'Customize Plan'}
            </button>

            {planChanges && (
              <ItineraryChangeHistoryPanel key={planChanges.tripId} tripId={planChanges.tripId} tripName={planChanges.tripName} />
            )}
            
            {isEditingMode && (
              <button
                onClick={resetToDefault}
                className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2 rounded-3xl text-sm font-medium bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-red-50 dark:hover:bg-red-900/30 hover:text-red-500 transition-all"
              >
                <RefreshCw className="w-4 h-4" />
                Reset
              </button>
            )}
          </div>
        </div>

        {plannerProfile && (
          <>
            {(customItinerary.unassignedActivities?.length || 0) > 0 && (
              <section className="rounded-3xl p-4 sm:p-5 space-y-3" style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)' }}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="eyebrow m-0">Activity inbox</div>
                    <h3 className="font-display text-2xl mt-2">Confirmed places waiting for a day.</h3>
                  </div>
                  <span className="rounded-full px-2.5 py-1 text-xs font-semibold" style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--ink)' }}>
                    {customItinerary.unassignedActivities?.length} unassigned
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {customItinerary.unassignedActivities?.map((activity) => (
                    <span key={activity.id} className="rounded-full px-3 py-1.5 text-xs font-semibold" style={{ border: '1px solid var(--border)', color: 'var(--ink-muted)' }}>
                      {activity.name}
                    </span>
                  ))}
                </div>
                <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>Organise my saved places will distribute these confirmed activities across available days. Nothing is discarded if it cannot be scheduled.</p>
              </section>
            )}
          <PlannerPreview
            itinerary={customItinerary}
            profile={plannerProfile}
            onItineraryChange={(next) => {
              setCustomItinerary(next);
              onItineraryChange?.(next);
            }}
          />
          </>
        )}

        {/* Days Grid - Overview */}
        <DragDropContext onDragEnd={onDragEnd}>
          <Droppable droppableId="itinerary-days">
            {(provided) => (
              <div 
                {...provided.droppableProps}
                ref={provided.innerRef}
                className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-7xl mx-auto place-items-center"
              >
                {filteredDays.map((day, index) => (
                  <Draggable 
                    key={`day-${day.day}`} 
                    draggableId={`day-${day.day}`} 
                    index={index}
                    isDragDisabled={!isEditingMode}
                  >
                    {(provided, snapshot) => (
                      <motion.div
                        id={index === 0 ? 'itinerary-first-day' : undefined}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.05, duration: 0.3, ease: 'easeOut' }}
                        ref={provided.innerRef}
                        {...provided.draggableProps}
                        className={clsx(
                          "w-full h-full",
                          snapshot.isDragging && "z-50"
                        )}
                        style={provided.draggableProps.style}
                      >
                        <div
                          className={clsx(
                            "w-full h-full trip-surface-card p-6 group flex flex-col relative overflow-hidden",
                            snapshot.isDragging
                              ? "shadow-2xl scale-105 rotate-2"
                              : "hover:shadow-xl hover:-translate-y-1"
                          )}
                          style={{
                            borderColor: snapshot.isDragging ? 'var(--accent)' : undefined,
                          }}
                        >
                          <div
                            className="handbook-motif"
                            data-motif={visualIdentity?.motifSet && visualIdentity.motifSet !== 'none' ? visualIdentity.motifSet : undefined}
                            aria-hidden="true"
                          />
                          <div className="flex justify-between items-start mb-3 md:mb-4 gap-2 relative z-[1]">
                            <div className="flex items-start md:items-center gap-2 md:gap-3 flex-wrap">
                              {isEditingMode && (
                                <div 
                                  {...provided.dragHandleProps}
                                  className="p-1 md:p-1.5 -ml-1 md:-ml-2 text-slate-300 hover:text-slate-500 cursor-grab active:cursor-grabbing rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 self-start mt-0.5 md:mt-0"
                                >
                                  <GripVertical className="w-4 h-4 md:w-5 md:h-5" />
                                </div>
                              )}
                              <div
                                className={clsx(
                                  "font-display handbook-display text-5xl md:text-6xl leading-none whitespace-nowrap transition-transform origin-left",
                                  !isEditingMode && "group-hover:scale-105 cursor-pointer"
                                )}
                                style={{ color: 'var(--accent)' }}
                                onClick={() => !isEditingMode && setSelectedDay(day.day)}
                              >
                                {String(day.day).padStart(2, '0')}
                              </div>
                            </div>
                            
                            {isEditingMode && editingDateIndex === index ? (
                              <div className="flex items-center gap-1.5">
                                <input
                                  autoFocus
                                  type="text"
                                  value={editedDate}
                                  onChange={(e) => setEditedDate(e.target.value)}
                                  onKeyDown={(e) => e.key === 'Enter' && handleDateEdit(index)}
                                  placeholder="e.g. Apr 23"
                                  className="editorial-input is-compact w-16 md:w-24" style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em' }}
                                />
                                <button 
                                  onClick={() => handleDateEdit(index)}
                                  className="p-1 text-emerald-500 hover:bg-emerald-50 rounded"
                                >
                                  <Save className="w-3 h-3" />
                                </button>
                              </div>
                            ) : (
                              <div 
                                className={clsx(
                                  "text-[10px] md:text-xs font-bold text-slate-400 uppercase tracking-widest text-right shrink-0 mt-1 md:mt-0",
                                  isEditingMode && "cursor-pointer hover:text-rose-500 flex items-center gap-1"
                                )}
                                onClick={() => {
                                  if (isEditingMode) {
                                    setEditedDate(day.date);
                                    setEditingDateIndex(index);
                                  }
                                }}
                              >
                                {day.date}
                                {isEditingMode && <Edit2 className="w-3 h-3 opacity-50" />}
                              </div>
                            )}
                          </div>
                          
                          <h3
                            className={clsx(
                              "font-display text-2xl md:text-3xl leading-tight mb-2 line-clamp-2 transition-colors",
                              !isEditingMode && "cursor-pointer"
                            )}
                            style={{ color: 'var(--ink)' }}
                            onClick={() => !isEditingMode && setSelectedDay(day.day)}
                          >
                            {day.title}
                          </h3>

                          {day.activities.length === 0 && (
                            <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>
                              No plans yet.
                            </p>
                          )}

                          <div 
                            className={clsx(
                              "mt-auto pt-4 flex items-center justify-between text-sm text-slate-500 dark:text-slate-400 border-t border-slate-50 dark:border-slate-800",
                              !isEditingMode && "cursor-pointer"
                            )}
                            onClick={() => !isEditingMode && setSelectedDay(day.day)}
                          >
                            {isEditingMode && editingCityIndex === index ? (
                              <div className="flex items-center gap-1.5">
                                <MapPin className="w-4 h-4 text-slate-400" />
                                <input
                                  autoFocus
                                  type="text"
                                  value={editedCity}
                                  onChange={(e) => setEditedCity(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      handleCityEdit(index);
                                    }
                                  }}
                                  onBlur={() => handleCityEdit(index)}
                                  className="editorial-input is-compact w-24"
                                  onClick={(e) => e.stopPropagation()}
                                />
                              </div>
                            ) : (
                              <div 
                                className={clsx(
                                  "flex items-center gap-1.5 min-w-0",
                                  isEditingMode && "cursor-pointer hover:text-rose-500"
                                )}
                                onClick={(e) => {
                                  if (isEditingMode) {
                                    e.stopPropagation();
                                    setEditedCity(day.city);
                                    setEditingCityIndex(index);
                                  }
                                }}
                              >
                                <MapPin className="w-4 h-4 text-slate-400" />
                                <span className="truncate">{day.city}</span>
                                {isEditingMode && <Edit2 className="w-3 h-3 opacity-50" />}
                              </div>
                            )}
                            {/* A generated day is a date and a place, not an
                                empty list: say so and offer the next step. */}
                            {day.activities.length === 0 ? (
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  // The add form lives in the day view, so open
                                  // the day first and the modal with it.
                                  setSelectedDay(day.day);
                                  handleAddActivity(day.day);
                                }}
                                className="text-[11px] md:text-xs px-2 py-1 rounded-lg shrink-0 flex items-center gap-1.5 font-semibold"
                                style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
                              >
                                <Plus className="w-3 h-3" />
                                Add your first activity
                              </button>
                            ) : (
                              <div className="text-[11px] md:text-xs bg-slate-50 dark:bg-slate-800 px-2 py-1 rounded-lg group-hover:bg-rose-50 dark:group-hover:bg-rose-900/30 group-hover:text-rose-600 dark:group-hover:text-rose-400 transition-colors shrink-0 flex items-center gap-1.5">
                                <Utensils className="w-3 h-3" />
                                {day.activities.length} {day.activities.length === 1 ? 'spot' : 'spots'}
                              </div>
                            )}
                          </div>

                          {/* Decorative hover gradient */}
                          {!isEditingMode && (
                            <div 
                              className="absolute inset-0 bg-gradient-to-br from-rose-50/0 to-rose-50/30 dark:to-rose-900/10 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none cursor-pointer"
                              onClick={() => setSelectedDay(day.day)}
                            ></div>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </Draggable>
                ))}
                {provided.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>
        
        {filteredDays.length === 0 && (
          <div className="text-center py-20 text-slate-400">
            No days found matching "{searchQuery}"
          </div>
        )}
      </div>
    );
  }

  if (!currentDay) {
    return (
      <div className="space-y-4 rounded-3xl border p-6 text-center" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-elevated)' }}>
        <div className="text-sm font-medium" style={{ color: 'var(--ink-muted)' }}>
          This day is no longer available. Returning to the overview keeps the itinerary safe.
        </div>
        <div className="flex justify-center">
          <button
            onClick={() => setSelectedDay(null)}
            className="px-4 py-2 rounded-3xl text-sm font-medium"
            style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-ink)' }}
          >
            Back to Overview
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
      {/* Navigation Header */}
      <div className="flex items-center justify-between gap-2">
        <button 
          onClick={() => setSelectedDay(null)}
          className="flex items-center gap-2 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors font-medium px-4 py-2 rounded-3xl hover:bg-white dark:hover:bg-slate-800"
        >
          <ChevronLeft className="w-5 h-5" /> Back to Overview
        </button>

        <div className="flex items-center gap-2">
        <button
          onClick={() => setIsEditingMode(!isEditingMode)}
          className={clsx(
            "flex items-center gap-2 px-3 md:px-4 py-2 rounded-3xl text-sm font-medium transition-all",
            isEditingMode 
              ? "bg-rose-500 text-white shadow-lg shadow-rose-500/30" 
              : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:border-rose-200 dark:hover:border-rose-500/50"
          )}
        >
          {isEditingMode ? <Save className="w-4 h-4" /> : <Edit2 className="w-4 h-4" />}
          <span className="hidden sm:inline">{isEditingMode ? 'Done' : 'Customize'}</span>
        </button>

        <button
          onClick={() => setGalleryDay(selectedDay)}
          className="flex items-center gap-2 px-3 md:px-4 py-2 rounded-3xl text-sm font-medium bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:border-rose-200 dark:hover:border-rose-500/50 hover:text-rose-500 transition-all"
        >
          <ImageIcon className="w-4 h-4" />
          <span className="hidden sm:inline">Photos</span>
          {dayPhotos[selectedDay!] && dayPhotos[selectedDay!].length > 0 && (
            <span className="w-5 h-5 rounded-full bg-rose-500 text-white text-xs flex items-center justify-center">
              {dayPhotos[selectedDay!].length}
            </span>
          )}
        </button>

        </div>
      </div>

      {/* Day Selector (Wrapping) */}
      <div className="flex flex-wrap gap-2 md:gap-3 justify-center">
        {customItinerary.days.map((day) => (
          <button
            key={day.day}
            onClick={() => setSelectedDay(day.day)}
            className={clsx(
              "w-24 md:w-32 p-2 md:p-3 rounded-3xl border transition-all text-center group relative overflow-hidden",
              selectedDay === day.day
                ? "bg-slate-900 dark:bg-rose-600 text-white border-slate-900 dark:border-rose-600 shadow-lg scale-105"
                : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-800 hover:border-rose-200 dark:hover:border-rose-500/50 hover:-translate-y-0.5"
            )}
          >
            <div className={clsx("text-[10px] md:text-xs font-bold uppercase tracking-wider mb-0.5 md:mb-1 opacity-70")}>
              {day.date}
            </div>
            <div className="font-extrabold text-base md:text-xl mb-0.5 md:mb-1">
              <span className={clsx(
                selectedDay === day.day 
                  ? "text-white/70 dark:text-white/75"
                  : "text-slate-500 dark:text-slate-400"
              )}>Day</span>{' '}
              <span className={clsx(
                selectedDay === day.day
                  ? "text-rose-300 dark:text-white"
                  : "text-rose-500 dark:text-rose-400"
              )}>{day.day}</span>
            </div>
            <div className="text-[10px] md:text-xs truncate font-medium opacity-80">
              {day.city}
            </div>
          </button>
        ))}
      </div>

      {/* Day Details — swipe left/right to change day on mobile */}
      <AnimatePresence mode="wait">
        <motion.div
          key={customItinerary.id + selectedDay}
          initial={{ opacity: 0, y: 15, filter: 'blur(4px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: -10, filter: 'blur(4px)' }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="space-y-4 md:space-y-6"
          {...swipeHandlers}
        >
          <div
            // z-[41] keeps the roaming pet overlay (fixed, z-40 — see Pets.tsx)
            // walking behind this card instead of across its text.
            className="p-5 md:p-8 rounded-3xl shadow-sm border relative z-[41] overflow-hidden"
            style={{
              background: 'linear-gradient(135deg, var(--bg-elevated) 0%, color-mix(in srgb, var(--bg) 70%, var(--bg-elevated)) 100%)',
              borderColor: 'var(--border)',
            }}
          >
            <div className="absolute top-0 right-0 p-4 md:p-8 opacity-5 pointer-events-none">
              <MapPin className="w-20 h-20 md:w-32 md:h-32 text-slate-900 dark:text-white" />
            </div>
            <div className="relative z-10">
              <div className="text-[10px] md:text-xs font-bold text-rose-500 uppercase tracking-widest mb-1 md:mb-2">Current Location</div>
              
              {isEditingMode && isTitleEditing ? (
                <div className="flex items-center gap-2 mb-2 md:mb-3">
                  <input
                    autoFocus
                    type="text"
                    value={editedTitle}
                    onChange={(e) => setEditedTitle(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleTitleEdit(editedTitle)}
                    className="editorial-input w-full" style={{ fontSize: '1.5rem', fontWeight: 800 }}
                  />
                  <button 
                    onClick={() => handleTitleEdit(editedTitle)}
                    className="p-1.5 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600"
                  >
                    <Save className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <h2 
                  className={clsx(
                    "text-2xl md:text-3xl font-extrabold text-slate-900 dark:text-white mb-2 md:mb-3 tracking-tight flex items-center gap-3",
                    isEditingMode && "cursor-pointer hover:text-rose-500 transition-colors"
                  )}
                  onClick={() => {
                    if (isEditingMode) {
                      setEditedTitle(currentDay.title);
                      setIsTitleEditing(true);
                    }
                  }}
                >
                  {currentDay.title}
                  {isEditingMode && <Edit2 className="w-5 h-5 opacity-50" />}
                </h2>
              )}

              <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 font-medium text-sm md:text-base">
                <div className="p-1.5 bg-white dark:bg-slate-800 rounded-xl shadow-sm">
                  <MapPin className="w-3.5 h-3.5 md:w-4 md:h-4 text-rose-500" />
                </div>
                {currentDay.city}
              </div>
            </div>
          </div>

          {routeRealityChecks.length > 0 && (
            <div
              className="rounded-3xl border p-4 md:p-5 space-y-2 relative z-[41]"
              style={{
                backgroundColor: 'var(--bg-elevated)',
                borderColor: 'var(--border)',
              }}
            >
              <div className="flex items-center gap-2 text-slate-800 dark:text-slate-100">
                <div className="p-1.5 rounded-xl bg-slate-100 dark:bg-slate-800">
                  <Train className="w-4 h-4 text-rose-500" />
                </div>
                <h3 className="font-bold text-sm md:text-base">Route Reality Check</h3>
                <span className="text-[11px] text-slate-500 dark:text-slate-400">(non-food places)</span>
              </div>
              <div className="space-y-2">
                {routeRealityChecks.map((check, index) => (
                  <div
                    key={`${check.fromName}-${check.toName}-${index}`}
                    className={clsx("rounded-2xl border px-3 py-2 text-xs md:text-sm")}
                    style={check.isWarning
                      ? {
                          borderColor: 'color-mix(in srgb, var(--warn) 40%, var(--border))',
                          backgroundColor: 'color-mix(in srgb, var(--warn) 10%, var(--bg-elevated))',
                        }
                      : {
                          borderColor: 'var(--border)',
                          backgroundColor: 'color-mix(in srgb, var(--bg) 70%, var(--bg-elevated))',
                        }}
                  >
                    <div className="font-semibold text-slate-700 dark:text-slate-200">
                      {check.fromName} → {check.toName}
                    </div>
                    {check.missingCoordinates ? (
                      <div className="text-slate-500 dark:text-slate-400">
                        Add map coordinates to both places to calculate distance.
                      </div>
                    ) : (
                      <div className="text-slate-600 dark:text-slate-300 flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span>{check.distanceKm!.toFixed(1)} km apart</span>
                        <span>~{check.estimatedTravelMinutes} min transfer</span>
                        {check.gapMinutes !== null && <span>Gap: {check.gapMinutes} min</span>}
                      </div>
                    )}
                    {check.isWarning && (
                      <div className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        Planned time may be too tight for this transfer.
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-4">
            {sortedCurrentActivities.map(({ activity, originalIndex }, idx) => (
              <motion.div
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.08, duration: 0.4, ease: 'easeOut' }}
                key={`${activity.name}-${activity.time}-${originalIndex}`}
                className="relative group/edit"
              >
                <ActivityItem
                  activity={activity}
                  dayDate={isoDateForDay(currentDay.day)}
                  timezone={tripTimezone}
                  isEditing={isEditingMode && editingActivityIndex === originalIndex}
                  onEdit={(updated) => handleUpdateActivity(currentDay.day, originalIndex, updated)}
                  onDelete={() => handleDeleteActivity(currentDay.day, originalIndex)}
                />
                
                {isEditingMode && editingActivityIndex !== originalIndex && (
                  <button 
                    type="button"
                    aria-label={`Edit ${activity.name}`}
                    onClick={() => setEditingActivityIndex(originalIndex)}
                    className="absolute top-4 right-4 p-2 bg-white dark:bg-slate-800 rounded-xl shadow-sm text-slate-400 hover:text-rose-500 opacity-0 group-hover/edit:opacity-100 transition-all md:opacity-0 opacity-100"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                )}
              </motion.div>
            ))}

            {isEditingMode && (
              <button
                onClick={() => handleAddActivity(currentDay.day)}
                className="w-full py-4 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-3xl flex items-center justify-center gap-2 text-slate-400 dark:text-slate-500 hover:border-rose-300 hover:text-rose-500 transition-all"
              >
                <Plus className="w-5 h-5" />
                Add Activity
              </button>
            )}
          </div>
        </motion.div>
      </AnimatePresence>

      {/* Add Activity Modal */}
      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
              onClick={() => setShowAddModal(false)}
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white dark:bg-slate-900 w-full max-w-md max-h-[min(90dvh,44rem)] overflow-y-auto rounded-2xl shadow-2xl p-6 relative z-10 border border-slate-100 dark:border-slate-800"
            >
              <button 
                onClick={() => setShowAddModal(false)}
                className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>

              <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-6">Add Activity</h3>
              
              {/* Search Integration */}
                <div className="mb-6 relative">
                  <form onSubmit={handleSearch} className="relative">
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search place to autofill..."
                      className="editorial-input w-full" style={{ paddingLeft: '2.5rem' }}
                    />
                    <Search className="absolute left-3 top-3 w-4 h-4 text-slate-400" />
                    <button 
                      type="submit"
                      className="absolute right-2 top-2 bg-emerald-500 text-white p-1 rounded-xl hover:bg-emerald-600 transition-colors"
                      disabled={isSearching}
                    >
                      {isSearching ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-xl animate-spin" /> : <Search className="w-3 h-3" />}
                    </button>
                  </form>

                {/* Search Results Dropdown */}
                {searchResults.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-slate-800 rounded-3xl shadow-xl border border-slate-100 dark:border-slate-700 max-h-64 overflow-y-auto z-20">
                    {searchResults.map((place, i) => (
                      <div key={i} className="p-3 border-b dark:border-slate-700 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                        <div 
                          className="cursor-pointer mb-3"
                          onClick={() => {
                            setNewActivity((prev) => ({
                              ...prev,
                              name: place.display_name.split(',')[0],
                              location: place.display_name.split(',').slice(1, 3).join(','),
                              coordinates: [parseFloat(place.lat), parseFloat(place.lon)]
                            }));
                            setSearchResults([]);
                            setSearchQuery('');
                          }}
                        >
                          <h4 className="font-bold text-slate-900 dark:text-white text-sm line-clamp-1">{place.display_name.split(',')[0]}</h4>
                          <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 mt-0.5">{place.display_name}</p>
                        </div>
                        
                        <div className="flex gap-2">
                          <a 
                            href={`https://www.google.com/search?q=${encodeURIComponent(place.display_name)}&tbm=isch`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex-1 py-1.5 bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-[10px] font-bold rounded-xl border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-600 flex items-center justify-center gap-1.5 transition-colors"
                          >
                            <Camera className="w-3 h-3" /> View Photos
                          </a>
                          <button 
                            onClick={() => {
                              setNewActivity((prev) => ({
                                ...prev,
                                name: place.display_name.split(',')[0],
                                location: place.display_name.split(',').slice(1, 3).join(','),
                                coordinates: [parseFloat(place.lat), parseFloat(place.lon)]
                              }));
                              setSearchResults([]);
                              setSearchQuery('');
                            }}
                            className="flex-1 py-1.5 bg-emerald-500 text-white text-[10px] font-bold rounded-xl hover:bg-emerald-600 flex items-center justify-center gap-1.5 transition-colors shadow-sm shadow-emerald-500/20"
                          >
                            <Plus className="w-3 h-3" /> Add
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Form Fields */}
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Activity Name</label>
                    <input
                      type="text"
                      value={newActivity.name}
                      onChange={(e) => setNewActivity({...newActivity, name: e.target.value})}
                      placeholder="e.g. Visit Museum"
                      className="editorial-input w-full"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Time</label>
                    <div className="relative">
                      <input
                        type="time"
                        value={newActivity.time}
                        onChange={(e) => setNewActivity({...newActivity, time: e.target.value})}
                        className="editorial-input w-full"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Location</label>
                  <div className="relative">
                    <input
                      type="text"
                      value={newActivity.location}
                      onChange={(e) => setNewActivity({...newActivity, location: e.target.value})}
                      placeholder="Address or area"
                      className="editorial-input w-full" style={{ paddingLeft: '2.5rem' }}
                    />
                    <MapPin className="absolute left-3 top-3 w-4 h-4 text-slate-400 pointer-events-none" />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Category</label>
                  <div className="relative">
                    <select
                      value={newActivity.type}
                      onChange={(e) => {
                        setNewActivity({...newActivity, type: e.target.value as ActivityType});
                        setAddFlightDurationError('');
                      }}
                      className="editorial-select w-full"
                    >
                      {ICON_OPTIONS.map(opt => (
                        <option key={opt.id} value={opt.id}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {newActivity.type === 'flight' && (
                  <FlightDurationFields
                    idPrefix="add-flight-duration"
                    hours={addFlightHours}
                    minutes={addFlightMinutes}
                    onHoursChange={(value) => {
                      setAddFlightHours(value);
                      setAddFlightDurationError('');
                    }}
                    onMinutesChange={(value) => {
                      setAddFlightMinutes(value);
                      setAddFlightDurationError('');
                    }}
                    error={addFlightDurationError}
                  />
                )}

                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Description</label>
                  <textarea
                    value={newActivity.description}
                    onChange={(e) => setNewActivity({...newActivity, description: e.target.value})}
                    placeholder="Add details..."
                    className="editorial-textarea w-full" style={{ resize: 'none', minHeight: '5rem' }}
                  />
                </div>

                {/* Google Links Preview if location set */}
                {newActivity.name && (
                  <div className="flex gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                    <a 
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(newActivity.name + ' ' + (newActivity.location || ''))}`}
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-bold transition-colors"
                      style={{
                        backgroundColor: 'var(--bg)',
                        color: 'var(--accent)',
                      }}
                    >
                      <ExternalLink className="w-3.5 h-3.5" /> Preview Map
                    </a>
                    <a 
                      href={`https://www.google.com/search?q=${encodeURIComponent(newActivity.name + ' ' + (newActivity.location || ''))}&tbm=isch`}
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="flex-1 flex items-center justify-center gap-2 py-2 bg-slate-50 dark:bg-slate-800 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                    >
                      <Camera className="w-3.5 h-3.5" /> Preview Photos
                    </a>
                  </div>
                )}

                <button
                  onClick={confirmAddActivity}
                  disabled={!newActivity.name}
                  className={clsx(
                    "w-full font-bold py-4 rounded-3xl flex items-center justify-center gap-2 mt-4 transition-all shadow-lg",
                    !newActivity.name 
                      ? "bg-slate-200 text-slate-400 cursor-not-allowed" 
                      : "bg-slate-900 dark:bg-emerald-600 text-white hover:scale-[1.02] active:scale-[0.98] shadow-slate-900/20"
                  )}
                >
                  <Save className="w-5 h-5" />
                  Save Activity
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Photo Gallery Modal */}
      <PhotoGallery
        itineraryId={customItinerary.id}
        dayNumber={galleryDay!}
        dayTitle={customItinerary.days.find(d => d.day === galleryDay)?.title || ''}
        isOpen={galleryDay !== null}
        onClose={() => setGalleryDay(null)}
      />
    </div>
  );
};

