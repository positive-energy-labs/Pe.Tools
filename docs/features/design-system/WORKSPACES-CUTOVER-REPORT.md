# Workspace consumer cutover report

## Scope

- Base: `36b9d51f84efa8ea6acecb72ff65d22e422b8453`.
- Consumer commit: `ab93a0a` (`Move workspace consumers onto Surface`).
- Source only: `+46/-38` lines across eight owned consumer files. Tests: `+0/-0` lines.

## Landed

- `Workspace` now composes `Surface` and `PaneWorkspace`. It keeps the shared gutter, scroll-away route head, and existing resize/persistence keys without copying grid tracks into each consumer.
- `/runs` uses `Surface` at its route root. The source census confirms the owned consumers are route roots, not Chat/plugin children, so no consumer uses fixed viewport positioning.
- Takeoffs names its `plan` and `rooms` panes. Families renders its matrix inside the titled `families` pane. Family uses the supported `recess` pane header ground.
- Route-local pane-header geometry was removed. `MasterTable` continues to own its one rail and filter row.

## Proof

- PROVEN[deterministic, `ab93a0a`]: `vp check --fix` over the eight changed files passed formatting, lint, and type checks.
- PROVEN[deterministic, `ab93a0a`]: `vp test` over takeoff, family, families, runs, instances, and grilles coverage passed 14 files and 111 tests.
- UNPROVEN[browser]: root owns route proof. No server or browser was started.

## Remaining gaps

- Root must land the parent-sized `Surface` and shared-gutter `PaneSplit` correction. Consumers use only that shared contract and add no viewport/fixed workaround.
- `family/workspace-core.ts`, `families/workspace.tsx`, and `runs/browser/model.ts` retain their existing global keyboard handlers because they are outside this consumer ownership. Keyboard access remains intact; pane-local registration is root follow-up work if it remains required.
- The full-suite three baseline failures recorded in `L0-REPORT.md` were not rerun. This lane adds no guard baseline.
