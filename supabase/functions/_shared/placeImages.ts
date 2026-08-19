/**
 * Real photographs of real places — the rules, with no network in sight.
 *
 * This module has NO imports and no Deno APIs on purpose, so the same code is
 * exercised by the Node/vitest suite: the precedent set by `cacheKeys.ts`,
 * `osmPlaces.ts` and `placeCost.ts`. The fetchers live in `imageSources.ts`.
 *
 * ## A photograph is a factual claim about a place
 *
 * A picture is the first thing a traveller looks at and the last thing they
 * think to doubt. That makes it exactly the kind of assertion the rest of this
 * app refuses to make without a source — so the same rule applies here, in its
 * strongest form:
 *
 * **No image of a place may ever be generated.** Not by a model, not by
 * similarity search, not by "a picture of somewhere that looks like this". A
 * generated approximation of Osaka Castle is a false statement about what a
 * traveller will see when they arrive, and it is a false statement they cannot
 * detect. Every image here is a photograph somebody took of *this* place, with
 * its author, its licence and its file page carried alongside it.
 *
 * ## Only Wikimedia hosts, and that is a security decision as much as a
 * licensing one
 *
 * The leads come from OSM tags, which anybody may edit — the same untrusted
 * input `isSafePublicUrl` exists to guard on the official-source path. But an
 * image is worse than a fetch: an `<img src>` is loaded *by the traveller's
 * browser*, so an arbitrary URL in that tag would hand a stranger the IP
 * address, user agent and referrer of every person who sees the card.
 *
 * So the OSM `image` tag is never hotlinked. It is accepted only when it
 * already points into Wikimedia, in which case what is kept is the *file
 * title*, and the real URL is rebuilt from Commons' own API together with the
 * licence and the author. A photo hosted anywhere else is dropped, and
 * {@link osmImageLeads} says so rather than silently narrowing.
 *
 * ## An unrecognised licence is not permission
 *
 * Commons is overwhelmingly free content, but not uniformly: it also holds
 * fair-use files, non-commercial licences and no-derivatives licences. The
 * gate is therefore an allowlist ({@link licenceForDisplay}) — refuse first on
 * anything that names a restriction, then admit only licences we can name.
 * Anything unrecognised is refused, which is the same "unknown is not zero"
 * rule the quota and opening-hours code already follow.
 */

/**
 * A pointer at where a photograph of this place might be found. Derived from
 * tags that are already in the discovery payload, so producing one costs no
 * request at all — the resolution into an actual image is what costs, and that
 * is deferred until a traveller is looking at the card.
 */
export interface ImageLead {
  kind: 'commons-file' | 'commons-category' | 'wikidata' | 'wikipedia';
  /**
   * `File:Foo.jpg`, `Category:Bar`, `Q1234`, or `en:Some Article` depending on
   * `kind`. Kept as the source wrote it, minus the prefix normalisation in
   * {@link normaliseCommonsTitle}.
   */
  value: string;
}

/** A photograph, with everything needed to display it and credit it. */
export interface PlaceImage {
  /** Full-size (or large thumbnail) URL, always on a Wikimedia host. */
  url: string;
  /** A smaller rendering for cards, when Commons produced one. */
  thumbnailUrl?: string;
  /**
   * The dimensions of the **source photograph**, not of `url` — which is
   * normally a rendering of it. These exist to rank one photograph against
   * another (see {@link rankPlaceImages}), not to lay anything out: the card's
   * media slot is sized by CSS `aspect-ratio`, so nothing here can resize it.
   */
  width?: number;
  height?: number;
  source: 'wikimedia-commons';
  /** The Commons file page — where the full licence and author live. */
  sourcePage: string;
  /** Photographer or uploader, markup stripped. Often absent for old files. */
  author?: string;
  /** Human-readable licence name, e.g. `CC BY-SA 4.0`. */
  licence: string;
  licenceUrl?: string;
  /** The single line shown under the photo. See {@link attributionFor}. */
  attribution: string;
  /** Which lead produced it, which is what {@link rankPlaceImages} orders on. */
  lead: ImageLead['kind'];
}

