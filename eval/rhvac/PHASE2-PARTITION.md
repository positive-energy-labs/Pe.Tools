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

Initially landed behind `TakeoffOptions.Formulation = Partition` (`PartitionFormulation.cs`); the
Regions path stayed byte-identical while the A/B gate was open. The offline loop is now
`ProjectAReplayDumpRun` (`PE_TAKEOFF_REPLAY_OUT`) →
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
- `run-takeoff.py` and `ProjectAReplayDumpRun` now share the inferred Partition policy; preserve
  that parity when adding future level-policy evidence.
- **Regions deleted (2026-08-05):** the pre-agreed second-model gate passed: project-a 54.1
  Partition vs 52.4 Regions, and project-b 23.3 vs 22.0. Partition is the only formulation.
  All seven captured replay TSVs were byte-identical before/after deletion; post-deletion scores
  remained exactly 54.1 / 23.3.

---

# Phase 3 — wall-line arrangement snapping (complete)

## Checkpoint state (2026-08-04, pre-implementation checkpoint under power-loss warning)

DONE:
- Control runs re-pinned by my own replays (not stale doc numbers):
  - Regions replay content-identical to committed `project-a/takeoff` fixtures (EOL-only diffs from checkout).
  - Partition pre-snap control: TOTAL 54.0, taxonomy frag:35 merge:26 miss:1 ok:26 poor:30,
    wall 54.1% @1.5ft; per-level mIoU 0.399/0.524/0.627/0.473 (L0/L1/L2/L3). Matches phase-2 record.
- Full source read: PartitionFormulation, Detector (TraceLoops/CollapseCollinear/BuildObstruction),
  DetectSnapshot, ProjectAReplayDumpRun, score-takeoff.py, diag-partition.py, TakeoffReplayTests.

DESIGN (settled, not yet coded) — new `source/Pe.Revit.Takeoff/BoundarySnap.cs`, called from
PartitionFormulation emit path, gated by `TakeoffOptions.SnapBoundaries` (default true; Partition-only):
1. Boundary NETWORK from final owner grid (emitted ids vs 0): unit edges at cell corners with
   owner pairs; chains = maximal runs between junction nodes (degree != 2); closed chains for
   islands. Shared by construction — each chain snapped ONCE, both rooms conform.
2. DIRECTIONS per level: secant orientation over ~4 ft arc windows along chains, histogram (1 deg
   bins mod 180) weighted by arc length, only windows whose edges are evidence-backed
   (max(evidence) >= BoundaryEvidenceMin — no walls invented where evidence is absent);
   smoothed circularly, NMS peak extraction (min share ~2%, min separation ~10 deg). DERIVED, never
   hardcoded; sanity-log vs the known ~130.5 deg grid.
3. RUNS: per-edge nearest-direction assignment (tol ~12 deg, backed windows only), consecutive
   merge, absorb short raw gaps between same-dir runs, min run ~3 ft; constrained least-squares
   line fit (direction fixed, offset = mean projection), max point deviation cap else revert raw.
4. ARRANGEMENT: per-direction 1D clustering of run offsets (~0.6 ft tol) -> shared wall lines;
   runs adopt cluster offset (deviation recheck).
5. JUNCTIONS: resolved globally — intersection of the two best-supported non-parallel incident
   lines (move cap ~1.2 ft), else projection onto the single line, else stay.
6. REBUILD chains: line runs become straight segments meeting at line intersections (joggle
   fallback for near-parallel/far intersections); raw runs keep original points. Rooms rebuilt by
   traversing raster loops and substituting chain geometry (orientation-matched), so the
   partition stays total and deterministic.
7. GUARDS by construction: per-room area drift vs raster <= max(0.5 sqft, 1%) and simple-polygon
   check; violations revert that room's chains to raw (iterate to fixed point, final fallback =
   all-raw = pre-snap geometry). RawSqft/Perimeter become snapped polygon truth when snapping is on.
Tests planned (TakeoffReplayTests): diagonal hypotenuse = exactly 3-vertex triangle polygon;
door-gap rooms stay 4 separate; open-plan pinch (no-evidence) boundary vertices byte-unchanged
vs SnapBoundaries=false; area-drift bound asserted on all synthetic rooms; determinism via
existing partition TSV test. ProjectAReplayDumpRun gains PE_TAKEOFF_SNAP=0 escape for A/B.

