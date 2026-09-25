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
- 2026-09-24, PROVEN[session, controlled snapshot `rooms2`, Duryee_Clone_Sept_15 local, `7f280111`; browser `/rooms`]: the route binds session, document, level and plan view from `rooms.snapshot`, draws the regions over the plan image, and `rooms.partition` on `Mechanical Zoning Plan - Level 1` answers in 8.4 s with 1 created, 5 locked (the view's five role-less Filled Regions adopted as drawn rooms), 3 held, 2 `degenerate loop` failures. A second run with no edit answers 0 created, 1 kept, 0 rooms deleted, 5 locked, held redrawn: the rerun rule is stable. Receipts `d5b2ba53`, `5b158820`.
- 2026-09-24, PROVEN[same]: `rooms.draw` creates a locked named region through the op catalog (`Pantry`, 100 sqft, element 7527663), and a machine region deleted by script (7527455) stays deleted until the next run. Mutations from the web go through the semantic actions; the host answers `{ value, target }` and the web verb reads `value`.
- 2026-09-24, FALSIFIED[same]: that a hand-drawn locked region can be placed anywhere. A 10 by 10 ft rectangle at x -36..-26, y 250..260 inside the held area made the rerun throw `reclaimed faces do not have matching shared boundaries` (`Solve.cs:189`, the reclaim coverage validator, receipt `deddb828`); the transaction rolled back and the route said so in its log row. This is the first solver target for the crusade: a locked proposal must never throw the partition.
- 2026-09-24, a carrier GUID reused across libraries reads as bound (Project Information) and never lands on Filled Regions; `CarrierGuidTests` scans `dotnet/` for duplicate carrier literals. Room field carriers are `...9010` to `...9016`.
- 2026-09-24, a dev host spawned by a Revit supervisor runs in attach mode with no source watcher; after a merge that adds host actions, run `pnpm --dir ts dev` from the checkout to take it over. The old process refused the new actions with `Operation admission kind required`.
- 2026-09-24, kaitpw (demiurge round 1): a **room** is the unit an engineer assigns supply and return CFM to, not a load-calculation unit and not every enclosed space. A **zone** is a region meant to be partitioned into rooms. A hand-drawn region is always intentional; its **designation** (room or zone, with provenance inferred or person) says which. This supersedes "a region the user drew is locked" and the adoption of role-less Filled Regions as locked rooms: on the Duryee zoning plan most adopted fills were zones.
- 2026-09-24, kaitpw: designation is a tree. A zone contains rooms; a room belongs to at most one zone; a room outside every zone is allowed, shown as unassigned, and never touched by partition. Partition runs only inside zones and fills around the rooms already there, never across the view crop.
- 2026-09-24, kaitpw: designation is inferred from interior wall evidence first (a region no wall ink crosses is a room, a region walls divide is a zone); area (about 300 sqft) breaks ties only when evidence is absent. A person overrides it with a toggle in the rooms UI. Rejected shapes: area as the primary rule, filled region type as the flag, declared-only, and rooms as native Revit Spaces (epitaphs in this round's report).
- 2026-09-24, kaitpw: CFM is never derived. Room grain stays evidence-based (walls, confirmed openings, the provisional 40 sqft join rule from the takeoffs ledger) with a person override; partition's merge policy is the product, not cleanup.

## Tried & rejected

## Owed
- Build designation: a `_PE_TakeoffRole` value set room | zone | held with provenance inferred | person, the wall-evidence inference, the room-in-zone tree, the UI toggle, and partition scoped to zones. Replaces the role-less adoption in `Rooms.Partition`.
- Ask a PE mechanical designer what makes a space its own CFM unit (bath exhaust, closet, open plan) before the merge policy is tuned toward it.
- The two `degenerate loop` failures on Duryee Level 1 (R06, R08) and the 0 sqft held residues: the materializer must drop or repair slivers before `FilledRegion.Create`, and a held residue of 3,020 sqft with 4 points is the crop rectangle, not a room. Astra wave 0.
- `pnpm verify` has not run on the rooms merge; only package tests, checks, compile R25 and the deterministic Takeoff tests have.
- The plan image lands only after the second snapshot read; the first paint draws regions with no underlay.
- A test bed project with every architectural link kind (native RVT link, IFC link, DWG import) and zones drawn and ready, so solver claims stop resting on project-a alone. kaitpw, 2026-09-24.
- Purge `/takeoffs` room management once `/rooms` is proven in a session.
