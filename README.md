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

## Android (optional)

This repo includes a Capacitor Android shell under `android/`. After building the web app:

```bash
npm run build
npx cap sync android
```
