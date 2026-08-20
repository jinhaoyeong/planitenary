/**
 * The one door every place card comes through.
 *
 * Ask and Smart Plan prove trust in completely different ways — a model's
 * choice checked against a per-turn index, or a reference the server stored
 * when discovery could prove it and re-reads from the owned trip. Past that
 * point they are the same code, which is the property worth protecting: a place
 * must not be more loosely identified on one screen than on another.
 *
 * What is tested here is the factual half. Nothing in it may resolve by name,
 * and a reference that no longer describes a real relationship must produce no
 * card at all rather than a card built on whatever the database says now.
 */
import { describe, expect, it, vi } from 'vitest';
import { resolveStructuredPlaceCards } from './placeCardResolver.ts';
import type { SupabaseClient } from '@supabase/supabase-js';

interface LinkRow { provider: string; provider_place_id: string; canonical_place_id: string }
interface PlaceRow { id: string; primary_name: string; city?: string; neighbourhood?: string; latitude?: number; longitude?: number }

/** Just enough Supabase to answer the two reads the resolver performs. */
const clientWith = (links: LinkRow[], places: PlaceRow[]): SupabaseClient => ({
  from: (table: string) => ({
    select: () => ({
      in: (_column: string, ids: string[]) => Promise.resolve({
        data: table === 'place_provider_links'
          ? links.filter((row) => ids.includes(row.provider_place_id))
          : places.filter((row) => ids.includes(row.id)),
        error: null,
      }),
    }),
  }),
} as unknown as SupabaseClient);

const GYOEN: PlaceRow = {
  id: 'c-1111', primary_name: 'Shinjuku Gyoen National Garden', city: 'Tokyo',
  neighbourhood: '新宿区', latitude: 35.6852, longitude: 139.7100,
};
const LINK: LinkRow = { provider: 'osm', provider_place_id: 'n250668618', canonical_place_id: 'c-1111' };

const photo = {
  url: 'https://upload.wikimedia.org/a/b.jpg',
  attribution: 'someone · CC BY 2.0 · Wikimedia Commons',
  sourcePage: 'https://commons.wikimedia.org/wiki/File:b.jpg',
  licence: 'CC BY 2.0',
};

const imagesReturning = (byId: Record<string, unknown[]>) =>
  vi.fn(async (name: string) => (name === 'travel-images' ? { images: byId } : {}));

describe('a trusted reference becomes a factual card', () => {
  it('resolves identity, presentation and photograph from the server alone', async () => {
    const callFunction = imagesReturning({ n250668618: [photo] });
    const cards = await resolveStructuredPlaceCards(
      clientWith([LINK], [GYOEN]),
      callFunction,
      [{ providerPlaceId: 'n250668618', extras: { decision: 'must-do' } }],
    );

    expect(cards).toHaveLength(1);
    expect(cards[0].ref).toEqual({
      canonicalPlaceId: 'c-1111', provider: 'osm', providerPlaceId: 'n250668618',
    });
    // The name comes from the canonical record, never from the caller.
    expect(cards[0].name).toBe('Shinjuku Gyoen National Garden');
    expect(cards[0].city).toBe('Tokyo');
    expect(cards[0].decision).toBe('must-do');
    expect(cards[0].image?.attribution).toContain('CC BY');

    // The image request carries identity and nothing else — no leads at all,
    // which is what keeps it free and cache-only.
    expect(callFunction).toHaveBeenCalledWith('travel-images', {
      placeIds: ['n250668618'], provider: 'osm',
    });
  });

  it('keeps the place and drops the picture when no photograph is cached', async () => {
    const cards = await resolveStructuredPlaceCards(
      clientWith([LINK], [GYOEN]),
      imagesReturning({}),
      [{ providerPlaceId: 'n250668618' }],
    );
    expect(cards).toHaveLength(1);
    expect(cards[0].image).toBeUndefined();
    expect(cards[0].name).toBe('Shinjuku Gyoen National Garden');
  });

  it('shows nothing when the image service fails outright', async () => {
    const cards = await resolveStructuredPlaceCards(
      clientWith([LINK], [GYOEN]),
      vi.fn(async () => { throw new Error('travel-images responded 503'); }),
      [{ providerPlaceId: 'n250668618' }],
    );
    // A card without a photograph is still a true card.
    expect(cards).toHaveLength(1);
    expect(cards[0].image).toBeUndefined();
  });

  it('produces no card when nothing authoritative is recorded about the place', async () => {
    const cards = await resolveStructuredPlaceCards(
      clientWith([LINK], []),
      imagesReturning({ n250668618: [photo] }),
      [{ providerPlaceId: 'n250668618' }],
    );
    expect(cards).toEqual([]);
  });

  it('produces no card when the link table cannot account for the place', async () => {
    const cards = await resolveStructuredPlaceCards(
      clientWith([], [GYOEN]),
      imagesReturning({}),
      [{ providerPlaceId: 'n250668618' }],
    );
    expect(cards).toEqual([]);
  });
});

