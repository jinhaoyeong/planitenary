/**
 * Central guard for every browser `localStorage` touch.
 *
 * Chrome enforces a per-origin quota (~5 MB) that the application cannot raise.
 * The only correct defence is to treat local storage as an optional cache:
 * Planitenary must render, authenticate and reach the server even when writes
 * always fail. Nothing in here may throw into React render or hydration.
 */

export type StorageFailureReason = 'quota' | 'security' | 'unavailable' | 'unknown';

export type StorageWriteResult = { ok: true } | { ok: false; reason: StorageFailureReason };

/**
 * Planitenary keeps its own storage comfortably under the browser ceiling so a
 * full origin can never starve Supabase auth of the room it needs to persist a
 * session. This is a soft budget enforced by the app, not a browser limit.
 */
export const LOCAL_STORAGE_SOFT_LIMIT_BYTES = 3_000_000;

/** Optional history is capped by bytes as well as by entry count. */
export const HISTORY_SOFT_LIMIT_BYTES = 512_000;

/**
 * Key prefixes Planitenary owns and may prune. Auth, extension and unrelated
 * site keys are absent by construction — cleanup uses this allowlist and never
 * a wildcard sweep, so `sb-*` Supabase tokens can never be collected.
 */
export const TRIP_SCOPED_KEY_PREFIXES = [
  'itinerary-',
  // Ask Planitenary chat history, one entry per account+trip holding every
  // conversation for that trip. Listed so the orphan sweep reclaims it when a
  // trip is deleted on another device, the same way it reclaims that trip’s
  // itinerary and budget caches. `askChatHistory` bounds it before it gets
  // there, so one trip's chats cannot crowd out an auth token on their own.
  'ask-chat-',
  'budget-meta-',
  'budget-',
  'checklist-data-',
  'drafts-',
  'trip-settings-',
  'photos-',
  'restore-snapshot-',
] as const;

/** Suffixes appended to a base key by the resilience layer. */
export const STORAGE_KEY_SUFFIXES = ['-backup', '-history', '-cleared'] as const;

export const isQuotaExceededError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { name?: unknown; code?: unknown };
  return (
    candidate.name === 'QuotaExceededError' ||
    candidate.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    candidate.code === 22 ||
    candidate.code === 1014
  );
};

const classifyError = (error: unknown): StorageFailureReason => {
  if (isQuotaExceededError(error)) return 'quota';
  if (error && typeof error === 'object' && (error as { name?: unknown }).name === 'SecurityError') {
    return 'security';
  }
  return 'unknown';
};

/**
 * Reading `window.localStorage` itself throws in some privacy modes, so even
 * acquiring the handle is guarded.
 */
const getStorage = (): Storage | null => {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
};

/** UTF-16 code units are two bytes each; key names count toward the quota too. */
export const approximateEntryBytes = (key: string, value: string): number => (key.length + value.length) * 2;

export const safeGetItem = (key: string): string | null => {
  const storage = getStorage();
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
};

export const safeRemoveItem = (key: string): boolean => {
  const storage = getStorage();
  if (!storage) return false;
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
};

/**
 * Writes without ever throwing. Callers decide whether a failed cache write
 * matters; startup and hydration paths must simply ignore the result.
 */
export const safeSetItem = (key: string, value: string): StorageWriteResult => {
  const storage = getStorage();
  if (!storage) return { ok: false, reason: 'unavailable' };
  try {
    storage.setItem(key, value);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: classifyError(error) };
  }
};

const listKeys = (): string[] => {
  const storage = getStorage();
  if (!storage) return [];
  try {
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (typeof key === 'string') keys.push(key);
    }
    return keys;
  } catch {
    return [];
  }
};

export const isTripScopedKey = (key: string): boolean =>
  TRIP_SCOPED_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));

/** Account-scoped registries. Owned, measurable, but never trip-scoped. */
const ACCOUNT_KEY_PREFIXES = ['local-trips-', 'trip-registry-'] as const;

/** Every Planitenary-owned key currently present. Never includes auth keys. */
export const listAppOwnedKeys = (): string[] =>
  listKeys().filter(
    (key) => isTripScopedKey(key) || ACCOUNT_KEY_PREFIXES.some((prefix) => key.startsWith(prefix)),
  );

export interface StorageUsageEntry {
  key: string;
  bytes: number;
}

export interface StorageUsage {
  totalBytes: number;
  entries: StorageUsageEntry[];
}

/** Approximate footprint of Planitenary's own keys, largest first. */
export const measureAppStorage = (): StorageUsage => {
  const entries = listAppOwnedKeys()
    .map((key) => ({ key, bytes: approximateEntryBytes(key, safeGetItem(key) ?? '') }))
    .sort((a, b) => b.bytes - a.bytes);
  return {
    totalBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
    entries,
  };
};

const isOptionalKey = (key: string): boolean => key.endsWith('-history') || key.endsWith('-backup');

/**
 * Frees room by discarding Planitenary's own optional recovery data, largest
 * first. Primary caches and anything in `protectedKeys` are left alone, and no
 * key outside the owned allowlist is ever considered.
 */
export const pruneOptionalStorage = (options?: {
  protectedKeys?: readonly string[];
  targetBytes?: number;
}): { removed: string[]; freedBytes: number } => {
  const protectedKeys = new Set(options?.protectedKeys ?? []);
  const targetBytes = options?.targetBytes ?? LOCAL_STORAGE_SOFT_LIMIT_BYTES;
  const usage = measureAppStorage();

  const removed: string[] = [];
  let freedBytes = 0;
  let remaining = usage.totalBytes;

  // History is the cheapest thing to lose, so it goes before any backup.
  const candidates = [
    ...usage.entries.filter((entry) => entry.key.endsWith('-history')),
    ...usage.entries.filter((entry) => entry.key.endsWith('-backup')),
  ];

  for (const entry of candidates) {
    if (remaining <= targetBytes) break;
    if (protectedKeys.has(entry.key)) continue;
    if (!isOptionalKey(entry.key)) continue;
    if (!safeRemoveItem(entry.key)) continue;
    removed.push(entry.key);
    freedBytes += entry.bytes;
    remaining -= entry.bytes;
  }

  return { removed, freedBytes };
};

/**
 * Write path for optional caches. Stays inside the app's soft budget, pruning
 * its own recovery data once before giving up. Never loops and never throws.
 */
export const safeSetItemWithBudget = (
  key: string,
  value: string,
  options?: { protectedKeys?: readonly string[] },
): StorageWriteResult => {
  const incoming = approximateEntryBytes(key, value);
  const existing = approximateEntryBytes(key, safeGetItem(key) ?? '');
  const projected = measureAppStorage().totalBytes - existing + incoming;

  if (projected > LOCAL_STORAGE_SOFT_LIMIT_BYTES) {
    pruneOptionalStorage({
      protectedKeys: [key, ...(options?.protectedKeys ?? [])],
      targetBytes: Math.max(0, LOCAL_STORAGE_SOFT_LIMIT_BYTES - incoming),
    });
  }

  const first = safeSetItem(key, value);
  if (first.ok || first.reason !== 'quota') return first;

  pruneOptionalStorage({
    protectedKeys: [key, ...(options?.protectedKeys ?? [])],
    targetBytes: 0,
  });
  return safeSetItem(key, value);
};
