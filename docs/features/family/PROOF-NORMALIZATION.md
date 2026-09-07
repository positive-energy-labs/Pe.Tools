# Normalization proof slice, 2026-09-06

Worktree: `C:/Users/kaitp/source/repos/Pe.Tools-ff-normalize`, branch `family/normalize`, baseline `d2e19ce15ec9092018f1c37cfc529c97e8349cd3`.

## Second slice authored API

The parameter object keeps `shared`, `dataType`, `propertiesGroup`, `isInstance`, `tooltip`, `value`, `formula`, and `wasNamed`. It adds only:

| Field | Meaning |
|---|---|
| `sharedGuid?: Guid` | Exact shared identity, captured on read and checked against the selected active APS definition on explicit shared authoring. No creator/provenance metadata. |
| `fillBlanksFromSources?: bool` | Default false. If the destination existed, optionally fill only blank cells from ranked `wasNamed` candidates. Existing populated destination cells win. |
| `mappingStrategy?: string` | Existing SetValue strategy name, default `CoerceByStorageType`; retains company coercion vocabulary. |

`wasNamed` supplies explicit source candidates. Ranking reuses `MapParamsSettings.GetRankedCurrParams`, including populated-type counts and authored-order tie breaking. Explicit JSON values/formulas run after source migration and always win. Missing destinations are created even without a matching source. Shared definitions resolve by exact name from the existing active APS cache, with missing/ambiguous entries refused, and native definitions use the existing temporary-file primitive. Safe native replacement consumes a source; fallback copy must retain any source that cannot be safely removed. These fields are implemented in this slice; runtime acceptance remains pending.

**OPEN: trustworthy bulk normalization is not complete.** The first slice repaired explicit-value merging and the processor commit boundary (`86cda03`). The second wires shared definitions, ranked sources and safe replacement. No Revit runtime case ran in this owner's lane. Runtime identity/association proof and company-corpus conversion still block production acceptance.

## Initial census and retained behavior

The external census was a locator, not authority. These are the initial source findings before the repairs below; line anchors in this table refer to that baseline:

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

Captured shared GUID is now emitted by `Capture/FamilyModelParameterProjection.cs` into `FamilyModelParameter.SharedGuid`, compared by the reconciler, and checked against the selected active cached APS definition. Source descriptions are passed unchanged to `ExternalDefinitionCreationOptions.Description` by `SharedParameterBinder.EnsureDefinition`. The frozen four-definition fixture preserves exact Unicode descriptions from the local APS cache, without claiming live APS freshness.

**Tooltip readback remains open.** Capture still emits no local/shared tooltip. Local `FamilyManager.SetDescription` is available, but no matching getter was found in the installed Revit 2025 API XML; `ExternalDefinition.Description` proves the created external definition, not the resulting internal family tooltip. Explicit local tooltip changes therefore cannot yet establish residue-free convergence. Shared datatype/tooltip remain forbidden in authored objects because the shared source owns them. Do not report exact tooltip roundtrip as proven.

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

### Second slice implementation anchors

- `source/Pe.Shared.RevitData/Families/FamilyModelContracts.cs` (`FamilyModelParameter`): `sharedGuid`, `fillBlanksFromSources`, `mappingStrategy` are the exact native JSON names. Nullable blank-fill defaults to false; nullable strategy defaults to existing `CoerceByStorageType`. `wasNamed` remains the candidate list. No `OverrideExistingValues` duplication: explicit state always wins.
- `source/Pe.Revit.FamilyFoundry/Reconcile/FamilySharedParameterSource.cs` (`Resolve`, `GetDefinition`): lazily read existing `parameters-service-cache.json`, require exactly one active exact-name match, validate authored GUID, use existing temporary file and shared binder. Missing/ambiguous sources fail closed. No source refresh or original-file mutation.
- `source/Pe.Revit.FamilyFoundry/Reconcile/ReconcileFamily.cs` (`Execute`): resolve shared identities before hashing; normalize sources inside the family transaction; recapture and replan explicit writes; reject unsupported replans and residue. `FamilyReconciler.Lower` supplies the shared source to `AddParams`. Hash includes resolved desired state, exact authored fragment and selected shared-definition GUID/spec/description/visibility/modifiability/scope/group. `parameters.sources` changes and detailed `normalize.sources` effects expose candidate ranking, blank-fill, coercion and safe cleanup even when ordinary Diff is empty. The planned queue includes `NormalizeParamSources`; Execute runs that planned operation, then recaptures/replans explicit writes. Source outcomes include actual transfer/retention logs and publish only after family commit. The remaining lowered queue is a preview, not an exact native operation replay after migration.
- `source/Pe.Revit.FamilyFoundry/Operations/NormalizeParamSources.cs` (`Execute`): reuse existing populated-type ranking and SetValue coercion. Existing destination wins. Missing destination uses native same-spec replacement when safe, otherwise add/copy; new numeric zero defaults are overwritten from candidates. Existing numeric zero is populated, not blank. Opt-in only fills existing blank cells. Explicit writes run afterward regardless of the flag. Incompatible existing destination datatype fails safely; cross-spec destination identity replacement is not implemented.
- `source/Pe.Revit/Extensions/FamDocument/NormalizeParameter.cs` (`ReplaceDefinition`, `TryMergeEquivalentParameter`): reusable document primitives use native replacement under subtransactions. Cleanup requires matching datatype/scope/formula/all raw type values, transfers element associations/dimension and array labels/formula dependents, then removes the source. Non-equivalent or separately authored sources remain. Incompatible association transfer fails the whole family. These native operations need runtime proof.
- `source/Pe.Revit/Extensions/FamParameter/GetAssociated.cs`: direct associations inspect their owning elements; dimensions/arrays use real labels instead of invalid element-id/class assumptions. `MapReplaceParams` reuses native replacement and caches the old name before invalidating its handle. Existing coercion/purge operations remain.
- `source/Pe.Revit/Parameters/TempSharedParamFile.cs`: unique task file; restore application shared-file path immediately even if opening fails; disposal deletes only its task file. `SharedParameterBinder.EnsureDefinition` rejects same-name GUID/spec mismatch.
- `source/Pe.Revit/Utils/PeToolsFailureHandling.cs` (`RejectErrors`) and `source/Pe.Revit.Tests/Harness/RevitTestFailureGuard.cs`: the existing FamilyVisit safe failure primitive is shared with the process-wide harness guard. Warnings are reported/dismissed; errors roll back and clear rollback dialogs. No UnlockConstraints/DetachElements/DeleteElements resolution is attempted by this guard. The unrelated product `ResolveFailures` policy is unchanged. Broad behavior tally includes fixture setup/load content-loss prevention, pending runtime proof.

