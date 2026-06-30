---
name: effect-ts
description: Build, review, or explain TypeScript applications using Effect, Effect Platform/RPC, effect-atom frontend state, streams, websockets, SSE, fibers, layers, schemas, and chained/dependent async state. Use when the task mentions Effect.ts, Effect, effect-atom, reactive frontend atoms, or the bundled Effect example repo.
---

# Effect.ts Application Skill

Use this skill for TypeScript work that should follow Effect ecosystem patterns rather than ad-hoc promises, global mutable state, or framework-specific side effects.

## Bundled resources

- `assets/building-an-app-with-effect/` — rich example monorepo modeled after `lucas-barake/building-an-app-with-effect`. Prefer it when a user asks for full-stack package layout, client/server/domain/database boundaries, or an app-shaped example.
- `assets/building-an-app-with-effect/packages/reactive-feed-example/` — focused package demonstrating `@effect-atom/atom-react` with dependent async frontend state, websocket events, SSE events, optimistic actions, and general atom composition patterns.
- `references/effect-source/` — locally bundled Effect source excerpts and generated concept index. Start with `references/effect-source/CONCEPT_INDEX.md` before reading source excerpts.
- `references/effect-source/UPSTREAM_FETCH.md` — records the attempted upstream clone commands and fallback used if the complete git clone is not present.

## Workflow

1. Read only the relevant reference first:
   - Frontend atom/reactive state: `references/effect-atom-patterns.md` and the reactive feed package.
   - Effect primitive internals: `references/effect-source/CONCEPT_INDEX.md`, then the specific source excerpt listed there.
   - Full-stack package shape: inspect the bundled app asset package manifests and source.
2. Prefer `Effect.gen`, `Layer`, `Context.Tag`, `Schema`, `Stream`, `Queue`, `PubSub`, `Scope`, and typed errors over raw promises and untyped exceptions.
3. For frontend async chains, model dependencies explicitly: upstream atom value -> request atom -> derived atom -> UI discriminated state.
4. For websocket/SSE, use scoped acquisition and cleanup. Never create long-lived browser connections in render bodies.
5. Keep examples runnable and package-local. If adding dependencies, update the nearest `package.json` only.

## Effect style reminders

- Use `Effect.tryPromise` / `Effect.promise` at async boundaries, then stay in Effect.
- Use `Effect.acquireRelease` for sockets, event sources, subscriptions, timers, and abort controllers.
- Use `Stream.async` or a queue-backed stream for push sources.
- Use `Atom`/`Result` style UI state instead of multiple loose `useState` booleans.
- Keep environmental dependencies in services/layers; do not import concrete clients deep in domain code.
