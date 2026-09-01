/**
 * How long one discovery request may take, and who says so.
 *
 * Per-source ceilings bounded a source but nothing bounded the request, so a
 * planning call could legitimately spend 12s on Wikivoyage and 22s twice on
 * Overpass — 56-64s — while the browser aborted at 50s and told the traveller
 * the search had timed out. Two numbers, neither derived from the other.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createRequestDeadline,
  DISCOVERY_REQUEST_BUDGET_MS,
  emptySourceReport,
  factualDiscoveryOutcome,
} from '../../supabase/functions/_shared/discoveryResilience';
import { DISCOVERY_PLANNING_REQUEST_TIMEOUT_MS } from './discoveryRuntime';

const discoverSource = readFileSync('supabase/functions/travel-discover/index.ts', 'utf8');

describe('one clock for the whole request', () => {
  it('gives a source its own ceiling while there is room for it', () => {
    const now = 0;
    const deadline = createRequestDeadline(45_000, () => now);
    expect(deadline.allow(22_000, 8_000)).toBe(22_000);
  });

  it('shortens a source to what is actually left', () => {
    let now = 0;
    const deadline = createRequestDeadline(45_000, () => now);
    now = 30_000;
    expect(deadline.allow(22_000, 8_000)).toBe(15_000);
  });

  it('refuses to start a round that cannot finish', () => {
    let now = 0;
    const deadline = createRequestDeadline(45_000, () => now);
    now = 40_000;
    expect(deadline.allow(22_000, 8_000)).toBeNull();
    expect(deadline.remainingMs()).toBe(5_000);
  });

  it('reports exhaustion rather than counting down past zero', () => {
    let now = 0;
    const deadline = createRequestDeadline(45_000, () => now);
    now = 90_000;
    expect(deadline.remainingMs()).toBe(0);
    expect(deadline.expired()).toBe(true);
  });
});

describe('the two Overpass rounds cannot outlive the budget', () => {
  /** The serial worst case the review measured against the old 50s client deadline. */
  const WIKIVOYAGE = 12_000;
  const OVERPASS = 22_000;

  it('fits one full round inside the planning budget', () => {
    expect(WIKIVOYAGE + OVERPASS).toBeLessThan(DISCOVERY_REQUEST_BUDGET_MS.planning);
  });

  it('declines the fallback round once the first round has spent the budget', () => {
    let now = 0;
    const deadline = createRequestDeadline(DISCOVERY_REQUEST_BUDGET_MS.planning, () => now);
    now = 8_000 + WIKIVOYAGE + OVERPASS; // geocode, Wikivoyage, one Overpass round
    expect(deadline.allow(OVERPASS, 8_000)).toBeNull();
  });

  it('allows the fallback round when the earlier sources were quick', () => {
    let now = 0;
    const deadline = createRequestDeadline(DISCOVERY_REQUEST_BUDGET_MS.planning, () => now);
    now = 1_500 + 11_000; // Wikivoyage fast, one Overpass round at the measured 11s
    expect(deadline.allow(OVERPASS, 8_000)).toBe(OVERPASS);
  });
});

describe('the client deadline is derived from the server budget', () => {
  it('waits at least as long as the server is allowed to work', () => {
    expect(DISCOVERY_PLANNING_REQUEST_TIMEOUT_MS).toBeGreaterThan(DISCOVERY_REQUEST_BUDGET_MS.planning);
  });

  it('leaves a transport margin rather than aborting the instant the budget ends', () => {
    const margin = DISCOVERY_PLANNING_REQUEST_TIMEOUT_MS - DISCOVERY_REQUEST_BUDGET_MS.planning;
    expect(margin).toBeGreaterThanOrEqual(2_000);
    expect(margin).toBeLessThanOrEqual(10_000);
  });
});

describe('the server tells the truth about why it found nothing', () => {
  it('calls a budget exhaustion an outage, not an empty city', () => {
    const report = { ...emptySourceReport(), deadlineExceeded: true };
    expect(factualDiscoveryOutcome({ candidateCount: 0, report })).toBe('sources-unavailable');
  });

  it('still calls a genuine absence an absence', () => {
    expect(factualDiscoveryOutcome({ candidateCount: 0, report: emptySourceReport() })).toBe('no-candidates');
  });

  it('reports results as results even when the budget ran out afterwards', () => {
    const report = { ...emptySourceReport(), deadlineExceeded: true };
    expect(factualDiscoveryOutcome({ candidateCount: 4, report })).toBe('ok');
  });
});

describe('the discovery function honours the contract', () => {
  it('starts one deadline for the request', () => {
    expect(discoverSource).toContain('createRequestDeadline(DISCOVERY_REQUEST_BUDGET_MS[mode])');
  });

  it('gates the fallback round on remaining budget as well as source health', () => {
    expect(discoverSource).toContain('const canRetry = !report?.overpassFailed');
    expect(discoverSource).toContain("deadline.allow(OVERPASS_TIMEOUT_MS[mode], OVERPASS_MINIMUM_VIABLE_MS) !== null");
  });

  it('records the exhaustion rather than reporting an empty city', () => {
    expect(discoverSource).toContain('report.deadlineExceeded = true');
  });

  it('passes the remaining budget to each source instead of its bare ceiling', () => {
    expect(discoverSource).toContain('fetchOverpassPlaces(area, categories, mode, placesBudget)');
    expect(discoverSource).toContain('fetchWikivoyageListings(city, wikivoyageBudget)');
  });
});
