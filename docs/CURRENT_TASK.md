# Current Task

Feature:
Smart place details — what a place costs, when it is open, and why it ranks
where it does

Branch: `main`, at `b60133c`.

1008 tests across 53 files, `tsc -b` clean, production build clean.

Lint, stated precisely, because "changed files are clean" was too broad a claim
to make about this diff: **every file created by this work is lint-clean**, and
the two pre-existing files it edits are unchanged against the baseline —
`App.tsx` reports the same 3 `no-explicit-any` errors it reported before, and
`ItineraryView.tsx` the same 3 errors and 3 hook warnings, all on lines this
work never touched.

## The complaint

> "the details is kinda useless… the cost is unknown… i dont get the opening
> hour… why it rank here feels hardcoded as well… generic and surface default
> hardcode style answer"

Four failures, each with a concrete cause:

- `formatPrice` said **"Cost unknown"** on nearly every card, because
  `osmPriceLevel` only ever answers "free" or nothing — while Wikivoyage's price
  string was already parsed and thrown away, and OSM's `charge` tag was already
  in the Overpass payload and discarded
- `openingSummary` read `periods[0]` and appended the raw enum, printing
  **`09:00–17:00 · high confidence`**. A museum shut on Mondays showed Tuesday's
  hours. The scheduler has resolved weekdays correctly since the Monday-closure
  fix; only the UI was blind
- **"Why it ranks here"** was a table of six fixed sentences, top three above a
  0.7 threshold — so most of a thirty-place shortlist read identically
- Most OSM places have **no description at all**, because prose only arrives
  when a Wikivoyage listing matches

Plan: `~/.claude/plans/resilient-jumping-noodle.md`. Eight steps; data contracts
first, then the UI, then Gemini — so the deterministic version can be judged
honestly before any model is in the loop.

## Done — steps 1–8, deployed

Both model operations are wired: grounded, quota-limited, fail-closed, cached
(including the empty answer), and labelled where they reach the screen.

**Deployed 2026-08-08.** Migration `20260807000100_add_ai_brief_cache.sql`
applied against live Postgres; `travel-evidence` → v26, `travel-refresh` → v4,
`travel-capabilities` v24 and `travel-discover` v23 already current. Commit
`b60133c` on `main`, pushed.

That deploy carried a real fix, found live before the earlier deploy (v25) had
even finished being exercised: the brief's 16-char excerpt floor was applied
unchanged to fare excerpts, so an ordinary price line like `Adults $10` was
refused on every page and the empty result cached — indistinguishable from the
model or the credential failing, which is what it first looked like. Fares now
get their own floor plus a stronger rule (the excerpt must contain the fare's
own figure), and `VALIDATOR_VERSION` is folded into the cache key so the fix
invalidates every wrongly-empty result the buggy version had already cached,
rather than leaving them to expire on the normal TTL.

A same-day review caught five more issues before this shipped: a place the
operator declared free could be overwritten by a paid price found in prose; a
currency-resolution call had its arguments swapped, silently disabling the
excerpt fallback; a dozen currencies absent from the rate catalog were
converting at a false 1:1 rate (`COP 50,000` → `RM 50,000`, true value ≈ RM 55);
published fares were rounded to whole units (`€6.50` shown as `€7`); and the
day-card hours chip could answer about the wrong day when a plan has no start
date. All six fixed, all with regression tests — 1008 tests, `tsc -b` clean,
production build clean.

### 1. The claim cache was losing what claims meant

`applies_to` was written to `travel_claims` and **never read back**, and the
write was missing it too. A cached `best-time` claim came back with the window
that gave it meaning stripped, so `summarisePlaceEvidence` silently stopped
producing a best-time window for any place whose evidence was cached. The claim
looked present; only its meaning was gone.

- Both ends fixed. `parseAppliesTo` lives in `cacheKeys.ts`, not beside
  `CachedClaim` in `cache.ts`, because `cache.ts` imports the Supabase client
  and so cannot be loaded by vitest — a round trip nothing can test is how this
  went unnoticed