/**
 * How many photographs are kept per place.
 *
 * A card shows one. The rest exist so a broken URL or a later gallery has
 * somewhere to fall back to, and so a Commons category — the least curated
 * lead — is not represented by whichever file happens to sort first.
 */
export const MAX_IMAGES_PER_PLACE = 4;

/**
 * How many files are read from a Commons *category*, which is an unordered
 * bucket rather than a chosen picture. Kept small: a category can hold
 * thousands of files, most of them details, signs and floor plans.
 */
export const MAX_CATEGORY_FILES = 6;

/**
 * The probe source name for "we looked for a photograph of this place".
 *
 * One name for the whole lookup, not one per lead, because the leads are asked
 * together in a single batch and a place with no photograph has no photograph
 * whichever lead was tried.
 */
export const PLACE_IMAGE_PROBE_SOURCE = 'wikimedia-image';

const WIKIMEDIA_HOSTS = new Set([
  'upload.wikimedia.org',
  'commons.wikimedia.org',
  'commons.m.wikimedia.org',
]);

/**
 * True for a URL safe to put in an `<img src>` on a traveller's device.
 *
 * HTTPS and a Wikimedia host, nothing else. This is deliberately far narrower
 * than `isSafePublicUrl`: that function decides what the *server* may fetch,
 * where the cost of being wrong is an SSRF probe. This one decides what a
 * *browser* may be told to load, where the cost of being wrong is every
 * viewer's IP address arriving at a host an anonymous map editor chose.
 */
export function isWikimediaImageUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return false;
    if (url.username || url.password) return false;
    return WIKIMEDIA_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * A Wikimedia image URL with its query string and fragment removed, or nothing.
 *
 * Commons appends its own campaign parameters to the URLs `imageinfo` returns —
 * `?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail`
 * on every `thumburl`. They are harmless to fetch and were invisible to every
 * unit test here, because no test could invent them; a live response is what
 * showed them.
 *
 * They have to go, for two reasons that are about identity rather than tidiness:
 *
 * - `image_url` is half of `place_images`' primary key. Parameters Wikimedia
 *   can change at will make the *same photograph* a different row, so a cache
 *   hit and a fresh fetch would disagree about what is already stored.
 * - {@link rankPlaceImages} de-duplicates on URL. Two leads resolving one file
 *   with differing parameters would survive as two entries, and the card
 *   gallery would show the same picture twice.
 *
 * There is also no reason to forward another site's analytics parameters from a
 * traveller's browser.
 */
export function wikimediaImageUrl(value: string | undefined): string | undefined {
  if (!isWikimediaImageUrl(value)) return undefined;
  const url = new URL(value!);
  url.search = '';
  url.hash = '';
  return url.toString();
}

/**
 * `File:Foo bar.jpg` from any of the shapes a tag or URL writes it in.
 *
 * Commons treats spaces and underscores as the same character and capitalises
 * the first letter, so `file:foo_bar.jpg` and `File:Foo bar.jpg` are one file.
 * Normalising here means two spellings of one photograph cannot become two
 * cache rows, two API lookups and two chances to show the same picture twice.
 */
