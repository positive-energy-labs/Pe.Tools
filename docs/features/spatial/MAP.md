# Space: live frontier (2026-10-28)

Written after one night and one day of real-Revit proof on three models. Holds the pillars, the
lessons that drive design, the priors being dropped, the target read, the proof gate every change
passes, and the steps in flight. Rulings go to `LEDGER.md` Decided; costs and truth claims go to
[READING-REVIT.md](READING-REVIT.md), the authority this map cites as R/U ids. Deleted when the
shared context read, levels and the cache are the shipped path on all three models.

## Why

`/ducts` draws a 3D picture of the systems you open, with the building around them. Pea will
route ducts through that same geometry. The picture is the asset kaitpw has invested in most, and
on 2026-10-27 it lied: on Chadds EX 7, 5,157 of 5,157 link boxes and 2,587 of 2,918 host boxes
were square to the host axes on a building with a 45° wing, so the context was unreadable
([ADR 0025](../../adr/0025-accurate-geometry-first.md)). The same day, a single Pea Sweep held
Revit at 13.8 GB. The goal (kaitpw): Pe.Tools is never why Revit needs a restart, even when most
of Pea's tools read space and manipulate 3D.

Two days of assumptions were proved wrong one at a time. Each wrong one had already shaped code:
axis-aligned boxes chosen on a repeat-memory gate that omitted accuracy; "meshes are cheap"
(true for focus, false for context); "the bounding-box filter is cheap" (true only after a full
walk had already paid); "≈430 s for meshes" (a probe script, not the product: 54.5 s); "the IFC
link is the cost, so turn it off" (Chadds-shaped; ruled out). This map exists so the next agent
does not pay for them again.

## Pillars

1. **Accuracy first.** Every element is drawn in its own frame: a mesh, or a box oriented by
   that element's transform or location line, in full 3D (30–34% of family instances are tilted
   on Manuella and Cleremont). Never an axis-aligned box around a rotated element. [ADR 0025]
2. **Building geometry is always read, whatever its source.** Host, Revit link, IFC link, CAD.
   No control exists for one model's setup; context behaves the same on every model. Cost is cut
   by reading less of every source, never by dropping a source. An emergency off switch may
   exist as an escape door, not as the design. [ledger, kaitpw 2026-10-27]
