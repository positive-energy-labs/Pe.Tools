# Effect source concept index

Use this as a table of contents for useful Effect primitives. Paths are local excerpts under `src/` when available, and upstream paths in the Effect repo when a full clone is substituted.

| Concept | Start here | What to look for |
| --- | --- | --- |
| Effect core type | `src/Effect.ts.md` / upstream `packages/effect/src/Effect.ts` | `Effect<A, E, R>` variance, `Effect.gen`, async boundaries, caching, `all`, `fork`, interruption. |
| Runtime/fibers | upstream `packages/effect/src/Runtime.ts`, `Fiber.ts`, `FiberRef.ts` | Running effects, fiber lifecycle, scoped local state, supervision. |
| Layers/services | upstream `packages/effect/src/Context.ts`, `Layer.ts` | `Context.Tag`, dependency injection, live/test layers. |
| Streams | `src/Stream.ts.md` / upstream `packages/effect/src/Stream.ts` | Pull/push streams, websocket/SSE bridging, resource-safe stream construction. |
| Scope/resource safety | upstream `packages/effect/src/Scope.ts`, `internal/fiberRuntime.ts` | `acquireRelease`, finalizers, cleanup on interruption. |
| Queues/PubSub | upstream `packages/effect/src/Queue.ts`, `PubSub.ts` | Backpressure, fan-out event buses, push source normalization. |
| Schema | upstream `packages/effect/src/Schema.ts` | Runtime decoding for websocket/SSE payloads and API boundaries. |
| HTTP/platform | upstream `packages/platform/src/Http*`, `packages/platform-node/src/*` | Request/response, server routes, socket adapters. |
| Frontend atoms | `references/effect-atom-patterns.md` and bundled `reactive-feed-example` | Dependent async state, resource atoms, optimistic commands, event projections. |

## Scraped highlights

- `Effect` values describe workflows that may be synchronous, asynchronous, concurrent, parallel, failing, or dependency-requiring.
- A runtime executes an `Effect` and supplies the required environment.
- Caching helpers such as `cached`, `cachedWithTTL`, and `cachedInvalidateWithTTL` are useful for frontend request atoms and stale-while-refresh flows.
- Stream primitives are the natural bridge from websocket/SSE event sources into composable Effect pipelines.
