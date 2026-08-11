/**
 * When a request happens, and when an answer is ignored.
 *
 * The failure this guards against is a loop rather than a wrong result:
 *
 *   render → array rebuilt → effect fires → request → setState → render → …
 *
 * The backend cache would keep that from costing money, but it still floods
 * the Edge Function and makes the UI impossible to reason about. So the tests
 * here are mostly about what must NOT cause a request, and about an answer
 * arriving after it stopped being wanted.
 */
import { describe, expect, it } from 'vitest';
import {
  IntelligenceRequestController,
  MAX_HELD_KEYS,
  foldIntelligenceResults,
  materialRequestKey,
} from './candidateIntelligenceRequest';

const candidates = [
  { candidateId: 'a', candidateRevision: 'r1' },
  { candidateId: 'b', candidateRevision: 'r1' },
];

const key = (over: Partial<Parameters<typeof materialRequestKey>[0]> = {}) =>
  materialRequestKey({ profileRevision: 'p1', plannerContextRevision: 'ctx1', candidates, ...over });

describe('the material fingerprint', () => {
  it('is stable across renders with equivalent data', () => {
    // Fresh array objects each time, exactly as a render would rebuild them.
    expect(key({ candidates: [...candidates.map((c) => ({ ...c })) ] })).toBe(key());
  });

  /**
   * The deck reorders as decisions are made, and a reorder changes nothing
   * about whether a place suits the traveller. Without the sort, every re-rank
   * would look like new material and buy the same answers again.
   */
  it('ignores candidate order', () => {
    expect(key({ candidates: [...candidates].reverse() })).toBe(key());
  });

  it.each([
    ['profile revision', { profileRevision: 'p2' }],
    ['planner context revision', { plannerContextRevision: 'ctx2' }],
    ['a candidate revision', { candidates: [{ candidateId: 'a', candidateRevision: 'r2' }, candidates[1]] }],
    ['the candidate set', { candidates: [...candidates, { candidateId: 'c', candidateRevision: 'r1' }] }],
  ])('changes when %s changes', (_label, over) => {
    expect(key(over)).not.toBe(key());
  });

  /**
   * Everything a traveller does while browsing. None of it can change what is
   * true about a candidate, so none of it may cause a request — and the way to
   * guarantee that is for the key to have no way to see it.
   */
  it('cannot see deck index, flip, scroll, decisions or viewport', () => {
    const fingerprint = key();
    for (const uiState of ['3', 'flipped', 'scrolled', 'must-do', '390px', 'hovered']) {
      expect(fingerprint).not.toContain(uiState);
    }
  });
});

describe('deciding whether to ask', () => {
  it('asks once for a new key', () => {
    const controller = new IntelligenceRequestController();
    expect(controller.shouldRequest('k1')).toBe(true);
    controller.begin('k1');
    controller.settle('k1', new Map());
    // Held, so asking again would buy the same answer.
    expect(controller.shouldRequest('k1')).toBe(false);
  });

  /** Two identical requests cannot disagree; the second is load and a race. */
  it('refuses a duplicate while the same key is in flight', () => {
    const controller = new IntelligenceRequestController();
    controller.begin('k1');
    expect(controller.shouldRequest('k1')).toBe(false);
  });

  it('asks again when the material key changes', () => {
    const controller = new IntelligenceRequestController();
    controller.begin('k1');
    controller.settle('k1', new Map());
    expect(controller.shouldRequest('k2')).toBe(true);
  });

  /**
   * A failure must not be remembered as done. Recording it would make one bad
   * response permanent for as long as the traveller stayed on the deck, with
   * no way to recover but a reload.
   */
  it('allows a retry after a failed request', () => {
    const controller = new IntelligenceRequestController();
    controller.begin('k1');
    controller.settle('k1', undefined);
    expect(controller.shouldRequest('k1')).toBe(true);
  });

  it('never asks on an empty key', () => {
    expect(new IntelligenceRequestController().shouldRequest('')).toBe(false);
  });

  /**
   * The loop, simulated. A component rerendering repeatedly with unchanged
   * material must produce exactly one request no matter how many times the
   * effect runs.
   */
  it('produces one request across many rerenders with unchanged material', () => {
    const controller = new IntelligenceRequestController();
    let requests = 0;
    for (let render = 0; render < 50; render += 1) {
      const fingerprint = key({ candidates: candidates.map((c) => ({ ...c })) });
      if (controller.shouldRequest(fingerprint)) {
        requests += 1;
        controller.begin(fingerprint);
        controller.settle(fingerprint, new Map());
      }
    }
    expect(requests).toBe(1);
  });
});

describe('an answer that arrived too late', () => {
  /**
   * The race: p1 is overtaken by p2, p2 answers first, p1 arrives late.
   * Without the comparison the previous traveller's personalisation would
   * overwrite the current one's — and it would look like the feature simply
   * being wrong.
   */
  it('is discarded when the material key has moved on', () => {
    const controller = new IntelligenceRequestController();
    const first = key({ profileRevision: 'p1' });
    const second = key({ profileRevision: 'p2' });

    expect(controller.accepts(second, second)).toBe(true);
    // p1 finishing after p2 must not be applied.
    expect(controller.accepts(first, second)).toBe(false);
  });

  it('is accepted when it is still the answer being waited for', () => {
    const controller = new IntelligenceRequestController();
    expect(controller.accepts(key(), key())).toBe(true);
  });
});

