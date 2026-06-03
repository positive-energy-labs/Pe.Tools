# Proposition: Treat Host Operation Metadata as Pea's Capability Map

## Status

Research proposition. Temporary context for the schema-compression/discovery work.

## Proposition

The public host-operation catalog should be treated as Pea's canonical capability map. Pea should discover, rank, and zoom through generated operation metadata instead of receiving broad prompt lore or one tool per Revit task.

The hand-maintained C# client should remain a blessed ergonomic ladder for high-value workflows. The TypeScript/Pea surface should consume generated metadata and generic host execution unless a repeated product workflow justifies a narrower wrapper.

## Current evidence

### Contract authority already exists

`source/Pe.Shared.HostContracts/Operations/HostOperationsCatalog.cs` enumerates public host operations and keeps the TypeScript client slice intentionally small. The public catalog is broader than the current generated TS client wrappers: it includes Revit context, catalog, matrix, detail, resolve, document session, recent documents, open document, settings, scripts, APS, and host status operations.

`source/Pe.Shared.HostContracts/Operations/HostOperationContracts.cs` gives each operation a rich metadata vocabulary:

- execution mode and public exposure;
- operation family;
- Revit layer;
- active-document requirement and supported active document kinds;
- result grain;
- cost tier;
- visibility;
- request-shape kind;
- intent verb;
- strict validation flag;
- examples and safe defaults;
- use/avoid language;
- usually-before/usually-after/next-operation guidance;
- supported scopes, primary nouns, capabilities, and ambiguity behavior.

This is already the shape of a capability map. The remaining work is projection and consumption, not inventing a parallel registry.

### The C# client ladder is mostly right

`source/Pe.Shared.HostContracts/PeHostClient.cs` exposes `Host`, `Revit`, and `Scripting`. `PeHostRevitClient` then groups operations as:

- `Context`
- `Catalog`
- `Matrix`
- `Detail`
- `Resolve`

The XML docs steer the caller through correct workflows:

- start with context summary;
- resolve fuzzy references once;
- use catalog calls for discovery/provenance;
- use matrix calls for coverage/audit joins;
- inspect exact handles/rows through detail calls;
- avoid broad electrical or panel-schedule calls until exact candidates exist.

This is intuitive for scripts and repo callers. It should not be replaced by a generic schema-compression abstraction.

### The generated TypeScript artifact is metadata-rich

`source/pea/app/generated/host-operations.generated.ts` is generated from `HostOperationsCatalog.PublicHttp`. It already carries request/response shape summaries, safe default JSON, examples, canonical use, cost, visibility, next-operation guidance, and ambiguity behavior.

That generated artifact is the right Pea-side seed for compressed discovery.

## Design pressure found during research

1. **Request-shape consistency is not finished.** The metadata can classify `CommonEnvelope`, `QueryWrapper`, `Flat`, `Command`, and legacy exception shapes. Some schedule/query requests still wrap separate query objects while newer RevitData contracts use `Filter` / `Scope` / `References` / `Projection` / `Budget` / `Options` envelopes.
2. **The TS client is intentionally not a Revit wrapper universe.** It exposes host and scripting groups, while the operation catalog contains many more public Revit operations. This favors metadata-driven discovery plus generic execution for Pea.
3. **Operation metadata is more valuable than more tools.** The architecture/philosophy files both warn against adding overlapping tools or prompt inventory. The current catalog can answer "what should I call next?" if projected correctly.

## Recommended architecture

### 1. Generate a compact operation map

Generate a small artifact from `HostOperationsCatalog.PublicHttp`, for example:

```text
revit [bridge, singleFlight=revit]
  context.summary: Orient/Summary/Cheap, project+family, no request
    use: broad Revit questions, active view/sheet, selection, open document state
    next: context.visible-summary, catalog.project-index, resolve.references
  catalog.schedules: Inventory/Catalog/Bounded, project
    default: Summary maxEntries=25
    next: detail.schedules, matrix.schedule-coverage, matrix.schedule-profiles
```

The map should be generated, not hand-authored.

### 2. Keep operation recipes close to metadata

If a workflow becomes common, add metadata/examples/bounded-expansion hints before adding a new tool. Good recipe fields:

- user phrases that should trigger the operation;
- preflight requirements;
- safe default request;
- what the operation answers and does not answer;
- next operations;
- common narrow joins;
- ambiguity behavior.

### 3. Preserve C# ergonomics

Keep `PeHostClient.Revit.Context/Catalog/Matrix/Detail/Resolve` as the main C# surface. Add blessed methods only when the workflow is stable and high-value. Keep `ExecuteAsync<TRequest,TResponse>` as the escape hatch.

### 4. Normalize request shapes incrementally

Do not block compression on request-shape cleanup, but use the compressed capability map to expose inconsistencies. New Revit data operations should prefer the common envelope unless a strong reason exists.

## Implementation path

1. Add a small codegen target that emits a compressed host capability markdown/JSON/TOON fixture from operation metadata.
2. Add snapshot tests to ensure the artifact updates when operation metadata changes.
3. Teach Pea's operation-selection prompt/context to read the compressed map before operation detail.
4. Add or improve metadata for operations that remain hard to distinguish.
5. Only after real usage, consider a generated TypeScript Revit wrapper subset for the most repeated Pea workflows.

## Verification criteria

- Given a natural user question, Pea can pick the same operation ladder a developer would pick from `PeHostClient` docs.
- The compressed map includes cost/gating/proof-critical metadata: bridge requirement, active document kind, mutation, strict validation, and safe defaults.
- Generated artifacts fail tests when operation keys/routes/metadata become inconsistent.
- No prompt hardcodes a long Revit operation inventory.
- C# callers still have an obvious, documented path through the grouped client.

## Risks

- A generated map can become too large if it includes full request/response DTO shapes by default.
- A generic host operation executor can feel less intuitive than named methods if Pea lacks good metadata projection.
- Request-shape inconsistency can leak into agent behavior if the map does not surface safe default requests.
- Adding TypeScript wrappers for every operation would recreate the context-size problem in code form.

## Current recommendation

Use `HostOperationAgentMetadata` as the capability-map authority. Improve generation/projection before adding more Pea tools or broad TypeScript wrappers. Keep the C# client ladder hand-maintained and small.

## References

- `source/Pe.Shared.HostContracts/AGENTS.md`
- `source/Pe.Shared.HostContracts/Operations/HostOperationsCatalog.cs`
- `source/Pe.Shared.HostContracts/Operations/HostOperationContracts.cs`
- `source/Pe.Shared.HostContracts/PeHostClient.cs`
- `source/pea/app/generated/host-operations.generated.ts`
- `docs/ARCHITECTURE.md`
- `source/pea/app/PHILOSOPHY.md`
