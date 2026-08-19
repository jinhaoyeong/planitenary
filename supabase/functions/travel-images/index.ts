/**
 * Real photographs of the places on a traveller's deck.
 *
 * Every image this returns is a photograph somebody took of the place it is
 * attached to, fetched from Wikimedia Commons with its author, its licence and
 * a link to the file page. **Nothing here is generated.** A model-produced
 * approximation of a landmark is a false statement about what a traveller will
 * see when they arrive, and one they have no way to detect — the same standard
 * the rest of this app applies to prices, hours and closures, applied to the
 * thing on a card that people doubt least.
 *
 * ## Why this is a separate function from discovery
 *
 * The pointers — a `wikimedia_commons` tag, a Wikidata id — are already in the
 * Overpass response, so `travel-discover` carries them out for free. Resolving
 * them is what costs, and resolving all sixty at discovery time would be one
 * lookup per place across a shortlist the traveller may abandon after four
 * cards. That is the fan-out shape that produced this project's RM 31.69 bill
 * on a different API, so images follow the rule evidence already follows: the
 * visible card plus a few ahead, never the whole shortlist.
 *
 * ## The batching is the cost control
 *
 * Within one request every lead of a kind is asked as a single call — one
 * request to Wikidata for every item, one to Commons for every file title,
 * whatever the deck size. Commons categories are the exception (the endpoint
 * takes one category at a time) and are therefore asked only for places no
 * curated lead answered, and capped.
 *
 * Wikimedia needs no credential and cannot bill, so a cap here protects the
 * API rather than a budget — but the cache still matters enormously, because
 * *most places have no photograph at all* and without the probe log every one
 * of them is looked up again on every discovery run, forever.
 */
import { expiryFor, json, preflight } from '../_shared/providers.ts';
import { authenticateRequest } from '../_shared/auth.ts';
import { shouldFetchEvidence } from '../_shared/cacheKeys.ts';
import {
  readCanonicalPlaceCoordinates,
  readCanonicalPlaceIds,
  readImageProbes,
  readPlaceImages,
  serviceClient,
  writeImageProbes,
  writePlaceImages,
} from '../_shared/cache.ts';
import {
  commonsCategoryFileTitles,
  commonsImages,
  groupLeads,
  wikidataEntityFacts,
  wikipediaPageFacts,
} from '../_shared/imageSources.ts';
import {
  isNonPhotographicAsset,
  parseImageLead,
  rankPlaceImages,
  validateEntityForPlace,
  PLACE_IMAGE_PROBE_SOURCE,
  PLACE_IMAGE_VALIDATION_VERSION,
  type ImageLead,
  type PlaceImage,
  type WikidataEntityFacts,
} from '../_shared/placeImages.ts';

interface ImagesBody {
  placeIds?: string[];
  /**
   * One lead list per place id, positionally aligned. The client holds these
   * because they arrived on the candidate from discovery; the server cannot
   * re-derive them, since it does not keep the OSM tags.
   */
  placeLeads?: unknown[][];
  travelStartsInDays?: number;
  /** Which map provider the ids belong to. Defaults to OSM. */
  provider?: string;
}

/**
 * A deck's worth of places, plus the prefetch ahead of it. Bounded here as
 * well as on the client, because the client is not the only thing that can
 * send this request.
 */
const MAX_PLACES = 25;

/**
 * Leads read per place. A place with more than this many pointers is not a
 * place with more photographs available; it is a place somebody tagged
 * enthusiastically, and reading all of them would let one map object cost more
 * lookups than the rest of the deck combined.
 */
const MAX_LEADS_PER_PLACE = 4;

/**
 * Commons categories resolved in one request, across the whole batch.
 *
 * The category endpoint takes one category at a time, so this is the only
 * unbatched call in the function and the only place where cost grows with deck
 * size. Capping it means a deck of twenty-five places with nothing but
 * categories costs six requests rather than twenty-five — and the places past
 * the cap are simply not probed, so they are retried next time rather than
 * being recorded as having no photograph.
 */
