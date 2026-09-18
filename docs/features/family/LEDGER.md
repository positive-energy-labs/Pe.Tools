# Family Foundry ledger

Recentered 2026-09-08 from the operator stories, source history, and native tests. Git before this rewrite retains the old run narratives. Current investigation: [MAP.md](MAP.md).

## Decided

- 2026-09-18: The `family.editor.*` ops are gone. `family.editor.snapshot` is deleted: `family.capture` reads parameters, per-type values, formulas and shared identity, and no live consumer needed the snapshot's read-only flag, current type or display strings. `family.editor.open` is renamed `family.open` with the same behavior; `/families` calls it to open a loaded family for edit. The user ruled "prob delete all family editor stuff, or rename". Protocol 44 and 45. Proof: source compile and web typecheck against a locally regenerated catalog.
- 2026-09-18: `family.editor.apply` is deleted. It was a third door that wrote per-type values and formulas with no evidence and committed partial success. Family writes are FamilyPatch plan/apply (`family.*`, `families.*`); scripts use the library in process. Its gotcha 18 guard moved into the family model validator (`value-names-parameter`). Ruled by domains-opus as settled direction (agents propose, users approve); the user can reopen it. Proof: pure, red then green.
- 2026-09-18: `PreviewFamily` and `ReconcileFamily` share one `FamilyPreparation.Prepare`. Apply stays an operation in `OperationProcessor`, because the queue owns the transaction, single versus bulk, and cancellation. There is no `ApplyFamily` twin. Proof: native attached family-document lane, 4/4 on the refusal and formula scenarios.
- 2026-09-18: A formula that the destination refuses aborts the whole parameter transfer (`NormalizeParameter.cs`). It is never dropped silently. Proof: fresh R25, red 2/1 then green 3/3. Consequence: the Old_template company migration now refuses families that used to lose formulas.
- 2026-09-18: Lookup tables reconcile by meaning (`FamilyLookupTableCsv.Same`): exact header and row names in order, numeric cells as numbers, text cells as text. Revit export rewrites CRLF and six-decimal numbers, so text comparison never converged. Proof: native `FamilyLookupTableDiffTests` red 2/5 then green 5/5, and the a-box roundtrip passes.
- 2026-09-18: A same-name family-to-shared identity change keeps per-type values, formulas, dimension labels, visibility, array labels, nested associations and lookup references. Proof: native `SameNameSharedReplacementTests`, hop 1.
- 2026-09-18: After an identity-only source migration, the residue baseline stays the pre-migration intent (`FamilyPlan.IsIdentityOnlyMigration`), so a native drop refuses instead of converging. Native did not trigger it; it stays as a guard.
- 2026-09-18: An identity change of a shared parameter that drives grouped or arrayed elements refuses in preview and apply alike (`identity-change-through-group`). Revit refuses it at commit ("Changes to groups are allowed only in group edit mode"). Group edit mode is not implemented. The Revit refusal is native-proven; the preview-side agreement is compile-only until the next native run.

- 2026-09-15: Family build uses any bound document as execution context; only capture, plan, and apply require a family document. Author-facing placement labels map at the shared JSON contract (`Unhosted` → `OneLevelBased`, `FaceHosted` → `WorkPlaneBased`, `WallHosted` → `OneLevelBasedHosted`) and serialize back to Revit placement tokens.
- 2026-09-13: Unacknowledged Family input belongs to its exact file Work and survives pane unmounts. Writes serialize against accepted server revisions; refusals retain input and require explicit retry. This buffer survives only the current browser runtime.

