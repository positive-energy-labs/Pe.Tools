# Judge — candidate `xstate` (`@xstate/store` 4.2.3 + `@xstate/store-react` 2.0.0)

Adversarial review. Read-only. Judged 2026-08-24 against `SCENARIO.md`,
`00-baseline-census.md` §10 (R1–R20) and `01-qr-repo-pattern.md` §6 (R1–R16).

Proto: worktree `Pe.Tools-sb-xstate`, `source/pe-tools/apps/web/src/state-bench/xstate/`
(`store.ts` 775, `panes.tsx` 443, `host.ts` 137, `bench.test.ts` 145) and
`src/routes/state-bench.xstate.tsx` (53). Total 1553 lines.

## 0. Proof lane — commands run by the judge

| Command | Result |
|---|---|
| `vp run @pe/web#test -- state-bench` (from `source/pe-tools`) | **FAILS to plan.** `error: Failed to plan tasks from 'vp run' in task @pe/web#test / * Task "state-bench" not found`. Exit 0. The `test` script is bare `vp run`, so the filter is read as a task name. Command defect, not candidate defect. |
| `vp test src/state-bench/xstate/bench.test.ts` (from `apps/web`) | **PASS. 1 file, 5 tests, 484 ms.** Report claims 1.45 s; the count and the names match. |
| `vp check src/state-bench/xstate src/routes/state-bench.xstate.tsx` | **PASS.** "All 5 files are correctly formatted"; "Found no warnings, lint errors, or type errors in 5 files". |
| Route registration | Present in `routeTree.gen.ts:32,138-139`. |
| Devtools screenshot | `.artifacts/runs/state-bench-xstate-20260824/devtools.png` exists, 165 529 bytes. Content verified (see A12 and E3). |

The report's test and check claims are true. Its perf claim is not (E3).

## A. Scenario compliance

