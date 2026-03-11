# Settings Editor Integration - Scope and Architecture

## Purpose

Capture the architecture decisions and current state for the external
settings-editor integration so future work in this repo stays aligned.

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
  - Settings modules are registered by module instead of ad-hoc startup wiring.
  - Module metadata is the source of truth for schema/validation identity and
    default storage conventions (`ModuleKey`, `SettingsTypeName`,
    `DefaultSubDirectory`).
- **Typed envelope contract for hub responses**
  - Hub responses use a typed envelope (`ok`, typed `code`, `message`, `issues`,
    `data`) so frontend branching is stable and machine-readable.
- **Backend-owned transport constants**
  - Hub routes, hub method names, DTOs, enums, and event names are defined in
    this repo and exported for the external frontend.
- **Filesystem as source of truth for settings files**
  - In this repo, settings listing, reads, writes, and composition are local
    filesystem concerns, not SignalR concerns.

## Current Implemented Architecture

### Backend In This Repo

- External SignalR host: `Pe.Host`.
- Revit-side bridge runtime: `Pe.Global.Services.Host.HostRuntime`.
- Shared transport/contracts project: `Pe.Host.Contracts`.
- Module registration: `SettingsModuleRegistry` + `ISettingsModule<TSettings>`.
- Structured validation contract: `ValidationIssue` from
  `SettingsEditorHub.ValidateSettingsEnvelope`.
- Dynamic options via providers: `IOptionsProvider` /
  `IDependentOptionsProvider`.
- Client event contract names are centralized via `HubClientEventNames` (for
  example `DocumentChanged`) to reduce string drift.
- Local settings discovery uses `SettingsManager.Discover(...)`.
- Local file composition uses `ComposableJson<T>` + `JsonCompositionPipeline`.

### Frontend Paths

The frontend lives in a separate TypeScript repository. This repo should only
document the contract and backend responsibilities it exposes to that frontend,
not frontend implementation details.

### Cross-layer Contract

- Typed envelope response model:
  - `ok`, typed `code`, `message`, `issues`, `data`.
- Settings catalog response model:
  - module target metadata for frontend target selection.
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
- Local storage pipelines:
  - filesystem discovery for settings files/directories.
  - local composition for `$include` and `$preset` expansion.

### Runtime Interaction Model

- Frontend/backend boundary:
  - external frontend connects to the single settings-editor hub hosted outside
    Revit.
  - frontend handles its own file IO strategy outside this repo.
- Host/add-in boundary:
  - Revit connects to the external host over named pipes only when the user
    explicitly enables the bridge.
  - the bridge is expected to be disconnected by default for Revit performance.
- Invalidation:
  - document-change notifications are emitted by the Revit bridge agent and
    forwarded by the external host to browser clients.

### Data Loading Strategy

- Default:
  - filesystem-backed settings discovery/composition remains the default path
    inside this repo.
- SignalR path:
  - server-filtered options/providers, validation, schema generation, and
    document-aware parameter catalogs remain the SignalR use cases.
- Constraint:
  - preserve simple attribute/provider authoring on backend while keeping file
    storage concerns out of the hub surface.

## Key Locations

### Backend Paths

- `source/Pe.App/`
- `source/Pe.Host/`
- `source/Pe.Host.Contracts/`
- `source/Pe.Global/Services/Host/`
- `source/Pe.Global/Services/Storage/Core/Json/`
- `source/Pe.Global/Services/Storage/Core/Json/SchemaProcessors/`
- `source/Pe.Global/Services/Storage/Core/Json/SchemaProviders/`

### External Frontend

- Not in this repository.
- Consume the hub contract documented in `docs/SETTINGS_EDITOR_SIGNALR_CONTRACT.md`.
- Do not assume this repo contains the authoritative frontend runtime or file IO
  behavior.

## Implementation Principles

- Favor type-safe APIs and compile-time checks.
- Keep execution flow linear and debuggable.
- Keep metadata minimal; avoid early DSL over-abstraction.
- Coordinate backend and external frontend design together.
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

## Remaining SignalR Use Case Examples

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
