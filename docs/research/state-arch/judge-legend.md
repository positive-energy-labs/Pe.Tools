# Judge — candidate `legend` (`@legendapp/state` 3.0.0-beta.48)

Adversarial review of `docs/research/state-arch/04-legend.md` and the proto in worktree
`Pe.Tools-sb-legend`. All line references are that worktree, under
`ts/apps/web/src/`. The judge ran every lane. The judge also ran five scratch
probes (`__judge_scratch.test.ts`, created, run, then deleted; the worktree is unchanged).

## 0. Lanes the judge ran

| Lane | Command | Real output |
|---|---|---|
| Requested test lane | `vp run @pe/web#test -- state-bench` (from `ts`) | `error: Failed to plan tasks from 'vp run' in task @pe/web#test / * Task "state-bench" not found` |
| Corrected test lane | `vp test src/state-bench/legend/bench.test.ts` (from `apps/web`) | `Test Files 1 passed (1) / Tests 5 passed (5)` in 1.53 s |
| Type/lint/format | `vp check apps/web/src/state-bench/legend apps/web/src/routes/state-bench.legend.tsx` | `pass: All 6 files are correctly formatted` / `pass: Found no warnings, lint errors, or type errors in 6 files` |
| SSR | `vp dev --port 3411`, `curl -L /state-bench/legend` | `HTTP=200 bytes=4456` after a 307 to the defaulted search string |

The report is accurate on all four lanes. The report's disclosure of the broken lane name is
correct and is a point in its favour.

Three facts the lanes do not show:

| Fact | Evidence |
|---|---|
| The 4 456-byte SSR body has **no route markup**. `grep` for `Legend state bench`, `Zone list`, `Staging table` finds 0 hits. The 200 proves the SSR module graph loads. It does not prove the route server-renders. | fetched body |
| The `@tanstack/query-core` fix is a **hand-forged lockfile entry**. The published manifest of `@legendapp/state@3.0.0-beta.48` declares only `use-sync-external-store`, but `pnpm-lock.yaml` lists `'@tanstack/query-core': 5.101.4` under Legend's snapshot. Any non-frozen `pnpm install` re-resolves from the manifest and drops it, which returns SSR to 500. | `node_modules/.pnpm/@legendapp+state@3.0.0-beta.48_react@19.2.7/node_modules/@legendapp/state/package.json`; `git show HEAD -- ts/pnpm-lock.yaml` |
| `@tanstack/query-core` was also added as a direct `@pe/web` dependency and no source file imports it. | `apps/web/package.json:30`; `grep -rn "@tanstack/query-core" apps/web/src` → 0 hits |

## A. Scenario compliance