export function normaliseCommonsTitle(value: string | undefined, prefix: 'File' | 'Category'): string | undefined {
  if (!value) return undefined;
  let title = decodeSafely(value.trim());
  if (!title) return undefined;
  // Strip whichever prefix is present, in any language-neutral casing.
  title = title.replace(new RegExp(`^${prefix}\\s*:\\s*`, 'i'), '');
  title = title.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  if (!title) return undefined;
  // A title carrying a path separator or a fragment is not a bare file name;
  // it is a URL somebody put in the wrong tag, and guessing at it would build
  // a lookup for a file that does not exist.
  if (/[#<>[\]|{}]/.test(title)) return undefined;
  const capitalised = title.charAt(0).toUpperCase() + title.slice(1);
  return `${prefix}:${capitalised}`;
}

/** `decodeURIComponent` that returns the input rather than throwing on `%`. */
function decodeSafely(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * The Commons file title inside a Wikimedia URL, or nothing.
 *
 * Handles the two forms in the wild: a `commons.wikimedia.org/wiki/File:X`
 * page link, and an `upload.wikimedia.org/.../X.jpg` direct link — including
 * the `/thumb/` variant, whose last path segment is a *rendering* of the file
 * (`800px-X.jpg`) rather than the file itself.
 */
export function commonsFileTitleFromUrl(value: string | undefined): string | undefined {
  if (!isWikimediaImageUrl(value)) return undefined;
  const url = new URL(value!);
  const path = decodeSafely(url.pathname);

  if (url.hostname.toLowerCase().endsWith('commons.wikimedia.org')) {
    const match = /\/wiki\/(.+)$/.exec(path);
    return match ? normaliseCommonsTitle(match[1], 'File') : undefined;
  }

  // upload.wikimedia.org/wikipedia/commons/a/ab/Foo.jpg
  // upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Foo.jpg/800px-Foo.jpg
  const segments = path.split('/').filter(Boolean);
  if (segments.length === 0) return undefined;
  const isThumb = segments.includes('thumb');
  // For a thumb the file name is the second-to-last segment; the last is the
  // rendering. Taking the last would ask Commons about `800px-Foo.jpg`, which
  // is not a file that exists.
  const name = isThumb ? segments[segments.length - 2] : segments[segments.length - 1];
  return normaliseCommonsTitle(name, 'File');
}

/** A `wikipedia=en:Title` tag, split into the pieces the API needs. */
export function parseWikipediaLead(value: string): { language: string; title: string } | undefined {
  const match = /^([a-z]{2,3}(?:-[a-z0-9-]+)?)\s*:\s*(.+)$/i.exec(value.trim());
  if (!match) return undefined;
  const title = match[2].replace(/_/g, ' ').trim();
  if (!title) return undefined;
  return { language: match[1].toLowerCase(), title };
}

/** A `Q`-number, or nothing. Tags carry stray whitespace and the odd URL. */
export function parseWikidataId(value: string): string | undefined {
  const match = /(Q\d+)/i.exec(value.trim());
  return match ? match[1].toUpperCase() : undefined;
}

/**
 * Every place in the discovery payload that might have a photograph, from tags
 * Overpass already returned.
 *
 * This costs no request, which is the whole reason it lives on the discovery
 * path: a per-place image lookup at discovery time would recreate exactly the
 * fan-out that made the previous provider expensive. Discovery carries the
 * pointers; `travel-images` resolves them for the handful of cards a traveller
 * actually reaches.
 *
 * Ordered strongest lead first, so a caller taking the first one gets the best
 * one. See {@link rankPlaceImages} for what "strongest" means and why.
 */
export function osmImageLeads(tags: Record<string, string | undefined>): ImageLead[] {
  const leads: ImageLead[] = [];
  const seen = new Set<string>();
  const add = (kind: ImageLead['kind'], value: string | undefined) => {
    if (!value) return;
    const key = `${kind}|${value}`;
    if (seen.has(key)) return;
    seen.add(key);
    leads.push({ kind, value });
  };

  // A mapper attached this exact photograph to this exact map object. The most
  // specific statement anybody has made about what this place looks like.
  const commons = tags.wikimedia_commons;
  if (commons) {
    if (/^\s*category\s*:/i.test(commons)) {
      add('commons-category', normaliseCommonsTitle(commons, 'Category'));
    } else {
      add('commons-file', normaliseCommonsTitle(commons, 'File'));
    }
  }

  /**
   * `image=<url>`. Accepted only when it already points into Wikimedia, and
   * even then only as a *file title* — never as a URL to hotlink. A photo
   * hosted anywhere else is dropped rather than loaded from a stranger's
   * server by every traveller who sees the card.
   */
  add('commons-file', commonsFileTitleFromUrl(tags.image));

  // The encyclopedia's own choice of representative image for the subject.
  add('wikidata', tags.wikidata ? parseWikidataId(tags.wikidata) : undefined);

  // Last of the curated leads: the lead image of the article, which is usually
  // the same file Wikidata names and is here for when it is not.
  if (tags.wikipedia && parseWikipediaLead(tags.wikipedia)) add('wikipedia', tags.wikipedia.trim());

  // A bucket of files rather than a chosen picture — see MAX_CATEGORY_FILES.
  if (!commons || !/^\s*category\s*:/i.test(commons)) {
    add('commons-category', normaliseCommonsTitle(tags['wikimedia_commons:category'], 'Category'));
  }

  return leads;
}

/**
 * How good a lead is at answering "what does this place look like".
 *
 * Lower sorts first. The ordering is about *who chose the picture and for
 * what*:
 *
 * 1. `commons-file` — a mapper chose this photograph for this map object.
 * 2. `wikidata` — the encyclopedia chose it for the subject. Curated, but the
 *    subject is not always the thing on the map (a temple complex's P18 may be
 *    its most famous hall).
 * 3. `wikipedia` — the article's lead image, normally identical to P18 and
 *    kept for when the item has none.
 * 4. `commons-category` — nobody chose it. A category is an unordered bucket
 *    that also holds signs, floor plans and detail shots, so it ranks last
 *    even though it is often the only lead a place has.
 */
const LEAD_PRIORITY: Record<ImageLead['kind'], number> = {
  'commons-file': 0,
  wikidata: 1,
  wikipedia: 2,
  'commons-category': 3,
};

/**
 * Order photographs best-first and drop duplicates.
 *
 * Two leads routinely resolve to the same file — a mapper's `wikimedia_commons`
 * tag and the article's lead image are frequently one photograph — and showing
 * it twice in a gallery would look like two pictures of the same wall.
 *
 * Within one lead the tie-break is pixel area, because the failure mode of a
 * card image is a thumbnail stretched across a 520px scene. Landscape is
 * preferred at equal area: the media slot is wider than it is tall, so a
 * portrait photograph arrives letterboxed with the subject shrunk to a strip.
 */
export function rankPlaceImages(images: PlaceImage[]): PlaceImage[] {
  const byUrl = new Map<string, PlaceImage>();
  for (const image of images) {
    const existing = byUrl.get(image.url);
    // Keep the copy that came from the stronger lead, so a file found both as
    // a mapper's choice and as a category member is credited as the former.
    if (!existing || LEAD_PRIORITY[image.lead] < LEAD_PRIORITY[existing.lead]) byUrl.set(image.url, image);
  }

  return [...byUrl.values()].sort((left, right) => {
    const lead = LEAD_PRIORITY[left.lead] - LEAD_PRIORITY[right.lead];
    if (lead !== 0) return lead;
    const area = (right.width || 0) * (right.height || 0) - (left.width || 0) * (left.height || 0);
    if (area !== 0) return area;
    const orientation = Number(isPortrait(left)) - Number(isPortrait(right));
    if (orientation !== 0) return orientation;
    return left.url.localeCompare(right.url);
  }).slice(0, MAX_IMAGES_PER_PLACE);
}

const isPortrait = (image: PlaceImage) => Boolean(image.width && image.height && image.height > image.width);

/**
 * The fields of Commons' `extmetadata` this app reads, validated rather than
 * cast.
 *
 * `extmetadata` is a free-form map whose values are HTML fragments written by
 * thousands of different templates over twenty years. Every field here is
 * checked for shape and stripped of markup, because the alternative is a
 * `<a href>` from a wiki template being rendered into a credit line.
 */
export interface CommonsMetadata {
  artist?: string;
  credit?: string;
  licenceShortName?: string;
  licenceUrl?: string;
  usageTerms?: string;
  restrictions?: string;
}

/** Read one `extmetadata` value, which is always `{ value: ... }` when present. */
function metadataField(raw: Record<string, unknown>, key: string): string | undefined {
  const entry = raw[key];
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return undefined;
  const value = (entry as { value?: unknown }).value;
  if (typeof value === 'string') return stripMarkup(value) || undefined;
  // Some templates emit a bare number (a year, a licence version).
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

export function parseCommonsMetadata(value: unknown): CommonsMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  return {
    artist: metadataField(raw, 'Artist'),
    credit: metadataField(raw, 'Credit'),
    licenceShortName: metadataField(raw, 'LicenseShortName'),
    licenceUrl: metadataField(raw, 'LicenseUrl'),
    usageTerms: metadataField(raw, 'UsageTerms'),
    restrictions: metadataField(raw, 'Restrictions'),
  };
}

/**
 * HTML fragment → plain text.
 *
 * Commons author fields are markup (`<a href="/wiki/User:X" title="…">X</a>`),
 * and the credit line is rendered as text, so the tags have to go. Entities
 * are decoded afterwards, never before: decoding first would turn a `&lt;` in
 * somebody's name into a tag that the stripper then removes.
 */
export function stripMarkup(value: string): string {
  const withoutTags = value
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]*>/g, ' ');
  return decodeEntities(withoutTags).replace(/\s+/g, ' ').trim();
}

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith('#')) {
      const code = body[1] === 'x' || body[1] === 'X'
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/**
 * Anything naming a restriction. Checked *before* the allowlist, because these
 * phrases turn up alongside a free-looking licence name — a file can be tagged
 * `CC BY-SA 3.0` for the photograph while `Restrictions` records that the
 * building in it is not freely licensed.
 */
const REFUSED_LICENCE = [
  'fair use', 'fairuse', 'non-free', 'nonfree', 'all rights reserved',
  'noncommercial', 'non-commercial', 'no derivative', 'noderiv',
  'permission', 'used with', 'copyrighted',
];

/**
 * Licences this app will display under, by their Commons short name.
 *
 * An allowlist, not a blocklist. A licence nobody here recognised is not a
 * licence somebody here checked, and the honest response to "we do not know
 * what this permits" is to show no photograph rather than to show one and
 * hope. That is the same rule `usageToday` follows for an unreachable counter
 * and `openingWindow` follows for unparsed hours.
 */
const FREE_LICENCE_PREFIXES = [
  'cc0', 'cc by', 'cc-by', 'cc sa', 'cc-sa', 'public domain', 'pd', 'gfdl',
  'attribution', 'no restrictions',
];

/**
 * The Creative Commons restriction codes, as they appear inside a short name.
 *
 * `CC BY-NC 3.0` spells out none of the phrases in {@link REFUSED_LICENCE} —
 * it carries the restriction as two letters — and it starts with `cc by`, so
 * the phrase list alone admits exactly the licences it exists to exclude.
 * Matched as whole tokens rather than as substrings: `nd` appears inside
 * plenty of ordinary words, and `CC BY-SA` must not be refused for containing
 * neither.
 */
const REFUSED_LICENCE_CODES = new Set(['nc', 'nd']);

/**
 * The licence to display under, or nothing at all.
 *
 * Refusals are checked first and across every field, including `UsageTerms`
 * and `Restrictions`, because the short name is the field most likely to look
 * clean while another field carries the catch.
 */
export function licenceForDisplay(metadata: CommonsMetadata): { licence: string; licenceUrl?: string } | undefined {
  const shortName = metadata.licenceShortName?.trim();
  const haystack = [shortName, metadata.usageTerms, metadata.restrictions]
    .filter((field): field is string => Boolean(field))
    .join(' ')
    .toLowerCase();
  if (!shortName) return undefined;
  // `CC BY-NC` contains "cc by", so the refusal has to run first or the
  // allowlist would admit exactly the licences this list exists to exclude.
  if (REFUSED_LICENCE.some((phrase) => haystack.includes(phrase))) return undefined;

  const normalised = shortName.toLowerCase().replace(/\s+/g, ' ').trim();
  // Tokenised on the short name only. The codes are two letters, and scanning
  // free prose for them would refuse a licence because a sentence beside it
  // happened to contain the word "and".
  if (normalised.split(/[^a-z0-9]+/).some((token) => REFUSED_LICENCE_CODES.has(token))) return undefined;

  if (!FREE_LICENCE_PREFIXES.some((prefix) => normalised.startsWith(prefix))) return undefined;

  return {
    licence: shortName,
    licenceUrl: metadata.licenceUrl && /^https:\/\//i.test(metadata.licenceUrl) ? metadata.licenceUrl : undefined,
  };
}

/** Credit lines longer than this are a template's paragraph, not a name. */
const MAX_AUTHOR_LENGTH = 80;

/**
 * The one line shown under the photograph.
 *
 * CC BY and CC BY-SA require the author be named, so this is a licence
 * obligation rather than a nicety. When the author field is absent or is
 * plainly a template's prose rather than a name, the line falls back to
 * Wikimedia Commons and the card links the file page, which carries the full
 * attribution — the standard practice, and honest about what is known.
 */
export function attributionFor(author: string | undefined, licence: string): string {
  const name = author && author.length <= MAX_AUTHOR_LENGTH ? author : undefined;
  return name ? `${name} · ${licence} · Wikimedia Commons` : `${licence} · Wikimedia Commons`;
}

/** The Commons file page for a title, which is where the licence really lives. */
export function commonsFilePage(title: string): string {
  return `https://commons.wikimedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
}

/**
 * A validated `PlaceImage`, or nothing.
 *
 * Every refusal here is a photograph not shown, which is always the safe
 * outcome: a card without a picture is a card, and a card with somebody's
 * unlicensed photograph on it is a problem.
 */
export function buildPlaceImage(input: {
  title: string;
  lead: ImageLead['kind'];
  url?: string;
  thumbnailUrl?: string;
  width?: number;
  height?: number;
  descriptionUrl?: string;
  metadata: CommonsMetadata;
}): PlaceImage | undefined {
  const url = wikimediaImageUrl(input.url);
  if (!url) return undefined;
  const licence = licenceForDisplay(input.metadata);
  if (!licence) return undefined;

  const author = input.metadata.artist || input.metadata.credit;
  const size = (value: number | undefined) => (
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : undefined
  );

  return {
    url,
    thumbnailUrl: wikimediaImageUrl(input.thumbnailUrl),
    width: size(input.width),
    height: size(input.height),
    source: 'wikimedia-commons',
    sourcePage: input.descriptionUrl && /^https:\/\//i.test(input.descriptionUrl)
      ? input.descriptionUrl
      : commonsFilePage(input.title),
    author,
    licence: licence.licence,
    licenceUrl: licence.licenceUrl,
    attribution: attributionFor(author, licence.licence),
    lead: input.lead,
  };
}

/**
 * Re-validate a photograph that has crossed the network or come back out of
 * jsonb.
 *
 * Not a second licence check — the licence text is not here — but a shape and
 * host check, so a malformed or hostile row degrades to no photograph rather
 * than to an `<img>` pointing wherever the row said. The cache column can hold
 * whatever an older or newer writer put there, which is the same reasoning
 * behind `parseAppliesTo`.
 */
export function parsePlaceImage(value: unknown): PlaceImage | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const text = (field: unknown) => (typeof field === 'string' && field.trim() ? field.trim() : undefined);
  const number = (field: unknown) => (
    typeof field === 'number' && Number.isFinite(field) && field > 0 ? Math.round(field) : undefined
  );

  const url = wikimediaImageUrl(text(raw.url));
  const licence = text(raw.licence);
  if (!url || !licence) return undefined;

  const lead = text(raw.lead);
  const sourcePage = text(raw.sourcePage);
  const author = text(raw.author);

  return {
    url,
    thumbnailUrl: wikimediaImageUrl(text(raw.thumbnailUrl)),
    width: number(raw.width),
    height: number(raw.height),
    source: 'wikimedia-commons',
    sourcePage: sourcePage && /^https:\/\//i.test(sourcePage) ? sourcePage : 'https://commons.wikimedia.org/',
    author,
    licence,
    licenceUrl: text(raw.licenceUrl) && /^https:\/\//i.test(String(raw.licenceUrl)) ? text(raw.licenceUrl) : undefined,
    // Rebuilt rather than trusted: the stored line was composed from the
    // author and licence beside it, and a row whose credit disagrees with its
    // own licence field would be crediting the photograph wrongly.
    attribution: attributionFor(author, licence!),
    lead: lead && lead in LEAD_PRIORITY ? (lead as ImageLead['kind']) : 'commons-category',
  };
}

/** Validate a lead that arrived from a client or out of a cached candidate. */
export function parseImageLead(value: unknown): ImageLead | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as { kind?: unknown; value?: unknown };
  const kind = typeof raw.kind === 'string' && raw.kind in LEAD_PRIORITY
    ? (raw.kind as ImageLead['kind'])
    : undefined;
  const text = typeof raw.value === 'string' ? raw.value.trim() : '';
  // Bounded: these become API query parameters, and an unbounded string from a
  // client is a request this server would build on somebody else's behalf.
  if (!kind || !text || text.length > 300) return undefined;

  if (kind === 'wikidata') {
    const id = parseWikidataId(text);
    return id ? { kind, value: id } : undefined;
  }
  if (kind === 'wikipedia') {
    return parseWikipediaLead(text) ? { kind, value: text } : undefined;
  }
  const title = normaliseCommonsTitle(text, kind === 'commons-file' ? 'File' : 'Category');
  return title ? { kind, value: title } : undefined;
}

// ---------------------------------------------------------------------------
// Identity validation
//
// A Wikidata id on an OSM object names *an* entity, not necessarily the place
// the traveller is looking at. Production produced three shapes of that error:
// the tag pointed at a retail company and returned its Tokyo flagship for a
// Fukuoka branch; it pointed at an idol group and returned a concert photo for
// a theatre; and it pointed at the right place but the entity's picture was a
// placeholder icon rather than a photograph. All three passed the licence gate,
// because a correctly licensed photograph of the wrong subject is still
// correctly licensed.
//
// The rules below come from measuring 135 resolved images across six cities
// rather than from intuition, and each one is tied to a case that occurred.
// ---------------------------------------------------------------------------

/**
 * Bumped whenever the rules here change what counts as a valid image.
 *
 * v2 gated Wikidata leads. v3 extends the same gate to Wikipedia article
 * images, which were previously trusted implicitly — a hole wide enough that a
 * refused entity's own article still supplied its picture.
 *
 * Cached rows carry the version they were accepted under, so tightening the
 * policy retires every decision made under a looser one without deleting
 * anything. An unstamped legacy row is treated as version 1.
 */
export const PLACE_IMAGE_VALIDATION_VERSION = 3;

/**
 * How far a Wikidata entity may sit from the candidate and still be the same
 * place.
 *
 * Measured: 91 coordinate-bearing entities across five cities put the median at
 * 20 m, the 95th percentile at 220 m, and the largest legitimate match at
 * 1.685 km — Bugaksan, a mountain whose entity is a centroid and whose
 * candidate is a trailhead. The only violation was a Singapore department store
 * matched to its Tokyo namesake, 4,952 km away. 2 km keeps every legitimate
 * match observed and rejects the mismatch by three orders of magnitude.
 */
export const MAX_ENTITY_DISTANCE_KM = 2;

/**
 * Direct `P31` values that cannot be a physical destination.
 *
 * Deliberately small and deliberately *direct*: no subclass traversal, because
 * walking Wikidata's ontology to decide "place-ness" would reject far more than
 * it fixes and would be impossible to reason about from a test. Every id here
 * is one an actual production mismatch resolved through, and none of them
 * appear on the legitimate coordinate-less entities in the same sample (a
 * church building, a kilometre-zero marker), which is what makes the list safe.
 */
export const NON_PLACE_INSTANCE_OF: ReadonlySet<string> = new Set([
  'Q4830453',    // business — Marui, Isetan, Daimaru
  'Q641066',     // girl group — HKT48, NMB48
  'Q15056993',   // aircraft family — six War Memorial exhibits
  'Q18487018',   // missile family — Scud-B
  'Q18487055',   // surface-to-air missile model — Nike-Hercules
  'Q100710213',  // tank model — Type 63, SU-100, Type 59, M46
  'Q100709275',  // self-propelled artillery model — M107
]);

export type ImageRejectionReason =
  | 'wikidata_coordinate_mismatch'
  | 'wikidata_non_place_entity'
  | 'non_photographic_asset';

export type ImageValidation = { ok: true } | { ok: false; reason: ImageRejectionReason };

/** Facts read from the same `wbgetentities` response that supplies `P18`. */
export interface WikidataEntityFacts {
  /** Commons file title from `P18`, when the entity names one. */
  title?: string;
  /** `P625` coordinate location, when the entity carries one. */
  lat?: number;
  lng?: number;
  /** Direct `P31` values, unresolved and uncrawled. */
  instanceOf: string[];
}

/** Great-circle distance in kilometres. */
export function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = Math.PI / 180;
  const dLat = (bLat - aLat) * toRad;
  const dLng = (bLng - aLng) * toRad;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(aLat * toRad) * Math.cos(bLat * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/**
 * Whether a Wikidata entity may speak for this candidate.
 *
 * Coordinates decide it whenever the entity has them, because proximity is a
 * statement about the same physical location and entity type is only a proxy
 * for one. The type check exists solely for entities that carry no coordinates,
 * where there is nothing to compare — and it only refuses on a known-bad type,
 * never on an unrecognised one, so an incomplete entity keeps its photograph.
 */
export function validateEntityForPlace(
  facts: WikidataEntityFacts,
  candidate: { lat?: number; lng?: number } | undefined,
): ImageValidation {
  if (typeof facts.lat === 'number' && typeof facts.lng === 'number') {
    // Without candidate coordinates there is nothing to compare against, and
    // refusing here would punish places for a gap in our own record.
    if (typeof candidate?.lat !== 'number' || typeof candidate?.lng !== 'number') return { ok: true };
    return distanceKm(candidate.lat, candidate.lng, facts.lat, facts.lng) > MAX_ENTITY_DISTANCE_KM
      ? { ok: false, reason: 'wikidata_coordinate_mismatch' }
      : { ok: true };
  }

  return facts.instanceOf.some((id) => NON_PLACE_INSTANCE_OF.has(id))
    ? { ok: false, reason: 'wikidata_non_place_entity' }
    : { ok: true };
}

/**
 * Files that are not photographs of anything.
 *
 * The card's slot promises a picture of the place, so a placeholder glyph or a
 * logo is a broken promise even though it is a valid, freely licensed file.
 * Matched on the file title because that is all this layer holds, and kept to
 * unambiguous names — `Gthumb.svg` shipped to two Fukuoka shrines.
 */
const NON_PHOTOGRAPHIC_TITLE = /(^|[\s_-])(gthumb|no[\s_-]?image|placeholder|blank|icon|logo|flag|coat[\s_-]of[\s_-]arms|wappen|map|diagram|plan)([\s_-]|\.|$)/i;

export function isNonPhotographicAsset(fileTitle: string): boolean {
  const title = fileTitle.replace(/^File:/i, '').trim();
  // Vector art is illustration, not photography. Commons photographs are
  // raster; an SVG in a photo slot has always been a symbol so far.
  if (/\.svg$/i.test(title)) return true;
  return NON_PHOTOGRAPHIC_TITLE.test(title);
}
