# Judge — candidate `zustand`

Adversarial review. The judge ran every command. The judge did not trust the report's claims.

- Proto worktree: `C:\Users\kaitp\source\repos\Pe.Tools-sb-zustand`
- Files judged: `state-bench/zustand/{model.ts,bench.ts,view.tsx,bench.test.ts}`, `routes/state-bench.zustand.tsx`
- Line references are `file:line` inside `ts/apps/web/src/`.

## 0. Lanes the judge ran

| Command | Result | Note |
|---|---|---|
| `vp run @pe/web#test -- state-bench` (from `ts`) | FAILS: `Task "state-bench" not found` | The mission command does not work. The report says the same at §8.3. The report is correct. |
| `vp test src/state-bench/zustand/bench.test.ts` (from `apps/web`) | PASS. 1 file, 5 tests, 858 ms | Matches the report's §5 claim exactly. |
| `vp check src/state-bench/zustand src/routes/state-bench.zustand.tsx` | PASS. 5 files formatted; 0 warnings, 0 lint errors, 0 type errors | Matches the report's §8 claim. |
| Judge probe (temporary test, deleted after use) | 5 probes; all confirmed the defects below | Working tree left clean. |

Line counts are true: `bench.ts` 674 + `model.ts` 182 = 856 controller lines; `view.tsx` 577 + route 55 = 632 view lines; `bench.test.ts` 107. The report's §8 numbers are honest.

## A. Scenario compliance

| SCENARIO requirement | Verdict | Evidence |
|---|---|---|
| Waterfall clears descendants | **met** | `bench.ts:466-471` clears in one central `pick`. `bench.test.ts:28-50` proves it. |
| Every binding in URL search; reload restores | **met** | `routes/state-bench.zustand.tsx:17-26` `validateSearch`; `bench.ts:202-206` pushes to the router. |
| Feed shape `{options,state,at?,note?}` | **met** | `model.ts:8-13`; `bench.ts:380-404`. |
| Feed state `live` | **partial** | Only the sessions feed gets `live`, and only from a hard-coded `live = true` argument (`bench.ts:410`). It is asserted, not derived. |
| Feed state `fresh` | **faked** | Unbound links return `{options:[],state:"fresh"}` with no read behind them (`bench.ts:414,418,424,432,441`). The judge probe printed `UNBOUND doc/view/zones/folder: {"options":[],"state":"fresh"}`. This is the census S8/S9 defect, reproduced. |
| Feed state `loading` | **met** | `bench.ts:382-384`. |
| Feed state `error` | **met** | `bench.ts:385-391`. It keeps the prior data. |
| Feed state `fixture` | **partial** | Derived from `harness.mode === "fixture"`, a flag on the harness, not from the read (`bench.ts:383,395`). |
| Feed state `stale` after adopt | **met** | `bench.ts:576-578` invalidates with `refetchType:"none"`, yields a microtask, then re-reads. `bench.test.ts:52-71` observes `stale` in the sequence. This is a real producer for `stale`. It answers census Q2. |
| 1-in-4 zones failure to `error` feed | **met in the store; BROKEN in the UI** | `model.ts:141-142` rejects. `bench.test.ts:73-90` proves the error feed. But the Plan pane uses `useSuspenseQuery` (`view.tsx:427`) and the proto has **no error boundary anywhere**. A failed zones read makes the Plan pane throw. The pane does not show an error feed. It unwinds to the router's default catch boundary and takes the whole route down. The report does not state this. |
| Push `docChanged` invalidates doc + views + zones | **met** | `bench.ts:330-345`; `bench.test.ts:92-106`. |
| One-line fixture swap at the composition root | **met, but thin** | `routes/state-bench.zustand.tsx:45` is one line. But `createFixtureHost()` and `createMockHost()` are the **same** `createHarness` body with two knobs changed (`model.ts:108-182`). The judge probe printed `FIXTURE KNOBS: {"latencyMultiplier":0,"failureOn":false} MODE: fixture`. The proto never substitutes a different implementation. The seam is typed and real. The demonstration is not. |
| The same swap in a no-React vitest test | **partial / faked demo** | `bench.test.ts:17` reads `const fixture = true;`. The ternary at line 18 has a constant condition. The `createMockHost()` branch is unreachable. The test proves the fixture host works. It does not prove a swap, and it is written to look as if it does. |
| No React rendered in the test | **met** | No React import; no render. Note: `@tanstack/react-query` still loads React into the module graph. |
| `<Suspense>` per pane with a per-pane fallback | **met; 1 of 3 real** | `view.tsx:111` wraps all three panes. Only the Plan pane suspends (`view.tsx:427`). Zone list and Staging use `useQuery` and render their own pending text (`view.tsx:369-371`, `466-468`), so their boundaries never fire. The SCENARIO asked for both styles, so this is compliant. But two of three fallbacks are decorative. |
| `<Activity>` on the Plan pane | **met** | `view.tsx:77-81`. |
| Hidden Activity keeps state; note the subscription cost | **claimed; not verifiable here** | Report §6 claims subscriptions pause and renders drop from 12 to 8. The judge has no browser. Unverified. |
| `useTransition` / `startTransition` on the binding pick | **met** | `view.tsx:154,160` for binding picks; `view.tsx:304` for stage. |
| Hover at 60 fps with 500 zones, measured | **partial / unproven** | `bench.ts:517-534` measures `setState` to `queueMicrotask`. That is not milliseconds per frame. It excludes style, layout and paint of 1 500 nodes. The numbers are dev mode with Strict Mode doubling, self-reported, and not reproducible by the judge. |
| Devtools wired | **met** | Zustand `devtools` middleware (`bench.ts:176,188`), plus a `<pre>` inspector that includes the Query cache (`view.tsx:549-576`), plus `devtools.png` in the proto directory. |
| Staging table shows staged edits and dirty rows; `Adopt` commits | **FAKED** | Staged renames never reach the host. `bench.ts:574` sends `adoptZones(session, doc, zones)` — zone ids only. `bench.ts:575` then wipes `stagedRenames` to `{}`. The judge probe printed `ADOPT PAYLOAD: [["zone-001"]]` and `STAGED AFTER: {}`. The verb silently destroys the user's edits. The dirty column is theatre. |

