# Travel Handbook

A mobile-first travel handbook app built with React, TypeScript, Vite, and Capacitor.

The handbook-style experience is restored, but the seeded personal trip content has been removed. The app now starts with a blank editable trip so you can build your own itinerary from scratch.

## Stack

- React + TypeScript
- Vite + PWA support
- Tailwind CSS v4
- Framer Motion
- Capacitor for native iOS and Android packaging

## Local development

```bash
npm install
npm run dev
```

## Production web build

```bash
npm run build
```

## Native mobile setup

Install dependencies first:

```bash
npm install
```

Sync the web build into Capacitor:

```bash
npm run cap:sync
```

Open the native projects:

```bash
npm run cap:ios
npm run cap:android
```

## Before publishing

- Change `appId` and `appName` in `capacitor.config.ts`
- Replace the placeholder app icons in `public/`
- Customize the handbook screens in `src/App.tsx`
- Review permissions, splash screens, and store metadata in Xcode and Android Studio
