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
  aiBudgetEpoch,
  aiBudgetUsd,
  expiryFor,
  json,
  preflight,
  reasoningCallLimit,
  resolveReasoning,
  REASONING_QUOTA_PROVIDER,
  REASONING_QUOTA_TIMEZONE,
  secrets,
  YOUTUBE_QUOTA_TIMEZONE,
  YOUTUBE_SEARCH_UNITS,
  youtubeSearchLimit,
} from '../_shared/providers.ts';
import {
  boundSources,
  countRejections,
  emptyCounters,
  evidenceRevision,
  MAX_BRIEF_BATCH,
  requestAdmissionRead,
  requestPlaceBriefBatch,
  type BriefBatchItem,
  type PlaceBrief,
} from '../_shared/reasoning.ts';
import { reserveQuota, usageToday } from '../_shared/quota.ts';
import { budgetWindowStart, type ModelUsage } from '../_shared/aiCost.ts';
import { SpendSession, meteredModelCall } from '../_shared/meteredModel.ts';
import {
  type CachedAiBrief,
  type CachedEvidence,
  readAiBriefs,
  readCanonicalPlaceIds,
  readEvidenceCache,
  readEvidenceProbes,
  readOpeningHours,
  readSpendToDate,
  serviceClient,
  writeEvidenceCache,
  writeAiBriefs,
  writeEvidenceProbes,
  writeOpeningHours,
  writeSpendEvent,
} from '../_shared/cache.ts';
import { lookupAiBrief, shouldFetchEvidence } from '../_shared/cacheKeys.ts';
import {
  googleReviews,
  officialEvidence,
  redditEvidence,
  youtubeEvidence,
} from '../_shared/evidenceSources.ts';
import { admissionFromOfficialClaims, type AdmissionFare, type PlaceAdmission } from '../_shared/placeCost.ts';

interface EvidenceBody {
  city?: string;
  placeIds?: string[];
  placeNames?: string[];
  /** Each place's own website, for the official-source check. */
  placeWebsites?: Array<string | undefined>;
  /** Country codes resolve bare official JSON-LD amounts safely. */
  placeCountryCodes?: Array<string | undefined>;
  /**
   * Which places have no prose of their own. The client knows this and the
   * server does not — a description arrives with a matched Wikivoyage listing,
   * which happens on the discovery path. Only these places are worth spending
   * a metered call on.
   */
  placeNeedsDescription?: boolean[];
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

  /**
   * Model answers cached against this place's evidence, read once for the
   * whole batch. Fetched by place id across every revision, because the
   * revision for this run is only known after the grounding sources have been
   * assembled inside the loop below.
   */
  const cachedAiBriefs = cache && canonicalIds.size > 0
    ? await readAiBriefs(
      cache,
      [...canonicalIds.values()].map((canonicalPlaceId) => ({
        canonicalPlaceId, operation: 'place-brief', evidenceRevision: '',
      })),
    )
    : new Map<string, unknown | null>();

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
  /** Operator-published admission by provider place id, for the client to merge. */
  const admissions: Record<string, PlaceAdmission> = {};
  /** Validated model descriptions by provider place id. Often empty. */
  const briefs: Record<string, PlaceBrief> = {};
  const freshAiBriefs: CachedAiBrief[] = [];
  const reasoningCounters = emptyCounters();
  /**
   * Places wanting a description that the cache could not answer.
   *
   * Filled during the per-place loop and drained once afterwards, so a request
   * covering ten uncached places costs one provider call rather than ten. The
   * cache is consulted *before* a place lands here, which is what keeps a
   * revisited deck at zero calls instead of merely fewer.
   */
  const pendingBriefs: Array<{
    placeId: string;
    canonicalId?: string;
    item: BriefBatchItem;
  }> = [];
  /**
   * Resolved per operation, because the model allowlist is per operation and
   * the output ceiling differs between a batched brief and a single fare read.
   *
   * `misconfigured` is kept apart from `unconfigured` all the way to the
   * response. Both leave cards with their deterministic copy, but only one of
   * them is somebody's mistake, and a mistake that renders identically to a
   * deliberate choice is one nobody will ever find.
   */
  const briefResolution = resolveReasoning('place-brief');
  const admissionResolution = resolveReasoning('admission-read');
  const briefOptions = briefResolution.status === 'ready' ? briefResolution.options : undefined;
  const admissionOptions = admissionResolution.status === 'ready' ? admissionResolution.options : undefined;
  const configError = [briefResolution, admissionResolution]
    .find((resolution) => resolution.status === 'misconfigured');

