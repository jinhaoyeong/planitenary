/**
 * Tests for Wikivoyage listing extraction, imported straight from the Deno
 * `_shared` module — the same precedent as `cacheKeys.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import {
  matchListing,
  metresBetween,
  normaliseListingName,
  parseWikivoyageListings,
  stripWikiMarkup,
} from '../../supabase/functions/_shared/wikivoyage';
import {
  heldListingImages,
  wikivoyageImageLeads,
} from '../../supabase/functions/_shared/placeImages';

const OSAKA = `
==See==
{{see
| name=Osaka Castle | alt=大阪城 | url=https://www.osakacastle.net/
| address=1-1 Osakajo | lat=34.6873 | long=135.5259
| hours=09:00-17:00 | price=¥600
| content=The keep is a 1931 reconstruction, but the [[stonework]] is original.
}}
{{see|name=Shitennoji|lat=34.6543|long=135.5165|content=Japan's oldest temple.}}

==Eat==
{{eat
| name=Daruma | lat=34.6489 | long=135.5061
| price=¥1000 | content=Famous for '''kushikatsu'''.
}}

==Sleep==
{{sleep|name=Some Hotel|lat=34.7|long=135.5}}
`;

describe('parsing Wikivoyage listings', () => {
  const listings = parseWikivoyageListings(OSAKA);

  it('finds every recommendation kind it knows how to use', () => {
    expect(listings.map((listing) => listing.name))
      .toEqual(['Osaka Castle', 'Shitennoji', 'Daruma']);
  });

  it('ignores listing kinds the planner has no use for', () => {
    // Accommodation is chosen by the traveller, not recommended as a stop.
    expect(listings.some((listing) => listing.name === 'Some Hotel')).toBe(false);
  });

  it('keeps the structured fields an itinerary needs', () => {
    const castle = listings[0];
    expect(castle.kind).toBe('see');
    expect(castle.coordinates).toEqual([34.6873, 135.5259]);
    expect(castle.hours).toBe('09:00-17:00');
    expect(castle.price).toBe('¥600');
    expect(castle.url).toBe('https://www.osakacastle.net/');
    expect(castle.address).toBe('1-1 Osakajo');
  });

  it('returns prose a traveller can read, not wiki markup', () => {
    expect(listings[0].content).toBe('The keep is a 1931 reconstruction, but the stonework is original.');
    expect(listings[2].content).toBe('Famous for kushikatsu.');
  });

  it('handles a compact single-line listing', () => {
    expect(listings[1].coordinates).toEqual([34.6543, 135.5165]);
  });

  it('returns nothing for a page with no listings rather than throwing', () => {
    expect(parseWikivoyageListings('==See==\nJust prose, no templates.')).toEqual([]);
    expect(parseWikivoyageListings('')).toEqual([]);
  });

  it('does not hang on an unterminated template', () => {
    expect(parseWikivoyageListings('{{see|name=Broken')).toEqual([]);
  });

  it('skips a listing with no name, which could never be identified', () => {
    expect(parseWikivoyageListings('{{see|lat=1|long=2|content=Nameless}}')).toEqual([]);
  });

  it('respects the limit so a huge page cannot flood the shortlist', () => {
    const many = '{{see|name=X|lat=1|long=2}}'.repeat(50);
    expect(parseWikivoyageListings(many, 10)).toHaveLength(10);
  });
});

/**
 * The identity fields.
 *
 * These were parsed into the values map and then dropped, which is why every
 * Wikivoyage-sourced candidate reached a card with no way to find a photograph
 * of itself. Wikivoyage editors state the Wikidata item, the Wikipedia article
 * and the photograph directly on the listing; the whole coverage gap for these
 * places was that this parser did not read three keys it already had.
 */
describe('preserving a listing\'s explicit identity fields', () => {
  const [item] = parseWikivoyageListings(
    '{{see|name=Kushida Shrine|lat=33.59297|long=130.41047'
    + '|wikidata=Q865839|wikipedia=Kushida Shrine|image=Kushidajinjafukuoka01.jpg}}',
  );

  it('keeps the Wikidata item the editor wrote', () => {
    expect(item.wikidata).toBe('Q865839');
  });

  it('keeps the article title, bare, as the field states it', () => {
    // No language prefix: the field names an article on the wiki the listing
    // was read from. Supplying the prefix is `wikivoyageImageLeads`' job.
    expect(item.wikipedia).toBe('Kushida Shrine');
  });

  it('keeps the file name, bare, as the field states it', () => {
    expect(item.image).toBe('Kushidajinjafukuoka01.jpg');
  });

  it('leaves an identifier exactly as written rather than stripping markup', () => {
    // `Shōfuku-ji (Fukuoka)` is a real article title. Running an identifier
    // through the prose cleaner would quietly produce a *different*
    // identifier, which is worse than not reading the field at all.
    const [listing] = parseWikivoyageListings(
      '{{see|name=Shofukuji|lat=33.6|long=130.4|wikipedia=Shōfuku-ji (Fukuoka)}}',
    );
    expect(listing.wikipedia).toBe('Shōfuku-ji (Fukuoka)');
  });

  it('treats a blank identity field as absent', () => {
    // Wikivoyage templates ship every parameter, most of them empty: the
    // Fukuoka page has `wikidata=` on 22 listings and a value on 13.
    const [listing] = parseWikivoyageListings(
      '{{see|name=Kego Koen|lat=33.5884|long=130.3991|wikidata=|wikipedia=|image=}}',
    );
    expect(listing.wikidata).toBeUndefined();
    expect(listing.wikipedia).toBeUndefined();
    expect(listing.image).toBeUndefined();
  });

  it('ignores an identity field long enough to be a payload rather than a name', () => {
    // These become API query parameters; an unbounded one is a request this
    // app would build on a wiki editor's behalf.
    const [listing] = parseWikivoyageListings(
      `{{see|name=Huge|lat=1|long=2|image=${'a'.repeat(400)}.jpg}}`,
    );
    expect(listing.image).toBeUndefined();
  });

  it('reports nothing for a listing that states no identity at all', () => {
    const [listing] = parseWikivoyageListings('{{eat|name=ShinShin|lat=33.59271|long=130.39689}}');
    expect(listing.wikidata).toBeUndefined();
    expect(listing.wikipedia).toBeUndefined();
    expect(listing.image).toBeUndefined();
  });
});