| # | Requirement | Verdict | Evidence |
|---|---|---|---|
| A1 | Waterfall clears descendants | **met** | `BINDINGS` tree + recursive `descendants()` + `pickInto`, `store.ts:35-59`. One declaration serves both trees. Test `bench.test.ts:53-77`. Best single artifact in the proto. |
| A2 | Every binding in URL search, reload restores | **partial** | `validateSearch` covers all 8 fields, `state-bench.xstate.tsx:17-26`. But the store keeps a **second writable copy** in `context.search` (`store.ts:74`), and the flow is one-way out (`enqueue.emit.searchChanged` → `navigate`, `state-bench.xstate.tsx:43-45`). No inbound URL→store path exists. `initialSearch` is read once (`:38-40`). Any external search change desyncs the store silently. |
| A3 | Feed states, `stale` after adopt | **partial** | `deriveFeed` `store.ts:180-197`; `stale` produced at `store.ts:566` and `:695-697`; test `:79-100`. **But** `"live"` is declared and never produced (only occurrence is the type at `store.ts:11`), and a never-read cache reports **`fresh`** — `status:"idle"` falls through every ternary to `"fresh"` (`store.ts:186-194`). The screenshot shows `folder` and `r10` as `FRESH · EMPTY` before any read. Asserted freshness, which is exactly census S8/R3. |
| A4 | 1-in-4 `listZones` failure → `error` feed | **partial / mis-titled** | `host.ts:103-109` gates the rejection behind `knobs.failures`, default `false`. `configure()` then sets `zoneCalls = 3` (`host.ts:129`) so the **next** call fails. The test named "surfaces the one-in-four listZones rejection" (`bench.test.ts:102-113`) therefore proves forced-failure-on-next-call, not the 1-in-4 cadence. The cadence is never exercised. The `ponytail:` comment admits the substitution; the test title does not. |
| A5 | Push `docChanged` invalidates doc+views+zones | **met** | `hostPush` `store.ts:679-700` marks all three stale then re-reads via `refreshDoc` → `listViews` → `listZones` cascade. Test `:115-144` asserts an all-stale frame then all-settled. `sessionGone` also handled (`:681-688`). |
| A6 | One-line fixture swap at composition root | **met** | `createBenchState(initialSearch.fixture ? createFixtureHost() : createMockHost(), initialSearch)`, `state-bench.xstate.tsx:38-40`. One expression. |
| A7 | Same swap in a vitest test, no React | **met** | `bench.test.ts` imports no React. `createBenchState(createFixtureHost(), boundSearch)` `:43`. 500 zones asserted `:49`. Verified passing. |
| A8 | `<Suspense>` per pane, per-pane fallback | **partial — inert** | Three boundaries with three distinct fallbacks, `panes.tsx:408,417,426`. **Nothing in the proto can suspend.** `useSelector`/`useAtom` read synchronously; `createAsyncAtom` returns a tagged status. The fallbacks are unreachable. The scenario asked for "both styles if the library allows"; only the status style exists, and the report says so honestly in §1 — but the proto still ships three decorative boundaries instead of one comment. |
| A9 | `<Activity>` on the plan pane, state kept | **met** | `panes.tsx:412`. Report measures 1/0/1 commits hidden and a catch-up render on restore. Consistent with `Activity mode="hidden"` unmounting effects. |
| A10 | `useTransition` for the binding pick | **partial** | The transition wraps the **URL write**, not the pick: `startTransition(() => void navigate(...))`, `state-bench.xstate.tsx:44`. The pick itself is a bare synchronous `store.trigger.pickSession` (`panes.tsx:46`). The report's own §1 cites React's caveat that an external-store mutation inside a transition falls back to blocking, so the sentence is not protected. |
| A11 | Hover across 3 panes at 60 fps, 500 zones, measured | **measured, requirement FAILED** | Instrumentation is real: `bench.hover` times the handler (`store.ts:749-753`), three `<Profiler>` wrappers record commits (`panes.tsx:404-429`). The result fails the bar. Report §6: 33.0/5.2/11.9 ms ≈ 50 ms per hover ≈ 20 fps. The **screenshot** is worse: `commits list/plan/staging 3/1/3 · last durations 63.60/4.20/11.30 ms` ≈ 15 fps. Cause: `new Set(search.zones)` plus a full 500-row map rebuilt in all three panes on every hover (`panes.tsx:220,253,290`). |
| A12 | Devtools / cheapest inspector | **met, with a self-inflicted defect** | `store.inspect` → `inspectionAtom` ring of 20 (`store.ts:717-721`); `<pre>` of whole context + last 20 actions (`panes.tsx:350-365`). Screenshot verified. **Defect:** a 1 Hz `setInterval` fires `tick` unconditionally (`store.ts:722`), and `notifyInspection` runs on **every** event whether or not the context changed (`@xstate/store` `dist/store-55b22bbd.js:651`). The 20-slot action log therefore fills with `tick` within 20 seconds of idle and erases the real history. |
| A13 | Staging table: staged renames, dirty rows, `Adopt` commits | **FAKED** | The table and dirty marking exist (`panes.tsx:285-333`). **`Adopt` never sends the renames.** `host.adoptZones(session, doc, zones)` takes zone ids only (`store.ts:542`, `host.ts:116`), and `adoptResolved` then **deletes** the staged edits (`store.ts:565`). The staged work is discarded silently by the verb that claims to commit it. The report describes this as "Staged rename rows, dirty count, Adopt refusal … all stay in the centralized object" and never mentions the loss. |
| A14 | Refusal derived, never flagged | **met** | `selectAdoptRefusal` `store.ts:222-232`, pure, exported, re-checked inside the `adopt` transition (`:538`). |
| A15 | Recent folders max 8, pane widths persisted | **met** | `slice(0,8)` `store.ts:598-601`; `persist()` on `addFolder` and `resizePane` (`:604,:705`). |
| A16 | Hover in page memory, not URL | **met** | `hoverAtom` `store.ts:236`, never emitted to search. |

Score: 8 met, 6 partial, 1 faked, 0 missing.

## B. Census R1–R20

