# Claude Context

Stable reference for this codebase. Changes rarely.

Current work lives in `CURRENT_TASK.md`. History lives in `CHANGELOG_AI.md`.

---

## Architecture

**Planitenary** is a travel itinerary planner. A traveller describes a trip
(destinations, dates, moods, styles, budget, pace); the app discovers real
places, gathers evidence about them from the open internet, and builds a
day-by-day plan a person could physically complete.

```
React + Vite (TypeScript, strict)          Supabase Edge Functions (Deno)
├── src/lib/          pure planning logic  ├── travel-capabilities   what is connected
│   ├── humanScheduler.ts   day simulation ├── travel-discover       places
│   ├── destinationPlanner.ts trip build   ├── travel-evidence       reviews, video, official sites
│   ├── placeIntelligence.ts  ranking      ├── travel-refresh        nightly re-gather (cron)
│   ├── travelEvidence.ts     evidence     ├── travel-route-matrix   travel times
│   ├── travelBehaviour.ts    pace         ├── travel-weather        forecast
│   ├── timezones.ts          jet lag      ├── travel-events         Ticketmaster
│   └── destinationCapability.ts           ├── travel-import-link    pasted social links
└── src/components/                        ├── travel-images         real place photographs
    └── DestinationDiscoveryPanel.tsx      └── travel-reasoning      OpenAI

                                           supabase/functions/_shared/
                                           ├── providers.ts      secrets, fetch, freshness
                                           ├── cache.ts          read/write-through caches
                                           ├── cacheKeys.ts      pure keys + fetch decisions
                                           ├── claims.ts         text → claims
                                           ├── evidenceSources.ts the four gatherers
                                           ├── imageSources.ts   Wikimedia image gatherers
                                           ├── officialSource.ts JSON-LD + SSRF guard
                                           ├── osmPlaces.ts      OSM tag mapping
                                           ├── placeImages.ts    licence + host + ranking
                                           ├── wikivoyage.ts     listing parser
                                           └── quota.ts          daily caps
```

### One discovery run

```
Panel → travel-capabilities  → which providers are live
      → travel-discover      → PlaceCandidate[]  (cached 30d / 7d near travel)
      → rankWithIntelligence → 8-dimension score
      → travel-evidence      → current deck card + 4 ahead, NOT the whole shortlist
      → travel-images        → same window; real photographs, batched per source
      → buildDestinationItinerary
           pass 1  fill days in cluster order
           pass 2  rebalance fatigue across days
           pass 3  materialise into DayPlan[]
```

---

## Database

| Migration | Adds |
| --- | --- |
| `20260804000100_add_travel_evidence_cache` | `canonical_places`, `place_provider_links`, `place_aliases`, `source_documents`, `travel_claims`, `route_cache`, `weather_cache`, `opening_hours_snapshots`, `user_shared_sources`, `plan_runs` |
| `20260805000100_grant_service_role_cache_writes` | Grants for `route_cache`, `weather_cache` |
| `20260806000100_add_discovery_cache` | `discovery_cache`, `evidence_probes`, index on `source_documents`, service-role grants |
| `20260806000200_add_provider_usage` | `provider_usage` + `consume_provider_quota()` |
| `20260806000300_grant_opening_hours_writes` | Grant for `opening_hours_snapshots` |
| `20260816000100_add_place_images` | `place_images`, `place_image_probes` + service-role grants |

### Tables that carry the most weight

- **`discovery_cache`** — `(city_key, provider)` → the full `PlaceCandidate[]`.
  Separate from `canonical_places` because that table stores *identity* only and
  cannot answer "what did discovery return for Osaka".
- **`evidence_probes`** — `(canonical_place_id, source)` records that a source
  *was asked*. This is what makes "this place has no reviews" a cacheable
  answer; without it, empty results re-fetch forever.
- **`provider_usage`** + `consume_provider_quota()` — atomic daily counter.
  Reserve-and-check in one statement, so concurrent requests cannot both take
  the last call.
- **`opening_hours_snapshots`** — operator-published hours. Must persist,
  because the nightly refresh marks the probe fresh and the next live request
  therefore skips the fetch.
- **`place_images`** + **`place_image_probes`** — real photographs and the
  record that Commons was asked. The probe table carries more weight here than
  `evidence_probes` does: *most OSM places have no photograph at all*, so
  "nothing found" is the common answer rather than the exception, and without
  the probe the majority of every deck is looked up again on every run. The
  `licence` column is not metadata — CC BY and CC BY-SA require attribution, so
  a row that lost it must stop being shown, and `parsePlaceImage` refuses to
  read one back without it.

Grants are always written explicitly. A silent write failure looks exactly like
"this place publishes nothing" — which is how the original cost bug hid.

