---
name: classroom-finance-specialist
description: Work effectively on the Classroom Finance 5 Next.js project. Use for most tasks in this repo, including feature work, bug fixes, UI changes, API routes, Supabase schema changes, LINE payment workflows, Vercel Blob uploads, deployment fixes, documentation, reviews, and debugging.
---

# Classroom Finance Specialist

## Start Here

Use this skill as the default project guide for `Classroom Finance 5`, a Thai classroom finance app built with Next.js 16, React 19, TypeScript, Tailwind CSS v4, Zustand, Supabase, Vercel Blob, and LINE Messaging API.

Read only the reference needed for the task:

- For file locations, app structure, routes, integrations, and commands, read `references/project-map.md`.
- For implementation conventions, data flow, UI patterns, API routes, migrations, and LINE behavior, read `references/implementation-patterns.md`.
- For verification, deployment, environment variables, and common failures, read `references/verification-and-debugging.md`.

## Core Workflow

Inspect the existing implementation before editing. This repo already has strong local patterns for routes, modals, state hydration, Supabase mappers, response helpers, and Thai UI copy.

Keep changes scoped to the requested workflow. Avoid broad rewrites, new design systems, library swaps, or schema changes unless the task requires them.

Respect the two data shapes:

- UI state in `src/types/index.ts` uses camelCase.
- Supabase/API types in `src/types/supabase.ts` use snake_case.

When data crosses the API/database boundary, check `src/lib/supabase/mappers.ts`, `src/lib/supabase/server.ts`, and the relevant domain wrapper in `src/lib/supabase`.

Preserve secrets. Mention environment variable names only; never print real values from `.env.local`.

After code changes, run the narrowest useful verification. Usually start with `npm run lint`; run `npx next build --webpack` for routes, server/client boundaries, dependency changes, schema-linked types, or deployment fixes.

## Product Priorities

The product exists to manage classroom money: dashboard summaries, transactions, collection schedules, students, categories, pockets, payment proof uploads, and LINE registration/payment notifications.

Thai UX matters. Keep labels and messages natural, concise, and consistent with the surrounding UI.

Financial correctness matters. Avoid changes that can duplicate payments, lose schedule links, corrupt transaction source/kind, expose private proof images, or send LINE messages to the wrong student.

Database compatibility matters. Migrations are manually applied in numeric order from `supabase/migrations`; update TypeScript types and mappers with schema changes.