| # | SCENARIO requirement | Verdict | Evidence |
|---|---|---|---|
| A1 | Waterfall clears descendants on re-pick | **met** | `store.ts:26-33` graph, `store.ts:69-83` pure `pickInto`, `bench.test.ts:29-55` |
| A2 | Every binding in URL search, reload restores | **partial** | `routes/state-bench.legend.tsx:16-25` validates all 7 fields; `:40-46` copies search into the store and calls `loadBound` once. Back/forward changes the search but triggers **no** re-read, because the `synced` getters are not reactive (probe A). Reload restores; history navigation does not. |
| A3 | `Feed` = `{options, state, at?, note?}` with the six-value union | **met** | `mock-host.ts:1-13`, produced by one function at `store.ts:177-199` |
| A4 | Feed reaches `stale` after Adopt | **partial** | `store.ts:402` sets the flag and `store.ts:196` maps it. In fixture mode `fixtureState()` is tested **before** `stale`, so the feed reports `fixture` and never `stale` (probe C: `feed=fixture staleFlag=true`). The whole no-React lane runs in fixture mode, so the test lane can never see the stale feed; `bench.test.ts:76` asserts the boolean flag instead. |
| A5 | `listZones` rejects 1 in 4 → `error` feed | **partial** | `mock-host.ts:114` implements it, but `failureEnabled` defaults to `false` (`mock-host.ts:71`), so the default host never fails. SCENARIO makes rejection the behaviour and the knob the override. The error state itself is real (probe B: `s2=error`, 500 previous options retained). |
| A6 | Push `docChanged` invalidates doc + views + zones | **partial** | `store.ts:416-422` sets three stale flags. It does not re-read and does not drop the cached value (probe: 0 extra host reads). In fixture mode it is also invisible in the feed (A4). |
| A7 | One-line fixture swap at the composition root | **partial** | True for the no-React lane (`bench.test.ts:8`). The React tree has no composition root: `panes.tsx:6` and `page.tsx:6` import the module singleton `legendBench` (`store.ts:499`). The rendered route cannot be given a fixture host; the UI knob mutates `controls.fixture` on the live host instead (`store.ts:487-490`). |
| A8 | vitest, no React, five named cases | **met** | `bench.test.ts:16-104`; 5 passed, no React import |
| A9 | `<Suspense>` per pane with a per-pane fallback | **met** | `panes.tsx:150-165`; `use$(zones$, {suspense:true})` at `:98, :107, :121` |
| A10 | Both loading styles (suspend and status) if the library allows | **met** | suspend at `panes.tsx:98`; status at `store.ts:192` → `FeedBadge` `page.tsx:62-71` |
| A11 | `<Activity>` on the Plan pane, hidden pane keeps state, note the cost | **met** | `panes.tsx:154-160`; report §6 records "hidden plan renders +0" |
| A12 | `useTransition` / `startTransition` on the binding pick | **met** | `routes/state-bench.legend.tsx:33-38`, pending flag rendered at `page.tsx:300` |
| A13 | Hover shared by 3 panes, page memory, not URL | **met** | `store.ts:101` `hoverById`, read at `panes.tsx:18, 37, 60` |
| A14 | Hover at 60 fps with 500 zones, **measured** | **partial** | `store.ts:368-377` measures only the store write and its synchronous notifications. React render and commit are outside the span, so the figure is not ms/frame and does not answer the 60 fps question. See E2. |
| A15 | Devtools or a `<pre>` of the state tree + last 20 actions, screenshot | **met** | `page.tsx:73-107`, `store.ts:291-295` (`.slice(-20)`), screenshot `legend-inspector.png` verified genuine |
| A16 | Staging table: staged renames, dirty rows, Adopt commits | **partial** | Dirty rows are real (`panes.tsx:71-79`). Adopt sends **nothing**: `store.ts:400-401` clears the staged names by design because the MockHost has no rename payload. The staging pane is a dirtiness display, not a write path. Honestly marked with a `ponytail:` comment. |
| A17 | Adopt refuses when zones are `stale` or `loading`; derived refusal | **partial** | `store.ts:251-259` is correctly derived and works live (probe D: `refusal="zones are stale; refresh before Adopt"`). It fails in fixture mode because the feed lies (probe C: `refusal=undefined` with `staleFlag=true`). |
| A18 | Adopt: busy + seconds counter, receipt toast, then auto re-read | **met** | `store.ts:391-404`, `page.tsx:157`, `page.tsx:179-183`. Toast never clears. |
| A19 | `Refresh zones` re-reads and marks fresh | **partial** | `store.ts:311-339` works from a clean state. After an errored read the refresh promise **never settles** (probe B: `refresh3=HUNG`) even though the host call is made and succeeds. |
| A20 | `Open in RHVAC` navigates, demands r10 | **faked** | `store.ts:469-474` only appends a log line. The refusal is real (`store.ts:260`); the navigation is not. |
| A21 | Persisted: recent folders (max 8), pane widths | **partial** | `store.ts:117-121, 357-365` persist correctly. The sliders are uncontrolled with hard-coded `defaultValue="30"` / `"40"` (`page.tsx:236, 249`), so a restored width is not shown after reload. |
| A22 | Knobs: latency multiplier, failure on/off, fixture on/off | **met** | `page.tsx:190-216`, `store.ts:479-490` |
| A23 | Derived: feeds, progress, seams, refusals, world — computed, never stored | **partial** | All exist (`store.ts:241-289`). `world$` is dead: the only consumer is `page.tsx:93` for `.length`. The panes re-derive `selected` / `hovered` / `staged` per row instead (`panes.tsx:18-19, 37-38, 59-61`). `seams$` filters on `options === null`, which `feed()` can never return (`store.ts:188, 193, 195`). |

