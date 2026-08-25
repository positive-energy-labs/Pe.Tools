# Judge — jotai

Adversarial review of candidate `jotai` against `SCENARIO.md`, census §10 (R1–R20), and
qr-repo §6 (R1–R16). All `store.ts`, `view.tsx`, `bench.test.ts` paths are relative to
`source/pe-tools/apps/web/src/state-bench/jotai/`. `route` is
`source/pe-tools/apps/web/src/routes/state-bench.jotai.tsx`.

## 0. Proof lanes I ran myself

| Lane | Command | Real result |
| --- | --- | --- |
| Test | `vp test src/state-bench/jotai/bench.test.ts` from `apps/web` | **PASS** — 1 file, 5 tests, 549 ms. `vp run @pe/web#test -- state-bench` does not work; `vp run` does not forward the filter. |
| Check | `vp check apps/web/src/state-bench/jotai apps/web/src/routes/state-bench.jotai.tsx` | **PASS** — 4 files formatted, no lint or type errors. |
| Route registration | `src/routeTree.gen.ts:32,138` | Registered. |
| Devtools artifact | `devtools.png`, 155 859 B | Real screenshot. Shows the route, 500 rects, Atom Viewer, `hostPushEffect` / `routerSearch` / `sessionsQuery` labels, and `<unlabeled-atom40>`. |
| Versions | installed | jotai 2.20.2, jotai-tanstack-query 0.11.0, jotai-effect 2.4.1, jotai-devtools 0.14.0, react 19.2.7. The report agrees. |

The report's test claim is true. The report's `vp check` claim is true.

## A. Scenario compliance

| # | Requirement | Verdict | Evidence |
| --- | --- | --- | --- |
| A1 | Waterfall re-pick clears every descendant | met | Pure `pickBinding`, `store.ts:110-126`; asserted `bench.test.ts:48-68` |
| A2 | Every binding in URL search; reload restores | met | `route:8-17` `validateSearch`; `route:35` writes back; `store.ts:540-543` |
| A3 | `Feed` shape and 6 `FeedState` values | met | `store.ts:75-83`; adds a `basis` field |
| A4 | Feed `stale` after adopt, then auto re-read | met | `store.ts:672-682`; asserted `bench.test.ts:70-87` |
| A5 | 1-in-4 `listZones` rejection to an `error` feed | met | `store.ts:174-181`; `bench.test.ts:89-110`. Gated behind the failure knob, which the scenario also demands |
| A6 | Push `docChanged` invalidates doc + views + zones | **partial** | `store.ts:448-466`. The assertion (`bench.test.ts:112-125`) is satisfied by the hand-set flag at `store.ts:459` alone. The three `invalidateQueries` calls are never observed. See E2 |
| A7 | One-line fixture swap at the composition root | met | `route:29`; the same construction at `bench.test.ts:27` |
| A8 | No-React vitest test | met | I ran it. 5/5 pass. No React import |
| A9 | `<Suspense>` per pane with a per-pane fallback | **partial** | Three boundaries at `view.tsx:98,103,110`. Only the Plan can suspend (`view.tsx:351`). `loadable` (`view.tsx:314`) and `unwrap` (`view.tsx:389`) never throw, so two of the three fallbacks are unreachable code |
| A10 | `<Activity>` on the plan pane; state kept; cost noted | met | `view.tsx:104`. The report states honestly that hidden subscriptions keep firing |
| A11 | `useTransition` / `startTransition` on the pick | **partial** | `startTransition` at `view.tsx:165,342,383`. No `useTransition`, no `isPending`, no pending UI, no measurement. "The sentence stays responsive" is asserted, not shown |
| A12 | Hover across 3 panes at 500 zones, measured | **partial** | Instrumented at `store.ts:693-718`, shown at `view.tsx:139-154`. See E3: the numbers are not reproducible from the repo |
| A13 | Devtools wired | met | `view.tsx:128-134`, gated on `import.meta.env.DEV` |
| A14 | Cheapest inspector: whole tree + last 20 actions | met | `store.ts:469-486`; `slice(-20)` at `store.ts:539`; `view.tsx:428-443` |
| A15 | Knobs: latency, failure, fixture | met | `view.tsx:41-63` |
| A16 | Five state kinds kept visibly separate | met | URL `store.ts:247`; persisted `store.ts:392-395`; page `store.ts:379-391`; cache `store.ts:251-325`; derived `store.ts:397-433` |
| A17 | Refusals derived, never flagged | met | `deriveAdoptRefusal` `store.ts:128-139`, atom `store.ts:397`, re-checked `store.ts:656` |
| A18 | Verb bracket: busy + seconds counter + receipt toast | met | `store.ts:655-688` |
| A19 | `Open in RHVAC` demands r10 | met | `store.ts:399`; `view.tsx:289` |
| A20 | Recent folders max 8; pane widths persisted | met | `store.ts:606-608`; `store.ts:392-395` |
| A21 | Staging table shows staged renames and dirty rows | **partial** | Rows render (`view.tsx:406-426`), but `Adopt` sends only zone ids (`store.ts:669`) and then deletes the renames (`store.ts:681`). The staged edits go nowhere |
| A22 | Route compiles under `vp check` | met | I ran it. Pass |

