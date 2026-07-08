# Mastra Native Purge Audit

Date: 2026-07-08
Repo snapshot: `5a980c3` plus in-flight host/web same-origin migration changes
Scope: Pea workbench, Pea core/runtime, Peco runtime, `@pe/runtime`, `@pe/agent-contracts`, and Mastra/MastraCode glue.

## Executive Read

The 0.25 -> 0.27 migration did the right kind of purge: it deleted the old Pe-owned workbench/protocol stack and moved the browser path onto native Mastra `AgentController` and `@mastra/client-js`. The remaining custom code is mixed: some is still load-bearing Pea product policy, but some is now stale protocol glue that only exists because the old shape has not been fully collapsed.

Current Pe.Tools pins are already latest stable for the relevant packages: `mastracode@0.30.0`, `@mastra/core@1.50.1`, `@mastra/server@1.50.1`, `@mastra/client-js@1.31.1`, `@mastra/libsql@1.15.1`. The local upstream checkout at `C:\Users\kaitp\source\.explore\mastra` is useful for source reading, but it is older (`mastracode 0.27.0-alpha.*` on `58e287b1`), so current delete decisions should prefer the installed 0.30 declarations and the package lock.

The highest-confidence deletion path is:

1. Finish the host squash: move the Pea runtime into the Effect host, mount Mastra as a tenant, and delete the standalone Pea web server path.
2. Collapse `@pe/agent-contracts` from a generic workbench protocol package into only product-owned route-state/family-sheet contracts plus a small app-local web view model.
3. Delete uncalled legacy runtime protocol files (`events`, `interrupts`, `message-parts`, `transport`, `client`) unless an immediate package API consumer is discovered.
4. Keep Pe-owned runtime assembly, product tools, access policy, storage-path policy, prompt/tool transparency, `/pe/messages`, and same-thread switch guards until exact upstream gaps close.

## Evidence Base

- Subagent recent-commit pass:
  - `2b96990` is the main historical purge: 2,546 insertions / 9,195 deletions, deleting the old Pe browser/protocol stack and moving to native Mastra agent-controller.
  - `78e25ca` bumped to Mastra `1.50.1` / MastraCode `0.30.0`.
  - `541dcb6` added Peco sandbox allowed-path persistence matching MastraCode stock `/sandbox add`.
  - `ef03a85` added workbench guards for upstream same-thread switch/approval abort behavior.
  - `e3b0294` shrank model resolution to `createMastraCodeAgentController(...).resolveModel`.
- Subagent upstream-export pass:
  - `mastracode` root exports `createMastraCodeAgentController`, `bootLocalAgentController`, `mountAgentControllerOnMastra`, `prepareAgentControllerMount`, `wireSessionConcerns`, `createAuthStorage`.
  - `mastracode/tui` exports `MastraTUI`; `mastracode/acp` exports `MastraCodeAcpAgent`.
  - `@mastra/core/agent-controller` exports `AgentController`, `Session`, display state, events, messages, modes, model lists, permissions, goals, task state.
  - `@mastra/client-js` exports the agent-controller session client and types, but its `AgentControllerSession.sendMessage` is still `sendMessage(message: string)`.
  - Core `Session.sendMessage` accepts `{ content, files }`, so `/pe/messages` remains justified until the HTTP route/client widens.
  - `@mastra/libsql` owns `LibSQLStore` / `ThreadStateLibSQL`; any custom thread-state store should stay deleted.
- Current dirty-tree migration evidence:
  - `apps/web` is already moving from split `/pe-host`, `/pe`, `/api/agent-controller` origins to same-origin host routes.
  - `docs/rework/SQUASH-DESIGN.md` explicitly says Mastra becomes an Effect-host tenant and the Pea web subcommand/server dies.
  - `packages/runtime/src/pea-runtime.ts` is newly untracked and duplicates most of `apps/pea/src/runtime.ts`, which means the host-squash move has started. Treat it as in-flight migration work, not as stable duplicate to edit here.

## Upstream Surfaces To Use

Use these as the preferred source of truth:

