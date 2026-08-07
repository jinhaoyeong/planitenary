/**
 * Tests for the OpenStreetMap → PlaceCandidate mapping, imported straight from
 * the Deno `_shared` module (which has no Deno APIs) — the same precedent as
 * `cacheKeys.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import {
  isExcludedOsmPlace,
  osmCategories,
  osmDietaryOptions,
  osmElementCoordinates,
  osmIndoorOutdoor,
  osmNames,
  osmNotability,
  osmOpeningCaveats,
  osmPlaceId,
  osmPriceLevel,
  osmVisitMinutes,
  parseOsmOpeningRules,
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
  /** Weekdays a rule set says the place is open, as Date.getDay() values. */
  const openDays = (value: string) =>
    parseOsmOpeningRules(value).flatMap((rule) => rule.daysOfWeek).sort((a, b) => a - b);

  it('applies an unqualified range to every day', () => {
    expect(parseOsmOpeningRules('09:00-17:00')).toEqual([
      { daysOfWeek: [0, 1, 2, 3, 4, 5, 6], opensAt: '09:00', closesAt: '17:00' },
    ]);
  });

  it('keeps a weekday range to its weekdays', () => {
    expect(openDays('Mo-Fr 09:00-17:00')).toEqual([1, 2, 3, 4, 5]);
  });

  it('knows a museum shut on Mondays is shut on Mondays', () => {
    // The bug this whole change exists for: `Tu-Su` used to read as open all
    // week, and a Monday was planned around a locked door.
    expect(openDays('Tu-Su 10:00-18:00')).toEqual([0, 2, 3, 4, 5, 6]);
  });

  it('lets a later rule close a day an earlier rule opened', () => {
    expect(openDays('Mo-Su 09:00-18:00; Mo off')).toEqual([0, 2, 3, 4, 5, 6]);
    expect(openDays('Mo-Su 09:00-18:00; We closed')).toEqual([0, 1, 2, 4, 5, 6]);
  });

  it('reads different hours on different days', () => {
    const rules = parseOsmOpeningRules('Mo-Fr 09:00-17:00; Sa 10:00-14:00');
    expect(rules).toHaveLength(2);
    expect(rules.find((rule) => rule.daysOfWeek.includes(6))).toMatchObject({ opensAt: '10:00', closesAt: '14:00' });
    expect(rules.find((rule) => rule.daysOfWeek.includes(1))).toMatchObject({ opensAt: '09:00', closesAt: '17:00' });
    // Sunday appears in neither rule, so the place is closed then.
    expect(openDays('Mo-Fr 09:00-17:00; Sa 10:00-14:00')).not.toContain(0);
  });

  it('handles a comma-separated day list', () => {
    expect(openDays('Mo,We,Fr 09:00-17:00')).toEqual([1, 3, 5]);
  });

  it('walks a range that wraps the week', () => {
    expect(openDays('Fr-Mo 10:00-16:00')).toEqual([0, 1, 5, 6]);
  });

  it('pads a single-digit hour so times compare correctly', () => {
    expect(parseOsmOpeningRules('Mo-Su 9:30-18:00')[0]).toMatchObject({ opensAt: '09:30', closesAt: '18:00' });
  });

  it('understands always open', () => {
    expect(parseOsmOpeningRules('24/7')).toEqual([
      { daysOfWeek: [0, 1, 2, 3, 4, 5, 6], opensAt: '00:00', closesAt: '23:59' },
    ]);
  });

  it('skips public holidays rather than applying them to a weekday', () => {
    // The planner has no holiday calendar, so PH must not become a weekly rule.
    expect(openDays('Mo-Su 09:00-17:00; PH off')).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('reports nothing rather than inventing a window it cannot read', () => {
    // A wrong window silently builds a plan around a closed door; no window is
    // handled honestly by the scheduler as "hours unknown".
    expect(parseOsmOpeningRules('sunrise-sunset')).toEqual([]);
    expect(parseOsmOpeningRules('')).toEqual([]);
    expect(parseOsmOpeningRules(undefined)).toEqual([]);
    expect(parseOsmOpeningRules('closed')).toEqual([]);
  });

  it('refuses a range that crosses midnight instead of inverting it', () => {
    expect(parseOsmOpeningRules('22:00-02:00')).toEqual([]);
  });
});

describe('stating what the hours parser dropped', () => {
  /**
   * Every case above where the parser correctly refuses to guess leaves the
   * traveller with a confident-looking weekly schedule that quietly omits a
   * clause the venue did publish. These turn each silent drop into a sentence.
   */
  const caveatText = (value?: string) => osmOpeningCaveats(value).join(' ');

  it('says nothing at all about an ordinary weekly schedule', () => {
    // A caveat on every place would be noise, and noise gets ignored — which
    // would cost us the cases that matter.
    expect(osmOpeningCaveats('Tu-Su 10:00-18:00')).toEqual([]);
    expect(osmOpeningCaveats('24/7')).toEqual([]);
    expect(osmOpeningCaveats(undefined)).toEqual([]);
    expect(osmOpeningCaveats('  ')).toEqual([]);
  });

  it('warns when holiday hours were published but not read', () => {
    expect(caveatText('Mo-Su 09:00-17:00; PH off')).toMatch(/holiday/i);
    expect(caveatText('Mo-Su 09:00-17:00; SH 10:00-14:00')).toMatch(/holiday/i);
  });

  it('warns when the hours vary by season', () => {
    expect(caveatText('Apr-Oct 09:00-18:00; Nov-Mar 09:00-16:00')).toMatch(/season/i);
  });

  it('warns when opening follows the sun', () => {
    expect(caveatText('sunrise-sunset')).toMatch(/sunrise or sunset/i);
  });

  it('warns when a place stays open past midnight', () => {
    // For a bar or a night market this is the only window that matters, and it
    // is precisely the one the parser drops.
    expect(caveatText('Fr-Sa 22:00-02:00')).toMatch(/past midnight/i);
    // A normal same-day range must not trip it.
    expect(caveatText('Mo-Su 10:00-18:00')).not.toMatch(/past midnight/i);
  });

  it('reports several gaps at once when a string has several', () => {
    expect(osmOpeningCaveats('Apr-Oct 22:00-02:00; PH off').length).toBeGreaterThanOrEqual(3);
  });
});

describe('dietary options', () => {
  it('records only a firm answer', () => {
    expect(osmDietaryOptions({ 'diet:vegetarian': 'yes', 'diet:vegan': 'only' }).sort())
      .toEqual(['vegan', 'vegetarian']);
  });

  it('ignores "limited", which a traveller cannot plan around', () => {
    // One dish on a twenty-dish menu is not catering for a dietary need, and
    // reporting it as such is worse than saying nothing.
    expect(osmDietaryOptions({ 'diet:vegan': 'limited' })).toEqual([]);
    expect(osmDietaryOptions({ 'diet:halal': 'no' })).toEqual([]);
  });

  it('says nothing when nobody has tagged it', () => {
    expect(osmDietaryOptions({ amenity: 'restaurant' })).toEqual([]);
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
