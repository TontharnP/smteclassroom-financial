---
name: git-pr-helper
description: Help with Git and pull request workflows for this repository. Use to inspect diffs, avoid overwriting user changes, stage and commit repo-local changes, write PR summaries, address review comments, resolve conflicts, and prepare release notes for Classroom Finance work.
---

# Git PR Helper

## Workflow

Start with `git status --short`. Treat unrelated modified, deleted, or untracked files as user work unless clearly created by the current task.

Inspect diffs before staging. Stage only files that belong to the requested change.

Do not revert `agent.md`, `.codex/`, `.env.local`, generated artifacts, or user changes unless explicitly requested.

For commits, use concise messages that name the changed feature or fix. For PR descriptions, include what changed, why, and verification.

For reviews, lead with findings ordered by severity and cite file paths and line numbers.

## Repo-Specific Notes

Common verification commands are `npm run lint` and `npx next build --webpack`. There is no test script in `package.json` currently.

Important code areas are `src/app`, `src/components`, `src/lib`, `src/types`, `supabase/migrations`, `docs`, and integration config files.

## PR Summary Shape

Use short bullets:

- Summary: user-visible and technical changes.
- Verification: commands run and results.
- Notes: migrations, env vars, deployment steps, or risks.