| # | Score | Evidence |
|---|---:|---|
| R1 addressable, one mechanism | 2 | All 6 bindings plus `stage` and `zones` in router search, `state-bench.xstate.tsx:17-26`. No `useState` binding anywhere. |
| R2 clears dependents by declaration | 2 | `BINDINGS` + `descendants` + `pickInto`, `store.ts:35-59`. Zero effects. Strongest row in the proto. |
| R3 machine-readable basis, freshness computed from it | 1 | `CacheEntry.basis` is written by all four helpers (`store.ts:158-179`) and **read by nothing** — a grep for `.basis` returns no read site. `deriveFeed` ignores it and infers from flags; `idle` becomes `fresh`. Write-only metadata. |
| R4 write declares its invalidations at the read's identity | 1 | `adoptResolved` sets `cache.zones.stale = true` by field name (`store.ts:566`). Better than a positional `queryKey[2]`, still hand-written per write, and it names one read only. |
| R5 optimistic and write-through one mechanism | 1 | One write, no optimism. Not exercised, so not disproved. |
| R6 staged edits: declared home, stated lifetime, per-cell "what a write would send" | 1 | Home declared (`stagedRenames`, `store.ts:83`), lifetime = store. The third clause fails outright: no write carries them (A13). |
| R7 write result into read model without cache surgery | 1 | No splices — the receipt triggers a full re-read (`store.ts:554-567`). Clean, but it discards the receipt's information and pays 500 zones for it. |
| R8 selection and hover first-class, shared, separable | 2 | `hoverAtom` plus `search.zones`; every pane signature is `{ bench }` (`panes.tsx:215,248,285`). No prop drilling at all. |
| R9 derived order without a parent round trip | 1 | No filter, sort, or cursor in the proto. Not exercised. |
| R10 verb as one bracket | 1 | In-flight identity, elapsed seconds, receipt, and toast all present (`store.ts:537-573`). Failure is `error: string`, not a typed kind (`:544`). "Links it touches" is hard-coded inside `adoptResolved`, not declared. |
| R11 refusal computable before the verb | 2 | `selectAdoptRefusal` `store.ts:222-232`; ordered reasons; rendered as the button title and an inline caption (`panes.tsx:158,164-166`). |
| R12 manifest as data, evaluated once | 1 | `BINDINGS` is a module constant. The stage and verb manifest is inline JSX rebuilt every render (`panes.tsx:132-163`). Half the requirement. |
| R13 derivations pure, exported, testable without React | 2 | `pickInto`, `selectSessionsFeed` through `selectR10Feed`, `selectWorld`, and `selectAdoptRefusal` are all exported and hook-free (`store.ts:48,199-232`). The test imports four of them directly. |
| R14 route mountable with an injected data source | 2 | `createBenchState(host, search)` `store.ts:234`. Proven by `bench.test.ts` with no browser and no network. |
| R15 loading/empty/error/fixture distinct, no fifth | 1 | `idle` collapses into `fresh`; `empty` is invented **in the view** as a string suffix (`panes.tsx:22`), which is the fifth state the requirement forbids. |
| R16 identity change, one reset protocol | 1 | `pickInto` is one protocol for the URL half, reused by `sessionGone` (`store.ts:682`). The cache half is hand-reset with `idle()` at five separate sites (`:317-319,:458,:616,:647,:687`). Two protocols. |
| R17 server data not shadowed by local edits without a merge rule | 1 | `renameZone` auto-drops an edit equal to the original (`store.ts:530-535`), and `adopt` clears all. A `docChanged` re-read leaves `stagedRenames` keyed to possibly-vanished ids with no stated rule. |
| R18 cross-surface writes visible | 0 | `localStorage` is written with no `storage` listener and no cross-tab path (`store.ts:154-156`). Not attempted. |
| R19 no hand-maintained dependency list per derivation | 1 | No dep arrays and no eslint suppressions — real progress. But the same information is hand-maintained as **6 basis template strings** (`store.ts:346,386,436,465,499,516`) and **11 stale-response race guards** (`:340,:374,:387,:422,:489,:504,:620,:624,:651,:655,:680`). A dependency list respelled. |
| R20 freshness captions self-update or say they do not | 0 | `Feed.at` is populated (`store.ts:171`) and consumed by nothing — no read in `panes.tsx`. No caption, no disclaimer. |

**Census total: 24 / 40.**

