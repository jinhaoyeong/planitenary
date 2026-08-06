# Current Task

Feature:
Discovery deck interactions, and itinerary sync fidelity

Branch: `main`, at `0fa4a02` plus this session's work.

## Completed

### Flight times on `TripProfile` — `0fa4a02`

- `arrivalTime` / `departureTime`, both optional, normalised by
  `sanitizeClockTime` and carried through `sanitizeTripProfile` so they survive
  a save and reload
- Collected in `TripCreateWizard` (*when* step) and `TripIdentityPanel`
- Passed through `BuildOptions.tripEdges`, activating the arrival and departure
  halves of `shapeTripEdge`, which were tested but unreachable

### Deck card: desktop swipe and flip-back

- Mouse drag decides a card, as touch always could. `DRAG_INTENT_PX = 8` marks
  a gesture as a drag so the trailing click is consumed rather than flipping
  the card it just decided on. The flag also resets on candidate change,
  because a committed swipe replaces the card without firing that click
- Clicking the back of a card flips it shut — what Space always did. Skips
  interactive children and a live text selection
- `draggable={false}` on the photo so native image drag cannot hijack a swipe

### Itinerary sync: stale writes and stripped fields

- `isNewerItineraryRevision` gates the remote fetch and the realtime echo.
  `revision` was being incremented on every local edit and consulted by
  neither, so a payload resolving after a rebuild could roll it back
- `latestItineraryRef` mirrors state for the async callbacks, whose closures
  form in an effect that does not depend on `customItinerary`
- **`indoorOutdoor` was never copied by `sanitizeActivity`** — the only input
  to `isOutdoor`, so weather ordering and the rain replan had been blind since
  the first save of any trip
- **`provider` was matched against three of seven `DiscoveryProvider` values**,
  so OSM, Wikivoyage, Amap and Baidu places lost attribution on save
- Both are now `Record<Union, true>` records: omitting a value is a compile
  error. Verified by deleting a key and confirming `TS2741`
- Temporary `[itinerary-sync]` tracing behind `ITINERARY_SYNC_DEBUG`

529 tests passing, `tsc -b` clean, eslint clean on changed files (the 3
`no-explicit-any` in `src/App.tsx` are pre-existing).

## Remaining

- **Confirm the flicker is closed.** Rebuild a long trip, watch the
  `[itinerary-sync]` console output, and check no `realtime-echo` or
  `remote-fetch` line reports `applied: true` with a *lower* day count than the
  local state. Then set `ITINERARY_SYNC_DEBUG = false` and remove the helper
- Verify an evening arrival end to end: `19:30` should collapse day one to
  dinner in a *rebuilt* plan. Editing Settings does not re-run the planner —
  the days only change on a rebuild through the discovery panel
- Watch the inverted-window case: a departure early enough that the airport
  lead lands before the day's start (a `12:33` flight yields a 09:03 limit
  against a 09:30 start). `simulateDay` should schedule nothing and say so;
  untested

## Known gaps, not yet addressed

- **Carried-over decisions are not filtered to the current candidate set.**
  `DestinationDiscoveryPanel` keeps prior decisions wholesale on re-discovery,
  which produced a real "45 of 20 reviewed" counter and a shortlist whose ids
  are not in the deck. A build from that state accepts nothing
- **Nothing tells the traveller the day plan is stale after a profile edit.**
  The staleness warning covers generated *copy* only (`profileRevision` against
  the frozen proposal); there is no equivalent for the days
- **No component tests exist.** All 32 test files are `src/lib/*`. The deck
  interactions and the sync guard are covered only by `tsc -b` and reading

## Blocked on credentials

`.env.local` holds only `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
`VITE_SUPABASE_AUTH_REDIRECT_URL` and `YOUTUBE_API_KEY`; the Supabase CLI is
not installed.

- Test `travel-refresh` with real due records:
  ```sql
  update evidence_probes set expires_at = now() - interval '1 day'
  where source = 'official-website'
    and canonical_place_id in (select id from canonical_places limit 1);
  ```
  Re-run the protected curl; expect `officialRefreshed: 1`. No undo needed.
- Verify the Vercel frontend; confirm the cron fires at 03:00 and that
  `youtubeBlocked` stays at 0 until the refresh budget is genuinely exhausted
- **Check whether `AMAP_API_KEY` is set.** Mainland China destinations route to
  Amap or Baidu, never OpenStreetMap — `resolveDestinationCapability` excludes
  OSM when `regional` is true. A Guangzhou deck rendering live data means a
  **paid** provider is configured. Worth confirming deliberately

## Do not modify

- `shapeTripEdge` and its constants. Already complete and tested; this work
  only supplies its inputs.
- Quota logic — `_shared/quota.ts` and `consume_provider_quota()`. The reserve
  works *because* refresh and live share one counter and differ only in the
  ceiling they pass.
- Evidence schema — `source_documents`, `travel_claims`, `evidence_probes`.
  A probe means "this source was asked".
- `_shared` purity — `cacheKeys.ts`, `claims.ts`, `osmPlaces.ts`,
  `wikivoyage.ts`, `officialSource.ts`, `quota.ts` must stay free of Deno APIs
  and runtime imports.
- `isSafePublicUrl` in the official-source fetch.
