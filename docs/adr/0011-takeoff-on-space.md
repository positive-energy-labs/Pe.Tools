---
status: proposed
---

# Room takeoff partitions on Pe.Revit.Space, not on rendered pixels

## Context

The takeoff partition (step 3 of `source/Pe.Revit.Takeoff/README.md`) finds rooms inside a
designer-drawn Zoning Region. Today it reads wall evidence by creating up to seven views per level,
exporting them as PNG, and flood-filling the raster. The wall source is not Wall elements; projectA
has none. Enclosure is IFC Structural Framing, Columns and Generic Models plus the per-level
architectural DWG, and the raster pipeline exists to turn that geometry into pixels and then back
into straight walls.

A census of the package on 2026-09-06 (`.artifacts/runs/takeoff-geom-20260906/census`) measured
the cost of that round trip. Of 10,622 LOC, 61.2% by adjusted line range is raster tax:
de-staircasing, frame election, rail projection, snapping, squaring, de-jogging. Of the 80
`TakeoffOptions` knobs, 43 exist only because evidence arrives as pixels. The domain kernel is
27 capabilities in 3,520 LOC. The pipeline also mutates the document to read it: views are
created, category visibility is rewritten, and `ExportImage` is called outside a transaction.

`Pe.Revit.Space` now holds a resident triangle soup of host plus IFC link with DWG layers raised
as `Curve2D` ribbons, and three proven verbs: `Slice` (exact 2D footprint of a z band, piece-for-
piece identical to the reference export), `Probe` (first hit down and up from a point), and
element-id exclusion on `Filter`. An evidence census on the exported slices found that the
raster's "ink starvation" was a capture loss: nine zones that carry oracle rooms and that the
raster emptied (Main Level 00/03/04/11/12/13, Upper Level 08, Attic Level 00/02) measure 0.86 to
0.99 perimeter backing on exact geometry. Real starvation exists on one level, Lower Level,
which ships no architectural DWG. A union-close solve on the slices produced a clean partition of
Main Level#09's 45 degree wing with no staircase in 4 to 8 s per zone of single-threaded Python;
the header band seals doorways and a 0.75 ft closing never bridges one.

## Decision

The partition runs on `Pe.Revit.Space`. A new package `Pe.Revit.Partition` owns it: it asks
`Verbs.Slice` for the knee and header bands inside the zone, buffers the pieces to a thin ink,
closes each band, unions them, subtracts from the zone, and the faces are the rooms. Existence is
asked with `Verbs.Probe` per face. Every answer carries the Space `Stamp`, so freshness and the
resolved enclosure filter travel with the rooms.

`Pe.Revit.Takeoff` keeps identity, materialization, carriers, registry, TSV and RHVAC and calls
`Pe.Revit.Partition` for step 3. The twelve raster files, the four mixed files' raster halves and
the 43 raster knobs are deleted, not bridged. The solver never writes to the document.

Enclosure is declared, never inferred: the filter names IFC categories and DWG wall layers, and
the answer echoes what it used. A zone with no enclosure inside it is held whole with a reason;
a room whose boundary is nothing but zone edge is held, never accepted.

The domain laws stand unchanged: zone is authority, ink is evidence, rooms are a partition,
accounting closes to 1e-6 sf, held beats guessed. Only their carrier changes.

## Consequences

- Nine knobs replace eighty. What the raster solved by tuning, exact geometry solves by
  construction; the surviving knobs are physical (ink width, closing radius, headroom) or laws
  (minimum room, boundary support, ink backing).
- The deterministic lane becomes real: the solver consumes a serialized `SliceAnswer`, so a zone
  fixture is a file and a test is a solve with no Revit. The session lane proves the adapter, not
  the algorithm.
- The document is never mutated to read it. Prepare and capture, the two-pass script split, and
  seed-view cleanup disappear.
- Boundaries are wall centerlines with no frame. The editability audit shrinks to loop validity
  and coverage; orthogonal-frame audits are gone, so a rotated wing costs nothing.
- Faces come out of a morphological close and are blobby at corners. A rectification pass is owed
  and its home is an open question (see `cleanroom/OPEN.md`).
- Lower Level stays held until it has a wall source. This ADR does not invent partitions there,
  and the seven raster rooms in Lower Level#08, at 0.14 edge-on-geometry, are not a baseline.
- Attic rafters cross the knee band as combs; the Attic zones are the first session proof and may
  force a second knee cut. That is a stage, not a knob, until Attic proves it needs one.
- The takeoffs ledger's raster tuning history becomes archive; its laws are re-stated in
  `cleanroom/SHAPE.md` against the new stages.

## Rejected

**Keeping the raster pipeline and feeding it better ink.** Every capability it adds over the
domain kernel repairs damage the renderer did: 6,498 of 10,622 adjusted LOC and 43 of 80 knobs.
Its capture is lossy in a way no tuning reached: nine zones emptied at 0.86 to 0.99 backing, and
LL06 and LL08, the named "ink-starved quadrant", are the two best-backed Lower Level zones on the
slices. Its evidence election (seven knobs) guessed per model what a `Filter` now declares. The
ledger's twenty-two rejected tuning rounds of 2026-08 are the cost of that shape.

**Stud-aware closing** (buffering framing to 0.5 ft before the union): measured worse on every
control in `solve-union`; it buys a wider seal window the header band already provides and eats
about 10% of room area.

**Treating every DWG layer as a wall.** Millwork alone out-footprints walls on Main Level#09
(245 vs 185 sqft). Layers are policy and are named by the filter.