- Every field validated rather than cast: the column is jsonb and can hold
  whatever an older writer put there. An object whose every field fails
  validation returns `undefined`, not `{}`, which would read as "scoped to
  nothing"
- `discoveryCityKey` carries a schema version. `discovery_cache` holds
  candidates verbatim for 30 days, so a new field would otherwise be absent from
  cached rows for a month — on the one path meant to make the app feel fast

### 2. One reading of opening hours, not two

`openingWindow` moved from `humanScheduler` to **`src/lib/openingHours.ts`** and
is imported back. `humanScheduler.test.ts` passes **unmodified**, which is the
proof the extraction changed no behaviour.

`describeOpeningHours` gives the panel what the scheduler already knew:

- Contiguous day runs collapse to `Tue–Sun`; days sharing hours without being
  adjacent join as `Mon–Tue, Thu–Sun`. Sunday never wraps into Monday
- **Every window of a day**, so a temple that shuts for lunch shows both
- The destination's clock, via `countryTimezone` — 23:00 UTC Monday is already
  Tuesday in Tokyo, and the traveller is asking about the destination's day
- On a day card, the activity's own trip date replaces "today"
- **`Closed on Monday 19 Apr — a day of your trip.`** The highest-value line in
  the panel, and it costs nothing but walking the trip's dates
- Confidence as a sentence — *"Community-maintained hours — worth checking on
  the day"* — never `· low confidence`

Only weekday closures may be asserted for a future date. A holiday closure needs
a **date-specific** rule from a source; OSM's `PH` clauses never reach us, so
`osmOpeningCaveats` states the gap instead: *"Holiday hours are published for
this place but are not read here."* Same for seasonal ranges, sunrise-relative
times and windows crossing midnight — all of which the parser correctly refuses
to guess at, and all of which were silently invisible.

### 3. Reasons that differ from card to card

The six-sentence table is gone; `src/lib/placeRationale.ts` replaces it.

- **Names the traveller's own words** — *"You asked for temples and history"*,
  not *"Matches what you said you like"*. The intersection was always computed
  and always discarded
- **Ordered by contribution (`value × weight`)**, not raw value. Significance at
  0.9 × 0.16 contributed less than traveller fit at 0.8 × 0.24, yet led the
  list — the direct mechanical cause of every card reading alike
- **Names the evidence**: `osmNotabilitySignals` turns the number
  `notability` sums into *"it has an encyclopedia entry and is a listed heritage
  site"*
- **Comparative against the shortlist**, computed once over the finished
  population so two cards can never compare against different denominators
- **Suppresses what does not distinguish** — a dimension true of >70% of the
  shortlist says nothing about any one member of it

Superlatives are guarded, because that is where overclaiming happens: *"the only
one open in the evening"* needs a real count of one, ties read as *"among the
most"*, percentiles are dropped below 8 candidates and comparison entirely below
3.

**A bug found by printing real output rather than trusting the tests.**
`STYLE_TAGS.temples` includes `history` so a shrine scores for a history-minded
traveller — fine inside a number. Said out loud it told someone the *Osaka
Museum of History* was one of the temples they asked for: a false claim about
their own input, which is worse than a vague one. `matchedStyleTags` now reads
each style's list only up to the first entry that is another style's own name —
the point where it stops describing itself and starts borrowing.

### 4. What a place costs

`supabase/functions/_shared/placeCost.ts` — no imports, so vitest exercises it
directly, the same precedent as `osmPlaces.ts`.

**A category is never a price.** A shopping street may be free to walk into, a
food market may hand out samples, a club may charge at the door. `class` is only
ever set by a source that spoke about money; categories set `expectation`, which
is rendered hedged and never promoted. An unpriced market resolves to
`class: 'unknown'` + `expectation: 'spending-inside'` — *"No admission price
published · spending happens inside"*, which separates admission from spending
without claiming either.

