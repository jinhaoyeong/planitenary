# Travel Handbook

A React + TypeScript + Vite app for planning trips: itineraries, maps, budgets, checklists, documents, and photos.

## Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Add your Supabase project values to `.env.local` (see `.env.example`). Never commit real `.env` files or API keys.

## Scripts

- `npm run dev` — local development
- `npm run build` — production build
- `npm run preview` — preview the production build
- `npm run lint` — ESLint

## Native apps

The web UI is also the native UI: Capacitor loads the same React + TypeScript bundle in a
native shell, so the 390pt mobile layout, fonts, safe-area handling, navigation, and
interactions stay in one source of truth.

### Android

The repo includes a Capacitor Android shell under `android/`. After building the web app:

```bash
npm run cap:sync
```

### iOS

The repo includes a Capacitor iOS shell under `ios/`. Sync the latest web bundle with:

```bash
npm run ios:sync
```

Open `ios/App/App.xcodeproj` in Xcode with:

```bash
npm run ios:open
```

Building and signing the iOS target requires macOS, Xcode, and an Apple developer
account. Windows can prepare the project and verify the web build, but cannot run
the Xcode simulator or produce an App Store archive.
