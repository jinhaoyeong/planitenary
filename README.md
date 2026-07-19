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

## Vercel deployment

Import the GitHub repository into Vercel. The included `vercel.json` uses the Vite build command, publishes `dist`, and rewrites client-side routes to `index.html`.

Add these variables in Vercel Project Settings → Environment Variables:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
VITE_SUPABASE_AUTH_REDIRECT_URL
```

Use `.env.example` as the variable-name reference. Never commit `.env.local`, Supabase service-role keys, build output, dependencies, or `.vercel` state.

In Supabase Authentication → URL Configuration, add the Vercel production URL to the redirect allow list.

### Account security (2FA)

In the Supabase dashboard:

1. Enable Multi-factor authentication (TOTP) under Authentication → MFA / Multi-factor.
2. Optionally enable password, email, and phone change notification emails under Authentication → Emails.

In the app, cloud accounts are required to enroll an authenticator after sign-in (Demo / local test accounts skip this). Sign-in then requires a 6-digit TOTP code, and password / email / phone changes require the current password plus that code.

Enabling TOTP in the Supabase dashboard only turns the feature on for the project — each user still enrolls from the app setup screen.

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