**A number without a currency is not a price.** Resolution is code → symbol
disambiguated by country → country default → **stop**. `¥600` is JPY in Osaka
and CNY in Shanghai; with no country, or in France, it yields **no amount** and
keeps `rawText`. This is the rule the old `'¥'.repeat(n)` broke.

Recovered, all of it already fetched and discarded:

- OSM `charge`, `fee`, `fee:conditional`, `charge:adult`, `admission`
- Wikivoyage `listing.price`, at both sites that dropped it —
  `travel-discover:665` hardcoded `priceLevel: undefined` with the parsed price
  in scope one line away
- Amap `biz_ext.cost` / Baidu `detail_info.price`, declared in the interfaces
  and never read — a per-head spend, so `spend-based`, not `ticketed`

`fee=yes` with no readable charge is **`ticketed` with no fares**: *"Ticket
required · no source published the price"* is the same knowledge as "Cost
unknown", stated usefully.

Precedence is one function: official-website > provider > osm-tag/wikivoyage >
category, ties broken by fare count then by structured tag, and asserted
order-independent.

`budgetFit` no longer defaults a missing price to `2`, which scored "we have no
idea" as a confident mid-price. Known-free now scores 1 outright.

Three bugs the tests caught:

- `6.00 EUR;3.00 EUR concession` labelled the **adult** ticket a concession —
  the look-ahead crossed the semicolon into the next price, then dropped the
  real concession as a duplicate. Both audience windows are now bounded by the
  neighbouring prices
- `600 yen` resolved to currency `YEN` — three letters, so it passed the ISO
  regex. Words are checked before codes
- `¥600–¥1,000` dropped the upper figure without keeping `rawText`

### 5. It survives the save

`Activity.admission` and `Activity.openingHoursWeek`, through
`candidateToActivity` → `sanitizeActivity` → storage → reload.

- `admission.fares` is canonical. `estimatedCost` is one figure pulled from the
  **adult** fare with its currency attached — a bare 1500 reads as dollars,
  ringgit or yen depending on who is looking. A child fare is never taken as the
  budget figure. Legacy `cost: string` still renders and is never written to
- `openingHoursWeek` is additive, so `PlannerPreview`'s `periods[0]` conflict
  check is untouched. Order is preserved, not sorted: a morning window must stay
  before the afternoon one, and re-sorting would make every sync echo look like
  a change
- Class, expectation and source are validated against **keyed records**, so
  adding a value to the union without listing it fails the build. That is the
  bug class that cost this file `indoorOutdoor` and four of seven providers
- Malformed fares are dropped **individually** — losing one concession price
  beats losing the adult fare with it. An admission with no attributable source
  is refused outright: a number on screen with nothing behind it is what the
  provenance line exists to prevent
- `fares: []` is preserved, because it means "ticket required, price not
  published" and must not collapse into "no information"
- Idempotent down to key order, verified through a real JSON round trip — the
  realtime path at `App.tsx:426` sanitises then compares `JSON.stringify`
- Records written before any of this exist reload with both fields absent, and
  stay idempotent

`admissionFor(candidate)` fills the category expectation for the three paths
that reach the UI without a server-resolved admission: offline fixtures, Google
(whose band is restaurant spend, not entry), and `discovery_cache` rows written
before the field existed. It can only ever supply an `expectation` — asserted as
a property across every category the table knows.

### Fixtures can now demonstrate any of this

Every fixture opened every day at one uniform window and had no price, so
nothing offline could show a weekly closure or a real fare. Added: a Tue–Sun
museum, a temple that shuts for lunch, and five published fares including a
free-entry park and a multi-fare museum.

### 6. The UI, both surfaces — walked in a browser, two bugs fixed

`src/lib/admissionCopy.ts` decides what a price reads as, shared by both
surfaces so a place cannot describe its cost one way while it is being chosen
and another way once it is in the plan. `formatPrice` and `openingSummary` are
deleted.

