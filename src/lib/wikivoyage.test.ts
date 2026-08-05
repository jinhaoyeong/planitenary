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
