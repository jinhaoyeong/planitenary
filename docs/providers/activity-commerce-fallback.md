# Activity commerce fallback — the provider-independent contract

**Status:** `ARCHITECTURE DECISION` · `NO UI IMPLEMENTED`

**Date:** 2026-08-31

**The decision:** Planitenary does not depend on an activities-commerce API.
Attraction discovery and itinerary planning run on factual sources — OSM /
Nominatim, Wikivoyage, Wikidata / Wikimedia, and operators' own websites — and a
booking provider, when one exists, is **enrichment layered on top of a plan that
was already complete without it.**

This is written after four provider attempts, none of which produced a usable
account:

```
Viator        technically viable   → partner account removed by the provider
GetYourGuide  technically superb   → 1M monthly visits + 300 monthly bookings
Tiqets        technically suitable → account signup could not be completed
Headout       unverifiable         → public API documentation withdrawn
```

Four different failures with one shape in common: **the blocker was never the
code.** A planner whose attractions only appear when a marketplace account
exists is a planner that four external decisions can switch off. That is the
dependency this document removes.

---

## The rule

> **Absence of a commerce provider must never prevent an attraction from
> appearing in Smart Plan, and must never cause Planitenary to state a
> commercial fact it does not have.**

Two halves, and the second matters as much as the first. Falling back is not
permission to guess.

```
factual attraction  (OSM / Wikivoyage / Wikidata / official site)
        │
        ├── always: appears in discovery, schedulable in Smart Plan
        │
        └── commerce layer, if and only if available
              ├── live provider   → price + availability + times
              └── no provider     → truthful unknowns + an honest link
```

---

## What already exists

This is not a new subsystem. Most of the fallback is already built, and the
contract below mostly names rules for machinery that is in the repo today.

| Piece | Where | What it already does |
|---|---|---|
| `official-website` price source | `src/lib/travelBooking.ts` — `PriceSource` | A price read from the operator's own site is already a first-class, non-provider price |
| `officialAdmissionClaims`, `admissionFromJsonLd`, `admissionFromVisibleText` | `supabase/functions/_shared/officialSource.ts` | Extracts admission prices an operator publishes about itself |
| `officialTicketLinks` | same | Finds the operator's own ticket links on their page |
| `isLikelyResellerUrl` | same | Refuses to treat a marketplace host as an official operator source — the list already includes `viator.com`, `getyourguide.com`, `klook.com`, `tiqets.com`, `headout.com` |
| `openingRulesFromJsonLd` | same | Opening hours, which is the *scheduling* fact — distinct from the *commerce* fact |
| `closureNotices` | same | Closures and renovations, which only the operator knows |
| `isSafePublicUrl` | same | Keeps any outbound link safe |
| Fare-unverified precedent | commit `f99a842` | "offer the operator's own page when a fare cannot be verified" — the same move, already made for transport |

So the work this document implies is mostly **consistency**: applying to
activities the rule transport already follows, and naming the states so the UI
cannot drift into invention.

---

## The three states

An activity in a plan is in exactly one commercial state. They must be
distinguishable in the data, not just in copy.

### 1. Priced by a provider

A live commerce provider supplied a figure. `PriceSnapshot` with
`source: 'provider'`, a `retrievedAt`, and freshness per the existing contract
(`live` only if the provider declared an `expiresAt`, otherwise `checked`).

### 2. Priced by the operator

The operator publishes admission prices on their own site.
`source: 'official-website'` with the `sourceUrl` pointing at that page.

This is a real price and may be shown — but it is an **advertised admission
rate**, not an offer for a date and a party. It cannot claim availability, it
cannot claim a start time, and it must never be presented as bookable inventory.

### 3. Not priced

No provider, and no official figure we can stand behind. **This is the normal
state, not an error state**, and the plan is fully usable in it.

**The gap to settle before any UI is built:** `priceFreshness()` in
`src/lib/travelBooking.ts` returns `'manual'` when `price` is `undefined` —
the same value it returns for a price the traveller typed in. So "nobody has
ever priced this" and "the traveller priced this themselves" are currently
indistinguishable at the freshness layer. That may be harmless if the card
renders the absence rather than the state, but it must be checked before a
"Price unknown" affordance is written, and fixed at the type level rather than
patched in a component. **Not changed here** — this document decides
architecture, not code.

---

## Copy: what may and may not be said

**Allowed when unpriced:**

