/**
 * Travel evidence model.
 *
 * Everything the app learns from outside itself — an official opening-hours
 * page, a Google review, a YouTube video, a RedNote post the traveller pasted
 * in — is normalised into one shape: {@link SourceEvidence} attached to a
 * {@link CanonicalPlace}, carrying {@link TravelClaim}s that can be traced back
 * to the exact URL they came from.
 *
 * The rule this file exists to enforce: **an AI model may interpret evidence,
 * but may never invent it.** Any operational fact shown to a traveller — hours,
 * price, closure, queue length, route — has to point at a source record.
 */

export type EvidenceSource =
  | 'official-website'
  | 'official-tourism'
  | 'google-places'
  | 'tripadvisor'
  | 'reddit'
  | 'youtube'
  | 'tiktok'
  | 'douyin'
  | 'rednote'
  | 'blog'
  | 'user-shared';

/** Who produced the evidence. Changes how much weight a claim deserves. */
export type EvidenceAuthorType =
  | 'official'
  | 'local-creator'
  | 'traveller'
  | 'business'
  | 'unknown';

/**
 * Whether the content looks commercially motivated. Deliberately hedged: the
 * app describes what it observed, it does not accuse a creator or business of
 * dishonesty.
 */
export type EvidenceDisclosure =
  | 'organic'
  | 'sponsored'
  | 'possible-promotion'
  | 'unknown';

export type TravelClaimType =
  | 'worth-visiting'
  | 'overrated'
  | 'local-favourite'
  | 'tourist-trap'
  | 'queue-time'
  | 'visit-duration'
  | 'best-time'
  | 'crowded'
  | 'closed'
  | 'renovation'
  | 'reservation-needed'
  | 'price'
  | 'food-quality'
  | 'photo-spot'
  | 'accessibility'
  | 'transport-tip';

/**
 * One assertion extracted from one piece of evidence.
 *
 * `value` is the machine-usable form when a claim is quantitative (a queue of
 * 40 minutes, a visit of 90 minutes); `summary` is the human sentence. Claims
 * without a numeric reading still schedule correctly — they just inform ranking
 * rather than timing.
 */
export interface TravelClaim {
  type: TravelClaimType;
  summary: string;
  /** Quantitative reading where the claim has one (minutes, price level…). */
  value?: number;
  unit?: 'minutes' | 'hours' | 'price-level' | 'people';
  /** Time window the claim applies to, e.g. queues only in the evening. */
  appliesTo?: { start?: string; end?: string; daysOfWeek?: number[] };
  /** 0–1. How strongly the source states this, not how much we believe it. */
  strength: number;
  /** Verbatim fragment the claim was read from, for the evidence drawer. */
  excerpt?: string;
}

export interface CanonicalPlace {
  id: string;
  primaryName: string;
  localName?: string;
  aliases: string[];
  city: string;
  region?: string;
  countryCode: string;
  neighbourhood?: string;
  coordinates: [number, number];
  address?: string;
  website?: string;
  phone?: string;
  providerIds: Partial<Record<'google' | 'amap' | 'baidu' | 'tripadvisor', string>>;
}

export interface EvidenceEngagement {
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
}

export interface SourceEvidence {
  id: string;
  canonicalPlaceId: string;
  source: EvidenceSource;
  sourceUrl: string;
  sourceItemId?: string;
  /** When the author published it. Absent for undated pages. */
  publishedAt?: string;
  retrievedAt: string;
  language?: string;
  authorType: EvidenceAuthorType;
  disclosure: EvidenceDisclosure;
  engagement?: EvidenceEngagement;
  claims: TravelClaim[];
  /** 0–1 confidence that this record is accurate and correctly matched. */
  confidence: number;
  /** After this instant the record is stale and must be relabelled or refreshed. */
  expiresAt?: string;
}

/**
 * Trust ceiling per source type. An official page can establish that a venue
 * shut down; a single traveller video cannot. Used to cap how far one piece of
 * evidence can move an operational fact.
 */
const SOURCE_AUTHORITY: Record<EvidenceSource, number> = {
  'official-website': 1,
  'official-tourism': 0.95,
  'google-places': 0.85,
  tripadvisor: 0.75,
  /**
   * Ranked above video platforms and below map providers.
   *
   * Reddit is a discussion forum, so it is weak evidence for an operational
   * fact — it can never establish that a venue has closed, and
   * `OPERATIONAL_CLAIMS` keeps it from trying. But for the judgement a
   * traveller actually wants ("is this worth it, how long was the queue, when
   * should I go") it is unusually good: threads are written after the visit,
   * carry no sponsorship incentive, and disagree with each other in public.
   */
  reddit: 0.65,
  youtube: 0.6,
  tiktok: 0.5,
  douyin: 0.5,
  rednote: 0.5,
  blog: 0.5,
  'user-shared': 0.55,
};

