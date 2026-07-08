# Phase 4 squash design — mastra-behind-Effect

Grounding for implementation agents. Every API below was verified against source
(`effect@4.0.0-beta.92` installed tree AND effect-smol HEAD `4.0.0-beta.94`) by dedicated
index passes on 2026-07-08. **beta.92 → beta.94 is signature-identical for everything we
touch** (http, rpc, httpapi) — the bump is safe and boring. Do NOT write v3 Effect from
memory; when unsure, grep `node_modules/.pnpm/effect@4.0.0-beta.92/node_modules/effect/src/`
or `C:\Users\kaitp\source\.explore\effect-smol\`. See also EFFECT-V4-PATTERNS.md.

## Shape (one paragraph)

The host's existing Effect root stays the root. Mastra becomes a **tenant**: its runtime
(AgentController + session) is one scoped Layer whose release is the existing
`closeRuntimeController` ordering; its HTTP surface (a Hono app: native
`/api/agent-controller/*` + our `/pe/*` extras) mounts into the host's `HttpRouter` via
`HttpEffect.fromWebHandler` at its **existing absolute paths** (no prefix strip → zero
browser changes). The SPA is served by `HttpStaticServer.layer({ spa: true })` as the last
route. Static Pe surfaces get typed `HttpApi` contracts with a derived browser client;
`POST /call` stays a generic typed envelope (the dynamic op catalog is runtime-known and
cannot be a static contract). Lifecycle root becomes a `Deferred` latch raced against
`Layer.launch`, replacing `process.exit(0)`, so scope teardown runs: graceful
`server.close()` → Mastra release (abort → releaseLock → destroy) → service-file delete →
ownership-identity delete. On bind, a layer reads `HttpServer.address` and writes
`state/service/host.json` per the A10 convention (SDK `clients/ts/pe-service.ts`).

## Pillar 1 — Mastra runtime as a scoped Layer

```ts
class MastraRuntime extends Context.Service<MastraRuntime, {
  readonly runtime: RuntimeHandle            // from createRuntimeController
  readonly fetch: (req: Request) => Promise<Response>  // hono app.fetch
}>()("pe/MastraRuntime") {}

const MastraRuntimeLive = Layer.effect(MastraRuntime)(
  Effect.acquireRelease(
    Effect.promise(async () => {
      const runtime = await createPeaRuntime({ /* lane, workspace, hostBaseUrl: self */ })
      const app = new Hono()
      app.use("*", cors())
      mountPeExtras(app, runtime)                     // /pe/info /pe/inspect /pe/messages (image hack stays)
      await new MastraServer({ app, mastra: runtime.mastra }).init()  // /api/agent-controller/*
      return { runtime, fetch: (req) => app.fetch(req) }
    }),
    ({ runtime }) => Effect.promise(() => runtime.close())
    // close = session.abort() → thread.clearAndReleaseLock() → controller.destroy()
    //         (packages/runtime/src/controller/create-runtime-controller.ts:159-177)
  )
)
```

- `createPeaRuntime` moves from `apps/pea/src/runtime.ts:72-188` into the host (or a shared
  package); its `hostBaseUrl` for pea tools now points at **our own** bound address (see
  Pillar 4) — no cross-process hop.
- v4 note: `Layer.effect` accepts scoped effects (v3 `Layer.scoped` is gone).
- Alternative rejected: build Mastra outside Effect and pass it in (today's shape). Loses
  release ordering tied to server shutdown — the exact cause of stale thread locks.

## Pillar 2 — mounting Hono under the Effect router

`HttpEffect.fromWebHandler` (`effect/unstable/http/HttpEffect.ts:396`) is first-class:
converts the current `HttpServerRequest` → web `Request` (body streams in,
`duplex:"half"`), awaits the handler, converts back via `HttpServerResponse.fromWeb`.
**SSE is safe**: `fromWeb` wraps `Response.body` with `Stream.fromReadableStream` —
lazy/chunked, never buffered (verified in source, HttpServerResponse.ts:1631).

```ts
const MastraMountLive = HttpRouter.use((router) => Effect.gen(function* () {
  const { fetch } = yield* MastraRuntime
  const h = HttpEffect.fromWebHandler((req) => fetch(req))
  yield* router.add("*", "/api/agent-controller/*", h)
  yield* router.add("*", "/pe/*", h)
}))
```

- Mount at the **absolute existing paths, no strip** — the Hono app's routes are already
  absolute, so the browser contract (`MastraClient` apiPrefix `/api`, `/pe/info` handshake)
  is untouched; the vite proxies just die.
- If we ever want a stripped prefix mount: `router.prefixed("/agent").add("*", "/*", h)` —
  `prefixed` slices the URL before the child sees it (semantics proven by
  `NodeHttpServer.test.ts:169`). Not needed now.
- Escape hatch if Mastra ever needs raw Node req/res:
  `NodeHttpServerRequest.toIncomingMessage/toServerResponse`.
- Alternative rejected: invert (Hono root, Effect mounted via `HttpRouter.toWebHandler`).
  Loses `request.upgrade` (the Revit WS bridge rides Effect's Node server), the scoped
  lifecycle root, and would rewrite the working half instead of the dying half.

## Pillar 3 — lifecycle root: latch + launch race, service file on bind

```ts
NodeRuntime.runMain(Effect.scoped(Effect.gen(function* () {
  yield* prepareHostOwnership()                       // existing acquireRelease
  const latch = yield* Deferred.make<void>()

  const AdminShutdown = HttpRouter.add("POST", "/admin/shutdown", (req) =>
    isValidToken(req) // X-Pe-Service-Token / takeover token
      ? Effect.as(Effect.forkDaemon(Deferred.succeed(latch, void 0)),  // 200 flushes first
                  HttpServerResponse.jsonUnsafe({ shuttingDown: true }))
      : HttpServerResponse.json({ error: "forbidden" }, { status: 403 }))

  const HttpLive = HttpRouter.serve(AppLive).pipe(
    Layer.provideMerge(ServiceFileLive),              // needs HttpServer (bound address)
    Layer.provide(NodeHttpServer.layer(createServer, { port: PREFERRED_PORT })),
    Layer.provide(MastraRuntimeLive),
    Layer.provide(RevitBridgeLive),
    Layer.provide(NodeHttpClient.layerUndici),
    Layer.provide(NodeServices.layer),
  )
  yield* Effect.raceFirst(Layer.launch(HttpLive), Deferred.await(latch))
  // hard-exit fallback timer is acceptable insurance after the latch fires
})))