Nothing is faked. Nothing is fully missing. Five items are partial, and one of them (A21) makes
the third pane a decoration.

## B. Census R1–R20

| # | Score | Evidence |
| --- | ---: | --- |
| R1 addressable, one mechanism | 2 | One `search` atom holds bindings, stage, and selection (`store.ts:85-94,247`) |
| R2 dependents cleared by declaration | 2 | `pickBinding` is a pure exported function. No effect (`store.ts:110-126`) |
| R3 machine-readable basis; freshness computed | 1 | `basis` is carried (`store.ts:80`), but `stale` is asserted by a side flag (`store.ts:459,676`) and `error` by a hand-kept map (`store.ts:336,575`) |
| R4 write declares the reads it invalidates | 1 | `touches:["zones"]` plus a key (`store.ts:660,672`), but the key tuple is retyped by hand and the flag is then set a second time |
| R5 optimistic and write-through are one mechanism | 0 | No optimistic path exists. Adopt is write-then-refetch only |
| R6 staged edits: home, lifetime, per-cell wire value | 1 | `staged` atom (`store.ts:381`) and a dirty column (`view.tsx:423`). The lifetime is never stated, and no cell shows what a write would send — because the write sends nothing (`store.ts:669`) |
| R7 write result enters the read model without cache surgery | 1 | No splices, which is good. But the write does not return into the model either; it re-reads. The freshness side needs manual surgery |
| R8 selection and hover first-class and shared | 2 | `search.zones` + `hover` atom + `zoneState` family, read by all three panes (`store.ts:435-446`) |
| R9 derived view order without a parent round trip | 1 | Not exercised (no filter or sort). The one derivation leaks into the view (`view.tsx:391`) |
| R10 verb bracket including typed failure kind | 1 | Four of five. Failure is a bare `Error` turned into a toast string (`store.ts:741-743`) |
| R11 refusal computable before the verb runs | 2 | `deriveAdoptRefusal`, pure and exported (`store.ts:128-139`) |
| R12 manifest is data, evaluated once | 0 | There is no manifest. Stages and verbs are JSX literals rebuilt each render (`view.tsx:269-311`) |
| R13 every derivation a pure exported function | 1 | Two are exported. `feeds`, `progress`, `seams`, `world`, and `refusal` are closures inside `createBenchAtoms`, reachable only through a store |
| R14 route mountable with an injected data source | 2 | `createBenchState(host, search)`. The test does exactly this (`bench.test.ts:19,27`) |
| R15 loading / empty / error / fixture are distinct | 2 | Six-state union. `isPending` is first-load only, so a background refetch is not collapsed into `loading` (`store.ts:212-233`) |
| R16 identity change has one reset protocol | 1 | Bindings use `pickBinding`. Host identity uses a different protocol: a `useMemo` rebuild plus a deferred `setTimeout` disposal (`route:30-40`) |
| R17 server data not shadowed by local edits without a merge rule | 0 | `staged` shadows zone names (`view.tsx:420`) with no merge rule, and adopt discards them (`store.ts:681`) |
| R18 cross-surface writes visible | 1 | Free cross-tab sync from `atomWithStorage` defaults only. Nothing deliberate |
| R19 no hand-maintained dependency list per derivation | 1 | Sync derivations track automatically. Async derivations do not: the zones key tuple is written at `store.ts:287`, `store.ts:298`, `store.ts:362-368`, and again in `refresh` (`store.ts:544`) |
| R20 freshness captions self-update or say they do not | 0 | `at` is captured and never rendered. The badge shows the state only (`view.tsx:250-267`). Worse: after a push, `invalidated` is never cleared (only `refresh` clears it, `store.ts:566`), so doc and views read `stale` forever |

