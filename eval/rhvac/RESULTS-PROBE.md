# Plane-cut probe result — vector does not beat raster

Run date: 2026-08-05  
Proof lane: installed `Pe.App` 0.6.23 in agent-owned Revit 2025 sandbox `rhvac-plane-cut`  
Model: `MEP_ArchitectA_ProjectA_R25_detached_1`  
Level: `Level 2/Upper Level`; elevation 12.5 ft; cut elevation 16.5 ft

## Result

Headline number: **47.7% wall recall** for vector lanes A+B at 1.5 ft, versus
**51.9%** for the current raster boundary (vector is 4.2 percentage points worse).

| Evidence lane | 0.75 ft | 1.5 ft |
|---|---:|---:|
| A — wall centerlines | 0.0% (0/241) | 0.0% (0/241) |
| A+B — centerlines plus plane cut | 21.6% (52/241) | 47.7% (115/241) |
| Current raster boundary | 28.6% (69/241) | 51.9% (125/241) |

All three rows use the same `score-takeoff.py` sample spacing and 70% hit-fraction rule.

![Upper Level probe overlay](project-a/probe/overlay_upper_probe.png)

Overlay: `eval/rhvac/project-a/probe/overlay_upper_probe.png`  
Harvest: `eval/rhvac/project-a/probe/harvest_upper.json`  
Machine-readable score: `eval/rhvac/project-a/probe/score_upper.json`

## Harvest counts

| Item | Count |
|---|---:|
| Walls seen, host + links | 1 |
| Walls crossing Upper Level band | 0 |
| Inserts on harvested walls | 0 |
| Lane-B elements seen in the four categories | 55,807 |
| Bounding-box candidates at the cut plane | 5,146 |
| Solids harvested | 5,139 |
| Elements with plane-cut output | 5,094 |
| Emitted 2D outline segments | 23,907 |
| Skipped: no solids | 7 |
| Skipped: no plane intersection | 45 |
| Failed solids | 0 |
| Failed elements | 0 |

The only non-empty lane-B population at the cut was 5,146 Generic Model elements in the
`3D Global in progress2026.03.03.ifc` link. The final harvest uses a 0.002-ft thin-slab
Boolean intersection at level + 4.0 ft and emits tessellated horizontal-face edges in host
model feet. Collection was read-only; no model transaction or save was performed.

## Verdict

1. The vector A+B lane loses to raster at both tolerances: 21.6% versus 28.6% at 0.75 ft, and 47.7% versus 51.9% at 1.5 ft.
2. Lane A contributes nothing because the architectural shell is imported as linked IFC Generic Models, not Revit Walls crossing Upper Level.
3. Lane B is well registered and failure-free, but its extra internal detail does not recover enough mined wall runs to overtake raster.
4. This result does not justify a large rewrite or demoting the PNG raster to DWG-only fallback.
5. Keep raster primary; retain vector plane cuts only as optional evidence if a later combined detector proves an incremental gain.
