# Effect v4 patterns for the host, MCP server and web doors

Read 2026-11-04 at `main` f734953f. Pin: `effect` 4.0.2 exact, with `@effect/platform-node` 4.0.2 and `@effect/atom-react` 4.0.2.

Your training is mostly Effect v3, and v4 written from those reflexes compiles wrong or does not compile. This doc lists what changed and the shapes this repo uses. [ADR 0029](../../adr/0029-effect-is-the-standard-library-one-fiber-per-request.md) is the law: Effect is the standard library, and each request runs on one fiber. When this doc and the ADR disagree, the ADR wins, so fix this doc.

## 0. References, in order of trust

1. **The installed package.** It is the only version that compiles here, and the published package ships its sources:
   - `ts/node_modules/.pnpm/effect@4.0.2/node_modules/effect/src/` holds the modules. Read the doc comment and the `@stability` tag.
   - `ts/node_modules/.pnpm/effect@4.0.2/node_modules/effect/ai-docs/src/` holds worked examples by area: `01_effect`, `03_stream`, `06_schedule`, `07_datetime`, `08_observability`, `09_testing`, `50_http-client`, `51_http-server`, `60_child-process`, `70_cli`, `71_ai`.
   - Look up the platform backends and React hooks under `ts/node_modules/.pnpm/@effect+platform-node@4.0.2_*/node_modules/@effect/platform-node/src/` and `ts/node_modules/.pnpm/@effect+atom-react@4.0.2_*/node_modules/@effect/atom-react/src/`.
2. **swell's `effect` skill** (`~/source/repos/swell/.claude/skills/effect/SKILL.md`). ADR 0029 names it as the reference dogma. It gives seven rules (the edge is a Schema, failures are values, dependencies are services, nothing ambient, name the steps, a driver not an owner, the source is the spec) and a seven-step loop: find the pin, get the source at that tag, ask which module owns the concept, read three things, compile what you doubt, probe what matters, record the verdict. It also lists smells and the places where Effect falls short. swell pins 4.0.2 too.
3. **ADR 0029 and the host ledger** (`docs/features/host/LEDGER.md`). They hold the rules, the API corrections made against 4.0.2, and what is still owed.
4. **Clones under `.explore/`.** They are useful for the `migration/*.md` guides, `MIGRATION.md`, `LLMS.md` and `packages/effect/test`. None of them is at the pin:
   - `.explore/effect` follows the canonical `Effect-TS/effect` repo, which now hosts v4. Its working copy reads `4.0.0-rc.111`, which is older than 4.0.2, and it has no release tags. Pull it before you use it. Where it differs from the installed package, the installed package wins.
   - `.explore/effect-smol` is archived at `4.0.0-beta.98`, and its README says v4 moved to `Effect-TS/effect`. Do not cite it.
   - `.explore/effect-atom` is the pre-merge v3-era atom library. Use it only for rename history.
5. **Testimony.** The Effect audit of 2026-11-04 is `.artifacts/review/effect-audit-2026-11-04/SYNTHESIS.md`, and its fix rules are items 11 to 24 and 31 of `.artifacts/runs/evolution-20261103/briefs/COMMON.md`. Section 2 below folds them in. They are disposable artifacts, so cite the source lines, never the artifact.
6. **Upstream on the web:** https://github.com/Effect-TS/effect (branch `main` is v4) and https://effect.website/docs. Both may run ahead of 4.0.2.

Doubt every name in this doc. Before you build on a signature, grep it in reference 1 and compile a ten-line sketch.

### Stability

Some modules carry `@stability unstable` and can break in a minor release: `effect/http`, `effect/http-api`, `effect/process`, `effect/rpc`, `effect/reactivity`, and others. That is why the pin is exact, and why ADR 0029 makes any bump a wave of its own. When you bump, re-grep every recipe below.

---

## 1. What changed from v3

Every name below was grepped as an export of the 4.0.2 sources. A name that is not in these tables may still exist, but grep it before you use it.

### 1a. Module paths

v4 has one `effect` package with subpath exports, and there is no `effect/unstable/*` path. The betas used `effect/unstable/http` and similar paths. If you meet `unstable/` in an old note, the note is stale.