**B total: 22 / 40.**

## C. qr-repo R1–R16

| # | Score | Evidence |
| --- | ---: | --- |
| R1 async derived declared as a peer of sync derived | 2 | `atomWithQuery` and `atom((get)=>…)` sit in one function body (`store.ts:251-433`) |
| R2 one route = one statically readable state module | 2 | Every node lives in `store.ts` and in one 37-key return literal (`store.ts:488-524`) |
| R3 automatic dependency tracking, including across `await` | 0 | Query keys are manual dependency arrays, restated four times for zones |
| R4 dependent async as straight-line `await` | 0 | It is `enabled:` config (`store.ts:266,277,288,310,321`). Straight-line `await` exists only in the imperative shadow copy `bootstrap` (`store.ts:625-653`) |
| R5 exhaustive loading/error/data match, statically enforced | 1 | `loadable` gives a real union and one pane matches it (`view.tsx:314-327`). The 6-state `FeedState` is matched by a ternary chain with a fallback (`view.tsx:251-258`). Nothing is enforced |
| R6 consumers take the state object | 2 | Every component takes `{ state }` only |
| R7 URL inputs: per-field schema + fallback, readable `k=v` | 1 | One declaration, but hand-written coercion, not a schema. `zones` is split on commas by hand (`route:57-59`) |
| R8 escape hatch for input-writes-from-derived-reads | 1 | `atomEffect` works outside React (`store.ts:448`, `store.ts:761`). There is no cycle detection, and the router two-way sync (`route:35,43` and `store.ts:540-543`) is an unguarded loop |
| R9 value objects capture reactive display config | 0 | Not attempted |
| R10 zero React lifecycle coupling | 2 | Proven by the passing no-React suite |
| R11 keep-previous-data on invalidation | 2 | `unwrap(zonesPromise, prev => prev ?? [])` (`store.ts:331`), used by the staging pane |
| R12 real `AbortSignal` threaded to the fetch | 0 | `MockHost` has no signal parameter (`store.ts:60-66`). The report admits this |
| R13 explicit disposal tied to route lifetime | 1 | `dispose()` exists (`store.ts:770-774`), but it needs a `setTimeout` hack to survive React's dev effect probe (`route:31-39`), and the four `atomFamily` maps are never pruned |
| R14 errors distinct from empty | 2 | `state:"error"` plus `note`, against `options: []` |
| R15 cache and dedup by key | 2 | One `QueryClient` for each state. Deliberate |
| R16 Suspense / error-boundary interop | 1 | Suspense yes. **There is no `ErrorBoundary` in the proto.** With failures on, the Plan's `use()` rejection escapes to whatever app-level boundary exists |

**C total: 19 / 32.**

## D. Store-vs-view split

| Unit | Lines | Note |
| --- | ---: | --- |
| `store.ts` types + pure functions | 1–140 | `pickBinding` and `deriveAdoptRefusal` are exported and pure |
| `store.ts` MockHost | 141–208 | Scenario-mandated, not state logic |
| `store.ts` atoms | 246–525 | 280 lines |
| `store.ts` actions | 527–749 | 223 lines |
| `store.ts` factory | 751–778 | |
| `view.tsx` | 490 | |
| `route` | 60 | |
| `bench.test.ts` | 126 | |

The split is genuinely good. The store holds 778 lines. The panes hold almost no state.

### State logic still inside components

