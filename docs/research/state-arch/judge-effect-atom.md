# Judge — candidate `effect-atom`

Adversarial review of `docs/research/state-arch/02-effect-atom.md` and the proto in worktree
`Pe.Tools-sb-effect-atom`. All `model.ts` / `bench.tsx` / `bench.test.ts` / `mock-host.ts` line
references are `source/pe-tools/apps/web/src/state-bench/effect-atom/<file>`. `route:` is
`source/pe-tools/apps/web/src/routes/state-bench.effect-atom.tsx`. `Hooks.ts:` is the installed
`@effect/atom-react@4.0.0-beta.92` source.

## 0. Lane facts the judge ran

| Command | Result |
| --- | --- |
| `vp run @pe/web#test -- state-bench` (from `source/pe-tools`) | **FAILS.** `error: Failed to plan tasks from 'vp run' in task @pe/web#test * Task "state-bench" not found` |
| `vp test src/state-bench/effect-atom/bench.test.ts` (from `apps/web`) | **PASS. 1 file, 5 tests, 1.18 s.** This is the command the report names |
| `vp check apps/web/src/state-bench/effect-atom apps/web/src/routes/state-bench.effect-atom.tsx` | **PASS.** "All 5 files are correctly formatted"; "Found no warnings, lint errors, or type errors in 5 files" |
| `.artifacts/runs/state-bench/effect-atom-inspector.png` | Present, 16 509 B |
| Route registration | Present in `src/routeTree.gen.ts:32,138` |
| `react` installed | 19.2.7. `Activity` is a real export (`react.development.js:795`) |
| `@effect/atom-react` installed | 4.0.0-beta.92, peer `react ^19.2.4`, peer `effect ^4.0.0-beta.92` |

The report's test and check claims are true. The report's own correction of the test command is
also true. Physical line counts: `model.ts` 584, `mock-host.ts` 173 (= 757 store/host, as claimed),
`bench.tsx` 482 + `route` 21 = 503 (report says 500), `bench.test.ts` 114.

---

## A. Scenario compliance

| # | SCENARIO requirement | Verdict | Evidence |
| --- | --- | --- | --- |
| A1 | Re-picking a parent clears every descendant | **met** | Pure `pickSearch` `model.ts:94-99`; test `bench.test.ts:34-53` |
| A2 | Every binding lives in URL search params | **met** | `route:8` + `model.ts:74-82`; all 7 keys typed |
| A3 | `Feed = {options,state,at,note}` with the 6 states | **partial** | Shape `model.ts:24-29`; `at` is stored (`model.ts:139`) and **never rendered** (no `.at` reference in `bench.tsx`); `live` is produced for `sessions` only (`model.ts:257`) |
| A4 | Feed goes `stale` after adopt, then re-reads | **met** | Set `model.ts:342`; projected `model.ts:125,131`; cleared on success `model.ts:237`; test `bench.test.ts:55-70` |
| A5 | 1-in-4 `listZones` failure surfaces as `error` | **partial / faked in the UI** | Store proven (`mock-host.ts:132`, test `bench.test.ts:72-88`). But `useAtomSuspense` **throws** on Failure (`Hooks.ts:409-411`; its own docstring, `Hooks.ts:392-393`: "callers need an error boundary for failures"), the panes call it with no `includeFailure` (`bench.tsx:352`), and `grep -rn "ErrorBoundary\|errorComponent" apps/web/src` returns **zero hits**. With the knob on, the 4th read blanks all three panes and the route |
| A6 | Push `docChanged` invalidates doc + views + zones | **met** | `model.ts:372-381`; test `bench.test.ts:90-113` |
| A7 | One-line fixture swap at the composition root | **met** | `model.ts:521`; injection seam `model.ts:148-151`, root `model.ts:583` |
| A8 | Vitest with no React | **met** | `bench.test.ts` imports zero React; judge ran it, 5/5 |
| A9 | Each pane `<Suspense>`-wrapped, per-pane fallback | **met, thin** | `bench.tsx:315,321,332`. All three suspend on the **same** atom (`bench.tsx:351-353`), so they always fall back together. No pane has independent async |
| A10 | Both styles: suspend and hand-you-status | **met** | Suspend `bench.tsx:352`; status `bench.tsx:53-58` reading Feed atoms |
| A11 | `<Activity>` on the Plan pane, state kept | **met (render) / claim unproven (cost)** | `bench.tsx:320`. The subscription-cost conclusion is not measurable by this design — see E1 |
| A12 | `useTransition` / `startTransition` on the pick | **partial** | `route:15-17`. Only `navigate` runs in the transition; `isPending` is discarded, so there is no pending affordance and no proof the sentence stayed responsive |
| A13 | Hover across 3 panes at 500 zones, measured | **partial** | `model.ts:409-426` + markers `bench.tsx:366,398,439`. Self-instrumented counter, dev StrictMode, 1 sample, single mouse-enter. No frame time over a sweep. It rejects a 1 500-row re-render; it does not measure 60 fps |
| A14 | Devtools or cheapest inspector: whole tree + last 20 actions | **met** | `model.ts:542-569`, `bench.tsx:466-481`, screenshot present |
| A15 | Staging table: staged renames, dirty rows | **met** | `stagedAtom` family `model.ts:206-208`; dirty rows `bench.tsx:441-450` |
| A16 | `Adopt` commits the staged edits | **partial** | `model.ts:339` sends only `zoneIds`. `model.ts:343` then **discards** every staged name. The SCENARIO host signature cannot carry names, so this is a scenario ambiguity, not only a proto fault — but the silent discard is data loss |
| A17 | Adopt refuses on `stale` / `loading`; busy + seconds; receipt toast | **met** | `model.ts:102-111`, `model.ts:318-330`, `model.ts:340-341`, `bench.tsx:270-274` |
| A18 | Refusal reasons DERIVED, never flagged | **met** | `model.ts:304-306`; the view reads one string (`bench.tsx:239,266`) |
| A19 | `Refresh zones` re-reads and marks fresh | **met** | `model.ts:314-317` + `model.ts:237` |
| A20 | `Open in RHVAC` (nav; demands r10) | **partial** | `bench.tsx:250-258` disables without `r10`, but the verb only writes a toast (`model.ts:359`). No navigation |
| A21 | Persisted recents max 8, pane widths | **met** | `model.ts:479-495` |
| A22 | Hover is page memory, NOT URL | **met** | `model.ts:195,200-202`; hover never enters `pickSearch` |

