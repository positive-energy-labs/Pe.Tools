# Effect v4 Patterns — grounding doc for the backend rework

Purpose: **you have Effect v3 internalized from training. Writing v4 by reflex produces wrong code.**
This doc is the antidote. Read it before writing any Effect in this repo.

Sources of truth (verify against these, never from memory):
- **Our condoned style:** `source/pe-tools/apps/host/src/` — `index.ts`, `bridge.ts`, `call-route.ts`,
  `host-ownership.ts`, `local-ops.ts`, `local-error.ts`, `product-paths.ts`, and `@pe/host-contracts`.
  Host runs `effect@4.0.0-beta.92`.
- **The library:** `C:\Users\kaitp\source\.explore\effect-smol` (Effect working repo, currently
  `4.0.0-beta.94`). `git pull` it first. Signatures live in `packages/effect/src/...`. Migration guides
  live in `MIGRATION.md` + `migration/*.md` (they are excellent — read the one for whatever you touch).

## Version discipline (READ FIRST)

Host is on **beta.92**; effect-smol HEAD is **beta.94+**. The beta moves fast and renames APIs between
releases. **Never trust a signature from memory or from this doc alone when it matters.** Two ways to confirm:

1. Installed package (matches what actually compiles here):
   `source/pe-tools/node_modules/.pnpm/effect@4.0.0-beta.92/node_modules/effect/src/<Module>.ts`
   (the published package ships `src/` — grep it directly.)
2. effect-smol at HEAD: `packages/effect/src/<area>/<Module>.ts`. If a signature differs from what the
   installed version exposes, the installed version wins for compiling; note the drift.

When you bump the host's effect version, re-grep both. If a recipe below fails to typecheck, the API moved —
grep, don't guess.

---

## 1. The v3→v4 gotcha table

Everything here is verified against effect-smol source or our host code. If it's not in a table, don't assume it.

### 1a. Module locations moved (the `@effect/platform` / `@effect/rpc` packages are GONE)

Almost everything merged into the single `effect` package under `effect/unstable/*`. All ecosystem packages
share **one version number** now (`effect@4.0.0-beta.N` ⇒ `@effect/platform-node@4.0.0-beta.N`).

| v3 import | v4 import |
| --- | --- |
| `@effect/platform/HttpRouter` | `effect/unstable/http` → `import { HttpRouter } from "effect/unstable/http"` |
| `@effect/platform/HttpServerResponse` | `effect/unstable/http` → `import { HttpServerResponse } from "effect/unstable/http"` |
| `@effect/platform/HttpServerRequest` | `effect/unstable/http` (`HttpServerRequest`) |
| `@effect/platform/HttpApp` | `effect/unstable/http/HttpEffect` |
| `@effect/platform/HttpApi*` | `effect/unstable/httpapi/*` (barrel `effect/unstable/httpapi`) |
| `@effect/platform/Command` | `effect/unstable/process/ChildProcess` |
| `@effect/platform/CommandExecutor` | `effect/unstable/process/ChildProcessSpawner` |
| `@effect/platform/Socket` | `effect/unstable/socket/Socket` |
| `@effect/rpc/Rpc\|RpcGroup\|RpcServer\|RpcClient\|RpcSerialization` | `effect/unstable/rpc/*` (barrel `effect/unstable/rpc`) |
| `@effect/schema/Schema` | **`effect/Schema`** (top-level barrel `effect`) — this is NOT `@effect/schema` anymore |
| `@effect/platform/KeyValueStore` | `effect/unstable/persistence/KeyValueStore` |
| `@effect/experimental/Sse` | `effect/unstable/encoding/Sse` |
| `@effect/ai/*` | `effect/unstable/ai/*` |
| `effect/JSONSchema` | `effect/JsonSchema` (renamed casing) |
| `effect/Either` | **`effect/Result`** — `Either` is gone; it's `Result` now |
| `effect/FiberRef` | `effect/References` (see 1e) |
| `effect/FastCheck`, `effect/TestClock` | `effect/testing/FastCheck`, `effect/testing/TestClock` |

`effect/unstable/*` modules may take breaking changes in **minor** releases (they graduate to top-level as
they stabilize). Import from the direct module path or the area barrel; both work — our host uses the barrel
(`import { HttpRouter, HttpServerResponse } from "effect/unstable/http"`).

Platform-node lives in `@effect/platform-node`: `NodeHttpServer`, `NodeHttpClient`, `NodeRuntime`,
`NodeServices`, `NodeSocket`, `NodeChildProcessSpawner`, etc.

### 1b. Services & layers (the biggest reflex trap)

