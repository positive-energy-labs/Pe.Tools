# Settings Editor Integration - Scope and Architecture

## Purpose

Capture the architecture decisions and current state for the external
settings-editor integration so future work in this repo stays aligned.

## Core Decisions

- **Settings classes are the contract surface**
  - Settings shape and metadata originate on backend settings types.
- **Schema-driven field generation, not page autogeneration**
  - Schema drives fields, options, and constraints. Layout and workflow remain
    intentional.
- **Server-authoritative validation**
  - Client feedback is immediate; server remains source of truth.
- **Render-schema delivery for frontend**
  - Host schema payloads are render-oriented and structural-only.
  - Authoring schemas remain backend and local-tooling assets for JSON file
    intellisense.
- **Module-first backend registration**
  - Settings modules are registered by module instead of ad-hoc startup wiring.
  - Module metadata is the source of truth for schema, validation identity, and
    default storage conventions.
- **Backend-owned transport constants**
  - HTTP routes, operation definitions/keys, DTOs, enums, and event names
    are defined in this repo and exported for the external frontend.
- **Filesystem as source of truth for settings files**
  - In this repo, settings listing, reads, writes, composition, and validation
    are host-owned filesystem concerns.

## Current Implemented Architecture

### Backend In This Repo

- External host: `Pe.Host`
- Revit-side bridge runtime: `Pe.Revit.Global.Services.Host.HostRuntime`
- Shared transport and contracts project: `Pe.Shared.HostContracts`
- Module registration: `SettingsModuleRegistry` + `ISettingsModule<TSettings>`
- Dynamic field metadata and runtime options: explicit schema definitions +
  `IFieldOptionsSource`
- Client event names are centralized via `SettingsHostEventNames`
- Local settings discovery uses `SettingsManager.Discover(...)`
- Host-backed storage uses `LocalDiskSettingsStorageBackend`
- Shared file composition uses `JsonCompositionPipeline`

### Frontend Paths

The frontend lives in a separate TypeScript repository. This repo should
document the contract and backend responsibilities it exposes to that frontend,
not frontend implementation details.

### Cross-layer Contract

- JSON schema plus targeted metadata:
  - `x-options`
  - `x-runtime-capabilities`
- Structured validation payloads remain machine-readable.
- Type generation:
  - backend messages and enums are exported with TypeGen and consumed as
    frontend source-of-truth types
- Internal schema pipelines:
  - authoring pipeline for local files and editor tooling
  - render pipeline for frontend field rendering
  - explicit schema-definition augmentation instead of attribute-driven runtime
    provider reflection
- Local storage pipelines:
  - HTTP-backed filesystem discovery for settings files and directories
  - host-backed composition for `$include` and `$preset` expansion
  - host-backed validation on open, save, and explicit validate

### Runtime Interaction Model

- Frontend/backend boundary:
  - external frontend talks to the single settings-editor host hosted outside
    Revit
  - frontend consumes HTTP for all request/response workflows
  - frontend consumes SSE only for invalidation
- Host/add-in boundary:
  - Revit connects to the external host over named pipes only when the user
    explicitly enables the bridge
  - the bridge is expected to be disconnected by default for Revit performance
- Invalidation:
  - document-change notifications are emitted by the Revit bridge agent and
    forwarded by the external host to browser clients over SSE

### Data Loading Strategy

- Default:
  - host HTTP is the public entry point for browser reads and mutations
- Event path:
  - SSE is the public entry point for invalidation-only push events
- Internal bridge path:
  - named-pipe RPC is still used between `Pe.Host` and the Revit add-in for
    all live Revit-backed queries

## Key Locations

### Backend Paths

- `source/Pe.App/`
- `source/Pe.Host/`
- `source/Pe.Shared.HostContracts/`
- `source/Pe.Revit.Global/Services/Host/`
- `source/Pe.Shared.StorageRuntime/`
- `source/Pe.Shared.StorageRuntime/`

### External Frontend

- Not in this repository
- Consume the host contract documented in
  `docs/SETTINGS_EDITOR_HOST_CONTRACT.md`

## Implementation Principles

- Favor type-safe APIs and compile-time checks.
- Keep execution flow linear and debuggable.
- Keep metadata minimal and avoid early DSL over-abstraction.
- Coordinate backend and external frontend design together.
- Architect metadata to integrate easily into TanStack Form and Query.
- Preserve clear user feedback for status, progress, and field-level errors.
- Reduce the surface area of generated code wherever practical.

## Success Criteria

- New settings modules onboard via module registration, not startup surgery.
- Field rendering and validation patterns are consistent across modules.
- Validation and options remain responsive and deterministic.
- Schema walking remains explicit while runtime behavior is standardized.

## Remaining Revit-Aware Use Case Examples

- Get family type name based on a family name.
- Get shared parameters in document, from parameters-service-cache, or from a
  specific list of families' documents.
- Get families in a document filtered by a category.
- Get tag families in a document which are bound to a category.
- Provide user feedback on parameter mappings based on parameter datatypes.
- Specify mandatory uniqueness by key of objects in a list.
- Get all schedules of a certain category.
- Get scheduleable parameters for a certain category.
- Display formatting options for a schedule or in project units.
