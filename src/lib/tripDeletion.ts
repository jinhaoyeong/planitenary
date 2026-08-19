/** Remote resources that are present in the deployed Supabase schema. */
export const TRIP_REMOTE_DELETE_TABLES = [
  'draft_items',
  'budgets',
  'checklists',
  'trip_documents',
  'day_photos',
  'itineraries',
  'trip_registry',
] as const;

/**
 * Every base key Planitenary may write for one trip.
 *
 * The itinerary cache has three historical shapes and all of them must be
 * reclaimed on delete. `Handbook` still writes the unscoped legacy key, and
 * demo sessions use their own namespace — cleaning only the current
 * user-scoped shape is what allowed multi-megabyte snapshots to survive a
 * deleted trip and eventually exhaust the origin quota.
 */
export const tripStorageKeys = (userId: string, tripId: string) => [
  `itinerary-${userId}-${tripId}`,
  `itinerary-${tripId}`,
  `itinerary-demo-${tripId}`,
  `budget-${tripId}`,
  `budget-meta-${tripId}`,
  `checklist-data-${tripId}`,
  `drafts-${tripId}`,
  `trip-settings-${tripId}`,
  `photos-${tripId}`,
  `restore-snapshot-${tripId}`,
];

export const tripStorageCleanupKeys = (userId: string, tripId: string) => [
  ...tripStorageKeys(userId, tripId).flatMap((key) => [
    key,
    `${key}-backup`,
    `${key}-history`,
  ]),
  `budget-${tripId}-cleared`,
];
