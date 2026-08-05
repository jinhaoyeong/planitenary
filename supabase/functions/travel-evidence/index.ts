/**
 * Gathers what people are actually saying about a place, right now.
 *
 * Two streams today:
 *   - Google Places reviews. Capped at five per place and ordered by relevance,
 *     so this is a sample, not a census — it is weighted accordingly.
 *   - YouTube, searched with a recency filter, which is the best openly
 *     available signal for what is currently worth visiting.
 *
 * TikTok, Douyin and RedNote are deliberately absent: none offers public travel
 * search to commercial apps. Those arrive as traveller-pasted links instead.
 *
 * Claim extraction here is keyword-based and conservative. It reports what a
 * source said and links back to it; it never asserts an operational fact that
 * no source stated.
 */
import { expiryFor, fetchJson, json, preflight, secrets } from '../_shared/providers.ts';
import {
  type CachedEvidence,
  readCanonicalPlaceIds,
  readEvidenceCache,
  readEvidenceProbes,
  serviceClient,
  writeEvidenceCache,
  writeEvidenceProbes,
} from '../_shared/cache.ts';
import { evidenceSourceUrl, reviewItemKey, shouldFetchEvidence } from '../_shared/cacheKeys.ts';

interface EvidenceBody {
  city?: string;
  placeIds?: string[];
  placeNames?: string[];
  travelStartsInDays?: number;
  /** Which map provider the ids belong to. Defaults to Google. */
  provider?: string;
}

type ClaimType =
  | 'worth-visiting' | 'overrated' | 'local-favourite' | 'tourist-trap'
  | 'queue-time' | 'crowded' | 'closed' | 'reservation-needed' | 'food-quality';

interface Claim {
  type: ClaimType;
  summary: string;
  value?: number;
  unit?: 'minutes';
  strength: number;
  excerpt?: string;
}

/**
 * Conservative phrase matching. Each rule needs an unambiguous phrase — we
 * would rather miss a claim than invent one.
 */
const CLAIM_RULES: Array<{ type: ClaimType; patterns: RegExp[]; summary: string; strength: number }> = [
  { type: 'overrated', patterns: [/\boverrated\b/i, /\bnot worth (the|it)\b/i, /\bwaste of (time|money)\b/i], summary: 'Described as overrated', strength: 0.8 },
  { type: 'tourist-trap', patterns: [/\btourist trap\b/i, /\btoo touristy\b/i], summary: 'Described as a tourist trap', strength: 0.8 },
  { type: 'local-favourite', patterns: [/\blocals? (love|go|eat|favou?rite)\b/i, /\bhidden gem\b/i], summary: 'Described as a local favourite', strength: 0.7 },
  { type: 'worth-visiting', patterns: [/\bworth (the|a) (visit|trip|queue|wait)\b/i, /\bmust[- ]see\b/i, /\bhighly recommend\b/i], summary: 'Described as worth visiting', strength: 0.7 },
  { type: 'crowded', patterns: [/\b(very |extremely |so )?crowded\b/i, /\bpacked\b/i, /\bshoulder to shoulder\b/i], summary: 'Reported as crowded', strength: 0.6 },
  { type: 'closed', patterns: [/\bpermanently closed\b/i, /\bclosed (down|for good)\b/i], summary: 'Reported as closed', strength: 0.9 },
  { type: 'reservation-needed', patterns: [/\b(book|reserve|reservation)s? (ahead|in advance|required|essential)\b/i], summary: 'Booking ahead is recommended', strength: 0.7 },
  { type: 'food-quality', patterns: [/\b(delicious|amazing food|best (meal|food))\b/i], summary: 'Food is well regarded', strength: 0.6 },
];

