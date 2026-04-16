# Pe.Host

## North Star

Make `Pe.Host` the stable external orchestration point for settings authoring, live Revit-backed document insight, and agent visibility into Revit.

Backend-defined metadata should drive a serious schema-based frontend runtime. First-class Revit concepts should be exposed cleanly. Both humans and agents should be able to understand and act on document state through one coherent query-friendly surface.

This should serve both local agents running beside the repo and frontend-exposed agents that use host endpoints as tools, and it should shape which endpoints we create and how we shape them. Longer term, the host should make meaningful agent-driven Revit workflows possible, potentially including carefully controlled code-execution-style capabilities.

`host-status` should become the cheap, poll-friendly freshness contract for bridge posture and active-document truth. Richer document inventory and targeting should exist beside it as explicit document-context surfaces, not be inferred from stale bridge assumptions or ad hoc scripting alone.

## User Goals

- Let lay users edit local profiles through a good external GUI instead of raw JSON-first workflows.
- Keep the editor useful even when Revit or the bridge is unavailable.
- Make live document state easy to inspect once the bridge is connected.
- Grow into richer document-aware flows such as schedule inspection and targeted editing, loaded-family inspection, and family-instance inspection.

## Developer Goals

- Let Pe.Tools declare as much profile-intrinsic metadata and relationship logic as possible from the backend.
- Keep the frontend focused on consuming schema and runtime metadata rather than re-encoding backend rules by hand.
- Support backend-declared inter-property relationships, from simple cases like families by selected category to richer document-aware dependency logic.
- Make backend metadata rich enough to drive a real frontend runtime: defaults, hints, option sources, dependency wiring, and renderer selection should come from the host contract whenever practical.
- Preserve a clear seam where the host owns structural workflows and the bridge owns live-document behavior.
- Keep `host-status` small, cheap, and trustworthy enough for frequent agent polling during live work.
- Expose document targeting explicitly when needed instead of smuggling document identity through whatever happens to be active.

## Integration Goals

- Keep the host as the single browser-facing request/response surface.
- Keep transport contracts typed, explicit, backend-owned, and friendly to TanStack Query-style caching and invalidation.
- Treat schema payloads as frontend-runtime inputs, not just validation artifacts.
- Allow backend metadata to route frontend rendering toward custom components when generic schema-driven field rendering is not enough.
- Make live Revit data available through host endpoints for frontends, local agents/LLMs, and other tooling that need transparent access to document state.
- Let more document entities become first-class host surfaces over time, especially schedules, parameters, families, categories, and later views.
- Provide a first-class document-context surface for open-document inventory and stable target-document selection.
- Grow toward richer edit flows such as loaded-family parameter edits, document-wide migration/patch flows, family-instance editing, and schedule-oriented custom experiences.

## Endpoint Shape and Tool Budget

- Treat every new endpoint as part of the effective agent tool budget, even when the endpoint is not yet exposed as a formal tool.
- Add endpoints sparingly. The bar is not just "is this useful?" but "does this create a stable contract that hides meaningful Revit weirdness better than scripting or an internal helper would?"
- Prefer endpoints when the shape represents a repeated user/job concept, requires hidden joins or document-context resolution, and meaningfully shrinks prompt/script/context size for callers.
- Prefer internal Revit-side libraries when the mechanics repeat in scripts but the contract is not yet stable enough to freeze as a public host surface.
- Prefer ad hoc scripting for exploratory, investigative, one-off, or still-emerging abstractions.
- Do not add endpoints that merely mirror raw Revit API calls, mostly wrap direct parameter reads/writes, or expose context-specific shapes that are too unstable to trust broadly.
- Prefer a small number of durable document contracts such as `host-status` freshness and document-context targeting over one endpoint per raw document-manager capability.
- Use electrical as the first specialization test: discipline-specific endpoints are justified when the domain object is operationally richer than a generic Revit element and when the host can collapse real API awkwardness behind a small durable contract.

## Electrical Taxonomy

- Organize electrical host surfaces as a hybrid of jobs and entities, not raw Revit classes.
- Keep the surface small. Prefer a few high-value contract families over one endpoint per electrical type or operation.
- Treat scripting as the default escape hatch for electrical exploration and long-tail work. Promote only the repeated, stable, Revit-quirk-hiding shapes.

Initial host inspection families:

- `elementContext.query`
  - general-purpose element inspection surface
  - should expose stable generic element identity first, then attach domain-specific context when applicable
  - should support multiple target modes such as current selection and explicit element references before minting more narrow entity endpoints

Initial specialized electrical contract families:

- `electrical.panels.*`
  - panel-centered inspection surface
  - resolves the panel as a stable business object rather than leaking the family-instance/electrical-equipment split
- `electrical.circuits.*`
  - circuit-centered authored object surface
  - exposes row-like operational data such as circuit number, slotting, load name, load/current, rating, wire data, connected elements, and health
- `electrical.panelSchedules.*`
  - read-only panel schedule instance projection
  - should preserve `Header`, `Body`, `Summary`, and `Footer` as a faithful schedule snapshot rather than flattening the schedule into only circuit rows
- `electrical.loadClassifications.*`
  - load-summary and demand-math support surface
  - should expose classification and demand-definition context cleanly enough for schedule and circuit reasoning

Future candidates once the shape is proven:

- `electrical.panelTemplates.*`

## Non-Goals

- Do not turn the host into a second in-process Revit runtime.
- Do not hide live-document requirements behind misleading offline smartness.
- Do not force the frontend to hand-maintain backend-owned dependency and metadata logic.
- Do not pretend generic JSON field rendering is sufficient for every important Revit-backed workflow.
- Do not treat repeated interest alone as sufficient reason to mint a new endpoint.
- Do not let electrical specialization sprawl into one endpoint per raw API type.
- Do not let narrow target-specific endpoints proliferate by domain when one general element-context surface can carry the same context.
- Do not overload `host-status` with every open-document detail just because it is polled often; keep freshness there and richer document targeting in a sibling surface.
