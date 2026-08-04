import { describe, expect, it } from 'vitest';
import {
  applyTravellerConstraints,
  deriveTravelBehaviour,
  describePace,
  inferPace,
  PACE_DEFAULTS,
  paceRank,
  sanitizeTravelBehaviour,
} from './travelBehaviour';
import type { TripMood, TripType } from './tripProfile';

const profile = (moods: TripMood[] = [], tripTypes: TripType[] = []) => ({ moods, tripTypes });

describe('pace inference from existing moods', () => {
  it('maps the documented migration cases', () => {
    expect(inferPace(profile(['slow-living']))).toBe('very-relaxed');
    expect(inferPace(profile(['calm']))).toBe('relaxed');
    expect(inferPace(profile([], ['relaxation']))).toBe('relaxed');
    expect(inferPace(profile(['fast-paced']))).toBe('active');
    expect(inferPace(profile())).toBe('balanced');
  });

  it('resolves conflicting moods toward the calmer reading', () => {
    // Over-packing is the failure a traveller feels; an easy day leaves room to add.
    expect(inferPace(profile(['calm', 'fast-paced']))).toBe('relaxed');
    expect(inferPace(profile(['slow-living', 'fast-paced']))).toBe('very-relaxed');
  });

  it('never overwrites an explicit pace choice', () => {
    const behaviour = deriveTravelBehaviour(profile(['fast-paced']), { pace: 'very-relaxed' });
    expect(behaviour.pace).toBe('very-relaxed');
  });
});

describe('pace produces materially different days', () => {
  it('orders stop counts, start times and buffers monotonically', () => {
    const order = ['very-relaxed', 'relaxed', 'balanced', 'active', 'intensive'] as const;
    for (let i = 1; i < order.length; i += 1) {
      const slower = PACE_DEFAULTS[order[i - 1]];
      const faster = PACE_DEFAULTS[order[i]];
      expect(faster.maxMainActivities).toBeGreaterThanOrEqual(slower.maxMainActivities);
      expect(faster.startTime <= slower.startTime).toBe(true);
      expect(faster.transitionBufferMinutes).toBeLessThanOrEqual(slower.transitionBufferMinutes);
      expect(faster.maximumWalkingMinutes).toBeGreaterThanOrEqual(slower.maximumWalkingMinutes);
      expect(faster.minimumFreeTimeMinutes).toBeLessThanOrEqual(slower.minimumFreeTimeMinutes);
    }
  });

  it('gives a relaxed traveller a later start, fewer stops and longer meals', () => {
    const relaxed = deriveTravelBehaviour(profile(['calm']));
    const active = deriveTravelBehaviour(profile(['fast-paced']));
    expect(relaxed.maxMainActivitiesPerDay).toBeLessThan(active.maxMainActivitiesPerDay!);
    expect(relaxed.preferredStartTime! > active.preferredStartTime!).toBe(true);
    expect(relaxed.meals.preferredDiningMinutes!).toBeGreaterThan(active.meals.preferredDiningMinutes!);
    expect(relaxed.comfort.minimumTransitionBufferMinutes)
      .toBeGreaterThan(active.comfort.minimumTransitionBufferMinutes);
  });

  it('keeps every pace physically feasible — fast never means impossible', () => {
    for (const pace of Object.values(PACE_DEFAULTS)) {
      expect(pace.transitionBufferMinutes).toBeGreaterThan(0);
      expect(pace.diningMinutes).toBeGreaterThanOrEqual(45);
      expect(pace.maxMainActivities).toBeLessThanOrEqual(5);
      expect(pace.startTime < pace.latestReturnTime).toBe(true);
    }
  });

  it('keeps relaxed travellers within one city', () => {
    expect(PACE_DEFAULTS['very-relaxed'].allowCrossCityDays).toBe(false);
    expect(PACE_DEFAULTS.relaxed.allowCrossCityDays).toBe(false);
    expect(PACE_DEFAULTS.active.allowCrossCityDays).toBe(true);
  });
});

describe('sanitising a stored behaviour profile', () => {
  it('preserves explicit settings across a reload', () => {
    const stored = {
      pace: 'relaxed',
      preferredStartTime: '11:00',
      maxMainActivitiesPerDay: 2,
      meals: { maximumQueueMinutes: 10, dietaryNeeds: ['halal'] },
      travellers: { adults: 2, children: 1, seniors: 0, mobilityNeeds: [] },
    };
    const behaviour = sanitizeTravelBehaviour(stored, profile(['fast-paced']));
    expect(behaviour.pace).toBe('relaxed');
    expect(behaviour.preferredStartTime).toBe('11:00');
    expect(behaviour.meals.maximumQueueMinutes).toBe(10);
    expect(behaviour.meals.dietaryNeeds).toEqual(['halal']);
    expect(behaviour.travellers.children).toBe(1);
  });

  it('falls back to mood-derived defaults for corrupt input', () => {
    const behaviour = sanitizeTravelBehaviour(
      { pace: 'teleporting', preferredStartTime: '99:99', walking: { maximumDailyMinutes: 'lots' } },
      profile(['slow-living']),
    );
    expect(behaviour.pace).toBe('very-relaxed');
    expect(behaviour.preferredStartTime).toBe(PACE_DEFAULTS['very-relaxed'].startTime);
    expect(behaviour.walking.maximumDailyMinutes).toBe(PACE_DEFAULTS['very-relaxed'].maximumWalkingMinutes);
  });

  it('handles a missing profile without throwing', () => {
    expect(sanitizeTravelBehaviour(null, profile()).pace).toBe('balanced');
    expect(sanitizeTravelBehaviour(undefined, profile()).pace).toBe('balanced');
  });
});

describe('traveller composition overrides pace', () => {
  it('gentles an active day when travelling with children', () => {
    const active = deriveTravelBehaviour(profile(['fast-paced']), {
      travellers: { adults: 2, children: 2, seniors: 0, mobilityNeeds: [] },
    });
    const constrained = applyTravellerConstraints(active);
    expect(constrained.maxMainActivitiesPerDay).toBeLessThanOrEqual(3);
    expect(constrained.comfort.requireRestAfterLongTravel).toBe(true);
  });

  it('caps walking hard when a mobility need is declared', () => {
    const constrained = applyTravellerConstraints(deriveTravelBehaviour(profile(['fast-paced']), {
      travellers: { adults: 1, children: 0, seniors: 0, mobilityNeeds: ['wheelchair'] },
    }));
    expect(constrained.walking.maximumDailyMinutes).toBeLessThanOrEqual(45);
    expect(constrained.comfort.minimumTransitionBufferMinutes).toBeGreaterThanOrEqual(25);
  });

  it('leaves an unconstrained party untouched', () => {
    const behaviour = deriveTravelBehaviour(profile(['fast-paced']));
    expect(applyTravellerConstraints(behaviour)).toBe(behaviour);
  });
});

describe('pace ordering and description', () => {
  it('ranks paces from calm to intense', () => {
    expect(paceRank('very-relaxed')).toBeLessThan(paceRank('balanced'));
    expect(paceRank('balanced')).toBeLessThan(paceRank('intensive'));
  });

  it('describes the plan in plain language', () => {
    const summary = describePace(deriveTravelBehaviour(profile(['calm'])));
    expect(summary).toContain('Relaxed');
    expect(summary).toMatch(/\d main stops? a day/);
  });
});
