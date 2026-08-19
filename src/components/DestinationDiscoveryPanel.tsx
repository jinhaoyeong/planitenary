import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
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
import { capabilityFor, discoverPlaces, fetchPlaceEvidence, fetchPlacePhotos, loadProviderRuntime, parseCurrentEvents, parseWeatherRisk } from '../lib/discoveryRuntime';
import {
  IntelligenceRequestController,
  foldIntelligenceResults,
  materialRequestKey,
  type CandidateIntelligenceEntry,
} from '../lib/candidateIntelligenceRequest';
import { buildIntelligenceView, type IntelligenceView } from '../lib/candidateIntelligenceView';
import { fetchCandidateIntelligence } from '../lib/candidateIntelligenceTransport';
import {
  toCandidateIntelligenceMaterial,
  toCandidateIntelligenceTripMaterial,
  toPlannerIntelligenceMaterial,
  candidateMaterialRevision,
  plannerMaterialRevision,
  tripMaterialRevision,
} from '../../supabase/functions/_shared/intelligenceMaterial';
import { renderIntelligenceCopy } from '../../supabase/functions/_shared/candidateIntelligence';
import { matchedStyleTags } from '../lib/placeIntelligence';
import { inferPace } from '../lib/travelBehaviour';
import type { PlaceEvidenceSummary } from '../lib/travelEvidence';
import { hapticMedium, hapticSuccess, hapticTap } from '../lib/haptics';
import { timezoneShiftHours } from '../lib/timezones';
import { invokeTravelFunction, isSupabaseConfigured } from '../lib/supabase';
import type { CandidateDecision, PlaceCandidate, RankedCandidate } from '../lib/destinationIntelligence';
import type { RouteLeg, RouteResolver } from '../lib/humanScheduler';
import {
  bindSavedActivityIds,
  cardDecisionWrites,
  decisionTargetIdOf,
  resolvedCardDecision,
  retainedDecisionIdsOf,
  reviewCandidatesForItinerary,
} from '../lib/decisionTarget';
import {
  buildDestinationItinerary,
  defaultDiscoveryDecisions,
  pruneDecisionsToCandidates,
  rankWithIntelligence,
  shortlistTarget,
  type DestinationBuildResult,
} from '../lib/destinationPlanner';
import { applyTravellerConstraints, deriveTravelBehaviour } from '../lib/travelBehaviour';
import { isFoodOnly } from '../lib/humanScheduler';
import { recordShortlistDiagnostic } from '../lib/plannerDiagnostics';
import { describeCityLegs } from '../lib/cityLegs';
import { describeStayDates, legsFromCityStays, reconcileCityStays } from '../lib/cityStays';
import { SWIPE_COMMIT_PX, isDragIntent, shouldCloseFromSurface, swipeDecision } from '../lib/deckGestures';
import { manualDestination, type TripProfile } from '../lib/tripProfile';
import { admissionFor } from '../lib/destinationIntelligence';
import { admissionLine, describeAdmission } from '../lib/admissionCopy';
import { describeOpeningHours } from '../lib/openingHours';
import { countryTimezone } from '../lib/destinations';
import { convertCurrency, formatCurrency, hasRate } from '../lib/currency';
import { useCurrency } from '../contexts/CurrencyContext';
import { mergeAdmission } from '../../supabase/functions/_shared/placeCost';
import { safeGetItem, safeSetItem } from '../lib/safeLocalStorage';

interface DestinationDiscoveryPanelProps {
  itinerary: Itinerary;
  profile: TripProfile;
  onItineraryChange: (itinerary: Itinerary) => void;
}

type DiscoveryPhase = 'idle' | 'review' | 'preview' | 'built';

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

const DECISION_HINT: Partial<Record<DiscoveryCandidateDecision, string>> = {
  skip: 'Keep this out of my plan.',
  visited: "I've already been here.",
};

const formatDuration = (minutes: number) => minutes >= 120 && minutes % 60 === 0
  ? `${minutes / 60} hr`
  : `${minutes} min`;

const DESKTOP_REVIEW_MODE_KEY = 'planitenary:destination-review-mode';

/**
 * How far ahead of the current card evidence is gathered. Enough that swiping
 * feels instant, small enough that a shortlist the traveller abandons early
 * costs almost nothing.
 */
const EVIDENCE_PREFETCH_COUNT = 4;

/**
 * Cost and hours used to be two one-line helpers here, and both were wrong in
 * the same way: they printed whatever they had without saying what it meant.
 * `formatPrice` rendered a yen glyph for every country on earth and said "Cost
 * unknown" for almost every place; `openingSummary` read `periods[0]` and
 * appended the raw confidence enum. Both now come from shared modules —
 * `admissionCopy` and `openingHours` — so the itinerary says the same things.
 */
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

/**
 * How well-sourced the record is, said in words. The panel used to interpolate
 * the enum — "· medium confidence" — which named a rating rather than a reason.
 */
const SOURCE_CONFIDENCE_NOTE: Record<PlaceCandidate['sourceConfidence'], string> = {
  high: 'corroborated across sources',
  medium: 'from a single reliable source',
  low: 'thinly sourced, worth checking',
};

/**
 * The confidence sentence, said against the number printed beside it.
 *
 * The table above is written for the common case and reads as a lie in the
 * uncommon one: a card showing `1 source · corroborated across sources` claims
 * agreement between sources it does not have. The count and the phrase were
 * chosen independently, so nothing stopped them contradicting each other on
 * screen. Corroboration needs two things to corroborate; below that, high
 * confidence can only be a statement about the one source's authority.
 */
const sourceConfidenceNote = (confidence: PlaceCandidate['sourceConfidence'], sourceCount: number) => (
  confidence === 'high' && sourceCount < 2
    ? 'from an authoritative source'
    : SOURCE_CONFIDENCE_NOTE[confidence]
);

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
  /** Every key this action wrote, so Undo restores listing and saved-activity keys together. */
  previousByKey: Record<string, CandidateDecision | undefined>;
}

