## Problem Statement

Family Foundry extrusion authoring is currently split across separate reference-plane/dimension settings and constrained-extrusion settings. That split makes geometry intent hard to author, easy to drift, and difficult to serialize back into a useful authoring seed. The current shape also leaks low-level Revit implementation details such as specific plane names into authored JSON, which makes roundtripping brittle and increases the chance of silent mismatch between constraints and created solids.

This is especially problematic for two core workflows:

1. Authoring new family geometry by hand in JSON, where the author cares about semantic dimensions like width, length, height, diameter, and sketch placement rather than low-level plane pair wiring.
2. Serializing existing families, including third-party vendor families, into a reusable Family Foundry profile that preserves as much semantic meaning as possible and can be re-authored or executed in a different Revit version.

The goal is to make extrusion creation easier to author, easier to execute reliably, and easier to serialize into a shape that is meaningful to humans.

## Solution

Introduce a new high-level `ParamDrivenSolids` authoring and serialization model as the single public shape for authored and serialized solid definitions.

`ParamDrivenSolids` will:

- Be the only authored and serialized solid shape.
- Represent geometry intent semantically for supported shapes, starting with rectangles and circles/cylinders.
- Compile into lower-level reference-plane, dimension, sketch-plane, and solid-creation operations internally.
- Support shared constraints across multiple solids.
- Support deterministic, human-readable generated reference-plane names.
- Prefer reference-plane-based sketch placement rather than face-based authored placement.
- Serialize arbitrary families into the same high-level shape using best-effort semantic inference.
- Emit explicit warnings and unresolved markers when inference is ambiguous.
- Refuse execution when unresolved or ambiguous inferred constraints remain unfixed.

The lower-level reference-plane/dimension operation remains valuable as an independent primitive for future commands, but it is no longer a peer authoring model for extrusion creation.

## User Stories

1. As a Family Foundry author, I want to define a rectangular solid in terms of width, length, and height, so that I can express geometry intent without wiring plane pairs manually.
2. As a Family Foundry author, I want mirrored and offset constraints to be expressed directly on a solid axis, so that I can author symmetric and anchored geometry more naturally.
3. As a Family Foundry author, I want a solid definition to act as the single source of truth for both the constraints and the created geometry, so that those systems cannot drift out of sync.
4. As a Family Foundry author, I want multiple solids to share the same driving constraints, so that stacked and coordinated geometry can be authored once and reused.
5. As a Family Foundry author, I want to reference an existing or generated reference plane as an anchor, so that I can build solids incrementally from prior constraints.
6. As a Family Foundry author, I want rectangle semantics to follow a consistent width/length convention, so that authored JSON reads predictably regardless of source family naming.
7. As a Family Foundry author, I want cylinders to use a similar semantic model to rectangles, so that common MEP workflows feel uniform.
8. As a Family Foundry author, I want to sketch solids from reference planes rather than raw faces, so that placement remains stable and serializable.
9. As a Family Foundry author, I want helper construction details to stay out of the public JSON, so that the authoring model stays focused on intent.
10. As a Family Foundry author, I want validation to run before Revit mutation begins, so that bad configurations fail early and loudly.
11. As a Family Foundry author, I want the preview experience to surface compile and validation diagnostics, so that I can fix profiles before running them.
12. As a Family Foundry author, I want exact-match constraint deduplication, so that shared constraints are reused instead of duplicated accidentally.
13. As a Family Foundry author, I want deterministic generated plane names, so that diffs, debugging, and repeated compiles remain stable.
14. As a Family Foundry author, I want execution to reject ambiguous inferred semantics, so that the serializer never silently invents bad authoring intent.
15. As a Family Foundry author, I want serialized output to use the same shape that hand-authored profiles use, so that snapshot output is immediately useful as an authoring seed.
16. As a Family Foundry author, I want unresolved inference to be clearly marked inside the serialized shape, so that warnings travel with the JSON instead of being lost in logs.
17. As a Family Foundry author, I want third-party families to serialize into the new shape even when imperfect, so that vendor content can still be migrated across Revit versions.
18. As a Family Foundry author, I want the serializer to synthesize meaningful names for unnamed reference planes, so that exported shapes are understandable.
19. As a Family Foundry author, I want the system to distinguish between exact semantics and inferred semantics internally, so that diagnostics can be truthful without exposing multiple public formats.
20. As a Family Foundry author, I want ambiguous same-axis constraints to fail validation, so that the system does not guess between competing interpretations.
21. As a Family Foundry author, I want mirrored height support, so that vertically symmetric solids are expressible without falling back to low-level operations.
22. As a Family Foundry author, I want stacked boxes and cylinders on box faces to be expressible through shared plane-driven constraints, so that common equipment workflows are supported directly.
23. As a maintainer, I want the compiler to build a dependency graph for generated constraints and solids, so that authoring order does not control correctness.
24. As a maintainer, I want cyclic dependencies between generated constraints to be detected before execution, so that invalid profiles fail deterministically.
25. As a maintainer, I want the compiler to emit a deterministic intermediate plan, so that logs and debugging can inspect what will actually be created.
26. As a maintainer, I want the serializer to normalize vendor naming into Foundry semantics, so that authored output follows one convention instead of preserving arbitrary source wording.
27. As a maintainer, I want the decompiler to record confidence and ambiguity, so that best-effort semantic output is auditable.
28. As a maintainer, I want the high-level shape to stay small and semantic while allowing richer internal helper constructs, so that public API complexity remains controlled.
29. As a maintainer, I want deep, testable modules around compile, infer, validate, and name synthesis, so that this feature can evolve without coupling every change to Revit document mutation.
30. As a user migrating vendor content, I want a serialized authoring seed rather than a raw low-level dump, so that the output is usable as a starting point for real work.

