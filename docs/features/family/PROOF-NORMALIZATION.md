# Normalization proof slice, 2026-09-06

Worktree: `C:/Users/kaitp/source/repos/Pe.Tools-ff-normalize`, branch `family/normalize`, baseline `d2e19ce15ec9092018f1c37cfc529c97e8349cd3`.

**OPEN: trustworthy bulk normalization is not complete.** This slice repairs explicit-value merging and the processor's commit boundary. It compiles and passes the year-neutral contract checks. No Revit runtime case ran. Ranked migration, shared-definition resolution, identity correction, and association transfer still block production acceptance.

## Census and retained behavior

The external census was a locator, not authority. Current source confirms these paths:

| Path | Finding |
|---|---|
| `source/Pe.Revit.FamilyFoundry/Reconcile/FamilyReconciler.cs:65` | Patch desired state merges onto capture. Previously captured per-type cells overrode an explicit uniform value. Previously unrelated invalid captured geometry could fail validation before parameter work. |
| `source/Pe.Revit.FamilyFoundry/Reconcile/FamilyReconciler.cs:282` | Lowering still calls `AddParams` without `sharedSource`. Missing shared parameters therefore fail. No claim of shared-add support through this front door. |
| `source/Pe.Revit.FamilyFoundry/Operations/ParamOps.cs:29` | `AddParams` has the source delegate, but the reconciler does not supply it. `SetParamMetadata` changes scope/group/local tooltip; it does not implement shared/local or data-type replacement. |
| `source/Pe.Revit.FamilyFoundry/OperationSettings/MapParamsSettings.cs:44` | Retained source ranking uses populated-type counts, value-signature deduplication, and authored order for ties. These helpers are not wired into new lowering. |
| `source/Pe.Revit.FamilyFoundry/Operations/MapReplaceParams.cs:80` | Retained native replacement and coercion flow. Its catch still dereferences the old parameter after replacement at lines 98 and 103. This stability repair remains open. |
| `source/Pe.Revit/Extensions/FamParameter/GetAssociated.cs:77` | `HasDirectAssociation` treats a parameter id as an element id and rejects negative ids. This does not establish safe removal of built-in element-parameter associations. Association transfer/removal remains open. |
| `source/Pe.Revit.FamilyFoundry/Operations/ParamOps.cs:8` and `source/Pe.Revit.FamilyFoundry/Reconcile/FamilyReconciler.cs:140` | `wasNamed` selects the first existing name and lowers to native rename. Desired type keys/formula references are not remapped. Existing-destination precedence, ranked fallback and safe source deletion are not implemented by this rename path. |

No mapping, coercion, purge, geometry operation, or existing test was deleted. No `Compile Remove` was added. The old harness at `b578789` is preserved as raw evidence in `b578789-bulk-harness.cs.txt`. The new harness is a cleanroom acceptance slice, **not coverage-equivalent restoration of its 1,118 lines**.

### Exact shared identity and tooltip loss

`source/Pe.Revit.FamilyFoundry/Capture/FamilyModelParameterProjection.cs:30` reads `Definition.Identity.SharedGuid` only to derive a boolean. Its initializer at line 41 emits no GUID and no tooltip. `source/Pe.Shared.RevitData/Families/FamilyModelContracts.cs:205` has a nullable shared flag but no GUID field. Thus two same-name shared definitions with different GUIDs are indistinguishable in the current diff. Local tooltip writes at `Operations/ParamOps.cs:65` cannot converge through this capture because tooltip is not emitted. Shared datatype/tooltip are forbidden by `FamilyModelValidator.cs:67`. These losses were identified, not repaired in this slice.

### Company inputs

Read-only anchors under `C:/Users/kaitp/OneDrive/Documents/Pe.Tools/settings/`:

- `CmdFFMigrator/profiles/MechEquip/BASE.json` uses existing includes for shared names and mapping data, APS-name filters, cleanup and sorting.
- `CmdFFMigrator/profiles/PlumbEquip/P.json:51` supplies ranked candidate names; lines 58 and 67 repeat `PE_G_Perf_FluidFlowDesign` with different candidates. Its later assignments specify electrical formulas and `XP-#`, and request an electrical connector. Conversion must retain these behaviors and resolve duplicate-target rules explicitly.
- `CmdFFManager/profiles/SavedEquip/Constrained Box.json:39` uses `OverrideExistingValues: true` and explicit formulas. All 14 SavedEquip files are inventoried.

