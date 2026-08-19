/**
 * Conservative reclamation of trip-scoped browser storage whose trip no longer
 * belongs to the signed-in owner.
 *
 * Deleting a trip on one device leaves its cache behind on every other device.
 * Those snapshots are what filled the origin quota in production. Cleanup is
 * deliberately timid: a key is removed only when its trip id parses exactly and
 * is provably not owned. Anything ambiguous is kept.
 */

import {
  STORAGE_KEY_SUFFIXES,
  TRIP_SCOPED_KEY_PREFIXES,
  approximateEntryBytes,
  listAppOwnedKeys,
  measureAppStorage,
  safeGetItem,
  safeRemoveItem,
} from './safeLocalStorage';

/** Trip ids are minted as `trip-<uuid>`; nothing else is treated as one. */
const TRIP_ID_PREFIX = 'trip-';

const stripSuffix = (value: string): string => {
  for (const suffix of STORAGE_KEY_SUFFIXES) {
    if (value.endsWith(suffix)) return value.slice(0, -suffix.length);
  }
  return value;
};

/**
 * Extracts the trip id a key belongs to, or `null` when the key does not parse
 * unambiguously. Never guesses and never substring-matches a trip id.
 */
export const parseTripIdFromKey = (key: string, userId: string): string | null => {
  const prefix = TRIP_SCOPED_KEY_PREFIXES.find((candidate) => key.startsWith(candidate));
  if (!prefix) return null;

  const remainder = stripSuffix(key.slice(prefix.length));
  if (!remainder) return null;

  // `itinerary-<userId>-<tripId>` — the current user-scoped shape.
  if (userId && remainder.startsWith(`${userId}-`)) {
    const scoped = remainder.slice(userId.length + 1);
    return scoped.startsWith(TRIP_ID_PREFIX) ? scoped : null;
  }

  // `itinerary-demo-<tripId>` — demo sessions.
  if (remainder.startsWith('demo-')) {
    const demo = remainder.slice('demo-'.length);
    return demo.startsWith(TRIP_ID_PREFIX) ? demo : null;
  }

  // `budget-<tripId>` and the unscoped legacy `itinerary-<tripId>`.
  return remainder.startsWith(TRIP_ID_PREFIX) ? remainder : null;
};

export interface OrphanPruneResult {
  removed: string[];
  inspected: number;
}

/**
 * Removes storage for trips the owner no longer has.
 *
 * `ownedTripIds` must list every trip the account still holds, archived ones
 * included — an empty or partial registry would otherwise look like "own
 * nothing" and discard live caches. When it is empty, nothing is removed.
 */
export const pruneOrphanTripStorage = (
  userId: string,
  ownedTripIds: readonly string[],
): OrphanPruneResult => {
  const owned = new Set(ownedTripIds);
  if (owned.size === 0) return { removed: [], inspected: 0 };

  const keys = listAppOwnedKeys();
  const removed: string[] = [];
  let freedBytes = 0;

  for (const key of keys) {
    const tripId = parseTripIdFromKey(key, userId);
    if (!tripId) continue;
    if (owned.has(tripId)) continue;
    const bytes = approximateEntryBytes(key, safeGetItem(key) ?? '');
    if (!safeRemoveItem(key)) continue;
    removed.push(key);
    freedBytes += bytes;
  }

  if (import.meta.env.DEV && removed.length > 0) {
    // Names and sizes only — never stored contents, never auth material.
    console.info('[storage] reclaimed orphaned trip cache', {
      keys: removed,
      freedBytes,
      remainingBytes: measureAppStorage().totalBytes,
    });
  }

  return { removed, inspected: keys.length };
};