| Site | What it is | Belongs in the store? |
| --- | --- | --- |
| `view.tsx:27-29` `useEffect` | fires `actions.bootstrap()` on mount | **Yes.** A declarative atom graph must not need an imperative kick. See E1 |
| `view.tsx:352-355` `useEffect` | sets `activity.mounted` true and false | No. This is the Activity probe the scenario asked for |
| `view.tsx:334,370,408` | `state.actions.countRender()` **in the render body** | **Yes, and rewrite it.** This is render-phase mutation of store-adjacent counters. It is impure, and the perf numbers are built on it |
| `view.tsx:391` | `zones.filter(z => search.zones.includes(z.id))` | **Yes.** A selected-zones atom is one line |
| `view.tsx:159-162` | four `?? []` feed unwraps | Yes. Minor |
| `view.tsx:200` | `[...new Set(["C:\\RHVAC", ...recentFolders])]` legal-options merge | **Yes.** This is a feed, computed in JSX |
| `view.tsx:423` | dirty test `staged !== undefined && staged !== zone.name` | Yes. One line |
| `route:24-31` | `useState` host pair, `useMemo` state, `useRef` timer | Composition root, so acceptable. But the `useRef` exists only for the disposal hack |
| `route:33-40` | connect-router effect plus deferred `dispose` | Half is owed to the store. The `setTimeout` is a React-dev workaround |
| `route:42-44` | `syncSearch(search)` effect | The other half of the unguarded two-way loop |

**Count: 2 `useEffect` in view components. 2 `useEffect`, 1 `useState`, 1 `useRef`, and 1
`useMemo` in the route. Approximately 35 lines of state logic remain in components, and
approximately 25 of those belong in the store.**

There is zero `useState` in the three panes. That is the best result the split can show.

## E. Refutation

### E1 — "State handles its own waterfalls: 3/5". Refuted down to 2/5.

The store holds **two** waterfall implementations of the same chain:

| Implementation | Where | Used by |
| --- | --- | --- |
| Declarative: 6 query atoms with `enabled:` | `store.ts:251-325` | The browser, after React mounts |
| Imperative: a hand-sequenced `await` ladder | `store.ts:625-653`, 29 lines | `view.tsx:28` on mount, and **every test** |

`liveState()` (`bench.test.ts:16-22`) calls `bootstrap()` before it subscribes to anything.
With `staleTime: Infinity`, the query atoms then read the cache and never fetch. Only
`sessionsQuery` is auto-mounted (`store.ts:762`). **The no-React suite therefore proves the
imperative ladder, not the atom graph.** The declarative waterfall — the thing under
evaluation — has no automated proof in this proto.

Related: `store.set(atoms.zonesQuery)` with no argument appears four times
(`store.ts:456-458,559,573,677`) to poke an observer by hand. That is the shape of a library
that does not handle its own waterfalls.

### E2 — "Push invalidation is explicit and test-covered". Refuted as proof.

`bench.test.ts:112-125` asserts that three feeds read `"stale"`. That value comes entirely from
`set(invalidated, new Set(["doc","views","zones"]))` at `store.ts:459`. Delete the three
`invalidateQueries` calls above it and the test still passes. The test covers a string flag.

Two real defects follow from the same flag:

1. **`stale` never clears after a push.** `invalidated` is cleared only inside `refresh()`
   (`store.ts:566`), and nothing calls `refresh` for doc or views after mount. The default
   `refetchType: "active"` refetch does arrive, the data becomes fresh, and the badge keeps
   saying `stale`. This is census R20's failure mode: a caption that lies quietly.
2. **The flag is replaced, not merged.** `store.ts:459` uses `new Set([...])`, unlike
   `store.ts:676`. A concurrent `folder` invalidation is dropped silently.

### E3 — "Hover: 15.6 ms, 4 zone renders, 2 commits". Refuted as unproven.

| Objection | Detail |
| --- | --- |
| No artifact | There is no script, no test, and no recorded output in the repo. The one artifact, `devtools.png`, reads `last hover: 0.00 ms · 0 zone components · 0 commits` |
| The metric is not frame time | `store.ts:701-711` measures handler to second `requestAnimationFrame`. That is two frames of wall clock, not a dropped-frame count. It cannot show a 60 fps violation |
| Internally inconsistent | Report §6 says Strict Mode invocations are reported and not divided away, and cites 2 002 for 1 001 consumers, a clean ×2. A hover that changes the highlight on two zones across two panes is 4 real renders, so the doubled figure must be 8, not 4 |
| The counter is impure | `countRender()` runs in the render body (`view.tsx:334,370,408`), so the number depends on React's scheduling of the very thing it measures |

The architecture claim underneath — `selectAtom` families give per-zone subscriptions — is
visible in the code (`store.ts:435-446`) and is credible. The number is not evidence.

### E4 — "Centralized importable object: 5/5". Down to 4/5.

