# Settings Editor SignalR Contract (Frontend)

This is the practical contract a frontend needs to integrate with the Settings Editor backend.

## Transport

- SignalR hub route: `http://localhost:5150/hubs/settings-editor`
- Protocol: SignalR JSON protocol (camelCase payloads)
- Pattern: `connection.invoke("<MethodName>", request)`

## Core Rules

- `moduleKey` is required for almost every request and is the server-side identity for both transport and storage.
- The client does **not** choose settings subdirectories. The server owns that via module registration.
- All method results use an envelope shape:
  - `ok: boolean`
  - `code: "Ok" | "Failed" | "WithErrors" | "NoDocument" | "Exception"`
  - `message: string`
  - `issues: ValidationIssue[]`
  - `data: T | null`
- Serializer behavior: null fields are omitted from payloads (`nullValueHandling=ignore`), so frontend decoding should treat nullable members as optional.

## Hub Methods

- `GetSettingsCatalogEnvelope(SettingsCatalogRequest)`
  - Discover available module targets.
  - Request: `{ moduleKey?: string }`
  - Response data: `SettingsCatalogData`

- `ListSettingsEnvelope(ListSettingsRequest)`
  - List files and directory tree for one module.
  - Request: `{ moduleKey: string, recursive?: boolean, includeFragments?: boolean }`
  - Response data: `SettingsListData`

- `ReadSettingsEnvelope(ReadSettingsRequest)`
  - Read a single settings file.
  - Request: `{ moduleKey: string, relativePath: string, resolveComposition: boolean, requestId?: string }`
  - Response data: `SettingsReadData`
  - `data.json` is raw file content; `data.resolvedJson` is composition-expanded when requested.
  - `data.composition` is optional metadata for future fragment-aware save behavior.

- `WriteSettingsEnvelope(WriteSettingsRequest)`
  - Write a single settings file.
  - Request: `{ moduleKey: string, relativePath: string, json: string, validate: boolean, requestId?: string }`
  - Response data: none (status + issues only)

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

## Minimal Usage Flow

1. Connect to `"/hubs/settings-editor"`.
2. Call `GetSettingsCatalogEnvelope` for module picker/target bootstrap.
3. Call `GetSchemaEnvelope` and `ListSettingsEnvelope` for selected module.
4. Read file via `ReadSettingsEnvelope`.
5. On edits:
   - optional pre-check: `ValidateSettingsEnvelope`
   - persist: `WriteSettingsEnvelope`
6. For provider-backed fields, call `GetExamplesEnvelope` as needed.
7. Subscribe to `DocumentChanged` and invalidate dependent caches.

## Envelope Handling Recommendation

Treat response handling as:

- `ok === true`: success path
- `ok === false && code === "WithErrors"`: partially successful operation with actionable issues
- `ok === false && code === "NoDocument"`: active-Revit-document precondition failed
- `ok === false && (code === "Failed" || code === "Exception")`: failure path

Always render `issues` to users/dev logs when present; they contain field-level context (`instancePath`, `code`, `message`, `suggestion`).
