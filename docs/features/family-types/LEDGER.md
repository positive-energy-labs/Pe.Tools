# family-types ledger

| # | Status | Item |
|---|--------|------|
| 1 | open | Pre-existing formatting failures in `vp check`: thread-palette.tsx, chat.tsx, Lens.tsx (committed code, not this workstream) |
| 2 | open | Upload UI triplicated (PdfPane, GroundedDocView, family-sheet route) — extract shared component when /family-types absorbs upload |
| 3 | open | `/family-audit`, `/family-doc`, `/doc-lab` POC routes left in place; purge/absorb decision after /family-types ships |
| 4 | open | `pdf-audit/` vs `grounded-doc/` overlapping stacks; consolidate after /family-types picks its dependencies |
| 5 | open | Multi-level nested-family ancestry (EditFamily traversal) — no precedent in FF, deferred; snapshot is one level deep |
| 6 | open | No add/remove parameter or add/rename type host ops — FamilyFoundry machinery not bridged; editor is value+formula only this pass |
| 7 | open | changedKeys per-key state fan-out unused; upgrade only when full-map rebroadcast measurably hurts |
| 8 | open | Mixed-ownership dirty files (RevitBridgeOps.cs, RevitDataRequestService.cs, host-ops.generated.ts) carry other agents' uncommitted work — additive edits only, flag at commit |
| 9 | open | `/api/pdf-audit/*` server routes are dev-lane only (installed build = static SPA, no SSR) — installed-lane story for OCR undecided |
| 10 | open | parse-cache is in-memory, 8 entries, dies with dev server — persistence undecided |
| 11 | open | Memory file doc-lab-ux-pocs names routes (/lab-loupe,/lab-focal,/lab-sweep) that don't exist — update memory |
| 12 | done | family-sheet tools' stale `PE_WEB_URL` default 3010 → new parse_spec handler uses `PE_WEB_URL ?? http://localhost:3000` (Wave 1A) |
| 17 | open | Wave 1A swapped 6 `family_sheet_*` tools for 3 `route_state_read`/`route_state_apply`/`route_command` — tool-catalog snapshot tests `apps/pea/tests/index.test.ts:48-66` and `apps/pe-code/tests/index.test.ts:30-40` still assert the old six ids and now FAIL; update those lists (out of Wave 1A fence: packages only) |
| 18 | open | Wave 1A: command-handler ctx (`getDoc`/`setDoc`) is a non-atomic read-modify-write, unlike `applyRouteStatePatches` which uses the session's serialized `update` transaction. Fine for the human-triggered/single-session commands today; revisit if commands ever race browser writes |
| 13 | done | Orchestrator mis-grounded "FF" to the old PE_Tools repo; user steer corrected to in-repo Pe.Revit.FamilyFoundry — GROUNDING-REVIT demoted to API-lore-only, GROUNDING-LANGUAGE added |
| 14 | open | `FamilyEditorParameterSnapshot` still carries flat name-only fields (StorageType/DataType/Group as loose strings) alongside the new canonical `Identity` — full convergence to `ParameterDefinitionDescriptor`/`FamilyParameterSnapshot` deferred (Wave 1B was additive-alignment only, per GROUNDING-LANGUAGE) |
| 15 | open | `family.editor.apply` dryRun requires a live transaction to validate formulas/CurrentType, so read-only rejection is gated on `!DryRun` per the ParameterValueApplier precedent — but dryRun on a genuinely read-only family doc will fail at transaction start rather than returning a clean per-edit result. Realistic use is dryRun against the open writable family; revisit if read-only preview is ever needed |
| 16 | open | Family editor dryRun captures only synchronous per-edit validation (SetFormula/SetValueString throw immediately); deferred regeneration/commit-time failures are not surfaced because the transaction rolls back without committing (the FailuresPreprocessor only runs on commit) |
