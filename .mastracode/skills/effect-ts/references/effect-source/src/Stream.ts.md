# Stream.ts excerpt notes

Upstream: `packages/effect/src/Stream.ts`

Use streams for websocket/SSE because they model a typed sequence of values with resource cleanup, interruption, backpressure, transformation, and merging.

Useful areas in the full source:

- Constructors for async/push sources.
- Combinators for `map`, `filterMap`, `merge`, `runForEach`, `take`, retry/reconnect loops.
- Scoped constructors and finalizers for closing sockets/event sources.

Frontend mapping:

- WebSocket `message` events -> decode with `Schema` -> enqueue -> `Stream`.
- EventSource `message` events -> decode with `Schema` -> enqueue -> `Stream`.
- Merge initial fetch stream + live stream to build projections.
