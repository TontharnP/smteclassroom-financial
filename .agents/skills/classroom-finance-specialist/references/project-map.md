# Project Map

## Stack

- Next.js 16 App Router
- React 19
- TypeScript
- Tailwind CSS v4 via `@import "tailwindcss"` in `src/app/globals.css`
- Zustand global app state
- Supabase Postgres through server-side service-role client
- Vercel Blob for uploads
- LINE Messaging API webhook, rich menus, and push messages
- Recharts, Framer Motion, react-calendar, react-hook-form, Zod, lucide-react

## Commands

- `npm run dev`: local dev server
- `npx next build --webpack`: production build validation
- `npm start`: serve built app
- `npm run lint`: ESLint

There is no test script in `package.json` currently.

## Important Paths

- `src/app/layout.tsx`: fixed app shell, providers, sidebar/mobile nav layout
- `src/app/globals.css`: design tokens, dark mode variables, reusable UI classes
- `src/app/*/page.tsx`: App Router pages
- `src/app/api/**/route.ts`: API routes
- `src/components/layout`: sidebar, mobile nav, bottom tabs, theme toggle
- `src/components/ui`: shared modal, confirm dialog, skeletons
- `src/components/dashboard`: dashboard summaries and charts
- `src/components/transactions`: transaction forms, list, quick pay
- `src/components/schedule`: schedules, calendar, detail/edit/add modals
- `src/components/students`: student grid and student modals
- `src/components/categories`: category management
- `src/components/pockets`: pocket cards and transfer flows
- `src/components/providers`: hydration and theme providers
- `src/lib/store.ts`: Zustand data bundle and CRUD state helpers
- `src/lib/api/client.ts`: client fetch wrapper
- `src/lib/api/response.ts`: API response helpers
- `src/lib/supabase/server.ts`: service-role Supabase admin helpers
- `src/lib/supabase/mappers.ts`: database row to typed object mappers
- `src/lib/supabase/*.ts`: domain API wrappers
- `src/lib/server/line.ts`: LINE Messaging API helper functions
- `src/lib/server/paymentProofStorage.ts`: payment proof Blob storage
- `src/types/index.ts`: UI-facing camelCase types
- `src/types/supabase.ts`: Supabase/API snake_case types
- `src/types/supabase-category.ts`: category database type
- `supabase/migrations`: SQL migrations in numeric order
- `docs`: setup, development, migration, Supabase, and feature docs

## Main Product Areas

- Dashboard: balance, income, expense, schedule collection, charts, payment status
- Transactions: normal income/expense/transfer plus schedule-linked payments
- Schedule: collection schedules, folders, due dates, reminders, paid/unpaid status
- Students: profile, avatar, LINE User ID, outstanding schedule payment
- Categories: transaction categories and icons
- Pockets: balances and transfers
- LINE: webhook registration, rich menus, payment selection, proof upload, reminders
- Uploads: Vercel Blob for student avatars and payment proof images

## Required Environment Variables

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `LINE_CHANNEL_ACCESS_TOKEN`
- `LINE_CHANNEL_SECRET`
- `BLOB_READ_WRITE_TOKEN`

Never reveal actual values.
