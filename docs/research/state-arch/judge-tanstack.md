# Judge — candidate `tanstack`

Adversarial review of `03-tanstack.md` and its proto. Date: 2026-08-24. Worktree:
`Pe.Tools-sb-tanstack`, commit `58816cf`.

## Path legend

| Short | Full path (from `ts/apps/web/src/`) |
|---|---|
| `model.ts` | `state-bench/tanstack/model.ts` (663 lines) |
| `view.tsx` | `state-bench/tanstack/view.tsx` (459 lines) |
| `mock-host.ts` | `state-bench/tanstack/mock-host.ts` (165 lines) |
| `bench.test.ts` | `state-bench/tanstack/bench.test.ts` (80 lines) |
| `route.tsx` | `routes/state-bench.tanstack.tsx` (48 lines) |

## Proof lane — what I ran, not what the report claims

| Command | Result |
|---|---|
| `vp run @pe/web#test -- state-bench` (the command the mission gave) | FAILS: `Task "state-bench" not found`. The report's command form, `vp test src/state-bench/tanstack/bench.test.ts`, is the correct one. |
| `npx vp test state-bench --run --reporter=verbose` (from `apps/web`) | 1 file, **5 tests, 5 passed**, 342 ms. All five named cases exist and pass. |
| `npx vp check` (from `ts`) | **exit 0**. 437 files formatted; 398 files with no lint, warning, or type error. |
| `git diff --stat main...HEAD` | 2 new deps (`@tanstack/store`, `@tanstack/react-store`), 325 lockfile lines, 7 proto/doc files. No unrelated source edits. |

The report's test count, pass count, and `vp check` claim are true. The report's LOC table
(663 + 165 + 459 + 48 + 80 = 1415) is true.

---

## A. Scenario compliance

| # | SCENARIO requirement | Verdict | Evidence |
|---|---|---|---|
| A1 | Re-picking a parent clears every descendant | **met** | `model.ts:231-241`; `bench.test.ts:18-32` passes |
| A2 | Every binding in URL search, reload restores | **partial** | `route.tsx:17-26` validates. But the URL is a **mirror**, not the source. `page.search` (`model.ts:65`) is canonical; `patchSearch` writes the store first, then calls `searchWriter` (`model.ts:612-619`). Two writable copies of one truth |
| A3 | `Feed` = options + `FeedState` | **partial** | `model.ts:41-46, 601-609`. `live` is never produced. `model.ts:609` returns `fresh` for a query with no data, no fetch, and no basis — the exact S8/S9 lie the census condemned. `fixture` (`model.ts:602`) is a knob echo returned **before** the query is consulted |
| A4 | `stale` after adopt | **met** | `model.ts:605` reads `state.isInvalidated`; `model.ts:360` produces it. `bench.test.ts:34-50` passes. This gives census Q2 a real producer |
| A5 | 1-in-4 failure → `error` feed | **met** | `mock-host.ts:120`; `model.ts:604`; `bench.test.ts:52-66` passes |
| A6 | push `docChanged` invalidates doc+views+zones | **partial** | `model.ts:635-644, 433-446`; `bench.test.ts:68-80` passes. But the Plan pane's key `[KEY,"zones-suspense",...]` does not match the filter `[KEY,"zones",session]` under `partialMatchKey` (`query-core/build/modern/utils.js:94-105`). The Plan pane is never invalidated. See E4 |
| A7 | ONE-LINE fixture swap at the composition root | **partial/faked** | `model.ts:660-661` is one line and the test uses it (`bench.test.ts:7,19`). The **app does not**: `view.tsx:7` imports the module singleton `tanstackBench` (`model.ts:663`), and the UI toggle uses a second, different mechanism — a host hot-swap inside a live bench (`model.ts:307-319`). One requirement, two mechanisms |
| A8 | vitest, no React | **met** | `bench.test.ts` imports no React. 5/5 verified above |
| A9 | Each pane `<Suspense>`-wrapped, per-pane fallback, both styles | **met, with dead code** | `view.tsx:42, 46, 50`. Only Plan can suspend (`view.tsx:341`). `ZoneList` and `Staging` read stores and never suspend, so their fallbacks (`view.tsx:42, 50`) are unreachable. The brief asked for both styles, so the intent is met |
| A10 | `<Activity>` on the plan pane; state kept; note the cost | **met** | `view.tsx:45-49`. Report §1 and §6 give the measured hidden-pane figure (0 Plan renders) and correctly attribute it to React, not to a TanStack integration |
| A11 | `useTransition` on the binding pick | **partial** | `view.tsx:86-88, 188`. `useStore` is a deprecated alias for `useSelector`, which is `useSyncExternalStoreWithSelector` (`react-store/dist/useSelector.js:33`). React applies external-store updates synchronously; the transition can not defer them. `pending` renders; "the sentence stays responsive" is not proved |
| A12 | Hover across 3 panes at 500 zones, measured | **partial** | Instrument at `model.ts:249-268`. One dev-browser sample: 11.80 ms / 6 renders. The counter mutates state **during render** (`view.tsx:322, 354, 388`), which is an impure render. No sustained pointer-move sample, no Profiler commit count |
| A13 | Devtools wired, **screenshot it** | **partial** | Wired at `view.tsx:71-77` (Query panel + own `<pre>` inspector). No screenshot in the repo; report §8 says the file scope excluded binaries. The visual claim is unverifiable |
| A14 | Staging table: staged renames, dirty rows, Adopt commits then invalidates | **met** | `view.tsx:387-409`; `model.ts:274-276, 325-386` |
| A15 | Refusal reasons DERIVED, never flagged | **partial** | `adoptRefusal` is derived (`model.ts:581-587`) but omits `session`, `doc`, `view`, which the brief names. The `Open in RHVAC` refusal is a JSX flag: `disabled={!r10}` (`view.tsx:200`) |
| A16 | Persisted: recent folders max 8, pane widths | **met** | `model.ts:190-208, 283, 288-294` |
| A17 | Route compiles under `vp check` | **met** | verified, exit 0 |
| A18 | Verb bracket: busy + seconds counter + receipt toast | **met** | `model.ts:330-348`; `view.tsx:57-61, 214` |

