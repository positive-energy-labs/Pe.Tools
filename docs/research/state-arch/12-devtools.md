# 12 — Devtools for effect v4 atoms

Date: 2026-08-24. Verifies the "no devtools" weakness that [08-synthesis](08-synthesis.md) §3 gives
to substrate B (`effect/unstable/reactivity` + `@effect/atom-react`).

**Verdict in one line: the weakness is real, but it is smaller than stated. The registry gives a
public, unpatched observation seam. Build a panel. Do not wait.**

Sources used:

| Kind | Location | Version |
|---|---|---|
| Clone | `.explore/effect` (`Effect-TS/effect`, shallow, HEAD `b3f268d`) | `4.0.0-rc.111` |
| Installed | `ts/apps/web/node_modules/effect/src/...` | `4.0.0-beta.92` (pinned) |
| Clone | `.explore/effect-atom` (`tim-smart/effect-atom`) | v3 line, `60bcae0` |
| Clone | `.explore/tanstack-devtools` (`TanStack/devtools`, `566d39b`) | current |
| Clone | `.explore/jotai-devtools` (`jotaijs/jotai-devtools`, `43ba45c`) | v0.14.0 |
| Web | effect.website v4 devtools, VS Code marketplace, GitHub issues | fetched 2026-08-24 |

Paths below are relative to the clone root, or to `ts/` for repo files.

---

## 1. What exists today

### 1.1 Effect's own devtools

`effect/unstable/devtools` is a **tracer bridge**. It is not a state inspector.

| Item | Fact | Citation |
|---|---|---|
| Entry point | `DevTools.layer(url = "ws://localhost:34437")` installs a tracer that mirrors spans to a socket | `packages/effect/src/unstable/devtools/DevTools.ts:66-68` |
| Transport | WebSocket, or any `Socket` | `DevTools.ts:19-35` |
| Wire protocol, client → server | `Ping`, `Span`, `SpanEvent`, `MetricsSnapshot` | `DevToolsSchema.ts:489` |
| Wire protocol, server → client | `Pong`, `MetricsRequest` | `DevToolsSchema.ts:532` |
| Metric kinds | `Counter`, `Frequency`, `Gauge`, `Histogram`, `Summary` | `DevToolsSchema.ts:445` |
| Total size | 987 lines across 5 files | `wc -l packages/effect/src/unstable/devtools/*.ts` |
| Atoms in the protocol | **none** | `grep -rni "devtool" packages/effect/src/unstable/reactivity/` returns 0 hits |

