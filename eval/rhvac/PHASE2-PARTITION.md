# Phase 2 design brief — partition reformulation

Grounded in the phase-1 baseline (SCOREBOARD.md, 2026-08-04): TOTAL 52.3; of 118 scored rooms —
ok 22, fragmented 30, merged 31, shape-poor 30, missing 5; >50% of candidate area falls outside
any ground-truth room on every level; wall recall 43.8% @ 1.5 ft.

## Why the current formulation cannot reach the goal

Region growing emits independent blobs. Nothing forbids: uncovered floor (holes), wall-band
corridors promoted to rooms (the >50% outside-GT area), rooms that don't touch, or boundaries
that wander. Fragmented+merged+shape-poor (91/118) are all boundary-placement failures — the
regions are roughly where rooms are, but their edges are wrong, and edge errors are unfixable
by thresholds in a formulation where edges are emergent raster artifacts.

## Target formulation

1. **Domain**: the walkable/covered footprint per level (existence mask the detector already
   computes: floor + ceiling + headroom). Every cell of it belongs to exactly one space at the
   end. Holes impossible by construction.
2. **Boundary evidence field**: per cell-edge, a cost of "a wall crosses here" from the
   heightfield (obstruction runs, lintel strips, height discontinuities — the mechanisms
   RequireCeiling/SealDoorHeads already proved out) — NOT a binary mask. Low evidence = cheap
   to ignore; strong colinear runs = near-mandatory boundaries.
3. **Partition**: seeds (one per candidate space, e.g. distance-transform maxima or existing
   region cores) + boundary-cost-respecting assignment (watershed / graph-cut family) of every
   domain cell to a seed. Merge criterion is explicit: two seeds merge when no boundary-evidence
   ridge separates them (that merge is then an *ambiguity flag*, not silent).
4. **Slivers**: any region under min feature width (door width ~2.5 ft) or min area is dissolved
   into its dominant neighbor — wall bands and closet fragments cease to exist as rooms.
5. **Shared boundaries**: partition edges are shared between neighbors by construction; the TSV
   gains nothing new (polygons still emitted per room) but adjacent polygons share vertices.
6. **Ambiguity flags** (phase-5 hook, but emit now): open-plan low-ridge merges, low-confidence
   boundaries, border-touching regions. Flag, never guess.

Wall-line snapping (straight edges) is PHASE 3 — do not bundle. Phase 2 success is measured
with jagged-but-correctly-placed boundaries.

## Constraints

- Iterate ONLY through the offline replay harness (DetectSnapshot.Replay) once real captures
  exist; synthetic estate for unit truth. Score every change: `python eval/rhvac/score-takeoff.py`.
- Mechanisms generalize; no project-a constants in core logic. TakeoffOptions gains a formulation
  switch (old path stays runnable until the new one dominates the scoreboard, then old path dies
  per greenfield posture).
- Determinism: byte-identical TSV across replays, same as today.
- Success bar for phase 2: TOTAL meaningfully up from 52.3 with taxonomy shifting out of
  fragmented/merged into ok; outside-GT candidate area sharply down; zero holes inside the
  domain by construction. Shape-poor may persist until phase 3 (snapping).

## Open questions for the implementing agent to answer with measurements

- Seed source: distance-transform maxima vs current region cores — which survives open-plan
  blobs with fewer false splits?
- Boundary field calibration: can the 747 registered ground-truth wall lines calibrate edge-cost
  weights per evidence type (colinear obstruction run vs lintel vs height step)? (Calibrate
  weights = mechanism; per-project constants = banned.)
- Attic: is the L3 collapse (mIoU 0.308) an evidence problem (patchy rafter ceiling mask) or a
  domain problem (existence mask wrong under sloped roofs)? Measure before mechanism-guessing.

---

# Implementation record (2026-08-04, offline replay campaign)

Landed as `TakeoffOptions.Formulation = Partition` (`PartitionFormulation.cs`); the Regions path
stays byte-identical (control replay of all 5 snapshots reproduces the committed fixture TSVs
exactly, verified after the `BuildObstruction`/`FinishRegions` refactor). The offline loop is
`ProjectAReplayDumpRun` (`PE_TAKEOFF_REPLAY_OUT` + `PE_TAKEOFF_FORMULATION=Partition`) →
`score-takeoff.py --takeoff-dir`; diagnostics via `Dump_partition_diagnostics`
(`PE_TAKEOFF_DIAG_OUT`) → `diag-partition.py`.

