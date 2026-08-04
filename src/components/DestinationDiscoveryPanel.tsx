import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Clock3,
  Database,
  ExternalLink,
  Info,
  MapPinned,
  Route,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import type { DiscoveryCandidateDecision, Itinerary } from '../data';
import { FixturePlaceDiscoveryProvider } from '../lib/destinationFixtures';
import { EMPTY_PROVIDER_RUNTIME, canDiscover, describeCapability, type ProviderRuntime } from '../lib/destinationCapability';
import { capabilityFor, discoverPlaces, loadProviderRuntime, parseCurrentEvents, parseWeatherRisk } from '../lib/discoveryRuntime';
import { describePace } from '../lib/travelBehaviour';
import type { PlaceEvidenceSummary } from '../lib/travelEvidence';
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

const formatDuration = (minutes: number) => minutes >= 120 && minutes % 60 === 0
  ? `${minutes / 60} hr`
  : `${minutes} min`;

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

function CandidateCard({
  ranked,
  decision,
  onDecision,
}: {
  ranked: RankedCandidate;
  decision?: DiscoveryCandidateDecision;
  onDecision: (decision: DiscoveryCandidateDecision) => void;
}) {
  const { candidate, score, reasons, cautions = [] } = ranked;
  return (
    <article className="destination-candidate" data-decision={decision || 'undecided'}>
      <div className="destination-candidate-map" aria-hidden="true">
        <MapPinned className="w-5 h-5" />
        <span>{candidate.neighbourhood || candidate.city}</span>
        {candidate.coordinates && <small>{candidate.coordinates[0].toFixed(3)}, {candidate.coordinates[1].toFixed(3)}</small>}
      </div>
      <div className="destination-candidate-body">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h5>{candidate.name}</h5>
            <p className="destination-candidate-description">{candidate.description}</p>
          </div>
          <span className="destination-match-score" aria-label={`${score} percent match`}>{score}</span>
        </div>
        <div className="destination-facts" aria-label="Place details">
          <span><Clock3 className="w-3.5 h-3.5" />{formatDuration(candidate.estimatedVisitMinutes)}</span>
          <span>{formatPrice(candidate.priceLevel)}</span>
          <span>{openingSummary(candidate)}</span>
        </div>
        {/* Cautions are shown separately so a card never reads as pure upside
            when the evidence carries a warning. */}
        <p className="destination-match-reason">{reasons.join(' · ')}</p>
        {cautions.length > 0 && (
          <p className="destination-match-caution">{cautions.join(' ')}</p>
        )}
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
          <a href={candidate.sourceReferences[0]?.url} target="_blank" rel="noreferrer" className="destination-source-link">
            Source <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>
    </article>
  );
}

