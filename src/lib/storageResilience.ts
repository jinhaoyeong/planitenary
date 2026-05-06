import type { DayPhoto, Itinerary } from '../data';

const HISTORY_LIMIT = 30;

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
  const raw = localStorage.getItem(getHistoryKey(key));
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
  if (entries.length === 0) {
    localStorage.removeItem(getHistoryKey(key));
    return;
  }
  localStorage.setItem(getHistoryKey(key), JSON.stringify(entries.slice(0, HISTORY_LIMIT)));
};

const pushHistorySnapshot = (key: string, raw: string) => {
  const history = parseHistory(key);
  if (history[0]?.raw === raw) return;
  history.unshift({ savedAt: new Date().toISOString(), raw });
  writeHistory(key, history);
};

const getRestoreCandidateRaw = (key: string): string | null => {
  const backupRaw = localStorage.getItem(`${key}-backup`);
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

export const loadFromStorage = <T>(key: string): T | null => {
  const parse = (raw: string | null): T | null => {
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  };

  const primary = parse(localStorage.getItem(key));
  if (primary) return primary;

  const backupRaw = getRestoreCandidateRaw(key);
  const backup = parse(backupRaw);
  if (!backup) return null;

  localStorage.setItem(key, backupRaw as string);
  return backup;
};

export const saveToStorage = <T>(key: string, value: T) => {
  const serialized = JSON.stringify(value);
  const currentRaw = localStorage.getItem(key);

  if (currentRaw && currentRaw !== serialized) {
    // Preserve the previous good value as the immediate restore target.
    localStorage.setItem(`${key}-backup`, currentRaw);
    pushHistorySnapshot(key, currentRaw);
  } else if (!localStorage.getItem(`${key}-backup`)) {
    localStorage.setItem(`${key}-backup`, serialized);
  }

  localStorage.setItem(key, serialized);
};

interface LocalTripIndexEntry {
  id: string;
  updatedAt: string;
}

const getLocalTripIndexKey = (ownerId: string) => `travel-handbook-trip-index-${ownerId}`;

export const listLocalTrips = (ownerId: string): LocalTripIndexEntry[] => {
  const raw = localStorage.getItem(getLocalTripIndexKey(ownerId));
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as LocalTripIndexEntry[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => typeof item?.id === 'string' && typeof item?.updatedAt === 'string');
  } catch {
    return [];
  }
};

export const upsertLocalTrip = (ownerId: string, itinerary: Itinerary) => {
  const current = listLocalTrips(ownerId).filter((item) => item.id !== itinerary.id);
  const next = [{ id: itinerary.id, updatedAt: new Date().toISOString() }, ...current];
  localStorage.setItem(getLocalTripIndexKey(ownerId), JSON.stringify(next));
};

export const removeLocalTrip = (ownerId: string, itineraryId: string) => {
  const next = listLocalTrips(ownerId).filter((item) => item.id !== itineraryId);
  localStorage.setItem(getLocalTripIndexKey(ownerId), JSON.stringify(next));
};

export const writeRawToStorage = (key: string, raw: string | null, options?: { preserveCurrent?: boolean }) => {
  const preserveCurrent = options?.preserveCurrent ?? true;
  const currentRaw = localStorage.getItem(key);

  if (preserveCurrent && currentRaw && currentRaw !== raw) {
    localStorage.setItem(`${key}-backup`, currentRaw);
    pushHistorySnapshot(key, currentRaw);
  }

  if (raw === null) {
    localStorage.removeItem(key);
    return;
  }

  if (!localStorage.getItem(`${key}-backup`)) {
    localStorage.setItem(`${key}-backup`, raw);
  }

  localStorage.setItem(key, raw);
};

export const forceRestoreFromBackup = (key: string) => {
  const backupRaw = getRestoreCandidateRaw(key);
  if (!backupRaw) return false;
  localStorage.setItem(key, backupRaw);
  return true;
};

export const forceRestoreTripData = (itineraryId: string) => {
  const keys = [
    `itinerary-${itineraryId}`,
    `budget-${itineraryId}`,
    'checklist-data',
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
  checklist: 'checklist-data',
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
    const current = localStorage.getItem(key);
    if (current === null) {
      localStorage.removeItem(`${key}-backup`);
    } else {
      localStorage.setItem(`${key}-backup`, current);
      pushHistorySnapshot(key, current);
    }
  }
  try {
    const { getAllPhotosForItinerary } = await import('./photoStorage');
    const photos = await getAllPhotosForItinerary(itineraryId);
    const serialized = JSON.stringify(photos);
    localStorage.setItem(keyMap.photos, serialized);
    localStorage.setItem(`${keyMap.photos}-backup`, serialized);
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
  const photosPrimaryRaw = localStorage.getItem(photosKey);
  if (!photosPrimaryRaw) {
    try {
      const { getAllPhotosForItinerary } = await import('./photoStorage');
      const photos = await getAllPhotosForItinerary(itineraryId);
      if (Object.keys(photos).length > 0) {
        localStorage.setItem(photosKey, JSON.stringify(photos));
      }
    } catch {
      // keep preview available for non-photo datasets
    }
  }

  return (Object.keys(keyMap) as RestoreDatasetId[]).map((id) => {
    const key = keyMap[id];
    const primary = localStorage.getItem(key);
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
        const raw = localStorage.getItem(keyMap.photos);
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
    localStorage.setItem(keyMap.photos, JSON.stringify(photos));
  } catch {
    // continue snapshot for non-photo data
  }
  const snapshot: Record<string, string | null> = {};
  for (const key of Object.values(keyMap)) {
    snapshot[key] = localStorage.getItem(key);
    snapshot[`${key}-backup`] = localStorage.getItem(`${key}-backup`);
  }
  const snapshotKey = `restore-snapshot-${itineraryId}`;
  localStorage.setItem(snapshotKey, JSON.stringify({ createdAt: new Date().toISOString(), data: snapshot }));
  return snapshotKey;
};

export const restoreLastSnapshot = async (itineraryId: string) => {
  const snapshotKey = `restore-snapshot-${itineraryId}`;
  const raw = localStorage.getItem(snapshotKey);
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as { data?: Record<string, string | null> };
    const data = parsed.data || {};
    for (const [key, value] of Object.entries(data)) {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    }
    const photosKey = `photos-${itineraryId}`;
    const photosRaw = localStorage.getItem(photosKey);
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
