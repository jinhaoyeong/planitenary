import type { DayPhoto, Itinerary } from '../data';
import {
  HISTORY_SOFT_LIMIT_BYTES,
  approximateEntryBytes,
  safeGetItem,
  safeRemoveItem,
  safeSetItem,
  safeSetItemWithBudget,
} from './safeLocalStorage';

/**
 * Recovery history is a convenience, not a record. It used to keep 30 complete
 * itinerary snapshots per key, which is how a single deleted trip left ~4 MB
 * behind and exhausted the origin quota. Server Change History is the real
 * record; this cache stays small and is additionally capped by bytes.
 */
const HISTORY_LIMIT = 5;

interface LocalTripEntry {
  id: string;
  updatedAt: string;
}

const getLocalTripsKey = (userId: string) => `local-trips-${userId}`;

const readLocalTrips = (userId: string): LocalTripEntry[] => {
  try {
    const parsed = JSON.parse(safeGetItem(getLocalTripsKey(userId)) || '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is LocalTripEntry =>
      Boolean(entry && typeof entry === 'object' && typeof (entry as LocalTripEntry).id === 'string')
    );
  } catch {
    return [];
  }
};

export const listLocalTrips = (userId: string): LocalTripEntry[] =>
  readLocalTrips(userId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

export const upsertLocalTrip = (userId: string, itinerary: Pick<Itinerary, 'id'>) => {
  const entries = readLocalTrips(userId).filter((entry) => entry.id !== itinerary.id);
  entries.push({ id: itinerary.id, updatedAt: new Date().toISOString() });
  safeSetItem(getLocalTripsKey(userId), JSON.stringify(entries));
};

export const removeLocalTrip = (userId: string, tripId: string) => {
  const entries = readLocalTrips(userId).filter((entry) => entry.id !== tripId);
  safeSetItem(getLocalTripsKey(userId), JSON.stringify(entries));
};

interface StorageHistoryEntry {
  savedAt: string;
  raw: string;
}

const getHistoryKey = (key: string) => `${key}-history`;

const scoreParsedValue = (value: unknown): number => {
  if (value === null || value === undefined) return 0;
  if (Array.isArray(value)) {
    return value.reduce((sum, item) => sum + scoreParsedValue(item), value.length * 5);
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.entries(record).reduce((sum, [, child]) => sum + scoreParsedValue(child), Object.keys(record).length);
  }
  if (typeof value === 'string') return value.trim().length > 0 ? 1 : 0;
  if (typeof value === 'number') return Number.isFinite(value) ? 1 : 0;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return 0;
};

const scoreRawSnapshot = (raw: string | null): number => {
  if (!raw) return 0;
  try {
    return scoreParsedValue(JSON.parse(raw));
  } catch {
    return 0;
  }
};

const parseHistory = (key: string): StorageHistoryEntry[] => {
  const raw = safeGetItem(getHistoryKey(key));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as StorageHistoryEntry[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry) => entry && typeof entry.raw === 'string' && typeof entry.savedAt === 'string');
  } catch {
    return [];
  }
};

const writeHistory = (key: string, entries: StorageHistoryEntry[]) => {
  const historyKey = getHistoryKey(key);

  if (entries.length === 0) {
    safeRemoveItem(historyKey);
    return;
  }

  // History is a recovery aid, not the primary itinerary. It is bounded by
  // bytes before it is ever offered to the browser, so a photo-rich trip
  // cannot quietly consume the origin quota one snapshot at a time.
  const withinByteBudget = (size: number): boolean => {
    const serialized = JSON.stringify(entries.slice(0, size));
    return approximateEntryBytes(historyKey, serialized) <= HISTORY_SOFT_LIMIT_BYTES;
  };

  const sizes = [HISTORY_LIMIT, 3, 1].filter((size) => size <= entries.length);
  for (const size of sizes) {
    if (!withinByteBudget(size)) continue;
    if (safeSetItem(historyKey, JSON.stringify(entries.slice(0, size))).ok) return;
  }

  // Either every window is too large or the browser is full. History is the
  // first thing Planitenary gives up; the primary value matters more.
  safeRemoveItem(historyKey);
};

