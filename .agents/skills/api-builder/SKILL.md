---
name: api-builder
description: Build, modify, or review API routes for the Classroom Finance Next.js app. Use for src/app/api route handlers, Supabase service-role data access, LINE webhook endpoints, Vercel Blob uploads, request validation, response contracts, and client wrappers under src/lib.
---

# API Builder

## Project Context

API routes live under `src/app/api/**/route.ts` and use Next.js App Router route handlers. Shared response helpers are in `src/lib/api/response.ts`: `ok`, `noContent`, `badRequest`, `notFound`, and `serverError`.

Supabase server access is centralized in `src/lib/supabase/server.ts` with service-role credentials from `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Domain mappers live in `src/lib/supabase/mappers.ts`. Client-side request wrappers use `src/lib/api/client.ts` and domain modules under `src/lib/supabase`.

Important API domains include transactions, schedules, schedule folders, students, categories, uploads, health, cron keep-alive, LINE webhook, LINE payment requests, rich-menu setup, and schedule LINE reminders.

## Workflow

Inspect an existing route in the same domain before editing. Match its response helpers, `RouteContext` style, allowed-column update list, mapper use, and error behavior.

Define the contract before coding: method, URL, search params, request body, response body, status codes, and UI client wrapper changes.

Validate untrusted input at the route boundary. Prefer Zod if adding substantial validation; otherwise keep small checks explicit and consistent with nearby routes.

Use database type names from `src/types/supabase.ts` for API payloads and map database rows through `src/lib/supabase/mappers.ts` before returning them.

For update routes, whitelist columns through `updateRecord` instead of passing arbitrary body fields to Supabase.

After changing API behavior, update the matching domain wrapper in `src/lib/supabase/*.ts`, UI types if needed, and documentation when external setup changes.

## Security Rules

Never expose secret values in responses or logs. Mention environment variable names only.

LINE webhook routes must verify `x-line-signature` with `LINE_CHANNEL_SECRET` before processing events.

Vercel Blob upload code must require `BLOB_READ_WRITE_TOKEN` and avoid trusting client-supplied file metadata beyond what the route validates.

`serverError` currently returns error messages to clients. Avoid adding sensitive detail to thrown errors in API routes.

## Verification

Run `npm run lint` for route and type changes. Run `npx next build --webpack` for new routes, dynamic route params, server-only imports, or changed environment assumptions.
