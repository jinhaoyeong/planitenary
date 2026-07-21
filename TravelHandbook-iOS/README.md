# Travel Handbook (Native iOS)

Native **SwiftUI** sibling of the web/Capacitor app in `../planitenary`. Open this folder in **Xcode on a Mac** — it is not a Capacitor wrapper.

## Open & run

1. Copy `TravelHandbook-iOS` to a Mac (or open the repo there).
2. Open `TravelHandbook.xcodeproj` in Xcode 15+.
3. Select the **TravelHandbook** scheme and an iPhone simulator or device.
4. Set your **Signing Team** under Target → Signing & Capabilities.
5. In `TravelHandbook/Info.plist`, replace:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`  
   with the same values as `planitenary/.env.local` (`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`).
6. Press **Run** (⌘R). Deployment target: **iOS 17**.

## Demo login

- Email: `demo@travelhandbook.local`
- Password: `Demo1234`  
  Demo mode is local-only (no MFA, no cloud sync).

## What’s included (parity with the web app)

| Area | Status |
|------|--------|
| Welcome onboarding (5 slides) | Yes |
| Auth (sign in / up, demo, local, cloud) | Yes |
| MFA challenge + mandatory TOTP setup for cloud | Yes |
| Dashboard (create / open / rename / delete trips) | Yes |
| Trip shell + bottom pill nav + hamburger menu | Yes |
| Itinerary overview + day detail | Yes |
| Activities (edit, mood board, voice notes, food picker) | Yes |
| Maps (MapKit + Nominatim search) | Yes |
| Draft ideas (+ RedNote preview via jina.ai) | Yes |
| Budget + expenses + currency (MYR base) | Yes |
| Checklist | Yes |
| Documents | Yes |
| Photo Wall | Yes |
| Handbook settings (story / copy / themes) | Yes |
| Account (profile + security / MFA) | Yes |
| Restore backup modal | Yes |
| Theme light/dark + Ember Rose branding | Yes |

## Bundle ID

`com.blankcanvas.app` (same as Capacitor `appId`).

## Notes

- Local data uses `UserDefaults` / Documents with the **same key names** as the web app where possible, so mental model matches — but this is a **separate native store**, not a shared browser `localStorage`.
- Cloud sync talks to the same Supabase project via a lightweight URLSession client (no Capacitor).
- Add App Icon art in `Assets.xcassets/AppIcon.appiconset` before App Store submission.
- PasswordGate and Pets from the web repo were unused in navigation there and are not ported.

## Project layout

```
TravelHandbook-iOS/
├── TravelHandbook.xcodeproj
└── TravelHandbook/
    ├── TravelHandbookApp.swift
    ├── AppRootView.swift
    ├── Models/
    ├── Theme/
    ├── Services/
    ├── ViewModels/
    ├── Views/
    ├── Assets.xcassets
    └── Info.plist
```
