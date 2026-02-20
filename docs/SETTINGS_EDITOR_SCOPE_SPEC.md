# SignalR Settings Editor - Scope and Architecture

## Purpose

Capture the architecture decisions and current stack for the SignalR-backed
settings editor so future implementation work stays aligned.

## Core Decisions

- **Settings classes are the contract surface**
  - Settings shape + metadata originate on backend settings types.
- **Schema-driven field generation, not page autogeneration**
  - Schema drives fields/options/constraints; layout/workflow remains
    intentional.
- **Server-authoritative validation**
  - Client feedback is immediate; server remains source of truth.
- **Render-schema delivery for frontend**
  - SignalR schema payloads are render-oriented and pre-resolved for UI
    generation.
  - Authoring schemas remain backend/local-tooling assets for JSON file
    intellisense.
- **Module-first backend registration**
  - Settings/actions are registered by module instead of ad-hoc startup wiring.
  - Module metadata is the source of truth for settings identity and location
    (`ModuleName`, `SettingsTypeName`, `StorageName`, `DefaultSubDirectory`).
- **TanStack Form as frontend runtime foundation**
  - TanStack Form handles field state, submit lifecycle, linked-field behavior,
    and validation orchestration.
  - Schema walking remains custom and explicit.
- **Typed envelope contract for hub responses**
  - Hub responses use a typed envelope (`ok`, typed `code`, `message`, `issues`,
    `data`) so frontend branching is stable and machine-readable.
- **Typed hub clients over raw method-string invocations**
  - Frontend feature code consumes typed hub clients/hooks rather than calling
    SignalR `invoke` with method-name strings directly.

## Current Implemented Architecture

### Backend

- SignalR hubs: `SchemaHub`, `SettingsHub`, `ActionsHub`.
- Module registration: `SettingsModuleRegistry` + `ISettingsModule<TSettings>`.
- Structured validation contract: `ValidationIssue` from
  `SchemaHub.ValidateSettings`.
- Dynamic options via providers: `IOptionsProvider` /
  `IDependentOptionsProvider`.
- Client event contract names are centralized via `HubClientEventNames` (for
  example `DocumentChanged`) to reduce string drift.

### Frontend (Stack)

- Router: TanStack Router.
- Form runtime: TanStack Form.
- Query/cache runtime: TanStack Query.
- UI controls: shadcn components.
- Transport model: shared SignalR runtime, typed hub clients, focused hub hooks.
- Rendering model: custom schema walker + field adapters.

### Cross-layer Contract

- Typed envelope response model:
  - `ok`, typed `code`, `message`, `issues`, `data`.
- Settings catalog response model:
  - `files[]` flat list and `tree` directory projection from the same backend
    discovery pass.
- JSON Schema + targeted metadata:
  - `x-depends-on`
  - `x-provider`
  - optional `x-field` hints (label/order/group/placeholder).
  - render payloads avoid provider-backed `examples` duplication when
    `x-provider` is present.
- Structured validation payload:
  - `path`, `code`, `severity`, `message`, `suggestion`.
- Type generation:
  - Backend message/enums are exported with TypeGen and consumed as frontend
    source-of-truth types.
- Internal schema pipelines:
  - authoring pipeline: rich schema for local files/VS Code intellisense.
  - render pipeline: pre-resolved schema for frontend field rendering.

### Runtime Interaction Model

- Frontend composition layers:
  - SignalR transport/runtime.
  - Typed hub clients (`schema`, `actions`, `settings`).
  - Feature hooks that orchestrate query/cache + UI behavior.
- Hub state tracking:
  - Connection state and error are tracked per hub, not only globally.
- Invalidation:
  - Document-change notifications invalidate schema/options-dependent caches.

### Data Loading Strategy

- Default:
  - Server-filtered options/providers remain the default path for deterministic,
    Revit-authoritative behavior.
- Targeted expansion:
  - Rich catalog endpoints are added for workflows that need full metadata on
    the client (for example mapping UIs), with optional client-side filtering on
    top.
