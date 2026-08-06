/**
 * Keeping evidence current, rather than waiting to be asked.
 *
 * Caching stops the app buying the same answer twice. It does not make an
 * answer *true* — a review from six weeks ago is cached and stale at the same
 * time. Until now the only thing that refreshed anything was a traveller
 * happening to reopen discovery after the freshness window lapsed, which means
 * the plan was most out of date precisely when nobody was looking.
 *
 * This runs nightly and refreshes what has expired.
 *
 * ## The budget
 *
 * Official websites cost nothing — no key, no quota — so they refresh freely.
 * YouTube does not: the Data API allows 100 searches a day and a sweep could
 * spend the lot before a traveller opens the app.
 *
 * So refresh and live traffic share one counter and differ only in the ceiling
 * they ask against: refresh passes 30, live passes 90. Because the count is
 * shared, refresh can never push the total past 30, which leaves at least 60
 * for people actually using the app. If travellers get there first, refresh
 * simply gets less, or none. No coordination, no second table, no race.
 */
import { json, preflight, YOUTUBE_QUOTA_TIMEZONE, YOUTUBE_SEARCH_UNITS, expiryFor, secrets } from '../_shared/providers.ts';
import { reserveQuota } from '../_shared/quota.ts';
import {
  serviceClient,
  writeEvidenceCache,
  writeEvidenceProbes,
  writeOpeningHours,
  type CachedEvidence,
  type OpeningRuleRow,
} from '../_shared/cache.ts';
import { officialEvidence, youtubeEvidence } from '../_shared/evidenceSources.ts';

/**
 * Nightly YouTube ceiling. Held below the live ceiling so the shared counter
 * enforces the reserve on its own — see the note above.
 */
const REFRESH_YOUTUBE_LIMIT = 30;

/** Official pages are free, but a sweep still needs an end. */
const MAX_OFFICIAL_REFRESHES = 200;

/**
 * A place is worth refreshing if somebody looked at it recently.
 *
 * The intent was "trips departing within seven days", which the schema cannot
 * yet answer: `trip_registry` holds no travel dates, and nothing links a
 * canonical place to a trip. Recency of interest is the honest stand-in —
 * `evidence_probes.retrieved_at` records when the app last asked about a
 * place, so the most recently probed places are the ones travellers are
 * actively planning around. Places nobody has opened in weeks refresh last, or
 * not at all, which is the same cost discipline by a different route.
 */
const INTEREST_WINDOW_DAYS = 30;

