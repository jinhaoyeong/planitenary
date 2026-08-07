# Changelog (AI sessions)

Running log. Newest first. Rationale lives in `CLAUDE_CONTEXT.md`.

---

## 2026-08-07 (place details: cost, hours, and why it ranks)

> "the details is kinda useless… the cost is unknown… i dont get the opening
> hour… why it rank here feels hardcoded as well… generic and surface default
> hardcode style answer"

All eight steps. Data contracts first, UI next, Gemini last — so the
deterministic version could be judged before any model was in the loop.

**The claim cache was losing what claims meant.** `applies_to` was written to
`travel_claims` and never read back — and the write was missing it too. A
cached `best-time` claim returned with its window stripped, so
`summarisePlaceEvidence` silently stopped producing best-time windows for any
place whose evidence was cached. Both ends fixed; `parseAppliesTo` lives in
`cacheKeys.ts` because `cache.ts` cannot be loaded by vitest, and a round trip
nothing can test is how this survived. `discoveryCityKey` now carries a schema
version, so a new candidate field is not absent from cached rows for 30 days.

**One reading of opening hours, not two.** `openingWindow` moved to
`src/lib/openingHours.ts` and the scheduler imports it back —
`humanScheduler.test.ts` passes unmodified, which is the proof. The panel had
been reading `periods[0]` and printing `09:00–17:00 · high confidence`, so a
museum published `Tu-Su` looked open on Monday to the person deciding whether to
go, while the planner knew otherwise. `describeOpeningHours` groups the week
(`Tue–Sun`), keeps both windows of a day that shuts for lunch, reads the clock
in the destination, names closed days, and says *"Closed on Monday 19 Apr — a
day of your trip."* A holiday closure is asserted only from a date-specific
source rule; `osmOpeningCaveats` states the gaps the parser refuses to guess at
instead of leaving them invisible.

**Reasons that differ from card to card.** The six-sentence table is gone.
`placeRationale.ts` names the traveller's own style words, orders by
contribution (`value × weight`) rather than raw value — the mechanical cause of
every card reading alike — names the evidence under each dimension, compares
against the finished shortlist, and drops any dimension true of more than 70% of
it. Superlatives are guarded: "the only one" needs a count of one, ties read as
"among the most", percentiles vanish below eight candidates.

Found by printing real output rather than trusting the tests: `STYLE_TAGS.temples`
includes `history`, so the first working version told a traveller the *Osaka
Museum of History* was one of the temples they had asked for. Fuzzy expansion is
fine inside a score; said out loud it is a false claim about their own input.
Styles are now named only from the tags that define them.

**What a place costs.** `_shared/placeCost.ts`. A category never sets `class` —
a shopping street may be free to enter and a market may hand out samples — so
categories set `expectation` only, and an unpriced market reads "No admission
price published · spending happens inside". A number without a resolvable
currency is never shown: `¥600` is JPY in Osaka, CNY in Shanghai, and *nothing*
with no country to read it against. Recovered the Wikivoyage price that
`travel-discover:665` discarded with it in scope one line away, the OSM `charge`
tag already in the Overpass payload, and the Amap/Baidu spend figures declared
in the interfaces and never read. `fee=yes` with no charge is now "Ticket
required · no source published the price" rather than "Cost unknown".
`budgetFit` no longer scores an unknown cost as a confident mid-price.

Three bugs the tests caught: `6.00 EUR;3.00 EUR concession` labelled the *adult*
ticket a concession (the look-ahead crossed into the next price); `600 yen`
resolved to currency `YEN`, three letters passing the ISO regex; `¥600–¥1,000`
dropped the upper figure without keeping the raw text.

