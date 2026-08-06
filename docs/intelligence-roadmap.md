# Intelligence Roadmap

Goal, in the traveller's own words:

> Pull the latest reviews from around the internet — not just social media. Be
> trendy and always up to date. Then be genuinely intelligent about scheduling:
> not just "fit lunch into a day", but travel distance, walking distance,
> enjoying time, eating time — every factor, as human as possible, and adapt to
> the mood the traveller chose.

This document is the plan to get there from the code as it stands today.

---

## Status — 2026-08-06

Measured against the goal quoted above, not against this document's own phases.

| Goal, in the traveller's words | State |
| --- | --- |
| "travel distance, walking distance, enjoying time, eating time — every factor" | **Done** |
| "as human as possible" — queue, rest, fatigue across days, meal venues | **Done** |
| "adapt to the mood the traveller chose" | **Done** — `PACE_DEFAULTS` fully enforced |
| Arrival and departure shaping | **Done** — flight times wired in `0fa4a02` |
| "don't give them 100 for 10+ days" | **Done, tuning still provisional** — see §6 Phase 7 |
| Multi-city trips — a stay per city, days that belong to one | **Done** — `cityStays` asked in the wizard, `planCityLegs` as fallback, city switcher in discovery |
| "pull the latest reviews from around the internet" | **Partial** — YouTube and official sites live; Google off by choice; Reddit dropped |
| TikTok / Douyin / RedNote discovery | **Blocked, permanently** — see §1 |
| "be trendy and always up to date" | **Built, never verified** — `travel-refresh` has not run against real due records |

Rough shape: **engine ~85%, sourcing ~40%, confirmed working end to end ~55%.**

The third number is the weak one, and it is the one that matters. Two examples
of why "built" and "working" are not the same thing here, both found on
2026-08-06 by reading rather than by testing:

- `sanitizeActivity` never copied `indoorOutdoor`. It is the only input to
  `isOutdoor`, so weather-aware ordering and the rain replan lost their data on
  the **first save of any trip** and had been running blind ever since.
- The same function matched `provider` against three of seven
  `DiscoveryProvider` values, so every place from OpenStreetMap, Wikivoyage,
  Amap or Baidu lost its attribution on save — which is all of them.

Both are fixed in `4c3d6c6`, and both are now covered by tests: `c5dfce5`
extracted the sanitisers out of `App.tsx` to `src/lib/itinerarySanitize.ts`
precisely so they could be reached. The save path
(`itinerarySanitize.test.ts`), decision pruning (`decisionPruning.test.ts`),
the Trip Identity fields (`TripIdentityPanel.test.tsx`) and the discovery card's
flip and gesture rules (`DeckCard.test.tsx`, `deckGestures.test.ts`) now have
automated coverage; §9 remains for the parts that need real builds or deployed
services.

---

## 0. What already exists

This is not a rewrite. The architecture is largely right; most of the work is
wiring, depth, and filling in config that was defined but never consumed.

Already built and working:

| Capability | Where | State |
| --- | --- | --- |
| Evidence model with source authority, freshness decay, promotion risk, corroboration | `src/lib/travelEvidence.ts` | Complete |
| Trend detection (recency + platform spread + organic share) | `travelEvidence.ts` → `trendStrength` | Complete |
| Human day simulation: travel → queue → arrive → visit → exit → walk → eat → rest | `src/lib/humanScheduler.ts` → `simulateDay` | Good, gaps below |
| Five-level pace table driving stops/day, start time, meal length, walking ceiling | `src/lib/travelBehaviour.ts` → `PACE_DEFAULTS` | Complete |
| Mood → pace inference, calmest-signal-wins | `travelBehaviour.ts` → `inferPace` | Complete |
| Traveller constraints (children, seniors, mobility) overriding pace | `travelBehaviour.ts` → `applyTravellerConstraints` | Complete |
| Geographic day clustering from real coordinates | `humanScheduler.ts` → `clusterCandidates` | Complete |
| Evidence-aware ranking (current quality beats lifetime rating) | `src/lib/placeIntelligence.ts` | Complete |
| Multi-provider capability resolution | `src/lib/destinationCapability.ts` | Complete |
| Cache tables and read/write helpers | `supabase/migrations/20260804000100_*.sql`, `_shared/cache.ts` | Built, **partly unused** |
| Link import for TikTok / Douyin / RedNote / YouTube | `supabase/functions/travel-import-link/index.ts` | Stores URL only |

The governing principle already written into `travelEvidence.ts` and worth
restating, because everything below must obey it:

> An AI model may **interpret** evidence, but may never **invent** it. Any
> operational fact shown to a traveller — hours, price, closure, queue length,
> route — has to point at a source record.

---

## 1. Honest constraints

These are not solvable by trying harder. The plan works around them.

**TikTok, Douyin and RedNote have no public search API for commercial apps.**
There is no legitimate way to ask "what is trending in Osaka on RedNote". The
existing comment at the top of `travel-evidence/index.ts` already says this and
it is still true. Scraping them violates their terms, gets the server IP banned
within days, and breaks whenever they change their markup. **This app will not
scrape them.**

What *is* legitimate, and is the path taken below:
- The traveller pastes a link. `travel-import-link` already accepts this.
- Public **oEmbed** endpoints return title, author and thumbnail for one
  specific URL. TikTok and YouTube both publish these. This is sanctioned.
- Official partner or research programs, if ever approved, slot into the
  existing `tiktokPartner` / `douyinPartner` / `rednotePartner` capability flags
  with no architectural change.

**Google reviews are gone** with the deleted Cloud project, and the review field
is what made it expensive — `reviews` is an Atmosphere-tier field, the priciest
Places SKU. Re-enabling it is a deliberate, capped decision, not a default.

