# Mission: falsify the PNG raster as the primary wall-evidence lane (plane-cut probe)

Question to answer with one number + one picture: does harvesting vector wall evidence from
the Revit API beat the rendered-PNG ink raster the detector currently uses? Benchmark: the
existing wall-recall metric (mined Bluebeam wall lines, 1.5 ft tolerance). Current raster
recall on project-a is 53.7% overall / 51.9% on floor 2 (Upper). If the harvested lanes beat
that meaningfully, the raster is demoted to DWG-link fallback and a large rewrite is
justified; if not, we learned it cheap. Either answer is a success — do NOT tune toward a
desired outcome.

## Read first
- `source/Pe.Revit.Takeoff/ProjectionSeed.cs` (current ink lane: categories, band heights)
- `eval/rhvac/score-takeoff.py` (wall-recall implementation + `oracle-geometry.json` wall lines)
- `eval/rhvac/project-a/SCOREBOARD.md` (baseline numbers)
- `pe-revit guide` output (session orchestration; run from `source/pe-tools` via `pnpm exec`)

## Step 1 — get a live Revit session with project-a open (sandbox lane ONLY)
- Two host processes are already live (dev port 60688, installed port 5180) but NO Revit is
  connected to either bridge. Do not touch the dev lane and NEVER use any --take-over-host
  flag or `live converge --restart` — those are the user's.
- Use the agent-owned sandbox lane: from `source/pe-tools`,
  `pnpm exec pe-revit sandbox start --installed <addin> --year 25 --wait` (consult
  `pe-revit sandbox --help` / `pe-revit guide` for the exact installed-addin name; installed
  payload v0.6.23 is present). Then `pe-revit sessions` to get the session/port, and drive it
  via `POST http://localhost:<port>/call` with body `{ "key": "<op>", "request": {...} }`.
- Open the project-a model with the `revit.apply.document.open` op. Finding the RVT path is part
  of the mission: check `eval/rhvac/project-a/oracle.source.txt` (the .r10 lives in the same
  G:\ project tree), `eval/rhvac/project-a/manual-takeoff-mining.md`, `bluebeam/` notes, and the
  host's recent-documents ops. If the model is cloud/workshared and cannot open without
  interactive sign-in, STOP and write the blocker honestly in RESULTS-PROBE.md.
- The takeoff detector ran on this model before; a local copy may exist under
  `C:\Users\kaitp\Documents\Pe.Tools\workspaces\`.

## Step 2 — harvest two vector evidence lanes (scripting.execute, level = Upper Level)
Scripts run via the `scripting.execute` op (`PeScriptContainer` body — see any existing
inline script under `.artifacts/tmp/` in the main checkout for the shape). Read-only: open
NO transactions that modify the model; if a script needs a transaction to run, roll it back.

Lane A — wall centerlines (no cutting):
- All `Wall` elements (host + linked instances, transformed to host coords) whose z-range
  crosses Upper Level's 4-ft band.
- Emit per wall: centerline as polyline (LocationCurve; tessellate arcs), total thickness,
  and every insert from `FindInserts(true,true,true,true)` projected to a span along the
  centerline with category (door/window/opening), width, sill and head elevation.

Lane B — plane cut of non-wall ink categories:
- Categories from ProjectionSeed's InkCategories MINUS Walls/curtain-wall (covered by lane
  A): Columns, StructuralColumns, StructuralFraming, GenericModel. Host + links.
- Cut each element's solids with the horizontal plane at level + 4.0 ft (thin-slab boolean
  or ExtrusionAnalyzer — your choice), emit resulting 2D outline segments with elementId +
  category. Skip elements whose solids fail; count them.

Write both lanes to `eval/rhvac/project-a/probe/harvest_upper.json` (model feet, same frame as
the detector TSVs — no view transform).

## Step 3 — score offline (python, no new deps beyond overlay.py's)
- New script `eval/rhvac/probe-score.py`: load `oracle-geometry.json` wall lines for the
  Upper floor, compute recall of (A) lane-A centerlines, (B) lane A+B union, (C) the current
  raster ink TSV boundary — all with the SAME sample-point/1.5-ft method as score-takeoff.py
  (import or copy it; do not modify score-takeoff.py — another change is staged there).
- Also report recall at 0.75 ft tolerance for all three (the raster collapses there; vector
  may not — that spread is the headline).
- Render `probe/overlay_upper_probe.png`: ink raster gray, lane-A lines colored by
  insert-span type, lane-B segments distinct, mined GT wall lines dashed.

## Deliverable
`eval/rhvac/RESULTS-PROBE.md`: the recall table (3 lanes × 2 tolerances), element counts,
failures/skips, the overlay image path, and a 5-line honest verdict. Do not commit anything;
leave files in place. When done, stop the sandbox you started (`pe-revit sandbox stop`).
Work autonomously; do not ask questions.