## Implementation Decisions

- `ParamDrivenSolids` becomes the only public authored and serialized solid model.
- The existing lower-level reference-plane and dimension concepts remain as internal compile targets and future standalone primitives, not as a second public way to author the same extrusion intent.
- The public model is semantic and shape-specific. Rectangles use explicit rectangle semantics. Circles/cylinders use a similar but shape-appropriate semantic contract.
- Axis constraints should be represented with a reusable internal concept that can support both `Mirror` and `Offset` across rectangle and cylinder axes.
- Rectangle semantics normalize orientation such that, in plan, length is left-right and width is front-back.
- Orientation should be determined from the sketch plane's local basis, using a deterministic rule rather than world-axis or UI-view assumptions.
- Sketch placement should resolve to reference planes, not authored extrusion-face references.
- Shared constraints are required and should be deduplicated only on exact semantic identity.
- Generated reference planes must have deterministic, human-readable names. Human-readable display names are required even if internal compilation uses a separate semantic identity key.
- Helper planes may be synthesized during compilation when needed, but they are internal details and must not leak into the serialized authoring model.
- The compiler should construct a dependency graph of generated constraints and solids and topologically sort execution. Authored JSON order should not be semantically required.
- Validation must run before any Revit mutation begins. Missing anchors, invalid orientations, ambiguous inference, same-axis conflicts, and dependency cycles must hard fail at validation/compile time.
- The compiler should emit a deterministic intermediate plan suitable for logging, diagnostics, preview, and debugging.
- Serialization/decompilation must work for both compiler-generated families and arbitrary third-party families.
- Internal decompilation should distinguish between exact semantic reconstruction and inferred semantic reconstruction, even though only one public serialized shape is emitted.
- Ambiguous inference must still serialize into the public shape, but with explicit unresolved markers and warnings that make manual repair necessary.
- Execution must reject unresolved or ambiguous inferred specs until the user fixes them.
- The serializer should synthesize readable names for unnamed or poorly named reference planes rather than preserving opaque or missing source naming.
- There is no backward-compatibility requirement for existing Family Foundry extrusion profile shapes in this repo or in local settings.
- Extrusion identity should not rely on the `GenericForm.Name` setter as a durable API contract.

## Testing Decisions

- Good tests should validate externally visible behavior and meaningful output contracts rather than incidental implementation details.
- Compiler tests should verify that valid high-level solid specs produce the expected intermediate plan, shared constraint deduplication, deterministic naming, dependency ordering, and hard validation failures.
- Serializer/decompiler tests should verify both exact reconstruction for compiler-owned families and best-effort inferred reconstruction for arbitrary families, including warnings and unresolved markers.
- Execution tests should verify that valid compiled plans create stable, constrained geometry and that unresolved inferred specs are rejected before mutation.
- Roundtrip tests should assert that authored profiles serialize back into the same high-level public shape where semantics are exact, and into a warning-marked best-effort shape where semantics are inferred.
- Priority scenario tests should include:
  - the existing magic-box style rectangle workflow,
  - mirrored and offset height cases,
  - stacked boxes sharing constraints,
  - a box with circles/cylinders constrained to its faces via reference-plane-driven placement,
  - ambiguous third-party-family inference cases that must serialize with warnings and fail execution until fixed.
