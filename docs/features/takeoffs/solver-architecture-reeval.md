# Solver architecture re-evaluation (2026-08-14)

Ground-up review of the zone-bounded room solver: where heuristics slot in, what the
feedback loops measure vs. what we want, and the minimal refactor that makes A/B
experiments cheap. Grounded in the `takeoff-zone-promotion-final-20260814-153853`
contact sheet and a full structural survey of `source/Pe.Revit.Takeoff`.

## Failure taxonomy (from the contact sheet)

Three distinct failure classes, not four bad zones:

| Class | Zones | Mechanism |
|---|---|---|
| **Clutter-ink partitions** | Lower 08, Attic 00/01/02 | Interior gray ink (stairs, fixtures, roof framing, site linework) disconnected from the wall network spawns diagonal wandering partitions. LL08: raw 16 → accepted 2. Attic 00: raw 12 → accepted 0. |
| **Over-partitioning of real ink** | Main 08 (ink 94%), Lower 06 upper-right | Dense legitimate wall ink produces a lattice of tiny cells; merge phase doesn't consolidate. ML08: raw 10 → accepted 1, held 9. |
| **Over-exclusion** | Main 05 | Zone polygon fine, rooms plausible, but 2753 of 3152 sf excluded, accepted 0 held 8. Gate chain discards wholesale — `RejectionHistogram` in report.json already knows which gate; nobody looks. |

Healthy control: Main 07 (raw 2 → accepted 2, held 0). The core watershed + gates are
fine when the zone is small, orthogonal, and clean. **The problem is missing pre-solve
triage/hygiene and missing post-solve recombination — not the core.**

## Architecture diagnosis

The tiny core already exists; it's just fused shut:

1. **`PartitionFormulation.Run` (369 lines)** — six comment-delimited phases mutating
   shared `int[] owner` / `bool[] domain` arrays in place. No phase is independently
   runnable or testable. 9-param signature with 3 nullable pre-computed rasters as
   ad-hoc caching.
2. **`TakeoffPromotion.PromoteZone` (115 lines)** — the only place stages compose, as
   11 sequential statements. Ordering is load-bearing but implicit (e.g.
   `RestoreHeldSourceGeometry` must precede `RebuildResiduesInsideZone`; nothing
   encodes that). Stage identity exists only as `Mark("...")` stopwatch strings.
3. **No pre-solve seam at all.** Nothing sits between `DetectSnapshot` and
   `BuildObstruction` where zone triage or raster hygiene could live.
4. **Knobs are split.** `TakeoffOptions` holds ~30 tunables, but the constants
   experiments actually want to vary are hardcoded `const`s across five files
   (FrameLocalProjector 14, SpaceBoundaryNetwork 12, TakeoffEditability 11,
   TakeoffEvidenceFidelity 6+6 inline). Options are not serialized into report.json,
   so artifacts are not self-describing — two runs can't be attributed to their knobs.
5. **Duplicate geometry currency.** Five near-identical `RoomResult → NTS Polygon`
   converters with three different `PrecisionModel`s; three+ `SignedArea` copies.
6. **The gate chain runs only inside NUnit.** `TakeoffPromotion` is `internal`; the
   live path (`scripts.ts:164`) materializes the *raw* detector partition. The contact
   sheet we review is not what a live user gets. Honesty gap.

## What the feedback loops measure vs. what we want

Keep as-is (laws, pass/fail, already zone-bounded): containment, closure, abstention,
non-vacuous, determinism, strict editability. These are correct and cheap.

Gaps:

- **No run-over-run comparison.** report.json exists per run but there is no diff
  tool. A/B testing today = eyeballing two contact sheets.
- **No aggregate scoreboard.** Per-zone disposition numbers exist in diagnostics but
  nothing rolls up "conversion" (raw → accepted), held-fraction, excluded-fraction
  across the 45 zones, so a tuning change can't be summarized in one line.
- **Rejection histogram is write-only.** ML05's wholesale exclusion is already
  attributed per-gate in `Rejections` — it's just never surfaced on the sheet.
- **Doorway seals are invisible.** Closure decisions happen in `BuildObstruction`
  (door-head seal, wall-run gap seal) and never reach the renderer.
- **Options not in artifacts.** See knob split above.

Deliberately not reintroducing IoU/coverage scoring — retired per DECISIONS.md; the
oracle survives as the non-vacuous count only.

## Proposal