/** Extra, honestly-sourced context a card can show when there is room for it. */
export interface CandidateContext {
  /**
   * Personalised advice, already turned into what a card may show.
   *
   * Prepared upstream rather than assembled here, so the card interprets no
   * atoms of its own — `buildIntelligenceView` stays the single place that
   * decides what earns space. Null whenever the server had nothing to say or
   * could not be asked; the deterministic rationale covers both.
   */
  intelligenceView?: IntelligenceView | null;
  evidence?: PlaceEvidenceSummary;
  queueMinutes?: number;
  /**
   * The traveller's own dates, so a weekly closure can be named as a day of
   * their trip rather than left as an abstract "closed Mondays".
   */
  tripStart?: string;
  tripEnd?: string;
  /** Position in the ranked shortlist, 1-based — the question being answered. */
  position?: number;
  /** Approximate home-currency equivalent, when live rates are available. */
  toHomeCurrency?: (amount: number, currency: string) => string | undefined;
  /** Fixed clock, for tests. */
  now?: Date;
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
          // Native image dragging would otherwise hijack a swipe on a mouse.
          draggable={false}
          onError={() => setFailedUrl(candidate.photoUrl ?? null)}
        />
      ) : (
        <div className="destination-place-media-fallback" aria-hidden="true">
          <MapPinned className="w-5 h-5" />
          <span>{candidate.neighbourhood || candidate.city}</span>
        </div>
      )}
      {/*
        The credit is not a caption. CC BY and CC BY-SA both require the author
        be named, so this line is part of the permission to show the photograph
        at all — which is why it renders whenever the photograph does, and why
        it links the file page rather than merely naming a licence: the page is
        where the full author and licence text lives, and where somebody
        checking the claim would need to go.
      */}
      {showPhoto && candidate.photoAttribution && (
        candidate.photoSourcePage ? (
          <a
            className="destination-photo-credit"
            href={candidate.photoSourcePage}
            target="_blank"
            rel="noreferrer noopener"
            // The photo sits inside a swipeable deck card, so a drag that ends
            // on the credit must not also open a tab.
            draggable={false}
          >
            {candidate.photoAttribution}
          </a>
        ) : (
          <small className="destination-photo-credit">{candidate.photoAttribution}</small>
        )
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
export function CandidateDetails({ ranked, context }: { ranked: RankedCandidate; context?: CandidateContext }) {
  const { candidate, rationale, reasons, cautions = [] } = ranked;
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

  const admission = describeAdmission(admissionFor(candidate), { toHomeCurrency: context?.toHomeCurrency });
  const hours = describeOpeningHours(candidate.openingHours, {
    tripStart: context?.tripStart,
    tripEnd: context?.tripEnd,
    now: context?.now,
    timezone: candidate.openingHours?.timezone ?? countryTimezone(candidate.countryCode),
    verifiedAt: candidate.lastVerifiedAt,
    caveats: candidate.openingHours?.caveats,
  });

  /**
   * The one closure that is about the traveller rather than about the place.
   * Everything else can wait until they have read the description; a day of
   * their own trip cannot.
   */
  const tripClosure = hours.closedTripDates[0];
  const reportedClosure = cautions.find((caution) => /reports this place as closed/i.test(caution));
  const otherCautions = cautions.filter((caution) => caution !== reportedClosure);

  // Cost, time and hours were the three things the traveller said were useless.
  // They go above everything else, and the strip stays put while the rest
  // scrolls under it.
  const verdict: Array<{ label: string; value: string; note?: string }> = [
    { label: 'Cost', value: admission.headline, note: admission.note },
    { label: 'Time needed', value: formatDuration(evidence?.typicalVisitMinutes || candidate.estimatedVisitMinutes) },
    {
      label: hours.unknown ? 'Hours' : 'Today',
      value: hours.todayLine ?? 'Not published',
      note: hours.unknown ? 'no source published them' : undefined,
    },
  ];

  // What is left after the three facts above were promoted out of it.
  const specs: Array<{ label: string; value: string }> = [];
  if (queueMinutes) specs.push({ label: 'Typical queue', value: `${Math.round(queueMinutes)} min reported` });
  if (bestWindow) specs.push({ label: 'Best time', value: `${bestWindow.start}–${bestWindow.end}` });
  if (crowdLabel) specs.push({ label: 'Crowding', value: crowdLabel });
  if (reservation) specs.push({ label: 'Booking', value: reservation });
  specs.push({ label: 'Weather', value: INDOOR_LABEL[candidate.indoorOutdoor] });
  specs.push({ label: 'Area', value: candidate.neighbourhood || candidate.city });

  const points = rationale?.length ? rationale.map((point) => ({ key: point.id, text: point.text })) : reasons.map((reason) => ({ key: reason, text: reason }));

  /** Prepared upstream; the card only renders it. */
  const intelligenceView = context?.intelligenceView ?? null;

  /**
   * Whether the ranking can actually be explained for this place.
   *
   * `placeRationale` emits a single `variety` point when no dimension cleared
   * the notable threshold — an honest "nothing stands out on paper". Printing
   * that under a heading reading *"Why it is #1 for you"* makes the heading a
   * promise the body immediately breaks, which reads worse than either half
   * alone. Where there is no reason, the heading stops claiming there is one.
   */
  const hasRankReason = points.some((point) => point.key !== 'variety');

  /** The number the provenance line prints, so the sentence can agree with it. */
  const sourceCount = evidence?.sourceCount || candidate.sourceReferences.length;

  /** Model prose, shown only where no human wrote any. Always labelled. */
  const brief = evidence?.brief;

  return (
    <div className="destination-detail">
      <dl className="destination-detail-verdict">
        {verdict.map((item) => (
          <div key={item.label}>
            <dt>{item.label}</dt>
            <dd>
              {item.value}
              {item.note && <small>{item.note}</small>}
            </dd>
          </div>
        ))}
      </dl>

      {(tripClosure || reportedClosure) && (
        <p className="destination-detail-alert">
          {reportedClosure ?? `Closed on ${tripClosure!.label} — a day of your trip.`}
        </p>
      )}

      {candidate.description && <p className="destination-detail-description">{candidate.description}</p>}

      {/**
        * A model-written description, and only when a human-written one is
        * absent — most OSM places have no prose at all because no Wikivoyage
        * listing matched, which is the gap this fills.
        *
        * The label is not decoration. Every sentence here has been checked to
        * quote its source verbatim, but "grounded" is not the same as "written
        * by a person", and a traveller is entitled to know which they are
        * reading before they weigh it. Blending the two into one paragraph
        * would make that impossible, so the two can never share an element.
        */}
      {!candidate.description && brief && (
        <div className="destination-detail-brief">
          <p className="destination-detail-description">
            {brief.sentences.map((sentence) => sentence.text).join(' ')}
          </p>
          <p className="destination-detail-provenance">
            {`Description written by AI from ${brief.sourceCount} ${brief.sourceCount === 1 ? 'source' : 'sources'}, each sentence quoted from one of them`}
          </p>
        </div>
      )}

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

      {intelligenceView ? (
        /**
         * Every line here rests on an atom checked against the traveller's own
         * selections and this app's own numbers. The wording is ours, so no
         * phrasing the model produced reaches the screen.
         */
        <div className="destination-detail-section">
          <h6>{intelligenceView.fitLabel || 'Why it is on your list'}</h6>
          {intelligenceView.matches.length > 0 && (
            <div className="destination-tag-row">
              {intelligenceView.matches.map((match) => (
                <span key={match} className="destination-tag">{match}</span>
              ))}
            </div>
          )}
          {intelligenceView.explanation.length > 0 && (
            <ul className="destination-detail-list">
              {intelligenceView.explanation.map((line) => <li key={line}>{line}</li>)}
            </ul>
          )}
          {intelligenceView.pairings.length > 0 && (
            <p className="destination-detail-note">
              Worth considering alongside {intelligenceView.pairings.join(' and ')}.
            </p>
          )}
        </div>
      ) : points.length > 0 && (
        /**
         * The deterministic rationale — what every card shows until advice
         * arrives, and what it keeps if none ever does. Pending, refused and
         * "nothing worth saying" all land here, because a card must stay
         * decidable without the model.
         */
        <div className="destination-detail-section">
          {/* The heading names the position, because that is the actual question
              — but only when there is an answer to give. */}
          <h6>
            {context?.position && hasRankReason
              ? `Why it is #${context.position} for you`
              : 'Why it is on your list'}
          </h6>
          <ul className="destination-detail-list">
            {points.slice(0, 4).map((point) => <li key={point.key}>{point.text}</li>)}
          </ul>
        </div>
      )}

      {/* Shown whenever there is something to attribute — not only when there
          are extra fares. A single ¥600 with no source behind it is a number
          the traveller has no way to weigh, which is what the provenance line
          exists to prevent. */}
      {(admission.fares.length > 0 || admission.rawText || (admission.sourced && admission.provenance)) && (
        <div className="destination-detail-section">
          <h6>Admission</h6>
          {admission.fares.length > 0 && (
            <dl className="destination-detail-fares">
              {admission.fares.map((fare) => (
                <div key={fare.label}>
                  <dt>{fare.label}</dt>
                  <dd>{fare.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {/* The source's own words, whenever parsing could not represent all
              of them. Better a quote than a number we had to round off. */}
          {admission.rawText && <p className="destination-detail-quote">“{admission.rawText}”</p>}
          {admission.provenance && <p className="destination-detail-provenance">{admission.provenance}</p>}
        </div>
      )}

      {!hours.unknown && (
        <div className="destination-detail-section">
          <h6>Opening hours</h6>
          <dl className="destination-detail-hours">
            {hours.weekly.map((group) => (
              <div key={group.label}>
                <dt>{group.label}</dt>
                <dd>{group.windows.join(', ')}</dd>
              </div>
            ))}
          </dl>
          {hours.closedDays.length > 0 && (
            <p className="destination-detail-closed">
              {`Closed ${hours.closedDays.join(', ')}`}
            </p>
          )}
          {hours.provenanceLine && <p className="destination-detail-provenance">{hours.provenanceLine}</p>}
        </div>
      )}

      {/* Stated gaps. The parser refuses to guess at holiday or seasonal hours,
          which is right — but silently, which left a confident-looking weekly
          schedule missing the one clause that mattered. */}
      {hours.caveats.length > 0 && (
        <ul className="destination-detail-list is-caveats">
          {hours.caveats.map((caveat) => <li key={caveat}>{caveat}</li>)}
        </ul>
      )}

      <dl className="destination-detail-specs">
        {specs.map((spec) => (
          <div key={spec.label}>
            <dt>{spec.label}</dt>
            <dd>{spec.value}</dd>
          </div>
        ))}
      </dl>

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

      {/* A list, not `join(' ')`. Six sentences run together were unreadable
          exactly when they mattered most. */}
      {otherCautions.length > 0 && (
        <ul className="destination-match-caution">
          {otherCautions.map((caution) => <li key={caution}>{caution}</li>)}
        </ul>
      )}

      <p className="destination-detail-provenance">
        {evidence?.sourceCount
          ? `${evidence.sourceCount} independent ${evidence.sourceCount === 1 ? 'source' : 'sources'}`
          : `${candidate.sourceReferences.length} ${candidate.sourceReferences.length === 1 ? 'source' : 'sources'}`}
        {` · ${sourceConfidenceNote(candidate.sourceConfidence, sourceCount)}`}
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
    <article
      className="destination-candidate"
      data-decision={decision || 'undecided'}
      data-candidate-id={candidate.id}
      data-decision-target={decisionTargetIdOf(candidate)}
    >
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
          : (
            // Most OSM places have no description at all — prose only arrives
            // with a matched Wikivoyage listing. What it costs is the next most
            // decision-relevant thing, and now there is always an answer.
            <p className="destination-candidate-description">
              {candidate.description || admissionLine(admissionFor(candidate))}
            </p>
          )}

        <div className="destination-candidate-footer">
          <fieldset className="destination-decision-group">
            <legend className="sr-only">Preference for {candidate.name}</legend>
            {DECISIONS.map((option) => (
              <label
                key={option.id}
                className="destination-decision-option"
                data-active={decision === option.id ? 'true' : 'false'}
                title={DECISION_HINT[option.id]}
              >
                <input
                  className="destination-decision-input"
                  type="radio"
                  name={`candidate-decision-${candidate.id}`}
                  value={option.id}
                  checked={decision === option.id}
                  onChange={() => onDecision(option.id)}
                  onClick={() => {
                    if (decision === option.id) onDecision(option.id);
                  }}
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
 * judgement is not enough. Used on both mobile and desktop; the same swipe,
 * keyboard and button routes to a decision exist on each, because a pointer is
 * a pointer whether it is a finger or a mouse.
 */
export function DeckCard({
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
  /** Whether the current pointer gesture has travelled far enough to be a drag. */
  const dragMovedRef = useRef(false);

  useEffect(() => {
    x.set(0);
    // A committed swipe replaces the card without ever firing the click that
    // would have cleared this, so the next card must not start suppressed.
    dragMovedRef.current = false;
  }, [candidate.id, x]);

  const commit = (decision: DiscoveryCandidateDecision) => onDecision(decision);
  const flip = (next: boolean) => { onFlippedChange(next); hapticTap(); };

  const openDetails = () => {
    // Consume the click that trails a drag rather than reading it as a tap.
    if (dragMovedRef.current) {
      dragMovedRef.current = false;
      return;
    }
    flip(true);
  };

  /**
   * Clicking the back flips it shut, which is what Space has always done. The
   * rule itself lives in `deckGestures.ts`; this reads the live selection,
   * which only the browser can answer.
   */
  const closeDetailsFromSurface = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!shouldCloseFromSurface(event.target, Boolean(window.getSelection()?.toString()))) return;
    flip(false);
  };

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
        drag={flipped || reduceMotion ? false : 'x'}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.92}
        onDragStart={() => { dragMovedRef.current = false; }}
        onDrag={(_, info) => {
          if (isDragIntent(info.offset.x)) dragMovedRef.current = true;
        }}
        onDragEnd={(_, info) => {
          const decision = swipeDecision(info.offset.x, info.velocity.x);
          if (decision) commit(decision);
        }}
      >
        <motion.span className="destination-deck-stamp is-must" style={{ opacity: mustOpacity }}>Must do</motion.span>
        <motion.span className="destination-deck-stamp is-skip" style={{ opacity: skipOpacity }}>Skip</motion.span>

        <div className={`destination-flip-scene${flipped ? ' is-flipped' : ''}`}>
          <div className="destination-flip-inner">
            <button
              type="button"
              className="destination-flip-face is-front"
              onClick={openDetails}
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

            <div className="destination-flip-face is-back" aria-hidden={!flipped} onClick={closeDetailsFromSurface}>
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
            </div>
          </div>
        </div>

        {flipped && (
          <>
            <div className="destination-deck-actions">
              <button type="button" className="destination-quick-action is-skip" title={DECISION_HINT.skip} onClick={() => commit('skip')}>Skip</button>
              <button type="button" className="destination-quick-action is-detail" onClick={() => commit('interested')}>Interested</button>
              <button type="button" className="destination-quick-action is-must" onClick={() => commit('must-do')}>Must do</button>
            </div>
            <p className="destination-deck-hint">Choose a preference, or close the card to keep browsing</p>
          </>
        )}

        {!flipped && (
          <>
            <div className="destination-deck-actions">
              <button type="button" className="destination-quick-action is-skip" title={DECISION_HINT.skip} onClick={() => commit('skip')}>Skip</button>
              <button type="button" className="destination-quick-action is-detail" onClick={() => flip(true)}>Details</button>
              <button type="button" className="destination-quick-action is-must" onClick={() => commit('must-do')}>Must do</button>
            </div>
            <p className="destination-deck-hint">
              {isDesktop
                ? 'Drag or ← skip · → must do · ↑ interested · Space details'
                : 'Swipe right to keep · left to skip'}
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
  if (reason === 'closed-on-this-day') return 'Closed on the days left in your trip';
  if (reason === 'free-time-floor') return 'Would leave your days with no breathing room';
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
                {/* The scheduler's own sentence when it has one — it says what
                    actually blocked this place, which the category cannot. */}
                <small>{item.detail || unscheduledReasonLabel(item.reason)}</small>
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
          {/*
            * A multi-city plan is named after the trip, not after whichever
            * deck was open when Build was pressed — and the division between
            * cities is stated here, because it is the decision a traveller is
            * most likely to want to argue with.
            */}
          <h4>Your {result.cityLegs.length > 1
            ? result.cityLegs.map((leg) => leg.city).join(' · ')
            : cityLabel} plan</h4>
          <p>{placeCount} places across {plannedDays} {plannedDays === 1 ? 'day' : 'days'}.</p>
          {result.cityLegs.length > 1 && (
            <p className="destination-preview-legs">{describeCityLegs(result.cityLegs)}</p>
          )}
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
            {visibleUnscheduled.map(({ candidate, reason, detail }) => (
              <li key={candidate.id}>
                <span>{candidate.name}</span>
                {/* Always shown, even when every place shares a category: two
                    places can both be "Opening hours don't fit" for entirely
                    different reasons, and the specific one is the useful part. */}
                <small>{detail || unscheduledReasonLabel(reason)}</small>
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
  // Live rates, so a sourced fare can carry an approximate home-currency
  // equivalent beside it. The published figure always leads.
  const { homeCurrency, rates } = useCurrency();
  /**
   * A trip is reviewed one city at a time, and built from all of them.
   *
   * Discovery used to read `profile.destinations[0]` and nothing else, so a
   * traveller who chose Osaka, Nara, Kyoto and Kobe was shown Osaka places,
   * shortlisted Osaka places, and got an Osaka plan. Each city now has its own
   * deck; the decisions are one map across the whole trip, because a place id
   * is unique and a build needs every city at once.
   */
  const tripDestinations = useMemo(() => {
    const fromProfile = profile.destinations.filter((entry) => entry.city.trim().length > 0);
    if (fromProfile.length > 0) return fromProfile;
    // A trip saved before destinations existed still has its city list.
    return itinerary.cities.filter(Boolean).map((city) => manualDestination(city, ''));
  }, [profile.destinations, itinerary.cities]);
  const [activeCityIndex, setActiveCityIndex] = useState(0);
  const destination = tripDestinations[Math.min(activeCityIndex, Math.max(0, tripDestinations.length - 1))]
    ?? profile.destinations[0];
  const primaryCity = destination?.city || itinerary.cities[0] || '';
  const isMultiCity = tripDestinations.length > 1;
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
  /**
   * Saved decisions belong to the *trip*, not to whichever city is on screen.
   * Matching only the active city would throw away a whole multi-city review
   * the moment the traveller reopened the panel on a different tab.
   */
  const savedStateMatchesCity = Boolean(
    itinerary.discoveryState
    && [capability.destination.city, ...tripDestinations.map((entry) => entry.city), ...itinerary.cities]
      .filter(Boolean)
      .some((city) => city.toLowerCase() === itinerary.discoveryState!.city.toLowerCase()),
  );
  const [phase, setPhase] = useState<DiscoveryPhase>(() => {
    if (itinerary.discoveryState?.stage === 'itinerary-built' && savedStateMatchesCity) return 'built';
    // Candidate records live in component state and are not persisted in the
    // itinerary. Re-open discovery for any non-built saved state so a reload
    // cannot render an empty review panel with no way to fetch candidates.
    return 'idle';
  });
  /**
   * Candidates per city, keyed by the canonical city label.
   *
   * Kept apart rather than in one list so switching cities does not re-fetch
   * what has already been reviewed, and so a build can draw on every city the
   * traveller has been through in this session. Candidates are not persisted —
   * only decisions are — so this empties on reload, exactly as before.
   */
  const [candidatesByCity, setCandidatesByCity] = useState<Record<string, PlaceCandidate[]>>({});
  /**
   * Memoised so the empty case is a stable reference: `?? []` allocates a new
   * array every render, which would re-run every memo and effect keyed on the
   * deck — including the one that buys evidence.
   */
  const candidates = useMemo(() => candidatesByCity[cityLabel] ?? [], [candidatesByCity, cityLabel]);
  /**
   * Review model: listing identity stays on `candidate.id`, while an explicit
   * saved-activity link (or an injected saved place) is the decision target.
   * Discovery `candidates` are left untouched so Build/intelligence keep
   * listing ids.
   */
  const reviewCandidates = useMemo(
    () => reviewCandidatesForItinerary(candidates, itinerary, { city: cityLabel }),
    [candidates, itinerary, cityLabel],
  );
  /**
   * Personalised advice, keyed by candidate id and held apart from the ranked
   * candidates themselves. Separate on purpose: an answer arriving late must
   * not recreate the ranking data and move the deck under the traveller.
   */
  const [intelligence, setIntelligence] = useState<Record<string, CandidateIntelligenceEntry>>({});
  /** One controller for the component's life; it owns dedup and staleness. */
  const intelligenceController = useRef(new IntelligenceRequestController());

  /**
   * The candidate-intelligence request, built from the **canonical pool**.
   *
   * `candidates` rather than `pendingDeck`, and that distinction is the whole
   * guarantee: `pendingDeck` is decision-filtered, so building the key from it
   * would make Skip remove a candidate, change the fingerprint, and buy fresh
   * answers about the places the traveller did *not* skip.
   */
  const intelligenceRequest = useMemo(() => {
    const tripMaterial = toCandidateIntelligenceTripMaterial({
      tripMaterialRevision: '',
      styles: profile.styles || [],
      pace: inferPace(profile),
    });
    const tripRevision = tripMaterialRevision(tripMaterial);

    const entries = candidates.map((candidate) => {
      const base = {
        candidateId: candidate.id,
        candidateRevision: '',
        plannerRevision: '',
        name: candidate.name,
        category: '',
        matchedStyleTags: matchedStyleTags(candidate, profile),
        durationRangeMinutes: undefined,
        indoorOutdoor: candidate.indoorOutdoor === 'indoor' || candidate.indoorOutdoor === 'outdoor'
          ? candidate.indoorOutdoor
          : undefined,
        pairableCandidateIds: [],
      };
      const material = toCandidateIntelligenceMaterial(base as never);
      const planner = toPlannerIntelligenceMaterial(base as never);
      return {
        ...base,
        ...material,
        ...planner,
        // The transport contract omits unavailable planner fields rather than
        // serialising its internal null sentinel.
        clusterId: planner.clusterId ?? undefined,
        durationRangeMinutes: material.durationRangeMinutes ?? undefined,
        indoorOutdoor: material.indoorOutdoor ?? undefined,
        candidateRevision: candidateMaterialRevision(material),
        plannerRevision: plannerMaterialRevision(planner),
      };
    });

    return { tripMaterial, tripRevision, entries };
  }, [candidates, profile]);

  /** The latest payload is available without making payload identity a trigger. */
  const latestIntelligenceRequestRef = useRef(intelligenceRequest);
  latestIntelligenceRequestRef.current = intelligenceRequest;

  /**
   * One primitive the effect can depend on.
   *
   * Everything a traveller does while browsing — deck index, flip, scroll,
   * decisions, viewport — is absent by construction, because none of it is an
   * input here. A key that cannot see UI state cannot be moved by it.
   */
  const materialKey = useMemo(
    () => JSON.stringify([
      itinerary.id,
      materialRequestKey({
        tripMaterialRevision: intelligenceRequest.tripRevision,
        candidates: intelligenceRequest.entries,
      }),
    ]),
    [intelligenceRequest, itinerary.id],
  );
  const latestMaterialKeyRef = useRef(materialKey);
  latestMaterialKeyRef.current = materialKey;

  useEffect(() => {
    const request = latestIntelligenceRequestRef.current;
    if (!isSupabaseConfigured() || request.entries.length === 0) return;
    const controller = intelligenceController.current;
    const issuedKey = materialKey;

    const held = controller.cached(issuedKey);
    if (held) { setIntelligence(Object.fromEntries(held)); return; }
    if (!controller.shouldRequest(issuedKey)) return;

    controller.begin(issuedKey);
    let active = true;
    void fetchCandidateIntelligence(
      { tripId: itinerary.id, ...request.tripMaterial, tripMaterialRevision: request.tripRevision },
      request.entries,
    ).then((rows) => {
      // The key comparison, not the unmount flag, is what makes a late answer
      // safe: an in-flight request whose material has moved on must not land.
      if (!active || !controller.accepts(issuedKey, latestMaterialKeyRef.current)) return;
      if (!rows) { controller.settle(issuedKey, undefined); return; }
      const entries = foldIntelligenceResults(rows);
      controller.settle(issuedKey, entries);
      setIntelligence(Object.fromEntries(entries));
    });
    return () => { active = false; };
  }, [itinerary.id, materialKey]);

  const setCandidates = useCallback(
    (update: PlaceCandidate[] | ((previous: PlaceCandidate[]) => PlaceCandidate[])) => {
      setCandidatesByCity((previous) => ({
        ...previous,
        [cityLabel]: typeof update === 'function' ? update(previous[cityLabel] ?? []) : update,
      }));
    },
    [cityLabel],
  );
  /** Every place the traveller has been shown this session, across all cities. */
  const allCandidates = useMemo(
    () => Object.values(candidatesByCity).flat(),
    [candidatesByCity],
  );
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
  const reviewRanked = useMemo(
    () => rankWithIntelligence(reviewCandidates, profile, { evidence: evidenceSummaries, trends }),
    [reviewCandidates, profile, evidenceSummaries, trends],
  );
  /**
   * The whole trip's places, ranked together. The deck reviews one city at a
   * time; the plan is built from all of them at once, which is the only way a
   * Kyoto day can hold Kyoto places.
   */
  const rankedAll = useMemo(
    () => (isMultiCity
      ? rankWithIntelligence(allCandidates, profile, { evidence: evidenceSummaries, trends })
      : ranked),
    [isMultiCity, allCandidates, profile, evidenceSummaries, trends, ranked],
  );
  /**
   * Trip capacity, derived the same way `buildDestinationItinerary` derives it,
   * so the deck recommends the number of places the build can actually use.
   */
  const tripDayCount = Math.max(1, itinerary.days.length || profile.dayCount || 1);
  const tripBehaviour = useMemo(
    () => applyTravellerConstraints(deriveTravelBehaviour(profile)),
    [profile],
  );
  /**
   * The days this city actually has.
   *
   * Taken from the traveller's stay plan wherever they have set one, because
   * that is a decision they made rather than a number to infer. Without a plan
   * — an older trip, or one still being filled in — an even split is the
   * fallback, and the panel says so rather than presenting it as settled.
   */
  const statedLegs = useMemo(
    () => legsFromCityStays(
      reconcileCityStays(profile.cityStays, tripDestinations.map((entry) => entry.city)),
      tripDayCount,
    ),
    [profile.cityStays, tripDestinations, tripDayCount],
  );
  const activeLeg = statedLegs.find((leg) => leg.city.toLowerCase() === (destination?.city || '').toLowerCase());
  const hasStayPlan = statedLegs.length > 0;
  const cityDayCount = activeLeg?.days
    ?? Math.max(1, Math.round(tripDayCount / Math.max(1, tripDestinations.length)));
  const shortlistSize = useMemo(
    () => shortlistTarget(cityDayCount, tripBehaviour, ranked.filter(({ candidate }) => !isFoodOnly(candidate)).length),
    [cityDayCount, tripBehaviour, ranked],
  );
  const groupedRanked = useMemo(() => {
    const assigned = new Set<string>();
    const groups = GROUPS.map((group) => {
      const items = reviewRanked.filter(({ candidate }) => (
        !assigned.has(candidate.id)
        && candidate.categories.some((category) => (group.matches as readonly string[]).includes(category))
      ));
      items.forEach(({ candidate }) => assigned.add(candidate.id));
      return { ...group, items };
    });
    const leftover = reviewRanked.filter(({ candidate }) => !assigned.has(candidate.id));
    return leftover.length === 0
      ? groups
      : [...groups, { id: 'also', label: 'Also on this trip', matches: [] as readonly string[], items: leftover }];
  }, [reviewRanked]);
  const [decisions, setDecisions] = useState<Record<string, CandidateDecision>>(() => (
    savedStateMatchesCity ? itinerary.discoveryState!.decisions : {}
  ));
  /**
   * Set when a re-discovery discarded choices about places no longer offered.
   * Candidates are not persisted, so restored decisions cannot be checked
   * against anything until discovery returns — this is where the traveller
   * finds out.
   */
  const [decisionNotice, setDecisionNotice] = useState<string | null>(null);
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
      return safeGetItem(DESKTOP_REVIEW_MODE_KEY) === 'list' ? 'list' : 'deck';
    } catch {
      return 'deck';
    }
  });
  useEffect(() => {
    try {
      safeSetItem(DESKTOP_REVIEW_MODE_KEY, desktopMode);
    } catch {
      // Preference persistence is optional; the in-memory choice still works.
    }
  }, [desktopMode]);
  /**
   * Progress is reported for the city on screen. A trip-wide count beside a
   * one-city deck reads as "45 of 20 reviewed" — the same class of nonsense
   * `d89bbe8` removed, arrived at from the other direction.
   */
  const isSelected = (decision: CandidateDecision | undefined) =>
    decision === 'must-do' || decision === 'interested';
  const selectedCount = reviewRanked.filter(({ candidate }) => (
    isSelected(resolvedCardDecision(decisions, candidate))
  )).length;
  const reviewedCount = reviewRanked.filter(({ candidate }) => (
    Boolean(resolvedCardDecision(decisions, candidate))
  )).length;
  /** Across every city, which is what the build will actually receive. */
  const tripSelectedCount = Object.values(decisions).filter(isSelected).length;
  /**
   * What "build" is judged against. On a multi-city trip a traveller may be
   * looking at an untouched Kobe deck with twenty places kept in Osaka — the
   * button must not be disabled by the city that happens to be on screen.
   */
  const buildableCount = isMultiCity ? tripSelectedCount : selectedCount;
  const pendingDeck = useMemo(
    () => reviewRanked.filter(({ candidate }) => !resolvedCardDecision(decisions, candidate)),
    [reviewRanked, decisions],
  );
  const currentDeckCard = (focusedCandidateId
    ? pendingDeck.find(({ candidate }) => candidate.id === focusedCandidateId)
    : undefined) || pendingDeck[0] || null;

  /**
   * Evidence is gathered for the cards the traveller is actually looking at,
   * never for the whole shortlist. Reviews are the most expensive data the app
   * buys, so a sixty-place list abandoned after four cards must cost four
   * places' worth of provider calls, not sixty.
   *
   * Ids already asked for are remembered so re-ranking — which happens every
   * time evidence arrives — cannot re-request them.
   */
  const evidenceRequestedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (phase !== 'review' || usingFixture || !isSupabaseConfigured()) return;
    const visible = [
      ...(currentDeckCard ? [currentDeckCard] : []),
      ...pendingDeck.slice(0, EVIDENCE_PREFETCH_COUNT),
    ];
    const wanted = visible
      .map(({ candidate }) => candidate)
      .filter((candidate) => candidate.providerPlaceId && !evidenceRequestedRef.current.has(candidate.id));
    const unique = [...new Map(wanted.map((candidate) => [candidate.id, candidate])).values()];
    if (unique.length === 0) return;

    unique.forEach((candidate) => evidenceRequestedRef.current.add(candidate.id));
    let active = true;
    void fetchPlaceEvidence(
      { city: capability.destination.city, countryCode: capability.destination.countryCode },
      unique,
      invokeTravelFunction,
      { provider: capability.places.provider },
    ).then((digest) => {
      if (!active) return;
      // Merged, not replaced: each batch only carries the places it asked for.
      setQueueEvidence((previous) => ({ ...previous, ...digest.queueEvidence }));
      setEvidenceSummaries((previous) => ({ ...previous, ...digest.evidenceSummaries }));
      setTrends((previous) => ({ ...previous, ...digest.trends }));

      // Hours from an operator's own site replace whatever the map provider
      // held. Community-maintained hours go stale; this is what corrects them,
      // and it is what stops a day being built around a closed door.
      const official = digest.officialHours;
      const officialAdmissions = digest.officialAdmissions;
      const windows = digest.bestTimeWindows;
      if (Object.keys(official).length > 0 || Object.keys(officialAdmissions).length > 0 || Object.keys(windows).length > 0) {
        setCandidates((previous) => previous.map((candidate) => {
          const hours = official[candidate.id];
          const admission = officialAdmissions[candidate.id];
          const best = windows[candidate.id];
          if (!hours && !admission && !best) return candidate;
          return {
            ...candidate,
            ...(hours ? { openingHours: hours } : {}),
            // An operator's structured offer outranks the map or guidebook
            // value already on the candidate. `mergeAdmission` also carries a
            // category expectation along when the official page only answered
            // part of the question.
            ...(admission ? { admission: mergeAdmission(admission, candidate.admission) } : {}),
            // When travellers agree a place is best at a particular time, the
            // scheduler aims for it rather than dropping the place in wherever
            // it happens to fit.
            ...(best ? { bestTimeWindows: best } : {}),
          };
        }));
      }
    });
    return () => { active = false; };
  }, [phase, usingFixture, currentDeckCard, pendingDeck, setCandidates, capability.destination.city, capability.destination.countryCode, capability.places.provider]);

  /**
   * Real photographs, for the cards the traveller is actually looking at.
   *
   * A separate effect from evidence, and a separate request, because the two
   * answer to different limits: evidence is metered and rationed per place,
   * while images come from Wikimedia, which cannot bill and answers a whole
   * deck in a handful of batched calls. Folding images into the evidence call
   * would tie a free lookup to a rationed one and lose the pictures whenever
   * the metered path declined to run.
   *
   * The same "asked already" ledger discipline applies: re-ranking happens
   * every time evidence lands, so without it every arrival would re-request
   * the same photographs.
   */
  const photosRequestedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (phase !== 'review' || usingFixture || !isSupabaseConfigured()) return;
    const visible = [
      ...(currentDeckCard ? [currentDeckCard] : []),
      ...pendingDeck.slice(0, EVIDENCE_PREFETCH_COUNT),
    ];
    const wanted = visible
      .map(({ candidate }) => candidate)
      // A place with no pointer has nothing to look up, and a place that
      // already has its photograph has nothing to gain.
      .filter((candidate) => (candidate.imageLeads?.length ?? 0) > 0
        && !candidate.photoUrl
        && !photosRequestedRef.current.has(candidate.id));
    const unique = [...new Map(wanted.map((candidate) => [candidate.id, candidate])).values()];
    if (unique.length === 0) return;

    unique.forEach((candidate) => photosRequestedRef.current.add(candidate.id));
    let active = true;
    void fetchPlacePhotos(unique, invokeTravelFunction, { provider: capability.places.provider })
      .then((photos) => {
        if (!active || Object.keys(photos).length === 0) return;
        setCandidates((previous) => previous.map((candidate) => {
          const photo = photos[candidate.id];
          if (!photo) return candidate;
          return {
            ...candidate,
            photoUrl: photo.url,
            photoAttribution: photo.attribution,
            photoSourcePage: photo.sourcePage,
          };
        }));
      });
    return () => { active = false; };
  }, [phase, usingFixture, currentDeckCard, pendingDeck, setCandidates, capability.places.provider]);
  /**
   * Context every card shares: the traveller's dates, so a weekly closure can
   * be named as a day of *their* trip, and a conversion for sourced fares. Held
   * apart from the per-card fields so the deck and the browse list cannot drift
   * into describing the same place differently.
   */
  const sharedContext = useMemo(() => ({
    tripStart: profile.startDate,
    tripEnd: profile.endDate,
    toHomeCurrency: (amount: number, currency: string) => {
      if (!homeCurrency || currency === homeCurrency) return undefined;
      // No real rate means no approximation. `rateFor` ends in `?? 1`, so a
      // currency the catalog has never heard of would render COP 50,000 as
      // "RM 50,000" — a number a thousand times out, sitting beside a
      // correctly published one. Omitting it costs the traveller nothing.
      if (!hasRate(rates, currency) || !hasRate(rates, homeCurrency)) return undefined;
      // Explicitly approximate: a ticket price is fixed, an exchange rate is
      // not, and the published figure always leads.
      return formatCurrency(convertCurrency(amount, currency, homeCurrency, rates), homeCurrency);
    },
  }), [profile.startDate, profile.endDate, homeCurrency, rates]);

  /**
   * Prepared view data for one candidate, or null.
   *
   * Only a `ready` entry produces a view. `deterministic-only` means the model
   * was asked and had nothing to add; `unavailable` means it never ran. Both
   * keep the deterministic rationale, because a card that swapped useful text
   * for an apology would be worse than one that never tried.
   *
   * Pairings resolve against the *current* canonical pool, which is why the
   * display name is deliberately not model material: a corrected spelling
   * shows immediately and costs no new request.
   */
  const intelligenceViewFor = useCallback((candidateId: string): IntelligenceView | null => {
    const entry = intelligence[candidateId];
    if (!entry || entry.status !== 'ready' || !entry.intelligence) return null;
    const pool = new Map(intelligenceRequest.entries.map((item) => [item.candidateId, item]));
    const self = pool.get(candidateId);
    if (!self) return null;
    const names = entry.intelligence.pairWithCandidateIds
      .map((id) => candidates.find((candidate) => candidate.id === id)?.name)
      .filter(Boolean) as string[];
    return buildIntelligenceView(
      entry.intelligence,
      // The renderer owns the words; this only chooses which of them survive
      // as chips rather than sentences.
      renderIntelligenceCopy(entry.intelligence, self as never, pool as never),
      names,
    );
  }, [intelligence, intelligenceRequest, candidates]);

  /** Rank position by candidate id, so a card can say what it is ranked. */
  const rankPositions = useMemo(() => {
    const positions = new Map<string, number>();
    reviewRanked.forEach((entry, index) => positions.set(entry.candidate.id, index + 1));
    return positions;
  }, [reviewRanked]);

  const deckContext = useMemo<CandidateContext | undefined>(() => {
    if (!currentDeckCard) return undefined;
    const id = currentDeckCard.candidate.id;
    return {
      ...sharedContext,
      evidence: evidenceSummaries[id],
      queueMinutes: queueEvidence[id],
      position: rankPositions.get(id),
      intelligenceView: intelligenceViewFor(id),
    };
  }, [currentDeckCard, evidenceSummaries, queueEvidence, sharedContext, rankPositions, intelligenceViewFor]);
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
        // Every city reviewed this session, so a reload can tell which of the
        // restored decisions still belong to places the trip has seen.
        candidateIds: [...allCandidates.map((candidate) => candidate.id), ...candidates.map((candidate) => candidate.id)]
          .filter((id, index, all) => all.indexOf(id) === index),
        decisions: next,
        discoveredAt,
        updatedAt: new Date().toISOString(),
        stage: 'reviewing',
      },
    });
  };

  /**
   * The selected city is read at click time, so Start always discovers the
   * city currently shown by the switcher.
   */
  const beginDiscovery = async (cityIndex = activeCityIndex) => {
    const target = tripDestinations[cityIndex] ?? destination;
    const targetCapability = target
      ? capabilityFor({ city: target.city, region: target.region, countryCode: target.countryCode || '' }, runtime)
      : capability;
    const targetLabel = targetCapability.destination.city || target?.city || cityLabel;
    if (!canDiscover(targetCapability)) return;
    setLoading(true);
    setError(null);
    try {
      // Live provider first; the captured library is the labelled fallback.
      const activeRuntime = await loadProviderRuntime(
        isSupabaseConfigured() ? (name) => invokeTravelFunction(name) : undefined,
      );
      const outcome = await discoverPlaces(
        {
          city: targetCapability.destination.city,
          region: target?.region,
          countryCode: target?.countryCode || targetCapability.destination.countryCode,
          lat: target?.lat,
          lng: target?.lng,
        },
        activeRuntime,
        isSupabaseConfigured() ? invokeTravelFunction : undefined,
      );
      setUsingFixture(outcome.usingFixture);
      // Discovery no longer carries evidence; it arrives per card from the
      // effect below. Clear the previous run's evidence and the record of what
      // was asked for, so a new city starts genuinely empty.
      evidenceRequestedRef.current = new Set();
      setQueueEvidence(outcome.queueEvidence);
      setEvidenceSummaries(outcome.evidenceSummaries);
      setTrends(outcome.trends);

      const discovered = outcome.candidates.length > 0
        ? outcome.candidates
        : await new FixturePlaceDiscoveryProvider().search({
          city: targetCapability.destination.city,
          countryCode: targetCapability.destination.countryCode,
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
      /**
       * Decisions survive a re-discovery, but only for places still on offer.
       * A provider can return a different set for the same city, and keeping
       * the rest leaves the deck counting choices about cards it does not have.
       *
       * Pruned against *every* city's candidates rather than this one's. Using
       * only the active deck would delete the traveller's Kyoto choices the
       * moment they opened Nara — the failure `d89bbe8` fixed, in a new
       * disguise.
       */
      const stillOffered = [
        ...discovered,
        ...Object.entries(candidatesByCity)
          .filter(([city]) => city !== targetLabel)
          .flatMap(([, cityCandidates]) => cityCandidates),
      ];
      const pruned = pruneDecisionsToCandidates(
        decisionsRef.current,
        bindSavedActivityIds(stillOffered, itinerary),
        retainedDecisionIdsOf(itinerary),
      );
      setCandidatesByCity((previous) => ({ ...previous, [targetLabel]: discovered }));
      setActiveCityIndex(cityIndex);
      decisionsRef.current = pruned.decisions;
      setDecisions(pruned.decisions);
      // Nothing is dropped silently: a selection that vanishes between runs is
      // the traveller's work disappearing, and they get told.
      setDecisionNotice(pruned.dropped > 0
        ? `${pruned.dropped} earlier ${pruned.dropped === 1 ? 'choice' : 'choices'} no longer match places on offer here, so ${pruned.dropped === 1 ? 'it was' : 'they were'} cleared.`
        : null);
      setPhase('review');
      persistDecisions(pruned.decisions, new Date().toISOString());
    } catch (discoveryError) {
      setError(discoveryError instanceof Error ? discoveryError.message : 'Discovery could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  /**
   * Move the deck to another city only when its candidates are already known.
   * An unreviewed city stays in the intro until the traveller presses Start,
   * so switching tabs never begins discovery by surprise.
   */
  const switchCity = (index: number) => {
    if (index === activeCityIndex || loading) return;
    hapticTap();
    const label = tripDestinations[index]?.city ?? '';
    const known = Object.keys(candidatesByCity).find((city) => city.toLowerCase() === label.toLowerCase());
    setActiveCityIndex(index);
    setFocusedCandidateId(null);
    setDecisionNotice(null);
    setError(null);
    // City tabs select a destination; discovery remains behind the explicit
    // Start action. If a traveller is already reviewing and picks an
    // unreviewed city, show the intro so they can start it intentionally.
    if (phase === 'review' && (!known || (candidatesByCity[known]?.length ?? 0) === 0)) {
      setPhase('idle');
    }
  };

  const closeReview = () => {
    hapticTap();
    setPhase('idle');
  };

  /** Per-city review state and stay length, for the switcher's own labels. */
  const cityProgress = useMemo(() => tripDestinations.map((entry) => {
    const label = Object.keys(candidatesByCity).find((city) => city.toLowerCase() === entry.city.toLowerCase());
    const cityCandidates = label ? candidatesByCity[label] ?? [] : [];
    const ids = new Set(cityCandidates.map((candidate) => candidate.id));
    const leg = statedLegs.find((item) => item.city.toLowerCase() === entry.city.toLowerCase());
    return {
      city: entry.city,
      discovered: cityCandidates.length,
      reviewed: Object.keys(decisions).filter((id) => ids.has(id)).length,
      selected: Object.entries(decisions)
        .filter(([id, decision]) => ids.has(id) && (decision === 'must-do' || decision === 'interested')).length,
      // The dates the traveller booked for this city, when they have said.
      dates: leg ? describeStayDates(leg, profile.startDate) : null,
      days: leg?.days ?? null,
    };
  }), [tripDestinations, candidatesByCity, decisions, statedLegs, profile.startDate]);

  const CitySwitcher = ({ compact = false }: { compact?: boolean }) => {
    if (!isMultiCity) return null;
    return (
      <div
        className={`destination-city-switcher${compact ? ' is-compact' : ''}`}
        role="tablist"
        aria-label="Cities on this trip"
      >
        {cityProgress.map((entry, index) => (
          <button
            key={entry.city}
            type="button"
            role="tab"
            aria-selected={index === activeCityIndex}
            className={index === activeCityIndex ? 'adaptive-tab is-active' : 'adaptive-tab'}
            onClick={() => switchCity(index)}
            disabled={loading}
          >
            <span className="destination-city-switcher-name">{entry.city}</span>
            {/*
              * The dates come first: a traveller reviewing Kyoto places needs
              * to know they have two days there, or they will keep twelve.
              */}
            <span className="destination-city-switcher-meta">
              {entry.dates ? `${entry.dates} · ` : ''}
              {entry.discovered === 0 ? 'not reviewed' : `${entry.selected} kept`}
            </span>
          </button>
        ))}
      </div>
    );
  };

  const renderCloseReview = (variant: 'icon' | 'labeled') => (
    <button
      type="button"
      className={variant === 'icon' ? 'destination-deck-close' : 'pill-btn pill-ghost'}
      aria-label="Close place review"
      onClick={closeReview}
    >
      <X className={variant === 'icon' ? 'w-5 h-5' : 'w-4 h-4'} aria-hidden="true" />
      {variant === 'labeled' ? 'Close' : null}
    </button>
  );

  const updateDecision = (candidateId: string, decision: CandidateDecision, options?: { name?: string; silent?: boolean }) => {
    const card = reviewRanked.find((item) => item.candidate.id === candidateId)?.candidate
      ?? { id: candidateId };
    const previous = resolvedCardDecision(decisionsRef.current, card);
    const writes = cardDecisionWrites(card, decision);
    const previousByKey = Object.fromEntries(
      Object.keys(writes).map((key) => [key, decisionsRef.current[key]]),
    ) as Record<string, CandidateDecision | undefined>;
    const next = { ...decisionsRef.current, ...writes };
    decisionsRef.current = next;
    setDecisions(next);
    persistDecisions(next);
    // A fresh decision always releases the deck back to ranked order.
    setFocusedCandidateId(null);
    if (options?.silent) return;
    if (decision === 'must-do') hapticSuccess();
    else hapticMedium();
    const name = options?.name || reviewRanked.find((item) => item.candidate.id === candidateId)?.candidate.name || 'Place';
    const entry: UndoState = { candidateId, name, previous, next: decision, previousByKey };
    setDecisionHistory((history) => [...history.filter((item) => item.candidateId !== candidateId), entry]);
    setUndoState(entry);
    if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current);
    undoTimerRef.current = window.setTimeout(() => setUndoState(null), 4200);
  };

  /** Revert one decision and put that place back in front of the traveller. */
  const revert = (entry: UndoState) => {
    const next = { ...decisionsRef.current };
    for (const [key, previous] of Object.entries(entry.previousByKey)) {
      if (previous) next[key] = previous;
      else delete next[key];
    }
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
    // Sized to this trip: the days it has, and the stops a day of the chosen
    // pace can hold. A relaxed mood therefore shortlists fewer places.
    const next = defaultDiscoveryDecisions(ranked, {
      dayCount: tripDayCount,
      behaviour: tripBehaviour,
    });
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
      const selected = rankedAll
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
    // Every city the traveller reviewed, so a Kyoto day can hold Kyoto places.
    const result = buildDestinationItinerary(itinerary, profile, rankedAll, decisions, {
      queueEvidence,
      routeResolver,
      weatherRiskDays: nextWeatherRiskDays,
      /**
       * Flight times come from the traveller and are optional; the time-zone
       * shift is derived, and is worth having on its own because it is what
       * decides whether the first days of a long-haul trip are eased off.
       */
      tripEdges: {
        arrivalTime: profile.arrivalTime,
        departureTime: profile.departureTime,
        timezoneShiftHours: timezoneShiftHours(
          destination?.timezone,
          profile.startDate ? new Date(`${profile.startDate}T12:00:00Z`) : undefined,
        ),
      },
      currentEventNotes,
      currentEvents,
    });
    if (routeWarning) result.warnings = [...result.warnings, routeWarning];
    if (weatherWarning) result.warnings = [...result.warnings, weatherWarning];
    if (eventsWarning) result.warnings = [...result.warnings, eventsWarning];
    if (nextWeatherRiskDays.length > 0) result.warnings = [...result.warnings, `Rain-sensitive days use an indoor-first order: ${nextWeatherRiskDays.join(', ')}.`];
    /**
     * Developer-only. Records what this build actually rejected, so
     * `SHORTLIST_HEADROOM` can eventually be set from real trips instead of
     * intuition. Reads the finished result and changes nothing about it.
     */
    recordShortlistDiagnostic(result, { city: cityLabel, days: tripDayCount });
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
      /**
       * Cities in the order the trip now visits them, followed by any the
       * traveller chose that this plan gave no days to. A city with nothing
       * shortlisted in it is still a city they said they were going to, and
       * dropping it here would quietly edit their trip.
       */
      cities: Array.from(new Set([
        ...buildResult.days.map((day) => day.city).filter(Boolean),
        ...tripDestinations.map((entry) => entry.city).filter(Boolean),
      ])),
      revision: (itinerary.revision || 0) + 1,
      discoveryState: {
        city: cityLabel,
        mode: usingFixture ? 'fixture' : 'live',
        // Every city reviewed this session, so a reload can tell which of the
        // restored decisions still belong to places the trip has seen.
        candidateIds: [...allCandidates.map((candidate) => candidate.id), ...candidates.map((candidate) => candidate.id)]
          .filter((id, index, all) => all.indexOf(id) === index),
        decisions,
        discoveredAt: itinerary.discoveryState?.discoveredAt || timestamp,
        updatedAt: timestamp,
        stage: 'itinerary-built',
        scheduledCandidateIds: buildResult.scheduledCandidates.map((candidate) => candidate.id),
        unscheduledCandidates: buildResult.unscheduledReasons.map(({ candidate, reason, detail }) => ({
          candidateId: candidate.id,
          reason,
          detail,
        })),
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
          <h3>{isMultiCity ? `Build your ${tripDestinations.map((entry) => entry.city).join(' · ')} itinerary` : `Build a ${cityLabel} itinerary`}</h3>
          <p>
            {!isMultiCity
              ? 'Verified places, one at a time.'
              : hasStayPlan
                // Their plan, read back. They already know where they are
                // sleeping; what they need here is which deck matches which days.
                ? `Choose a city, then press Start. Verified places, one city at a time — ${describeCityLegs(statedLegs)}.`
                // Said plainly, because a traveller reviewing Osaka would
                // otherwise assume the other three cities were forgotten.
                : `Choose a city, then press Start. Verified places, one city at a time. Set how long you are staying in each city in Settings, or the days will be divided from what you shortlist.`}
          </p>
          <CitySwitcher compact />
        </div>
        <div className="destination-intro-actions">
          {canResumeReview && candidates.length > 0 && (
            <button type="button" className="pill-btn pill-primary" onClick={() => { hapticTap(); setPhase('review'); }}>
              Continue reviewing
            </button>
          )}
          <button type="button" className={`pill-btn ${canResumeReview && candidates.length > 0 ? 'pill-ghost' : 'pill-primary'}`} onClick={() => void beginDiscovery()} disabled={loading}>
            <Sparkles className="w-4 h-4" /> {loading ? 'Loading places…' : 'Start'}
          </button>
        </div>
        {error && <p className="destination-discovery-error" role="alert">{error} Try again; your itinerary has not changed.</p>}
      </section>
    );
  }

  if (isMobileReview && desktopMode === 'deck') {
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
            {renderCloseReview('icon')}
          </div>
          <h3>Choose places for {cityLabel}</h3>
          <CitySwitcher compact />
          <div className="destination-review-progress" aria-label={`${reviewedCount} of ${ranked.length} places reviewed in ${cityLabel}`}>
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
          <div className="destination-deck-mobile-actions">
            <button
              type="button"
              className="pill-btn pill-ghost"
              onClick={() => { hapticTap(); setDesktopMode('list'); }}
            >
              <LayoutGrid className="w-4 h-4" aria-hidden="true" /> Browse all
            </button>
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
            <strong>{isMultiCity ? `${cityLabel} reviewed` : 'Shortlist ready'}</strong>
            <p>
              {isMultiCity
                ? `${selectedCount} kept in ${cityLabel}, ${tripSelectedCount} across the trip. Review another city, or build now.`
                : `${selectedCount} places selected. Build your itinerary, or keep adjusting with recommended picks.`}
            </p>
            <CitySwitcher compact />
            <div className="destination-deck-complete-actions">
              <button type="button" className="pill-btn pill-primary" onClick={() => void previewPlan()} disabled={buildableCount < 2 || routeLoading}>
                {routeLoading ? 'Checking routes…' : 'Build itinerary'}
              </button>
              {decisionHistory.length > 0 && (
                <button type="button" className="pill-btn pill-ghost" onClick={stepBack}>
                  <ArrowLeft className="w-4 h-4" /> Reconsider {decisionHistory[decisionHistory.length - 1].name}
                </button>
              )}
              <button type="button" className="pill-btn pill-ghost" onClick={selectRecommended}>
                Use recommended shortlist ({shortlistSize.shortlist})
              </button>
              {/*
                * The number is explained rather than just shown: it comes from
                * this trip's length and pace, so a traveller who wanted more
                * knows the lever is the pace, not this button.
                */}
              <p className="text-xs w-full" style={{ color: 'var(--ink-muted)' }}>
                {shortlistSize.capped && shortlistSize.shortlist < shortlistSize.capacity
                  // Only a trip long enough to out-run the ceiling loses places.
                  ? `About ${shortlistSize.shortlist} places — as many as is practical to review at once. ${tripDayCount} days at this pace could hold around ${shortlistSize.capacity}, so add more once you have worked through these.`
                  : isMultiCity
                    ? hasStayPlan
                      // A number from their own plan, not an inference. The
                      // lever is the stay plan, and it is named.
                      ? `About ${shortlistSize.shortlist} places for your ${cityDayCount} ${cityDayCount === 1 ? 'day' : 'days'} in ${cityLabel}, at a ${tripBehaviour.pace.replace('-', ' ')} pace. Change the days in Settings if this city deserves more of the trip.`
                      : `About ${shortlistSize.shortlist} places for ${cityLabel} — its likely share of ${tripDayCount} days at a ${tripBehaviour.pace.replace('-', ' ')} pace. Set how long you are staying in each city to make this exact.`
                    : `About ${shortlistSize.shortlist} places for ${tripDayCount} ${tripDayCount === 1 ? 'day' : 'days'} — roughly what a ${tripBehaviour.pace.replace('-', ' ')} pace fits, with room for the ones that will not slot in.`}
              </p>
              {renderCloseReview('labeled')}
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

        {currentDeckCard && buildableCount >= 2 && (
          <div className="destination-review-footer destination-deck-footer">
            <div className="destination-review-footer-copy">
              <strong>{selectedCount} selected</strong>
              <span>You can build anytime</span>
            </div>
            <div className="destination-review-footer-actions">
              <button type="button" className="pill-btn pill-primary" onClick={() => void previewPlan()} disabled={routeLoading}>
                {routeLoading ? 'Checking routes…' : 'Build'}
              </button>
            </div>
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
          <h3>Choose what belongs in your {cityLabel} {isMultiCity ? 'days' : 'trip'}</h3>
          <CitySwitcher />
          <div className="destination-review-progress" aria-label={`${reviewedCount} of ${ranked.length} places reviewed in ${cityLabel}`}>
            <div className="destination-review-progress-track">
              <div
                className="destination-review-progress-fill"
                style={{ width: ranked.length ? `${Math.min(100, (reviewedCount / ranked.length) * 100)}%` : '0%' }}
              />
            </div>
            <span>{reviewedCount} of {ranked.length} reviewed · {selectedCount} selected</span>
          </div>
          {decisionNotice && (
            <p className="text-xs" role="status" style={{ color: 'var(--accent)' }}>{decisionNotice}</p>
          )}
        </div>
        <div className="destination-review-summary">
          <div className="destination-review-summary-toolbar">
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
            {renderCloseReview('labeled')}
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
                      decision={resolvedCardDecision(decisions, item.candidate)}
                      context={{
                        ...sharedContext,
                        evidence: evidenceSummaries[item.candidate.id],
                        queueMinutes: queueEvidence[item.candidate.id],
                        position: rankPositions.get(item.candidate.id),
                        intelligenceView: intelligenceViewFor(item.candidate.id),
                      }}
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
        <div className="destination-review-footer-copy">
          <strong>{selectedCount} selected</strong>
          <span>{reviewedCount} reviewed · skip and visited stay out of the plan</span>
        </div>
        <div className="destination-review-footer-actions">
          {renderCloseReview('labeled')}
          <button type="button" className="pill-btn pill-primary" onClick={() => void previewPlan()} disabled={buildableCount < 2 || routeLoading}>
            {routeLoading ? 'Checking routes…' : 'Build itinerary'}
          </button>
        </div>
      </div>
    </section>
  );
}
