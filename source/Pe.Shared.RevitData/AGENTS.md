# Pe.Shared.RevitData

## Scope

Owns durable DTOs and enums for Revit state collected through host operations, scripts, tests, and future frontend views.

## Purpose

`Pe.Shared.RevitData` is the clean contract boundary between Revit collectors and consumers. It should express Revit concepts in user-facing, portable language while preserving stable handles, provenance, diagnostics, and enough shape for compact rendering.

## Critical Entry Points

- `AgentContextContracts.cs` - compact context, visible-summary, natural-reference, stable-handle, and provenance contracts.
- `DocumentSessionContextContracts.cs` - active/open document session summaries.
- `SelectionContracts.cs` - element context, selection, explicit element references, and nearby document facts.
- `LoadedFamiliesContracts.cs` - loaded-family catalog/matrix contracts and parameter presence language.
- `Parameters/ParameterIdentity.cs` - canonical parameter identity and stable key/provenance fields.
- `Schedules/` - schedule catalog/detail/profile contracts.
- `ProjectBrowserContracts.cs` and `ProjectIndexContracts.cs` - browser navigation/provenance and compact semantic project-index contracts.
- `SheetContracts.cs` - minimal sheet anchor/detail contracts for printed-context correlation, scripts, and external extractors.
- `RevitDataContracts.cs` - shared issue/diagnostic contracts.

## Shared Language

| Term | Meaning | Prefer / Avoid |
| --- | --- | --- |
| **handle** | Stable reference returned to consumers for later resolution, usually with ids/unique ids and label/provenance | Prefer handles over eager full object dumps |
| **provenance** | Why a fact is relevant: active document, active view, selection, sheet placement, printed context, explicit lookup, search | Avoid anonymous derived rows |
| **parameter identity** | Canonical parameter key plus name, kind, built-in id, shared GUID, or parameter-element id | Prefer over name-only matching |
| **parameter kind** | Whether a loaded-family parameter is built-in/shared/family/project/name-fallback style | Avoid overloading this with storage type |
| **parameter presence** | Where a parameter exists for matrix purposes: family, family-and-project-binding, project-binding-only, unresolved | Prefer this public term over `scope` or internal `authority` |
| **binding level** | Project binding applicability such as type/instance/category level | Keep separate from family parameter presence |
| **formula state** | Whether a family parameter has formula/no formula/unresolved formula facts | Prefer this over raw formula string checks |
| **Project Browser lens** | Live browser organization for views, sheets, and schedules used as navigation/provenance metadata | Avoid treating it as BIM truth or a full raw browser clone |
| **sheet anchor map** | Revit-native sheet contents and placements with handles, provenance, and optional bounds | Prefer as correlation data for scripts/extractors/vision; avoid modeling OCR/spellcheck/visual judgment as core DTOs |

## Living Memory

- Keep DTOs portable and Revit-assembly-free.
- Contracts should favor compact defaults: counts, labels, handles, provenance, issues, and bounded projections.
- Use `RevitDataOutputBudget` consistently for `MaxEntries`, `MaxRowsPerEntry`, `MaxSamplesPerEntry`, and `IncludeDiagnostics`; add `RevitDataResultPage` anywhere a collector may truncate output.
- Use public user-facing names even when collectors use deeper internal resolver language. `authority` belongs in resolver internals, not public matrix vocabulary.
- Emit diagnostics through `RevitDataIssue` rather than throwing through normal expected query ambiguity or partial collection failures.
- Do not model every Revit API type directly. Add shapes that help Pea/frontend/CLI answer user tasks cheaply and then resolve to detail deliberately.
- Keep contracts aligned to the operation ladder: context for current/visible orientation, project-index for broad inventory, project-browser for navigation/provenance, resolve for fuzzy references, catalog for noun inventories, detail for known handles/rows/sheet anchors, and matrix for coverage/join/audit/comparison projections.
- Keep Project Browser filters/provenance on browser-owned domains: project-browser, project-index, schedules, views, sheets, and natural-reference resolution. Do not spread browser filters into families, parameter bindings, circuits, panels, or broad element detail without a concrete join.
