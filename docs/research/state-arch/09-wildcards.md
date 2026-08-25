# 09 — Wildcards: the "and more" sweep

Research only. No proto was built. This file assesses eight candidates that the
[README](README.md) candidate map does not cover, against the README taxonomy axes and the
[SCENARIO](SCENARIO.md).

Date: 2026-08-24. Versions are the versions on npm on that date.

Clones are under `.explore/`. Citations are `path:line` relative to the clone root. React
citations are against `.explore/react` at commit `3d05080` (2026-08-24).

| # | Candidate | Version | Clone / source |
|---|---|---|---|
| A | valtio | 2.3.2 | `.explore/valtio` @ `4689e79` |
| B | @preact/signals-react + signals-core | 3.12.0 / 1.14.4 | `.explore/preact-signals` @ `1e3ab34` |
| C | mobx + mobx-react-lite | 7.0.3 / 5.0.3 | `.explore/mobx` @ `01211a6` |
| D | nanostores + async/query/router/persistent | 1.5.2 / 0.1.0 / 0.3.4 / 1.1.0 / 1.3.5 | `.explore/nanostores` @ `400cbb3` |
| E | @xstate/store atom API | 4.2.3 | `.explore/xstate` @ `d798af5` |
| F | @solidjs/signals (Solid 2.0 reactive core) | 2.0.0-rc.0 | npm tarball; repo `solidjs/solid` |
| G | plain React 19 + hand-rolled `asyncCompute` | react 19.2.8 | `.explore/react` @ `3d05080` |
| H | effect v4 `unstable/reactivity` (effect-smol) | 4.0.0-beta.107 | `.explore/effect-smol` @ `3a1128c` |

`@solid-primitives/*` is SolidJS-only. It has no React binding. Per the mission it is skipped.
Slot F is filled by `@solidjs/signals`, which is the same reactive core, released as a
framework-agnostic package.

---

## 0. Three cross-cutting findings

Read these before the candidate rows. All three change how the other reports must be read.

### F1 — effect v4 ships Atom in core. The 02 candidate-map row is out of date.

The `effect-smol` repository is **archived and read-only**. Effect V4 moved to
`Effect-TS/effect` `main` (`.explore/effect-smol/README.md:1-12`).

Effect v4 does contain a reactive primitive. It is not a plan and not a proposal. It is
6 281 lines of shipped code at `packages/effect/src/unstable/reactivity/`:

| File | Lines | Content |
|---|---|---|
| `Atom.ts` | 2 523 | the atom graph and 60+ combinators |
| `AtomRegistry.ts` | 1 118 | the registry, batching, lifetimes |
| `AsyncResult.ts` | 1 081 | the `Result` sum type |
| `AtomHttpApi.ts` | 354 | atoms from an HttpApi client |
| `AtomRef.ts` | 352 | refs |
| `Reactivity.ts` | 348 | key-based invalidation service |
| `AtomRpc.ts` | 305 | atoms from an RPC client |
| `Hydration.ts` | 155 | SSR hydration |

Framework bindings are separate packages in the same repo: `@effect/atom-react`,
`@effect/atom-solid`, `@effect/atom-vue`, all at `4.0.0-beta.98`
(`.explore/effect-smol/packages/atom/react/package.json`). `@effect/atom-react@4.0.0-beta.107`
is on npm, and this repo already depends on it
(`source/pe-tools/apps/web/package.json`).

The scenario's whole state-kind table has a native primitive:

| Scenario need | Atom primitive | Cite (`packages/effect/src/unstable/reactivity/Atom.ts`) |
|---|---|---|
| URL bindings | `Atom.searchParam` with a `Schema` | `:2172` |
| Persisted recents, widths | `Atom.kvs`, sync or async | `:2107` |
| Stale-while-revalidate | `Atom.swr` | `:1760` |
| Staged edit and adopt | `Atom.optimistic`, `Atom.optimisticFn` | `:1855`, `:1958` |
| Per-zone atom | `Atom.family` with `WeakRef` + `FinalizationRegistry` | `:1343` |
| Route lifetime | `keepAlive`, `autoDispose`, `setIdleTTL` | `:1466`, `:1482`, `:212` |
| Hover at 60 fps | `Atom.debounce`, `Atom.batch` | `:1693`, `:2025` |
| Push `docChanged` | `Atom.withReactivity` + `Reactivity.ts` | `:807` |
| Refresh zones | `Atom.refresh`, `Atom.withRefresh` | `:2367`, `:1731` |
| Verb progress | `Atom.pull` returns a `PullResult` | `:1244`, `:1233` |
| Waterfall across `await` | `get.result(atom)` returns an `Effect`, so the graph tracks the whole generator body | `:161-166` |

`Atom.ts:161` is the direct answer to W1. `get.result` gives an `Effect`, not a promise. The
dependency graph tracks the full generator body, not a synchronous prefix.

**Stability.** `effect/unstable/*` modules "may receive breaking changes in minor releases,
while modules outside `unstable/` follow strict semver"
(`.explore/effect-smol/MIGRATION.md:42-44`). `reactivity` is on that list
(`MIGRATION.md:46-48`). Graduation to `effect/*` is the stated path (`MIGRATION.md:50`).

**Action.** This belongs to report 02 and the 08 synthesis, not to 09. The README row
"effect-atom — native, but v3 today?" is answered: v4 native, in core, `unstable`.

### F2 — `useSyncExternalStore` updates are always `SyncLane`. `useTransition` cannot defer them.

React source, `.explore/react/packages/react-reconciler/src/ReactFiberHooks.js`:

```js
// :1893-1895
if (checkIfSnapshotChanged(inst)) {
  startUpdateTimerByLane(SyncLane, 'updateSyncExternalStore()', fiber);
  forceStoreRerender(fiber);
}
// :1913-1917
function forceStoreRerender(fiber: Fiber) {
  const root = enqueueConcurrentRenderForLane(fiber, SyncLane);
  ...
}
```

Any state read through `useSyncExternalStore` re-renders at `SyncLane`. A `startTransition`
around the write does not lower that priority. The scenario requires `useTransition` for the
binding pick so the sentence stays responsive. That requirement is defeated for every
candidate whose React binding is `useSyncExternalStore`.

| Candidate | React binding | Transition-friendly |
|---|---|---|
| valtio | `useSyncExternalStore` (`src/react.ts:131`) | no |
| @preact/signals-react | `useSyncExternalStore` shim (`packages/react/runtime/src/index.ts:20`) | no |
| mobx-react-lite | `useSyncExternalStore` (`packages/mobx-react-lite/src/useObserver.ts:101`) | no |
| nanostores/react | `useSyncExternalStore` (`@nanostores/react` `index.js:29`) | no |
| @xstate/store react | `useSyncExternalStore` (`packages/xstate-store-react/src/index.ts:169,178`) | no |
| jotai | `useReducer` (`.explore/jotai/src/react/useAtomValue.ts:126`) | **yes** |
| @effect/atom-react | mixed: `useSyncExternalStore` (`Hooks.ts:57`) and `useState` (`Hooks.ts:427`) | partial |

jotai's choice of `useReducer` over `useSyncExternalStore` is deliberate, and it is the reason
jotai supports transitions. This is a real axis, not a detail. Add it to the README taxonomy.

### F3 — Activity `hidden` unmounts effects, so external-store subscriptions stop.