Score: 9 met, 8 partial, 1 partial/faked, 0 missing.

---

## B. Census rubric R1–R20

| R | 0/1/2 | Evidence (one line) |
|---|---:|---|
| R1 addressable, one mechanism | 2 | Every binding, `stage`, and selection live in `validateSearch` (`route.tsx:17-26`) |
| R2 clear dependents by declaration | 1 | `pick` is a declarative if-chain (`model.ts:234-237`), but `doc` is written from an async observer callback (`model.ts:166-169`) — an effect-driven binding write |
| R3 machine-readable basis | 1 | `isInvalidated` and `dataUpdatedAt` are real basis (`model.ts:605-608`); `model.ts:602` and `:609` assert a state with no basis |
| R4 write declares its invalidations at the read's identity | 2 | `zonesOptions(...).queryKey` is reused for the write (`model.ts:351, 360`); no positional key literal anywhere |
| R5 optimistic + write-through one mechanism | 1 | One mechanism (`setQueryData`), but two calls per write, the second admitted as a workaround (`model.ts:361-365`) |
| R6 staged edits: declared home, stated lifetime, per-cell "what would a write send" | 1 | `page.staged` is a declared home that dies with the object; no per-cell write preview, and `Receipt` carries no rename payload |
| R7 write returns its result without hand-written cache surgery | 0 | Two hand-written map-splices into cache (`model.ts:353-359, 363-365`) |
| R8 selection and hover first-class, shared, separable | 2 | `search.zones` + `hovered` store, read by all three panes with zero props (`view.tsx:323-324, 355-356, 389-391`) |
| R9 derived view order without a parent round trip | 2 | `derived.zones` is computed once and read directly by each pane |
| R10 verb bracket incl. typed failure kind | 1 | Identity, elapsed, receipt, and touched key are present; failure is a bare `string` (`model.ts:378-380`), and `adopt` has two failure channels — a throw (`:328`) and a `null` return (`:382`) |
| R11 refusal computable from state | 1 | Derived for `adopt`; flagged in JSX for `Open in RHVAC` (`view.tsx:200`) |
| R12 manifest is data, evaluated once | 2 | No per-render manifest literal; option factories and verbs are methods |
| R13 every derivation is a pure exported function | 1 | `derive()` and `feed()` are **private methods on a class** (`model.ts:530, 601`), not exported pure functions. Testable through the object only |
| R14 route mountable with an injected data source | 1 | The object accepts an injected host (`model.ts:139`), but the route imports a module singleton (`view.tsx:7`), so the route can not be mounted against another host |
| R15 loading / empty / error / fixture distinct | 1 | Four exist; `empty` is not distinct from `fresh`; `live` is dead vocabulary |
| R16 identity change → one reset protocol | 1 | `pick` clears descendants and `sessionGone` clears the session (`model.ts:642`); `bootDefaults` re-seeding (`:210-229`) plus the doc-observer write are a second protocol |
| R17 server data not shadowed by local edits without a merge rule | 2 | One stated rule, `page.staged[id] ?? zone.name`, applied in derive (`model.ts:536`) and reused in the row (`view.tsx:403`) |
| R18 cross-tab / cross-surface writes visible | 0 | `localStorage` is written, never observed; no `storage` listener |
| R19 no hand-maintained dependency list per derivation | 1 | Automatic inside Store (`createStore(() => this.derive())`, `model.ts:164`); manual across the Query seam — a hand-rolled `cacheRevision` counter (`model.ts:116, 518, 531`) |
| R20 freshness captions self-update or say they do not | 0 | `FeedChip` prints the state word only (`view.tsx:167-173`); `feed.at` is carried and never rendered; no statement that it does not tick |

