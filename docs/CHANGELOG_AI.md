# Changelog (AI sessions)

Running log. Newest first. Rationale lives in `CLAUDE_CONTEXT.md`.

---

## 2026-08-06 (multi-city session)

Two reports from the traveller, one interface and one engine.

### The engine: a four-city trip was eight days in Osaka

> "I select Japan, then for the cities I selected Osaka, Nara, Kyoto, Kobe …
> the card has day 1 in Osaka then until day 8 in Kyoto and day 6 in Nara, and
> the location is all Osaka only, and the recommended plan is all Osaka."

Three separate causes, all now closed:

**`buildDaysFromProfile` guessed the split at creation.** `cityForDay` divided
the days evenly in the order the cities were typed and wrote the result into the
titles — "Day 6 in Nara" — before a single place had been shortlisted, and
nothing downstream honoured those assignments. A multi-city trip now creates
days with **no city and neutral titles**; a single-city trip still names its
city, where saying so is simply true.

**Every built day was stamped `profile.destinations[0].city`.** New
`src/lib/cityLegs.ts` divides the trip into stays: largest-remainder
apportionment over the shortlist, a floor of one day per city, cities dropped by
*weight* rather than by position when there are more cities than days. The
planner clusters within each leg, carries nothing across a leg boundary, keeps
meals to the day's city, and confines fatigue rebalancing to days of the same
stay — evening out a trip is worth a rearranged afternoon, never a train.

A day trip is *not* a leg. The Osaka fixture offers Nara, Kyoto and Kobe places
as day trips; turning one into a leg would silently move the traveller's hotel.
Legs come from chosen destinations only, and a place outside every leg city is
attached to the nearest stay by the centroid of what is shortlisted there —
computed from the places themselves, so it needs no gazetteer. Whether such a
day is schedulable at all remains `simulateDay`'s call, from
`allowCrossCityDays`.

**Discovery only ever read `destinations[0]`.** The panel now has a city
switcher: one deck per city, discovered on first open rather than all up front,
cached per city so switching back is instant, and built from every city at once.
Decisions are one map across the trip and are pruned against *every* city's
candidates — pruning to the active deck would have deleted the traveller's Kyoto
choices the moment they opened Nara, which is `d89bbe8`'s bug in a new disguise.
Progress counters report the city on screen; the Build button counts the trip.

The split is stated rather than assumed: "Your days are split Osaka 5 days ·
Nara 1 day · Kyoto 1 day · Kobe 1 day, following how many places you kept in
each city." A city that got no days is named too.

### The correction: the app does not divide the days

> "You don't get to decide user days on which cities. If they put more than one,
> ask about it … before hand they should already know which cities and day they
> stay."

The first pass inferred the split from what was shortlisted. That is a
reasonable answer to *"how long should each stay be"* and the wrong answer to
*"who decides"* — where you sleep on night four is a hotel booking, and the app
does not get a vote. So the trip is asked, before discovery.

- `TripProfile.cityStays` — city and days, **in travel order**, so the array is
  the route as well as the lengths. Sanitised on every save, filtered to cities
  the trip still has, and deliberately never rebalanced: an incomplete or
  overspent plan is a state the traveller is in the middle of, not corruption
  to repair behind their back
- `src/lib/cityStays.ts` proposes an even starting split, reconciles a stored
  plan against a changed city list, and reports what is still unplaced.
  Adding a day takes it from an unassigned pool, **never from a neighbouring
  city** — auto-balancing would be smoother and would quietly undo a decision
  the traveller had already made
- `CityStayPlanner` appears in the wizard's *when* step and in Trip Identity
  whenever a trip has more than one city. Steppers per city, arrows to reorder
  the route, each stay shown as the dates it covers — "2 Apr – 4 Apr", because a
  hotel is booked against dates, not day numbers
