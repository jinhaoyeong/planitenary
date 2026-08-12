/**
 * Browser-acceptance-only intelligence.
 *
 * This module is reached only when the Vite dev build explicitly enables the
 * acceptance fixture flag. It deliberately speaks the same response shape as
 * the transport so the card, not a special renderer, remains under review.
 */

import type { ValidatedIntelligence } from '../../supabase/functions/_shared/candidateIntelligence';
import type {
  IntelligenceRequestCandidate,
  IntelligenceRequestTrip,
  IntelligenceResponseRow,
} from './candidateIntelligenceTransport';

type Reason = ValidatedIntelligence['reasons'][number];
type Caution = ValidatedIntelligence['cautions'][number];

const reason = (type: Reason['type'], references: string[] = []): Reason => ({ type, references });
const caution = (type: Caution['type'], references: string[] = []): Caution => ({ type, references });

function take(
  candidates: IntelligenceRequestCandidate[],
  used: Set<string>,
  predicate: (candidate: IntelligenceRequestCandidate) => boolean,
): IntelligenceRequestCandidate | undefined {
  const candidate = candidates.find((entry) => !used.has(entry.candidateId) && predicate(entry));
  if (candidate) used.add(candidate.candidateId);
  return candidate;
}

const selectedStyleFor = (candidate: IntelligenceRequestCandidate, trip: IntelligenceRequestTrip) =>
  trip.styles.find((style) => candidate.matchedStyleTags.includes(style));

const indoorFor = (candidate: IntelligenceRequestCandidate) =>
  candidate.indoorOutdoor === 'indoor' || candidate.indoorOutdoor === 'both';

export function createDevCandidateIntelligenceFixture(
  trip: IntelligenceRequestTrip,
  candidates: IntelligenceRequestCandidate[],
): IntelligenceResponseRow[] {
  if (candidates.length === 0) return [];

  const used = new Set<string>();
  const modes = new Map<string, 'strong' | 'multi' | 'weak' | 'pairing' | 'caution' | 'indoor'>();

  const strong = take(candidates, used, (candidate) => Boolean(selectedStyleFor(candidate, trip)))
    ?? take(candidates, used, () => true);
  const multi = take(candidates, used, (candidate) => Boolean(selectedStyleFor(candidate, trip)) && indoorFor(candidate))
    ?? take(candidates, used, indoorFor);
  const weak = take(candidates, used, (candidate) => candidate.matchedStyleTags.length === 0);
  const cautionCandidate = take(candidates, used, (candidate) => candidate.matchedStyleTags.length === 0);
  // Eagles is a visible canonical card in the acceptance fixture. Prefer it
  // so the pairing state can be reviewed without making production request
  // material or card rendering scenario-aware.
  const pairing = take(candidates, used, (candidate) => candidate.name === 'Eagles')
    ?? take(candidates, used, (candidate) => candidate.pairableCandidateIds.length > 0)
    ?? take(candidates, used, () => true);
  const indoor = take(candidates, used, indoorFor);

  if (strong) modes.set(strong.candidateId, 'strong');
  if (multi) modes.set(multi.candidateId, 'multi');
  if (weak) modes.set(weak.candidateId, 'weak');
  if (pairing) modes.set(pairing.candidateId, 'pairing');
  if (cautionCandidate) modes.set(cautionCandidate.candidateId, 'caution');
  if (indoor) modes.set(indoor.candidateId, 'indoor');

  const pairingTarget = pairing
    ? candidates.find((candidate) => candidate.candidateId !== pairing.candidateId
      && pairing.pairableCandidateIds.includes(candidate.candidateId))
      ?? candidates.find((candidate) => candidate.candidateId !== pairing.candidateId)
    : undefined;
  const clusterReference = (candidate: IntelligenceRequestCandidate) =>
    candidates.find((other) => other.candidateId !== candidate.candidateId)?.candidateId;

  return candidates.map((candidate, index) => {
    const mode = modes.get(candidate.candidateId);
    if (!mode) {
      // Keep the tail of the deck visibly useful without pretending every
      // place received a model answer. The final row is the unavailable path;
      // the preceding rows cover settled-empty and fully-rejected outcomes.
      return {
        candidateId: candidate.candidateId,
        intelligence: null,
        status: index === candidates.length - 1 ? 'unavailable' : 'deterministic-only',
      };
    }

    const style = selectedStyleFor(candidate, trip);
    const sharedFit = style ? [reason('style-match', [style])] : [];
    const reference = clusterReference(candidate);
    const base: ValidatedIntelligence = {
      candidateId: candidate.candidateId,
      personalFitScore: mode === 'weak' || mode === 'caution' ? 38 : 88,
      recommendation: mode === 'strong' ? 'must-do'
        : mode === 'weak' ? 'weak-fit'
          : mode === 'caution' ? 'optional' : 'interested',
      reasons: [],
      cautions: [],
      pairWithCandidateIds: [],
      suggestedDurationMinutes: candidate.durationRangeMinutes?.[0] ?? null,
    };

    if (mode === 'strong') {
      base.reasons = [...sharedFit, ...(reference ? [reason('cluster-fit', [reference])] : [])];
    } else if (mode === 'multi') {
      base.reasons = [
        ...sharedFit,
        reason('pace-fit', [trip.pace]),
        ...(indoorFor(candidate) ? [reason('indoor-option')] : []),
        ...(reference ? [reason('cluster-fit', [reference])] : []),
      ];
    } else if (mode === 'weak') {
      base.reasons = [reason('weak-style-match')];
    } else if (mode === 'pairing') {
      base.reasons = [...sharedFit, ...(reference ? [reason('cluster-fit', [reference])] : [])];
      if (pairingTarget) base.pairWithCandidateIds = [pairingTarget.candidateId];
    } else if (mode === 'caution') {
      base.cautions = [caution('weak-style-match')];
    } else if (mode === 'indoor') {
      base.reasons = [reason('indoor-option')];
    }

    return { candidateId: candidate.candidateId, intelligence: base, status: 'ready' };
  });
}
