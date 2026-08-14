# Takeoffs

Takeoffs turns architectural evidence into persistent, editable Revit zoning and room geometry, then bridges room data into Elite RHVAC for Manual J. The designer declares scope and engineering intent; automation handles deterministic partitioning and data transfer; ambiguity stays visible for human resolution.

## Why

- **Make revisions a diff, not a redraw.** Durable takeoff state lets an architectural change rerun affected partitions instead of restarting the draw-and-enter cycle.
- **Reuse work PE already does.** PE already draws and issues zoning geometry. Using it as the detector's domain gives an explicit inclusion boundary — roofs, other levels, site, and linked-model noise are out without inference.
- **Don't ask code to guess intent.** Unbounded room detection plateaued because splitting an open plan into rooms encodes engineering intent no geometry reveals. The zoning boundary supplies that intent and bounds the search; automation partitions, the designer decides.
- **Persist in domain tools.** Revit owns geometry and assignments; `.r10` owns RHVAC-only inputs and results. The UI is a replaceable view, never an authority.

## Language

- **Zoning Region**: persistent, designer-drawn Filled Region for one connected scope area on a level. Carries a name, color, and one or more RHVAC System assignments; it is both the issued sheet graphic and the detector's partition domain. Regions sharing a name read as one legend entry — "zoning group" is that shared name, not a managed entity.
- **Takeoff Room**: PE's atomic room-by-room Manual J unit. One Takeoff Room = one Room Region = one RHVAC Room.
- **Room Region**: persistent, editable Filled Region for one Takeoff Room inside a Zoning Region. The designer's edit surface.
- **Revit Space**: native analytical volume derived from a Room Region — regenerated and audited, never hand-edited.
- **RHVAC System**: load/equipment parent. Every exported RHVAC Room carries one explicit `SystemNumber`.
- **RHVAC Zone**: subgroup within an RHVAC System. PE leaves every room at `ZoneNumber = 1`; not a product grouping.

Unqualified Room, Zone, and System are ambiguous across Revit and RHVAC — qualify **Architectural Room**, **Revit HVAC Zone**, and **Revit MEP System** when the native entity matters. Before changing these mappings, their Revit representations, or RHVAC export, read [the terminology note](../../docs/context/takeoff-room-space-zone-system-terminology-2026-08-13.md).

## Workflow

1. The designer draws and labels Zoning Regions (name, color, RHVAC System) in Revit — this declares scope and produces the issued zoning graphic.
2. The detector partitions each Zoning Region into Room Regions and reports accepted, held, void, and excluded areas.
3. The designer reshapes Room Regions, assigns room data, and reruns only affected partitions as needed.
4. Takeoffs derives Revit Spaces when needed and writes room inputs to `.r10`.
5. The designer finishes remaining inputs and calculations in RHVAC. Later revisions resume from the edited state.

## Laws

- **Scope**: Every Room Region belongs to exactly one Zoning Region. The detector never claims geometry outside it — roofs, other levels, site, linked-model noise.
- **Accounting**: Accepted rooms plus held, void, and excluded areas account for every Zoning Region on every level. Abstention stays visible; a held area beats a guessed one.
- **Editability**: Prefer a held area to a mangled room. A Room Region ships only through a strict promotion gate — one coherent local orthogonal frame with ordinary right-angle corners (no sharp tips, diagonal shortcuts, stair steps, or jumbled junctions), and every straightened edge still tracing real wall evidence. Straight is not enough; a clean edge that has drifted off the wall it represents is rejected. Rooms that fail are dropped whole into visible residue, never bent to fit. Coverage or area diagnostics cannot buy back a violation.
- **Authority**: Zoning Regions own outer scope; Room Regions own the internal partition and are the edit surface; Revit Spaces are derived, never authored, and a materialized Space's native boundary is read back and audited before a run is final. Editing a Zoning Region invalidates only its partition; editing a Room Region never redefines scope. The UI may cache but never becomes authoritative.
- **Identity**: Filled Regions carry an explicit PE role and stable identifiers; identity and provenance survive targeted reruns, splits, merges, and architectural revisions.
- **Persistence**: Revit owns zoning/room geometry and RHVAC System assignments; `.r10` owns RHVAC-only inputs and saved results. Recalculation proposes a diff against prior edits rather than silently replacing them. RHVAC remains the calculation authority — writing `.r10` does not run the load calc.

## Decisions

Resolved, so agents stop reopening them:

- **Detector domain is the Zoning Region, not the level.** No level-wide detection, no "coverage %" as the goal — the ceiling there is engineer intent, not geometry.
- **1:1 Takeoff Room ↔ Room Region ↔ RHVAC Room.**
- **Designer edits Room Region FRs; Spaces are derived and disposable** — no hand-edited Spaces flowing back as truth.
- **No native Revit HVAC Zones or Space color-fill schemes as output** — project-a uses none and Revit 2026 changed the tools; revisit only on real need.
- **"Zoning group" is a shared name/color, not an entity.**
- **Keep "System" as office vocabulary** — no rename.
