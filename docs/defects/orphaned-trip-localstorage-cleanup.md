# DEFECT: Orphaned trip localStorage cleanup / storage quota exhaustion

**Status:** open, NOT fixed here
**Discovered:** 2026-08-19, during Budget server-authority acceptance (HEAD `ef4f6f1`)
**Severity:** reliability — reaches the ~5 MB origin quota and degrades auth/session restoration
**Scope rule:** this is a SEPARATE defect from Budget source-of-truth acceptance. Do not fold it in.

## Observed in production (traeitenarywdre.vercel.app)

localStorage for the origin sat at approximately **5,242,805 bytes / quota exhausted**.

Major orphan entries observed:

| entry | approx size |
| --- | --- |
| `trip-82522acd…` history | 3.96 MB |
| `trip-b8479169…` history | 0.53 MB |
| `trip-82522acd…` backup | 0.15 MB |

Both trips were already deleted. Observed effects, in order:

1. Budget backup write failed — swallowed gracefully, no user-visible error.
2. Primary Budget cache became stale.
3. Authoritative **server** Budget row remained correct (this is the resilience evidence).
4. Auth/session restoration subsequently rendered signed-out despite a still-valid token.

## Root cause (static analysis, HEAD `ef4f6f1`)

Trip deletion cleans only the **user-scoped** itinerary key shape, but several live writers
use the **unscoped legacy** shape. The unscoped `-history` blob is the 3.96 MB orphan.

Key shapes in use:

- `src/App.tsx:278` — writes `itinerary-${user.id}-${tripId}` (user-scoped, current)
- `src/App.tsx:277` — writes `itinerary-demo-${tripId}` (demo)
- `src/App.tsx:423` — still *reads* legacy `itinerary-${tripId}` for recovery
- `src/components/Handbook.tsx:660` — **writes** legacy `itinerary-${tripId}` directly via
  `localStorage.setItem`, bypassing the scoped key entirely

Cleanup list, `src/lib/tripDeletion.ts:12-29`:

```ts
export const tripStorageKeys = (userId, tripId) => [
  `itinerary-${userId}-${tripId}`,   // scoped only
  `budget-${tripId}`,
  `budget-meta-${tripId}`,
  `checklist-data-${tripId}`,
  `drafts-${tripId}`,
  `trip-settings-${tripId}`,
  `photos-${tripId}`,
];
// each expanded to key, `${key}-backup`, `${key}-history`
```

`itinerary-${tripId}`, `itinerary-${tripId}-backup`, `itinerary-${tripId}-history`,
and the `itinerary-demo-${tripId}` family are **never** removed. `pushHistorySnapshot`
(`src/lib/storageResilience.ts:101`) retains up to `HISTORY_LIMIT = 30` full raw snapshots
per key, so an unscoped key accumulates ~30 copies of a whole itinerary and is never reaped.

### Secondary path (dead code, but same bug shape)

`src/components/Dashboard.tsx:120` `handleDeleteTrip` clears keys with
`writeRawToStorage(key, null, { preserveCurrent: false })`. With `raw === null` that helper
does `localStorage.removeItem(key)` and returns (`storageResilience.ts:220-223`) — it never
removes `${key}-backup` or `${key}-history`. `Dashboard.tsx` is currently **not imported
anywhere**, so it is not the live cause, but it should not be resurrected as-is.

## Required fix (later, not in this acceptance)

Trip deletion must clean every trip-scoped namespace:

```
trip deletion
  → itinerary current   (scoped + legacy unscoped + demo)
  → itinerary backup
  → itinerary history
  → Budget cache / backup / meta
  → other trip-scoped browser state
```

Additionally, startup should safely prune **orphaned trip-scoped storage belonging to trips
the authenticated user no longer owns**, under conservative rules so a current trip is never
deleted. `HISTORY_LIMIT = 30` full snapshots per key should also be reviewed — it is the
multiplier that turns one stale key into megabytes.

## Preservation note