`BenchState` is a facade over a closure, not a module. `store.ts` cannot be read as a state
module in qr-repo R2's sense. You read a 37-key return literal at `store.ts:488-524`, then
chase each key into the factory body. The route still owns five hooks and a `setTimeout`
disposal hack. Real, but not 5.

### E5 — "Mockable: 5/5". Upheld, with one deduction.

The swap is one conditional (`route:29`), the fixture host is a construction and not a branch,
and the suite runs green. I ran it. The deduction: the canned fixture dataset is the same
generator with the latency skipped and a different cache key (`store.ts:141,165`), so fixture
mode never exercises different data. Call it 4.5.

### E6 — The staging pane. New finding, not in the report.

`Adopt` sends `zoneIds` only (`store.ts:669`), then clears the rename map (`store.ts:681`).
Every staged rename is destroyed by the verb that is supposed to commit it. The report's §3 row
"Page memory — clear and testable" hides this. Census R6 and R17 both land on it.

### E7 — No error boundary.

A grep of `view.tsx` and the route finds no `ErrorBoundary`. The Plan reads `zonesPromise`
directly (`view.tsx:351`). Turn failures on, hit the 4th call, and the rejection propagates past
all three `<Suspense>` boundaries. The proto has a demonstrated failure mode that it never
renders.

### E8 — What survives

| Report claim | Status |
| --- | --- |
| 5 tests pass; `vp check` clean | **Upheld. I ran both** |
| The fixture swap is one line at the composition root | **Upheld** |
| Devtools shows ~2 000 unlabeled family atoms and needs an eager import | **Upheld.** `devtools.png` shows `<unlabeled-atom40>` |
| `atomFamily` and `loadable` are deprecated in 2.20.3 and removed in v3 | Upheld, and correctly weighted |
| Activity: hidden subscriptions keep firing | Upheld, and honestly reported as a rejection signal |
| SSR hydration was not proven | Upheld. The report says so itself |
| **Verdict: hybrid-with, not the repo-wide architecture** | **Upheld.** My findings push the same way, harder |

The report is unusually honest. Its self-criticism (§8, papercuts 1–3) is where the real
evidence is. Its scores are one point generous in two of the three rows.

## F. Pattern grafts

| # | Graft | Why the winner must steal it |
| --- | --- | --- |
| 1 | **`Feed.basis`: a machine-readable key tuple carried on every feed and rendered in the badge tooltip** (`store.ts:80`, `view.tsx:262`) | This is the one thing that answers census R3 directly, and it is library-independent. The proto proves the idea, then proves the failure mode too: carrying `basis` is worthless while `state` is set by a side flag. Graft `basis`, and derive `state` **from** it |
| 2 | **`createBenchState(host, initialSearch)` returning `{ store, atoms, actions, dispose }`, with the fixture swap as one conditional at the root** (`store.ts:751-776`, `route:29`) | Whole-environment construction beats fixture branches scattered through the graph. It gave a real no-React suite in 126 lines. Any winner must copy this shape, including `dispose()` — and must not need the `setTimeout` that this one needs |
| 3 | **Subscription-granularity instrumentation as first-class state**: a `perf` atom plus `countRender`/`countCommit` (`store.ts:693-718`), shown on-screen (`view.tsx:139-154`) | The report's §6 story — an accidental parent subscription cost 2 002 renders, and the on-screen counter made it obvious — is the strongest argument in the report. Graft the visible counter, but move the increment out of the render body into `Profiler` or `useEffect` |

## G. Score summary

| Axis | Score |
| --- | --- |
| A. Scenario | 17 met, 5 partial, 0 missing, 0 faked |
| B. Census R1–R20 | 22 / 40 |
| C. qr-repo R1–R16 | 19 / 32 |
| D. Store-vs-view | Strong. Zero `useState` in the panes; ~25 lines still owed to the store |
| E. Refutation | All 3 headline claims survive as directions. None survives as proof at its stated score |

VERDICT: hybrid — jotai's page-scoped store, fixture-by-construction, and per-zone selector families are worth grafting, but the proto's two parallel waterfall implementations, side-flagged freshness, sticky `stale` after a push, discarded staged renames, and unreproducible perf numbers show that the library owns neither the async protocol nor the freshness protocol, so it must not be the repo-wide state architecture.
