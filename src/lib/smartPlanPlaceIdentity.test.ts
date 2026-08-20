/**
 * Place identity, captured where it is true and carried to where it is useful.
 *
 * The rule this file exists to hold is one sentence: **capture identity at the
 * moment the server can prove it, and never reconstruct it afterwards.**
 *
 * Smart Plan could not show a place card because the browser never learned who
 * a place was. `travel-discover` knew — it holds the canonical id and the
 * provider `place_provider_links` is keyed by, at the same instant — and threw
 * both away. Everything here follows from putting that reference on the
 * candidate instead, persisting it beside the decision it was made with, and
 * refusing every temptation to work one out later from a name, a candidate id
 * or a provider guess.
 */
import { describe, expect, it } from 'vitest';
import { attachPlaceRefs, parseStructuredPlaceRef } from '../../supabase/functions/_shared/placeReference';
import type { StructuredPlaceRef } from '../../supabase/functions/_shared/placeReference';
import { deriveSmartActions } from '../../supabase/functions/_shared/smartPlannerActions';
import { decisionPlaceRefs } from './decisionTarget';
import { emptyItinerary, sanitizeItinerary } from './itinerarySanitize';

const REF: StructuredPlaceRef = {
  canonicalPlaceId: 'c-1111',
  provider: 'osm',
  providerPlaceId: 'n250668618',
};

describe('travel-discover proves identity or offers none', () => {
  it('attaches a reference when the link table accounts for the place', () => {
    const out = attachPlaceRefs(
      [{ id: 'osm-n1', name: 'Artizon Museum', providerPlaceId: 'n1' }],
      'osm',
      new Map([['n1', 'c-1111']]),
    ) as Array<Record<string, unknown>>;

    expect(out[0].placeRef).toEqual({
      canonicalPlaceId: 'c-1111', provider: 'osm', providerPlaceId: 'n1',
    });
    // Everything else survives untouched.
    expect(out[0].name).toBe('Artizon Museum');
  });

  it('uses the link provider, not the one the listing came from', () => {
    /**
     * The ACROS case. A Wikivoyage listing found on an OSM discovery run
     * carries `provider: 'wikivoyage'` and is linked under `'osm'`. Copying
     * the candidate's own provider produces a reference that resolves to
     * nothing at all, silently — the failure this project has fixed twice.
     */
    const out = attachPlaceRefs(
      [{ id: 'wv-acros', name: 'ACROS Fukuoka', provider: 'wikivoyage', providerPlaceId: 'wv:ACROS' }],
      'osm',
      new Map([['wv:ACROS', 'c-2222']]),
    ) as Array<Record<string, unknown>>;

    expect(out[0].placeRef).toEqual({
      canonicalPlaceId: 'c-2222', provider: 'osm', providerPlaceId: 'wv:ACROS',
    });
    // The listing's own provenance is left alone; it is presentation, not identity.
    expect(out[0].provider).toBe('wikivoyage');
  });

  it('offers nothing when the link table cannot account for the place', () => {
    const out = attachPlaceRefs(
      [{ id: 'osm-n9', name: 'Unlinked Place', providerPlaceId: 'n9' }],
      'osm',
      new Map([['n1', 'c-1111']]),
    ) as Array<Record<string, unknown>>;
    expect(out[0].placeRef).toBeUndefined();
  });

  it('offers nothing when the candidate has no provider place id', () => {
    const out = attachPlaceRefs(
      [{ id: 'legacy-1', name: 'Old Listing' }],
      'osm',
      new Map([['n1', 'c-1111']]),
    ) as Array<Record<string, unknown>>;
    expect(out[0].placeRef).toBeUndefined();
  });

  it('does not let two places with one name borrow each other', () => {
    const out = attachPlaceRefs(
      [
        { id: 'a', name: "Tully's Coffee", providerPlaceId: 'n1114908651' },
        { id: 'b', name: "Tully's Coffee", providerPlaceId: 'n1482079801' },
      ],
      'osm',
      new Map([['n1114908651', 'c-aaa']]),
    ) as Array<Record<string, unknown>>;

    expect((out[0].placeRef as StructuredPlaceRef).canonicalPlaceId).toBe('c-aaa');
    // The second shares a display name and nothing else. It gets no reference.
    expect(out[1].placeRef).toBeUndefined();
  });
});