3. **Iterating is loading; only counting is free.** A quick filter plus `ToElementIds()` costs
   ≈0 MiB (91,829 IFC link ids, +0.0 MiB). Iterating the same collector loads every element
   (≈14 KB each in the Chadds IFC link, 0.8–2.3 KB in Cleremont's RVT links, ≈1 KB host). So
   every exclusion and every reach is a quick filter applied before iteration. A filter applied
   after the loop (main's halo mode) saves nothing. Counting is free in memory, not in time:
   one query per source takes 0.01–0.05 s, hundreds take 20–113 s. One OR filter per source.
4. **Read near each run, not around the system.** A system's axis-aligned crop is not its
   neighbourhood: a diagonal system's crop is mostly empty, and Cleremont SA 2's is a cube
   1,500 ft wide because of far members. Per-element reach cut candidates 9–82%.
5. **Frames belong to the placed link, not the link file.** Cleremont places one house file
   three times at 10.9°, 17° and the internal origin. Partitions, filters, oriented boxes and
   levels go per link instance; a second placement of a read document costs ≈0.
6. **Revit metadata is a hint.** `CategoryType.Model` admits MEP centre-line helpers (class
   `Element`); insulation is a separate element; view-specific imports leak into 3D context;
   links bring sketches, curtain grids, room separations, origin markers, planting, topography,
   masses and nested DWGs. Exclusions apply to every partition and are proved per model.
7. **Levels are data, measured right.** `Level.Elevation` is relative to the project base point
   (737 ft off on Cleremont); use `ProjectElevation` through the instance transform. Levels are
   per building (Cleremont: 50 levels, 31 distinct elevations, 12 coincident groups) and repeat
   under two naming sets (Manuella). They are read with the context, never inferred.
8. **Disclose what is missing.** A source may be unloaded (all of Manuella's), unavailable on
   this machine (Cleremont's links resolve through Desktop Connector), or cut by a bound. The
   picture says so per link instance, with the same words on every model.
9. **Never read the whole model per question.** `SpaceWorld.Prepare` built 12.5 M triangles for
   one Sweep: 220 s, +9.4 GiB, Revit 3.7→13.8 GB. Every read is scoped by the question. [U5]
10. **Proof is real Revit, cold, on three models.** A count, a screenshot, a compile, a warm
    repeat or an agent's word is testimony. A random sample under-reads a walk ≈30×; measure by
    walking. A new assumption with design weight is crushed by a probe before code depends on it.

## What a read costs (cold, fresh process, current main)

| Model | Building lives in | `/ducts` context, boxes | Link cost per element |
|---|---|---|---|
| Chadds (SA 7 / EX 7) | IFC link at 45°, loaded | 20.1 s +822 MiB / 6.0 s +162 MiB | ≈14 KB |
| Manuella (SA 42 / SA 39) | 3 RVT links, unloaded; host has 7 walls | 0.5 s, +4–6 MiB | n/a |
| Cleremont (SA 19 / SA 2) | 4 RVT links × 6 placements, loaded | 1.6 s +61 MiB / 3.6 s +166 MiB | 0.8–2.3 KB |

Meshes context on Chadds SA 7: 54.5 s, +2,443 MiB. Focus meshes are cheap (whole-building 5,224
meshes ≈105 MiB). Reports: `.artifacts/accept/{ducts-read-baseline-20261027,
manuella-generality-20261027,cleremont-generality-20261028}/REPORT.md`. Local detached copies for
proof live in `.artifacts/revit/detached/` (Manuella and Cleremont `_local_`). Every Chadds number
here was measured on the cloud `Chadds_Clone_Aug_11`. The older `ChaddsFord_R25_standalone_20261019`
is a different model, FALSIFIED as a stand-in: no IFC link, no loaded links, 4,266 pipe
insulations against the clone's 3,267 (step 3, 2026-10-28). The Chadds gate copy is
`MEP_Chadds_Clone_Aug_11_R25_local_20261028.rvt`, made by save-stripped. PROVEN[probe-o,
`004c7b43`, 2026-10-28 03:53Z]: all 196 per-partition category counts, link inventories and
transforms equal the cloud's; IFC instance 9465481 loaded.

## Priors to drop

| Prior | Why it goes |
|---|---|
| Axis-aligned context boxes as the default (`Scene.cs:32`) | Lies on every rotated element; falsified by the EX 7 census. |
| One crop box around the focus (`Scene.cs:158`) | Mostly empty on diagonal systems; a 1,500 ft cube with far members. |
| Proximity tested after loading (halo) | Pays the full load, then discards. |
| One transform per link document | Cleremont places one document three times. |
| Every building element has a family frame | Chadds IFC elements are DirectShapes: 800 of 800 sampled framing have identity frames and 800 distinct geometry keys (probe-o, 2026-10-28). |
| Insulation needs its own element read | The host's thickness matches: ducts 4,294/4,294 (Chadds), 364/364 (Cleremont); pipes 3,267/3,267, max error 0 (Chadds clone). |
| An IFC-off flag or any per-model toggle | Ruled out; building geometry is always needed. |
| `Level.Elevation` | Base-point relative; wrong by hundreds of feet. |
| Whole-model `Prepare` per verb call | 220 s and +9.4 GiB per cold call. |
| A disk pack keyed per process (`SpaceWorld.cs:47`, `LinkedGeometryStore.cs:36`) | Never hits after a restart; writes ≈550 MB per call into a shared 1 GiB cache. |

## Target read

```
SceneRequest   focus ids (the opened systems' members), reach ft, representation policy
  sources      host + every link INSTANCE (loaded | unloaded | unavailable, disclosed)
  reach        per focus element: its oriented box grown by reach, mapped into each
               source's frame; one OR'd quick filter per source; ids counted first
  exclude      quick filters before iteration: centre-line helpers, insulation (drawn
               from the host's RBS_REFERENCE_INSULATION_THICKNESS), view-specific,
               link noise classes; each exclusion counted and disclosed
  represent    runs: LocationCurve + size (+insulation); family instances: symbol box
               x total transform (full 3D); sketch-based floors/roofs/ceilings/stairs
               and IFC DirectShapes (identity frame, geometry in place): mesh; meshes on
               request from the same rule; tessellate once per type
  levels       per source instance: ProjectElevation through the transform; grouped
               per building, coincident levels merged, names kept
  disclose     per source: candidates counted, kept, excluded by class, cut by bound,
               unavailable; outlier focus members far from the rest
Cache          keyed by document + link instance + version (never per process);
               invalidated by a mark-only DocumentChanged handler; decided after step 2
Verbs          Pea's Sweep/Slice/Probe/Partition read through the same scoped read
               (beta; follow-on, not this map's target)
```

## Proof gate (every change, before main)

- One probe Revit at a time, machine-wide (`.artifacts/locks/revit-slot-1`), started only with
  ≥10 GiB free: two probes beside kaitpw's 15 GB session left 2.5 GiB free on 2026-10-28. An
  empty Revit costs ≈3 GiB. A worktree dev stack (dev.ts, dev-web, vite) costs 2–3.5 GiB, and
  `session start` boots one automatically: prestart a backend-only host or stop the stack after
  start. A watchdog stop is a boundary: name the consumer from a per-process memory log before
  holding again (a Chadds open on 2026-10-28 dropped machine free 16→1 GiB while the probe held
  1.9 GiB; cause UNPROVEN).
- Real Revit, SDK-controlled probe sessions only; never kaitpw's `pe.app-25`. Cold = first read
  in a fresh process; warm = one repeat. Memory = Revit private bytes delta; time = Revit side.
- Three models from their local copies: Chadds SA 7 and EX 7; Cleremont SA 19, SA 2 and SA 21;
  Manuella SA 42 and SA 39. The same system member ids before and after.
- Accuracy: no element in the artifact is drawn axis-aligned when its own frame is rotated
  (checked against the element's transform or location line), and every exclusion and bound is
  disclosed in the receipt.
- The document stays unmodified. Stamps: PROVEN / FALSIFIED / UNPROVEN with lane, session,
  commit and time.

## Steps

1. Proof harness (landed 2026-10-28: `tools/space-proof/`; baseline in the ledger). One command runs the gate on the three local copies and writes a comparable
   table. Promotes the throwaway instruments (`t3/ducts-read-baseline-measure`,
   `t3/cleremont-generality-research`) into a durable tool.
2. The shared context read: link-instance partitions, per-element reach before iteration,
   exclusions, disclosure. Deletes `Partition.BuildRegion`, `SceneCandidates`, the `Dirty` and
   `Fresh` flags and the duplicate pack keys.
3. Oriented representation: per-element oriented boxes in full 3D, sketch-based building as
   mesh, PSC1 and the web decoder carry them; tessellate once per type.
4. Levels as data, drawn in the picture.
5. Cache key and invalidation; keep or delete `LinkedGeometryStore`.
6. Follow-on: Pea's verbs read through the scoped read.

## Owed

- IFC/DirectShape drawing (kaitpw 2026-10-28): rule after seeing meshes and per-element
  triangle-fit oriented boxes side by side on the Chadds clone, both measured under step 2's
  reach. Leaning meshes; step 3 lands meshes as the default with the box as an option.
- How much of Cleremont's 7 GB open cost is its links.
- Link behaviour on a machine without Desktop Connector.
- CAD as building context: on Manuella, model-level DWG plans are the only building geometry
  loaded. kaitpw: undecided. Until ruled, model-level CAD is disclosed, not drawn.
- Why random samples under-read a full walk ≈30× (U3).