**The replacement for "reviews" is broader than reviews.** Which is arguably
better: a star average is a lifetime number dominated by old visits, and
`currentQuality()` in `placeIntelligence.ts` already discounts it for exactly
that reason. What the traveller actually wants is *recent first-hand reports*.

---

## 2. Evidence: where the internet's opinion actually lives

Six streams, replacing one expensive one. Each maps onto the existing
`EvidenceSource` union in `travelEvidence.ts`.

### 2.1 Reddit — the honest counterweight

The single best addition, and currently absent. Reddit has a free public API,
and subreddits like r/JapanTravel, r/travel, r/Malaysia carry genuine trip
reports, "is X worth it" threads, and queue/timing detail that no marketing
channel produces.

Critically: the traveller's own complaint about RedNote is that it is *full of
marketing and promo*. Reddit is the structural antidote — it is where people say
a place is overrated. `promotionRisk()` already exists to weight this; Reddit
should sit high on authority for opinion claims and low for operational ones.

- New `EvidenceSource`: `'reddit'`, authority ~0.65
- Search per place name + city, sort by new, restrict to the last 12 months
- Comment bodies are the richest source of queue times and "go at 7am" advice

### 2.2 YouTube — video reviews, kept

Already implemented in `youtubeEvidence()`. Keep it, but move it off the shared
Google key. Create a Google Cloud project with **only** YouTube Data API v3 and
**no billing account attached** — it is then structurally incapable of charging
you. Split `secrets.youtube()` in `_shared/providers.ts:58`, which currently
aliases `GOOGLE_MAPS_API_KEY`, into its own `YOUTUBE_API_KEY`.

Quota note: `search.list` costs 100 units against a 10,000/day budget. At 25
places per run that is 2,500 units — roughly four discovery runs exhausts the
day. Section 4's caching is what makes this survivable.

### 2.3 Wikivoyage and Wikipedia — curated and free

Wikivoyage is human-curated "see / do / eat / sleep" per city, licensed openly,
no key, no rate cost. It is the closest free thing to editorial judgment and
directly replaces Google's `editorialSummary`.

Wikipedia's Pageviews API gives real popularity data — a defensible replacement
for `rating` / `userRatingCount` in `destinationSignificance()`.

### 2.4 OpenStreetMap — the place layer

Overpass API for discovery (`tourism=*`, `historic=*`, `amenity=marketplace`,
`leisure=park`). The seven `DISCOVERY_QUERIES` in `travel-discover/index.ts`
map onto OSM tags almost one to one. Free, keyless, unbillable.

Adds fields Google never gave you and the scheduler wants: `opening_hours`,
`wheelchair`, `fee`, `cuisine`, `diet:vegetarian`.

### 2.5 TripAdvisor — the review seam you already stubbed

`secrets.tripadvisor`, `EvidenceCapability.tripadvisor` and authority `0.75` are
already in the code, unused. The Content API free tier covers reviews and
ratings. Coverage skews touristy — which is fine, because `localRelevance()`
already penalises tourist-trap signals.

### 2.6 User-shared links — where TikTok, Douyin and RedNote enter

`travel-import-link` currently stores a URL and stops. It never becomes
evidence. Closing this loop is what makes the social streams real:

1. Traveller pastes a RedNote or TikTok link (flow exists)
2. Fetch public oEmbed metadata → title, author, thumbnail
3. Run claim extraction over the caption (§3)
4. Resolve which place it is about → `place_provider_links`
5. Insert into `source_documents` as `SourceEvidence`

The place-resolution step should propose a match and let the traveller confirm
when confidence is low, rather than guessing silently. `match_confidence` on
`place_provider_links` exists for exactly this.

---

## 3. Making the evidence intelligent

### 3.1 Replace regex extraction with a bounded LLM pass

`extractClaims()` in `travel-evidence/index.ts` is keyword regex, English only.
Against Chinese RedNote or Douyin captions it will not fire at all. Against
English it catches maybe a third of what a person would read out of a review.

Replace it with `travel-reasoning` (the Gemini function, currently reported 503
in `travel-intelligence-staging-status.md` — it needs `GEMINI_API_KEY` set).

The model's job is strictly **extraction, never generation**:

- Input: raw source text + the `TravelClaimType` union
- Output: structured `TravelClaim[]` with `type`, `summary`, `value`, `unit`,
  `strength`, and a **verbatim `excerpt`**
- **Validation gate: reject any claim whose `excerpt` is not a literal substring
  of the input text.** This is the guardrail that makes "may interpret, never
  invent" mechanically enforced rather than aspirational.
- Keep the regex rules as a fallback when the model is unavailable, so evidence
  degrades rather than disappears

This unlocks multilingual evidence in one step: Chinese, Japanese and Korean
sources become usable, which matters enormously for the destinations this
traveller is actually planning.

### 3.2 Claim types worth extracting that nothing currently reads

`TravelClaimType` already declares these, and no extractor produces them:

`visit-duration` · `best-time` · `photo-spot` · `accessibility` ·
`transport-tip` · `price` · `renovation`

`visit-duration` and `best-time` are the two that directly improve scheduling —
they feed `estimatedVisitMinutes` and `bestTimeWindows`, both of which
`simulateDay` already consumes but nothing currently populates from evidence.

### 3.3 Staying current

"Always up to date" needs a refresh job, not just a cache. `FRESHNESS_SECONDS`
in `_shared/providers.ts` already defines the right decay rates per data kind.

Add a scheduled Supabase function, `travel-refresh`, running nightly:
- Select `source_documents` where `expires_at < now()` for places on active trips
- Re-fetch only those, respecting per-provider rate limits
- Recompute `trendStrength` so "trending now" means the last 120 days

