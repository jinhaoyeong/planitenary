/**
 * The bridge between what a traveller types and what a mapper wrote.
 *
 * A price question names an attraction in English. OpenStreetMap frequently
 * names the object in the local script — Tokyo Disneyland is
 * 東京ディズニーランド — so requiring the primary name to equal the query
 * resolved nothing, and a real attraction looked like an unknown place.
 *
 * The bridge has to be an assertion by the same source that named the object,
 * never a similarity score: these aliases *accept* an identity for pricing, so
 * a wrong one prices the wrong attraction. Everything here is a tag a mapper
 * published for that specific object.
 */
import { describe, expect, it } from 'vitest';
import { osmAliasNames, osmNames } from '../../supabase/functions/_shared/osmPlaces';

describe('the names an object authoritatively answers to', () => {
  it('bridges a localised primary name to its published English name', () => {
    const tags = { name: '東京ディズニーランド', 'name:en': 'Tokyo Disneyland' };
    expect(osmAliasNames(tags)).toContain('Tokyo Disneyland');
    expect(osmAliasNames(tags)).toContain('東京ディズニーランド');
    // And the display name a traveller reads is still the English one.
    expect(osmNames(tags).name).toBe('Tokyo Disneyland');
  });

  it('reads official, international and short names when a mapper published them', () => {
    const aliases = osmAliasNames({
      name: 'ユニバーサル・スタジオ・ジャパン',
      'name:en': 'Universal Studios Japan',
      official_name: 'Universal Studios Japan',
      int_name: 'Universal Studios Japan',
      short_name: 'USJ',
    });
    expect(aliases).toContain('Universal Studios Japan');
    expect(aliases).toContain('USJ');
    // Deduplicated: three tags carrying the same string yield one entry.
    expect(aliases.filter((entry) => entry === 'Universal Studios Japan')).toHaveLength(1);
  });

  it('splits the semicolon list OSM packs into alt_name', () => {
    const aliases = osmAliasNames({ name: 'Tokyo Disneyland', alt_name: 'TDL;Disneyland Tokyo' });
    expect(aliases).toContain('TDL');
    expect(aliases).toContain('Disneyland Tokyo');
  });

  /**
   * A nickname is a colloquialism, not an identity. Admitting `loc_name` or
   * `nickname` would let an informal name select a place to be priced, which
   * is the failure mode this whole path is built to avoid.
   */
  it('refuses nickname tags, which are not identity', () => {
    const aliases = osmAliasNames({ name: 'Tokyo Disneyland', loc_name: 'The Mouse', nickname: 'Nezumi' });
    expect(aliases).toEqual(['Tokyo Disneyland']);
  });

  it('is bounded, and drops empty or oversized entries', () => {
    const aliases = osmAliasNames({ name: 'A', alt_name: `;;${'x'.repeat(400)};Real Name;` });
    expect(aliases).toContain('Real Name');
    expect(aliases.every((entry) => entry.length <= 160 && entry.length > 0)).toBe(true);
    expect(aliases.length).toBeLessThanOrEqual(12);
  });

  it('yields nothing for an object with no name at all', () => {
    expect(osmAliasNames({ tourism: 'attraction' })).toEqual([]);
  });
});
