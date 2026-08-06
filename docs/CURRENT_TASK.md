# Current Task

Feature:
Multi-city planning, and a range calendar for the dates

Branch: `main`, at `d742caf` plus this session's work.

731 tests across 45 files, `tsc -b` clean, production build clean, eslint clean
on changed files (the 53 remaining problems are pre-existing and unchanged).

## Completed — multi-city

### The traveller divides the days, not the planner

- `TripProfile.cityStays`: city and days **in travel order**, so the array is
  the route as well as the lengths. Sanitised on save, filtered to cities the
  trip still has, and never rebalanced — an incomplete plan is a state the
  traveller is in the middle of, not corruption to repair
- `src/lib/cityStays.ts` proposes, reconciles and reports. A day added to one
  city comes from an unassigned pool, **never from a neighbour**
- `CityStayPlanner` in the wizard's *when* step and in Trip Identity, for any
  trip with more than one city. Steppers, route reordering, and each stay shown
  as the dates it covers — a hotel is booked against dates, not day numbers
- `buildDestinationItinerary` follows a complete plan against every signal in
  the shortlist, including keeping days in a city with nothing shortlisted.
  Inference survives only as the fallback for trips never asked, and says so
- Discovery sizes each city's recommended shortlist to that city's real days,
  and the switcher shows its dates

### Days belong to stays, not to `destinations[0]`

- `src/lib/cityLegs.ts`: `planCityLegs` divides the trip by largest-remainder
  apportionment over the shortlist, floor of one day per city, contiguous legs
  in travel order. More cities than days drops by **weight**, not by position
- `buildDestinationItinerary` clusters within each leg, resets carry-over at
  leg boundaries with a reason the traveller can read, keeps meals to the day's
  city, and confines fatigue rebalancing to days of the same stay
- A **day trip is not a leg**: legs come from chosen destinations only, and a
  place outside every leg city attaches to the nearest stay by the centroid of
  its shortlisted places. `allowCrossCityDays` still decides whether it can be
  scheduled at all
- `DestinationBuildResult.cityLegs` exposes the division; the preview header and
  a build warning both state it, along with any city that got no days
- `buildDaysFromProfile` no longer guesses at creation: a multi-city trip gets
  blank cities and neutral titles, a single-city trip still names its city

### Discovery reviews every city — uncommitted

- City switcher: one deck per city, discovered on first open, cached per city,
  built from all of them at once through `rankedAll`
- Decisions are one map across the trip and are pruned against **every** city's
  candidates — pruning to the active deck would repeat `d89bbe8`'s bug
- Per-city progress counters; the Build button counts the whole trip
- `applyPlan` writes the visited cities in order, keeping any chosen city the
  plan gave no days to rather than quietly editing the trip

## Completed — the date range calendar

- `src/lib/dateRange.ts` + `src/components/ui/DateRangeCalendar.tsx`, replacing
  both `<input type="date">` fields in the wizard and Trip Identity. Click the
  first day, click the last, and the days between are one connected band with a
  live "21 Jan – 31 Jan 2027 · 11 days, 10 nights"
- Local midnight, never UTC — `new Date('2027-01-21')` lands on the 20th west of
  Greenwich. `addMonths` clamps to a shorter month. `isIsoDate` round-trips,
  because `2027-02-30` is 2 March to a browser rather than `NaN`
- Clicking before a pending start restarts the range; a complete range restarts
  on the next click, so no "clear" step has to be found first
- Arrow keys walk a day and a week at a time and page at the edges; every day is
  a real `<button>` with a full `aria-label`

## Completed — earlier this session

### Shortlist sized to the trip — `141e6f4`, `b126f2b`

- `defaultDiscoveryDecisions` pre-selected a hardcoded 29 places regardless of
  trip length. Capacity is now `dayCount × maxMainActivities` for the pace
  actually used, so a three-day Calm trip pre-selects 9 and a twenty-one day one
  59 — choosing Calm shortens the deck with no second rule existing anywhere
- Food-only places are passed over: `buildDestinationItinerary` draws meals from
  the whole ranked list, so pre-selecting restaurants would spend sightseeing
  capacity on lunch. A night market still counts as a sight
- Hard ceiling of **100** applied *after* capacity, so a capped trip still
  reports the capacity it has. At 21 active days the cap takes 118 down to 100,
  still above the 84 the days hold — the shortfall copy checks rather than
  assumes
- `SHORTLIST_HEADROOM = 1.4` is labelled a guess, not presented as measured
- The recommended-shortlist button names the trip length and pace behind its
  number, so a traveller who wants more knows the lever is the pace

