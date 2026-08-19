import { describe, expect, it } from 'vitest';
import {
  TRIP_REMOTE_DELETE_TABLES,
  tripStorageCleanupKeys,
  tripStorageKeys,
} from './tripDeletion';

describe('trip deletion contracts', () => {
  it('only targets resources present in the deployed schema', () => {
    expect(TRIP_REMOTE_DELETE_TABLES).toEqual([
      'draft_items',
      'budgets',
      'checklists',
      'trip_documents',
      'day_photos',
      'itineraries',
      'trip_registry',
    ]);
    expect(TRIP_REMOTE_DELETE_TABLES).not.toContain('trip_settings');
  });

  it('cleans every itinerary key shape, including the legacy unscoped one', () => {
    const keys = tripStorageKeys('user-1', 'trip-7');
    // Handbook still writes the unscoped key; leaving it behind is what
    // stranded multi-megabyte snapshots for trips that no longer exist.
    expect(keys).toContain('itinerary-user-1-trip-7');
    expect(keys).toContain('itinerary-trip-7');
    expect(keys).toContain('itinerary-demo-trip-7');
  });

  it('cleans the primary, backup and history slot of every trip-scoped key', () => {
    const cleanup = tripStorageCleanupKeys('user-1', 'trip-7');
    for (const base of tripStorageKeys('user-1', 'trip-7')) {
      expect(cleanup).toContain(base);
      expect(cleanup).toContain(`${base}-backup`);
      expect(cleanup).toContain(`${base}-history`);
    }
    expect(cleanup).toContain('budget-trip-7-cleared');
  });

  it('never reaches outside the trip being deleted', () => {
    const cleanup = tripStorageCleanupKeys('user-1', 'trip-7');
    expect(cleanup.every((key) => key.includes('trip-7'))).toBe(true);
    expect(cleanup).not.toContain('itinerary-user-1-trip-8');
  });
});