Only refresh places attached to a trip someone is actually planning. Refreshing
the whole database is how you rebuild the cost problem in a new shape.

---

## 4. Caching — the precondition for everything above

This is first in build order, before any new provider.

The RM 31.69 charge was not caused by Google. It was caused by **25 uncached
detail calls fanned out per button click**, with a cache layer built but never
imported. Free APIs punish the same pattern with bans instead of bills.

Three changes:

1. **Wire `_shared/cache.ts` into `travel-evidence`.** Read `source_documents`
   by place id, honour `expires_at`, fetch only misses, write back. The table
   and the expiry helper (`expiryFor('reviewSummary', …)`) already exist and are
   already imported in that file.
2. **Stop auto-firing evidence for all candidates.** `discoveryRuntime.ts:250`
   calls `travel-evidence` for every candidate immediately after discovery.
   Fetch evidence for the deck card the traveller is actually looking at, plus a
   small prefetch of the next few.
3. **Cache discovery itself** into `canonical_places` — currently an empty
   table. `expiryFor('placeIdentity', …)` gives 30 days normally, 7 near travel.

---

## 5. Scheduling: from good to genuinely human

`simulateDay` is already better than most trip planners. It models arrival
buffers, queues, exit buffers, walking budget as a hard limit, the walk home
reserved up front, and it reports every rejection with a reason. Keep all of it.

These are the concrete gaps found by reading it.

> **Phase 5a closed §5.1 and the weekly-closure half of §5.3.** The findings
> below are kept as the record of what was wrong and why it mattered.
>
> Two things worth carrying forward from doing it:
>
> - **`tsc --noEmit -p tsconfig.json` checks nothing in this repo.** The root
>   config is `{"files": [], "references": [...]}`, so that command silently
>   succeeds on broken code. The real check is `npm run build`'s `tsc -b`.
> - **Parallel type unions drift.** `RejectionReason` (scheduler) and
>   `DiscoveryUnscheduledReason` (persisted, in `data.ts`) list the same
>   concepts twice, as do `DiscoveryProvider` and the `provider` field on
>   `Activity`. Both pairs have now drifted once each. Worth collapsing.

### 5.1 Config that is defined but never enforced

`PACE_DEFAULTS` declares four fields `simulateDay` never reads:

| Field | Intended meaning | Current state |
| --- | --- | --- |
| `minimumFreeTimeMinutes` | Unscheduled minutes a day must preserve | Computed as output, never enforced as a constraint |
| `maximumContinuousWalkMinutes` | Longest single walk before a break | Never checked |
| `optionalActivities` | Low-commitment nearby stops | `DayLoad.optionalActivities` is hardcoded `0` |
| `allowCrossCityDays` | May a day cross into another city | Never consulted |

For a "very-relaxed" traveller, `minimumFreeTimeMinutes: 150` is the single
field that most expresses "do not pack my day" — and it does nothing. Enforcing
it means rejecting a candidate when placing it would drop free time below the
floor, with a new `RejectionReason: 'free-time-floor'`.

`maximumContinuousWalkMinutes: 15` for very-relaxed means a single 25-minute walk
should trigger a rest slot or a transit leg instead. The `rest` slot kind
already exists.

### 5.2 Meals are time blocks with no food in them

`maybeInsertMeal()` inserts a slot labelled `'Lunch'` with the reason *"A
schedule constraint, not a recommended attraction."*

For a traveller whose stated interests include street food and night markets,
this is the biggest single gap in the product. The day reserves 85 minutes and
names no restaurant.

Fix: select an actual food candidate for each meal slot —
- Near the current cluster (reuse `clusterCandidates` geography)
- Open during the meal window
- Matching `profile.styles` food tags and `budgetTier`
- Respecting `meals.dietaryNeeds` (OSM `diet:*` tags from §2.4)
- Queue within `maximumQueueMinutes` — a 90-minute ramen queue is a real
  scheduling event, not a footnote, and `queueMinutesFor()` already handles it
- Falling back to the current abstract block when nothing qualifies, so a day
  never fails to have lunch

Also: `meals.breakfastRequired` exists on the profile and is never scheduled.

### 5.3 Day assignment is greedy; it should optimise

Today `clusterCandidates` groups by geography and days are filled in order.
Three factors are ignored:

- **Weekly closures.** Many museums close Mondays. `regularOpeningHours` is
  fetched but `openingWindow()` only reads `periods[0]` — the day-of-week
  dimension is discarded entirely. A Monday day plan can be built entirely from
  places that are shut.
- **Weather.** `preferIndoor` is a `DayPlanRequest` flag with no caller wiring
  it to `travel-weather`. Rainy day should pull the indoor cluster forward.
- **Best-time windows.** A night market on a morning day, a sunset viewpoint at
  11am. `bestTimeWindows` is consumed by `preferredWindow()` but nothing
  populates it — §3.2's `best-time` claims fix the supply side.

Proposed: score every (cluster, day) pair on closure fit, weather fit, and
best-time fit, then assign greedily by best score. A full optimiser is
unnecessary; a 5-day trip with 6 clusters is a tiny search space.

### 5.4 Rebalance across days

`fatigueScore` is computed per day and used only for a warning. Once all days
are simulated, compare them: if day 2 sits at 0.9 and day 3 at 0.3, move the
last stop of day 2 into day 3 and re-simulate. Repeat until the spread is
acceptable or no move helps.

This is what makes the plan feel considered rather than generated.

### 5.5 Trip-shaped energy

- **Arrival day** starts late — `startTimeOverride` exists for this and needs a
  caller that knows the flight arrival time.