**It survives the save.** `Activity.admission` and `Activity.openingHoursWeek`
through `candidateToActivity` → `sanitizeActivity` → reload. `admission.fares`
is canonical; `estimatedCost` takes the *adult* fare with its currency attached,
never a child fare. `fares: []` is preserved because it means something.
Malformed fares are dropped individually rather than taking the adult fare with
them, and an admission with no attributable source is refused. Validation uses
keyed records so the build fails when a union grows — the bug class that
previously cost this file `indoorOutdoor` and four of seven providers.
Idempotent down to key order, since the realtime path sanitises then compares
`JSON.stringify`.

Fixtures gained a Tue–Sun museum, a temple that shuts for lunch, and five real
fares: every fixture previously opened every day at one uniform window with no
price, so nothing offline could demonstrate any of this.

**The UI, both surfaces (step 6).** `admissionCopy.ts` decides what a price
reads as, shared by the discovery card and the day card so a place cannot
describe its cost one way while it is being chosen and another once it is
planned. `formatPrice` and `openingSummary` are deleted.

`CandidateDetails` leads with a sticky verdict strip — Cost · Time needed ·
Today — because those are the three things the traveller called useless, and
they now stay answerable while the rest scrolls under them. Beneath it: an alert
slot reserved for a closure landing on a day of *their own trip*, a "Why it is
#3 for you" heading that names the position because that is the question, the
other fares with the source's own words when parsing could not represent all of
them, a grouped week of hours with named closed days, the stated caveats, and
cautions as a **list** — `join(' ')` had been running six warnings together
exactly when they mattered most. `sourceConfidence` is a sentence now, not an
enum.

`ActivityItem` gets one row, not a panel: the hardcoded `¥ {activity.cost}`
becomes a real fare, a clock chip showing *that day's* hours which turns red on
"Closed this day", and booking only when required. `DayPlan.date` is a display
string ("12 Apr"), so the ISO date comes from `profile.startDate + (day − 1)` —
without it the card cannot ask the only question that matters.

Tests were written before the markup, since `DeckCard.test.tsx` asserts only
flip mechanics and there was no safety net on content at all.
`ActivityFacts.test.tsx` asserts through the whole discovery → convert → save →
JSON → reload path rather than from an in-memory object, and that both surfaces
describe the same place identically. It caught a real gap: a single-fare place
rendered its price with no attribution, because the admission section was gated
on having *extra* fares.

**The local browser pass found one real persistence bug.** On the transition
into Demo Mode, App could save the previous profile-less seed before the demo
storage key had hydrated. That left a valid but stale primary ahead of the
profile-rich backup on the next reload. Persistence now gates on the hydrated
storage key, and Demo Mode opts into recovery only when the backup contains a
valid profile missing from the primary. `storageResilience.test.ts` covers the
primary-first default and the explicit recovery policy.

With the fix live at `http://localhost:5199`, an existing Osaka Demo trip
(10–17 Apr 2027) survived a full reload and reopened the discovery review.

**The full acceptance walk then ran against the Osaka fixtures**, on a trip
spanning Monday 12 Apr 2027. The card measured **520×426 at x=545 before and
after the flip** — identical, which settles the one item the plan had flagged
as verified only by construction. Osaka Castle Museum read `JP¥600 · adult
ticket · ≈ RM 16`; Nakanoshima `JP¥1,500` with its student and child fares
beneath, plus `Closed on Monday 12 Apr — a day of your trip.`; Kuromon `No
admission price published · spending happens inside`; Osaka Castle Park `Free
entry`, and where nothing was published, `Not published · no source published
them` rather than an invented schedule. Shitennoji showed both halves of its
day, `08:30–12:00, 13:00–16:30`, on the discovery card and again on the day
card after a save and a reload. The scheduler put Nakanoshima on day four
rather than day three, routing around the Monday closure without being asked
to — the hours work paying off somewhere no test was pointed at.