- `mastracode`:
  - `createMastraCodeAgentController`: inert controller/resource build; already used for model resolution.
  - `bootLocalAgentController`: local single-session TUI/headless case.
  - `mountAgentControllerOnMastra`: server-owned Mastra case; best replacement for manual Mastra registration when Pea can accept MastraCode's opinionated setup.
  - `prepareAgentControllerMount`: same server case when construction must happen in caller-owned module shape.
  - `wireSessionConcerns`: session-scoped MastraCode extras when a server mints sessions.
  - `createAuthStorage`: already the right auth storage bridge.
- `mastracode/tui`: `MastraTUI`; do not clone TUI event/render internals.
- `mastracode/acp`: `MastraCodeAcpAgent`; Pe wrapper should stay tiny stdio/console glue only.
- `@mastra/core/agent-controller`: `AgentController`, `Session`, `AgentControllerConfig`, `PermissionRules`, display-state/events/messages/thread/model/mode/goal/task types.
- `@mastra/client-js`: `MastraClient`, `AgentControllerSession`, agent-controller event/message/thread/model/permission/goal types, route-generated client types.
- `@mastra/react`: `useChat` and chat primitives are worth a spike for simple chat rendering, but they are agent-chat oriented and do not replace the Pea workbench state model by themselves.
- `@mastra/libsql`: `LibSQLStore` and `ThreadStateLibSQL`; Pe.Tools should never recreate this.

## Ranked Delete / Replace Matrix

### P0: Delete Standalone Pea Web Server

Files:
- `source/pe-tools/packages/runtime/src/agent-controller-web.ts` (147 lines)
- `source/pe-tools/apps/pea/src/web.ts` (32 lines)
- `source/pe-tools/apps/pe-code/src/web.ts` (35 lines)
- `source/pe-tools/apps/web/src/workbench/config.ts` split-origin/token plumbing, already being deleted
- `source/pe-tools/apps/web/vite.config.ts` split proxies, already being collapsed

Replace with:
- Host-owned Effect HTTP root.
- Mastra Hono app mounted under the host via `HttpEffect.fromWebHandler`.
- Native `@mastra/server` `/api/agent-controller/*` routes plus small Pe extras under `/pe/*`.
- Host SPA static serving.

Delete/reduce estimate: 250-400 lines immediately, more if CLI args and product payload shims are included.

Tradeoff:
- This is the cleanest deletion and aligns with the current migration.
- Keep `/pe/messages`, `/pe/info`, `/pe/inspect` as Pe extras inside the host mount until upstream gaps close.
- Preserve runtime close ordering: `session.abort() -> thread.clearAndReleaseLock() -> controller.destroy()`.

Verdict: Do it as part of the host squash. Do not preserve a compatibility web server.

### P0: Collapse Generic Workbench Contracts

Files:
- `source/pe-tools/packages/agent-contracts/src/contracts.ts` (1,391 lines)
- `source/pe-tools/packages/agent-contracts/src/projection.ts` (1,397 lines)
- `source/pe-tools/packages/agent-contracts/tests/projection.test.ts`
- `source/pe-tools/packages/agent-contracts/tests/index.test.ts`
- Web consumers under `source/pe-tools/apps/web/src/workbench/*`, `components/*`, and `family-sheet/*`.

Replace with:
- Native `@mastra/client-js` agent-controller types for messages/events/thread/model/mode/permission/goal/task state.
- App-local Pea web view model for what Lens actually renders.
- Keep `route-state.ts` or move it closer to family-sheet, because typed route slices are Pe-owned product state over native session state.
- Keep family-sheet contracts that model Pea-specific worksheet state, not generic workbench protocol.
- Keep a product projection contract where Pea UI actually needs one. The deletion target is the generic ACP-era transport/workbench protocol layer, not every Pe-owned UI shape.

Delete/reduce estimate: 1,500-2,500 lines once web imports move off generic `Workbench*` protocol types.

Tradeoff:
- This is high LOC win but touches many UI files.
- It should be done after or alongside the web provider/adapter simplification so the new model is grounded in real Lens needs.
- Do not delete family-sheet route-state/data contracts just because they live in the same package.

