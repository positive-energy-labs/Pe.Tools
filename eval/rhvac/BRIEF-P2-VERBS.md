# Mission: phase-5 P2 — complete the resolution verb set (reject + merge)

Execute P2 of eval/rhvac/PHASE5-EDITABILITY-PLAN.md (read fully; it grounds every file).
Sidecar v2 anchors (P1) are committed — build on that. One deviation from the plan: the
`META residue` lane does not exist (that detector change was reverted), so `reject`
conservation lives in the SIDECAR: a rejected room's record retains its anchor + the room
stays renderable from the takeoff TSV (grayed), so nothing is silently lost. Do NOT touch
the detector.

## Scope
1. Schema: `action` literal gains `"reject"` and `"merge"`
   (packages/host-contracts/src/operation-types.ts:659 area); merge params
   `{ other: candidateKey }` with its own anchor for the merge target. Host op unchanged
   otherwise; regenerate whatever the typegen flow requires (check pnpm typegen scripts).
2. Apply mirrors (TS resolutions.ts + C# RhvacCandidateBuilder.ApplyResolutions):
   - `reject`: room excluded from the applied result (C#: excluded from export). TS apply
     marks it `rejected` so the UI can gray it rather than delete it.
   - `merge`: union the room's polygon into the target (survivor = the `other` key's room;
     `mergedFrom` provenance like splitShape's `splitFrom`). Anchor re-key applies to both
     keys; orphan if either is unresolvable.
   - Loss accounting {applied, remapped, orphaned} covers the new verbs.
3. UI (functional, not polished — taste pass comes later): FlagQueue rows gain a reject
   button; merge = click flag row -> "merge into..." -> click neighbor polygon (reuse the
   split two-click plumbing in plan-pane.tsx). Rejected rooms render gray at low opacity.
4. Mirror tests: extend the shared fixture (eval/rhvac/fixtures/) so TS and C# assert
   identical outcomes for all four verbs + anchors + orphans. A scripted project-a Main
   sidecar with >= 1 accept, split, merge, reject must round-trip through
   RhvacCandidateBuilder.ParseTsvDirectory with the expected room count and areas.

## Gates
- Web suite green (run `pnpm exec vp test` in apps/web — 86 baseline), host suite green
  (46 baseline), C# filter "RhvacCandidateBuilderTests|RhvacEvalTests|TakeoffReplayTests"
  green. Report counts.
- Deterministic sidecar serialization unchanged (no timestamps, stable sort).
- v1 and v2-without-new-verbs sidecars still parse (compat asserted in tests).
- score-takeoff.py --resolutions understands reject/merge (python apply mirror) and its
  RESOLUTIONS block counts them; a smoke run on project-a with a 4-verb sidecar reported.

Results to eval/rhvac/RESULTS-P2-VERBS.md. Stage, do not commit. Work autonomously; do
not ask questions.