Two scenario items are **faked**: `fresh` on unbound links, and Adopt committing staged edits. One is **broken in the UI only**: the failure path through `useSuspenseQuery`.

## B. Baseline census R1–R20

| # | Score | Evidence |
|---|:-:|---|
| R1 Addressable; one mechanism | 2 | All six bindings plus `stage` live in router search (`route:17-26`). One mechanism. |
| R2 Dependents clear by declaration | 1 | Central, but a hand-enumerated `if` chain (`bench.ts:467-470`). No declared link table. `pickInto` was more declarative than this. |
| R3 Machine-readable basis for freshness | 1 | `stale` is real (`state.isInvalidated`, `bench.ts:397`). `fresh`, `live` and `fixture` are asserted. The probe confirmed the hard-coded `fresh`. |
| R4 Write declares invalidations at the read's identity | 1 | Adopt uses the key factory (`bench.ts:576`). But `handleEvent` hand-builds prefix arrays (`bench.ts:335,341`). Positional key knowledge is back. |
| R5 Optimistic and write-through are one mechanism | 1 | Only one write exists, and it is not optimistic. Not proved either way. |
| R6 Staged edits: declared home, lifetime, per-cell send | 1 | Home and lifetime are declared (`bench.ts:57`; page memory). The "what a write would send" half is absent, because the write sends nothing. |
| R7 Write result enters the read model without cache surgery | 2 | Receipt to store, invalidate, re-read (`bench.ts:575-578`). No splices. |
| R8 Selection and hover first-class, shared, separable | 2 | Hover is store; selection is URL. All three panes read both by selector. Neither is drilled as a prop. |
| R9 Derived view order without a parent round trip | 1 | Not exercised. No filter, sort or cursor in the proto. |
| R10 Verb bracket: identity, elapsed, receipt, typed failure, links | 1 | Four of five (`bench.ts:363-378,565-584`). Failures are stringified (`bench.ts:674`); no typed kind. The touched links are hard-coded inside the verb. |
| R11 Refusal computable from state | 2 | `refusal()` (`bench.ts:445-455`). Judge probe: after `docChanged`, refusal returned `"zones are stale · refresh before Adopt"`. A genuine, working derivation. |
| R12 Manifest is data, evaluated once | 1 | Nothing is rebuilt per render; `queryOptions` is built once in the closure. But there is no manifest — stages and verbs are inline JSX (`view.tsx:299-338`). The requirement is dodged, not met. |
| R13 Every derivation a pure exported function | 1 | `feed` and `refusal` are closures over `store` and `queryClient`. They are neither exported nor pure. They are React-free and testable through the bench object, which is the useful half. |
| R14 Route mountable with an injected source | 2 | `createBench({harness})`. `bench.test.ts` proves it. |
| R15 Loading, empty, error, fixture as four distinct states | 1 | Empty is not distinct. `{options:[],state:"fresh"}` means both "not bound yet" and "the read returned nothing". A surface cannot tell them apart. |
| R16 One reset protocol on identity change | 1 | Two spellings of "a session change clears doc, view and zones": `bench.ts:467` and `bench.ts:350-353`. One writer, two rules. |
| R17 No shadowing of server data by local edits without a merge rule | 1 | Staged renames survive a refresh, which is correct. But an orphan rename for a zone the host removed stays forever. No merge rule. |
| R18 Cross-tab / cross-surface writes visible | 0 | `persist` writes to localStorage. Nothing listens for a `storage` event. |
| R19 No hand-maintained dependency list per derivation | 0 | Every waterfall edge carries a hand-written selector **and** a hand-written `equalityFn` (`bench.ts:284,293`). This is the eslint-suppression problem, re-typed as library API. |
| R20 Freshness captions self-update or say they do not | 2 | The badge word updates through `cacheVersion`. The tooltip shows an absolute clock time (`view.tsx:179`), not a relative `ago()`. It does not lie. |