Verdict: Highest-value workbench purge after host squash.

### P1: Reduce Web Provider / Adapter To Native Session Projection

Files:
- `source/pe-tools/apps/web/src/workbench/provider.tsx` (618 lines)
- `source/pe-tools/apps/web/src/workbench/adapter.ts` (873 lines)
- `source/pe-tools/apps/web/src/workbench/wire.ts` (208 lines)
- `source/pe-tools/apps/web/src/workbench/aui-adapter.ts` (153 lines)
- `source/pe-tools/apps/web/src/workbench/claims.ts` (107 lines)

Replace with:
- `@mastra/client-js` `AgentControllerSession` as the only transport.
- `@mastra/client-js` exported event/message/thread/model/mode/permission/goal types.
- A smaller app-local reducer that only handles Pea display choices.
- Consider an `@mastra/react useChat` spike for message/send/approve/cancel mechanics, but only if it can run against AgentController requirements without losing thread/model/mode/OM/permission state.

Delete/reduce estimate:
- Immediate: 200-400 lines by deleting duplicated context-breakdown code and relying on client-js types.
- Medium: 500-900 lines if `WorkbenchState` and ACP-era events are removed.
- Full: more only if `@mastra/react` can own the message/approval loop.

Keep for now:
- Same-thread `switchThread` guard. Upstream `session.thread.switch()` still aborts active runs when rebinding to the current thread.
- Pending-approval preservation around `agent_end(aborted|suspended)`.
- `/pe/messages` attachment post path.
- `/pe/inspect` fetch until native display state exposes Pea transparency payloads.
- `wire.ts` raw SSE boundary if current client-js typing remains lossy in practice for OM events.

Verdict: Reduce, do not blind-delete. The custom UI model should be Pea-specific, not a recreated transport stack.

### P1: Shrink `createRuntimeController`

File:
- `source/pe-tools/packages/runtime/src/controller/create-runtime-controller.ts` (222 lines)

Replace with:
- Host Effect Layer owning acquire/release.
- Direct `new AgentController(config)` only for Pea-specific custom agent assembly.
- `mountAgentControllerOnMastra` or equivalent mounting pattern where Pea can use MastraCode's opinionated controller builder.

Delete/reduce estimate: 80-180 lines after host squash.

Tradeoff:
- Pea still needs custom agent instructions, product tools, Revit host URL context, workspace, storage profile, memory profile, and prompt/tool transparency.
- Do not force `createMastraCode` if it makes Pea look like generic MastraCode rather than Pea. Use Mastra primitives, not MastraCode product policy, where Pea's identity differs.

Verdict: Keep a small Pea runtime builder; delete the generic "runtime framework" feel.

### P1: Move / Deduplicate Pea Runtime

Files:
- `source/pe-tools/apps/pea/src/runtime.ts` (285 lines)
- `source/pe-tools/packages/runtime/src/pea-runtime.ts` (new untracked, 265-ish lines)
- `source/pe-tools/apps/pea/src/index.ts`
- `source/pe-tools/apps/pea/src/web.ts`

Replace with:
- One canonical `createPeaRuntime` in the host/shared runtime location.
- `apps/pea` should become only CLI/TUI/ACP entry wiring if those remain.
- Host consumes the shared `createPeaRuntime` directly.

Delete/reduce estimate: 200-300 duplicated lines after import switch.

Tradeoff:
- The new file is in-flight migration work. Do not edit over it casually.
- Preserve Peco sandbox allowed-path persistence separately; it is not part of Pea runtime duplication.

Verdict: Complete the move, then delete the old app-local runtime copy.

### P1: Delete Runtime Legacy Protocol Files

Files:
- `source/pe-tools/packages/runtime/src/events.ts` (197 lines)
- `source/pe-tools/packages/runtime/src/interrupts.ts` (180 lines)
- `source/pe-tools/packages/runtime/src/message-parts.ts` (133 lines)
- `source/pe-tools/packages/runtime/src/transport.ts` (50 lines)
- `source/pe-tools/packages/runtime/src/client.ts` (37 lines)
- Exports in `source/pe-tools/packages/runtime/src/index.ts`

