# Release Risk Checklist

## Before Editing

- Check `git status --short`.
- Identify unrelated user changes and leave them alone.
- Confirm whether the change needs database migration, environment variables, platform setup, or external service access.
- Identify the highest-risk invariant: money, student identity, schema compatibility, secret handling, or deployment.

## Verification Matrix

Use the narrowest useful checks, but do not skip build for release-critical work.

- UI-only: `npm run lint`, browser smoke test when possible.
- API route: `npm run lint`, `npx next build --webpack`, route-level manual request if environment permits.
- Migration-linked: `npm run lint`, `npx next build --webpack`, apply SQL to non-production Supabase when available.
- LINE webhook: `npm run lint`, `npx next build --webpack`, verify signature path and missing-env behavior locally; platform test requires LINE credentials.
- Upload/Blob: `npm run lint`, `npx next build --webpack`, verify missing-token behavior; real upload requires Vercel Blob token.
- Dependency: `npm install`, `npm run lint`, `npx next build --webpack`.
- Deployment fix: `npx next build --webpack` at minimum.

## Release Notes Template

Summarize:

- What changed.
- User-visible behavior.
- Data or migration impact.
- Required environment/platform actions.
- Verification performed.
- Residual risks.

## Rollback Thinking

For additive code-only changes, rollback is usually a Git revert.

For migrations:

- Prefer forward fixes over destructive rollback.
- Keep new columns nullable until data is backfilled and code is stable.
- Do not drop old columns in the same release that introduces replacement fields.
- Avoid irreversible data rewrites without an exported backup.

For LINE or payment workflow incidents:

- Disable the risky action path before changing data.
- Preserve logs needed to identify duplicate or wrong payments.
- Reconcile `line_payment_requests` with `transactions` before cleanup.

## Incident Debugging

Classify the incident:

- Build/deploy failure.
- Missing environment variable.
- Supabase schema drift.
- API route contract mismatch.
- LINE signature/token/rich menu failure.
- Blob token/upload failure.
- UI hydration or client/server boundary error.
- Financial duplication or missing transaction.

Find the first meaningful error and map it to source files with `rg`. Fix root cause first, then cleanup follow-on symptoms.