| v3 | v4 (4.0.2) |
| --- | --- |
| `@effect/platform/HttpRouter`, `HttpServerRequest`, `HttpServerResponse`, `HttpMiddleware`, `HttpClient` | `effect/http` (`import { HttpRouter, HttpServerResponse } from "effect/http"`) |
| `@effect/platform/HttpApp` | `effect/http` → `HttpEffect` |
| `@effect/platform/HttpApi*` | `effect/http-api` |
| `@effect/platform/Command`, `CommandExecutor` | `effect/process` → `ChildProcess`, `ChildProcessSpawner` |
| `@effect/platform/Socket` | `effect/socket` |
| `@effect/rpc/*` | `effect/rpc` |
| `@effect/platform/KeyValueStore` | `effect/persistence` |
| `@effect/experimental/Sse`, encodings | `effect/encoding` (`Sse`, `Ndjson`, `Base64`, …) |
| `@effect/ai/*` | `effect/ai` |
| `@effect/schema/Schema` | `Schema` from `"effect"`. It is not `@effect/schema`. |
| `effect/Either` | `effect/Result` |
| `effect/FiberRef` | Gone. `effect/References` holds the built-ins (see 1e). |
| `effect/TestClock`, `effect/FastCheck` | `effect/testing` → `TestClock`, `TestConsole`, `TestSchema` |
| `@effect-atom/atom-react` | Atoms come from `effect/reactivity/Atom`, `AsyncResult`, `AtomRegistry` and `Reactivity`. The hooks come from `@effect/atom-react`. |

`@effect/platform-node` supplies `NodeRuntime`, `NodeServices`, `NodeHttpServer`, `NodeHttpClient` (the host uses `layerUndici`), `NodeChildProcessSpawner`, `NodeSocket`, `NodeFileSystem` and `NodePath`.

### 1b. Services and layers

| v3 | 4.0.2 |
| --- | --- |
| `Context.Tag("X")<X, S>()` | `class X extends Context.Service<X, S>()("X") {}` |
| `Context.GenericTag<S>("X")` | `const X = Context.Service<Id, S>("X")` (the function form; see `RequestIdentity` in `request-services.ts:14`) |
| `Effect.Service<X>()("X", { effect, dependencies })` with an automatic `.Default` | Gone. Give the class a `static readonly layer = Layer.effect(X, make)` and wire the dependencies with `Layer.provide`. |
| static accessors `X.method()` | Gone. Use `const x = yield* X`, then call `x.method()`. |
| the service's shape type | `X["Service"]`, or `Context.Service.Shape<typeof X>` for a function-form service |
| `Context.Reference<X>()("X", opts)` | `Context.Reference<T>("X", { defaultValue })` |
| `Layer.scoped` / `Layer.scopedDiscard` | `Layer.effect` / `Layer.effectDiscard`. Both are scoped. |
| `Layer.tapErrorCause` | `Layer.tapCause` |
| `X.Live` / `X.Default` | `X.layer`, plus variants such as `X.live` when the backend is provided |
| `Effect.Effect.Context<T>` | `Effect.Services<T>`. `Effect.Success<T>` gives the success type. |

### 1c. Effect combinators

| v3 | 4.0.2 |
| --- | --- |
| `Effect.async` | `Effect.callback` |
| `Effect.either` | `Effect.result`. It returns a `Result`. |
| `Effect.zipRight` / `zipLeft` | `Effect.andThen` / `Effect.tap` |
| `Effect.catchAll` / `catchAllCause` / `catchAllDefect` | `Effect.catch` / `catchCause` / `catchDefect` |
| `Effect.catchSome` / `catchSomeCause` | `Effect.catchFilter` / `catchCauseIf`, `catchCauseFilter` |
| `Effect.tapErrorCause` | `Effect.tapCause` |
| `Effect.ignoreLogged` | `Effect.ignore({ log: true })` |
| `Effect.fork` / `forkDaemon` | `Effect.forkChild` / `Effect.forkDetach`. In the host, use neither (see 2f). |
| `Effect.forkScoped`, `Effect.forkIn` | unchanged |
| `Effect.forkAll`, `forkWithErrorHandler` | removed |
| `Effect.makeLatch` / `makeSemaphore` | `Latch.make` / `Semaphore.make`. In 4.0.2, `Semaphore` is not FIFO (see 2j). |
| `Effect.timeoutTo` style | `Effect.timeoutOrElse({ duration, orElse })` |
| `Effect.catchTag`, `catchTags`, `catchIf` | unchanged. `catchReason` / `catchReasons` are new. |

