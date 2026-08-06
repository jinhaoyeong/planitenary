# Changelog (AI sessions)

Running log. Newest first. Rationale lives in `CLAUDE_CONTEXT.md`.

---

## 2026-08-06 (later session)

### Completed

`0fa4a02` Add flight times to trip planning
- `arrivalTime` / `departureTime` added to `TripProfile`, with
  `sanitizeClockTime` normalising `H:MM` and `HH:MM:SS` to `HH:MM` and dropping
  anything else
- Collected in `TripCreateWizard` (the *when* step) and editable afterwards in
  `TripIdentityPanel`, since flights are usually booked after a trip is planned
- Passed through `BuildOptions.tripEdges`, which finally activates the arrival
  and departure halves of `shapeTripEdge` — until now only the derived
  time-zone shift reached it
- Tests: 523 → 529. New `src/lib/tripProfile.test.ts`

Deck card: desktop swipe and flip-back
- Mouse drag now decides a card, as touch always could. `DRAG_INTENT_PX = 8`
  marks a gesture as a drag so the click that trails it is consumed instead of
  flipping the card it just decided on
- The flag resets on candidate change too: a committed swipe replaces the card
  without ever firing the click that would have cleared it
- Clicking the back of a card flips it shut, which Space always did. Ignores
  interactive children and a live text selection
- `draggable={false}` on the photo, so native image drag cannot hijack a swipe

Itinerary sync: stop a stale write undoing a rebuild
- `revision` existed to order versions and neither read path consulted it. The
  remote fetch overwrote unconditionally; the realtime handler compared only
  deep equality. A fetch or echo resolving after a rebuild could roll it back
- `isNewerItineraryRevision` now gates both, and `latestItineraryRef` mirrors
  state for the async callbacks, whose closures are formed in an effect that
  does not depend on `customItinerary`
- Ref writes deliberately kept out of state updaters: StrictMode double-invokes
  those, which would double `saveToStorage`
- Temporary `[itinerary-sync]` tracing behind `ITINERARY_SYNC_DEBUG`

Itinerary sync: stop the sanitiser stripping the planner's work
- **`indoorOutdoor` was never copied by `sanitizeActivity`.** It is the only
  input to `isOutdoor`, so weather-aware ordering and the rain replan lost
  their data on the first save and had been running blind since
- **`provider` was matched against a stale three-value list** while
  `DiscoveryProvider` has seven, so every place from OpenStreetMap, Wikivoyage,
  Amap or Baidu lost attribution on save — all of them, Google being unconfigured
- Both are now `Record<Union, true>` keyed records, so omitting a value is a
  **compile error**, not silent loss. `data.ts` records this list drifting twice
  before; verified by deleting a key and confirming `TS2741`

### Not verified

The three verification items carried in `CURRENT_TASK.md` were left undone:
each needs production credentials that are not in the working tree
(`.env.local` holds only `VITE_SUPABASE_*` and `YOUTUBE_API_KEY` — no service
role key, no `TRAVEL_REFRESH_SECRET`), and the Supabase CLI is not installed.

The deck-card interactions and the sync guard have **no test coverage**. All 32
test files are `src/lib/*`; there is no component-test setup (no jsdom, no
RTL), so covering them means standing that up first. Both were verified only by
`tsc -b`, eslint and reading.

Whether the revision guard actually closes the reported flicker is unconfirmed —
it fixes a real defect either way, and the tracing exists to settle it on the
next reproduction. The two sanitiser losses are confirmed and were happening on
every save independently of the race.

### Known consequence

Trips saved before this session have already lost `indoorOutdoor` and
`provider` on their activities. Those fields return only on a rebuild through
discovery; nothing backfills them.

---

## 2026-08-06

Context: a single day of testing produced an unexpected **RM 31.69** Google
Places bill — 25 uncached `reviews` lookups per button click on the
Atmosphere-tier SKU. The Google Cloud project was deleted, and the day's work
rebuilt the data layer on sources that cannot bill, then extended the planner.

### Completed

`19eac17` Cache travel discovery and evidence lookups
- Read-through caches for discovery and evidence; `discovery_cache` and
  `evidence_probes` tables
