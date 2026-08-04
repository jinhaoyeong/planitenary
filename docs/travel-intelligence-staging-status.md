# Travel intelligence staging status

This document records the last verified state of the completion branch. It deliberately distinguishes live provider evidence from local tests and unavailable providers.

## Repository

- Branch: `agent/complete-travel-intelligence`
- Base: `main` (unchanged during this work)
- Latest implementation areas: live discovery/evidence, weather, event-aware warnings, crowd risk, route preview, authenticated link import, AI boundary, regional discovery, disruption-aware replanning.

## Live staging checks

Project: the configured Supabase project referenced by the local `VITE_SUPABASE_URL`.

| Function | Result | Evidence |
| --- | --- | --- |
| `travel-capabilities-live` | HTTP 200 | One `GOOGLE_MAPS_API_KEY` now reports Places, Reviews, YouTube and Routes available; weather is available; events/China/social partners are false. |
| `travel-discover-live` Melbourne | HTTP 200 | Returned current Google Places records including Fed Square, coordinates, rating, address and retrieval timestamp. |
| `travel-evidence-live` Melbourne | HTTP 200 | Returned Google Places review documents and YouTube documents with source URLs and retrieval timestamps. |
| `travel-weather` Melbourne | HTTP 200 | Returned Open-Meteo daily forecast and expiry timestamp. |
| `travel-route-matrix` | HTTP 200 | Returned a real walking route of 15 minutes and 1,095 metres for the fixed Melbourne verification coordinates. |
| `travel-route-matrix` regional path | Implemented, not live-proven | Amap/Baidu walking adapters are deployed in version 8; without regional credentials they return an honest failed-pair/unknown result rather than inventing a route. |
| `travel-events` | HTTP 503 | `TICKETMASTER_API_KEY` is not configured. |
| `travel-discover-live` Beijing | HTTP 503 | Neither `AMAP_API_KEY` nor `BAIDU_API_KEY` is configured. |
| `travel-reasoning` | HTTP 503 | `OPENAI_API_KEY` is not configured. |
| `travel-import-link` without a session | HTTP 401 | Authentication is enforced. Unsafe HTTPS validation is covered by tests. |

## Automated verification

- Vitest: 299 tests passing across 24 files.
- Production TypeScript/Vite build: passing.
- Crowd evidence produces a separate `crowdRisk` signal and caution.
- Crowd-averse behaviour now applies a stronger evidence penalty than moderate or crowd-indifferent behaviour.
- Current event notes are passed into the plan warnings so event conflicts are visible before locking; events do not yet occupy schedule slots automatically.
- Weather risk changes the deterministic scheduler's indoor/outdoor ordering.
- The regional route request selects Amap/Baidu for a China capability and explicitly falls back to walking-only semantics when public-transit routing is unavailable.
- Replanning previews preserve locks and use existing preview/apply/undo protection.
- Disruption replanning now schedules unlocked activities around locked booking
  windows, so a late-start or route-delay preview cannot create an overlap with
  a protected reservation.
- The planner UI now exposes reversible route-delay recovery, walking-load reduction, and relaxed-pace previews; focused replanning tests cover each path.
- Deterministic conflict repair is available as a preview when overlaps are detected; unresolved opening-hour constraints remain warnings rather than being hidden.
- Lower-cost planning moves the highest-cost optional place with a known price to the unassigned pool for review; it never deletes the place or moves a locked/must-do activity.
- Fixtures remain an explicitly labelled fallback.

## Browser acceptance evidence

- Local desktop session at a 1440px viewport: itinerary shell, discovery panel,
  organiser controls and hero rendered successfully.
- Local 390px mobile viewport: itinerary shell and discovery controls rendered;
  measured document width was 375px against a 390px viewport, with no
  horizontal overflow.
- Local 390px mobile viewport: the Draft page was opened through the mobile
  menu; `The draft book · ideas & finds` rendered, no duplicate `Save a travel
  link` control was present, and document width remained 375px.
- Mobile discovery failure remained reversible and did not change the trip;
  the UI displayed `Live discovery unavailable: Provider responded 400`.
- These checks used the existing local/demo session. Live provider candidates
  are now available from Supabase; a signed-in cloud-user acceptance run and
  mobile itinerary-building with live candidates still need a fresh browser
  session to be recorded.

## Remaining external proof

1. Keep the verified single `GOOGLE_MAPS_API_KEY` configured in Supabase Edge Function secrets. Live Places, YouTube and Google Routes calls now succeed; the branch is currently at `a75d594`.
2. The same key was independently verified against Geocoding and the Maps JavaScript loader (HTTP 200). Do not expose this server-side key in browser code.
3. Add `TICKETMASTER_API_KEY` to Supabase Edge Function secrets if event-provider ingestion is required.
4. Add `AMAP_API_KEY` or `BAIDU_API_KEY` to Supabase Edge Function secrets if mainland-China route verification is required; Google remains the live provider for other destinations.
5. Add `OPENAI_API_KEY` to Supabase Edge Function secrets if live AI reasoning is required.
6. Sign in to Planitenary in the browser and exercise live discovery, build, improve, shared-link import and mobile itinerary-building with cloud data.

No provider key belongs in `VITE_*` variables. No unavailable provider is presented as live.

## Google key configuration

The server-side provider adapter uses one Supabase secret, `GOOGLE_MAPS_API_KEY`,
for the enabled Google Places, Routes, Geocoding and YouTube Data APIs. The
application no longer reads `YOUTUBE_API_KEY`; the old secret may be removed
from Supabase after deployment and verification.
