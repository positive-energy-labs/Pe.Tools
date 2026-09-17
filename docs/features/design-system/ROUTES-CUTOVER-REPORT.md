# Routes cutover report

## Commits

- Consumer base: `36b9d51f84efa8ea6acecb72ff65d22e422b8453`.
- Consumer commit: `f8e5506`.
- Foundation follow-up: pending root commit. `Surface` must fill its parent before route or Chat browser proof.

## Changed routes

- `Surface` and titled `Pane` now own Settings, Data Tables, Parameter Links, Doc Lab, Grilles, the two Family prototypes, Schedule Grid, and Variant E.
- Data Tables, Parameter Links, and Schedule Grid replace `SidePane` with `PaneSplit` and `Pane kind="flank"`. The existing persisted size keys remain.
- Schedule Grid puts re-read in `MasterTable.actions` and its status in `MasterTable.filters`.

## Proof

- PROVEN[static]: `vp check` over the nine owned files passed with no warnings, lint errors, or type errors.
- PROVEN[deterministic]: `routes/-settings.test.tsx` passed, 2 tests.
- FALSIFIED[deterministic]: `schedule-grid/seams.test.tsx` has its documented baseline missing-capture failure. With `PE_LANE=dev`, 4 of 5 tests passed and the remaining assertion failed because the expected schedule capture JSON was absent. Without `PE_LANE`, the suite refuses before loading because host ownership requires that SDK lane signal.
- UNPROVEN[browser]: root owns browser proof after the parent-sized `Surface` foundation merge.

## LOC

- Source only: +1,019/-929, net +90. No tests changed.

## Pending root seams

- Merge the additive parent-sized `Surface` change before browser proof. The current foundation at the consumer base still uses viewport-fixed geometry.
- Root deletes `components/lang/side-pane.tsx` after the final caller census. This lane does not delete it.