const pushHistorySnapshot = (key: string, raw: string) => {
  const history = parseHistory(key);
  if (history[0]?.raw === raw) return;
  history.unshift({ savedAt: new Date().toISOString(), raw });
  writeHistory(key, history);
};

const getRestoreCandidateRaw = (key: string): string | null => {
  const backupRaw = safeGetItem(`${key}-backup`);
  const history = parseHistory(key);
  const candidates = [backupRaw, ...history.map((entry) => entry.raw)].filter((raw): raw is string => typeof raw === 'string');
  if (candidates.length === 0) return null;

  const uniqueCandidates = candidates.filter((candidate, index) => candidates.indexOf(candidate) === index);
  let bestRaw = uniqueCandidates[0];
  let bestScore = scoreRawSnapshot(bestRaw);

  for (const candidate of uniqueCandidates.slice(1)) {
    const score = scoreRawSnapshot(candidate);
    if (score > bestScore) {
      bestScore = score;
      bestRaw = candidate;
    }
  }

  return bestRaw;
};

export interface StorageLoadOptions<T> {
  /**
   * A caller may identify a recovery snapshot that is more complete than a
   * still-valid primary. The default remains deliberately primary-first: a
   * shorter itinerary is still a legitimate user edit and must not be
   * replaced by an older snapshot just because it scores higher.
   */
  preferRecovery?: (primary: T, recovery: T) => boolean;
}

export const loadFromStorage = <T>(key: string, options?: StorageLoadOptions<T>): T | null => {
  const parse = (raw: string | null): T | null => {
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  };

  const primary = parse(safeGetItem(key));
  if (primary && !options?.preferRecovery) return primary;

  const backupRaw = getRestoreCandidateRaw(key);
  const backup = parse(backupRaw);

  if (primary && (!backup || !options?.preferRecovery || !options.preferRecovery(primary, backup))) {
    return primary;
  }
  if (!backup) return null;

  // Reading must never write its way into a crash. Promoting the recovery
  // snapshot back to the primary slot is an optimisation; on a full origin it
  // simply does not happen and the caller still receives the recovered value.
  safeSetItem(key, backupRaw as string);
  return backup;
};

export const saveToStorage = <T>(key: string, value: T) => {
  const serialized = JSON.stringify(value);
  const currentRaw = safeGetItem(key);

  if (currentRaw && currentRaw !== serialized) {
    // Preserve the previous good value as the immediate restore target.
    safeSetItem(`${key}-backup`, currentRaw);
    pushHistorySnapshot(key, currentRaw);
  } else if (!safeGetItem(`${key}-backup`)) {
    safeSetItem(`${key}-backup`, serialized);
  }

  if (safeSetItemWithBudget(key, serialized, { protectedKeys: [`${key}-backup`] }).ok) return;

  // Recovery metadata is optional. Drop this key's own backup and history and
  // retry once, so a growing itinerary cannot fail to save merely because its
  // recovery data occupied the remaining browser quota.
  safeRemoveItem(getHistoryKey(key));
  safeRemoveItem(`${key}-backup`);
  safeSetItem(key, serialized);

  // If that still failed the value remains in memory and the server stays
  // authoritative. Persistence is best-effort and never crashes React.
};

export const writeRawToStorage = (key: string, raw: string | null, options?: { preserveCurrent?: boolean }) => {
  const preserveCurrent = options?.preserveCurrent ?? true;
  const currentRaw = safeGetItem(key);

  if (preserveCurrent && currentRaw && currentRaw !== raw) {
    safeSetItem(`${key}-backup`, currentRaw);
    pushHistorySnapshot(key, currentRaw);
  }

  if (raw === null) {
    safeRemoveItem(key);
    // Clearing without preserving the current value is a deletion, not an
    // edit. Leaving the backup and history behind is exactly what stranded
    // multi-megabyte snapshots for trips that no longer exist.
    if (!preserveCurrent) {
      safeRemoveItem(`${key}-backup`);
      safeRemoveItem(getHistoryKey(key));
    }
    return;
  }

  if (!safeGetItem(`${key}-backup`)) {
    safeSetItem(`${key}-backup`, raw);
  }

  safeSetItemWithBudget(key, raw, { protectedKeys: [`${key}-backup`] });
};

