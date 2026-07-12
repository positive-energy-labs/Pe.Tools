# family-types ledger

Wave 1 telemetry: 1A (TS core) 19min/86 calls — long tail = discovering the server-side session
handle + a three-package fence; 1B (C#) 11min/66 calls — clean fence. Both fact-checked their
briefs and found stale orchestrator claims (unused param in snapshot helper, private
CreateIdentity) — carry verification scope on every brief pointer.

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
| 17 | done | Tool-catalog snapshot tests in apps/pea + apps/pe-code updated to the three route_state ids (orchestrator seam work, committed e235463) |
| 18 | open | Wave 1A: command-handler ctx (`getDoc`/`setDoc`) is a non-atomic read-modify-write, unlike `applyRouteStatePatches` which uses the session's serialized `update` transaction. Fine for the human-triggered/single-session commands today; revisit if commands ever race browser writes |
| 13 | done | Orchestrator mis-grounded "FF" to the old PE_Tools repo; user steer corrected to in-repo Pe.Revit.FamilyFoundry — GROUNDING-REVIT demoted to API-lore-only, GROUNDING-LANGUAGE added |
| 14 | open | `FamilyEditorParameterSnapshot` still carries flat name-only fields (StorageType/DataType/Group as loose strings) alongside the new canonical `Identity` — full convergence to `ParameterDefinitionDescriptor`/`FamilyParameterSnapshot` deferred (Wave 1B was additive-alignment only, per GROUNDING-LANGUAGE) |
| 15 | open | `family.editor.apply` dryRun requires a live transaction to validate formulas/CurrentType, so read-only rejection is gated on `!DryRun` per the ParameterValueApplier precedent — but dryRun on a genuinely read-only family doc will fail at transaction start rather than returning a clean per-edit result. Realistic use is dryRun against the open writable family; revisit if read-only preview is ever needed |
| 16 | open | Family editor dryRun captures only synchronous per-edit validation (SetFormula/SetValueString throw immediately); deferred regeneration/commit-time failures are not surfaced because the transaction rolls back without committing (the FailuresPreprocessor only runs on commit) |
| 19 | open | Wave 2C: `src/lab/mock.ts:3` and `src/lab/kit.tsx:4` doc comments still say `/family-sheet ?mock` — the fixtures now serve `/family-types`. Left untouched (lab/ is read-only reuse); fix the wording next time lab/ is edited |
| 20 | open | Wave 2C: `useRouteState` now writes ONLY via the dispatcher apply/command endpoints (no optimistic local echo); the UI waits for the `state_changed` round-trip. Snappy on a single local host; revisit optimism if echo latency is ever felt |
| 21 | open | Wave 2C: the dispatcher-backed live provider is unverified against a running host (static check + mock lane only) — P5 browser run with host up and the `route:family-types` endpoints mounted is required to prove the read→propose→stage→push loop |