Shape: domain = existence mask (floor + ceiling/headroom under RequireCeiling, wall cells
included); evidence = sealed obstruction ink at certainty 1.0 + weighted saturating ramps on
ceiling/floor height steps; seeds = unobstructed-domain cores (Hybrid: a core containing >= 2
distance-transform plateaus is seeded by the plateaus instead); assignment = deterministic
Meyer priority-flood (fronts meet mid-ink -> centerline splits, shared boundaries by
construction); merges explicit when a shared boundary's evidence backing < MinBoundarySupport
(flag `open-plan-merge`); slivers (< MinSqft or < 2.5 ft feature width) dissolve by DELETING the
region and re-flooding its cells under the same rule (dominant-neighbor dumping measurably
inflated neighbors: Guest Office 0.93 -> 0.67 IoU, fixed to 0.876); flags ride the TSV as
3-column `META flag <id>:<flag+flag>` lines (scorer + RhvacCandidateBuilder ignore unknown META
keys — format backward-compatible, Regions TSVs byte-unchanged).

## Iteration log (TOTAL = mean IoU x100 over 118 GT rooms; baseline Regions = 52.3)

| # | change | TOTAL | taxonomy (frag/merge/miss/ok/poor) | wall% | note |
|---|--------|-------|-----------------------------------|-------|------|
| 0 | Regions baseline (control replay) | 52.3 | 30/31/5/22/30 | 43.8 | byte-identical to fixtures |
| 1 | Partition, core seeds, dominant-neighbor slivers | 52.9 | 34/31/1/22/30 | 53.8 | Theatre needed FLAT policy (stock options -> 32k sf fake apron rooms; border-rejection had hidden this under Regions) |
| 2 | sliver dissolution -> delete + re-flood | 52.8 | 34/31/1/24/28 | 54.1 | fixes neighbor inflation (Guest Office .67 -> .876, Sauna .755) |
| 3 | seeds = DistanceMaxima everywhere | 41.9 | 31/52/1/15/19 | 49.3 | FALSIFIED: under-seeds closets/baths (L2 merged 13 -> 28, attic 4 seeds/12 GT) |
| 4 | attic without SealDoorHeads | (L3 .459 -> .401) | — | — | FALSIFIED: sealer's splits outweigh its interior pollution |
| 5 | seeds = Hybrid everywhere | 52.7 | 40/23/1/25/29 | 54.9 | splits blobs (merged -8) but fragments L0 (.399 -> .327) where ceil-step evidence is duct noise |
| 6 | Hybrid on L1/L2/L3 only (per-level policy) | 53.7 | 36/26/1/25/30 | 54.1 | keeps blob splits where evidence is trustworthy |
| 7 | FloorStepWeight 0.7 -> 0.45 (guide, never certify) | **54.0** | 35/26/1/26/30 | 54.1 | theater tiers / sunken floors are not room boundaries |

Final (iteration 7) per level vs baseline:

| floor | mIoU | cover% | over% | wall% | baseline mIoU/cover/over/wall |
|---|---|---|---|---|---|
| 0 | 0.399 | 82.2 | 56.7 | 46.2 | 0.408 / 77.1 / 51.7 / 34.0 |
| 1 | 0.524 | 91.9 | 57.7 | 66.6 | 0.491 / 89.1 / 51.3 / 56.6 |
| 2 | 0.627 | 87.9 | 53.2 | 51.7 | 0.656 / 90.0 / 52.4 / 42.0 |
| 3 | 0.473 | 74.2 | 54.6 | 25.4 | 0.308 / 47.5 / 61.1 / 15.9 |

Ambiguity flags emitted (final config): L1 10 rooms (7 open-plan-merge, 2 both, 1 low-evidence
-boundary), L2 3 (open-plan-merge), L0/Theatre/L3 none. Partition accounting per level (domain /
crumbs / border-dropped): L0 15,187 / 90 / 0 sf; Theatre 1,544 / 351 / 367 sf; L1 28,269 / 237 /
5,211 sf; L2 26,031 / 857 / 11,050 sf; L3 8,598 / 1,148 / 0 sf. Zero in-domain holes by
construction (every domain cell is in an emitted room, a logged border drop, or a logged crumb).

## Answers to the open questions (measured)