describe('folding a response into card state', () => {
  it('keeps intelligence only where the server said it is ready', () => {
    const entries = foldIntelligenceResults([
      { candidateId: 'a', intelligence: { candidateId: 'a' } as never, status: 'ready' },
      { candidateId: 'b', intelligence: null, status: 'deterministic-only' },
      { candidateId: 'c', intelligence: { candidateId: 'c' } as never, status: 'unavailable' },
    ]);

    expect(entries.get('a')?.intelligence).not.toBeNull();
    expect(entries.get('b')).toMatchObject({ intelligence: null, status: 'deterministic-only' });
    /**
     * `unavailable` means the model never ran, so anything alongside it is not
     * an answer and is dropped rather than rendered.
     */
    expect(entries.get('c')).toMatchObject({ intelligence: null, status: 'unavailable' });
  });

  it('treats an unrecognised status as unavailable rather than ready', () => {
    const entries = foldIntelligenceResults([
      { candidateId: 'a', intelligence: { candidateId: 'a' } as never, status: 'something-new' },
    ]);
    expect(entries.get('a')).toMatchObject({ status: 'unavailable', intelligence: null });
  });

  it('survives a malformed response without throwing', () => {
    expect(() => foldIntelligenceResults([{ candidateId: '', intelligence: null, status: 'ready' }]))
      .not.toThrow();
    expect(foldIntelligenceResults([]).size).toBe(0);
  });
});

describe('ids cannot impersonate a delimiter', () => {
  /**
   * Not hypothetical. This app's candidate ids are OSM-style, so a
   * delimiter-joined key aliases two genuinely different material states:
   * `osm:node:123` at revision `r1` and `osm:node` at revision `123:r1` both
   * render as `osm:node:123:r1`. The consequence is serving one state's
   * answers for another with nothing looking wrong.
   */
  it('keeps colon-bearing ids and revisions distinct', () => {
    const a = materialRequestKey({
      profileRevision: 'p1',
      candidates: [{ candidateId: 'osm:node:123', candidateRevision: 'r1' }],
    });
    const b = materialRequestKey({
      profileRevision: 'p1',
      candidates: [{ candidateId: 'osm:node', candidateRevision: '123:r1' }],
    });
    expect(a).not.toBe(b);
  });

  it('is not confused by commas, pipes or quotes inside an id', () => {
    const keys = [
      [{ candidateId: 'a,b', candidateRevision: 'r1' }],
      [{ candidateId: 'a', candidateRevision: 'b,r1' }],
      [{ candidateId: 'a|b', candidateRevision: 'r1' }],
      [{ candidateId: 'a"b', candidateRevision: 'r1' }],
    ].map((candidates) => materialRequestKey({ profileRevision: 'p1', candidates }));

    expect(new Set(keys).size).toBe(keys.length);
  });
});

/**
 * The subtle trap. Excluding decision state from the key is not enough on its
 * own: if the array handed in is the *visible* deck, Skip removes a candidate,
 * the fingerprint changes, and a decision has silently become material after
 * all. A traveller marking three places would buy fresh answers about the ones
 * they did not mark.
 */
describe('decisions cannot change the key through the back door', () => {
  const pool = [
    { candidateId: 'a', candidateRevision: 'r1' },
    { candidateId: 'b', candidateRevision: 'r1' },
    { candidateId: 'c', candidateRevision: 'r1' },
  ];
  const poolKey = () => materialRequestKey({ profileRevision: 'p1', candidates: pool });

  /**
   * Stated as a contrast, because a pure function cannot prove which array a
   * component hands it. What it *can* show is that the choice matters: the
   * pool and the deck produce different keys, so passing the wrong one is a
   * real bug rather than a stylistic preference. The component test is what
   * proves the right one is passed.
   */
  it('is identical for the pool however decisions reorder the deck', () => {
    const reordered = [...pool].reverse();
    expect(materialRequestKey({ profileRevision: 'p1', candidates: reordered })).toBe(poolKey());
  });

  it('would change if the visible deck were used instead — the mistake this guards', () => {
    const visible = pool.filter((candidate) => candidate.candidateId !== 'b');
    expect(materialRequestKey({ profileRevision: 'p1', candidates: visible })).not.toBe(poolKey());
  });
});

describe('answers already held are reused', () => {
  const entries = () => new Map([['a', { intelligence: null, status: 'deterministic-only' as const }]]);

  /**
   * Travellers move back and forth. Adjusting a profile and undoing it would
   * otherwise re-ask for an answer still sitting in memory — free at the
   * provider thanks to the backend cache, but a pointless round trip.
   */
  it('does not re-request a key whose answer is still held', () => {
    const controller = new IntelligenceRequestController();
    controller.begin('A');
    controller.settle('A', entries());
    controller.begin('B');
    controller.settle('B', entries());

    expect(controller.shouldRequest('A')).toBe(false);
    expect(controller.cached('A')).toBeDefined();
  });

  it('bounds what it remembers', () => {
    const controller = new IntelligenceRequestController();
    for (let index = 0; index < MAX_HELD_KEYS + 3; index += 1) {
      controller.begin(`k${index}`);
      controller.settle(`k${index}`, entries());
    }
    // The oldest fell out; the newest are still held.
    expect(controller.cached('k0')).toBeUndefined();
    expect(controller.cached(`k${MAX_HELD_KEYS + 2}`)).toBeDefined();
    expect(controller.shouldRequest('k0')).toBe(true);
  });

  it('holds nothing for a failed request', () => {
    const controller = new IntelligenceRequestController();
    controller.begin('A');
    controller.settle('A', undefined);
    expect(controller.cached('A')).toBeUndefined();
    expect(controller.shouldRequest('A')).toBe(true);
  });
});
