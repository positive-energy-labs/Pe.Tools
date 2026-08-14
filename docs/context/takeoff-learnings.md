# Takeoff learnings

Hard-won lessons from the room-detection campaign, distilled for the zone-bounded direction in
[`AGENTS.md`](../../source/Pe.Revit.Takeoff/AGENTS.md). Read this before re-attempting anything that
looks clever — most of it has been tried and measured. Revit-API constraints are **not** here; they
live as inline comments at their call sites, which is where they belong.

## Why the pivot

Unbounded whole-level room detection plateaued, and the ceiling was epistemic, not tunable:

- **Coverage % is a saturated, circular metric.** Mean IoU saturates ~0.54 against fuzzy oracle
  registration; the old "38.1% coverage" headline was area-matched then area-scored. You cannot move
  it honestly, and moving it does not make the output usable.
- **Open-plan blobs have no interior wall geometry.** No wall detector can split them — the split is
  *engineering intent*, not something in the model. This is the single fact that motivates the pivot:
  the designer's hand-drawn zone supplies the intent, and bounds the detector to a scope it can
  actually handle.

So the whole-level scoring/coverage machinery is retired. The room-partition *engine* survives.

## Where the code actually is (2026-08-14)

The pivot is **half-landed** — do not read the laws below, or AGENTS.md, as fully implemented:

- **Landed**: the strict promotion gate (`Regularize → FrameLocalProjector → MergeOrHoldTinyRooms →
  RejectMisalignedExposedRails`) and evidence-driven per-level policy inference (`LevelProfile`).
- **Not built**: detection is still **whole-level** — there is no Zoning Region FR input anywhere in
  the package. Revit **Spaces are still the primary materialized artifact**; the
  Room-Region-FR-as-edit-surface end-state does not exist yet.

AGENTS.md describes the target contract. The detector below is the pre-pivot whole-level engine that
is meant to be *scoped to a zone*, not replaced.

## The laws, and the scars that earned them

Each of these is an AGENTS.md law; here is the evidence, so nobody relitigates it.

- **STRAIGHT-ONLY** — curve/hole-solving ambition produced diagonal artifacts across whole plans;
  curved-wall support was removed wholesale (2026-07-12). The engine never invents a diagonal or curve.
- **Drop, don't mangle** — a visibly missing room is one easy human fix; a warped polygon is
  un-diagnosable. A region the priors can't explain is dropped whole and flagged UNRESOLVED.
- **Editability > area fidelity, enforced by a strict gate** — raw raster staircases make a
  FilledRegion literally un-editable (a user could edit exactly one wall of 82). A room ships only if
  it survives frame-local projection (one coherent orthogonal frame, bounded area/boundary drift, no
  micro-steps, no cross-frame overlap) *and* evidence fidelity (below); otherwise it is rejected
  **whole** into visible residue. Straightened geometry is not a license to ship — drift is a
  rejection criterion, not an allowance.
- **Evidence fidelity — straight is not enough, it must sit on real ink** — a straightened exposed
  edge that drifts ~0.25–0.75 ft off the nearest wall ink is rejected: it looks clean but no longer
  traces a real wall. Co-equal to editability, not subordinate to it.
- **Flag, don't reject** — the detector never decides junk-vs-real. The width threshold that kills
  narrow junk also kills a real 31.9-sf mech room; junk-vs-real is geometrically inseparable at
  0.25 ft (interior width is a discrete cliff — 2.0 ft ≡ 2.5 ft byte-identical).
- **Identity must be geometric** — `R{rank}` ids reshuffle on any re-detection (assigned by
  descending area), silently dropping human work. Anchor on label-point + area±20% instead (that gave
  100% auto-remap on a rank-shuffle fixture, 0 silent drops).
- **Counts aren't proof** — pair every claim with a plan-image checkpoint *and* a deterministic
  census. Screenshots and Room counts alone prove nothing.

## The room-partition engine (what survives, for step 2)

If you build the zone → Room Region partitioner, start from what already works:

- **Ink = walls, field = physics.** On a framing-stage IFC (70k DirectShapes, 0 Walls, 0 Rooms),
  Revit's plan renderer draws correct wall ink for free; the heightfield gates it. Chosen over 4
  alternatives (gbXML / EnergyAnalysisModel / link room-bounding are blind to DirectShapes;
  geometry-slicing needs a per-model cut-height hack).