**`CandidateDetails`**, top to bottom, every section omitted when unsourced:

1. **Verdict strip** — Cost · Time needed · Today. Sticky inside the scrolling
   back face, so the three facts the traveller called useless stay answerable
   while the rest scrolls under them. Card geometry is set by
   `.destination-flip-scene`'s `aspect-ratio`, so nothing here can resize it
2. **Trip-critical alert** — a closure landing on a day of their own trip, or a
   reported closure promoted out of the caution list. Nothing else earns it
3. Description, rating and tag chips
4. **"Why it is #3 for you"** — the heading names the position, because that is
   the question. Falls back to "Why it is on your list" with no position
5. **Admission** — the other fares, the source's own words when parsing could
   not represent all of them, and where the price came from. Shown whenever
   there is anything to attribute, not only when there are extra fares: a lone
   ¥600 with nothing behind it is a number the traveller cannot weigh
6. **Opening hours** — grouped week, named closed days, provenance sentence
7. **Caveats** — the holiday/seasonal/past-midnight gaps, quieter than a caution
   because they are about the limits of what we read, not about the place
8. Practical grid, traveller themes, then cautions **as a list** — `join(' ')`
   ran six warnings together exactly when they mattered most
9. Provenance, with `sourceConfidence` as a sentence

Copy now answers all four complaints: no "Cost unknown" anywhere, exact fares in
the published currency with an optional explicitly-approximate home-currency
figure, `Ticket required · no price published`, `No admission price published ·
spending happens inside`, and hours that lead with the real day.

**`ActivityItem`** gets one row, not a panel — a day card is a timeline, and the
full record lives in discovery. The hardcoded `¥ {activity.cost}` is replaced by
`admissionChip`; a `Clock` chip shows that day's real hours and turns red on
"Closed this day"; booking appears only when required. `DayPlan.date` is a
display string ("12 Apr"), so the ISO date comes from `profile.startDate +
(day − 1)` — otherwise the card cannot ask the only question that matters.

Tests written **before** the markup, since `DeckCard.test.tsx` asserts only flip
mechanics and there was no safety net on content: `CandidateDetails.test.tsx`
(25) and `ActivityFacts.test.tsx` (13), the latter asserting through the whole
discovery → convert → save → JSON → reload path rather than from an in-memory
object, plus that both surfaces describe the same place identically.

One gap the tests caught: a single-fare place rendered its price with **no
attribution at all**, because the admission section was gated on having *extra*
fares.

**Local browser pass (2026-08-07).** The Demo Mode profile persistence bug was
found and fixed while trying to run this check. On the auth transition into
Demo Mode, persistence could save the previous profile-less seed before the
current key had hydrated; a valid primary then won over the richer backup on
the next reload. Persistence now waits for key hydration, and Demo Mode can
prefer a recovery snapshot only when it contains a valid profile missing from
the primary. A regression test covers the recovery policy.

The running app was reloaded at `http://localhost:5199` with the existing
Osaka profile (10–17 Apr 2027). The profile and dates survived reload, and the
discovery review opened again. The first visible card rendered sourced
admission expectation, weekday hours, provenance, and a place-specific
rationale. This proves the local Demo persistence and discovery entry path;
it does not yet prove the deployed OSM save/reload path or every named Osaka
fixture card.

### 7. Official-site offers — deployed 2026-08-08

`admissionFromJsonLd` now reads schema.org `isAccessibleForFree`, `Offer` and
`AggregateOffer` prices, currency codes, audience labels, numeric `priceRange`
values, and keeps an unparseable range as source text. JSON-LD excerpts are
literal substrings of the original script block, so the claim still has a
verifiable source rather than a reconstructed sentence.

