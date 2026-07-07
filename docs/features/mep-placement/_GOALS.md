# MEP Placement Toolkits (experiment)

## Intent

Give Pea a real *ability*: draft collision-free (or collision-minimal) duct/pipe placement from a plain-language ask ("lay out the supply duct on this level"), then refine with the user until the nitty gritty is handed back to them. Users keep the decisions; Pea lays the groundwork.

The deliverable is not just code — it is a **skill + an opinionated placement abstraction** that will eventually be loaded into the scripting environment by default (ported into Pe.Tools, shipped with a bundled skill). Per the agent philosophy ladder: soul/orientation in the system prompt, tool/environment mechanics on tool descriptions, and the *operating loop for this ability* in a fat skill.

## Method: three competing toolkits

Three pods under `Documents\Pe.Tools\workspaces\`, built simultaneously by isolated agents so the approaches stay uncontaminated. Each pod = fat C# library (`src/`), thin declared entrypoints, a draft `SKILL.md`, and honest `NOTES.md`. Best-of-all-worlds wins the port.

| Pod | Thesis | Test zone (Snowdon HVAC) |
| --- | --- | --- |
| `mep-sketch` | Placeholder-first: sketch topology flat as placeholder ducts, a deterministic solver assigns elevations, resolves crossings, converts to real ducts + fittings | L1 - Block 43 |
| `mep-route` | Probe-and-route: fluent cursor API anchored to landmarks; every step returns collision/clearance feedback; agent improvises the loop | L2 |
| `mep-solve` | Declare-and-solve: intent JSON in, obstacle-aware lattice pathfinding out; reviewable draft, then commit | L3 |

Shared infra (verbatim in each pod): `PeaViz.cs` plan/3D PNG export. Collision *surfacing* is intentionally NOT shared — it is an experimental axis.

## Proof battery (identical per pod, live in Revit)

P1 trunk (~60 ft, 12x8 supply) → P2 three branches to real air terminals with fittings → P3 collision report + fix one via the approach's refine loop → P4 re-elevation refinement (loop cost) → P5 cleanup. PNG evidence after P2 and P3. Metrics: script runs, compile failures, collisions before/after, subjective friction.

## Verified environment facts (2026-07-03)

- `pea script execute` CLI loop works end-to-end (compile diagnostics, WriteTransaction rollback on exception).
- Duct place → size → regenerate → geometry → delete round-trip proven.
- ReadOnly `doc.ExportImage` produces highly legible plan PNGs (grids, rooms, colored systems).
- Pea vision is wireable: mastra 1.47.0 supports image tool-result parts (`experimental_content`); smallest change is a `read_image` tool in `packages/tools`.
- Bridge serializes operations (busy = retry); scripts are stateless between runs — state lives in the model or workspace files.

## Open questions

- Which feedback shape (numeric report vs image vs both) does an agent actually route well with?
- Code-driven (agent writes scenario scripts) vs data-driven (agent writes intent JSON) interface — which is more reliable at 75k-context pea scale?
- How much solver determinism is right before it stops surfacing decisions users must own?