  /**
   * Turn gathered documents into grounding text, keyed by the URL they came
   * from. Claim excerpts are verbatim fragments of the retrieved page, which
   * is exactly what the substring rule needs; nothing else we hold server-side
   * is guaranteed to be quotable.
   */
  const briefSourcesFrom = (docs: unknown[]) => {
    const byUrl = new Map<string, string[]>();
    for (const raw of docs) {
      const doc = raw as { sourceUrl?: string; claims?: Array<{ excerpt?: string; summary?: string }> };
      if (!doc?.sourceUrl) continue;
      const texts = (doc.claims || [])
        .map((claim) => claim.excerpt?.trim())
        .filter((text): text is string => Boolean(text));
      if (texts.length === 0) continue;
      byUrl.set(doc.sourceUrl, [...(byUrl.get(doc.sourceUrl) || []), ...texts]);
    }
    return [...byUrl.entries()].map(([sourceUrl, texts]) => ({ sourceUrl, text: texts.join('\n') }));
  };
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
    const cachedOfficialEntries = canonicalId
      ? (cachedByCanonical.get(canonicalId) || []).filter((entry) => entry.source === 'official-website')
      : [];
    const cachedOfficialAdmission = officialIsFresh && cachedOfficialEntries.length > 0
      ? admissionFromOfficialClaims(
        cachedOfficialEntries.flatMap((entry) => entry.claims),
        cachedOfficialEntries[0]?.sourceUrl,
        cachedOfficialEntries[0]?.retrievedAt,
      )
      : undefined;
    const cachedDocuments = cachedEntries.map((entry, position) => toWireDocument(placeId, entry, position));