const ServiceFileLive = Layer.effectDiscard(Effect.gen(function* () {
  const server = yield* HttpServer.HttpServer
  const addr = server.address                          // ACTUAL bound TcpAddress
  yield* Effect.acquireRelease(
    writeServiceFile("host", { pid: process.pid, port: addr.port, version, lane, token }),
    () => deleteServiceFile("host"))                   // SDK clients/ts/pe-service.ts — copy verbatim, do not fork
}))
```

- `NodeHttpServer.layer` registers a graceful-close finalizer (default
  `gracefulShutdownTimeout` 20s) — closing the launch scope IS the graceful path.
- Port: try preferred 5180; A10 says actual-wins via the service file, so a fallback to
  `{ port: 0 }` on EADDRINUSE is legal (`Layer.orElse`) — discovery never hardcodes.
- `/host/update` keeps its shape but its "self-shutdown after staging" now completes the
  latch instead of `process.exit`.
- Alternative rejected: keep `process.exit(0)`. Skips `clearAndReleaseLock` + service-file
  delete → stale locks and stale discovery files, the pathology A10 exists to kill.

## Pillar 4 — typed contracts: HttpApi for static surfaces; /call stays generic

Verified verdict: **the dynamic op catalog cannot be a static typed contract** — both
`RpcGroup.make` and `HttpApi.make` are compile-time values; ops self-register from Revit at
runtime. So: typed contracts for the STATIC surfaces, `/call` stays a generic (but now
schema'd) envelope with the existing runtime JSON-schema validation + checked-in typegen.

```ts
// packages/host-contracts (shared, imported by browser AND host)
const PeApi = HttpApi.make("PeHost").add(
  HttpApiGroup.make("host")
    .add(HttpApiEndpoint.get("status", "/host/status", { success: HostStatus }))
    .add(HttpApiEndpoint.get("install", "/host/install", { success: InstallReceipt }))
    .add(HttpApiEndpoint.post("update", "/host/update", { success: UpdateResult }))
    .add(HttpApiEndpoint.post("call", "/call", {
      payload: CallEnvelope,               // { key: string, request?: unknown }
      success: Schema.Unknown,
      error: HostProblem,                  // typed problem+json (400/423/503/500)
    }))
    .add(HttpApiEndpoint.get("events", "/events", {
      success: HttpApiSchema.StreamSse({ data: HostBridgeEvent }),  // typed SSE
    })))

