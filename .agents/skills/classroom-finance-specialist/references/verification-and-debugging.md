# Verification And Debugging

## Default Verification

Run `npm run lint` after most TypeScript, React, API, and docs-with-code changes.

Run `npx next build --webpack` when changing:

- App Router pages or API routes
- dynamic route params
- imports across server/client boundaries
- environment variable assumptions
- Supabase schema-linked types
- dependency versions
- deployment config

Run a browser smoke test for visible UI changes when a dev server is available.

## Common Failure Patterns

`Missing Supabase server environment variables` means `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` is absent at runtime.

PostgREST missing table or column errors usually mean migrations were not applied, a migration order is wrong, or TypeScript/mappers drifted from schema.

LINE `Invalid LINE signature` means the raw webhook body, signature header, or `LINE_CHANNEL_SECRET` does not match.

LINE push/rich menu failures usually involve `LINE_CHANNEL_ACCESS_TOKEN`, missing rich menu setup, an unregistered student, or a user who has not added the LINE Official Account.

Blob upload failures usually involve `BLOB_READ_WRITE_TOKEN`, file validation, or Vercel Blob platform setup.

Hydration issues usually involve client components reading browser-only state too early, data shape mismatches, or store mutation before `HydrationGate` finishes.

Build errors around dynamic routes may involve the repo's `params: Promise<{ id: string }>` pattern.

## Debugging Workflow

Find the first meaningful error. Ignore cascading warnings until the root failure is identified.

Search exact strings and identifiers with `rg`: route path, table name, column name, env var, function name, and stack frame file.

Map the failure to one layer:

- UI render or hydration
- client fetch wrapper
- API route contract
- Supabase query or schema
- migration drift
- external API credential
- upload storage
- build/deployment config

Fix the narrowest responsible layer and rerun the failing command or closest local equivalent.

## Deployment Notes

Deployment likely targets Vercel. Keep secrets in platform environment variables, not in code or committed files.

Supabase migrations are applied manually unless automation is added.

Set LINE webhook URL to `/api/line/webhook` on the deployed domain.

If a platform-side step is required, state it separately from repo changes.