**Scenario tally: 11 met, 11 partial, 1 faked, 0 missing.**

## B. Census `00-baseline-census.md` §10, R1–R20

| # | Score | Evidence |
|---|:-:|---|
| R1 Addressable, one mechanism | 2 | All 7 fields, including selection and stage, go through one `validateSearch` (`routes/state-bench.legend.tsx:16-25`). |
| R2 Dependents cleared by declaration | 2 | `BINDING_GRAPH` + pure `pickInto`, no effect (`store.ts:26-83`). |
| R3 Machine-readable basis, freshness computed from it | 1 | `basis$` exists (`store.ts:282-289`) but is decorative. Freshness comes from `readAt`/`stale` flags that `refresh` writes by hand (`store.ts:334-335`). |
| R4 Write declares its invalidations at the read's identity | 1 | Named keys beat `queryKey[2]`, but the list is hard-coded twice: `store.ts:402` and `store.ts:417-421`. |
| R5 Optimistic and write-through are one mechanism | 1 | Only write-through exists (`store.ts:397-404`). No optimistic path is demonstrated. |
| R6 Staged edits: declared home, stated lifetime, "what a write would send" | 1 | Home and lifetime are clear (`store.ts:102`, page memory). "What a write would send" is nothing (`store.ts:400-401`). |
| R7 Write result enters the read model without cache surgery | 1 | No surgery, but no return-into-read-model either: the receipt goes to page memory and the read is refetched (`store.ts:398-404`). |
| R8 Selection and hover first-class, shared, separable | 2 | `url.zones` + `page.hoverById`, three panes, zero prop drilling (`panes.tsx:18-19, 37-38, 59-60`). |
| R9 Derived order without a parent round trip | 1 | No round trip, but the visible set is derived in the view: `panes.tsx:62` renders 500 rows and returns `null` for 499. |
| R10 Verb as one bracket | 1 | Elapsed, receipt, failure kind and touched links are present (`store.ts:391-412`). In-flight **identity** is absent: two concurrent Adopts both call the host (probe E: `adoptZones calls=2`) and the second clobbers `busy`. |
| R11 Refusal computable from state alone | 1 | Correctly derived (`store.ts:251-259`) but computed from a feed that misreports in fixture mode (probe C). |
| R12 Manifest is data, evaluated once | 1 | `STAGES` is a module const (`store.ts:35-38`) but its `verbs` array is never read; the buttons are hand-written JSX (`page.tsx:129-159`). |
| R13 Derivations are pure and testable without React | 2 | `pickInto` is exported and pure; every `computed` is reachable off the bench object and was exercised with no React (probes C–E). |
| R14 Route mountable with an injected data source | 1 | The store takes a host (`store.ts:92`), but the components import the singleton (`panes.tsx:6`, `page.tsx:6`), so the route itself cannot be mounted against a fixture. |
| R15 Loading / empty / error / fixture are four distinct states | 1 | Four exist, but `empty` is not distinguishable (`options: []` on empty, on error, and on undefined — `store.ts:188-195`), and `fixture` shadows `stale`. |
| R16 Identity change has one reset protocol | 2 | `pickInto` is the only protocol; `sessionGone` reuses it (`store.ts:425`). |
| R17 Server data not shadowed by local edits without a merge rule | 1 | A merge rule exists (`store.ts:272`) but is unused by the panes; a refetch does not discard staged names, so no silent loss. |
| R18 Cross-tab / cross-surface writes visible | 0 | Nothing. The localStorage plugin writes; no `storage` listener, no cross-surface signal. |
| R19 No hand-maintained dependency list per derivation | 2 | `computed` auto-tracks; zero dep arrays, zero eslint suppressions in the proto. |
| R20 Freshness captions self-update or say they do not | 0 | `at` is carried in the Feed (`store.ts:197`) and never rendered. `FeedBadge` shows only the state word (`page.tsx:62-70`). No caption, no statement. |

**Census total: 24 / 40.**

## C. qr-repo `01-qr-repo-pattern.md` §6, R1–R16

