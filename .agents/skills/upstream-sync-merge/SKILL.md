---
name: upstream-sync-merge
description: Merge trusted upstream code into this fork while preserving local integration. Use for upstream syncs, branch merges, merge conflicts, protected files, LFS blockers, and sync workflows.
---

# Code Merge And Upstream Sync

## Overview

Use Git's ordinary three-way merge. In this repository, `upstream/main` is the
trusted source and `origin/main` is the writable fork. Preserve local platform
integration with the `keep-local` merge driver. Never copy directories,
force-push, reset, clean, or overwrite a worktree to make a merge appear clean.

When the user asks to sync or merge upstream without naming another target,
merge `upstream/main` into the local `main`.

## Workflow

1. Read `AGENTS.md`, `PROJECT-RUNBOOK.md`, this skill, `features.json`,
   `package.json`, and any existing roadmap or handoff file. Missing files are
   reported, not invented.
2. Confirm the path, branch, HEAD, remotes, and clean state. Run
   `npm run worktree:check`. A sync-only merge belongs on `main`; do not run
   `npm run worktree:development`, which intentionally rejects `main`.
3. Fetch upstream without materializing Windows LFS files on macOS, then inspect
   divergence:

   ```bash
   git -c lfs.skipSmudge=true fetch --no-tags upstream main
   git rev-list --left-right --count HEAD...upstream/main
   ```

   If `upstream/main` is already included, stop. A fetch failure is a network
   or provider blocker, not a merge result.
4. Check protected paths from `AGENTS.md` and local-owned paths from
   `.gitattributes`. Do not edit or stage protected runtime or watermark files.
   For LFS files, verify the declared pointer OID/size or the materialized hash;
   never treat pointer text length as runtime size.
5. Make a reviewable three-way merge:

   ```bash
   git config merge.keep-local.driver true
   git merge --no-commit --no-ff upstream/main
   ```

   Local-owned files remain local. Product source, schemas, generated files,
   package metadata, docs, and ordinary tests use normal three-way merging.
6. If clean, verify with `git diff --cached --check`,
   `npm run worktree:check`, `npm run feature-sync:check`, and
   `npm run type-check`. Run focused tests only when the changed surface needs
   them; do not launch the full test suite by default for a sync check.
7. If checks pass, complete the merge commit on `main` when the user asked to
   perform the merge. Never push to `origin` without explicit authorization.
   Report a clean `--no-commit` result as merged-but-uncommitted until then.
8. If conflicts remain, stop and show `git diff --name-only --diff-filter=U`
   and `git ls-files -u`. Inspect only the base/local/upstream stages. Resolve
   existing hunks in shared files; never use directory-wide `ours`, `theirs`,
   reset, checkout, or a feature refactor as a conflict strategy.

## Boundaries

- `start-dev.command`, platform-sync/LFS scripts and tests, the runbook, and
  the sync workflow are local-owned. Do not resolve them in favor of upstream.
- Protected runtime and watermark files remain fail-closed. For an LFS file,
  verify either the pointer's declared OID/size or the materialized file hash;
  do not compare a pointer's 134-byte text size with its declared runtime size.
  If the recorded baseline disagrees with every reachable ref, record it as a
  stale baseline and confirm the repository history before stopping the merge.
- A model is read-only: no product-file writes, staging, commits, pushes,
  release work, secrets, or network-provider calls unless explicitly requested.
- A clean merge should be committed on `main` after the required checks pass.
  Do not push without explicit user authorization. A conflict receives review
  advice before resolution.

## LFS And GitHub Workflow

For source-only cloud synchronization, use `actions/checkout` with `lfs: false`.
If checkout fails with `This repository exceeded its LFS budget`, classify it as
an LFS infrastructure blocker and do not claim that upstream was synchronized.
Only fetch or materialize protected Windows runtimes when the change touches
them and LFS access is available.

The optional GitHub flow is:

```text
fetch upstream/main -> guarded merge -> verify -> sync PR -> optional merge
```

Do not silently re-enable a disabled workflow. A user-authorized manual run is:

```bash
gh workflow run sync-upstream.yml --repo weszzzz/T8-penguin-canvas --ref main
```

## Verification

- Always run `git diff --check`, `npm run worktree:check`, and
  `npm run feature-sync:check`.
- Run `npm run type-check` plus tests for every changed node, provider, network,
  or merge-policy surface.
- Report separately: automatically merged, locally retained, model-advised,
  unresolved, verified, and not run.

## Lessons From Recent Sync

- Do not create or switch to a temporary `codex/*` branch for this workflow;
  `main` is the canonical sync target.
- A clean merge can stage a large release delta without changing `HEAD`; report
  this as merged-but-uncommitted until verification and commit are complete.
- When a protected-file check fails, compare the file across `HEAD`, the target
  remote, and recent history before treating it as local corruption. A shared
  mismatch can indicate stale policy metadata rather than drift.

Read [references/ownership.md](references/ownership.md) before changing the
sync workflow or resolving a conflict.
