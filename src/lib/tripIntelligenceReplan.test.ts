import { describe, expect, it } from 'vitest';
import type { Itinerary } from '../data';
import { relaxTrip, replanDay } from './tripIntelligence';
import type { TripProfile } from './tripProfile';

const profile = (): TripProfile => ({
  version: 1,
  destinations: [{ id: 'melbourne', city: 'Melbourne', country: 'Australia', countryCode: 'AU' }],
  dayCount: 1,
  tripTypes: [],
  styles: [],
  moods: [],
  budgetTier: 'mid-range',
  transport: ['walking'],
  stays: ['hotel'],
  hiddenGems: false,
  homeCurrency: 'MYR',
  tripCurrency: 'AUD',
  brandAfterDestination: false,
  applyVisualIdentity: false,
  createdAt: '2026-08-04T00:00:00.000Z',
});

const itinerary = (): Itinerary => ({
  id: 'trip-1',
  name: 'Melbourne',
  description: '',
  cities: ['Melbourne'],
  days: [{
    day: 1,
    date: '2026-08-05',
    city: 'Melbourne',
    title: 'CBD',
    activities: [
      { id: 'locked', kind: 'reservation', time: '18:00', durationMinutes: 90, name: 'Dinner', description: '', type: 'food', locked: true, lockedFields: ['schedule'] },
      { id: 'gallery', kind: 'place', time: '09:00', durationMinutes: 90, name: 'Gallery', description: '', type: 'culture', indoorOutdoor: 'indoor', coordinates: [-37.81, 144.96] },
      { id: 'garden', kind: 'place', time: '11:00', durationMinutes: 90, name: 'Garden', description: '', type: 'nature', indoorOutdoor: 'outdoor', coordinates: [-37.82, 144.97] },
    ],
  }],
  revision: 2,
  schemaVersion: 2,
});

describe('replanDay', () => {
  it('shifts unlocked activities while preserving a locked booking', () => {
    const proposal = replanDay(itinerary(), profile(), 1, { kind: 'late-start', minutes: 60 });
    const day = proposal.afterDays[0];
    expect(day.activities.find((activity) => activity.id === 'locked')?.time).toBe('18:00');
    expect(day.activities.find((activity) => activity.id === 'gallery')?.time).not.toBe('09:00');
    expect(proposal.changes.some((change) => change.protected)).toBe(true);
  });

  it('brings indoor activities ahead of outdoor activities for rain', () => {
    const proposal = replanDay(itinerary(), profile(), 1, { kind: 'rain' });
    const activities = proposal.afterDays[0].activities.filter((activity) => activity.kind === 'place');
    expect(activities[0].id).toBe('gallery');
  });

  it('shifts unlocked activities after a route delay', () => {
    const proposal = replanDay(itinerary(), profile(), 1, { kind: 'route-delay', minutes: 30 });
    expect(proposal.reason).toContain('30-minute route delay');
    expect(proposal.changes.length).toBeGreaterThan(0);
  });

  it('creates a roomier reversible preview for relaxed planning', () => {
    const source = itinerary();
    const proposal = relaxTrip(source, profile());
    expect(proposal.reason).toContain('relaxed preview');
    expect(proposal.baseItineraryRevision).toBe(source.revision || 0);
    expect(proposal.changes.length).toBeGreaterThan(0);
  });
});
