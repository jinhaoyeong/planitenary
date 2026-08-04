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

export const tripStorageKeys = (userId: string, tripId: string) => [
  `itinerary-${userId}-${tripId}`,
  `budget-${tripId}`,
  `checklist-data-${tripId}`,
  `drafts-${tripId}`,
  `trip-settings-${tripId}`,
  `photos-${tripId}`,
];

export const tripStorageCleanupKeys = (userId: string, tripId: string) =>
  tripStorageKeys(userId, tripId).flatMap((key) => [
    key,
    `${key}-backup`,
    `${key}-history`,
  ]);
