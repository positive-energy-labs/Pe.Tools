# Host runtime ops — target architecture

Status: phases A–D in flight on `sdk-migration`; E needs a Revit restart. No back compat —
the old contract pipeline is deleted, not deprecated.

## The whole contract, stated once

A Revit capability is **one C# static method** with `[BridgeOperation("key")]`. Everything
else — catalog, JSON Schemas, browser types, IDE intellisense, agent capability maps — is
derived at runtime from the connected session, served over plain unauthenticated localhost
HTTP. The running session is the source of truth; there are no compile-time contract
artifacts projected across languages.

## Wire

- `POST /call` — `{ key, request? }` + optional `x-pe-bridge-session-id` header → JSON
  response. Errors are `application/problem+json`-shaped `{ key, kind, message, status }`
  with the HTTP status set. Replaces Effect RPC/NDJSON (`/rpc`) entirely.
- `GET /ops` — runtime op catalog. MultiDocument shape (effect `JsonSchema`): shared
  `definitions` pool + per-op request/response roots, dialect-normalized. Serves typegen,
  agent capability maps, and docs.
- `GET /events` — SSE relay of bridge frames (document-changed, state-sync,
  connect/disconnect). Browser invalidates queries off it; no polling, no refresh buttons.
- `GET /schemas/settings/<moduleKey>/<rootKey>.json` — live settings authoring schema from
  the default (or `?session=`) session. Settings docs carry
  `"$schema": "http://localhost:5180/schemas/settings/<module>/<root>.json"` — absolute,
  machine-portable (each teammate's host resolves it), injected on save.
  **No disk mirror**: schemas are session state (value-domain samples come from the open
  document); persisting them was the old system's bug, not a feature.
- `GET /options/<domainKey>` — context-free value-domain options as `{ "enum": [...] }`
  (short TTL cache). Schemas reference these via remote `$ref`, which VSCode/Zed JSON LS
  resolves → live Revit completions in the editor. Context-dependent domains stay on the
  `settings.field-options` op (web form only).

## Bridge

Single Revit UI thread → single in-flight op per session, but concurrent machine callers
(SSE-invalidated refetch bursts, LSP `$ref` resolution, agents) are normal now: a small
bounded FIFO queue (reject with 423 only when full) replaces the instant-423 mailbox.

## Types

`packages/tools/src/dev/host-typegen.ts` reads `/ops` from a live session and emits
`packages/host-contracts/src/generated/host-ops.generated.ts` — **checked in, committed
like a lockfile**. `useHostOp` / `callHost` type themselves via
`K extends keyof HostOps ? HostOps[K] : unknown`. New op flow: write C# method → hot
reload → run typegen → commit. TS-only ops (settings.*, aps.*, logs, host.status) keep
hand-authored schemas in `operation-types.ts` — they're TS-native, not projections.

## Deleted (no back compat)

- C#: `RevitBridgeOps.cs` static catalog, per-op `HostOperationDefinition` contract
  classes, `HostOperationsCatalog`, `[ExportTsSchema]` usages, `JsonSchemaDocumentService`
  disk schema writes, Pe.Dev.Cli codegen (`HostContractExportModelProvider`,
  `HostContractsProjection`).
- TS: `packages/host-contracts/src/effect/*` (all generated Effect schemas + RPC cases),
  `contracts/host-operations.generated.ts`, `contracts/host-operation-contracts.generated.ts`,
  `rpc.ts`, `rpc-error.ts`, per-op query hooks' bespoke bodies, the host's RpcServer
  switchboard, the settings disk mirror (`.schemas/`).
- `bridge-protocol` + `product` constants stop being codegen outputs and become
  hand-authored contract files (they are wire/product invariants, not projections).

## Kept deliberately

- `IBridgeOperationContext` (Settings/RevitData/Scripting services): DI seam, not ceremony.
- Effect inside the host process: internal implementation, no longer on the boundary.
- Ajv validation of settings docs in the host: settings are TS-owned.