**Census total: 24 / 40.**

## C. qr-repo R1–R16

| # | Score | Evidence |
|---|:-:|---|
| R1 Async derived declared as a peer of sync derived — **non-negotiable** | 0 | Sync derived is a pull function (`feed`, `refusal`). Async is `store.subscribe` plus imperative `fetchQuery` (`bench.ts:258-313`). Two different shapes; not peers. |
| R2 One statically readable state module — **non-negotiable** | 1 | One file, 674 lines. But the node graph is spread across `queryOptions`, five subscriptions, `actions`, and `feed`. You cannot read the nodes together. |
| R3 Automatic dependency tracking across `await` — **non-negotiable** | 0 | Manual query keys, manual selectors, manual equality functions. |
| R4 Dependent async as straight-line `await`, not `enabled:` — **non-negotiable** | 0 | The `if (session && doc && view)` guard (`bench.ts:290`) is `enabled:` in another spelling. `view.tsx:360` uses a literal `enabled:`. |
| R5 Exhaustive loading/error/data match at the read site — **non-negotiable** | 0 | `FeedState` is a string union that is never matched exhaustively. `FeedBadge` prints it (`view.tsx:181`). Read sites use `isPending`/`isError` if-chains. |
| R6 Consumers take the state object | 1 | Panes take `bench` from context. But `SuspensePlan` takes four positional props (`view.tsx:416-426`), and every row takes a `zone` prop. |
| R7 URL inputs; per-field schema and fallback; readable `k=v` | 1 | Schema and fallbacks are one declaration (`route:17-26`). The encoding is not readable — the report's own §7 shows `zones=["zone-001"]`. |
| R8 Escape hatch for input-writes-from-derived-reads | 1 | The session-to-doc write exists, with a manual identity guard (`bench.ts:270-272`). No cycle detection. |
| R9 Value objects capture reactive display config | 0 | Not attempted. |
| R10 Zero React lifecycle coupling | 2 | The strongest result in the proto. `bench.test.ts` builds and drives the whole route with no React rendered. |
| R11 Keep-previous-data on invalidation | 2 | `refetchType:"none"` keeps `state.data`. The stale feed still carries its options (`bench.ts:392-402`). |
| R12 Real `AbortSignal` threaded to the fetch | 0 | Absent. The report admits it at §4. `cancelQueries` marks the query; the mock timer keeps running. |
| R13 Explicit disposal tied to route lifetime | 2 | `retain()` / `destroy()` (`bench.ts:645-665`). The `queueMicrotask` Strict Mode workaround is fragile, but it works. |
| R14 Errors distinct from empty | 1 | Error is distinct. Empty is not (see census R15). |
| R15 Cache and dedup by key | 2 | React Query supplies it. |
| R16 Suspense and error-boundary interop | 1 | Suspense works. The error-boundary half is missing, and its absence is an active defect (Part A). |

**qr-repo total: 14 / 32. Non-negotiables R1–R5: 1 / 10.**

That 1 / 10 is the decisive number. The QR pattern's whole value is R1–R5. This proto scores one point across all five.

## D. Store-vs-view split

The headline result is genuinely good: **zero `useState` in any component.** Confirmed by grep across `view.tsx` and the route file.