- Prior art exists in the Family Foundry roundtrip and Revit-backed test lanes, especially the current magic-box roundtrip coverage and related extrusion snapshot work.
- New deep modules around compile, validate, infer, and naming should be tested in isolation where possible, with Revit-backed tests reserved for document behavior that cannot be proven outside Revit.

## Out of Scope

- Supporting arbitrary sketch profiles, sweeps, blends, or general custom-shape solid authoring in this refactor.
- Maintaining backward compatibility for existing public extrusion profile shapes.
- Preserving vendor parameter naming or source family naming as canonical semantics.
- Face-based public authoring references as a first-class model.
- Silent execution of ambiguous inferred semantics.

## Further Notes

- This refactor is intended to improve both authoring ergonomics and serialization usefulness. If the serializer cannot produce a trustworthy authoring seed for arbitrary families, the design loses much of its value.
- The public model should stay semantic and approachable for hand-authored JSON, while the internals are free to grow richer to support compilation, diagnostics, and decompilation.
- The next design step should define the concrete `ParamDrivenSolids` schema, including unresolved inference markers, rectangle and cylinder shape contracts, and the reusable axis-constraint structure.

## Connector Addendum

### Problem Additions

- Family Foundry currently lacks a semantic model for authored MEP connectors.
- Connector creation has been split across ad hoc creation and post-pass mutation, which makes connector intent drift away from geometry intent.
- For duct and pipe workflows, best practice is to host the connector on a same-size extrusion. The public authoring model should capture that unit directly.

### Solution Additions

- `ParamDrivenSolids` now includes semantic connector authoring in addition to rectangles and cylinders.
- Connectors are authored as their own semantic units in a `Connectors` collection.
- Each connector spec owns its own stub geometry.
- V1 connector placement is intentionally narrow:
  - the connector is centered on the terminal face normal to the stub extrusion direction,
  - no authored XY offsets are supported,
  - no authored manual rotation is supported.
- Roundtrip serialization should emit the same public connector shape for compiler-owned families.
- Dirty third-party-family connector inference remains deferred; unresolved or ambiguous semantics must be explicit and execution must reject ambiguous specs.

### New User Stories

1. As a Family Foundry author, I want to author a duct, pipe, or electrical connector as one semantic unit with its host geometry, so the geometry and connector behavior cannot drift apart.
2. As a Family Foundry author, I want duct and pipe connectors to be hosted on same-size stub geometry by default, so authored families follow Revit best practice.
3. As a Family Foundry author, I want connectors to be centered on their host face automatically, so I do not need to author low-level placement details.
4. As a Family Foundry author, I want connector parameter associations to be declarative, so office standards can be applied without one-off make-connector operations.
5. As a Family Foundry author, I want serialized connector output to be a usable authoring seed rather than a low-level Revit dump.

### Connector Decisions

- `ParamDrivenSolids` gains a public `Connectors` collection.
- Connectors are their own semantic units and are not nested under rectangle or cylinder specs.
- Every V1 connector spec includes stub geometry.
- Host references use string aliases consistent with the existing `Box.Height.Top` alias pattern.
- Electrical connectors also use stub geometry in V1 for consistency; plane-only electrical hosting is deferred.
- Compiler-owned connector units may persist internal metadata to support exact roundtrip reconstruction, but that metadata is an internal implementation detail, not the public model.
- Internal connector metadata must not become the only serialization strategy. Third-party and non-generated families still need best-effort semantic inference when that later scope is implemented.
- Round connector stubs must declare their center planes explicitly, the same way semantic cylinders do, so their diameter constraint can be reconstructed and roundtripped.
- Company-specific formulas or parameter defaults must stay in app/profile orchestration and not be pushed into Family Foundry internals.
- Post-pass connector mutation is not the primary authoring model for the new API.

### Connector Testing Additions

- Compiler tests should cover connector schema validation, alias resolution, domain-specific compile output, and rejection of ambiguous connector semantics.
- Execution tests should prove that connector stub geometry and hosted connectors are created together and that declared associations are applied.
- Revit-backed constraint tests should exercise multiple parameter states for any non-trivial constraint. One static assertion is not sufficient proof for:
  - cylinder diameter,
  - connector stub diameter,
  - rectangular connector stub width and length,
  - any connector behavior that only reveals mistakes when switching family types.
- The test harness should support iterating the same family through multiple type states or parameter values and measuring the resulting geometry or connector-driven values.

### Connector Out Of Scope Additions

- Arbitrary connector XY placement or freeform manual positioning.
- Connector authoring without stub geometry.
- Full dirty third-party-family connector semantic inference.
- Office-specific electrical formulas inside core Family Foundry library code.
