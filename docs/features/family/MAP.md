# Family Foundry investigation

2026-09-08. Source baseline `57b72b6`, branch `family/rewrite`, base `bb4b7f1`. Six independent workers: Astra medium (shape), Opus low (engine and retained-session mining), Sol low (tests, contracts, definitions). Root checked findings and ran proof. Old feature reports were not used as specifications.

## Verdict

Keep the new engine. It consolidates real consumers and improves native parameter transfer. Do not restore the old Desired compiler. Do not merge on a claim of complete preservation or portability yet: the current model omits mandatory BIM state, and some loss can disappear into a new baseline.

The minimal target is captured BIM state, an explicit standard or patch, and one native reconciler. Geometry construction can extend that core. This is a proposed direction, not a completed architecture change.

## Historical comparison

The old snapshot is `d06e67e`, parent of the actual `CmdFFDesiredMigrator` addition `92c6239` on June 1. The mature desired snapshot is `bb4b7f1`; the new snapshot is `57b72b6`. Entries below describe inspected source capability, not historical runtime certification.

| Operator need | Old Manager / Migrator | Desired era | New worktree |
|---|---|---|---|
| Bulk project standard | Selectors and add/map/delete/purge queue | Declarative declarations compiled into old operations; three command paths | Per-family capture, plan, hash check, apply and receipt; common visit |
| Per-type values | Native replacement or copy/coercion | Same underlying mapping | Ranked sources, destination precedence, fill blanks and explicit assignments |
| Formulas and bindings | Mapping explicitly unsets formulas; fallback mainly copies values | Declarative input does not repair the old primitive | Transfers dimensions, arrays, associations and dependent formulas; source-formula failure can still be swallowed |
| Remove nonstandard parameters | Explicit delete and unused/empty purge | Similar purge | Explicit tombstones; overlay omission is retention, so no closed standard |
| Room calculation | Absent from inspected old queues | Ordinary Manager/Migrator expose it; Desired lowerer omits it | Shared patch path for build and migration; capture/apply axis mismatch |
| Electrical normalization | Migrator creates an electrical connector | Ordinary and Desired lowerers disagree about legacy creation | Shared power-connector association rule; no explicit main-connector selection |
| Portable shared definitions | Service dependent | Captured model lacks embedded GUID/spec | Embedded GUID/spec and attributes support offline reconstruction |
| Hosting and orientation | Native substrate retained during edits | Restricted template/geometry projection | Placement exists; connector pose, arbitrary room coordinates and host fidelity remain incomplete |
| Geometry | Constrained planes/extrusions/connectors | Separate model lowering/composition layers | One element-oriented model with optional construction macros; arbitrary geometry remains unmodeled |
| Repeatability | Processing timestamp changes each run | Timestamp remains | Timestamp removed; diff/residue machinery exists, but run effects and omitted facts need separate checks |

Historical anchors: `FFMigratorQueueBuilder`, `MapReplaceParams`, `MapParams`, `DesiredParameterCompiler`, `DesiredMigrationPlanLowerer` in the snapshots above. Current anchors: `NormalizeParamSources`, `NormalizeParameter`, `FamilyReconciler`, `FamilySharedParameterSource`, `FamilyModelBuild`.

The bounded C# count for FamilyFoundry, shared family contracts and FF ribbon commands fell from 23,111 desired-era lines to 11,569. This is not whole-feature net deletion: native helpers, host, web and tests are outside that count.

## Merge concerns

| Finding | Evidence and consequence | Smallest honest next step |
|---|---|---|
| Formula loss can become the baseline | `FamilyDocumentNormalizeParameter.TransferAndRemoveParameter` catches native formula assignment failure, then removes the source. `ReconcileFamily` recaptures after normalization. Source-proven path; native refusal case still owed. | Preserve the expression or refuse the family. Exercise a spec-incompatible source formula and assert rollback, not only current values. |
| A deleted type cell can disappear from planning | Merge removes a null cell; `FamilyReconciler.Diff` enumerates desired cells, so a removed cell produces no value change. Source-proven; native clear policy is unresolved. | Define clear versus inherit versus preserve; reject unsupported clearing before mutation. |
| Standard closure is absent | Full models become overlays. Cleanup protects all desired parameter names, including inherited nonstandard names. | Separate overlay semantics from a complete allowed set; resolve required drivers before deleting the complement. |
| Connector pose is under-specified | Capture accepts either coplanar normal sign and does not read back complete rectangular orientation; identity is domain/plane/intersections. | Capture and compare signed pose and host facts; retain native bindings without requiring arbitrary visual geometry. |
| Room capture/apply disagree | `AddRoomDingler` uses negative Y for work-plane and wall-hosted families; capture uses negative Y only for wall-hosted families. Offset alone cannot represent arbitrary/from-to points. | One placement rule, plus an explicit unsupported-state outcome until the model carries full required positions. |
| Save and load are different commit domains | `FamilyVisit` saves before project load verification. A later rollback cannot undo an overwritten file. | Model file outcome separately; prove source-file custody and load refusal. Merely moving Save after Assimilate is not atomic. |
| Contract validation permits invalid authored state | A deterministic probe against the built shared assembly accepts invalid slope strings, contradictory connector dimensions/domains and incomplete shared identity. `ValidatePatch` only parses shape before live merging. | Validate at the shared authored-input seam. Avoid blanket restrictions on native states, such as rejecting every empty type name. |