- Constraint:
  - Preserve simple attribute/provider authoring on backend while enabling
    richer frontend UX where justified.

## Key Locations

### Backend (`Pe.Tools`)

- `source/Pe.App/`
- `source/Pe.Global/Services/SignalR/`
- `source/Pe.Global/Services/SignalR/Hubs/`
- `source/Pe.Global/Services/SignalR/Actions/`
- `source/Pe.Global/Services/Storage/Core/Json/`
- `source/Pe.Global/Services/Storage/Core/Json/SchemaProcessors/`
- `source/Pe.Global/Services/Storage/Core/Json/SchemaProviders/`

### Frontend

- `C:/Users/kaitp/source/repos/signalir-clientside-demo/v2/src/routes/settings-editor.tsx`
  - Route-level orchestration for module/file/port search params and page-level
    UX (generated form, save/refresh, payload viewers, communication log).
- `C:/Users/kaitp/source/repos/signalir-clientside-demo/v2/src/lib/use-settings-editor-client.ts`
  - Single SignalR client/runtime for `/hubs/settings-editor`.
  - Handles connection lifecycle and `DocumentChanged` invalidation behavior.
- `C:/Users/kaitp/source/repos/signalir-clientside-demo/v2/src/features/settings-editor/queries.ts`
  - One TanStack Query hook per envelope hub method.
  - Query keys split by domain (`catalog`, `list`, `schema`, `read`, `examples`,
    `parameter-catalog`).
- `C:/Users/kaitp/source/repos/signalir-clientside-demo/v2/src/features/settings-editor/schema-to-field-render.tsx`
  - `SchemaToFieldRender` implementation.
  - Recursive schema walking with `$ref`/`oneOf`/`allOf` resolution and array
    item handling.
  - Provider-aware field rendering and dependent sibling-context wiring.
- `C:/Users/kaitp/source/repos/signalir-clientside-demo/v2/src/features/settings-editor/schema-utils.ts`
  - Render schema parsing/normalization helpers.
  - Default-value hydration and payload-to-default merge behavior.
- `C:/Users/kaitp/source/repos/signalir-clientside-demo/v2/src/components/ui/combobox.tsx`
  - Multi-select combobox primitive used by provider-backed string arrays.
- `C:/Users/kaitp/source/repos/signalir-clientside-demo/v2/src/generated/`
  - TypeGen-exported backend contracts (plus short-term sync patches while
    regenerating types).

## Implementation Principles

- Favor type-safe APIs and compile-time checks.
- Keep execution flow linear and debuggable.
- Keep metadata minimal; avoid early DSL over-abstraction.
- Coordinate backend and frontend design together.
- Aarchitect metadata to integrate easily into TanStack Form and Query
- Preserve clear user feedback (status, progress, field-level errors).
- Maximally reduce the surface area of generated code.
- While still in POC'ing and MVP'ing stage, the biggest risk is backend-frontend
  integration fragility. Stability here should be prioritized over all else,
  even if it means refactoring core logic.

## Success Criteria

- New settings modules onboard via module registration, not startup surgery.
- Field rendering/validation patterns are consistent across modules.
- Validation and options remain responsive and deterministic.
- Schema walking remains explicit while runtime behavior is standardized.

## Target Frontend Use Case Examples

- Get family type name based on a family name.
- Get shared parameters in document, from parameters-service-cache, or from a
  specific list of families' documents.
- Get families in a document filtered by a category
- Get tag families in a document which are bound to a category
- Provide user feedback on parameter mappings based on parameter datatypes. like
  maybe a preview of how it'd be coercion or a message about it.
  (AddAndMapShareParamsSettings.MappingData)
- Specify mandatory uniqueness by key of objects in a list
  (AddAndMapShareParamsSettings.MappingData.NewName)
- Provide validation feedback
- Get all Schedules of a certain category
- Get scheduleable parameters for a certain category
- Display formatting options for a schedule or in project units.