Two new seams + one refactor + a feedback-loop upgrade. No plugin framework, no
interfaces-with-one-implementation. An experiment = a different options record and/or
a different stage list.

### Seam 1 — Zone triage (pre-solve, pure)

New: `ZoneCensus` computed once per zone from `DetectSnapshot × ZoneScope`:
`ZoneSqft, InkSqft, InkRatio, ClusterSizesCells[], EdgeBandInkFraction`. Then
`ZoneTriage.Evaluate(census, options) → Solve | HoldWhole(reason)`. A held zone
renders on the contact sheet with its reason and emits zero rooms (abstention law
already permits this).

Slots the heuristics:
- **Small-zone rule**: `SmallZoneSqft = 750` (option) → HoldWhole("small-zone").
- **Wall-ratio refinement**: low `InkRatio` lets a *larger* small-zone threshold
  apply. Kills most attic wander before solving.

### Seam 2 — Ink hygiene (pre-solve raster transforms)

Pure `bool[] → bool[]` functions between snapshot and `BuildObstruction`:
- **Floating-cluster whiteout**: connected components on `ink ∧ zoneMask`; drop
  clusters below `MinInkClusterCells` (and/or bbox cap) that don't touch the
  zone-boundary ink ring. This is the LL08 / attic fix.
- Doorway closure already lives here (`DoorHeadMaxFt`, `DoorGapMaxFt`, `DoorJambMinFt`
  are already options). Change: emit the sealed cells as an overlay raster into the
  result so the renderer can draw them.

Each transform is an isolated unit-testable function, toggleable via options.

### Seam 3 — Explicit disposition stage list (refactor, not rewrite)

Turn PromoteZone's 11 statements into an ordered list of named steps
`(string Name, Action<PromotionState>)` executed in a loop — names reuse the existing
`Mark` strings. Ordering constraints become visible in one array literal; an
experiment inserts/removes/reorders. New recombination steps slot here:
- **Absorb-into-neighbor rules** (the LL08 / ML08 "wtf" merges): small room sharing
  most of its perimeter with one neighbor → merge.
- **Zone-edge-band recombine**: room with ≥X% of its area within `EdgeBandFt` (e.g.
  2 ft) of the zone boundary → merge into its interior neighbor.

`MinimumPromotedRoomSqft = 30` is already an option (Contracts.cs:37) — nothing to do
there except surface it in the UI eventually.

### Knobs + self-describing artifacts

Add the new tunables to `TakeoffOptions` (SmallZoneSqft, MinInkRatio,
MinInkClusterCells, EdgeBandFt, EdgeBandAreaFraction). Serialize the *full effective
options record + hash* into report.json. Promote a hardcoded `const` to an option only
when an experiment actually varies it — not the whole 60.

### Feedback-loop upgrade

- **report.json** gains: per-zone census, triage verdict, doorway-seal overlay,
  effective options + hash.
- **Contact sheet** gains: doorway seals drawn, triage-held zones labeled with reason,
  top-of-sheet aggregate row (Σ accepted/held/excluded sf, raw→accepted conversion,
  top-3 rejection reasons).
- **New `eval/rhvac/compare-zone-runs.py`**: takes two report.json paths, prints a
  per-zone delta table (disposition deltas, rejection-histogram deltas, options diff),
  optionally renders side-by-side panels for changed zones. This is the A/B loop.

### Debt burned in passing (only while touching those files)

- One `TakeoffGeometry` helper: single `ToPolygon` (one PrecisionModel) + one
  `SignedArea`; delete the five/three copies.
- Delete `SpaceMaterializer` (already scheduled, 537 LOC dead path).
- **Decision needed**: make `PromoteZone` reachable from the live path so materialized
  output matches the reviewed sheet, or explicitly document that live stays raw. The
  current silent divergence is the worst option.

## Suggested sequencing

1. Seam 3 refactor + geometry dedup (pure mechanical, tests already cover gates).
2. Census + triage + report/renderer plumbing (immediately explains ML05 via surfaced
   histogram, kills attic/small-zone noise).
3. Ink hygiene cluster whiteout (LL08).
4. compare-zone-runs.py, then start A/B on recombination rules (ML08, LL06).

Each step lands green against the existing law gates; the 45-zone project-a run is the
regression harness throughout.

---

## Implementation + A/B results (2026-08-14, same day)

