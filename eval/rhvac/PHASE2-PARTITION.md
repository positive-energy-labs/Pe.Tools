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
