# Proposition: Model Revit Data as Progressive Discovery, Not Raw Dumps

## Status

Research proposition. Temporary context for Revit/document-data implications of schema compression.

## Proposition

Schema compression is highly applicable to Revit document data, but only if it follows the existing document-data ladder: orient, inventory, resolve, join, then inspect detail. The compressed layer should summarize current document shape and available joins while preserving stable handles, provenance, budgets, diagnostics, and freshness.

Do not expose raw Revit API object graphs or broad all-model dumps to Pea. Compress the contract-shaped projections already owned by `Pe.Shared.RevitData` and collected by Revit-side libraries.

## Current repo fit

`docs/ARCHITECTURE.md` defines the ladder:

- `Context`: active document/view/sheet/selection/browser/visible summary;
- `Catalog`: inventories such as families, schedules, sheets, views, parameters, panels;
- `Detail`: one known handle, row, sheet anchor, element, or document object;
- `Relation / matrix`: family/type/instance/parameter/schedule/sheet coverage joins;
- `Projection`: UI, CSV, artifact, profile fragment, or report shape;
- `Apply`: explicit mutation after proof.

`source/Pe.Shared.RevitData/AGENTS.md` reinforces the same posture: portable DTOs, compact defaults, handles over eager dumps, provenance, parameter identity, browser provenance, budgets, result pages, and diagnostics.

`source/Pe.Shared.RevitData/RevitDataProjectionContracts.cs` already has a reusable shape for common-envelope requests:

```text
Filter / Scope / References / Projection / Budget / Options
```

This is a strong foundation for schema compression because every compressed row can point at an executable zoom or join path.

## Revit API findings that support the ladder

### Schedules are naturally tabular but semantically complex

Revit `ViewSchedule` represents schedule-like views such as regular schedules, key schedules, material takeoffs, view lists, sheet lists, keynote legends, revision schedules, and note blocks. It is explicitly not used for panel schedules, which are `PanelScheduleView`. Schedule rows generally represent elements and columns generally represent parameters, but filters, sorting, grouping, totals, formulas, and other schedule features complicate naive table assumptions.

`ScheduleDefinition` owns the schedule-authoring semantics: category, fields, filters, sorting/grouping, linked-file inclusion, filter-by-sheet, itemization, embedded schedules, and valid field/filter operations.

Implication: schedule compression should separate definition/catalog facts from rendered row/cell detail and from schedule-coverage matrix facts.

### Panel schedules are a separate electrical domain

`PanelScheduleView` is a `TableView` with panel/electrical behavior: circuit cell lookup, slot movement/locking, spare/space handling, apparent/demand load values, load classification accessors, panel/template accessors, and section/table data.

Implication: panel schedules should stay under electrical-panel-schedule detail operations, not be merged into generic schedule discovery.

### Collectors reward bounded native filters

`FilteredElementCollector` requires at least one filter before extraction. Revit reorders filters to minimize element expansion, and native filters should be applied before LINQ for performance. Callers should use only one extraction path at a time because extraction methods reset the collector.

Implication: compressed discovery should encourage scopes, categories, handles, and view references before detail collection. A broad "dump every element" path is both slow and architecturally wrong.

## Current operation ladder examples

Good paths already exist:

- Start with `revit.context.summary` for active document/view/sheet/selection orientation.
- Use `revit.context.visible-summary` for bounded visible/current-view context.
- Use `revit.resolve.references` for fuzzy user phrases and printed-context references.
- Use `revit.catalog.project-index` for broad semantic project inventory.
- Use `revit.catalog.project-browser` for folder/path navigation provenance, not BIM truth.
- Use `revit.catalog.schedules` for schedule inventory, fields, filters, fingerprints, placements, and browser paths.
- Use `revit.matrix.schedule-coverage` for visible-equipment or scoped element-to-schedule coverage.
- Use `revit.detail.schedules` for rows/cells/issue rows of known schedules.
- Use `revit.catalog.parameter-bindings`, `revit.catalog.concept-evidence`, and `revit.catalog.parameter-evidence` before parameter coverage when project standards may use custom/shared parameters.
- Use `revit.matrix.parameter-coverage` for missing/blank/default parameter audits.
- Use `revit.detail.elements` for exact handles and requested parameters such as Mark, Panel, Circuit Number, and Load Name.
- Use electrical catalog/detail calls only after element detail or panel schedule facts identify likely panel/circuit/load candidates.

## Proposed compressed document maps

### 1. Project orientation map

Summarize active/open document state, active view/sheet, selection count, visible category counts, and candidate next operations.