Counts: **13 met, 8 partial, 1 partial-faked, 0 missing.**

---

## B. Census R1–R20

| # | Score | Evidence |
| --- | ---: | --- |
| R1 addressable, one mechanism | **2** | All 7 bindings are URL search; one `validateSearch` (`model.ts:74-82`) |
| R2 dependents cleared by declaration | **2** | `pickSearch` is a pure function, not an effect (`model.ts:84-100`) |
| R3 machine-readable basis, freshness computed | **1** | `Timed<A>` carries `at` (`model.ts:52-55,117`), but freshness comes from flags, not from `at`; an **unbound** link returns `Effect.succeed({value:null,at:Date.now()})` and projects `fresh` (`model.ts:225,128-138`) |
| R4 write declares invalidation at the read's identity | **2** | `registry.refresh(<atom>)` names the read itself (`model.ts:364-381`). Strictly better than `queryKey[2]` predicate matching |
| R5 optimistic and write-through are one mechanism | **1** | Only write-through exists (`model.ts:332-353`). No optimistic path is exercised |
| R6 staged edits: declared home, stated lifetime, per-cell "what a write sends" | **1** | Home is `stagedAtom` (`model.ts:206`). Lifetime is never stated. The write sends nothing staged (`model.ts:339`) |
| R7 write result returns without cache surgery | **2** | No splices. Receipt to `receiptAtom`, then a re-read (`model.ts:340-345`) |
| R8 selection and hover first-class, shared, separable | **2** | `selectedAtom` / `hoveredAtom` families; the three panes take **zero** selection props (`bench.tsx:365,397,438`) |
| R9 derived view order without a parent round trip | **1** | Not exercised. No filter, sort, or cursor exists in the proto |
| R10 verb bracket: identity, elapsed, receipt, typed failure kind, links touched | **1** | Identity, elapsed and receipt are present (`model.ts:318-330,340`). Failure is a bare `Error` (`model.ts:351`). Links touched are implicit in `setTimeout(refreshZones, 60)` (`model.ts:345`), not declared |
| R11 refusal computable before the run | **2** | `adoptRefusal` is pure and exported (`model.ts:102-111`) |
| R12 manifest is data, evaluated once | **0** | No manifest exists. The verbs are JSX literals rebuilt each render (`bench.tsx:243-276`) |
| R13 derivations are pure exported functions | **2** | `validateSearch`, `pickSearch`, `adoptRefusal` exported and tested. Zero hooks in `model.ts` |
| R14 route mountable with an injected data source | **1** | The **store** is injectable (`model.ts:148-151`, proven by the test). The **route** is not: `bench.tsx:7` and `route:5` import the module singleton, so the React tree can hold exactly one instance. `RegistryContext.Provider` (`bench.tsx:13`) is decorative — the hooks read the registry from context, but every dispatch and every atom key comes from the singleton |
| R15 loading / empty / error / fixture are four distinct states | **1** | Error and fixture are distinct. Empty is **conflated with fresh** (see R3) |
| R16 identity change has one reset protocol | **1** | `syncSearch` resets `selectedAtom` only (`model.ts:388-393`). `stagedAtom` is cleared **only on adopt** (`model.ts:343`). Zone ids are `zone-N` in every session and view (`mock-host.ts:76`), so a staged rename on `zone-1` survives a session re-pick and re-attaches to a different document's `zone-1` |
| R17 server data not shadowed by local edits without a merge rule | **0** | `view.stagedName ?? zone.name` (`bench.tsx:381,458`). A refreshed host name is discarded silently. This is S23 reproduced exactly |
| R18 cross-surface writes visible | **0** | Nothing. One tab, one registry |
| R19 no hand-maintained dependency list per derivation | **2** | `get()` tracking is automatic; zero dep arrays and zero eslint suppressions in `model.ts` |
| R20 freshness captions update on their own or say they do not | **0** | `at` is captured and never displayed. The UI shows the state word only (`bench.tsx:140`). No caption, and no statement that there is none |

**Total 25 / 40.** Strong on addressability, derivation purity, and shared selection. Weak on
freshness honesty, staged-edit lifetime, and manifest.

---

## C. qr-repo R1–R16

