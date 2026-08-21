/**
 * A signature is not a fact.
 *
 * `askPlaceToken` proves this server issued a triple. This layer answers the
 * larger question — is it still true, and what is the place actually called —
 * and the tests that matter are the ones where a perfectly valid token must
 * still be refused.
 */
import { describe, expect, it } from 'vitest';
import { signAskPlaceRef } from './askPlaceToken';
import {
  latestTurnPlaceTokens,
  presentRecentPlaces,
  resolveRecentTrustedPlaces,
} from './askRecentPlaces';
import type { ConversationTurn } from './intelligenceContext';

const SECRET = 'a'.repeat(48);
const USER = 'user-1';
const TRIP = 'trip-tokyo';

interface Row { provider: string; provider_place_id: string; canonical_place_id: string }
interface Record_ { id: string; primary_name: string; city?: string; neighbourhood?: string }

/**
 * The two tables this layer reads, and nothing else. Built to match what
 * `readPlaceProviderLinks` and `readCanonicalPlaceRecords` actually query.
 */
const clientWith = (options: { links?: Row[]; places?: Record_[] } = {}) => ({
  from: (table: string) => ({
    select: () => ({
      in: async () => ({
        data: table === 'place_provider_links'
          ? options.links ?? []
          : (options.places ?? []).map((place) => ({
            id: place.id,
            primary_name: place.primary_name,
            city: place.city ?? null,
            neighbourhood: place.neighbourhood ?? null,
            latitude: null,
            longitude: null,
          })),
        error: null,
      }),
    }),
  }),
}) as unknown as Parameters<typeof resolveRecentTrustedPlaces>[0]['client'];

const gyoen = { provider: 'osm', providerPlaceId: 'n1', canonicalPlaceId: 'canon-gyoen' };
const ameya = { provider: 'osm', providerPlaceId: 'n2', canonicalPlaceId: 'canon-ameya' };

const linkRow = (place: typeof gyoen): Row => ({
  provider: place.provider,
  provider_place_id: place.providerPlaceId,
  canonical_place_id: place.canonicalPlaceId,
});

const tokenFor = (place: typeof gyoen, over: { userId?: string; tripId?: string } = {}) =>
  signAskPlaceRef(SECRET, {
    userId: over.userId ?? USER,
    tripId: over.tripId ?? TRIP,
    ...place,
  }) as Promise<string>;

const healthyClient = () => clientWith({
  links: [linkRow(gyoen), linkRow(ameya)],
  places: [
    { id: 'canon-gyoen', primary_name: 'Shinjuku Gyoen', city: 'Tokyo', neighbourhood: 'Shinjuku' },
    { id: 'canon-ameya', primary_name: 'Ameya-Yokocho', city: 'Tokyo', neighbourhood: 'Ueno' },
  ],
});

const resolve = (tokens: string[], client = healthyClient()) => resolveRecentTrustedPlaces({
  client, secret: SECRET, tokens, userId: USER, tripId: TRIP,
});

describe('which tokens a follow-up may act on', () => {
  const turn = (over: Partial<ConversationTurn>): ConversationTurn => ({
    question: 'q', answer: 'a', ...over,
  });

  /**
   * "The second one" means the second place in the answer directly above the
   * question. Reaching further back would make the phrase genuinely ambiguous.
   */
  it('takes the most recent card-bearing answer, not every answer', () => {
    expect(latestTurnPlaceTokens([
      turn({ trustedPlaceTokens: ['old-1', 'old-2'] }),
      turn({ trustedPlaceTokens: ['new-1'] }),
    ])).toEqual(['new-1']);
  });

  it('looks past turns that showed no cards', () => {
    expect(latestTurnPlaceTokens([
      turn({ trustedPlaceTokens: ['a', 'b'] }),
      turn({}),
    ])).toEqual(['a', 'b']);
  });

  it('is empty when nothing was ever carded', () => {
    expect(latestTurnPlaceTokens([turn({}), turn({})])).toEqual([]);
  });

  it('never carries more than one answer could have shown', () => {
    const many = Array.from({ length: 9 }, (_, index) => `t${index}`);
    expect(latestTurnPlaceTokens([turn({ trustedPlaceTokens: many })])).toHaveLength(5);
  });
});