```text
project: Office Tower MEP.rvt [active, Project, local]
activeView: M201 Mechanical Level 1 [sheetPlacement=true]
selection: 3 equipment handles
visibleCategories[5]{category,count,samples}
next: resolve.references, context.visible-summary, catalog.project-index
```

### 2. Schedule map

Summarize schedule groups, duplicate-normalized names, field fingerprints, sheet placements, authored filters, and zoom paths.

```text
schedules[84] scope=project projection=summary
  duplicateNameGroups[3]{normalized,count,examples}
  fieldFingerprints[10]{schedule,fieldCount,hash,topFields}
  placements[12]{schedule,sheet,role}
zoom: detail.schedules(scheduleIds), matrix.schedule-coverage(viewIds|elementHandles)
```

### 3. Parameter map

Summarize project bindings, parameter identities, concept/parameter evidence, category applicability, and coverage/audit paths.

```text
parameterConcept: equipment mark
candidates[4]{name,kind,confidence,bindingCount,scheduleFieldCount,reason}
zoom: catalog.parameter-bindings, matrix.parameter-coverage, detail.elements(requestedParameters)
```

### 4. Electrical map

Summarize panels, circuits, panel schedules, and load classifications only after scope is narrowed.

```text
panelCandidates[3]{name,mark,role,status,source}
circuitCandidates[8]{panel,circuitNumber,loadName,source,nearbyProxyReason}
zoom: catalog.electrical-panels, catalog.electrical-circuits, detail.electrical-panel-schedules
```

## Implementation details

1. Build compressed maps from existing DTOs and metadata first; do not change collectors just to make a prettier prompt shape.
2. Preserve stable handles in every compressed row that may become a follow-up target.
3. Preserve provenance/freshness and truncation information. A compact answer without scope and freshness is unsafe.
4. Treat schedule catalog/detail/coverage as three different projections, not one giant schedule object.
5. Treat parameter identity as a first-class join key. Avoid name-only joins except as explicit `NameFallback` evidence.
6. Use TOON-style tabular output only for uniform rows: schedule fingerprints, family/type matrix rows, coverage rows, visible category summaries, candidate lists.
7. Keep detail outputs explicit and bounded by request budgets.

## Verification criteria

- A compressed project map leads Pea to the same next host operation a human developer would choose from the C# client docs.
- Schedule questions route to catalog, detail, or coverage based on intent instead of dumping all schedule data.
- Parameter questions route through evidence/bindings before coverage when identity is uncertain.
- Electrical questions do not scan all circuits/panel schedules before exact panel/load/circuit candidates exist.
- Collector performance remains bounded by native filters, scopes, handles, budgets, and result pages.

## Risks

- A compressed Revit map can hide important absence unless truncation and diagnostics are visible.
- Browser paths are useful provenance but can be mistaken for BIM truth.
- Schedule rows look tabular but may represent grouped, footer, non-bindable, or multiple-subject rows.
- Panel schedules are tempting to normalize with regular schedules, but Revit API semantics differ enough that this would make the agent world less trustworthy.

## Current recommendation

Proceed with compressed Revit discovery maps over current `Pe.Shared.RevitData` contracts. Prioritize host-operation routing and schedule/parameter/electrical relationship summaries before any new public operation format.

## References

- `docs/ARCHITECTURE.md`
- `source/Pe.Shared.RevitData/AGENTS.md`
- `source/Pe.Shared.RevitData/RevitDataProjectionContracts.cs`
- `source/Pe.Shared.RevitData/Schedules/ScheduleContracts.cs`
- `source/Pe.Shared.RevitData/CoverageMatrixContracts.cs`
- `source/Pe.Shared.RevitData/ParameterContracts.cs`
- `source/Pe.Shared.RevitData/ParameterEvidenceContracts.cs`
- `source/Pe.Shared.RevitData/ConceptEvidenceContracts.cs`
- `source/Pe.Shared.RevitData/ElectricalContracts.cs`
- `source/Pe.Shared.RevitData/ElectricalPanelScheduleContracts.cs`
- Revit API `ViewSchedule`: <https://rvtdocs.com/2025/0dae24ba-5dcb-9a34-cccc-0cf8cc52bcd3>
- Revit API `ScheduleDefinition`: <https://rvtdocs.com/2025/420696e3-f3ec-1a1d-1205-36a8119d81e5>
- Revit API `PanelScheduleView`: <https://rvtdocs.com/2025/ef4390e8-5a93-fe7f-580b-c8ec297f6b52>
- Revit API `FilteredElementCollector`: <https://rvtdocs.com/2025/263cf06b-98be-6f91-c4da-fb47d01688f3>