describe('a stored reference must still be true', () => {
  it('refuses a reference whose canonical id no longer matches the link', async () => {
    /**
     * The reason Smart Plan supplies `expect` at all. Stored JSON can be
     * stale, hand-edited or corrupted, and three syntactically valid strings
     * are not a proof. If the link table now maps this provider place id
     * somewhere else, the honest answer is no card — not a card for a place
     * the traveller never decided anything about.
     */
    const cards = await resolveStructuredPlaceCards(
      clientWith([LINK], [GYOEN]),
      imagesReturning({ n250668618: [photo] }),
      [{
        providerPlaceId: 'n250668618',
        expect: { canonicalPlaceId: 'c-SOMEONE-ELSE', provider: 'osm' },
      }],
    );
    expect(cards).toEqual([]);
  });

  it('refuses a reference filed under the wrong provider', async () => {
    // ACROS again: a Wikivoyage listing linked under OSM. Asking under the
    // listing's own provenance must not resolve.
    const cards = await resolveStructuredPlaceCards(
      clientWith([LINK], [GYOEN]),
      imagesReturning({}),
      [{
        providerPlaceId: 'n250668618',
        expect: { canonicalPlaceId: 'c-1111', provider: 'wikivoyage' },
      }],
    );
    expect(cards).toEqual([]);
  });

  it('accepts a reference that still describes the same relationship', async () => {
    const cards = await resolveStructuredPlaceCards(
      clientWith([LINK], [GYOEN]),
      imagesReturning({}),
      [{
        providerPlaceId: 'n250668618',
        expect: { canonicalPlaceId: 'c-1111', provider: 'osm' },
      }],
    );
    expect(cards).toHaveLength(1);
    expect(cards[0].ref.canonicalPlaceId).toBe('c-1111');
  });
});

describe('names carry no authority here', () => {
  it('gives two same-named places their own cards, or none', async () => {
    const tullys = [
      { provider: 'osm', provider_place_id: 'n1114908651', canonical_place_id: 'c-aaa' },
    ];
    const records = [
      { id: 'c-aaa', primary_name: "Tully's Coffee", city: 'Tokyo', neighbourhood: '新宿区' },
      { id: 'c-bbb', primary_name: "Tully's Coffee", city: 'Tokyo', neighbourhood: '千代田区' },
    ];

    const cards = await resolveStructuredPlaceCards(
      clientWith(tullys, records),
      imagesReturning({}),
      [
        { providerPlaceId: 'n1114908651' },
        // Same display name, no link. It does not borrow the other's identity.
        { providerPlaceId: 'n1482079801' },
      ],
    );

    expect(cards).toHaveLength(1);
    expect(cards[0].ref).toEqual({
      canonicalPlaceId: 'c-aaa', provider: 'osm', providerPlaceId: 'n1114908651',
    });
  });

  it('has nothing to resolve without a client or a request', async () => {
    expect(await resolveStructuredPlaceCards(null, imagesReturning({}), [{ providerPlaceId: 'n1' }])).toEqual([]);
    expect(await resolveStructuredPlaceCards(clientWith([LINK], [GYOEN]), imagesReturning({}), [])).toEqual([]);
  });
});
