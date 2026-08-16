# Current Task

Feature:
Real internet photographs on place cards — step 1 of the Planitenary travel
agent proposal

Branch: `main`, at `9804698`.

1401 tests across 66 files, `tsc -b` clean, production build clean, every file
this work created or edited is lint-clean.

## The ask

> "for the image i dont want gpt to generate image i want it to fetch from
> internet and display it"

Followed by a seven-part proposal — internet place discovery, itinerary
generation, travel times, arrival/departure recalculation, route planning, an
Ask Planitenary agent, and real images — whose own recommended build order puts
images first, because it is the fastest visible improvement and the only part
that needs no model in the loop at all.

**This change delivers that first part in full.** The other six are untouched;
see "What is not built" below, which is the honest scope statement.

## The gap it closes

`PlaceCandidate.photoUrl` and `photoAttribution` already existed, and
`PlaceMedia` in `DestinationDiscoveryPanel` already rendered them — with a
neighbourhood placard as the fallback. **Nothing anywhere populated them.**
Every card in the app fell back to the placard, always. The contract was there;
the data never arrived.

## What was built

```
travel-discover                      travel-images
  OSM tags already in the              leads → Wikidata P18   (1 request, batched)
  Overpass response                         → Wikipedia lead  (1 per language)
        ↓                                   → Commons category (capped at 6)
  osmImageLeads(tags)                            ↓
  costs no request                        all converge on Commons imageinfo
        ↓                                        (1 request, batched)
  carried on the candidate                       ↓
                                          licence allowlist + host rule
                                                 ↓
                                          place_images + place_image_probes
                                                 ↓
                                          ranked, credited, on the card
```

### Sources, all free and keyless

Wikimedia Commons, Wikidata (`P18`) and Wikipedia (`pageimages`). None takes a
credential, so none can generate a bill — the rule stated in `CLAUDE_CONTEXT.md`
that no source in the active set has a payment path still holds after this
change.

Four leads, ordered by *who chose the picture and for what*:

1. `commons-file` — a mapper attached this photograph to this map object
2. `wikidata` — the encyclopedia's representative image for the subject
3. `wikipedia` — the article's lead image, for when the item has no `P18`
4. `commons-category` — nobody chose it; a bucket that also holds signs, floor
   plans and detail shots, which is why it ranks last and is capped

### The three rules that shaped it

**Nothing is generated.** A model-produced approximation of a landmark is a
false statement about what a traveller will see, and one they have no way to
detect. This is the same standard the app already applies to prices, hours and
closures, applied to the thing on a card people doubt least.

**Only Wikimedia hosts reach an `<img src>`.** The leads come from
community-edited OSM tags, and an image element is loaded by the *traveller's*
browser — so an arbitrary URL there hands a stranger the IP address of everybody
who sees the card. The `image=` tag is never hotlinked: it is accepted only when
it already points into Wikimedia, and only as a *file title*, with the URL
rebuilt from Commons alongside the licence. A photo hosted anywhere else is
dropped. Both `/thumb/` and plain upload URLs are understood, because the last
segment of a thumb path is a rendering (`800px-Foo.jpg`) and asking Commons
about it returns nothing.

**An unrecognised licence is not permission.** The gate is an allowlist.
Refusals run first, because `CC BY-NC 3.0` starts with an allowed prefix — and
the two-letter codes are matched as whole tokens, because scanning free prose
for `nd` would refuse a licence over the word "and". The catch is often in a
field other than the short name: a photograph can be `CC BY-SA 3.0` while
`Restrictions` records that the building in it is not freely licensed. Every
refusal costs a photograph, which is always the safe outcome.

### Cost control, which is where the real work is

- **Leads cost nothing.** They are derived from tags already in the Overpass
  response, on the discovery path. Resolving images *there* would be one lookup
  per place across a sixty-place shortlist — the fan-out shape that produced
  this project's RM 31.69 bill on a different API.
- **The same window as evidence:** the visible card plus four ahead, never the
  whole shortlist.
- **Every endpoint is batched.** One Wikidata request and one Commons request
  serve a whole deck, whatever its size. Categories are the exception (the
  endpoint takes one at a time) and are asked only for places no curated lead
  answered, capped at six per request.
- **`place_image_probes` carries more weight here than `evidence_probes`
  does.** Most OSM places have no image tag and no Wikidata item, so "nothing
  found" is the *common* answer rather than the exception. Without the probe,
  the majority of every deck is looked up again on every single run, forever.