### Shortlist fit measured, and deliberately not acted on — `e419534`

- `measureShortlistFit` / `recordShortlistDiagnostic` read a finished
  `DestinationBuildResult` and write nothing back. Gated to dev builds or
  `VITE_PLANNER_DIAGNOSTICS=true`, so no traveller sees a rejection rate
- Samples carry accepted, scheduled, `impliedHeadroom` and `byReason` plus city,
  day count and the pace *actually used* — `applyTravellerConstraints` can lower
  it, and samples are only comparable within one pace
- Up to 50 accumulate on `window.__plannerDiagnostics`; a tuning pass is
  `copy(__plannerDiagnostics)`. A build that scheduled nothing reports headroom 0
- **Result (roadmap §6, Phase 7):** a 36-build fixture sweep produced only 10
  usable samples — 26 were pool-bound. Median implied headroom 1.75, but the
  metric is partly self-referential and fixture hours are uniformly 09:00–18:00.
  Active-pace underfill was dominated by `no-viable-day`, which points at
  `maxMainActivities` being aspirational for fast pace, not at headroom being
  too small. **Decision: keep `1.4` and its provisional label**

### Stale decisions pruned to the live candidate set — `d89bbe8`

- Decisions were restored by city and survived a re-discovery; the candidate list
  did not. That produced the reported "45 of 20 reviewed — 33 selected" header
  and a build that accepted nothing while a shortlist of 33 was on screen
- `pruneDecisionsToCandidates` intersects on candidate **id**, not name (two
  places in one city genuinely share names), and returns the discarded count so
  the loss is shown — a vanished selection is the traveller's own work

### Pace and flight edges proven on finished builds — `6b369a6`, `d742caf`

- Roadmap §9.2 and §9.4 run through `buildDestinationItinerary` against the
  Melbourne fixture, so the result is reproducible rather than argued
- Calm / default / Fast paced route onto relaxed, balanced, active: busiest day
  2 / 3 / 3 stops, days open 10:13 / 09:28 / 09:13, meals 85 / 70 / 55 minutes,
  walking 16 minutes against 34. `PACE_DEFAULTS` demonstrably reaches the plan
- Departure shaping holds, including the inverted window: a 12:33 departure
  gives a 09:03 limit against a 09:30 start, and `simulateDay` schedules nothing
  and says so rather than throwing or inventing a day
- `6b369a6` found that an evening arrival did **not** leave "a day that is really
  just dinner" as `shapeTripEdge`'s comment claimed — 19:30 plus two hours to
  clear the airport starts the day at 21:30, past the balanced return time, so
  day one came back bare. `d742caf` closes that: `ARRIVAL_MEAL_ALLOWANCE_MINUTES`
  keeps a `maxMainOverride: 0` day open 180 minutes (capped at end of day) so one
  dinner fits. No main sight is invented, and past the late-dinner cutoff the day
  is honestly empty with a warning

### Component test harness — `c5dfce5`

- `sanitizeItinerary` / `sanitizeActivity` extracted to
  `src/lib/itinerarySanitize.ts`, behaviour unchanged, and covered by 13 tests.
  Three fail against pre-`4c3d6c6` code — verified by reverting, not assumed
- jsdom + React Testing Library added. `node` stays the default environment; a
  component test opts in per file with a `vitest-environment` docblock. Shared
  setup registers jest-dom, cleans up between tests, and stubs `matchMedia`,
  which `ThemeContext` reads on mount
- The first component test (`TripIdentityPanel.test.tsx`) found the flight-time
  and date labels were bare `<label>` siblings with no `htmlFor` — unlabelled to
  a screen reader, not merely unfindable by a test. Fixed

### Deck gestures made testable, and tested — uncommitted

- Roadmap §9.6 credited the jsdom harness with covering the deck; it did not.
  `TripIdentityPanel.test.tsx` was the only component test, and the deck's
  interactions had exactly the coverage that let both sanitiser losses through
- The gesture *rules* — `DRAG_INTENT_PX`, `SWIPE_COMMIT_PX`, the velocity flick
  threshold, and the interactive-target / text-selection guards — moved to
  `src/lib/deckGestures.ts` as `isDragIntent`, `swipeDecision` and
  `shouldCloseFromSurface`. The component keeps the wiring; this keeps the
  judgement, which is what a regression would change
- Framer Motion's pointer drag cannot be driven honestly in jsdom, so the split
  is deliberate rather than incidental: 15 tests cover the arithmetic,
  8 component tests cover the flip a browser is genuinely needed for
