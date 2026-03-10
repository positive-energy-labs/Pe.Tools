# Settings Editor SignalR Contract

This document describes the SignalR contract exposed by this repo for the external
TypeScript settings-editor frontend.

It does not describe general settings file management inside `Pe.Tools`. In this
repo, settings discovery, file reads, and JSON composition are filesystem-first
and handled by the storage/composition services under `source/Pe.Global/Services/Storage/`.

## Transport

- SignalR hub route: `http://localhost:5150/hubs/settings-editor`
- Protocol: SignalR JSON protocol (camelCase payloads)
- Pattern: `connection.invoke("<MethodName>", request)`

## Scope

- The frontend lives in a separate repository.
- This repo exposes one hub at `"/hubs/settings-editor"`.
- This repo owns the SignalR transport contract:
  - request DTOs
  - response/envelope DTOs
  - enums
  - hub event names
  - hub method names
  - hub route constants
- The backend module registry is the source of truth for which settings modules
  are available. Frontends should consume exported module metadata rather than
  maintaining their own module list.
- SignalR is currently used for:
  - server capability and module discovery
  - schema generation
  - server-authoritative validation
  - provider-backed examples/options
  - Revit-derived parameter catalog queries
  - document invalidation events
- SignalR is not the source of truth for listing, reading, composing, or writing
  settings files. Those flows are handled locally against the filesystem in this
  repo.

## Core Rules

- `moduleKey` is required for almost every request and is the server-side identity
  for module metadata and schema/validation routing.
- The client does **not** choose settings subdirectories. Any module metadata the
  hub returns is owned by backend module registration.
- All method results use an envelope shape:
  - `ok: boolean`
  - `code: "Ok" | "Failed" | "WithErrors" | "NoDocument" | "Exception"`
  - `message: string`
  - `issues: ValidationIssue[]`
  - `data: T | null`
- The frontend should call `GetServerCapabilitiesEnvelope` during startup and
  treat `contractVersion` plus `availableModules` as the canonical source of
  transport compatibility.
- Concrete envelope DTOs are backend-defined and exported for TypeScript
  consumption. Frontend code should not hand-maintain duplicate envelope
  response types for hub methods.
- Serializer behavior: null fields are omitted from payloads (`nullValueHandling=ignore`), so frontend decoding should treat nullable members as optional.

## Hub Methods

- `GetServerCapabilitiesEnvelope()`
  - Get transport metadata, exported module descriptors, and supported dataset
    features.
  - Response data: `ServerCapabilitiesData`

- `GetSettingsCatalogEnvelope(SettingsCatalogRequest)`
  - Discover available module targets/metadata.
  - Request: `{ moduleKey?: string }`
  - Response data: `SettingsCatalogData`

- `ValidateSettingsEnvelope(ValidateSettingsRequest)`
  - Server-authoritative validation against module schema.
  - Request: `{ moduleKey: string, settingsJson: string }`
  - Response data: `ValidationData`

- `GetSchemaEnvelope(SchemaRequest)`
  - Get render schema for UI generation.
  - Request: `{ moduleKey: string }`
  - Response data: `SchemaData`
  - `fragmentSchemaJson` may be `null` for modules without fragment schema or when generation fails.

- `GetFieldOptionsEnvelope(FieldOptionsRequest)`
  - Get options/examples for a specific property path.
  - Request: { `moduleKey: string`, `propertyPath: string`, `sourceKey: string`, `contextValues?: Record<string,string>` }
  - Response data: `FieldOptionsData`
  - Endpoint-level throttling is applied server-side.

- `GetParameterCatalogEnvelope(ParameterCatalogRequest)`
  - Get richer parameter entries for mapping UI scenarios.
  - Request: `{ moduleKey: string, contextValues?: Record<string,string> }`
  - Response data: `ParameterCatalogData`
  - Endpoint-level throttling is applied server-side.

## Client Event Subscription

- Event name: `DocumentChanged`
- Payload: `DocumentInvalidationEvent`
- Meaning: machine-readable document-sensitive invalidation signal
- Recommended behavior: invalidate options/catalog queries according to payload flags.

```ts
connection.on("DocumentChanged", (event) => {
  if (event.invalidateFieldOptions || event.invalidateCatalogs) {
    queryClient.invalidateQueries({ queryKey: ["settings-editor"] });
  }
});
```

## Backend-Owned Transport Constants

- Hub route constant: `HubRoutes.SettingsEditor`
- Hub method names: `HubMethodNames.*`
- Client event names: `HubClientEventNames.*`

## Minimal Usage Flow

1. Connect to `"/hubs/settings-editor"`.
2. Call `GetServerCapabilitiesEnvelope` for startup compatibility and module
   registry data.
3. Call `GetSettingsCatalogEnvelope` for module picker/target bootstrap when a
   settings-target-specific list is needed.
4. Use the selected module metadata to align the external frontend with local
   filesystem-backed settings conventions.
5. Call `GetSchemaEnvelope` for render schema generation.
6. Call `ValidateSettingsEnvelope` before save when server-authoritative
   validation is needed.
7. For provider-backed fields, call `GetFieldOptionsEnvelope` as needed.
8. For mapping or document-aware UIs, call `GetParameterCatalogEnvelope` as
   needed.
9. Subscribe to `DocumentChanged` and invalidate dependent caches according to
   the payload flags.

## Non-Goals

The following operations are not currently part of the hub contract in this
repo:

- listing settings files
- reading settings files
- writing settings files
- server-side composition expansion for editor file IO

## Envelope Handling Recommendation

Treat response handling as:

- `ok === true`: success path
- `ok === false && code === "WithErrors"`: partially successful operation with actionable issues
- `ok === false && code === "NoDocument"`: active-Revit-document precondition failed
- `ok === false && (code === "Failed" || code === "Exception")`: failure path

Always render `issues` to users/dev logs when present; they contain field-level context (`instancePath`, `code`, `message`, `suggestion`).