- **A capped-away category writes no probe.** We never asked, so a later
  request must ask — the same rule a quota refusal follows on the evidence
  path. Recording it would turn "we ran out of budget" into "this place has no
  photograph".

### "Nothing found" and "did not answer" are not the same fact

Found while reviewing the failure path, and it is the sharpest edge in this
change. Every gatherer returns `{ ok, value }`. If any lookup *failed*:

- no probe is written — a five-minute Wikimedia outage recorded as an answer
  becomes thirty days of "these places have no pictures", on every deck open at
  the time
- no images are written — the write deletes before it inserts, so writing an
  empty failure result would erase good rows
- the response falls back to whatever the cache already held, so a card that
  had a photograph a moment ago does not blank and then reappear on the next
  request

If every lookup *succeeded*, the empty answers are written too — including the
delete. That delete is the only thing that retires a file removed from Commons
or relicensed to something this app may not display, so skipping the empties
would leave exactly those rows behind, still served on every cache hit.

`complete: false` comes back in the payload for the same reason the reasoning
counters do: most places genuinely have no photograph, so an outage and an
honest empty answer render identically on the cards.

### Where the rules live

`_shared/placeImages.ts` has no imports and no Deno APIs, so vitest exercises
every rule directly — the `placeCost.ts` and `osmPlaces.ts` precedent. 51 tests,
none touching the network. `_shared/imageSources.ts` holds the fetchers, the
`evidenceSources.ts` split.

Four more sit in `discoveryRuntime.test.ts`, on the client seam — the last point
before a string is handed to a browser as a photograph to load. A payload the
server never produced must still be refused there, or the host rule has a hole
on the only side of it that a traveller's browser can see.

The same `parsePlaceImage` validates a row coming out of jsonb *and* a payload
crossing the network into the client. A picture allowed on screen by one rule
and into the database by another is a rule with a gap. It also **rebuilds** the
credit line from the author and licence beside it rather than trusting the
stored string: a row whose credit disagreed with its own licence column would be
crediting the photograph wrongly, in the one place where being right is the
condition of showing it.

### A bug the tests caught before it shipped

The licence allowlist admitted `CC BY-NC 3.0`. The refusal list held the
*phrases* — "noncommercial", "no derivative" — and Commons short names carry the
restriction as two letters instead. `CC BY-NC` starts with `cc by`, so the
allowlist let through precisely the licences it exists to exclude. Fixed with a
whole-token check on the short name, with a test on both `-NC` and `-ND`.

### Files

| File | What |
| --- | --- |
| `_shared/placeImages.ts` | new — leads, host rule, licence allowlist, credit, ranking, both parsers |
| `_shared/imageSources.ts` | new — the four batched Wikimedia gatherers |
| `travel-images/index.ts` + `deno.json` | new function. **Every function directory needs its own `deno.json` or it fails to deploy** |
| `20260816000100_add_place_images.sql` | new — `place_images`, `place_image_probes`, RLS, explicit service-role grants |
| `_shared/cache.ts` | `readPlaceImages` / `writePlaceImages` / `readImageProbes` / `writeImageProbes` |
| `_shared/cacheKeys.ts` | `DISCOVERY_SCHEMA_VERSION` → 3, so 30-day cached candidates without `imageLeads` retire at deploy |
| `_shared/providers.ts` | `placeImage` freshness — 30 days, and `nearTravel` deliberately does *not* shorten it |
| `travel-discover/index.ts` | carries `imageLeads` on the candidate |
| `src/lib/discoveryRuntime.ts` | `fetchPlacePhotos`, re-validating through the server's own parser |
| `DestinationDiscoveryPanel.tsx` | its own effect, separate from evidence; credit links the file page |
| `src/index.css` | credit as an anchor, unstyled at rest over the photograph |

The image effect is deliberately **separate from the evidence effect**. The two
answer to different limits — evidence is metered and rationed per place, images
come from an API that cannot bill — and folding them together would lose the
pictures whenever the metered path declined to run.

## The live acceptance pass (2026-08-16)

The production gatherers were run against **real Wikimedia APIs** — possible
under vitest because `providers.ts` touches `Deno` only inside function bodies,
so `imageSources.ts` imports cleanly in Node. The smoke file was deleted after
running; it was a check, not a suite.

Six real Japanese landmarks, with the Wikidata ids resolved from Wikipedia's
`wikibase_item` pageprop — the same link an OSM `wikidata=` tag records:

| Place | Photograph | Licence | Author |
| --- | --- | --- | --- |
| Osaka Castle | `Osaka Castle 02bs3200.jpg` | CC BY 2.5 | 663highland |
| Shitennō-ji | `Shitennoji03s3200.jpg` | CC BY 2.5 | 663highland |
| Kinkaku-ji | `Water reflection of Kinkaku-ji…` | CC BY-SA 4.0 | Basile Morin |
| Fushimi Inari | `Fushimiinari-taisha, naihaiden-1.jpg` | CC0 | Saigen Jiro |
| Tokyo Tower | `Tokyo Tower 2023.jpg` | CC BY-SA 4.0 | Akonnchiroll |
| Sensō-ji | `Sensoji 2023.jpg` | CC0 | Akonnchiroll |

**Six places cost two requests** — one `wbgetentities`, one `imageinfo` — which
is the batching claim verified against the real APIs rather than argued. The
resolved URL was fetched: `200`, `image/jpeg`, 409 KB. The Commons file page
behind the credit line also returns `200`.

A missing file and an item with no `P18` both returned nothing with `ok: true`,
which is the distinction the probe log depends on.

### The bug it found: Commons appends tracking parameters

Every `thumburl` in a live `imageinfo` response now carries
`?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail`.
No unit test could have found this, because no unit test could have invented it.

It matters for identity, not tidiness. `image_url` is half of `place_images`'
primary key and `rankPlaceImages` de-duplicates on URL, so parameters Wikimedia
can change at will would make one photograph two rows and two gallery entries —
and there is no reason to forward another site's analytics parameters from a
traveller's browser either. `wikimediaImageUrl` now strips the query and
fragment, and both `buildPlaceImage` and `parsePlaceImage` go through it, so
what is stored and what is shown cannot disagree. Two regression tests, one
written from the verbatim live URL.

### Two cosmetic observations, not fixed

Real `Artist` fields are messier than the documented format: one rendered as
`Unknown author Unknown author` (a template emitting the phrase twice) and one
as `SunOfErat [1]` (a footnote marker surviving tag stripping). Both are
harmless — the credit still names a licence and links the file page — and
neither is worth a heuristic that could truncate a real name.

## Verification

- Real Wikimedia responses through the real gatherers — see above
- `npm test` — 1401 pass, 66 files (55 new)
- `npm run build` — clean
- `tsc -b` — clean
- Deno program — no new errors. The two pre-existing `caveats` errors in
  `travel-discover` (lines 709 and 814 at baseline) are unchanged; confirmed by
  running the check against a stashed tree
- `npx eslint` on every created and edited file — clean

## Not verified

The resolution path is proven against live Wikimedia. **The deployed path is
not**, because it cannot be reached from here:

- The migration has **not** been applied to live Postgres
- `travel-images` has **not** been deployed. There is no local Edge runtime on
  this machine (the Supabase CLI is present, Docker is not), so the function
  body — cache reads, probe writes, the `lookupComplete` fallback — has never
  executed. Its *parts* have; their composition has not
- **No browser has seen a photograph on a card.** The placard fallback is
  today's behaviour for every card, so it is not at risk, but "a real image
  renders in the deck" is an assertion, not an observation
- The licence allowlist has met six real Commons files, not the long tail. The
  failure mode is a refusal, so the risk is missing photographs rather than
  wrong ones — but a broad refusal would look exactly like "these places have
  no pictures", which is why `complete` and `providerCalls` are in the payload
- Fixture cities are excluded (`usingFixture` short-circuits the effect), so the
  offline walk cannot exercise any of this

**The first check after deploying:** open discovery for a real city and compare
`providerCalls` against `lookedUp` in the `travel-images` response. Roughly two
to four calls for a deck of any size is correct; a number tracking card count
1:1 means the batching or the probe write is broken — and both return images
either way, which is what makes it worth looking at deliberately rather than
waiting to notice.

## What is not built

The other six parts of the proposal. Stated plainly so the gap is not mistaken
for a partial implementation:

- **Internet place discovery** — no web search. Discovery is still OSM +
  Wikivoyage. Images are the only thing now pulled from the wider internet
- **Itinerary generation by a model** — `destinationPlanner` and
  `humanScheduler` still build every plan deterministically
- **Travel times, routes, arrival/departure recalculation** — unchanged
- **Ask Planitenary** — no agent, no tool framework, no conversational surface
- The existing `candidate-intelligence` path is **untouched**, including its
  metering, quota and budget boundaries

The proposal's own rule for those still stands: a model may decide *which*
option is best, but the travel times, hours and prices must come from tools that
know them. Nothing in this change weakens that, because nothing in this change
puts a model anywhere near a photograph.
