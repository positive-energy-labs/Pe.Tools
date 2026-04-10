# Settings Editor Host Contract

This document describes the browser-facing contract exposed by this repo for the
external TypeScript settings-editor frontend.

The browser transport is split by responsibility:

- HTTP owns every request/response workflow.
- SSE owns invalidation-only server-to-client events.
- Revit participates through the named-pipe bridge only when the user manually
  connects it from the add-in.
- The host may have multiple connected Revit sessions at once. Request routing is
  deterministic:
  - explicit `sessionId` wins
  - otherwise explicit `revitVersion` wins
  - otherwise the most recently connected session is the default
- The installed host may auto-shutdown after idle time when no Revit sessions
  are connected.

## Transport

- Host base URL: `http://localhost:5180`
- Storage and data API base: `http://localhost:5180/api/settings`
- Event stream: `GET /api/settings/events`
- HTTP payload shape: plain JSON DTOs with camelCase members
- SSE payload shape: `event:` + `data:` frames with JSON payloads

## Runtime Topology

- External host:
  - `source/Pe.Host/`
  - owns Kestrel, CORS, HTTP endpoints, and SSE fan-out
- Shared contract:
  - `source/Pe.Shared.HostContracts/`
  - owns DTOs, HTTP route constants, event names, and protocol constants
- Revit add-in bridge:
  - `source/Pe.Revit.Global/Services/Host/`
  - connects to the host over named pipes only when explicitly enabled

## Scope

- The frontend lives in a separate repository.
- This repo owns the browser transport contract:
  - request DTOs
  - response DTOs
  - enums
  - HTTP route constants
  - SSE event names
- The backend module registry is the source of truth for available settings
  modules.
- HTTP is the source of truth for:
  - host status
  - schema
  - workspace and tree discovery
  - document open/validate/save
  - structural schema payloads
- Bridge-backed HTTP endpoints are the source of truth for:
  - field options
  - parameter catalog queries
  - loaded families filter field options
  - schedule / loaded-families / project-parameter live data
- SSE is used only for:
  - document invalidation events
  - host-status change invalidation

## HTTP Endpoints

- `GET /api/settings/host-status`
  - Returns `HostStatusData`.
  - Includes `defaultSessionId` plus a `sessions` list for connected Revit
    sessions.
- `GET /api/settings/schema?moduleKey=...`
  - Returns `SchemaData`.
  - Structural only. Does not execute live Revit providers locally.
- `GET /api/settings/workspaces`
  - Returns `SettingsWorkspacesData`.
- `GET /api/settings/tree`
  - Query: `moduleKey`, `rootKey`, optional discovery flags.
  - Returns `SettingsDiscoveryResult`.
- `POST /api/settings/field-options`
  - Request: `FieldOptionsRequest`
  - Returns `FieldOptionsData`.
  - Bridge required.
- `POST /api/settings/parameter-catalog`
  - Request: `ParameterCatalogRequest`
  - Returns `ParameterCatalogData`.
  - Bridge required.
- `POST /api/settings/document/open`
  - Request: `OpenSettingsDocumentRequest`
  - Returns `SettingsDocumentSnapshot`.
- `POST /api/settings/document/validate`
  - Request: `ValidateSettingsDocumentRequest`
  - Returns `SettingsValidationResult`.
- `POST /api/settings/document/save`
  - Request: `SaveSettingsDocumentRequest`
  - Returns `SaveSettingsDocumentResult`.
- `POST /api/revit-data/loaded-families/filter/field-options`
  - Request: `LoadedFamiliesFilterFieldOptionsRequest`
  - Returns `FieldOptionsData`.
  - Bridge required.
- `POST /api/revit-data/schedules/catalog`
  - Bridge required.
- `POST /api/revit-data/loaded-families/catalog`
  - Bridge required.
- `POST /api/revit-data/loaded-families/matrix`
  - Bridge required.
- `POST /api/revit-data/project-parameter-bindings`
  - Bridge required.

## SSE Events

- Event name: `document-changed`
  - Payload: `DocumentInvalidationEvent`
  - Includes the originating `sessionId` and `revitVersion` when available.
  - Meaning: invalidate document-sensitive queries and mark the open document
    stale when appropriate.
- Event name: `host-status-changed`
  - Payload: `HostStatusChangedEvent`
  - Includes the affected `sessionId`, `revitVersion`, and current connected
    session count.
  - Meaning: invalidate the host-status query after bridge connect, disconnect,
    or active-document changes.

Recommended frontend behavior:

1. fetch and mutate through HTTP only
2. subscribe to `/api/settings/events`
3. use SSE payloads only to invalidate React Query caches and local stale state

## Backend-Owned Transport Constants

- HTTP route constants: `HttpRoutes.*`
- operation definitions and keys: `*OperationContract.Definition`
- SSE event names: `SettingsHostEventNames.*`
- protocol metadata: `HostProtocol.*`

## Minimal Usage Flow

1. Call `GET /api/settings/host-status` during startup.
2. Call `GET /api/settings/workspaces` and `GET /api/settings/tree` to discover
   editable documents.
3. Call `GET /api/settings/schema` to render a module editor.
4. Call `POST /api/settings/document/open` to load the active authoring file.
5. Call `POST /api/settings/document/validate` and
   `POST /api/settings/document/save` during authoring.
6. Call `POST /api/settings/field-options` and
   `POST /api/settings/parameter-catalog` only when the bridge is connected and
   the rendered form needs live Revit data.
   - Bridge-backed requests may include an optional target selector with
     `sessionId` or `revitVersion`.
7. Subscribe to `/api/settings/events` and invalidate dependent queries when
   events arrive.

## Manual Bridge Workflow

1. Start `Pe.Host`.
2. In Revit, run the `Settings Editor` command and choose `Connect Bridge`.
3. Open the external frontend.
4. When bridge activity is no longer wanted, disconnect from the same command.