These are not seven demonstrated native failures. The table explicitly distinguishes source paths, deterministic acceptance and missing native proof. The fresh baseline did demonstrate a fixture failure before migration: creating its array while Type C was current changed Type A seed values. The builder already has a first-type path; that path is now the default, and the diagnostic corruption case remains explicit.

## Test and fixture shape

Two public scenarios should carry the product, with narrow native-trap tests retained where they explain Revit:

1. **Bulk standard:** several types; source/destination collision; shared identity replacement; source and dependent formulas; dimension/array/connector bindings; blanks; room/electrical normalization; nonstandard drivers; one deliberately refused family. Assert independent expected native values/bindings, rollback, saved/reloaded project behavior and no-op reapply.
2. **Portable family:** capture, reconstruct in another document/year, save, reopen and apply again. Assert per-type values/formulas, signed connector pose, room positions, hosting/orientation and coverage. Optional geometry refusal must not conceal missing BIM state.

The current 81-family sweep checks shared identities and convergence across the corpus, plus specific Fantech MCA values. It does not independently assert every mapped value/formula on every family. Its elapsed time also includes review export and readback; use `processorMs` and `operationsMs` when distinguishing execution from that extra work.

Use the real company profiles and Old_Template corpus as acceptance inputs. Do not delete complex tests just because their fixture is expensive. Replace duplicate fixture/converter scaffolding only after the common scenario preserves its behavioral assertions. A fixture that compares only its own capture output can validate a shared omission twice.

Company definitions originally contained 145 entries: 144 exact active cache identities and archived `PE_G___Horsepower`. The other 10 duplicate names in the cache each pair an active and archived row; selecting the last row by name produced false mismatches and was rejected. Archive status lives in `Metadata`, not a serialized top-level boolean.

The change removes the archived fixture entry, selects only active converter definitions and routes the retired horsepower name to `PE_G_Perf_Horsepower`. A public native test covers both type values and repeat convergence. Both bulk harnesses now checkpoint definition identity, cache/fixture hashes and differences before migration. A cache observation is not proof of a live service refresh.

## Retained-session extraction

The September 1-8 frozen extraction examined 1,626 candidate turns. After excluding relays, injected instructions, agent dispatches and unrelated turns, 72 retained FF author-turn excerpts were reviewed; twelve claims were checked again in their original session stores. Three long excerpts have unreviewed tails, including part of the PE standard document. Family-worktree records were delegated rather than independent user authorship. Raw-record locators are in the disposable mining evidence.

Stable intent: preserve formulas; explicit formula unset retains type values; whole-family rollback with per-family batch outcomes; real company standards on the unmigrated template; Fantech before/after inspection; dependency planning is intentional. The present request supersedes old absolute metadata wording with a narrow exception, while keeping the ES ban. Historical reports of broken connectors/formulas are leads, not current runtime verdicts.

## Proof frontier

- Clean `57b72b6`: deterministic Family selection passed 88/88 through `pe-revit test`.
- Clean `57b72b6`: fresh controlled Revit 2025 public matrix failed at seed validation, before migration.
- Current focused edits: compile passed; two public tests passed in fresh controlled Revit 2025: active horsepower replacement/reapply and the full value/reference matrix. The separately named array diagnostic did not match the filter; the public matrix exercises the corrected default.
- Fresh controlled Revit 2025: the full mechanical sweep passed 81/81 families; composed profiles passed 12/12 family applications and empty second plans. SDK verdict: two tests passed, zero failed/skipped, exit 0; elapsed 48m25s including boot/build/inspection/export. The mechanical preflight matched 39 active definitions; composed preflight matched all 144 fixture definitions, with zero differences.
- The user chose the existing cache as authority; a live service refresh is not independently proven. Both checkpoints record its exact hash and identity fields. Review output contains 49 sweep RFAs and 12 profile RFAs; the first 32 sweep exports failed before the output directory was created, independently of their passing migrations.
- Documentation guard passed 6/6. The `beta.151.ff.1` CLI predates PID-pinned attached tests; its attached attempt was cancelled without native proof. The released `beta.152` CLI correctly refused the snapshot without a loaded test server. Successful native verdicts above came from fresh tests.

The committed-branch merge preview against `main` (`fe7c2b4`) reports conflicts in `global.json`, `.config/dotnet-tools.json` and `ProfileListItem.cs`; it excludes this investigation's uncommitted edits. No merge has been performed.

Disposable run: `.artifacts/runs/ff-purify-20260908/`. It contains source/historical citations in `shape-report.md`, revised `engine-report.md`, `tests-report.md`, `contracts-report.md`, `definitions-report.md`, `mine-report.md`, native/compile receipts and the deterministic contract probe. The feature verdict and open work live in [LEDGER.md](LEDGER.md); this map is swept when the merge frontier closes.
