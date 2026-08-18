# param-driven-solids ledger

`ParamDrivenSolids` is the authored/serialized shape for Family Foundry solid geometry: authors work in semantic dimensions and constraints, not low-level Revit construction detail. Implementation lives in `source/Pe.Revit.FamilyFoundry` (`AuthoredParamDrivenSolids.*`, `Resolution/AuthoredParamDrivenSolidsCompiler.*`, `Snapshots/`, `Serialization/`). Decided lines were distilled 2026-08-17 from the deleted `_GOALS.md` (authored 2026-04-06) and carry the distillation date.

## Decided

- 2026-08-17 — `ParamDrivenSolids` is the ONLY public authored/serialized solids contract — one shape for hand-authored profiles, serialized output, snapshots, and replay. Older reference-plane/dimension and constrained-extrusion concepts survive as internal compile targets or future low-level primitives, never as peer public authoring models.
- 2026-08-17 — The public contract is semantic and shape-specific (rectangles use rectangle semantics; circles/cylinders their own), and the compiled execution plan is runtime-only — a deterministic intermediate that is inspectable in logs, proofs, and tests, not a second authoring model. Internal helper constructs stay richer than the public contract without leaking into authored JSON.
- 2026-08-17 — Sketch placement prefers reference-plane-based placement over face-authored placement; shared constraints are expressed once and reused across solids; generated reference-plane names are deterministic and human-readable so diffs stay stable.
- 2026-08-17 — Rectangle semantics normalize orientation so authored JSON reads consistently; orientation rules come from deterministic geometric logic, never UI-view assumptions.
- 2026-08-17 — Reverse inference preserves ambiguity honestly through warnings and unresolved markers instead of silently guessing, and execution REFUSES unresolved or ambiguous inferred constraints. Serialized vendor-family output is an authoring seed, not a low-level dump — and never execution-safe without author review.
- 2026-08-17 — Validation fails before Revit mutation begins: compile-time and inference-time diagnostics surface in Family Foundry preview/validation flows, ahead of execution.
- 2026-08-17 — Compiler, inference, validation, and name-synthesis are independently testable seams.

## Tried & rejected

*(nothing recorded — this dir was goals-only before 2026-08-17)*

## Owed

*(none recorded; the goals doc it replaced was aspirational and its aspirations are implemented — verify against `AuthoredParamDrivenSolidsCompiler` before assuming full coverage)*