- `buildDestinationItinerary` treats a complete plan as authoritative and
  follows it against every signal in the shortlist, including keeping days in a
  city with nothing shortlisted in it. Shortlist inference survives only as the
  fallback for trips that were never asked — an older saved trip — and says so:
  "Set a stay plan in Settings to decide this yourself"
- Discovery reads the plan too: the city switcher shows each city's dates, and
  the recommended shortlist for Kyoto is sized to *your two days in Kyoto*
  rather than to an inferred share

Verified end to end through a save round trip: a plan of Kyoto 4 · Osaka 2 ·
Nara 1 · Kobe 1 — deliberately contradicting both the shortlist weighting and
the order the cities were added — produced exactly those legs, in that order,
with "Built to your stay plan: …".

### The interface: one calendar for both ends of the trip

Two `<input type="date">` fields never showed the trip as a trip — you chose a
start, the picker closed, and the eleven days you had committed to were drawn
nowhere. `DateRangeCalendar` replaces both, in the wizard and in Trip Identity:
click the first day, click the last, and the days between are one connected
band, with a live "21 Jan – 31 Jan 2027 · 11 days, 10 nights".

- `src/lib/dateRange.ts` holds the arithmetic. Dates are read at **local
  midnight** — `new Date('2027-01-21')` is UTC and lands on the 20th west of
  Greenwich, which is how a trip silently loses a day. `addMonths` clamps to a
  shorter month, where `Date.setMonth` would skip to 3 March. `isIsoDate`
  round-trips rather than parsing, because `2027-02-30` is not `NaN` to a
  browser, it is 2 March
- Clicking before a pending start restarts the range rather than producing a
  backwards one; a complete range restarts on the next click, so there is no
  "clear" step to find first
- Arrow keys walk a day and a week at a time and page the view at the edges.
  Every day is a real `<button>` with a full `aria-label` — "Thursday 21 January
  2027", since "21" alone tells a screen-reader user nothing

### Verification

731 tests across 45 files (645 → 731 this session), `tsc -b` clean, production
build clean, eslint clean on every changed file — the 53 remaining problems are
pre-existing and identical before and after, checked against a stash.

New: `cityLegs.test.ts` (16), `cityStays.test.ts` (25),
`multiCityPlanner.test.ts` (15, written from the traveller's own two reports),
`dateRange.test.ts` (32), `DateRangeCalendar.test.tsx` (12),
`CityStayPlanner.test.tsx` (11). One existing test was **rewritten rather than
repaired**: `trips.test.ts` asserted that a multi-city trip spreads cities
across its days, which was the behaviour being complained about.

Not verified: none of this has been through a browser. Both the inferred and the
stated splits were read out of real `buildDestinationItinerary` runs against the
Kansai fixture, but the switcher, the calendar, the stay planner and live
multi-city discovery have only been exercised in jsdom.

---

## 2026-08-06 (shortlist and verification session)

Theme: close the traveller's "don't give me 100 places for 10 days" complaint,
then stop asserting the planner works and demonstrate it on finished builds.

### Completed

`7635835` Record honest status and a verification backlog in the roadmap
- Documentation only. Adds a status section measured against the traveller's
  original goal rather than the document's own phases, plus §9 (what
  verification means for each unproven claim) and §10 (known gaps)

`c5dfce5` Make the save path testable and add a component test harness
- `sanitizeItinerary` / `sanitizeActivity` extracted from `App.tsx` to
  `src/lib/itinerarySanitize.ts`, behaviour unchanged, covered by 13 tests.
  Three of them fail against pre-`4c3d6c6` code — verified by reverting both
  fixes and watching them go red, not by assuming
- The idempotence test earns its place separately: the realtime sync compares
  JSON output to decide whether a remote payload differs, so a non-deterministic
  id or timestamp in the sanitiser would loop the sync
