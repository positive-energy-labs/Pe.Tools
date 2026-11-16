---
scope: skills
---

# Shapes

The target shape for each law in `SKILL.md`, in its order. These are written for the ideal, not copied from any codebase. Every block except the test typechecks against `effect` 4.0.2 under `strict` and `exactOptionalPropertyTypes`. A bump re-reads every name here against the new pin.

## A program

### 1. One entry

```ts
// the one place the program runs; the reason is on the line
// effect-edge: process-main
NodeRuntime.runMain(Layer.launch(AppLive))
```

### 2. One layer graph, built once

```ts
const ServerLive = Layer.unwrap(Effect.gen(function* () {
  const port = yield* Config.Port("PORT")          // the layer's shape depends on config
  return NodeHttpServer.layer(createServer, { port })
}))

export const AppLive = HttpRouter.serve(Routes).pipe(
  Layer.provide(Projects.layer),                    // only the routes need it
  Layer.provideMerge(ServerLive),                   // stays visible above
  Layer.provide(NodeServices.layer),
)
```

### 3. Every lifetime belongs to a scope

```ts
export class Watcher extends Context.Service<Watcher, {
  readonly track: (id: string) => Effect.Effect<void>
}>()("app/Watcher") {
  static readonly layer = Layer.effect(Watcher, Effect.gen(function* () {
    const handle = yield* Effect.acquireRelease(openHandle, (h) => closeHandle(h)) // released with the layer
    const fibers = yield* FiberSet.make()                                         // interrupted with the layer
    yield* poll(handle).pipe(Effect.forever, Effect.forkScoped)                   // owned by the layer's scope
    const track = Effect.fn("Watcher.track")(function* (id: string) {
      yield* FiberSet.run(fibers, follow(handle, id))
    })
    return Watcher.of({ track })
  }))
}
```

### 4. A thin transport

```ts
// decode, call one service method, return its typed failure
HttpRouter.add("POST", "/projects", Effect.gen(function* () {
  const input = yield* HttpServerRequest.schemaBodyJson(CreateProject)
  const projects = yield* Projects
  return yield* HttpServerResponse.json(yield* projects.create(input))
}))
```

### 5. Failures reach the wire once

```ts
const Problem = Schema.Literals(["read.input", "read.busy", "read.retiring", "native.refused"])
type Problem = typeof Problem.Type

// closed: a new code fails to compile until it has a row
const status = {
  "read.input": 400,
  "read.busy": 429,
  "read.retiring": 409,
  "native.refused": 409,
} as const satisfies Record<Problem, number>

const toWire = (failure: { readonly problem: Problem; readonly message: string }) =>
  ({ status: status[failure.problem], body: { problem: failure.problem, message: failure.message } })
```

### 6. Facts a caller acts on are typed fields

```ts
// whether work reached the far side, with uncertainty as a state, tied to one attempt
const Dispatch = Schema.Union([
  Schema.TaggedStruct("NotDispatched", {}),                          // proven: retry is safe
  Schema.TaggedStruct("Dispatched", { outcome: Schema.Literals(["applied", "rejected", "conflict", "failed"]) }),
  Schema.TaggedStruct("Unknown", { reason: Schema.Literals(["interrupted", "timeout", "no-receipt"]) }), // retry is not safe
])

export class NativeFailed extends Schema.TaggedError<NativeFailed>()("NativeFailed", {
  problem: Schema.Literal("native.refused"),
  attempt: Schema.String,         // the exact attempt this fact describes
  dispatch: Dispatch,             // set by the producer that knows; persisted and projected, never inferred
}) {}

// the wire projection keeps the retry fact; it drops the cause, not the evidence
const toWire = (f: NativeFailed) =>
  ({ status: status[f.problem], body: { problem: f.problem, attempt: f.attempt, dispatch: f.dispatch } })
```

## A function

### 1. Decode the edge

```ts
const Spec = Schema.Struct({ limit: Schema.Struct({ perDay: Schema.Number }) })
const spec = yield* Schema.decodeUnknownEffect(Spec)(raw, { errors: "all", onExcessProperty: "error" })
// use `spec` from here on, never `raw as Spec`
```

### 2 and 3. A tagged failure with a cause, from a rejectable Promise

```ts
export class EntryLoadFailed extends Schema.TaggedError<EntryLoadFailed>()("EntryLoadFailed", {
  entry: Schema.String,          // the resource id
  cause: Schema.Defect(),        // the evidence, kept whole
}) {
  override get message() {       // built from fields, never from cause
    return `Entry ${this.entry} failed to load.`
  }
}

const loaded = yield* Effect.tryPromise({
  try: () => entry.load(),
  catch: (cause) => new EntryLoadFailed({ entry: entry.key, cause }),
})

// cannot reject: Promise.resolve of a value already in hand
const value = yield* Effect.promise(() => Promise.resolve(cached))
```

### 4. State and dependencies inside the service

```ts
export class Reads extends Context.Service<Reads, {
  readonly join: (key: string) => Effect.Effect<Answer, ReadFailed>
}>()("app/Reads") {
  static readonly layer = Layer.effect(Reads, Effect.gen(function* () {
    const bridge = yield* Bridge              // dependencies from the environment
    const limits = yield* ReadLimits          // bounds from a Context.Reference with a default
    const flights = new Map<string, Flight>() // state in the closure: one copy per layer
    const join = Effect.fn("Reads.join")(function* (key: string) { /* ... */ })
    return Reads.of({ join })
  }))
}
```

### 5. Nothing ambient

```ts
const now = yield* Clock.currentTimeMillis    // not Date.now()
yield* Effect.sleep("5 seconds")              // not setTimeout
const fs = yield* FileSystem.FileSystem       // not node:fs
const port = yield* Config.Int("PORT")        // not process.env.PORT
```

### 6. Name the steps

```ts
export const load = Effect.fn("Catalog.load")(
  function* (key: string): Effect.fn.Return<Entry, EntryMissing> {
    const found = yield* lookup(key)
    if (Option.isNone(found)) return yield* new EntryMissing({ key })
    return found.value
  },
  Effect.annotateLogs({ owner: "Catalog" }),  // combinators trail the body
)
```

### 7. The waiter settles on every exit

```ts
yield* Effect.gen(function* () {
  yield* Ref.set(owner, terminal)                              // 1. the owning state moves first
  yield* Effect.tryPromise({ try: persist, catch: toTagged })  // 2. the persist fails as a value, inside the protected effect
  return yield* work
}).pipe(Effect.onExit((exit) => Deferred.done(waiter, exit)))  // 3. success, failure, defect and interrupt all settle
// its test: fail the persist once and interrupt the work once; the waiter settles both times
```

### 8. Order is a queue

```ts
const jobs = yield* Queue.bounded<Job>(64)     // the bound is named; offer waits when full
yield* Effect.forever(Effect.flatMap(Queue.take(jobs), runJob)).pipe(Effect.forkScoped)
```

### 9. Tests run on the test clock

```ts
// not compiled here: needs @effect/vitest
it.effect("expires after an hour", () => Effect.gen(function* () {
  const window = yield* ConsentWindow
  yield* window.open("run-1")
  yield* TestClock.adjust("1 hour")
  expect(yield* window.state("run-1")).toBe("expired")
}).pipe(Effect.provide(ConsentWindow.layer)))
```