- 2026-09-08 — Bulk normalization is the first story: impose a company parameter standard across loaded families while retaining per-type values, formulas, and native bindings.
- 2026-09-08 — Portability is the second story: carry BIM behavior across Revit years, documents, and users. Connector pose, room points, hosting, and orientation are mandatory; arbitrary visual geometry is optional.
- 2026-09-08 — Every normalization independent of individual geometry must also be available to migration, including room calculation and electrical parameter associations.
- 2026-09-08 — ExtensibleStorage is banned. Other roundtrip metadata needs a concrete, large benefit from a small datum; never use metadata to hide missing capture.
- 2026-09-08 — Preserve formulas as formulas unless the user expressly replaces or unsets them. Equal values today do not prove preserved behavior.
- 2026-09-08 — Fail an individual family atomically when required preservation fails; a batch may finish other families and report separate outcomes.
- 2026-09-08 — Parameters Service is authoritative for company definitions. A frozen fixture must identify its source and reject drift, including archived identities and duplicate active names.
- 2026-09-08 — Keep one native mutation authority. Do not restore the Desired Migrator compiler and parallel profile execution paths.
- 2026-09-08 — Tests at the public family seam and realistic fixtures carry the executable specification. Source inspection, compiled code, and native readback are distinct evidence.

## Tried & rejected

- 2026-09-08 — Native RFA distribution alone is smaller but does not express reconstruction across Revit years; it cannot replace the portability story.
- 2026-09-08 — A successful model diff alone cannot prove preservation of uncaptured connector orientation, hosting, room-point coordinates, or formulas lost before the new baseline.
- 2026-09-08 — A dependency graph with no current runtime caller is not automatically waste: retained user history explicitly requires dependency planning; preserve or complete that purpose before deletion.
- 2026-09-08 — Old agent reports are investigation leads, not proof. Two swarm claims were withdrawn after tracing archive metadata and coverage refusal.
- 2026-08-17 — Whole-view image tightness is not a portability gate: template annotations affect framing. Revisit crop manipulation only for a separate view-export requirement.
- 2026-08-16 — An absent per-type override is not an empty resolved value; family-table cells must retain that distinction.

## Owed

- At Family engine acceptance, port focused parameter plan capture with `DecisionFingerprint` (`7cc0706`) and exact electrical-connector plan identity that refuses approximate references (`881d393`, `a6ce060`) onto the `ba200ee` model. The behavior is preserved at local ref `refs/archive/wt-sweep-20260915/branch/family/electrical-connector-plan-capture`; compile passed there, but its prepared native tests never ran.
- Prove natively that an `EditFamily` copy has an empty `PathName` and a `Title` equal to `{family.Name}.rfa`; the `HandleFamilyCopyFailures` document predicate depends on this identity.
- Browser build reached durable action `f5b9f390-70aa-44c6-8ca6-2ff868e55ab1`; its exact SDK receipt proves a terminal 400 placement-parse failure, but beta.160 did not type that failure as pre-dispatch, so recovery conservatively retains `unknown`. Do not submit another build ID until a human explicitly retires that recovered uncertainty. Native build/open/rebind/plan/apply/re-plan acceptance therefore remains open.
- Browser acceptance for Family delayed edits, pane remount, save and conflict recovery remains open. Shared-head summaries must use authored Settings Work, not the empty Family Work document.

- Express company-standard closure separately from overlay patches, including the disposition of required nonstandard drivers.
- Prevent deleted type cells from becoming silent convergence; prove refusal or preservation through a public native scenario.
- Old_template migration: count and classify the formula-transfer refusals natively, then get a user decision: refuse the family, or keep values and record the dropped formula on the receipt.
- User decision: support an identity change through grouped or arrayed associations with group edit mode, or keep the refusal. Prove first that the array label alone triggers the Revit refusal.
- Prove natively the shared-to-family same-name replacement (temporary name, then `RenameParameter`) and the three-hop preservation without the array.
- Browser acceptance on the project-a cloud model for the identity change, lookup convergence and formula refusal from `/families`.
- Express and verify mandatory connector pose, hosting, and room-point state independently of optional geometry reconstruction.
- Broaden the bulk corpus assertions to all required preservation facts; complete portability proof across years, including save/reopen, no-op reapply, rollback and native readback.
- Settle the PVFY unbalanced two-pole connector policy; the composed-profile test still excludes it. A resolved native constraint receipt is not a general preservation proof.
- Diagnose FV-0511VK2 constraint rollback when cleanup removes planes; it remains excluded from the composed-profile test.
- Retire the test-facing legacy profile converter after replacing its frozen-profile job with a canonical fixture; simplify the operation stack only behind equivalent scenario coverage.