/**
 * ACROS rooftop garden, copied verbatim from `en.wikivoyage.org/wiki/Fukuoka`
 * (See > Views, revision 5285650).
 *
 * The place that made this whole change necessary. It is a Wikivoyage-only
 * candidate — OSM has the building and the `Step Garden` way, but neither is
 * what the guidebook is recommending — so it reached the card with no leads and
 * always showed the placard, while the listing that created it had been naming
 * a photograph of itself the entire time.
 *
 * The listing states **no** Wikidata item and **no** article. That is the whole
 * point of the fixture: the file name is the only identity here, and it is
 * enough, because an editor attached it to this exact listing. Nothing in this
 * path reads `name`.
 */
describe('the ACROS rooftop garden regression', () => {
  const ACROS = `{{see
| name=ACROS rooftop garden | alt= | url= | email=
| address= | lat=33.591595 | long=130.402349 | directions=Tenjin Chuo Park
| phone= | tollfree= | fax=
| hours=09:00-18:00 (March-October), 09:00-17:00 (November-February) | price=Free
| image=Acrosfukuoka02.jpg
| lastedit=2026-05-07
| content=The ACROS building has a terraced roof that merges with the park.
}}`;
  const [listing] = parseWikivoyageListings(ACROS);

  it('is the listing it says it is', () => {
    expect(listing.name).toBe('ACROS rooftop garden');
    expect(listing.coordinates).toEqual([33.591595, 130.402349]);
  });

  it('keeps the photograph the editor attached to it', () => {
    expect(listing.image).toBe('Acrosfukuoka02.jpg');
  });

  it('turns it into the one Commons file lead, and nothing else', () => {
    expect(wikivoyageImageLeads(listing)).toEqual([
      { kind: 'commons-file', value: 'File:Acrosfukuoka02.jpg', origin: 'wikivoyage-listing' },
    ]);
  });

  it('never waits on an identity verdict, because the listing states none', () => {
    // Nothing can contradict the picture here, so there is nothing to hold it
    // for — see `heldListingImages`.
    expect(heldListingImages([{ placeId: 'wv:ACROS rooftop garden', leads: wikivoyageImageLeads(listing) }]))
      .toEqual([]);
  });
});

describe('stripping wiki markup', () => {
  it('keeps the label from a piped link', () => {
    expect(stripWikiMarkup('Visit [[Osaka Castle|the castle]] today')).toBe('Visit the castle today');
  });

  it('keeps a plain link target as text', () => {
    expect(stripWikiMarkup('Near [[Namba]]')).toBe('Near Namba');
  });

  it('keeps the label from an external link', () => {
    expect(stripWikiMarkup('See [https://example.com the site]')).toBe('See the site');
  });
});

describe('matching a place to its guidebook entry', () => {
  const listings = parseWikivoyageListings(OSAKA);

  it('matches on name regardless of case and punctuation', () => {
    expect(matchListing({ name: 'osaka castle' }, listings)?.name).toBe('Osaka Castle');
  });

  it('treats an accented and unaccented name as the same place', () => {
    expect(normaliseListingName('Ōsaka Castle')).toBe(normaliseListingName('Osaka Castle'));
  });

  it('ignores a leading article', () => {
    expect(normaliseListingName('The Louvre')).toBe(normaliseListingName('Louvre'));
  });

  it('will not attach one venue\'s description to a different one nearby', () => {
    // Two businesses can share a building; proximity alone is not identity.
    const match = matchListing(
      { name: 'Completely Different Bar', coordinates: [34.6489, 135.5061] },
      listings,
    );
    expect(match).toBeUndefined();
  });

  it('matches on proximity when the names are recognisably related', () => {
    const match = matchListing(
      { name: 'Daruma Shinsekai', coordinates: [34.6489, 135.5061] },
      listings,
    );
    expect(match?.name).toBe('Daruma');
  });

  it('does not match a related name that is far away', () => {
    expect(matchListing({ name: 'Daruma Shinsekai', coordinates: [35.6, 139.7] }, listings)).toBeUndefined();
  });

  it('needs a name to match at all', () => {
    expect(matchListing({ name: '' }, listings)).toBeUndefined();
  });
});

describe('distance', () => {
  it('measures city-scale distances closely enough to group a day', () => {
    // Osaka Castle to Shitennoji is roughly 4 km.
    const metres = metresBetween([34.6873, 135.5259], [34.6543, 135.5165]);
    expect(metres).toBeGreaterThan(3_500);
    expect(metres).toBeLessThan(4_500);
  });

  it('is zero for the same point', () => {
    expect(metresBetween([34.6873, 135.5259], [34.6873, 135.5259])).toBe(0);
  });
});