- jsdom + React Testing Library added. `node` stays the default environment so
  the pure lib suites stay in milliseconds; a component test opts into a DOM per
  file via a `vitest-environment` docblock. Shared setup registers jest-dom,
  cleans up between tests, and stubs `matchMedia`, which jsdom lacks and
  `ThemeContext` reads on mount
- The first component test found the flight-time and date labels were bare
  `<label>` siblings with no `htmlFor` — **unlabelled to a screen reader**, not
  merely unfindable by a test. Fixed
- Tests: 529 → 547 across 34 files

`141e6f4` Size the recommended shortlist to the trip, not to a constant
- `defaultDiscoveryDecisions` pre-selected a hardcoded 29 places whether the trip
  was three days or twenty-one. Capacity is now days × `maxMainActivities` for
  the pace, so Calm shortens the deck with no second rule existing anywhere:
  a three-day calm trip drops 29 → 9, a twenty-one day one rises to 59
- Food-only places are passed over — meals are drawn from the whole ranked list,
  so pre-selecting restaurants would spend sightseeing capacity on lunch
- `SHORTLIST_HEADROOM` covers accepted-but-never-scheduled places and is
  labelled provisional. `FATIGUE_SPREAD_TOLERANCE` was guessed at `0.25` and
  fired on nothing, so this one is called a guess rather than presented as
  measured
- Tests: 547 → 559

`d89bbe8` Prune stale decisions to the candidates actually on offer
- Decisions were restored by city and survived re-discovery; the candidate list
  did not. Hence the reported "45 of 20 reviewed — 33 selected" header, three
  numbers that cannot all be true, and a build that accepted nothing while a
  shortlist of 33 was on screen
- `pruneDecisionsToCandidates` intersects on candidate **id**, not name — two
  places in one city genuinely share names — and returns the discarded count so
  the loss can be shown rather than dropped silently
- Tests: 559 → 569

`b126f2b` Cap the shortlist at 100 and add the tool to tune headroom from data
- A twenty-one day Fast-paced trip worked out at 118 pre-selected places. The
  capacity is real (84 stops), but 118 is not a deck a person reviews
- The ceiling is applied *after* capacity, so a capped trip still reports the
  capacity it has. At 21 days the cap takes 118 → 100, above the 84 the days
  hold, so nothing is lost — only the margin narrows. The shortfall copy now
  checks instead of claiming a shortfall in both cases
- `measureShortlistFit` reports implied headroom (accepted / scheduled) and
  rejections by cause: `daily-capacity-reached` means the shortlist was too long,
  `opening-hours-conflict` / `walking-limit-exceeded` mean the margin is working
- Tests: 569 → 579

`e419534` Record shortlist fit after each build, for developers only
- `recordShortlistDiagnostic` reads a finished build and writes nothing back, so
  scheduling is untouched. Gated to dev builds or `VITE_PLANNER_DIAGNOSTICS=true`
- Samples carry the pace *actually used* — `applyTravellerConstraints` can lower
  it, and averaging across paces would produce a number that fits no trip
- Up to 50 accumulate on `window.__plannerDiagnostics`, so a tuning pass is
  `copy(__plannerDiagnostics)` rather than scraping console lines
- Tests: 579 → 584

`6b369a6` Verify pace shaping and flight-time edges on real builds
- Roadmap §9.2 and §9.4 run through `buildDestinationItinerary` against the
  Melbourne fixture, so the claims are reproducible and stay checked
- §9.2 passes on every dimension §7 asked for: busiest day 2 / 3 / 3 stops, days
  opening 10:13 / 09:28 / 09:13, meals 85 / 70 / 55 minutes, walking 16 minutes
  against 34. `PACE_DEFAULTS` demonstrably reaches the plan — previously only
  inferred from the table
- The inverted departure window is handled better than expected: a 12:33 flight
  gives a 09:03 limit against a 09:30 start, and rather than throwing it
  schedules nothing and warns
- Tests: 584 → 594

