# Continuation result

## Status

Ready for authority review at `fb3d7b9c0aa423cf9750cdff7e13d512f96e894a` plus this scoped commit. `CRUSADE.md` was absent from this worktree, the accepted base worktree, and tracked Git paths.

## Census

- `ctx.write`: `route/family/manifest.ts` has apply cleanup and captured-reading writes. `families/manifest.ts` has apply cleanup and scope writes. No action calls `ctx.write` more than once.
- `ctx.command`: `route/spec-editor.tsx` has `open` and `adopt`.
- `docWriter`: `route/use-route.ts` constructs one writer. Action `write` and `command` now pass the action snapshot revision. Ordinary `work.write` still owns its separate accepted-revision queue.
- Production `work.write`: `instances/cluster.tsx`, `family/store.ts`, `routes/parameter-links.tsx`, `families/store.ts`, `route/schedules/live.tsx`, `takeoff/controller.ts`, and `takeoff/route-workspace.tsx`.

## Behavior

- A late action write or command sends the revision of the original Work snapshot. A newer Work snapshot therefore causes a host `stale_revision` refusal without mutation.
- A write or command against the same snapshot succeeds. Hydrated absent Work initializes at revision `0`. Unhydrated Work refuses.
- The ordinary same-tick `work.write` chain still carries accepted revisions. The A-B-A page guard still passes. A stale refusal after one native call does not redispatch that call.

## Proof

- RED: `vp test src/route/target-gap.test.tsx` from `source/pe-tools/apps/web` returned 1 failed and 6 passed. The late action returned `null` instead of `stale-revision`.
- GREEN: `vp test src/route/target-gap.test.tsx src/route/action-scope.test.tsx src/route/schedules/seams.test.tsx` returned 3 files passed and 16 tests passed.
- CHECK: `vp check --fix src/route/use-route.ts src/route/target-gap.test.tsx` completed with 0 errors and exposed 4 test-only stringification warnings, which were corrected. `vp check src/route/use-route.ts src/route/target-gap.test.tsx` then returned no warnings, lint errors, or type errors.

Native success/publication separation remains unproven and belongs to the next host wave.