- **FLOOR shapes boundaries; CEILING only gates.** Ceiling data is too patchy at framing stage (joist
  gaps, tilted planes) to touch boundary geometry — letting it caused a wavy-edge regression. But the
  ceiling test is *mandatory*: open-to-sky courtyards look enclosed in plan ink.
- **Boundary convention (locked 2026-07-03): centerline on interior partitions, outside-face on
  envelope.** This is where the accuracy is — raw finish-face undershoots oracle areas 15–25%.
- **Rooms are a coverage, not independent shapes.** Simplify all rooms together (NetTopologySuite
  `CoverageSimplifier`) so a shared interior edge gets one identical replacement. No per-room repairs.
  (This collapse to a single shared-coverage simplifier *succeeded* and supersedes the earlier
  "two regularizers can't be collapsed" finding.)
- **Current pipeline shape — the promotion gate** (`RoomTakeoff` §detect→materialize):
  `Regularize` (shared coverage) → `FrameLocalProjector` (per-room orthogonal rails; one polygon or
  reject) → `MergeOrHoldTinyRooms` → `RejectMisalignedExposedRails` (evidence fidelity). Accepted
  rooms are much nicer, but the gate currently **over-rejects** (defective-room dropping too
  aggressive as of `d1c7964`) — treat rejection tuning as open, not settled.
- **Watershed partition over independent-blob detection** — rooms partition the walkable domain; wall
  thickness splits at the centerline so neighbors share boundaries by construction. But **BuildDomain
  must claim wall-band cells to the centerline** or fronts stop at wall faces and leave white
  interstitial bands ("rooms must touch" depends on this).
- **Snap to dominant orientation frames** — houses are rectilinear; DP chords alone ship arbitrary
  angles that make FRs un-editable by hand.
- **Earned magic numbers** (data, not taste): `GapSealFt=1.5` (1.0→11 rooms, 1.5→45, 2.0→44 regressed);
  `CellFt=0.25` resolves stud walls and is a fixed capture resolution; `HeaderBandFt≈8.5` (per-model =
  stud-top histogram minus ~2 ft); `HeaderNearFt` must cover half the widest opening; full-precision
  F6 TSV is load-bearing (rounding flips geometric tie-breaks and changes room counts).

## Falsified — do not re-try

Each was implemented and measured. The number is the tombstone.

- **Vector wall harvest** (plane-cut probe): 47.7% recall vs raster 51.9% @1.5 ft — the shell is a
  linked IFC of Generic Models, so there are no Revit Walls to harvest. Keep raster primary.
- **Typed IFC openings**: all 55,634 imported objects are `IfcBuildingElementProxy` "Undefined"
  (0 IfcDoor/Window/Wall). Typed door identity cannot replace the gap-seal heuristic here.
- **Finer cells** (1.5-in, 1-in): open no junk/real width-separation window (overlap 23–31%, never
  90% precision+recall) at 4.4–10.8× replay cost.
- **Junction-pairing by owner identity**: moved loop/topology failures only 87→84 (needed ≤35);
  ≥3 paths sharing an owner-pair is irreducibly ambiguous.
- **DistanceMaxima seeds**: under-seed closets/baths (41.9 vs 52.8); region cores win. Hybrid seeding
  beats pure maxima.
- **Pure-shape junk flags**: narrow/compactness reach 97.4% precision but only 30% recall — remaining
  junk is compact closet-lookalikes. The signal that *does* work is **non-geometric**:
  ceiling-height std-dev ≥ 0.5 ft flags junk at 93.4% precision (30%→71% recall on sub-60-sf junk).
- **MinCompactness as a room-killer**: amputated 86% of L0 area (13→23 rooms when disabled). Never
  silently delete; low-confidence blobs ship as flagged proposals.
- **Machine-straightness ceiling**: under a 3% area-honesty contract only **67/285 rooms (23.5%)**
  regularize; outer-ring vertices drop 20.9% (target 50%). The rest is human hand-editing — which is
  exactly what the zone-bounded, edit-in-Revit flow assumes.

## Retired by the pivot (do not resurrect)

The manual coverage-optimization campaign: coverage-%/junk-count gates, name-matched `LEVEL_POLICY`,
`FloorStepWeight`, and morphology attempts to split open plans. **Not retired** — the per-level
obstruction flags (`RequireCeiling`, `SealDoorHeads`, `SealWallRunGaps`, `StoryCapFt`) still run, now
*inferred from evidence per level* (`LevelProfile`) instead of hand-set. Scope and open-plan splits
are *meant* to come from the zone FR rather than the detector, but that scoping isn't built yet (see
"Where the code actually is").
