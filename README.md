# Jizhang

Mobile-first AI bookkeeping app built with React, TypeScript, Vite, Tailwind CSS, and Capacitor Android.

## Features

- Dashboard for monthly budget, weekly trends, category ranking, and spending insights.
- AI-assisted transaction entry with local fallback parsing when no API key is configured.
- Screenshot/OCR-style import flow for bill splitting demos.
- Transaction search, category filtering, expandable details, and delete actions.
- Local settings for API configuration, monthly budget, and custom categories.
- Android packaging through Capacitor.

## Tech Stack

- React 19
- TypeScript
- Vite
- Tailwind CSS
- Capacitor Android
- LocalStorage persistence

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Android Sync

```bash
npm run android:sync
```

## Data Compatibility

The app stores user data in LocalStorage. Keep these keys stable during refactors:

- `ab_transactions`
- `ab_settings`

Android update compatibility depends on keeping the same package id and signing key:

- `com.aurora.bookkeeper`