`<Activity>` is stable in React 19.2. `hidden` "hides the children, unmounts effects, and
defers all updates until React has nothing left to work on"
([react.dev/blog/2025/10/01/react-19-2](https://react.dev/blog/2025/10/01/react-19-2)).
The reference page says React "will also destroy their Effects, cleaning up any active
subscriptions" ([react.dev/reference/react/Activity](https://react.dev/reference/react/Activity)).

The source agrees. `useSyncExternalStore` subscribes inside a passive effect:

```js
// ReactFiberHooks.js:1721
mountEffect(subscribeToStore.bind(null, fiber, inst, subscribe), [subscribe]);
```

Hiding an Activity clears `OffscreenPassiveEffectsConnected` and unmounts the passive effects
of the subtree (`ReactFiberCommitWork.js:5307-5313`, which calls
`recursivelyTraverseDisconnectPassiveEffects` → `commitHookPassiveUnmountEffects` at `:5297`).

**Answer to the mission question: no. Subscriptions in a hidden Activity do not keep firing.**
The `subscribe` cleanup runs. The cost while hidden is zero.

React closes the correctness hole on reveal. The store-instance effect re-runs and re-checks
the snapshot:

```js
// ReactFiberHooks.js:1871-1881
// Something may have been mutated in between render and commit. ...
// time. This effect also re-runs when a hidden Activity tree is revealed.
if (checkIfSnapshotChanged(inst)) {
  forceStoreRerender(fiber);
}
```

Consequence for the scenario's hidden Plan pane:

| Property | Result |
|---|---|
| React state | preserved |
| DOM state | preserved (`display: none`) |
| Store subscription | unsubscribed while hidden |
| Store writes while hidden | not observed |
| On reveal | snapshot re-read, one forced re-render if it changed |
| Push `docChanged` while hidden | not seen by the pane; seen on reveal only if the snapshot value differs |
| Library graph outside React | keeps computing; only the React re-render stops |

The last row is the trap. valtio, signals, mobx, nanostores and solid signals all run their
graph outside React. Hiding the Plan pane stops its React renders. It does not stop the
subscriptions those libraries hold inside their own graph, and it does not stop a hidden pane's
`asyncCompute` from re-fetching. Only the React binding sleeps.

---

## 1. Shared table — README taxonomy axes

### Table A — model

| Candidate | Reactivity model | Async ownership | Cache semantics | Composition unit | Dependency tracking |
|---|---|---|---|---|---|
| A valtio | push, proxy + `proxy-compare` per-hook `affected` | none built in; promise as a proxy value + React `use()` | none | one proxy tree | auto, per accessed path |
| B signals-react | push, fine-grained signals | none built in; hand-rolled `asyncCompute` | none | `createModel` factory = one disposable object | auto, **stops at first `await`** |
| C mobx | push, observable + reaction | `flow` generators; no async derived | none (`mobx-utils` is mobx 6 only) | one observable class | auto, **stops at first `await`** |
| D nanostores | push, atom graph | `@nanostores/async` `computedAsync`; `@nanostores/query` fetcher stores | full in `query`, none in `async` | many small stores | **explicit deps** (array argument) |
| E @xstate/store atoms | push, vendored alien-signals | `createAsyncAtom` | none | store + free atoms | auto, **stops at first `await`** |
| F @solidjs/signals | push-pull hybrid, microtask flush | async memos, `action`, `createOptimistic` | `refresh()` invalidation, no keyed cache | `createRoot` owner tree | auto, **complete** (see §7) |
| G plain React 19 | pull, `useSyncExternalStore` | you write it | you write it | one hand-rolled object | manual (`use()` needs a stable promise) |
| H effect v4 atoms | atoms (graph) | store-owned, Effect fibers | `swr`, `family`, `Reactivity` keys | atoms + `AtomRegistry` | auto, **complete across `Effect.gen`** |

### Table B — surfaces and risk

| Candidate | Fixture seam | URL state | Persistence | Suspense / Activity | Devtools | Effect v4 affinity | Maintenance risk |
|---|---|---|---|---|---|---|---|
| A valtio | module mock, or a `host` field on the proxy | none | `subscribe` + hand-rolled | `use()` on a promise field; "de-opt" blocks `useTransition` | redux bridge (`src/vanilla/utils/devtools.ts`) | neutral | pmndrs; core stable, satellites stale |
| B signals-react | constructor argument on `createModel` | none | hand-rolled | none native | `@preact/signals-debug` 1.5.0 + `devtools-ui` + vite plugin | neutral | preact core team; active |
| C mobx | constructor argument | none | `mobx-persist-store` (third party) | none native | mobx-devtools, `spy`, `trace` | neutral | mobx 7 active; `mobx-utils` **stuck on mobx ^6** |
| D nanostores | `useTestStorageEngine`, `allTasks()` | `@nanostores/router` **owns routing** — conflicts with TanStack Router | `@nanostores/persistent` 1.3.5, good | none native | none | neutral | Sitnik; core active, `@nanostores/async` is 0.1.0 |
| E @xstate/store atoms | store input / atom config | none | hand-rolled | none native | Stately inspect (store only, not atoms) | neutral | Stately; active |
| F @solidjs/signals | `createRoot` closure argument | none | hand-rolled | `createLoadingBoundary`, `createErrorBoundary` — its own, not React's | none | neutral | **rc.0**; breaking changes stated |
| G plain React 19 | DI at module init | TanStack Router `validateSearch` | hand-rolled | native, and it is the point | none | neutral | none — it is React |
| H effect v4 atoms | `Layer` swap at the `AtomRuntime` | `Atom.searchParam` + `Schema` | `Atom.kvs` | `useAtomSuspense`; mixed uSES / `useState` | `@effect/atom` devtools (basic) | **native** | `unstable/*`; minor-version breaks allowed |

---

## 2. A — valtio 2.3.2

Valtio gives one importable proxy object and per-path auto-tracking, which is exactly the
"one centralized object" want, and `useSnapshot` re-renders only the components that read a
changed path (`src/react.ts:119-140`). Everything past that is a problem for this scenario.
Valtio 2 has no derived primitive: `watch` is marked `@deprecated ... Please migrate to
valtio-reactive` (`src/vanilla/utils/watch.ts:19`), `derive` moved to `derive-valtio` which
last shipped 0.2.0 in 2024, and `valtio-reactive` is 0.2.0 from January 2026. What remains is
plain object getters, and the docs warn that "a computed property should only reference
**sibling** properties, otherwise you'll encounter weird bugs"
(`docs/guides/computed-properties.mdx:52`) and that getters on the proxy are "not cached, and
will be re-calculated on every call" (`:44`). Async is a promise stored as a proxy field and
unwrapped with React 19 `use()` (`docs/guides/async.mdx:32-49`) — but valtio does not proxy
promises at all (`src/vanilla.ts:76`), so a promise field is opaque, and there is no loading,
error, stale or fixture state, only Suspense. The same guide states the fatal one: "It still
suffers from 'de-opt', which prevents `useTransition` to work well"
(`docs/guides/async.mdx:51`), and points at a third-party mitigation, `use-valtio`. The
scenario needs a `Feed` sum type with five states, a `stale` producer, and `useTransition` on
the binding pick. Valtio supplies none of the three.

```ts
// 20-line sketch — valtio. Waterfall + stale-after-write.
import { proxy } from "valtio";
let host = liveHost;                                     // 1-line fixture swap: host = fixtureHost
export const s = proxy({
  session: null as string | null, doc: null as Promise<Doc> | null,
  view: null as string | null, zones: null as Promise<Zone[]> | null,
  zonesStale: false, hover: null as string | null,       // hover = page memory, not URL
});
export const pickSession = (id: string) => {             // R2 clear-descendants is MANUAL
  s.session = id; s.view = null; s.zones = null;         // no declarative link graph
  s.doc = host.activeDoc(id);                            // promise stored as a field
};
export const pickView = (v: string) => { s.view = v; s.zones = readZones(); };
const readZones = async () => {                          // no dedup, no abort, no retry
  const d = await s.doc!; s.zonesStale = false;
  return host.listZones(s.session!, d.id, s.view!);
};
export const adopt = async (ids: string[]) => {
  await host.adoptZones(s.session!, (await s.doc!).id, ids);
  s.zonesStale = true; s.zones = readZones();            // stale flag is hand-maintained
};
// view: const snap = useSnapshot(s); const zones = use(snap.zones!);   // Suspense only, no `stale`
```

**Verdict: no proto.** Three independent blockers, each fatal on its own: no maintained derived
primitive, a `useTransition` de-opt on the exact interaction the scenario measures, and no
async state model beyond a raw promise. Steal nothing. jotai and effect atoms give the same
fine-grained tracking with an async model attached.

---

## 3. B — @preact/signals-react 3.12.0 + signals-core 1.14.4

This is the qr-repo pattern ported to React, with two of its worst bugs fixed at the library
level. `signals-core` gained `createModel(fn)`: a factory for "disposable model instances that
group signals, computed values, and actions together", where "effects created while
constructing the model are captured and disposed when you call `model[Symbol.dispose]()`"
(`packages/core/README.md:257-289`). `@preact/signals-react` adds `useModel`, which creates
"a model instance once per component and automatically dispose[s] it when the component
unmounts" (`packages/react/README.md:106-125`). Those two lines close
[01](01-qr-repo-pattern.md) W6 (`new State()` in the render body) and W7 (nothing is ever
disposed), which are the pattern's only structural leaks. React 19 is a declared peer,
`"react": "^16.14.0 || 17.x || 18.x || 19.x"` (`packages/react/package.json:71`), and there is
now a real devtools story: `@preact/signals-debug` 1.5.0, a `devtools-ui` panel, and a
`@preact/signals-agent-vite` plugin that auto-injects it. What did **not** change:
`signals-core` exports exactly `computed, effect, batch, untracked, action, createModel,
Signal, ReadonlySignal, Effect, Computed` (`packages/core/src/index.ts:1127-1138`). There is no
async primitive. `asyncCompute` and `awaitAsync` are still yours to write, so W1 through W5 and
W8 through W15 stay open unless you fix them. The React binding uses the
`useSyncExternalStore` shim (`packages/react/runtime/src/index.ts:20`), so F2 applies and the
binding pick cannot be a transition.

```ts
// 20-line sketch — signals-react + createModel. Waterfall + stale-after-write.
import { computed, signal, createModel } from "@preact/signals-react";
import { asyncCompute, awaitAsync } from "./async";       // ~200 lines you still write
export const Route = createModel((host: Host) => {        // 1-line fixture swap: new Route(fixtureHost)
  const session = signal<string | null>(null);
  const view    = signal<string | null>(null);
  const zonesEpoch = signal(0);                           // the `stale` producer, hand-made
  const doc = asyncCompute(async () => {
    const id = session.value;                             // tracked: read BEFORE the await
    return id ? host.activeDoc(id) : null;
  });
  const zones = asyncCompute(async () => {
    zonesEpoch.value;                                     // must be read pre-await, or W1 bites
    const d = await awaitAsync(doc);                      // waterfall edge, reads as straight-line code
    const v = view.peek();                                // W1: a post-await read is UNTRACKED
    return d && v ? host.listZones(session.peek()!, d.id, v) : [];
  });
  return {
    session, view, doc, zones,
    pickSession(id: string) { session.value = id; view.value = null; },            // R2 manual
    async adopt(ids: string[]) { await host.adoptZones(...); zonesEpoch.value++; },// stale -> re-read
  };                                                      // createModel supplies [Symbol.dispose]
});
```

**Verdict: yes, one proto — as the control arm.** It is the author's own pattern, honestly
ported, with W6 and W7 fixed for free. It is the only candidate that measures "how much does
the shape you already like actually cost in React 19". Budget it as the *cheapest* proto and
scope it tight: the deliverable is the 200-line `asyncCompute` that fixes W1 with an explicit
`get()`, which merges this arm with candidate G. Expect it to lose on F2 and on the absence of
a cache, and expect `createModel` to be the thing 08 steals.

---

## 4. C — mobx 7.0.3 + mobx-react-lite 5.0.3

MobX is the oldest and most complete answer to "one importable object that owns its own
reactivity", and mobx 7 is current — both packages published 2026-08-19 — with React 18 and 19
as declared peers (`packages/mobx-react-lite/package.json`) and `observer` built on
`useSyncExternalStore` (`packages/mobx-react-lite/src/useObserver.ts:101`). The blocker is the
async layer. MobX has never had an async derived primitive. `computed` must be synchronous, and
async work goes through `flow` generators that write back into observables by hand. The
canonical fix for that is `mobx-utils`' `fromPromise`, which is exactly the `AsyncState` sum
type the scenario needs — and `mobx-utils` is at 6.1.1 with
`peerDependencies: { mobx: "^6.0.0" }`, so it does not support mobx 7. That leaves the whole
async waterfall, freshness, cancellation, dedup and invalidation surface hand-written, on top
of a 14.8 kB gzip core, with no URL primitive and no persistence primitive. MobX's own React
guide also warns off local observable state because "this can theoretically lock you out of
some features of React's Suspense mechanism"
([mobx.js.org/react-integration.html](https://mobx.js.org/react-integration.html)), and the
scenario requires per-pane Suspense. Nothing here is worse than qr-repo, and several things are
better (`reaction`, `when`, `trace`, real devtools), but nothing is better than what jotai,
TanStack or effect atoms already give.

```ts
// 20-line sketch — mobx. Waterfall + stale-after-write.
import { makeAutoObservable, flow, reaction, runInAction } from "mobx";
export class RouteStore {
  session: string | null = null; view: string | null = null;
  doc: Doc | null = null; zones: Zone[] = []; zonesState: FeedState = "loading";
  constructor(private host: Host) {              // 1-line fixture swap: new RouteStore(fixtureHost)
    makeAutoObservable(this, {}, { autoBind: true });
    reaction(() => this.session, () => { this.view = null; this.loadDoc(); });  // R2 via reaction
    reaction(() => [this.doc?.id, this.view], () => this.loadZones());          // waterfall = 2 reactions
  }
  loadDoc = flow(function* (this: RouteStore) {  // `flow`, not a derived value
    this.doc = yield this.host.activeDoc(this.session!);
  }).bind(this);
  loadZones = flow(function* (this: RouteStore) {
    if (!this.doc || !this.view) return;
    this.zonesState = "loading";                 // no keep-previous unless you code it
    this.zones = yield this.host.listZones(this.session!, this.doc.id, this.view);
    this.zonesState = "fresh";
  }).bind(this);
  async adopt(ids: string[]) {
    await this.host.adoptZones(this.session!, this.doc!.id, ids);
    runInAction(() => { this.zonesState = "stale"; }); await this.loadZones();
  }
}
```

**Verdict: no proto.** The one thing that would make MobX competitive — `fromPromise` — is
locked to mobx 6. Everything else is a larger, older restatement of what jotai and effect atoms
do with an async model included. Steal one idea: `reaction(expr, effect)` splits tracking from
side effect. That is the shape `@solidjs/signals` `createEffect` also uses, and it is what
qr-repo's constructor `effect`s (W12) badly need.

---

## 5. D — nanostores 1.5.2 (+ async / query / router / persistent)

Nanostores is the smallest credible candidate at 2.2 kB gzip, and its satellites map onto the
scenario's state-kind table almost one for one. `@nanostores/persistent` 1.3.5 gives
`persistentMap`, cross-tab sync by default, and a `useTestStorageEngine()` fake for tests —
the best persistence-plus-fixture story in this sweep. `@nanostores/async` 0.1.0 gives
`computedAsync`, whose value is an explicit state machine — `{state:'loading'}`,
`{state:'ready', changing:false|true, value}`, `{state:'failed', error}` — with the previous
value held while `changing` is true. That is `Feed` with a real stale-while-revalidate, and
because deps are declared as the first argument, W1 is structurally impossible. Cascading is
first class: "if any input is `'loading'`, the derived store stays loading; if any input fails,
the derived store inherits the error from the leftmost failed input", with values
auto-unwrapped. Three things break it here. First, `@nanostores/async` has no `AbortSignal`
and no `refresh` or `invalidate`, so `Refresh zones` and the adopt→stale→re-read cycle have no
primitive; the fix is `@nanostores/query` 0.3.4, which does have `invalidateKeys`,
`revalidateKeys` and `mutateCache` — but that is a **second, key-based async world** beside the
first, and the route would carry both. Second, `@nanostores/router` owns routing; this app is
on TanStack Router, so the URL binding seam is hand-rolled either way. Third, `computed`'s
async overloads in core are already `@deprecated` in favour of `@nanostores/async`
(`computed/index.d.ts:11,17`), which means the async story moved once in the last year and
sits at 0.1.0.

```ts
// 20-line sketch — nanostores + @nanostores/async. Waterfall + stale-after-write.
import { atom } from "nanostores";
import { computedAsync } from "@nanostores/async";
import { persistentMap } from "@nanostores/persistent";
export let host = liveHost;                             // 1-line fixture swap: host = fixtureHost
export const $session = atom<string | null>(null);
export const $view    = atom<string | null>(null);
export const $epoch   = atom(0);                        // the `stale` producer; no refresh() exists
export const $recents = persistentMap("takeoff:", { dirs: "" });   // persisted, cross-tab, testable
export const $doc = computedAsync($session, id => id ? host.activeDoc(id) : null);
export const $zones = computedAsync(                    // deps EXPLICIT -> W1 cannot happen
  [$doc, $view, $session, $epoch],                      // cascading: $doc auto-unwrapped to Doc
  (doc, view, session) => doc && view ? host.listZones(session!, doc.id, view) : [],
);                                                      // while re-running: {state:'ready',changing:true}
export const pickSession = (id: string) => { $session.set(id); $view.set(null); };  // R2 manual
export const adopt = async (ids: string[]) => {
  await host.adoptZones($session.get()!, unwrap($doc).id, ids);
  $epoch.set($epoch.get() + 1);                         // stale -> cascade re-runs, holds old zones
};
// view: const z = useStore($zones);  z.state === "ready" && z.changing  =>  FeedState "stale"
// no AbortSignal anywhere; adopt-in-flight plus rapid picks leave orphaned listZones calls
```

**Verdict: no proto.** Two async worlds (`async` plus `query`) for one route, a router that
cannot be adopted, no cancellation, and a 0.1.0 async package. But steal the model:
`{state:'ready', changing:true, value}` answers open question **Q2** ("should `FeedState` keep
`stale`") and **Q3** ("is a background refetch `loading` or `fresh`") in one shape — the answer
is that `changing` is orthogonal to `state`, not a fifth member of it. Recommend that 08 apply
that to `targeting/model.ts` `FeedState` regardless of which library wins.

---

## 6. E — @xstate/store 4.2.3 atom API

`@xstate/store` now ships a standalone atom graph beside its event and transition store:
`createAtom`, `createAsyncAtom`, `createReducerAtom`, `createAtomConfig`
(`packages/xstate-store/src/index.ts:4-10`), built on a vendored alien-signals reactive system
(`packages/xstate-store/src/atom.ts:1-5`), zero runtime dependencies, ~3.4 kB gzip, React 18
and 19 peers. `createAsyncAtom` is a near-exact reimplementation of qr-repo's `asyncCompute`.
It returns `AsyncAtomState<Data,Error> = {status:'pending'} | {status:'done';data} |
{status:'error';error}` (`atom.ts:66-69`), it aborts the previous run when it recomputes, and
it drops stale resolutions by run id (`atom.ts:104-127`). It fixes qr-repo W3, and it fixes it
properly: the getter receives a real `AbortSignal` — "Signal aborted when the async atom
recomputes before this run settles" (`atom.ts:72-75`) — which qr-repo never threaded to the
network. It inherits everything else. Tracking is the synchronous prefix of the getter, so W1
is intact. `return { status: 'pending' }` on every recompute (`atom.ts:127`) means no
keep-previous-data, so W2 is intact. There is no key, no cache, no dedup, no retry, no
`refresh`, no invalidation API and no dependent-async helper, so a waterfall is a manual status
check on the upstream atom's `AsyncAtomState` — which is the `enabled:` config shape that
[01](01-qr-repo-pattern.md) R4 explicitly rejects. Stately's inspector covers the store, not
the atoms.

```ts
// 20-line sketch — @xstate/store atoms. Waterfall + stale-after-write.
import { createAtom, createAsyncAtom } from "@xstate/store";
export let host = liveHost;                             // 1-line fixture swap: host = fixtureHost
export const session = createAtom<string | null>(null);
export const view    = createAtom<string | null>(null);
export const epoch   = createAtom(0);                   // the `stale` producer; no refresh() exists
export const doc = createAsyncAtom(async ({ signal }) => {
  const id = session.get();                             // tracked (synchronous prefix)
  return id ? host.activeDoc(id, { signal }) : null;    // real AbortSignal -> fixes qr-repo W3
});
export const zones = createAsyncAtom(async ({ signal }) => {
  epoch.get(); const v = view.get(); const s = session.get();  // ALL reads must precede the await
  const d = doc.get();                                  // AsyncAtomState, NOT the value
  if (d.status !== "done" || !d.data || !v) return [];   // waterfall = manual status check (anti-R4)
  return host.listZones(s!, d.data.id, v, { signal });   // recompute flashes to 'pending' (W2)
});
export const pickSession = (id: string) => { session.set(id); view.set(null); };  // R2 manual
export const adopt = async (ids: string[]) => {
  await host.adoptZones(session.get()!, docId(), ids);
  epoch.set(epoch.get() + 1);                           // stale -> zones flashes pending, no old data
};
```

**Verdict: no proto.** It is qr-repo's `asyncCompute` with W1 and W2 unfixed, minus the
`awaitAsync` ergonomics that made qr-repo pleasant, plus a cache layer that does not exist.
Report 07 already covers `@xstate/store`'s event half; the atom half adds nothing that changes
that verdict. Steal exactly one line: `AsyncAtomOptions { signal: AbortSignal }` passed into
the getter, `atom.ts:72-75`. That is the right shape for [01](01-qr-repo-pattern.md) R12, and
any hand-rolled `asyncCompute` must copy it verbatim.

---

## 7. F — @solidjs/signals 2.0.0-rc.0

This is the strongest wildcard, and it is the only candidate in this sweep that solves W1
structurally instead of asking you to be careful. `@solidjs/signals` is the reactive core of
SolidJS 2.0, published as a standalone framework-agnostic package with "first-class support for
async, transitions, optimistic updates, and deeply reactive stores". It needs no Solid
renderer, only `createRoot`, `createEffect` and `flush`. Async memos are ordinary memos —
`createMemo(async () => ...)`, a peer of the sync form, which is
[01](01-qr-repo-pattern.md) R1 exactly. The waterfall is not `await otherState`. Reading an
unresolved async memo **throws a `NotReadyError`** from the synchronous read path
(`dist/dev.js:2144-2146`), the graph registers the dependency, and the memo body re-runs from
the top when the upstream settles. Every read therefore happens in the tracked synchronous
prefix, and W1 cannot occur. This is the same mechanism as React's `use()`, moved inside the
reactive graph. W2 is closed by design: "previous values are held in place until the async work
resolves, so downstream consumers never see an inconsistent state", surfaced as `isPending()`
and `latest()`. W6 and W7 are closed by the owner tree (`createRoot(dispose => ...)`,
`onCleanup`). On top of that it ships `refresh(target)` for invalidation "without tearing the
consumer down", `createOptimistic` and `createOptimisticStore` for staged edits that revert on
failure, `createProjection` for derived stores, `createLoadingBoundary` and
`createErrorBoundary`, `createStore` with `reconcile`, and `action()` for transactional writes
that span an async gap. That list is the scenario's staging table, adopt verb and feed model,
pre-built. The costs are real: it is `2.0.0-rc.0` with "breaking changes before a final
release" stated in the README; there is no React binding, so the bridge is yours (`createRoot`
plus `createEffect` plus `useSyncExternalStore`, about 20 lines, and F2 then applies); its
loading and error boundaries are its own, not React's, so a per-pane React `<Suspense>` needs
`NotReadyError` translated into a thrown thenable; and there are no devtools.

```ts
// 20-line sketch — @solidjs/signals. Waterfall + stale-after-write.
import { createRoot, createSignal, createMemo, createOptimistic, refresh, isPending, latest } from "@solidjs/signals";
export const route = createRoot(() => {                 // owner tree: dispose closes W6 + W7
  let host = liveHost;                                  // 1-line fixture swap: host = fixtureHost
  const [session, setSession] = createSignal<string | null>(null);
  const [view, setView]       = createSignal<string | null>(null);
  const doc   = createMemo(async () => { const id = session(); return id ? host.activeDoc(id) : null; });
  const zones = createMemo(async () => {
    const d = doc();                                    // UNRESOLVED -> throws NotReadyError, memo retries
    const v = view(), s = session();                    // so EVERY read stays in the tracked prefix (no W1)
    return d && v ? host.listZones(s!, d.id, v) : [];   // old value held while re-running (no W2)
  });
  const [staged, setStaged] = createOptimistic<Rename[]>([]);   // reverts if adopt fails
  return {
    session, view, doc, zones, staged,
    feed: () => isPending(zones) ? (latest(zones) ? "stale" : "loading") : "fresh",  // Q2 + Q3 answered
    pickSession(id: string) { setSession(id); setView(null); },                      // R2 manual
    async adopt(ids: string[]) { setStaged(s => s); await host.adoptZones(session()!, ids);
      refresh(zones); },                                // stale -> re-read, consumer never torn down
  };
});
```

**Verdict: yes, proto it — highest value in this sweep.** It is the only candidate that answers
R1–R5, R11, R12 and R13 from [01 §6](01-qr-repo-pattern.md) with library primitives instead of
a hand-rolled helper, and it does it in the exact shape the author already writes. Scope the
proto to answer three questions and nothing else: (1) does the React bridge tear or lag with
500 zones across three panes, (2) can `NotReadyError` be translated into a React `<Suspense>`
thenable cleanly, (3) how bad is `rc.0` churn over the next quarter. If it wins on those, it
beats candidate B outright, because it is candidate B with the missing 200 lines already
written and already correct. If `rc.0` risk is disqualifying, its primitives are still the
specification that 08 should hold every other candidate against.

---

## 8. G — plain React 19 + a hand-rolled `asyncCompute`

The brief for this arm was `use()` plus `cache()` plus Suspense plus `useSyncExternalStore`
plus about 200 lines fixing W1 with an explicit `get()`. Two of those five do not hold.
`cache()` "is for use in Server Components only", and "React will invalidate the cache for all
memoized functions for each server request"
([react.dev/reference/react/cache](https://react.dev/reference/react/cache)). This route is a
client SPA on TanStack Router, so `cache()` is unavailable, and the docs add that calling a
memoized function outside a component does not read or update the cache at all. `use()` then
has a hard prerequisite: "Promises passed to `use` must be cached so the same Promise instance
is reused across re-renders. If a new Promise is created directly in render, React will display
the Suspense fallback on every re-render"
([react.dev/reference/react/use](https://react.dev/reference/react/use)). The docs' own
recommendation is "a simple module-level cache" or "a Suspense-enabled data source". So the
arm's real content is: build a module-level keyed promise cache. That is a query cache. Adding
W1's fix (an explicit `get()` threaded through the async body), plus keep-previous-data (W2),
`AbortSignal` (W3), dedup and keys (W4, W15), retries (W5), disposal (W6, W7) and a `stale`
producer converges on a worse `@tanstack/react-query` — which report 03 already covers, and
which is already a dependency. The one genuine win is F2: state held in `useState` or
`useReducer`, and in TanStack Router search params, **is** transition-friendly, and every
external-store candidate in this sweep is not.

```ts
// 20-line sketch — plain React 19. Waterfall + stale-after-write.
export let host = liveHost;                             // 1-line fixture swap: host = fixtureHost
const cache = new Map<string, { p: Promise<any>; epoch: number }>();   // cache() is SERVER-ONLY
export const read = <T,>(key: string, epoch: number, run: (s: AbortSignal) => Promise<T>) => {
  const hit = cache.get(key);                           // module-level: use() needs a STABLE promise
  if (hit && hit.epoch === epoch) return hit.p as Promise<T>;
  const ac = new AbortController(); const p = run(ac.signal);
  cache.set(key, { p, epoch }); return p;                // no dedup window, no retry, no gc, no keep-previous
};
export const store = { epoch: 0, subs: new Set<() => void>() };
export const bump = () => { store.epoch++; store.subs.forEach(f => f()); };  // the `stale` producer
// bindings live in TanStack Router search -> transition-friendly, unlike any store (F2)
function Zones({ session, docId, view }: Props) {
  const epoch = useSyncExternalStore(sub, () => store.epoch);          // F2: this read is SyncLane
  const zones = use(read(`zones|${session}|${docId}|${view}`, epoch,
    s => host.listZones(session, docId, view, s)));
  return <ZoneList zones={zones} />;                    // errors need an ErrorBoundary; use() cannot try/catch
}
// waterfall = nested Suspense boundaries; each pane blocks on its own parent's resolved value
const adopt = async (ids: string[]) => { await host.adoptZones(session, docId, ids); bump(); };
// bump() invalidates by epoch -> every keyed read re-runs -> full fallback flash (no keep-previous)
// still owed: keep-previous, dedup, retry, gc, per-key stale, error-vs-empty, devtools
```

**Verdict: no proto — but keep two findings.** The arm collapses into "reimplement TanStack
Query, badly", and the honest comparison already exists as report 03. Record instead: (1)
`cache()` is server-only, which removes it from every future client-route design in this repo;
(2) `useTransition` works on router search state and on React state, and does not work on any
`useSyncExternalStore`-backed store (F2). That means the scenario's "bindings live in the URL"
requirement and its "`useTransition` on the binding pick" requirement are the same requirement,
and any candidate that moves bindings into a store loses the second one.

---

## 9. H — effect v4 `unstable/reactivity`

Covered in full at [F1](#f1--effect-v4-ships-atom-in-core-the-02-candidate-map-row-is-out-of-date).
Summary for the table: the reactive primitive exists, it is in `effect` core under
`unstable/reactivity`, it is 6 281 lines, it has React, Solid and Vue bindings at
`4.0.0-beta.98` in the same repo, and it covers URL, persistence, SWR, optimistic updates,
families, lifetimes, push invalidation and typed failures with named combinators.
`get.result` returns an `Effect`, so dependency tracking covers the whole `Effect.gen` body and
W1 does not exist. The cost is the `unstable` contract: breaking changes are permitted in minor
releases (`.explore/effect-smol/MIGRATION.md:42-44`).

```ts
// 20-line sketch — effect v4 atoms. Waterfall + stale-after-write.
import { Atom, Reactivity } from "effect/unstable/reactivity";
import { Effect } from "effect";
const runtime = Atom.runtime(HostLive);                 // 1-line fixture swap: Atom.runtime(HostFixture)
export const session = Atom.searchParam("session", { schema: SessionId });  // URL, typed, shareable
export const view    = Atom.searchParam("view",    { schema: ViewId });
export const recents = Atom.kvs({ key: "takeoff:recents", schema: Recents, defaultValue: () => [] });
export const doc = runtime.atom(Effect.fnUntraced(function* (get) {
  const s = yield* get.result(session);                 // tracked ACROSS the whole generator (no W1)
  return yield* Host.activeDoc(s);
}));
export const zones = runtime.atom(Effect.fnUntraced(function* (get) {
  const d = yield* get.result(doc);                     // straight-line waterfall, no `enabled:` config
  const v = yield* get.result(view);
  return yield* Host.listZones(d.sessionId, d.id, v);   // interruption is free: the fiber cancels
})).pipe(Atom.swr, Atom.withReactivity(["zones"]));      // swr holds previous while re-reading = `stale`
export const adopt = runtime.fn(Effect.fnUntraced(function* (ids: ReadonlyArray<ZoneId>) {
  const r = yield* Host.adoptZones(ids);                // AsyncResult carries typed failure + waiting
  yield* Reactivity.invalidate(["zones"]);              // the write declares what it invalidates (R4)
  return r;
}));
// view: Result.builder(useAtomValue(zones)).onWaiting(...).onFailure(...).onSuccess(...)
```

**Verdict: yes — but reassign it to report 02, not a new proto.** Hand F1 to the 02 owner and
to 08. The concrete asks: rerun 02 against `effect/unstable/reactivity` plus
`@effect/atom-react@4`, not `@effect-atom/atom-react@3`; confirm `Atom.searchParam` can be made
to agree with TanStack Router `validateSearch` rather than fight it; and price the `unstable`
churn against the fact that `effect@4.0.0-beta.92` is already a dependency of `@pe/web` and the
server is already effect v4.

---

## 10. Verdicts

| # | Candidate | Proto? | One-line reason |
|---|---|---|---|
| A | valtio | **no** | The derived story is deprecated and split across two stale satellites; `useTransition` de-opts; no async state model. |
| B | @preact/signals-react | **yes, cheapest** | qr-repo's own shape in React, with `createModel` and `useModel` closing W6 and W7 for free; the control arm. |
| C | mobx + mobx-react-lite | **no** | `mobx-utils` (`fromPromise`) is locked to mobx ^6, so mobx 7 has no async derived primitive at all. |
| D | nanostores + satellites | **no** | Two async worlds for one route, a router that cannot be adopted, no `AbortSignal`, `@nanostores/async` at 0.1.0. |
| E | @xstate/store atoms | **no** | `createAsyncAtom` is `asyncCompute` with W1 and W2 intact and no cache; report 07 already covers the store half. |
| F | @solidjs/signals | **yes, highest value** | The only candidate that kills W1 structurally (`NotReadyError` re-run) and ships SWR, optimistic updates, refresh and an owner tree. |
| G | plain React 19 | **no** | `cache()` is server-only; the rest converges on a worse TanStack Query, which report 03 already measures. |
| H | effect v4 atoms | **yes — reassign to 02** | Atom is in `effect` core under `unstable/reactivity`, with URL, kvs, SWR, optimistic updates and push invalidation. |

### Findings for 08, whichever candidate wins

| # | Finding | Cite |
|---|---|---|
| X1 | Add "transition-friendly" to the README taxonomy. `useSyncExternalStore` forces `SyncLane`, so bindings held in an external store cannot be picked inside a transition. Only jotai (`useReducer`) and router search state survive it. | `ReactFiberHooks.js:1893-1917`; `.explore/jotai/src/react/useAtomValue.ts:126` |
| X2 | A hidden `<Activity>` unsubscribes external stores and re-checks the snapshot on reveal. Hidden panes cost nothing in React, but a library graph outside React keeps running and keeps fetching. | `ReactFiberCommitWork.js:5297-5313`; `ReactFiberHooks.js:1871-1881` |
| X3 | `FeedState` should carry `changing` as an orthogonal flag, not `stale` as a fifth member. That answers **Q2** and **Q3** together. | `@nanostores/async` state machine; `@solidjs/signals` `isPending` / `latest`; `Atom.swr` |
| X4 | Any hand-rolled `asyncCompute` must take `{ signal: AbortSignal }` in the getter, not race and discard. | `.explore/xstate/packages/xstate-store/src/atom.ts:72-75` vs [01](01-qr-repo-pattern.md) W3 |
| X5 | `React.cache()` is unusable on every client route in this repo. Remove it from future designs. | [react.dev/reference/react/cache](https://react.dev/reference/react/cache) |
| X6 | Split tracking from effect (`reaction(expr, fn)`, `createEffect(compute, fn)`). That is the fix for qr-repo W12's unguarded constructor `effect`s. | mobx `reaction`; `@solidjs/signals` `createEffect` |
| X7 | `createModel` plus `[Symbol.dispose]` is the minimal fix for "one importable route object with a stated lifetime" (R13, W6, W7). It is about 30 lines if no library is adopted. | `.explore/preact-signals/packages/core/README.md:257-289` |

## Sources

- [react.dev/reference/react/Activity](https://react.dev/reference/react/Activity)
- [react.dev/blog/2025/10/01/react-19-2](https://react.dev/blog/2025/10/01/react-19-2)
- [react.dev/reference/react/cache](https://react.dev/reference/react/cache)
- [react.dev/reference/react/use](https://react.dev/reference/react/use)
- [mobx.js.org/react-integration.html](https://mobx.js.org/react-integration.html)
- [github.com/Effect-TS/effect-smol](https://github.com/Effect-TS/effect-smol) (archived) → [github.com/Effect-TS/effect](https://github.com/Effect-TS/effect)
- [github.com/nanostores/async](https://github.com/nanostores/async), [github.com/nanostores/query](https://github.com/nanostores/query), [github.com/nanostores/persistent](https://github.com/nanostores/persistent)
- [npmjs.com/package/@solidjs/signals](https://www.npmjs.com/package/@solidjs/signals)