### 1d. `Ref`, `Deferred` and `Fiber` are not yieldable

| v3 | 4.0.2 |
| --- | --- |
| `yield* ref` | `yield* Ref.get(ref)` |
| `yield* deferred` | `yield* Deferred.await(deferred)` |
| `yield* fiber` | `yield* Fiber.join(fiber)` |

An `Effect`, an `Option`, a `Result`, a `Config` and a `Context.Service` are yieldable. Pass a non-Effect yieldable to a combinator with `.asEffect()`.

### 1e. FiberRef

4.0.2 has no `FiberRef` module. The only fiber modules are `Fiber`, `FiberHandle`, `FiberMap` and `FiberSet`. Ambient per-fiber state is a `Context.Reference` or a required `Context.Service`, set with `Effect.provideService`. The built-in references live in `References`, for example `References.CurrentLogLevel`, `MinimumLogLevel`, `CurrentLogAnnotations` and `TracerEnabled`. Request identity is a required service that admission provides once (ADR 0029 rule 2). `References` has no `CurrentConcurrency`.

### 1f. Cause is flat

A `Cause` has `reasons: ReadonlyArray<Fail | Die | Interrupt>`. Iterate the reasons; do not recurse a tree.

| v3 | 4.0.2 |
| --- | --- |
| `Cause.isFailure` / `isDie` / `isInterrupted` | `Cause.hasFails` / `hasDies` / `hasInterrupts` |
| `Cause.failureOption` | `Cause.findErrorOption`. On an `Exit`, use `Exit.findErrorOption`. |
| `Cause.failures(c)` | `c.reasons.filter(Cause.isFailReason)` |
| `Cause.sequential` / `parallel` | `Cause.combine` |
| `*Exception` | `*Error` (`Cause.NoSuchElementError`) |

`Cause.pretty` exists. ADR 0029 rule 5 makes it a finding inside an error message, because a message must not carry a classified failure.

### 1g. Stream

| v3 | 4.0.2 |
| --- | --- |
| `Stream.fromChunk(s)` / `mapChunks` | `Stream.fromArray(s)` / `mapArray` |
| `Stream.async*` | `Stream.callback((queue) => …)`, emitting with `Queue.offerUnsafe(queue, v)` |
| `Stream.repeatEffect` | `Stream.fromEffectRepeat` |
| `Stream.either` / `catchAll` | `Stream.result` / `Stream.catch` |
| `Mailbox` | `Queue` |

`Stream.fromPubSub`, `map`, `filter`, `runForEach` and `fromReadableStream` are unchanged.

### 1h. Schema

Import it as `import { Schema } from "effect"`. The full guide is `migration/schema.md` in `.explore/effect`. The usual traps:

| v3 | 4.0.2 |
| --- | --- |
| `Schema.Union(A, B)`, `Tuple(A, B)` | `Schema.Union([A, B])`, `Schema.Tuple([A, B])` |
| `Schema.Literal("a", "b")` | `Schema.Literals(["a", "b"])`. A single `Schema.Literal("a")` is still fine. |
| `Schema.Record({ key, value })` | `Schema.Record(key, value)` |
| `decodeUnknown` / `decode` / `decodeUnknownEither` | `decodeUnknownEffect` / `decodeEffect` / `decodeUnknownExit`. The `*Sync` forms are unchanged. |
| `Schema.filter(pred)` | `.check(Schema.makeFilter(pred))`. A refinement uses `Schema.refine`. |
| `Schema.transform` / `transformOrFail` | `from.pipe(Schema.decodeTo(to, …))` with `SchemaTransformation` / `SchemaGetter` |
| `optionalWith(s, { exact: true })` / `{ default }` | `Schema.optionalKey(s)` / `s.pipe(Schema.withDecodingDefault…)` |
| `.annotations(a)` | `.annotate(a)` |
| `Schema.TaggedError` (v3) | `Schema.TaggedError<Self>()("Tag", fields)`. It is the stable 4.0.2 name. The betas called it `Schema.ErrorClass`, which no longer exists. The untagged form is `Schema.Error`. |
| `ParseResult` formatters | A failed parse raises `Schema.SchemaError` with `.issue`. Format it through `SchemaIssue`. |

