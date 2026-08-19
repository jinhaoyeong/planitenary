/**
 * Emergency storage reclamation that must run before the Supabase client exists.
 *
 * Supabase decides once, in the `GoTrueClient` constructor, whether localStorage
 * is usable — by writing a probe key (`auth-js/lib/helpers.ts`
 * `supportsLocalStorage`). On a full origin that write throws, the result is
 * memoised for the lifetime of the page, and the client silently falls back to
 * an empty in-memory store. The existing `sb-*-auth-token` is then never read
 * and the user appears signed out despite holding a valid session.
 *
 * That happens at module-import time, long before the trip registry loads, so
 * the ownership-aware cleanup in `tripStorageOrphans` can never run: no session
 * means no registry, and no registry means no pruning. A browser that filled up
 * would stay broken forever.
 *
 * This pass therefore runs first and answers one narrow question — can the
 * origin still be written to? — using only data Planitenary owns and can afford
 * to lose. It never needs to know which trips are still owned, because it only
 * discards optional recovery material.
 */

import {
  LOCAL_STORAGE_SOFT_LIMIT_BYTES,
  measureAppStorage,
  safeRemoveItem,
  safeSetItem,
} from './safeLocalStorage';

/**
 * Headroom the probe demands. Comfortably larger than an observed Supabase auth
 * token (~4.5 KB) so a token refresh, not just a read, still fits afterwards.
 */
export const BOOTSTRAP_PROBE_BYTES = 32_768;

const PROBE_KEY = 'planitenary-bootstrap-probe';

/** Can the origin still take a write of useful size? Always cleans up after itself. */
export const canWriteBootstrapProbe = (): boolean => {
  const payload = 'p'.repeat(BOOTSTRAP_PROBE_BYTES / 2);
  const result = safeSetItem(PROBE_KEY, payload);
  safeRemoveItem(PROBE_KEY);
  return result.ok;
};

export interface BootstrapRecoveryResult {
  ran: boolean;
  removed: string[];
  freedBytes: number;
  beforeBytes: number;
  afterBytes: number;
  writable: boolean;
}

/** Optional recovery data only — never a primary cache, never a foreign key. */
const isDiscardable = (key: string) => key.endsWith('-history') || key.endsWith('-backup');

/**
 * Frees room for authentication by discarding Planitenary's own history and
 * backups, largest first, stopping as soon as the origin is writable again and
 * the app is back inside its soft budget.
 *
 * Deliberately conservative: primary caches survive, and because
 * `measureAppStorage` reads through the owned-prefix allowlist, auth tokens and
 * third-party keys are not merely skipped — they are never enumerated.
 */
export const reclaimOptionalStorageForBootstrap = (): BootstrapRecoveryResult => {
  const beforeBytes = measureAppStorage().totalBytes;
  const healthy = () =>
    canWriteBootstrapProbe() && measureAppStorage().totalBytes <= LOCAL_STORAGE_SOFT_LIMIT_BYTES;

  if (healthy()) {
    return { ran: false, removed: [], freedBytes: 0, beforeBytes, afterBytes: beforeBytes, writable: true };
  }

  // History before backups: a backup is one restore away from being useful,
  // a history entry is the most disposable thing Planitenary keeps.
  const entries = measureAppStorage().entries;
  const candidates = [
    ...entries.filter((entry) => entry.key.endsWith('-history')),
    ...entries.filter((entry) => entry.key.endsWith('-backup')),
  ];

  const removed: string[] = [];
  let freedBytes = 0;

  for (const entry of candidates) {
    if (healthy()) break;
    if (!isDiscardable(entry.key)) continue;
    if (!safeRemoveItem(entry.key)) continue;
    removed.push(entry.key);
    freedBytes += entry.bytes;
  }

  return {
    ran: true,
    removed,
    freedBytes,
    beforeBytes,
    afterBytes: measureAppStorage().totalBytes,
    writable: canWriteBootstrapProbe(),
  };
};
