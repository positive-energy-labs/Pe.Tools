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
| 12 | open | family-sheet tools' stale `PE_WEB_URL` default 3010 (web dev is 3000) — fix in new tools |
| 13 | done | Orchestrator mis-grounded "FF" to the old PE_Tools repo; user steer corrected to in-repo Pe.Revit.FamilyFoundry — GROUNDING-REVIT demoted to API-lore-only, GROUNDING-LANGUAGE added |
