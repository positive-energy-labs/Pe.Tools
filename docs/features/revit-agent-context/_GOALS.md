# Revit Agent Context Alignment

## North Star

Pea should orient to Revit the way the user experiences it: active document, active view or sheet, current selection, visible model state, Project Browser organization, printed/deliverable context, and stable handles for follow-up action.

Expose Revit state maximally through host operations, but keep the Pea-facing tool surface minimal, intuitive, and cheap in tokens. The agent should ask for compact summaries first, then progressively resolve richer context only when the task needs it.

## User Goals

- Refer to Revit naturally: `this view`, `the selected equipment`, `the active sheet`, `printed mech Level 1 plan`, `that panel schedule`, or `the open family`.
- Get answers grounded in the current Revit session without raw API spelunking.
- See concise context summaries with stable document/view/element handles and provenance.
- Move from summary to detail without restating intent or losing the current Revit target.
- Trust that Pea distinguishes visible/active/selected/open/printed state instead of flattening all model data into one dump.

## Developer Goals

- Build context as progressive host operations, not a large eager snapshot.
- Prefer generated host-operation metadata and request/response hints over hand-authored Pea prompt knowledge.
- Keep returned shapes compact by default: summaries, counts, labels, handles, provenance, ambiguity notes, and next-query hints.
- Make every user-facing context object resolvable back to stable Revit identifiers such as document keys, element ids, unique ids, view ids, sheet ids, and schedule ids.
- Keep `Pe.Shared.HostContracts` as the route/contract authority; do not create caller-local route maps.
- Keep Revit collection logic in Revit/data packages and expose it through `Pe.Host`; Pea should consume host operations rather than duplicate Revit API logic.

## Integration Goals

- Extend the current layer-first context base:
  - `revit.context.summary` for active/open document, active view/sheet, selection, browser counts, and visible-category orientation.
  - `revit.context.document-session` for active/open document facts.
  - `revit.context.visible-summary` for bounded active-view visible model state.
  - `revit.resolve.references` for natural references to stable handles with provenance.
  - `revit.detail.elements` for current selection or explicit element references.
  - `revit.catalog.project-browser` for bounded Project Browser folder/path vocabulary and view/sheet/schedule provenance.
  - `revit.catalog.*`, `revit.matrix.*`, and `revit.detail.*` operations for semantic schedule, loaded-family, electrical, and parameter-binding domain context.
- Let Pea resolve natural references through a small sequence: status -> context summary -> resolve references -> targeted detail/catalog/matrix query.
- Carry generated operation metadata through the TypeScript catalog so Pea can discover layer, domain noun, cost tier, result grain, strict validation, and single-flight requirements without hard-coded endpoint lore.
- Preserve Design Automation safety by keeping UI-session-only facts behind desktop bridge operations and document-owned facts in shared collectors when possible.

## Non-Goals

- Do not expose one giant `get everything about Revit` tool.
- Do not make Pea users choose raw Revit API classes, category ids, or endpoint routes for normal context questions.
- Do not eagerly dump all elements visible in a view unless the user asks for a broad export.
- Do not turn Pea into `pe-dev`; repo diagnostics and build orchestration remain dev/operator concerns.
- Do not add bespoke task-specific audit endpoints when bounded projections on context/catalog/detail operations can answer the task.
- Do not clone the entire Project Browser or add browser-specific UI activation in the MVP; browser organization is a live navigation lens, not the semantic model.
