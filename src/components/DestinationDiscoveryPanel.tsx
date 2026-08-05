import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Database,
  ExternalLink,
  LayoutGrid,
  Layers,
  MapPinned,
  Sparkles,
  Star,
  Undo2,
  X,
} from 'lucide-react';
import { AnimatePresence, motion, useMotionValue, useReducedMotion, useTransform } from 'framer-motion';
import type { DiscoveryCandidateDecision, Itinerary } from '../data';
import { FixturePlaceDiscoveryProvider } from '../lib/destinationFixtures';
import { EMPTY_PROVIDER_RUNTIME, canDiscover, describeCapability, type ProviderRuntime } from '../lib/destinationCapability';
import { capabilityFor, discoverPlaces, loadProviderRuntime, parseCurrentEvents, parseWeatherRisk } from '../lib/discoveryRuntime';
import type { PlaceEvidenceSummary } from '../lib/travelEvidence';
import { hapticMedium, hapticSuccess, hapticTap } from '../lib/haptics';
import { invokeTravelFunction, isSupabaseConfigured } from '../lib/supabase';
import type { CandidateDecision, PlaceCandidate, RankedCandidate } from '../lib/destinationIntelligence';
import type { RouteLeg, RouteResolver } from '../lib/humanScheduler';
import {
  buildDestinationItinerary,
  defaultDiscoveryDecisions,
  rankWithIntelligence,
  type DestinationBuildResult,
} from '../lib/destinationPlanner';
import type { TripProfile } from '../lib/tripProfile';

interface DestinationDiscoveryPanelProps {
  itinerary: Itinerary;
  profile: TripProfile;
  onItineraryChange: (itinerary: Itinerary) => void;
}

type DiscoveryPhase = 'idle' | 'review' | 'preview' | 'built';

const SWIPE_COMMIT_PX = 110;

const GROUPS = [
  { id: 'essentials', label: 'Essentials', matches: ['essential'] },
  { id: 'local', label: 'Local character', matches: ['local-character', 'shopping'] },
  { id: 'culture', label: 'Culture and history', matches: ['history', 'museum', 'temple', 'shrine', 'art'] },
  { id: 'food', label: 'Food and markets', matches: ['food', 'market', 'food-district'] },
  { id: 'nature', label: 'Nature and views', matches: ['nature', 'park', 'garden', 'view', 'waterfront'] },
  { id: 'evening', label: 'Evening options', matches: ['evening'] },
  { id: 'day-trips', label: 'Nearby day trips', matches: ['day-trip'] },
] as const;

const DECISIONS: Array<{ id: DiscoveryCandidateDecision; label: string }> = [
  { id: 'must-do', label: 'Must do' },
  { id: 'interested', label: 'Interested' },
  { id: 'skip', label: 'Skip' },
  { id: 'visited', label: 'Visited' },
];

const DECISION_LABEL: Record<CandidateDecision, string> = {
  'must-do': 'Must do',
  interested: 'Interested',
  skip: 'Skip',
  visited: 'Visited',
};

const formatDuration = (minutes: number) => minutes >= 120 && minutes % 60 === 0
  ? `${minutes / 60} hr`
  : `${minutes} min`;

const DESKTOP_REVIEW_MODE_KEY = 'planitenary:destination-review-mode';

const formatPrice = (priceLevel?: number) => {
  if (priceLevel === undefined) return 'Cost unknown';
  if (priceLevel === 0) return 'Free';
  return `${'¥'.repeat(Math.min(4, Math.max(1, priceLevel)))} price level`;
};

const openingSummary = (candidate: PlaceCandidate) => {
  const period = candidate.openingHours?.periods[0];
  if (!period?.opensAt || !period.closesAt) return 'Hours need live verification';
  return `${period.opensAt}–${period.closesAt} · ${candidate.openingHours?.sourceConfidence} confidence`;
};

const RESERVATION_LABEL: Record<PlaceCandidate['reservationStatus'], string | null> = {
  required: 'Booking required',
  recommended: 'Booking recommended',
  'not-needed': 'No booking needed',
  unknown: null,
};

const INDOOR_LABEL: Record<PlaceCandidate['indoorOutdoor'], string> = {
  indoor: 'Indoor · fine in rain',
  outdoor: 'Outdoor · weather matters',
  mixed: 'Indoor and outdoor',
};

const formatVerifiedAt = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

const useIsMobileReview = () => {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  return isMobile;
};

interface UndoState {
  candidateId: string;
  name: string;
  previous?: CandidateDecision;
  next: CandidateDecision;
}

/** Extra, honestly-sourced context a card can show when there is room for it. */
interface CandidateContext {
  evidence?: PlaceEvidenceSummary;
  queueMinutes?: number;
}

/**
 * A real photograph of the place when a provider supplied one, and a labelled
 * neighbourhood placard when it did not. Never a stand-in image of somewhere
 * else — a traveller has to be able to trust that the picture is the place.
 */
function PlaceMedia({ candidate, className }: { candidate: PlaceCandidate; className?: string }) {
  // Remember which URL broke rather than a bare flag, so a new place starts
  // trusted again without an effect to reset it.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showPhoto = Boolean(candidate.photoUrl) && failedUrl !== candidate.photoUrl;

  return (
    <div className={`destination-place-media${className ? ` ${className}` : ''}`} data-has-photo={showPhoto ? 'true' : 'false'}>
      {showPhoto ? (
        <img
          src={candidate.photoUrl}
          alt={`${candidate.name}, ${candidate.neighbourhood || candidate.city}`}
          loading="lazy"
          decoding="async"
          onError={() => setFailedUrl(candidate.photoUrl ?? null)}
        />
      ) : (
        <div className="destination-place-media-fallback" aria-hidden="true">
          <MapPinned className="w-5 h-5" />
          <span>{candidate.neighbourhood || candidate.city}</span>
        </div>
      )}
      {showPhoto && candidate.photoAttribution && (
        <small className="destination-photo-credit">{candidate.photoAttribution}</small>
      )}
    </div>
  );
}

/**
 * Everything worth knowing before keeping or skipping a place: what it costs in
 * time and money, when it is open, how crowded it gets, what other travellers
 * consistently say, and where all of that came from. Facts with no source are
 * simply omitted rather than filled with a plausible guess.
 */