---

## APIs

| Source | Cost | Key | Notes |
| --- | --- | --- | --- |
| **OpenStreetMap (Overpass)** | Free | None | Primary discovery. `OVERPASS_ENDPOINT` overridable |
| **Wikivoyage** | Free | None | Curated `see/do/eat`, one request per *city* |
| **Wikimedia Commons / Wikidata** | Free | None | Real place photographs. Batched 50 titles or ids per request |
| **Nominatim** | Free | None | City geocoding fallback; needs User-Agent |
| **Official venue websites** | Free | None | Authority 1.0. Only source allowed to assert a closure |
| **YouTube Data API v3** | Free | `YOUTUBE_API_KEY` | 100 searches/day; capped app-side at 90 |
| **OpenRouteService** | Free tier | `OPENROUTESERVICE_API_KEY` | Route matrix. No transit profile |
| **Open-Meteo** | Free | None | Weather |
| **Ticketmaster** | Free tier | `TICKETMASTER_API_KEY` | Events |
| **TikTok / YouTube oEmbed** | Free | None | Metadata for pasted links only |
| Google Places / Routes | **Paid** | `GOOGLE_MAPS_API_KEY` | Supported, deliberately not configured |
| Amap / Baidu | Paid | `AMAP_API_KEY` / `BAIDU_API_KEY` | Mainland China |
| Reddit | Free tier | `REDDIT_CLIENT_ID/SECRET` | Built; dropped — access needs approval |
| TripAdvisor | Free tier | `TRIPADVISOR_API_KEY` | Seam exists, unimplemented |
| **OpenAI** | **Paid** | `OPENAI_API_KEY` | Default reasoning provider. `gpt-5-nano`, effort `minimal` |
| Gemini | Paid | `GEMINI_API_KEY` | Adapter retained; inactive unless explicitly selected |

Other env: `YOUTUBE_DAILY_SEARCH_LIMIT` (default 90), `TRAVEL_REFRESH_SECRET`,
`TRAVEL_REASONING_PROVIDER` (default `openai`), `OPENAI_MODEL`,
`OPENAI_REASONING_EFFORT` (default `minimal`), `AI_DAILY_CALL_LIMIT`
(default 50).

### The reasoning provider is selected, never inferred

`reasoningProvider()` reads one env var; `reasoningKey()` reads only that
provider's credential. There is no `'auto'` and `callModel` has no failover
branch, because a provider chosen by which key happens to exist means an
outage — or an exhausted budget — silently starts billing the other vendor.
That is the same invisible-spend shape as the original RM 31.69 incident,
one layer up. Switching providers is a config change a person makes, not
something a `catch` block decides.

Both providers share one `ai-reasoning` quota counter, because the cap exists
because *a model bills* and that is true whichever one is selected. Two
counters would let a provider switch quietly reset the day's spend to zero.

**No source in the active set can generate a bill.** Overpass, Wikivoyage,
Nominatim, Open-Meteo and official websites have no payment path at all;
YouTube and ORS return `429`/`403` rather than an invoice.

---

## Design philosophy

The app previously ran on Google Places. One day of testing produced an
unexpected **RM 31.69** bill — 25 uncached `reviews` lookups per button click,
on the Atmosphere-tier SKU. The project was deleted. Much of what follows is
downstream of that.

### Never invent; always cite
*An AI model may interpret evidence, but may never invent it.* Every operational
fact shown to a traveller points at a source record with a **verbatim excerpt**.
If an LLM is introduced, reject any claim whose excerpt is not a literal
substring of the source text.

### A photograph is a factual claim, and is never generated
A picture is the first thing a traveller looks at and the last thing they think
to doubt, which makes it exactly the kind of assertion the rule above governs.
**No image of a place may ever be generated** — not by a model, not by
similarity search. A generated approximation of Osaka Castle is a false
statement about what somebody will see when they arrive, and one they cannot
detect. Every image is a real photograph with its author, its licence and a link
to its file page.

Two consequences worth stating separately, because both are load-bearing:

**Only Wikimedia hosts reach an `<img src>`.** The leads come from
community-edited OSM tags — the same untrusted input `isSafePublicUrl` guards on
the official-source path — but an image element is loaded by the *traveller's*
browser, so an arbitrary URL there hands a stranger the IP address of everybody
who sees the card. The `image=` tag is therefore never hotlinked: it is accepted
only when it already points into Wikimedia, and only as a *file title*, with the
real URL rebuilt from Commons alongside the licence.

**An unrecognised licence is not permission.** Commons also holds fair-use,
non-commercial and no-derivatives files. The gate is an allowlist, refusals run
before it (`CC BY-NC` starts with an allowed prefix), and the catch is often in
a field other than the short name. A refusal costs a photograph, which is always
the safe outcome.