**Census total: 23 / 40.**

---

## C. qr-repo rubric R1–R16

| R | 0/1/2 | Evidence (one line) |
|---|---:|---|
| R1 async derived declared as a peer of sync derived | 0 | Sync derived is `createStore(() => ...)`; async is `QueryObserver` + `setOptions` + a revision counter. Two vocabularies. `@tanstack/store@0.11.1` ships `createAsyncAtom` (`dist/atom.d.ts:15`) and the proto never used it |
| R2 one route = one statically readable state module | 2 | `model.ts` holds every node; `TanstackBench` reads top to bottom |
| R3 automatic dependency tracking, incl. across `await` | 1 | Automatic inside Store; manual across the Query boundary (`model.ts:516-528`) |
| R4 dependent async as straight-line `await`, not `enabled:` | 0 | `enabled:` at `model.ts:465, 473, 481, 490, 498`, plus imperative rewiring in `syncObservers` (`:501-508`) |
| R5 exhaustive loading/error/data match, statically enforced | 0 | `Feed.state` is a string union checked with `===` in JSX (`view.tsx:310-311`). No exhaustive match, no compiler enforcement |
| R6 consumers take the object; adding a node costs zero call-site edits | 2 | Every component imports `bench` and selects a slice |
| R7 URL inputs, per-field schema + fallback, one declaration | 2 | `route.tsx:17-26`, readable `k=v` |
| R8 escape hatch for input-writes-from-derived-reads | 1 | Present (`model.ts:166-169`) but ad-hoc, with a hand-written equality guard and no cycle detection |
| R9 value objects capture reactive display config | 0 | Not attempted, not discussed |
| R10 zero React lifecycle coupling | 2 | Proved by 5 verified no-React tests |
| R11 keep-previous-data on invalidation | 2 | `staleTime: Infinity` + `isInvalidated` keeps the rows and marks them stale (`model.ts:105, 605`) |
| R12 real `AbortSignal` threaded to the fetch | 0 | No `queryFn` takes `{ signal }` (`model.ts:457, 464, 472, 480, 488, 496`); `cancelQueries` (`:625-633`) can not stop the mock. Report §4 states the rule and the proto breaks it |
| R13 explicit disposal tied to route lifetime | 0 | `destroy()` exists (`model.ts:448-452`) and **the route never calls it**. `route.tsx:37` returns no cleanup, so a dead `navigate` closure is retained after unmount. The bench is a module singleton |
| R14 errors surface distinctly from empty | 1 | `error` is distinct; `empty` is not |
| R15 cache/dedup by key | 2 | The Query cache is the reason to pick this stack |
| R16 Suspense / error-boundary interop | 1 | Suspense works for one pane, through a mirror key (`model.ts:388-398`); no error boundary anywhere |

**qr-repo total: 16 / 32.**

---

## D. Store-vs-view split

The split is the proto's best result. Measured, not claimed.

| Metric | Value |
|---|---|
| State/host lines | 828 (`model.ts` 663 + `mock-host.ts` 165) |
| View/route lines | 507 (`view.tsx` 459 + `route.tsx` 48) |
| **Lines of state logic inside components** | **~22 of 507 (4.3 %)** |
| Baseline for comparison | 114 `useState` across the shells (census §9.1) |

Every React hook in the view and the route:

| Hook | Site | Belongs in the store? |
|---|---|---|
| `useTransition` | `view.tsx:86` | No. A React-only concern. Correct place |
| `startTransition` | `view.tsx:188` | No. Correct place |
| `useState("")` — folder draft | `view.tsx:227` | **Yes.** The draft that feeds `addFolder` is page memory; `recentFolders` already lives in the store (`model.ts:73`). This is the one leak |
| `useCallback` — `writeSearch` | `route.tsx:32-35` | No. It closes over `navigate`. Correct place |
| `useEffect` — `connectSearch` | `route.tsx:37` | Partly. The URL↔store bridge is state logic; it is here because Router hands `search` only inside React. It also **has no cleanup**, which is a defect, not a placement choice |
| `useEffect` — `connectStorage` + `bootDefaults` | `route.tsx:38-41` | Partly. Same reason. Neither call is disposed |

Other state logic that leaked into JSX:

| Site | What leaked |
|---|---|
| `view.tsx:200` | `disabled={!r10}` — a refusal rule, flagged not derived |
| `view.tsx:403` | `value={staged ?? zone.name}` — the merge rule, restated where `derive()` already applied it (`model.ts:536`) |
| `view.tsx:322, 354, 388` | `bench.recordRender(...)` — a store write during render |

No `useState` holds domain state. No prop drilling: the deepest pane prop signature is
`{ zone }`. This is a real improvement on every baseline route.

---

## E. Refutation

Default is "refuted" where the proto does not prove the claim.

### E1. "Mockable — 5/5. The fixture swap is one line." → **partly refuted**

- One line is true **for the test** (`bench.test.ts:7, 19` → `model.ts:660-661`).
- It is not the app's mechanism. `view.tsx:7` imports the singleton `tanstackBench`
  (`model.ts:663`), built with the live host. The fixture checkbox calls `setKnobs`
  (`view.tsx:255-257` → `model.ts:307-319`), which hot-swaps a pre-built host pair inside a
  live bench and keeps the same `QueryClient`. The brief asked for **one** swap that works in
  both places. There are two.
- The test's fixture assertion is close to tautological. `feed()` returns
  `{ state: "fixture" }` from the knob at `model.ts:602`, **before** it reads any query.
  `expect(feeds.zones.state).toBe("fixture")` (`bench.test.ts:11`) therefore tests the knob,
  not the read. The adjacent length assertion (`:12`) is what carries the case.
- Score should be 4/5, not 5/5.

### E2. "Centralized importable object — 4/5." → **partly refuted**

- The object is real and framework-independent. That part holds.
- `model.ts:663` constructs it **at module import**. The constructor subscribes six
  `QueryObserver`s (`model.ts:165-173`), and a `QueryObserver` starts fetching on its first
  subscription. So `import "./model"` fires `listSessions()` against the live mock host and
  opens a host-event subscription. Every test run pays for a second live bench it never uses.
  This is hostile to SSR, which the report names as a strength in §1.
- The route never calls `destroy()`, and `route.tsx:37` returns no cleanup. Route unmount
  leaks the search-writer closure, the host subscription, and six observers.
- "Router synchronization still begins in a React effect" is the report's own caveat. The
  larger cost — no lifetime at all — is not named.

### E3. "Perf: 11.80 ms / 6 zone renders proves selector isolation." → **partly refuted**

The measured interaction is the one interaction that was isolated. The two that were not are
not measured.

