# 08 — Synthesis: the route-store shape and its substrate

Inputs: [00](00-baseline-census.md) census, [01](01-qr-repo-pattern.md) qr-repo pattern,
[SCENARIO](SCENARIO.md), seven built protos (02–07, 11), [09](09-wildcards.md) sweep, seven
adversarial judges (`judge-*.md`). All numbers below are the judges' re-run numbers, not the
builders' claims. Date: 2026-08-24.

## 1. Scoreboard

| Candidate | Scenario met/partial/faked | Census R1–R20 | qr R1–R16 | qr non-negotiables R1–R5 | State logic in views | Judge verdict |
|---|---|---:|---:|---:|---|---|
| **effect v4 atoms** (r3) | 17 / 5 / 0 | **35** | **26** | 8/10 | 0 lines, 0 `useState`, 0 `useEffect` | hybrid — strongest; 2 library defects |
| jotai | 17 / 5 / 0 | 22 | 19 | ~6/10 | 0 `useState`, ~25 lines owed | hybrid — owns neither async nor freshness |
| preact-signals (control arm) | 11 / 8 / 1 | 22 | 21 | **9/10** | low | hybrid — no cache; `useModel` defect |
| tanstack store + query | 9 / 8 / 1 | 23 | 16 | 2/10 | 22 / 507 lines | hybrid — steal Query contracts, reject Store |
| xstate/store | 8 / 6 / 1 | 24 | 14 | 3/10 | 9 / 496 lines | reject; hand-writes 40 % of a cache |
| legend-state v3 | — | 24 | 19 | — | hook-free | reject; async hangs after error |
| zustand + query | — | 24 | 14 | 1/10 | 0 `useState` | reject |
| baseline `/takeoffs` (census) | — | ~8 | ~6 | — | 114 `useState` across 3 routes | — |

Reading: every candidate beats the baseline on the store/view split by a wide margin, so the split
is a discipline, not a library feature. The spread is in the async centre: only effect atoms
proved a tracked dependent chain (judge probe P1: one key → three generator hops, zero over-reach
into the sibling branch).

## 2. The shape (library-independent)

Ten parts named by two or more judges as "steal this whatever wins". This is the spec; the
substrate below is one way to run it.

| # | Part | Named by | Answers |
|---|---|---|---|
| S1 | `BINDINGS` graph + pure `pickInto` / `descendants` as one declaration per route | xstate, legend, (targeting/model.ts already has it) | census R2, R16 |
| S2 | Router `validateSearch` is the **only** URL declaration; the store reads router search and **emits a search patch** instead of navigating | xstate F3, effect-atom N2 (anti), tanstack | census R1, qr R7 |
| S3 | One `Feed` projector: `(AsyncResult, basis, waiting) → FeedState`; `stale` produced from `waiting`/`isInvalidated`, never asserted | tanstack F2, zustand 1, legend 2, effect-atom F3, jotai 1 | census R3, R15, Q2, Q3 |
| S4 | `Feed.basis` — the key tuple a read came from, rendered in the badge | jotai F1 | census R3, R20 |
| S5 | Fixture replaces the **capability root** (host is a constructor arg / one atom); same one-line swap in app and test | all seven | census R14 |
| S6 | Per-entity view node `{hovered, selected, staged}` keyed by id; panes subscribe by id, take no selection props | effect-atom F2, legend 3, jotai 3 | census R8, 500-zone hover |
| S7 | `{ store }` is the only pane prop; zero `useState` in panes; a derived value ships its own subscription | zustand 3, xstate F2, tanstack F3 | qr R6, census §9.3 |
| S8 | A write **declares the key it invalidates**; the read graph cascades | effect-atom F5, tanstack F1 | census R4, R7, S10–S12 |
| S9 | Staged edit carries its base: `{base, next}`; `dirty` and `conflict` are one-line derivations | effect-atom F6, preact F3 | census R6, R17, S23 |
| S10 | React-free owner with `dispose()`, `retain()`, `settle()`; `inspect()` returns `{url, persisted, page, feeds, actions}` | zustand 2, preact F2, jotai 2, effect-atom F4 | qr R10, R13; devtools floor |

```mermaid
flowchart LR
  URL[Router search<br/>validateSearch] -->|read| Store
  Store -->|emit patch| URL
  KVS[(localStorage)] <--> Store
  subgraph Store[route store — one importable object]
    B[bindings S1] --> A[async chain<br/>session→doc→view→zones]
    A --> F[Feed projector S3/S4]
    W[write verbs S8] -->|invalidate key| A
    E[per-entity view S6] --- P[page memory: hover, staged S9]
  end
  Host[(host / fixture S5)] --> A
  Store -->|{store}| Panes[panes: 0 useState S7]
  Store --> I[inspect S10]
```

