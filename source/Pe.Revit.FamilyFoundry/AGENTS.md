# Pe.Revit.FamilyFoundry

## Scope

Owns the Revit-side family reconciler: capture a live family document as a `FamilyModel`, diff it against a
desired model, lower the differences to an `OperationQueue`, apply that queue inside one `FamilyVisit`, and write
a `FamilyReceipt`. The portable contracts themselves (`FamilyModel`, `FamilyPatch`) live in
`source/Pe.Shared.RevitData/Families/`, which holds no Revit assembly reference.

## Purpose

One capability, one path. `ReconcileFamily` is the only `DocOperation` a caller needs: build from template, bulk
patch and normalize are that operation with three inputs. Everything under `Operations/` is the execution layer the
reconciler lowers to; scripts and Pods may call those verbs directly, but they are not a second front door.

## Critical Entry Points

- `Reconcile/ReconcileFamily.cs` — the one `DocOperation`. Capture current, resolve the patch to a desired
  `FamilyModel`, `Reconcile` to a `FamilyPlan`, run the lowered queue, capture again, diff for residue, publish
  `LastPlan` / `LastReceipt`. Non-empty residue throws; the caller's transaction rolls the family back whole.
- `Reconcile/FamilyReconciler.cs` — pure, no `Document`. `Desired` merges a patch onto the capture; `Diff` is the
  one comparison (identity rules are on its doc-comment); `Reconcile` wraps `Diff` plus `Lower` and hashes the plan.
- `Capture/FamilyModelCaptureExtensions.cs` — `Document.CaptureFamilyModel()`, the capture both sides of a diff use.
- `Pe.Revit/Extensions/FamDocument/FamilyVisit.cs` — EditFamily, transaction discipline, LoadFamily, post-verify.
  It is a `Pe.Revit` seam with no FF dependency, so Pods call it directly.
- `OperationProcessor.cs`, `OperationQueue.cs`, `BaseOperation.cs` — queue execution across family and project
  documents, and the operation model the reconciler lowers into.
- `Operations/`, `OperationGroups/` — the ops library: the verbs `FamilyReconciler.Lower` emits and scripts reuse.
- `Apply/FamilyModelBuild.cs` — build a new family document from a template plus a `FamilyModel`.
- `ProcessingResultBuilder.cs` — the run and per-family artifact writer (`run-summary.json`, `family-report.json`,
  `plan.json`, `receipt.json`).
- `FamilyModelSettingsRegistration.cs`, `SchemaDefinitions/FamilyFoundrySchemaDefinitions.cs` — the `FamilyFoundry`
  settings module (`models`, `patches` roots), its validators, and the value domains its schema exposes.

## Validation

- `pe-revit test` is the ONLY Revit surface. Everything under `Pe.Revit.Tests` boots Revit, including the pure
  reconciler tests; never run `dotnet test` against it. `Pe.Shared.Tests` covers the portable contracts with no Revit.
- Compile is a proof of shape, not of behavior. Say which lane carried a claim: source compile, deterministic test,
  attached `pe-revit test`, or a named live session.
- The `FamilyReceipt` is the convergence evidence. `Residue.Count == 0` is the definition of converged; `Outcomes`
  says what each planned change did, `Unmodeled` says what capture could not express, and `PlanHash` says the plan
  did not drift between plan and apply. Compare receipts before and after a change.
- `snapshot-diff.json` is NOT proof. Its `Post` side is populated only by a collector lane that every product caller
  passes null, so it reads as structurally half-null. Deleting it is owed work.
- Debugging ladder: `run-summary.json` → `family-report.json` → `receipt.json` and `plan.json` → `logs-detailed.json`.
- A change in a section capture did not fully read is `Unverifiable` by construction; check `Coverage` before
  believing a clean diff.

## Shared Language

| Term | Meaning | Prefer / Avoid |
| --- | --- | --- |
| **model** | `FamilyModel`, the ONE portable profile (family.json). Capture emits it and an author writes it | Avoid "snapshot" and "profile" for it; both name retired shapes |
| **patch** | `FamilyPatch`, the `{ select, patch, run }` fragment. Omit = unchanged, null = delete, `{}` = ensure | Avoid calling a patch a partial model; the merge onto the capture is what makes it one |
| **reconcile** | `FamilyReconciler.Reconcile`: `Diff` desired against current, then `Lower` to an `OperationQueue` | Avoid "apply"; apply is running the lowered queue, not deciding what to run |
| **plan** | `FamilyPlan`: changes, queue, refusals, run effects, `PlanHash` | Non-empty `Refusals` means an EMPTY queue; a refused plan is not a partial plan |
| **receipt** | `FamilyReceipt` for one family, published on `ReconcileFamily.LastReceipt` | The proof packet. Prefer it over logs whenever both could carry the claim |
| **residue** | `Diff(desired, capture-after-apply)`. Empty residue is convergence | Avoid "remaining changes"; residue is measured after the fact, never predicted |
| **unmodeled** | `FamilyModelUnmodeledFact`, the ledger of what is INEXPRESSIBLE, with a closed reason enum | Honesty over completeness. The compiler refuses to apply unmodeled facts; never persist state to hide one |
| **coverage** | `CoverageState` per section: whether capture READ it at all | A different fact from unmodeled. Absent after capture means `NotRead`, not "empty" |
| **operation** | One runtime mutation unit under `Operations/`; a group is an ordered set of them | Avoid calling a whole workflow one operation when the queue distinction matters |
| **visit** | One `FamilyVisit`: EditFamily → edits → LoadFamily → verify, as one transaction group | Avoid describing the inner queue as transactional; it opens no transaction of its own |

## Living Memory

- Keep the reconciler pure. `FamilyReconciler` takes no `Document`; anything needing Revit belongs in
  `ReconcileFamily`, an operation, or a `UnitResolver`.
- Each family rolls back whole on failure. Partial completion is a property of the batch, never of one family.
- Existing company destinations win source selection. Rewire source references to the destination, then remove
  the source; a failed transfer rolls the family back.
- Portability permits referenced files and sidecars. ExtensibleStorage is banned; any other roundtrip metadata
  needs a concrete large benefit from a small datum. Never persist data merely to make a test succeed.
- Treat Revit metadata and positional correspondence as untrusted until behavior proves them. Assert across several
  family types so a broken association cannot hide behind one happy path.
- Product rulings live in `docs/features/family/LEDGER.md`; live-proven Revit behavior in that dir's
  `GROUNDING-REVIT.md`. Neither belongs here.
