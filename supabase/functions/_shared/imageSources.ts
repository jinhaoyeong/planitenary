/**
 * The image gatherers — one function per Wikimedia endpoint.
 *
 * The counterpart of `evidenceSources.ts`, and shaped the same way: none of
 * these decides *whether* to run. Caching, probes and freshness are the
 * caller's business. Each simply answers "what does this source hold", or
 * returns nothing when it cannot say.
 *
 * ## Every call here is batched, and that is the point
 *
 * A per-place image lookup across a sixty-place shortlist is sixty requests —
 * the exact fan-out shape that produced this project's RM 31.69 bill on a
 * different API. The Wikimedia endpoints all accept up to fifty titles or ids
 * per request, so a whole deck of places costs **one** request to Wikidata and
 * **one** to Commons regardless of how many places are in it.
 *
 * Wikimedia is free and unmetered, so the risk here is not a bill — it is
 * being a bad citizen of an API that runs on donations, and being rate limited
 * for it. The batching, the `User-Agent` that names this app, and the
 * `MAX_TITLES_PER_REQUEST` ceiling are all that politeness made mechanical.
 *
 * ## No credential, and therefore no possible bill
 *
 * These endpoints need no key. That keeps them inside the rule stated in
 * `CLAUDE_CONTEXT.md`: no source in the active set can generate an invoice.
 * An overrun returns `429`, not money.
 */
import { fetchJson } from './providers.ts';
import {
  buildPlaceImage,
  commonsFilePage,
  MAX_CATEGORY_FILES,
  normaliseCommonsTitle,
  parseCommonsMetadata,
  parseWikipediaLead,
  type ImageLead,
  type PlaceImage,
} from './placeImages.ts';

/**
 * Wikimedia's documented ceiling for anonymous callers. Asking for more does
 * not fail — it silently truncates, which would leave the extra places looking
 * like places with no photograph.
 */
const MAX_TITLES_PER_REQUEST = 50;

/**
 * Wikimedia asks that automated clients identify themselves and give a contact
 * path. An anonymous bot on these endpoints gets blocked, and a block would
 * present as "no place has a photograph" — a silent, total failure of exactly
 * the kind this codebase keeps having to make loud.
 */
const WIKIMEDIA_USER_AGENT = 'Planitenary/1.0 (travel itinerary planner; https://planitenary.app)';

const REQUEST_INIT: RequestInit = {
  headers: { 'User-Agent': WIKIMEDIA_USER_AGENT, Accept: 'application/json' },
};

/**
 * The width Commons is asked to render a thumbnail at.
 *
 * The discovery card's media slot is 520 CSS pixels at its widest, so 1024
 * covers a 2× display without shipping a 6000-pixel original over a hotel
 * wifi connection. The original URL is kept alongside it for a future
 * full-screen view.
 */
const THUMBNAIL_WIDTH = 1024;

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let start = 0; start < items.length; start += size) batches.push(items.slice(start, start + size));
  return batches;
}

/**
 * A gatherer's answer, with "the request failed" kept apart from "the request
 * succeeded and there was nothing".
 *
 * These are not the same fact and the caller must not treat them alike. A
 * place whose lookup *answered* with nothing has no photograph, and recording
 * that is the entire reason the probe log exists. A place whose lookup
 * **failed** was never asked — and writing a probe for it would turn a
 * five-minute Wikimedia outage into thirty days of "these places have no
 * pictures", across every deck open at the time.
 *
 * This is the distinction `usageToday` draws between `null` and `{calls: 0}`,
 * and the one `reserveQuota` refusals draw by writing no probe.
 */
export interface GatherResult<T> {
  ok: boolean;
  value: T;
}

interface CommonsPage {
  title?: string;
  missing?: boolean;
  imageinfo?: Array<{
    url?: string;
    descriptionurl?: string;
    width?: number;
    height?: number;
    thumburl?: string;
    extmetadata?: unknown;
  }>;
}

/**
 * File titles → validated photographs, licence and author included.
 *
 * This is where every lead ends up: Wikidata and Wikipedia both answer with a
 * *file name*, not an image, so the licence — the thing that decides whether a
 * photograph may be shown at all — is only ever read here, once, from Commons
 * itself.
 *
 * `leadFor` says which lead asked for each title, so the ranking can prefer a
 * mapper's chosen photograph over a category's first member.
 */