## 3. Substrate decision

Two substrates can run the shape. The others were rejected by their own judges.

| | A. TanStack Query + thin object | B. effect v4 atoms (`effect/unstable/reactivity` + `@effect/atom-react`, already pinned) |
|---|---|---|
| Tracked async waterfall (qr R3/R4) | no — keys restated per query; two graphs joined by a `cacheRevision` counter | **yes, proven** (`get.result` inside `Effect.gen`) |
| Cache: dedup, stale, retry, invalidate | **full**, with devtools | swr + keyed invalidate; no retry policy, no gc timers |
| Devtools | **TanStack panel** | none; `inspect()` + `registry.getNodes()` |
| Suspense / transitions / Activity | `useSuspenseQuery`; transition ok via router | `useAtomSuspense`; binding is mixed uSES/useState (partial transitions); Activity unsubscribes, graph keeps running |
| Effect v4 affinity (server shares Schema, HttpApi/Rpc atoms) | neutral | **native** |
| Stability | stable | `unstable/`, beta; two module-global-singleton defects (Suspense promise map `Hooks.ts:335`, `searchParam` state `Atom.ts:2723`) |
| Library-owned share of the store | cache only | ≈15 % of `model.ts`; 64 registry pokes |
| Per-click cost after fix | fine | N1 (aggregate `searchAtom`) is a 5-line fix; then fine |

**Recommendation: B, with four rules, staged through one route.**

1. Router owns the URL. **Never `Atom.searchParam`** (drops hash, second `pushState`, global state). The store reads `Route.useSearch` via one writable atom and emits patches (S2).
2. One `AtomRegistry` per app, module-level, disposed by the route owner (S10). No nested `RegistryProvider` until the Suspense map is registry-scoped upstream.
3. Read individual param atoms inside async sources; the aggregate is for the sentence only (anti-N1).
4. `inspect()` + `Atom.withLabel` on every node is the devtools floor; file the two singleton defects upstream (`Effect-TS/effect`), and pin the beta.

Why B over A: the user's three wants are, in order, *one readable object, the object owns its
waterfalls, mockable*. A gives the third and half of the first; B gives all three, and it is the
only substrate where the qr pattern's R1–R5 survive without a 204-line local runtime (the control
arm's price, and it still lacks a cache). A's cache and devtools are real losses; S3/S4/S8/S10 are
the compensations, and they are cheap.

Why staged: the shape is the durable asset. Cut `/takeoffs` (frontier) onto B with S1–S10 as
the contract. If beta churn or the singleton defects bite, the same shape ports to A (or jotai)
without touching panes. The bake-off protos prove the port is mechanical: every candidate's
`model.ts` has the same ten regions.

## 4. Residual gaps (owed, whoever builds it)

| Gap | Evidence | Owed |
|---|---|---|
| `useTransition` on a pick | 09 F2: uSES-based bindings re-render at SyncLane; effect atom-react is mixed | Measure on the real route; if picks jank, move the sentence to router-search-only rendering |
| Hidden `<Activity>` panes keep fetching | 09 F3 + preact probe: React unsubscribes, the graph does not | Gate sources on a `paneVisible` atom, or accept the fetch |
| `AbortSignal` into host reads | effect-atom qr R12 = 0; preact is the only proto that threads it | `Effect.tryPromise({ try: (signal) => host.x(..., signal) })` |
| Retry / backoff policy | none of B | `Effect.retry` with a schedule on `timed()` |
| Verb failure kind | bare `Error` everywhere | typed error union on the verb bracket (census R10) |
| Manifest as data | every proto builds verbs as JSX literals (census R12) | keep targeting `Product` static; closures live on the store |

## 5. Facts that change other docs

- `FeedState.stale` gets a producer (`waiting` / `isInvalidated`); Q2 and Q3 in the census close as "stale = previous data held while a re-read is owed; loading = no data yet".
- Add the **transition-friendly** axis to any future state-library evaluation (README updated).
- `@effect/atom-react` is first-party in `Effect-TS/effect` (effect-smol is archived); `@effect-atom/atom-react` (tim-smart) is v3-only. Do not evaluate the latter again.
- `React.cache()` is server-only; unusable on client routes here (09 X5).

## 6. Why effect atoms win — the longer form

The three wants, in kaitpw's order, and what each candidate actually did with them:

| Want | What it means mechanically | Who delivered it | Who did not, and why |
|---|---|---|---|
| 1. One centralized importable object | a route module you read top-to-bottom, where a new node is one field and no call site changes | effect atoms, preact, jotai (with `createBenchState`), xstate | tanstack (query keys scatter across hooks), zustand (object yes, but two engines inside it) |
| 2. The object owns its async waterfalls | a *tracked* dependency edge across `await`, so "doc changed" re-runs views and zones with nothing hand-listed, and *only* them | **effect atoms only** (judge probe P1: one key → three hops, sibling branch untouched; `registry.refresh` calls 11 → 1) | preact tracks across await but with a 204-line local runtime and no cache; jotai tracks but freshness is side-flagged; every query-based candidate restates every edge as a key |
| 3. Mockable / fixture-able | the host is a value the store is built from | all seven | — |

So want 2 is the discriminator. It is also the want that matters most for the routes coming:
targeting's feeds are a dependent chain by construction (trunk → terminal), and every route will
have one. A substrate that cannot track across `await` forces each route to hand-list its edges,
which is exactly the `useMemo` with a 14-entry dependency array and five eslint suppressions the
census found in `/takeoffs`.

What makes effect atoms track across `await` when preact-signals and jotai's async atoms do not:
`get.result(atom)` returns an `Effect`, so the read is a step in the generator that the registry
sees, not a promise the tracker lost sight of. The same mechanism gives interruption (a re-run
cancels the previous fiber), typed failures, and `Stream`s as push inputs — the SSE feed becomes
an atom input instead of a `useEffect` subscription.

Second-order reasons:

| Reason | Evidence |
|---|---|
| The primitives match the scenario table one-to-one | `Atom.kvs` (persisted), `Atom.family` (per-entity), `Atom.swr` (stale-while-revalidate), `Atom.optimistic` (staged), `withReactivity`/`Reactivity.invalidate` (declared invalidation), `AsyncResult.waiting` (the `stale` producer the census said nothing produced) |
| It is already in the app | `@effect/atom-react@4.0.0-beta.92` is pinned in `apps/web`; no new dependency |
| Server affinity | the server is effect v4; `Schema`, `HttpApi`/`Rpc` atoms, and error types cross the wire without a second type system |
| Store/view split went to zero | round 3: 0 `useState`, 0 `useEffect`, 0 misplaced lines in 567 view lines — the best of seven |
| Invalidation became declaration | eleven hand-listed refreshes → one keyed invalidate; the census's S10–S12 cache-surgery smells have no home to come back to |

What it costs, stated plainly:

| Cost | Size | Mitigation |
|---|---|---|
| `effect/unstable/*`: breaking changes allowed in minors | real | pin the beta; the shape S1–S10 is substrate-independent, so a port is mechanical |
| Two module-global singletons (Suspense promise map, `searchParam` state) | library bugs | one registry per app; never `Atom.searchParam`; file upstream |
| No devtools panel | real today | `inspect()` + `withLabel` floor now; see `12-devtools.md` for what a panel could be |
| ~15 % of the store is library-owned; the rest is domain + orchestration | same for every candidate — the domain does not shrink | the orchestration half is where S3/S8/S10 make it uniform across routes |
| React binding is mixed `useSyncExternalStore`/`useState` | transitions partial (09 F2) | keep the sentence on router search state, which transitions natively |
| Docs are source-first (191-byte README) | AX cost for Pea | the reading guide + `inspect()` are the local docs until upstream catches up |

What would flip the decision: a registry-scoped Suspense fix not landing before the second
route; or a TanStack Query release that tracks dependent queries without keys (none announced).

### 6.1 Devtools potential (from `12-devtools.md`)

| Fact | Consequence |
|---|---|
| Nothing upstream: effect's devtools shows spans/metrics/fibers, not atoms; `tim-smart/effect-atom#248` is 13 months idle and targets v3 | do not wait |
| Public registry surface is enough: `getNodes()`, `Node.parents/children/listeners/state`, `valueOption()`, `Atom.withLabel` | a collector needs no `@internal` reads, so it survives beta churn |
| What the registry cannot say: *why* a node recomputed | the store's write sites log `{verb, key}` — S8 makes the cause a declaration, so the join is 15 lines |
| `@tanstack/react-devtools` is already the shell in `__root.tsx` | the atoms panel sits beside Router and Query; one registration line |
| Estimate: ~250 lines without graph, ~336 with; 1–1.5 days | being built on branch `atom-devtools` |
| Headless first | `inspect()` + collector snapshot are JSON, so agents assert on them in tests and probes; the panel is one view; Redux DevTools is a second sink later |

This closes the "no devtools" row in §3 to "no *upstream* devtools; ~300 local lines, on a public
surface, with better cause-tracking than a generic panel because writes declare their keys".