- **Departure day** must end early enough for the airport.
- **Jet lag**: for long-haul east-west travel, the first two days should ease
  in. A simple rule keyed on timezone delta is enough.
- **Last-day light**: nobody wants a 5-stop day before a night flight.

### 5.6 Explaining the plan

Every rejection already carries a `detail` string. Surface them. "We left the
Sky Deck out — it would have pushed you past your 75-minute walking limit" is
the single most trust-building sentence a planner can show, and the data for it
already exists in `SchedulingRejection`.

---

## 6. Build order

Each step is independently shippable and useful on its own.

**Phase 1 — Stop the bleeding, unlock everything else — DONE (2026-08-06)**
1. ✅ `travel-evidence` reads and writes `source_documents` + `travel_claims`
2. ✅ Evidence is lazy — the current deck card plus four, never the shortlist
3. ✅ Discovery cached in `discovery_cache`; identities in `canonical_places`
4. ✅ `evidence_probes` makes "asked, got nothing" a cacheable answer
5. ✅ The Routes capability probe is memoised instead of re-billed per request

*Independent of provider choice. No wasted work whichever way §2 goes.*

Shipped in `20260806000100_add_discovery_cache.sql` plus changes to
`_shared/cache.ts`, `_shared/cacheKeys.ts`, `_shared/providers.ts`,
`travel-discover`, `travel-evidence`, `discoveryRuntime.ts` and
`DestinationDiscoveryPanel.tsx`.

Three bugs found and fixed while building it, each of which would have kept
paying a provider:

- Every review of a place shared that place's page URL, and `source_documents`
  is unique on `(source, source_url)` — four of every five reviews would have
  been silently discarded on write. Fixed with a stable per-review fragment.
- An unconfigured provider would have recorded a probe saying it had been asked,
  so adding the key later would be ignored until that probe expired.
- Canonical linking is best-effort; when it failed, evidence for that place
  could never be cached until the discovery cache expired 30 days later. Linking
  now also repairs itself on the cache-hit path.

**Phase 2 — Free, unbillable place data — DONE (2026-08-06)**
4. ✅ `'osm'` added to `PlaceProviderId`; `searchOsm()` sits beside `searchAmap`
5. ✅ Wikivoyage curation — one request per *city*, never per place
6. ✅ OpenRouteService route matrix; the haversine fallback is untouched
7. ✅ `notability` replaces `rating` as the significance signal
8. ✅ `indoorOutdoor` is finally real, from OSM tags

*Discovery now works end to end with zero spend and no billing account.*

Notes worth carrying forward:

- **Seven billed searches became one free query.** A text API had to be *told*
  what "top attractions" means, so the old path ran seven searches. OSM objects
  carry their own classification, so one Overpass query asks for everything and
  the tags say which is which.
- **Restaurants are deliberately not in the Overpass query.** A city holds
  thousands and an unranked list of them is noise. Food comes from Wikivoyage's
  `eat` listings instead — curated, and a better answer.
- **`notability` is not a rating.** A star average measures lifetime
  satisfaction; notability measures documentation (encyclopedia article,
  heritage listing, guidebook entry). `destinationSignificance` takes the
  stronger of notability and review count, so a source carrying only one of the
  two is not penalised for the gap.
- **Transit has no ORS equivalent** on the free tier. Those elements stay
  `unknown` rather than being routed as walking, which would have invented a
  plausible-looking wrong duration.
- **OSM opening hours are parsed conservatively** and reported at `low`
  confidence. Weekly closures are still unmodelled — the Monday-closure gap in
  §5.3 remains open and is now the most valuable single fix left.

**Phase 3 — Evidence breadth — DONE (2026-08-06), except TripAdvisor**
7. ✅ Reddit ingestion, via app-only OAuth
8. ✅ YouTube split onto its own `YOUTUBE_API_KEY`
9. ✅ User-shared link loop: oEmbed → claims → `source_documents`
10. TripAdvisor into the existing seam — deferred; its coverage skews touristy,
    which is the least useful signal for this product

Also done here, since both were overdue:

- **Claim extraction moved to `_shared/claims.ts`** and given its own tests. It
  is the code that turns a stranger's sentence into something the planner acts
  on, and it had none. Writing them found a real gap: "the line was about 50
  min" — a far more natural phrasing than "line of 50 min" — was not matched,
  because the pattern allowed one hedge word and people use two.
- **The drifting unions collapsed.** `DiscoveryProvider` and
  `SchedulerRejectionReason` are now declared once in `src/data.ts` and
  re-exported. Both pairs had drifted; adding Reddit would have made it three.

Reddit needs free credentials (`REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET`
from a "script" app). The unauthenticated `.json` endpoints are not an option:
Reddit throttles and increasingly blocks anonymous requests from cloud IPs,
which is where Edge Functions run.

**Phase 4 — Evidence depth**
11. `GEMINI_API_KEY` set; LLM claim extraction with the substring validation gate
12. Extract `visit-duration`, `best-time`, `accessibility`, `price`
13. Nightly `travel-refresh` for expired evidence on active trips

**Phase 5a — Weekly closures and the dead pace config — DONE (2026-08-06)**
14. ✅ Day-of-week opening hours, end to end (fixes the Monday-closure bug)
15. ✅ All four dead `PACE_DEFAULTS` fields enforced

**Official sources + meals — DONE (2026-08-06)**

- ✅ **The official-source fetcher now exists.** `capabilitySnapshot()` had
  hardcoded `officialSources: true` since the capability model was written, and
  nothing implemented it — so `describeCapability` told travellers the plan was
  "checked against official sources" when nothing checked any. It is the
  highest-authority source in the model (weight 1.0, the only one permitted to
  establish a closure) and it needs no credential at all.
