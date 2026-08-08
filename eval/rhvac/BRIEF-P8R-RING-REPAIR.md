# Brief P8R: Ring repair for self-touching unresolved shapes

## Context

P8 (commit 9241f02, see eval/rhvac/RESULTS-P8-MATERIALIZE-EVERYTHING.md) made
SpaceMaterializer draw unregularized rooms, residues, and defectors as owned
FilledRegions on the takeoff view. On project-a Main, 31 of the 74 unresolved shapes
have non-simple raster rings — self-touching loops (a vertex or edge coincides with
another part of the same ring, typical of rasterized polygons with pinch points) —
that `FilledRegion.Create` rejects even after consecutive-duplicate removal, so they
fall back to owned detail lines. Census was: 10 Spaces / 43 FRs / 31 line fallbacks
/ 31 FR failures / 72 rooms + 3 residues + 9 defectors = 84.

Mission: add a ring-repair pass so most of those 31 render as proper FilledRegions.

## Read first

- source/Pe.Revit.Takeoff/SpaceMaterializer.cs — `DrawUnresolved` (~line 145) is the
  failure path; the accounting invariant is at the top of the file.
- source/Pe.Revit.Takeoff/Annotate.cs — `ToLoop`, `CleanPoints`.
- eval/rhvac/RESULTS-P8-MATERIALIZE-EVERYTHING.md — prior gates and census.
- The TakeoffSpaceMaterializationTests test file (find via grep) — project-a census
  assertion and synthetic idempotency test.

## Scope

- Implement ring repair in source/Pe.Revit.Takeoff (SpaceMaterializer.cs and/or a
  small helper next to Annotate). Candidate mechanisms, in preference order:
  1. Split a self-touching ring at repeated vertices into simple sub-loops; each
     simple sub-loop with non-trivial area becomes a CurveLoop; feed all of them to
     one `FilledRegion.Create` call (or one region per sub-loop if Revit rejects the
     combined set).
  2. Nudge coincident/pinch vertices apart by half a raster cell to break the touch.
  Pick whichever survives contact with the real 31 failures; a hybrid is fine.
- Accounting stays per-CANDIDATE: a candidate that materializes as one or several
  repaired FilledRegion elements counts as exactly 1 in `FilledRegions`; the
  invariant `Spaces + FilledRegions + LineFallbacks == Rooms + Residues + Defectors`
  must keep holding. Every FR element gets the same Stamp comments and the
  unresolvedStyle override as today. Log each repair (`[spaces] {id} ring repaired:
  ...`) so the census is reconstructable from logs.
- Holes on repaired candidates: best effort — a hole loop that still fails to build
  may be dropped with a log line, but the outer ring must render.
- Detail-line fallback stays as the last resort for anything repair cannot fix.
- Do NOT change detector, replay, or resolution production code. Do not touch
  score-takeoff.py or fixture TSVs.

## Gates (binding)

1. Source compile: 0 errors.
2. `dotnet tool run pe-revit -- test fresh --filter "FullyQualifiedName~TakeoffSpaceMaterializationTests"`
   green (run from the worktree root). Update the project-a census assertion to the new
   honest numbers; the accounting invariant assertion itself must not be weakened.
3. project-a Main FR-failure count shrinks from 31 to <= 10 (target; see honest-stop).
   Line fallbacks shrink by the same amount.
4. Synthetic test: extend it with at least one self-touching-ring case (e.g. a
   figure-eight / pinched bowtie raster ring) proving repair produces FilledRegion(s)
   and counts as 1 FR candidate.
5. `git diff --exit-code -- '*.tsv'` and `git diff --exit-code -- source/pe-tools/`
   both pass.
6. `python eval/rhvac/score-takeoff.py` still prints TOTAL SCORE 54.1 (this change
   must not affect scoring).
7. Write eval/rhvac/RESULTS-P8R-RING-REPAIR.md: mechanism chosen, new project-a census
   table (same columns as P8), census of the remaining FR failures (id + one-line
   reason each), gates rerun output.

If <= 10 is unreachable, stop at the best honest point: keep the repairs that work,
revert anything that only helps by lying, and write the tradeoff/census of the
remaining failures in the results file. The census is deliverable #1 even if the
target is missed.

Stage, do not commit. Work autonomously; do not ask questions.
