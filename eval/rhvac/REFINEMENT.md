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
- 2026-08-10 (eve): EDITABILITY ROUND — live project-a session with kaitpw surfaced two chronic,
  binding defects: interstitial white bands between rooms (BuildDomain excludes wall cells, so
  watershed fronts stop at wall FACES) and raster stairstep boundaries on 67/82 rooms, which
  make human editing of FilledRegions literally impossible. Fixes, all mechanisms:
  (1) wall-band claim — non-domain cells sandwiched between owned cells within WallClaimFt
  (axis-pair rays; default 1.5 ft/side) are split at the band centerline by multi-source BFS,
  so rooms TOUCH; RawSqft becomes centerline semantics where claimed (~2051 sf on project-a Main).
  (2) EDITABILITY OVER AREA FIDELITY — straightened geometry ships whenever a valid loop
  assembles: the tight tolerance now only decides regularized STATUS, drift up to
  HardAreaDriftPct (25%) ships flagged `area-drift`; dirty paths still assemble from their
  DP-fitted curves; degree-1 gaps get bridged (`bridged-loop`); rooms with no assemblable loop
  get a local DP+axis-snap straightener (`local-straightened`); residues straightened too.
  project-a Main geometry census: network:26/applied:34/local:21/raster:1 (was 15 straight /
  67 raster). (3) Border residues (exterior leaks past the crop, e.g. the 5,200 sf pool-terrace
  blob) are logged, never drawn. ParseTsv area-integrity seam widened 3.5%→27% to match the new
  contract. Live project-a Main after: 31 Spaces, 53 FRs, lineFallbacks=0, filledRegionFailures=0
  (was 2+2 — R17/R59 straightened away). Scoreboard 54.1 → 54.4 (cover% up every level; wall
  recall 53.4% → 43.1% — the metric partly counts the jogs/nubs straightening removes; knob is
  BoundarySimplifyFt/MaxVertexShiftFt if it matters). Four-verbs fixture recurated to the new
  snapshot (accept R04 / reject R77 / split R07 / merge R14→R08; anchors rebind, 4/0/0).
  Committed TSVs + room-map refreshed. Gates: offline 45/45, FreshRevitProcess 54/54.
  Mech zoning plans discovered to be hand-drawn FilledRegions (no Spaces/zones/color schemes
  in the doc) — zone polygons extracted as reference data (`project-a/zones-mech.json`),
  grouping-only, not wired into scoring.
- 2026-08-08: Edit-in-Revit round landed (P6–P9, e442b57..792b7a5). Flow: calc draft → resolve
  intent → draw (Spaces for regularized rooms only; unregularized/residue/defectors = owned
  FilledRegions or detail-line fallback — zero silent loss, accounting test-asserted) → human
  edits geometry in Revit → `RoomTakeoff.ReadbackNative` writes `rooms_<level>.native.tsv`
  (source=native) → route merges native over detector by room id. Browser simplification
  deleted; the route displays canonical geometry only. Seam flipped: core `TakeoffTsv`/
  `TakeoffResolutions` own parse+resolutions; RHVAC is an export adapter. Residue: takeoff
  Revit lane has no host-op wrapper (script/test facade only) — live op exposure + typegen,
  live-session parity proof, and recalc-as-diff are the open items.