`d742caf` Support dinner on late arrival days
- `6b369a6` found `shapeTripEdge`'s comment was wrong: an evening arrival did not
  leave "a day that is really just dinner". 19:30 plus two hours to clear the
  airport starts the day at 21:30, past the balanced return hour, so the window
  was zero minutes wide and day one came back completely bare
- `ARRIVAL_MEAL_ALLOWANCE_MINUTES = 180` now sets a `returnTimeOverride` on a
  `maxMainOverride: 0` arrival day, capped at end of local day, so one dinner
  fits. No main sight is invented; past the late-dinner cutoff the day is
  honestly empty and says so
- Tests: 594 → **596 across 37 files**

### Phase 7 measurement — deliberately not acted on

A sweep of 36 fixture builds (four cities, three paces, three trip lengths)
produced only **10 usable samples**; 26 were pool-bound and nine of the usable
rows came from Osaka, the only pool large enough. Median implied headroom was
1.75, but the metric is partly self-referential — the shortlist is *defined* as
capacity × 1.4 — and fixture hours are uniformly 09:00–18:00, so they cannot say
what live weekday closures do to the margin.

Fill rate by pace (3 / 5 / 8 days): Calm 67 / 100 / 100%, Balanced 78 / 80 / 88%,
Fast paced 75 / 70 / 63%. The declining fast-paced figure, dominated by
`no-viable-day`, suggests `maxMainActivities` is aspirational for active pace
once geography is real — not that headroom should rise.

**Decision: keep `SHORTLIST_HEADROOM = 1.4` and its provisional label** until
non-pool-bound samples from live places with real hours exist.

### Not verified

- **§9.3, the sync flicker.** `ITINERARY_SYNC_DEBUG` is still `true` in
  `src/lib/itinerarySanitize.ts`. Needs one browser reproduction, then the flag
  goes false and `logItinerarySync` is deleted
- **§9.1 deployed round trip.** The sanitisers are covered in `src/lib`; a real
  OSM place surviving discovery → save → reload in the deployed app is not
- **§9.5** still needs the service-role key and `TRAVEL_REFRESH_SECRET`, neither
  in the working tree

### Correction owed to the roadmap — since made, and then closed

§9.6 claimed the jsdom setup covered "the sync layer and its revision guard" and
"the discovery deck's interactions". It did not: `TripIdentityPanel.test.tsx`
was the only component test, the sync guard and decision pruning were covered as
pure-lib tests, and the deck was covered by nothing.

Uncommitted follow-up, in this session:

- The roadmap's status section, §9.1 and §9.6 now separate what is covered by
  extraction into pure-lib tests from what the jsdom harness itself covers, and
  list what remains unproven
- **`src/lib/deckGestures.ts`** — `isDragIntent`, `swipeDecision` and
  `shouldCloseFromSurface`, extracted from three inline conditions inside
  `DestinationDiscoveryPanel`. Framer Motion's pointer drag cannot be driven
  honestly in jsdom, so the arithmetic is separated from the gesture: the
  component keeps the wiring, the module keeps the judgement
- **`deckGestures.test.ts`** (15 tests) covers the thresholds, including the
  cases worth naming — the drag threshold is strictly greater than, so a hand
  resting on the boundary still opens the card; an abandoned swipe suppresses
  its trailing click while deciding nothing; and distance beats a contradicting
  velocity, so a rightward throw is never read as a skip
- **`DeckCard.test.tsx`** (8 tests) covers the half a browser is needed for:
  which clicks open the card, which close it, and that a source link and a live
  text selection are left alone. `DeckCard` is now exported
- Verified by mutation rather than by assumption: dropping the
  interactive-target and selection guards turns four tests red, including the
  component-level "leaves the source link alone"

Tests: 596 → **619 across 39 files.** `tsc -b` clean, eslint clean on changed
files. Still a browser observation: that a real mouse drag suppresses the click
trailing it. That is the limit of what jsdom can honestly assert.

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
