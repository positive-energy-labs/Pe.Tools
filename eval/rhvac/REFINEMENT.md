# Takeoff refinement campaign (started 2026-08-03)

Goal: refine auto-takeoffs until no further refinement is possible. The output contract is a
**partition** of the conditioned footprint — straight walls, no holes, no slivers, shared
boundaries, ambiguity flagged — easy for a human/pea to edit in Revit or the /rhvac UI before
conversion. The pre-commit human edit surface is the antidote to intent ambiguity; the detector
never guesses intent.

## Ground rules

- **Mechanisms generalize; thresholds don't.** project-a is the adversarial benchmark, not the spec.
  No project-a-specific constants in core logic (per-project knobs with sane defaults are fine).
- Every detector change is judged by the scoreboard (`eval/rhvac/score-takeoff.py`), including
  its absolute **GATES** section, with per-level overlays attached as evidence in any phase-close
  note. A phase may not be recorded closed while gates fail unless the log names each failing gate
  explicitly. Falsify before believing; a plausible mechanism gets measured on the live data
  before it lands (see HANDOFF.md falsification-pass precedent).
- Structural properties are enforced **by construction**, not tuned toward:
  partition (no holes/gaps), boundaries on a wall-line arrangement (no stair-steps),
  min feature width (no slivers), explicit ambiguity flags (no guessed intent).
- Iteration runs offline via the replay harness wherever possible; live Revit sessions only for
  capture + periodic re-verification.
- Bounded mechanical grinds may be delegated to `codex exec "<prompt>"`.

## Phases

1. **Instrument** (in flight): per-room IoU scoreboard vs mined Bluebeam ground truth
   (145/150 rooms, 936 wall lines, all-level registration) + auto room-map curation;
   offline replay harness for the detector's post-Revit stages.
2. **Partition reformulation**: replace independent region growing with a partition of the
   walkable/conditioned footprint; every cell assigned; boundaries at wall centerlines
   (matches ASHRAE mid-partition convention and kills the −13.5% area undershoot class).
3. **Wall-line arrangement**: detect dominant wall directions, snap partition boundaries to a
   line arrangement; straight edges by construction; retire post-hoc polygon simplification.
4. **Iterate to plateau**: offline loop against the scoreboard; failure-taxonomy-driven
   (missing / fragmented / merged / shape-poor per room); attic + openings lanes once the
   main-floor score plateaus; periodic live re-verification.
5. **Editability surface**: detector emits ambiguity flags (open-plan blobs, low-evidence
   boundaries) that the /rhvac UI and Revit lane render as one-action human resolutions
   (split line, merge, accept). Perfect = geometric where determinable, one-touch where not.

## State log (append per phase completion)

- 2026-08-05: Regions formulation deleted after Partition passed the pre-agreed second-model gate:
  project-a 54.1 vs 52.4 and project-b 23.3 vs 22.0. Seven replay TSVs stayed byte-identical across the
  deletion; Partition is now the only detector and replay formulation.
- 2026-08-03: Bluebeam mining landed (cc80353) — per-room geometric oracle exists.
- 2026-08-04 (eve): Phase 2 partition formulation landed offline (`Formulation = Partition`,
  PartitionFormulation.cs): evidence-watershed assignment of every domain cell, explicit
  open-plan merges + ambiguity flags in the TSV, sliver re-flood dissolution. Replay-measured:
  TOTAL 52.3 -> 54.0, wall recall 43.8 -> 54.1%, missing 5 -> 1, merged 31 -> 26, attic mIoU
  .308 -> .473; zero in-domain holes by construction. Iteration log + open-question answers in
  PHASE2-PARTITION.md. Regions path byte-identical and still default; live regen + LEVEL_POLICY
  mirror pending.
- 2026-08-04: Phase 1 instrument landed — `score-takeoff.py` scoreboard (per-room IoU, coverage/
  over-detection, failure taxonomy, wall recall; <2 s) over `project-a/oracle-geometry.json`
  (22/25 sheet-pages auto-registered; 118/150 oracle rooms carry model-frame polygons — the
  145/150 area matches minus out-of-model structures and 3 pages awaiting manual anchors;
  747/936 wall lines registered). Baseline: TOTAL 52.3 (ok:22 frag:30 merge:31 poor:30 miss:5),
  wall recall 43.8% @1.5 ft — `project-a/SCOREBOARD.md`. Auto room-map: 5 curated + 26 auto-iou,
  gated coverage 9.8%→24.7% area. Replay harness for post-Revit stages is the remaining
  phase-1 item.
- 2026-08-06: Phase 3's `BoundarySnap` path is superseded: `SpaceBoundaryNetwork` now regularizes the full level once at partition emit, and TSV, UI, and Space materialization share that geometry.
- 2026-08-10: COVERAGE RESET — room boundaries are one level-wide polygonal coverage.
  The 1,333-line per-room wall-fit/bridge/local-straighten solver was deleted and replaced by
  NetTopologySuite `CoverageSimplifier`: grid loops stay fully noded until every room is
  simplified atomically, so adjacent rooms receive the same edge. Wall-band claim now sees
  distinct owners within a bounded circular neighborhood but only claims obstruction cells;
  a pre-vectorization pass also resolves 98 diagonal raster corner-touches. Geometry-status flags
  and the materializer's regularized/unresolved split are gone; every room uses the canonical
  coverage for both TSV/SVG and Space boundaries, with FilledRegions reserved for residues and
  native shape-gate defectors. A small post-simplification stage now uses long, strongly
  wall-supported edges to infer local orientation families per wing, fits each eligible edge at
  its own offset, and moves every shared junction once from its incident fitted lines. Weakly
  supported and curved contours remain unsnapped. Offline Main Level replay: 82 OGC-valid rooms,
  zero overlap, 198 exact-touch pairs (broken fixture: 65), one non-touching pair at 0.25 ft plus
  seven more between 0.25 and 1.5 ft, and 2,227 polygon points including closing vertices/holes.
  The evidence stage aligns 84 straight, well-supported edges across five local families
  (45, 135, 0, 90, 88.5 degrees); curved and weak evidence does not vote.
  Simplified level area is +1.08% versus raster ownership; worst individual-room drift is 24.7%.
  SDK beta.116 live proof on project-a regenerated the Main Level from 70,414 elements and 2,749,337
  triangles, then created 82/82 FilledRegions with zero failures; the user-visible view-image
  operation exported that exact annotated Revit view at 4,000 px.

- 2026-08-08: Edit-in-Revit round landed (P6–P9, e442b57..792b7a5). Flow: calc draft → resolve
  intent → draw (Spaces for regularized rooms only; unregularized/residue/defectors = owned
  FilledRegions or detail-line fallback — zero silent loss, accounting test-asserted) → human
  edits geometry in Revit → `RoomTakeoff.ReadbackNative` writes `rooms_<level>.native.tsv`
  (source=native) → route merges native over detector by room id. Browser simplification
  deleted; the route displays canonical geometry only. Seam flipped: core `TakeoffTsv`/
  `TakeoffResolutions` own parse+resolutions; RHVAC is an export adapter. Residue: takeoff
  Revit lane has no host-op wrapper (script/test facade only) — live op exposure + typegen,
  live-session parity proof, and recalc-as-diff are the open items.
