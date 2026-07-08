# Mastra Upstream Candidates

> Note: `mastra` is cloned locally for **reference only** — not a Pe.Tools-owned repo and not a
> contribution target. These are candidates we'd _want_ upstream; until they land in a published
> `mastracode`, Pe.Tools must use the public-API fallback, never deep-imports or dist scanning.

## Export a small public model resolver surface

Status 2026-06-29: still open, and now **actively load-bearing** for pea. The 0.26 migration moved
pea's model resolution onto `ModelRouterLanguageModel` + `defaultGateways` and deleted
`packages/runtime/src/models/mastracode-model.ts`. That dropped OAuth: `defaultGateways` only read
env vars, so pea can no longer use a developer/operator's stored Codex/Anthropic OAuth (only API
keys). Pea's product direction is now BYO-OAuth for inference, so pea is **reverting to the
`createMastraCode({ disableHooks: true, disableMcp: true }).resolveModel` boot-fallback** — the exact
public path this candidate recommends keeping. A public root `resolveModel` (or
`createMastraCodeModelResolver()`) export would let pea drop the second `createMastraCode` boot
entirely; it boots one trimmed runtime per process purely to reach `resolveModel`.

OAuth-for-OM is the gap that has no working Pe-side fix (tried and removed, 2026-06-30). The mode
agent resolves via an explicit `model` fn, but gateway-resolved roles — Observational Memory,
subagents, catalog — resolve a model-id `string` through registered `gateways`, with no per-model fn
hook. We tried an OAuth-gateway shim (`createMastraCodeOAuthGateway()` delegating to the cached
`resolveModel`, registered on the controller and prefix-routed). It does **not** work on
`@mastra/core@1.48.0-alpha.4`: OM is configured via `memory/profiles.ts` → `observationalMemory.model`
(not the controller's `config.omConfig`), and that string resolves through a gateway set that is not
the controller's `config.gateways` — so the shim never sees the OM request and resolution falls to the
models.dev registry. The OM `model` field is `string`-only, so a pre-resolved (OAuth'd) instance can't
be passed either. Removed the shim; OM uses a plain id via `defaultGateways` and needs a key/token.

What would actually fix it (upstream asks): (a) a public `MastraCodeGateway`/factory **plus** routing
OM through the controller's `config.gateways` (or a way to set the OM model as a resolved instance); or
(b) own OM through the controller's `config.omConfig` (which does use `config.gateways`) instead of via
`@mastra/memory`'s `observationalMemory`. Until then OM is key/token-based, not OAuth.

Status 2026-06-24: still open after checking the synced upstream MastraCode source for the `0.25.0` / `0.25.1-alpha.1` line. `createMastraCode()` still returns `resolveModel`, but `mastracode/src/index.ts` does not show a root named `resolveModel` export. Pe.Tools should keep the public `createMastraCode({ disableHooks: true, disableMcp: true })` fallback until a small resolver export exists.

Pea needs MastraCode-owned model resolution so provider routing, OAuth/API-key behavior, gateway support, model aliases, thinking options, and fast-changing model names stay upstream of Pe.Tools.

Today `mastracode@0.22.3` exposes `resolveModel` in type declarations only through the object returned by `createMastraCode()`. The root runtime module exports `createAuthStorage` and `createMastraCode`, but not `resolveModel` or a lightweight resolver factory. Pea previously worked around this by scanning MastraCode's private `dist/chunk-*.js` files for an exported `resolveModel`, which breaks once Pea is packaged as a Vite+/tsdown SEA executable because there is no real `mastracode` package directory to scan at runtime.

Proposed upstream shape:

```ts
export function resolveModel(
  modelId: string,
  options?: {
    thinkingLevel?: "off" | "low" | "medium" | "high" | "xhigh";
    remapForCodexOAuth?: boolean;
    requestContext?: RequestContext;
  },
): MastraModelConfig;
```

An equivalent `createModelResolver()` or `createMastraCodeModelResolver()` public export would also work. The key request is a small public resolver API that does not require constructing a full MastraCode harness just to resolve a model handle.

## Carry `files` (multimodal attachments) on the send-message HTTP route

Status 2026-06-30: open, **load-bearing for apps/web**. The native `Session.sendMessage` already
supports multimodal input — verified in the installed `@mastra/core@1.47.0`:

```ts
// dist/agent-controller/session.d.ts
sendMessage({ content, files, ... }: {
  content: string;
  files?: Array<{ data: string; mediaType: string; filename?: string }>;
  ...
}): Promise<void>;
```

But the HTTP boundary drops it. The server route body schema is `z.object({ message: z.string() })`
and the handler calls `session.sendMessage({ content: message })` — files are stripped:

- `packages/server/src/server/handlers/agent-controller.ts` — `sendMessageBodySchema = z.object({ message: z.string() })`, handler `void session.sendMessage({ content: message })`.
- `client-sdks/client-js/src/resources/agent-controller.ts` — `sendMessage(message: string)` (string-only wrapper).

So `mastracode`'s TUI reaches multimodal only by calling the in-process `Session` directly
(`readFileSync` → base64 → `session.sendMessage({ content, files })`), bypassing HTTP. A browser
client has no such direct path.

Proposed upstream shape: extend `sendMessageBodySchema` to accept the same `files` array
`Session.sendMessage` already takes, forward it in the handler, and widen the client-js
`sendMessage` to `sendMessage(message: string | { content: string; files?: ... })`.

**Pe.Tools fallback until then:** `apps/web` sends through a thin Pe-owned route
`POST /pe/messages` on `agent-controller-web.ts` that delegates to the in-process
`runtime.session.sendMessage({ content, files })` — same family as `/pe/info` and `/pe/inspect`.
When the native route carries `files`, delete `/pe/messages` and route sends through
`@mastra/client-js`.

## Message-cutoff for clone/fork (`forkThread(messageId)`)

Status 2026-06-30: open, **degraded in apps/web** (acceptable for now per product). Native clone
only forks a whole thread; it cannot cut off at a message:

- `packages/server/src/server/handlers/agent-controller.ts` — clone handler accepts only
  `{ sourceThreadId, title? }`.

Pe's old `/workbench/*` `forkThread(messageId)` truncated the new thread at a chosen message. There
is no native equivalent, and rebuilding it client-side would mean reconstructing server-side fork
logic (the exact custom stack the native migration deleted).

Proposed upstream shape: add an optional `upToMessageId?: string` (or `beforeMessageId`) to the
clone route + handler so the cloned thread stops at that message.

**Pe.Tools fallback until then:** `forkThread(messageId)` degrades to native full-thread clone
(messageId ignored); the per-message fork affordance is hidden in the UI. Restore message-cutoff
fork once the route supports it.

## session.thread.switch() aborts the active run even when switching to the already-active thread (core 1.50.1)

`AgentControllerSession` `thread.switch({ threadId })` unconditionally calls `session.abort()` (→ `suspensions.clear()` + `approval.cancel()`) before rebinding, with no early-out when `threadId` equals the currently-bound thread. Any UI that re-aligns the session thread on hydrate/reload therefore destroys a live HITL suspension and emits `agent_end(aborted)` — in our workbench this cancelled pending approval buttons and (pre-guard) drove a hydrate/abort event flood. Ask: make `switch()` a no-op (or a non-aborting re-bind) when the target thread is already bound, and/or don't drop parked suspensions/approvals for the thread being switched *to*. Our fallback (apps/web provider.tsx hydrate): only call `switchThread` when `session.state().threadId` differs from the target, plus reducer guards so no `agent_end` cancels a live approval.