/** Claims that state operational truth, and so require an authoritative source. */
const OPERATIONAL_CLAIMS = new Set<TravelClaimType>([
  'closed',
  'renovation',
  'reservation-needed',
  'price',
]);

export const sourceAuthority = (source: EvidenceSource): number => SOURCE_AUTHORITY[source] ?? 0.4;

/**
 * Whether a claim may be presented as fact rather than as traveller opinion.
 * "This venue is closed" needs an official or map-provider source; "the queue
 * was long" is reportable from anyone, phrased as a report.
 */
export function claimIsPresentableAsFact(evidence: SourceEvidence, claim: TravelClaim): boolean {
  if (!OPERATIONAL_CLAIMS.has(claim.type)) return true;
  return sourceAuthority(evidence.source) >= 0.85;
}

const DAY_MS = 86_400_000;

/**
 * Age decay. Travel evidence rots fast: a two-year-old video is a weak signal
 * about today's queue. Undated evidence is treated as ~180 days old rather than
 * as fresh, so a page with no timestamp can never outrank a dated recent one.
 */
export function freshnessWeight(evidence: SourceEvidence, now = new Date()): number {
  const stamp = evidence.publishedAt || evidence.retrievedAt;
  const published = stamp ? new Date(stamp) : null;
  if (!published || Number.isNaN(published.getTime())) return 0.35;
  const ageDays = Math.max(0, (now.getTime() - published.getTime()) / DAY_MS);
  if (!evidence.publishedAt) return 0.35;
  // Half-life of roughly 8 months, floored so old evidence still counts a little.
  return Math.max(0.15, Math.min(1, Math.exp(-ageDays / 240)));
}

/** True once the record has passed its own expiry and must be relabelled stale. */
export function isStale(evidence: SourceEvidence, now = new Date()): boolean {
  if (!evidence.expiresAt) return false;
  const expiry = new Date(evidence.expiresAt);
  return !Number.isNaN(expiry.getTime()) && expiry.getTime() <= now.getTime();
}

/**
 * How much this record should count, combining source authority, its own
 * confidence and how recent it is. Stale records are heavily discounted rather
 * than dropped, so the UI can still show them labelled "may be out of date".
 */
export function evidenceWeight(evidence: SourceEvidence, now = new Date()): number {
  const base = sourceAuthority(evidence.source) * evidence.confidence * freshnessWeight(evidence, now);
  return isStale(evidence, now) ? base * 0.4 : base;
}

/**
 * Promotion risk, 0–1. Built from disclosure plus soft signals: a business
 * account, engagement far out of line with the rest of the evidence, or a
 * platform where undisclosed promotion is common.
 *
 * This deliberately produces a *risk*, never a verdict.
 */
export function promotionRisk(evidence: SourceEvidence): number {
  if (evidence.disclosure === 'sponsored') return 1;
  let risk = evidence.disclosure === 'possible-promotion' ? 0.6 : 0.1;
  if (evidence.authorType === 'business') risk += 0.25;
  if (evidence.authorType === 'official') risk += 0.1;
  // Platforms where marketing content is heavily represented.
  if (evidence.source === 'rednote' || evidence.source === 'douyin' || evidence.source === 'tiktok') {
    risk += 0.1;
  }
  return Math.max(0, Math.min(1, risk));
}

export const PROMOTION_LABELS: Record<EvidenceDisclosure, string> = {
  organic: 'Organic-looking',
  sponsored: 'Sponsored',
  'possible-promotion': 'Possible promotion',
  unknown: 'Unknown',
};

export interface PlaceEvidenceSummary {
  canonicalPlaceId: string;
  /** Independent sources backing this place, after de-duplication. */
  sourceCount: number;
  distinctSources: EvidenceSource[];
  /** Most recent publication across all evidence. */
  latestPublishedAt?: string;
  positiveThemes: string[];
  negativeThemes: string[];
  /** Median reported queue in minutes, when travellers reported one. */
  typicalQueueMinutes?: number;
  /** Median reported visit length in minutes. */
  typicalVisitMinutes?: number;
  /** 0–1, weighted by authority, confidence and freshness. */
  evidenceConfidence: number;
  /** 0-1 visitor crowding signal, separate from general quality. */
  crowdRisk?: number;
  /** 0–1. High means the shortlist should treat the praise cautiously. */
  promotionRisk: number;
  warnings: string[];
}

const median = (values: number[]): number | undefined => {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
};

