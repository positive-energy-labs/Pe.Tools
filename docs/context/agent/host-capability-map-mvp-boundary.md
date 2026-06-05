# Host Capability Map MVP Boundary

## Status

Implemented MVP context note for the compressed host-operation discovery work.

## Boundary

Pea now treats `HostOperationsCatalog.PublicHttp` as the source of truth for host capability discovery. Codegen emits a compressed Pea-side capability map beside the generated host client and full host-operation catalog:

- `source/pea/app/generated/host-client.generated.ts`
- `source/pea/app/generated/host-operations.generated.ts`
- `source/pea/app/generated/host-capability-map.generated.ts`

The compressed map is routing/orientation data only. It is not an execution contract and it is not a replacement for the full generated operation metadata.

## Product shape

- `host_operation_search` remains the discovery door.
- `host_operation_call` remains the typed JSON execution door.
- Broad/orientation discovery can ask for the capability-map projection.
- Exact planning still uses ranked operation matches with `hints` or `full` verbosity for examples, routes, request/response fields, and execution metadata.
- Pea startup context only points at the capability-map workflow; it does not inject the full map by default.

## Compression stance

Compact markdown is the MVP default because it is readable and good enough for broad routing. JSON is available for normalized rows. TOON is only an optional preview renderer for uniform-row token efficiency.

Non-goals:

- Do not make host operations return TOON.
- Do not make TOON canonical inside host contracts.
- Do not add one Pea tool per Revit operation.
- Do not fork Schedule Manager, Family Foundry, schedule profile, parameter reference, or dynamic-column shapes into Pea.

## First real maps

The first high-value focus sections are schedules and parameters:

- schedules: catalog -> detail rows/profiles -> coverage matrix -> settings schema/field options
- parameters: concept/evidence -> bindings -> coverage matrix -> settings schema/field options/parameter catalog

These paths reuse generated host-operation metadata and shared DTO/schema concepts. Query-wrapper safe defaults are nested under their actual request DTO wrapper instead of inventing Pea-only shortcuts.

## Proof added

Focused Pea runtime tests cover:

- broad schedule/parameter discovery through the compressed capability map;
- compact markdown, compact JSON, and optional TOON preview render paths;
- exact/full operation metadata remaining available for execution planning;
- DTO-aligned safe defaults for schedule/detail/query-wrapper operations.

## Runtime proof note

Host-operation metadata is static runtime contract data. If AttachedRrd still reports stale fields after hot reload, such as a missing `requiresActiveDocument` flag or empty supported document kinds, restart RRD and re-run the attached host operation before trusting live behavior.

## Next refinements

- Add broader routing evals only after black-box Pea behavior shows repeated misses.
- Keep adding operation metadata/examples before adding tools.
- Normalize Revit request shapes toward a common envelope when touched, but do not block this MVP on the long-term request-shape refactor.