MID-FLIGHT: nothing coded yet — checkpoint landed before first edit.
NEXT STEP: write BoundarySnap.cs exactly per the design above, add the ~10 Snap* options to
TakeoffOptions (Contracts.cs), wire the emit path in PartitionFormulation.Run, build, green the
26 NoDocumentRuntime tests + new synthetic tests, then replay+score vs the pinned control.

## Completion re-baseline (2026-08-05, upgraded geometric oracle)

The implementation above is complete. `BoundarySnap` derives its directions from each level's
evidence, snaps every shared chain once, and is reached only by the Partition formulation. The
staged guard rejects touched output that fails the simple-polygon check and bounds each touched
room's area drift by `max(0.5 sqft, 1%)`; an untouched or fully reverted room now returns its
original raster loop byte-for-byte instead of rebuilding an equivalent but differently ordered
invalid ring.

One settled-design value changed during implementation: `SnapMaxCornerMoveFt` is 2.5 ft, not the
provisional ~1.2 ft. The required diagonal fixture demonstrated that raster tie-breaking inside a
wall-joint blob can put the raw corner more than 1.2 ft from the derived line intersection. Fitted
runs still obey the 0.8 ft point-deviation cap; evidence-backed terminal stubs are separately
bounded by the 2.5 ft corner cap and the per-room area guard.

The checkpoint numbers above predate the oracle upgrade and are retained only as history. Fresh
five-snapshot replays on the current 118-room oracle produced:

| Metric | Partition, snap off (control) | Partition, snap on | Delta vs control |
| --- | ---: | ---: | ---: |
| TOTAL score | 54.1 | 54.1 | 0.0 |
| High-confidence score (92 rooms) | 56.5 | 56.5 | 0.0 |
| Wall recall at 1.5 ft | 54.1% | 53.7% | -0.4 pp |
| Taxonomy (fragmented / merged / ok / shape-poor) | 35 / 23 / 27 / 33 | 35 / 23 / 27 / 33 | unchanged |
| L0 mIoU (73 candidates) | 0.414 | 0.414 | 0.000 |
| L1 mIoU (82 candidates) | 0.526 | 0.526 | 0.000 |
| L2 mIoU (79 candidates) | 0.622 | 0.623 | +0.001 |
| L3 mIoU (51 candidates) | 0.475 | 0.475 | 0.000 |

Snap coverage was deliberately conservative: Lower 399/7,281 ft (5%), Theatre 0/804 ft,
Main 131/12,980 ft (1%), Upper 369/7,742 ft (5%), and Attic 167/5,520 ft (3%). The A/B outputs
kept all 285 candidate rooms. Fifty exported room areas changed; the internal unrounded guard
accepted no drift beyond its bound. The largest ratio visible in the one-decimal TSVs is 1.006%,
which is a rounding artifact at the limit, not the value tested by the guard.

Validation: `Pe.Revit.Tests` built in `Debug.R25.Tests`; the complete
`LibraryBehavior.NoDocumentRuntime` lane excluding `ProjectAEvalRun` passed; both Partition replay
lanes emitted all five level TSVs and scored successfully. Synthetic checks cover shared tiling,
bounded drift, a single-segment diagonal, preservation of unsupported boundaries, no-evidence
byte identity, and deterministic Partition replay. Production snap code contains no
project-a-specific level names, angles, or constants.

Outcome: Phase 3 improves selected outlines but is neutral on the headline score and slightly
negative on mined-wall recall. That is the measured result, not a scoring win.

## Completion diagnosis: rejection telemetry and upper bound (2026-08-05)

`ProjectAReplayDumpRun` now accepts `PE_TAKEOFF_SNAP_DIAG_OUT` and writes one
`snap_<level>.json` file per replay. Each chain records its full length, final outcome, raw and
snapped points, and the raw/snapped geometry of surviving line runs. Outcomes are causal: a chain
is `area-guard-revert` only when it had a snap candidate before guard demotion. The table assigns
each chain's full length to one terminal outcome, so it accounts to 100%; this is deliberately
different from the surviving snapped-RUN coverage (399/0/131/369/167 ft) reported above.

