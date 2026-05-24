---
name: error-log-analyzer
description: Analyze errors, stack traces, failed commands, and runtime logs for Classroom Finance. Use for Next.js build errors, API route failures, Supabase/PostgREST errors, LINE webhook errors, Vercel Blob upload errors, hydration issues, TypeScript/lint failures, and production logs.
---

# Error Log Analyzer

## Project Context

This app can fail in several integration layers: Next.js App Router, React client components, Supabase service-role queries, PostgREST schema mismatches, Vercel Blob uploads, LINE webhook signature and Messaging API calls, cron keep-alive, and hydrated Zustand state.

Shared response errors come from `src/lib/api/response.ts`. Supabase access and common helpers are in `src/lib/supabase/server.ts`. LINE helpers are in `src/lib/server/line.ts` and webhook handling is in `src/app/api/line/webhook/route.ts`.

## Workflow

Find the first meaningful error, not the loudest follow-on message. Capture command, route, HTTP status, timestamp, environment, and stack frame into project code.

Search referenced files, functions, route names, table names, env var names, and error strings with `rg`.

Map the error to the likely layer: import/build, server/client boundary, environment variable, API contract, Supabase schema, migration order, external API credential, upload token, or UI hydration.

Explain the evidence, then fix the code when requested. Keep the fix scoped to the root cause.

## Common Error Patterns

`Missing Supabase server environment variables` means `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` is absent at runtime.

PostgREST missing table or column errors usually mean migrations in `supabase/migrations` were not applied or TypeScript/mappers drifted from schema.

LINE `Invalid LINE signature` means webhook body, signature header, or `LINE_CHANNEL_SECRET` mismatch.

Blob upload failures usually involve missing `BLOB_READ_WRITE_TOKEN`, invalid file assumptions, or platform-side Blob configuration.

Next.js dynamic API route typing uses `params: Promise<{ id: string }>` in this repo; keep new dynamic routes consistent.

## Verification

Rerun the failing command or closest targeted command. Use `npm run lint` for lint/type import failures and `npx next build --webpack` for App Router, server/client, and deployment failures.
