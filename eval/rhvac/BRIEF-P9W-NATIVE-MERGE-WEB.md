# Mission brief — P9W: route merges native (Revit-edited) geometry over detector geometry (web)

## Context

The prod workflow is: calc draft → resolve intent → draw Spaces/FRs in Revit → human edits
geometry in Revit → **readback**. A C# mission (P9, queued behind P8) will add the readback op:
it reads native `Space.GetBoundarySegments()` for every Space on the takeoff level/phase and
writes a sibling TSV per level, `<level>.native.tsv`, in the standard takeoff TSV format with
one addition: a `META\tsource\tnative` line. Native rooms carry no ambiguity flags; room id =
Space.Number; rooms the human created directly in Revit appear with their Space number as id.

This mission builds the web side against that contract now (fixture-driven — the C# writer
does not exist yet). The route displays native geometry as the finished truth wherever it
exists; detector geometry remains visible only where nothing native supersedes it.

Read first: `apps/web/src/rhvac/takeoff.ts` (post-P6: parse is verbatim, no simplify),
`apps/web/src/rhvac/types.ts`, `apps/web/src/host/rhvac.ts` (:~102, wire.tsvs assembly),
`apps/web/src/rhvac/fixture.ts`, `apps/web/src/rhvac/plan-pane.tsx` (styling + legend
conventions, including the P6 unregularized treatment). All paths relative to
`source/pe-tools/`.

## Scope

1. **Parse.** `parseTakeoffTsv` reads `META\tsource\t<value>`: `TakeoffLevel.source` is
   `"native"` when the line says native, else `"detector"`. Unknown source values throw
   (fail fast — this is our own format).
2. **Merge.** Where both a detector level and a native level share the same META level name,
   merge into one displayed level: rooms present in the native TSV replace same-id detector
   rooms (mark them `native: true` on the room shape); detector rooms with no native
   counterpart stay, keeping their flags/styling (unregularized evidence, decision flags);
   native-only ids (human-drawn) appear as native rooms. Residues always come from the
   detector level. Merge lives in shared code (`takeoff.ts` or a small sibling module), used
   by both the host wire path (`host/rhvac.ts`) and the fixture path.
3. **Styling.** Native rooms read as finished-and-authoritative: the existing matched/
   unmatched (blue/kiln) treatment, plus a slightly stronger stroke than detector rooms.
   Legend chip when any native room is present: label `native — edited in Revit`. Decision
   flags never apply to native rooms (they carry none).
4. **Fixture.** Extend the project-a fixture with a small hand-authored `.native.tsv` for one
   level (a handful of rooms: some ids overlapping detector rooms, one novel id) so the demo
   button exercises the merge visibly.
5. **Tests.** Merge-rule unit tests: native-wins-by-id, detector-remainder-kept,
   native-only-added, residues-from-detector, unknown-source-throws.

## Binding gates

- `pnpm exec vp test` green in `apps/web` AND `apps/host` — report exact counts.
- No file outside `source/pe-tools/apps/web` is modified.
- The merge is pure data logic with unit tests — no styling-only assertions.

If a gate is unreachable, stop at the best honest point and write the tradeoff/census in
`eval/rhvac/RESULTS-P9W-NATIVE-MERGE-WEB.md`. Write that results file either way (what
changed, test counts).

Stage your changes; do not commit. Work autonomously; do not ask questions.