| # | Score | Evidence |
|---|:-:|---|
| R1 Async derived declared as a peer of sync derived, same file | 2 | `observable(synced({get}))` sits beside `computed()` in one module (`store.ts:123-165` vs `241-289`). This is the pattern's core and Legend has it. |
| R2 One route = one statically readable state module | 2 | `store.ts`, 499 lines, whole graph visible, exported as one object (`store.ts:430-495`). |
| R3 Automatic dependency tracking including across `await` | 0 | **Refuted by probe A.** Writing `state$.url.view` directly caused 0 host reads. The waterfall is a four-line `if` ladder in `pick` (`store.ts:351-354`). |
| R4 Dependent async as straight-line `await`, not `enabled:` config | 1 | The getters look like straight-line reads, but the real sequencing is the manual ladder in `loadBound` (`store.ts:461-468`), and `syncedQuery` still uses `enabled:` (`store.ts:161`). |
| R5 Exhaustive loading/error/data match at the read site | 1 | `FeedState` is a union, but every read site is a ternary chain (`page.tsx:65`, `store.ts:186-198`). Nothing is statically enforced; `live` has no producer and no compiler complains. |
| R6 Consumers take the state object, not values | 1 | Adding a node costs zero call-site edits, but consumers do not *take* the object — they import the singleton (`panes.tsx:6`). Same coupling, worse testability. |
| R7 URL-backed inputs, per-field schema + fallback, one declaration | 2 | `routes/state-bench.legend.tsx:16-25`. Encoding is only half readable: `zones=%5B%5D` (JSON array) on write, comma-list tolerated on read (`:8-13`). |
| R8 Escape hatch for input-writes-from-derived-reads | 1 | The push handler and `pick` do it (`store.ts:415-428`), hand-written, no cycle detection. |
| R9 Value objects capture reactive display config | 0 | Not exercised anywhere in the proto. |
| R10 Zero React lifecycle coupling; constructible in a script | 2 | `createLegendBench` is a plain function; probes D and E drove Adopt and refusal with no React. |
| R11 Keep-previous-data on invalidation | 2 | Probe B: during `error` the feed still carried 500 options. `store.ts:188` is explicit about it. |
| R12 Real `AbortSignal` threaded to the fetch | 0 | No signal anywhere. The report admits it (§4). |
| R13 Explicit disposal tied to route lifetime | 1 | `dispose` unsubscribes host events only (`store.ts:493`). The `synced` observables, the `QueryClient` (`store.ts:94`) and the import-time singleton (`store.ts:499`) are never torn down. |
| R14 Errors surface distinctly from empty | 1 | `state: "error"` + `note` is distinct (`store.ts:186-191`), but `options: []` is shared with empty. |
| R15 Cache / dedup by key | 1 | Only for R10 through `syncedQuery` (`store.ts:156-165`). The five core `synced` resources have no key and no dedup. |
| R16 Suspense / error-boundary interop | 2 | Suspense works per pane against React 19.2.7 (`panes.tsx:98, 107, 121`). No error boundary is wired, but R16 asks only for interop. |

**qr-repo total: 19 / 32.**

## D. Store-vs-view split

This is the proto's best result. The numbers are real.

| Measure | Value |
|---|---|
| `useState` in components | **0** |
| `useReducer` / `useSyncExternalStore` in components | 0 |
| `useEffect` in components | **2** |
| `use$` call sites in views | 30, of which 9 are inline selector closures |
| View lines (`panes.tsx` 171 + `page.tsx` 309 + route 49) | 529 |
| Judge estimate of **state logic inside components** | **≈ 65 lines** |

### Every `useState` / `useEffect` in a component

| Site | What it does | Belongs in the store? |
|---|---|---|
| `panes.tsx:12` `useEffect(() => markRender(pane))` | Instrumentation. Every row of every pane writes a counter after commit. | **No — it should not exist.** It writes an observable that `perf$` reads and the Toolbar subscribes to (`page.tsx:115`), so 500 row renders push 500 store writes and re-render the Toolbar. It contaminates the measurement it takes. |
| `routes/state-bench.legend.tsx:40-46` `useEffect(connect + loadBound)` | Router→store wiring plus the first load, guarded by `useRef`. | **Partly.** The wiring is legitimate adapter code. The `loaded` ref is a lifecycle rule that belongs with the store, and its absence from the store is why history navigation does not re-read (A2). |

