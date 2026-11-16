---
name: effect
description: "How idiomatic Effect v4 is written, from one function to a whole program. Trigger on \"effect\", \"idiomatic effect\", \"effect v4\", \"Effect.gen\", \"which module owns this\", \"is this effect-y\", before writing, changing or reviewing code that imports `effect` or `@effect/*`, or when an Effect API is in doubt. Not a v3-to-v4 rename table; the repo file names where that lives."
figure: the statute and the commentary
prevents: "v3 by reflex: Effect written from memory, a blog, or existing code instead of the pinned source"
scope: skills
---

# Effect

**Read the statute, not the commentary.** The source at the pin is the statute. Your memory, the website, another repo's conventions, the code already in this repo and this file are commentary, and commentary runs ahead of the statute or behind it. You may not cite commentary where the statute speaks, and you may not write a helper where the statute already has a module.

This file describes the target. Existing code that departs from it is debt to retire, never a precedent to copy. `references/shapes.md` holds the code shape of each law. `references/repo.md` holds the facts a port rewrites: the pin, the clones, the house doc, the gate.

## Where the statute lives

- The pin is exact, because an unstable module can break in a minor. A bump is a change of its own, and it re-reads every shape.
- The installed package ships its sources, `src/` and `ai-docs/src/`. Read these first, because they are the only version that compiles here.
- The upstream `Effect-TS/effect` repo hosts v4 and tags each release as `effect@<version>`. Its tests, `LLMS.md` and `migration/` at the exact pin come from a worktree of that tag.
- Another app's conventions are commentary from another house. Borrow a reason from them, never a name, and check every name against the pin.

## A program

1. **One entry.** A process starts at one `NodeRuntime.runMain` or `Layer.launch`, with a marked reason. `Effect.run*` runs only there, at a framework boundary, and at the test harness's one seam. A run mid-program starts a new root fiber that inherits none of the caller's interruption, scope or services, so the work it starts has no owner unless someone wires one by hand.
2. **One layer graph, built once.** The application is a graph of layers provided once at the entry. `Layer.provide` feeds a dependency only its consumer needs, and `Layer.provideMerge` keeps it visible above. A layer whose shape depends on config is `Layer.unwrap` over an Effect that reads the config.
3. **Every lifetime belongs to a scope.** A resource is `Effect.acquireRelease` inside a scoped layer. A background fiber is `Effect.forkScoped` into its service's scope, and a dynamic set of fibers lives in a `FiberSet` or a keyed `FiberMap`. A detached fork has no owner, so nobody stops it.
4. **A transport is thin.** A route, a tool or a CLI verb decodes its input, calls one service method, and returns the typed failure. A user, an agent and a schedule reach one capability through different doors, so logic written into one handler is missing from the others.
5. **Failures reach the wire once.** One mapper over the closed set of public failure cases picks each case's wire status and body. Only the public projection is closed. A service keeps its own narrow failures and capabilities, because one universal error vocabulary couples every caller to every service. The failure says what happened and the mapper says how a door speaks it, because each door speaks its own wire. A case is a closed `problem` code, so a failure class that needs several statuses carries several codes. Nothing classifies a failure by its message, its shape or its class name.
6. **Facts a caller acts on are typed fields.** Whether work reached the far side, a retry hint, an outcome from another system: the producer that knows sets it, as a field decoded into a closed union, tied to the exact attempt it describes. Uncertainty is one of the states, because an interruption, a timeout, a missing receipt or a cancelled waiter proves neither that the far side rolled back nor that a retry is safe. The fact survives every projection, the durable record as well as the wire, because a mapper cannot recover what persistence threw away. The mapper never infers it, and a free number from another system never becomes the status.
7. **The public wire vocabulary has one owner.** A `kind` or code that readers branch on is generated from its source of record. An internal class name never leaks onto the wire in its place.
8. **Every operation names the owner of its lifetime.** A read lives on its request, a durable command lives on its record from admission, and a subscription only observes, so losing the observer never stops the work. An operation that calls back into its own server over HTTP hides a second owner, so compose the admitted service directly.

## A function

