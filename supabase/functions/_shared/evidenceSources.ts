/**
 * The evidence gatherers themselves — one function per source.
 *
 * Shared so that a live request and the nightly refresh gather evidence the
 * same way. Two implementations of "what does YouTube say about this place"
 * would drift, and the one that drifted would be the one nobody watches.
 *
 * None of these decides *whether* to run: caching, quota and freshness are the
 * caller's business. Each simply answers "what does this source say", or
 * returns nothing when it cannot say.
 */
import {
  fetchJson,
  fetchText,
  redditAccessToken,
  REDDIT_USER_AGENT,
  secrets,
} from './providers.ts';
import { evidenceSourceUrl, reviewItemKey } from './cacheKeys.ts';
import { assessDisclosure, extractClaims } from './claims.ts';
import { parseOsmOpeningRules } from './osmPlaces.ts';
import {
  closureNotices,
  extractJsonLd,
  isSafePublicUrl,
  openingRulesFromJsonLd,
  visibleText,
} from './officialSource.ts';

interface GoogleReview {
  text?: { text?: string };
  rating?: number;
  publishTime?: string;
  authorAttribution?: { displayName?: string };
}

export async function googleReviews(placeId: string) {
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

export async function youtubeEvidence(placeName: string, city: string, placeId: string) {
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

/**
 * What the operator says about their own place.
 *
 * The highest-authority source in the model, and the only one permitted to
 * establish that a venue has closed. It is also the cheapest: the address is
 * already on the candidate, and reading it costs no credential and no quota.
 *
 * Returns claims *and* opening hours, because an operator's own hours should
 * override community-maintained ones — which is what makes a weekday closure
 * trustworthy rather than merely likely.
 */
export async function officialEvidence(website: string | undefined, placeId: string) {
  // The address came from a community-edited tag, so it is untrusted input.
  if (!isSafePublicUrl(website)) return { documents: [], openingRules: [] };

  const html = await fetchText(website!);
  if (!html) return { documents: [], openingRules: [] };

  const openingRules = openingRulesFromJsonLd(extractJsonLd(html), parseOsmOpeningRules);
  const text = visibleText(html);
  const notices = closureNotices(text);

  // A page with neither a notice nor structured hours told us nothing worth
  // storing. Recording it anyway would dilute every summary with empty records.
  if (notices.length === 0) return { documents: [], openingRules };

  return {
    openingRules,
    documents: [{
      id: `official-${placeId}`,
      canonicalPlaceId: placeId,
      source: 'official-website' as const,
      sourceUrl: website!,
      sourceItemId: undefined as string | undefined,
      publishedAt: undefined as string | undefined,
      retrievedAt: new Date().toISOString(),
      authorType: 'official' as const,
      // An operator describing their own place is not promotion in the sense
      // `promotionRisk` guards against, and `authorType: 'official'` already
      // adds its own small penalty there.
      disclosure: 'organic' as const,
      claims: notices.map((notice) => ({
        type: notice.type,
        summary: notice.summary,
        strength: 0.95,
        excerpt: notice.excerpt,
      })),
      confidence: 0.9,
    }],
  };
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
export async function redditEvidence(placeName: string, city: string, placeId: string) {
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