| # | Score | Evidence |
| --- | ---: | --- |
| R1 async derived declared as a peer of sync derived | **2** | `Atom.make((get) => value)` and `Atom.make((get) => Effect)` are the same constructor, adjacent in one file (`model.ts:221-306`). This is the best single result in the proto |
| R2 one route = one statically readable state module | **2** | `model.ts`, 584 lines, every node visible together (`model.ts:159-306`) |
| R3 automatic dependency tracking, **including across `await`** | **1** | Tracking works inside the atom body. `get` is not usable after an `await`: every dependency is read synchronously before the Effect is returned (`model.ts:222,228,234`). W1 is avoided, not fixed |
| R4 dependent async as straight-line `await`, not `enabled:` config | **1** | Every read is guarded by a ternary on URL strings — `session && doc && view ? read : Effect.succeed(empty)` (`model.ts:235-239`). That is `enabled:` re-spelled inline. **No atom awaits another atom's result** |
| R5 exhaustive loading/error/data match, statically enforced | **1** | `if (isInitial) … if (isFailure) … return` (`model.ts:124-140`). No exhaustive matcher, no compile-time enforcement |
| R6 consumers take the state object, not values | **2** | Panes read atoms by key; adding a node costs zero call-site edits (`bench.tsx:367,399,440`) |
| R7 URL inputs: per-field schema + fallback, one declaration | **2** | `model.ts:74-82`, readable `k=v` for six of seven fields; `zones` is an array |
| R8 escape hatch for input-writes-from-derived-reads, with cycle detection | **1** | The hatch exists and is used — `registry.set(zonesStaleAtom, false)` **inside a read Effect** (`model.ts:237`) while `zonesFeedAtom` reads both (`model.ts:270-279`). No cycle detection. It works by luck of ordering |
| R9 value objects capture reactive display config | **1** | Not exercised. `Atom.family` could carry it; nothing does |
| R10 zero React lifecycle coupling | **2** | `createEffectAtomBench` is a plain function; the whole suite runs headless. Proven, not asserted |
| R11 keep-previous-data on invalidation | **2** | AsyncResult keeps Success with `waiting`; `useAtomSuspense` defaults `suspendOnWaiting:false` (`Hooks.ts:408`), so panes keep prior rows. Note: `resultFeed` maps `waiting → "loading"` (`model.ts:134`), which takes Q3's disputed side without saying so |
| R12 real `AbortSignal` threaded | **0** | `Effect.tryPromise` with no signal (`model.ts:113-117`). The report admits it |
| R13 explicit disposal tied to route lifetime | **1** | `testing.dispose()` exists (`model.ts:574-578`) and **nothing calls it**. The module singleton (`model.ts:583`) builds two hosts and subscribes to both at import time (`model.ts:382-383`) |
| R14 errors surface distinctly from empty | **1** | Error is distinct. Empty is not (see B/R15) |
| R15 cache / dedup by key | **2** | `Atom.family` plus registry node identity (`model.ts:200-215`) |
| R16 Suspense / error-boundary interop | **1** | Suspense yes. Error boundary absent, and the library requires one |

**Total 22 / 32.** The pattern's headline requirement (R1) is fully satisfied. Its second headline
(R4, straight-line dependent `await`) is not demonstrated at all.

---

## D. Store-vs-view split

| Metric | Count | Detail |
| --- | ---: | --- |
| `useState` in components | **0** | None in `bench.tsx` or `route` |
| `useReducer` / `useMemo` / `useCallback` / `useRef` in components | **0** | None |
| `useEffect` in components | **2** | `bench.tsx:20`, `route:16` |
| `useTransition` in components | **1** | `route:15` |
| Lines of state logic inside components | **2** | `bench.tsx:20`, `bench.tsx:441` |

| Hook / line | Belongs in the store? | Why |
| --- | --- | --- |
| `bench.tsx:20` `useEffect(() => state.dispatch.hydratePersisted(), [])` | **Yes** | Hydration is store lifecycle. `createEffectAtomBench` or `connect()` can call it. A `persistedHydrated` guard already exists (`model.ts:497`), so the hook adds a React dependency and nothing else |
| `route:16-19` `useEffect(() => state.connect(search, go))` | **No** | Correct. This is the router-to-store seam and must live where the router hook lives |
| `route:15` `useTransition` | **No** | Correct. The transition wraps `navigate`, which is a React concern |
| `bench.tsx:441` `const dirty = view.stagedName !== null` | **Yes** | One-line derivation. `zoneViewAtom` (`model.ts:209-215`) already computes `stagedName` and should emit `dirty` |
| `bench.tsx:280` `useAtomValue(state.atoms.search).zones.length` | Marginal | The only place a component reaches into `search` to compute a value. Trivial |

Everything else in the view is presentation: grid template (`bench.tsx:312`), fill ternary
(`bench.tsx:407`), reason strings (`bench.tsx:257,267`), count text (`bench.tsx:82`).

**Assessment: this is the cleanest split the bake-off is likely to see.** Zero `useState` across a
482-line view with three synchronized 500-row panes is the real result of this proto, and it is not
an artifact of the reporter's prose — it is verifiable by grep.

---

## E. Refutation

The default is "refuted" when the proto does not prove the claim.

