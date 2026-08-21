/**
 * One vocabulary for what the planner can do.
 *
 * The failure this guards against is drift: Smart Plan offering a chip Ask has
 * never heard of, or the two describing the same engine in different words.
 * Both surfaces read this registry, so the tests here are about the registry
 * being coherent rather than about either surface.
 */
import { describe, expect, it } from 'vitest';
import type { Itinerary } from '../data';
import { emptyItinerary } from './itinerarySanitize';
import {
  PLANNER_CAPABILITIES,
  availableCapabilities,
  capabilityAskExamples,
  conflictCountFor,
  plannerCapability,
  plannerTripSignals,
} from './plannerCapabilities';

const place = (id: string, time: string, durationMinutes = 90) => ({
  id, name: `Place ${id}`, time, durationMinutes,
  type: 'sightseeing', description: '', location: 'Osaka', cost: 0,
});

const tripWith = (activities: ReturnType<typeof place>[], over: Partial<Itinerary> = {}): Itinerary => ({
  ...emptyItinerary,
  id: 'trip-1',
  days: [{ day: 1, date: '2026-09-01', title: 'Day one', activities }],
  ...over,
} as unknown as Itinerary);

const planned = () => tripWith([place('a1', '09:00'), place('a2', '11:00')]);

describe('the registry is coherent', () => {
  it('gives every capability a unique id', () => {
    const ids = PLANNER_CAPABILITIES.map((capability) => capability.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every capability both a chip label and a question', () => {
    for (const capability of PLANNER_CAPABILITIES) {
      expect(capability.label.length).toBeGreaterThan(0);
      expect(capability.description.length).toBeGreaterThan(0);
      // The question is what Ask pre-types; a chip without one could only be
      // offered on one of the two surfaces.
      expect(capability.askExample.length).toBeGreaterThan(0);
    }
  });

  /**
   * Traveller-facing language, checked rather than trusted. "Rebalance travel"
   * is a thing a person wants; "optimise spatial routing" is a thing a
   * programmer wrote.
   */
  it('never leaks internal vocabulary into what a traveller reads', () => {
    const jargon = /optimise|optimize|heuristic|density|spatial|diversification|algorithm/i;
    for (const capability of PLANNER_CAPABILITIES) {
      expect(capability.label).not.toMatch(jargon);
      expect(capability.description).not.toMatch(jargon);
      expect(capability.askExample).not.toMatch(jargon);
    }
  });

  it('keeps the internal ids stable across the rename', () => {
    // These are the ids the deterministic planners were already keyed by.
    for (const id of [
      'rebalance-travel', 'late-start', 'rainy-day', 'route-delay',
      'less-walking', 'more-relaxed', 'lower-cost', 'fix-conflicts', 'more-local',
    ] as const) {
      expect(plannerCapability(id)).toBeDefined();
    }
  });

  /**
   * A deterministic capability must not be routed through the model. It is
   * arithmetic the device can already do, and sending it to a metered provider
   * would spend money to reproduce an exact answer.
   */
  it('routes the deterministic planners away from the model', () => {
    for (const id of [
      'rebalance-travel', 'more-relaxed', 'less-walking', 'rainy-day',
      'late-start', 'route-delay', 'lower-cost', 'fix-conflicts', 'place-saved',
    ] as const) {
      expect(plannerCapability(id)?.route).toBe('local-proposal');
    }
  });

  it('routes the genuinely open-ended ones into the conversation', () => {
    expect(plannerCapability('more-local')?.route).toBe('ask');
    expect(plannerCapability('complete-trip')?.route).toBe('ask');
  });

  it('keeps undo out of both, because it reverses rather than proposes', () => {
    expect(plannerCapability('undo-last')?.route).toBe('history');
  });
});

describe('availability follows the trip', () => {
  it('offers nothing that rearranges places when there are none', () => {
    const ids = availableCapabilities(plannerTripSignals(emptyItinerary)).map((entry) => entry.id);
    expect(ids).not.toContain('rebalance-travel');
    expect(ids).not.toContain('less-walking');
    expect(ids).not.toContain('lower-cost');
  });

  it('offers the rearranging capabilities once a day has places', () => {
    const ids = availableCapabilities(plannerTripSignals(planned())).map((entry) => entry.id);
    expect(ids).toEqual(expect.arrayContaining([
      'rebalance-travel', 'more-relaxed', 'less-walking', 'rainy-day',
      'late-start', 'route-delay', 'lower-cost',
    ]));
  });

  /** A repair chip on a trip with nothing to repair teaches that chips do nothing. */
  it('offers conflict repair only when conflicts exist', () => {
    expect(plannerTripSignals(planned()).conflictCount).toBe(0);
    expect(availableCapabilities(plannerTripSignals(planned())).map((entry) => entry.id))
      .not.toContain('fix-conflicts');

    // Two stops that overlap in time.
    const clashing = tripWith([place('a1', '09:00', 180), place('a2', '10:00')]);
    expect(plannerTripSignals(clashing).conflictCount).toBeGreaterThan(0);
    expect(availableCapabilities(plannerTripSignals(clashing)).map((entry) => entry.id))
      .toContain('fix-conflicts');
  });

  it('offers to place saved activities only when some are waiting', () => {
    const ids = availableCapabilities(plannerTripSignals(planned())).map((entry) => entry.id);
    expect(ids).not.toContain('place-saved');

    const waiting = tripWith([], { unassignedActivities: [place('a9', '00:00')] } as unknown as Partial<Itinerary>);
    expect(availableCapabilities(plannerTripSignals(waiting)).map((entry) => entry.id))
      .toContain('place-saved');
  });

  it('offers undo only when a planner change can be reversed', () => {
    expect(availableCapabilities(plannerTripSignals(planned())).map((entry) => entry.id))
      .not.toContain('undo-last');

    const reversible = tripWith([place('a1', '09:00')], {
      plannerHistory: [{ id: 'h1', action: 'optimise-trip', appliedAt: '2026-08-21T10:00:00.000Z', previous: planned() }],
    } as unknown as Partial<Itinerary>);
    expect(availableCapabilities(plannerTripSignals(reversible)).map((entry) => entry.id))
      .toContain('undo-last');
  });
});

describe('conflict counting is shared, not re-derived', () => {
  it('counts an overlap between consecutive stops', () => {
    expect(conflictCountFor(tripWith([place('a1', '09:00', 180), place('a2', '10:00')]))).toBeGreaterThan(0);
  });

  it('counts nothing for a clean day', () => {
    expect(conflictCountFor(planned())).toBe(0);
  });
});

describe('Ask examples come from the same registry', () => {
  it('offers questions for what this trip can actually do', () => {
    const examples = capabilityAskExamples(plannerTripSignals(planned()));
    expect(examples.length).toBeGreaterThan(0);
    // Every example is some capability's own phrasing, not a parallel list.
    for (const example of examples) {
      expect(PLANNER_CAPABILITIES.some((capability) => capability.askExample === example)).toBe(true);
    }
  });

  it('is bounded, so the empty state does not push the composer off screen', () => {
    expect(capabilityAskExamples(plannerTripSignals(planned()), 4)).toHaveLength(4);
  });

  /**
   * Undo is a button. Offering it as a sentence invites a traveller to ask the
   * model for something only the change history can do.
   */
  it('never suggests asking the model to undo', () => {
    const reversible = tripWith([place('a1', '09:00')], {
      plannerHistory: [{ id: 'h1', action: 'optimise-trip', appliedAt: '2026-08-21T10:00:00.000Z', previous: planned() }],
    } as unknown as Partial<Itinerary>);
    const examples = capabilityAskExamples(plannerTripSignals(reversible), 20);
    expect(examples).not.toContain(plannerCapability('undo-last')?.askExample);
  });
});