`officialEvidence` emits price claims at authority 1.0, alongside closure
claims, without adding a price rule to the low-authority review/video claim
extractor. `travel-evidence` returns an admission map beside official hours;
the client remaps provider IDs to candidate IDs and merges the official record
above OSM/Wikivoyage/provider values. Cached official claims rebuild the same
admission on a probe hit, including free entry and ticket-required/no-price
answers. The nightly refresh passes the canonical country code so bare official
numbers are resolved safely as well.

The client contract now carries `unit: 'currency'` and admission audience/
currency in `appliesTo`; no migration is needed because the existing claims
JSONB column already stores it. `travel-evidence` (v26), `travel-refresh` (v4),
`travel-capabilities` (v24) and `travel-discover` (v23) are all deployed, so
live non-fixture discovery can now receive operator-published fares — this has
not yet been exercised against a real page in production, only proven through
the fixtures and the unit suite.

**One gap found reviewing the extractor: a free place read as a priced one.**
`admissionFromJsonLd` only classified a zero-priced offer as `free` when the
node *also* carried `isAccessibleForFree` — but that property is optional and
widely omitted, and `offers: { price: "0" }` is a normal way to publish free
entry. Such a place resolved to `ticketed`, and the card then read
**`JP¥0 · adult ticket`**: derived from the source, and the worst available way
to say "free".

Fixed at both levels, because zero is a price other sources can publish too
(OSM `charge=0`), and the classifier is not the last line of defence:

- `admissionFromJsonLd` treats an all-zero fare set as free on its own
- `describeAdmission` and `admissionChip` render an all-zero `ticketed`
  admission as **`Free entry`**, so the two surfaces cannot disagree about it

Guarded on **every** fare being zero, not *some* — a museum with a free child
ticket beside a ¥1,500 adult one is not a free museum, and a test holds that
line.

### 8. The model tier, grounded and fail-closed

`supabase/functions/_shared/reasoning.ts`. No Supabase or provider imports, so
vitest exercises every rule directly — the `placeCost.ts` precedent.

**The contract is mechanical, not a prompt.** A system prompt asking a model
not to invent things is a request. What is enforced is: every displayed
sentence carries a `sourceUrl` we supplied and an `excerpt` that is a **literal
substring** of the text we supplied for that URL. A sentence that cannot
produce one is dropped and the rest are kept — one bad sentence is no reason to
lose four good ones, and no reason to show the bad one.

The substring rule is the real guarantee. A digit check cannot see *"the finest
garden in Kansai"*, and a qualitative invention is exactly what a traveller
acts on. Numbers are checked too, but as a pre-filter beside the rule, never
instead of it.

Rules a sentence must clear, in order:

1. Shape, then a `sourceUrl` we actually supplied
2. **A minimum excerpt length.** Without a floor the rule is trivially
   satisfiable — `"the"` is a substring of virtually any page, so a model could
   attach it to a wholly invented sentence and pass
3. The excerpt is literally present, comparing with whitespace collapsed and
   case ignored (HTML extraction reflows text; an excerpt differing only in
   capitalisation is the same quotation). **No punctuation stripping** — that
   is where a paraphrase starts passing as a quotation
4. No brochure phrasing (`must-see`, `hidden gem`, `nestled`, `boasts`, …) —
   each asserts a verdict no source made, and each hides in the sentence rather
   than the excerpt
5. **No hours, closures or prices.** Those have their own pipeline, provenance
   and currency handling. A brief repeating them can only agree, which is
   noise, or disagree, which puts two answers to one question on a single card.
   Checked *before* the digit filter, because the dangerous version is the one
   whose numbers are genuinely in the source and would otherwise pass
6. Every number in the sentence appears in the source

`admission-read` is stricter still, since a fare renders as a bare fact: the
amount must appear as digits on the operator's page (both `1500` and `1,500`
are tried), the excerpt must be verbatim, and the currency is resolved through
the same path as every other price rather than trusted from the model — `YEN`
is three letters and passes any ISO-shaped regex, a bug this project already
fixed once deterministically.