- ✅ Operator-published hours override community-maintained ones, read from
  schema.org JSON-LD.
- ✅ **SSRF guard** on those fetches. Venue URLs come from OpenStreetMap tags,
  which anyone on earth can edit, so this is attacker-influenceable input:
  `isSafePublicUrl` rejects non-HTTPS, credentials, odd ports, loopback,
  link-local (including the cloud metadata endpoint) and private ranges.
- ✅ Meals name a real restaurant, chosen on opening hours, queue tolerance,
  walking detour, budget tier, dietary needs and the traveller's own styles.
- ✅ `breakfastRequired` is finally scheduled.
- ✅ A separate, capped Overpass food query, because the sights query excludes
  restaurants on purpose and Wikivoyage alone is too thin to eat from.

Three things worth carrying forward:

- **`fatigueScore` is not comparable across pace profiles** — its own
  documentation says so, and a test was comparing it anyway. It passed by luck
  until meal travel shifted the numbers. Absolute exertion is the honest signal.
- **Food-adjacent is not food-only.** A night market is somewhere to eat *and*
  a genuine sight; the first cut of the split quietly deleted markets from
  sightseeing. `isFoodOnly` draws the line, `isFoodPlace` decides meal
  eligibility.
- **Suggested meal venues are not shortlisted places.** They are tracked apart
  from `scheduled`, or the "every accepted place is scheduled or explained"
  invariant breaks the moment the planner suggests a restaurant.

**YouTube daily cap — DONE (2026-08-06)**

`provider_usage` plus `consume_provider_quota()` count our own YouTube searches
and stop below Google's limit.

The cap is on **search calls, not quota units**. The Data API grants 10,000
units *and* 100 `search.list` calls a day; a search costs 100 units, so both run
out together — but the search count is the one that maps to something
meaningful: 100 searches is 100 places. Default ceiling 90, override with
`YOUTUBE_DAILY_SEARCH_LIMIT`.

Details that matter:

- **Reset is midnight Pacific, not UTC.** Counting in UTC would misalign the
  reset by up to eight hours.
- **The reservation is atomic**, so two concurrent requests cannot both take the
  last search. A counter in function memory would not work at all: Edge
  Functions run as many short-lived instances.
- **A refusal is not recorded as a probe.** We never asked, so tomorrow must ask
  again rather than treating today's silence as an answer.
- **A blocked place still serves its cached video evidence** — the cap stops new
  lookups, it does not discard what is already known.
- **Fails open.** Exceeding a YouTube quota costs nothing but an error response;
  there is no bill behind it. Failing closed would turn a brief database problem
  into a total loss of evidence.
- `travel-evidence` reports `youtubeQuota: { limit, used, blockedThisRequest }`,
  because otherwise a cap looks exactly like a provider outage.

**Cross-day rebalancing + rejection detail — DONE (2026-08-06)**

18. ✅ Cross-day fatigue rebalancing
20. ✅ The scheduler's own explanation reaches the traveller

`buildDestinationItinerary` now runs in three passes — fill the days in order,
even them out, then turn the result into the plan. The middle pass moves the
last stop off the hardest day onto the lightest and re-simulates, keeping the
move only when the spread genuinely narrows **and** no place is lost.

Measured, not guessed. On the Melbourne set, walking went from **34 / 12 / 10 /
9** minutes across four days to **10 / 12 / 16 / 15**.

Decisions worth keeping:

- **Tolerance is 0.18**, chosen from measured plans. A two-day trip at 0.47
  against 0.22 — one day twice as demanding — scores 0.247 and clearly wants
  evening out; a balanced three-day trip scores 0.140 and does not. The
  original 0.25 caught neither.
- **Comparing `fatigueScore` across days of one trip is valid**, unlike
  comparing it across pace profiles: every day here shares one behaviour
  profile, which is exactly what the score is normalised to.
- **Empty days are never targets.** Filling a free day is a different decision,
  and it interacts badly with the measure — an empty day is excluded from the
  spread, so putting one stop on it creates a very light active day and *widens*
  the range.
- **A geographically silly move rejects itself.** Nothing in the rebalancer
  knows about clusters, but moving a CBD stop onto a beach day adds a long
  transit leg, which fails the "must narrow the spread" test.

`SchedulingRejection.detail` now reaches the UI and is persisted, so *"Closed on
Mondays"* and *"Would push walking past your 75 minute limit, including the
journey back"* survive a reload instead of degrading to a category label.

**Phase 5d — DONE (2026-08-06)**

17. ✅ `bestTimeWindows` populated, from corroborated evidence
19. ✅ Arrival, departure and jet-lag day shaping

**`bestTimeWindows` now has a source.** `best-time` claims are extracted from
what people wrote — "go early", "at sunset", "lit up at night" — and turned into
a window only when sources agree. The bar is deliberately high, because the
scheduler *declines to place* a venue outside its window: one stranger's remark
could otherwise drop a place from the trip. It needs two independent sources,
and a rival window at half the weight or less.

The extraction rules are narrow in a specific way: each phrase must be about
timing, not enthusiasm. "Amazing at sunset" is a time; "amazing" is not.

**The trip's edges are no longer ordinary days.** `shapeTripEdge` gives day one
a start two hours after landing (and no main stops at all after an evening
arrival), ends the last day in time to leave for the airport, and eases the
first two days of a long-haul trip.

- **The old arrival override was dead code.** `index === 0 && itinerary.days.length === 0`
  is false whenever the itinerary already has day placeholders — which it always
  does — so the 15:00 start never once applied.
- **`maxMainOverride` may only ask for less.** A caller can request a gentler
  day; it cannot raise the traveller's own ceiling.