| level | snapped | no direction consensus | insufficient evidence backing | deviation cap | corner cap | area guard revert | other |
|---|---:|---:|---:|---:|---:|---:|---:|
| Lower | 791.50 (10.87%) | 16.25 (0.22%) | 316.50 (4.35%) | 0 | 0 | 5,307.00 (72.89%) | 849.75 (11.67%) |
| Theatre | 0 | 0 | 23.50 (2.92%) | 0 | 0 | 434.50 (54.04%) | 346.00 (43.03%) |
| Main | 240.25 (1.85%) | 144.00 (1.11%) | 1,445.50 (11.14%) | 0 | 0 | 7,306.25 (56.29%) | 3,844.25 (29.62%) |
| Upper | 501.25 (6.47%) | 59.75 (0.77%) | 231.25 (2.99%) | 0 | 0 | 5,011.75 (64.73%) | 1,938.50 (25.04%) |
| Attic | 487.50 (8.83%) | 17.25 (0.31%) | 36.50 (0.66%) | 0 | 0 | 3,342.00 (60.54%) | 1,637.25 (29.66%) |

All values are ft (percent of that level's boundary network). The dominant terminal rejection is
therefore the room guard (54-73% of chain length), not direction consensus, evidence backing,
deviation, or corner movement. `other` is the second pool (12-43%) and is predominantly assigned
direction fragments that do not survive the 3-ft minimum-run construction. Opening the area-drift
limit while retaining simple-polygon/ring checks still left the guard dominant, proving that most
of this pool is invalid assembled topology rather than harmless area drift.

Perpendicular offsets used the same registered mined walls as `diag-partition.py`. A surviving
snapped run was matched to the nearest same-direction wall segment within 3 ft; raw statistics use
the raster edges replaced by that same run. Values are length-weighted absolute feet:

| level | matched run ft | snapped mean / median | raw mean / median | mean snapped-minus-raw |
|---|---:|---:|---:|---:|
| Lower | 159.0 | 1.094 / 0.640 | 1.068 / 0.719 | +0.026 |
| Theatre | 0 | - | - | - |
| Main | 26.0 | 0.386 / 0.368 | 0.376 / 0.368 | +0.010 |
| Upper | 133.2 | 0.607 / 0.706 | 0.603 / 0.671 | +0.004 |
| Attic | 69.8 | 1.924 / 2.014 | 1.934 / 2.018 | -0.011 |

There is no systematic wall-relative correction hiding behind low coverage: snapping changes the
mean perpendicular offset by -0.011 to +0.026 ft depending on level. That explains why more visual
straightening need not improve the 1.5-ft wall metric.

The temporary upper-bound experiment doubled `SnapMaxDevFt` (0.8 -> 1.6 ft) and
`SnapMaxCornerMoveFt` (2.5 -> 5 ft), lowered `SnapMinBackedFrac` (0.5 -> 0.25), and opened the area
drift limit. These settings were reverted and are not committed.

| experiment | snapped-run coverage Lower / Theatre / Main / Upper / Attic | TOTAL | wall recall |
|---|---:|---:|---:|
| stock guarded | 5.5 / 0.0 / 1.0 / 4.8 / 3.0% | 54.1 | 53.7% |
| relaxed, valid polygons required | 20.0 / 1.2 / 6.1 / 16.0 / 3.5% | 54.5 (+0.4) | 52.8% (-0.9 pp) |
| no room reversion (unsafe ceiling) | 55.3 / 13.4 / 34.2 / 52.9 / 29.6% | 54.8 (+0.7) | 51.1% (-2.6 pp) |

The unsafe ceiling emitted invalid rings that the stock scorer could not consume until its local
analysis copy used generic repaired-geometry boundaries; it is not a shippable score. One genuine
guard mechanism was also tested at stock thresholds: deduplicating shared-chain demotions per
iteration. It reduced valid coverage (Lower 4.51%, Main 0.45%, Upper 4.61%), left TOTAL at 54.1,
and was reverted.

**Decision:** retain the conservative snapping mechanism and the telemetry, but make no feature
change. The valid upper bound is below the ~0.5 TOTAL bar, while forced coverage buys only +0.7 by
emitting invalid topology and further harms wall recall. On this benchmark, snapping is a
visual/editability win, not a scoring win.