The VS Code extension "Effect Dev Tools" is a debugger companion. It shows Context, a Span Stack,
a Fiber list with interrupt, and "pause on defect" breakpoints. It reads a paused fiber. It does
not read an `AtomRegistry`.
Sources: [effect.website v4 devtools](https://www.effect.website/docs/v4/getting-started/devtools),
[VS Code marketplace](https://marketplace.visualstudio.com/items?itemName=effectful-tech.effect-vscode).

**Conclusion: spans and metrics only. Atoms do not appear.**

### 1.2 Atom-side tooling

| Question | Answer | Citation |
|---|---|---|
| Does `@effect/atom-react` export a devtools hook? | No. The 11 exports are `useAtomInitialValues`, `useAtomValue`, `useAtomMount`, `useAtomSet`, `useAtomRefresh`, `useAtom`, `useAtomSuspense`, `useAtomSubscribe`, `useAtomRef`, `useAtomRefProp`, `useAtomRefPropValue` | `.explore/effect/packages/atom/react/src/Hooks.ts:78,113,185,209,250,273,371,406,437,462,486` |
| Does `tim-smart/effect-atom` ship a devtools package? | No. `grep -rli "devtool"` over the whole repo returns **0 files**. Packages: `atom`, `atom-livestore`, `atom-react`, `atom-solid`, `atom-vue` | `.explore/effect-atom/packages/` |
| Is there a devtools branch or PR? | No. Branches: `agent/codex-engineer/0db0df47`, `api`, `batching`, `main`, `stream-fn`. Zero PRs match "devtools" | `gh api repos/tim-smart/effect-atom/branches` |
| Is there an issue? | **Yes, one.** `tim-smart/effect-atom#248` "dev tools", opened 2025-07-25, **still open** | https://github.com/tim-smart/effect-atom/issues/248 |
| Anything in `Effect-TS/effect`? | No. `gh search issues/prs` for "atom devtools", "registry inspection", "atom inspect", "reactivity devtools" returns **0 results** | — |

Issue #248 content, quoted:

| Author | Date | Point |
|---|---|---|
| tim-smart | 2025-07-25 | "react query style dev tools would be sweet … inspect the registry and rx state, manually trigger refreshes, manually set initial/success/error/waiting states … on my list of things to build internally" |
| tim-smart | 2025-07-26 | "I think Rx could integrate with the redux dev tools. Jotai does this" |
| ethanniser | 2025-07-29 | "drawing up some ideas for rx dev tools" |
| indietyp | 2025-08-12 | "tanstack has released tanstack-devtools … to create and embed custom devtools" |

**Read: 13 months open, zero lines of code, and the last comment already names our answer.
Waiting has a bad record here.** Note also that #248 is against the **v3 line**; 08-synthesis §5
rules `@effect-atom/atom-react` out of scope. The v4 first-party package has no issue at all.

### 1.3 The reference bar

| Panel | Shows | Does not show | Size |
|---|---|---|---|
| **jotai-devtools** v0.14 | Atom list, atom detail, **dependents list**, JSON tree of any value, diff highlight, **time travel** with snapshot history, private-atom filter, dark mode | No visual graph. No per-atom recompute count. No timing | 4 556 lines total; AtomViewer 697; TimeTravel 1 562 |
| **TanStack Query devtools** | Query list by key, status, `dataUpdatedAt`, observer count, data explorer, per-query actions (refetch, invalidate, reset, remove), error trigger | — | ships in `@tanstack/react-query-devtools` |
| **TanStack Devtools shell** | Tab host for any plugin, theme, position, persisted open tabs, optional cross-process event bus | Nothing state-specific by itself | plugin API is 5 fields |

jotai's panel needs three dev-only store methods: `getMountedAtoms()`, `getAtomState(atom)`,
`getMountedAtomState(atom)`, plus a **store-wide change event** `subscribeStore(callback)`
(`.explore/jotai-devtools/src/utils/useAtomsSnapshot.ts:64,70,76,114`). Keep that list. Section 2
compares it to what effect gives.

---

## 2. The registry surface we can build on

All of the following is **public API**. No patch of the library is needed.

### 2.1 What the registry exposes

| Member | Signature | Use for devtools | Citation (rc.111) |
|---|---|---|---|
| `getNodes()` | `() => ReadonlyMap<Atom \| string, Node<any>>` | Full node census. Returns the **live internal Map**, not a copy, so one reference stays current | `AtomRegistry.ts:68`, impl `:364-366` |
| `onNodeAdded` | `((node: Node<any>) => void) \| undefined` — **mutable field, assignable** | Node-created event | `AtomRegistry.ts:81`, fired at `:430` |
| `onNodeRemoved` | `((node: Node<any>) => void) \| undefined` — **mutable field** | Node-removed event, incl. idle sweep | `AtomRegistry.ts:82`, fired at `:489,:504,:547,:561` |
| `subscribe(atom, f, {immediate})` | `() => () => void` | Per-atom change event, in commit order | `AtomRegistry.ts:76`, impl `:400-414` |
| `mount(atom)` | `() => () => void` | Force-retain a node while inspecting | `AtomRegistry.ts:70` |
| `refresh(atom)` | `void` | Panel action "refresh this node" | `AtomRegistry.ts:71` |
| `set` / `update` / `modify` | writable atoms only | Panel action "set this value" | `AtomRegistry.ts:72,74,75` |
| `reset()` / `dispose()` | `void` | Panel action "reset registry" | `AtomRegistry.ts:79,80` |

`onNodeAdded` and `onNodeRemoved` have **no consumer anywhere in the Effect repo**
(`grep -rn "onNodeAdded" .explore/effect` matches only `AtomRegistry.ts`). They are an unused,
declared seam. They are present in the pinned `4.0.0-beta.92` as well
(`node_modules/effect/src/unstable/reactivity/AtomRegistry.ts:81-82`).

### 2.2 What one node exposes

| Member | Type | Devtools meaning | Citation |
|---|---|---|---|
| `atom` | `Atom<A>` | Identity, and the label carrier | `AtomRegistry.ts:97` |
| `value()` | `() => A` | Current value — **forces a rebuild when the node is stale**. Do not call it from a panel | `:98`, impl `:630-658` |
| `parents` | `Set<Node>` (rc.111) / `Array<Node>` (beta.92) | Inbound edges = dependencies | `:99` |
| `children` | `Set<Node>` / `Array<Node>` | Outbound edges = dependents | `:100` |
| `listeners` | `Set<() => void>` | Subscriber count. Non-zero means React or a stream holds it | `:101` |
| `currentState()` | `"uninitialized" \| "stale" \| "valid" \| "removed"` | Node lifecycle | `:102`, impl `:612-627` |
| `valueOption()` | `Option<A>` — **not on the `Node` interface**, only on `NodeImpl` | Non-forcing read. The correct read for a panel | impl `:660-666` |
| `_value` | `A` — private field | The raw last value | impl `:629` |

Atom metadata:

| Member | Type | Citation |
|---|---|---|
| `label` | `readonly [name: string, stack: string]` — optional | `Atom.ts:73` |
| `keepAlive`, `lazy`, `idleTTL` | `boolean`, `boolean`, `number?` | `Atom.ts:68,69,74` |
| `toJSON()` | `{ _id: "Atom", keepAlive, lazy, label }` | `Atom.ts:234-241` |
| `Atom.withLabel(name)` | Sets `label = [name, callerStackFrame]`. **It captures `new Error().stack?.split("\n")[5]`, so the panel gets a source location for free** | `Atom.ts:1579-1588` |

Batch surface:

| Member | Note | Citation |
|---|---|---|
| `Atom.batch(f)` | Public re-export of `Registry.batch` | `Atom.ts:2085` |
| `batchState` | `{ phase, depth, stale: Node[], notify: Set<Node> }` — marked `/** @internal */` but **exported** | `AtomRegistry.ts:1087-1093` |
| `BatchPhase` | `disabled \| collect \| commit` | `AtomRegistry.ts:1077-1084` |

### 2.3 Observable without a patch

| Signal | How | Cost |
|---|---|---|
| Node census, add and remove | `onNodeAdded` / `onNodeRemoved` | Zero |
| Label and source file | `node.atom.label` | Zero, if `withLabel` is applied |
| Dependency graph, both directions | `node.parents`, `node.children` | Zero. Read on demand |
| Lifecycle state | `node.currentState()` | Zero |
| Subscriber count | `node.listeners.size` | Zero |
| Retention policy | `atom.keepAlive`, `atom.lazy`, `atom.idleTTL` | Zero |
| Current value | `(node as NodeImpl).valueOption()` | Zero. **Never `value()`** |
| Value-change events, per node | `registry.subscribe(atom, fn)` | **Not zero — see 2.4** |
| Recompute count, per node | Poll and diff `_value` identity, or count `subscribe` callbacks | Low, with the 2.4 caveat |
| Batch commit order | `batchState.notify` iteration order during `BatchPhase.commit` | Uses an `@internal` export |

### 2.4 Not observable, and why

| Question | Why it is closed | Citation |
|---|---|---|
| **"Why did this node recompute?"** | `invalidate()` takes no cause argument. `invalidateChildren()` calls `child.invalidate()` with no reference to the parent that changed. No cause is stored anywhere on the node | `AtomRegistry.ts:741-771` |
| "Which parent changed first?" | `disposeLifetime()` moves `parents` into `previousParents` and clears `parents` before the rebuild. The panel can diff the two sets to see an edge change, but not an edge **trigger** | `AtomRegistry.ts:780-790` |
| "How long did this async atom take?" | No timestamp and no counter on `NodeImpl`. The panel must stamp times itself | `AtomRegistry.ts:587-611` (field list) |
| "What did the value used to be?" | No history. `setValue` overwrites `_value` | `AtomRegistry.ts:685-719` |
| A store-wide change event | **Missing.** This is jotai's `subscribeStore`. `onNodeAdded`/`onNodeRemoved` cover creation and removal only, not value changes | compare `useAtomsSnapshot.ts:114` |

**Observer effect — the one real trap.** A panel that calls `registry.subscribe` on every node adds
a listener to every node. `canBeRemoved` is `!atom.keepAlive && listeners.size === 0 &&
children.size === 0 && state !== 0` (`AtomRegistry.ts:634-636`). A subscribed node is never idle-swept.
Therefore **devtools-on and devtools-off have different memory and different `idleTTL` behaviour**.
`RegistryContext` sets `defaultIdleTTL: 400` ms by default
(`.explore/effect/packages/atom/react/src/RegistryContext.ts:44-47`), so the difference is visible
within half a second. Two ways out:

| Option | Effect | Recommend |
|---|---|---|
| Poll `getNodes()` on `requestAnimationFrame`, read `valueOption()`, diff by `Object.is` | No listeners added. Misses changes that happen and revert inside one frame. Loses commit order | **Yes, default** |
| Subscribe per node | Exact ordering. Breaks idle GC | Only behind an explicit "precise mode" toggle in the panel |

**Causality has a better source than the graph: our own verb layer.** 08-synthesis S8 already says
"a write declares the key it invalidates". The store owns every `registry.set` / `update` / `refresh`
call. So the store can log `{verb, key, t}` at the write site. Join that log with the graph, and
"why did `zones-feed` recompute?" answers as "verb `adopt` invalidated `zones`, which is an ancestor".
This needs no library change and it is exact. The registry supplies the graph; the store supplies
the cause.

### 2.5 Version drift — act on this

| Item | beta.92 (pinned) | rc.111 (HEAD) | Impact |
|---|---|---|---|
| `Node.parents` / `Node.children` | `Array<Node<any>>` (`node_modules/effect/src/unstable/reactivity/AtomRegistry.ts:99-100`) | `Set<Node<any>>` (`.explore/effect/.../AtomRegistry.ts:99-100`) | **Breaking for any counter.** The bench proto already uses `node.parents.length` (`Pe.Tools-sb-effect-atom/.../state-bench/effect-atom/model.ts:738`). On rc.111 that is `undefined` and `edges` becomes `NaN` |
| `onNodeAdded` / `onNodeRemoved` | present | present | Safe to use now |
| `getNodes()` | present | present | Safe |

Fix: write `const size = (x) => Array.isArray(x) ? x.length : x.size` once in the collector.

---

## 3. TanStack Devtools as the host

The app already runs the shell. Registering an "Atoms" tab is a 6-line file.

### 3.1 Plugin interface

| Field | Type | Required | Citation |
|---|---|---|---|
| `name` | `string \| ((el, props) => void)` | yes | `.explore/tanstack-devtools/packages/devtools/src/context/devtools-context.tsx:48-50` |
| `id` | `string` | no — derived from `name` | `:55` |
| `defaultOpen` | `boolean`, default `false` | no | `:61` |
| `render` | `(el: HTMLDivElement, props: TanStackDevtoolsPluginProps) => void` | yes | `:75` |
| `destroy` | `(pluginId: string) => void` | no | `:76` |
| `props` given to `render` | `{ theme: TanStackDevtoolsTheme, devtoolsOpen: boolean }` | — | `:17-20` |

The React adapter replaces `render` and `name` with React nodes:
`render: JSX.Element | ((el, props) => JSX.Element)`
(`.explore/tanstack-devtools/packages/react-devtools/src/devtools.tsx:25-68`).

The cross-process `EventClient` from `@tanstack/devtools-event-client` is **optional**. It exists to
make a plugin framework-agnostic, or to cross a process boundary
(`.explore/tanstack-devtools/docs/framework/react/guides/custom-plugins.md:35-118`). Our registry
lives in the same JS context as the panel. **Skip the event client.** Read the registry directly.

### 3.2 Current wiring in this repo

| File | Line | Content |
|---|---|---|
| `apps/web/src/routes/__root.tsx` | 57-68 | `<TanStackDevtools config={{position:"bottom-right"}} plugins={[{name:"Tanstack Router", render:<TanStackRouterDevtoolsPanel/>}, TanStackQueryDevtools]}/>` |
| `apps/web/src/integrations/tanstack-query/devtools.tsx` | 1-6 | The whole plugin file: an import, a `name`, a `render`. 6 lines |

### 3.3 Minimal panel, 38 lines

```tsx
// apps/web/src/integrations/atoms/devtools.tsx
import { useEffect, useState } from "react";
import type * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { registry } from "#/state/registry"; // the one module-level registry, 08-synthesis rule 2

const size = (x: any) => (Array.isArray(x) ? x.length : x.size); // beta.92 Array vs rc.111 Set
type Row = { key: string; state: string; deps: number; dependents: number; subs: number; value: string };

function snapshot(): Row[] {
  return [...registry.getNodes().values()].map((n: any) => ({
    key: n.atom.label?.[0] ?? String(n.atom),            // Atom.ts:73
    state: n.currentState(),                              // AtomRegistry.ts:102
    deps: size(n.parents),
    dependents: size(n.children),
    subs: n.listeners.size,
    value: (() => { const o = n.valueOption(); return o._tag === "Some" ? JSON.stringify(o.value)?.slice(0, 120) : "—"; })(),
  }));                                                    // valueOption does not force a rebuild
}

function AtomsPanel() {
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    let raf = 0;
    const tick = () => { setRows(snapshot()); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <table className="w-full text-xs font-mono">
      <thead><tr><th>atom</th><th>state</th><th>deps</th><th>dependents</th><th>subs</th><th>value</th></tr></thead>
      <tbody>{rows.map((r) => (
        <tr key={r.key} onDoubleClick={() => registry.refresh((registry.getNodes().get(r.key) as any)?.atom)}>
          <td>{r.key}</td><td>{r.state}</td><td>{r.deps}</td><td>{r.dependents}</td><td>{r.subs}</td><td>{r.value}</td>
        </tr>))}
      </tbody>
    </table>
  );
}

export default { name: "Atoms", render: <AtomsPanel /> };
```

Register it with one line in `__root.tsx:63`, beside `TanStackQueryDevtools`.

This gives the value table, the edge counts, the subscriber count, and refresh-on-double-click.
It does not yet give the recompute counter, the invalidation log, or a drawn graph. Section 4
prices those.

---

## 4. Verdict

### 4.1 Buy / build / wait

| Option | What it is | Cost | Verdict |
|---|---|---|---|
| **Wait for upstream** | `tim-smart/effect-atom#248` | 13 months open, 0 commits, and it targets the **v3** package that 08-synthesis §5 rules out | **No.** Re-check in 6 months |
| **Buy: Redux DevTools as a sink** | Send a labelled snapshot to `window.__REDUX_DEVTOOLS_EXTENSION__` on each change. This is what jotai's `useAtomDevtools` does, and what tim-smart suggested in #248 | ~60 lines. Free JSON tree, free diff, free time-travel UI. Needs a browser extension. Gives no graph and no per-node timing. Time travel is read-only for us, because replaying into an atom graph with live async sources is not sound | **Partly.** Take it as a **second** sink later, not as the panel |
| **Buy: jotai-devtools** | Not portable. It binds to jotai store internals (`getMountedAtoms`, `subscribeStore`) | — | **No** |
| **Build: TanStack plugin** | Headless collector + one React panel, hosted by the shell already in `__root.tsx` | See 4.2 | **Yes** |

### 4.2 Estimate for the minimal panel

Scope: graph, values, last-N invalidations, per-node recompute count.

| Part | File | Lines | Notes |
|---|---|---|---|
| Collector, headless | `apps/web/src/state/atom-inspect.ts` | 110 | `onNodeAdded`/`onNodeRemoved` census, rAF diff of `valueOption()`, per-node `recomputes` counter and `lastChangeAt`, ring buffer of the last 100 changes, `size()` drift shim |
| Verb log join | in the route store, at the write site | 15 | `{verb, key, t}` pushed on every `registry.set/update/refresh`. Supplies the **cause** that the registry cannot |
| Table panel | `apps/web/src/integrations/atoms/devtools.tsx` | 120 | Filter by label prefix, sort, select a row, detail pane with parents and children lists, actions: refresh, mount, set |
| Graph view | same file or `graph.tsx` | 90 | Layered SVG by topological depth. No layout dependency. Optional in v1 |
| Registration | `__root.tsx` | 1 | |
| **Total** | | **~336** (**~246** without the graph view) | Compare: jotai-devtools is 4 556 lines, but it carries Mantine, time travel, and a redux bridge |

| Effort | Estimate |
|---|---|
| Collector + table + registration | **0.5 day** |
| Add recompute count, invalidation ring, verb-cause join | **+0.5 day** |
| Add the SVG graph | **+0.5 day** |
| **Total** | **1–1.5 days** |

Risk: `@internal` `batchState` is the only tempting non-public read. The plan above does not use it.
Keep it that way, and the panel survives beta churn as long as `getNodes()` and `Node` hold.

### 4.3 What it gives agents versus humans

An agent cannot see a panel. So **build the collector headless first, and expose it as data**. The
panel is one view on that data; a browser probe is another.

The `inspect()` taxonomy already exists in the bench proto
(`Pe.Tools-sb-effect-atom/ts/apps/web/src/state-bench/effect-atom/model.ts:715-742`):

```ts
inspect() {                                   // model.ts:715
  const nodes = [...registry.getNodes().values()];
  return {
    search:    registry.get(searchAtom),      // :718  URL truth
    persisted: registry.get(persistedAtom),   // :719  kvs truth
    page:      { hover, busy, receipt, dirty, planVisible },   // :720-726
    feeds:     { sessions, doc, views, zones, folder, r10 },   // :727-734
    registry:  { nodes: nodes.length,                          // :736
                 subscribed: nodes.filter((n) => n.listeners.size > 0).length,   // :737
                 edges: nodes.reduce((c, n) => c + n.parents.length, 0) },       // :738 — drift, see 2.5
    actions:   registry.get(actionsAtom),     // :740  verb log
  };
}
```

Map of who gets what:

| Capability | Agent | Human | Source |
|---|---|---|---|
| "What is the route state right now?" | **Yes** — `inspect()` returns JSON. Assert on it in a test, or read it in a browser probe | Yes, via the table | store `inspect()` |
| "Is the graph the size I think?" | **Yes** — `registry.nodes`, `subscribed`, `edges` are three numbers. A test can assert an upper bound and catch a leak | Yes | `inspect().registry` |
| "Did this click over-fetch?" | **Yes** — diff `inspect()` before and after, and read the recompute counters | Yes, and faster | collector |
| "Why did node X recompute?" | **Yes** — the verb log gives the cause; the graph gives the path | Yes | verb log + graph |
| "Which node is hot?" | Yes — sort by `recomputes` | Yes | collector |
| "Does the shape look right?" | Weak. A node list reads poorly as text | **Yes** — this is what the drawn graph is for | graph view |
| "Set this value and see what happens" | Yes, by calling the store verb | **Yes** — panel actions are faster | `registry.set` / `refresh` |
| Time travel | No. Not sound with live async sources | Partly, through the Redux sink | — |

Three rules that follow:

| # | Rule |
|---|---|
| D1 | `Atom.withLabel` on **every** atom. Without it the panel shows object identity, and `withLabel` also captures a source frame (`Atom.ts:1587`). The bench proto already does this on all ~40 atoms (`model.ts:219-444`) |
| D2 | The collector is headless and exported as data. Publish it at one global, e.g. `globalThis.__PE_ATOMS__`, in dev only, so the browser lane can read it. The repo has no such convention yet, so set one |
| D3 | The panel reads `valueOption()`, never `value()`, and polls by frame instead of subscribing per node. Otherwise the observation changes the idle-GC behaviour it is measuring (2.4) |

### 4.4 Correction to 08-synthesis

| 08-synthesis §3 said | Replace with |
|---|---|
| "Devtools: none; `inspect()` + `registry.getNodes()`" | "Devtools: none upstream, and none planned for v4. The registry has a public seam — `getNodes()`, `onNodeAdded`, `onNodeRemoved`, per-node `parents`/`children`/`listeners`/`currentState()` — that supports a TanStack Devtools plugin in about 250–340 lines and 1–1.5 days. Cause tracking comes from the store verb log (S8), not from the registry. Cost: none upstream, one day of ours." |

Rule 4 of the recommendation ("`inspect()` + `Atom.withLabel` on every node is the devtools floor")
stands, and this document sets the ceiling.

## 5. Built

Built on 2026-08-24:

| File | Lines | Purpose |
|---|---:|---|
| `ts/apps/web/src/state/atom-inspect.ts` | 209 | Public-API collector, cause hook, snapshots, polling subscription, refresh, and safe primitive set |
| `ts/apps/web/src/state/atom-inspect.test.ts` | 71 | Headless registry tests for census, counters, the 100-change ring, cause join, and deterministic snapshots |
| `ts/apps/web/src/integrations/atoms/devtools.tsx` | 159 | TanStack Devtools table, prefix filter, hot-node sort, node detail, actions, and last 20 changes |
| `ts/apps/web/src/routes/__root.tsx` | 75 | `AtomDevtools` import and one plugin registration |

Product code is 368 lines across the collector and panel. The optional graph view was not built.

The browser proof used `/settings` at `http://localhost:3002/settings`. The open Atoms panel showed
`1 node · 0 edges · 1 subscribed`, prefix filtering, recompute and last-change sorting, and one
`unlabelled` valid node. Selecting that node showed its current `AsyncResult` value, no parents or
children, the missing `Atom.withLabel` source, Refresh and Set actions, and an empty last-20 list.
The browser console had no warnings or errors. The screenshot showed the Atoms tab open below the
Settings route, with the table on the left and the detail pane on the right.

The collector cannot see these facts through the public API:

- It cannot see which parent invalidated a node, the invalidation order, or why a node recomputed.
  `note({ verb, key })` supplies the most recent store-owned cause instead.
- It cannot count a recompute that returns the same value identity. The `recomputes` field counts
  observed value-identity changes.
- It cannot read a stale or uninitialized value without forcing a rebuild. It calls public
  `Node.value()` only when `Node.currentState()` is `valid`; it does not cast to `NodeImpl` or call
  `valueOption()`.
- It cannot recover previous values, exact batch commit order, or async duration. No public node
  revision, history, cause, commit event, or timestamps exist.
- The 100 ms poll can miss a value that changes and reverts between polls. It avoids
  `AtomRegistry.subscribe`, so inspection does not add node listeners or prevent idle removal.

Set is limited to writable nodes whose current valid value is a string, finite number, or boolean.
Object writes stay with route-store verbs because a readable atom value does not prove its write
input has the same type.

A route store must expose this shape and call `note` immediately before each `set`, `update`, or
`refresh` write. Every atom must use `Atom.withLabel`.

```ts
export interface InspectableAtomStore {
  readonly registry: AtomRegistry.AtomRegistry;
  readonly inspector: AtomInspector;
  inspect(): InspectSnapshot;
  subscribe(cb: () => void): () => void;
  note(cause: { verb: string; key: string }): void;
  refresh(id: string): boolean;
  set(id: string, value: string): boolean;
  dispose(): void;
}
```