- **Jet lag is computed, not asked for.** `timezoneShiftHours` reads the
  browser's zone against the destination's, on the trip's own start date so a
  daylight-saving boundary does not put it an hour out. Unknown zones return
  undefined rather than zero — "no difference" and "no idea" must not share a
  value.
- ~~Flight times have no home on the profile yet~~ — closed in `0fa4a02`.
  `TripProfile.arrivalTime` / `departureTime` are collected in the create
  wizard and in Trip identity, and reach `tripEdges` alongside the time-zone
  shift.

**Nightly refresh + weather-aware assignment — DONE (2026-08-06)**

`travel-refresh` runs nightly and re-gathers what has expired. Until now the
only thing that refreshed anything was a traveller happening to reopen
discovery after the window lapsed — so the plan was most out of date precisely
when nobody was looking.

**The budget invariant.** Refresh and live traffic share one counter and differ
only in the ceiling they ask against: refresh passes `callLimit: 30`, live
passes `90`. Because the count is shared, refresh can never push the total past
30, which leaves at least 60 searches for people actually using the app. If
travellers get there first, refresh gets less, or none. No coordination, no
second table, no race — and no change to `consume_provider_quota`.

Official websites cost nothing and refresh freely, capped at 200 a night.

**Deviation from the approved plan, stated plainly.** "Trips departing within
seven days" is not queryable: `trip_registry` holds no travel dates and nothing
links a canonical place to a trip. The stand-in is **recency of interest** —
`evidence_probes.retrieved_at` records when the app last asked about a place, so
the most recently probed places refresh first and anything untouched for 30 days
refreshes not at all. Same cost discipline, different route. True departure-date
targeting needs a start date on the registry and a place→trip link.

**A flaw caught mid-build.** Marking the official probe fresh makes the next
live request *skip* the fetch — so hours read overnight would have been thrown
away, and the traveller left on community-maintained ones. The refresh would
have actively suppressed the better answer it had just found. Hours now persist
in `opening_hours_snapshots`, and `travel-evidence` reads them when it skips.

**Weather-aware day assignment.** `assignClustersToDays` sends the sheltered
part of the city to the day the forecast says is wet. Ordering *within* a day
could only shuffle what the day was given; if the wet day got the gardens and
the beach there was nothing to bring forward. A swap needs a 25-point
improvement in indoor share, so a coherent day is never traded for a marginal
one.

**Still open**

- Departure-date targeting for the refresh job, per the deviation above.
- Phase 4: LLM claim extraction, which needs `GEMINI_API_KEY`.

Closed since this list was written: flight times on `TripProfile` (`0fa4a02`),
the `sanitizeActivity` field losses (`4c3d6c6`), the component-test harness
(`c5dfce5`) and trip-length shortlist sizing (`141e6f4`).

**Phase 6 — Prove what exists actually works — PARTLY VERIFIED**

Nothing new is built here. This phase closes the gap between "shipped" and
"observed working", and it comes first because everything after it is built on
paths that have never been confirmed. Detail in §9.

26. Verify the discovery → build → save → reload round trip keeps its data
27. Verify `travel-refresh` against real expired probes
28. Verify the deployed Vercel build
29. Confirm the 03:00 cron fires and the quota split holds
30. Confirm the itinerary-sync flicker is closed, then strip the tracing

**Phase 7 — Shortlist sized to the trip — DONE; tuning remains provisional**

The traveller's own complaint: *"don't give them like 100 for 10+ days, they
don't have time to go to so many places."*

`defaultDiscoveryDecisions` in `src/lib/destinationPlanner.ts` now derives the
target from trip length and pace, rather than using the old:

```ts
ranked.slice(0, 2)   → 'must-do'
ranked.slice(2, 29)  → 'interested'
```

A hardcoded 29 for every trip. A 3-day city break and a 21-day trip used to get
an identical shortlist.

31. **Done.** Derive the target from capacity, not a constant: `dayCount` ×
    `PACE_DEFAULTS[pace].maxMainActivities`, which already differs per pace —
    so Calm asks for fewer places than Fast paced without a second rule
32. **Done, with the multiplier still provisional.** Add headroom for rejection, not a flat multiplier. Places are lost to
    opening hours, walking limits and clustering; `unscheduledReasons` already
    records why, so the overshoot can be measured from real plans rather than
    guessed. Measure before choosing the factor — `FATIGUE_SPREAD_TOLERANCE`
    was guessed at `0.25` and fired on nothing
33. **Done.** Keep meals out of the count. `isFoodOnly` places are drawn from a separate
    pool and must not consume sightseeing capacity
34. **Done.** Show the traveller the target: "about 30 places for 11 days" beats an
    unexplained deck length

### Phase 7 measurement result — 2026-08-06

`measureShortlistFit` is called after each development build and stores up to
50 samples in `window.__plannerDiagnostics`, grouped by city, trip length, and
the pace actually used. A sweep of 36 fixture builds (four cities, three
paces, three trip lengths) produced only 10 usable samples: the other 26 were
pool-bound, and nine of the usable rows came from Osaka, the only pool with
enough places for the chosen shortlist.

The usable median implied headroom was 1.75, but that number must not tune the
constant. The metric is partly self-referential: the shortlist is deliberately
capacity × 1.4, so `accepted / scheduled` above 1.4 mostly measures places lost
to other constraints. Fixture opening hours are also uniformly 09:00–18:00,
so they cannot tell us how live weekday closures affect the margin.

The fill-rate pattern points elsewhere:

| Pace | 3 days | 5 days | 8 days |
| --- | ---: | ---: | ---: |
| Calm | 67% | 100% | 100% |
| Balanced | 78% | 80% | 88% |
| Fast paced | 75% | 70% | 63% |