Type extraction is `typeof S.Type` or `Schema.Schema.Type<typeof S>`. Use `Schema.Json` for arbitrary JSON, and `Schema.fromJsonString` / `UnknownFromJsonString` to parse JSON text.

**Standard Schema.** MCP SDK v2 (`@modelcontextprotocol/server`) types `registerTool` on Standard Schema plus `~standard.jsonSchema`. Compose `Schema.toStandardJSONSchemaV1(Schema.toStandardSchemaV1(S))` (ADR 0029 rule 8, PROVEN by compile 2026-11-02). In the other direction, `fromStandardSchema` (`host-contracts/src/contracts/standard-schema.ts:26`) decodes zod contracts through Effect. It is transitional: its import count only shrinks, phase 8 deletes it, and a new edge uses native Effect Schema.

### 1i. Runtime

`Runtime<R>` is gone; the `Runtime` module keeps only `Teardown` and `makeRunMain`. `NodeRuntime.runMain` is the process entry. `Scope.extend` became `Scope.provide`. `ManagedRuntime` exists, but no house shape uses it.

---

## 2. House rules, as code (ADR 0029)

The host still carries islands, so a file you open may contradict this section. Treat the island as the finding, not the precedent. At f734953f: 124 `effect-edge: island, phase 5` markers, 91 `Effect.fnUntraced` against 48 `Effect.fn`, 38 `Effect.promise`, `AsyncLocalStorage` in 5 host files, and module singletons in `gateway-owner.ts`. Copy from the four places where Effect is real: `ts/packages/host-internal/src/dispatch.ts` (the serial worker), `ts/apps/host/src/native-reads.ts`, `ts/apps/host/src/run-consent.ts` (settlement) and `ts/apps/host/src/harness/spawner.ts`.

### 2a. The run family runs only at a marked edge (rule 2)

Every `Effect.run*`, `runMain` and `*With` form, including aliases and destructured forms, needs a `// effect-edge: <reason>` comment on its own line. The reason comes from a closed vocabulary: `process-main`, `cli-main`, `test-runner`, `als-crossing` (retires in phase 5), or `island, phase 5`. The `pe/effect-edge` lint (`ts/scripts/oxlint-effect-edge.js`) refuses any other site. The per-file island counts in `ts/tests/repo-guards/src/effect-islands.baseline.json` only shrink, and the guard compares them to the merge base. After phase 5 the island count is zero.

```ts
// host-main.ts: the one product process edge
// effect-edge: process-main
NodeRuntime.runMain(hostProgram());
```

Never write a helper that captures `Effect.context()` and calls `runPromiseWith(services)`: it ends the fiber (COMMON 13). Write the caller as an Effect instead.

### 2b. Dependencies are services, provided once

```ts
export class Spawner extends Context.Service<Spawner, Effect.Success<typeof make>>()("pe/Spawner") {
  static readonly layer = Layer.effect(Spawner, make); // scoped: closing the layer closes every child
  static readonly live = Spawner.layer.pipe(Layer.provide(NodeServices.layer));
}
```

- Anything with a lifetime is a service, built in `make` with `Effect.gen` and provided once in `app.ts` `makeHttpLive`. The scoped services today are `RevitBridge`, `NativeReads`, `RunConsents`, `HarnessThreads`, `FamiliesReader`, `MachineOwner`, `CaptureStore`, `ReceiptExport`, `Spawner`, `HostLifecycle`, `UpdateReader` and `AdmittedBuiltins`. `ActionJournal` and `HostLog` are still module state in `gateway-owner.ts`, which is a finding (COMMON 20).
- Configured bounds are a `Context.Reference` with a default, so a test can swap them. For example, `NativeReadLimits` in `native-reads.ts:15` and `DispatchLimits` in `dispatch.ts:113`.
- Hold the shape in a closure inside `make`. A module `let`, a WeakMap registry or a lazy singleton beside a service is a second owner.
- A test swaps a layer, never a module.