Replace with:
- `@mastra/core/agent-controller` and `@mastra/client-js` event/message/permission types.

Delete/reduce estimate: 450-600 lines.

Evidence:
- Caller scan found no app/package callers outside self-exports/tests for these old protocol helpers.
- `events.ts` is only imported by `runtime.ts` for a `RuntimeProtocol` type.
- `message-parts.ts`, `transport.ts`, and `client.ts` are currently just exported surface area.

Tradeoff:
- Because `@pe/runtime` is a workspace package, confirm there is no external published consumer expectation before deletion. Repo posture is greenfield, so stale public surface should disappear.

Verdict: Safe purge candidate.

### P1: Delete Or Move Runtime Context Breakdown Duplication

Files:
- `source/pe-tools/packages/runtime/src/context-breakdown.ts` (272 lines)
- `source/pe-tools/apps/web/src/workbench/adapter.ts` context-breakdown section
- `source/pe-tools/packages/runtime/tests/context-breakdown.test.ts`

Replace with:
- One app-local helper if only Lens needs it.
- Or one shared UI helper outside `@pe/runtime` if multiple UIs need it.

Delete/reduce estimate: 150-300 lines, depending which copy survives.

Evidence:
- Runtime copy is only used by its own tests.
- Web adapter has a ported copy.

Verdict: Delete runtime copy or make web import one shared helper. Do not keep two implementations.

### P2: Keep `/pe/messages`, But Make It Small

Files:
- `source/pe-tools/packages/runtime/src/agent-controller-web.ts`
- Future host Pe extras mount
- `source/pe-tools/apps/web/src/workbench/provider.tsx`

Replace later with:
- Native `@mastra/server` agent-controller route accepting `files`.
- Native `@mastra/client-js` `sendMessage({ content, files })` or equivalent widened API.

Delete/reduce estimate after upstream: 40-80 lines.

Tradeoff:
- This route is not accidental glue. Core `Session.sendMessage` already supports files; the HTTP/client route is the missing link.
- Browser attachments are product-visible, so do not regress them for purity.

Verdict: Keep until upstream lands files on the native route.

### P2: Keep Model Resolver Hack Until Upstream Adds Resolver Export

File:
- `source/pe-tools/packages/runtime/src/models/resolve.ts` (49 lines)

Replace later with:
- `mastracode` root `resolveModel`, `createMastraCodeModelResolver`, or equivalent no-controller resolver factory.

Delete/reduce estimate: 40-50 lines.

Tradeoff:
- Current 0.30 shape is acceptable: it builds an inert controller via `createMastraCodeAgentController`, no session/thread lock.
- Still heavier than needed and uses temp dir/cache singleton.

Verdict: Keep. Upstream ask is smaller now, but still valid.

### P2: Keep Prompt / Tool Transparency For Now

Files:
- `source/pe-tools/packages/runtime/src/system-prompt-capture.ts` (49 lines)
- `source/pe-tools/packages/runtime/src/tool-list-capture.ts` (98 lines)
- `source/pe-tools/apps/pea/src/runtime.ts`
- `source/pe-tools/packages/runtime/src/pea-runtime.ts`
- `/pe/inspect` in current/future server mount

Replace later with:
- Native AgentController display state or inspector endpoint exposing system prompt, tool list, skills, memory config, and request-window shape.

Delete/reduce estimate after upstream: 100-180 lines plus `/pe/inspect`.

Tradeoff:
- This is AX/observability product value, not generic protocol glue.
- The implementation is a little invasive because it wraps model/tool-list boundary, but it captures the exact prompt/tool slice Pea wants to show.

Verdict: Keep until native display/inspect surface matches Pea's transparency needs.

### P2: Keep Storage / Memory Profiles As Product Policy

Files:
- `source/pe-tools/packages/runtime/src/storage/profiles.ts` (148 lines)
- `source/pe-tools/packages/runtime/src/memory/profiles.ts` (124 lines)
- `source/pe-tools/packages/runtime/src/storage/thread-state.ts` (50 lines)

