---
name: classroom-finance-advanced-engineer
description: Handle advanced engineering work in the Classroom Finance 5 repo. Use for complex features, cross-cutting refactors, payment correctness, LINE automation, Supabase migrations, production incident fixes, data integrity reviews, release preparation, and changes spanning UI, API, database, and deployment.
---

# Classroom Finance Advanced Engineer

## Purpose

Use this skill when the work is too broad or risky for a single narrow skill. It is designed for changes that cross multiple layers of the Classroom Finance app: React UI, Zustand state, Next.js API routes, Supabase schema, Vercel Blob, LINE Messaging API, and Vercel deployment.

For normal project orientation, `$classroom-finance-specialist` is enough. Use this advanced skill when correctness, rollout order, migration safety, or payment integrity is the hard part.

## Reference Loading

Read only what the task needs:

- `references/advanced-delivery-playbook.md`: multi-layer feature planning and implementation order.
- `references/financial-integrity.md`: payment, transaction, schedule, pocket, and LINE invariants.
- `references/release-risk-checklist.md`: validation, deployment, rollback, and incident response checks.

## Advanced Workflow

Map the task across layers before editing:

1. Product behavior and Thai UX.
2. UI components, forms, modals, and store updates.
3. Client API wrappers.
4. App Router API route contract.
5. Supabase schema, migrations, mappers, and indexes.
6. External services: LINE, Vercel Blob, Vercel cron/deploy.
7. Verification and release notes.

Identify invariants first. For example, schedule payments must not duplicate, LINE users must not bind to the wrong student, and migrations must not lose data.

Make additive changes where possible. Split risky work into migration, compatibility code, UI adoption, then cleanup.

Prefer existing local patterns over new abstractions. Add an abstraction only when it reduces repeated cross-layer logic or protects a financial/data invariant.

Run `npm run lint` after implementation. Run `npx next build --webpack` for any route, migration-linked type, server/client boundary, deployment, dependency, or release-critical change.

## Stop Conditions

Pause and report clearly if the task requires production secrets, live Supabase mutation, LINE account configuration, Vercel project access, or destructive data migration not explicitly approved by the user.
