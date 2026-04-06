# Param-Driven Solids

## North Star

Make `ParamDrivenSolids` the single canonical authored and serialized shape for Family Foundry solid geometry so authors work in semantic dimensions and constraints instead of low-level Revit construction detail.

## User Goals

- Author solid geometry in terms of semantic dimensions like width, length, height, diameter, and stable placement intent.
- Use one public shape for hand-authored profiles, serialized output, snapshots, and replay-oriented workflows.
- Reuse serialized vendor-family output as a practical authoring seed instead of a low-level dump.
- Get deterministic names, stable diffs, and explicit diagnostics when inference is ambiguous or unresolved.
- Fail before Revit mutation begins when the authored or inferred shape is invalid.

## Developer Goals

- Keep `ParamDrivenSolids` as the only public authored/serialized solids contract.
- Compile the semantic shape into lower-level planes, dimensions, sketch placement, and solid-creation operations internally.
- Preserve a deterministic intermediate plan that is easy to inspect in logs, proofs, and tests.
- Support shared constraints across multiple solids without duplicated authored wiring.
- Keep internal helper constructs richer than the public contract without leaking that complexity into authored JSON.
- Make compiler, inference, validation, and name-synthesis code independently testable.

## Integration Goals

- Align authored profiles, reverse inference, tests, and compiler input on the same public shape.
- Keep the compiled execution plan as the runtime-only shape, not a second authoring model.
- Allow snapshots and serializers to emit authored-friendly output with explicit warnings or unresolved markers when confidence is limited.
- Keep Family Foundry preview and validation flows able to surface compile-time and inference-time diagnostics before execution.

## Decisions

- `ParamDrivenSolids` is the canonical public shape for authored and serialized solid definitions.
- Older reference-plane/dimension and constrained-extrusion concepts remain internal compile targets or future low-level primitives, not peer public authoring models.
- The public contract is semantic and shape-specific.
  - Rectangles use explicit rectangle semantics.
  - Circles/cylinders use a similar shape-appropriate semantic contract.
- Sketch placement should prefer reference-plane-based placement over face-authored placement.
- Shared constraints should be expressible once and reused across multiple solids.
- Generated reference-plane naming should be deterministic and human-readable.
- Reverse inference should preserve ambiguity honestly through warnings/unresolved markers instead of silently guessing.
- Execution should refuse unresolved or ambiguous inferred constraints.

## Geometry Semantics

- Rectangle semantics should normalize orientation so authored JSON reads consistently.
- Axis constraints should support mirrored and offset behaviors across supported shapes.
- Stacked boxes, cylinders, and similar MEP-oriented arrangements should remain expressible through shared plane-driven constraints.
- Orientation rules should come from deterministic geometric logic rather than UI-view assumptions.

## Non-Goals

- Do not keep multiple equal public solids authoring models alive long-term.
- Do not expose low-level helper construction detail as the primary authored contract.
- Do not silently invent semantics during serialization or reverse inference.
- Do not treat ambiguous inferred output as execution-safe without author review.

## Notes

- Main implementation ownership currently sits in `Pe.Revit.FamilyFoundry`, but this is a feature-level goals doc because the capability spans authoring shape, reverse inference, snapshots, tests, and runtime execution.