`original-profile-hashes.json` records SHA-256 for 45 files across the migrator tree and SavedEquip. Originals were only read. No conversion is certified. The ignored main-tree `Old_Template.rvt` was not opened or changed. A future corpus test must copy it into its disposable run directory before opening it; this slice's runtime tests create disposable documents instead.

## Changed contracts and root repair

1. `FamilyPatch.Apply` now removes inherited cells when a uniform value or formula is authored, and removes an inherited opposite formula/value. Explicit per-type overrides remain authoritative. Unmentioned parameters and cells remain unchanged. Source: `source/Pe.Shared.RevitData/Families/FamilyPatch.cs:44`. Existing `OverrideExistingValues` stays intact for direct operation callers; the reconciler's explicit assignments use its existing true default.
2. `ReconcileFamily(FamilyModel)` now merges specified state onto current capture instead of interpreting omission as deletion. Explicit null deletion remains available through `FamilyPatch`. Unchanged baseline validation defects in unmentioned sections do not block a parameter patch. New defects and defects in explicitly authored sections still fail. Sources: `Reconcile/ReconcileFamily.cs:59`, `Reconcile/FamilyReconciler.cs:65` under `source/Pe.Revit.FamilyFoundry/`.
3. The patch constructor adds optional `expectedPlanHash`. The bridge supplies it before queue execution. The hash now includes current capture and run rules as well as changes, so a changed baseline or run policy invalidates the plan. Existing hashes must be replanned. Sources: `ReconcileFamily.cs:29`, `ReconcileFamily.cs:72`, `FamilyReconciler.cs:254`, `source/Pe.App/Host/FamilyFoundryBridgeOps.cs:67`.
4. Requested unverifiable changes, operation errors, pending entries, or remaining residue prevent successful reconciliation. Outcomes use residue instead of suffix-matching log names. The processor publishes a candidate receipt only after the family visit and required project load finish. Failed finalization marks outcomes unsuccessful and retains the planned differences as outstanding work; these are not a fresh post-rollback capture. Sources: `ReconcileFamily.cs:44`, `ReconcileFamily.cs:79`, `OperationProcessor.cs:187`, `OperationProcessor.cs:235`.
5. `FamilyVisit.InPlace` owns a group across all edits, or a subtransaction when the caller already holds a transaction. A later callback failure rolls back earlier edits in that visit. `FamilyVisit.Run` wraps project load and verification in a project transaction group. Every owned edit checks commit status. Errors request rollback rather than deletion/detachment resolution. Sources: `source/Pe.Revit/Extensions/FamDocument/FamilyVisit.cs:70`, `:116`, `:166`, `:189`.
6. `FamilyVisit.Run` adds optional `afterEdits` for existing explicit save behavior after family edit transactions close. Apply's default options do not save. Explicit save/export remains a separate filesystem effect: files already written cannot be undone by Revit rollback. No claim of atomic filesystem export is made.
7. Visits no longer create an unrequested default type before preflight. The reusable `EnsureDefaultType` primitive remains available for callers explicitly creating a default. A caller-held parent transaction is not a committed receipt: `FamilyVisitResult.Verified` and processor convergence remain false until ownership can establish the outer commit. No outer-commit callback API is introduced here.

No JSON policy field, provenance metadata, dependency, TS composition, MAP, or LEDGER change was added. The proposed blank-fill field is **not shipped**. Routes must not emit an invented field yet.

## Validation

All commands ran from this worktree. Raw output is under `.artifacts/runs/fresh-20260906-ff/`; the requested directory name does not imply fresh-runtime proof.

