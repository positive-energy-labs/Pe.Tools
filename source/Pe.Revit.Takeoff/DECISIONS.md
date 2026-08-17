# Takeoff decisions

Dated, append-only. Newest batch first. Each entry: what was decided, and the why that makes it stick. Reopen one only with new evidence — and record the reopening here.

## 2026-08-16 (round 2, R2b) — projection technicalities die with magnitudes; the gates were mostly right

**Adopted: fragment dissolve + detail repair in the projector (kaitpw-ruled at the round-2
summon).** MultiPolygon output (checkerboard pinch / orphan-across-strip) is dissolved by a
minimal axis bridge refused on rival cells; handle-scale-detail refusals get ONE de-jog attempt
whose expansion is carved out of every neighbor, renoded, and re-judged by the unmodified audit
under a never-uglier rule. `frame:InvalidGeometry` is extinct (bare refusals became
magnitude-carrying holds — what rejection mining needs), and repairs pay the same axis-L∞ drift
price as everything else. **The strong hypothesis was falsified**: most fragmented rooms hid
genuine lattice losses (Attic01 R02: 5.6 ft real drop behind the MultiPolygon mask) — held
correctly. On the merged incumbent the repair converts nothing (its LL08/LL09 targets were
already resolved by R2d/R2a) — adopted as robustness: H1 showed InvalidGeometry RISES when
partitions reshape, so this protects future gains from being eaten by representation debris.
**Honesty bar reformulated per kaitpw: per-zone** — no zone's own accepted edge-on-ink may
fall; the board mean is diagnostic only (dilution by ink-poor zones gaining honest rooms is a
statistical artifact). TUNING.md updated.

## 2026-08-16 (round 2, R2a) — one disease, three instances: axis-denominated motion priced in Euclidean

**Adopted: drift audit re-priced in world-axis L∞ against the de-staircased reference
(`FrameLocalProjector.AxisOrientedDistance`).** The boundary simplifier licenses a
`BoundarySimplifyFt` BOX of motion (2.0 ft in x and y) — which is 2.0 ft of Euclidean offset
perpendicular to an orthogonal wall but 2.83 ft perpendicular to a 45° wall. The Euclidean
Hausdorff charged rotated frames √2 for the same licensed motion: 45° drifts clustered at
2.59–2.98 against the 2.5 budget, argmax vectors perpendicular to the walls. Same disease as
the sealer's diagonal steps (round 1), same shape of fix; budget untouched. LL08 4→7 accepted,
UL02/UL03 +1 oracle room each, zero orthogonal-frame disposition changes, honesty up.
**ML09 falsified as a family member** — its holds are genuine wander (up to 18 ft); it needs a
different answer.

**Adopted: zone-fit squaring (`ZoneClipSquareFt = 1.0`).** Clipping manufactures off-frame
edges the audit then refuses (every off-frame edge in a fitted polygon is fit output by
construction — the room already passed canonical audit). The squarer re-decomposes such edges
along the frame, budgeted by the DISPLACEMENT the repair introduces (not edge length), and the
unmodified audit re-judges. Attic01 R05 + ML08 R03 convert (+520 sf honest), zonefit:fallback
58→46, Main 10's trivially-correct room finally clips cleanly. Standing falsifier: a kaitpw
A/B reading Attic01 R05's shape as junk → knob to 0.

Residual named instances for round 3: repair-debris dissolve (MicroStepRun after squaring —
Attic00 R01's 598 sf), paired-coverage fits (ML05's coordinated two-room refusals).

## 2026-08-16 (round 2, R2d) — door-head evidence is bounded to door scale

**Adopted: `DoorHeadMaxComponentFt = 9.0` + oversize-never-backs.** The door-head sealer's
lintel predicate had no width bound, so duct soffits and low basement ceilings sealed wholesale
(Lower: one 204 sf component, 33×49 ft bbox) and — worse — those cells counted as BACKING
evidence, manufacturing trust: LL08 read 0.68 backed on a 0.23 ink-only floor. Empirical cap
from the all-real-doors level: Upper's 95 door-head components top out at 8.25 ft. Components
over 9 ft now seal only their wall-adjacent fringe (new class `SealDoorHeadOversize`, still
closure so doorways under soffits keep closing) and never back a boundary
(`EvidenceInkDistance` counts `SealDoorHead` only). Result: LL08 4→1 accepted, LL06 4→3,
LL09 4→3, ML08 1→0 — **not one dead room was oracle-matched; recall is bit-identical** — board
savedWork flat (0.3784→0.3780), accepted edge-on-ink +2.4 pts, Upper's sealing 100% preserved.
LL08's board contribution was always fake. AMENDS 2026-08-14 "door-head seals count as backing":
still true, now only at door scale. Falsifier on record: a real >9 ft cased archway losing its
only backing — if a genuine archway room dies, re-key the bound on component MIN dimension
(strip vs blob), not bbox max.

## 2026-08-16 (adversarial wave 1) — the machine shrinks; both stage merges refuse to happen