| Hook | Site | Does it belong in the store? |
|---|---|---|
| `useEffect` | `view.tsx:21` `hydrateSearch(search)` | No. The router is the authority. This is the inbound bridge. Correct place. |
| `useEffect` | `view.tsx:22` `bench.start()` | No. Lifecycle bridge. Correct place. |
| `useEffect` | `view.tsx:23` `bench.retain()` | No. Lifecycle bridge. Correct place. |
| `useTransition` | `view.tsx:154` | No. React concurrency; view-local by definition. |
| `useMemo` | `route:41` `createBench(...)` | No. Composition root. |
| `useCallback` ×2 | `route:33,37` | No. Router adapters. |

Three effects, all lifecycle glue. No effect implements a waterfall, a clear, or an invalidation. That is a real win, and the report undersells it.

State logic that still lives inside components:

| Site | Lines | Judgment |
|---|:-:|---|
| `view.tsx:351-362` `useStatusZones` | 12 | **Belongs in the store.** It rebuilds `queryOptions.zones`, invents a placeholder key `["state-bench","zustand","zones","unbound"]` that `bench.ts` does not know about, and adds `enabled:`. A fourth cache key, created outside the key factory. |
| `view.tsx:40-44` and `:296` `cacheVersion` subscribe | 6 | **Belongs in the store.** A hand-rolled change-notification hack, because `feed()` is a pull function with no subscription of its own. `subscribeFeed` exists at `bench.ts:628`, but the view does not use it. |
| `view.tsx:561-569` Inspector query projection | 9 | **Belongs in the store.** Cache introspection inside a render body. |
| `view.tsx:368-371`, `412`, `466-468` guard chains | 7 | **Belongs in derived state.** "Not bound yet" is a feed state the store should name, not three re-implementations. |
| `view.tsx:503` `dirty` | 1 | **Belongs in the store.** The staging model owns dirtiness. |
| `view.tsx:179` and `:133` display expressions | 2 | View-local. Correct place. |
| `view.tsx:341-349` `useZoneBasis` | 9 | Selector only. Correct place. |

**About 35 lines of state logic in 632 view lines (5.5 %).** The split is good in the aggregate. It leaks in exactly one place worth naming: `useStatusZones`.

A real defect follows from that leak. `view.tsx:356` writes a cache key by hand. `destroy()` removes queries under `keys.root` (`bench.ts:664`), and `["state-bench","zustand","zones","unbound"]` is not under `keys.root`, which is `["state-bench","zustand",mode]`. That placeholder query is never cleaned up.

## E. Refutation

### The verdict, under attack

The report says **reject**. The judge tried to refute that and **could not**. The report's conclusion survives, and the judge's independent scoring is harsher than the report's: 1 / 10 on the QR non-negotiables. **Verdict not refuted.**

### Claim 1 — "Centralized importable object: 4 / 5"

**Refuted. The correct score is 3 / 5.**

`createBench()` is genuinely importable and React-free, and `bench.test.ts` proves it. But the object is not the single authority the score implies. The view creates a fourth query key outside the key factory (`view.tsx:356`), and that key escapes `destroy()`. `feed()` is a pull function with no notification, so the view invented `cacheVersion` (`view.tsx:42`) to know when to re-read it — a subscription mechanism that lives in the component layer, not in the object. An object whose consumers must hand-roll change notification for its own derived values is centralized in storage, not in authority.

### Claim 2 — "Mockable: 5 / 5"

**Refuted. The correct score is 3 / 5.**

Two independent problems, both confirmed by probe:

1. There is one host implementation. `createFixtureHost()` and `createMockHost()` both call `createHarness` (`model.ts:180-182`) and differ by two knob values. The probe printed `FIXTURE KNOBS: {"latencyMultiplier":0,"failureOn":false}`. The "swap" swaps knobs.
2. The test that names itself "fixture swap" has a constant condition. `bench.test.ts:17` is `const fixture = true;`. The `createMockHost()` branch is unreachable. The test proves the fixture host runs. It does not prove a swap.

The injected `MockHostHarness` seam is real and typed, so a third implementation would work. The proto never shows one. Per the mission's default: **refuted**.

### Claim 3 — §6 "only six logical components render" on hover

**Refuted.**

`Inspector` subscribes with the identity selector `useStore(bench.store, (value) => value)` (`view.tsx:551`). Every `setState` changes the state identity, so `Inspector` re-renders on every hover and runs a full `JSON.stringify` of the state tree plus a projection over the whole query cache (`view.tsx:558-573`). It sits inside a `<details>`, which does not stop React from rendering its children. `Inspector` does not call `markZoneRender`, so the proto's own counter cannot see it. The counter measures zone components only. The report reports it as total components.