const POSITIVE_CLAIMS = new Set<TravelClaimType>(['worth-visiting', 'local-favourite', 'photo-spot', 'food-quality']);
const NEGATIVE_CLAIMS = new Set<TravelClaimType>(['overrated', 'tourist-trap', 'crowded', 'closed', 'renovation']);

/**
 * Fold every record about one place into a single summary the UI can show and
 * the ranker can consume. Weighted by {@link evidenceWeight}, so ten reposts of
 * one sponsored clip cannot outweigh an official page.
 */
export function summarisePlaceEvidence(
  canonicalPlaceId: string,
  evidence: SourceEvidence[],
  now = new Date(),
): PlaceEvidenceSummary {
  const relevant = evidence.filter((item) => item.canonicalPlaceId === canonicalPlaceId);
  const distinctSources = Array.from(new Set(relevant.map((item) => item.source)));
  const warnings: string[] = [];

  const queueValues: number[] = [];
  const visitValues: number[] = [];
  const positive = new Map<string, number>();
  const negative = new Map<string, number>();

  let weightTotal = 0;
  let riskTotal = 0;

  for (const item of relevant) {
    const weight = evidenceWeight(item, now);
    weightTotal += weight;
    riskTotal += promotionRisk(item) * weight;

    if (isStale(item, now)) warnings.push(`${item.source} evidence is past its refresh window.`);

    for (const claim of item.claims) {
      if (claim.type === 'queue-time' && typeof claim.value === 'number') queueValues.push(claim.value);
      if (claim.type === 'visit-duration' && typeof claim.value === 'number') visitValues.push(claim.value);

      const bucket = POSITIVE_CLAIMS.has(claim.type) ? positive : NEGATIVE_CLAIMS.has(claim.type) ? negative : null;
      if (bucket) bucket.set(claim.summary, (bucket.get(claim.summary) || 0) + weight * claim.strength);

      if (claim.type === 'closed' && claimIsPresentableAsFact(item, claim)) {
        warnings.push('An authoritative source reports this place as closed.');
      }
    }
  }

  const rank = (entries: Map<string, number>) => [...entries.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([summary]) => summary);

  const latest = relevant
    .map((item) => item.publishedAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .pop();

  // Confidence rises with corroboration: independent sources agreeing matters
  // more than one source repeating itself.
  const averageWeight = relevant.length > 0 ? weightTotal / relevant.length : 0;
  const corroboration = Math.min(1, distinctSources.length / 3);
  const evidenceConfidence = Math.max(0, Math.min(1, averageWeight * (0.6 + 0.4 * corroboration)));
  const crowdedClaims = [...negative.keys()].filter((summary) => /crowd|packed|busy|queue|wait/i.test(summary)).length;
  const queueRisk = queueValues.length > 0 ? Math.min(1, (median(queueValues) || 0) / 90) : 0;
  const crowdRisk = Math.max(0, Math.min(1, crowdedClaims > 0 ? Math.max(0.55, queueRisk) : queueRisk));

  return {
    canonicalPlaceId,
    sourceCount: relevant.length,
    distinctSources,
    latestPublishedAt: latest,
    positiveThemes: rank(positive),
    negativeThemes: rank(negative),
    typicalQueueMinutes: median(queueValues),
    typicalVisitMinutes: median(visitValues),
    evidenceConfidence,
    crowdRisk,
    promotionRisk: weightTotal > 0 ? riskTotal / weightTotal : 0.5,
    warnings: Array.from(new Set(warnings)),
  };
}

/**
 * Trend strength, 0–1: is this place *currently* interesting, as opposed to
 * historically famous? Reads recency and cross-platform agreement, never
 * lifetime like counts — a decade-old viral video is not a trend.
 */
export function trendStrength(evidence: SourceEvidence[], now = new Date()): number {
  const dated = evidence.filter((item) => item.publishedAt);
  if (dated.length === 0) return 0;

  const recent = dated.filter((item) => {
    const age = (now.getTime() - new Date(item.publishedAt!).getTime()) / DAY_MS;
    return age >= 0 && age <= 120;
  });
  if (recent.length === 0) return 0;

  const recencyShare = recent.length / dated.length;
  const platformSpread = Math.min(1, new Set(recent.map((item) => item.source)).size / 3);
  const volume = Math.min(1, recent.length / 6);
  // Discount promoted content so a coordinated push cannot manufacture a trend.
  const organicShare = recent.filter((item) => promotionRisk(item) < 0.5).length / recent.length;

  return Math.max(0, Math.min(1, (recencyShare * 0.3 + platformSpread * 0.3 + volume * 0.2 + organicShare * 0.2)));
}
