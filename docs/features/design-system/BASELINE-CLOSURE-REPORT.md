# Baseline closure report, 2026-09-16

## Scope and evidence

Current closure base: `9f77fca` (merged from root `8aec6ac`). The reproduced deterministic command was:

```text
vp test scripts/fixture-census.test.ts src/schedule-grid/seams.test.tsx
```

Before the correction it had three failures: one missing canonical fixture, a saved schedule capture `ENOENT`, and a first queued apply refused as `stale-revision`.

## Schedule seams — PROVEN fixed

`apps/host/tests/schedule-test-fixture.ts` created every isolated host fixture with the same logical document address, `C:/Same.rvt`. Schedule Work identity is derived from the document address and schedule identity. The shared browser reading registry therefore retained a prior fixture's route slice and saved-reading ID across teardown. Its old capture belonged to the prior temporary capture store, producing `ENOENT`; its old revision was `r3` while the new fixture was `r2`, producing the first `stale-revision` refusal.

The fixture now uses its own temporary document address. That is the existing identity authority used by schedule capture creation; no queue behavior, expected revision, assertion, or production capture was changed.

```text
vp test src/schedule-grid/seams.test.tsx
5 passed, 0 failed
```

This proves the queue carries the first accepted revision, preserves the caller's explicit stale revision, and resumes an implicit write after that refusal. It is deterministic test evidence only; no browser or Revit behavior is claimed.

## Fixture census — BLOCKED by missing authority

The sole unclassified maintained route is `/lab` from `apps/web/src/routeTree.gen.ts`. `apps/web/src/routes/lab.tsx` is a live session-only synthetic-operation route (`needs: "session"`, `inventory` reading) and has neither a fixture seed nor a `source=fixture` loader/path. Search found no existing `/lab?source=fixture` authority or canonical fixture metadata to restore. It cannot truthfully be marked `inherent-static`, and this closure does not fabricate a review URL or weaken `fixture-census`.

Required owner input: provide or designate the legitimate `/lab` fixture source (or explicitly retire/move the mounted route). Until then, the census assertion remains a real baseline failure.

Final combined rerun: `1 failed, 6 passed`; the only failure is `fixture-census.test.ts` at `missingCanonicalFixtures` (`1`, expected `0`).
