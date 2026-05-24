---
name: performance-review
description: Investigate and improve performance in the Classroom Finance app. Use for slow Next.js pages, expensive Supabase queries, client rendering bottlenecks, bundle size, chart/calendar performance, Zustand update churn, image handling, API latency, and build or deployment performance issues.
---

# Performance Review

## Project Context

The app uses a fixed dashboard shell with hydrated client state, many modal-heavy client components, Recharts, Framer Motion, `react-calendar`, Supabase API routes, and Vercel Blob images.

API helpers in `src/lib/supabase/server.ts` often fetch full tables through `listRecords` and filter in route handlers. This is simple but can become slow as transactions, schedules, students, and LINE payment requests grow.

## Workflow

Identify the measured symptom first: page, route, command, viewport, dataset size, and whether the bottleneck is database, API, render, bundle, image, network, or build.

Inspect the relevant page, child components, API route, and domain wrapper. Trace duplicate fetches, repeated calculations, unbounded lists, and large client-only trees.

Prefer targeted improvements: Supabase filtering before fetch, indexes in migrations, memoized calculations, stable props, scoped Zustand updates, lazy modal loading, and pagination or virtualization for large lists.

Keep UI behavior unchanged unless the user accepts a product tradeoff.

## High-Value Checks

For API performance, look for `listRecords(...).filter(...)` patterns that can move filters into Supabase queries and for missing indexes in `supabase/migrations`.

For UI performance, inspect dashboard cards/charts, transaction lists, student grids, schedule calendar, and modal forms for avoidable re-renders or expensive derived data.

For bundle size, avoid adding heavy dependencies. Existing libraries include Recharts, Framer Motion, react-calendar, qrcode, PromptPay QR, and Supabase.

For images, keep uploaded student avatars and payment proofs efficient and avoid rendering unbounded full-size images.

## Verification

Run the smallest relevant command: `npm run lint`, `npx next build --webpack`, local page smoke test, API timing comparison, or query plan when a database is available. Report any performance claim that was inferred rather than measured.
