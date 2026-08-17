/**
 * Arrival settling and departure lead must stay one product policy.
 * destinationPlanner and the flight-aware proposal engine import the same
 * constants; neither may keep a private copy that can drift.
 */
import { describe, expect, it } from 'vitest';
import {
  ARRIVAL_SETTLING_MINUTES,
  DEPARTURE_LEAD_MINUTES,
} from '../../supabase/functions/_shared/itineraryEdgeTiming';
import {
  ARRIVAL_SETTLING_MINUTES as proposalArrivalSettling,
  DEPARTURE_LEAD_MINUTES as proposalDepartureLead,
} from '../../supabase/functions/_shared/itineraryProposal';
import { shapeTripEdge } from './destinationPlanner';
import { toMinutes, toTime } from './humanScheduler';

describe('shared itinerary edge timing policy', () => {
  it('keeps the existing arrival settling and departure lead values', () => {
    expect(ARRIVAL_SETTLING_MINUTES).toBe(120);
    expect(DEPARTURE_LEAD_MINUTES).toBe(210);
  });

  it('is the same export the flight-aware planner consumes', () => {
    expect(proposalArrivalSettling).toBe(ARRIVAL_SETTLING_MINUTES);
    expect(proposalDepartureLead).toBe(DEPARTURE_LEAD_MINUTES);
  });

  it('is the same policy destinationPlanner uses to shape trip edges', () => {
    const arrivalTime = '11:00';
    const departureTime = '20:00';
    const firstDay = shapeTripEdge(0, 4, { arrivalTime });
    const lastDay = shapeTripEdge(3, 4, { departureTime });

    expect(firstDay.startTimeOverride).toBe(toTime(toMinutes(arrivalTime) + ARRIVAL_SETTLING_MINUTES));
    expect(lastDay.returnTimeOverride).toBe(toTime(toMinutes(departureTime) - DEPARTURE_LEAD_MINUTES));
  });
});