| v3 habit | v4 reality | correct v4 |
| --- | --- | --- |
| `Context.Tag("X")<X, S>()` | `Context.Service` — **type params first, id via returned ctor** | `class X extends Context.Service<X, S>()("X") {}` |
| `Context.GenericTag<S>("X")` | `Context.Service<S>("X")` (function form) | `const X = Context.Service<S>("X")` |
| `Effect.Tag("X")<X,S>()` + static accessors (`X.method(...)`) | accessors **removed** (generics were lost) | `X.use((s) => s.method(...))`, or prefer `yield* X` then `x.method(...)` |
| `Effect.Service<X>()("X", { effect, dependencies })` + auto `.Default` | `Context.Service<X>()("X", { make })` stores the ctor but **does NOT auto-make a layer**; no `dependencies` | define layer yourself (below) |
| access the service's shape type | `X["Service"]` | `(bridge: RevitBridge["Service"]) => ...` |
| `Context.Reference<X>()("X", opts)` | `Context.Reference<T>("X", opts)` (function form) | `const L = Context.Reference<"info"\|"warn">("L", { defaultValue: () => "info" })` |
| `Layer.scoped(Tag, eff)` | **`Layer.effect`** | `Layer.effect(Tag, Effect.gen(...))` |
| `Layer.scopedDiscard(eff)` | **`Layer.effectDiscard`** | `Layer.effectDiscard(Effect.gen(...))` |
| `Layer.tapErrorCause` | `Layer.tapCause` | — |
| naming: `X.Default` / `X.Live` | convention is now **`X.layer`** (+ `layerTest`, `layerConfig`, …) | `static readonly layer = Layer.effect(this, this.make)` |

`Layer.effect` accepts both `Layer.effect(Tag, effect)` (host style) and curried `Layer.effect(Tag)(effect)`
(test-fixture style). Both are real.

`Effect.Service`-with-`make` no longer wires deps. Do it by hand:
```ts
class Logger extends Context.Service<Logger>()("Logger", {
  make: Effect.gen(function* () { /* ... */ })
}) {
  static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(Config.layer))
}
```

### 1c. Effect combinator renames

| v3 | v4 | note |
| --- | --- | --- |
| `Effect.async` | `Effect.callback` | |
| `Effect.either` | `Effect.result` | returns `Result`; the value has `_tag: "Success"\|"Failure"` with `.success`/`.failure` |
| `Effect.zipRight` | `Effect.andThen` | |
| `Effect.zipLeft` | `Effect.tap` | |
| `Effect.catchAll` | `Effect.catch` | |
| `Effect.catchAllCause` | `Effect.catchCause` | |
| `Effect.catchAllDefect` | `Effect.catchDefect` | |
| `Effect.catchSome` | `Effect.catchFilter` (takes a `Filter`, not `Option`) | |
| `Effect.catchSomeCause` | `Effect.catchCauseIf` / `Effect.catchCauseFilter` | |
| `Effect.tapErrorCause` | `Effect.tapCause` | |
| `Effect.ignoreLogged` | `Effect.ignore` (`Effect.ignore({ log: true })` to log) | host uses this |
| `Effect.fork` | `Effect.forkChild` | |
| `Effect.forkDaemon` | `Effect.forkDetach` | |
| `Effect.forkScoped` / `Effect.forkIn` | **unchanged** | host uses `Effect.forkScoped` |
| `Effect.forkAll`, `Effect.forkWithErrorHandler` | **removed** | fork individually; observe via `Fiber.join`/`Fiber.await` |
| `Effect.makeLatch` / `Effect.makeSemaphore` | `Latch.make` / `Semaphore.make` | |
| `Effect.catchTag`, `Effect.catchTags`, `Effect.catchIf` | **unchanged** | |

`catchTag`/`catchTags` still work — our tagged errors (`class BridgeError { readonly _tag = "BridgeError" }`)
are matched by `_tag`. New: `Effect.catchReason`/`catchReasons` for nested `reason`-tagged errors.

Fork options: `forkChild`/`forkDetach`/`forkScoped`/`forkIn` all take `{ startImmediately?, uninterruptible? }`.

### 1d. Yieldable — `Ref`/`Deferred`/`Fiber` are NOT Effects anymore

v3 let you `yield* ref`, `yield* deferred`, `yield* fiber`. **v4 does not.** They implement `Yieldable`
only if they're `Effect`, `Option`, `Result`, `Config`, or a `Context.Service`. Everything else needs its
module function:

| v3 | v4 |
| --- | --- |
| `yield* ref` | `yield* Ref.get(ref)` |
| `yield* deferred` | `yield* Deferred.await(deferred)` |
| `yield* fiber` | `yield* Fiber.join(fiber)` |
| `Effect.map(Option.some(x), f)` | `Effect.map(Option.some(x).asEffect(), f)` — or just `yield*` it in a gen |

