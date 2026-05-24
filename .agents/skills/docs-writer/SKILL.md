---
name: docs-writer
description: Create or update documentation for Classroom Finance. Use for README changes, Thai user guides, developer docs, Supabase setup, migration instructions, LINE setup, deployment notes, API docs, runbooks, changelogs, and comments that must match the current repo behavior.
---

# Docs Writer

## Project Context

The app is documented in Thai and English across `README.md`, `QUICK_MIGRATION_GUIDE.md`, `supabase/STORAGE_SETUP.md`, and `docs/*.md`. User-facing docs may be Thai; developer docs can be English or Thai depending on the surrounding file.

The product manages classroom finance: dashboard, transactions, schedules/folders, students, categories, pockets, payment methods, Vercel Blob uploads, and LINE registration/payment notifications.

## Workflow

Read the code, scripts, config, and adjacent docs before writing. Do not invent commands, env vars, endpoints, schema fields, or features.

Keep documentation operational: prerequisites, exact commands, file paths, environment variable names, migration order, expected result, and troubleshooting.

Match the language and tone of the target file. Preserve Thai terminology used in the UI where applicable.

Update docs when changes affect setup, migrations, LINE webhook/rich menu configuration, Vercel Blob, deployment, or user workflows.

## Important Facts

Commands: `npm install`, `npm run dev`, `npx next build --webpack`, `npm start`, `npm run lint`.

Required environment names: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET`, `BLOB_READ_WRITE_TOKEN`.

Supabase migrations live in `supabase/migrations` and are applied in numeric order.

LINE webhook path is `/api/line/webhook`. Student LINE registration can be done by sending a student number to the LINE bot.

## Verification

Check referenced paths with `rg --files` and commands in `package.json`. Run `npm run lint` only when documentation changes include code snippets that must compile or when docs edits accompany code changes.
