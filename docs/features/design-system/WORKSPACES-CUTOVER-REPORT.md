# Workspace consumer cutover report

## Scope

- Base: `36b9d51f84efa8ea6acecb72ff65d22e422b8453`.
- Consumer commits: `ab93a0a` (`Move workspace consumers onto Surface`) and `c4aa86d` (`Keep table rails singular in workspaces`).
- Source: `+128/-121` lines across nine owned consumer files. Tests: `+3/-1` lines in one associated test.

## Landed

- `Workspace` now composes `Surface` and `PaneWorkspace`. It keeps the shared gutter, scroll-away route head, and existing resize/persistence keys without copying grid tracks into each consumer.
- `/runs` uses `Surface` at its route root. Family and Families also render through `workbench/route-panes.tsx`; the parent-sized `Surface` contract keeps those embedded workspaces inside their host without a consumer-specific mode or viewport escape.
- Takeoffs names its visual `plan` pane. The Rooms, Families, and Family table panes retain title/help metadata but use intentional `headerless`, so each `MasterTable` draws the only title rail and filter row.
- Family moves overlay modes and table actions into `MasterTable`; route controls remain outside table ownership. Route-local pane-header geometry was removed.

## Proof

- PROVEN[deterministic, `c4aa86d`]: scoped `vp check --fix` passed formatting, lint, and type checks.
- PROVEN[deterministic, `c4aa86d`]: takeoff, family, and families tests passed 9 files and 85 tests. `families/demo-lane.test.tsx` asserts the Families table title rail exists while pane-header count is zero.
- UNPROVEN[browser]: root owns route proof. No server or browser was started.

## Remaining gaps

- Root must land the parent-sized `Surface` and shared-gutter `PaneSplit` correction. Consumers use only that shared contract and add no viewport/fixed workaround.
- `family/workspace-core.ts`, `families/workspace.tsx`, and `runs/browser/model.ts` retain their existing global keyboard handlers because they are outside this consumer ownership. Keyboard access remains intact; pane-local registration is root follow-up work if it remains required.
- The full-suite three baseline failures recorded in `L0-REPORT.md` were not rerun. This lane adds no guard baseline.