```
Tickets may be required
Check current ticket price
Check availability
Official website
View tickets
```

Each is either a fact about our knowledge or an instruction to the traveller.
None asserts a commercial fact.

**Forbidden, always, in every state:**

- An invented price, or a price "from" a range nobody published
- Invented availability, in either direction — "available" and "sold out" are
  equally forbidden without a provider that said so
- An invented start time. Opening hours are not a start time
- Invented capacity — no "places left" without a provider field that genuinely
  means remaining inventory. Field names lie about this constantly: one
  marketplace's `max_tickets` is the most that may be bought in a single order
  and says nothing about what remains, and another's `remaining` sits beside an
  `UNLIMITED` state that makes the number meaningless. A count is inventory only
  when the provider's documentation says it is.
- Treating a click on any outbound link as a booking
- **Any commerce fact produced by a language model.** Prices, availability,
  opening times on a ticket, and cancellation terms are retrieved or absent.
  A model may phrase them; it may never supply them

That last rule is the one most likely to erode quietly, because a plausible
price is easy to generate and hard to spot. Commerce facts carry a `sourceUrl`
and a `retrievedAt` or they do not exist.

---

## The link, and its order of preference

When Planitenary offers a way to act on an attraction, the destination is chosen
in this order:

1. **The operator's own ticket URL** — what `officialTicketLinks` extracts.
   Best outcome: the traveller buys from the venue, at the venue's price, with
   no intermediary.
2. **The operator's own website** — when no ticket link is identifiable.
   Honest, and always available for a real attraction.
3. **A deliberately supported marketplace page** — only where a provider
   relationship actually exists, and only through that provider's attributed
   URL.

Tier 3 is opt-in per provider and must never be reached by guessing a URL.
`isLikelyResellerUrl` already keeps marketplace hosts out of tier 1 and 2; that
boundary is what makes the ladder honest, and it must not be relaxed to fill a
gap. **An attraction with no operator site and no provider gets no link** — and
still appears in the plan, still occupies its slot, still carries its opening
hours.

---

## `TravelBooking` with no provider

Unchanged from the provider-neutral lifecycle, and it already works:

```
Add to Plan   → TravelBooking(activity-ticket, status='planned')
                provider: undefined
                price:    undefined  or  source: 'official-website'
click a link  → still 'planned'
traveller says they booked → 'requested'
trustworthy confirmation   → 'confirmed'
```

`bookingConstraintStrength()` already treats `planned` as `'none'`, so an
unpriced, unbooked activity exerts no scheduling pressure while still being
visible and orderable in the day. Nothing about the no-provider path needs a new
status, and no new status should be invented for it — "planned without a price"
is `planned`.

Scheduling facts and commerce facts stay separate: an activity can hold opening
hours from the operator and a duration from OSM, and be scheduled precisely,
while its price and availability remain unknown. **Smart Plan consumes the
scheduling facts and must not require the commerce ones.**

---

## Adding a provider later must not change the itinerary's identity

The point of doing this now is that the enrichment path stays open. The
constraint that keeps it open:

> Attaching a provider to an existing activity may add `provider`,
> `providerOfferId`, `price` and availability. It must not change **which
> attraction the item is**, its identity in the plan, its position in the day,
> or the traveller's own edits.

Concretely: the itinerary item is keyed on the attraction, not on a provider's
product id. A Tiqets product id, a Headout variant id or a GetYourGuide tour id
is an *attribute acquired later*, never the identity. This is the same rule the
project already applies to leg identity — see the Stage 4 decision that `legId`
is never stored — and for the same reason: an id owned by someone else is not a
stable name for a thing the traveller owns.

The corollary is that **losing a provider is survivable too.** If an account is
removed (Viator), a product is unpublished (Tiqets returns 404), or terms
require deletion on termination (Tiqets, Headout), the enrichment is stripped
and the item degrades to state 3. The plan survives; the price disappears. That
is only possible if provider-derived fields were identifiable and separable from
the start.

---

## What this closes

- Planitenary can ship activities without any marketplace account.
- The four provider research documents keep their value — they become options
  rather than prerequisites, and each is already written against the same
  provider-neutral `TravelOffer` / `TravelBooking` / freshness contract.
- The next provider conversation, whenever it happens, is a commercial decision
  with a deadline of "whenever", not a blocker on the product.

**No UI is implemented by this document.** The next engineering step, when it
comes, is the `priceFreshness()` gap above — not a card.