**Adopted: six-knob kill + one dead rule, zones byte-identical, 125/125.** Deleted as
perturbation-proven inert: `SparseWallInkRatio`, `SparseWallMinRawRooms`,
`SparseWallAbsorbSharedPerimeterFraction` (unreachable behind `AdaptivePolicy=false`),
`SmallZoneLowInkSqft` + `MinZoneInkRatio` (two halves of a permanently-off conjunction whose
keying signal, inkRatio, was falsified as a discriminator this same day),
`InkClusterWhiteoutBboxFt` (never armed), and the LevelProfile `regionCores` seed rule +
`CeilingStepInkLiftMin` (only effect assigned the field's default; 08-14 sanction). The
`AdaptivePolicy` seam itself stays — a contract test now asserts it carries no live rules, and
the earned attic rule (keyed on `EdgeBandInkFraction`) is slated for it.

**Falsified — both stage-merge hypotheses, by their own experiments (gates earn their keep):**
`scope` is not a shadow of zonefit — disabling it breaks the containment law in 4 real zones
(it is the enforcement arm for rooms whose rescue clip was refused; "never binds alone" was true
of the histogram, false of the gate). `evidence` is not a duplicate of ink-backing — deleting it
lets a misaligned neighbor survive to shared-audit and kill ML08's good accepted room; it binds
earlier, at rail granularity.

**Oracle cleared; the audit lied, not the markups.** Lower's "floor mapping suspect" decomposed
into uniform page drift + the LL06/LL08 ink-starved quadrant (chamfer was measuring missing
detector ink) + stacked walls; floor labels correct across all 118 rooms. Main 10/14/15 are
genuinely empty (they stack under the Upper wing, correctly counted there). Scorer audit now
separates drift from starvation and names the 2 unzoned theatre-area rooms the board silently
dropped. Board numbers stand unchanged.

## 2026-08-16 (round 1 of the tuning orchestration) — five-agent wave on fresh homogeneous bins

Context: first recapture with the F/F0 framing veto live on all four levels (bins were previously
split-generation). New currency: `eval/rhvac/score-looks-good.py` savedWork (see
docs/features/takeoffs/TUNING.md); kaitpw A/B verdicts in worktree TASTE.md.

**Adopted:**

- **Wall-run scan thresholds are honored in feet on every scan direction
  (`Detector.BuildObstruction`, per-direction `maxGap`/`minRun` from `stepFt = CellFt·√2` on
  diagonals) + `DoorGapMaxFt` 4.5 → 6.0.** The angle-blind sealer defect deferred on 2026-08-15 is
  fixed: diagonal scans bridged 6.36 ft where 4.5 was declared and jammed 2.83 where 2.0 was.
  The fix alone unwound fat-plug propping in five zones (board slightly down); the honest 6.0
  gap re-tune on top recovers them: board savedWork 0.334 → 0.378, recall 0.276 → 0.336,
  edge-on-ink UP 0.848 → 0.868, Main 00 0→3 accepted, Attic 00 0→4 (first ever). kaitpw A/B:
  "better in every image"; the LL08/ML09 rooms lost in the retune "were no good in the first
  place" (LL08's was 0.636 edge-on-ink). 6.0 is valid ONLY on diagonal-honest steps — the old
  6.75 tombstone (angle-blind code) stands separately.
- **`SmallZoneSqft` is a user-exposed per-project toggle, default stays ~750 (700–800 band).**
  kaitpw: project-a is high-end residential; typical projects have smaller "small" rooms. Do not
  fixture-tune the default (X=730's +1 room is ML13-specific) and do not build pipeline behavior
  around the value. Full release (X=0) falsified as a free lunch: only 2/14 released oracle rooms
  convert; 4 are lost to missing (LL05 releases and solves to *nothing* — the residue evaporates).

**Falsified / re-sealed:**

- **`FrameMaxSourceDropFt` relaxation (3.5–8.0), re-swept on savedWork: fails honesty at every
  point.** The 2026-08-15 conjecture that drops are double-backstopped does not hold: every
  admitted room carries more unbacked boundary than the accepted mean (board edge-on-ink falls
  monotonically), 3.5–6.5 is a dead band, and the old "clean 547 sf LL08 room" converts
  un-oracle'd with swallow. Keep 2.5. Salvage note: UL06's 464 sf oracle room converts only at
  8.0 with decent edges — zone-conditional harvest territory, not a default.
- **Global `BoundarySnap 45/20` tombstone RE-SEALED on framing-clean ink.** Its exact named
  victims (Main 10's trivially-correct room, LL08 backing) reproduce — the damage was never
  framing noise. Per-zone reopening is EARNED (see round-2 slate): attic-scoped
  {snap 45/20, drift 3.0, support 0.375} converts Attic 00 0→1 and Attic 01 4→6 honestly
  in-zone, keyed on `edgeBandInkFraction ≤ ~0.35` — which cleanly separates attic (≤0.31) from
  every other rasterized zone (≥0.41) where the old key, inkRatio, is falsified as a
  discriminator (fresh attic 0.198–0.204 overlaps productive zones exactly).
- **`DoorJambMinFt` 1.5: strictly dominated** (ink stubs qualify as jambs; sealing balloons,
  accepted recall collapses).
- **Relaxing `InkBackedAcceptMin` is pointless, not just forbidden**: the ink gate blocks ZERO
  oracle-bearing rooms on fresh bins (10 rooms, 638 sf, all junk). Honesty is free; the
  direction is closed.

**Known, deferred to round 2:** the 45° measurement-inflation family (drift magnitudes at 45°
land at ≈ BoundarySimplifyFt·√2 — the drift metric inflates like the sealer did; diagonal-frame
strict editability blocks 24 held oracle rooms, the single largest pool); Attic 01 projection
defects (MultiPolygon / ExcessiveDetail); oracle floor-mapping audit (Lower chamfers better
against floor 1 than floor 0; Main 14/15 accept with zero oracle rooms).

## 2026-08-15 (the authority-vs-estimate batch) — three-agent fan-out, verified and merged

**Adopted:**

- **Declared zone angle beats the measured frame inside its own noise
  (`FrameLocalProjector.SnapToDeclaredFrames`, `FrameZoneSnapDeg = 1.0`).** ML05's rooms were never
  wrong — the raster frame estimator measured the wing at 45.267° against a zone drawn at exactly
  45.000°, and the 0.25° editability tolerance split that hair: every zone-fit clip read as
  `OffFrameEdge`, fell back, and the un-clipped room died at `scope:outside` (8 of 11 ML05 losses;
  drift was only 4). When the measured frame lands within `FrameZoneSnapDeg` of the zone's own
  dominant angle, the declared angle wins — it is KNOWN where the estimate is only inferred. Beyond
  the margin the measurement stands, so a zone at an angle its rooms don't share can never bend
  them. Board 59 → 69 accepted (+2,509 sf), ML05 3 → 7, only Attic 01 −1. Independently
  corroborated: the LL06/LL08 agent reached the same scope/zone-fit chain with no knowledge of this
  fix (48 rooms / 12,987 sf board-wide were dying whole for sub-1% overhangs whose trimming clip
  was refused on exactly this angle disagreement).
- **Boundary drift split into its two directions
  (`BoundaryDrift` = invention, projected→source; `SourceFeatureDrop` = drop, source→projected,
  `FrameMaxSourceDropFt = 2.5`).** The symmetric Hausdorff was one number for two failures of
  unequal dishonesty: INVENTION (an accepted boundary the detector never proposed) has no other
  backstop and keeps the tight tolerance; a DROP (a thin source appendage the rail lattice
  swallowed) is already bounded by the area-drift gate and by ink-backing. At the 2.5/2.5 defaults
  behavior is byte-identical to the old gate — the split is the measurement seam; whether drops
  deserve a looser leash (sweep says only ≥7.8 ft buys anything: one clean 547 sf LL08 room) is a
  deliberate follow-up, not a default slipped in.
- **Rejections carry their magnitudes (`frameDeg/support/srcArea/drop/invent` in details;
  `scope/<room> outside=N sf of M sf (P%)`).** Both agents' root causes were found by
  instrumentation-first missions; neither was findable while the gates reported bare counters. A
  tolerance rejection must state what the tolerance would have had to be.
- **Framing gets a low-support veto at capture (seed F/F0 pair,
  `knee = (A ∨ (F ∧ near(F0, 1.5 ft))) ∧ A2`, `FramingLowBandFt = 1.0`).** kaitpw spotted "ducts"
  in the attic crops; the live census showed no ducts (all MEP hidden, GenericModel fallback
  correctly off) but 4,200 of the attic band's 6,145 framing members were joists, blocking,
  rafters, plates, and sheathing — horizontal structure drawn as phantom wall ink. The knee AND
  kills sloped members (footprint shifts between cuts) but is blind to horizontal members riding
  through both knee cuts. A wall-former runs down to its plate; framing ink now only counts near
  the low-cut framing footprint. Raster-side because the framing lives in linked documents, which
  host views cannot element-hide.

**Rejected:**

- **`DoorGapMaxFt = 6.75` — decisively, twice-queued and now closed.** 59 → 40 rooms, −4,104 sf.
  The histogram is the proof: `doorHeadSqft` unchanged (369.3) while `wallRunGapSqft` doubles —
  the wider gap seals wall runs, not doors, scrambling the watershed (`NoCoherentFrame` 10 → 22)
  while contributing zero backing. Nothing recommends it at any stacking.
- **Zone-edge exemption for editability violations (mirroring the ink gate's exemption).**
  Correct-sounding, measured worse: clips commit that the FINAL editability gate (no exemption)
  then kills, −22 rooms outside the target zones. A zone-edge exemption is only coherent if it
  runs through the canonical editability contract end to end — a public-contract change, not a
  promotion-stage patch.
- **Global relaxation for attic gains (`BoundarySnap 45/20` + drift 4.5).** The +4 attic rooms are
  real (92/81% backed, crops clean) but the snap widening manufactures unbacked rooms elsewhere
  (LL08 −2 via `ink:unbacked`, Main 10's trivially-correct 1,284 sf room lost). Attic ink-ratios
  (0.26–0.34) that would key a per-zone adaptive rule are framing-noise-inflated — re-measure
  after the F/F0 recapture before designing that rule.

**Confirmed defect, deliberately deferred: the wall-run sealer is angle-blind.** In the 45° wing
its two diagonal scans run PARALLEL to the walls and fill whole corner triangles (95% of ML05's
199 sf of run plugs are diagonal-scan-owned; orthogonal ML08 is 100% H/V), and diagonal cell steps
are 0.354 ft against thresholds calibrated in 0.25 ft cells, so diagonal scans bridge 6.4 ft where
4.5 was declared. Disabling is catastrophic (59 → 32; the sealer is load-bearing), and fat plugs
currently prop up productive zones — the fix is a global re-tune that must happen on
framing-filtered ink. ML05's four remaining `frame:BoundaryDrift` holds (4.0–6.4 ft) are the
corner-notch victims; they are the next rooms to fall when this is fixed.

## 2026-08-14 (night: the diagonal-wing + honesty batch) — called-out zones root-caused

The four zones kaitpw called out (LL06, LL08, ML05, ML09) all live in the building's ~45°
rotated wing. Three independent defects stacked there; each got its own fix, all measured on the
45-zone harness, 127 tests green throughout.

**Adopted:**

- **De-staircase before any angle measurement (`FrameLocalProjector.DeStaircase`, DP 1.0 ft).** A
  45° wall traced from a 0.5 ft raster is a staircase of axis-aligned steps, and a staircase folds
  its ENTIRE length into the 0° bin of any raw-edge mod-90 histogram — the true frame is
  structurally invisible, not just noisy. `DominantFrames`, `FrameSupport`, and rail extraction all
  measure on simplified copies now (cell ownership keeps raw geometry). ML05 went 0 → 8-10
  accepted, clean 45° rooms on walls; aggregate 63 → 74 before gating.
- **Zone snapping is edge-wise and frame-preserving.** Vertex-wise nearest-point snapping was
  falsified: a lone vertex snapping across a zone jog onto a non-parallel segment tilts both
  adjacent edges, the strict audit refuses, the whole fit falls back, and the downstream scope gate
  kills the room ("snap poisons clip"). Now an EDGE moves only onto a near-parallel (≤3°) zone
  segment whose line both endpoints are within `ZoneSnapFt` of. And a snap is never allowed to sink
  a clip that stands alone: zone-fit tries snap+clip, then clip-only, before falling back.
- **Zone-fit refusals name themselves** (`RejectionDetails["zonefit/<id>"]`): invalid-or-tiny /
  still-overhangs / overlaps-neighbor / lost-shared-edge / editability with violation kinds. The
  diagonal-wing diagnosis was impossible while `zonefit:fallback` was a bare counter.
- **Flat levels keep wall-run sealing even when attic-classified.** project-a Main (sloped 0.50) vs
  Attic (0.55) are indistinguishable at level scale, and the attic-branch disarm starved Main's
  wings of closure entirely (ML05/ML09: zero rooms). Sealing arms wherever ceiling coverage is
  flat; what stops seal-manufactured rooms is the ink gate below, not the seal switch. (Attic 00
  and Attic 01 are zones on the SAME level wanting opposite sealing — no level-scoped switch can
  ever serve both.)
- **Ink-backing acceptance gate (`ink-backing` stage, `InkBackedAcceptMin = 0.5`).** Teal must mean
  trustworthy: an accepted room needs ≥50% of its non-zone-edge boundary on evidence ink, else it
  holds (`ink:unbacked`, per-room fraction recorded). Zone-edge samples are exempt — authority, not
  evidence. This is what converts LL08's 12-room fragment soup and Attic 01's seal-lattice into
  honest abstention, and it retroactively justifies arming sealing everywhere flat.
- **Door-head seals count as backing evidence (`DetectSnapshot.EvidenceInkDistance`).** A door-head
  closure derives from real model door geometry; a room bounded by its own doorway is legitimately
  backed. Wall-run and gap-close plugs stay heuristic and do NOT back a boundary. Measured: LL08
  0 → 5 accepted at 0.70 backing, LL06 backing 0.55 → 0.75.
- **`OST_GenericModel` is fallback wall ink, not a peer category (`ProjectionSeed`).** Live-proven
  root cause of the "ductwork and equipment coming through" noise: the band whitelist admitted
  GenericModel for IFC-walls-as-DirectShapes agnosticism, but in project-a the IFC's GenericModel
  members are equipment proxies ('Undefined', full-height) and round piers ('3P0-17') — the LL06/
  LL08 blob clusters — while actual walls arrive as Structural Framing studs (1,495 in LL06's
  quadrant alone). GenericModel is now admitted only when recognized wall categories are absent
  from the band (<50 elements), mirroring the DWG wall-layer precedent. NOT adopted: mirroring the
  sheeted zoning view's settings wholesale — the engineers element-hide the entire IFC link there
  (their background is the flat DWG), which would delete the primary lane's only wall source.

**Falsified / rejected this batch:**

- Vertex-wise zone snapping (see above; the test
  `Zone_fit_falls_back_when_the_zone_edge_runs_diagonal_to_the_room_frame` now records the
  edge-wise contract).
- Level-scoped seal discrimination between Main and Attic (indistinguishable profiles).
- Raw-edge frame histograms on raster-traced geometry (blind to rotated frames by construction).

## 2026-08-14 (seam refactor + six-way tuning fan-out) — patterns adopted, axes closed

Full evidence: `docs/features/takeoffs/solver-architecture-reeval.md` (A/B appendix + composite
table) and `docs/features/takeoffs/zoning-plan-ink-feasibility.md`. Composite outcome: 31 → 59
accepted rooms (17% → 27% conversion) on the 45-zone project-a harness, no zone losing a room, all
laws green, 127 tests.

**Adopted patterns:**

- **Ink is evidence; the zone is authority.** Two different fidelity rules, never conflated. A
  boundary must stay near its measured ink ("never bent to fit" = the frame drift gate). But the
  zone boundary is a user declaration: rooms are clipped/snapped to it (`zone-fit` stage), never
  rejected merely for grazing it. kaitpw: clipping and snapping are non-negotiable.
- **An audit may never be tighter than the transform it audits.** The frame gate's 1.5 ft drift
  budget rejected motion `BoundarySimplifyFt = 2.0` had licensed — a self-inconsistency costing
  ~15 rooms. Now `FrameMaxBoundaryDriftFt = 2.5`, `FrameMaxAreaDrift = 0.20`; do not go past
  3.0 ft — at 4.0 the gate stops firing and mean ink-backing turns down (the harness stops
  measuring safety).
- **Hybrid seeding, `SeedClearFt = 1.5`.** Unimodal peak, measured 45 > 42 > 39 > 36 > 32
  accepted at 1.0/1.5/2.0/3.0/4.5. Splits open-plan cores at real evidence ridges; the merge
  criterion re-merges unbacked splits, so finer seeding adds candidates without adding a new way
  to be wrong.
- **Knobs-not-consts + self-describing artifacts.** Every tuned threshold lives in
  `TakeoffOptions`; every report carries the effective options + hash (per level). A number that
  can't be varied in an experiment can't be defended in a default.
- **Recombination runs before the frame projector.** Absorb/edge-band placed after it never fire —
  their targets are already rejected. Placement beat thresholds by an order of magnitude.
- **Triage holds are labeled by cause.** Zero-raster zones hold as `no-raster`, never
  `small-zone` — a raster failure must not masquerade as a policy decision.
- **Drift-magnitude capture on every frame rejection** (`RejectionDetails["drift/<id>"]`): ten
  lines that turned "20 zones held and nobody knows why" into ranked, quantified causes. Keep.
- **Regularizer frame snap widened: `BoundarySnapToleranceDeg 35`, `BoundarySnapShortDeg 12`**
  (+4 rooms, BoundaryDrift 25→21, ink-backing and shared-edge losses flat). SnapTol 45/20 is a
  per-zone area-dominant lever (+sf, −rooms, −0.03 ink). Short edges must stay conservative —
  45/45 collapsed.
- **Door/window closures are visible.** Three seal classes attributed at the source
  (gap-close / door-head / wall-run), persisted as deterministic INKP bins, drawn on every panel,
  closure sqft in the subtitle (old `closure` slot was the accounting residual — renamed `leak`).
  Found by rendering: Main Level never arms wall-run sealing (sloped-ceiling fraction trips the
  attic branch) — open question, now observable.

**Closed axes (do not re-try without new evidence):**

- **Evidence-weight tuning is structurally dead under core seeding.** Boundary support is
  identically 1.0 (seeds are components of `domain ∧ ¬obst`, so shared boundaries sit on
  obstruction cells where evidence = 1). `MinBoundarySupport` ≤ 1 is a no-op; > 1 collapses
  everything. Making it live requires measuring support pre-flood or excluding obstruction cells.
- **A second-chance rescue pass for held rooms cannot work at any lawful threshold.** Held rooms
  need median 2.7 ft / max 8.3 ft of drift to pass — they are genuinely non-rectilinear watershed
  outlines (band-ink artifact), not near-misses.
- **Census-adaptive per-zone knobs are OFF (`AdaptivePolicy = false`).** The one live rule
  (sparse-ink → absorb 0.30) was a +3-room win under the old tight projector and a measured
  −6-room cost under the relaxed one — per-zone adaptation calibrated against one gate
  configuration does not survive a change to that gate. The seam stays (pure, attributed via
  `adaptedKnobs`); rearm only after recalibration. Corollary: `inkRatio` cleanly separates
  sparse-partition zones (≤0.056) from certified ones (≥0.121) on project-a — the signal is real
  even though the rule is currently unearned.
- **Absorb share thresholds: measured ceiling is 0.54** (rooms have 3–4 neighbors; no one
  neighbor holds 60% of a perimeter). Defaults 0.45/0.5; 0.30 remains a falsified-as-default,
  plausible-per-zone lever.
- **DWG-derived zoning-plan ink is opportunistic, not primary (kaitpw).** Raster band capture
  exists because it is agnostic to model topology; the DWG-layer strip (proven live on projectA)
  only exists where layered DWGs + zoning views do. Revisit when testing new models.
- **`LevelProfile` only upgrades toward Hybrid; the below-grade → RegionCores rule is dead by
  override order** now that Hybrid is the default. Deliberate domain rule silently subsumed —
  revive it consciously or delete it, don't rediscover it.
- **`BoundarySimplifyFt` coarsening falsified twice** (2.5 and 3.0): it buys BoundaryDrift
  reductions by killing rooms — zonefit fallbacks and scope:outside rise. Cleaner-looking
  outlines are not better-fitting outlines.
- **Under-sealing destroys Lower Level**: `GapSealFt` 1.5→1.0 took Lower from 27 to 6 accepted
  rooms; `DoorGapMaxFt` down likewise. Foundation-wall ink needs the full seal. `DoorGapMaxFt`
  UP to 6.75 gains +616 sf but costs mean ink-backing 0.676→0.646 — HELD, not shipped, pending
  the ink-backing-as-gate decision; if ink-backing becomes a gate, re-measure it behind that gate.
- **Aggregate conversion is a proxy that diverged from the goal.** The composite raised accepted
  rooms 31→59 while the user's called-out zones (LL08/ML05/ML09) did not visually improve: LL08's
  12 accepted are 10% ink-backed fragments; ML05/ML09 accept nothing at 0% ink-backing because
  their wall ink barely exists in the band raster. Ink starvation is the binding constraint
  (third independent confirmation). Candidate correction under review: per-room ink-backing
  acceptance gate (zone-edge segments exempt — zone is authority), headline metric becomes
  well-backed accepted sf.

## 2026-08-14 (zone promotion loop) — exact scope and editability are binding

- **The exact Zoning Region geometry is the accounting universe.** Promotion receives the
  `ZoneScope`; accepted + held + void + excluded must equal its polygonal area within numerical
  precision. Uncaptured scope is an explicit excluded region, never area that disappears from a
  detector-derived denominator.
- **Promotion fails closed.** A projected room that leaves its zone, loses a source adjacency, or
  fails canonical editability is held whole using its source geometry. Only accepted regions reach
  the Room Region materializer. Area, ink, and rejection counts remain diagnostics.
- **One shared network remains mandatory.** The raster partition needs
  `SpaceBoundaryNetwork` to recover coherent long-edge frames; removing it made all 183 projectA
  candidates frame-incoherent. `FrameLocalProjector` then uses one rail set per connected local
  frame, and a final adjacency audit holds both sides of any lost shared edge.
- **The tuning loop is per-zone and visually reviewable.** Frozen level evidence is prepared once,
  cropped per zone, and evaluated across all 45 project-a zones in about 20 seconds. The report carries
  exact zone loops, enclosing-zone area, per-room rejection detail, shared-edge preservation, and
  a translucent disposition contact sheet so the registered plan remains visible.
- **The 30-sf rule is only a first-run unlabeled-pocket heuristic.** project-a `.r10` contains a real
  standalone 23-sf Guest Suite Laundry with its own load and register. A small candidate may merge
  only with exactly one neighbor when the union stays strict; linked or designer-authored rooms
  must never be merged merely because they are small.
- **Short shared rails are architectural evidence, not raster noise by default.** Retaining
  orthogonal rails down to 0.75 ft improved the frozen all-zone result from 31 to 34 accepted rooms,
  accepted area from 4,324 to 4,683 sf, and preserved shared adjacencies from 7 to 11, with zero
  lost pairs and every hard law still green. Lower thresholds remain unproven.

## 2026-08-14 (live Revit, later) — Room Region materialization live-proven

`ZoneMaterializer` on the project-a clone, real zoning view ("Mechanical Zoning Plan - Main Level"),
11 real detected rooms from Main Level zone #05: first run created 11 Room Region FRs stamped
role/GUID/provenance through `TakeoffCarriers`; the immediate rerun created 0, re-bound 11/11 by
the geometric anchor law (label-point containment + area +/-20%), orphaned 0, 11 distinct GUIDs
stable. Reruns never touch an existing region — unmatched rooms are created, orphans are reported,
nothing is modified or deleted (propose-never-overwrite at the materialization layer). Held
residue draws only when the zone has none yet. Rebind ambiguity resolves to best area ratio and
the loser stays unmatched. FR-only; no Spaces anywhere in the path.

## 2026-08-14 (live Revit) — FR carriers and registry blob proven; TakeoffCarriers live-verified

Live-probed in the project-a cloud clone (Revit 2025, dev payload) via `scripting.execute`:

- **FR shared-param write round-trip PROVEN.** A text param bound through our own
  `SharedParameterBinder` (instance binding, Detail Items category) landed on all 9,212
  FilledRegions; set + Regenerate round-trips in-transaction and reads back identically from a
  separate later call. The persistence-layer hypothesis under every data home is now fact.
- **Registry blob capacity PROVEN to 1 MB** on a hidden Project Information text param
  (1 KB / 32 KB / 256 KB / 1 MB all round-trip byte-identical).
- **`TakeoffCarriers` live-verified**: EnsureBindings + WriteIdentity/ReadIdentity +
  provenance blob on a real FR; System registry write/read through the fail-closed codec;
  `Reconcile` on live data surfaced the rename question correctly (vanished FC-13 + appeared
  WS-1 = 1 candidate pair). Pe.Revit.Takeoff gained its one ProjectReference (Pe.Revit) for the
  binder — the sanctioned persistence path; the library stays otherwise leaf.
- Residual: carrier survival across save/sync/reopen is standard Revit project-param behavior;
  spot-check on the first model that syncs. Probe params (`_PE_TakeoffProbe*`) live only in the
  unsaved clone session.
- Ops note: adding a new source file (or any csproj change) puts hot reload into
  restart-required by design — converge --restart cycles Revit and drops open documents; reopen
  via `revit.apply.document.open`. Not an SDK bug.

## 2026-08-14 (live RHVAC) — surgical sync accepted and recalculated by RHVAC 10

Live-probed in Elite RHVAC 10.01.57 on a disposable copy of projectA. `sync-rhvac.ps1`
updated only Room Identifier 1: name `Golf Sim 005` → `Golf Sim 005 SYNC PROBE` and area
1485 → 1600 sf. RHVAC opened the output without a repair/conversion error; its Room Data view
showed the new name and area. Opening Load Preview recalculated the project, and saving persisted
the fresh results.

- Building area moved exactly +115 sf, 51559.8008 → 51674.8008.
- System 1 cooling net load moved +47 Btuh, 4009.5569 → 4056.5569; heating load moved
  +102 Btuh, 7604.6611 → 7706.6611. Its fixed actual airflow remained 600 CFM.
- Building cooling net changed 488173.4375 → 486648.9375 and heating changed 483396.625 →
  483498.625. The building cooling direction is not attributable solely to this room because the
  full RHVAC recalculation refreshed project-wide previously persisted results; the edited
  system's heating and cooling both moved upward as expected.
- A fresh extract found all 149 other rooms' modeled inputs projection-identical to the
  pre-open synced file. No calculation error was reported.

This closes the RHVAC-open/recalculation residual for surgical UPDATE. The optional orphaned
`SystemNumber` and `DefaultRoom`-clone INSERT live probes remain unrun; they do not block the
proven update path.

## 2026-08-14 (later) — the review surface and the `.r10` reversal

Settled in a mock-driven session (decision-queue mock v2, judged against the live `/rhvac` plan-pane pattern).

- **Pending proposals are session-ephemeral; decisions write through.** The review surface holds no batch-commit state: every accept/dismiss is an op persisting to the datum's home at click time, and the solver's determinism (same model + zone + constants → same proposal) makes a lost session cost one rerun, never a decision. This deleted the "proposal blob" idea before it was born — an ephemeral queue is admissible precisely because nothing pending accumulates.
- **Held data conflicts are the one persisted pending state** — a marker on the surviving Room Region's blob, because export-blocking state cannot be session-scoped. Removals do not hold: confirming a removal orphans the room's `.r10` data with a stale flag rather than deleting it.
- **Two-verb review vocabulary.** accept = take the recalc's proposal, dismiss = keep the designer's state, uniform across shape/new/removal/drift rows; merges are the only multi-choice row. Mirrors the surviving `plan-pane.tsx` FlagQueue — one row per decision, inline verbs, no cards, no severity taxonomy. Web UI carries no geometry verbs (reaffirming the purge); shape work deep-links to Revit.
- **Drift is measured, not forbidden.** Closure is a partition-time invariant; hand-edit drift reports against a project-constant threshold (starting 20 sf — a constant in one place, not a UI lever) and blocks export only above it. Edge-snap reconciliation arrives as a rerun proposal row, never silently.
- **The zone is the rerun unit; no sub-zone rerun, no exposed knobs.** Partial accept is free (rows are independent); accepted rooms are pinned by GUID re-binding so a zone rerun cannot disturb them — granularity without a dice lever. Determinism is the anti-dice-rolling law: rerunning an unchanged model returns the identical proposal. A designer needing per-zone constant tuning is a promotion-gate bug to file, not a knob to expose.
- **REOPENED: export "never in place" (set earlier today) → surgical sync.** New evidence: remaking the file violates one-home-per-datum — the `.r10` is the home for Manual J data *and* for RHVAC-native edits this pipeline will never model (equipment picks, duct settings, overrides), all destroyed by a remake; and file-identity churn was rotting the `{file identity, Identifier}` link every export. New shape: upsert by `Identifier` on geometry-owned fields only, insert new rooms, park removals stale, touch nothing else. Safety survives as copy → validate → atomic swap + timestamped backup ("never destructively" replaces "never in place"). New proof obligations (README): Jet upsert round-trip that RHVAC still opens and recalcs; lock detection; plus an adoption path for pre-existing files (match by name once, then `Identifier` forever).

## 2026-08-14 — the zone-bounded spec

Settled in a grilled design session against five audits (feedback loops, architecture, UI, git-history census, four-surface project-a reconciliation) plus the firm's Manual J training deck.

- **One home per datum is the governing law.** Split-brain state (the resolutions sidecar and its independently-implemented TS twin; Spaces vs detector TSVs as competing writable geometry) caused silent work loss in the prior era. Every datum gets exactly one authoring home; all else is projection.
- **Detector domain is the Zoning Region, not the level** (inherited from the pivot, restated as binding). Coverage % against a level is retired — the ceiling was engineer intent, not geometry. Whole-level entry points survive only as convenience wrappers, if at all.
- **No extensible storage — repo-hard rule.** Broken ES schemas can crash Revit. Sanctioned carriers: Pe shared parameters bound through `SharedParameterBinder`, and versioned fail-closed JSON-blob parameters (the `_PE_ParameterLinksProfile` pattern). Known legacy exception: Autotag, to be unwound (likely onto Parameter Links). Takeoff's own `PeTakeoffOwnership` ES fallback in `SpaceMaterializer` gets deleted with the Spaces-primary path.
- **FR carrier: Pe shared params via Detail-Items instance binding.** Live-probed in the project-a clone (Revit 2025): `OST_FilledRegion.AllowsBoundParameters == false`, but the architect's own `Filter`/`Graphics Filter` shared params — instance-bound to a ~100-category set including Detail Items — appear writable on FR instances. `Mark`/`Comments` stay free for humans. Write round-trip is a standing proof obligation (README).
- **System is a first-class entity**: stable GUID + mutable user tag, in a model-owned registry blob on Project Information. project-a evidence forced this: the `systemNumber ↔ FC-n` binding existed only as hand-typed prose in one xlsx cell; tags were renamed mid-project (IU→WS) leaving the issued legend stale; multi-tag zones (`FC-8, FC-13`) and cross-level systems (FC-6, FC-9, FC-17) are ~15% of the project. Zones carry tags (human-authored); validate resolves against the registry; a vanished+appeared tag pair is asked about explicitly — rename or new system — never guessed.
- **Equipment ↔ zone is a tag join at query time.** Equipment already carries `PE_G___TagInstance` (office standard; nothing in this repo writes it). No persisted element-to-element links: the Parameter Links engine's relationship model is a closed topology enum, and a declared-edge graph store is the wrong machinery for what a join over two parameter sets answers. Validate reports dangling tags on both sides — which would have caught project-a' phantom `IU-2` and the unparsed `UH-2-4` range form.
- **Reruns are explicit, per zone. Nothing watches for architectural change.** Arch revisions arrive as relinked models with possibly shifted coordinates; deciding "things moved" is the designer's call (zone redraw or explicit rerun), not an automatic diff — automating it would smuggle in design decisions nobody asked for.
- **Recalc proposes; the designer's shape wins until accepted.** The prior era's native-readback lane silently discarded human decisions when Revit edits superseded them — the trust-destroying default. Geometry merges are proposals; data merges (two accepted rooms with `.r10` data collapsing into one) are held unresolved and block export.
- **Room type lives on the Room Region FR** (`PE_M___RoomType`, closed vocabulary from the PE equipment table). It is upstream input that must survive revisions; the `.r10` holds only derived values (people, equipment Btuh); the assists are the deterministic function between them. Grid shows it with provenance and writes back through an op.
- **`.r10` room link = `{file identity, Identifier}` in the Room Region provenance blob.** `Identifier` is an RHVAC autonumber PK meaningful only against one file — pairing prevents silent rot on file swap. The prior string join (`{number}-{name}`) survived project-a 150/150 only because nothing had been renamed yet.
- **Spaces are out of the critical path.** Nothing between zone declaration and `.r10` export needs one; the project-a clone's only spatial elements were 61 orphaned `PE-TAKEOFF` Spaces from an old run. A derive-spaces op stays open as a future feature (Revit-native capabilities, real 3D geometry).
- **Scope calls**: reconciliation report in, and it writes nothing — minimal blast radius while trust builds. FOM→equipment write-back out of v1 (uncomfortable making equipment writable from this pipeline yet). ManS workbook generation out; its `Load Preview Data Link` table recombines RHVAC paste + FOM + cutsheet data whose boundaries aren't mapped yet. Review-surface and system-view UI shapes go to prototype, not spec — same phase as the old-code purge and arch revamp.
- **Dev-lane build-out, installability as constraint.** Real promotion is premature at this maturity, but no new `sourceRoot` dependencies and package-relative script resolution from day one, so shipping is packaging rather than rework.
- **Metrics: conservation gates, not scores.** Five oracle-free gates (accounting closure, scope containment, identity stability, edit preservation, no vacuous pass) + non-gating diagnostics. The old scorer's gates failed permanently by 2–4× and two actively rewarded falsified behavior (count-ratio rewarded open-plan blobs; zero-junk punished the flag-don't-reject law).

## Inherited from the whole-level campaign (2026-06 → 2026-08)

Laws with their earned evidence, so nobody relitigates:

- **STRAIGHT-ONLY** — curve/hole ambition shipped diagonal artifacts across whole plans; removed wholesale 2026-07-12.
- **Drop, don't mangle** — a missing room is one human fix; a warped polygon is un-diagnosable.
- **Editability over area fidelity** — raw raster staircases made FRs literally un-editable (one editable wall of 82); straightened-but-drifted edges are rejected, not shipped.
- **Flag, don't reject** — the width threshold that kills narrow junk also kills a real 31.9-sf mech room; junk/real is geometrically inseparable at 0.25-ft cells. Only ceiling-height variance earned junk-flag status (93.4% precision, 71% recall).
- **Identity must be geometric, never rank** — `R{rank}` ids reshuffle on any rerun; label-point + area ±20% re-anchored 100% on a shuffle fixture.
- **Counts aren't proof** — every claim pairs a plan-image checkpoint with a deterministic census.
- **Boundary convention (locked 2026-07-03)**: centerline on interior partitions, outside-face on envelope — matches the firm's taught ASHRAE measuring rule exactly; finish-face undershoots real areas 15–25%.
- **Rooms are one shared coverage** — per-room repairs can't agree on shared edges; simplify all rooms together so a shared edge gets one identical replacement.

Falsified — do not re-try (each implemented and measured; the number is the tombstone):

- Vector wall harvest: 47.7% recall vs raster 51.9%.
- Typed IFC openings: all 55,634 imported objects untyped proxies.
- Finer cells (1.5-in/1-in): no junk/real separation window at 4.4–10.8× cost.
- Junction pairing by owner identity: 87→84 failures, needed ≤35.
- DistanceMaxima seeding: under-seeds closets/baths (41.9 vs 52.8); hybrid wins.
- Pure-shape junk flags: 97.4% precision at 30% recall — useless alone.
- MinCompactness as room-killer: amputated 86% of a level's area.
- Machine-straightness ceiling: 23.5% of rooms regularize under a 3% area-honesty contract — the rest is exactly the human hand-editing the zone-bounded flow assumes.
- Coverage %/mean IoU as goals: saturated ~0.54 against fuzzy oracle registration, circular by construction ("area-matched then area-scored").
- Native readback as canonical (P9, built then reversed): hand-edited Spaces flowing back as truth recreated competing writable state; the instinct (human edits win) was right, the artifact was wrong — it now lands on Room Region FRs.