    const [reviews, videos, threads, official] = await Promise.all([
      wantReviews ? googleReviews(placeId) : Promise.resolve([]),
      videosAllowed ? youtubeEvidence(name, city, placeId) : Promise.resolve([]),
      wantThreads ? redditEvidence(name, city, placeId) : Promise.resolve([]),
      wantOfficial
        ? officialEvidence(
          website,
          placeId,
          body.placeCountryCodes?.[index],
          /**
           * Only reached when the operator's JSON-LD published no fare at all —
           * `officialEvidence` enforces that, so a well-marked-up site never
           * costs a metered call. Everything a call needs to be refused lives
           * here: no key, no canonical id to cache against, no quota.
           */
          admissionOptions && canonicalId
            ? async (pageText, country) => {
              const revision = evidenceRevision([{ sourceUrl: website || '', text: pageText }]);
              const cached = lookupAiBrief(cachedAiBriefs, canonicalId, 'admission-read', revision);
              if (cached !== undefined) {
                // Including a cached `null`: a page the model could not read a
                // price from will not become readable tomorrow.
                reasoningCounters.cacheHits += 1;
                return cached as AdmissionFare[] | null;
              }
              if (!await reserveQuota(cache, {
                provider: REASONING_QUOTA_PROVIDER,
                calls: 1,
                units: 1,
                callLimit: reasoningCallLimit(),
                resetTimezone: REASONING_QUOTA_TIMEZONE,
                failClosed: true,
              })) {
                reasoningCounters.skipped += 1;
                return undefined;
              }
              const { fares, rejections } = await requestAdmissionRead(
                { pageText, countryCode: country },
                admissionOptions,
              );
              countRejections(reasoningCounters, rejections);
              if (fares) reasoningCounters.succeeded += 1; else reasoningCounters.failed += 1;
              freshAiBriefs.push({
                canonicalPlaceId: canonicalId,
                operation: 'admission-read',
                evidenceRevision: revision,
                brief: fares,
              });
              return fares;
            }
            : undefined,
        )
        : Promise.resolve({ documents: [], openingRules: [], admission: undefined as PlaceAdmission | undefined }),
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

    const officialAdmission = official.admission || cachedOfficialAdmission;
    if (officialAdmission) admissions[placeId] = officialAdmission;

    documents.push(...cachedDocuments, ...reviews, ...videos, ...threads, ...official.documents);

    /**
     * A description, for the many places that have none.
     *
     * Only asked for when the client says this place has no prose of its own —
     * most OSM results, because prose arrives only with a matched Wikivoyage
     * listing. Grounded in the claim excerpts we just gathered, which are
     * verbatim fragments of real pages, so the substring rule in
     * `validateBriefSentences` has something true to check against.
     *
     * Everything about this call is arranged so that failing is cheap and
     * silent: it runs last, it never blocks a card, and every negative
     * outcome — no key, no sources, no quota, a timeout, or every sentence
     * rejected — produces the same result, which is no brief.
     */
    if (briefOptions && body.placeNeedsDescription?.[index]) {
      const briefSources = boundSources(briefSourcesFrom([...cachedDocuments, ...reviews, ...threads, ...official.documents]));
      const revision = evidenceRevision(briefSources);
      const cachedBrief = canonicalId && cache
        ? lookupAiBrief(cachedAiBriefs, canonicalId, 'place-brief', revision)
        : undefined;

      if (briefSources.length === 0) {
        reasoningCounters.skipped += 1;
      } else if (cachedBrief !== undefined) {
        /**
         * A hit, and `null` is a legitimate hit — it records that we asked
         * about this exact evidence and nothing survived validation. Re-asking
         * would spend a metered call to learn the same thing again.
         */
        reasoningCounters.cacheHits += 1;
        if (cachedBrief) briefs[placeId] = cachedBrief as PlaceBrief;
      } else {
        /**
         * Deferred, not called. Asking here would spend one provider request
         * per place; collecting the misses and asking once for all of them is
         * the same answer for a tenth of the requests.
         *
         * Only the *uncached* places reach this list, so a second visit to a
         * deck costs nothing at all rather than a smaller batch.
         */
        pendingBriefs.push({
          placeId,
          canonicalId,
          item: {
            candidateId: placeId,
            evidenceRevision: revision,
            place: { name, city, categories: [] },
            sources: briefSources,
          },
        });
      }
    }

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

  /**
   * The deferred briefs, in batches of `MAX_BRIEF_BATCH`.
   *
   * **One provider request is one quota call**, whatever it carries. That
   * keeps the counter meaning what its name says — actual requests made — and
   * the workload is bounded on the other axes instead: how many places may
   * ride in a batch, how much serialised input may be sent, and how many
   * tokens the reply may cost. Charging a ten-place batch as ten calls would
   * make the counter measure neither requests nor spend.
   *
   * Quota is reserved per batch and checked before each one, so exhausting the
   * allowance mid-way leaves the remaining places unasked rather than
   * half-asked. An unasked place writes no cache row and is simply retried on
   * a later request, which is the correct outcome — unlike an *empty answer*,
   * which is knowledge and is stored.
   */
  /**
   * The spending ceiling, read once before any batch.
   *
   * Two independent refusals, both failing closed:
   *
   * - the ledger could not be read, so what today has cost is unknown;
   * - it *was* read, and the total has reached the ceiling.
   *
   * A third case is subtler and refuses too: calls whose cost could not be
   * determined. Those are missing from `knownUsd` entirely, so the total is a
   * floor rather than the truth, and continuing to spend against a number
   * known to be incomplete is how a ceiling gets quietly passed. Unknown-cost
   * events therefore stop further paid work until somebody reconciles them.
   */
  const session = new SpendSession(
    {
      readSpend: () => readSpendToDate(cache, budgetWindowStart(aiBudgetEpoch())),
      writeLedger: (row) => writeSpendEvent(cache, row),
    },
    aiBudgetUsd(),
  );

  for (let start = 0; start < pendingBriefs.length; start += MAX_BRIEF_BATCH) {
    const batch = pendingBriefs.slice(start, start + MAX_BRIEF_BATCH);
    if (!briefOptions) break;

    /**
     * The shared metered boundary: budget, quota, provider, ledger, in that
     * order. The budget is re-evaluated per batch and includes what earlier
     * batches in this same invocation have already spent — reading it once and
     * reusing the verdict would let every batch in the loop cross the ceiling
     * together on the strength of one stale "allowed".
     */
    let batchUsage: ModelUsage | undefined;
    let produced = new Map<string, PlaceBrief | null>();

    const outcome = await meteredModelCall(
      { operation: 'place-brief', provider: briefOptions.provider, requestedModel: briefOptions.model },
      session,
      {
        reserveQuota: () => reserveQuota(cache, {
          provider: REASONING_QUOTA_PROVIDER,
          calls: 1,
          units: 1,
          callLimit: reasoningCallLimit(),
          resetTimezone: REASONING_QUOTA_TIMEZONE,
          failClosed: true,
        }),
        readSpend: () => readSpendToDate(cache, budgetWindowStart(aiBudgetEpoch())),
        writeLedger: (row) => writeSpendEvent(cache, row),
        call: async () => {
          const answer = await requestPlaceBriefBatch(
            batch.map((entry) => entry.item),
            { ...briefOptions, onUsage: (reported) => { batchUsage = reported; } },
          );
          produced = answer.briefs;
          countRejections(reasoningCounters, answer.rejections);
          return {
            result: answer,
            usage: batchUsage,
            // A batch that came back with nothing usable was still billed.
            status: answer.briefs.size > 0 ? 'success' : batchUsage ? 'invalid_output' : 'provider_error',
          };
        },
      },
    );

    if (!outcome.ok) {
      // Nothing is asked, so nothing is cached: an unasked place is retried on
      // a later request, unlike an empty *answer*, which is knowledge.
      reasoningCounters.skipped += pendingBriefs.length - start;
      break;
    }

    for (const entry of batch) {
      // Keyed by the id we sent, never by position — see `validateBriefBatch`.
      const brief = produced.get(entry.item.candidateId);
      if (brief) {
        briefs[entry.placeId] = brief;
        reasoningCounters.succeeded += 1;
      } else {
        reasoningCounters.failed += 1;
      }
      // The empty answer is written too. That is the whole point: a place with
      // nothing to say must not be re-asked tomorrow.
      if (entry.canonicalId && brief !== undefined) {
        freshAiBriefs.push({
          canonicalPlaceId: entry.canonicalId,
          operation: 'place-brief',
          evidenceRevision: entry.item.evidenceRevision,
          brief: brief ?? null,
        });
      }
    }
  }

  if (cache) {
    await writeEvidenceCache(cache, freshDocuments, expiresAt);
    await writeOpeningHours(cache, freshHours, expiryFor('openingHours', body.travelStartsInDays));
    await writeEvidenceProbes(cache, attemptedProbes, expiresAt);
    /**
     * Model answers get the long TTL, because correctness here is governed by
     * `evidenceRevision` and not by the clock: a description stops being right
     * when what we read changes, which the key already catches. The expiry is
     * therefore garbage collection rather than freshness, and a short one
     * would only mean paying to regenerate an answer that was still correct.
     */
    await writeAiBriefs(cache, freshAiBriefs, expiryFor('placeIdentity', body.travelStartsInDays));
  }

  return json({
    documents,
    trends,
    openingHours,
    admissions,
    briefs,
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
    /**
     * What the model tier cost and refused. `rejectedSentences` is the number
     * that matters: a grounding validator whose rejection rate nobody watches
     * is a validator nobody notices has stopped working — whether because the
     * model improved or because the rule silently started passing everything.
     */
    reasoning: {
      configured: Boolean(briefOptions || admissionOptions),
      /**
       * Present only when a model *is* configured and was refused. Silence
       * here means "no model", which is an ordinary deployment; a string means
       * somebody set one that is not approved, and every card looking exactly
       * as it would without a key is precisely why that has to be said out
       * loud rather than inferred from an absence.
       */
      configError: configError?.status === 'misconfigured' ? configError.error : undefined,
      /**
       * What has been spent, and whether that figure can be trusted.
       *
       * `knownUsd` is reported beside `unknownEvents` rather than on its own,
       * because a total that silently excludes uncostable calls reads as
       * complete when it is a floor. Both numbers or neither.
       */
      /**
       * What has been spent, and whether that figure can be trusted.
       *
       * `knownUsd` is reported beside `unknownEvents` rather than on its own,
       * because a total that silently excludes uncostable calls reads as
       * complete when it is only a floor. Both numbers or neither.
       */
      spend: await session.report(),
      limit: reasoningCallLimit(),
      used: (briefOptions || admissionOptions) ? (await usageToday(cache, REASONING_QUOTA_PROVIDER, REASONING_QUOTA_TIMEZONE))?.calls ?? null : null,
      ...reasoningCounters,
    },
  });
});
