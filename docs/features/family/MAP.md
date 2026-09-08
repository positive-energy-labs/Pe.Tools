# Family Foundry completion map

Rewritten 2026-09-07 (the 2026-09-07 morning form is in git). Integration line: `Pe.Tools-family`, branch `family/rewrite`, base `68ce9db` plus 16 dirty files (Codex's last uncommitted round: receipt commitment, coverage marking, connector intent, sidecar default). Nothing merged to main or published. Product rulings: [LEDGER.md](LEDGER.md).

## The shape (what exists on the line)

One portable text profile, one reconciler, three doors.

| Piece | Where | Role |
|---|---|---|
| `FamilyModel` (family.json) | `Pe.Shared.RevitData/Families/FamilyModelContracts.cs` | the ONE portable profile; patch semantics (omit = unchanged, null = delete, `{}` = ensure) |
| Patch file `{ select, patch, run }` | `Pe.Shared.RevitData/Families/FamilyPatch.cs` | bulk lane input; 45 frozen company profiles convert to it |
| `ReconcileFamily` | `Pe.Revit.FamilyFoundry/Reconcile/ReconcileFamily.cs` | one `DocOperation`: capture current, pure `Diff`, compile to `OperationQueue`, apply inside `FamilyVisit`, receipt with residue |
| Ops library | `Pe.Revit.FamilyFoundry/Operations`, `OperationProcessor` | script-usable execution layer; the only pre-rewrite survivor |
| Door 1 `/family` | `apps/web/src/family` | one-family authored + live lanes on `family/store.ts` |
| Door 2 `/families` | `apps/web/src/families` | fleet plan → apply → receipt chain in `familiesRouteState` |
| Door 3 scripts / Pods / Pea | `packages/mcps/src/pea/family-commands.ts`, `FamilyModelBridgeOps.cs` | public Build/Plan/Apply primitives; `NoTransaction` lets the script own the transaction |

Diff against main (main has not touched this area since base `bb4b7f1`): library 113 files −9,279 net; tests 108 files +11,494; web/TS 57 files +2,328.

## Proof ladder (highest surface that has carried the claim)

| Rung | Claim | Lane | Evidence |
|---|---|---|---|
| 1 | all 45 profiles convert; Grinder, Modine, Magna3 rulings honored | deterministic | converter tests on the line |
| 2 | one family, browser: AprilAire Plan → Apply → converged → repeat 0 | browser + session dev, ff-close-25 | `.artifacts/runs/session-20260907-aprilaire/` |
| 3 | one family, public script: Linear LED capture, stable plan hash, apply, empty replan | Host script | `.artifacts/runs/fresh-20260907-ff-close/` |
| 4 | one family, native migration: Fantech 38/38 shared identities, 80 → 0 changes, zero residue; user inspected PRE/POST and approved | Host script, NoTransaction | `.artifacts/runs/session-20260907-fantech-inspect/` (execution e4442d9f) |
| 5 | bulk: all 81 editable mechanical families in Old_Template under the company mechanical mapping plus the connector rule | fresh `pe-revit test`, `Old_template_all_editable_mechanical_families_migrate_company_mapping` | 2026-09-08: run 12 one session 78/80 (Magna3 excluded; PVFY and Panasonic FV-0511VK2 roll back on `Constraints are not satisfied`, Panasonic flaky: passed run 4). Run 14 Magna3 alone passes with the pole-word ruling. So 79/81 green, 2 owed to the depgraph line (`.artifacts/runs/famclose-20260907/depgraph-report.md`). Evidence: `rung5-run12-checkpoint.json`, `rung5-run14-checkpoint.json` |
| 6 | receipt commitment tracks the real `FamilyVisit` result; Build refuses an unconverged family | Host script | `receipt-readback.cs` in run 3; dirty tree, uncommitted |
| 7 | exclusive current-source attached suite (no installed Pe.App beside it) | pe-revit test | **UNPROVEN**: every attached run so far loaded installed Pe.App 0.6.26 too |

Rung 4 is source-to-destination proof. The destination-wins ruling (existing `PE_` destination with a differing source value) has no native carrier yet.

## Resume point (2026-09-08 00:30, uncommitted)

Fourteen source files (plus `CoerceByStorageType` pole words) are dirty on top of `3d6ea55` and compile: key-level verifiability, connector rule on the sweep with `createIfAbsent`, power-only connectors, phase-1 slot on unbalanced connectors, replacement fallback, null-formula guard, family-type sources excluded, electrical coercion of numeric sources, label fallback, failure-event resolution in `FamilyVisit` (the modal-dialog hang), commit errors carrying Revit text, NUnit timeout 60. Herd `famclose` cast 2026-09-08 00:20: depgraph (writes source), perf, bugs-reconcile, bugs-ops, cruft (read-only); reports under `.artifacts/runs/famclose-20260907/swarm/`. Swarm reports landed 2026-09-08; dispatched to session `famfix` in worktree `Pe.Tools-family-fix` (branch `family/rewrite-fix`, seed `2cff8dd` = this dirty tree without the depgraph trace): fix-ops, fix-reconcile, fix-cruft, posture and reports under its `.artifacts/runs/famfix-20260908/`. Owed from the swarm, not dispatched: perf 1 and 2 (four captures and the double reconcile), perf 8 (per-attempt SubTransaction), cruft 2-4 (second capture pipeline fold), bugs-reconcile 8. Next: merge `family/rewrite-fix` onto the line after depgraph lands, rerun the 80, compare receipts to run 12, commit as the rung 5 checkpoint.

## Merge gate (what closes the branch)

1. Dirty tree proven deterministic-green and committed as one checkpoint (w1 report in `.artifacts/runs/famclose-20260907/`).
2. Rung 5 on a disposable Old_Template copy in a session this effort owns. Coverage units are distinct: 45 profiles, 81 editable mechanical families, 38 shared definitions. Known seam: the harness at `FamilyFoundryBulkMigrationHarnessTests.cs` ~964 presumes a pre-existing Fantech `PE_E___MCA` the immutable fixture lacks; reconcile against rung 4, do not delete preservation assertions.
3. Rung 7 or an explicit waiver line in the ledger.
4. Broad capture's related-document warning (SDK `9091b5c` + caller `8c2f79a`) adopted as one coherent package or excluded by name.
5. Ledger rebuilt to current truth; this MAP deleted; the branch sweep below executed.

Geometry roundtrip, room points, lookup-table deletion, Pea authoring, supported-year and installed journeys stay in scope but are not merge gates (2026-09-06: bulk parameter migration is the primary gate).

## Branch and worktree disposition (census 2026-09-07)

70 `family/*` branches sat beside the line. `git cherry family/rewrite <b>`:

- 45 branches: every commit patch-equivalent in `family/rewrite`. Worktrees retired 2026-09-07 (`retire-list.txt`, `retire.log` in the run dir); branches deleted at the sweep.
- 25 branches carry commits the line does not hold verbatim. Census (`w2-report.md`, literal-line match of added source against the line): 20 are re-expressed on the line (A), `family/proof` is 38 doc commits plus two test files, `family/critic-purge` is contradicted by the 2026-09-06 ops-library ruling (re-open with the user, never by merge). Pull before the sweep, one commit each:
  - `family/electrical-connector-plan-capture`: `Capture/FamilyPlanCapture.cs`, focused pre-apply capture and refusal of approximate connector plan identities.
  - `family/sdk-failure-scope-call` `8c2f79a`: `ProcessFamily.cs` EditFamily failure predicate (pairs with SDK `9091b5c`, gate 4).
  - `family/proof`: `Diagnostics/DimensionCreationDiagnosticsTests.cs`, and the missing rows of `ValueWriteExperimentTests.cs`.
- Deterministic state of the dirty tree (w1, 2026-09-08T00:54Z): C# compiles 0 errors; `Pe.Shared.Tests` 172/172; web family routes 161/161; `vp check` typecheck fails with 28 errors in untouched `family-review/proto-editor/*` and `instances/*` (pre-existing on `68ce9db`); one mcps test needs a running dev host. Every `Pe.Revit.Tests` filter boots Revit, so converter and `Diff` tests are attached-lane only.
- `family/scope-dismiss` (merged) has two dirty `families/store` files; inspect, then retire.

## Runtime custody

No SDK sessions exist as of 2026-09-07 evening (`pe-revit session list`: none). Every PID and port in earlier forms of this map is dead. Rules that survive: re-read SDK identity before runtime work; own the session you mutate; `pe-revit test` is the only Revit test surface; never quarantine a source snapshot (it disables ricaun); public scripts go through `vp exec jiti apps/pea/src/main.ts script execute --host dev --bridge-session-id session:<owned-id> --permission-mode NoTransaction`; check operation status, not CLI exit 0.

## Completion contract

- Explicit JSON specifications are manifested; unmentioned content stays untouched.
- Each family completes or rolls back; successful batch siblings persist.
- Destination wins: rewire source references and remove the source, or roll back the family.
- No ExtensibleStorage or persistent roundtrip metadata. Apply never saves existing documents.
- `/family`, `/families`, Pea route state and public script/Pod primitives must agree.
- Green by deleting coverage is rejected; restore deleted intent at the highest surface.
- Measurable authored literals require units. Number/Integer stay unitless.

## User stories and remaining proof

| Story | Remaining highest-surface evidence |
|---|---|
| Author one portable family | native JSON + sidecars create on every supported year; no machine paths |
| Bulk normalize a model | rung 5 |
| Audit/manage a project's families | `/families` live snapshot, selection, plan, apply, drift, failure, repeat, receipts (two bridge ops still dashed) |
| Ask Pea to author a family | Pea changes real route state through capability/scope/target contracts |
| Normalize third-party electrical content | destination precedence natively; association transfer (dirty tree carries the connector-intent rewrite) |
| Use FF from scripts/Pods | one pod renames a parameter across three families through `FamilyVisit`, live |
| Reapply a changed specification | extras preserved, connector added, explicit values changed, next run 0 |
| Trust partial batch progress | failed family unchanged, sibling persisted, actionable receipt, in one bulk run |
| Roundtrip supported content | capture/rebuild/reopen plus geometry perturbation; symbolic loops compile, not native-proven |

## Value strategy evidence

Fresh controlled Revit 2025, proof `39cde8f`: 12-type Mitsubishi family, five specs, three repetitions, zero mismatches. Median mutation: batched setters 4867.7 ms, prepopulated-source formulas 924.3 ms, temporary selector 4133.7 ms. No selector optimization adopted. New numeric values are raw zero; blank writes do not restore unset.

## Protected state

- `Old_Template.rvt` SHA256 `8107AD50ADBD7BB9866287F0C8DB9168FD88ABE3132206356B717E24F2EE46B1`; proof opens disposable copies only.
- Downloads `MEP_Architect_Project Name_R25_Copy_2025.07.11.rte` is the user's likely old clone; unchanged.
- OneDrive Documents/Pe.Tools settings and workspaces are migration inputs; the cloud template is already migrated.
- SDK pin on this line is `ff.1`; canonical main is beta.151 with different companions. Adopt as a package, never by swapping global.json alone.