### 2c. Failures are values; one mapper turns them into HTTP (rule 5)

```ts
const fields = { message: Schema.String, status: Schema.Number, problem: Schema.String };
export class ReadBusy extends Schema.TaggedError<ReadBusy>()("ReadBusy", fields) {}
// in a generator: return yield* new ReadBusy({ message, status: 429, problem: "read.capacity" });
```

- Expected failures are `Schema.TaggedError` classes, and they belong to the closed `DoorFailure` union (`@pe/host-internal/request-contracts`). `http-problems.ts` maps that union once, as `HttpRouter.middleware<{ handles: DoorFailure }>()((h) => h.pipe(Effect.catchTags(handlers))).layer`, and the `satisfies DoorFailureMapper` makes a new failure need a mapper entry.
- A handler returns the typed failure. It never builds a problem response, picks a status, or classifies an error by its message or shape (COMMON 16).
- A `throw` inside an Effect, or a regex on a message, is a finding. Plain `readonly _tag = "X"` classes survive only until their file converts. Three remain at f734953f: `local-error.ts`, `call-route.ts:1228` and `takeoff-captures.ts:191`.
- Wrap a Promise that can reject in `Effect.tryPromise({ try, catch: (e) => new Tagged(...) })`. Use `Effect.promise` only for a Promise that provably cannot reject, because a rejection inside it becomes a defect that bypasses `catchTags` and every finalizer (COMMON 12).

### 2d. Name the steps (rule 6)

A reusable effectful function is `Effect.fn("Owner.step")(function* (...) { ... })`, so every step is a span and a stack frame. Reserve `Effect.fnUntraced` for hot inner loops. Use `Effect.gen` inline, and never write a function whose only body is an `Effect.gen` wrapper. Never put Effect around a pure value: a `gen` with one yield, or `Effect.succeed` around a projection, only adds a fiber (COMMON 21).

### 2e. Nothing ambient (rule 4)

- **Time** comes from `Clock` (`Clock.currentTimeMillis`) and `DateTime`, and waits use `Effect.sleep`. Persisted `at:` stamps come from `Clock` through `DateTime`. Tests drive time with `TestClock.adjust` from `effect/testing` (`tests/consent-window.test.ts`).
- **Children** come from the `Spawner` service over `effect/process`, never from `node:child_process` (2i).
- **Files** that need a scope come from `FileSystem`. A one-line `appendFileSync` is not a finding by itself.
- **Config** comes from Effect `Config`, and an env value the host does not author is decoded by a Schema (rules 1 and 7). The host does not do this yet: it has one `Config.` site.
- **Recorded exceptions where Effect falls short:** `node:os` supplies `homedir` and `hostname`. Worktree identity uses native realpath, because `FileSystem.stat` has no `ino` above 2^53 and `realPath` keeps 8.3 short names.

### 2f. Supervision: fork into a scope (rule 12)

Fork every fiber (a consent window, a poll, a probe, a dispatch worker) into a service's scope with `Effect.forkScoped`, or with `Effect.forkIn(scope)` after `const scope = yield* Effect.scope`. A detached `runFork` is a finding. The host has one `Effect.forkDetach`, in `host-lifecycle.ts:415`: it trips the shutdown latch after the response flushes. Do not copy it.

Durable work captures causal identity and journal ownership explicitly when it is forked. It never inherits the request's cancellation lifetime (rule 2, rule 14).

### 2g. Settle inside the Exit (COMMON 11)

The obligatory step must be guaranteed, and the persist must be typed. Never write "persist, then settle the waiter" as two statements, because a persist failure skips the settle. Transition state first, run the persist, and settle in `Effect.onExit`, so that every exit, interruption included, reaches the waiter:

```ts
// run-consent.ts: the one settlement
body.pipe(
  Effect.onExit((exit) =>
    Effect.sync(() => {
      const outcome = Exit.isSuccess(exit)
        ? Effect.succeed(exit.value)
        : Effect.fail(Option.getOrElse(Exit.findErrorOption(exit), () => stopped));
      for (const waiter of waiters) Deferred.doneUnsafe(waiter.answer, outcome);
    }),
  ),
);
```

Inside a marked Promise island, use the island's own idiom: `try { persist() } finally { settle() }`. Do not thread Effect combinators into Promise code; convert the island whole or not at all (COMMON 24).

### 2h. Route lifetimes, shared reads and the serial slot (rules 10, 11, 15)

- Every route declares one of three lifetimes:
  - **Request-owned read:** the work lives on the request fiber.
  - **Durable command:** the journal owns the work from submission.
  - **Subscription:** the route observes, and losing the observer never stops the work.
- A native read is a `NativeReads.join(prepared, session)`. It shares one dispatch per canonical descriptor and refcounts its joiners. When the last joiner is interrupted it sends one `op.cancel`, and it forgets the entry only on terminal settlement. The join runs under `Effect.uninterruptibleMask((restore) => …)`, so a join never leaks a refcount.
- The serial slot is one worker per Revit process incarnation. It is fed by a bounded FIFO `Queue` and forked into the bridge scope (`dispatch.ts`). Cancel bypasses the worker. A timer never releases the slot.
- Every cache, queue and subscriber list names an entry bound, a byte bound, and the result it returns on overflow (rule 15).

### 2i. Child processes

```ts
const handle = yield* spawner.spawn({ command, args, cwd, env }); // env is the whole environment
```

`Spawner.spawn` (`harness/spawner.ts`) ties each child to both the caller's scope and the Spawner's. Closing either one kills the process tree while the leader is still alive. On win32 the backend runs `taskkill /pid <leader> /T /F`, and the walk needs a live leader, which is why the kill finalizer runs before the backend's release. A leader that exits on its own still orphans its tree, because Node exposes no Job Object. `ChildProcess.make(cmd, args, { cwd, env, extendEnv: false })` is the descriptor; `windowsHide` exists on its options. Ten-odd child sites outside the Spawner remain, listed in the audit's P4. Each is a finding.

### 2j. Effect 4.0.2 behaviour that bit us (probe, do not assume)

- `Semaphore` is not FIFO: a newcomer can take a freed permit before the waiters wake. Order-sensitive work uses a `Queue` and one worker fiber.
- `Queue.clear` after `Queue.interrupt` on an empty queue fails. This once kept a retired Revit session alive forever; see `dispatch.ts`.
- The platform child release walks the process tree only after a non-zero exit. That is why `Spawner` kills the tree first.

### 2k. Edge decoding (rules 1 and 7)

Decode everything the host does not author, never cast it: the thread store, harness child output, CLI discovery, SSE frames and tab memory, MCP blobs. Decode once with `Schema.decodeUnknownEffect(S)(raw)` and use the value it returns. Parsing and then returning `raw as T` is a cast with extra steps (COMMON 18). Persisted records carry a version. Mint sequence ids from the last decoded record, never from `length + 1` (COMMON 19, 28).

### 2l. Tests (rule 13)

Unit tests are not something to preserve. A deterministic test stays only when it guards an invariant that the pe-browser lane cannot falsify. Tests run Effects only through `ts/apps/host/tests/effect-test.ts`: use `effectTest` for fiber laws under `TestClock`, and `settle()` for Promise-shaped calls. A test never calls the run family itself (COMMON 31). `@effect/vitest` waits for vite-plus to run vitest 5 (host ledger, Owed).

### 2m. Where Effect does not fit (rule 9)

- `ducts-domain` is pure values in and values out, so leave it plain.
- React render code stays React plus atoms; `Effect.gen` in a component is a finding.
- `eventlog`, `workflow`, `cluster`, `KeyValueStore` and `TxRef` are rejected, because each would be a second owner of state beside the journal.
- `Schedule` owns in-process backoff only (`machine.ts:649`, `Effect.repeat(Schedule.spaced(...))`). The journal owns retry across restarts.
- Use `Path` where a scope is needed, not for every `join`.