Replace with:
- Native `LibSQLStore` / `ThreadStateLibSQL` where storage implementation is involved.
- Keep Pe path/profile policy around product home, state db, storage warnings, OM thresholds/instructions.

Delete/reduce estimate:
- `thread-state.ts`: maybe 30-50 lines if raw thread debug/test no longer needs store lookup.
- profiles: little or no deletion; this is product policy.

Verdict: Do not delete profiles just because they wrap Mastra types. They decide Pea's durable storage shape.

### P2: Keep Access Policy, But Rebase On Native Permissions If Possible

File:
- `source/pe-tools/packages/runtime/src/tools/access-policy.ts` (109 lines)

Replace later with:
- Native `PermissionRules` / session permission APIs if they can express Pea's read-only/ask/trusted product semantics over Pe tool metadata.

Delete/reduce estimate: 40-100 lines if native permissions become the only enforcement path.

Tradeoff:
- Today this is a real Pea safety boundary over host/Revit tools.
- Do not remove until there is a product-equivalent permission mapping and regression proof.

Verdict: Keep, but move closer to Pea/tool profile if `@pe/runtime` is being slimmed.

### P2: Peco Runtime Should Stay Mostly MastraCode-Native

File:
- `source/pe-tools/apps/pe-code/src/runtime.ts` (182 lines)

Replace/reduce:
- Keep `createMastraCode`/`bootLocalAgentController` as the base.
- Try deleting `createMastraCodeExtraTools` if MastraCode `extraTools` accepts the Pe tool object shape directly.
- Keep `applySandboxAllowedPaths`: it mirrors stock `/sandbox add` by writing both `session.state` and `thread.setSetting`, and commit `541dcb6` proves it was needed.
- Replace manual close sequence only if MastraCode exposes an official dispose/close handle.

Delete/reduce estimate: 30-80 lines.

Verdict: Already mostly correct. Do not over-purge Peco into Pea abstractions.

### P3: ACP Wrapper Is Fine

File:
- `source/pe-tools/packages/runtime/src/acp-server.ts` (29 lines)

Replace later with:
- A public MastraCode `runAcpAgent` helper if one appears.

Delete/reduce estimate: 10-25 lines.

Tradeoff:
- Current wrapper is only stdio connection + console redirect around native `MastraCodeAcpAgent`.

Verdict: Keep as small integration glue.

## Add / Upgrade List

Adopt now or during host squash:

- Use `@mastra/server` native agent-controller routes mounted inside the host; do not keep a second Pea web process.
- Use MastraCode `mountAgentControllerOnMastra` / `prepareAgentControllerMount` as the reference pattern for server-owned Mastra construction.
- Use `@mastra/client-js` route-generated and agent-controller types directly in web code.
- Use `@mastra/core/agent-controller` types directly in runtime/mcps where server-side request/session state is needed.
- Keep `@mastra/libsql` as the only thread-state storage implementation.
- Keep `mastracode/tui` and `mastracode/acp`; Pea/Peco should not own their protocols/renderers.
- Spike `@mastra/react useChat` only for the chat/approval loop; reject it if it cannot carry Pea's AgentController model/mode/thread/OM/permission/workbench requirements.

No stable package upgrade is currently required:

- `mastracode` latest stable is `0.30.0`, Pe.Tools already pins `0.30.0`.
- `@mastra/core` / `@mastra/server` latest stable is `1.50.1`, Pe.Tools already pins `1.50.1`.
- `@mastra/client-js` latest stable is `1.31.1`, Pe.Tools already pins `1.31.1`.
- `@mastra/libsql` latest stable is `1.15.1`, Pe.Tools already pins `1.15.1`.
- Alpha/beta tags exist, but the local upstream source checked for `0.27 alpha` does not justify jumping off latest stable for this purge.

## Upstream Ask List

These exact upstream additions would delete Pe.Tools code:

1. Widen agent-controller HTTP `sendMessage` to carry files:
   - Server schema: `{ message: string, files?: Array<{ data: string; mediaType: string; filename?: string }> }`
   - Client API: `sendMessage(message: string | { content: string; files?: ... })`
   - Deletes `/pe/messages` and attachment special-case send path.

