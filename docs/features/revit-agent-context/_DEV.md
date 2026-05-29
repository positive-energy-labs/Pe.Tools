# Revit Agent Context Alignment

## Mental Model

Revit agent context is a progressive translation layer between the user's current Revit experience and stable Revit handles.

The user thinks in session terms: active model, current view, selected equipment, sheet placement, schedules, browser organization, and printed deliverables. Revit stores those facts across documents, views, elements, schedules, sheets, parameters, and UI session state. Pea should bridge that gap through compact host operations that start with orientation and only expand when needed.

## Architecture

Current building blocks:

- `source/Pe.Shared.HostContracts/Operations/` owns public host operation definitions and generated Pea-facing metadata.
- `source/Pe.Shared.RevitData/DocumentSessionContextContracts.cs` defines active/open document summaries.
- `source/Pe.Shared.RevitData/SelectionContracts.cs` defines selection and explicit element context queries.
- `source/Pe.Revit.DocumentData/Selection/ElementContextCollector.cs` resolves current selection or element references into identity, level, electrical, connector, circuit, panel, wire, schedule, load-classification, and requested-parameter facts.
- `source/Pe.Host` maps public host operations to local or bridge-backed behavior.
- `source/pea/app` consumes generated host-operation metadata through `host_operation_search` and `host_operation_call`.

Current layer-first operations cover the progressive context ladder:

- `revit.context.summary`: compact active document, active view/sheet, selection, browser counts, and visible-category orientation.
- `revit.context.document-session`: open/active document context; bridge-backed and does not require an active document flag in metadata.
- `revit.context.visible-summary`: bounded visible model/category context for the active view.
- `revit.resolve.references`: natural phrases such as `this view` or `selected equipment` to stable handles with provenance.
- `revit.detail.elements`: current selection or explicit element references; bridge-backed and active-document scoped.
- Domain context: `revit.catalog.*`, bounded `revit.matrix.*`, and targeted `revit.detail.*` operations for loaded families, schedules, parameter bindings, parameter coverage, schedule coverage, and electrical data.

Missing context layers should be added as small bounded projections instead of one broad context dump.

## Context Layers

1. **Session orientation**
   - Is Pe.Host reachable?
   - Is the Revit bridge connected?
   - What document is active and what other documents are open?

2. **View and sheet orientation**
   - What view or sheet is active?
   - What stable handles identify it?
   - Is the active view printable, template-controlled, placed on a sheet, dependent, schedule-like, or model-graphical?

3. **Selection orientation**
   - What is selected?
   - What are the stable element ids/unique ids?
   - Which selected items are equipment, circuits, wires, panels, schedules, annotations, or unsupported for the current task?

4. **Visible and browser-like context**
   - What major model/category/system facts are visible or relevant in the active view?
   - How would the user find this item in Revit's project browser or sheet organization?
   - Which summaries can be returned cheaply before a larger query?

5. **Targeted detail**
   - Resolve a handle into detailed element/view/sheet/schedule data.
   - Return explicit ambiguity and provenance when natural language maps to multiple Revit targets.

## Key Flows

### Orient before acting

For normal Pea work, the intended first pass is:

1. Use injected startup context and `<pea-status-change>` deltas as the normal orientation path.
2. `host_operation_search` for the needed Revit context capability.
3. `revit.context.summary` to identify active/open document, active view/sheet, selection, browser counts, and visible-category orientation when the injected context is missing, stale, or not specific enough.
4. `revit.resolve.references` when the user's wording is ambiguous or natural, such as `this view` or `selected equipment`.
5. Domain-specific `revit.catalog.*` calls for inventory, bounded `revit.matrix.schedule-coverage` / `revit.matrix.parameter-coverage` calls for joins, or `revit.detail.*` only after the target is known.

### Resolve natural references

Natural references should become stable handles:

- `this model` -> active document key/title/path/cloud identifiers.
- `this view` -> active view handle and view summary.
- `selected equipment` -> current selection entries with element ids/unique ids and effective identity.
- `that panel schedule` -> schedule/panel-schedule handle plus panel provenance.
- `printed Level 1 mech plan` -> sheet/view/printable-view candidates with ambiguity notes.

### Keep summaries cheap

Default responses should prefer:

- counts and top candidates
- names, categories, view/sheet types, and discipline/level/phase labels
- stable ids and unique ids
- provenance: active document, active view, selection, explicit lookup, or derived relationship
- next query hints for detail expansion

Avoid returning full element tables, full parameter bags, all schedule rows, or all family types unless the task asks for an export or audit. Prefer result views, budgets, and truncation diagnostics.

## Implementation Direction

Current compact projections include context summaries, visible summaries, natural-reference resolution, schedule catalogs/details with budgets, loaded-family catalogs with summaries, project-parameter binding summaries, and bounded schedule/parameter coverage matrices.

Likely next contracts should focus on compact projections for:

- project-browser-like organization for views, sheets, schedules, and families
- richer active-view visible context summaries by category/system/level
- natural-reference resolution over previously returned handles and active session state
- additional reverse membership joins only after repeated workflows prove they earn their context cost

Each new operation should include generated metadata with clear family/layer/domain noun, result grain, cost tier, `summary`, `tags`, `requiresBridge`, `requiresActiveDocument`, single-flight group, strict-validation posture, and request/response type hints. Keep request shapes explicit and small so Pea can call them without guessing JSON.

## Open Questions

- Should active view context be a standalone operation or folded into document session context?
- What is the smallest useful visible-context summary for a graphical view without accidentally creating an expensive model scrape?
- How much project-browser structure should be exposed directly versus as search/navigation projections?
- Which UI-session facts can be safely mirrored in a future Design Automation-friendly document-owned shape, and which must remain desktop bridge-only?


## Project Browser lens

`revit.catalog.project-browser` exposes bounded folder/path vocabulary and item handles for Views, Sheets, and Schedules. Treat this as human navigation/provenance: useful for scoping, ranking, validation, and explanations around printed/archive/design/reference language. Use semantic catalog, matrix, and detail operations for model facts, schedule rows, parameters, and element data.