function CandidateDetails({ ranked, context }: { ranked: RankedCandidate; context?: CandidateContext }) {
  const { candidate, reasons, cautions = [] } = ranked;
  const evidence = context?.evidence;
  const queueMinutes = context?.queueMinutes ?? evidence?.typicalQueueMinutes;
  const bestWindow = candidate.bestTimeWindows?.[0];
  const reservation = RESERVATION_LABEL[candidate.reservationStatus];
  const verifiedAt = formatVerifiedAt(candidate.lastVerifiedAt);
  const crowdLabel = evidence?.crowdRisk === undefined
    ? null
    : evidence.crowdRisk >= 0.66 ? 'Busy most of the day'
      : evidence.crowdRisk >= 0.33 ? 'Moderately busy' : 'Rarely crowded';
  const tags = candidate.experienceTags.slice(0, 5);

  const specs: Array<{ label: string; value: string }> = [
    { label: 'Time needed', value: formatDuration(evidence?.typicalVisitMinutes || candidate.estimatedVisitMinutes) },
    { label: 'Cost', value: formatPrice(candidate.priceLevel) },
    { label: 'Opening hours', value: openingSummary(candidate) },
  ];
  if (queueMinutes) specs.push({ label: 'Typical queue', value: `${Math.round(queueMinutes)} min reported` });
  if (bestWindow) specs.push({ label: 'Best time', value: `${bestWindow.start}–${bestWindow.end}` });
  if (crowdLabel) specs.push({ label: 'Crowding', value: crowdLabel });
  if (reservation) specs.push({ label: 'Booking', value: reservation });
  specs.push({ label: 'Weather', value: INDOOR_LABEL[candidate.indoorOutdoor] });
  specs.push({ label: 'Area', value: candidate.neighbourhood || candidate.city });

  return (
    <div className="destination-detail">
      {candidate.description && <p className="destination-detail-description">{candidate.description}</p>}

      {(candidate.rating || tags.length > 0) && (
        <div className="destination-detail-chips">
          {candidate.rating && (
            <span className="destination-detail-chip is-rating">
              <Star className="w-3 h-3" aria-hidden="true" />
              {candidate.rating.toFixed(1)}
              {candidate.reviewCount ? ` · ${candidate.reviewCount.toLocaleString()} reviews` : ''}
            </span>
          )}
          {tags.map((tag) => (
            <span key={tag} className="destination-detail-chip">{tag.replace(/-/g, ' ')}</span>
          ))}
        </div>
      )}

      <dl className="destination-detail-specs">
        {specs.map((spec) => (
          <div key={spec.label}>
            <dt>{spec.label}</dt>
            <dd>{spec.value}</dd>
          </div>
        ))}
      </dl>

      {reasons.length > 0 && (
        <div className="destination-detail-section">
          <h6>Why it ranks here</h6>
          <ul className="destination-detail-list">
            {reasons.slice(0, 4).map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
        </div>
      )}

      {evidence && (evidence.positiveThemes.length > 0 || evidence.negativeThemes.length > 0) && (
        <div className="destination-detail-section">
          <h6>What travellers repeat</h6>
          <ul className="destination-detail-list">
            {evidence.positiveThemes.slice(0, 3).map((theme) => (
              <li key={`positive-${theme}`} className="is-positive">{theme}</li>
            ))}
            {evidence.negativeThemes.slice(0, 3).map((theme) => (
              <li key={`negative-${theme}`} className="is-negative">{theme}</li>
            ))}
          </ul>
        </div>
      )}

      {cautions.length > 0 && <p className="destination-match-caution">{cautions.join(' ')}</p>}

      <p className="destination-detail-provenance">
        {evidence?.sourceCount
          ? `${evidence.sourceCount} independent ${evidence.sourceCount === 1 ? 'source' : 'sources'}`
          : `${candidate.sourceReferences.length} ${candidate.sourceReferences.length === 1 ? 'source' : 'sources'}`}
        {` · ${candidate.sourceConfidence} confidence`}
        {verifiedAt ? ` · checked ${verifiedAt}` : ''}
      </p>
    </div>
  );
}

/**
 * The desktop browse-list row. Deliberately short: a photo, the name, the two
 * numbers that decide most choices, and the four decisions. Everything else
 * lives behind "Details" so a sixty-place list stays scannable instead of
 * filling several screens with prose.
 */
function CandidateCard({
  ranked,
  decision,
  onDecision,
  context,
}: {
  ranked: RankedCandidate;
  decision?: DiscoveryCandidateDecision;
  onDecision: (decision: DiscoveryCandidateDecision) => void;
  context?: CandidateContext;
}) {
  const { candidate, score } = ranked;
  const [expanded, setExpanded] = useState(false);

  return (
    <article className="destination-candidate" data-decision={decision || 'undecided'}>
      <PlaceMedia candidate={candidate} className="destination-candidate-photo" />
      <div className="destination-candidate-body">
        <div className="destination-candidate-headline">
          <div className="min-w-0">
            <p className="destination-candidate-meta-line">
              {candidate.neighbourhood || candidate.city}
              {' · '}
              {formatDuration(context?.evidence?.typicalVisitMinutes || candidate.estimatedVisitMinutes)}
              {candidate.rating ? ` · ${candidate.rating.toFixed(1)}★` : ''}
            </p>
            <h5>{candidate.name}</h5>
          </div>
          <span className="destination-match-score" aria-label={`${score} percent match`}>{score}</span>
        </div>

        {expanded
          ? <CandidateDetails ranked={ranked} context={context} />
          : <p className="destination-candidate-description">{candidate.description || openingSummary(candidate)}</p>}

        <div className="destination-candidate-footer">
          <fieldset className="destination-decision-group">
            <legend className="sr-only">Preference for {candidate.name}</legend>
            {DECISIONS.map((option) => (
              <label
                key={option.id}
                className="destination-decision-option"
                data-active={decision === option.id ? 'true' : 'false'}
              >
                <input
                  className="destination-decision-input"
                  type="radio"
                  name={`candidate-decision-${candidate.id}`}
                  value={option.id}
                  checked={decision === option.id}
                  onChange={() => onDecision(option.id)}
                />
                {decision === option.id && <Check className="w-3.5 h-3.5" aria-hidden="true" />}
                <span>{option.label}</span>
              </label>
            ))}
          </fieldset>
          <div className="destination-candidate-links">
            <button
              type="button"
              className="destination-collapse-link"
              aria-expanded={expanded}
              onClick={() => setExpanded((open) => !open)}
            >
              {expanded ? 'Less' : 'Details'}
              <ChevronDown className={`w-3.5 h-3.5 transition-transform${expanded ? ' rotate-180' : ''}`} aria-hidden="true" />
            </button>
            {candidate.sourceReferences[0]?.url && (
              <a href={candidate.sourceReferences[0].url} target="_blank" rel="noreferrer" className="destination-source-link">
                Source <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

/**
 * One place, one decision. The front is the photograph and the two facts that
 * frame a snap judgement; the back is the full evidence for the times a snap
 * judgement is not enough. Used on both mobile (swipe) and desktop (a wider
 * card driven by the keyboard and the rail beside it).
 */
function DeckCard({
  ranked,
  onDecision,
  context,
  variant = 'mobile',
  flipped,
  onFlippedChange,
}: {
  ranked: RankedCandidate;
  onDecision: (decision: DiscoveryCandidateDecision) => void;
  context?: CandidateContext;
  variant?: 'mobile' | 'desktop';
  flipped: boolean;
  onFlippedChange: (flipped: boolean) => void;
}) {
  const { candidate, score } = ranked;
  const reduceMotion = useReducedMotion();
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-220, 0, 220], [-8, 0, 8]);
  const mustOpacity = useTransform(x, [20, SWIPE_COMMIT_PX], [0, 1]);
  const skipOpacity = useTransform(x, [-SWIPE_COMMIT_PX, -20], [1, 0]);
  const isDesktop = variant === 'desktop';

  useEffect(() => {
    x.set(0);
  }, [candidate.id, x]);

  const commit = (decision: DiscoveryCandidateDecision) => onDecision(decision);
  const flip = (next: boolean) => { onFlippedChange(next); hapticTap(); };

  return (
    <motion.div
      className="destination-deck-pop"
      data-variant={variant}
      initial={reduceMotion ? false : { opacity: 0, scale: 0.88, y: 28 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={reduceMotion ? undefined : { opacity: 0, scale: 0.92, y: -12 }}
      transition={{ type: 'spring', stiffness: 380, damping: 28 }}
    >
      <motion.article
        className="destination-deck-card"
        style={{ x, rotate }}
        drag={flipped || reduceMotion || isDesktop ? false : 'x'}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.92}
        onDragEnd={(_, info) => {
          if (info.offset.x >= SWIPE_COMMIT_PX || info.velocity.x > 700) {
            commit('must-do');
            return;
          }
          if (info.offset.x <= -SWIPE_COMMIT_PX || info.velocity.x < -700) {
            commit('skip');
          }
        }}
      >
        <motion.span className="destination-deck-stamp is-must" style={{ opacity: mustOpacity }}>Must do</motion.span>
        <motion.span className="destination-deck-stamp is-skip" style={{ opacity: skipOpacity }}>Skip</motion.span>

        <div className={`destination-flip-scene${flipped ? ' is-flipped' : ''}`}>
          <div className="destination-flip-inner">
            <button
              type="button"
              className="destination-flip-face is-front"
              onClick={() => flip(true)}
              aria-label={`Show details for ${candidate.name}`}
            >
              <PlaceMedia candidate={candidate} className="destination-deck-photo" />
              <span className="destination-match-score destination-deck-score" aria-label={`${score} percent match`}>{score}</span>
              <div className="destination-deck-front-copy">
                <p className="destination-candidate-meta-line">
                  {candidate.neighbourhood || candidate.city}
                  {' · '}
                  {formatDuration(context?.evidence?.typicalVisitMinutes || candidate.estimatedVisitMinutes)}
                  {candidate.rating ? ` · ${candidate.rating.toFixed(1)}★` : ''}
                </p>
                <h5>{candidate.name}</h5>
                <p className="destination-deck-tap-hint">
                  {isDesktop ? 'Click or press Space for full details' : 'Tap to flip for details'}
                </p>
              </div>
            </button>

            <div className="destination-flip-face is-back" aria-hidden={!flipped}>
              <button type="button" className="destination-flip-back-close" onClick={() => flip(false)} aria-label="Flip card back">
                <X className="w-4 h-4" />
              </button>
              <div className="destination-flip-back-scroll">
                <p className="destination-candidate-meta-line">{candidate.neighbourhood || candidate.city}</p>
                <h5>{candidate.name}</h5>
                {candidate.localName && candidate.localName !== candidate.name && (
                  <p className="destination-candidate-meta-line">{candidate.localName}</p>
                )}
                <CandidateDetails ranked={ranked} context={context} />
                {candidate.sourceReferences[0]?.url && (
                  <a href={candidate.sourceReferences[0].url} target="_blank" rel="noreferrer" className="destination-source-link">
                    Open source <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
              <div className="destination-deck-back-actions">
                <button type="button" className="destination-quick-action is-skip" onClick={() => commit('skip')}>Skip</button>
                <button type="button" className="destination-quick-action is-detail" onClick={() => commit('interested')}>Interested</button>
                <button type="button" className="destination-quick-action is-must" onClick={() => commit('must-do')}>Must do</button>
              </div>
            </div>
          </div>
        </div>

        {!flipped && (
          <>
            <div className="destination-deck-actions">
              <button type="button" className="destination-quick-action is-skip" onClick={() => commit('skip')}>Skip</button>
              <button type="button" className="destination-quick-action is-detail" onClick={() => flip(true)}>Details</button>
              <button type="button" className="destination-quick-action is-must" onClick={() => commit('must-do')}>Must do</button>
            </div>
            <p className="destination-deck-hint">
              {isDesktop ? '← skip · → must do · ↑ interested · Space details' : 'Swipe right to keep · left to skip'}
            </p>
          </>
        )}
      </motion.article>
    </motion.div>
  );
}

const unscheduledReasonLabel = (reason: string) => {
  if (reason === 'daily-capacity-reached') return 'Days are already full';
  if (reason === 'incompatible-location') return 'Too far from other stops that day';
  if (reason === 'insufficient-route-data') return 'Travel time unclear';
  if (reason === 'opening-hours-conflict') return 'Opening hours don’t fit';
  if (reason === 'duplicate') return 'Already covered by another stop';
  if (reason === 'walking-limit-exceeded') return 'Would mean too much walking';
  if (reason === 'return-time-exceeded') return 'Would finish too late';
  if (reason === 'queue-exceeds-tolerance') return 'Wait time is longer than you wanted';
  if (reason === 'no-viable-day') return 'No free day left in this trip';
  return 'Couldn’t fit into this trip';
};

function BuiltDiscoverySummary({
  itinerary,
  cityLabel,
  candidates,
  decisions,
  onEdit,
  onRebuild,
}: {
  itinerary: Itinerary;
  cityLabel: string;
  candidates: PlaceCandidate[];
  decisions: Record<string, CandidateDecision>;
  onEdit: () => void;
  onRebuild: () => void;
}) {
  const discoveryState = itinerary.discoveryState;
  const selectedCount = Object.values(decisions).filter((decision) => decision === 'must-do' || decision === 'interested').length;
  const scheduledCandidateIds = discoveryState?.scheduledCandidateIds || candidates
    .filter((candidate) => itinerary.days.some((day) => day.activities.some((activity) => activity.providerPlaceId === candidate.providerPlaceId)))
    .map((candidate) => candidate.id);
  const unscheduled = discoveryState?.unscheduledCandidates || [];
  const plannedDays = itinerary.days.filter((day) => day.activities.some((activity) => activity.kind === 'place')).length;
  const nameFor = (candidateId: string) => {
    const fromCandidates = candidates.find((candidate) => candidate.id === candidateId)?.name;
    if (fromCandidates) return fromCandidates;
    const fromDays = itinerary.days
      .flatMap((day) => day.activities)
      .find((activity) => activity.providerPlaceId && candidateId.includes(activity.providerPlaceId))?.name;
    return fromDays || 'Selected place';
  };

  return (
    <section className="destination-discovery-shell destination-discovery-built" aria-labelledby="destination-built-title">
      <div className="destination-built-summary">
        <div>
          <span className="fixture-badge"><Check className="w-4 h-4" /> Plan ready</span>
          <h3 id="destination-built-title">Your {cityLabel} itinerary is ready</h3>
          <p>
            {scheduledCandidateIds.length} on the plan
            {unscheduled.length > 0 ? ` · ${unscheduled.length} couldn’t fit` : ''}
            {' · '}{plannedDays} {plannedDays === 1 ? 'day' : 'days'}
            {selectedCount > scheduledCandidateIds.length ? ` · ${selectedCount} selected` : ''}
          </p>
        </div>
        <div className="destination-built-actions">
          <button type="button" className="pill-btn pill-ghost" onClick={onEdit}>Change places</button>
          <button type="button" className="pill-btn pill-primary" onClick={onRebuild}>Rebuild</button>
        </div>
      </div>
      {unscheduled.length > 0 && (
        <div className="destination-unscheduled-panel">
          <strong>{unscheduled.length} {unscheduled.length === 1 ? 'place didn’t fit' : 'places didn’t fit'}</strong>
          <span>They’re still saved. Remove a few or add a day, then rebuild.</span>
          <ul>
            {unscheduled.slice(0, 3).map((item) => (
              <li key={item.candidateId}>
                <span>{nameFor(item.candidateId)}</span>
                <small>{unscheduledReasonLabel(item.reason)}</small>
              </li>
            ))}
          </ul>
          {unscheduled.length > 3 && <small>+{unscheduled.length - 3} more</small>}
        </div>
      )}
    </section>
  );
}

function DiscoveryPreview({
  result,
  cityLabel,
  onBack,
  onApply,
}: {
  result: DestinationBuildResult;
  cityLabel: string;
  onBack: () => void;
  onApply: () => void;
}) {
  const [showAllUnscheduled, setShowAllUnscheduled] = useState(false);
  const placeCount = result.days.reduce((total, day) => total + day.activities.filter((activity) => activity.kind === 'place').length, 0);
  const plannedDays = result.days.filter((day) => day.activities.some((activity) => activity.kind === 'place')).length;
  const unscheduled = result.unscheduledReasons;
  const visibleUnscheduled = showAllUnscheduled ? unscheduled : unscheduled.slice(0, 3);
  const sharedReason = unscheduled.length > 0 && unscheduled.every((item) => item.reason === unscheduled[0].reason)
    ? unscheduledReasonLabel(unscheduled[0].reason)
    : null;
  const activeLoads = result.dayLoads.filter((load) => load.mainActivities > 0);
  const averageWalkingKm = activeLoads.length
    ? (activeLoads.reduce((sum, load) => sum + load.walkingDistanceMeters, 0) / activeLoads.length / 1000).toFixed(1)
    : '0.0';

  return (
    <div className="destination-plan-preview">
      <div className="destination-preview-header">
        <div>
          <button type="button" className="destination-back-link" onClick={onBack}><ArrowLeft className="w-4 h-4" /> Back</button>
          <h4>Your {cityLabel} plan</h4>
          <p>{placeCount} places across {plannedDays} {plannedDays === 1 ? 'day' : 'days'}.</p>
        </div>
      </div>

      <p className="destination-preview-stats">
        About {averageWalkingKm} km walking a day
        {result.routeMode === 'provider' ? ' · live travel times' : ' · estimated travel times'}
      </p>

      <div className="destination-day-list">
        {result.days.map((day, dayIndex) => {
          const places = day.activities.filter((activity) => activity.kind === 'place');
          if (places.length === 0) return null;
          const load = result.dayLoads[dayIndex];
          return (
            <article key={day.day} className="destination-day-row">
              <div className="destination-day-number">Day {day.day}</div>
              <div>
                <h5>{day.title}</h5>
                {load && (
                  <p className="destination-day-load">
                    {places.length} {places.length === 1 ? 'place' : 'places'}
                    {' · '}{(load.walkingDistanceMeters / 1000).toFixed(1)} km walking
                    {' · '}back by {load.expectedReturnTime}
                  </p>
                )}
                <div className="destination-day-places">
                  {places.map((activity) => (
                    <div key={activity.id}>
                      <strong>{activity.time} · {activity.name}</strong>
                    </div>
                  ))}
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {unscheduled.length > 0 && (
        <div className="destination-unscheduled-panel">
          <strong>
            {unscheduled.length === 1
              ? '1 place couldn’t fit this trip'
              : `${unscheduled.length} places couldn’t fit this trip`}
          </strong>
          <span>
            {sharedReason
              ? `${sharedReason}. Keep this plan, or choose fewer places and rebuild.`
              : 'Keep this plan, or choose fewer places and rebuild.'}
          </span>
          <ul>
            {visibleUnscheduled.map(({ candidate, reason }) => (
              <li key={candidate.id}>
                <span>{candidate.name}</span>
                {!sharedReason && <small>{unscheduledReasonLabel(reason)}</small>}
              </li>
            ))}
          </ul>
          {unscheduled.length > 3 && (
            <button
              type="button"
              className="destination-unscheduled-toggle"
              onClick={() => setShowAllUnscheduled((open) => !open)}
            >
              {showAllUnscheduled ? 'Show less' : `Show all ${unscheduled.length}`}
            </button>
          )}
        </div>
      )}

      <div className="destination-preview-actions">
        <button type="button" className="pill-btn pill-primary" onClick={onApply}><Check className="w-4 h-4" /> Keep this plan</button>
        <button type="button" className="pill-btn pill-ghost" onClick={onBack}>Choose fewer places</button>
      </div>
    </div>
  );
}

export function DestinationDiscoveryPanel({ itinerary, profile, onItineraryChange }: DestinationDiscoveryPanelProps) {
  const primaryCity = profile.destinations[0]?.city || itinerary.cities[0] || '';
  const destination = profile.destinations[0];
  const [providerRuntime, setProviderRuntime] = useState<ProviderRuntime | null>(null);
  useEffect(() => {
    let active = true;
    void loadProviderRuntime(
      isSupabaseConfigured() ? (name) => invokeTravelFunction(name) : undefined,
    ).then((runtime) => {
      if (active) setProviderRuntime(runtime);
    });
    return () => { active = false; };
  }, []);
  const runtime = providerRuntime ?? EMPTY_PROVIDER_RUNTIME;
  const capability = capabilityFor({
    city: primaryCity,
    region: destination?.region,
    countryCode: destination?.countryCode || '',
  }, runtime);
  const supportsDiscovery = canDiscover(capability);
  const capabilityLoading = providerRuntime === null && isSupabaseConfigured();
  // Canonical display name for the active destination — never a hardcoded city.
  const cityLabel = capability.destination.city || primaryCity || 'this destination';
  const savedStateMatchesCity = Boolean(
    itinerary.discoveryState
    && itinerary.discoveryState.city.toLowerCase() === capability.destination.city.toLowerCase(),
  );
  const [phase, setPhase] = useState<DiscoveryPhase>(() => {
    if (itinerary.discoveryState?.stage === 'itinerary-built' && savedStateMatchesCity) return 'built';
    // Candidate records live in component state and are not persisted in the
    // itinerary. Re-open discovery for any non-built saved state so a reload
    // cannot render an empty review panel with no way to fetch candidates.
    return 'idle';
  });
  const [candidates, setCandidates] = useState<PlaceCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** True once results are known to come from the captured library, not a provider. */
  const [usingFixture, setUsingFixture] = useState(false);
  /** Reported wait times by candidate id, gathered from evidence. */
  const [queueEvidence, setQueueEvidence] = useState<Record<string, number>>({});
  /** Per-place evidence summaries and trend strength, when a provider supplied them. */
  const [evidenceSummaries, setEvidenceSummaries] = useState<Record<string, PlaceEvidenceSummary>>({});
  const [trends, setTrends] = useState<Record<string, number>>({});
  const [routeLoading, setRouteLoading] = useState(false);
  // Multi-dimensional ranking: interests, significance, recent quality,
  // practicality, trend and promotion risk — not one opaque number.
  const ranked = useMemo(
    () => rankWithIntelligence(candidates, profile, { evidence: evidenceSummaries, trends }),
    [candidates, profile, evidenceSummaries, trends],
  );
  const groupedRanked = useMemo(() => {
    const assigned = new Set<string>();
    return GROUPS.map((group) => {
      const items = ranked.filter(({ candidate }) => (
        !assigned.has(candidate.id)
        && candidate.categories.some((category) => (group.matches as readonly string[]).includes(category))
      ));
      items.forEach(({ candidate }) => assigned.add(candidate.id));
      return { ...group, items };
    });
  }, [ranked]);
  const [decisions, setDecisions] = useState<Record<string, CandidateDecision>>(() => (
    savedStateMatchesCity ? itinerary.discoveryState!.decisions : {}
  ));
  const decisionsRef = useRef(decisions);
  const [buildResult, setBuildResult] = useState<DestinationBuildResult | null>(null);
  const [undoState, setUndoState] = useState<UndoState | null>(null);
  const undoTimerRef = useRef<number | null>(null);
  const isMobileReview = useIsMobileReview();
  /**
   * Every decision in the order it was made, so "Back" can walk as far back as
   * the traveller wants. The transient undo toast only ever covers the most
   * recent one, and it disappears — this does not.
   */
  const [decisionHistory, setDecisionHistory] = useState<UndoState[]>([]);
  /**
   * When you step back, the deck must show *that* place again rather than the
   * next-highest ranked one it would otherwise fall to.
   */
  const [focusedCandidateId, setFocusedCandidateId] = useState<string | null>(null);
  const [deckFlipped, setDeckFlipped] = useState(false);
  /** Desktop review defaults to the same one-at-a-time deck as mobile. */
  const [desktopMode, setDesktopMode] = useState<'deck' | 'list'>(() => {
    if (typeof window === 'undefined') return 'deck';
    try {
      return window.localStorage.getItem(DESKTOP_REVIEW_MODE_KEY) === 'list' ? 'list' : 'deck';
    } catch {
      return 'deck';
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(DESKTOP_REVIEW_MODE_KEY, desktopMode);
    } catch {
      // Preference persistence is optional; the in-memory choice still works.
    }
  }, [desktopMode]);
  const selectedCount = Object.values(decisions).filter((decision) => decision === 'must-do' || decision === 'interested').length;
  const reviewedCount = Object.keys(decisions).length;
  const pendingDeck = useMemo(
    () => ranked.filter(({ candidate }) => !decisions[candidate.id]),
    [ranked, decisions],
  );
  const currentDeckCard = (focusedCandidateId
    ? pendingDeck.find(({ candidate }) => candidate.id === focusedCandidateId)
    : undefined) || pendingDeck[0] || null;
  const deckContext = useMemo<CandidateContext | undefined>(() => {
    if (!currentDeckCard) return undefined;
    const id = currentDeckCard.candidate.id;
    return { evidence: evidenceSummaries[id], queueMinutes: queueEvidence[id] };
  }, [currentDeckCard, evidenceSummaries, queueEvidence]);
  /** Decided places, most recent first — the desktop rail's running record. */
  const recentDecisions = useMemo(
    () => [...decisionHistory].reverse().slice(0, 8),
    [decisionHistory],
  );

  useEffect(() => { setDeckFlipped(false); }, [currentDeckCard?.candidate.id]);

  const persistDecisions = (next: Record<string, CandidateDecision>, discoveredAt = itinerary.discoveryState?.discoveredAt || new Date().toISOString()) => {
    onItineraryChange({
      ...itinerary,
      revision: (itinerary.revision || 0) + 1,
      discoveryState: {
        city: cityLabel,
        mode: usingFixture ? 'fixture' : 'live',
        candidateIds: candidates.map((candidate) => candidate.id),
        decisions: next,
        discoveredAt,
        updatedAt: new Date().toISOString(),
        stage: 'reviewing',
      },
    });
  };

  const beginDiscovery = async () => {
    if (!supportsDiscovery) return;
    setLoading(true);
    setError(null);
    try {
      // Live provider first; the captured library is the labelled fallback.
      const destination = profile.destinations[0];
      const runtime = await loadProviderRuntime(
        isSupabaseConfigured() ? (name) => invokeTravelFunction(name) : undefined,
      );
      const outcome = await discoverPlaces(
        {
          city: capability.destination.city,
          region: destination?.region,
          countryCode: destination?.countryCode || capability.destination.countryCode,
        },
        runtime,
        isSupabaseConfigured() ? invokeTravelFunction : undefined,
      );
      setUsingFixture(outcome.usingFixture);
      setQueueEvidence(outcome.queueEvidence);
      setEvidenceSummaries(outcome.evidenceSummaries);
      setTrends(outcome.trends);

      const discovered = outcome.candidates.length > 0
        ? outcome.candidates
        : await new FixturePlaceDiscoveryProvider().search({
          city: capability.destination.city,
          countryCode: capability.destination.countryCode,
          queries: [],
          interests: profile.styles,
          startDate: profile.startDate,
          endDate: profile.endDate,
          limit: 40,
        });
      if (discovered.length === 0) {
        throw new Error(outcome.providerError
          ? `Live discovery unavailable: ${outcome.providerError}`
          : 'No places were returned for this destination.');
      }
      const nextDecisions = Object.keys(decisions).length > 0 ? decisions : {};
      setCandidates(discovered);
      decisionsRef.current = nextDecisions;
      setDecisions(nextDecisions);
      setPhase('review');
      persistDecisions(nextDecisions, new Date().toISOString());
    } catch (discoveryError) {
      setError(discoveryError instanceof Error ? discoveryError.message : 'Discovery could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  const updateDecision = (candidateId: string, decision: CandidateDecision, options?: { name?: string; silent?: boolean }) => {
    const previous = decisionsRef.current[candidateId];
    const next = { ...decisionsRef.current, [candidateId]: decision };
    decisionsRef.current = next;
    setDecisions(next);
    persistDecisions(next);
    // A fresh decision always releases the deck back to ranked order.
    setFocusedCandidateId(null);
    if (options?.silent) return;
    if (decision === 'must-do') hapticSuccess();
    else hapticMedium();
    const name = options?.name || ranked.find((item) => item.candidate.id === candidateId)?.candidate.name || 'Place';
    const entry: UndoState = { candidateId, name, previous, next: decision };
    setDecisionHistory((history) => [...history.filter((item) => item.candidateId !== candidateId), entry]);
    setUndoState(entry);
    if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current);
    undoTimerRef.current = window.setTimeout(() => setUndoState(null), 4200);
  };

  /** Revert one decision and put that place back in front of the traveller. */
  const revert = (entry: UndoState) => {
    const next = { ...decisionsRef.current };
    if (entry.previous) next[entry.candidateId] = entry.previous;
    else delete next[entry.candidateId];
    decisionsRef.current = next;
    setDecisions(next);
    persistDecisions(next);
    setDecisionHistory((history) => history.filter((item) => item !== entry));
    setUndoState(null);
    if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current);
  };

  const undoLastDecision = () => {
    if (!undoState) return;
    hapticTap();
    revert(undoState);
    setFocusedCandidateId(undoState.previous ? null : undoState.candidateId);
  };

  /**
   * Walk backwards through the review, one place per press, with no dependence
   * on having caught the undo toast before it faded.
   */
  const stepBack = useCallback(() => {
    const previousEntry = decisionHistory[decisionHistory.length - 1];
    if (!previousEntry) return;
    hapticTap();
    revert(previousEntry);
    setFocusedCandidateId(previousEntry.candidateId);
    setDeckFlipped(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decisionHistory, decisions]);

  useEffect(() => () => {
    if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current);
  }, []);

  /**
   * Desktop has no swipe, so the deck is driven from the keyboard instead.
   * Bindings stay off while a field is focused so typing is never hijacked.
   */
  useEffect(() => {
    if (isMobileReview || phase !== 'review' || desktopMode !== 'deck' || !currentDeckCard) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const decide = (decision: CandidateDecision) => {
        event.preventDefault();
        updateDecision(currentDeckCard.candidate.id, decision, { name: currentDeckCard.candidate.name });
      };
      if (event.key === 'ArrowLeft') return decide('skip');
      if (event.key === 'ArrowRight') return decide('must-do');
      if (event.key === 'ArrowUp') return decide('interested');
      if (event.key === 'ArrowDown') return decide('visited');
      if (event.key === ' ') {
        event.preventDefault();
        setDeckFlipped((open) => !open);
        return;
      }
      if (event.key === 'Backspace') {
        event.preventDefault();
        stepBack();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobileReview, phase, desktopMode, currentDeckCard, stepBack, decisions]);

  const selectRecommended = () => {
    const next = defaultDiscoveryDecisions(ranked);
    decisionsRef.current = next;
    setDecisions(next);
    persistDecisions(next);
    // A bulk shortlist is not a sequence of choices, so step-back history that
    // no longer describes how the current selection was reached is dropped.
    setDecisionHistory([]);
    setFocusedCandidateId(null);
    hapticSuccess();
  };

  const clearAllDecisions = () => {
    const next: Record<string, CandidateDecision> = {};
    decisionsRef.current = next;
    setDecisions(next);
    persistDecisions(next);
    setDecisionHistory([]);
    setFocusedCandidateId(null);
    setUndoState(null);
    hapticTap();
  };

  const previewPlan = async () => {
    // Queue evidence feeds the scheduler so a famous place with a 90-minute
    // wait costs 90 minutes of the day, not zero.
    setRouteLoading(true);
    let routeResolver: RouteResolver | undefined;
    let routeWarning: string | undefined;
    let weatherWarning: string | undefined;
    let eventsWarning: string | undefined;
    let currentEventNotes: string[] = [];
    let currentEvents: Array<{ id: string; name: string; date?: string; startTime?: string; endTime?: string; url?: string }> = [];
    // Provider capability can change after auth/function startup. Refresh it
    // immediately before a paid preview instead of trusting the mount-time
    // snapshot, which otherwise silently forces estimated routing.
    const activeRuntime = await loadProviderRuntime(
      isSupabaseConfigured() ? (name) => invokeTravelFunction(name) : undefined,
      true,
    );
    const activeCapability = capabilityFor({
      city: capability.destination.city,
      region: capability.destination.region,
      countryCode: capability.destination.countryCode,
    }, activeRuntime);
    const regionalRouteProvider = activeCapability.routes.provider === 'amap' || activeCapability.routes.provider === 'baidu'
      ? activeCapability.routes.provider
      : undefined;
    const effectiveRouteMode = regionalRouteProvider ? 'walking' : (profile.transport.includes('public-transport') ? 'public-transport' : 'walking');
    if (regionalRouteProvider && profile.transport.includes('public-transport')) {
      routeWarning = 'The regional route provider currently supplies walking routes; transit time is not assumed.';
    }
    const nextWeatherRiskDays: number[] = [];
    try {
      const selected = ranked
        .filter(({ candidate }) => decisions[candidate.id] === 'must-do' || decisions[candidate.id] === 'interested')
        .map(({ candidate }) => candidate)
        .filter((candidate) => candidate.coordinates)
        .slice(0, 25);
      // Google limits transit matrices to 100 elements, unlike walking/driving
      // matrices which support up to 625. Ten shortlisted places keep the
      // transit request within that provider limit; the scheduler can still
      // use honest estimates for candidates outside the routing subset.
      const routedCandidates = effectiveRouteMode === 'public-transport' ? selected.slice(0, 10) : selected;
      if (activeCapability.routes.status === 'live' && isSupabaseConfigured() && routedCandidates.length > 0) {
        const payload = await invokeTravelFunction('travel-route-matrix', {
          origins: routedCandidates.map((candidate) => ({ coordinates: candidate.coordinates })),
          destinations: routedCandidates.map((candidate) => ({ coordinates: candidate.coordinates })),
          mode: effectiveRouteMode,
          provider: regionalRouteProvider,
          travelStartsInDays: profile.startDate
            ? Math.max(0, Math.ceil((new Date(profile.startDate).getTime() - Date.now()) / 86_400_000))
            : undefined,
        }) as { matrix?: Array<Array<{ status?: string; durationMinutes?: number; distanceMeters?: number }>>; failedPairs?: number };
        if ((payload as { partial?: boolean }).partial) {
          routeWarning = 'The regional route provider returned a bounded partial matrix; remaining travel is estimated honestly.';
        }
        if ((payload.failedPairs || 0) > 0) {
          routeWarning = 'Some regional routes were unavailable; those legs remain explicitly estimated.';
        }
        const routeMap = new Map<string, RouteLeg>();
        payload.matrix?.forEach((row, originIndex) => row.forEach((cell, destinationIndex) => {
          if (cell.status !== 'ok' || !cell.durationMinutes || !cell.distanceMeters) return;
          const from = routedCandidates[originIndex];
          const to = routedCandidates[destinationIndex];
          if (from && to) routeMap.set(`${from.id}:${to.id}`, {
            durationMinutes: cell.durationMinutes,
            distanceMeters: cell.distanceMeters,
            mode: effectiveRouteMode,
            source: 'provider',
          });
        }));
        routeResolver = (from, to) => routeMap.get(`${from.id}:${to.id}`);
        if (routeMap.size === 0) routeWarning = 'The live route provider returned no usable route cells; travel is estimated.';
      } else if (activeCapability.routes.status !== 'live') {
        routeWarning = 'Live routing is not configured for this destination; travel is estimated.';
      }
    } catch {
      routeWarning = 'Live routing was unavailable for this preview; travel is estimated.';
    }
    if (activeCapability.weather && isSupabaseConfigured()) {
      const weatherAnchor = ranked.find(({ candidate }) => candidate.coordinates)?.candidate.coordinates;
      if (weatherAnchor) {
        try {
          const weather = parseWeatherRisk(await invokeTravelFunction('travel-weather', {
            latitude: weatherAnchor[0],
            longitude: weatherAnchor[1],
            startDate: profile.startDate,
            endDate: profile.endDate,
          }));
          const start = profile.startDate ? new Date(`${profile.startDate}T00:00:00Z`).getTime() : NaN;
          weather.forEach((day) => {
            const dayIndex = Number.isFinite(start)
              ? Math.floor((new Date(`${day.date}T00:00:00Z`).getTime() - start) / 86_400_000)
              : -1;
            if (dayIndex >= 0 && day.indoorRecommended) nextWeatherRiskDays.push(dayIndex + 1);
          });
        } catch {
          weatherWarning = 'Live weather was unavailable for this preview; outdoor ordering is unchanged.';
        }
      }
    }
    if (activeCapability.events && isSupabaseConfigured()) {
      try {
        const events = parseCurrentEvents(await invokeTravelFunction('travel-events', {
          city: activeCapability.destination.city,
          startDate: profile.startDate,
          endDate: profile.endDate,
        }));
        if (events.length > 0) {
          eventsWarning = `${events.length} current event${events.length === 1 ? '' : 's'} found near ${activeCapability.destination.city}; review dates before locking the itinerary.`;
          currentEvents = events.slice(0, 8);
          currentEventNotes = currentEvents.map((event) => {
            const time = event.startTime ? ` ${event.startTime}${event.endTime ? `–${event.endTime}` : ''}` : '';
            return event.date ? `${event.name} (${event.date}${time})` : `${event.name}${time}`;
          });
        }
      } catch {
        eventsWarning = 'Current events were unavailable for this preview; the itinerary does not assume events exist.';
      }
    }
    const result = buildDestinationItinerary(itinerary, profile, ranked, decisions, {
      queueEvidence,
      routeResolver,
      weatherRiskDays: nextWeatherRiskDays,
      currentEventNotes,
      currentEvents,
    });
    if (routeWarning) result.warnings = [...result.warnings, routeWarning];
    if (weatherWarning) result.warnings = [...result.warnings, weatherWarning];
    if (eventsWarning) result.warnings = [...result.warnings, eventsWarning];
    if (nextWeatherRiskDays.length > 0) result.warnings = [...result.warnings, `Rain-sensitive days use an indoor-first order: ${nextWeatherRiskDays.join(', ')}.`];
    setBuildResult(result);
    setPhase('preview');
    setRouteLoading(false);
  };

  const applyPlan = () => {
    if (!buildResult) return;
    const timestamp = new Date().toISOString();
    onItineraryChange({
      ...itinerary,
      days: buildResult.days,
      cities: Array.from(new Set(buildResult.days.map((day) => day.city).filter(Boolean))),
      revision: (itinerary.revision || 0) + 1,
      discoveryState: {
        city: cityLabel,
        mode: usingFixture ? 'fixture' : 'live',
        candidateIds: candidates.map((candidate) => candidate.id),
        decisions,
        discoveredAt: itinerary.discoveryState?.discoveredAt || timestamp,
        updatedAt: timestamp,
        stage: 'itinerary-built',
        scheduledCandidateIds: buildResult.scheduledCandidates.map((candidate) => candidate.id),
        unscheduledCandidates: buildResult.unscheduledReasons.map(({ candidate, reason }) => ({ candidateId: candidate.id, reason })),
      },
      plannerHistory: [
        ...(itinerary.plannerHistory || []),
        {
          id: `discovery-${Date.now()}`,
          action: 'generate' as const,
          createdAt: timestamp,
          summary: `Built a ${cityLabel} itinerary with ${buildResult.scheduledCandidates.length} verified places.`,
          affectedDayNumbers: buildResult.days.map((day) => day.day),
          beforeDays: itinerary.days,
          afterDays: buildResult.days,
        },
      ].slice(-10),
    });
    setPhase('built');
    setBuildResult(null);
  };

  if (capabilityLoading) {
    return (
      <section className="destination-discovery-shell destination-discovery-unavailable">
        <Database className="w-5 h-5" />
        <div>
          <h4>Checking live destination providers</h4>
          <p>Preparing the current discovery options for {cityLabel}.</p>
        </div>
      </section>
    );
  }

  if (!supportsDiscovery) {
    // Capability is resolved from the destination's region and the connected
    // providers, so the message stays accurate as backends come online.
    return (
      <section className="destination-discovery-shell destination-discovery-unavailable">
        <Database className="w-5 h-5" />
        <div>
          <h4>Smart discovery isn’t available for {cityLabel} yet</h4>
          <p>{describeCapability(capability)} You can still build your trip by adding places manually below.</p>
        </div>
      </section>
    );
  }

  if (phase === 'preview' && buildResult) {
    return <section className="destination-discovery-shell"><DiscoveryPreview result={buildResult} cityLabel={cityLabel} onBack={() => setPhase('review')} onApply={applyPlan} /></section>;
  }

  if (phase === 'built') {
    const reopenReview = () => {
      if (candidates.length > 0) {
        setPhase('review');
        return;
      }
      void beginDiscovery();
    };

    return (
      <BuiltDiscoverySummary
        itinerary={itinerary}
        cityLabel={cityLabel}
        candidates={candidates}
        decisions={decisions}
        onEdit={reopenReview}
        onRebuild={reopenReview}
      />
    );
  }

  if (phase === 'idle') {
    const canResumeReview = Boolean(candidates.length > 0 || (savedStateMatchesCity && itinerary.discoveryState?.stage === 'reviewing'));
    return (
      <section className="destination-discovery-shell destination-discovery-intro">
        <div className="destination-intro-copy">
          <h3>Build a {cityLabel} itinerary</h3>
          <p>Verified places, one at a time.</p>
        </div>
        <div className="destination-intro-actions">
          {canResumeReview && candidates.length > 0 && (
            <button type="button" className="pill-btn pill-primary" onClick={() => { hapticTap(); setPhase('review'); }}>
              Continue reviewing
            </button>
          )}
          <button type="button" className={`pill-btn ${canResumeReview && candidates.length > 0 ? 'pill-ghost' : 'pill-primary'}`} onClick={beginDiscovery} disabled={loading}>
            <Sparkles className="w-4 h-4" /> {loading ? 'Loading places…' : 'Start'}
          </button>
        </div>
        {error && <p className="destination-discovery-error" role="alert">{error} Try again; your itinerary has not changed.</p>}
      </section>
    );
  }

  if (isMobileReview) {
    return (
      <section className="destination-discovery-shell destination-discovery-review is-deck-only" aria-label={`Review places for ${cityLabel}`}>
        <div className="destination-deck-chrome">
          <div className="destination-deck-chrome-top">
            <button
              type="button"
              className="destination-deck-back"
              onClick={stepBack}
              disabled={decisionHistory.length === 0}
              aria-label={decisionHistory.length > 0
                ? `Go back to ${decisionHistory[decisionHistory.length - 1].name}`
                : 'No earlier place to go back to'}
            >
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
              Back
            </button>
            <span className="fixture-badge">
              <Database className="w-4 h-4" /> {ranked.length} verified
            </span>
            <button
              type="button"
              className="destination-deck-close"
              aria-label="Close place review"
              onClick={() => { hapticTap(); setPhase('idle'); }}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <h3>Choose places for {cityLabel}</h3>
          <div className="destination-review-progress" aria-label={`${reviewedCount} of ${ranked.length} places reviewed`}>
            <div className="destination-review-progress-track">
              <div
                className="destination-review-progress-fill"
                style={{ width: ranked.length ? `${Math.min(100, (reviewedCount / ranked.length) * 100)}%` : '0%' }}
              />
            </div>
            <div className="destination-deck-progress-meta">
              <span>{reviewedCount} of {ranked.length}</span>
              <span>{selectedCount} selected</span>
            </div>
          </div>
        </div>

        {currentDeckCard ? (
          <div className="destination-deck-stage">
            <AnimatePresence mode="wait">
              <DeckCard
                key={currentDeckCard.candidate.id}
                ranked={currentDeckCard}
                context={deckContext}
                flipped={deckFlipped}
                onFlippedChange={setDeckFlipped}
                onDecision={(decision) => updateDecision(currentDeckCard.candidate.id, decision, { name: currentDeckCard.candidate.name })}
              />
            </AnimatePresence>
            {pendingDeck.length > 1 && (
              <p className="destination-deck-remaining">{pendingDeck.length - 1} left after this</p>
            )}
          </div>
        ) : (
          <div className="destination-deck-complete">
            <strong>Shortlist ready</strong>
            <p>{selectedCount} places selected. Build your itinerary, or keep adjusting with recommended picks.</p>
            <div className="destination-deck-complete-actions">
              <button type="button" className="pill-btn pill-primary" onClick={() => void previewPlan()} disabled={selectedCount < 2 || routeLoading}>
                {routeLoading ? 'Checking routes…' : 'Build itinerary'}
              </button>
              {decisionHistory.length > 0 && (
                <button type="button" className="pill-btn pill-ghost" onClick={stepBack}>
                  <ArrowLeft className="w-4 h-4" /> Reconsider {decisionHistory[decisionHistory.length - 1].name}
                </button>
              )}
              <button type="button" className="pill-btn pill-ghost" onClick={selectRecommended}>Use recommended shortlist</button>
              <button type="button" className="pill-btn pill-ghost" onClick={() => { hapticTap(); setPhase('idle'); }}>Close</button>
            </div>
          </div>
        )}

        <AnimatePresence>
          {undoState && (
            <motion.div
              className="destination-undo-toast"
              role="status"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
            >
              <span>Marked {undoState.name} as {DECISION_LABEL[undoState.next]}</span>
              <button type="button" onClick={undoLastDecision}>
                <Undo2 className="w-4 h-4" /> Undo
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {currentDeckCard && selectedCount >= 2 && (
          <div className="destination-review-footer destination-deck-footer">
            <div>
              <strong>{selectedCount} selected</strong>
              <span>You can build anytime</span>
            </div>
            <button type="button" className="pill-btn pill-primary" onClick={() => void previewPlan()} disabled={routeLoading}>
              {routeLoading ? 'Checking routes…' : 'Build'}
            </button>
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="destination-discovery-shell destination-discovery-review" data-mobile-review="false">
      <div className="destination-review-header">
        <div className="destination-review-headline">
          <span className="fixture-badge">
            <Database className="w-4 h-4" /> {ranked.length} verified{usingFixture ? ' · may be out of date' : ''}
          </span>
          <h3>Choose what belongs in your {cityLabel} trip</h3>
          <div className="destination-review-progress" aria-label={`${reviewedCount} of ${ranked.length} places reviewed`}>
            <div className="destination-review-progress-track">
              <div
                className="destination-review-progress-fill"
                style={{ width: ranked.length ? `${Math.min(100, (reviewedCount / ranked.length) * 100)}%` : '0%' }}
              />
            </div>
            <span>{reviewedCount} of {ranked.length} reviewed · {selectedCount} selected</span>
          </div>
        </div>
        <div className="destination-review-summary">
          <div className="destination-review-mode-toggle" role="group" aria-label="Review layout">
            <button
              type="button"
              className={desktopMode === 'deck' ? 'is-active' : ''}
              aria-pressed={desktopMode === 'deck'}
              onClick={() => setDesktopMode('deck')}
            >
              <Layers className="w-4 h-4" aria-hidden="true" /> One at a time
            </button>
            <button
              type="button"
              className={desktopMode === 'list' ? 'is-active' : ''}
              aria-pressed={desktopMode === 'list'}
              onClick={() => setDesktopMode('list')}
            >
              <LayoutGrid className="w-4 h-4" aria-hidden="true" /> Browse all
            </button>
          </div>
          <div className="destination-review-summary-actions">
            <button type="button" className="pill-btn pill-ghost" onClick={selectRecommended}>Recommended shortlist</button>
            <button
              type="button"
              className="pill-btn pill-ghost"
              onClick={clearAllDecisions}
              disabled={selectedCount === 0 && reviewedCount === 0}
              aria-label="Clear all place decisions"
            >
              Clear all
            </button>
          </div>
        </div>
      </div>

      {desktopMode === 'deck' ? (
        <div className="destination-desk-review">
          <div className="destination-deck-stage is-desktop">
            {currentDeckCard ? (
              <AnimatePresence mode="wait">
                <DeckCard
                  key={currentDeckCard.candidate.id}
                  ranked={currentDeckCard}
                  context={deckContext}
                  variant="desktop"
                  flipped={deckFlipped}
                  onFlippedChange={setDeckFlipped}
                  onDecision={(decision) => updateDecision(currentDeckCard.candidate.id, decision, { name: currentDeckCard.candidate.name })}
                />
              </AnimatePresence>
            ) : (
              <div className="destination-deck-complete">
                <strong>Every place reviewed</strong>
                <p>{selectedCount} selected. Build the itinerary, step back through your choices, or browse the full list.</p>
              </div>
            )}
          </div>

          <aside className="destination-deck-rail" aria-label="Review progress">
            <div className="destination-deck-rail-head">
              <div className="destination-selection-count"><strong>{selectedCount}</strong><span>selected</span></div>
              <p>{pendingDeck.length} still to review</p>
            </div>

            <div className="destination-deck-rail-nav">
              <button
                type="button"
                className="pill-btn pill-ghost"
                onClick={stepBack}
                disabled={decisionHistory.length === 0}
              >
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
              <span>{decisionHistory.length} to step back through</span>
            </div>

            {recentDecisions.length > 0 && (
              <div className="destination-deck-rail-history">
                <h6>Recent choices</h6>
                <ul>
                  {recentDecisions.map((entry) => (
                    <li key={entry.candidateId}>
                      <span className="destination-history-name">{entry.name}</span>
                      <span className="destination-history-decision" data-decision={entry.next}>{DECISION_LABEL[entry.next]}</span>
                      <button
                        type="button"
                        onClick={() => { revert(entry); setFocusedCandidateId(entry.candidateId); setDeckFlipped(false); }}
                      >
                        Change
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="destination-deck-rail-hint">
              Keyboard: <kbd>←</kbd> skip · <kbd>→</kbd> must do · <kbd>↑</kbd> interested · <kbd>Space</kbd> details · <kbd>Backspace</kbd> back
            </p>
          </aside>
        </div>
      ) : (
        <div className="destination-review-groups">
          {groupedRanked.map((group) => {
            if (group.items.length === 0) return null;
            return (
              <section key={group.id} className="destination-review-group">
                <div className="destination-group-heading">
                  <h4>{group.label}</h4>
                  <span>{group.items.length} places</span>
                </div>
                <div className="destination-candidate-grid">
                  {group.items.map((item) => (
                    <CandidateCard
                      key={item.candidate.id}
                      ranked={item}
                      decision={decisions[item.candidate.id]}
                      context={{ evidence: evidenceSummaries[item.candidate.id], queueMinutes: queueEvidence[item.candidate.id] }}
                      onDecision={(decision) => updateDecision(item.candidate.id, decision, { name: item.candidate.name })}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <AnimatePresence>
        {undoState && (
          <motion.div
            className="destination-undo-toast"
            role="status"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
          >
            <span>Marked {undoState.name} as {DECISION_LABEL[undoState.next]}</span>
            <button type="button" onClick={undoLastDecision}>
              <Undo2 className="w-4 h-4" /> Undo
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="destination-review-footer">
        <div>
          <strong>{selectedCount} selected</strong>
          <span>{reviewedCount} reviewed · skip stays out of the plan</span>
        </div>
        <button type="button" className="pill-btn pill-primary" onClick={() => void previewPlan()} disabled={selectedCount < 2 || routeLoading}>
          {routeLoading ? 'Checking routes…' : 'Build itinerary'}
        </button>
      </div>
    </section>
  );
}