- Checked by mutation, not by assumption: removing the interactive-target and
  selection guards turns four tests red, including the component-level "leaves
  the source link alone"
- `DeckCard` is now exported from `DestinationDiscoveryPanel.tsx`
- Roadmap §9.6, §9.1 and the status section corrected to say what is covered
  by pure-lib tests, what by the harness, and what is still unproven

## Remaining

- **None of the multi-city work has been through a browser.** The four-city plan
  was read out of a real `buildDestinationItinerary` run (Osaka 1–5, Nara 6,
  Kyoto 7, Kobe 8), but the switcher, the calendar and live multi-city discovery
  have only been exercised in jsdom. Worth one pass: create a Kansai trip, review
  two cities, build, and check the day cards and the dashboard card location
- **Reordering is arrow buttons, not drag.** Accessible and testable, but a
  four-city route is fiddlier to reorder than it should be
- **The drag gesture itself is still a browser observation.** `isDragIntent` and
  `swipeDecision` are tested and the component calls them, but that a real mouse
  drag suppresses its trailing click cannot be shown in jsdom
- **`ITINERARY_SYNC_DEBUG` is still `true`** in `src/lib/itinerarySanitize.ts:387`.
  Roadmap §9.3 is the last unfinished no-credentials check: rebuild a long trip,
  confirm no `realtime-echo` or `remote-fetch` line reports `applied: true` with
  an `incomingDays` lower than `currentDays`, then set the flag to `false` and
  delete `logItinerarySync` and its call sites
- **Deployed save round trip (§9.1).** The sanitisers are covered in `src/lib`;
  what remains is discovery → save → reload against a real OSM place in the
  deployed app, checking `provider` and `indoorOutdoor` survive
- **Collect non-pool-bound shortlist samples** from live places with real opening
  hours before touching `SHORTLIST_HEADROOM`. Fixture pools cannot exercise the
  weekday-closure and walking-limit paths that the margin exists for
- **The revision guard's call sites in `App.tsx` are untested.** The comparison
  is covered; that the remote fetch and the realtime handler both consult it is
  not. Same for `DestinationDiscoveryPanel`'s use of
  `pruneDecisionsToCandidates` — the pruning is tested, the wiring is not

## Known gaps, not yet addressed

- **Nothing tells the traveller the day plan is stale after a profile edit.**
  `profileRevision` guards generated *copy* only; there is no equivalent for the
  days. Set flight times, see the plan unchanged, conclude the feature does
  nothing — which is exactly what happened on 2026-08-06
- **Amap POI noise reaches the shortlist.** A Guangzhou deck ranked "AAG Markets",
  a financial-services office, at 58. Regional keyword search has no category
  gate equivalent to `osmPlaces.ts`
- **No photos.** `photoUrl` / `photoAttribution` exist and `PlaceMedia` renders
  them, but nothing populates them since Google was removed. Wikidata `P18`, the
  OSM `wikimedia_commons` tag and MediaWiki `pageimages` are free and keyless;
  Commons requires visible attribution
- **Sourcing breadth (roadmap Phase 8).** TripAdvisor unimplemented; the bounded
  LLM extraction pass that turns a pasted RedNote or TikTok link into structured
  claims is unbuilt and needs `GEMINI_API_KEY`. Platform search on TikTok, Douyin
  and RedNote stays blocked by their terms — pasted links are the lawful route
- **Contextual tips are partial.** Best-time windows, queue advice, event
  conflicts and source explanations exist; local etiquette, safety notes, photo
  spots, hidden entrances and crowd prediction do not
- **Hotel location, dietary profile and accessibility needs** are honoured where
  present in scheduling, but are not first-class `TripProfile` inputs

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

- `shapeTripEdge`'s constants beyond the arrival-meal allowance added in
  `d742caf`. The departure half and jet-lag shift are complete and tested.
- Quota logic — `_shared/quota.ts` and `consume_provider_quota()`. The reserve
  works *because* refresh and live share one counter and differ only in the
  ceiling they pass.
- Evidence schema — `source_documents`, `travel_claims`, `evidence_probes`.
  A probe means "this source was asked".
- `_shared` purity — `cacheKeys.ts`, `claims.ts`, `osmPlaces.ts`,
  `wikivoyage.ts`, `officialSource.ts`, `quota.ts` must stay free of Deno APIs
  and runtime imports.
- `isSafePublicUrl` in the official-source fetch.
- `SHORTLIST_HEADROOM` until non-pool-bound live samples exist. The fixture
  sweep is not evidence for changing it.