1. **Seed source: region cores win.** DistanceMaxima alone scored 41.9 vs 52.8 — the 3-ft
   clearance plateau under-seeds closets, baths and halls, which then merge into neighbors
   (L2 merged 13 -> 28, attic mIoU 0.116). Cores over-split nothing that the merge criterion
   plus sliver re-flood cannot absorb. The productive combination is the HYBRID: cores by
   default, plateau sub-seeding only inside cores spanning >= 2 plateaus, and only on levels
   whose height-step evidence is trustworthy (below) — that alone converted merged 31 -> 26
   and lifted L1 mIoU .495 -> .524, attic .459 -> .473.
2. **Calibration: yes — and it validated the defaults instead of replacing them.** Against the
   747 registered wall lines (`diag-partition.py`, precision = fraction of positive cells within
   1.5 ft of a wall line): obstruction ink lift over domain base rate is 1.59/2.43/3.14 on
   L0/L1/L2; ceiling steps >= 2.5 ft lift 1.20/1.78/2.34; the ceil/ink ratio ~0.73 on the floors
   where it matters matches `CeilStepWeight = 0.7`. Floor steps lift 1.7-2.1 on L0/L1 but are
   ANTI-signal on the attic (0.43-0.72) and mark theater tiers — hence `FloorStepWeight = 0.45`,
   deliberately below `BoundaryEvidenceMin = 0.5`: floor steps guide watershed placement but can
   never certify a boundary (+0.3 TOTAL). The same measurement exposed L0's ceiling channel as
   duct/beam noise (lift 1.1-1.2), which is why hybrid sub-seeding is per-level policy, not a
   global default.
3. **Attic: mostly an evidence-shape problem on top of a bounded domain gap, not a mask bug.**
   The partition alone recovered most of the collapse (mIoU 0.308 -> 0.473, cover 47.5 -> 74.2%,
   over-detection 61.1 -> 54.6%): the old formulation was dropping/mis-growing regions the mask
   already supported. Residual: the existence mask covers 79% of attic GT area (vs 87-89% on
   L1/L2) — knee-wall strips below MinHeadroomFt plus the 8.5-ft registration residual on the
   borrowed attic transform (SCOREBOARD.md calls attic numbers directional). The door-head
   sealer marks ~45% of attic GT interiors as obstruction under sloped ceilings, but removing it
   REGRESSED L3 (.459 -> .401): its door splits outweigh the pollution. Attic wall ink is nearly
   uninformative (lift 1.14); the best attic channel is big ceiling steps (>= 2.5 ft, lift 1.78).
   Phase-3 wall-line snapping should not expect much from attic ink.

## Honest gaps

- **over% did NOT drop** (51-52% baseline -> 53-58%): centerline claiming plus blob splitting
  emit MORE area, and the metric counts the 15 GT-less oracle rooms and unmodeled space as
  over-detection. cover% rose in step (L1 89 -> 92, L3 47 -> 74). A per-room area audit against
  a completed oracle is the only way to make this metric move honestly.
- **merged is floored near 26**: the L1 kitchen/sitting mega-blobs have NO wall geometry
  (live-falsified 2026-07-24) and several L2 "merged" are cookie-cutter twin GT identity noise
  (candidates at IoU .84-.90 "spanning" twin oracle rooms — see SCOREBOARD honesty ledger).
  These are curation/flag lanes, not detector lanes.
- **fragmented (35) is the biggest loss pool (≈18 pts)** but perfect fragment-merging is worth
  only +2.1 TOTAL (measured upper bound — most pieces legitimately span GT boundaries).
  The real gain hiding in that class is boundary PLACEMENT, i.e. phase 3.
- Rooms classed ok average IoU 0.776 — the jagged-raster + registration ceiling. Phase-3
  snapping attacks exactly this.

## Phase-3 handoff

- Wall-line arrangement + snapping should consume the partition's shared boundaries (they are
  already collapsed-collinear cell chains; `BoundarySimplifyFt` is unused in partition mode).
- The evidence field (BuildEvidence) is the natural input for dominant-direction extraction;
  note the per-level reliability measurements above before trusting attic/basement ink.
- run-takeoff.py LEVEL_POLICY must gain the partition policy (Theatre -> FLAT, SeedSource
  Hybrid on Main/Upper/Attic) when partition goes live; the C# mirror lives in
  `ProjectAReplayDumpRun.PolicyFor`.
- Regions-path deletion stays deferred until partition also dominates on a second model
  (single-benchmark dominance is not proof of generalization).