interface DuePlace {
  canonicalPlaceId: string;
  source: string;
  name: string;
  city: string;
  website?: string;
  providerPlaceId: string;
}

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  /**
   * This endpoint spends quota, so it fails closed. An unset secret disables
   * it entirely rather than leaving a public button that drains the day's
   * allowance.
   */
  const expected = Deno.env.get('TRAVEL_REFRESH_SECRET');
  if (!expected) return json({ error: 'Refresh is not configured.' }, 503);
  if (request.headers.get('x-refresh-secret') !== expected) {
    return json({ error: 'Not authorised.' }, 401);
  }

  const cache = serviceClient();
  if (!cache) return json({ error: 'Refresh needs the service role.' }, 503);

  const now = new Date();
  const interestSince = new Date(now.getTime() - INTEREST_WINDOW_DAYS * 86_400_000).toISOString();

  // Expired probes, most recently interesting first.
  const { data: dueProbes, error } = await cache
    .from('evidence_probes')
    .select('canonical_place_id, source, retrieved_at')
    .lt('expires_at', now.toISOString())
    .gt('retrieved_at', interestSince)
    .order('retrieved_at', { ascending: false })
    .limit(MAX_OFFICIAL_REFRESHES);
  if (error) return json({ error: error.message }, 502);

  const rows = dueProbes || [];
  if (rows.length === 0) {
    return json({ refreshed: 0, officialRefreshed: 0, youtubeRefreshed: 0, youtubeBlocked: 0 });
  }

  // Everything needed to re-ask a source, in one round trip per table.
  const placeIds = [...new Set(rows.map((row) => String(row.canonical_place_id)))];
  const { data: places } = await cache
    .from('canonical_places')
    .select('id, primary_name, city, website')
    .in('id', placeIds);
  const { data: links } = await cache
    .from('place_provider_links')
    .select('canonical_place_id, provider_place_id')
    .in('canonical_place_id', placeIds);

  const placeById = new Map((places || []).map((place) => [String(place.id), place]));
  const providerIdByPlace = new Map((links || []).map((link) => [String(link.canonical_place_id), String(link.provider_place_id)]));

  const due: DuePlace[] = rows.flatMap((row) => {
    const canonicalPlaceId = String(row.canonical_place_id);
    const place = placeById.get(canonicalPlaceId);
    const providerPlaceId = providerIdByPlace.get(canonicalPlaceId);
    if (!place || !providerPlaceId) return [];
    return [{
      canonicalPlaceId,
      source: String(row.source),
      name: String(place.primary_name || ''),
      city: String(place.city || ''),
      website: place.website ? String(place.website) : undefined,
      providerPlaceId,
    }];
  });

  const expiresAt = expiryFor('reviewSummary');
  const documents: CachedEvidence[] = [];
  const probes: Array<{ canonicalPlaceId: string; source: string }> = [];
  const hours: Array<{ canonicalPlaceId: string; rules: OpeningRuleRow[] }> = [];
  let officialRefreshed = 0;
  let youtubeRefreshed = 0;
  let youtubeBlocked = 0;

  const canFetchVideos = Boolean(secrets.youtube());

  // Sequential on purpose: this is a background job with no one waiting, and a
  // burst of parallel requests is the fastest way to get rate limited.
  for (const place of due) {
    if (place.source === 'official-website') {
      if (!place.website) continue;
      const official = await officialEvidence(place.website, place.providerPlaceId);
      officialRefreshed += 1;
      probes.push({ canonicalPlaceId: place.canonicalPlaceId, source: 'official-website' });
      /**
       * Hours are stored, not just counted.
       *
       * Marking the probe fresh means the next live request will *skip* the
       * official fetch — so without persisting these, the refresh would read
       * the operator's hours overnight, throw them away, and leave the
       * traveller on the community-maintained ones.
       */
      if (official.openingRules.length > 0) {
        hours.push({ canonicalPlaceId: place.canonicalPlaceId, rules: official.openingRules });
      }
      for (const document of official.documents) {
        documents.push({ ...document, canonicalPlaceId: place.canonicalPlaceId });
      }
      continue;
    }

    if (place.source === 'youtube') {
      if (!canFetchVideos || !place.name) continue;
      const allowed = await reserveQuota(cache, {
        provider: 'youtube-search',
        calls: 1,
        units: YOUTUBE_SEARCH_UNITS,
        // Held below the live ceiling: this is what reserves the traveller's share.
        callLimit: REFRESH_YOUTUBE_LIMIT,
        resetTimezone: YOUTUBE_QUOTA_TIMEZONE,
      });
      if (!allowed) {
        youtubeBlocked += 1;
        // The night's share is spent. Nothing later in the list will fare
        // better, so stop asking.
        continue;
      }
      const videos = await youtubeEvidence(place.name, place.city, place.providerPlaceId);
      youtubeRefreshed += 1;
      probes.push({ canonicalPlaceId: place.canonicalPlaceId, source: 'youtube' });
      for (const document of videos) {
        documents.push({ ...document, canonicalPlaceId: place.canonicalPlaceId });
      }
      continue;
    }

    // Reviews and forum threads are refreshed on demand rather than nightly:
    // one needs a paid key and the other an approval this deployment lacks.
  }

  await writeEvidenceCache(cache, documents, expiresAt);
  await writeOpeningHours(cache, hours, expiryFor('openingHours'));
  await writeEvidenceProbes(cache, probes, expiresAt);

  return json({
    refreshed: probes.length,
    officialRefreshed,
    youtubeRefreshed,
    youtubeBlocked,
    documentsWritten: documents.length,
    openingHoursUpdated: hours.length,
    consideredDue: due.length,
  });
});
