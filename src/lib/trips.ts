import type { Itinerary } from '../data';

export type TripStatus = 'active' | 'archived';

export interface TripSummary {
  id: string;
  title: string;
  description: string;
  status: TripStatus;
  updatedAt: string;
  dayCount: number;
  cityCount: number;
}

export const createTripId = () => `trip-${crypto.randomUUID()}`;

export const createBlankItinerary = (id = createTripId()): Itinerary => ({
  id,
  name: 'New Trip',
  cities: [],
  description: 'Start with a blank travel handbook and shape every day your way.',
  days: [],
});

export const toTripSummary = (itinerary: Itinerary, updatedAt = new Date().toISOString()): TripSummary => ({
  id: itinerary.id,
  title: itinerary.name || 'Untitled trip',
  description: itinerary.description || 'A new travel handbook.',
  status: 'active',
  updatedAt,
  dayCount: itinerary.days.length,
  cityCount: itinerary.cities.length,
});

