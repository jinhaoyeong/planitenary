import { describe, expect, it } from 'vitest';
import { timezoneOffsetMinutes, timezoneShiftHours } from './timezones';

/** Southern-hemisphere summer, so daylight saving is active in Melbourne. */
const JANUARY = new Date('2027-01-15T12:00:00Z');
/** Northern-hemisphere summer, so Melbourne is on standard time.  */
const JULY = new Date('2026-07-15T12:00:00Z');

describe('reading a zone’s offset', () => {
  it('reads a whole-hour zone', () => {
    expect(timezoneOffsetMinutes('Asia/Tokyo', JULY)).toBe(540);
  });

  it('reads a half-hour zone', () => {
    expect(timezoneOffsetMinutes('Asia/Kolkata', JULY)).toBe(330);
  });

  it('reads UTC as zero rather than as unknown', () => {
    expect(timezoneOffsetMinutes('UTC', JULY)).toBe(0);
  });

  it('follows daylight saving rather than assuming a fixed offset', () => {
    // Melbourne is +11 in January and +10 in July. A trip planned across the
    // boundary would otherwise be an hour out.
    expect(timezoneOffsetMinutes('Australia/Melbourne', JANUARY)).toBe(660);
    expect(timezoneOffsetMinutes('Australia/Melbourne', JULY)).toBe(600);
  });

  it('reports unknown for a zone it cannot read', () => {
    expect(timezoneOffsetMinutes('Not/AZone', JULY)).toBeNull();
    expect(timezoneOffsetMinutes(undefined, JULY)).toBeNull();
  });
});

describe('the shift a traveller actually feels', () => {
  it('measures a long-haul trip in the right direction', () => {
    // Kuala Lumpur to London in July: the destination is seven hours behind.
    expect(timezoneShiftHours('Europe/London', JULY, 'Asia/Kuala_Lumpur')).toBe(-7);
    expect(timezoneShiftHours('Asia/Kuala_Lumpur', JULY, 'Europe/London')).toBe(7);
  });

  it('is zero for a trip that stays on the same clock', () => {
    expect(timezoneShiftHours('Asia/Singapore', JULY, 'Asia/Kuala_Lumpur')).toBe(0);
  });

  it('rounds a half-hour zone to the nearest hour', () => {
    expect(timezoneShiftHours('Asia/Kolkata', JULY, 'UTC')).toBe(6);
  });

  it('says unknown rather than zero when a zone is missing', () => {
    // "No difference" and "no idea" must not share a value: the first means
    // plan normally, the second means do not adjust anything.
    expect(timezoneShiftHours(undefined, JULY, 'Asia/Kuala_Lumpur')).toBeUndefined();
    expect(timezoneShiftHours('Asia/Tokyo', JULY, 'Not/AZone')).toBeUndefined();
  });
});
