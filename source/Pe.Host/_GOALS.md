# Pe.Host

## North Star

Make `Pe.Host` the stable external orchestration point for settings authoring, live Revit-backed document insight, and agent visibility into Revit.

Backend-defined metadata should drive a serious schema-based frontend runtime. First-class Revit concepts should be exposed cleanly. Both humans and agents should be able to understand and act on document state through one coherent query-friendly surface.

This should serve both local agents running beside the repo and frontend-exposed agents that use host endpoints as tools, and it should shape which endpoints we create and how we shape them. Longer term, the host should make meaningful agent-driven Revit workflows possible, potentially including carefully controlled code-execution-style capabilities.

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

## Integration Goals

- Keep the host as the single browser-facing request/response surface.
- Keep transport contracts typed, explicit, backend-owned, and friendly to TanStack Query-style caching and invalidation.
- Treat schema payloads as frontend-runtime inputs, not just validation artifacts.
- Allow backend metadata to route frontend rendering toward custom components when generic schema-driven field rendering is not enough.
- Make live Revit data available through host endpoints for frontends, local agents/LLMs, and other tooling that need transparent access to document state.
- Let more document entities become first-class host surfaces over time, especially schedules, parameters, families, categories, and later views.
- Grow toward richer edit flows such as loaded-family parameter edits, document-wide migration/patch flows, family-instance editing, and schedule-oriented custom experiences.

## Non-Goals

- Do not turn the host into a second in-process Revit runtime.
- Do not hide live-document requirements behind misleading offline smartness.
- Do not force the frontend to hand-maintain backend-owned dependency and metadata logic.
- Do not pretend generic JSON field rendering is sufficient for every important Revit-backed workflow.