---

## 3. HTTP in the host (`effect/http`)

The host is one `HttpRouter` app. ADR 0029 corrected the HTTP migration target: the router is already adopted, and phase 5 deletes the Web-handler island inside it rather than adding another router.

### Routes are layers

```ts
import { HttpRouter, HttpServerResponse as Response } from "effect/http";

export const hostStatusRoute = HttpRouter.add("GET", hostProcessIdentity.healthPath, () =>
  Effect.gen(function* () {
    const bridge = yield* RevitBridge;
    return yield* Response.json(/* ... */);
  }),
);
```

- Path params: `yield* HttpRouter.params`.
- Responses: `Response.json(x)` is effectful, `Response.jsonUnsafe(x, { status, headers })` is sync, and `Response.text`, `Response.empty()`, `Response.stream(bytes, { contentType, headers })`, `Response.file(path)` and `Response.fromWeb` cover the rest.
- Response-modifying middleware is `HttpRouter.middleware`. `serve({ middleware })` wraps only the sending of the response.

### Assembly (`app.ts` `makeHttpLive`, launched by `host-program.ts`)

```ts
HttpRouter.serve(Layer.mergeAll(routes, CommonAppLive).pipe(Layer.provide(identity)))
  .pipe(Layer.provideMerge(ServerLive))          // NodeHttpServer.layer(() => nodeServer, { ... })
  .pipe(Layer.provide(NodeHttpClient.layerUndici), Layer.provide(RunConsents.layer),
        Layer.provide(Spawner.live), Layer.provide(NodeServices.layer) /* ... */);
// host-program.ts
yield* Effect.raceFirst(Layer.launch(HttpLive), Deferred.await(latch));
```

- `HttpRouter.serve` installs `HttpMiddleware.logger` and logs the bound address by itself. Pass `disableLogger` or `disableListenLog` to turn them off.
- Graceful self-shutdown races `Layer.launch` against a latch. Closing the launch scope runs `NodeHttpServer`'s `server.close()` finalizer, then the other releases in reverse order. `process.exit` skips every finalizer, so it is only a delayed fallback.
- The actual bound address after listen is `(yield* HttpServer.HttpServer).address`.

### Static SPA

`HttpStaticServer.layer({ root, spa: true, index: "index.html" })`, merged last so API routes win (`static-spa.ts`). `NodeHttpServer.layer` already supplies its FileSystem, Path, HttpPlatform and Etag.

### WebSocket upgrade (`bridge.ts`)

```ts
const socket = yield* Effect.orDie(req.upgrade);
const write = yield* socket.writer;
// socket.runString(onFrame) drives the read side; cleanup goes in Effect.ensuring.
```

### Foreign fetch handlers

`HttpEffect.fromWebHandler((req: Request) => door.fetch(req))` bridges a Web handler, such as the MCP SDK door, and streaming survives in both directions. The honest uses are a true third-party entry (MCP SDK, ACP). It is also the island ADR 0029 rule 5 deletes for Pe-owned routes: `pe-routes.ts` `servePeRoute`, `demo-owner.ts`, `pages-route.ts`, `share.ts`, `device-routes.ts` and `duct-catalogs.ts` still use it at f734953f. Prefix semantics: `router.prefixed("/x").add("*", "/*", h)` strips `/x`, and a bare `add("*", "/x/*", h)` does not.

### Not adopted: RPC and HttpApi

`POST /call` replaced Effect RPC and NDJSON on 2026-07-08 (host ledger), and its operation-key dispatch stays a table generated from operation metadata (ADR 0029 rule 5). The dynamic operation catalog registers from Revit at runtime, so a compile-time `RpcGroup` or `HttpApi` cannot type it. `effect/rpc` and `effect/http-api` exist at 4.0.2, but nothing in the host imports them. If a typed static surface ever needs them, start from the module sources and `ai-docs/src/51_http-server`, not from memory. Two notes for that day: at 4.0.2 `RpcSerialization` has `layerNdjson`, `layerJson`, `layerJsonRpc`, `layerNdJsonRpc` and `layerSchemaBinary`, and no MsgPack layer; HttpApi errors carry their status as an `httpApiStatus` annotation on `Schema.Error` / `Schema.TaggedError` (see `HttpApiError.ts`).

