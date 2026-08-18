import { describe, expect, it } from 'vitest';
import {
  TRIP_REMOTE_DELETE_TABLES,
  tripStorageCleanupKeys,
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

  it('cleans the user-scoped itinerary and all resilient local snapshots', () => {
    expect(tripStorageCleanupKeys('user-1', 'trip-7')).toEqual([
      'itinerary-user-1-trip-7',
      'itinerary-user-1-trip-7-backup',
      'itinerary-user-1-trip-7-history',
      'budget-trip-7',
      'budget-trip-7-backup',
      'budget-trip-7-history',
      'budget-meta-trip-7',
      'budget-meta-trip-7-backup',
      'budget-meta-trip-7-history',
      'checklist-data-trip-7',
      'checklist-data-trip-7-backup',
      'checklist-data-trip-7-history',
      'drafts-trip-7',
      'drafts-trip-7-backup',
      'drafts-trip-7-history',
      'trip-settings-trip-7',
      'trip-settings-trip-7-backup',
      'trip-settings-trip-7-history',
      'photos-trip-7',
      'photos-trip-7-backup',
      'photos-trip-7-history',
      'budget-trip-7-cleared',
    ]);
  });
});