### Authority gates operational facts
`OPERATIONAL_CLAIMS` + `claimIsPresentableAsFact` restrict closures,
renovations, prices and reservations to sources at authority ≥ 0.85. A forum
thread may say a place is overrated; it may not close it.

### Unknown is not zero
`usageToday` returns `null` when unreachable and `{calls: 0}` only when
genuinely unused. `timezoneShiftHours` returns `undefined` for an unknown zone.
`openingWindow` separates "hours unknown" from "closed today". A confident wrong
number is worse than an admitted gap.

Two corollaries, both learned from bugs that shipped:

**A category is not a price.** `PlaceAdmission.class` is only ever set by a
source that spoke about money. A shopping street may be free to walk into, a
food market may hand out samples, a nightclub may charge at the door — the
category proves none of it. Categories set `expectation`, which is rendered in
visibly hedged language and is never promoted to a class, wherever it is applied
from. This is why `admissionFor()` is safe to call as a client-side fallback.

**A number without a currency is not a price.** Currency is resolved once,
server-side, where the country code is known: explicit ISO code → symbol
disambiguated by country → country default → *stop*. `¥600` is JPY in Osaka and
CNY in Shanghai, and with no country to read it against it yields no amount at
all, only `rawText`. The predecessor of this rule rendered `'¥'.repeat(n)` for
every country on earth.

**An admitted gap must still be admitted out loud.** The OSM hours parser
correctly refuses to guess at public holidays, seasonal ranges,
sunrise-relative times and windows crossing midnight — but silently, which left
a confident-looking weekly schedule missing the one clause that mattered.
`osmOpeningCaveats` names each drop the source actually published.

### An explanation shared by everything explains nothing
A reason shown on most of a shortlist carries no information about any member of
it. `placeRationale` orders points by score *contribution* rather than raw
dimension value, suppresses any dimension true of more than 70% of the
shortlist, and guards comparatives: "the only one" requires a count of one, ties
read as "among the most", percentiles are dropped below eight candidates.

Copy shown to a traveller is held to a stricter standard than the score behind
it. `STYLE_TAGS` is deliberately fuzzy — `temples` expands to include `history`
so a shrine scores for a history-minded traveller — but naming that back as "you
asked for temples" on a history museum is a false claim about the traveller's
own input. Fuzzy is fine inside a number; it is not fine in a sentence.

### Fail open on quota, fail closed on spending
`reserveQuota` allows the call when the counter is unreachable — exceeding a
YouTube quota costs a `403`, not money, and failing closed would turn a brief
database problem into total loss of evidence. But `travel-refresh` refuses every
request without its secret, because an endpoint that *spends* must not be a
public button.

### A probe records that a provider was asked
Not that it answered. An unconfigured provider is never probed, or adding the
key later would be ignored until the probe expired. A quota refusal writes no
probe either.

### Caching is not freshness
The cache stops the app buying the same answer twice. It does not make an answer
true. That is what `travel-refresh` exists for.

### Corroboration before anything reshapes a day
Queue times need 2+ sources. `best-time` windows need 2+ sources **and** a rival
window at half the weight or less — because `preferredWindow` makes the
scheduler *decline a placement*, so a wrong window removes a place from the trip
rather than merely mis-ranking it.

### Nothing is dropped silently
Every place not scheduled appears in `unscheduledReasons` with a specific
`detail` ("Closed on Mondays", "Would push walking past your 75 minute limit").
The rebalancer's "no place lost" guard exists for the same reason.

### Reserve by ceiling, not by coordination
Refresh and live traffic share one quota counter and differ only in the limit
they pass: refresh `30`, live `90`. Because the count is shared, refresh can
never push the total past 30, leaving ≥60 for travellers. No second table, no
race.

### Measure before choosing a threshold
`FATIGUE_SPREAD_TOLERANCE = 0.18` came from measuring real plans. The first
guess (`0.25`) fired on nothing at all.

### Distinctions worth preserving
- **`notability` is not a rating.** A star average measures lifetime
  satisfaction; notability measures documentation. `destinationSignificance`
  takes the *stronger* of the two, so a source carrying only one is not
  penalised for the gap.
- **Food-adjacent is not food-only.** A night market is somewhere to eat *and* a
  genuine sight. `isFoodPlace` decides meal eligibility; `isFoodOnly` decides
  exclusion from sightseeing.
- **Suggested meal venues are not shortlisted places.** Tracked apart from
  `scheduled`, or the "every accepted place is scheduled or explained"
  invariant breaks the moment the planner suggests a restaurant.