## C. qr-repo R1–R16

| # | Score | Evidence |
|---|---:|---|
| R1 async derived declared as a peer of sync derived | 0 | Three idioms in one file: pure selectors (`store.ts:199-232`), event-pair chains (`:301-521`), and `createAsyncAtom` (`:243-246`). This is the pattern's core requirement and the proto's worst failure. |
| R2 one route = one statically readable state module | 2 | `store.ts` holds every node. `createBenchState` returns store, selectors, atoms, and lifetime (`:741-773`). |
| R3 automatic dep tracking including across `await` | 0 | Every dependency is hand-spelled (see B/R19). |
| R4 dependent async as straight-line `await` | 0 | It is neither `await` nor `enabled:`. It is an event chain across 6 transitions with a guard on each. |
| R5 exhaustive loading/error/data match at the read site | 0 | `Feed.state` is a 6-member union; no consumer is forced to match. `FeedStatus` is a ternary chain with a catch-all (`panes.tsx:11-18`), and panes read `feed.options?.map` regardless of state. |
| R6 consumers take the state object | 2 | Every component takes exactly `{ bench }`. Adding a node costs zero call-site edits. |
| R7 URL-backed inputs, per-field schema and fallback, one declaration | 1 | One `validateSearch` with a fallback per field (`state-bench.xstate.tsx:17-26`), readable `k=v`. Hand-rolled coercers, and the store shadows it (A2). |
| R8 escape hatch for invalidation rules, ideally cycle-detected | 1 | `enqueue.trigger` and `enqueue.effect(({trigger}) => trigger.refreshZones())` (`store.ts:556,690`) work. No cycle detection — the library drains `pendingEvents` in an unbounded `while` loop. |
| R9 value objects capture reactive display config | 1 | No units or formatting axis in this scenario. Not exercised, not blocked. |
| R10 zero React lifecycle coupling | 2 | Proven, not asserted: `bench.test.ts` builds and drives the whole state object with no renderer. |
| R11 keep-previous-data on invalidation | 2 | `loading(previous, basis)` and `failed(previous, …)` spread the old `data` (`store.ts:159-179`); `stale` keeps it outright. Panes never blank on refresh. |
| R12 real `AbortSignal` threaded to the fetch | 0 | `MockHost` accepts no signal (`host.ts:50-65`). The `createAsyncAtom` callback does not even destructure `{ signal }` (`store.ts:243-246`), so the one abort feature the report praises is not wired. |
| R13 explicit disposal tied to route lifetime | 1 | `dispose()` clears the interval and both subscriptions (`store.ts:768-772`); the route calls it (`state-bench.xstate.tsx:48`). In-flight host promises still resolve and call `trigger` on a disposed store. |
| R14 errors distinct from empty | 1 | `error` carries a `note`. `idle` is indistinguishable from `fresh`, and `empty` is a view-side suffix. |
| R15 cache/dedup by key | 1 | Exactly one dedup, hand-written for one read: `sessionRequest ??=` (`store.ts:238-242`). The other five reads have no key and no dedup — two rapid `Refresh zones` clicks issue two `listZones` calls. |
| R16 Suspense and error-boundary interop | 0 | Three boundaries, nothing suspends, no error boundary (A8). |

**qr-repo total: 14 / 32.**

## D. Store-vs-view split

This is the proto's strongest result and the one headline claim that survives scrutiny.

| Measure | Count | Detail |
|---|---:|---|
| `useState` in components | **1** | `state-bench.xstate.tsx:38` — store construction. Belongs there; it is the composition root. |
| `useEffect` in components | **1** | `state-bench.xstate.tsx:42-50` — subscribe to `searchChanged`, dispose on unmount. Belongs there; it is the router adapter. |
| `useTransition` in components | **1** | `state-bench.xstate.tsx:37`. Belongs there, though it wraps the wrong thing (A10). |
| `useState`/`useEffect`/`useMemo`/`useRef`/`useCallback` in `panes.tsx` (443 lines) | **0** | Verified by grep. No pane holds any React state. |
| Lines of state logic inside components | **≈ 9 of 496** (1.8 %) | Listed below. |

