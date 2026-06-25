# MastraCode 0.25 Upgrade Deletion Audit

Date: 2026-06-24

## Scope

This note compares Pe.Tools' current Mastra integration against the newest MastraCode and Mastra core shape, with a deletion-first bias. It focuses on ACP, thread/session ownership, Harness API changes, auth/model resolution, permissions, event projection, and anything likely to replace local Pe runtime code.

Pe.Tools versions found before this migration in `source/pe-tools`:

- `mastracode`: `^0.22.3`
- `@mastra/core`: `1.42.0`
- `@agentclientprotocol/sdk`: `^0.25.0`

Current public package tags checked with `npm view`:

- `mastracode`: stable `0.25.0`, alpha `0.25.1-alpha.1`
- `@mastra/core`: stable `1.46.0`, alpha `1.46.1-alpha.1`
- `@agentclientprotocol/sdk`: stable latest `1.0.0`

The upstream source clone used for code inspection is `C:\Users\kaitp\source\repos\mastra`, synced to `main` at `3785a96d69643db7ba24e04e2001c199e082bf72`.

Applied migration state after the first pruning pass:

- `mastracode`: `0.25.1-alpha.1`
- `@mastra/core`: `1.46.1-alpha.1`
- `@mastra/libsql`: `1.14.1`
- `@mastra/memory`: `1.21.2-alpha.0`
- `@agentclientprotocol/sdk`: still `^0.25.0` because MastraCode alpha still uses the `0.21.x` ACP SDK line internally; the `1.0.0` jump needs a separate ACP compatibility pass.

Additional pruning now reflected in the worktree:

- Peco no longer depends on `@pe/runtime`.
- Peco no longer exposes `peco --acp`, `peco web`, `dev:web`, or the local runtime workbench adapter.
- Peco no longer builds a `RuntimeFactory`; it creates the native MastraCode runtime directly and passes the native `session` to the TUI.
- The deleted `@pe/runtime` ACP adapter files are not re-exported. Pea/Peco source checks and tests pass without that custom ACP stack.
- `@pe/runtime` no longer exports or tests the deleted runtime kernel, protocol-session manager, ACP adapter, or workbench HTTP server stack.
- `@pe/runtime` no longer depends on `@agentclientprotocol/sdk`; ACP SDK ownership remains in `@pe/acp-client` and `@pe/agent-contracts`.
- Pea no longer exposes the deleted `pea web` / `dev:web` surface and no longer depends on `@pe/acp-client` or `@pe/workbench-core`.

## Sources

- MastraCode changelog: `C:\Users\kaitp\source\repos\mastra\mastracode\CHANGELOG.md`
- Mastra core changelog: `C:\Users\kaitp\source\repos\mastra\packages\core\CHANGELOG.md`
- Mastra core Harness source: `C:\Users\kaitp\source\repos\mastra\packages\core\src\harness\harness.ts`
- Mastra core Session source: `C:\Users\kaitp\source\repos\mastra\packages\core\src\harness\session.ts`
- MastraCode ACP source: `C:\Users\kaitp\source\repos\mastra\mastracode\src\acp\agent.ts`
- MastraCode runtime source: `C:\Users\kaitp\source\repos\mastra\mastracode\src\index.ts`
- Official docs: https://mastra.ai/docs/harness/overview
- Official docs: https://mastra.ai/reference/harness/harness-class
- Official docs: https://mastra.ai/docs/harness/session
- Official docs: https://mastra.ai/docs/harness/threads-and-state
- Official docs: https://mastra.ai/docs/harness/tool-approvals
- Official docs: https://mastra.ai/docs/agents/acp
- NPM: https://www.npmjs.com/package/mastracode
- NPM: https://www.npmjs.com/package/@mastra/core
- NPM: https://www.npmjs.com/package/@agentclientprotocol/sdk

Note: the current public docs still contain stale `harness.session` and `harness.*` examples on some pages. The synced source and changelogs are more authoritative for the 0.25/1.46 breaking API shape.

## Executive Result

The upgrade is not a simple version bump. It is the moment to delete our generic "Harness as singleton runtime" layer.

Mastra core now owns the seams Pe.Tools had been rebuilding:

- Multi-session ownership: `Harness` is a factory/shared-resource owner; `Session` owns per-conversation state.
- Run control: send, follow-up, steer, abort, tool suspension response, and reminders live on `Session`.
- Event isolation: `session.subscribe()` replaces global harness subscription.
- Thread lifecycle and reads: `session.thread.*` replaces Harness thread lifecycle/read wrappers.
- State/mode/model/permissions/OM: these are session subdomains now.
- Display projection: `session.displayState` owns a UI-ready snapshot.
- Tool permission rules: `session.permissions` owns per-category/per-tool policies.
- ACP: MastraCode has stdio ACP server mode and public `mastracode/acp` export.
- Model retry and transient 400 handling: upstream owns common model-stream retry cases.

The largest deletion candidates are `@pe/runtime`'s kernel/protocol/ACP layers for Peco, plus large parts of the generic protocol/session store once Pea is moved to core `Session`.

## Hard Version Caveat

Stable latest today is `mastracode@0.25.0` with `@mastra/core@1.46.0`. The synced upstream source is already at `0.25.1-alpha.1` / `1.46.1-alpha.1`.

That alpha adds stable session `id` and `ownerId` and makes them required for `harness.createSession()`. The API in the synced source is:

```ts
await harness.createSession({
  id: "my-session-id",
  ownerId: "my-owner-id",
  resourceId: "optional-resource",
});
```

Deletion implication: do not build new local provenance machinery while upgrading to stable `0.25.0`. Either adopt the alpha intentionally, wait for `0.25.1` stable, or structure the Pe adapter so `id`/`ownerId` are a trivial follow-up.

## API Replacement Matrix

| Old local or old Harness surface | New upstream surface | Pe.Tools implication |
| --- | --- | --- |
| `harness.getState()` | `session.state.get()` | Replace in `kernel.ts`, `protocol-sessions.ts`, Pea model resolver access. |
| `harness.setState()` | `session.state.set()` / `session.state.update()` | Delete state proxy assumptions from `RuntimeKernelHarness`. |
| `harness.sendMessage()` | `session.sendMessage()` | Main kernel send path moves to Session. |
| `harness.followUp()` | `session.followUp()` | Delete optional follow-up probing wrapper. |
| `harness.steer()` | `session.steer()` | Use Session run-control directly. |
| `harness.abort()` | `session.abort()` / `session.abortRun()` | Runtime close and prompt cancellation must target a session. |
| `harness.respondToToolSuspension()` | `session.respondToToolSuspension()` | ACP approval/continuation handling should call Session. |
| `harness.saveSystemReminderMessage()` | `session.saveSystemReminderMessage()` | Reminder persistence no longer belongs on the Harness wrapper. |
| `harness.subscribe()` | `session.subscribe()` | Delete global event bus assumptions. |
| `harness.switchModel()` | `session.model.switch()` | Workbench model switching can call Session. |
| `harness.getFullModelId()` | `session.model.get()` | Workbench current-model display should read Session. |
| `harness.getModelName()` | `session.model.displayName()` | Delete local display-name helper if only splitting IDs. |
| `harness.switchMode()` | `session.mode.switch()` | Workbench mode switching can call Session. |
| `harness.createThread()` | `session.thread.create()` | Kernel thread materialization can collapse. |
| `harness.switchThread()` | `session.thread.switch()` | `RuntimeHarness` idempotent switch subclass should die. |
| `harness.listThreads()` | `session.thread.list()` | Prefer upstream thread reads over local memory scans. |
| `harness.memory.deleteThread()` | `session.thread.delete()` | Avoid direct memory access for normal thread deletion. |
| Local thread message queries | `session.thread.listMessages()` / `listActiveMessages()` / `firstUserMessages()` | Delete direct storage reads where not needed for debug. |
| Local permission rules in runtime state | `session.permissions.{getRules,setForCategory,setForTool}` | Map Pe access controls to upstream policy before keeping custom state. |
| Local OM model state helpers | `session.om.observer.*` / `session.om.reflector.*` | Delete OM accessors from generic runtime once UI uses Session. |
| Local subagent model state | `session.subagents.model.*` | Use upstream if Peco exposes subagent model selection. |
| Local event projection from raw events | `session.displayState.get()` plus `display_state_changed` | Keep only Pe-specific contract mapping. |

## ACP Findings

### Shipped Upstream

MastraCode `0.25.0` adds:

- `mastracode --acp`
- public `import { MastraCodeAcpAgent } from "mastracode/acp"`
- fixes for ACP server mode after the Harness session split
- session-scoped events and prompt execution through `session.sendMessage()`
- basic mode and model switching through ACP extension methods

The source implementation is intentionally thin:

- `MastraCodeAcpAgent.newSession()` creates a Mastra thread with `session.thread.create()`.
- ACP `sessionId` is the Mastra thread id.
- prompts serialize through a mutex, switch the single Session to the target thread, then call `session.sendMessage()`.
- cancel calls `session.abort()`.
- modes and models call `session.mode.set()` and `session.model.set()`.

### Delete Candidate

For Peco, upstream ACP can likely replace most of:

- `source/pe-tools/apps/pe-code/src/index.ts` ACP path through `runRuntimeAcpAgent`
- `source/pe-tools/packages/runtime/src/acp/agent.ts`
- `source/pe-tools/packages/runtime/src/acp/adapter.ts`
- `source/pe-tools/packages/runtime/src/acp/acp-session-store.ts`
- `source/pe-tools/packages/runtime/src/acp/events-map-runtime-acp.ts`
- much of `source/pe-tools/packages/runtime/src/session/protocol-sessions.ts`

This is strongest for the "stock MastraCode plus Pe.Tools extra tools" use case. Peco already calls `createMastraCode()`, so preserving a generic Pe kernel around it is now mostly compatibility drag.

### Keep For Now

Pea cannot blindly replace its ACP implementation with `MastraCodeAcpAgent` because Pea's ACP/workbench surface includes local behavior that upstream does not cover yet:

- Pe workbench extension methods
- custom history/thread snapshots
- access-level controls
- Pe auth descriptors
- product metadata, debug metadata, system prompt snapshots
- approval replay/ledger behavior needed by the current web workbench

Deletion shape: keep a thin Pe adapter over core `Session`, not the current generic runtime kernel. If that adapter still feels generic after the migration, upstream the missing ACP extension hooks instead of growing Pe runtime again.

## Harness / Session Findings

### Shipped Upstream

The important upstream design is now explicit:

- Harness owns shared machinery: agent, config, storage, lock gateway, workspace/browser propagation, model catalog.
- Session owns per-conversation machinery: identity, current thread, mode, model, state, run, stream, follow-ups, tool suspensions, permission grants, display state, event bus.
- One Harness can serve many Sessions.
- `harness.getSessionByResource(resourceId)` exists for notification routing to the right Session.
- In alpha, Session identity includes stable `id` and `ownerId`.

### Local Conflict

`source/pe-tools/packages/runtime/src/kernel.ts` is written against the removed singleton-Harness world. Its required interface still includes:

- `abort`
- `createThread`
- `getCurrentThreadId`
- `getResourceId`
- `getState`
- `listThreads`
- `sendMessage`
- `setState`
- `subscribe`
- `switchThread`

Those are the exact methods upstream moved off the Harness. Trying to shim them back onto Harness would preserve the wrong architecture.

### Delete Candidate

Delete or heavily collapse:

- `RuntimeKernelRequiredHarness`
- `MastraRuntimeKernel`'s internal draft/materialized session registry
- `RuntimeHarness` subclass in `harness/runtime-harness.ts`
- `thread-selection.ts`
- direct state/thread wrappers in `runtime.ts`
- fake Harness test scaffolding that exists only to preserve the old interface

Replacement should be a small `RuntimeSessionHandle` or Pe-specific session adapter around a real upstream `Session`.

## Thread Locking Findings

### Shipped Upstream

Core still accepts a `threadLock` provider in `HarnessConfig`, and Session thread transitions call into that provider through the `ThreadDataStore` gateway.

`session.thread` now owns:

- `create`
- `switch`
- `clone`
- `delete`
- `list`
- `getById`
- `listMessages`
- `listActiveMessages`
- `firstUserMessage(s)`
- `getSetting`
- `setSetting`
- `deleteSetting`
- `clearAndReleaseLock`
- `detachFromCurrent`

### Local Implication

`source/pe-tools/packages/runtime/src/harness/thread-lock.ts` may remain only as the Pe filesystem lock provider. It should not be a runtime abstraction boundary.

Delete candidates after Session migration:

- explicit close-time lock release in Peco if `session.thread.clearAndReleaseLock()` is used
- `RuntimeHarness` switch override
- thread selection helpers that pick/create/switch manually
- any direct memory delete/list code for normal thread lifecycle

Keep temporarily:

- lock-file reader surfaced in workbench thread metadata, if the website still needs to show "locked by process X"
- Pe product storage path selection for `.pea` vs `.mastracode`

## Session Provenance / Identity Findings

### Shipped Upstream

In `1.46.1-alpha.1`, `SessionIdentity` exposes:

- `getId()`
- `getOwnerId()`
- `getResourceId()`
- `getDefaultResourceId()`

MastraCode alpha creates a deterministic session id from the project resource ID and owner id from hostname plus project root.

### Local Implication

This directly attacks the local provenance problem in:

- `runtime/context.ts`
- `session/protocol-sessions.ts`
- ACP session/thread mapping
- workbench thread IDs that are sometimes protocol IDs, external IDs, or Mastra thread IDs

Deletion target: stop storing durable protocol session identity in thread metadata unless it is genuinely an external client concern. Use upstream `session.identity.getId()` for "which runtime session is this" and `session.thread.getId()` for "which conversation thread is active."

Caveat: stable `0.25.0` does not yet require/guarantee this identity shape. Avoid a large local refactor until the alpha API is either adopted or released stable.

## Model Resolution / Auth Findings

### Shipped Upstream

MastraCode `0.25.0` adds:

- OpenAI subscription support for Stagehand browser AI ops through `/login`
- Stagehand fix for OpenAI Codex OAuth `Bad Request` failures
- transient OpenAI HTTP 400 retry once
- global ECONNRESET model-stream retry with exponential backoff
- exported `isBadRequestError` from core processors

### Local Implication

Delete or avoid adding local retry code for model streams. I did not find Pe.Tools retry logic in `source/pe-tools/apps` or `source/pe-tools/packages` that should compete with upstream.

Keep:

- `auth/mastracode-auth-storage.ts` while Pea needs MastraCode's stored provider credentials.
- Pea Cloud auth profile, because upstream does not know Pea product auth semantics.

### Resolver Caveat

`source/pe-tools/MASTRA_UPSTREAM_CANDIDATES.md` remains open.

The synced upstream source imports `resolveModel` internally and returns it from `createMastraCode()`, but `mastracode/src/index.ts` does not show a root named export for `resolveModel`. That means our current fallback that constructs a lightweight MastraCode runtime is still the public path. It is better than private chunk scanning, but it does not satisfy the original "small resolver without full harness construction" ask.

Deletion target if upstream adds a root export:

- the `createMastraCode({ disableHooks: true, disableMcp: true })` fallback in `runtime/src/models/mastracode-model.ts`
- resolver task side effects caused by booting a full MastraCode runtime just to get a model handle

## Permissions / Access Levels Findings

### Shipped Upstream

Core now owns:

- category policies: `session.permissions.setForCategory({ category, policy })`
- per-tool policies: `session.permissions.setForTool({ toolName, policy })`
- in-memory grants: `session.grantCategory()`, `session.grantTool()`, `session.getGrants()`
- approval response: `session.respondToToolApproval()`

### Local Implication

Pe.Tools access levels are not exactly the same abstraction:

- `read-only`
- `ask`
- `trusted`

`trusted` maps cleanly to upstream `yolo` or category/tool `allow`. `ask` maps to upstream `ask`. `read-only` is product policy layered over tool metadata, not just approval policy.

Delete target:

- persisted local `accessLevel` as generic runtime state
- parts of `tools/access-policy.ts` once tool kind maps to upstream `ToolCategory`
- custom ACP access-level propagation if workbench can express policies through upstream permissions

Keep until mapped:

- Pe's read-only semantics, because upstream `deny`/`ask` policies do not know our `RuntimeToolKind` taxonomy.
- workbench UI labels if product still wants the three-mode access switch.

## Event Projection / Workbench Findings

### Shipped Upstream

Each Session has its own event bus and a reducer-maintained `displayState` snapshot. This includes:

- running/current message
- active tools
- pending approvals
- pending suspensions
- active subagents
- OM progress
- modified files
- task list state
- token usage
- queued follow-ups

### Local Implication

Pe.Tools should stop rebuilding a full UI projection from raw Mastra events where upstream `displayState` already has it.

Delete candidates:

- generic event ledger/replay where it exists only to rebuild display state
- raw event mappers for ACP/workbench fields covered by `HarnessDisplayState`
- local task-progress reconstruction now restored upstream

Keep:

- `@pe/agent-contracts` as the website contract boundary
- Pe-specific context/debug/auth/system-prompt entries
- durable protocol history only where the client actually needs replay after reconnect

## Peco-Specific Deletion Path

Peco should be the first cut because it already delegates to MastraCode.

Recommended deletion-first migration:

1. Bump `apps/pe-code` to MastraCode/core latest.
2. Use `createMastraCode()` returned `session` directly.
3. Stop constructing `createRuntimeKernel(harness, ...)` for Peco.
4. Change TUI wiring to whatever the new `MastraTUI` expects. Upstream TUI already migrated to `session.thread.*`.
5. For ACP, prefer `mastracode --acp` or `MastraCodeAcpAgent` over `runRuntimeAcpAgent`.
6. Re-add only Pe.Tools extra-tool and metadata affordances that are still observably needed.

Expected deletions:

- Peco runtime close code that calls old Harness methods.
- Peco-specific manual lock release.
- generic kernel construction in `apps/pe-code/src/runtime.ts`.
- ACP adapter surface for Peco.

## Pea-Specific Deletion Path

Pea still needs custom product behavior:

- Revit/host operations
- Pea-specific instructions and tools
- Pea product auth profile
- bundled Pea skills
- workbench metadata
- product storage path
- controlled workspace roots

Recommended shape:

1. Build Pea Harness as today, but call `harness.init()` then `harness.createSession({ id, ownerId, resourceId })`.
2. Return a Pea runtime handle centered on that `Session`, not on a generic Harness kernel.
3. Move send/follow-up/abort/mode/model/state/thread operations to Session.
4. Reimplement only the Pe workbench extension as an adapter over `session.displayState`, `session.thread`, `session.state`, `session.permissions`, and `session.respondToToolSuspension()`.
5. Keep Pe-specific access policy until it maps cleanly to upstream `ToolCategory`/`PermissionPolicy`.

Expected deletions:

- most of `kernel.ts`
- most of `protocol-sessions.ts`
- `RuntimeHarness` subclass
- thread-selection helpers
- fake Harness compatibility tests
- direct Harness state wrappers

## Things Not Replaced Yet

Do not delete these blindly:

- Pea product auth and Pea Cloud gateway semantics.
- Pe workbench contract packages, because the website needs a stable Pe-owned contract even if its data source changes.
- Pe read-only access semantics until mapped onto upstream permissions.
- lock-file inspection UI if the website still displays lock ownership.
- model resolver compatibility fallback, because upstream still lacks a confirmed root-level resolver export.
- custom Pea tools and tool metadata.
- storage profile selection for `.pea` and product-owned state.

## Suggested Upgrade Order

1. Decide stable vs alpha. If alpha is acceptable, use `0.25.1-alpha.1` / `1.46.1-alpha.1` to avoid reworking session identity twice. If stable only, write the adapter so `id`/`ownerId` are a no-drama follow-up.
2. Bump package versions in the TypeScript workspace, including ACP SDK review. Expect compile failures in `@pe/runtime`.
3. Fix Peco by deleting the local runtime kernel path first.
4. Migrate Pea to a real `Session` handle.
5. Rebuild the Pe workbench adapter from `session.displayState` and `session.thread` instead of raw event reconstruction.
6. Map access levels to upstream permissions, keeping only Pe read-only policy if still needed.
7. Keep the model resolver upstream request open.
8. Run source compile lane for `source/pe-tools` and targeted workbench/runtime tests.

## Compile Break Watchlist

Expect failures anywhere these names appear:

- `getState`
- `setState`
- `sendMessage`
- `followUp`
- `abort`
- `subscribe`
- `createThread`
- `switchThread`
- `listThreads`
- `getCurrentThreadId`
- `getResourceId`
- `switchModel`
- `switchMode`

The highest-risk local files are:

- `source/pe-tools/packages/runtime/src/kernel.ts`
- `source/pe-tools/packages/runtime/src/session/protocol-sessions.ts`
- `source/pe-tools/packages/runtime/src/acp/adapter.ts`
- `source/pe-tools/packages/runtime/src/acp/acp-session-store.ts`
- `source/pe-tools/packages/runtime/src/harness/create-runtime-harness.ts`
- `source/pe-tools/packages/runtime/src/harness/runtime-harness.ts`
- `source/pe-tools/apps/pe-code/src/runtime.ts`
- `source/pe-tools/apps/pea/src/runtime.ts`
- `source/pe-tools/packages/runtime/src/models/mastracode-model.ts`

## Bottom Line

Do not shim the old Harness API. The new upstream design is already the architecture Pe.Tools wanted: shared Harness, isolated Sessions, native thread/session provenance, session-owned events, and permission/display state close to the run state.

Use the version bump to delete the generic runtime kernel for Peco, then thin Pea down to a product adapter over upstream `Session`.
