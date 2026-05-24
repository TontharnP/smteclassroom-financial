---
name: database-migration
description: Create, review, or fix Supabase/Postgres migrations for Classroom Finance. Use for schema changes under supabase/migrations, SQL constraints, indexes, triggers, RLS policies, generated TypeScript types, camelCase/snake_case mapping updates, and data-layer compatibility.
---

# Database Migration

## Project Context

Migrations live in `supabase/migrations` and are intended to run in order through the Supabase SQL Editor or CLI. `scripts/run-migration.js` prints manual migration guidance; it does not execute SQL.

Core tables include `students`, `schedules`, `schedule_folders`, `transactions`, `categories`, `projects`, and `line_payment_requests`. Important fields include student `line_user_id`, schedule `folder_id` and `sort_order`, transaction pocket fields, payment `method`, and LINE payment request status.

Database/API types in `src/types/supabase.ts` use snake_case. UI types in `src/types/index.ts` use camelCase. Row mapping lives in `src/lib/supabase/mappers.ts`.

## Workflow

Inspect all existing migrations before writing a new one. Use the next numeric prefix and a descriptive name, for example `009_add_example_column.sql`.

Design additive migrations by default. Prefer `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, safe `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, and `DROP TRIGGER IF EXISTS` before creating replacement triggers.

Update related TypeScript types, mappers, API allowed-column lists, forms, and docs in the same change when schema behavior changes.

Consider production data before changing constraints. Backfill data before adding `NOT NULL` or stricter `CHECK` constraints.

Use `uuid_generate_v4()` consistently with the existing schema unless the project migrates UUID strategy deliberately.

## Safety Rules

Do not drop tables, columns, constraints, indexes, data, or RLS policies unless explicitly requested.

Preserve existing values during migrations from legacy fields, such as `bank` to `kplus` compatibility.

Keep LINE and payment data referential integrity clear. Existing `line_payment_requests` references students and schedules with cascade deletes and transactions with `ON DELETE SET NULL`.

## Verification

Run `npm run lint` after TypeScript changes and `npx next build --webpack` after schema-linked type or route changes. If a real Supabase database is available, apply migrations to a non-production project first.
