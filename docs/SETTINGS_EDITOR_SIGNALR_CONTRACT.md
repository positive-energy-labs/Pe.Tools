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
- SignalR is currently used for:
  - schema generation
  - server-authoritative validation
  - provider-backed examples/options
  - Revit-derived parameter catalog queries
  - generic `DocumentChanged` invalidation events
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
- Concrete envelope DTOs are backend-defined and exported for TypeScript
  consumption. Frontend code should not hand-maintain duplicate envelope
  response types for hub methods.
- Serializer behavior: null fields are omitted from payloads (`nullValueHandling=ignore`), so frontend decoding should treat nullable members as optional.

## Hub Methods

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

- `GetExamplesEnvelope(ExamplesRequest)`
  - Get options/examples for a specific property path.
  - Request: `{ moduleKey: string, propertyPath: string, siblingValues?: Record<string,string> }`
  - Response data: `ExamplesData`
  - Endpoint-level throttling is applied server-side.

- `GetParameterCatalogEnvelope(ParameterCatalogRequest)`
  - Get richer parameter entries for mapping UI scenarios.
  - Request: `{ moduleKey: string, siblingValues?: Record<string,string> }`
  - Response data: `ParameterCatalogData`
  - Endpoint-level throttling is applied server-side.

## Client Event Subscription

- Event name: `DocumentChanged`
- Meaning: generic "something in document state changed"
- Recommended behavior: invalidate schema/options/catalog queries that depend on active document state.

```ts
connection.on("DocumentChanged", () => {
  queryClient.invalidateQueries({ queryKey: ["settings-editor"] });
});
```

## Backend-Owned Transport Constants

- Hub route constant: `HubRoutes.SettingsEditor`
- Hub method names: `HubMethodNames.*`
- Client event names: `HubClientEventNames.*`

## Minimal Usage Flow

1. Connect to `"/hubs/settings-editor"`.
2. Call `GetSettingsCatalogEnvelope` for module picker/target bootstrap.
3. Use the selected module metadata to align the external frontend with local
   filesystem-backed settings conventions.
4. Call `GetSchemaEnvelope` for render schema generation.
5. Call `ValidateSettingsEnvelope` before save when server-authoritative
   validation is needed.
6. For provider-backed fields, call `GetExamplesEnvelope` as needed.
7. For mapping or document-aware UIs, call `GetParameterCatalogEnvelope` as
   needed.
8. Subscribe to `DocumentChanged` and invalidate dependent caches.

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