| # | Claim from the report | Verdict | Basis |
| --- | --- | --- | --- |
| **E1** | §6: "Registry inspector counts were **519 subscribed nodes visible and 519 hidden**. **Therefore** beta.92's atom subscriptions keep firing while the Activity subtree is hidden" | **REFUTED — the experiment cannot discriminate** | The 500 per-zone subscriptions are on `zoneViewAtom(id)` (`model.ts:209`), and **all three panes subscribe to the same 500 atoms** (`bench.tsx:367,399,440`). Hiding the Plan pane cannot lower the count, because `ZoneList` and `StagingTable` still hold every key. 519 = 500 shared zone atoms + 19 top-level, hidden or not. Separately, `useAtomValue` subscribes through `React.useSyncExternalStore` (`Hooks.ts:57`) and `useAtomMount` through `React.useEffect` (`Hooks.ts:166`) — both are passive effects, which React 19.2 **does** unmount inside a hidden `<Activity>`. The number is also read by `inspect()` during the same render pass that hides the subtree (`bench.tsx:467-478`), before commit. The stated conclusion is a non-sequitur, and it points the wrong way |
| **E2** | §9: "State handles its own waterfalls — **4/5**" | **REFUTED, ~2/5** | There is **no dependent async** in the proto. `docResult`, `viewsResult`, `zonesResult`, `folderResult` and `r10Result` are five independent fan-outs off URL strings, each gated by a ternary (`model.ts:221-252`). No atom reads another async atom's value. The one machine-driven chain the scenario demands — adopt → stale → automatic re-read — is a **magic 60 ms sleep** (`model.ts:345`), and the test compensates with a 75 ms sleep (`bench.test.ts:63`). Push invalidation is a **hand-written list of three atoms** (`model.ts:377-379`), and a knob change calls `refreshAll()`, which refreshes all six unconditionally (`model.ts:364-371`). The library's dependency tracking is real; the scenario's waterfall is carried by the URL and by the human, not by the state layer |
| **E3** | §9: "Centralized importable object — **5/5**" | **DOWNGRADED, not 5/5** | The **store** scores 5: `createEffectAtomBench(live, fixture)` is injectable and headless (proven, `bench.test.ts:22`). The **view** scores 2: `bench.tsx:7` imports the module singleton, so every dispatch call and every atom key is bound to one instance. You cannot mount two benches, and you cannot render the route against the test's injected harness. The report's own SSR papercut is a symptom of the same shape |
| **E4** | §5 and §8: "All five required no-React cases pass"; "5/5 passing"; "zero warnings/type errors" | **CONFIRMED** | The judge ran both. 5/5 tests, `vp check` clean on all 5 files. The report is honest here, including about the wrong `vp run` command |
| **E5** | §8 papercut 2: "beta.92 caches promises globally by Atom, not Registry" | **CONFIRMED** | `atomPromiseMap` is a module-level `Map<Atom, Promise>` (`Hooks.ts:335-338`), consulted before the registry is used (`Hooks.ts:345-346`). The SSR blocker is real |
| **E6** | §5: the fixture is a "canned in-memory dataset" | **PARTIAL** | The fixture is the **same generator** with `latency = 0` (`mock-host.ts:92-94`). It is not a distinct canned dataset, so a fixture run cannot detect a live-shape regression. The `FeedState = "fixture"` projection is real (`model.ts:132`) |
| **E7** | §6: "0.300 ms … 6 component executions … at 500 zones" | **PLAUSIBLE, weakly proven** | The mechanism checks out: `hover()` writes at most two family atoms (`model.ts:413-416`), 3 components share each key, StrictMode doubles render bodies → 6. But it is self-instrumentation (`model.ts:411,422`), one sample, dev mode, and a single mouse-*enter*, not a sweep. Also unmeasured: `dirtyCountAtom` reads all 500 `stagedAtom`s on every keystroke in the staging table (`model.ts:301-303`), and two top-level components subscribe to it (`bench.tsx:241,281`) |
| **E8** | §7: "This separation is visible in the inspector" | **PARTIAL** | `inspect()` uses non-subscribing `registry.get` calls (`model.ts:545-567`), and `Inspector` subscribes to only 7 atoms (`bench.tsx:467-473`). `page.hover` is therefore **stale in the inspector** — the one field a hover demo would want |
| **E9** | Overall verdict: "conditional reject for the long-lived architecture; keep as a hybrid option" | **UPHELD, partly for other reasons** | The report's blockers (beta churn, global suspense map, no devtools) are all confirmed. But the report **under-reports the proto's own defects**: no error boundary on a required failure path, staged renames that bleed across bindings, staged renames discarded on adopt, empty projected as `fresh`, and no freshness caption at all |

### Defects the report does not mention

| # | Defect | Repro |
| --- | --- | --- |
| D1 | The failure knob blanks the whole route | Turn on `failure`, press `refresh zones` until call 4. `useAtomSuspense` throws (`Hooks.ts:410`); no boundary exists in `apps/web/src` |
| D2 | Staged renames bleed across bindings | Rename `zone-1`, then re-pick `session`. `syncSearch` clears `selectedAtom` only (`model.ts:388-393`); `stagedAtom("zone-1")` survives and re-attaches to the new document's `zone-1` |
| D3 | Adopt discards staged names | `model.ts:339` sends ids; `model.ts:343` nulls the staged names. No user-visible warning |
| D4 | Unbound links report `fresh` | Load with no `session`. `docFeed.state === "fresh"` with zero options (`model.ts:225` → `model.ts:128-138`) |
| D5 | `Date.now()` inside a derivation | `folderFeedAtom` stamps `at: Date.now()` on every recompute (`model.ts:284`). The timestamp describes the render, not the read |
| D6 | The singleton subscribes to two hosts forever | `model.ts:382-383` runs at module scope; `dispose()` is never called by any route |

---

## F. Pattern grafts — what a different winner should steal

| # | Graft | Why it transfers |
| --- | --- | --- |
| **F1** | **Fixtures replace the capability root, not individual reads.** One writable node holds the whole `MockHost`; the swap is `registry.set(hostAtom, fixture ? fixtureHost : liveHost)` (`model.ts:521`), and the same seam is the test's constructor argument (`model.ts:148-151`, `bench.test.ts:20-28`) | This is library-independent. It answers census R14 for **any** candidate, and it is why the no-React test is 114 lines instead of a mock-server harness. Contrast with the census reality: `?source=fixture` in a browser, or a live host |
| **F2** | **One per-entity view node, three consumers.** `zoneViewAtom(id)` bundles `{hovered, selected, stagedName}` (`model.ts:209-215`); the three panes subscribe by id and take **zero** selection props (`bench.tsx:367,399,440`) | This is the direct answer to census R8 and to the 8- and 9-prop pane signatures in §9.3. It removes the selector-factory tax without a memoization library. Any winner with keyed reactive state can copy the shape without change |
| **F3** | **Split the async node from the domain projection.** The Effect node returns `Timed<A>` (`model.ts:113-117`); a separate derived node turns `AsyncResult` plus flags into a domain `Feed` (`resultFeed`, `model.ts:119-141`) | One place converts library async state into `FeedState`. It is where `stale`, `fixture` and `waiting` policy live, and it is the only file to edit when Q2 and Q3 are answered. A TanStack or signals winner should keep this seam although its inputs differ |
| **F4** | **`inspect()` returns the state-kind taxonomy, not a blob.** `{search, persisted, page, feeds, registry, actions}` (`model.ts:542-569`) | The cheapest devtools **and** an executable proof of the SCENARIO's five-kind separation table. Every candidate should ship this function whether or not its library has devtools — but fix E8 first: subscribe to what you print |

---

## Summary

| Axis | Result |
| --- | ---: |
| Scenario compliance | 13 met / 8 partial / 1 faked / 0 missing |
| Census R1–R20 | 25 / 40 |
| qr-repo R1–R16 | 22 / 32 |
| `useState` in components | 0 |
| Misplaced state logic in components | 2 lines |
| Report claims refuted | 2 of the 3 strongest (E1, E2); a third downgraded (E3) |

