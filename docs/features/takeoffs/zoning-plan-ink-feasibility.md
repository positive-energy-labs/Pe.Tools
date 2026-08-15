# Zoning-plan-derived ink: live feasibility probe (2026-08-14)

Question: can the seed-ink raster come from the engineers' own zoning plan views
instead of our synthetic band-view export pipeline? Probed live against
ProjectA_Clone_Aug_11 (dev host, Revit 2025).

## What the probe did

1. Enumerated plan views: the model has `Mechanical Zoning Plan - {Lower, Main,
   Upper, Attic} Level` (template "Mech Zoning Plan", sheet M101) — exactly the four
   harness levels.
2. Exported "Main Level" and "Attic Level" verbatim via `doc.ExportImage`
   (ReadOnly, no transaction, 6000 px, crop-registered — crop box in model feet +
   FitToPage gives the exact affine).
3. Duplicated the Main Level zoning view, stripped it, re-exported (3 iterations).

## Findings

- **Verbatim zoning-plan pixels are NOT a good ink source.** Wall linework renders
  halftone mid-gray and shares its gray band with furniture, fixtures, and roof
  lines; annotations add ~1,200 small dark clusters (text, tags, section marks);
  zone color fills cover 8.5% of the image. Separation would need everything our
  pipeline already does, with less control.
- **But the zoning view encodes the per-project curation we currently rebuild from
  scratch**: crop extents, cut heights, and — decisive here — *which* background is
  authoritative. In project-a all four RVT/IFC links are hidden in the zoning views;
  the architecture is a **linked DWG per level** ("1 Main Level_projectA
  Ford_07.28.2026.dwg"). The engineers already decided what the building is.
- **The DWGs have layer discipline.** Layers arrive as subcategories: `A_WALL_1/3/7`,
  `A_XWALL`, `A_GLAZ` vs. clutter layers `A_FURN`, `A_FIXT`, `A_EQIP`, `A_STAR`,
  `A_MILL`, `A_PATT_*`, `A_ROOF_*`. Per-view subcategory visibility lets us show
  wall layers only.
- **Winning recipe (probe v4, verified)**: duplicate zoning view → detach template →
  hide all annotation + all model categories except DWG imports → hide all DWG
  layers except `A_WALL*`, `A_XWALL`, `A_GLAZ` → export. Result: pure wall ink,
  1.04% coverage, zero annotation, zero fills, no furniture/stairs/roof framing.
  The attic view's ink is the *architect's* attic plan (knee walls as drawn), and
  the zoning fills exclude unconditioned roof area entirely.
- Binarization note: stripped-DWG lines render anti-aliased mid-gray (~200); the
  current `px > 128` ink cutoff (ProjectionSeed.cs:311) would MISS them. Either
  lower the threshold for this lane or set a heavier projection line weight in the
  override (weight 5 was still thin at scale 1:192; consider exporting at larger
  PixelSize or bumping weight).

## Impact on the failure taxonomy

- LL08 clutter partitions: the stairs/fixtures/site ink that spawned them lives on
  non-wall DWG layers — gone at the source.
- Attic wander: roof framing / non-wall linework gone; ink = architect's walls.
- ML08 over-partitioning: partially helped (real closet walls remain real), still
  needs the recombination rules.

## Proposed shape (fits the seam architecture)

**Strategy preference settled by kaitpw 2026-08-14: SyntheticBands stays PRIMARY.**
Raster band capture was chosen originally because it is agnostic to every RVT model
topology (native walls, linked RVTs, CAD, IFC); the DWG-layer recipe only exists on
projects where the architect delivered layered DWGs *and* the engineers built zoning
views on them. Over-optimizing for the DWG scenario would rebuild the
topology-specific fragility the raster approach exists to avoid.

`SeedInk` becomes a strategy recorded in `DetectSnapshot.CaptureOptions` provenance:

1. **SyntheticBands** (default, topology-agnostic): current knee/header band
   composition. This is the lane that must keep working everywhere.
2. **ZoningPlanDwg** (opportunistic per-project accelerator, only when detected:
   `* Zoning Plan - <level>` views + a layered DWG import): derive a stripped seed
   view (recipe above, takeoff-owned + deleted after export like current seed
   views), export + stamp with the existing `StampPng`/INKP machinery. Record
   source view id, DWG name (its date-stamped filename is free provenance), layer
   keep-list. Revisit the preference in earnest when testing starts on new models
   with different topologies.

Heightfield (floor/ceiling physics from 3D links) is unchanged — only the ink
producer swaps. Everything downstream of `DetectSnapshot` is untouched, so the
whole zone-bounded harness, gates, and diagnostics apply to both lanes and A/B
comparison between lanes is just two report.json files.

Open items:
- Zone fills in the zoning views are not FilledRegions (4 incidental ones only) —
  fill source not identified; irrelevant for ink, possibly relevant later as a
  zones-mech.json cross-check.
- Layer keep-list (`A_WALL*`, `A_XWALL`, `A_GLAZ`) is a per-firm convention knob,
  belongs in TakeoffOptions with these as defaults.
- Door openings: A_DOOR hidden ⇒ doorways read as clean gaps ⇒ existing
  headerless-doorway closure (DoorGapMaxFt/DoorJambMinFt) is the closure path; the
  lintel/header band trick doesn't apply to DWG ink.
