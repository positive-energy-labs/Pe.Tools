# Effect.ts excerpt notes

Upstream: `packages/effect/src/Effect.ts`

Key primitives to inspect in the full source:

- `EffectTypeId` and `Effect.Variance` define the type identity and variance of `Effect<A, E, R>`.
- `Effect.gen` supports generator syntax for linear, typed Effect workflows.
- `Effect.promise` / `Effect.tryPromise` lift async boundaries.
- `cached`, `cachedWithTTL`, `cachedInvalidateWithTTL`, `cachedFunction`, and `once` memoize workflows.
- `Effect.all` combines tuple/record/iterable structures and controls sequencing/concurrency.
- `fork`, `race`, `timeout`, `retry`, and `repeat` are the common async orchestration primitives for chained frontend state.

Frontend mapping:

- Atom read effect => one `Effect` per requested value.
- Atom invalidation => rerun the effect or use a cached/invalidate pair.
- Dependent atom => `Effect.gen` that yields upstream atom values before requesting downstream data.