The counter has a second flaw. `actions.hover` calls `metrics.reset()` on entry (`bench.ts:519`). A move between two zones fires `mouseleave` then `mouseenter` as two separate dispatches, and each one resets the counter. The report's "12 invocations for a move between zones" cannot be what a single reading of that counter shows.

### Claim 4 — §5 "the five named cases … fourth zones-call error"

**Confirmed at the store level. Refuted at the route level.**

`bench.test.ts:73-90` genuinely proves the error feed. But no error boundary exists in the proto. `useSuspenseQuery` (`view.tsx:427`) throws on that same failure. In the browser, the one-in-four rejection removes the Plan pane and unwinds past all three `<Suspense>` boundaries. The report's §8 browser proof reports a successful adopt and a successful `docChanged`. It never reports exercising the failure knob in the browser. The failure path is proved only where it is easy to prove.

### Claim 5 — §7 "Refresh replaces host data but does not silently overwrite the staged rename map"

**Technically true, and misleading.**

Refresh does preserve staged renames. **Adopt destroys them and never sends them.** Probe: `ADOPT PAYLOAD: [["zone-001"]]`, `STAGED AFTER: {}` (`bench.ts:574-575`). The sentence in §7 is written about the safe verb, while the unsafe one goes unmentioned. This is the proto's most serious functional defect, and the report does not contain it.

### Found by the judge; absent from the report

| Finding | Evidence |
|---|---|
| Adopt silently discards staged renames | `bench.ts:574-575`; probe output |
| No error boundary. A `useSuspenseQuery` failure kills the route | `view.tsx:427`. A grep for `ErrorBoundary` returns nothing. |
| Unbound feeds assert `fresh` with no read | `bench.ts:414,418,424,432,441`; probe output |
| Sessions never re-read after `sessionGone` | `bench.ts:347` invalidates with `refetchType:"none"`, and the session subscriber returns early on `null` (`bench.ts:267`). Probe: the session feed stayed `stale` with no recovery path. |
| A placeholder query key escapes `destroy()` | `view.tsx:356` against `bench.ts:664` |
| `useMemo` in the route can build two benches under Strict Mode. The discarded one keeps a host event subscription. | `route:41-52`; `bench.ts:356` |
| Layout: hiding the Plan adds a fourth grid child to a three-column grid | `view.tsx:70-91` |

## F. Pattern grafts

Three things a different winner should steal.

| # | Graft | Why |
|---|---|---|
| 1 | **`stale` from `isInvalidated`, with `refetchType:"none"`.** `bench.ts:327-328`, `392-402`. | This is the first real producer for `FeedState.stale` in the whole census. It answers open question Q2 with a mechanism instead of an opinion: invalidate without a refetch, keep the previous data, project `stale`, then re-read on the user's or the verb's schedule. It also gives R11 (keep-previous-data) for free, and `refusal()` consumes it immediately (`bench.ts:452`). Any winner should copy this exact shape. |
| 2 | **The React-free controller object, with `retain()` and `settle()`.** `bench.ts:150`, `636-653`. | `settle()` is the quiet win. A deterministic "all reads are idle" await turns a five-case async route test into 107 readable lines, with no fake timers and no `waitFor`. `retain()`, with microtask-deferred disposal, survives the Strict Mode double-mount probe without a `useRef` hack. Both belong in whichever architecture wins. |
| 3 | **Zero `useState` in the view, enforced by making the object the only writer.** All of `view.tsx`. | The 114 `useState` calls across the three censused routes go to zero here, and the three surviving effects are all lifecycle bridges. This proves the target split is reachable. It also shows where it leaks: the one place a component reached for state logic (`useStatusZones`) is exactly the place where the object failed to offer a subscription for its own derived value. The lesson to steal: **a derived value must ship its own subscription, or the view will invent one.** |

Honourable mention, not a graft: `useShallow` for tuple selectors is a Zustand-specific ergonomic. It does not transfer.

VERDICT: reject — the proto proves the React-free controller and gives the census its first real `stale` producer, but it scores 1/10 on the QR pattern's five non-negotiables, and the judge found two faked scenario behaviours (Adopt silently discards staged renames; unbound feeds assert `fresh`) plus a missing error boundary that the report does not mention.