`yield* SomeService` and `yield* Option.some(x)` still work (they're Yieldable). Passing a non-Effect
Yieldable to a combinator like `Effect.map`/`Effect.all` needs `.asEffect()`.

### 1e. FiberRef → `Context.Reference` / `References`

`FiberRef`, `FiberRefs`, `Differ` are removed. Built-ins moved to the `References` module and are read by
`yield*`-ing them; set them with `Effect.provideService`.

| v3 | v4 |
| --- | --- |
| `yield* FiberRef.get(FiberRef.currentLogLevel)` | `yield* References.CurrentLogLevel` |
| `Effect.locally(eff, FiberRef.currentLogLevel, x)` | `Effect.provideService(eff, References.CurrentLogLevel, x)` |
| `FiberRef.currentConcurrency` | `References.CurrentConcurrency` |

### 1f. Cause is flat now

`Cause<E>` is `{ reasons: ReadonlyArray<Fail | Die | Interrupt> }`. `Empty`/`Sequential`/`Parallel` are gone.
Iterate `cause.reasons`; don't recurse a tree.

| v3 | v4 |
| --- | --- |
| `Cause.isFailure` / `isDie` / `isInterrupted` | `Cause.hasFails` / `hasDies` / `hasInterrupts` |
| `Cause.failureOption` | `Cause.findErrorOption` |
| `Cause.failures(cause)` | `cause.reasons.filter(Cause.isFailReason)` |
| `Cause.sequential`/`parallel(l, r)` | `Cause.combine(l, r)` |
| `Cause.NoSuchElementException` (+ all `*Exception`) | `Cause.NoSuchElementError` (all `*Error`) |

### 1g. Stream renames

| v3 | v4 |
| --- | --- |
| `Stream.fromChunk` / `fromChunks` | `Stream.fromArray` / `fromArrays` |
| `Stream.mapChunks` | `Stream.mapArray` |
| `Stream.async` (+ `asyncEffect`/`asyncPush`/`asyncScoped`) | `Stream.callback` |
| `Stream.repeatEffect` | `Stream.fromEffectRepeat` |
| `Stream.either` | `Stream.result` |
| `Stream.catchAll` / `catchAllCause` | `Stream.catch` / `Stream.catchCause` |
| `Stream.Context` | `Stream.Services` |
| `Mailbox` / `Mailbox.make` | `Queue.Queue` / `Queue.make` |

Unchanged and used by our host: `Stream.fromPubSub`, `Stream.map`, `Stream.filter`, `Stream.runForEach`.

### 1h. Schema — this is `effect/Schema`, and it is NOT v3 `@effect/schema`

Import `import { Schema } from "effect"`. Constructors that were variadic are now **array-taking**, and the
decode/encode function family gained explicit `Effect`/`Exit`/`Sync` suffixes. Full guide:
`effect-smol/migration/schema.md`. High-frequency ones:

| v3 | v4 |
| --- | --- |
| `Schema.Union(A, B)` | `Schema.Union([A, B])` |
| `Schema.Tuple(A, B)` | `Schema.Tuple([A, B])` |
| `Schema.Literal("a", "b")` | `Schema.Literals(["a", "b"])` (single: `Schema.Literal("a")` still ok; `Schema.Literal(null)` → `Schema.Null`) |
| `Schema.Record({ key, value })` | `Schema.Record(key, value)` |
| `Schema.decodeUnknown(s)` | `Schema.decodeUnknownEffect(s)` |
| `Schema.decode(s)` | `Schema.decodeEffect(s)` |
| `Schema.decodeUnknownEither(s)` | `Schema.decodeUnknownExit(s)` |
| `Schema.decodeUnknownSync` / `decodeSync` | **unchanged** |
| `Schema.filter(pred)` | `Schema.check(Schema.makeFilter(pred))` |
| `Schema.filter(refinement)` | `Schema.refine(refinement)` |
| `Schema.transform(from, to, {decode,encode})` | `from.pipe(Schema.decodeTo(to, SchemaTransformation.transform({decode,encode})))` |
| `Schema.transformOrFail(...)` | `from.pipe(Schema.decodeTo(to, { decode: SchemaGetter.transformOrFail(...), encode }))` |
| `Schema.optionalWith(s, {exact:true})` | `Schema.optionalKey(s)` |
| `Schema.optionalWith(s, {default})` | `s.pipe(Schema.withDecodingDefaultType(Effect.succeed(x)))` |
| `Schema.pick("a")` / `omit("b")` | `.mapFields(Struct.pick(["a"]))` / `.mapFields(Struct.omit(["b"]))` |
| `Schema.extend(structB)` | `.pipe(Schema.fieldsAssign(fieldsB))` or `.mapFields(Struct.assign(fieldsB))` |
| `s.annotations(a)` | `s.annotate(a)` |
| filters `greaterThan`/`minLength`/`int` | `isGreaterThan`/`isMinLength`/`isInt`, applied via `.check(...)` |
| `Schema.TaggedError` | `Schema.ErrorClass` (see RPC recipe) |
| `ParseResult.ArrayFormatter.formatError` | parse now fails with `Schema.SchemaError` whose `.issue` is a `SchemaIssue`; format via `SchemaIssue.makeFormatterStandardSchemaV1()(err.issue).issues` |

`Schema.String`, `Schema.Number`, `Schema.Boolean`, `Schema.Struct`, `Schema.Array`, `Schema.NullOr`,
`Schema.optional`, `Schema.Option` are unchanged in spelling. Type extraction is `Schema.Schema.Type<typeof s>`;
the runtime codec type is `Schema.Codec<A>`. (Both used throughout `@pe/host-contracts` and `call-route.ts`.)

### 1i. Misc

- `Runtime<R>` **removed**. Use `Context<R>`. Run with deps via `Effect.runForkWith(services)` after
  `yield* Effect.context<R>()`. `Runtime` module now only has `Teardown`/`makeRunMain`.
- `Scope.extend` → `Scope.provide`.
- `Effect.provideService` / `Effect.provideContext` — unchanged names.

---

## 2. Condoned in-house patterns (from `apps/host`)

These excerpts are the house style. Copy their shape.

### Service definition + Layer (`bridge.ts`)
```ts
export class RevitBridge extends Context.Service<
  RevitBridge,
  {
    readonly invoke: (key: string, payload: unknown, sid?: string) =>
      Effect.Effect<unknown, BridgeError | NoRevitSession>
    readonly events: PubSub.PubSub<HostBridgeEvent>
    // ...
  }
>()("RevitBridge") {}

export const RevitBridgeLive = Layer.effect(
  RevitBridge,
  Effect.gen(function* () {
    const sessions = yield* Ref.make(new Map<string, Session>())
    const events = yield* PubSub.unbounded<HostBridgeEvent>()
    // ... build the closure ...
    return { invoke, snapshot, list, handleConnection, events }
  }),
)
```
Consume it as `const bridge = yield* RevitBridge`, then `bridge.invoke(...)`. When you need the shape type in
a signature, use `RevitBridge["Service"]` (see `call-route.ts` `dispatchTsOnlyOperation`).

### Tagged errors — plain classes, not `Data.TaggedError`
```ts
export class BridgeError {
  readonly _tag = "BridgeError"
  constructor(readonly message: string, readonly statusCode: number) {}
}
export class NoRevitSession {
  readonly _tag = "NoRevitSession"
  readonly message = "No Revit session is connected to the bridge."
}
```
`Effect.catch`/`catchTag` discriminate on `_tag`. Map to HTTP via a `toProblem(error)` switch on `_tag`
(see `call-route.ts`) → problem+json with a real status.

### Effectful functions — `Effect.fnUntraced`
The house idiom for a generator-bodied helper (curried-arg friendly, no manual `Effect.gen` wrap):
```ts
const decodeFrame = Effect.fnUntraced(function* (raw: string) {
  const value = yield* Effect.try({ try: () => JSON.parse(raw) as unknown, catch: (e) => e })
  return yield* Schema.decodeUnknownEffect(bridgeFrameSchema)(value)
})
```

### Adding HTTP routes (`index.ts`) — each route is a Layer
```ts
import { HttpRouter, HttpServerResponse as Response } from "effect/unstable/http"

const hostStatusRoute = HttpRouter.add("GET", "/host/status", () =>
  Effect.gen(function* () {
    const bridge = yield* RevitBridge
    const snapshot = yield* bridge.snapshot(undefined)
    return yield* Response.json(yield* getHostStatus(snapshot))
  }),
)
// path params:
const r = HttpRouter.add("GET", "/schemas/:key", Effect.gen(function* () {
  const params = yield* HttpRouter.params   // { key?: string }
  // ...
}))
```
Responses: `Response.json(x)` (effectful), `Response.jsonUnsafe(x, { status })` (sync), `Response.text(...)`,
`Response.empty()`, `Response.stream(byteStream, { contentType, headers })`.

### SSE / streaming from a PubSub (`index.ts`)
```ts
const bridgeEventsRoute = HttpRouter.add("GET", "/events", () =>
  Effect.gen(function* () {
    const bridge = yield* RevitBridge
    const encoder = new TextEncoder()
    const body = Stream.fromPubSub(bridge.events).pipe(
      Stream.map((e) => encoder.encode(`data: ${JSON.stringify(e)}\n\n`)),
    )
    return Response.stream(body, {
      contentType: "text/event-stream",
      headers: { "cache-control": "no-cache", connection: "keep-alive" },
    })
  }),
)
```

### WebSocket upgrade (`bridge.ts`)
```ts
const socket = yield* Effect.orDie(req.upgrade)      // req: HttpServerRequest
const write = yield* socket.writer
yield* socket.runString(onFrame).pipe(               // onFrame: (raw: string) => Effect<void>
  Effect.ensuring(Effect.suspend(() => session ? cleanupSession(session) : Effect.void)),
  Effect.ignore({ log: true }),
)
return Response.empty()
```

### Background work tied to scope (`index.ts`)
```ts
const InstallGcLive = Layer.effectDiscard(
  Effect.gen(function* () {
    yield* Effect.forkScoped(runInstallGc)
    const bridge = yield* RevitBridge
    yield* Effect.forkScoped(
      Stream.fromPubSub(bridge.events).pipe(
        Stream.filter((e) => e.kind === "disconnected"),
        Stream.runForEach(() => runInstallGc),
      ),
    )
  }),
)
```

### Config / env
No `Config` module in the host — env is read directly (`process.env.X`) and validated in plain functions
(`host-ownership.ts`, `product-paths.ts`). Effectful side reads (fetch, fs) go through `Effect.tryPromise`
+ `Effect.catch(() => Effect.succeed(fallback))`. `Effect.acquireRelease(acquire, release)` for lifecycle
(identity file written on start, removed on exit — `prepareHostOwnership`). Keep this style; don't introduce
`Config` unless a task asks.

### Child processes (`index.ts`)
```ts
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
const out = yield* spawner.string(ChildProcess.make("cmd", ["/c", shim, "install", "gc", "--json"]))
```

### App assembly + launch (`index.ts`) — this is our `runMain`
```ts
const AppLive = Layer.mergeAll(bridgeWsRoute, bridgeEventsRoute, hostStatusRoute, callRoute, /* ... */)

const HttpLive = HttpRouter.serve(AppLive).pipe(
  Layer.provide(NodeHttpServer.layer(createServer, { port: HOST_PORT })),
  Layer.provide(NodeHttpClient.layerUndici),
  Layer.provide(RevitBridgeLive),
  Layer.provide(NodeServices.layer),
)

NodeRuntime.runMain(
  Effect.scoped(Effect.gen(function* () {
    yield* prepareHostOwnership()
    yield* Layer.launch(HttpLive)
  })),
)
```
`NodeRuntime.runMain` is the v4 entrypoint (from `@effect/platform-node`). `Layer.launch` runs a
never-ending layer (the server). Routes are Layers merged into `AppLive`; `HttpRouter.serve(AppLive)`
turns the accumulated router into the served app.

### Schema contracts (`@pe/host-contracts`)
Hand-authored, array-form constructors, `Type` aliases beside each schema:
```ts
import { Schema } from "effect"
const nullableString = Schema.optional(Schema.NullOr(Schema.String))
export const bridgeFrameSchema = Schema.Struct({
  kind: Schema.Literals(["Registration", "Response", "Event", /* ... */]),
  event: Schema.optional(Schema.NullOr(bridgeEventSchema)),
  // ...
})
export type BridgeFrame = Schema.Schema.Type<typeof bridgeFrameSchema>
```

---

## 3. RPC recipe (Phase 4: typed Pe surfaces, streaming over HTTP ndjson)

This is what replaces the untyped `POST /call` + `/pe-host` proxy for Pe-owned surfaces. All signatures below
are from effect-smol beta.94 (`packages/effect/src/unstable/rpc/*` and `packages/platform-node/test/`).
`import { Rpc, RpcGroup, RpcServer, RpcClient, RpcSerialization } from "effect/unstable/rpc"`.

### 3a. Define the group (shared package — imported by host AND browser)
```ts
import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/unstable/rpc"

export class RevitDoc extends Schema.Class<RevitDoc>("RevitDoc")({
  id: Schema.String,
  title: Schema.String,
}) {}

// Errors: Schema.ErrorClass (NOT v3 Schema.TaggedError)
export class NoSession extends Schema.ErrorClass<NoSession>("NoSession")({
  _tag: Schema.tag("NoSession"),
  message: Schema.String,
}) {}

export const PeRpcs = RpcGroup.make(
  // unary
  Rpc.make("GetDoc", {
    payload: { id: Schema.String },     // becomes Schema.Struct
    success: RevitDoc,
    error: NoSession,
  }),
  // STREAMING: stream:true wraps success in RpcSchema.Stream; the wire is ndjson chunks
  Rpc.make("WatchDocs", {
    payload: { since: Schema.Number },
    success: RevitDoc,                  // element type of the stream
    stream: true,
  }),
)
```
`Rpc.make(tag, opts)` signature (verified `Rpc.ts:902`):
```ts
Rpc.make<Tag, Payload, Success, Error, Stream extends boolean>(tag, {
  payload?, success?, error?, defect?, stream?, primaryKey?
})
// stream:true  ⇒  success schema becomes RpcSchema.Stream<Success, Error>, error becomes Schema.Never
```

### 3b. Implement handlers — `group.toLayer` (verified `RpcGroup.ts:95`, fixture `rpc-schemas.ts`)
A streaming handler returns a `Stream` **or** a `Queue`/mailbox that the framework drains as the stream.
```ts
import { Effect, Queue, Stream, Layer } from "effect"

export const PeRpcsLive = PeRpcs.toLayer(
  Effect.gen(function* () {
    const bridge = yield* RevitBridge          // depend on our existing services
    return PeRpcs.of({
      GetDoc: (req) =>
        Effect.gen(function* () {
          const doc = yield* bridge.invoke("doc.get", { id: req.id })
          return new RevitDoc(doc as any)
        }),
      // stream handler: return a Stream (or a Queue you fill from a forkScoped fiber)
      WatchDocs: (req) =>
        Effect.succeed(
          Stream.fromPubSub(bridge.events).pipe(
            Stream.map(() => new RevitDoc({ id: "1", title: "x" })),
          ),
        ),
    })
  }),
)
// PeRpcsLive : Layer<Rpc.ToHandler<...>, never, RevitBridge | ...>
```

### 3c. Serve over HTTP ndjson, mounted in our existing host router
`RpcServer.layerHttp` registers a route into the current `HttpRouter` (verified `RpcServer.ts:791`). It
requires `RpcSerialization` + `HttpRouter` + the handler layer:
```ts
import { RpcServer, RpcSerialization } from "effect/unstable/rpc"

const RpcRoute = RpcServer.layerHttp({
  group: PeRpcs,
  path: "/rpc",
  protocol: "http",          // "http" = request/stream over HTTP; default is "websocket"
})

// fold into the host's HttpLive assembly:
const HttpLive = HttpRouter.serve(Layer.mergeAll(AppLive, RpcRoute)).pipe(
  Layer.provide(PeRpcsLive),               // handlers
  Layer.provide(RpcSerialization.layerNdjson),   // ndjson framing
  Layer.provide(NodeHttpServer.layer(createServer, { port: HOST_PORT })),
  Layer.provide(RevitBridgeLive),
  Layer.provide(NodeServices.layer),
)
```
> Verify the exact merge point when you wire it — `layerHttp` needs `HttpRouter.HttpRouter` in context; our
> host builds the router by merging `HttpRouter.add` layers into `AppLive`. If typecheck complains about a
> missing `HttpRouter` service, provide `HttpRouter.layer` alongside (as the effect-smol tests do:
> `RpcServer.layerProtocolHttp({path}).pipe(Layer.provide(HttpRouter.layer))`). Prefer `layerHttp` for the
> all-in-one; drop to `layer` + `layerProtocolHttp` only if you need to split them.

Serialization options (all `RpcSerialization.*`): `layerNdjson` (use this — line-delimited JSON, streaming
friendly), `layerJson`, `layerNdJsonRpc()`, `layerMsgPack`.

### 3d. Derived typed client for the browser (verified `rpc-e2e.ts`, `RpcClient.ts:627/985`)
```ts
import { Context, Layer } from "effect"
import { RpcClient, RpcSerialization } from "effect/unstable/rpc"
import { FetchHttpClient } from "effect/unstable/http"

export class PeClient extends Context.Service<
  PeClient,
  RpcClient.RpcClient<RpcGroup.Rpcs<typeof PeRpcs>, RpcClientError>
>()("PeClient") {
  static readonly layer = Layer.effect(PeClient)(RpcClient.make(PeRpcs)).pipe(
    Layer.provide(RpcClient.layerProtocolHttp({ url: "/rpc" })),
    Layer.provide(RpcSerialization.layerNdjson),
    Layer.provide(FetchHttpClient.layer),   // browser fetch transport — verify export name
  )
}

// usage — fully typed, streaming call returns a Stream:
const program = Effect.gen(function* () {
  const client = yield* PeClient
  const doc = yield* client.GetDoc({ id: "1" })        // Effect<RevitDoc, NoSession>
  yield* client.WatchDocs({ since: 0 }).pipe(          // Stream<RevitDoc>
    Stream.take(5),
    Stream.runForEach((d) => Effect.log(d.title)),
  )
})
```
`RpcClient.make(group)` returns `Effect<RpcClient<...>, never, Protocol | Scope>`; unary rpcs become
`client.Tag(payload): Effect<Success, Error>`, `stream:true` rpcs become `client.Tag(payload): Stream<...>`.
Nested tags like `"nested.test"` are indexed: `client["nested.test"]()`.

---

## 4. HttpApi recipe (simpler request/response Pe surfaces)

For plain typed REST endpoints (no streaming semantics needed), `HttpApi` is lighter than RPC and gives a
derived client the same way. `import { HttpApi, HttpApiGroup, HttpApiEndpoint, HttpApiBuilder, HttpApiClient } from "effect/unstable/httpapi"`.

### Define (verified `HttpApiBuilder.test.ts`, `HttpApiEndpoint.ts:1128`)
```ts
const Api = HttpApi.make("PeApi").add(
  HttpApiGroup.make("host").add(
    HttpApiEndpoint.get("status", "/host/status", {
      success: HostStatus,                 // a Schema
    }),
  ).add(
    HttpApiEndpoint.post("update", "/host/update", {
      payload: UpdateRequest,
      success: UpdateResult,
    }),
  ),
)
```
`HttpApiEndpoint.get/post(name, path, { params?, query?, headers?, payload?, success?, error? })`.

### Implement + serve
```ts
const HostGroupLive = HttpApiBuilder.group(Api, "host", (handlers) =>
  handlers
    .handle("status", () => Effect.succeed(/* HostStatus */))
    .handle("update", (req) => Effect.succeed(/* UpdateResult, req.payload typed */)),
)
// mount via HttpApiBuilder.layer(Api) (registers routes into HttpRouter), provide HostGroupLive.
// Verify exact wiring vs beta.92 — grep packages/effect/src/unstable/httpapi/HttpApiBuilder.ts.
```

### Derived client (browser) — `HttpApiClient.make` (verified `HttpApiClient.ts:459`)
```ts
const client = yield* HttpApiClient.make(Api, { baseUrl: "" })  // needs HttpClient in context
const status = yield* client.host.status()                     // fully typed
```
`HttpApiClient.make(api, { baseUrl?, transformClient?, transformResponse? })` returns
`Effect<Client<Groups>, never, HttpClient>`; provide `FetchHttpClient.layer` in the browser.

**RPC vs HttpApi — settled verdict (Phase 4 index, supersedes earlier leaning):** use **HttpApi** for the
static Pe surfaces (status, install, update, shutdown, `/call` envelope, `/events`). Reasons: consumers
include curl + the C# addin/CLI, and RPC's HTTP transport is POST-only with a framed body envelope plain
HTTP clients can't speak; HttpApi gives ordinary GET/POST + derived typed client + free OpenAPI
(`HttpApiBuilder.layer(api, { openapiPath })`, `HttpApiScalar` docs UI). Typed SSE exists:
`HttpApiSchema.StreamSse({ data: EventSchema })` — handler returns a `Stream`, client receives a decoded
`Stream`; stream failures travel as a reserved `effect/httpapi/stream/failure` event carrying the `Cause`.
HttpApi errors carry status via `{ httpApiStatus: 400 }` on `Schema.ErrorClass` options; built-ins in
`HttpApiError` (BadRequest 400 … InternalServerError 500). Streaming is success-only (stream schema in the
error channel throws at construction).

**The dynamic op catalog cannot be typed contracts** — `RpcGroup.make`/`HttpApi.make` are compile-time
values; ops self-register from Revit at runtime. `POST /call` stays a generic envelope
(`{key, request} → Unknown`) with runtime JSON-schema validation; typegen stays the type source.

Keep RPC in the quiver for per-procedure streaming / WS multiplexing, with two source-verified traps:
`RpcServer.layerHttp` **defaults to `protocol: "websocket"`** (pass `"http"`), and
`RpcSerialization.layerJson` **buffers** stream responses — only framed serializations (`layerNdjson`,
`layerMsgPack`) stream over plain HTTP (`makeProtocolWithHttpEffect` checks `includesFraming`). Also:
`RpcSerialization.ts` top-level-imports `msgpackr` — if RPC enters the browser bundle, measure whether
tree-shaking drops it. Both derive typed clients; don't hand-roll `fetch` wrappers for Pe surfaces.

---

## 4b. HTTP serving primitives (verified in the Phase-4 index, beta.92 ≡ beta.94)

All byte-identical between installed beta.92 and effect-smol HEAD beta.94 — the bump needs no HTTP changes.

### Mount a foreign fetch handler (Hono/Mastra) — `HttpEffect.fromWebHandler`
`effect/unstable/http/HttpEffect` has a first-class bridge — do NOT hand-roll conversions:
```ts
import { fromWebHandler } from "effect/unstable/http/HttpEffect"
const h = fromWebHandler((req: Request) => honoApp.fetch(req))
// register: HttpRouter.add("*", "/api/agent-controller/*", h)
```
Streaming survives both directions: request bodies go in as `Stream.toReadableStreamWith` +
`duplex:"half"`; `HttpServerResponse.fromWeb` wraps `Response.body` with `Stream.fromReadableStream`
(lazy/chunked — SSE passes through unbuffered; verified in source, not assumed).
Prefix semantics: `router.prefixed("/x").add("*", "/*", h)` **strips** `/x` from the URL the child sees;
a bare `add("*", "/x/*", h)` does NOT strip. Raw Node escape hatch:
`NodeHttpServerRequest.toIncomingMessage/toServerResponse` (`HttpServerRequest.source` is the raw req).

### Static SPA — `HttpStaticServer.layer`
```ts
HttpStaticServer.layer({ root: dir, spa: true, index: "index.html" })  // merge LAST; API routes win
```
SPA fallback, MIME, etag/304, byte ranges built in. Its deps (FileSystem/Path/HttpPlatform/Etag) are
**already bundled by `NodeHttpServer.layer`** — zero extra wiring. Single files:
`HttpServerResponse.file(path)` (needs `HttpPlatform`, same story).

### Actual bound address — the `HttpServer` service
```ts
const { address } = yield* HttpServer.HttpServer   // { _tag: "TcpAddress", hostname, port } after listen
```
Filled from Node `server.address()` post-listen, so `{ port: 0 }` fallback works. Helpers:
`HttpServer.formatAddress`, `addressFormattedWith`, `withLogAddress`.

### Graceful self-shutdown — latch raced against `Layer.launch`
`process.exit(0)` skips every finalizer (stale locks/service files). The native pattern:
```ts
const latch = yield* Deferred.make<void>()
// handler: respond first, then trip the latch
Effect.as(Effect.forkDetach(Deferred.succeed(latch, void 0)), Response.jsonUnsafe({ shuttingDown: true }))
yield* Effect.raceFirst(Layer.launch(HttpLive), Deferred.await(latch))
```
Closing the launch scope runs `NodeHttpServer`'s graceful `server.close()` finalizer
(`gracefulShutdownTimeout` default 20s; `disablePreemptiveShutdown` exists), then remaining releases in
reverse acquisition order. A hard `process.exit` fallback timer after the latch is acceptable insurance.

### Middleware notes
`HttpRouter.serve` **auto-installs `HttpMiddleware.logger`** (`disableLogger: true`) and auto-logs the
bound address (`disableListenLog: true`). `HttpMiddleware.cors({...})` exists (also `HttpRouter.cors`).
`serve({ middleware })` wraps response *sending* and cannot modify the final response — use
`HttpRouter.middleware`/`addGlobalMiddleware` for response-modifying middleware.

---

## 4c. Effect.Atom (React state layer — adopted for route workspaces)

Atom moved INTO the effect monorepo in v4. If you knew `@effect-atom/atom-react@0.5`
(effect v3), everything renamed:

| v3 (@effect-atom 0.5) | v4 (verified beta.92 ≡ beta.98) |
| --- | --- |
| package `@effect-atom/atom-react` (re-exports Atom + Result) | **`@effect/atom-react`** — HOOKS ONLY (`useAtom`, `useAtomValue`, `useAtomSet`, `useAtomRefresh`, `useAtomSuspense`, `RegistryProvider`, …); version-locked to effect (`4.0.0-beta.N` peers `effect ^4.0.0-beta.N`) |
| `import { Atom, Result } from "@effect-atom/atom-react"` | `import * as Atom from "effect/unstable/reactivity/Atom"` + `import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"` |
| `Result` module (Initial/Waiting/Success/Failure) | **`AsyncResult`** — same shape (`isSuccess`/`isFailure`/`isWaiting`/`isInitial`, `.value`, `.cause`, `value()`, `getOrElse`); renamed because `effect/Result` now means Either |
| `Stream.asyncPush((emit) => acquireRelease(...))`, `emit.single(v)` | `Stream.callback((queue) => acquireRelease(...))`, `Queue.offerUnsafe(queue, v)` |
| `Cause.failureOption(cause)` | `Cause.findErrorOption(cause)` |
| `Atom.make` / `Atom.readable` / `Atom.writable` / `Atom.fn` / `Atom.family`, `RegistryProvider` | unchanged names. `Atom.make(stream)` → `Atom<AsyncResult<A, E \| NoSuchElementError>>`; `Atom.fn` → `AtomResultFn` |

Also in `effect/unstable/reactivity`: `AtomRef`, `AtomRegistry`, `AtomHttpApi`, `AtomRpc`
(atom-native HttpApi/Rpc clients — consider when a typed Pe surface meets a React view).

House patterns (proven in `apps/web/src/workbench/route-state.tsx` and the
scratch reference `packages/scratch-state-bakeoff/src/3-effect-atom.tsx`):
- **Push-authoritative doc**: `Atom.make(Stream.concat(hydrateEffect, Stream.callback(subscribe)))`
  — server is the single writer; the scoped finalizer in `Stream.callback` unsubscribes
  when the atom is disposed. `Atom.family(spec => ...)` shares ONE subscription across
  every component reading the same spec.
- **Dirty-safe local draft**: writable `Atom<Option<T>>` override (None = follow remote,
  Some = hold edit) + derived `Option.getOrElse(override, () => remote)` value + derived
  `Option.isSome` dirty. Clobber-safety is structural — no lastSynced ref, no effect.
- **Command with pending/error**: `Atom.fn(input => Effect...)`; read
  `AsyncResult.isWaiting` / `isFailure` + `Cause.findErrorOption` in the component —
  replaces paired useStates.
- A default registry exists on React context; `RegistryProvider` is only needed to seed
  values or scope lifetimes.

---

## 5. AI note (we keep Mastra)

Effect ships `effect/unstable/ai/*` (`LanguageModel`, `Tool`, `Toolkit`, `Chat`, `McpServer`, provider
packages `@effect/ai-*`). **We are NOT adopting it** — Mastra stays the agent framework (see PLAN.md +
MASTRA-DELTA.md). Mentioned only so you recognize it and don't accidentally wire it in. If a task ever needs
an Effect-native MCP server surface, `effect/unstable/ai/McpServer` exists — but that's out of scope for the
rework.

---

## Quick self-check before you commit Effect code

- Did I write `Context.Tag`, `Effect.Service`, `Layer.scoped`, `Effect.catchAll`, `Effect.either`,
  `Effect.fork`, `yield* someRef`, `Schema.Union(a,b)`, `@effect/platform/...`, or `@effect/rpc/...`?
  → all v3. Fix per the tables above.
- Is the API in `effect/unstable/*`? Then it can break on a minor bump — pin your expectation to the grep,
  not to this doc.
- When unsure: grep `node_modules/.pnpm/effect@<version>/.../src/<Module>.ts` (compiles-here truth) or
  effect-smol `packages/effect/src/...` (HEAD). Never write a signature from memory.
</content>
</invoke>