| Interaction | What actually happens | Zone components re-rendered |
|---|---|---|
| Hover | `hovered` store only (`model.ts:252`) | ~6 (the report's figure; plausible) |
| **Click a zone** | `selectZone` → `patchSearch` → `searchWriter` → `navigate` (`route.tsx:33`) → `TanstackRoute` re-renders → the unmemoized tree below it re-renders | **~1500** |
| **Type one character in a staged rename** | `stageRename` → `page` change → `derive()` remaps 500 zones (`model.ts:534-537`) → `ZoneList` and `Staging` get a new array identity → both map 500 unmemoized rows | **~1000** |

Also: every hover notifies ~1500 `useSelector` subscribers (500 rows × 3 panes), each running
a selector and an `Object.is`. 11.80 ms for 6 committed renders is the honest price of that
fan-out. The report reports the number and does not explain it.

The instrument itself is impure — `recordRender` mutates `this.renderCounts` inside the render
body (`view.tsx:322, 354, 388`). It reads correctly only because the app mounts no
`StrictMode` (verified: no `StrictMode` anywhere in `apps/web/src`).

### E4. New defect the report does not name — the Plan pane is a permanently stale mirror → **confirmed**

- `Plan` reads a second cache key, `[KEY,"zones-suspense",session,doc,view]`
  (`model.ts:391`), with `staleTime: Infinity` (`:396`).
- `adopt` writes and invalidates `[KEY,"zones",session,doc,view]` only (`model.ts:351, 360`).
- `docChanged` invalidates `[KEY,"zones",session]` (`model.ts:441-444`).
- `refreshZones` refetches the `zonesObserver` only (`model.ts:322`).
- `partialMatchKey` compares element by element
  (`query-core/build/modern/utils.js:94-105`); `"zones-suspense" !== "zones"`, so **none of
  those three match the Plan's key.**

Consequence: inside one `view` binding, the Plan pane keeps drawing the zone array it first
resolved. After `Adopt`, the list and staging panes show `adopted` and the renamed labels; the
Plan pane does not. After a `docChanged` push, the list and staging feeds go `stale`; the Plan
pane is unaware. Only a `view` re-pick (a new key) or the fixture toggle
(`invalidateQueries({ queryKey: [KEY] })`, `model.ts:318`) refreshes it.

The report calls this "architecture tax caused by mixing hook suspense with a route-owned
observer graph" (§4, last bullet). That is an aesthetic framing of a correctness bug. The
brief says all three panes draw the same zones.

Method note: confirmed by source, not by a browser run. The key-matching rule is deterministic
and is quoted above; no invalidation path in `model.ts` produces a matching filter.

### E5. "Reject TanStack Store as the reason to choose the architecture." → **refuted as reasoned, correct as an outcome**

The proto never tried Store's own async primitive. `@tanstack/store@0.11.1` exports
`createAsyncAtom` (`dist/index.d.ts`, `dist/atom.d.ts:15`), which is the closest thing to the
qr-repo `asyncCompute` peer that this whole bake-off exists to find. The proto bolted Query in,
hand-wired a `cacheRevision` counter to bridge the two graphs (`model.ts:116, 518, 531`), and
then concluded that Store does not own async. That conclusion is not earned by this evidence.

The recommendation itself — Router + Query for URL and host cache — survives, because Query's
cache, dedup, and invalidation are the strongest parts of the proto (R4, R11, R15 all score 2).

### E6. Dead code the report counts as delivered

| Site | Status |
|---|---|
| `model.ts:400-417` `streamZones` + `view.tsx:281-283` button | `experimental_streamedQuery` writes to a key nothing reads. Not asked for by the brief. 18 lines of decoration |
| `model.ts:595-597` `seams` | Always `[]`. `feed()` returns `options: []` in all five branches (`:601-609`), so `feed.options === null` is never true |
| `model.ts:34` `"live"` | Declared in `FeedState`, never produced |
| `view.tsx:42, 50` | Two of three `Suspense` fallbacks are unreachable |

---

## F. Pattern grafts — what a different winner should steal

| # | Graft | Why |
|---|---|---|
| F1 | **`queryOptions` factories as the one typed key+fetch contract.** `model.ts:454-499` is the only place a key is spelled. The write reuses `zonesOptions(...).queryKey` (`:351, 360`); the invalidation reuses a prefix built from the same parts | It removes positional key knowledge from routes without inventing a key DSL. Census R4 and smells S10/S12 die on contact with this pattern |
| F2 | **`isInvalidated` as the single real producer of `FeedState.stale`.** `model.ts:605`, with `staleTime: Infinity` | Census Q2 asked whether `stale` has a producer. This answers yes, with a machine-readable basis, and it keeps the previous rows on screen while stale |
| F3 | **The store/view discipline itself.** 1 `useState`, 2 `useEffect`, 0 domain state in components, no prop drilling below `{ zone }` | 22 lines of state logic in 507 view lines, against 114 `useState` in the baseline shells. Hold the winner to this shape whatever the library |

Do **not** graft: the mirror suspense key (E4), the module-singleton composition root (E2), or
the `cacheRevision` counter (`model.ts:116, 518, 531`). That counter is the visible seam
between two dependency graphs, and it is the thing this bake-off should be trying to remove.

---

## Summary

| Axis | Score |
|---|---|
| Scenario compliance | 9 met / 8 partial / 1 faked / 0 missing |
| Census R1–R20 | 23 / 40 |
| qr-repo R1–R16 | 16 / 32 |
| State logic in components | 22 / 507 lines — the best result seen so far |
| Report honesty | High. §4, §7, §8 and the verdict all name real costs. Two claims oversell (E1, E3); one defect is reframed as taste (E4) |

VERDICT: hybrid — take Query's `queryOptions` key contract, its `isInvalidated` freshness basis, and this proto's store/view discipline, but reject the composition root, the mirror suspense key, and the `cacheRevision` bridge that proves the two dependency graphs never became one.