/** "waited about 40 minutes", "2 hour queue", "45 min wait". */
const QUEUE_PATTERNS = [
  /(\d{1,3})\s*(?:-|to)?\s*\d{0,3}\s*min(?:ute)?s?\s*(?:queue|wait|line)/i,
  /(?:queue|wait(?:ed)?|line)\s*(?:of|was|for|about)?\s*(?:around\s*)?(\d{1,3})\s*min/i,
  /(\d)\s*hours?\s*(?:queue|wait|line)/i,
];

function extractClaims(text: string): Claim[] {
  if (!text) return [];
  const claims: Claim[] = [];

  for (const rule of CLAIM_RULES) {
    const hit = rule.patterns.find((pattern) => pattern.test(text));
    if (!hit) continue;
    const match = text.match(hit);
    claims.push({
      type: rule.type,
      summary: rule.summary,
      strength: rule.strength,
      excerpt: match ? text.slice(Math.max(0, (match.index ?? 0) - 40), (match.index ?? 0) + 80).trim() : undefined,
    });
  }

  for (const pattern of QUEUE_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;
    const raw = Number.parseInt(match[1], 10);
    if (!Number.isFinite(raw)) continue;
    const minutes = /hour/i.test(match[0]) ? raw * 60 : raw;
    // Anything beyond four hours is far more likely a misparse than a queue.
    if (minutes > 0 && minutes <= 240) {
      claims.push({
        type: 'queue-time',
        summary: `Reported wait of about ${minutes} minutes`,
        value: minutes,
        unit: 'minutes',
        strength: 0.7,
        excerpt: match[0],
      });
    }
    break;
  }

  return claims;
}