2. Export a no-controller MastraCode model resolver:
   - `resolveModel(modelId, options)` or `createMastraCodeModelResolver(options)`.
   - Deletes cached inert-controller/temp-dir resolver in `models/resolve.ts`.

3. Make OM/model routing OAuth-aware through public MastraCode surfaces:
   - Public `MastraCodeGateway`, OM routed through controller `config.gateways`, or OM accepting resolved model instances.
   - Deletes Pe-side model/auth routing compromises for Observational Memory and keeps fast-changing model/provider behavior upstream.

4. Make same-thread `SessionThread.switch` a no-op:
   - If the target thread is already bound, do not abort, clear suspensions, or cancel approval.
   - Deletes web hydrate guard/reducer approval preservation special cases.

5. Add message-cutoff clone/fork:
   - `cloneThread({ sourceThreadId, upToMessageId })` or equivalent.
   - Deletes Pea's degraded whole-thread fork behavior and any future custom message slicing.

6. Expose native controller handshake and display/inspect metadata:
   - Controller id, resource id, thread/session identity, plus Pe transparency payload hooks.
   - Deletes more of `/pe/info`, `/pe/inspect`, and dev-web launch/handshake plumbing.

7. Expose native display/inspect state for prompt/tools/skills/memory:
   - System prompt snapshot, tool list, skills payload, OM config/window estimates.
   - Deletes `/pe/inspect`, `system-prompt-capture.ts`, and `tool-list-capture.ts`.

8. Export precise client-js event schemas or raw typed SSE parse helpers:
   - Especially OM event payloads and display-state changes.
   - Deletes or shrinks `apps/web/src/workbench/wire.ts`.

9. Expose official close/dispose for `bootLocalAgentController` / `createMastraCode` result:
   - Should cover abort, thread lock release, controller destroy, MCP disconnect, worker/interval/pubsub shutdown.
   - Deletes Peco manual close boilerplate.

10. Native permission policy hook over AgentController tools:
   - Must support Pea read-only/ask/trusted semantics and Pe tool metadata.
   - Could delete `guardRuntimeToolsForAccessPolicy`.

## Do Not Adopt Yet

- MastraCode internal `shared` web/settings hooks (`createApiClient`, provider/model-pack hooks, OM query hooks). Useful patterns, not public stable API for Pea.
- `@mastra/react` as a wholesale workbench replacement. It is chat oriented; Pea needs thread/model/mode/access/OM/workbench/world/route-state affordances.
- MastraCode product defaults as Pea defaults. Pea is a Revit/operator product with Pe tools, Pe auth story, Revit host context, and Positive Energy AX; use Mastra primitives without inheriting the wrong product identity.
- Deep imports or `dist/chunk-*` scanning. Only public Mastra/MastraCode exports count for deletion work.
- Alpha package tags only to chase exports. The current stable packages already contain the relevant 0.30 surfaces, and the local upstream alpha source is older than Pe.Tools' installed pins.

## File-by-File Notes

`source/pe-tools/packages/runtime/src/agent-controller-web.ts`
: Delete server bootstrap during host squash. Keep its Pe extras as a tiny Hono mount until upstream gaps close.

`source/pe-tools/apps/pea/src/web.ts`, `source/pe-tools/apps/pe-code/src/web.ts`
: Delete or reduce to host-open helpers. They should not own a backend server.

`source/pe-tools/packages/runtime/src/controller/create-runtime-controller.ts`
: Shrink after host owns lifecycle. Keep only Pea custom controller/session construction if needed.

`source/pe-tools/apps/pea/src/runtime.ts`
: Move to shared/host runtime; then delete app-local copy. This is product assembly, not generic Mastra glue.

`source/pe-tools/packages/runtime/src/pea-runtime.ts`
: In-flight copy of Pea runtime. Finish this migration intentionally; do not let both files survive.

`source/pe-tools/packages/runtime/src/models/resolve.ts`
: Keep until MastraCode exports resolver directly.

