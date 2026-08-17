import { describe, expect, it } from 'vitest';
import {
  INVALID_FLIGHT_DURATION,
  MISSING_FLIGHT_DURATION,
  applyActivityDuration,
  durationFieldsFromMinutes,
  durationMinutesFromFields,
  formatFlightDuration,
} from './flightDuration';

describe('flight duration fields', () => {
  it('converts hours and minutes into durationMinutes', () => {
    expect(durationMinutesFromFields('2', '30')).toEqual({ ok: true, durationMinutes: 150 });
    expect(durationMinutesFromFields('0', '45')).toEqual({ ok: true, durationMinutes: 45 });
    expect(durationMinutesFromFields('1', '15')).toEqual({ ok: true, durationMinutes: 75 });
    expect(durationMinutesFromFields('12', '5')).toEqual({ ok: true, durationMinutes: 725 });
  });

  it('treats a blank hours field as zero when minutes are present', () => {
    expect(durationMinutesFromFields('', '45')).toEqual({ ok: true, durationMinutes: 45 });
  });

  it('hydrates durationMinutes back into hours and minutes', () => {
    expect(durationFieldsFromMinutes(150)).toEqual({ hours: '2', minutes: '30' });
    expect(durationFieldsFromMinutes(60)).toEqual({ hours: '1', minutes: '0' });
    expect(durationFieldsFromMinutes(45)).toEqual({ hours: '0', minutes: '45' });
  });

  it('leaves missing duration blank rather than inventing 60 minutes', () => {
    expect(durationFieldsFromMinutes(undefined)).toEqual({ hours: '', minutes: '' });
    expect(durationFieldsFromMinutes(0)).toEqual({ hours: '', minutes: '' });
  });

  it('rejects a missing duration without substituting a default', () => {
    expect(durationMinutesFromFields('', '')).toEqual({ ok: false, error: MISSING_FLIGHT_DURATION });
  });

  it('rejects zero, negative, and non-numeric duration', () => {
    expect(durationMinutesFromFields('0', '0')).toEqual({ ok: false, error: INVALID_FLIGHT_DURATION });
    expect(durationMinutesFromFields('-1', '0')).toEqual({ ok: false, error: INVALID_FLIGHT_DURATION });
    expect(durationMinutesFromFields('1', '-15')).toEqual({ ok: false, error: INVALID_FLIGHT_DURATION });
    expect(durationMinutesFromFields('abc', '10')).toEqual({ ok: false, error: INVALID_FLIGHT_DURATION });
    expect(durationMinutesFromFields('1.5', '0')).toEqual({ ok: false, error: INVALID_FLIGHT_DURATION });
    expect(durationMinutesFromFields('1', '90')).toEqual({ ok: false, error: INVALID_FLIGHT_DURATION });
  });

  it('formats a traveller-facing duration without exposing durationMinutes', () => {
    expect(formatFlightDuration(150)).toBe('2 hr 30 min');
    expect(formatFlightDuration(60)).toBe('1 hr');
    expect(formatFlightDuration(45)).toBe('45 min');
    expect(formatFlightDuration(undefined)).toBeUndefined();
  });
});

describe('applying duration to an activity', () => {
  it('writes durationMinutes only when the type is flight', () => {
    const flight = applyActivityDuration(
      { type: 'flight', time: '10:00', name: 'Arrival', description: '' },
      '2',
      '0',
    );
    expect(flight).toEqual({
      ok: true,
      activity: { type: 'flight', time: '10:00', name: 'Arrival', description: '', durationMinutes: 120 },
    });
  });

  it('does not require duration for a sight or food activity', () => {
    const sight = { type: 'sight', time: '11:00', name: 'Castle', description: '', durationMinutes: 90 };
    expect(applyActivityDuration(sight, '', '')).toEqual({ ok: true, activity: sight });
    const food = { type: 'food', time: '12:00', name: 'Lunch', description: '' };
    expect(applyActivityDuration(food, '', '')).toEqual({ ok: true, activity: food });
  });

  it('preserves an unchanged flight duration and writes a changed one', () => {
    const existing = { type: 'flight', time: '10:00', name: 'KIX → HND', description: '', durationMinutes: 150 };
    const fields = durationFieldsFromMinutes(existing.durationMinutes);
    expect(applyActivityDuration(existing, fields.hours, fields.minutes)).toEqual({
      ok: true,
      activity: existing,
    });
    expect(applyActivityDuration(existing, '3', '0')).toEqual({
      ok: true,
      activity: { ...existing, durationMinutes: 180 },
    });
  });
});
