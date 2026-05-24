---
name: deployment-fix
description: Diagnose and fix deployment, build, hosting, environment, and production runtime failures for Classroom Finance. Use for Vercel/Next.js build errors, Supabase env problems, Vercel Blob uploads, LINE webhook/rich menu setup, cron keep-alive, routing issues, and production-only regressions.
---

# Deployment Fix

## Project Context

The app deploys as a Next.js app, likely on Vercel. `vercel.json` exists. Runtime integrations require `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET`, and `BLOB_READ_WRITE_TOKEN`.

Supabase migrations are manual unless the user adds CLI automation. LINE webhook URL should point to `/api/line/webhook`. Vercel Blob is used for uploads and payment proof storage.

## Workflow

Gather the failing command, platform log, route, commit context, and whether the failure happens during install, build, server startup, API runtime, webhook call, upload, or cron.

Reproduce locally with `npx next build --webpack` when the failure is build-related. Use `npm run lint` for type/import/lint symptoms.

Trace environment errors to the exact variable name without printing secret values.

For API runtime failures, inspect the route under `src/app/api`, its server-only imports, Supabase access, and external API assumptions.

For LINE webhook failures, verify signature handling, channel secret, channel access token, webhook URL, rich menu setup route, and whether the user has added the LINE Official Account.

For Blob failures, verify `BLOB_READ_WRITE_TOKEN`, upload route size/type validation, and returned URLs/pathnames.

## Safety Rules

Never reveal secret values. Do not commit real `.env.local` values.

Do not change production data or Supabase schema while diagnosing deployment unless the user explicitly asks and the migration path is clear.

Call out required platform-side changes separately from repo changes.

## Verification

Run `npx next build --webpack` for deployment fixes. If deployment requires network access or platform credentials, state what was verified locally and what remains to check on the host.