export async function commonsImages(
  titles: string[],
  leadFor: (title: string) => ImageLead['kind'],
): Promise<GatherResult<Map<string, PlaceImage>>> {
  const found = new Map<string, PlaceImage>();
  const unique = [...new Set(titles)].filter(Boolean);
  if (unique.length === 0) return { ok: true, value: found };
  let ok = true;

  for (const batch of chunk(unique, MAX_TITLES_PER_REQUEST)) {
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      formatversion: '2',
      prop: 'imageinfo',
      iiprop: 'url|size|extmetadata',
      iiurlwidth: String(THUMBNAIL_WIDTH),
      titles: batch.join('|'),
    });
    const payload = await fetchJson(
      `https://commons.wikimedia.org/w/api.php?${params}`,
      REQUEST_INIT,
      10_000,
    ).catch(() => {
      ok = false;
      return null;
    });

    const pages = (payload as { query?: { pages?: CommonsPage[] } } | null)?.query?.pages || [];
    for (const page of pages) {
      const title = normaliseCommonsTitle(page.title, 'File');
      if (!title || page.missing) continue;
      const info = page.imageinfo?.[0];
      if (!info) continue;

      const image = buildPlaceImage({
        title,
        lead: leadFor(title),
        // The rendered thumbnail is what a card displays; the original is kept
        // as `url` only when Commons produced no rendering, which happens for
        // files already smaller than the requested width.
        url: info.thumburl || info.url,
        thumbnailUrl: info.thumburl,
        width: info.width,
        height: info.height,
        descriptionUrl: info.descriptionurl || commonsFilePage(title),
        metadata: parseCommonsMetadata(info.extmetadata),
      });
      if (image) found.set(title, image);
    }
  }

  return { ok, value: found };
}

interface WikidataClaim {
  mainsnak?: { datavalue?: { value?: unknown } };
}

/**
 * Wikidata `P18` (image) for a batch of items → Commons file titles.
 *
 * `P18` is the item's *representative* image, chosen by editors. That makes it
 * a genuinely curated answer to "what does this look like" — but for the
 * subject rather than for the map object, which is why it ranks below a
 * mapper's own `wikimedia_commons` tag. See `LEAD_PRIORITY`.
 *
 * Only the first claim is read. An item with several P18 values has them
 * ordered by rank already, and taking them all would let one heavily
 * photographed subject fill a whole deck's worth of image slots.
 */
export async function wikidataImageTitles(ids: string[]): Promise<GatherResult<Map<string, string>>> {
  const titles = new Map<string, string>();
  const unique = [...new Set(ids)].filter(Boolean);
  if (unique.length === 0) return { ok: true, value: titles };
  let ok = true;

  for (const batch of chunk(unique, MAX_TITLES_PER_REQUEST)) {
    const params = new URLSearchParams({
      action: 'wbgetentities',
      format: 'json',
      props: 'claims',
      ids: batch.join('|'),
    });
    const payload = await fetchJson(
      `https://www.wikidata.org/w/api.php?${params}`,
      REQUEST_INIT,
      10_000,
    ).catch(() => {
      ok = false;
      return null;
    });

    const entities = (payload as { entities?: Record<string, { claims?: Record<string, WikidataClaim[]> }> } | null)
      ?.entities || {};
    for (const [id, entity] of Object.entries(entities)) {
      const claim = entity?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
      if (typeof claim !== 'string') continue;
      const title = normaliseCommonsTitle(claim, 'File');
      if (title) titles.set(id.toUpperCase(), title);
    }
  }

  return { ok, value: titles };
}

interface WikipediaPage {
  title?: string;
  pageimage?: string;
}

/**
 * The lead image of a batch of Wikipedia articles, as Commons file titles.
 *
 * Grouped by language by the caller, because the endpoint is per-wiki:
 * `en.wikipedia.org` cannot answer about a `ja:` article. Usually returns the
 * same file Wikidata already named, which costs nothing — the titles are
 * de-duplicated before Commons is asked.
 */
