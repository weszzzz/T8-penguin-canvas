---
name: upstream-sync-merge
description: Safely synchronize this repository with its trusted upstream while preserving local platform integration. Use for upstream pulls, sync merges, merge conflicts, local-owned file policy, and read-only AI merge advice.
---

# Upstream Sync Merge

## Overview

Use Git for ordinary three-way merges. Preserve local platform integration with
the `keep-local` merge driver. Ask Codex only to analyze real shared-file
conflicts; it must not invent or edit product code.

## Workflow

1. Start from a clean `main` and fetch the selected target remote. Do not copy
   directory trees, reset, or overwrite a working tree.
2. Confirm the target remote before merging: `origin` is the repository's
   read/write remote, while `upstream` is the trusted source remote. Fetch the
   selected remote before judging divergence.
3. Perform the sync merge directly on `main`; a temporary development branch is
   not required for an upstream merge. Run `npm run worktree:check` before
   modifying the merge state.
4. Let Git attempt the three-way merge with `merge.keep-local.driver=true`.
   The local-owned paths in `.gitattributes` retain the local side.
5. Use `--no-commit --no-ff` for the first merge attempt so the result can be
   reviewed before any commit. If there is no conflict, verify the merge on
   `main`; commit only after explicit authorization.
6. If conflicts remain, use `.github/codex/prompts/upstream-merge-advisor.md`.
   Codex may inspect only `:1`, `:2`, and `:3` Git stages and return an
   `ours`, `theirs`, or `combine-existing-hunks` decision for each path.
7. Apply only an approved decision on `main`. Never turn merge advice into a
   feature request or refactor.

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
- A clean merge may remain on `main`; do not commit or push without explicit
  user authorization. A conflict receives review advice before resolution.

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
  this as merged-but-uncommitted until the user authorizes the commit.
- When a protected-file check fails, compare the file across `HEAD`, the target
  remote, and recent history before treating it as local corruption. A shared
  mismatch can indicate stale policy metadata rather than drift.

Read [references/ownership.md](references/ownership.md) before changing the
sync workflow or resolving a conflict.
