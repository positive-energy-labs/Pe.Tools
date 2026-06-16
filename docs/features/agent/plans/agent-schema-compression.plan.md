# Proposition: Add Agent-Facing Schema Compression as a Projection Layer

## Status

Research proposition. Temporary context until promoted into a feature/package doc or converted into implementation tasks.

## Proposition

Pe.Tools should add an agent-facing compressed projection layer for large structured worlds, especially host operations, settings/schema surfaces, and Revit document data. The source of truth should remain typed JSON contracts and generated metadata. Compression should be a deterministic rendering/projection step that helps Pea inspect a small map, choose a zoom path, and request detail deliberately.

TOON or TOON-like output is desirable for the final prompt-facing rendering, but it should not become the primary public contract format.

## Why this is worth doing

- `source/pea/app/PHILOSOPHY.md` already states the core posture: start from a compressed overview, preserve relationships, expose provenance/freshness, and make zoom/filter/join paths explicit.
- `docs/ARCHITECTURE.md` defines the document data ladder: `Context` and `Catalog` are shallow defaults; `Detail`, `Relation / matrix`, `Projection`, and `Apply` require explicit scope, filters, budgets, handles, provenance, or specs.
- `source/Pe.Shared.RevitData/AGENTS.md` says DTOs should favor compact defaults: counts, labels, handles, provenance, issues, and bounded projections.
- The generated host-operation catalog already carries enough metadata to render a useful capability map: family, Revit layer, result grain, cost tier, request shape, active-document gating, examples, safe defaults, use/avoid language, usually-before/after, next operations, and ambiguity behavior.
- Official TOON material reports deterministic lossless JSON-model round trips, explicit `[N]` and `{fields}` guardrails, multi-language implementations, and benchmark claims of 76.4% accuracy vs JSON's 75.0% while using roughly 40% fewer tokens in mixed-structure tests.

## Desired compressed-view contract

A useful compressed view should include:

- entity/schema/operation name;
- human title or identity field;
- count, scope, and truncation state;
- coarse field names and types;
- references out and references in;
- provenance, freshness, and diagnostic severity counts;
- available zoom, filter, detail, join, and apply paths;
- known costs/gates such as bridge requirement, active document kind, mutation, or single-flight lane.

Example posture, not a final format:

```text
revit.catalog.schedules [Catalog, Cheap, Project]
  answers: schedule inventory, fields, filters, sheet placements
  default: Summary maxEntries=25
  next: revit.detail.schedules, revit.matrix.schedule-coverage
  avoid: visible-equipment coverage when schedule-coverage can answer

ScheduleCatalogSummary(count=84, truncated=false)
  groups[4]{name,count,examples}:
    Equipment,12,"MECH EQUIPMENT SCHEDULE|ELEC EQUIPMENT SCHEDULE"
    Panel,8,"PANEL SCHEDULES|PANELBOARD SCHEDULE"
  fieldFingerprints[3]{schedule,fieldCount,hash,topFields}
```

## Recommended architecture

1. Keep public operation responses as JSON DTOs from `Pe.Shared.HostContracts` and `Pe.Shared.RevitData`.
2. Add deterministic projection/rendering at the consumer edge first, probably in Pea/generated-agent artifacts, not inside Revit collectors.
3. Use a neutral intermediate model such as `CompressedProjection` only after two or more consumers need it. Until then, generate/render directly from existing metadata and DTOs.
4. Treat TOON as one renderer among several: `json`, `compact-json`, `markdown-map`, `toon`.
5. Keep schema zoom paths executable: every compressed row should point to a host operation, schema path, field option query, handle detail query, matrix join, or script fallback.

## TOON fit rules

Use TOON-style tabular rendering when:

- the payload is a uniform array of objects;
- object values are primitive or can be reduced to primitive labels/handles/counts;
- field names repeat enough that a single header saves tokens;
- exact ordering and count guardrails help model reliability.

Prefer JSON or concise markdown when:

- the shape is deeply nested or irregular;
- values include nested objects/arrays that would fall back to verbose TOON list form;
- the consumer is not an LLM prompt;
- the model must emit machine-validated structured output rather than read context.

## Implementation sequence

1. Generate a compressed host capability map from `HostOperationsCatalog.PublicHttp` and `HostOperationAgentMetadata`.
2. Add a renderer test set comparing JSON vs compact markdown vs TOON for representative host-operation metadata, schedule summaries, family catalogs, and coverage matrices.
3. Wire Pea to prefer compressed maps for discovery, then call existing host operations for detail.
4. Promote repeated compressed shapes into a shared projection contract only after the first Pea workflow proves the shape.
5. Add budget/truncation/freshness assertions so compression cannot silently hide missing data.

## Verification criteria

- A Pea/operator prompt can choose the right next operation from a compressed map without seeing full operation docs.
- Round-trip tests prove TOON-rendered payloads decode back to semantically equivalent JSON for supported shapes.
- Token counts improve materially for uniform arrays such as host-operation rows, schedule field fingerprints, family/type matrices, and parameter coverage rows.
- The fallback path remains JSON for irregular Revit shapes.
- No Revit collector or public host operation starts returning TOON as its primary contract.

## Risks

- Compression can become another stale context artifact if generated from anywhere other than the contract authority.
- TOON can be over-applied to nested Revit data where it is less compact and less legible than JSON.
- If zoom paths are prose-only, the model gets a prettier map but not a safer workflow.
- A new shared package would be premature until Pea and at least one other surface need the same projection model.

## Current recommendation

Proceed, but keep it narrow: build a generated host-capability/document-map renderer first. Use TOON experimentally as a prompt renderer, not as a new transport or host-operation response format.

## References

- `source/pea/app/PHILOSOPHY.md`
- `docs/ARCHITECTURE.md`
- `source/Pe.Shared.RevitData/AGENTS.md`
- `source/Pe.Shared.HostContracts/Operations/HostOperationContracts.cs`
- `source/Pe.Shared.HostContracts/Operations/HostOperationsCatalog.cs`
- `source/pea/app/generated/host-operations.generated.ts`
- TOON: <https://toonformat.dev>