Active-pace underfill is therefore not evidence that headroom is too small.
In the clearest case, Osaka at eight days and fast pace, the shortlist was
already the full 35-place fixture pool and only 20 of 32 nominal slots filled;
most rejections were `no-viable-day`, with no opening-hours or walking-limit
signal because the fixture data could not exercise those paths. This suggests
that `maxMainActivities` is aspirational for active pace when geography and
travel time are real, not that `SHORTLIST_HEADROOM` should increase.

Decision: keep `SHORTLIST_HEADROOM = 1.4` and its provisional label. Revisit
after collecting non-pool-bound samples from live places with real hours.

**Phase 8 — Sourcing breadth — PARTLY BLOCKED**

35. **Done** — fix carried-over decisions on re-discovery (below; it blocked any honest
    measurement of shortlist size)
36. TripAdvisor, the one unimplemented free-tier review seam — §2.5
37. Phase 4 LLM extraction, which is what turns a pasted RedNote or TikTok link
    into structured claims — the only lawful route to those platforms
38. Decide the Google reviews question in §8 deliberately, with a hard cap

---

## 7. How we know it worked

The traveller's own test, made concrete:

- Selecting **Calm** produces a visibly different itinerary from **Fast paced** —
  fewer stops, later start, longer meals, more free time, and the free-time floor
  is actually held.
- No day contains a place that is closed that weekday.
- Every meal slot names a real restaurant that is open, affordable and matches
  the traveller's dietary needs.
- Every claim shown traces to a URL, and its excerpt appears verbatim in the
  source.
- "Trending" reflects the last 120 days, and a coordinated promotional push does
  not create a trend — `trendStrength`'s `organicShare` term already guards this.
- A full discovery run for a new city costs nothing and cannot be billed.

---

## 8. Open questions

- **Google reviews**: leave out permanently, or re-enable behind a hard quota
  cap once caching is in place? Review *text* is genuinely the richest evidence,
  and cached at 7-day expiry the volume would be a fraction of what was charged.
- **Reddit API terms** have changed repeatedly; confirm current commercial-use
  and rate-limit terms before building on it.
- **Free-tier limits** for OpenRouteService and TripAdvisor shift over time —
  verify current quotas rather than trusting figures quoted from memory.
- **Is `AMAP_API_KEY` set?** `resolveDestinationCapability` excludes
  OpenStreetMap when `regional` is true, so mainland China routes to Amap or
  Baidu and nothing else. A Guangzhou deck rendering live data therefore means
  a **paid** provider is configured. Confirm this deliberately rather than
  discovering it on an invoice.

---

## 9. Verification backlog

What "verified" means for each unproven claim, and exactly what it takes. These
are ordered by how much later work depends on them.

### 9.1 The save round trip — no credentials needed

The highest-value check, because it is where both silent data losses lived, and
it needs nothing but the app.

1. Build a plan through the discovery panel and apply it
2. Reload the page
3. In the console: `JSON.parse(localStorage.getItem('itinerary-<user>-<id>'))`
4. Assert on a scheduled place activity that these survived:
   `indoorOutdoor`, `provider`, `durationMinutes`, `transportMinutes`,
   `transportMode`, `travelEstimateSource`, `sourceReferences`, `coordinates`

**Passes when** a place from OSM still says `provider: 'osm'` and keeps its
`indoorOutdoor` after a reload. Before `4c3d6c6` both were `undefined`.

**Automated coverage:** `itinerarySanitize.test.ts` covers the sanitisation
itself — including both field losses, verified by reverting `4c3d6c6` and
watching three tests go red — and `TripIdentityPanel.test.tsx` covers the Trip
Identity save path. Neither exercises Supabase, `localStorage` or a real
provider payload, so the deployed OSM round trip remains a live-environment
check.

### 9.2 Mood actually changes the plan — no credentials needed

The criterion is now covered by reproducible real-build tests in `6b369a6`.

1. Same city, same dates, same shortlist
2. Build once with **Calm**, once with **Fast paced**
3. Compare stops per day, start time, meal length, free-time floor

**Passes when** the two are visibly different plans. The recorded build
comparison showed relaxed / balanced / active paces producing different
stops-per-day, start times, meal lengths, and walking totals.

### 9.3 Itinerary sync flicker — no credentials needed

1. Open a long trip, rebuild, watch the console for `[itinerary-sync]`
2. Read the `applied`, `incomingRevision`, `currentRevision`, `incomingDays`,
   `currentDays` fields on each line

**Passes when** no `realtime-echo` or `remote-fetch` line reports
`applied: true` alongside an `incomingDays` lower than `currentDays`.

**Then** set `ITINERARY_SYNC_DEBUG = false` in `src/App.tsx` and delete
`logItinerarySync` and its call sites — deliberately one flag and one function
so this is a small change.

### 9.4 Flight-time shaping — no credentials needed

Wired in `0fa4a02` and verified through finished builds in `6b369a6`.

1. Set arrival `19:30`, departure `20:00` in Settings → Trip identity
2. **Rebuild through the discovery panel** — editing the profile does not
   re-run the planner, which is why this looked broken on 2026-08-06
3. Day one should hold no main sights, only a late meal; the last day should
   end by 16:30; both should carry the traveller-facing note. A 19:30 arrival
   now allows a dinner-only day without raising the sightseeing allowance.

**Also test the inverted window:** a departure early enough that the airport
   lead lands before the day starts — `12:33` gives a 09:03 limit against a 09:30
   start. `simulateDay` should schedule nothing and say why. This case is now
   covered by the real-build verification.