The store/view split is the best possible outcome, and it is real. The waterfall claim is not: this
proto has no dependent async, only URL-gated fan-out plus a 60 ms sleep. The library's own defects
(module-global Suspense promise map, no atom devtools, beta churn) are confirmed as reported, and
the proto adds six unreported defects of its own — one of which, no error boundary on a required
failure path, leaves the scenario's failure requirement unproven in the browser.

VERDICT (round 2): hybrid — graft the host-atom fixture swap, the per-entity view node and the Feed projector into whichever candidate wins, but do not make a beta-tagged `effect/unstable/reactivity` with no devtools, no error-boundary story and no demonstrated dependent async the default state layer.

---

## Round 3

Commit `26e719a` "research(state-bench): effect-atom round 3 — native v4 primitives".
`model.ts` 584 → **757**, `bench.tsx` 482 → **567**, `mock-host.ts` 173 → **177**, `bench.test.ts`
114 → **113**, route 21 → 21. Report LOC claims (934 store/host, 588 view/route, 113 tests) are
exact.

### R3.0 Lane facts the judge ran

| Command | Result |
| --- | --- |
| `vp test src/state-bench/effect-atom/bench.test.ts` | **PASS. 5 tests, 910 ms.** The 75 ms sleep is gone from the suite |
| `vp check` on the 5 proto paths | **PASS.** Formatted; no warnings, lint errors, or type errors |
| Judge probe (8 extra cases, written and then deleted) | 8 run; results below. Worktree left clean |

The judge's probe file was removed after the run; `git status` shows no proto changes.

### R3.1 Does the waterfall claim now hold? **YES — proven.**

The chain is real: `docSource` awaits `sessionsResult`, `viewsResult` awaits `docResult`,
`zonesSource` awaits `viewsResult`, `r10Result` awaits `folderResult` — each with
`yield* get.result(parent, { suspendOnWaiting: true })` **inside `Effect.gen`**
(`model.ts:299,317,334,363`).

The discriminating fact: **`viewsResultAtom` has no reactivity key and never reads `docResultAtom`
in its atom body.** Its body reads `get(hostAtom)` only (`model.ts:315`). The only path from doc to
views is the `get.result` call inside the generator.

Traced invalidation, probe **P1** — `emit("sessionGone")` → `Reactivity.invalidate(["sessions"])`
(`model.ts:523`), one key, one node:

```
P1 delta {"sessions":1,"doc":1,"views":1,"zones":1,"folder":0,"r10":0,"adopt":0}
```

One key invalidated → three generator hops re-ran → and the unrelated folder/r10 branch was **not**
touched. `get.result` tracks across the generator, and the cascade is directional. Round 2's E2
("no dependent async exists") is **fully refuted by the round-3 code**. The magic
`setTimeout(refreshZones, 60)` is gone (`grep -c setTimeout model.ts` = **0**, was 1), and
`registry.refresh` calls fell from **11 to 1**.

Probe **P8** confirms the guard: an event for a session that is not bound produces a zero delta.

### R3.2 Delta table — Scenario (section A)

| # | Requirement | R2 | R3 | What changed |
| --- | --- | --- | --- | --- |
| A3 | Feed shape, 6 states, `at` | partial | **met** | `feedCaption` renders `new Date(feed.at).toLocaleTimeString()` (`bench.tsx:525-528`, used at `99,158`); `stale` now has a real producer — `result.waiting` (`model.ts:163-164`) |
| A5 | 1-in-4 failure → error | partial/faked | **met** | `PaneErrorBoundary` per pane with `resetKey` and a retry verb (`bench.tsx:337-364,537-567`) |
| A12 | transition on pick | partial | **met** | `pending` is surfaced (`route:15,20`; `bench.tsx:78`) |
| A16 | Adopt commits staged edits | partial | **partial (honest)** | Renames survive adopt and the toast says why (`model.ts:483-486`); probe P4 confirms `staged=RENAMED`, `dirty=1` after adopt. The host still cannot carry names |
| A4 | stale after adopt | met | **met, better** | `Reactivity.invalidate(["zones"])` inside the mutation effect (`model.ts:489`) instead of a 60 ms sleep |
| A7 | one-line fixture swap | met | **met, better** | Fixture is now a distinct dataset (`Fixture Zone 001`, `load+1`; `mock-host.ts:112,133-137`). Probe P7 confirms the whole chain re-reads with fixture data |
| A9 | Suspense per pane | met, thin | met, thin | Still one atom behind three boundaries (`bench.tsx:382`) |
| A11 | Activity | met / claim unproven | **met / claim withdrawn** | The report now states the round-2 census "was a whole-registry census, not proof". Correct, and it matches E1 |
| A13 | hover at 500 zones | partial | **partial, citation stale** | See R3.5/N4 |
| A20 | Open in RHVAC (nav) | partial | partial | Still a toast (`model.ts:510`) |

**Scenario totals: 13 met / 8 partial / 1 faked → 17 met / 5 partial / 0 faked.**

### R3.3 Delta table — Census R1–R20 (25/40 → **35/40**)