All of the above landed (stage-list PromoteZone, TakeoffGeometry dedup −1,730 LOC,
census/triage/hygiene seams, recombination stages, report v2 + optionsHash,
compare-zone-runs.py, promotion public + on the live path in scripts.ts). 121 tests
green. Knobs are runtime-injectable in the harness via `PE_TAKEOFF_KNOBS`.

The A/B sweep (reports in `.artifacts/exp-e*.report.json`) settled the defaults now
in `TakeoffOptions`:

- **SmallZoneSqft = 750** — 17 of the 19 project-a zones ≤750 sf never produced an
  accepted room; the two that did (Main 00/07) are exactly the "user partitions
  explicitly" cases the rule intends.
- **Low-ink modulation stays OFF** — with band-composed ink, low ink ratio marks big
  *open* rooms that solve fine (Upper 10: 0.05 ratio, 100% conversion) and high
  ratio marks attic clutter. The ratio only means "wall density" once ink comes from
  the DWG lane; revisit then.
- **InkClusterWhiteoutCells = 100** — net +4 accepted rooms; attics transformed
  (Attic 00: 0→1 accepted, Attic 01: 2→3, ~1,700 sf junk-held cleared). Sole
  casualty: Lower 09 loses one room to a <60-cell load-bearing wall stub (whiteout
  60 is byte-identical to 100, so no threshold rescues it; the DWG ink lane will).
- **Absorb 60 sf / 0.45 share, EdgeBand 2.0 ft / 0.5 area** — original priors
  (0.6/0.8) never fire on real geometry (measured share ceiling 0.54; lattice rooms
  have 3–4 neighbors). Placement matters more than thresholds: the stages must run
  BEFORE the frame projector or their targets are already rejected.
- **Absorb 0.30 is a per-zone lever, not a default** — it cracks LL08 (+2 accepted,
  −4 held) and cleans ML08, but bulldozes good rooms elsewhere (net −3 rooms
  globally). Candidate for the per-zone adjustable-knob UI.
- Zero-cell-mask zones hold as `no-raster` (previously mislabeled solve/excluded).

Remaining known-bad after tuning: LL08/ML05 (need DWG wall ink — see
`zoning-plan-ink-feasibility.md`), ML08 lattice (per-zone absorb lever or DWG ink).

---

## Six-way tuning fan-out + zone authority (2026-08-14, evening)

### Fan-out verdicts

| Axis | Verdict | Grounding |
|---|---|---|
| **Frame drift relax** | **Adopted: 2.5 ft / 0.20** | The dominant single win. `frame:BoundaryDrift` was rejecting rooms whose only sin was a raster-resolution corner; the canonical editability audit — not these two numbers — is what actually stops sloppy geometry. |
| **Hybrid seeds, SeedClearFt 1.5** | **Adopted** | Coarser clearance plateaus, so fewer spurious watershed splits at pinches. |
| **Evidence weights** | **Structurally dead axis** | `CeilStep*`/`FloorStep*`/`BoundaryEvidenceMin` only modulate a boundary the *band-composed ink* already drew. Until ink comes from the DWG lane the weights are re-scoring one signal against itself; there is no second opinion for them to weigh. Revisit with DWG ink, not before. |
| **Second-pass rescue ladder** | **Dead end, not ported** | The drift magnitudes are the proof: rooms that failed the projector did not fail it *narrowly*, so re-projecting them in different company moves the same distance and fails again. What survived from that worktree is only the miss attribution that demonstrates this. |
| **Adaptive per-zone gating** | **Subtracts yield** | See below — measured −6 rooms. Ported (the seam is sound, deviations are reported) but its one live rule is falsified by the relax it now sits behind. |

### The zone-authority principle

Ink and the zone boundary are different kinds of thing, and the solver had been treating
both as evidence:

- **Ink is evidence.** It is a measurement of the drawing, it can be wrong, sparse, or
  cluttered, and a room that disagrees with it gets a *budget* — the drift law — inside
  which disagreement is tolerated and outside which the room is held.
- **The zone boundary is authority.** The user drew it to say where this takeoff ends. It
  is not a noisy observation of where the room is; it is the statement of where the room
  stops. Arguing with it is a category error.

