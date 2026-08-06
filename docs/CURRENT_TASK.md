# Current Task

Feature:
Flight times on `TripProfile`

Branch: `main`, at `a6704cd` with uncommitted work.

## Completed

- `arrivalTime` / `departureTime` on `TripProfile`, both optional
- `sanitizeClockTime` — normalises `H:MM` and `HH:MM:SS` to `HH:MM`, returns
  `undefined` for anything it cannot read. Wired into `sanitizeTripProfile`, so
  the fields survive a save and reload instead of being dropped as unknown keys
- Collected in `TripCreateWizard` (*when* step, under the dates) and editable
  later in `TripIdentityPanel`, because flights are usually booked after the
  trip is planned
- Passed through `BuildOptions.tripEdges` in `DestinationDiscoveryPanel`. This
  activates the arrival and departure halves of `shapeTripEdge`, which were
  written and tested but unreachable — only `timezoneShiftHours` was wired
- 529 tests passing (was 523), `npm run build` clean, eslint clean on changed
  files

## Remaining

Nothing in code. One verification item, needing a browser:

- Confirm an evening arrival (`19:30`) really does collapse day one to dinner,
  and that a `20:00` departure ends the last day by 16:30, in a generated plan

The wizard's `localStorage` draft resumes through `readDraft` →
`sanitizeTripProfile`, so the round-trip is the one the new test asserts.

## Carried over — blocked on credentials

These are from the previous feature (nightly refresh) and could not be done in
this working tree: `.env.local` holds only `VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY`, `VITE_SUPABASE_AUTH_REDIRECT_URL` and
`YOUTUBE_API_KEY` — no service-role key, no `TRAVEL_REFRESH_SECRET` — and the
Supabase CLI is not installed.

- Test `travel-refresh` with real due records. Nothing had expired yet, so the
  first manual call correctly returned all zeros. To verify without waiting:
  ```sql
  update evidence_probes set expires_at = now() - interval '1 day'
  where source = 'official-website'
    and canonical_place_id in (select id from canonical_places limit 1);
  ```
  Re-run the protected curl; expect `officialRefreshed: 1`. No undo needed —
  the sweep rewrites `expires_at` itself.
- Verify the Vercel frontend — weather assignment, best-time merge and
  trip-edge shaping shipped in `a6704cd` and need a deployed build to confirm.
- Confirm the cron fires at 03:00 and that `youtubeBlocked` stays at 0 until
  the refresh budget is genuinely exhausted.

## Files

- `src/lib/tripProfile.ts`
- `src/lib/tripProfile.test.ts`
- `src/components/TripCreateWizard.tsx`
- `src/components/TripIdentityPanel.tsx`
- `src/components/DestinationDiscoveryPanel.tsx`

## Do not modify

- `shapeTripEdge` and its constants (`ARRIVAL_SETTLING_MINUTES`,
  `DEPARTURE_LEAD_MINUTES`, `JET_LAG_*`). It was already complete and tested;
  this feature only supplies its inputs.
- Quota logic — `_shared/quota.ts` and `consume_provider_quota()`. The reserve
  works *because* refresh and live share one counter and differ only in the
  ceiling they pass. Raising refresh above 30 removes the traveller's share.
- Evidence schema — `source_documents`, `travel_claims`, `evidence_probes`.
  A probe means "this source was asked"; changing that meaning breaks
  empty-result caching and the refresh scheduling together.
- `_shared` purity — `cacheKeys.ts`, `claims.ts`, `osmPlaces.ts`,
  `wikivoyage.ts`, `officialSource.ts`, `quota.ts` must stay free of Deno APIs
  and runtime imports.
- `isSafePublicUrl` in the official-source fetch.