**Two bugs surfaced that only a browser could have shown**, both of them the
panel overclaiming, which is the one thing this work exists to stop. A card
read `1 source · corroborated across sources`: the count and the confidence
sentence were chosen independently, so nothing stopped them contradicting each
other inside a single line — corroboration needs two things to corroborate.
And `Why it is #1 for you` sat directly above *"Nothing stands out on paper —
it is here for variety"*, a heading making a promise the next line broke;
where the rationale has only its fallback point, the heading now stops
claiming a rank reason. Both are fixed and both have regression tests written
from what was on screen.

**Official-site admission is now a real evidence source.** `admissionFromJsonLd`
reads schema.org `isAccessibleForFree`, `Offer`, `AggregateOffer`, and
`priceRange` data from the same JSON-LD block already used for operator hours.
Explicit currencies win; bare numbers use the canonical country code, and
unresolved ranges remain source text rather than becoming a guessed fare.
JSON-LD excerpts retain a literal substring of the original script, so the
price claim remains inspectable.

`officialEvidence` emits those prices at authority 1.0, with audience and
currency in `appliesTo`; review/video claim extraction remains unchanged and
cannot establish an operational price. `travel-evidence` returns an admission
map beside official hours, `discoveryRuntime` remaps provider IDs to candidate
IDs even when there is no prose document, and the panel merges the operator's
answer above OSM/Wikivoyage/provider data. Cached official claims reconstruct
the same admission on a fresh-probe hit, so the first read and the warm read do
not disagree. The nightly refresh also passes country code for safe currency
resolution.

Reviewing that extractor turned up a free place reading as a priced one:
`admissionFromJsonLd` classified a zero-priced offer as free only when the node
*also* carried `isAccessibleForFree`, which is optional and widely omitted, so
`offers: { price: "0" }` resolved to `ticketed` and the card would have read
`JP¥0 · adult ticket`. Fixed in the classifier and again in `admissionCopy`,
because zero is a price other sources publish too and the classifier is not the
last line of defence — guarded on *every* fare being zero, since a free child
ticket beside a ¥1,500 adult one is not a free museum.

**The model tier (step 8), the only place a sentence no human wrote can reach a
traveller.** `_shared/reasoning.ts` is written backwards from normal code: the
validators come first and the network call is bolted to the end of them,
because a system prompt asking a model not to invent things is a request, not a
guarantee. What is enforced is mechanical — every displayed sentence must carry
a `sourceUrl` we supplied and an `excerpt` that is a literal substring of the
text we supplied for it. A sentence that cannot is dropped and the rest are
kept; zero survivors means no brief at all, the same outcome as having no key.

The substring rule is the guarantee and the digit check only a pre-filter,
because "the finest garden in Kansai" contains no digits and an invented
adjective is what a traveller acts on. Three further rules exist because the
obvious version of this is defeatable: a **minimum excerpt length**, since
`"the"` is a substring of nearly any page and would otherwise launder a wholly
invented sentence; **no punctuation stripping** when normalising, since that is
where a paraphrase starts passing as a quotation; and **no hours, closures or
prices**, checked before the digit filter because the dangerous version of a
sentence about opening times is the one whose numbers really are in the source,
which would sail through and then contradict the structured hours beside it.

Gemini bills, so `reserveQuota` gained `failClosed`. It fails open by design,
and its own comment reasons about YouTube costing nothing on overrun — an
argument that holds only while the call is free. An unreachable counter now
means "don't call" here, as does a missing client, since that means nothing is
counting the spend at all. One attempt, one timeout, no retry: a failed brief
is a missing brief, and retrying turns a provider wobble into a bill. Separate
daily cap, enforced input ceilings, and counters for skipped, rejected and
kept — a grounding validator whose rejection rate nobody watches is one nobody
notices has stopped working.

On the card the brief is labelled *"Description written by AI from N sources,
each sentence quoted from one of them"*, inside its own bordered element that
model prose can never share with human prose, and only where no human wrote
any. Grounded is not the same as written by a person, and the traveller is
entitled to know which they are reading before weighing it. `aiReasoning` now
survives from `travel-capabilities` into `ProviderRuntime` — both the parser
and the type had been dropping it, so the client could not tell "no brief for
this place" from "no model in this deployment".

