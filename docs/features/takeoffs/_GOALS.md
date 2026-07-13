# Takeoffs

## North star

Convert native Revit, linked Revit, IFC, and CAD building evidence into simplified spatial
geometry suitable for RHVAC and OpenStudio/EnergyPlus. The first product slice is complete,
inspectable room coverage on each intended level.

Detection and Revit element choice are separate concerns. Detection emits neutral takeoff
regions with geometry, provenance, confidence, and evidence. For MEP and energy workflows,
accepted regions normally materialize as host `Space` elements. `Room` is appropriate when the
workflow owns architectural room-program semantics. `Zone` groups accepted Spaces for shared
thermostatic control; it is not a room detector or room substitute.

On models whose source geometry cannot bound native spatial elements, accepted shared-partition
edges materialize as marker-owned host Space Separation Lines before one Space is placed per
accepted region. The target phase is explicit. Replacement and cleanup touch only marker-owned
Spaces, lines, and work views; existing user Spaces are a fail-fast conflict, never collateral.

## Product behavior

Pea runs the deterministic detector, presents native visible draft regions plus image and
topology evidence, and reports every target region as accepted, intentionally excluded, or
unresolved. The engineer can correct or accept the draft, after which Pea rescans only affected
or ambiguous regions and graduates accepted regions to Spaces. Fully automatic operation is the
goal, but the human-Pea draft loop is a first-class product path rather than a failure mode.

The useful correction vocabulary is small: missing region, leaked/merged region, split region,
false region, and ambiguous boundary. Corrections should refer to visible model evidence and be
replayable; opaque JSON-only edits are not an acceptable collaboration seam.

## Partition geometry

Detected regions form one shared building partition, not independently beautified polygons. Every
interior boundary is a single edge shared by two regions at the wall centerline; envelope edges use
the outside wall face. Shared vertices and edges must be coincident, so accepted regions leave no
wall-thickness gaps or overlaps between them.

Regularization follows evidence under the STRAIGHT-ONLY LAW (2026-07-12): every shipped segment is
either on a consensus wall line or an axis-aligned connector between wall lines; curves and
free-floating diagonals are never invented. A region the priors cannot explain is DROPPED WHOLE —
a visibly missing room is an easy human fix, a mangled shape is bewildering. Residual cells are
classified before they are claimed. Wall mass may collapse into the shared boundary and small
floor/headroom-valid slivers may join a neighboring region; shafts, columns, voids, exterior space,
and ambiguous residuals remain excluded or reviewable. Geometric neatness alone is never evidence
that space belongs to a room.

## Accuracy and proof

"100% coverage" means every in-scope occupiable region is classified, not merely that the model
contains some Rooms or Spaces. Coverage must be scored against a ground-truth plan image with at
least one labeled point per intended region, while also reporting merges, splits, false regions,
intentional exclusions, and unresolved regions.

Every tuning iteration keeps real-image checkpoints: untouched plan, projection bands, combined
ink, floor/ceiling/headroom fields, accepted and rejected components, final polygons, and the
Revit-native overlay. Images are paired with a deterministic census; neither screenshots nor
element counts alone prove accuracy.

## Current Chadds direction

The framing-stage Chadds IFC contains DirectShapes rather than useful Rooms, Spaces, Walls, or
energy-analysis spaces. Revit plan views are not reliable boundary evidence for this model: live
image proof showed that they project IFC DirectShape geometry from adjacent stories even when the
view range is correctly constrained to a one-foot band. Boundary seeds therefore use Revit's
renderer through top-down orthographic 3D views with physical section boxes at the sampled world-Z
bands. The heightfield remains the physics gate for floor, ceiling, headroom, courtyards, terraces,
and voids. Keep the algorithm in `Pe.Revit.Takeoff`; keep Pea's recon/review/refine choreography
outside the deterministic library.

Competing experiments should share the same image truth and scorecard. Recapitulate only the
smallest changes that improve measured coverage; do not preserve experimental pipelines merely
because they worked once.

Current Upper-level checkpoint (2026-07-10): physical section seeds, a 1.5-foot ink close, 0.30
ceiling-fraction gate, 20-square-foot candidate floor, and 0.09 compactness gate produce 61 room
cores / 11,301 square feet, cover 22 of 24 raw points where the independent VGPrint and heightfield
experiments agree, and keep the open courtyard empty. A bounded one-foot geodesic partition pass
then assigns 1,966 square feet of connected physical wall ink to those cores, producing 61 shared-
edge regions / 13,267 square feet with zero Revit FilledRegion failures. The valid long circulation
room scores 0.095 compactness; the two rejected exterior snakes score 0.041 and 0.026. Image review
still flags two small drafts for human rejection: a roof/turret pocket and a diagonal sliver.

The same checkpoint now materializes successfully in R2025 as 61 host MEP Spaces in the explicit
`Future` phase on `Level 2/Upper Level`, bounded by one shared network of 343 Space Separation
Lines. Open shared paths preserve their topological endpoints and simplify directly to physical
wall runs; they never reintroduce a midpoint dogleg merely to preserve raster area. A committed-
model census reports 13,331.2 square feet, 132,422 cubic feet, and zero bad
areas, volumes, or boundary loops; every Space has exactly one boundary loop. The partition pass
re-solves 154 square feet of small enclosed residual pockets instead of leaving holes. A strict,
area-preserving physical fit selects only high-confidence irregular regions; on Chadds it selects
R03 from geometry rather than identity and reduces its native boundary to seven physical wall
segments (18 API fragments split at network junctions), one loop, and 906.343 square feet.
Validation and overlays use `Space.GetBoundarySegments()`, not polygons redrawn from detector TSV.
