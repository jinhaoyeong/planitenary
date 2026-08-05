/**
 * Gathers what people are actually saying about a place, right now.
 *
 * Three streams today, chosen so their biases do not all point the same way:
 *   - Reddit threads. Written after the visit, with no sponsorship incentive
 *     and public disagreement, which makes this the best available answer to
 *     "is it overrated" — the question a star average structurally cannot ask.
 *   - YouTube, searched with a recency filter: the strongest openly available
 *     signal for what is worth visiting *now*, and the most promotional.
 *   - Google Places reviews, when a deployment pays for them. Capped at five
 *     per place and ordered by relevance, so a sample, not a census.
 *
 * TikTok, Douyin and RedNote are deliberately absent: none offers public travel
 * search to commercial apps. Those arrive as traveller-pasted links instead,
 * through `travel-import-link`.
 *
 * Claim extraction lives in `_shared/claims.ts` and is keyword-based and
 * conservative. It reports what a source said and links back to it; it never
 * asserts an operational fact that no source stated.
 */
import {
  expiryFor,
  fetchJson,
  json,
  preflight,
  redditAccessToken,
  REDDIT_USER_AGENT,
  secrets,
} from '../_shared/providers.ts';
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
import { assessDisclosure, extractClaims } from '../_shared/claims.ts';

interface EvidenceBody {
  city?: string;
  placeIds?: string[];
  placeNames?: string[];
  travelStartsInDays?: number;
  /** Which map provider the ids belong to. Defaults to Google. */
  provider?: string;
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

interface RedditPost {
  data?: {
    id?: string;
    title?: string;
    selftext?: string;
    permalink?: string;
    subreddit?: string;
    created_utc?: number;
    score?: number;
    num_comments?: number;
    over_18?: boolean;
    is_self?: boolean;
    author?: string;
  };
}

/**
 * What people who actually went are saying, from discussion rather than reviews.
 *
 * This is the counterweight to the promotional pull of every other channel.
 * A review sits next to a business listing and a video earns its creator money;
 * a forum thread does neither, and its replies contradict each other in public.
 * That makes it the best free signal for "is this overrated" — the question a
 * star average structurally cannot answer.
 *
 * Only post titles and bodies are read. Comments hold the richest detail (queue
 * times, "go at 7am"), but fetching them costs one request per post, which is
 * the per-place fan-out this app already learned not to do.
 */
async function redditEvidence(placeName: string, city: string, placeId: string) {
  const token = await redditAccessToken();
  if (!token || !placeName) return [];

  const params = new URLSearchParams({
    q: `"${placeName}" ${city}`,
    sort: 'relevance',
    // A year is long enough to find the thread and short enough to stay current;
    // freshnessWeight decays whatever comes back by its actual age.
    t: 'year',
    limit: '15',
    type: 'link',
  });

  const payload = await fetchJson(
    `https://oauth.reddit.com/search?${params}`,
    { headers: { Authorization: `Bearer ${token}`, 'User-Agent': REDDIT_USER_AGENT } },
    10_000,
  ).catch(() => null);

  const posts = (payload as { data?: { children?: RedditPost[] } } | null)?.data?.children || [];

  return posts.flatMap((post) => {
    const data = post.data;
    if (!data?.id || !data.permalink || data.over_18) return [];
    const text = `${data.title || ''}. ${data.selftext || ''}`.trim();
    const claims = extractClaims(text);
    // A thread that says nothing about the place is noise, not evidence.
    if (claims.length === 0) return [];

    return [{
      id: `reddit-${data.id}`,
      canonicalPlaceId: placeId,
      source: 'reddit' as const,
      sourceUrl: `https://www.reddit.com${data.permalink}`,
      sourceItemId: data.id,
      publishedAt: data.created_utc ? new Date(data.created_utc * 1000).toISOString() : undefined,
      retrievedAt: new Date().toISOString(),
      authorType: 'traveller' as const,
      disclosure: assessDisclosure(text),
      claims,
      /**
       * Search relevance is not a guarantee the thread is about *this* place —
       * names repeat across cities. Confidence rises with community agreement,
       * which is the closest thing a forum has to corroboration, and stays
       * below a map provider's because the match itself is looser.
       */
      confidence: Math.min(0.75, 0.45 + Math.min(0.3, Math.log10(Math.max(1, data.score || 1)) / 10)),
    }];
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
  const canFetchThreads = Boolean(secrets.redditClientId() && secrets.redditClientSecret());

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
    const wantThreads = Boolean(name) && shouldFetchEvidence({
      configured: canFetchThreads,
      canonicalPlaceId: canonicalId,
      source: 'reddit',
      freshProbes,
    });
    // Cached rows stay usable whenever we are not replacing them this run.
    const reviewsAreFresh = !wantReviews;
    const videosAreFresh = !wantVideos;
    const threadsAreFresh = !wantThreads;

    // Cached documents are used only for the sources we are *not* re-fetching.
    // A probe write can fail while the document write succeeded, and returning
    // both copies would double-count the same review — inflating `sourceCount`
    // and making one opinion look like corroboration.
    const cachedEntries = (canonicalId ? cachedByCanonical.get(canonicalId) || [] : []).filter((entry) => (
      entry.source === 'google-places' ? reviewsAreFresh
        : entry.source === 'youtube' ? videosAreFresh
          : entry.source === 'reddit' ? threadsAreFresh
            : true
    ));
    const cachedDocuments = cachedEntries.map((entry, position) => toWireDocument(placeId, entry, position));

    const [reviews, videos, threads] = await Promise.all([
      wantReviews ? googleReviews(placeId) : Promise.resolve([]),
      wantVideos ? youtubeEvidence(name, city, placeId) : Promise.resolve([]),
      wantThreads ? redditEvidence(name, city, placeId) : Promise.resolve([]),
    ]);
    if (wantReviews) providerCalls += 1;
    if (wantVideos) providerCalls += 1;
    if (wantThreads) providerCalls += 1;

    documents.push(...cachedDocuments, ...reviews, ...videos, ...threads);

    if (canonicalId) {
      if (wantReviews) attemptedProbes.push({ canonicalPlaceId: canonicalId, source: 'google-places' });
      if (wantVideos) attemptedProbes.push({ canonicalPlaceId: canonicalId, source: 'youtube' });
      if (wantThreads) attemptedProbes.push({ canonicalPlaceId: canonicalId, source: 'reddit' });
      for (const document of [...reviews, ...videos, ...threads]) {
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
