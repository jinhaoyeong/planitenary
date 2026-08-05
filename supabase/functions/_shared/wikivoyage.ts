/**
 * Wikivoyage listing extraction.
 *
 * OSM tells us what exists; it has no opinion about what is worth a traveller's
 * afternoon. Wikivoyage does — it is human-curated, openly licensed, needs no
 * key, and structures its recommendations as templates rather than prose:
 *
 *   {{see
 *   | name=Osaka Castle | lat=34.6873 | long=135.5259
 *   | hours=09:00-17:00 | price=¥600
 *   | content=The keep is a 1931 reconstruction...
 *   }}
 *
 * That structure is why this is parseable at all, and why it is a better
 * curation source than scraping prose from a blog.
 *
 * One request per *city*, never per place. A per-place enrichment call would
 * recreate the fan-out that made the previous provider expensive.
 *
 * No imports and no Deno APIs, so the vitest suite exercises this directly.
 */

export type WikivoyageKind = 'see' | 'do' | 'eat' | 'drink' | 'buy';

export interface WikivoyageListing {
  kind: WikivoyageKind;
  name: string;
  content?: string;
  address?: string;
  coordinates?: [number, number];
  hours?: string;
  price?: string;
  url?: string;
}

/** Listing kind → the app's category vocabulary. */
export const WIKIVOYAGE_CATEGORIES: Record<WikivoyageKind, string[]> = {
  see: ['essential'],
  do: ['essential'],
  eat: ['food'],
  drink: ['evening'],
  buy: ['shopping'],
};

const KINDS: WikivoyageKind[] = ['see', 'do', 'eat', 'drink', 'buy'];

/**
 * Extract one balanced `{{...}}` block starting at `start`, which must be the
 * index of its opening brace. Returns null for an unterminated template rather
 * than consuming the rest of the page.
 */
function readTemplate(text: string, start: number): { body: string; end: number } | null {
  let depth = 0;
  for (let index = start; index < text.length - 1; index += 1) {
    if (text[index] === '{' && text[index + 1] === '{') {
      depth += 1;
      index += 1;
    } else if (text[index] === '}' && text[index + 1] === '}') {
      depth -= 1;
      index += 1;
      if (depth === 0) return { body: text.slice(start + 2, index - 1), end: index + 1 };
    }
  }
  return null;
}

/**
 * Split a template body on top-level pipes only. A pipe inside a nested
 * template or a `[[link|label]]` is part of a value, not a field separator.
 */
function splitFields(body: string): string[] {
  const fields: string[] = [];
  let depth = 0;
  let current = '';
  for (let index = 0; index < body.length; index += 1) {
    const pair = body.slice(index, index + 2);
    if (pair === '{{' || pair === '[[') { depth += 1; current += pair; index += 1; continue; }
    if (pair === '}}' || pair === ']]') { depth -= 1; current += pair; index += 1; continue; }
    if (body[index] === '|' && depth === 0) { fields.push(current); current = ''; continue; }
    current += body[index];
  }
  fields.push(current);
  return fields;
}

/** Strip the wiki markup that would otherwise reach a traveller's screen. */
export function stripWikiMarkup(value: string): string {
  return value
    // [[Article|label]] → label; [[Article]] → Article
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    // [https://example.com label] → label
    .replace(/\[(?:https?:)?\/\/\S+\s+([^\]]*)\]/g, '$1')
    .replace(/\[(?:https?:)?\/\/\S+\]/g, '')
    // Remaining templates carry no traveller-facing meaning here.
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/'''?/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const asCoordinate = (value?: string): number | undefined => {
  if (!value) return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

/**
 * Every listing on a Wikivoyage city page, in document order.
 *
 * Unnamed listings are skipped: a recommendation the traveller cannot identify
 * is not usable, and it cannot be matched against a place either.
 */
export function parseWikivoyageListings(wikitext: string, limit = 200): WikivoyageListing[] {
  const listings: WikivoyageListing[] = [];
  if (!wikitext) return listings;

  for (let index = 0; index < wikitext.length - 1 && listings.length < limit; index += 1) {
    if (wikitext[index] !== '{' || wikitext[index + 1] !== '{') continue;
    // Check the name before walking the braces. Reading every template on the
    // page to discover it is a section wrapper turns this into an O(n²) scan of
    // a document that can run to hundreds of kilobytes.
    const head = wikitext.slice(index + 2, index + 12).trim().toLowerCase();
    if (!KINDS.some((kind) => head.startsWith(kind))) continue;

    const template = readTemplate(wikitext, index);
    if (!template) break;

    const fields = splitFields(template.body);
    const kind = fields[0]?.trim().toLowerCase() as WikivoyageKind;
    if (!KINDS.includes(kind)) continue;
    index = template.end - 1;

    const values: Record<string, string> = {};
    for (const field of fields.slice(1)) {
      const split = field.indexOf('=');
      if (split === -1) continue;
      values[field.slice(0, split).trim().toLowerCase()] = field.slice(split + 1).trim();
    }

    const name = stripWikiMarkup(values.name || '');
    if (!name) continue;

    const lat = asCoordinate(values.lat);
    const lng = asCoordinate(values.long ?? values.lon);
    listings.push({
      kind,
      name,
      content: values.content ? stripWikiMarkup(values.content) : undefined,
      address: values.address ? stripWikiMarkup(values.address) : undefined,
      coordinates: lat !== undefined && lng !== undefined ? [lat, lng] : undefined,
      hours: values.hours ? stripWikiMarkup(values.hours) : undefined,
      price: values.price ? stripWikiMarkup(values.price) : undefined,
      url: values.url || undefined,
    });
  }

  return listings;
}

/**
 * Names are compared with punctuation, case, diacritics and a leading article
 * removed, because "The Ōsaka Castle" and "Osaka Castle" are the same place and
 * must not be offered to a traveller twice.
 */
export function normaliseListingName(name: string): string {
  return name
    .normalize('NFD')
    // Combining marks left behind by NFD: "Ōsaka" and "Osaka" must compare equal.
    // Written as escapes because the literal marks are invisible in an editor.
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/^(the|a|an|le|la|les|el|il)\s+/, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

/** Metres between two points. Small-angle equirectangular is ample at city scale. */
export function metresBetween(a: [number, number], b: [number, number]): number {
  const toRadians = Math.PI / 180;
  const meanLatitude = ((a[0] + b[0]) / 2) * toRadians;
  const x = (b[1] - a[1]) * toRadians * Math.cos(meanLatitude);
  const y = (b[0] - a[0]) * toRadians;
  return Math.round(Math.sqrt(x * x + y * y) * 6_371_000);
}

/**
 * Find the listing describing a place, by name first and location second.
 *
 * Proximity alone is not enough — two restaurants can share a building — so a
 * coordinate match still requires the names to be recognisably related. This
 * errs toward missing a match rather than attaching an editor's description of
 * one venue to a different one.
 */
export function matchListing(
  place: { name: string; coordinates?: [number, number] },
  listings: WikivoyageListing[],
  radiusMetres = 150,
): WikivoyageListing | undefined {
  const target = normaliseListingName(place.name);
  if (!target) return undefined;

  const exact = listings.find((listing) => normaliseListingName(listing.name) === target);
  if (exact) return exact;

  if (!place.coordinates) return undefined;
  return listings.find((listing) => {
    if (!listing.coordinates) return false;
    if (metresBetween(place.coordinates!, listing.coordinates) > radiusMetres) return false;
    const candidate = normaliseListingName(listing.name);
    return candidate.includes(target) || target.includes(candidate);
  });
}
