# Travel intelligence staging status

This document records the last verified state of the completion branch. It deliberately distinguishes live provider evidence from local tests and unavailable providers.

## Repository

- Branch: `agent/complete-travel-intelligence`
- Base: `main` (unchanged during this work)
- Latest implementation areas: live discovery/evidence, weather, events, crowd risk, route preview, authenticated link import, AI boundary, regional discovery, disruption-aware replanning.

## Live staging checks

Project: the configured Supabase project referenced by the local `VITE_SUPABASE_URL`.

| Function | Result | Evidence |
| --- | --- | --- |
| `travel-capabilities-live` | HTTP 200 | One `GOOGLE_MAPS_API_KEY` reports Google Places, Routes, Reviews and YouTube as available; weather is available; events/China/social partners are false. |
| `travel-discover-live` Melbourne | HTTP 200 | Returned current Google Places records including Fed Square, coordinates, rating, address and retrieval timestamp. |
| `travel-evidence-live` Melbourne | HTTP 200 | Returned 5 Google Places review documents and 8 YouTube documents with source URLs and retrieval timestamps. |
| `travel-weather` Melbourne | HTTP 200 | Returned Open-Meteo daily forecast and expiry timestamp. |
| `travel-route-matrix` | HTTP 502 | Underlying Google response is HTTP 403 because the Routes API is disabled for the key's Google project. |
| `travel-events` | HTTP 503 | `TICKETMASTER_API_KEY` is not configured. |
| `travel-discover-live` Beijing | HTTP 503 | Neither `AMAP_API_KEY` nor `BAIDU_API_KEY` is configured. |
| `travel-reasoning` | HTTP 503 | `OPENAI_API_KEY` is not configured. |
| `travel-import-link` without a session | HTTP 401 | Authentication is enforced. Unsafe HTTPS validation is covered by tests. |

## Automated verification

- Vitest: 288 tests passing across 22 files.
- Production TypeScript/Vite build: passing.
- Crowd evidence produces a separate `crowdRisk` signal and caution.
- Weather risk changes the deterministic scheduler's indoor/outdoor ordering.
- Replanning previews preserve locks and use existing preview/apply/undo protection.
- Fixtures remain an explicitly labelled fallback.

## Remaining external proof

1. Enable Google Routes API in the Google Cloud project that owns `GOOGLE_MAPS_API_KEY`.
2. Add `TICKETMASTER_API_KEY` to Supabase Edge Function secrets.
3. Add `AMAP_API_KEY` or `BAIDU_API_KEY` to Supabase Edge Function secrets.
4. Add `OPENAI_API_KEY` to Supabase Edge Function secrets.
5. Sign in to Planitenary in the browser and exercise discovery, build, improve, shared-link import, desktop layout and 390px mobile layout.

No provider key belongs in `VITE_*` variables. No unavailable provider is presented as live.

## Google key configuration

The server-side provider adapter uses one Supabase secret, `GOOGLE_MAPS_API_KEY`,
for the enabled Google Places, Routes, Geocoding and YouTube Data APIs. The
application no longer reads `YOUTUBE_API_KEY`; the old secret may be removed
from Supabase after deployment and verification.
