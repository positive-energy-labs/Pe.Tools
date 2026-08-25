# 0009 — One Atom registry per app

Date: 2026-08-24. Status: accepted.

## Context

An `AtomRegistry` owns atom values, subscriptions, and idle cleanup. Takeoffs created a registry
inside each route store while the root React tree and route workspace atoms used other registries.
That split one browser app into separate graphs.

The Effect React Suspense implementation keeps a module-level promise map keyed by atom object,
not by `(registry, atom)` (`@effect/atom-react/dist/Hooks.js:221`). The route workspace already
deduplicates one wire for each `(route, stateKey, scope)` coordinate
(`source/pe-tools/apps/web/src/workbench/route-state.tsx:134`). Both behaviors require one graph
for one mounted app.

## Decision

The web app creates one `AtomRegistry` with `defaultIdleTTL: 400` in `src/state/registry.ts` and
provides it at `__root.tsx`. Route composition roots pass that registry into route-store
constructors. A route store is a handle over its atoms, actions, subscriptions, timers, and
inspection surface. Disposing a route store releases only those owned resources. It does not
dispose the app registry.

Atoms remain local to each route-store instance. An `Atom.family` that must deduplicate across
mounts uses a key containing `(route, scope)`. A more specific coordinate can add a state key, as
`route-state.tsx` does.

## Consequences

- React panes, route stores, route workspace families, and atom devtools read one graph.
- Tests pass a fresh registry to each store. Tests own and may dispose that registry.
- Route-store constructors expose registry ownership instead of hiding a second registry.
- A route store cannot tear down another route by disposing shared registry state.