| # | R2 | R3 | Evidence for the change |
| --- | ---: | ---: | --- |
| R3 basis-driven freshness | 1 | **2** | `Timed<A>` now carries `bound` (`model.ts:54-58,145-146`); `resultFeed` computes from `isInitial` / `isFailure` / `bound` / `waiting` (`model.ts:148-172`). No asserted state left |
| R5 optimistic + write-through one mechanism | 1 | **2** | `Atom.optimistic` + `Atom.optimisticFn` is one mechanism (`model.ts:420-422,494-501`) |
| R6 staged edits home + what a write sends | 1 | **2** | `StagedRename {base,next}` (`model.ts:66-69`), `AdoptInput.renames` (`model.ts:70-73,695-700`), lifetime declared by `clearStaging` |
| R10 verb bracket | 1 | **2** | Links touched are now DECLARED: `Reactivity.invalidate(["zones"])` (`model.ts:489`). 4 of 5 — typed failure kind is still bare `Error` (`model.ts:478`) |
| R14 route mountable with injected source | 1 | **2** | `EffectAtomBench({ state })` + `BenchStateContext` (`bench.tsx:10-31`), default is the singleton |
| R15 four distinct states | 1 | **2** | Unbound is `options: null` + note (`model.ts:158-160`); probe P6: `{options:null, state:'fresh', note:'unbound; no host read'}` with **0 host calls** |
| R16 one reset protocol | 1 | **2** | `clearStaging()` on identity change (`model.ts:529-537,551-561`). Probe P5: dirty 1 → 0 on session re-pick. Round-2 defect D2 **fixed** |
| R17 no shadowing without a merge rule | 0 | **2** | `conflict = staged.base !== authority.name` (`model.ts:435`), rendered "· host changed" (`bench.tsx:487`). Rule is "keep local, flag conflict" |
| R20 freshness caption | 0 | **2** | `feedCaption` prints an absolute read clock, or the note when there is none (`bench.tsx:525-528`). An absolute clock cannot decay, so it needs no ticking |
| R9 derived view order | 1 | 1 | Still not exercised |
| R12 manifest as data | 0 | 0 | Verbs are still JSX literals (`bench.tsx:262-296`) |
| R18 cross-surface writes | 0 | 0 | Unchanged |
| R19 no hand-maintained dep list | 2 | 2 | Still no dep arrays — but see N1: the *granularity* is now the cost, not the maintenance |

Unchanged at 2: R1, R2, R4, R7, R8, R11, R13.

### R3.4 Delta table — qr-repo R1–R16 (22/32 → **26/32**)

| # | R2 | R3 | Evidence |
| --- | ---: | ---: | --- |
| R3 dep tracking **across `await`** | 1 | **2** | Probe P1. This is W1, fixed by the library, not avoided |
| R4 straight-line `await`, not `enabled:` | 1 | **2** | `yield* get.result(parent)` then `yield* timed(...)` (`model.ts:298-309,316-326,333-340,362-370`) |
| R8 escape hatch, disciplined | 1 | **2** | The round-2 `registry.set` inside a read Effect is gone; writes-from-reads go through `Reactivity.invalidate` in a mutation, and `Atom.batch` guards multi-writes (4 uses). Still no cycle detection |
| R16 Suspense / error-boundary interop | 1 | **2** | `PaneErrorBoundary` (`bench.tsx:537-567`) |
| R13 disposal tied to route lifetime | 1 | 1 | `connect()` now returns an unsubscribe consumed by the route effect (`model.ts:636-639`, `route:16-19`). Registry is still a module singleton and `dispose()` is still uncalled by the route |
| **R7 URL: one declaration** | **2** | **1** | **Regression.** The seven bindings are now declared **twice** — `validateSearch` for TanStack (`model.ts:102-110`) and seven `Atom.searchParam` + Schemas for the library (`model.ts:174-178,202-208`) — plus a hand-written mirror (`setSearch`, `model.ts:538-547`) |
| R5 exhaustive match | 1 | 1 | Still `if`-chains in `resultFeed` (`model.ts:153-171`) |
| R9 reactive display config | 1 | 1 | Still not exercised |
| R12 real `AbortSignal` | 0 | 0 | `Effect.tryPromise` with no signal (`model.ts:141-145`) |

Unchanged at 2: R1, R2, R6, R10, R11, R14, R15.

### R3.5 Section D — store-vs-view split (already best-in-class, now perfect)

| Metric | R2 | R3 |
| --- | ---: | ---: |
| `useState` in components | 0 | **0** |
| `useEffect` in `bench.tsx` | 1 | **0** — `Atom.kvs` self-hydrates (`model.ts:671-673`) |
| `useEffect` / `useTransition` in `route` | 1 / 1 | 1 / 1 (both correct seams) |
| Misplaced state logic in components | 2 lines | **0** — `dirty` and `conflict` moved into `zoneViewAtom` (`model.ts:434-435`) |
| React class components | 0 | 1 — `PaneErrorBoundary`, which React 19 still requires to be a class |

`bench.tsx` grew 85 lines and contains **zero** React state hooks. The only lifecycle code left in
the view is the error boundary, which has no hook equivalent.

### R3.6 Were the round-2 E-list defects fixed?

| # | Round-2 finding | Status |
| --- | --- | --- |
| E1 Activity claim | **Fixed and retracted by the builder.** The report now says the equal count "was a whole-registry census, not proof", and correctly names `useSyncExternalStore` as the reason hidden subtrees unsubscribe |
| E2 no dependent async | **Fixed.** Probe P1 |
| E3 view bound to the singleton | **Fixed.** `bench.tsx:10-31` |
| E6 fixture is the same generator | **Fixed.** `mock-host.ts:112,133-137`; probe P7 |
| E8 inspector shows stale hover | **Fixed.** `Inspector` now subscribes to `hoveredId`, `search`, `persisted`, `busy`, `receipt`, `dirtyCount` (`bench.tsx:502-513`) |
| E5 global Suspense promise map | **Not fixed** (library). `Hooks.ts:335-338` unchanged |
| E7 perf claim weakly proven | **Not re-measured.** See N4 |
| D1 no error boundary | **Fixed.** `bench.tsx:537-567` |
| D2 staged renames bleed across bindings | **Fixed.** Probe P5 |
| D3 adopt discards staged names | **Fixed.** Probe P4: names retained, toast explains |
| D4 unbound reports `fresh` | **Mostly fixed.** `options: null` + note make it renderable as distinct; the state *word* is still `fresh`, and `at` still stamps a read that never happened (probe P6) |
| D5 `Date.now()` in a derivation | **Fixed.** `folderFeedAtom` no longer stamps `at` (`model.ts:397-403`) |
| D6 singleton subscribes to two hosts forever | **Fixed.** One listener, re-pointed on fixture swap, released by `connect`'s cleanup (`model.ts:525-528,636-639`) |