Every hook in a component belongs where it is. Nothing is trapped in the shell.

| Line | Logic in the view | Belongs in the store? |
|---|---|---|
| `panes.tsx:220,253,290` | `new Set(search.zones)` × 3 | **Yes.** One `selectedSet` selector. Rebuilt per pane per render; a direct cause of A11. |
| `panes.tsx:22` | `feed.options?.length === 0 && feed.state !== "loading"` renders `· empty` | **Yes.** Invents a state the `Feed` union does not carry (R15). |
| `panes.tsx:128` | `selectAdoptRefusal(context, bench.host.fixture)` called per render | Borderline. Pure and exported, but it maps 500 zones inside `deriveFeed` on every Toolbar render. Should be a `store.select`. |
| `panes.tsx:129` | `context.search.session \|\| "session-2026"` | **Yes.** A hard-coded binding fallback hiding in a devtools button. |
| `panes.tsx:294` | `Object.keys(staged).length` dirty count | **Yes.** Trivial, but it is a derivation. |
| `panes.tsx:401` | `planVisible ? widths.plan : 0` grid template | No. Layout. |
| `panes.tsx:305` | `staged[zone.id] !== undefined` per-row dirty | No. Row rendering. |

Two subscription smells work against the split: `useSelector(bench.store, (s) => s.context)` in `Toolbar` (`panes.tsx:127`) and `Inspector` (`:352`) subscribe to the whole context, so any store event re-renders both. `Inspector` is open by default (`store.ts:272`) and `JSON.stringify`s the entire context — including all 500 zones — on every store event.

## E. Refutation

The verdict under test: *reject as sole architecture; keep as a page-memory and command layer beside a real cache owner.* **The verdict survives.** The evidence offered for it does not, in four places.

| # | Claim | Judge | Why |
|---|---|---|---|
| E1 | "Mockable **5/5**" | **Partially refuted → 4/5** | The swap is one line and the no-React test is real (A6, A7). But `createFixtureHost()` and `createMockHost()` are the **same function** with one boolean (`host.ts:86,136-137`); there is no second dataset, so the seam is proven only against itself. And fixture-ness is not a property of a read: it is a boolean argument threaded into all six selectors (`store.ts:733-739`) and into `selectAdoptRefusal(context, host.fixture)`. Swap in a host that is not `MockHost`-shaped and the parameter has nowhere to come from. |
| E2 | "The store owns both waterfalls, recursive invalidation, stale feeds, rejection, write refresh, and push refresh — **3/5**" | **Confirmed, and 3/5 is generous** | The ownership is real (`store.ts:301-700`), and A1/A5 are the two cleanest results here. The unpriced cost is larger than the report states: 11 hand-written race guards, 6 basis strings, `basis` itself never read, dedup for one of six reads, no `AbortSignal` anywhere, and no cancellation of general effects. That is a query cache, hand-written, missing five of its features. |
| E3 | "Perf: hover handler median **0.000 ms**, p95 0.100 ms" | **Refuted** | The measurement times `hoverAtom.set` and nothing else (`store.ts:750-752`). `atom.set` propagates synchronously and returns; the React commit is scheduled after it. A near-zero number here is arithmetic, not performance. The honest figure is in the same report — 33.0/5.2/11.9 ms of commit — and the **candidate's own screenshot disagrees with the report**: `commits list/plan/staging 3/1/3 · last durations 63.60/4.20/11.30 ms`. 63.6 ms for the list pane is about 15 fps against a 60 fps requirement. The report leads with the meaningless metric and buries the failing one. |
| E4 | "Staged rename rows … and the post-write stale refresh all stay in the centralized object" (§3) | **Refuted** | `Adopt` sends zone ids only and then deletes the staged renames (`store.ts:542,565`; `host.ts:116`). The staging pane's stated purpose is unimplemented, and the report reads as if it were done. This is the one place the report is not honest about a gap. |
| E5 | "`store.can.<event>`: derive verb refusal from the same transition that executes it" (§10 steal list) | **Refuted as proto evidence** | A grep for `store.can` over the proto returns nothing. The refusal is a hand-written `selectAdoptRefusal` (`store.ts:222-232`), and the transition re-checks it by calling that function (`:538`). The library feature is cited from the README and never exercised. It may still be worth stealing; this proto is not the evidence. |
| E6 | "`createAsyncAtom` demonstrates abort and stale-suppression for the root session list" (§4) | **Refuted** | The callback ignores `signal` entirely (`store.ts:243-246`) and its result is not the cache — the cache is filled by a parallel `readSessions()` bridge (`:712-715`). The atom's only consumer renders the string `atom:done` (`panes.tsx:56`). It is a demo prop. Related dead code: the `refreshSessions` transition (`store.ts:288-300`) and `sessionRefreshAtom` are never triggered by anything — 22 unreachable lines that `vp check` cannot see. |
| E7 | Report §6: "With Plan hidden … Hidden Plan subscriptions did not fire." | **Confirmed** | Consistent with `Activity mode="hidden"` unmounting effects, which unsubscribes `useSyncExternalStore`. The claim is modest and matches the library. |
| E8 | Report §7 admission that the URL mirror is "a second representation and a risk" | **Confirmed, and under-stated** | There is no inbound URL→store path at all (A2). `replace: true` masks it for the back button, but any deep link or sibling navigation into `/state-bench/xstate` after mount leaves the store on stale bindings with no reconciliation. |

