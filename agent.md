# Agent Guide: SMTE_19 Classroom Finance

Read this before changing the codebase. This app is a classroom finance dashboard for tracking income, expenses, schedules, students, payment status, and LINE notifications.

## Stack

- Next.js 16 App Router, React 19, TypeScript strict mode.
- Tailwind CSS v4 with app-specific tokens and classes in `src/app/globals.css`.
- Supabase Postgres through server helpers in `src/lib/supabase/`.
- Zustand for the hydrated global bundle in `src/lib/store.ts`.
- SWR for focused route/client fetching in `src/hooks/useSupabase.ts`.
- Framer Motion, lucide-react, react-hot-toast, Recharts, react-calendar, react-hook-form, Zod.
- Vercel Blob is used for uploaded payment/student assets.
- LINE Messaging API integration lives under `src/lib/server/line*.ts` and `src/app/api/line/`.

## Important Commands

```bash
npm run dev
npm run lint
npm run build
```

Use `npm run lint` for quick verification. Use `npm run build` when touching routing, server code, types, data mappers, or shared components.

## Project Layout

- `src/app/`: App Router pages and API routes.
- `src/app/api/`: Route handlers. Return with helpers from `src/lib/api/response.ts`.
- `src/components/`: Feature components grouped by domain (`dashboard`, `transactions`, `schedule`, `students`, `pockets`, `ui`, `layout`, etc.).
- `src/lib/store.ts`: Client-side global app bundle and mutations.
- `src/lib/supabase/server.ts`: Server-only Supabase admin client and generic record helpers.
- `src/lib/supabase/mappers.ts` and `src/lib/supabase/adapter.ts`: Database-to-UI mapping.
- `src/types/index.ts`: UI/domain types.
- `src/types/supabase.ts`: Database-oriented types.
- `supabase/migrations/`: Database schema changes.
- `docs/`: Product and setup documentation.

## Data Model Rules

- UI/domain objects use camelCase.
- Supabase rows use snake_case.
- Convert between those shapes through existing mapper/adapter functions instead of ad hoc mapping in components.
- When accessing Supabase in API routes or server code, prefer `listRecords`, `getRecord`, `createRecord`, `updateRecord`, and `deleteRecord` from `src/lib/supabase/server.ts`.
- Keep allowed-column lists explicit when updating records.
- Use `emptyToNull` and `normalizeForSupabase` patterns so optional values do not become inconsistent empty strings or `undefined` fields.
- Transactions can be normal transactions, schedule-derived transactions, or transfers. Preserve `source`, `schedule_id`, `student_id`, pocket fields, and method/category semantics carefully.
- Schedule payment status depends on relationships between schedules, students, and transactions. Avoid changing one side without checking the derived calculations and UI status displays.
- Pockets currently include fallback client-side defaults in `DataHydrator`; check for a real persistence layer before assuming pockets are fully database-backed.

## API Rules

- Import response helpers from `@/lib/api/response`:
  - `ok(data, status?)`
  - `noContent()`
  - `badRequest(message)`
  - `notFound(message?)`
  - `serverError(error)`
- Route handlers should validate request shape before writing.
- Keep error messages concise and user-actionable.
- Do not expose service role keys or internal Supabase details to client code.
- Server-only integrations must stay in server files or route handlers.

## UI Rules

This app has a polished glass UI with fixed-height app pages. Match the existing visual system instead of introducing a generic dashboard style.

- Use tokens from `src/app/globals.css`: `var(--panel)`, `var(--panel-solid)`, `var(--panel-soft)`, `var(--foreground)`, `var(--muted)`, `var(--muted-strong)`, `var(--primary)`, `var(--success)`, `var(--danger)`, `var(--warning)`, `var(--line)`.
- Prefer existing classes: `apple-card`, `apple-panel`, `apple-soft`, `apple-button`, `apple-ghost-button`, `apple-icon-button`, `apple-segmented`, `apple-segment`, `apple-segment-active`, `glass-nav`, `hover-lift`, `pressable`, `visual-gradient`.
- Pages should usually use `fixed-page`, `fixed-page-header`, and `fixed-page-body` so the shell does not create uncontrolled window scrolling.
- Use `src/components/ui/Skeleton.tsx` for loading states.
- Use `src/components/ui/Modal.tsx` and `ConfirmDialog.tsx` for modal/confirmation patterns.
- Use lucide-react icons for actions and navigation.
- Keep layouts responsive and touch-friendly. Check compact/mobile states for text overflow, fixed headers, scroll areas, and bottom navigation.
- Do not add isolated styling systems, new color palettes, or one-off card/button patterns unless the existing system cannot support the need.
- Keep Thai user-facing copy consistent with nearby screens.

## State And Data Fetching

- `DataHydrator` loads the core bundle once into Zustand: students, schedules, schedule folders, transactions, categories, and fallback pockets.
- Use store mutation helpers when updating already-hydrated client data.
- Use SWR hooks when a route or component needs focused server data with revalidation.
- After a mutation, update local store/SWR state deliberately so UI state does not drift from persisted data.
- Preserve optimistic UI only when rollback/error handling is clear.

## Forms And Validation

- Reuse existing modal and form patterns in the same feature folder before adding new abstractions.
- Use strict TypeScript types and Zod/react-hook-form where already established.
- Normalize numeric input before persistence.
- Avoid letting empty form strings leak into database fields that should be nullable.

## LINE And Uploads

- LINE webhook and payment request code is high impact. Keep signature validation, status transitions, and idempotency in mind.
- Students must have `lineUserId`/`line_user_id` before push notifications can work.
- Payment proof uploads go through server-side storage helpers. Do not move upload tokens into client components.

## Migrations

- Add schema changes as new SQL files under `supabase/migrations/`.
- Keep migrations forward-only and named with the next numeric prefix.
- Update `src/types/supabase.ts`, mappers, adapters, and related API routes in the same change when schema changes affect runtime code.
- Check docs or README when setup steps change.

## Verification Checklist

Before finishing code changes, run the narrowest useful verification:

- `npm run lint` for most changes.
- `npm run build` for changes touching routes, server code, TypeScript types, migrations, shared state, or cross-feature behavior.
- Manual browser check for visual changes, especially dashboard, transactions, schedule, students, modals, mobile navigation, and dark mode.

If verification cannot be run because environment variables or services are missing, state that clearly in the final response.

## Working Practices

- Read surrounding code before editing; follow local patterns.
- Keep changes scoped to the requested behavior.
- Avoid unrelated refactors and formatting churn.
- Do not revert user changes.
- Prefer small, typed helper functions over duplicated business logic.
- Use path alias `@/` for imports from `src`.
- Keep comments sparse and useful.
