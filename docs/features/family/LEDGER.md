# Family Foundry ledger

Recentered 2026-09-08 from the operator stories, source history, and native tests. Git before this rewrite retains the old run narratives. Current investigation: [MAP.md](MAP.md).

## Decided

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

- Browser build reached durable action `f5b9f390-70aa-44c6-8ca6-2ff868e55ab1`; its exact SDK receipt proves a terminal 400 placement-parse failure, but beta.160 did not type that failure as pre-dispatch, so recovery conservatively retains `unknown`. Do not submit another build ID until a human explicitly retires that recovered uncertainty. Native build/open/rebind/plan/apply/re-plan acceptance therefore remains open.
- Browser acceptance for Family delayed edits, pane remount, save and conflict recovery remains open. Shared-head summaries must use authored Settings Work, not the empty Family Work document.

- Express company-standard closure separately from overlay patches, including the disposition of required nonstandard drivers.
- Prevent formula-copy failure and deleted type cells from becoming silent convergence; prove refusal or preservation through public native scenarios.
- Express and verify mandatory connector pose, hosting, and room-point state independently of optional geometry reconstruction.
- Broaden the bulk corpus assertions to all required preservation facts; complete portability proof across years, including save/reopen, no-op reapply, rollback and native readback.
- Settle the PVFY unbalanced two-pole connector policy; the composed-profile test still excludes it. A resolved native constraint receipt is not a general preservation proof.
- Diagnose FV-0511VK2 constraint rollback when cleanup removes planes; it remains excluded from the composed-profile test.
- Retire the test-facing legacy profile converter after replacing its frozen-profile job with a canonical fixture; simplify the operation stack only behind equivalent scenario coverage.