1. **The edge is a Schema.** Whatever the program does not author is decoded, never cast, because a cast hides a typo and a decode names its path. Decode once and use the value the decoder returns. Domain values are `Schema.Class` or `Schema.Struct`, and absence is `Option`, not `null`.
2. **Failures are values.** An expected failure is a `Schema.TaggedError` with structured fields: the operation, the resource id, a closed code. It keeps the underlying error as `cause`, because the chain is the evidence, and it builds its message from its fields, because a message reaches users and logs and must not carry raw payloads, paths or defect text. Raise it with `return yield* new Failure(...)`, and recover with `catchTags`.
3. **A Promise that can reject gets a typed failure, once, at the foreign edge.** `Effect.tryPromise` with a `catch` that builds a tagged error. A failure that is already typed passes through unwrapped, because a fresh wrapper at every call multiplies adapters and hides the original case. `catch: (error) => error` leaves `unknown` in the channel. `Effect.promise` turns a rejection into a defect that typed recovery misses, so it is only for a Promise that cannot reject, and the line says why.
4. **State and dependencies live inside the service.** `make` gets its dependencies with `yield* Foo`, its bounds from a `Context.Reference` with a default, and holds its state in a closure. Each layer then owns its own copy, and a test swaps a layer, not a module. A module-level `let` or a memoized module Promise is a second owner.
5. **Nothing ambient.** Time comes from `Clock`, files from `FileSystem`, children from the platform spawner, config from `Config`. A read around the services cannot be recorded, replayed or controlled by a test.
6. **Name the steps.** A reusable effectful function is `Effect.fn("Owner.step")`, so each step is a span and a stack frame. Extra combinators go as trailing arguments, not a `.pipe` on the result. `Effect.fnUntraced` is for a hot loop or a step an outer span already covers, and it says which. A function whose only body is `Effect.gen` is a wrapper with no reason, and an Effect around a pure value adds indirection and no behaviour.
7. **The waiter settles on every exit.** An obligatory step never waits behind work that can fail. Put the state move, the persist and the work inside one effect, and settle from its `onExit`, which runs on success, failure, defect and an interrupt from outside. A settle written as the next statement runs on success only, and no type check sees the difference, so a test that fails the persist and interrupts the work, and watches the waiter settle both times, holds it. Settling a local waiter is not releasing work on the far side whose outcome is uncertain. That release waits on the fact in program law 6.
8. **Order is a queue, not a lock.** Order-sensitive work goes through a bounded `Queue` and one worker fiber, because a semaphore promises exclusion, not order. Every queue, cache and subscriber list names its bound and what happens on overflow.
9. **Tests run on the test clock.** A test is an Effect under the test harness, with test layers for the outside world only. It waits on a `Deferred`, a `Queue` take, or `TestClock.adjust`, never on wall time, and it never mocks the logic under test.

## Moving code toward the target

- A conversion is judged by what it removes, not by signatures converted. Each one names the decisions its consumers no longer make, the old execution or state machinery it deletes, and the behaviour that proves the new owner holds them. A count of converted sites proves none of that.
- Convert one family whole: its producers, its route through the one mapper, the deletion of its old branch, and a test on every fact a caller acts on. Typing every producer first and mapping later leaves two half-states alive at once.
- Code still Promise-shaped keeps Promise idiom, `try` and `finally`, until its family converts. Threading a runner into Promise code adds Effect without removing the Promise.
- A ceiling on old patterns only forbids growth, so each change names how much it lowers.

## What holds the laws

The target guard for each law is a type error or a lint rule, and prose is the fallback. Effect's own diagnostics, run as a lint, hold the edge, failure, ambient and naming laws. A guard runs in the gate, and a change lands only on a green gate. A rule with many existing hits starts as a per-file ceiling that only goes down. Law 7 of a function has no static check, so its test is the guard.

## The loop

1. Read the pin, then ask which module owns the concept. Search `src/` and `ai-docs/src/` for the concept, not for the function name you expect.
2. Read three things: the module source with its doc comment and `@stability`, the `ai-docs` example, and one test at the pin that calls it. The test shows the real call shape.
3. Compile what you doubt. A ten-line sketch against the installed package settles a signature.
4. Probe what matters on the platform you ship to: kill semantics, paths, queue order. The doc describes intent, and a probe describes this machine.
5. Check the diff against this file and `references/shapes.md`, not against neighbouring code.
6. Record what you adopted, rejected, or found Effect short on, where the repo file says.