describe('a decision keeps the reference it was made with', () => {
  const candidate = { id: 'osm-n250668618', providerPlaceId: 'n250668618', placeRef: REF };

  it('stores the exact reference under the decision key', () => {
    const refs = decisionPlaceRefs({ 'osm-n250668618': 'must-do' }, [candidate]);
    expect(refs).toEqual({ 'osm-n250668618': REF });
  });

  it('writes nothing for a candidate the server could not prove', () => {
    const refs = decisionPlaceRefs(
      { 'osm-n999': 'must-do' },
      [{ id: 'osm-n999', providerPlaceId: 'n999' }],
    );
    expect(refs).toBeUndefined();
  });

  it('follows a decision written against the saved activity', () => {
    const refs = decisionPlaceRefs(
      { 'activity-7': 'must-do' },
      [{ ...candidate, savedActivityId: 'activity-7' }],
    );
    expect(refs).toEqual({ 'activity-7': REF });
  });

  it('drops the reference when the decision is withdrawn', () => {
    // Undo removes the decision; identity must not outlive it and reappear
    // later as a card for a choice the traveller took back.
    const refs = decisionPlaceRefs({}, [], { 'osm-n250668618': REF });
    expect(refs).toBeUndefined();
  });

  it('keeps a held reference while its decision still stands', () => {
    const refs = decisionPlaceRefs({ 'osm-n250668618': 'skip' }, [], { 'osm-n250668618': REF });
    expect(refs).toEqual({ 'osm-n250668618': REF });
  });
});

describe('what survives a reload', () => {
  const stateWith = (placeRefs: unknown, decisions: Record<string, string> = { 'osm-n1': 'must-do' }) =>
    sanitizeItinerary({
      ...emptyItinerary,
      revision: 1,
      discoveryState: {
        city: 'Tokyo',
        mode: 'live',
        candidateIds: ['osm-n1'],
        decisions,
        discoveredAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
        placeRefs,
      },
    }, emptyItinerary).discoveryState;

  it('keeps a reference in exactly the right shape', () => {
    expect(stateWith({ 'osm-n1': REF })?.placeRefs).toEqual({ 'osm-n1': REF });
  });

  it.each([
    ['a missing provider', { canonicalPlaceId: 'c-1', providerPlaceId: 'n1' }],
    ['a missing canonical id', { provider: 'osm', providerPlaceId: 'n1' }],
    ['a name where identity belongs', { name: 'Shinjuku Gyoen' }],
    ['nothing at all', {}],
  ])('strips %s', (_label, malformed) => {
    expect(stateWith({ 'osm-n1': malformed })?.placeRefs).toBeUndefined();
  });

  it('refuses a reference whose decision no longer exists', () => {
    expect(stateWith({ 'osm-gone': REF })?.placeRefs).toBeUndefined();
  });

  it('leaves a record written before references existed alone', () => {
    const state = stateWith(undefined);
    expect(state?.placeRefs).toBeUndefined();
    expect(state?.decisions).toEqual({ 'osm-n1': 'must-do' });
  });

  it('carries nothing but identity — no name, image or coordinates', () => {
    const smuggled = { ...REF, name: 'Somewhere', image: 'https://x/y.jpg', coordinates: [1, 2] };
    expect(stateWith({ 'osm-n1': smuggled })?.placeRefs).toEqual({ 'osm-n1': REF });
  });
});

describe('Smart Plan shows the place when it honestly can', () => {
  const itineraryWith = (placeRefs?: Record<string, StructuredPlaceRef>) => ({
    days: [{ day: 1, activities: [] }],
    discoveryState: {
      decisions: { 'osm-n250668618': 'must-do' },
      placeRefs,
    },
  });

  const fitMustDo = (placeRefs?: Record<string, StructuredPlaceRef>) =>
    deriveSmartActions({ itinerary: itineraryWith(placeRefs), surface: 'itinerary' })
      .find((action) => action.id === 'fit-must-do');

  it('carries the exact stored reference for a new Must do', () => {
    const action = fitMustDo({ 'osm-n250668618': REF });
    expect(action).toBeDefined();
    expect(action?.placeRef).toEqual(REF);
    // The words are unchanged; the reference only adds a picture.
    expect(action?.reason).toBe('A place you marked Must do is not on the saved plan yet.');
  });

  it('still offers the action for a decision made before references existed', () => {
    const action = fitMustDo(undefined);
    expect(action).toBeDefined();
    expect(action?.placeRef).toBeUndefined();
    expect(action?.reason).toBe('A place you marked Must do is not on the saved plan yet.');
  });

  it('will not accept a malformed stored reference', () => {
    const action = fitMustDo({ 'osm-n250668618': { provider: 'osm' } as unknown as StructuredPlaceRef });
    expect(action).toBeDefined();
    expect(action?.placeRef).toBeUndefined();
  });

  it('binds by decision key, so a shared name reaches nothing', () => {
    // A reference stored for a different decision must not attach here.
    const action = fitMustDo({ 'osm-someone-else': REF });
    expect(action?.placeRef).toBeUndefined();
  });

  it('gives a reference to no other action', () => {
    const actions = deriveSmartActions({
      itinerary: itineraryWith({ 'osm-n250668618': REF }),
      surface: 'itinerary',
    });
    for (const action of actions.filter((entry) => entry.id !== 'fit-must-do')) {
      expect(action.placeRef).toBeUndefined();
    }
  });
});

describe('the reference validator is the one the Ask card already uses', () => {
  it('accepts only all three parts', () => {
    expect(parseStructuredPlaceRef(REF)).toEqual(REF);
    expect(parseStructuredPlaceRef({ canonicalPlaceId: 'c', provider: 'osm' })).toBeUndefined();
  });
});
