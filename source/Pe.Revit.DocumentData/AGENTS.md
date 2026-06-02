# Pe.Revit.DocumentData

## Scope

Owns document-backed Revit data collectors that read active/project document state into shared `Pe.Shared.RevitData` contracts.

## Purpose

`Pe.Revit.DocumentData` turns Revit API/session/document facts into compact, typed, consumer-safe data. It should hide Revit collection quirks behind small collectors and return stable handles, provenance, bounded projections, and diagnostics instead of raw API-shaped dumps.

## Critical Entry Points

- `AgentContext/RevitAgentContextCollector.cs` - session/view/sheet/selection/browser/visible-summary and natural-reference resolution collector.
- `Selection/ElementContextCollector.cs` - current selection and explicit element detail collection.
- `Families/Loaded/Collectors/LoadedFamiliesCollector.cs` and related collectors - loaded-family catalog/matrix collection.
- `Families/Loaded/Collectors/LoadedFamiliesFormulaCollector.cs` - narrow formula supplementation path.
- `Parameters/RevitParameterAuthorityResolver.cs` - internal parameter resolution/provenance logic.
- `Schedules/Collect/` - schedule catalog/query/profile collection.
- `ProjectBrowser/ProjectBrowserCollector.cs` - bounded Project Browser organization and path/provenance collection.

## Shared Language

| Term | Meaning | Prefer / Avoid |
| --- | --- | --- |
| **collect** | Read live Revit state into transient data | Prefer for normal document queries |
| **bounded projection** | Optional, deliberately limited join or summary layered on a compact base result | Prefer over bespoke audit endpoints |
| **parameter presence** | Public loaded-family matrix vocabulary for family/project binding presence | Avoid leaking resolver `authority` into DTOs |
| **natural reference** | User phrase like `this view` or `selected equipment` resolved to stable handles | Return ambiguity and provenance, not guesses |
| **Project Browser lens** | Read-only browser folder/path organization for views, sheets, and schedules | Use for navigation/ranking/provenance; do not click UI or infer BIM facts from folder names alone |

## Living Memory

- Keep broad host/query endpoints out of `Document.EditFamily(...)`. Opening family documents is an expensive, narrow investigation escape hatch and must happen outside any active transaction on the source project document.
- Prefer active-document/session collectors for user context, but keep document-owned helpers close to `Document`/shared collector seams where DA-safe behavior is possible.
- Default outputs should stay compact. Add bounded projections for sheet placement, schedule row handles, reverse schedule membership, placed-instance summaries, and visible-category context before creating task-specific audit endpoints.
- Parameter evidence should rank inspectable candidates from bindings, schedule fields/filters, and scoped elements; do not hide substitutions such as custom tag parameters behind universal intent labels.
- Match collectors to the operation ladder: context collectors orient, catalog collectors inventory nouns, detail collectors require known handles/rows, matrix collectors perform joins/audits, and scripts remain the escape hatch for custom API gaps or mutation.
- Broad collectors should apply explicit budget defaults and return `RevitDataResultPage` plus truncation diagnostics when capped. `IncludeDiagnostics=false` may suppress recoverable issues only at the final projection boundary.
- Filters should be trimmed and case-insensitive unless Revit identity semantics require otherwise. Filter misses should produce `RevitDataIssue` diagnostics instead of silently returning a misleading broad/empty result.
- Bridge-backed calls currently share the Revit single-flight lane; collectors should not assume hidden parallelism or reentrant Revit API access.
- Return `RevitDataIssue` diagnostics for partial or unsupported facts whenever the caller can recover.
- Direct Project Browser projection belongs in `ProjectBrowserCollector`; validate requested paths against the live browser organization and return nearest-match diagnostics instead of silently broadening invalid paths.
