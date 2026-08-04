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

interface EvidenceBody {
  city?: string;
  placeIds?: string[];
  placeNames?: string[];
  travelStartsInDays?: number;
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

  return reviews.map((review, index) => {
    const text = review.text?.text || '';
    return {
      id: `google-${placeId}-${index}`,
      canonicalPlaceId: placeId,
      source: 'google-places' as const,
      sourceUrl: mapsUri || `https://www.google.com/maps/place/?q=place_id:${placeId}`,
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

  const documents: unknown[] = [];
  const trends: Record<string, number> = {};

  // Sequential on purpose: these are quota-limited APIs, and a burst of
  // parallel requests is the fastest way to get rate limited.
  for (const [index, placeId] of placeIds.entries()) {
    const name = placeNames[index] || '';
    const [reviews, videos] = await Promise.all([
      googleReviews(placeId),
      name ? youtubeEvidence(name, city, placeId) : Promise.resolve([]),
    ]);
    documents.push(...reviews, ...videos);

    // Trend: how much of the recent video evidence is genuinely recent.
    const dated = videos.filter((video) => video.publishedAt);
    if (dated.length > 0) {
      const recent = dated.filter((video) => {
        const age = (Date.now() - new Date(video.publishedAt!).getTime()) / 86_400_000;
        return age >= 0 && age <= 120;
      }).length;
      trends[placeId] = Math.min(1, (recent / dated.length) * 0.6 + Math.min(1, recent / 5) * 0.4);
    }
  }

  return json({
    documents,
    trends,
    // Summarisation runs client-side via summarisePlaceEvidence, so the
    // weighting rules live in one place rather than being duplicated here.
    expiresAt: expiryFor('reviewSummary', body.travelStartsInDays),
  });
});