**Budget, because this is the only provider that bills.**

- A separate `gemini-reasoning` quota, `GEMINI_DAILY_CALL_LIMIT`, default 50 —
  independent of the discovery counters, so a busy search day cannot spend the
  model budget and a runaway model cannot starve discovery
- `reserveQuota` gained `failClosed`. It deliberately fails *open*, and its own
  doc comment reasons about YouTube costing nothing on overrun — that reasoning
  depends entirely on the call being free. An unreachable counter now means
  "don't call" for the metered provider. A missing client counts too: that
  means nothing is counting the spend at all
- One attempt, one timeout, **no retry** — a failed brief is a missing brief,
  and retrying converts a provider wobble into a bill
- Ceilings enforced before sending: 8 sources, 6k chars each
- Counters for skipped / rejected / succeeded / failed, returned in the
  payload. A grounding validator whose rejection rate nobody watches is one
  nobody notices has stopped working

**Only where it is needed.** The client sends `placeNeedsDescription` — the
server cannot know, since prose arrives with a matched Wikivoyage listing back
on the discovery path. Briefs are grounded in the claim excerpts already
gathered for that place, which are verbatim fragments of real pages.

**Labelled on the card.** `Description written by AI from N sources, each
sentence quoted from one of them`, inside its own bordered element that model
prose can never share with human prose. Grounded is not the same as
human-written, and a traveller is entitled to know which they are reading
before they weigh it. Shown only when no human description exists.

`aiReasoning` now survives from `travel-capabilities` into `ProviderRuntime` —
both the parser and the type dropped it, so the client could not tell "no brief
for this place" from "no model in this deployment".

33 tests on the validators alone, none touching the network.

**The cache, and why the empty answer is stored.** `ai_place_briefs`, its own
table rather than a new `evidence_probes.source` value — a generated
description is not a source of evidence, and reusing the probe log would have
meant widening an evidence-source union for something that is not evidence.

The daily cap stops runaway spend but not waste: without this, a place the
model had nothing to say about is asked about again tomorrow, and the day
after, forever. So `brief` is nullable and **a row's existence is the cache
hit while its payload is allowed to be null** — "we asked and nothing survived
validation" is a real answer worth remembering. `lookupAiBrief` therefore
returns `undefined` for a miss and `null` for a cached empty answer, and
callers must branch on presence rather than truthiness. Four tests hold that
line, because collapsing the two is the obvious mistake and it is invisible.

The key is place + operation + **`evidenceRevision`**, a content hash of the
grounding sources. Correctness is governed by that, not by the clock: a
description stops being right when what we read changes, not when a week
passes. So the row gets the long TTL — expiry here is garbage collection, and a
short one would only pay to regenerate answers that were still correct. The
hash covers URLs *and* their text, sorted, so the same page re-read with new
wording invalidates the answer while a reordered source list does not.

`lookupAiBrief` and `aiBriefKey` live in `cacheKeys.ts`, not beside the table
access in `cache.ts` — `tsc` caught the import dragging `Deno` globals into the
browser program the moment a client test used it. Exactly the precedent
`parseAppliesTo` set, and for the same reason: a key helper nothing can load is
a key helper nothing can test.

**`admission-read`, wired.** The only path by which a model-derived price is
ever shown as fact, and it runs on **official-site visible text only** — never
a review or a forum post, whose authority could not carry a price anyway
(`OPERATIONAL_CLAIMS` gates `price` at 0.85; reddit is 0.65).

Two decisions live in `resolveOfficialAdmission`, pure and in the testable
module rather than inside `officialEvidence`, which reaches for `Deno` and
cannot be loaded by vitest:

- **Structured pricing always wins.** A marked-up `Offer` is the operator
  stating a price in a form with one meaning; a number in a paragraph is the
  same operator read less reliably. `shouldReadAdmission` means a well-marked-up
  site is never even asked about — which is also why it never costs a call