- **`fatigueScore` is not comparable across pace profiles.** It is normalised to
  each traveller's own limits. Comparing days *within* one trip is valid and
  intended; relaxed-vs-active is not.

---

## Coding standards

### Verification — get this right or you will report false passes

```bash
npm run build     # tsc -b — the ONLY real typecheck
npm test          # vitest, 1401 tests / 66 files
npx eslint <changed files>
```

- **`tsc --noEmit -p tsconfig.json` checks NOTHING.** The root config is
  `{"files": [], "references": [...]}`, so it exits 0 on broken code. Always
  `tsc -b`.
- **`npm run lint` is not clean.** `src/App.tsx` has 3 pre-existing
  `no-explicit-any` errors (~lines 1390, 1828, 1891). Lint changed files only.
- **Deno functions are not covered by `tsc -b`:**
  ```bash
  npx tsc --noEmit --skipLibCheck --target es2022 --module esnext \
    --moduleResolution bundler --strict --lib es2022,dom \
    supabase/functions/_shared/*.ts supabase/functions/*/index.ts
  ```
  Ignore `TS5097` (Deno `.ts` imports), `TS7006` (`Deno.serve` request), and
  "Cannot find module '@supabase/supabase-js'".

### Edge Function conventions
- **Every function directory needs its own `deno.json`.** Ten exist, all
  identical. A new function without one **fails to deploy**.
- Secrets are read only through `_shared/providers.ts`; they never reach a
  `VITE_*` variable or the browser.
- Cache helpers are best-effort: a cache failure falls through to the provider,
  never to an error.

### The `_shared` purity rule
`cacheKeys.ts`, `claims.ts`, `osmPlaces.ts`, `wikivoyage.ts`,
`officialSource.ts` and `quota.ts` contain **no Deno APIs and no runtime
imports**, so `src/lib/*.test.ts` imports them directly under vitest. `quota.ts`
imports `SupabaseClient` as a *type only* for this reason. Adding a runtime
import to any of them breaks the suite that covers them.

### supabase-js
Row types are inferred from the select string's **literal type**. A concatenated
select string collapses every column to `GenericStringError`. Keep `.select(...)`
arguments as single literals.

### Tests
- Prove a feature *engages*, not merely that it stays quiet. A "spread stays
  under tolerance" assertion passes trivially when the code never runs.
- Comments say *why* the expectation matters, not what the line does.

### Security
`isSafePublicUrl` guards the official-source fetch. Those URLs come from
community-edited OSM tags and are attacker-influenceable. It blocks non-HTTPS,
credentials, odd ports, loopback, link-local (including `169.254.169.254`) and
private ranges. Residual risk: a public hostname whose DNS resolves to a private
address still passes — resolution happens after the check.

---

## Major completed features

**Cost control** — read-through caches for discovery, evidence, routes, weather
and opening hours; evidence fetched for the visible deck card plus four ahead;
`evidence_probes` making empty results cacheable; YouTube capped at 90
searches/day with a Pacific-time atomic counter; Routes capability probe
memoised.

**Discovery without a billing account** — OpenStreetMap via one Overpass query
(replacing seven billed text searches); separate capped food query with a
reserved shortlist share; Wikivoyage curation; `notability` replacing star
ratings; real `indoorOutdoor` from tags.

**Real place photographs** — `travel-images` resolving Wikimedia leads that
`travel-discover` carries out of the Overpass response for free; licence
allowlist and Wikimedia-only host rule in `_shared/placeImages.ts`; every
endpoint batched 50 titles or ids per request; `place_images` +
`place_image_probes` making "this place has no photograph" a cacheable answer;
credit line linking the Commons file page. **Nothing generated, ever.**

**Evidence** — official venue websites (schema.org JSON-LD hours and closure
notices, behind an SSRF guard); YouTube video evidence; pasted
TikTok/YouTube links via oEmbed; claim extraction with verbatim excerpts
including `best-time`; nightly `travel-refresh`.

**Place facts** — admission cost as a structured `PlaceAdmission` (class, fares
with explicit ISO currency, provenance), extracted from OSM `charge`/`fee`,
Wikivoyage listing prices and regional-provider spend figures; a single
weekday-aware reading of opening hours in `src/lib/openingHours.ts`, shared by
the scheduler and the UI; per-place explanation points in `placeRationale.ts`
ordered by score contribution and compared against the finished shortlist.

**Scheduling** — weekday-aware opening hours; all four previously-dead
`PACE_DEFAULTS` fields enforced; real restaurants in meal slots with dietary and
budget matching; breakfast; cross-day fatigue rebalancing; arrival, departure
and jet-lag day shaping; weather-aware day assignment; rejection reasons
surfaced and persisted.