const unscheduledReasonLabel = (reason: string) => {
  if (reason === 'daily-capacity-reached') return 'Daily capacity reached';
  if (reason === 'incompatible-location') return 'No compatible location cluster';
  if (reason === 'insufficient-route-data') return 'Insufficient route data';
  if (reason === 'opening-hours-conflict') return 'Opening-hours conflict';
  if (reason === 'duplicate') return 'Duplicate place';
  // These are the traveller's own comfort limits, phrased so it is clear the
  // limit can be relaxed rather than implying the place is unavailable.
  if (reason === 'walking-limit-exceeded') return 'Beyond your walking limit';
  if (reason === 'return-time-exceeded') return 'Past your return time';
  if (reason === 'queue-exceeds-tolerance') return 'Longer wait than you wanted';
  return 'No viable day found';
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

  return (
    <section className="destination-discovery-shell destination-discovery-built" aria-labelledby="destination-built-title">
      <div className="destination-built-summary">
        <div>
          <span className="fixture-badge"><Check className="w-4 h-4" /> Shortlist complete</span>
          <h3 id="destination-built-title">Your {cityLabel} itinerary is ready</h3>
          <p>
            {selectedCount} selected · {scheduledCandidateIds.length} scheduled
            {unscheduled.length > 0 ? ` · ${unscheduled.length} need attention` : ''}
            {' · '}{plannedDays} {plannedDays === 1 ? 'day' : 'days'}
          </p>
        </div>
        <div className="destination-built-actions">
          <button type="button" className="pill-btn pill-ghost" onClick={onEdit}>Edit selected places</button>
          <button type="button" className="pill-btn pill-primary" onClick={onRebuild}>Rebuild itinerary</button>
        </div>
      </div>
      {unscheduled.length > 0 && (
        <div className="destination-unscheduled-panel">
          <strong>{unscheduled.length} {unscheduled.length === 1 ? 'place needs' : 'places need'} attention</strong>
          <span>Review why before rebuilding.</span>
          <ul>
            {unscheduled.slice(0, 4).map((item) => (
              <li key={item.candidateId}>
                <span>{candidates.find((candidate) => candidate.id === item.candidateId)?.name || item.candidateId}</span>
                <small>{unscheduledReasonLabel(item.reason)}</small>
              </li>
            ))}
          </ul>
          {unscheduled.length > 4 && <small>+ {unscheduled.length - 4} more places need review.</small>}
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
  const placeCount = result.days.reduce((total, day) => total + day.activities.filter((activity) => activity.kind === 'place').length, 0);
  const activeLoads = result.dayLoads.filter((load) => load.mainActivities > 0);
  const totals = {
    walkingKm: activeLoads.length
      ? (activeLoads.reduce((sum, load) => sum + load.walkingDistanceMeters, 0) / activeLoads.length / 1000).toFixed(1)
      : '0.0',
    averageTransport: activeLoads.length
      ? Math.round(activeLoads.reduce((sum, load) => sum + load.transportMinutes, 0) / activeLoads.length)
      : 0,
  };
  return (
    <div className="destination-plan-preview">
      <div className="destination-preview-header">
        <div>
          <button type="button" className="destination-back-link" onClick={onBack}><ArrowLeft className="w-4 h-4" /> Back to shortlist</button>
          <h4>Your {cityLabel} itinerary is ready to review</h4>
          <p>{placeCount} source-backed places across {result.days.filter((day) => day.activities.some((activity) => activity.kind === 'place')).length} themed days.</p>
        </div>
        <span className="fixture-badge"><Database className="w-4 h-4" /> Verified places</span>
      </div>

      <div className="destination-evidence-strip">
        <span><ShieldCheck className="w-4 h-4" /><strong>{placeCount}/{placeCount}</strong> verified places</span>
        <span><MapPinned className="w-4 h-4" /><strong>{totals.walkingKm} km</strong> average walking</span>
        <span><Clock3 className="w-4 h-4" /><strong>{totals.averageTransport} min</strong> average travel</span>
        <span><Route className="w-4 h-4" /><strong>{result.routeMode === 'provider' ? 'Live' : 'Estimated'}</strong> routing</span>
      </div>

      <p className="destination-pace-summary">{describePace(result.behaviour)}</p>

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
                    {load.transportMinutes} min travel · {(load.walkingDistanceMeters / 1000).toFixed(1)} km walking
                    {' · '}back by {load.expectedReturnTime}
                    {load.fatigueScore > 0.8 ? ' · demanding day' : ''}
                  </p>
                )}
                <div className="destination-day-places">
                  {places.map((activity) => (
                    <div key={activity.id}>
                      <strong>{activity.time} · {activity.name}</strong>
                      <span>{activity.generatedMetadata?.reason}</span>
                      {activity.sourceReferences?.[0] && (
                        <a href={activity.sourceReferences[0].url} target="_blank" rel="noreferrer">Source <ExternalLink className="w-3 h-3" /></a>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <span>{places.length} verified {places.length === 1 ? 'place' : 'places'}</span>
            </article>
          );
        })}
      </div>

      {result.unscheduledReasons.length > 0 && (
        <div className="destination-unscheduled-panel">
          <strong>{result.unscheduledReasons.length} selected {result.unscheduledReasons.length === 1 ? 'place was' : 'places were'} not scheduled</strong>
          <span>Each place remains visible with a reason so you can adjust the shortlist and rebuild.</span>
          <ul>
            {result.unscheduledReasons.map(({ candidate, reason, detail }) => (
              <li key={candidate.id}>
                <span>{candidate.name}</span>
                <small title={detail}>{unscheduledReasonLabel(reason)}</small>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="destination-route-warning">
        <Info className="w-4 h-4" />
        <span>{result.routeMode === 'provider'
          ? 'Place identity, coordinates and travel minutes are backed by the connected route provider. Recheck conditions near departure.'
          : 'Place identity and coordinates are source-backed. Travel minutes are an offline straight-line estimate until a live route provider is connected.'}</span>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" className="pill-btn pill-primary" onClick={onApply}><Check className="w-4 h-4" /> Apply this itinerary</button>
        <button type="button" className="pill-btn pill-ghost" onClick={onBack}>Change selections</button>
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
  const [buildResult, setBuildResult] = useState<DestinationBuildResult | null>(null);
  const selectedCount = Object.values(decisions).filter((decision) => decision === 'must-do' || decision === 'interested').length;

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
      setDecisions(nextDecisions);
      setPhase('review');
      persistDecisions(nextDecisions, new Date().toISOString());
    } catch (discoveryError) {
      setError(discoveryError instanceof Error ? discoveryError.message : 'Discovery could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  const updateDecision = (candidateId: string, decision: CandidateDecision) => {
    const next = { ...decisions, [candidateId]: decision };
    setDecisions(next);
    persistDecisions(next);
  };

  const selectRecommended = () => {
    const next = defaultDiscoveryDecisions(ranked);
    setDecisions(next);
    persistDecisions(next);
  };

  const clearAllDecisions = () => {
    const next: Record<string, CandidateDecision> = {};
    setDecisions(next);
    persistDecisions(next);
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
    return (
      <section className="destination-discovery-shell destination-discovery-intro">
        <div>
          <span className="fixture-badge"><Database className="w-4 h-4" /> Official tourism sources</span>
          <h3>Build a {cityLabel} itinerary</h3>
          <p>Review real places from official tourism sources, choose what matters, then shape distinct neighbourhood-led days around your pace and interests.</p>
        </div>
        <button type="button" className="pill-btn pill-primary" onClick={beginDiscovery} disabled={loading}>
          <Sparkles className="w-4 h-4" /> {loading ? 'Loading verified places…' : `Discover ${cityLabel} places`}
        </button>
        {error && <p className="destination-discovery-error" role="alert">{error} Try again; your itinerary has not changed.</p>}
      </section>
    );
  }

  return (
    <section className="destination-discovery-shell">
      <div className="destination-review-header">
        <div>
          <span className="fixture-badge">
            <Database className="w-4 h-4" /> {ranked.length} verified places{usingFixture ? ' · captured, may be out of date' : ''}
          </span>
          <h3>Choose what belongs in your {cityLabel} trip</h3>
          <p>Nothing is scheduled until you review it. Ranking uses your interests, budget, data completeness and neighbourhood fit.</p>
        </div>
        <div className="destination-review-summary">
          <div className="destination-selection-count"><strong>{selectedCount}</strong><span>selected</span></div>
          <button type="button" className="pill-btn pill-ghost" onClick={selectRecommended}>Use recommended shortlist</button>
          <button
            type="button"
            className="pill-btn pill-ghost"
            onClick={clearAllDecisions}
            disabled={selectedCount === 0 && Object.keys(decisions).length === 0}
            aria-label="Clear all place decisions"
          >
            Clear all
          </button>
        </div>
      </div>

      <div className="destination-review-groups">
        {groupedRanked.map((group) => {
          const groupCandidates = group.items;
          if (groupCandidates.length === 0) return null;
          return (
            <section key={group.id} className="destination-review-group">
              <div className="destination-group-heading">
                <h4>{group.label}</h4>
                <span>{groupCandidates.length} places</span>
              </div>
              <div className="destination-candidate-grid">
                {groupCandidates.map((item) => (
                  <CandidateCard
                    key={item.candidate.id}
                    ranked={item}
                    decision={decisions[item.candidate.id]}
                    onDecision={(decision) => updateDecision(item.candidate.id, decision)}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <div className="destination-review-footer">
        <div>
          <strong>{selectedCount} places ready for planning</strong>
          <span>Skipped and visited places stay out of the itinerary.</span>
        </div>
        <button type="button" className="pill-btn pill-primary" onClick={() => void previewPlan()} disabled={selectedCount < 2 || routeLoading}>
          {routeLoading ? 'Checking routesâ€¦' : 'Build themed itinerary'}
        </button>
      </div>
    </section>
  );
}
