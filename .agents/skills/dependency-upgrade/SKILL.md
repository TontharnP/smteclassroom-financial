---
name: dependency-upgrade
description: Upgrade, replace, or audit dependencies in the Classroom Finance project. Use for npm/package-lock changes, Next.js 16, React 19, Tailwind v4, Supabase, LINE, Vercel Blob, Recharts, Framer Motion, vulnerability fixes, peer dependency conflicts, and migration-driven code updates.
---

# Dependency Upgrade

## Project Context

This repo uses npm with `package-lock.json`. Scripts are `npm run dev`, `npm start`, and `npm run lint`. Use `npx next build --webpack` for production build validation.

Key dependencies: Next.js 16, React 19, TypeScript 5, Tailwind CSS v4 with `@tailwindcss/postcss`, Supabase JS v2, Vercel Blob, Framer Motion, Recharts, react-calendar, react-hook-form, Zod v4, Zustand v5, lucide-react, promptpay-qr, qrcode.react, and uuid.

## Workflow

Inspect `package.json`, `package-lock.json`, framework config, and usage sites before changing versions.

Classify the upgrade as patch, minor, major, security, or migration. For Next, React, Supabase, Tailwind, Vercel Blob, LINE-related packages, and Zod major changes, check official migration notes before editing.

Use npm so the lockfile stays consistent. Update code for changed APIs in the same change.

Avoid swapping libraries unless the user requested it or the existing package cannot meet the requirement.

## Risk Areas

Next.js App Router route handler behavior, dynamic route `params` typing, server-only imports, React 19 client/server boundaries, Tailwind v4 configless CSS, Supabase JS response shapes, Zod v4 schema APIs, and chart/calendar rendering can break on upgrades.

Vulnerability fixes must not expose secrets or change payment/LINE behavior without verification.

## Verification

Run `npm install` after manifest changes, then `npm run lint` and `npx next build --webpack`. Note unresolved peer warnings or skipped migration steps.
