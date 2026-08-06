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
  json,
  preflight,
  secrets,
  YOUTUBE_QUOTA_TIMEZONE,
  YOUTUBE_SEARCH_UNITS,
  youtubeSearchLimit,
} from '../_shared/providers.ts';
import { reserveQuota, usageToday } from '../_shared/quota.ts';
import {
  type CachedEvidence,
  readCanonicalPlaceIds,
  readEvidenceCache,
  readEvidenceProbes,
  readOpeningHours,
  serviceClient,
  writeEvidenceCache,
  writeEvidenceProbes,
  writeOpeningHours,
} from '../_shared/cache.ts';
import { shouldFetchEvidence } from '../_shared/cacheKeys.ts';
import {
  googleReviews,
  officialEvidence,
  redditEvidence,
  youtubeEvidence,
} from '../_shared/evidenceSources.ts';

interface EvidenceBody {
  city?: string;
  placeIds?: string[];
  placeNames?: string[];
  /** Each place's own website, for the official-source check. */
  placeWebsites?: Array<string | undefined>;
  travelStartsInDays?: number;
  /** Which map provider the ids belong to. Defaults to Google. */
  provider?: string;
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
  /**
   * Hours the nightly refresh already read from operators' own sites. Without
   * this the refresh would be worse than useless: it marks the official probe
   * fresh, so this request skips the fetch, and the better hours it found
   * overnight would never reach anyone.
   */
  const storedHours = cache && canonicalIds.size > 0
    ? await readOpeningHours(cache, [...canonicalIds.values()])
    : new Map<string, Array<{ daysOfWeek: number[]; opensAt: string; closesAt: string }>>();

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
  /** Operator-published hours by provider place id, for the client to merge. */
  const openingHours: Record<string, Array<{ daysOfWeek: number[]; opensAt: string; closesAt: string }>> = {};
  const freshDocuments: CachedEvidence[] = [];
  const freshHours: Array<{ canonicalPlaceId: string; rules: Array<{ daysOfWeek: number[]; opensAt: string; closesAt: string }> }> = [];
  const attemptedProbes: Array<{ canonicalPlaceId: string; source: string }> = [];
  let providerCalls = 0;
  /** Video lookups the daily cap stopped. Reported so a quiet gap is visible. */
  let quotaBlocked = 0;

  // A probe records that a provider was *asked*. An unconfigured provider was
  // never asked, so it must not be probed — otherwise adding the key later
  // would be ignored until the probe expires, days afterwards.
  const canFetchReviews = Boolean(secrets.google());
  const canFetchVideos = Boolean(secrets.youtube());
  const canFetchThreads = Boolean(secrets.redditClientId() && secrets.redditClientSecret());
  // An operator's own site needs no credential at all — it is always available.
  const placeWebsites = body.placeWebsites || [];

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
    const website = placeWebsites[index];
    const wantOfficial = Boolean(website) && shouldFetchEvidence({
      configured: true,
      canonicalPlaceId: canonicalId,
      source: 'official-website',
      freshProbes,
    });
    /**
     * The daily cap, checked immediately before the call rather than up front.
     *
     * Reserved atomically, so two requests running at once cannot both take the
     * last search. A refusal here is deliberately *not* recorded as a probe:
     * we never asked, so tomorrow must ask again rather than treating today's
     * silence as an answer.
     */
    const videosAllowed = wantVideos && await reserveQuota(cache, {
      provider: 'youtube-search',
      calls: 1,
      units: YOUTUBE_SEARCH_UNITS,
      callLimit: youtubeSearchLimit(),
      resetTimezone: YOUTUBE_QUOTA_TIMEZONE,
    });
    if (wantVideos && !videosAllowed) quotaBlocked += 1;

    // Cached rows stay usable whenever we are not replacing them this run —
    // including when the cap stopped us, where the cached copy is all we have.
    const reviewsAreFresh = !wantReviews;
    const videosAreFresh = !videosAllowed;
    const threadsAreFresh = !wantThreads;
    const officialIsFresh = !wantOfficial;

    // Cached documents are used only for the sources we are *not* re-fetching.
    // A probe write can fail while the document write succeeded, and returning
    // both copies would double-count the same review — inflating `sourceCount`
    // and making one opinion look like corroboration.
    const cachedEntries = (canonicalId ? cachedByCanonical.get(canonicalId) || [] : []).filter((entry) => (
      entry.source === 'google-places' ? reviewsAreFresh
        : entry.source === 'youtube' ? videosAreFresh
          : entry.source === 'reddit' ? threadsAreFresh
          : entry.source === 'official-website' ? officialIsFresh
            : true
    ));
    const cachedDocuments = cachedEntries.map((entry, position) => toWireDocument(placeId, entry, position));

    const [reviews, videos, threads, official] = await Promise.all([
      wantReviews ? googleReviews(placeId) : Promise.resolve([]),
      videosAllowed ? youtubeEvidence(name, city, placeId) : Promise.resolve([]),
      wantThreads ? redditEvidence(name, city, placeId) : Promise.resolve([]),
      wantOfficial ? officialEvidence(website, placeId) : Promise.resolve({ documents: [], openingRules: [] }),
    ]);
    if (wantReviews) providerCalls += 1;
    if (videosAllowed) providerCalls += 1;
    if (wantThreads) providerCalls += 1;
    if (wantOfficial) providerCalls += 1;

    /**
     * Hours from the operator override community-maintained ones, which is
     * what makes a weekday closure trustworthy rather than merely likely.
     *
     * Freshly read hours are stored as well as returned, so the next request —
     * which will skip the fetch while the probe is fresh — still gets them.
     */
    if (official.openingRules.length > 0) {
      openingHours[placeId] = official.openingRules;
      if (canonicalId) freshHours.push({ canonicalPlaceId: canonicalId, rules: official.openingRules });
    } else if (canonicalId) {
      const stored = storedHours.get(canonicalId);
      if (stored) openingHours[placeId] = stored;
    }

    documents.push(...cachedDocuments, ...reviews, ...videos, ...threads, ...official.documents);

    if (canonicalId) {
      if (wantReviews) attemptedProbes.push({ canonicalPlaceId: canonicalId, source: 'google-places' });
      // Only a call that actually happened counts as having asked.
      if (videosAllowed) attemptedProbes.push({ canonicalPlaceId: canonicalId, source: 'youtube' });
      if (wantThreads) attemptedProbes.push({ canonicalPlaceId: canonicalId, source: 'reddit' });
      if (wantOfficial) attemptedProbes.push({ canonicalPlaceId: canonicalId, source: 'official-website' });
      for (const document of [...reviews, ...videos, ...threads, ...official.documents]) {
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
    await writeOpeningHours(cache, freshHours, expiryFor('openingHours', body.travelStartsInDays));
    await writeEvidenceProbes(cache, attemptedProbes, expiresAt);
  }

  return json({
    documents,
    trends,
    openingHours,
    // Summarisation runs client-side via summarisePlaceEvidence, so the
    // weighting rules live in one place rather than being duplicated here.
    expiresAt,
    /** Diagnostics: how many provider calls this request actually cost. */
    providerCalls,
    cached: providerCalls === 0,
    /**
     * Where the day's YouTube allowance stands. Without this a cap looks
     * exactly like a provider outage — evidence quietly thins and nothing says
     * why.
     */
    youtubeQuota: {
      limit: youtubeSearchLimit(),
      used: (await usageToday(cache, 'youtube-search', YOUTUBE_QUOTA_TIMEZONE))?.calls ?? null,
      blockedThisRequest: quotaBlocked,
    },
  });
});