Hence the new `zone-fit` stage (after `frame-projector`, before `tiny`): a room edge lying
within `ZoneSnapFt` of the zone boundary **snaps** onto it, and a room running past the
boundary is **clipped** by it — trimmed, not rejected. Neither is a relaxation: the fitted
room re-clears the same strict editability audit, area floor, containment, non-overlap, and
shared-edge survival as any other accepted room, and falls back to the pre-fit geometry
otherwise. The classic fallback is a zone edge cut diagonally across the room's frame,
where snapping would tilt the room off its rails — refused by measurement, not by a guess
about angles.

### Composite results (45 project-a zones, all law gates green in every run)

| Run | optionsHash | solved/held | rooms | accepted sf | held sf | excluded sf |
|---|---|---|---|---|---|---|
| Pre-change baseline | `ec6da308c8fa` | 25/20 | 31 | 4,622 | 35,278 | 16,607 |
| **Composite (new defaults)** | `746f415a4974` | 25/20 | **53** | **7,779** | 32,089 | 16,638 |
| Ablation: no zone-fit | `cb8d8ab51967` | 25/20 | 51 | 7,158 | 32,714 | 16,635 |
| Ablation: no adaptive | `1107b7da2049` | 25/20 | **59** | **7,894** | 32,044 | 16,568 |

**+22 rooms and +3,157 sf over baseline, with no zone losing a room** (the only per-zone
regression anywhere is Upper 00 at −3 sf). Biggest converts: Upper 07 +813 sf, Lower 08
+652, Lower 09 +473, Upper 06 0→350, Attic 01 +319, Lower 02 0→267.

**Zone-fit's isolated contribution is +2 rooms / +621 sf** — Attic 00 (+1 room, +268 sf)
and Upper 06 (0→1 room, +350 sf), plus 3 sf on Attic 01. Small, but Upper 06 had been
producing nothing at all. Event counts tell the honest story: **1 snap, 2 clips, 80
fallbacks across 16 zones**. Clip is the load-bearing half; snap is very nearly inert on
this model, because project-a' user-drawn zone lines rarely run parallel to the raster room
frames, so a snapped vertex usually tilts the room and the audit refuses. The guard is
working exactly as designed — but `ZoneSnapFt = 1.0` is buying one room, and the knob
deserves re-measurement (or retirement) rather than being assumed to earn its keep.

`scope:outside` fell 37 → 35. The expectation that zone-fit would largely convert the
scope-outside losses did **not** hold: those 35 rooms are not marginal overhangs, they are
rooms that leave the zone by more than a trim can fix.

### The adaptive policy is falsified by the relax it sits behind

`AdaptivePolicy` ships **on** by direction, and the measurement says that costs **6 rooms
and 115 sf**, entirely in the two zones its sparse-wall rule fires on:

| Zone | adaptive ON | adaptive OFF |
|---|---|---|
| Lower 08 | 8 rooms / 963 sf | 12 rooms / 1,074 sf |
| Lower 09 | 7 rooms / 669 sf | 9 rooms / 673 sf |

The rule (low ink ratio → absorb at 0.30) was calibrated when the projector held those
lattice cells at 1.5 ft / 10% drift, so folding them into neighbours was a strict gain.
Under 2.5 ft / 20% the projector now **accepts** those same cells as rooms, and the rule
spends them. The seam is sound and every deviation is reported into `report.json`, but the
one live rule should be recalibrated against the new drift budget or the default flipped
off — as it stands, `AdaptivePolicy=0` is the better run.

### Miss attribution

Frame rejections now carry the measured drift magnitudes (`RejectionDetails["drift/<id>"]`
= `area=… boundary=…ft`), recorded whenever a candidate polygon existed — including when a
*different* gate fired. This is what makes a tolerance sweep answerable: "the tolerance
rejected it" becomes "the tolerance would have had to reach X". It is also the evidence
that retired the second-pass rescue ladder.

`TakeoffSeedSource.DistanceMaxima` is restored last in the enum as the A/B control that
keeps Hybrid's contribution measurable rather than assumed.

### One collision worth knowing about

`SeedSource` now defaults to `Hybrid`, and `LevelProfile` only ever *upgrades* to Hybrid —
it never asks for `RegionCores` back. So the profile's "below-grade or non-flat levels use
region cores" rule no longer distinguishes anything: those levels arrive Hybrid too. That
matches what the fan-out actually measured (its `PE_TAKEOFF_KNOBS` override was applied
after inference, forcing Hybrid on every level), so the composite numbers above are honest.
But a deliberate domain rule has been silently subsumed by a default, and either the rule
or the default should be made explicit rather than left to override order.
