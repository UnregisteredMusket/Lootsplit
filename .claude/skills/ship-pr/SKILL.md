---
description: Ship a Lootsplit change the way CLAUDE.md requires, from branch to verified PR, CI check and merge. Use when a change is ready to commit, push and open as a pull request, or when asked to check or merge a PR.
---

# Ship a Lootsplit change

This turns CLAUDE.md's "How a change ships" into steps. CLAUDE.md wins if they ever disagree.

## 1. Branch and scope

- Branch from current `main` with `fix/…`, `feature/…`, `dev/…`, `docs/…` or `ci/…`. One topic per branch.
- Before pushing from a shallow clone, run `git fetch origin main` and rebase if needed, so the push sends a thin pack.

## 2. Verify locally

Run `npm run verify:quick`: unit tests, typecheck and lint.

**If `node_modules` is missing:**
- Run the touched tests with `node --experimental-strip-types --test FILE`.
- Diff `tsc` output against `main`.
- Write down exactly what could not run. CI is then the gate.

**Browser behavior:** run `npm run verify:focus -- SCENARIO` for the scenario you touched.

## 3. Check the rules

- No applied migration was edited (the guard hook blocks it). New schema is a new additive migration in this PR.
- Money and inventory changes followed `/money-command`.
- Any user-visible change has a help review (`src/lib/help/content.ts`, `player-content.ts`) and a `docs/FEATURE-INVENTORY.md` entry.
- New third-party content is credited in `src/lib/website/resources.ts`.
- Android changes follow the release rules: version bump, changelog, workflow-only publishing.

## 4. Open the PR

**The PR description is the checkpoint.** Use these headings:

```
## What changed
## Why
## How verified
## Help review
## What is left
```

**Create it with the REST API** (GraphQL is unavailable in cloud sessions):

```
gh api repos/UnregisteredMusket/Lootsplit/pulls -f title='…' -f head=BRANCH -f base=main -F body=@pr-body.md
```

## 5. CI

- **Don't push while the PR's run is in progress;** it cancels and restarts.
- **Wait for checks** with a background loop rather than repeated sleeps:

  ```
  gh api repos/UnregisteredMusket/Lootsplit/commits/SHA/check-runs --jq '.check_runs[] | "\(.name): \(.status) \(.conclusion)"'
  ```

- **On a failure:**
  - Read the failed step's annotation before re-running.
  - Infrastructure flake on unchanged code: re-run only the failed jobs.
  - Test failure: diagnose it.

## 6. Merge and release

- CLAUDE.md records the owner's standing approval to merge when green. If the session's permission settings refuse the merge, stop and ask the owner; don't work around it.
- Merging deploys: main verify, then `website-release.yml`, then the read-only live audit. Confirm the live identity before calling it released.