Eleven of thirteen closed. The two open ones are a library bug and an unrepeated measurement.

### R3.7 NEW defects

| # | Severity | Defect | Proof |
| --- | --- | --- | --- |
| **N1** | **High** | **Whole-graph over-invalidation on every pick.** `searchAtom` is a derived node that rebuilds a fresh object literal from all seven params (`model.ts:209-219`), and every async source reads the aggregate — `const search = get(searchAtom)` at `model.ts:296,331,351,360`. So *any* param change invalidates *every* source, and the new cascade then re-runs zones twice. Probe P2 measured identical damage for four unrelated picks: <br>`pick view=view-l2  -> {"doc":1,"views":1,"zones":2,"folder":1}`<br>`pick stage=read    -> {"doc":1,"views":1,"zones":2,"folder":1}`<br>`pick zones=zone-7  -> {"doc":1,"views":1,"zones":2,"folder":1}`<br>`pick folder=D:\Jobs-> {"doc":1,"views":1,"zones":2,"folder":1}`<br>At the scenario's declared latencies, **one zone checkbox click costs 2 × 800 ms `listZones` + 600 ms `listViews` + 400 ms `listFolder` + 200 ms `activeDoc`** and drops all three panes back to `stale`. Toggling the read/adopt stage does the same. Round 2 shared the aggregate-object flaw; round 3's cascade multiplies it. Fix is ~5 lines: read the individual `searchParam` atoms in each source body and keep `searchAtom` for the sentence only |
| **N2** | **High (library)** | **`Atom.searchParam` state is a module-global singleton, exactly like the Suspense promise map.** `searchParamState = { timeout, updates: Map, updating }` is module scope (`effect/src/unstable/reactivity/Atom.ts:2723-2727`), shared across every registry in the process. Its writer debounces 500 ms and then calls `window.history.pushState({}, "", \`${pathname}?${params}\`)` (`Atom.ts:2715-2742`) — which **drops the hash**, and fires *in addition to* the TanStack `navigate` the proto already performs (`route:17`). One binding pick therefore creates two history entries 500 ms apart. The report names the hazard but the proto still writes the params (`model.ts:540-546`), so the second pushState does fire |
| **N3** | **Medium** | **The whole URL layer is untested by the no-React suite, by construction.** The judge confirmed `typeof window === "undefined"` in the vitest environment (no `jsdom` docblock, no `environment` config). In that branch `searchParam` reads return `Option.none()` and writes are plain `ctx.setSelf` (`Atom.ts:2679-2681,2702-2705`) — the seven param nodes degrade to in-memory atoms. So `bench.test.ts` exercises a code path that never runs in the browser, and the `pushState` conflict in N2 cannot be caught by it |
| **N4** | **Medium** | **The perf claim was not re-measured and its citations are stale.** §6's "0.300 ms / 6 executions" paragraph is verbatim round 2 and cites `model.ts:410-430` (now `r10Feed`/`zonesAtom`; the hover code moved to `572-591`) and `bench.tsx:361,393,434` (markers are now at `398,431,473`). `hover()` also changed — it now wraps both writes in `Atom.batch` (`model.ts:576-581`), so the round-2 census was taken against different code |
| **N5** | **Low** | **An optimism guaranteed to revert.** `Atom.optimisticFn`'s reducer applies staged renames to the zones list (`model.ts:495-499`), but the host signature cannot accept names, so the invalidated re-read always restores the originals. Probe P4: authority name is back to `Zone 001`. The user sees the rename applied for the 1500 ms write, then snap back — while `conflict` stays `false`, because the host did not change anything |
| **N6** | **Low** | **`Atom.kvs` sync mode swallows failures**, as the report itself notes (`Atom.ts:2139-2141`). In the vitest run `localStorage` **is** defined (Node global), so the suite writes real persisted keys that survive between runs — a latent cross-test contamination the tests do not isolate |
| **N7** | **Low** | The route effect's deps are `[navigate, search]` (`route:18`), and `connect` now returns a host-unsubscribe. So **every pick tears down and re-adds the host listener**; a push event landing in that window is dropped |

### R3.8 How much of the 757-line `model.ts` is library-owned?

| Region | Lines | Owner |
| --- | ---: | --- |
| 1–19 imports | 19 | — |
| 21–78 domain types | 58 | hand — domain |
| 80–139 `validateSearch`, `pickSearch`, `adoptRefusal` | 60 | hand — domain |
| 141–181 `timed`, `unbound`, `resultFeed`, Schemas | 41 | hand — domain |
| 187–199 registry, runtime, closure vars | 13 | mixed |
| 201–219 7 × `searchParam` + derived `searchAtom` | 19 | library nodes, hand aggregate |
| 221–238 2 × `Atom.kvs` + derived `persisted` | 18 | **library** |
| 240–285 page-memory nodes and families | 46 | library declaration, hand policy |
| 287–372 async chain: `get.result`, `withReactivity`, `swr` | 86 | **library** |
| 374–410 Feed projections | 37 | hand — domain |
| 412–444 zones authority, `optimistic`, `zoneView`, refusal | 33 | mixed |
| 446–514 busy timer, adopt mutation, `optimisticFn`, `openR10` | 69 | hand — orchestration |
| 516–595 invalidation bridge, URL mirror, `clearStaging`, hover perf | 80 | hand — orchestration |
| 597–754 exports, `dispatch`, `inspect`, `testing` | 158 | hand |
| blanks, signature, tail | 20 | — |

| Bucket | Lines | Share |
| --- | ---: | ---: |
| **Library-owned** (kvs 18 + async chain 86 + ~10 param declarations) | **≈ 114** | **15 %** |
| **Hand-rolled domain** (types, pure functions, Feed projector) | ≈ 196 | 26 % |
| **Hand-rolled plumbing / orchestration / dispatch** | ≈ 369 | 49 % |
| Imports, blanks, tail | ≈ 78 | 10 % |

