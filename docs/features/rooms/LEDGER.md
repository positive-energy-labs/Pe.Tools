# rooms ledger

`/rooms` is the one place to split a project's rooms and manage the metadata on them. It replaces the room management inside `/takeoffs`.

## Decided
- 2026-09-24, a `/rooms` row is a Room Region, a Revit Filled Region carrying the `_PE_TakeoffGuid` spine and the takeoff carriers. It is not a native Revit Room; native Rooms stay solver proposals.
- 2026-09-24, partition scope is a level plus an optional bounds polygon, never a zoning region. The chosen plan view of that level is the plan image and the carrier for regions.
- 2026-09-24, a region the user drew or edited in Revit is locked authority on rerun; the solver fills only uncovered area. User-touched is a geometry hash mismatch against provenance.
- 2026-09-24, a region the user deleted may be redrawn on rerun, because deletion says the shape was wrong, not that no room is there. A hole is drawn, not inferred.
- 2026-09-24, revision resilience in the first slice is provenance and a `stale` flag per region (source epoch, link versions, wall evidence); refitting edges to moved walls is solver work, not route work.
- 2026-09-24, every room field (name, type, ceilingFt, people, lightingW, equipSensible, equipLatent, ventilationCfm) is a Revit parameter on the region. The schema is not settled; takeoffs parity is not required.
- 2026-09-24, `/rooms` is built on `defineRoute` on the route kernel with stages partition, review, history. The spec/pod lane of `entityRoute` is skipped until a rooms spec exists (re-openable). `/takeoffs` keeps its room code until `/rooms` is proven, then a purge deletes it.
- 2026-09-24, one typed write primitive `rooms.draw {view, loops[]}` materializes regions; partition uses it, and Pea gets the same door.
- 2026-09-24, solver tuning is a `goal` loop under Astra with a strict visual bar: every edge on wall ink, no stairstep runs, no swallowed walls, room count matches the registered plan, judged on full-level renders by fresh eyes. Pivot early over knob tuning.

## Tried & rejected

## Owed
- A test bed project with every architectural link kind (native RVT link, IFC link, DWG import) and zones drawn and ready, so solver claims stop resting on project-a alone. kaitpw, 2026-09-24.
- Purge `/takeoffs` room management once `/rooms` is proven in a session.