No provenance metadata, dependency, optimizer framework, TS composition, MAP, or LEDGER change was added.

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

The compiled `source/Pe.Revit.Tests/LibraryBehavior/FamilyFoundry/FamilyFoundryBulkMigrationHarnessTests.cs` contains the original six cases plus five source-migration cases:

- Explicit uniform width writes across two types, preservation of an unmentioned text parameter, and unchanged document path, line 38.
- Late dependent failure with both single and multiple edit transactions; original widths and unsuccessful receipt, line 58, two cases.
- Caller-owned transaction does not publish committed convergence; caller rollback restores original widths, line 72.
- Stale hash fails before parameter mutation, line 89.
- Two project families: failed family remains original after attempted migration; next family loads successfully; per-family receipts are false then true, line 103.

- Real cached company Width definition replaces local Width, checking GUID, all type values, source disappearance, external definition description and shared-file path restoration.
- Four combinations of blank-fill and explicit assignment for an existing shared destination with ranked company Model candidates. Populated destination wins, sparse blank falls back to the dense source only when opted in, explicit value wins with either flag, conflicting source remains.

Runtime owner should run SDK `test --plan` and then `test` on `source/Pe.Revit.Tests/Pe.Revit.Tests.csproj` with filter `FullyQualifiedName~FamilyFoundryBulkMigrationHarnessTests`, in a fresh controlled runtime. This owner did not run either Revit-backed command. Verify native transaction-group and load behavior before accepting the atomicity claim.

Required cases still to implement or retarget from the old harness:

- Native commit rollback, unresolved failure and failed project load after valid parameter changes; no stale success receipt. Check the restored project family, not just the edited temporary family.
- Extend compiled destination/blank-fill cases with duplicate candidates, ties from the real plumbing profile, and explicit formulas.
- Same-name wrong shared GUID, local/shared conversion, exact datatype/group/scope/GUID/tooltip readback, source unavailable and ambiguous definitions.
- Strict and storage coercion, text to Number/Length/Voltage/Current, Integer/YesNo, blank fallback, formula unwrapping, global/per-type values and invalid-number failure. The old harness's end-state assertions are at `b578789:.../FamilyFoundryBulkMigrationHarnessTests.cs:826` and `:885`.
- Linear/angular/radial dimensions, arrays, nested element-parameter and connector associations survive replacement; formula references and type keys follow rename; unsafe source removal rolls the whole family back.
- Param-only migration on real families with unmodeled geometry, and required connectors/room point failing after parameter edits. No unsupported requested work may be silently skipped.
- Real Old_Template sample/all/partitioned migrations on disposable copies, and behavior-equivalent conversion of company profiles plus all 14 SavedEquip inputs. Retained fixtures/helpers are not proof of this conversion.
- Empty or unnamed type handling, direct scripts/Pods with caller-owned transactions, explicit full-model normalization omission, and plan hash stability across capture/type traversal order.

## Open UX and contract questions for routes

The precedence rules and native fields above are settled. Routes should show retained conflicting source parameters and missing/ambiguous shared definitions clearly. Company duplicate-target mappings and conditional add settings require behavior-explicit conversion; a source-only instruction must not silently become an explicit declaration or disappear. Full corpus conversion is next, not certified by the four-definition fixture.

