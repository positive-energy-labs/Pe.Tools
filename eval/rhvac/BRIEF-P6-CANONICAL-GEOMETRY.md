# Mission brief — P6: route shows canonical geometry (web)

## Context

Decision (user, 2026-08-07): Revit is the geometry editor; the /rhvac route is a metadata /
merge-resolve / visibility surface. It must therefore display the **canonical TSV geometry** —
the exact polygons the Revit lane materializes (`RoomTakeoff.LoadMaterializationResult` parses
with `simplify: false`). Today the web viewer beautifies each room independently
(`parseTakeoffTsv` defaults `simplify: true` at `apps/web/src/host/rhvac.ts:102` and
`apps/web/src/rhvac/fixture.ts:49`), so the browser and Revit have never shown the same
polygons, and per-room simplification cannot preserve shared edges between neighbors. Raw
jagged shapes are honest: they are exactly the rooms a human must straighten in Revit.

Read first: `apps/web/src/rhvac/takeoff.ts`, `apps/web/src/rhvac/plan-pane.tsx` (styling +
legend), `apps/web/src/rhvac/types.ts` (STATE_FLAG_KINDS), `apps/web/src/rhvac/takeoff.test.ts`.
All paths relative to `source/pe-tools/`.

## Scope

1. **Delete display simplification.** Remove the `simplify` option from `parseTakeoffTsv` —
   parsing returns vertices verbatim, always. Delete the now-dead simplification code from
   `takeoff.ts` (`deriveGridPitch`, `simplifyLevelLoops`, `simplifyShape`, `simplifyOnce`,
   `simplifyChain`, `collapseCollinear`, plus helpers that become unused) and their tests.
   First verify nothing else in production web code imports them; if something does, stop and
   write why in the results file instead of forcing it.
2. **Unresolved-evidence styling.** In `plan-pane.tsx`, rooms carrying the `unregularized`
   state flag render as unresolved evidence, distinct from both finished rooms and
   decision-flagged rooms: solid hairline stroke in `var(--muted-foreground)` (NO dash — dash
   means pending decision), fill at roughly half the opacity of finished rooms. They stay out
   of the decision queue (unchanged behavior). Add a legend chip, e.g. label
   `raw shape — straighten in Revit`. `ruled-seam` stays unstyled. Decision-flag (clay dashed),
   rejected, and residue styling all unchanged.
3. **Tests.** Update `takeoff.test.ts`: delete simplification tests; add one asserting
   `parseTakeoffTsv` returns POLY vertices verbatim (count + first/last coordinates). Keep the
   parser-leniency tests.
4. Update the mirror-of-C# header comment in `takeoff.ts` to say the canonical parse contract
   is verbatim geometry (the C# simplifier is an r10-export concern, being moved in a parallel
   mission — do not reference exact C# file paths that may be mid-move).

## Binding gates

- `pnpm exec vp test` green in `apps/web` AND `apps/host` — report exact pass counts.
- `grep -r "simplify" apps/web/src/rhvac apps/web/src/host` returns no production hits.
- No file outside `source/pe-tools/apps/web` is modified.
- Fixture demo still loads: the project-a fixture button path parses without error (covered by
  existing fixture tests).

If a gate is unreachable, stop at the best honest point and write the tradeoff/census in
`eval/rhvac/RESULTS-P6-CANONICAL-GEOMETRY.md`. Write that results file either way (what
changed, test counts, LOC delta).

Stage your changes; do not commit. Work autonomously; do not ask questions.