describe('re-establishing a place', () => {
  it('accepts a token whose link still agrees, and names it from the record', async () => {
    const result = await resolve([await tokenFor(gyoen)]);
    expect(result.places).toEqual([expect.objectContaining({
      alias: 'recent-place-1',
      canonicalPlaceId: 'canon-gyoen',
      providerPlaceId: 'n1',
      name: 'Shinjuku Gyoen',
      city: 'Tokyo',
      area: 'Shinjuku',
    })]);
  });

  it('numbers aliases in the order the cards were shown', async () => {
    const result = await resolve([await tokenFor(ameya), await tokenFor(gyoen)]);
    expect(result.places.map((place) => [place.alias, place.name])).toEqual([
      ['recent-place-1', 'Ameya-Yokocho'],
      ['recent-place-2', 'Shinjuku Gyoen'],
    ]);
  });

  /**
   * F. The case a signature cannot cover. Link tables get corrected and
   * merged, so a valid token can name a relationship that no longer holds —
   * and acting on it would present yesterday's identity as today's fact.
   */
  it('refuses a valid token whose provider link now points elsewhere', async () => {
    const moved = clientWith({
      links: [{ provider: 'osm', provider_place_id: 'n1', canonical_place_id: 'canon-something-else' }],
      places: [{ id: 'canon-gyoen', primary_name: 'Shinjuku Gyoen' }],
    });
    const result = await resolve([await tokenFor(gyoen)], moved);
    expect(result.places).toEqual([]);
    expect(result.rejected).toMatchObject({ 'link-mismatch': 1 });
  });

  it('refuses a valid token whose provider link has disappeared', async () => {
    const gone = clientWith({ links: [], places: [{ id: 'canon-gyoen', primary_name: 'Shinjuku Gyoen' }] });
    const result = await resolve([await tokenFor(gyoen)], gone);
    expect(result.places).toEqual([]);
    expect(result.rejected).toMatchObject({ 'link-missing': 1 });
  });

  /** Without a canonical record there is no server-owned name to offer. */
  it('refuses a place the server cannot name', async () => {
    const nameless = clientWith({ links: [linkRow(gyoen)], places: [] });
    const result = await resolve([await tokenFor(gyoen)], nameless);
    expect(result.places).toEqual([]);
    expect(result.rejected).toMatchObject({ 'no-record': 1 });
  });

  it('rejects cross-trip and cross-user tokens before touching the database', async () => {
    const queried: string[] = [];
    const client = {
      from: (table: string) => {
        queried.push(table);
        return { select: () => ({ in: async () => ({ data: [], error: null }) }) };
      },
    } as unknown as Parameters<typeof resolveRecentTrustedPlaces>[0]['client'];
    const result = await resolveRecentTrustedPlaces({
      client,
      secret: SECRET,
      tokens: [
        await tokenFor(gyoen, { tripId: 'trip-osaka' }),
        await tokenFor(gyoen, { userId: 'user-2' }),
      ],
      userId: USER,
      tripId: TRIP,
    });
    expect(result.places).toEqual([]);
    expect(result.rejected).toMatchObject({ 'wrong-trip': 1, 'wrong-user': 1 });
    // An unverified token must never become a database query, or the origin
    // becomes a way to enumerate the link table.
    expect(queried).toEqual([]);
  });

  it('keeps the good references when one alongside them is bad', async () => {
    const result = await resolve([
      'not-a-token',
      await tokenFor(gyoen),
      await tokenFor(ameya, { tripId: 'trip-osaka' }),
    ]);
    expect(result.places.map((place) => place.name)).toEqual(['Shinjuku Gyoen']);
    expect(result.places[0].alias).toBe('recent-place-1');
  });

  /** Two cards for one place would consume two aliases and shift the ordinals. */
  it('collapses duplicates rather than spending an alias twice', async () => {
    const result = await resolve([await tokenFor(gyoen), await tokenFor(gyoen)]);
    expect(result.places).toHaveLength(1);
  });

  it('does nothing at all without a secret or a client', async () => {
    const token = await tokenFor(gyoen);
    expect((await resolveRecentTrustedPlaces({
      client: healthyClient(), secret: undefined, tokens: [token], userId: USER, tripId: TRIP,
    })).places).toEqual([]);
    expect((await resolveRecentTrustedPlaces({
      client: null, secret: SECRET, tokens: [token], userId: USER, tripId: TRIP,
    })).places).toEqual([]);
  });
});

describe('what the model is told', () => {
  /**
   * An identity and a name. Deliberately not a coordinate, an opening hour or
   * a travel time — those still require a tool call, exactly as they do for a
   * place found this turn.
   */
  it('offers an alias and a name, and no facts', async () => {
    const { places } = await resolve([await tokenFor(gyoen)]);
    const presented = presentRecentPlaces(places);
    expect(presented).toEqual([{ ref: 'recent-place-1', name: 'Shinjuku Gyoen', where: 'Shinjuku, Tokyo' }]);

    const serialised = JSON.stringify(presented);
    for (const leaked of ['canon-gyoen', 'n1', 'osm', 'latitude', 'coordinates']) {
      expect(serialised).not.toContain(leaked);
    }
  });
});