export const forceRestoreFromBackup = (key: string) => {
  const backupRaw = getRestoreCandidateRaw(key);
  if (!backupRaw) return false;
  return safeSetItem(key, backupRaw).ok;
};

export const forceRestoreTripData = (itineraryId: string) => {
  const keys = [
    `itinerary-${itineraryId}`,
    `budget-${itineraryId}`,
    `checklist-data-${itineraryId}`,
    `drafts-${itineraryId}`
  ];
  return keys.reduce((count, key) => count + (forceRestoreFromBackup(key) ? 1 : 0), 0);
};

export type RestoreDatasetId = 'itinerary' | 'budget' | 'checklist' | 'drafts' | 'photos';

export interface RestoreDatasetPreview {
  id: RestoreDatasetId;
  label: string;
  key: string;
  hasBackup: boolean;
  hasPrimary: boolean;
  changed: boolean;
  backupSummary: string;
  primarySummary: string;
  historyCount: number;
}

const getTripStorageKeyMap = (itineraryId: string): Record<RestoreDatasetId, string> => ({
  itinerary: `itinerary-${itineraryId}`,
  budget: `budget-${itineraryId}`,
  checklist: `checklist-data-${itineraryId}`,
  drafts: `drafts-${itineraryId}`,
  photos: `photos-${itineraryId}`
});

const summarizeRaw = (raw: string | null): string => {
  if (!raw) return 'No data';
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return `${parsed.length} item(s)`;
    if (parsed && typeof parsed === 'object') {
      const objectValue = parsed as Record<string, unknown>;
      if (Array.isArray(objectValue.days)) return `${objectValue.days.length} day(s)`;
      if (Array.isArray(objectValue.items)) return `${objectValue.items.length} item(s)`;
      return `${Object.keys(objectValue).length} field(s)`;
    }
    return 'Valid data';
  } catch {
    return 'Corrupted data';
  }
};

const summarizePhotosSnapshot = (raw: string | null): string => {
  if (!raw) return 'No data';
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const days = Object.values(parsed);
    const photoCount = days.reduce<number>((count, value) => count + (Array.isArray(value) ? value.length : 0), 0);
    const dayCount = days.filter((value) => Array.isArray(value) && value.length > 0).length;
    return `${photoCount} photo(s), ${dayCount} day(s)`;
  } catch {
    return 'Corrupted data';
  }
};

export const createLatestBackup = async (itineraryId: string) => {
  const keyMap = getTripStorageKeyMap(itineraryId);
  for (const [datasetId, key] of Object.entries(keyMap) as [RestoreDatasetId, string][]) {
    if (datasetId === 'photos') continue;
    const current = safeGetItem(key);
    if (current === null) {
      safeRemoveItem(`${key}-backup`);
    } else {
      safeSetItem(`${key}-backup`, current);
      pushHistorySnapshot(key, current);
    }
  }
  try {
    const { getAllPhotosForItinerary } = await import('./photoStorage');
    const photos = await getAllPhotosForItinerary(itineraryId);
    const serialized = JSON.stringify(photos);
    safeSetItem(keyMap.photos, serialized);
    safeSetItem(`${keyMap.photos}-backup`, serialized);
    pushHistorySnapshot(keyMap.photos, serialized);
    return true;
  } catch {
    return false;
  }
};