export async function wikipediaImageTitles(
  language: string,
  articleTitles: string[],
): Promise<GatherResult<Map<string, string>>> {
  const titles = new Map<string, string>();
  const unique = [...new Set(articleTitles)].filter(Boolean);
  // The language came from a community-edited tag, so it is untrusted input
  // being interpolated into a hostname. Anything but a plain wiki code stops
  // here rather than building a request to a host somebody else chose. A
  // refusal is `ok: true` — we decided not to ask, which is an answer, not an
  // outage.
  if (unique.length === 0 || !/^[a-z]{2,3}(-[a-z0-9-]+)?$/.test(language)) return { ok: true, value: titles };
  let ok = true;

  for (const batch of chunk(unique, MAX_TITLES_PER_REQUEST)) {
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      formatversion: '2',
      prop: 'pageimages',
      piprop: 'name',
      titles: batch.join('|'),
    });
    const payload = await fetchJson(
      `https://${language}.wikipedia.org/w/api.php?${params}`,
      REQUEST_INIT,
      10_000,
    ).catch(() => {
      ok = false;
      return null;
    });

    const pages = (payload as { query?: { pages?: WikipediaPage[] } } | null)?.query?.pages || [];
    for (const page of pages) {
      if (!page.title || !page.pageimage) continue;
      const title = normaliseCommonsTitle(page.pageimage, 'File');
      if (title) titles.set(page.title, title);
    }
  }

  return { ok, value: titles };
}

interface CategoryMember {
  title?: string;
}

/**
 * The first few files in a Commons category.
 *
 * One request per category — this is the only unbatched call here, because the
 * endpoint takes a single `cmtitle`. Categories are therefore asked for last
 * and only for places that no curated lead answered, which keeps the request
 * count proportional to "places with nothing better" rather than to deck size.
 *
 * Capped at {@link MAX_CATEGORY_FILES}: a category is an unordered bucket that
 * also holds signs, floor plans and detail shots, and reading a hundred of
 * them would not make the first one any more likely to be the building.
 */
export async function commonsCategoryFileTitles(category: string): Promise<GatherResult<string[]>> {
  const title = normaliseCommonsTitle(category, 'Category');
  if (!title) return { ok: true, value: [] };
  let ok = true;

  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    list: 'categorymembers',
    cmtitle: title,
    cmtype: 'file',
    cmlimit: String(MAX_CATEGORY_FILES),
  });
  const payload = await fetchJson(
    `https://commons.wikimedia.org/w/api.php?${params}`,
    REQUEST_INIT,
    10_000,
  ).catch(() => {
    ok = false;
    return null;
  });

  const members = (payload as { query?: { categorymembers?: CategoryMember[] } } | null)?.query?.categorymembers || [];
  return {
    ok,
    value: members
      .map((member) => normaliseCommonsTitle(member.title, 'File'))
      .filter((name): name is string => Boolean(name)),
  };
}

/** Split a batch of leads by kind, so each endpoint is asked exactly once. */
export function groupLeads(leads: Array<{ placeId: string; lead: ImageLead }>) {
  const wikidata = new Map<string, string[]>();
  const wikipedia = new Map<string, Map<string, string[]>>();
  const files = new Map<string, string[]>();
  const categories = new Map<string, string[]>();

  const push = (map: Map<string, string[]>, key: string, placeId: string) => {
    const existing = map.get(key);
    if (existing) existing.push(placeId); else map.set(key, [placeId]);
  };

  for (const { placeId, lead } of leads) {
    if (lead.kind === 'wikidata') push(wikidata, lead.value, placeId);
    else if (lead.kind === 'commons-file') push(files, lead.value, placeId);
    else if (lead.kind === 'commons-category') push(categories, lead.value, placeId);
    else {
      const parsed = parseWikipediaLead(lead.value);
      if (!parsed) continue;
      const byLanguage = wikipedia.get(parsed.language) || new Map<string, string[]>();
      push(byLanguage, parsed.title, placeId);
      wikipedia.set(parsed.language, byLanguage);
    }
  }

  return { wikidata, wikipedia, files, categories };
}
