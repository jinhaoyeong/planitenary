import { describe, expect, it } from 'vitest';
import type { DiscoveryCandidateLike } from '../../supabase/functions/_shared/discoveryPlan';
import {
  buildDiscoveryQueryPlan,
  buildExactDiscoveryQueryPlan,
  queryForCandidate,
  selectDiscoveryEntries,
} from '../../supabase/functions/_shared/discoveryPlan';

const candidate = (
  id: string,
  categories: string[],
  overrides: Partial<DiscoveryCandidateLike> = {},
): DiscoveryCandidateLike => ({
  id,
  providerPlaceId: id,
  provider: 'google',
  categories,
  experienceTags: categories,
  ...overrides,
});

const entriesFor = (
  candidates: DiscoveryCandidateLike[],
  plan: ReturnType<typeof buildDiscoveryQueryPlan>,
) => candidates.flatMap((place) => {
  const query = queryForCandidate(place, plan);
  return query ? [{ candidate: place, query }] : [];
});

describe('preference-first discovery plans', () => {
  it('preserves exact identity candidates without applying Browse taxonomy gates', () => {
    const plan = buildExactDiscoveryQueryPlan('Universal Studios Japan', 5);
    const weaklyTagged = candidate('google:usj', ['amusement-park'], { notability: undefined, rating: undefined });
    const selected = selectDiscoveryEntries([
      { candidate: weaklyTagged, query: plan.preferredQueries[0] },
    ], plan, 5);

    expect(plan.mode).toBe('exact');
    expect(plan.preferredQueries[0].text).toBe('Universal Studios Japan');
    expect(selected).toEqual([{
      candidate: weaklyTagged,
      trace: { matchedQueryGroup: 'exact-place-name' },
    }]);
  });

  it('maps the real Trip Setup ids and excludes culture groups for food/shopping/nature', () => {
    const plan = buildDiscoveryQueryPlan(['street-food', 'shopping', 'nature'], 25);

    expect(plan.mode).toBe('preference-first');
    expect(plan.preferredQueries.map((query) => query.id)).toEqual(['food', 'shopping', 'nature']);
    expect(plan.preferredQueries.flatMap((query) => query.matchedStyles)).toEqual([
      'street-food',
      'shopping',
      'nature',
    ]);
    expect(plan.preferredQueries.map((query) => query.id)).not.toEqual(expect.arrayContaining(['museums', 'heritage']));
    expect(plan.fallbackQueries.map((query) => query.id)).toEqual(['general']);
    expect(plan.fallbackLimit).toBe(5);
  });

  it('keeps a Tokyo-sized preferred pool ahead of bounded general fallback', () => {
    const plan = buildDiscoveryQueryPlan(['street-food', 'shopping', 'nature'], 25, { hiddenGems: true });
    const preferred = Array.from({ length: 20 }, (_, index) => candidate(
      `preferred-${index}`,
      index % 3 === 0 ? ['food', 'market'] : index % 3 === 1 ? ['shopping'] : ['park', 'nature'],
    ));
    const generic = Array.from({ length: 10 }, (_, index) => candidate(
      `fallback-${index}`,
      [['museum'], ['temple'], ['theatre'], ['church']][index % 4],
      { notability: 0.8 },
    ));

    const selected = selectDiscoveryEntries([...entriesFor(preferred, plan), ...entriesFor(generic, plan)], plan, 25);
    const fallback = selected.filter(({ trace }) => trace.fallbackReason);

    expect(selected).toHaveLength(25);
    expect(fallback).toHaveLength(5);
    expect(fallback.every(({ trace }) => trace.fallbackReason === 'bounded-general-fallback')).toBe(true);
    expect(selected.filter(({ trace }) => trace.matchedStyle).length).toBe(20);
  });

  it('makes culture/history preferences select museums and heritage before fallback', () => {
    const plan = buildDiscoveryQueryPlan(['museums', 'temples', 'history'], 25);
    const culture = Array.from({ length: 20 }, (_, index) => candidate(
      `culture-${index}`,
      index % 2 === 0 ? ['museum', 'art'] : ['temple', 'history'],
    ));
    const genericFood = Array.from({ length: 5 }, (_, index) => candidate(
      `food-${index}`,
      ['food', 'market'],
      { notability: 0.8 },
    ));

    const selected = selectDiscoveryEntries([...entriesFor(culture, plan), ...entriesFor(genericFood, plan)], plan, 25);

    expect(selected).toHaveLength(25);
    expect(selected.filter(({ trace }) => trace.matchedStyle).length).toBe(20);
    expect(selected.slice(0, 20).every(({ trace }) => ['museums', 'temples', 'history'].includes(trace.matchedStyle || ''))).toBe(true);
  });

  it('keeps food-heavy discovery ahead of museum fallback', () => {
    const plan = buildDiscoveryQueryPlan(['cafes', 'street-food'], 25);
    const food = Array.from({ length: 20 }, (_, index) => candidate(`food-${index}`, ['food', 'market']));
    const museums = Array.from({ length: 5 }, (_, index) => candidate(
      `museum-${index}`,
      index % 2 === 0 ? ['museum'] : ['theatre'],
      { notability: 0.9 },
    ));
    const selected = selectDiscoveryEntries([...entriesFor(food, plan), ...entriesFor(museums, plan)], plan, 25);

    expect(selected.filter(({ trace }) => trace.matchedStyle === 'cafes' || trace.matchedStyle === 'street-food')).toHaveLength(20);
    expect(selected.filter(({ trace }) => trace.fallbackReason)).toHaveLength(5);
  });

  it('uses an explicit general mode when no styles are selected', () => {
    const plan = buildDiscoveryQueryPlan([], 10);
    const candidates = [
      ...Array.from({ length: 5 }, (_, index) => candidate(`general-${index}`, ['essential'], { notability: 0.8 })),
      ...Array.from({ length: 5 }, (_, index) => candidate(`food-${index}`, ['food'], { notability: 0.8 })),
    ];
    const selected = selectDiscoveryEntries(entriesFor(candidates, plan), plan, 10);

    expect(plan.mode).toBe('general');
    expect(plan.fallbackLimit).toBe(10);
    expect(selected).toHaveLength(10);
    expect(selected.every(({ trace }) => trace.fallbackReason === 'no-preferences')).toBe(true);
  });

  it('records a sparse destination when fallback must exceed twenty percent', () => {
    const plan = buildDiscoveryQueryPlan(['nature'], 10);
    const preferred = Array.from({ length: 3 }, (_, index) => candidate(`nature-${index}`, ['park', 'nature']));
    const generic = Array.from({ length: 7 }, (_, index) => candidate(`generic-${index}`, ['museum'], { notability: 0.8 }));
    const selected = selectDiscoveryEntries([...entriesFor(preferred, plan), ...entriesFor(generic, plan)], plan, 10);

    expect(selected).toHaveLength(10);
    expect(selected.filter(({ trace }) => trace.fallbackReason === 'sparse-preference-pool')).toHaveLength(7);
  });

  it('does not let an irrelevant preferred-query hit block its later fallback', () => {
    const plan = buildDiscoveryQueryPlan(['street-food'], 1);
    const generic = candidate('generic-1', ['museum'], { notability: 0.8 });
    const selected = selectDiscoveryEntries([
      { candidate: generic, query: plan.preferredQueries[0] },
      { candidate: generic, query: plan.fallbackQueries[0] },
    ], plan, 1);

    expect(selected).toHaveLength(1);
    expect(selected[0].trace.fallbackReason).toBe('bounded-general-fallback');
  });
});