export const getRestorePreview = async (itineraryId: string): Promise<RestoreDatasetPreview[]> => {
  const keyMap = getTripStorageKeyMap(itineraryId);
  const labels: Record<RestoreDatasetId, string> = {
    itinerary: 'Itinerary',
    budget: 'Budget',
    checklist: 'Checklist',
    drafts: 'Draft Ideas',
    photos: 'Photos'
  };

  const photosKey = keyMap.photos;
  const photosPrimaryRaw = safeGetItem(photosKey);
  if (!photosPrimaryRaw) {
    try {
      const { getAllPhotosForItinerary } = await import('./photoStorage');
      const photos = await getAllPhotosForItinerary(itineraryId);
      if (Object.keys(photos).length > 0) {
        safeSetItem(photosKey, JSON.stringify(photos));
      }
    } catch {
      // keep preview available for non-photo datasets
    }
  }

  return (Object.keys(keyMap) as RestoreDatasetId[]).map((id) => {
    const key = keyMap[id];
    const primary = safeGetItem(key);
    const backup = getRestoreCandidateRaw(key);
    const historyCount = parseHistory(key).length;
    const summarizer = id === 'photos' ? summarizePhotosSnapshot : summarizeRaw;
    return {
      id,
      label: labels[id],
      key,
      hasBackup: Boolean(backup),
      hasPrimary: Boolean(primary),
      changed: primary !== backup,
      backupSummary: summarizer(backup),
      primarySummary: summarizer(primary),
      historyCount
    };
  });
};

export const restoreSelectedTripData = async (itineraryId: string, datasets: RestoreDatasetId[]) => {
  const keyMap = getTripStorageKeyMap(itineraryId);
  let count = datasets.reduce((total, id) => {
    if (id === 'photos') return total;
    return total + (forceRestoreFromBackup(keyMap[id]) ? 1 : 0);
  }, 0);

  if (datasets.includes('photos')) {
    const restored = forceRestoreFromBackup(keyMap.photos);
    if (restored) {
      try {
        const raw = safeGetItem(keyMap.photos);
        const parsed = raw ? (JSON.parse(raw) as Record<number, DayPhoto[]>) : {};
        const { restorePhotosForItinerary } = await import('./photoStorage');
        await restorePhotosForItinerary(itineraryId, parsed);
        count += 1;
      } catch {
        // photos restore failed; keep other restores intact
      }
    }
  }

  return count;
};

export const createRestoreSnapshot = async (itineraryId: string) => {
  const keyMap = getTripStorageKeyMap(itineraryId);
  try {
    const { getAllPhotosForItinerary } = await import('./photoStorage');
    const photos = await getAllPhotosForItinerary(itineraryId);
    safeSetItem(keyMap.photos, JSON.stringify(photos));
  } catch {
    // continue snapshot for non-photo data
  }
  const snapshot: Record<string, string | null> = {};
  for (const key of Object.values(keyMap)) {
    snapshot[key] = safeGetItem(key);
    snapshot[`${key}-backup`] = safeGetItem(`${key}-backup`);
  }
  const snapshotKey = `restore-snapshot-${itineraryId}`;
  safeSetItem(snapshotKey, JSON.stringify({ createdAt: new Date().toISOString(), data: snapshot }));
  return snapshotKey;
};

export const restoreLastSnapshot = async (itineraryId: string) => {
  const snapshotKey = `restore-snapshot-${itineraryId}`;
  const raw = safeGetItem(snapshotKey);
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as { data?: Record<string, string | null> };
    const data = parsed.data || {};
    for (const [key, value] of Object.entries(data)) {
      if (value === null) safeRemoveItem(key);
      else safeSetItem(key, value);
    }
    const photosKey = `photos-${itineraryId}`;
    const photosRaw = safeGetItem(photosKey);
    if (photosRaw) {
      try {
        const { restorePhotosForItinerary } = await import('./photoStorage');
        const parsedPhotos = JSON.parse(photosRaw) as Record<number, DayPhoto[]>;
        await restorePhotosForItinerary(itineraryId, parsedPhotos);
      } catch {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
};