The imperative surface **grew**: `registry.set` 24 → 30, `registry.get` 25 → 27,
`registry.update` 6 → 7 — **64 direct registry pokes** in the store, up from 55. What *fell* is the
hand-listed invalidation: `registry.refresh` **11 → 1**, `setTimeout` **1 → 0**.

Per-primitive accounting of the +173 lines:

| Primitive | Replaced | Net LOC | Verdict |
| --- | --- | ---: | --- |
| `Reactivity.invalidate` + `withReactivity` ×3 | `zonesStaleAtom`, a write-during-read `Effect.tap`, `setTimeout(…,60)`, `refreshAll()`, 10 of 11 `registry.refresh` | **−18** | **win** |
| `Atom.swr` ×1 | nothing | +1 | win |
| `Atom.batch` ×4 | nothing | +4 | win |
| `Atom.kvs` ×2 | `persist()` + `hydratePersisted()` + try/catch (≈17 lines) | +3 | wash |
| `get.result` in `Effect.gen` ×4 | 5 ternary-guarded flat reads (≈36 lines) | **+50** | more code, but it *is* the requirement — and it buys identity resolution and typed unknown-session / unknown-view failures |
| `Atom.optimistic` / `optimisticFn` | nothing (no optimism in round 2) | +20 | new capability, see N5 |
| **`Atom.searchParam` ×7** | one writable atom (1 line) | **+22, and `validateSearch` stays** | **loss** — three URL representations where round 2 had two |

**Net: the native primitives paid for invalidation and cost for the URL.** The builder's own comment
at `model.ts:201` states the reason: "searchParam owns a delayed pushState", so TanStack must stay
authoritative and the library node becomes a mirror.

### R3.9 Refutation of the round-3 report

| Claim | Verdict | Basis |
| --- | --- | --- |
| §4 "This is now a real dependent async graph, not URL-gated fan-out" | **CONFIRMED** | Probe P1 |
| §6 Activity retraction | **CONFIRMED** — the builder corrected E1 accurately and unprompted | |
| §5 "fixture now returns an observably distinct canned dataset" | **CONFIRMED** | Probe P7: `Fixture Zone 001` |
| §8 LOC (934 / 588 / 113) | **CONFIRMED** exactly | |
| §8 "Fixed judge defects include … O(dirty) counting" | **CONFIRMED** | `dirtyCountAtom` reads one array (`model.ts:439`), not 500 family atoms |
| §9 "State handles its own waterfalls — 4/5" | **UPHELD at 4/5** (was refuted to 2/5 in round 2) | The chain is tracked and the invalidation is directional. The missing point is now N1, not the absence of a chain |
| §6 hover perf paragraph | **STALE, not re-run** | N4 |
| §7 URL table row, unchanged from round 2 (`route:7-18`, `model.ts:74-105`) | **STALE CITATIONS** | Those lines are now `str`/`strings`/`validateSearch`/`pickSearch`; the searchParam layer the round-3 store added is not in the table |
| Overall "conditional reject … keep as a hybrid option" | **UPHELD** | Two of the three stated blockers are still live, and N2 adds a third instance of the same module-global-singleton bug class |

### R3.10 Pattern grafts — revised

F1 (host-atom fixture swap), F2 (per-entity view node), F3 (Feed projector) and F4
(`inspect()` taxonomy) all stand and are stronger. Round 3 adds two:

| # | Graft | Why |
| --- | --- | --- |
| **F5** | **Declare what a write invalidates as a key, and let the read graph cascade the rest.** `withReactivity(["doc"])` on the root plus `Reactivity.invalidate(["doc"])` in the mutation (`model.ts:293,312,344,489,523`) replaced eleven hand-listed refreshes with one. Probe P1 shows one key reaching three hops with no over-reach into the folder branch. This is census R4 answered properly, and it transfers to any keyed-invalidation library |
| **F6** | **A staged edit that carries its own base.** `StagedRename {base, next}` (`model.ts:66-69`) makes the shadowing conflict (`R17`) a one-line derivation — `staged.base !== authority.name` — instead of a merge policy. Cheap, and it is the only structure in the bake-off so far that detects S23 |

**Anti-graft:** do not copy the aggregate `searchAtom` (N1). Read the individual param nodes in each
async source; keep the aggregate for the sentence view only.

### R3.11 Summary

| Axis | R2 | R3 |
| --- | ---: | ---: |
| Scenario | 13 met / 8 partial / 1 faked | **17 met / 5 partial / 0 faked** |
| Census R1–R20 | 25 / 40 | **35 / 40** |
| qr-repo R1–R16 | 22 / 32 | **26 / 32** |
| `useState` / misplaced logic in components | 0 / 2 lines | **0 / 0 lines** |
| Round-2 defects closed | — | **11 of 13** |
| `registry.refresh` calls in the store | 11 | **1** |
| Library-owned share of `model.ts` | — | **≈ 15 %** |
| New defects | — | 7 (2 high) |

Round 3 is a large, honest improvement. The waterfall requirement — the one thing round 2 could not
demonstrate — is now proven by a traced single-key invalidation that reaches three generator hops
and stops at the branch boundary. Eleven of thirteen round-2 defects are closed, the builder
retracted his own bad Activity inference, and the store/view split is now perfect: zero `useState`,
zero misplaced derivations, zero `useEffect` in the view.

What did not improve is the shape of the cost. The library owns about 15 % of the store; half the
file is still hand-rolled orchestration and 64 direct registry pokes. `Atom.searchParam` is a net
loss that adds a third URL representation, carries the same module-global-singleton defect as the
Suspense promise map, fights TanStack Router with an undeclared 500 ms `pushState`, and is not
exercised by the test suite at all. And the aggregate `searchAtom` turns the new cascade into a
liability: one zone checkbox click now re-reads 500 zones twice plus the doc, the views and the
unrelated folder listing.

VERDICT (round 3): hybrid — the strongest store in the bake-off so far and the only one with a proven tracked async chain, but N1 makes it slower per click than round 2, and `Atom.searchParam` plus the global Suspense promise map are two instances of one library-wide defect class that must land upstream before this can be the default.