// host: HttpApiBuilder.group(PeApi, "host", handlers) → HttpApiBuilder.layer(PeApi)
// browser: HttpApiClient.make(PeApi, { baseUrl }) + FetchHttpClient.layer
//   → client.host.call(...) is Effect-typed end-to-end; streams surface as Stream
```

- HttpApi over Rpc for these because: plain GET/POST that **curl and the C# addin/CLI hit
  without framing** (Rpc's HTTP transport is POST-only with an envelope), typed SSE via
  `StreamSse`, and free OpenAPI (`HttpApiBuilder.layer(api, { openapiPath })` +
  `HttpApiScalar` docs UI) — nice for the SDK-release story.
- Rpc remains the right tool later if we want per-procedure streaming or WS multiplexing:
  `RpcServer.layerHttp({ protocol: "http" })` (⚠ defaults to websocket) +
  `RpcSerialization.layerNdjson` (⚠ `layerJson` BUFFERS streams — framing required).
- ⚠ `RpcSerialization` top-level-imports `msgpackr`; if Rpc ever enters the browser bundle,
  measure tree-shaking.

## Pillar 5 — static SPA from the host

```ts
HttpStaticServer.layer({ root: webDistDir, spa: true, index: "index.html" })
```

First-class (`effect/unstable/http/HttpStaticServer.ts:199`): SPA fallback, MIME,
etag/304, ranges. Its deps (FileSystem/Path/HttpPlatform/Etag) are all bundled by
`NodeHttpServer.layer` — zero extra wiring. Registered `GET /*`, merged LAST so API routes
win. Dev keeps vite (HMR) with ONE proxy target: the host origin from the service file.

## Pillar 6 — unchanged

Revit WS bridge (`request.upgrade` + `socket.runString` is the canonical v4 pattern —
already textbook), `/ops` typegen source, per-session FIFO queue, `InstallGcLive`,
host-ownership takeover. `HttpRouter.serve` auto-installs a request logger
(`disableLogger` to opt out) — delete any hand-rolled request logging on the way.

## What dies

- `apps/pea` `web` subcommand + `runRuntimeAgentControllerWeb`'s server bootstrap
  (`serve({fetch})` + SIGINT handling), `resolveInstalledStaticDir` hack, port 43112,
  `workbenchToken`/`workbenchPort` args, `resolveServingTarget` compat branch.
- `apps/web/vite.config.ts` proxies `/pe-host`, `/pe`, `/api/agent-controller` → one.
- `apps/web` `?w=`/`?t=` connection plumbing; `HOST_CALL_URL = "/pe-host/call"` → same-origin.
- `apps/host/dist-installed` **stays** (it's the exe payload) but the separate pea
  VersionedApp payload + pea PathShim target die from `product.payloads.json`; pea becomes
  a thin CLI or is deleted outright (TUI deprioritized; ACP entry can move to host later).
- C# `TsHostLauncher` bespoke probing → SDK `InstalledProduct.EnsureRunning("host")`;
  `PeaTerminalLauncher` dies with the TUI ribbon path (one button → open web at
  service-file port).

## Gotcha ledger (for implementers)

1. `RpcServer.layerHttp` defaults `protocol: "websocket"` — pass `"http"`.
2. `RpcSerialization.layerJson` buffers; NDJSON/msgpack frame → stream.
3. `HttpRouter.serve` auto-logger + auto listen-log (`disableLogger`/`disableListenLog`).
4. `serve({ middleware })` wraps response *sending* and can't modify the final response —
   use `HttpRouter.middleware`/`addGlobalMiddleware` for response-modifying middleware.
5. `prefixed()` strips the URL prefix; bare `add("*", "/x/*")` does NOT.
6. `Layer.effect` replaces v3 `Layer.scoped`; `Context.Service` replaces ServiceMap keys.
7. `NodeHttpServer.layer` graceful timeout default 20s; `disablePreemptiveShutdown` exists.
8. Thread-lock module keeps process-global state (`ownedLockPaths`, `process.on("exit")`) —
   fine single-process, but release MUST run via the Layer, not only exit hooks.
9. mastracode 0.30 sandbox-paths fix (session.state.set + thread.setSetting) must survive
   the move — it lives in the runtime construction path.
10. `LocalSandbox({ env: process.env })` captures env at acquire time — construct the
    Mastra layer AFTER any env mutation (lane vars from the C# spawner).