**The empty answer is cached too**, in `ai_place_briefs` — its own table,
because a generated description is not a source of evidence and reusing the
probe log would have meant widening an evidence-source union for something that
is not evidence. The daily cap stops runaway spend but not waste: without this,
a place the model had nothing to say about is asked about again tomorrow, and
every day after. So a row's *existence* is the cache hit and its payload is
allowed to be null, and `lookupAiBrief` returns `undefined` for a miss but
`null` for "we asked and nothing survived". Callers branch on presence, never
truthiness; four tests hold that line, because collapsing the two is the
obvious mistake and it is invisible when you make it.

The key is place plus a content hash of the grounding sources, so correctness
tracks what we read rather than the clock — a description stops being right
when the source changes, not when a week passes. The expiry is therefore
garbage collection, and the row gets the long TTL. `tsc` caught the key helper
dragging `Deno` globals into the browser program the moment a client test
imported it, so it sits in `cacheKeys.ts` beside `parseAppliesTo`, for the
reason that comment already gives: a key helper nothing can load is a key
helper nothing can test.

Two NUL bytes went into source files as string delimiters along the way —
functional, collision-proof, and enough to make `grep` and `file` classify both
files as binary. Replaced with printable separators.

Still unseen: dark mode on the `--warn` alert, and the back face on a real
mobile viewport. Live discovery still shows the category expectation on every
card because the step 2/4/7 edge functions are not deployed — the copy is
right, there is simply no fare in the payload yet. `admission-read` is now wired, and it is the only path by which a
model-derived price is ever shown as fact. It runs on official-site text only,
and two rules sit in a pure, tested function rather than inside the Deno-only
fetcher: structured pricing always wins, so a marked-up `Offer` is never
overridden and a well-marked-up site is never even asked about; and a
model-read fare is demoted rather than disguised — the source stays
`official-website` because the price really is published there, while
confidence drops to medium, so a number found in prose stays distinguishable
from one the operator marked up. The null result is cached like the brief's.

---

## 2026-08-06 (trip length changes)

> "What if user add one more day in the app after building and setting up the
> trip — does the UI update? Make sure it does."

It did not, in three separate ways.

**The day cards never followed the dates.** They were generated once, at
creation. Adding a day afterwards moved the hero badge to 9 and left eight
cards behind, so the ninth day existed nowhere the traveller could open it.
`syncDaysWithDuration` now runs inside `syncDurationDependentFields`, the single
path every profile write already takes.

- Growing appends. Shrinking removes trailing cards **only while they are
  empty** — a day with something on it is work, and deleting it to satisfy a
  date change would throw away what the traveller did; those days are kept and
  reported as stranded
- Clearing the dates changes nothing at all. Removing a date range is not an
  instruction to delete eight days of planning
- Dates refresh on every card, because moving a trip forward a week moves every
  day with it

**The stay plan was being discarded.** Eight placed nights no longer summed to
nine days, and a plan that does not add up was falling through to inference — so
adding one day silently threw away the whole thing. `fitCityStays` stretches the
last stay, or trims from the end when the trip shrinks, and the build says which:
"Your trip is 1 day longer than your stay plan, so it was added to Kyoto."

That needed a distinction the profile could not previously make. Three days
placed on an eight-day trip is either a finished plan for a trip that has since
grown, or one abandoned half-way; the first must be kept and stretched, the
second is better served by inference. `cityStayDayCount` records the length a
plan was set against, which is what tells them apart.

**Nothing said what had happened.** Trip Identity now reports it: an empty day
at the end says to rebuild through discovery, and days past the end of a
shortened trip say they were kept.

Verified end to end through the ordinary save path: build 8 days as Osaka 5 /
Kyoto 3, add a day, and the handbook returns nine dated cards and rebuilds as
Osaka 5 / Kyoto 4. 744 tests across 46 files.

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