---

## 4c. Atom (web state)

The section number stays 4c, because ADR 0001 links to it.

| v3 (`@effect-atom/atom-react` 0.5) | 4.0.2 |
| --- | --- |
| package `@effect-atom/atom-react` | Hooks only, in `@effect/atom-react`: `useAtomValue`, `useAtom`, `useAtomSet`, `useAtomRefresh`, `useAtomSuspense`, `useAtomMount`, `RegistryContext`, … |
| `import { Atom, Result }` | `import * as Atom from "effect/reactivity/Atom"` and `import * as AsyncResult from "effect/reactivity/AsyncResult"` |
| `Result` (Initial, Waiting, Success, Failure) | `AsyncResult`, with the same shape. The rename exists because `effect/Result` now means Either. |
| `Stream.asyncPush(emit)`, `emit.single(v)` | `Stream.callback((queue) => …)`, `Queue.offerUnsafe(queue, v)` |
| `Atom.make`, `readable`, `writable`, `fn`, `family` | unchanged names |

House shapes (`apps/web/src/shell/work-document.ts`, `shell/readings-hooks.ts`, `workbench/provider/thread-stream.ts`, `attention.tsx`):

- **One subscription per key.** `Atom.family((key) => Atom.make(...))` shares one subscription across every reader of the same key. A structured key implements `Equal.symbol` and `Hash.symbol` so that equal keys hit the same atom (`work-document.ts`).
- **Push-authoritative documents.** `Atom.make(Stream.concat(hydrate, Stream.callback(subscribe)))`. The server is the single writer, and the scoped finalizer in `Stream.callback` unsubscribes when the atom is disposed.
- **Dirty-safe local drafts.** A writable `Atom<Option<T>>` override, with derived `Option.getOrElse(override, () => remote)` for the value and `Option.isSome` for dirty.
- **Commands with pending and error.** `Atom.fn(input => Effect…)`, read with `AsyncResult.isWaiting` / `isFailure` plus `Cause.findErrorOption`.
- **Lifetimes.** A lifetime in web code has one owner, the scope. No `AbortController`, release `Set` or `live` flag sits beside a scoped atom or layer (COMMON 14). Observation is not completion: return the terminal in the result channel, and make subscription an `acquireRelease` (COMMON 15). Unbounded tails are a finding (COMMON 17, `thread-stream.ts`).

---

## 5. AI modules (not adopted)

`effect/ai` (`LanguageModel`, `Tool`, `Toolkit`, `Chat`, `McpServer`) exists. It is not adopted, because the lab harness is the agent (ADR 0015) and the MCP server runs on `@modelcontextprotocol/server` v2. It is named here only so nobody wires it in by accident.

---

## Self-check before you commit Effect code

- Did you write `Context.Tag`, `Effect.Service`, `Layer.scoped`, `Effect.catchAll`, `Effect.either`, `Effect.fork`, `yield* ref`, `Schema.Union(a, b)`, `Schema.ErrorClass`, `FiberRef`, `effect/unstable/*`, `@effect/platform/*` or `@effect/rpc`? Each one is v3 or a beta name. Fix it from section 1.
- Does a new `Effect.run*` lack an `effect-edge:` reason from the vocabulary? Has the island baseline grown? Either one blocks the merge.
- Do you see `throw`, a message regex, `Cause.pretty` in a message, `Effect.promise` on rejectable work, persist-then-settle, a module `let` beside a service, `Date.now()`, `setTimeout`, `node:child_process`, or `as` on decoded data? Each one has an owner in section 2.
- Is the signature in the installed 4.0.2 sources? If you doubt it, compile a sketch. If the behaviour matters (kill semantics, Windows paths, queue order), probe it.
- Record what you adopted, what you rejected and where Effect fell short, in the host ledger or a comment at the site.
