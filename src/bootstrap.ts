/**
 * Side-effect module that must be imported before anything touching Supabase.
 *
 * `createClient` decides whether localStorage is usable the moment it is
 * constructed, and caches that answer for the page. Reclaiming space after that
 * point is too late — the session would already have fallen back to memory.
 * Keeping this as its own module lets `main.tsx` order it first, and lets tests
 * import the recovery function without triggering it.
 */

import { reclaimOptionalStorageForBootstrap } from './lib/bootstrapStorageRecovery';

const result = reclaimOptionalStorageForBootstrap();

if (import.meta.env.DEV && result.ran) {
  // Key names and sizes only — never stored contents, never auth material.
  console.info('[storage] bootstrap reclaim', {
    removed: result.removed,
    freedBytes: result.freedBytes,
    beforeBytes: result.beforeBytes,
    afterBytes: result.afterBytes,
    writable: result.writable,
  });
}