No other component holds state. That is a real, verified win.

### State logic still living in components (≈ 65 lines)

| Site | Lines | Why it is state logic |
|---|---:|---|
| `page.tsx:75-100` Inspector snapshot | 26 | Assembles the whole state tree and stringifies it inside a render function. This is a derivation; it belongs in the store as one `computed`. It is also open by default (`store.ts:104`), so it re-stringifies 500 `hoverById` entries on every hover. |
| `panes.tsx:18-19, 37-38, 59-61` per-row `selected` / `hovered` / `staged` | 8 | Duplicates `world$` (`store.ts:269-276`) three times. `world$` is dead as a result. |
| `panes.tsx:62` `if (!selected) return null` | 1 | The staging pane's visible set is derived in the view. 500 components mount to show one row. |
| `panes.tsx:11-13` `usePaneRender` | 3 | Instrumentation write. |
| `page.tsx:236-259` slider handlers reading `prefs.*.peek()` | 8 | Read-modify-write of persisted state inside the view, with hard-coded defaults that shadow the persisted value. |
| `page.tsx:17, 28, 40-41, 51` binding reads and `options ?? []` fallbacks | 6 | Small and defensible. The `?? []` fallback is dead: `options` is never null. |
| `routes/state-bench.legend.tsx:32-46` | 15 | Adapter plus first-load lifecycle. |
| `panes.tsx:9` `as Observable<Zone[]>` cast | 1 | A type hole the store should have closed. |

**Read:** the split is clean by hook count and dirty by responsibility. The store owns the
vocabulary. The view still owns one whole derivation (the inspector snapshot), one visible-set
filter, and all the instrumentation.

## E. Refutation

### E0. The report's verdict

The report concludes **reject**. The judge tried to refute it and **could not**. The probes make
the case for reject stronger than the report does, not weaker. Two defects the report does not
name at all:

| Defect | Proof |
|---|---|
| **The `synced` getters are not reactive.** A direct write to `state$.url.view` produced 0 host reads. `pick("folder", …)` from the recents dropdown (`page.tsx:294`) produced 0 file reads, so choosing a recent folder never lists it. | probe A: `zoneReads after direct url write=0; fileReads after pick("folder")=0` |
| **`refresh` never settles after an errored read.** The third refresh calls the host and the host succeeds, but the promise hangs. The `finally` of any awaiting caller never runs. | probe B: `s1=fixture refresh2=settled s2=error reads=2 refresh3=HUNG s3=fixture totalReads=3` |

Both come from one root: the async layer is not the library's. It is 30 hand-written lines
(`store.ts:311-339` and `:341-355`) that Legend does not help with.

### E1. Claim: "Mockable 5/5 — one-line fixture swap, no provider ceremony"

**Refuted as stated.** The swap reaches the vitest lane only (`bench.test.ts:8`). The React tree
imports the singleton (`panes.tsx:6`, `page.tsx:6`), so the route cannot be mounted against a
fixture host; the UI knob mutates the live host instead (`store.ts:487`). Worse, fixture mode
*changes behaviour under test*: `fixtureState()` is checked before `stale` (`store.ts:196`), so
the entire no-React lane can never observe a stale feed, and `refusal$` does not refuse a stale
Adopt there (probe C: `feed=fixture staleFlag=true refusal=undefined`). The one test that covers
this asserts the boolean flag, not the feed (`bench.test.ts:76-77`). A fixture that hides the
state the scenario exists to test is not 5/5.

### E2. Claim: "3 components rerender per hover; 5.234 ms mean"

**Refuted.** Both halves.

