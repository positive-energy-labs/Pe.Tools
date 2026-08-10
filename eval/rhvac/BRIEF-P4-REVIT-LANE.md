# Mission: P4 — Revit lane applies resolutions before materializing Spaces

Execute P4 of eval/rhvac/PHASE5-EDITABILITY-PLAN.md. Today `RoomTakeoff.MaterializeSpaces`
(RoomTakeoff.cs ~:134) materializes `LoadResult(opt, level)` blind to the sidecar — a split
or merge resolved in /rhvac never changes the Spaces. Fix: apply the sidecar to the loaded
TakeoffResult before `SpaceMaterializer.Replace`.

## Scope
- Locate the sidecar the same way the C# export lane does (takeoff-resolutions.json next
  to the takeoff data; check how RhvacCandidateBuilder.ParseTsvDirectory finds it and what
  path convention the host op writes — the Revit lane needs an explicit path or documented
  convention, choose what the existing plumbing supports and state it).
- Apply semantics MUST reuse (not re-implement) the P2-verb apply. The builder operates on
  its own TakeoffRoomShape/LevelTakeoff types; RoomTakeoff has TakeoffResult/RoomResult.
  Extract a small shared core or write a faithful port with a MIRROR TEST asserting
  identical outcomes on the committed four-verb project-a fixture
  (eval/rhvac/fixtures/project-a-main-four-verbs.json) across both appliers.
- Verb effects in the Revit lane: accept = flag not stamped; split = two Spaces (ids
  R{n}.a/.b, splitFrom provenance in Comments after the ownership prefix); merge = one
  Space for the survivor; reject = Space not materialized. Orphaned decisions: log loudly,
  materialize the room unresolved (never drop silently).
- Loss accounting {applied, remapped, orphaned} surfaces in the materialization log line.

## Gates
- New NoDocumentRuntime mirror test green (identical apply outcomes builder-vs-Revit-lane
  on the shared fixture).
- Full filter "TakeoffReplayTests|RhvacCandidateBuilderTests|RhvacEvalTests" green.
- TakeoffSpaceMaterializationTests still compiles; live parity is PENDING (say so; do not
  claim Revit behavior you did not run).
- No detector/TSV changes; fixtures untouched (verify git status shows none).
- Comments stamping preserves the token|roomId ownership prefix contract
  (SpaceMaterializer.SpaceComments).

Results to eval/rhvac/RESULTS-P4-REVIT-LANE.md. Stage, do not commit. Work autonomously;
do not ask questions.