One correction in the candidate's favour: a plausible objection — that the always-on 1 Hz `tick` re-renders every pane — does **not** hold. `createStoreTransition` preserves the snapshot reference when a handler returns the same context (`dist/store-55b22bbd.js:869-874`), so an idle tick does not propagate. It does still pollute the inspector (A12), because `notifyInspection` is unconditional.

## F. Pattern grafts — what a different winner should steal

| # | Graft | Where | Why it is worth taking |
|---|---|---|---|
| F1 | **`BINDINGS` + recursive `descendants` + `pickInto` as one declaration for every binding tree** | `store.ts:35-59`, 25 lines | Answers census R2 and R16 outright, for **two independent trees**, with no effects and one unit test. It is library-agnostic — plain data and a pure function. Whatever wins should copy this file region verbatim. |
| F2 | **`{ bench }` as the only prop any pane takes** | `panes.tsx:215,248,285`; `store.ts:741-773` | qr-repo R6 in practice. Zero `useState` across 443 lines of view, and adding a state node costs no call-site edits. Contrast the census's 8- and 9-prop pane signatures. The mechanism is a returned object of selectors, not an XState feature. |
| F3 | **`enqueue.effect` / `enqueue.emit`: commit first, then side-effect through a narrow seam** | `store.ts:288-300,:554-567`; `state-bench.xstate.tsx:43-45` | The router adapter is 3 lines because the store *emits* a search instead of navigating. The same seam gives the inspector its history for free. Any winner that navigates from inside its store will be harder to test than this one. |

Anti-graft, worth stating: do **not** copy `deriveFeed`'s flag-based state inference (`store.ts:180-197`). Compute freshness from `basis` and `at`, or delete both fields.

## Summary

| Axis | Result |
|---|---|
| Scenario | 8 met / 6 partial / 1 faked / 0 missing |
| Census R1–R20 | 24 / 40 |
| qr-repo R1–R16 | 14 / 32 |
| Store-vs-view split | ≈ 9 of 496 view lines carry state logic; 0 hooks in panes |
| Proof | `vp test` 5/5 pass, 484 ms; `vp check` clean on all 5 files |
| Report honesty | High, with one exception (A13/E4) and one misleading headline metric (E3) |

The candidate proves the two things a state layer should make easy — declarative descendant clearing, and a view layer with no state in it — and proves, at 775 lines, that `@xstate/store` makes the async centre hard. It hand-writes a query cache and reaches about 40 % of one. The report reaches the right conclusion; a judge should not accept its 5/5, its perf numbers, or its staging-pane claim.

VERDICT: hybrid — reject `@xstate/store` as the state architecture, but graft its `BINDINGS`/`pickInto` reset declaration and its `{ bench }`-only pane contract onto whichever candidate owns the async cache.