### 9.5 Needs credentials not in the working tree

`.env.local` holds only `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
`VITE_SUPABASE_AUTH_REDIRECT_URL` and `YOUTUBE_API_KEY`. No service-role key,
no `TRAVEL_REFRESH_SECRET`, and the Supabase CLI is not installed.

| Check | Needs | Method |
| --- | --- | --- |
| `travel-refresh` does real work | service role + `TRAVEL_REFRESH_SECRET` | Expire one probe (SQL below), re-run the protected curl, expect `officialRefreshed: 1` |
| Cron fires at 03:00 | Supabase dashboard | Read the function logs the morning after |
| Quota split holds | Supabase dashboard | `youtubeBlocked` stays 0 until the refresh budget is genuinely spent; refresh must never exceed 30 of the shared counter |
| Deployed frontend | a Vercel build | Weather assignment, best-time merge and trip-edge shaping all shipped in `a6704cd` and have only ever run locally |

```sql
update evidence_probes set expires_at = now() - interval '1 day'
where source = 'official-website'
  and canonical_place_id in (select id from canonical_places limit 1);
```

No undo needed — the sweep rewrites `expires_at` itself.

### 9.6 The structural gap — narrowed, not closed

The gap was that all 32 test files were `src/lib`, so anything living inside
`App.tsx` or a component was unreachable. `c5dfce5` addressed it in two ways,
and it is worth keeping them distinct:

**By extraction, into pure-lib tests** — the larger share of the win:

- the save path (`sanitizeItinerary` / `sanitizeActivity`), where both silent
  losses lived — `itinerarySanitize.test.ts`
- the revision guard `isNewerItineraryRevision`, which orders versions so a
  late-resolving fetch cannot roll back a rebuild — same file
- stale-decision pruning — `decisionPruning.test.ts` (`d89bbe8`)
- shortlist sizing and the 100-place cap — `shortlistSizing.test.ts`
- pace and flight-edge shaping through finished builds —
  `destinationPlannerGeneric.test.ts` (`6b369a6`, `d742caf`)

**By the jsdom + RTL harness itself:**

- `TripIdentityPanel.test.tsx`, covering the flight-time and date fields and the
  panel wiring that connects the profile to `BuildOptions`
- `DeckCard.test.tsx`, covering the card's flip: which clicks open it, which
  close it, and which — a source link, a live text selection — must be left
  alone. The gesture *rules* moved to `src/lib/deckGestures.ts` and are covered
  by `deckGestures.test.ts`, because Framer Motion's pointer drag cannot be
  driven honestly in jsdom. Both were checked by mutation: removing the
  interactive-target and selection guards turns four tests red

**Still uncovered:**

- the drag gesture *itself*. `isDragIntent` and `swipeDecision` are tested, and
  the component calls them, but that a real mouse drag suppresses the click
  trailing it remains a browser observation
- the *call sites* of the revision guard in `App.tsx`. The comparison is tested;
  that the remote fetch and the realtime handler both consult it is not
- `DestinationDiscoveryPanel`'s use of `pruneDecisionsToCandidates` — the pruning
  is tested, the wiring is not

The remaining manual checks are the deployed discovery → save → reload round
trip (§9.1) and the itinerary-sync browser observation (§9.3).

---

## 10. Known gaps not yet scheduled

### Current verification amendment — 2026-08-06

Reproducible finished-build tests now verify that Calm, balanced, and
fast-paced profiles reach the scheduler and produce different stop counts,
start times, meal lengths, and walking totals. They also verify a shortened
departure day, the inverted departure window, and a dinner-only first day for
a 19:30 arrival: no main sightseeing stops, but a real meal when one fits or
a flexible dinner fallback otherwise.

The save path and stale-decision pruning are covered by pure-lib tests; the
Trip Identity fields and the discovery card's flip by component tests, with the
deck's gesture rules extracted to `deckGestures.ts` so they could be reached at
all. §9.6 lists what remains uncovered. The shortlist sweep remains deliberately
untuned: 26 of 36 fixture builds were pool-bound, and active-pace underfill was
dominated by `no-viable-day` in the only sufficiently large pool. Keep
`SHORTLIST_HEADROOM = 1.4` until non-pool-bound live samples with real hours
exist. The carried-decision issue is closed by `d89bbe8`.

- **Carried-over decisions are now filtered to the current candidate set.**
  `pruneDecisionsToCandidates` intersects by canonical candidate id and reports
  how many stale selections were discarded, so a rebuild cannot silently
  accept nothing because the city returned a different deck. Closed by
  `d89bbe8`.
- **Nothing tells the traveller the day plan is stale after a profile edit.**
  `profileRevision` guards generated *copy* against its frozen proposal; there
  is no equivalent for the days. A traveller can set flight times, see the plan
  unchanged, and reasonably conclude the feature does nothing.
- **Route reordering is arrow buttons, not drag.** `CityStayPlanner` lets the
  traveller set both the length and the order of every stay, which is the part
  that matters; moving a city up a four-row list is still fiddlier than dragging
  it would be.
- **Amap POI noise reaches the shortlist.** A Guangzhou deck ranked "AAG
  Markets" — a financial-services office — at 58 with "central to understanding
  this city". Regional-provider keyword search has no category gate equivalent
  to `osmPlaces.ts`.
- **No photos.** `photoUrl` and `photoAttribution` exist on `PlaceCandidate`
  and `PlaceMedia` renders them, but nothing populates them since Google was
  removed. Wikidata `P18`, the OSM `wikimedia_commons` tag and MediaWiki
  `pageimages` are all free and keyless. Coverage would be partial — notable
  sights yes, a market stall no — and Commons requires visible attribution.
