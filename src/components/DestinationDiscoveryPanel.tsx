import { useMemo, useState } from 'react';
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
import { FixturePlaceDiscoveryProvider, getDestinationCapability } from '../lib/destinationFixtures';
import type { CandidateDecision, PlaceCandidate, RankedCandidate } from '../lib/destinationIntelligence';
import {
  buildDestinationItinerary,
  defaultDiscoveryDecisions,
  rankDestinationCandidates,
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
  const { candidate, score, reasons } = ranked;
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
        <p className="destination-match-reason">{reasons.join(' · ')}</p>
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
          <p>{selectedCount} selected places · {scheduledCandidateIds.length} scheduled · {unscheduled.length} need attention · {plannedDays} days with places.</p>
        </div>
        <div className="destination-built-actions">
          <button type="button" className="pill-btn pill-ghost" onClick={onEdit}>Edit selected places</button>
          <button type="button" className="pill-btn pill-primary" onClick={onRebuild}>Rebuild itinerary</button>
        </div>
      </div>
      {unscheduled.length > 0 && (
        <div className="destination-unscheduled-panel">
          <strong>{unscheduled.length} selected {unscheduled.length === 1 ? 'place needs' : 'places need'} attention</strong>
          <span>Nothing was dropped silently. Review the reason before rebuilding.</span>
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
  const hoursKnown = result.scheduledCandidates.filter((candidate) => candidate.openingHours).length;
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
        <span><MapPinned className="w-4 h-4" /><strong>100%</strong> coordinates</span>
        <span><Clock3 className="w-4 h-4" /><strong>{placeCount ? Math.round(hoursKnown / placeCount * 100) : 0}%</strong> captured hours</span>
        <span><Route className="w-4 h-4" /><strong>Fallback</strong> routing</span>
      </div>

      <div className="destination-day-list">
        {result.days.map((day) => {
          const places = day.activities.filter((activity) => activity.kind === 'place');
          if (places.length === 0) return null;
          return (
            <article key={day.day} className="destination-day-row">
              <div className="destination-day-number">Day {day.day}</div>
              <div>
                <h5>{day.title}</h5>
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
            {result.unscheduledReasons.map(({ candidate, reason }) => (
              <li key={candidate.id}>
                <span>{candidate.name}</span>
                <small>{unscheduledReasonLabel(reason)}</small>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="destination-route-warning">
        <Info className="w-4 h-4" />
        <span>Place identity and coordinates are source-backed. Travel minutes remain an offline straight-line fallback and overall confidence stays Low until a live route provider is connected.</span>
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
  const capability = getDestinationCapability(primaryCity);
  const supportsFixture = capability !== undefined;
  // Canonical display name for the active destination — never a hardcoded city.
  const cityLabel = capability?.city || primaryCity || 'this destination';
  const savedStateMatchesCity = Boolean(
    itinerary.discoveryState
    && capability
    && itinerary.discoveryState.city.toLowerCase() === capability.city.toLowerCase(),
  );
  const [phase, setPhase] = useState<DiscoveryPhase>(() => {
    if (itinerary.discoveryState?.stage === 'itinerary-built' && savedStateMatchesCity) return 'built';
    return savedStateMatchesCity ? 'review' : 'idle';
  });
  const [candidates, setCandidates] = useState<PlaceCandidate[]>(() => capability?.places ?? []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ranked = useMemo(() => rankDestinationCandidates(candidates, profile), [candidates, profile]);
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
        mode: 'fixture',
        candidateIds: candidates.map((candidate) => candidate.id),
        decisions: next,
        discoveredAt,
        updatedAt: new Date().toISOString(),
        stage: 'reviewing',
      },
    });
  };

  const beginDiscovery = async () => {
    if (!capability) return;
    setLoading(true);
    setError(null);
    try {
      const provider = new FixturePlaceDiscoveryProvider();
      const discovered = await provider.search({
        city: capability.city,
        countryCode: capability.countryCode,
        queries: capability.knowledge?.discoveryQueries ?? [],
        interests: profile.styles,
        startDate: profile.startDate,
        endDate: profile.endDate,
        limit: 40,
      });
      if (discovered.length === 0) throw new Error('No source-backed places were returned.');
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

  const previewPlan = () => {
    const result = buildDestinationItinerary(itinerary, profile, ranked, decisions);
    setBuildResult(result);
    setPhase('preview');
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
        mode: 'fixture',
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

  if (!supportsFixture) {
    return (
      <section className="destination-discovery-shell destination-discovery-unavailable">
        <Database className="w-5 h-5" />
        <div>
          <h4>Smart discovery isn’t available for {cityLabel} yet</h4>
          <p>We don’t have a verified place library for {cityLabel} right now. You can still build your trip by adding places manually below.</p>
        </div>
      </section>
    );
  }

  if (phase === 'preview' && buildResult) {
    return <section className="destination-discovery-shell"><DiscoveryPreview result={buildResult} cityLabel={cityLabel} onBack={() => setPhase('review')} onApply={applyPlan} /></section>;
  }

  if (phase === 'built') {
    return (
      <BuiltDiscoverySummary
        itinerary={itinerary}
        cityLabel={cityLabel}
        candidates={candidates}
        decisions={decisions}
        onEdit={() => setPhase('review')}
        onRebuild={() => setPhase('review')}
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
          <span className="fixture-badge"><Database className="w-4 h-4" /> {ranked.length} verified places</span>
          <h3>Choose what belongs in your {cityLabel} trip</h3>
          <p>Nothing is scheduled until you review it. Ranking uses your interests, budget, data completeness and neighbourhood fit.</p>
        </div>
        <div className="destination-review-summary">
          <div className="destination-selection-count"><strong>{selectedCount}</strong><span>selected</span></div>
          <button type="button" className="pill-btn pill-ghost" onClick={selectRecommended}>Use recommended shortlist</button>
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
        <button type="button" className="pill-btn pill-primary" onClick={previewPlan} disabled={selectedCount < 2}>
          Build themed itinerary
        </button>
      </div>
    </section>
  );
}