- **A model-read fare is demoted, not disguised.** `source` stays
  `official-website`, because the price genuinely is published there, but
  confidence drops to `medium`. Leaving it at `high` would make a number found
  in prose indistinguishable from one the operator marked up

Cached under `operation: 'admission-read'` in the same table, keyed by a hash
of the page text, and **the null result is cached too** — a page the model
could not read a price from will not become readable tomorrow. The reader is
injected into `officialEvidence` rather than imported, so that module still
knows nothing about keys, quotas or caches.

Step 9 (`rank-rationale`) is deferred and likely dropped — a rephrasing layer
adds latency and a second validation surface without adding intelligence.

## The acceptance walk, done (2026-08-07)

Walked in Chrome against the Osaka fixtures, on a demo trip spanning **Monday
12 Apr 2027**. Every step-6 acceptance item now has an observation behind it
rather than an argument:

| Claim | What the browser showed |
| --- | --- |
| Card geometry stable on flip | `.destination-flip-scene` measured **520×426 at x=545 before and after** — identical. The item the plan flagged as verified only by construction |
| Exact fare, published currency first | Osaka Castle Museum **`JP¥600 · adult ticket · ≈ RM 16`** |
| Multi-fare admission | Nakanoshima **`JP¥1,500`**, with Student ¥1,100 and Child beneath |
| Category-only market | Kuromon **`No admission price published · spending happens inside`** |
| Free entry | Osaka Castle Park **`Free entry`** |
| Hours genuinely absent | **`Not published · no source published them`** — no invented schedule |
| A place that shuts for lunch | Shitennoji **`08:30–12:00, 13:00–16:30`** — both windows, on the discovery card *and* the day card |
| Closure inside the traveller's trip | **`Closed on Monday 12 Apr — a day of your trip.`** |
| The traveller's own words | **`You asked for temples and history — this is tagged for all of them`** |
| Superlatives stay tie-safe | **`Among the most documented on your Osaka list`**, never "the most" |
| Persistence | fares, currencies and **Shitennoji's two windows** survived build → save → reload |
| Day-card facts row, after reload | `Tennoji · JP¥300 · ≈ RM 8 · 08:30–12:00, 13:00–16:30` |

The scheduler also placed Nakanoshima on **Day 4 rather than Day 3**, routing
around the Monday closure unprompted — the hours work paying off somewhere no
test was pointed at.

### Two bugs only a browser could have shown

Both were the panel overclaiming, which is the single thing this work exists to
stop. Both are fixed, and both now have regression tests written from what was
on screen.

- **`1 source · corroborated across sources`.** The count and the confidence
  sentence were chosen independently, so nothing stopped them contradicting
  each other inside one line. Corroboration needs two things to corroborate;
  below that, high confidence can only speak to the one source's authority
- **`Why it is #1 for you`** printed directly above *"Nothing stands out on
  paper — it is here for variety"*. Each half is defensible; together the
  heading makes a promise the next line immediately breaks. Where
  `placeRationale` emits only its `variety` fallback, the heading stops
  claiming a rank reason

### Still open

Everything server-side is deployed as of 2026-08-08. What is left is purely
verification and one deferred decision:

- **Dark mode on the `--warn` alert** and the back face scrolling on a real
  mobile viewport — never looked at in a real browser at any point in this
  work.
- **Live (non-fixture) discovery through the now-deployed functions has not
  been exercised end to end against a real operator page.** The unit suite and
  the offline fixture walk both pass; a live smoke test — open discovery for a
  real city, confirm a real page's admission or hours reaches a card — has not
  been done since the v26/v4 deploy.
- **Step 9 (`rank-rationale`) is deferred, likely permanently.** A rephrasing
  layer over the deterministic rationale in step 3 would add latency and a
  second validation surface without adding intelligence; step 3's points
  already read specifically per card. Revisit only if they still read poorly
  after being seen live.
