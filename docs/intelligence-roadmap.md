# Intelligence Roadmap

Goal, in the traveller's own words:

> Pull the latest reviews from around the internet — not just social media. Be
> trendy and always up to date. Then be genuinely intelligent about scheduling:
> not just "fit lunch into a day", but travel distance, walking distance,
> enjoying time, eating time — every factor, as human as possible, and adapt to
> the mood the traveller chose.

This document is the plan to get there from the code as it stands today.

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

**Phase 2 — Free, unbillable place data**
4. Add `'osm'` to `PlaceProviderId`; write `searchOsm()` beside `searchAmap`
5. Wikivoyage + Wikipedia pageviews for curation and significance
6. OpenRouteService for the route matrix; keep the haversine fallback

*After this, discovery works end to end with zero spend and no billing account.*

**Phase 3 — Evidence breadth**
7. Reddit ingestion
8. Split YouTube onto its own billing-free key
9. Close the user-shared link loop: oEmbed → claims → `source_documents`
10. TripAdvisor into the existing seam

**Phase 4 — Evidence depth**
11. `GEMINI_API_KEY` set; LLM claim extraction with the substring validation gate
12. Extract `visit-duration`, `best-time`, `accessibility`, `price`
13. Nightly `travel-refresh` for expired evidence on active trips

**Phase 5 — Scheduling intelligence**
14. Enforce the four dead `PACE_DEFAULTS` fields
15. Real restaurants in meal slots; add breakfast
16. Day-of-week opening hours (fixes the Monday-closure bug)
17. Weather-aware and best-time-aware day assignment
18. Cross-day fatigue rebalancing
19. Arrival/departure/jet-lag day shaping
20. Surface rejection reasons in the UI

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