| Problem | Evidence |
|---|---|
| The Toolbar re-renders on every hover | `hover()` appends to `hoverSamplesMs` (`store.ts:377`) → `perf$` (`store.ts:242-250`) → `use$(perf$)` in the Toolbar (`page.tsx:115`) |
| The Inspector re-renders and re-stringifies the whole tree on every hover, and is open by default | `page.tsx:80` reads `page.get()`, which contains `hoverById`; `store.ts:104` `inspectorOpen: true` |
| Hover *enter* touches two zones, not one | `store.ts:373-374` clears the previous leaf and sets the new one; each zone has three pane components |
| The number is not ms/frame | The span at `store.ts:368-376` closes before React schedules, so render and commit are excluded. The scenario asked for ms/frame or commit count at 60 fps. |
| Finding the previous hover is O(500) proxy reads per move | `store.ts:369-371` `Object.keys(...).find(key => …peek())` |
| The staging pane mounts 500 components to show one row | `panes.tsx:133` with `panes.tsx:62`; the screenshot's own counter reads `renders L/P/S 2030/2030/2030` |

The *granularity* claim survives — a hover does not re-render 500 rows — and that is the real
finding. The specific number 3 does not.

### E3. Claim: "Centralized importable object 4/5 — genuinely framework-free"

**Upheld, with a deduction.** Probes D and E constructed the store, ran Adopt, and read
`refusal$` with no React. That is real. But `dispose()` unsubscribes host events only
(`store.ts:493`); the synced resources, the `QueryClient` (`store.ts:94`) and the import-time
singleton (`store.ts:499`) are never torn down, and the singleton subscribes to host events on
the server. Call it 3/5.

### E4. Claim (§4): "Dependent `synced` getters read the binding nodes they depend on"

**Refuted.** Probe A. The getters read the nodes; nothing re-runs them. Every re-read in the
proto is an explicit `refresh(key)` call. This is the claim that matters most, because it is the
one thing kaitpw's second want asks for. The report already scores that want 2/5; the proto shows
the true score is closer to 1/5.

### E5. Claim (§4): "a late obsolete read can win"

**Not reproduced.** Probe: `pick("view","slow")` (120 ms) then `pick("view","fast")` (10 ms).
Resolve order was `slow | fast`; the final value was `z-fast` and the URL was `fast`. The reads
appear to serialize behind `sync()`. This self-reported weakness is unproven in that direction.
It stays true that no `AbortSignal` exists (qr R12 = 0).

### E6. Claim (§8, papercut 1): the SSR dependency fix

**Upheld and worse than stated.** The report says the dependency "had to be attached to Legend"
in the lock snapshot. Verified: the published manifest declares only `use-sync-external-store`,
so the lock entry is hand-forged and does not survive a re-resolve. The report is honest; the
candidate is not shippable on that basis.

## F. Pattern grafts — what a different winner should steal

| # | Graft | Where | Why |
|---|---|---|---|
| 1 | **`BINDING_GRAPH` + pure `pickInto`** | `store.ts:26-83` | 24 lines of data and one pure function answer census R2 and R16 completely, with no effect and no React. Testable in 20 lines (`bench.test.ts:29-55`). Any winner should carry this file shape verbatim. |
| 2 | **One `feed()` producer for the whole `FeedState` union** | `store.ts:177-199` | The census S8 says nothing produces `stale`. This is one function of `(value, status, staleFlag, readAt)` that produces all six states for all six links, so freshness stops being hand-asserted per call site. Steal it, and fix the precedence bug: test `error` → `loading` → `stale` → `fixture` → `fresh`, so a fixture never hides a stale read. |
| 3 | **Per-entity hover leaves, `hoverById[id]`** | `store.ts:101`, read at `panes.tsx:18` | The subscription boundary becomes a *data shape* instead of a memo trick. It is why 500 zones hover cheaply, and it is library-independent: a `Map<id, signal>`, an atom family, or a selector keyed by id all give the same property. Keep the shape; drop the O(n) previous-hover scan at `store.ts:369-371` and store `hoveredId` beside it. |

Also steal the report's own closing discipline: every remaining candidate must prove package
resolution under SSR, first-load rejection, post-error recovery, hidden-`Activity` subscription
cost, and router-parent re-renders. Three of those five broke here, and only a running proto
found them.

VERDICT: reject — the proto proves Legend's rendering granularity and a genuinely hook-free view layer, but its async authority is 30 hand-written lines that do not re-read on a URL write and hang after any error, which is the exact half of the problem this bake-off exists to solve.