| Lane | Exact command | Result |
|---|---|---|
| compile | `dotnet build source/Pe.Revit.Tests/Pe.Revit.Tests.csproj -c Debug.R25 -v minimal` | Exit 0; final output 55 warnings, 0 errors. `compile-final.log`. Includes app, Family Foundry, shared primitives and the new harness. |
| deterministic plan | `dotnet tool run pe-revit -- test --plan --project source/Pe.Shared.Tests/Pe.Shared.Tests.csproj --json` | Exit 0; SDK chose deterministic because the package is year-neutral. `deterministic-plan.json`. |
| deterministic | `dotnet tool run pe-revit -- test --project source/Pe.Shared.Tests/Pe.Shared.Tests.csproj --filter FullyQualifiedName~FamilyModelContractTests --json` | Exit 0; 56 passed, 0 failed, 0 skipped. `deterministic.json`. |
| source hygiene | `git diff --check` | Exit 0. |

SDK binary: `pe.revit.cli/0.1.0-beta.150`, SHA-256 `4D23791A6C273158A4E64D5361F79D2A04C575C25BA202D1381D54CF43563457`. No raw Revit-backed `dotnet test`, session launch, user-document operation, or runtime refresh ran.

## Runtime owner's acceptance cases

The compiled `source/Pe.Revit.Tests/LibraryBehavior/FamilyFoundry/FamilyFoundryBulkMigrationHarnessTests.cs` contains six cases:

- Explicit uniform width writes across two types, preservation of an unmentioned text parameter, and unchanged document path, line 38.
- Late dependent failure with both single and multiple edit transactions; original widths and unsuccessful receipt, line 58, two cases.
- Caller-owned transaction does not publish committed convergence; caller rollback restores original widths, line 72.
- Stale hash fails before parameter mutation, line 89.
- Two project families: failed family remains original after attempted migration; next family loads successfully; per-family receipts are false then true, line 103.

Runtime owner should run SDK `test --plan` and then `test` on `source/Pe.Revit.Tests/Pe.Revit.Tests.csproj` with filter `FullyQualifiedName~FamilyFoundryBulkMigrationHarnessTests`, in a fresh controlled runtime. This owner did not run either Revit-backed command. Verify native transaction-group and load behavior before accepting the atomicity claim.

Required cases still to implement or retarget from the old harness:

- Native commit rollback, unresolved failure and failed project load after valid parameter changes; no stale success receipt. Check the restored project family, not just the edited temporary family.
- Existing destination wins; opt-in fill only its blank cells from ranked sources; explicit JSON values/formulas win with either flag value. Include duplicate candidates and ties from the real plumbing profile.
- Same-name wrong shared GUID, local/shared conversion, exact datatype/group/scope/GUID/tooltip readback, source unavailable and ambiguous definitions.
- Strict and storage coercion, text to Number/Length/Voltage/Current, Integer/YesNo, blank fallback, formula unwrapping, global/per-type values and invalid-number failure. The old harness's end-state assertions are at `b578789:.../FamilyFoundryBulkMigrationHarnessTests.cs:826` and `:885`.
- Linear/angular/radial dimensions, arrays, nested element-parameter and connector associations survive replacement; formula references and type keys follow rename; unsafe source removal rolls the whole family back.
- Param-only migration on real families with unmodeled geometry, and required connectors/room point failing after parameter edits. No unsupported requested work may be silently skipped.
- Real Old_Template sample/all/partitioned migrations on disposable copies, and behavior-equivalent conversion of company profiles plus all 14 SavedEquip inputs. Retained fixtures/helpers are not proof of this conversion.
- Empty or unnamed type handling, direct scripts/Pods with caller-owned transactions, explicit full-model normalization omission, and plan hash stability across capture/type traversal order.

## Open UX and contract questions for routes

The user's precedence rules are settled. The remaining design work is how to express source fallback with the existing authored contract: one optional blank-fill control, no override knob that weakens explicit state, and no historical-creator inference. `wasNamed` currently means first-name rename and is insufficient for ranked bulk migration. Do not convert company mappings to it as though behavior were equivalent.

Expose committed failure separately from a staged caller-transaction result. Show failed families alongside successful families, and require replanning after hash drift. Keep required connector/room-point failures visible. Shared identity/tooltip readback and complete legacy-harness restoration remain release blockers, not optional cleanup.