The affected browser profile is being **kept untouched as evidence**. During the Budget
acceptance, do not delete `trip-b8479169…`, do not delete `trip-82522acd…` history, do not
alter deleted-trip state, and do not manually free localStorage space.

## Suspected additional consequence — NOT CONFIRMED

**Blank render after sign-in.** On 2026-08-19 the affected profile rendered a blank page at
`traeitenarywdre.vercel.app` after sign-in. This is *consistent with* the same quota
exhaustion: once the origin is at the ~5 MB cap, `localStorage.setItem` throws
`QuotaExceededError`, and an unguarded write on the sign-in / trip-hydration path would
propagate through render and blank the shell.

If real, this is a more severe consequence than the stale-cache effect already recorded —
it moves the defect from "degraded persistence" to "app unusable in that profile".

**Status: hypothesis only.** Deliberately NOT investigated. Confirming it requires reading
the console of the preserved evidence profile, and that profile is being kept frozen and
untouched (deviceId `53fd143c-cd54-432a-abe8-a3ce825dc3db`) for the duration of the Budget
acceptance. Do not treat this as production-confirmed until that inspection actually happens.

---

## Resolution (implemented 2026-08-19)

Chrome's per-origin quota was **not** raised — it cannot be, and trying would have
been the wrong fix. Instead Planitenary no longer depends on having storage room,
and no longer fills the origin in the first place.

**Never crash.** `src/lib/safeLocalStorage.ts` is the single guarded entry point.
`safeGetItem` / `safeSetItem` / `safeRemoveItem` return values or structured
results (`{ ok: false, reason: 'quota' }`) and never throw — acquiring the storage
handle is guarded too, for private-mode `SecurityError`. Every raw
`localStorage.*` call across `App`, `TripDashboard`, `Handbook`, `ProfilePanel`,
`TripCreateWizard`, `DestinationDiscoveryPanel`, the Auth/Currency/Theme contexts,
`currency`, `petPack`, `shellTheme` and `storageResilience` now routes through it.

The specific blank-screen path was `loadFromStorage`: it promoted a recovery
snapshot back into the primary slot with an unguarded `setItem` **during
hydration**, so a full origin threw straight through render. It is now a
best-effort write; the caller still receives the recovered value either way.

**Never fill.** History kept `HISTORY_LIMIT = 30` complete snapshots per key —
the multiplier behind the 3.96 MB orphan. It is now 5 entries *and* capped at
`HISTORY_SOFT_LIMIT_BYTES` before anything is offered to the browser. A
`LOCAL_STORAGE_SOFT_LIMIT_BYTES` app budget sits below the browser ceiling so
Supabase auth keeps headroom; `safeSetItemWithBudget` prunes its own optional
data once, retries once, then gives up without looping.

**Reclaim.** `tripStorageKeys` now covers the legacy unscoped `itinerary-${tripId}`
and `itinerary-demo-${tripId}` shapes, plus `restore-snapshot-`, each with its
`-backup`/`-history`. `writeRawToStorage(key, null, { preserveCurrent: false })`
now clears backup and history too, since that call means deletion, not an edit.
`src/lib/tripStorageOrphans.ts` prunes trip-scoped storage for trips the owner no
longer has, after a **successful** registry load only — a failed query must never
read as "owns nothing" — and an empty registry prunes nothing. Key ownership is an
explicit prefix allowlist with exact trip-id parsing, so `sb-*` auth tokens,
preferences and third-party keys are unreachable by construction.

**Covered by tests.** `safeLocalStorage.test.ts`, `tripStorageOrphans.test.ts`,
updated `tripDeletion.test.ts`, and a full-origin regression in
`storageResilience.test.ts` that makes every write throw `QuotaExceededError` and
asserts hydration still returns the trip and nothing throws.

### Still open

- The blank-render hypothesis above is now *fixed by construction*, but remains
  unconfirmed in production because the evidence profile was never inspected.
- `src/components/Dashboard.tsx` is dead code (imported nowhere) that duplicates
  trip-deletion logic. It benefits from the `writeRawToStorage` fix but should be
  deleted rather than revived.
