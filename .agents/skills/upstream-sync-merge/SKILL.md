---
name: upstream-sync-merge
description: Safely synchronize this repository with its trusted upstream while preserving local platform integration. Use for upstream pulls, sync PRs, merge conflicts, local-owned file policy, and read-only AI merge advice.
---

# Upstream Sync Merge

## Overview

Use Git for ordinary three-way merges. Preserve local platform integration with
the `keep-local` merge driver. Ask Codex only to analyze real shared-file
conflicts; it must not invent or edit product code.

## Workflow

1. Start from a clean `main` and fetch `upstream/main`. Do not copy directory
   trees, reset, or overwrite a working tree.
2. Work on a temporary `codex/*` branch. Run `npm run worktree:check` and
   `npm run worktree:development` before modifying code.
3. Let Git attempt the three-way merge with `merge.keep-local.driver=true`.
   The local-owned paths in `.gitattributes` retain the local side.
4. If there is no conflict, verify the merge, open a sync PR, and keep `main`
   unchanged until the PR is accepted.
5. If conflicts remain, use `.github/codex/prompts/upstream-merge-advisor.md`.
   Codex may inspect only `:1`, `:2`, and `:3` Git stages and return an
   `ours`, `theirs`, or `combine-existing-hunks` decision for each path.
6. Apply only an approved decision on a `codex/*` branch. Never turn merge
   advice into a feature request or refactor.

## Boundaries

- `start-dev.command`, platform-sync/LFS scripts and tests, the runbook, and
  the sync workflow are local-owned. Do not resolve them in favor of upstream.
- Protected runtime and watermark files remain fail-closed. Verify the LFS
  pointer or materialized hash before an upstream merge can continue.
- A model is read-only: no file writes, staging, commits, pushes, release work,
  secrets, or network-provider calls.
- An automatic clean merge opens a PR. A conflict opens a review issue with
  advice; it does not modify `main`.

## Verification

- Always run `git diff --check`, `npm run worktree:check`, and
  `npm run feature-sync:check`.
- Run `npm run type-check` plus tests for every changed node, provider, network,
  or merge-policy surface.
- Report separately: automatically merged, locally retained, model-advised,
  unresolved, verified, and not run.

Read [references/ownership.md](references/ownership.md) before changing the
sync workflow or resolving a conflict.
*** Add File: /Users/wes/Documents/T8-penguin-canvas/.agents/skills/upstream-sync-merge/references/ownership.md
# Ownership Map

## Local-owned paths

These paths use the `keep-local` merge driver in `.gitattributes`:

- `start-dev.command`
- `PROJECT-RUNBOOK.md`
- `scripts/sync-platform.cjs`
- `scripts/verify-lfs-runtime.cjs`
- `tests/syncPlatform.test.cjs`
- `tests/verifyLfsRuntime.test.cjs`
- `.github/workflows/sync-upstream.yml`

They may be updated deliberately in local work, but an upstream overlap must
not replace them automatically.

## Shared paths

Product source, schemas, generated capability artifacts, package metadata,
documentation, and ordinary tests use Git's normal three-way merge. A conflict
must be resolved from the existing base/local/upstream hunks, then verified.

## Automated outcomes

| Outcome | Action |
| --- | --- |
| Upstream already included | Stop without a PR. |
| Clean merge | Push a `sync/upstream-*` branch and open a PR. |
| Shared-file conflict | Create read-only merge advice and a review issue. |
| Protected-file drift | Stop before merge. |
| Failed verification | Keep the branch/PR out of `main`. |

Delete this entire "Structuring This Skill" section when done - it's just guidance.]

## [TODO: Replace with the first main section based on chosen structure]

[TODO: Add content here. See examples in existing skills:
- Code samples for technical skills
- Decision trees for complex workflows
- Concrete examples with realistic user requests
- References to scripts/templates/references as needed]

## Resources (optional)

Create only the resource directories this skill actually needs. Delete this section if no resources are required.

### scripts/
Executable code (Python/Bash/etc.) that can be run directly to perform specific operations.

**Examples from other skills:**
- PDF skill: `fill_fillable_fields.py`, `extract_form_field_info.py` - utilities for PDF manipulation
- DOCX skill: `document.py`, `utilities.py` - Python modules for document processing

**Appropriate for:** Python scripts, shell scripts, or any executable code that performs automation, data processing, or specific operations.

**Note:** Scripts may be executed without loading into context, but can still be read by Codex for patching or environment adjustments.

### references/
Documentation and reference material intended to be loaded into context to inform Codex's process and thinking.

**Examples from other skills:**
- Product management: `communication.md`, `context_building.md` - detailed workflow guides
- BigQuery: API reference documentation and query examples
- Finance: Schema documentation, company policies

**Appropriate for:** In-depth documentation, API references, database schemas, comprehensive guides, or any detailed information that Codex should reference while working.

### assets/
Files not intended to be loaded into context, but rather used within the output Codex produces.

**Examples from other skills:**
- Brand styling: PowerPoint template files (.pptx), logo files
- Frontend builder: HTML/React boilerplate project directories
- Typography: Font files (.ttf, .woff2)

**Appropriate for:** Templates, boilerplate code, document templates, images, icons, fonts, or any files meant to be copied or used in the final output.

---

**Not every skill requires all three types of resources.**
