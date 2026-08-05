/**
 * Tests for the OpenStreetMap → PlaceCandidate mapping, imported straight from
 * the Deno `_shared` module (which has no Deno APIs) — the same precedent as
 * `cacheKeys.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import {
  isExcludedOsmPlace,
  osmCategories,
  osmElementCoordinates,
  osmIndoorOutdoor,
  osmNames,
  osmNotability,
  osmPlaceId,
  osmPriceLevel,
  osmVisitMinutes,
  parseOsmOpeningHours,
} from '../../supabase/functions/_shared/osmPlaces';

describe('categorising an OSM place', () => {
  it('reads the category from the tag rather than guessing from a name', () => {
    expect(osmCategories({ tourism: 'museum', name: 'Something Unhelpful' })).toEqual(['museum']);
  });

  it('keeps every category a place genuinely belongs to', () => {
    expect(osmCategories({ leisure: 'garden' })).toEqual(['garden', 'park']);
  });

  it('treats any historic tag as history without needing a rule per kind', () => {
    expect(osmCategories({ historic: 'castle' })).toEqual(['history']);
    expect(osmCategories({ historic: 'archaeological_site' })).toEqual(['history']);
  });

  it('counts a heritage listing as a sight even when the primary tag is ordinary', () => {
    expect(osmCategories({ building: 'yes', heritage: '2' })).toContain('history');
  });

  it('returns nothing for a place it cannot describe, rather than calling it essential', () => {
    // An unclassifiable place must be dropped, not promoted to a headline sight.
    expect(osmCategories({ name: 'Mystery' })).toEqual([]);
  });

  it('excludes infrastructure a traveller does not visit for its own sake', () => {
    expect(isExcludedOsmPlace({ tourism: 'hotel' })).toBe(true);
    expect(isExcludedOsmPlace({ amenity: 'parking' })).toBe(true);
    expect(isExcludedOsmPlace({ tourism: 'museum' })).toBe(false);
  });
});

describe('indoor and outdoor', () => {
  it('answers from the tags, which the paid path never could', () => {
    // The Google path hardcoded 'mixed' everywhere, leaving the scheduler's
    // wet-weather preference with nothing to sort by.
    expect(osmIndoorOutdoor({ tourism: 'museum' })).toBe('indoor');
    expect(osmIndoorOutdoor({ leisure: 'park' })).toBe('outdoor');
  });

  it('reads a roof as indoors when the category alone is ambiguous', () => {
    expect(osmIndoorOutdoor({ amenity: 'marketplace', covered: 'yes' })).toBe('indoor');
    expect(osmIndoorOutdoor({ amenity: 'marketplace' })).toBe('mixed');
  });
});

describe('notability as the rating substitute', () => {
  it('rates a documented place above an undocumented one', () => {
    const documented = osmNotability({ wikidata: 'Q123', wikipedia: 'en:Osaka Castle', heritage: '1' });
    expect(documented).toBeGreaterThan(osmNotability({ tourism: 'attraction' }));
  });

  it('treats an encyclopedia article as the strongest single signal', () => {
    expect(osmNotability({ wikidata: 'Q123' })).toBeGreaterThan(osmNotability({ website: 'https://x.test' }));
  });

  it('stays within 0–1 however many signals stack up', () => {
    const everything = osmNotability({
      wikidata: 'Q1', wikipedia: 'en:X', heritage: '1', tourism: 'attraction',
      'name:en': 'X', website: 'https://x.test',
    });
    expect(everything).toBeGreaterThan(0.8);
    expect(everything).toBeLessThanOrEqual(1);
  });

  it('gives an untagged place no significance rather than a default', () => {
    expect(osmNotability({ name: 'Corner shop' })).toBe(0);
  });
});

describe('names', () => {
  it('shows a readable name while keeping the local one', () => {
    expect(osmNames({ name: '大阪城', 'name:en': 'Osaka Castle' }))
      .toEqual({ name: 'Osaka Castle', localName: '大阪城' });
  });

  it('does not duplicate a name that is already in the reading language', () => {
    expect(osmNames({ name: 'Federation Square', 'name:en': 'Federation Square' }))
      .toEqual({ name: 'Federation Square', localName: undefined });
  });

  it('falls back to the only name there is', () => {
    expect(osmNames({ name: 'Plaça Reial' }).name).toBe('Plaça Reial');
  });
});

describe('opening hours', () => {
  it('reads a simple daily range', () => {
    expect(parseOsmOpeningHours('09:00-17:00')).toEqual({ opensAt: '09:00', closesAt: '17:00' });
  });

  it('reads the first range out of a day-qualified string', () => {
    expect(parseOsmOpeningHours('Mo-Fr 09:00-17:00')).toEqual({ opensAt: '09:00', closesAt: '17:00' });
  });

  it('pads a single-digit hour so times compare correctly', () => {
    expect(parseOsmOpeningHours('Mo-Su 9:30-18:00')).toEqual({ opensAt: '09:30', closesAt: '18:00' });
  });

  it('understands always open', () => {
    expect(parseOsmOpeningHours('24/7')).toEqual({ opensAt: '00:00', closesAt: '23:59' });
  });

  it('reports unknown rather than inventing a window it cannot read', () => {
    // A wrong window silently builds a plan around a closed door; an unknown
    // one is handled honestly by the scheduler.
    expect(parseOsmOpeningHours('sunrise-sunset')).toBeUndefined();
    expect(parseOsmOpeningHours('')).toBeUndefined();
    expect(parseOsmOpeningHours(undefined)).toBeUndefined();
    expect(parseOsmOpeningHours('closed')).toBeUndefined();
  });

  it('refuses a range that crosses midnight instead of inverting it', () => {
    expect(parseOsmOpeningHours('22:00-02:00')).toBeUndefined();
  });
});

describe('price and visit length', () => {
  it('records free entry, which is a real fact', () => {
    expect(osmPriceLevel({ fee: 'no' })).toBe(0);
  });

  it('does not turn "costs something" into a price level', () => {
    expect(osmPriceLevel({ fee: 'yes' })).toBeUndefined();
  });

  it('budgets for the most demanding category a place belongs to', () => {
    expect(osmVisitMinutes(['view', 'museum'])).toBe(120);
  });

  it('falls back to a plain default for an unmapped category', () => {
    expect(osmVisitMinutes(['unheard-of'])).toBe(90);
  });
});

describe('element identity', () => {
  it('uses the centroid for ways and relations', () => {
    expect(osmElementCoordinates({ type: 'way', id: 1, center: { lat: 1.5, lon: 2.5 } })).toEqual([1.5, 2.5]);
  });

  it('has no coordinates when the element carries none', () => {
    expect(osmElementCoordinates({ type: 'relation', id: 9 })).toBeUndefined();
  });

  it('keeps node, way and relation ids distinct', () => {
    expect(osmPlaceId({ type: 'node', id: 7 })).toBe('n7');
    expect(osmPlaceId({ type: 'way', id: 7 })).toBe('w7');
    expect(osmPlaceId({ type: 'node', id: 7 })).not.toBe(osmPlaceId({ type: 'way', id: 7 }));
  });
});