/** Undisclosed promotion is common; look for the honest disclosures at least. */
function assessDisclosure(text: string): 'organic' | 'sponsored' | 'possible-promotion' {
  if (/\b(sponsored|paid partnership|#ad\b|gifted|complimentary (meal|stay|visit))/i.test(text)) {
    return 'sponsored';
  }
  if (/\b(discount code|use my code|affiliate|partnership)\b/i.test(text)) return 'possible-promotion';
  return 'organic';
}

interface GoogleReview {
  text?: { text?: string };
  rating?: number;
  publishTime?: string;
  authorAttribution?: { displayName?: string };
}

async function googleReviews(placeId: string) {
  const key = secrets.google();
  if (!key) return [];
  const payload = await fetchJson(
    `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
    { headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'reviews,googleMapsUri' } },
  ).catch(() => null);

  const reviews = (payload as { reviews?: GoogleReview[] } | null)?.reviews || [];
  const mapsUri = (payload as { googleMapsUri?: string } | null)?.googleMapsUri;

  const pageUrl = mapsUri || `https://www.google.com/maps/place/?q=place_id:${placeId}`;

  return reviews.map((review, index) => {
    const text = review.text?.text || '';
    // Every review of a place shares that place's page URL, but the cache is
    // unique on (source, source_url). Without a per-review identity all five
    // reviews collapse onto one row and four are lost.
    const itemKey = reviewItemKey(placeId, {
      publishTime: review.publishTime,
      author: review.authorAttribution?.displayName,
    }, index);
    return {
      id: `google-${placeId}-${index}`,
      canonicalPlaceId: placeId,
      source: 'google-places' as const,
      sourceUrl: evidenceSourceUrl(pageUrl, itemKey),
      sourceItemId: itemKey,
      publishedAt: review.publishTime,
      retrievedAt: new Date().toISOString(),
      authorType: 'traveller' as const,
      disclosure: assessDisclosure(text),
      claims: extractClaims(text),
      // A five-review relevance-ordered sample is useful but not a census.
      confidence: 0.6,
    };
  });
}

interface YouTubeItem {
  id?: { videoId?: string };
  snippet?: {
    title?: string;
    description?: string;
    publishedAt?: string;
    channelTitle?: string;
  };
}

async function youtubeEvidence(placeName: string, city: string, placeId: string) {
  const key = secrets.youtube();
  if (!key) return [];

  const params = new URLSearchParams({
    part: 'snippet',
    q: `${placeName} ${city}`,
    type: 'video',
    maxResults: '8',
    order: 'relevance',
    // Recency is the whole point: an old video says little about today.
    publishedAfter: new Date(Date.now() - 540 * 86_400_000).toISOString(),
    key,
  });

  const payload = await fetchJson(`https://www.googleapis.com/youtube/v3/search?${params}`).catch(() => null);
  const items = (payload as { items?: YouTubeItem[] } | null)?.items || [];

  return items
    .filter((item) => item.id?.videoId)
    .map((item) => {
      const text = `${item.snippet?.title || ''}. ${item.snippet?.description || ''}`;
      return {
        id: `youtube-${item.id!.videoId}`,
        canonicalPlaceId: placeId,
        source: 'youtube' as const,
        sourceUrl: `https://www.youtube.com/watch?v=${item.id!.videoId}`,
        sourceItemId: item.id!.videoId,
        publishedAt: item.snippet?.publishedAt,
        retrievedAt: new Date().toISOString(),
        authorType: 'traveller' as const,
        disclosure: assessDisclosure(text),
        claims: extractClaims(text),
        // Title and description only — we are not transcribing the video.
        confidence: 0.45,
      };
    });
}

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const body = (await request.json().catch(() => ({}))) as EvidenceBody;
  const city = typeof body.city === 'string' ? body.city.trim() : '';
  const placeIds = (body.placeIds || []).filter((id) => typeof id === 'string').slice(0, 25);
  const placeNames = body.placeNames || [];
  if (!city || placeIds.length === 0) {
    return json({ error: 'A city and at least one place id are required.' }, 400);
  }

  const expiresAt = expiryFor('reviewSummary', body.travelStartsInDays);
  const provider = typeof body.provider === 'string' && body.provider.trim()
    ? body.provider.trim()
    : 'google';

  // ---------------------------------------------------------------------
  // Read-through cache
  //
  // Evidence is the most expensive data this app gathers: reviews are an
  // Atmosphere-tier field, and each place also costs 100 YouTube quota units.
  // Re-fetching it because a traveller reopened discovery is pure waste.
  //
  // The cache keys on canonical place id. A place with no canonical record —
  // a fixture, or a provider whose discovery run predates this cache — still
  // works: it fetches live and simply skips the write.
  // ---------------------------------------------------------------------
  const cache = serviceClient();
  const canonicalIds = cache
    ? await readCanonicalPlaceIds(cache, provider, placeIds)
    : new Map<string, string>();
  const cachedByCanonical = cache && canonicalIds.size > 0
    ? await readEvidenceCache(cache, [...canonicalIds.values()])
    : new Map<string, CachedEvidence[]>();
  const freshProbes = cache && canonicalIds.size > 0
    ? await readEvidenceProbes(cache, [...canonicalIds.values()])
    : new Set<string>();

  /** A cached row becomes a wire document; the wire keys by *provider* id. */
  const toWireDocument = (placeId: string, entry: CachedEvidence, index: number) => ({
    id: `${entry.source}-${placeId}-${entry.sourceItemId || index}`,
    canonicalPlaceId: placeId,
    source: entry.source,
    sourceUrl: entry.sourceUrl,
    sourceItemId: entry.sourceItemId,
    publishedAt: entry.publishedAt,
    retrievedAt: entry.retrievedAt,
    authorType: entry.authorType,
    disclosure: entry.disclosure,
    claims: entry.claims,
    confidence: entry.confidence,
  });

  const documents: unknown[] = [];
  const trends: Record<string, number> = {};
  const freshDocuments: CachedEvidence[] = [];
  const attemptedProbes: Array<{ canonicalPlaceId: string; source: string }> = [];
  let providerCalls = 0;

  // A probe records that a provider was *asked*. An unconfigured provider was
  // never asked, so it must not be probed — otherwise adding the key later
  // would be ignored until the probe expires, days afterwards.
  const canFetchReviews = Boolean(secrets.google());
  const canFetchVideos = Boolean(secrets.youtube());

  // Sequential on purpose: these are quota-limited APIs, and a burst of
  // parallel requests is the fastest way to get rate limited.
  for (const [index, placeId] of placeIds.entries()) {
    const name = placeNames[index] || '';
    const canonicalId = canonicalIds.get(placeId);

    const wantReviews = shouldFetchEvidence({
      configured: canFetchReviews,
      canonicalPlaceId: canonicalId,
      source: 'google-places',
      freshProbes,
    });
    // A YouTube search needs a name to search for; without one there is nothing
    // to ask, and no call to make.
    const wantVideos = Boolean(name) && shouldFetchEvidence({
      configured: canFetchVideos,
      canonicalPlaceId: canonicalId,
      source: 'youtube',
      freshProbes,
    });
    // Cached rows stay usable whenever we are not replacing them this run.
    const reviewsAreFresh = !wantReviews;
    const videosAreFresh = !wantVideos;

    // Cached documents are used only for the sources we are *not* re-fetching.
    // A probe write can fail while the document write succeeded, and returning
    // both copies would double-count the same review — inflating `sourceCount`
    // and making one opinion look like corroboration.
    const cachedEntries = (canonicalId ? cachedByCanonical.get(canonicalId) || [] : []).filter((entry) => (
      entry.source === 'google-places' ? reviewsAreFresh
        : entry.source === 'youtube' ? videosAreFresh
          : true
    ));
    const cachedDocuments = cachedEntries.map((entry, position) => toWireDocument(placeId, entry, position));

    const [reviews, videos] = await Promise.all([
      wantReviews ? googleReviews(placeId) : Promise.resolve([]),
      wantVideos ? youtubeEvidence(name, city, placeId) : Promise.resolve([]),
    ]);
    if (wantReviews) providerCalls += 1;
    if (wantVideos) providerCalls += 1;

    documents.push(...cachedDocuments, ...reviews, ...videos);

    if (canonicalId) {
      if (wantReviews) attemptedProbes.push({ canonicalPlaceId: canonicalId, source: 'google-places' });
      if (wantVideos) attemptedProbes.push({ canonicalPlaceId: canonicalId, source: 'youtube' });
      for (const document of [...reviews, ...videos]) {
        freshDocuments.push({
          canonicalPlaceId: canonicalId,
          source: document.source,
          sourceUrl: document.sourceUrl,
          sourceItemId: document.sourceItemId,
          publishedAt: document.publishedAt,
          retrievedAt: document.retrievedAt,
          authorType: document.authorType,
          disclosure: document.disclosure,
          confidence: document.confidence,
          claims: document.claims,
        });
      }
    }

    // Trend: how much of the recent video evidence is genuinely recent. Reads
    // cached videos too, so a cache hit does not silently flatten the trend.
    const datedVideos = [
      ...videos,
      ...cachedDocuments.filter((document) => document.source === 'youtube'),
    ].filter((video) => video.publishedAt);
    if (datedVideos.length > 0) {
      const recent = datedVideos.filter((video) => {
        const age = (Date.now() - new Date(video.publishedAt!).getTime()) / 86_400_000;
        return age >= 0 && age <= 120;
      }).length;
      trends[placeId] = Math.min(1, (recent / datedVideos.length) * 0.6 + Math.min(1, recent / 5) * 0.4);
    }
  }

  if (cache) {
    await writeEvidenceCache(cache, freshDocuments, expiresAt);
    await writeEvidenceProbes(cache, attemptedProbes, expiresAt);
  }

  return json({
    documents,
    trends,
    // Summarisation runs client-side via summarisePlaceEvidence, so the
    // weighting rules live in one place rather than being duplicated here.
    expiresAt,
    /** Diagnostics: how many provider calls this request actually cost. */
    providerCalls,
    cached: providerCalls === 0,
  });
});