- Evidence made lazy: current deck card + 4 ahead, not the whole shortlist
- Routes capability probe memoised (was a billed call per request)

`a2bbc3f` Restore free live destination discovery
- OpenStreetMap via Overpass — one free query replacing seven billed searches
- Wikivoyage curation, one request per city
- OpenRouteService route matrix; `notability` replacing star ratings;
  real `indoorOutdoor` from tags

`11ea33e` Fix weekday-aware scheduling constraints
- Day-of-week opening hours end to end (the Monday-closure bug)
- All four previously-dead `PACE_DEFAULTS` fields enforced

`33ebe63` Add Reddit evidence and claim extraction
- Reddit ingestion (later dropped — API access needs approval; code retained)
- YouTube split onto its own key; user-shared link loop closed via oEmbed
- Claim extraction moved to `_shared/claims.ts` with its own tests

`71fd054` Add official sources and meal scheduling
- Official-source fetcher: schema.org JSON-LD hours + closure notices
- SSRF guard on venue URLs (they come from community-edited OSM tags)
- Real restaurants in meal slots; breakfast; dietary and budget matching

`59a0204` / `f0a786f` Provider quota
- `provider_usage` + atomic `consume_provider_quota()`
- YouTube capped at 90 searches/day, Pacific-time reset

`a6704cd` Complete nightly refresh and adaptive itinerary planning
- `travel-refresh` on cron `0 3 * * *`, protected by `TRAVEL_REFRESH_SECRET`
- Evidence fetchers extracted to `_shared/evidenceSources.ts`
- Opening-hours persistence; cross-day fatigue rebalancing; trip-edge shaping
  (arrival, departure, jet lag); `bestTimeWindows` from corroborated evidence;
  weather-aware day assignment

Tests: 40 → 523 across 31 files.

### Bugs found and fixed along the way

- **`tsc --noEmit -p tsconfig.json` checks nothing** — root config is
  `{"files": [], "references": []}`. Several "typecheck passed" reports were
  vacuous before this was caught. `tsc -b` is the real check.
- **Four of every five reviews were being discarded** — `source_documents` is
  unique on `(source, source_url)` and every review of a place shared that
  place's page URL.
- **An unconfigured provider recorded a probe**, so adding its key later would
  have been ignored until the probe expired.
- **The nightly refresh would have suppressed the hours it found** — marking the
  official probe fresh makes the next live request skip the fetch, so hours were
  read overnight and thrown away. Now persisted in `opening_hours_snapshots`.
- **`officialSources: true` was hardcoded with no implementation** — the app
  told travellers their plan was "checked against official sources" when nothing
  checked any.
- **Arrival-day shaping was dead code** — `itinerary.days.length === 0` is false
  whenever day placeholders exist, which is always.
- **`fatigueScore` was compared across pace profiles** in a test, which its own
  documentation forbids. It passed by luck until meal travel shifted the numbers.
- **Parallel type unions drifted twice** — `DiscoveryProvider` /
  `Activity.provider`, and `RejectionReason` / `DiscoveryUnscheduledReason`. Both
  now declared once in `src/data.ts`.
- **`usageToday` reported 0 on error**, conflating "nothing used" with "counter
  unreachable". Returns `null` now.

### Known issues

- Need a real expired record to verify the refresh end to end; the first manual
  call correctly returned zeros because nothing was due.
- Overpass, Wikivoyage and JSON-LD parsers are tested against synthetic
  fixtures, not a broad sample of live responses.
- `TRAVEL_REFRESH_SECRET` sits in plaintext in the `cron.job` command string —
  Vault was unavailable on the project.
- `src/App.tsx` has 3 pre-existing `no-explicit-any` lint errors.
- Refresh targets by recency of interest, not departure date. `trip_registry`
  has no travel dates and nothing links a place to a trip.

### Decisions

- Reddit dropped from the roadmap (API access requires approval). Code retained;
  setting two secrets activates it with no change.
- Google Places kept supported but unconfigured. Re-enabling `reviews` is a
  deliberate, quota-capped decision — never a default.
