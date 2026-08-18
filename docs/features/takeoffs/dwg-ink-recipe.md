# DWG ink lane recipe (ZoningPlanDwg)

Grounding for the opportunistic `ZoningPlanDwg` seed-ink lane — needed only if/when that lane
gets built. Live-verified on ProjectA_Clone_Aug_11 (probe v4, 2026-08-14). Decision + rejection
of verbatim zoning-plan pixels are in `LEDGER.md`.

- **Applicability detector**: `* Zoning Plan - <level>` views + a layered DWG import per level.
  DWG layers arrive as subcategories (`A_WALL_1/3/7`, `A_XWALL`, `A_GLAZ` vs clutter `A_FURN`,
  `A_FIXT`, `A_EQIP`, `A_STAR`, `A_MILL`, `A_PATT_*`, `A_ROOF_*`).
- **Recipe**: duplicate zoning view → detach template → hide all annotation + all model
  categories except DWG imports → per-view subcategory visibility: hide all DWG layers except
  the keep-list `A_WALL*`, `A_XWALL`, `A_GLAZ` → export via the existing `StampPng`/INKP
  machinery (takeoff-owned view, deleted after export). Verified result: pure wall ink, 1.04%
  coverage, zero annotation/fills/furniture.
- **Keep-list is a per-firm convention knob** — belongs in `TakeoffOptions` with the above as
  defaults.
- **Binarization trap**: stripped-DWG lines render anti-aliased mid-gray (~200); the `px > 128`
  ink cutoff (ProjectionSeed.cs) MISSES them. Lower the threshold for this lane, or export at
  larger PixelSize / heavier line weight (weight 5 was still thin at 1:192).
- **Doors**: `A_DOOR` hidden ⇒ doorways read as clean gaps ⇒ headerless-doorway closure
  (`DoorGapMaxFt`/`DoorJambMinFt`) is the closure path; the lintel/header band trick does not
  apply to DWG ink.
- **Provenance to record**: source view id, DWG filename (date-stamped = free provenance),
  layer keep-list.
- **What it fixes**: LL08 clutter partitions and attic wander (clutter ink gone at source);
  ML08 over-partitioning only partially. Evidence weights (retired as structurally dead with
  band-composed ink) become worth revisiting only with this lane.
