/**
 * Existing itinerary edge timing policy.
 *
 * Arrival settling and departure lead are product rules the destination
 * planner and the flight-aware proposal engine must share. They are not
 * guesses, environment knobs, or per-trip configuration.
 */

/** Getting out of an airport and to somewhere the day can start. */
export const ARRIVAL_SETTLING_MINUTES = 120;
/** Leaving for the airport: check-in, security, and not running for it. */
export const DEPARTURE_LEAD_MINUTES = 210;
