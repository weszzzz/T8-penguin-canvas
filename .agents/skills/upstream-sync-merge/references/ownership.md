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

## Outcomes

| Outcome | Action |
| --- | --- |
| Upstream already included | Stop without a merge. |
| Clean merge | Verify the staged result; commit only with authorization. |
| Shared-file conflict | Inspect the three Git stages and resolve existing hunks only. |
| Protected-file drift | Compare reachable refs before stopping; do not overwrite protected files. |
| Failed verification | Leave the merge uncommitted and report the failed check. |