`source/pe-tools/packages/runtime/src/storage/profiles.ts`
: Keep. Product storage path/profile policy over native LibSQL.

`source/pe-tools/packages/runtime/src/storage/thread-state.ts`
: Keep only if tests/raw debug still need native store lookup. Delete if no production caller remains.

`source/pe-tools/packages/runtime/src/memory/profiles.ts`
: Keep. Pea observational-memory policy.

`source/pe-tools/packages/runtime/src/auth/*`
: Keep. Pea auth-mode UX/profile policy plus MastraCode auth storage bridge.

`source/pe-tools/packages/runtime/src/tools/access-policy.ts`
: Keep as safety policy until native permissions can enforce equivalent behavior.

`source/pe-tools/packages/runtime/src/system-prompt-capture.ts`, `source/pe-tools/packages/runtime/src/tool-list-capture.ts`
: Keep for AX transparency until native display/inspect can replace them.

`source/pe-tools/packages/runtime/src/events.ts`, `interrupts.ts`, `message-parts.ts`, `transport.ts`, `client.ts`
: Delete candidates. They look like leftover generic runtime protocol surface.

`source/pe-tools/packages/runtime/src/context-breakdown.ts`
: Delete or move; current web has its own ported copy.

`source/pe-tools/packages/runtime/src/acp-server.ts`
: Keep as tiny stdio wrapper around native `MastraCodeAcpAgent`.

`source/pe-tools/packages/agent-contracts/src/contracts.ts`, `projection.ts`
: Major collapse target. Remove ACP-era/generic workbench protocol contracts and projection. Preserve only Pe product data shapes.

`source/pe-tools/packages/agent-contracts/src/raw-thread.ts`
: Likely delete or move to a dev-only inspector package. It is not a native runtime requirement.

`source/pe-tools/packages/agent-contracts/src/route-state.ts`
: Keep or move closer to family-sheet. This is product route-state over native session state.

`source/pe-tools/apps/web/src/workbench/provider.tsx`
: Reduce after host same-origin and client-js type cleanup. Keep upstream gap guards.

`source/pe-tools/apps/web/src/workbench/adapter.ts`
: Reduce aggressively after `WorkbenchState` collapse. Delete duplicated context-breakdown logic.

`source/pe-tools/apps/web/src/workbench/wire.ts`
: Keep only as raw-event validation boundary. Delete if client-js exposes precise enough schemas/types.

`source/pe-tools/apps/web/src/workbench/aui-adapter.ts`
: Delete/reduce if web model shifts closer to assistant-ui or Mastra-native messages.

`source/pe-tools/apps/web/src/workbench/route-state.tsx`
: Keep; product collaborative route-state hook. Replace the empty-merge hydration nudge if native state read/subscribe makes it unnecessary.

`source/pe-tools/apps/web/src/workbench/claims.ts`
: Revisit after same-origin host session ownership settles. Delete only if native session/thread ownership makes cross-tab claim unnecessary.

`source/pe-tools/apps/pe-code/src/runtime.ts`
: Mostly correct: native MastraCode runtime with Pe tools added. Only shrink adapter/close/path persistence if upstream supports exact behavior.

## Recommended Order

1. Finish host squash and delete standalone web server path.
2. Switch Pea runtime imports to the new shared `createPeaRuntime`, then delete the old app-local runtime copy.
3. Delete isolated runtime legacy protocol files and remove their barrel exports.
4. Start `agent-contracts` collapse with a compiler-guided migration: keep route-state/family-sheet, move web-only model local, delete ACP projection.
5. Reduce web provider/adapter after the contract collapse, preserving upstream gap guards.
6. Send upstream PR/issues for `sendMessage(files)`, model resolver export, same-thread switch no-op, clone cutoff, display/inspect payload, typed raw events, close/dispose, and permissions hook.

## Final Boundary

Use Mastra for controller/session/thread/model/mode/permission/goal/message/event/storage/TUI/ACP mechanics. Use Pe.Tools for Pea product identity: Revit host context, Pe tools, storage roots, auth posture, safety policy, transparency payloads, and route-state/product UIs. Anything between those two categories should be treated as deletion debt.
