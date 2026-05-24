---
name: frontend-ui
description: Build, modify, or review frontend UI for the Classroom Finance Next.js app. Use for React components, App Router pages, Tailwind v4 styling, Thai interface copy, responsive layout, modals, charts, calendars, Zustand-backed UI state, and visual polish in src/app and src/components.
---

# Frontend UI

## Project Context

This is `Classroom Finance 5`, a Thai classroom finance web app built with Next.js 16, React 19, TypeScript, Tailwind CSS v4, Framer Motion, Recharts, `react-calendar`, `react-hook-form`, Zod, Zustand, Supabase, Vercel Blob, and LINE Messaging API.

Primary UI routes live in `src/app`: `/dashboard`, `/transactions`, `/schedule`, `/students`, `/categories`, and `/notifications`. Reusable UI lives in `src/components`, with domain folders for dashboard, transactions, schedule, students, categories, pockets, layout, notifications, and `ui`.

## Workflow

Inspect the target route, component folder, `src/app/globals.css`, and nearby modals before editing.

Preserve the app shell pattern from `src/app/layout.tsx`: fixed viewport, `HydrationGate`, sidebar on desktop, mobile nav and bottom tabs on small screens.

Prefer existing UI classes and tokens: `apple-card`, `apple-panel`, `apple-soft`, `apple-button`, `apple-ghost-button`, `apple-icon-button`, `apple-segmented`, `pressable`, `section-title`, `page-kicker`, `fixed-page`, and CSS variables in `:root` and `.dark`.

Use lucide-react icons for UI controls when an icon exists. Keep Thai copy natural and concise.

Implement complete states when relevant: loading skeletons, empty states, API errors, disabled submitting states, mobile and desktop behavior, hover/focus, and dark mode.

Run `npm run lint` after UI edits. Run `npx next build --webpack` when changing routes, imports, client/server boundaries, or shared types.

## Data And State

UI-facing types in `src/types/index.ts` use camelCase. Database/API types in `src/types/supabase.ts` use snake_case. Check mappers in `src/lib/supabase/mappers.ts` and adapters before mixing the two.

Global hydrated data is stored in `src/lib/store.ts`. API client helpers are in `src/lib/api/client.ts`; domain API wrappers are in `src/lib/supabase/*.ts`.

When a component mutates data, update local Zustand state consistently with the API result instead of inventing a second source of truth.

## Design Standards

Keep this as an operational dashboard, not a marketing page. Prioritize dense, scannable layouts, clear hierarchy, compact controls, and predictable navigation.

Use stable responsive dimensions to prevent overflow in Thai text, tables, cards, calendars, and modal headers. Add `min-w-0`, truncation, wrapping, and grid constraints where needed.

Do not introduce a new visual system unless the requested work requires it. Avoid unrelated palette, radius, layout, or typography rewrites.