const MAX_CATEGORY_LOOKUPS = 6;

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authentication = await authenticateRequest(request);
  if (authentication.ok === false) return json({ error: authentication.detail }, authentication.status);

  const body = (await request.json().catch(() => ({}))) as ImagesBody;
  const placeIds = (body.placeIds || []).filter((id) => typeof id === 'string' && id.trim()).slice(0, MAX_PLACES);
  if (placeIds.length === 0) return json({ error: 'At least one place id is required.' }, 400);

  const provider = typeof body.provider === 'string' && body.provider.trim() ? body.provider.trim() : 'osm';
  const expiresAt = expiryFor('placeImage', body.travelStartsInDays);

  /**
   * Leads, validated one at a time.
   *
   * These become API query parameters and, for a Wikipedia lead, part of a
   * *hostname*. `parseImageLead` bounds the length, checks the shape and
   * normalises the title, so nothing a client sends can build a request to a
   * host of its choosing. A malformed lead is dropped individually rather than
   * failing the batch: losing one pointer beats losing a deck's photographs.
   */
  const leadsByPlace = new Map<string, ImageLead[]>();
  placeIds.forEach((placeId, index) => {
    const raw = Array.isArray(body.placeLeads?.[index]) ? body.placeLeads![index] : [];
    const leads = raw
      .map(parseImageLead)
      .filter((lead): lead is ImageLead => Boolean(lead))
      .slice(0, MAX_LEADS_PER_PLACE);
    if (leads.length > 0) leadsByPlace.set(placeId, leads);
  });

  // ---------------------------------------------------------------------
  // Read-through cache
  //
  // The probe log is what makes this worth having. Most OSM places carry no
  // image tag and no Wikidata item, so "no photograph" is the *common* answer,
  // and a document cache alone cannot tell it apart from "never asked".
  // ---------------------------------------------------------------------
  const cache = serviceClient();
  const canonicalIds = cache
    ? await readCanonicalPlaceIds(cache, provider, placeIds)
    : new Map<string, string>();
  const cachedByCanonical = cache && canonicalIds.size > 0
    ? await readPlaceImages(cache, [...canonicalIds.values()])
    : new Map<string, PlaceImage[]>();
  const freshProbes = cache && canonicalIds.size > 0
    ? await readImageProbes(cache, [...canonicalIds.values()])
    : new Set<string>();

  /**
   * Where each place actually is, according to our own canonical record rather
   * than the caller. This is the yardstick the Wikidata entity is measured
   * against, so it must not be something a request can assert.
   */
  const canonicalCoordinates = cache && canonicalIds.size > 0
    ? await readCanonicalPlaceCoordinates(cache, [...canonicalIds.values()])
    : new Map<string, { lat: number; lng: number }>();
  const placeCoordinates = new Map<string, { lat: number; lng: number }>();
  for (const [placeId, canonicalId] of canonicalIds) {
    const point = canonicalCoordinates.get(canonicalId);
    if (point) placeCoordinates.set(placeId, point);
  }

  const images: Record<string, PlaceImage[]> = {};
  /** Places whose lookup we are about to run, and which leads to run for them. */
  const pending: Array<{ placeId: string; canonicalId?: string; leads: ImageLead[] }> = [];

  for (const placeId of placeIds) {
    const canonicalId = canonicalIds.get(placeId);
    const leads = leadsByPlace.get(placeId) || [];

    const wantLookup = leads.length > 0 && shouldFetchEvidence({
      configured: true,
      canonicalPlaceId: canonicalId,
      source: PLACE_IMAGE_PROBE_SOURCE,
      freshProbes,
    });

    if (!wantLookup) {
      /**
       * A fresh probe means we asked recently, and the answer stands even when
       * it was "nothing". Cached photographs are returned; a place with a
       * fresh probe and no rows genuinely has no photograph we may show, and
       * asking again would learn the same thing.
       */
      const cached = canonicalId ? cachedByCanonical.get(canonicalId) : undefined;
      if (cached && cached.length > 0) images[placeId] = cached;
      continue;
    }

    pending.push({ placeId, canonicalId, leads });
  }

  /**
   * One pass over every pending place, grouped by lead kind so each endpoint
   * is asked once for the whole batch rather than once per place.
   */
  const flatLeads = pending.flatMap(({ placeId, leads }) => leads.map((lead) => ({ placeId, lead })));
  const grouped = groupLeads(flatLeads);
  let providerCalls = 0;
  /**
   * Whether every lookup this run actually completed.
   *
   * "Commons answered and had nothing" and "Commons did not answer" are
   * different facts, and only the first one may be written to the probe log. A
   * five-minute Wikimedia outage recorded as an answer would become thirty
   * days of "these places have no pictures" across every deck open at the
   * time — and it would look exactly like normal operation, because most
   * places genuinely have none.
   *
   * The same distinction `usageToday` draws between `null` and `{calls: 0}`.
   */
  let lookupComplete = true;

  /**
   * Which places each file title belongs to, and by which lead. Built as the
   * titles are resolved, so the single Commons lookup at the end can attribute
   * every photograph back to its place *and* to the lead that found it — which
   * is what `rankPlaceImages` orders on.
   */
  const titleOwners = new Map<string, Array<{ placeId: string; lead: ImageLead['kind'] }>>();
  /** Why a candidate photograph was refused, for the response diagnostics. */
  const rejections: Array<{ placeId: string; reason: string }> = [];
  const claimTitle = (title: string, placeId: string, lead: ImageLead['kind']) => {
    /**
     * A placeholder glyph is a valid, freely licensed file and a broken promise
     * in a slot that says "this is the place" — two Fukuoka shrines received
     * `Gthumb.svg`. Refused here so it cannot reach any lead's results.
     */
    if (isNonPhotographicAsset(title)) {
      rejections.push({ placeId, reason: 'non_photographic_asset' });
      return;
    }
    const owners = titleOwners.get(title);
    if (owners) owners.push({ placeId, lead }); else titleOwners.set(title, [{ placeId, lead }]);
  };

  // A mapper's own choice of photograph. Already a file title, so no
  // resolution step and no request of its own.
  for (const [title, owners] of grouped.files) {
    for (const placeId of owners) claimTitle(title, placeId, 'commons-file');
  }

  /**
   * Articles first, so both image authorities can be judged by one entity
   * lookup.
   *
   * A Wikipedia lead used to claim its article's lead image with no identity
   * check at all, which made it a way around the Wikidata gate rather than a
   * second source: Marui's Wikidata item was correctly refused as a company,
   * and the article for that same company then supplied its Tokyo head office
   * to a Fukuoka branch. Resolving articles before the entity batch lets every
   * path converge on the same validator without a second round trip.
   */
  const wikipediaPages = new Map<string, Map<string, { title: string; qid?: string }>>();
  for (const [language, byTitle] of grouped.wikipedia) {
    providerCalls += 1;
    const resolved = await wikipediaPageFacts(language, [...byTitle.keys()]);
    if (!resolved.ok) lookupComplete = false;
    wikipediaPages.set(language, resolved.value);
  }

  /**
   * Every entity either authority points at, asked once. Article items usually
   * repeat the ids the tags already named, so this normally costs nothing
   * extra; when it does not, it is still one batched request rather than one
   * per article.
   */
  const entityIds = new Set<string>(grouped.wikidata.keys());
  for (const pages of wikipediaPages.values()) {
    for (const page of pages.values()) if (page.qid) entityIds.add(page.qid);
  }

  let entityFacts = new Map<string, WikidataEntityFacts>();
  if (entityIds.size > 0) {
    providerCalls += 1;
    const resolved = await wikidataEntityFacts([...entityIds]);
    if (!resolved.ok) lookupComplete = false;
    entityFacts = resolved.value;
  }

  // The encyclopedia's representative image, for every item at once.
  for (const [itemId, placeIds] of grouped.wikidata) {
    const facts = entityFacts.get(itemId.toUpperCase());
    if (!facts?.title) continue;
    for (const placeId of placeIds) {
      /**
       * The tag names an entity, not necessarily this place. Production
       * produced a Tokyo flagship for a Fukuoka branch and a concert
       * photograph for a theatre, both correctly licensed. The same response
       * that carried the picture also carries what is needed to refuse it.
       */
      const verdict = validateEntityForPlace(facts, placeCoordinates.get(placeId));
      if (!verdict.ok) {
        rejections.push({ placeId, reason: verdict.reason });
        continue;
      }
      claimTitle(facts.title, placeId, 'wikidata');
    }
  }

  // Article lead images, held to exactly the same standard.
  for (const [language, byTitle] of grouped.wikipedia) {
    const pages = wikipediaPages.get(language);
    if (!pages) continue;
    for (const [articleTitle, page] of pages) {
      for (const placeId of byTitle.get(articleTitle) || []) {
        /**
         * An article with no Wikidata item cannot be tied to a physical place
         * at all, and an unproven identity is exactly what this gate exists to
         * refuse. A placard beats an article photograph of we-don't-know-what.
         */
        if (!page.qid) {
          rejections.push({ placeId, reason: 'wikipedia_unverified_identity' });
          continue;
        }

        /**
         * When the place also carries its own Wikidata tag and the article
         * disagrees with it, the two sources are describing different things
         * and neither is evidence for the other. Choosing whichever produced a
         * picture would be picking the prettier answer, not the true one.
         */
        const taggedIds = [...grouped.wikidata.entries()]
          .filter(([, owners]) => owners.includes(placeId))
          .map(([id]) => id.toUpperCase());
        if (taggedIds.length > 0 && !taggedIds.includes(page.qid)) {
          rejections.push({ placeId, reason: 'wikipedia_wikidata_identity_mismatch' });
          continue;
        }

        const facts = entityFacts.get(page.qid);
        if (!facts) {
          rejections.push({ placeId, reason: 'wikipedia_unverified_identity' });
          continue;
        }
        const verdict = validateEntityForPlace(facts, placeCoordinates.get(placeId));
        if (!verdict.ok) {
          rejections.push({ placeId, reason: verdict.reason });
          continue;
        }
        claimTitle(page.title, placeId, 'wikipedia');
      }
    }
  }

  /**
   * Categories last, and only for places nothing better answered.
   *
   * This is the one lookup whose cost grows with the number of places, so it
   * is spent on the places that would otherwise show no photograph at all
   * rather than on adding a fifth picture to a place that already has four.
   */
  const alreadyAnswered = new Set(
    [...titleOwners.values()].flatMap((owners) => owners.map((owner) => owner.placeId)),
  );
  const categoriesToRead = [...grouped.categories.entries()]
    .filter(([, owners]) => owners.some((placeId) => !alreadyAnswered.has(placeId)))
    .slice(0, MAX_CATEGORY_LOOKUPS);
  /**
   * Places whose category we did not get to. They are excluded from the probe
   * write below: we never asked, so a later request must ask rather than treat
   * today's silence as an answer. Exactly the rule `reserveQuota` refusals
   * follow on the evidence path.
   */
  const unreadCategoryPlaces = new Set(
    [...grouped.categories.entries()]
      .filter(([category]) => !categoriesToRead.some(([read]) => read === category))
      .flatMap(([, owners]) => owners)
      .filter((placeId) => !alreadyAnswered.has(placeId)),
  );

  for (const [category, owners] of categoriesToRead) {
    providerCalls += 1;
    const titles = await commonsCategoryFileTitles(category);
    if (!titles.ok) lookupComplete = false;
    for (const title of titles.value) {
      for (const placeId of owners) claimTitle(title, placeId, 'commons-category');
    }
  }

  /**
   * The single Commons lookup, where every lead converges.
   *
   * Wikidata and Wikipedia both answer with a file *name*, so the licence —
   * the thing that decides whether a photograph may be shown at all — is read
   * here, once, from Commons itself. `commonsImages` refuses anything it
   * cannot name a free licence for, which is why a refusal produces no
   * photograph rather than an unattributed one.
   */
  if (titleOwners.size > 0) {
    providerCalls += 1;
    const leadFor = (title: string): ImageLead['kind'] => {
      const owners = titleOwners.get(title) || [];
      // The strongest lead that claimed this title. A file found both as a
      // mapper's choice and as a category member is credited as the former.
      const order: ImageLead['kind'][] = ['commons-file', 'wikidata', 'wikipedia', 'commons-category'];
      return order.find((kind) => owners.some((owner) => owner.lead === kind)) || 'commons-category';
    };
    const resolved = await commonsImages([...titleOwners.keys()], leadFor);
    if (!resolved.ok) lookupComplete = false;

    const byPlace = new Map<string, PlaceImage[]>();
    for (const [title, image] of resolved.value) {
      for (const owner of titleOwners.get(title) || []) {
        // Credited to the lead that this *place* found it through, which is
        // not always the strongest lead overall — two places can share one
        // photograph through different routes.
        const forPlace: PlaceImage = { ...image, lead: owner.lead };
        byPlace.set(owner.placeId, [...(byPlace.get(owner.placeId) || []), forPlace]);
      }
    }
    for (const [placeId, found] of byPlace) images[placeId] = rankPlaceImages(found);
  }

  /**
   * A failed lookup falls back to whatever the cache already held.
   *
   * Without this a Wikimedia wobble would blank the pictures on a deck that
   * had them a moment earlier — and because nothing is written on a failure,
   * the very next request would re-read those same cached rows and put them
   * back. A card flickering between having a photograph and not is a worse
   * outcome than a slightly stale one.
   */
  if (!lookupComplete) {
    for (const entry of pending) {
      if (images[entry.placeId]?.length || !entry.canonicalId) continue;
      const cached = cachedByCanonical.get(entry.canonicalId);
      if (cached && cached.length > 0) images[entry.placeId] = cached;
    }
  }

  if (cache && lookupComplete) {
    /**
     * Written for every place we asked about, **including those that produced
     * nothing** — because the write deletes a place's existing rows before
     * inserting, and that delete is the only thing that can retire a file
     * removed from Commons or relicensed to something this app may not
     * display. Skipping the empty answers would leave exactly those rows
     * behind, still being served on every cache hit.
     */
    const freshImages = pending
      .filter((entry) => entry.canonicalId && !unreadCategoryPlaces.has(entry.placeId))
      .map((entry) => ({ canonicalPlaceId: entry.canonicalId!, images: images[entry.placeId] || [] }));
    await writePlaceImages(cache, freshImages, expiresAt);

    /**
     * The empty answer is probed too — that is the whole point. A place with
     * no photograph must not be looked up again tomorrow, and the day after,
     * forever. Only places we actually *asked* about are recorded: one whose
     * category lookup was capped away was never asked, and recording it would
     * turn "we ran out of budget" into "this place has no photograph".
     *
     * The whole block is skipped when any lookup failed, for the same reason
     * at a larger scale — see `lookupComplete`.
     */
    const probes = pending
      .filter((entry) => entry.canonicalId && !unreadCategoryPlaces.has(entry.placeId))
      .map((entry) => ({ canonicalPlaceId: entry.canonicalId!, source: PLACE_IMAGE_PROBE_SOURCE }));
    await writeImageProbes(cache, probes, expiresAt);
  }

  return json({
    /** Photographs by provider place id, ranked best-first. Often empty. */
    images,
    expiresAt,
    /**
     * Diagnostics. `providerCalls: 0` on a full deck is the cache working;
     * a number that grows with deck size on every request is the probe log
     * failing to write, which otherwise looks exactly like normal operation.
     */
    providerCalls,
    cached: providerCalls === 0,
    /**
     * Places asked about this run. Reported beside `providerCalls` because the
     * ratio between them is the only visible sign that batching still holds —
     * twenty places at four calls is correct, twenty places at twenty calls is
     * the fan-out this function exists to avoid, and both return images.
     */
    lookedUp: pending.length,
    /**
     * False when a lookup did not answer, in which case nothing was cached and
     * nothing was probed. Reported because the alternative is a silent outage:
     * most places genuinely have no photograph, so "Wikimedia is down" and
     * "these places have no pictures" render identically on the cards.
     */
    complete: lookupComplete,
    /**
     * Photographs refused because they could not be shown to depict the place.
     * Reported so a deck full of placards can be told apart from a deck whose
     * pictures were all rejected — the two look identical to a traveller.
     */
    rejected: rejections,
  });
});