Expose committed failure separately from a staged caller-transaction result. Show failed families alongside successful families, and require replanning after hash drift. Keep required connector/room-point failures visible. Shared identity/tooltip readback and complete legacy-harness restoration remain release blockers, not optional cleanup.

## Second slice validation and runtime handoff

Latest commands are the same compile and SDK deterministic commands listed above. Authoritative outputs: `compile-sources-final.log` and `deterministic-sources-final.json`; compile exit 0, 33 warnings, 0 errors; deterministic exit 0, 57 passed, 0 failed, 0 skipped. The added deterministic case checks mapping-field serialization and inherited GUID/type/tooltip clearing on shared/local conversion. Earlier failed compile logs remain as raw evidence, not final results.

Root relayed the separate proof owner's value experiment (the proof report/raw evidence are authoritative; this owner has not inspected them): real Mitsubishi Filter Box, 12 types / 1,881 elements / 44 parameters / five targets; medians baseline 4.868s, source formula 0.924s, temporary selector 4.134s. This owner did not rerun it. It supports treating newly created numeric zero defaults differently from existing destination data; no optimizer was adopted. Exact raw evidence is in the proof owner's `final/value-experiment.json`.

Additional runtime guard acceptance: induce an error with a destructive resolution available during fixture setup/load; require RolledBack, unchanged element/constraint fingerprint, console diagnostics, and no modal. The compiled source-migration cases do not yet exercise every association category or this guard error path. Company profile converter, all 14 SavedEquip behavior, disposable Old_Template migration, and full highest-surface corpus proof remain outstanding.

### Pod feeder and unit-policy boundary

Retargeted the two files from feeder `80fa435` without merging: `Reconcile/RenameParamAcross.cs` and `FamilyRenameAcrossFamiliesTests.cs`. The public Patch keeps only the destination `wasNamed` rule; it no longer null-deletes the source before references move. It reuses the same planned normalization primitive, native replacement and recapture. Retained original unreferenced text case and added a three-family Width case checking loaded family type values, a dependent formula and dimension labels. Both compile; neither ran here. `RenameOutcome.Renamed` additionally requires a committed converged receipt and no error. External pod source was not edited.

Root is settling portable unitless measurable-value policy with the user. No new unit rule is introduced. Explicit-unit fixtures remain; converter must flag ambiguous legacy numeric assignments separately from source-to-target internal value coercion.

## Corpus fixture slice after `03fec88`

`source/Pe.Revit.Tests/Fixtures/Profiles/company-20260906/manifest.json` inventories byte-for-byte copies of all 45 original profiles and seven referenced global fragments, including all 14 SavedEquip. Original SHA-256 values still match the first census. Existing include/preset directives remain intact; no original was converted in place. Two unresolved original preset references remain visible: `CmdFFMigrator/profiles/MechEquip/DH.json` and `CmdFFManager/profiles/SavedEquip/AprilAire E-Series.json` reference `@global/_filter-aps-params/Dehumidifier`, which was not found under the original Global tree.

`source/Pe.Revit.Tests/Harness/CompanyNormalizationFixture.cs` is a **test-only parameter fixture converter**, not a replacement composition engine. It consumes existing `MapParamsSettings` and `SetKnownParamsSettings` after include/filter composition, emits native `FamilyPatch`, and retains candidate order/coercion strategy. Selected shared destinations are explicit state. Duplicate selected targets, conditional source-only creation, conditional assignment, and unitless numeric assignments fail with diagnostics rather than being silently reinterpreted. Global formulas and explicit-unit values/per-type cells map to the existing native fields. Non-parameter sections are preserved in source fixtures and have not been converted; they are not silently considered complete.

The company Width acceptance case now follows copied real mapping fragment ? typed settings ? fixture converter ? ReconcileFamily ? OperationProcessor ? native readback. The full filtered company profile/corpus is **not yet** routed through that highest surface. Production includes/filter composition remains routes-owned; required connectors/room point, geometry, local-definition conversion, duplicate-rule adjudication and conditional profile behavior must still be composed and proven.

Raw `corpus-tally.json` records all 45 profiles' enabled sections and 19 unitless global value assignments requiring datatype/unit review (conservative candidates, not a unit-policy decision). Full per-type numeric review remains required. The missing presets block claiming behavior-equivalent conversion of every original.

Validation from this tree: `dotnet build source/Pe.Revit.Tests/Pe.Revit.Tests.csproj -c Debug.R25 -v minimal` exited 0, 111 warnings, 0 errors (`compile-corpus.log`). SDK deterministic command from the validation table exited 0: 58 passed, 0 failed, 0 skipped (`deterministic-corpus.json`). New deterministic coverage verifies every copied file hash, the 52-file inventory and all 14 SavedEquip, keeping unresolved references explicit. No Revit launched/tested. Next runtime owner cases remain the source/association/rename/rollback cases above, then full composed profile migrations on disposable Old_Template copies.
