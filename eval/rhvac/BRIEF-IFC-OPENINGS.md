# Mission: IFC opening-metadata probe — can we identify doors/windows without Revit Walls?

Question: the project-a shell is a linked IFC of ~56k GenericModel elements (zero Revit Walls
— see eval/rhvac/RESULTS-PROBE.md). The detector currently guesses door openings with a
<=4.5 ft colinear-gap heuristic (Detector.cs SealWallRunGaps) that fails on the firm's
oversized doors (10 ft doors exist). IFC imports usually carry class metadata (IfcDoor,
IfcWindow, IfcWall) on the imported elements. If we can enumerate doors/windows with
positions + widths from the link, the gap heuristic can be replaced with typed, provenance-
carrying seals. Answer YES or NO with evidence.

## Steps
1. Session bootstrap exactly as the previous probe (it worked): agent-owned sandbox lane
   ONLY, `dotnet tool run pe-revit -- sandbox start --installed Pe.App --year 25 --wait`
   from the worktree root; drive via POST /call; open the same detached project-a model
   (`MEP_ArchitectA_ProjectA_R25_detached_1` — rediscover path as before).
   NEVER touch the dev lane or any take-over-host flag. Read-only scripts; no model saves.
2. Via scripting.execute on the IFC link's elements: sample metadata carriers — element
   Category, family/type names, the IFC-mapped parameters (IfcExportAs, IFC Predefined
   Type, "Export Type", extensible-storage or shared params the Revit IFC importer stamps),
   and element Name strings. Report the distinct IFC classes present and their counts.
3. If door/window classes (or reliable name patterns) exist: dump every door/window on
   Upper Level with location point, facing/width if derivable (bbox extents along its host
   run), and level, to `eval/rhvac/project-a/probe/ifc_openings_upper.json`.
4. Offline: render them over the existing ink raster + mined GT (reuse probe-score.py /
   overlay plumbing) to `eval/rhvac/project-a/probe/overlay_ifc_openings.png`. Sanity metric:
   count of identified doors on Upper vs the door-gap seals the detector currently makes
   (grep detect logs or instrument nothing — an approximate visual count is acceptable;
   state how you counted).
5. Stop your sandbox when done.

## Deliverable
`eval/rhvac/RESULTS-IFC-OPENINGS.md`: distinct IFC classes table, opening counts, JSON +
overlay paths, and a 5-line verdict: is typed door identification reliable enough to
replace the gap heuristic on IFC-shell models? Honest NO is a valid result. Do not commit.
Work autonomously; do not ask questions.
