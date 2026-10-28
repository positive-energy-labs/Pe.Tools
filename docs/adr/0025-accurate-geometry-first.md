# Accurate geometry first; orientation per element

Date: 2026-10-27. Status: accepted. kaitpw's ruling was relayed on 2026-10-27 through the look-rule thread. The human source is thread cfdbb202, 2026-10-27 17:14Z.

## Context

Space reads feed the Ducts context picture, Pea's spatial verbs, Takeoff, and future clash detection. On 2026-10-27, an overnight run made axis-aligned context boxes the default (merged in `d3e739f9`, `Scene.cs:32`) because its gate measured only repeat memory. A census of the EX 7 artifact then found that 5,157 of 5,157 link boxes and 2,587 of 2,918 host boxes were square to the host axes, on a building with a 45 degree wing. For a rotated family instance, the world box is a median 2.17 times the family-local box volume. The memory premise was also wrong. On Chadds, the Revit cost of a read is first touch per element (≈1.12 GiB for the IFC link before any geometry call), not triangles. Evidence and limits: [Reading Revit: cost and truth](../features/spatial/READING-REVIT.md).

## Decision

- Accuracy is the top requirement of every Space read, above memory and time.
- Meshes are first-class geometry. A box is at most a far-field level of detail, and it is never the substrate.
- Each box takes its orientation from its own element, through the element transform or location line. A box is never oriented per link, per document, or to world axes.
- To bound memory and time, choose which elements to walk: scope, partition, link opt-in. Do not degrade geometry with axis-aligned boxes, silent triangle budgets, or partial pictures.
- A bound that removes elements from a picture states what it removed.

## Consequences

- **Ducts context.** The boxes default at `Scene.cs:32` contradicts this ADR, so it must be replaced. The target is near-field meshes plus oriented far-field boxes. Near-field meshes are not affordable yet. On Chadds, a 10 ft reach around one system walked 29,107 elements, mostly in the IFC link, and cost +2,395 MiB (≈7 minutes in a probe script; 54.5 s on the product path, 2026-10-27). The near field needs a cache, a tighter reach, or a per-category policy first.
- **Pea routing.** Pea's spatial verbs (Sweep, Slice, Probe) and the router read meshes, never context boxes. A box answer is a broad-phase filter, not a clearance.
- **Clash detection** needs full meshes on the same substrate. No representation choice may remove meshes from the substrate.
- **Takeoff.** The band slices of [ADR 0011](0011-takeoff-on-space.md) stay mesh-based.
- **Heavy links.** Most of the Chadds cost is the walk of a loaded IFC-derived link. Resolved 2026-10-27 (ledger): building geometry is always read; cost is cut by reading less of every source (per-element reach before iteration), never by dropping a source. The "link opt-in" bound above is superseded. Live frontier: [spatial MAP](../features/spatial/MAP.md).
- **Not context geometry.** MEP centre-line helper elements, CAD links, and insulation elements are not context geometry. Insulation draws from its host.
- **Cost.** IFC framing has no `Location`, so oriented boxes for it need symbol geometry. On MEP fittings that cost ≈82 KB per element, against ≈107 KB for a mesh. An exact oriented box is a fidelity tool, not a memory lever.
