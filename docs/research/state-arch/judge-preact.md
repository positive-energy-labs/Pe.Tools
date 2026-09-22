# Judge — candidate `preact` (CONTROL ARM)

Adversarial review of `11-preact.md` and its proto. Date: 2026-08-24. Worktree:
`Pe.Tools-sb-preact`, commit `b27ca89`.

This candidate is the control arm. The library gives signals and `createModel`. It gives no
async layer. The author wrote that layer. Every async result below is a result about
`async.ts`, not about `@preact/signals-*`.

## Path legend

| Short | Full path (from `ts/apps/web/src/`) | Lines |
|---|---|---:|
| `async.ts` | `state-bench/preact/async.ts` | 204 |
| `host.ts` | `state-bench/preact/host.ts` | 205 |
| `model.ts` | `state-bench/preact/model.ts` | 576 |
| `panes.tsx` | `state-bench/preact/panes.tsx` | 202 |
| `bench.test.ts` | `state-bench/preact/bench.test.ts` | 98 |
| `route.tsx` | `routes/state-bench.preact.tsx` | 227 |

## Proof lane — what I ran, not what the report claims

| Command | Result |
|---|---|
| `vp run @pe/web#test -- state-bench` (the mission command) | FAILS: `Task "state-bench" not found`. `@pe/web#test` is `vp run`, which lists tasks. The correct form is `vp test state-bench` from `apps/web`. |
| `vp test state-bench --reporter=verbose` (from `apps/web`) | **5 tests, 5 passed**, 1.15 s. All five required cases are present and pass. No React is imported. |
| `vp check` (from `apps/web`) | **pass**. 257 files formatted. 238 files with no warning, lint error, or type error. |
| `git diff --stat main...HEAD` | 10 files, +1 761 lines. 2 new deps (`@preact/signals-core` 1.14.4, `@preact/signals-react` 3.12.0), 22 lockfile lines. **No unrelated source edits.** |
| `wc -l` on the six proto files | 1 512 lines. The report's per-file table is true. |

The report's test count, pass count, `vp check` claim, and line counts are all true.

### Independent probes I ran (headless node, `vp exec node --import jiti/register`)

I built the model outside React five times and measured it. These are my numbers.

| Probe | Result |
|---|---|
| A — cancellation on re-pick | `host.metrics.aborted = 1` after `pickBinding("session", …)` mid-flight. Real `AbortSignal`. |
| B — descendants re-read after a pick | `zoneCalls 1 → 2`; first zone `viewId` changed `view-plan → view-upper`. The waterfall re-reads, not only clears. |
| C — disposal | After `model[Symbol.dispose]()`, `refreshZones()` **still issued one host request**. `run()` has no `disposed` guard (`async.ts:95`). |
| D — default failure rate | 9 zone calls, 0 failures, feed `fresh`. The 1-in-4 rule is **off by default** (`host.ts:91`). |
| E — refusal on an error feed | zones feed `error`, `refusal = null`. Adopt is enabled against a failed read. |
| F — push then refusal | zones feed `stale`, `refusal = "zones are stale; refresh first"`. Correct. |
| G — post-`await` dependency tracking | Node read `b` **only after** an `await`. Runs: `["a0/b0","a0/b1"]`. **W1 is fixed and proven.** |
| H — conditional dependency | A signal read on only one branch caused no spurious run. Fine-grained and dynamic. |
| I — error recovery | Node threw, went `error`, then a dependency change re-ran it to `success`. No hang. |
| J — liveness with zero React consumers | The graph ran with no component mounted. Eager, route-lifetime, not consumer-driven. |
| K — store-layer hover cost, 500 zones | `world` recompute is **0.06 ms per hover**. 20 keystrokes in the staging table cost 1.36 ms total. |
| L — inspector cost | `inspector` recompute is 0.2 ms for a 114 541-character JSON tree. Not a bottleneck. |

Probe K is the important one. See section E.

---

## A. Scenario compliance

| # | SCENARIO requirement | Verdict | Evidence |
|---|---|---|---|
| A1 | Re-picking a parent clears every descendant | **met** | `model.ts:259-283`, one `batch`. Test passes. Probe B shows the descendants also re-read. |
| A2 | Every binding in URL search; reload restores | **partial** | `route.tsx:25-34` validates. But the signals are canonical. `publish()` (`model.ts:213-215`) writes the URL, and `useEffect` (`route.tsx:58-61`) writes the signals back. Two writable copies of one truth. |
| A3 | `Feed` = options + `FeedState`, same meaning as targeting | **partial** | `host.ts:1-14`; `fromOptions` (`model.ts:536-555`). `live` is a **constructor argument** (`model.ts:127`), not a basis. Precedence puts `fixture` and `stale` **before** `error` (`:543-546`), so a failed read in fixture mode reports `fixture`. |
| A4 | Feed `stale` after adopt, then auto re-read | **met** | `model.ts:317-319`; the clear is an effect on success (`:444-446`). Test passes. Probe F. This is a real `stale` producer, which census Q2 asked for. |
| A5 | 1-in-4 `listZones` failure → `error` feed | **partial** | The rule exists (`host.ts:157`) but `failures` defaults `false` (`host.ts:91`). Probe D: 9 calls, 0 failures. The test forces `failureEvery: 1` (`bench.test.ts:57`), so **1-in-4 is never exercised anywhere**, only 1-in-1. |
| A6 | Push `docChanged` invalidates doc+views+zones | **met** | `model.ts:234-243`. Test passes. Probe F. |
| A7 | ONE-LINE fixture swap at the composition root | **met** | `route.tsx:50` is one ternary. `bench.test.ts:25` uses the same constructor. Best in field. |
| A8 | Vitest, no React, five named cases | **met** | `bench.test.ts`. 5/5 verified by me. No React import in the file or its imports. |
| A9 | `<Suspense>` per pane, per-pane fallback | **partial** | Three boundaries with distinct fallbacks (`route.tsx:175-185`). Only Plan can suspend (`panes.tsx:46`). The other two never throw, so two of the three boundaries can never fire. The report calls this "both styles"; it is one style plus two decorations. |
| A10 | `<Activity>` on the Plan pane; state kept | **met** | `route.tsx:178-182`. The subscription probe is real code (`panes.tsx:49-52`, `model.ts:399-401`). |
| A11 | `useTransition` for the binding pick | **partial** | `route.tsx:56,98`. Only the `view` picker uses it, and only through `probeTransition`. Session, doc, folder and r10 picks (`:86,92,104,113`) call `pickBinding` directly. |
| A12 | Hover across 3 panes at 500 zones, measured | **measured; failed** | `model.ts:407-424` measures with `flushSync`. Report §6: 167.20 ms. See E3 — the measurement is honest but it does not measure the library. |
| A13 | Devtools or cheapest inspector, screenshotted | **partial** | Inspector is real: `model.ts:169-191` plus `<pre>` and last-20 actions (`panes.tsx:177-179`, `model.ts:206-211`). **No screenshot.** The report admits this (§8). |
| A14 | Stages of verbs (`read` / `adopt`) | **faked** | `stage` is a URL field (`model.ts:64`) with a `<select>` (`route.tsx:117-126`). **No verb is gated on it.** All three buttons render in both stages (`route.tsx:130-160`). The stage is decoration. |
| A15 | Refusal reasons DERIVED, never flagged | **met** | `model.ts:152-160` is a `computed` and drives `disabled` (`route.tsx:147`). |
| A16 | Staging table: staged renames, dirty rows, Adopt commits | **partial** | The merge rule is one declared line (`model.ts:145-146`). But probe: after a successful adopt (`receipt.adopted = 1`) the rename is **still staged and the row is still dirty**. Adopt neither sends nor clears staged edits. The report never mentions this. |
| A17 | Persisted recents (max 8) and pane widths | **met** | `model.ts:334-343`. Cap verified at `:335`. |
| A18 | Hover in page memory, NOT in the URL | **met** | `model.ts:69`; `currentSearch()` (`:193-204`) omits it. |
| A19 | Selection multi, in the URL | **met** | `model.ts:285-291`. |
| A20 | Verb bracket: busy, seconds counter, receipt, toast | **met** | `model.ts:298-327`; `route.tsx:152`. Failure kind is untyped (`toast = String(error)`). |

Score: 11 met, 8 partial, 1 faked.

---

## B. Census rubric R1–R20

| # | Score | Evidence |
|---|---:|---|
| R1 addressable, one mechanism | 1 | URL is the address, but the signals are the writable canon and the URL is a mirror (`model.ts:213-215` out, `route.tsx:58-61` back in). One route, two copies. |
| R2 clear dependents by declaration | 1 | `pickBinding` (`model.ts:259-283`) is not an effect — good. But it is a hand-written `if/else` chain per key, not a declared parent→child table like `pickInto`. |
| R3 machine-readable basis; freshness computed | 1 | `at` is carried (`async.ts:120`). But `live` and `fresh` are call-site arguments (`model.ts:124,127`) and `stale` is three side signals (`:85-87`) cleared by three effects (`:438-446`). |
| R4 write declares what it invalidates | 0 | Adopt hand-sets `zonesStale` and calls `zones.refresh()` (`model.ts:317-319`). `docChanged` hand-lists three nodes (`:235-243`). No registry. The report admits it. |
| R5 optimistic and write-through one mechanism | 0 | Neither exists. Adopt is write-then-refetch only. |
| R6 staged edits: home, lifetime, "what a write would send" | 1 | Home declared (`model.ts:72,145`). **Lifetime absent** — proven never cleared by adopt. No per-cell write preview. |
| R7 write result enters the read model without surgery | 1 | No hand surgery — good. But no write-through either; the receipt lands in a separate signal (`model.ts:315`). |
| R8 selection and hover first-class, shared, separable | 2 | `hover` and `selectedZones` live in the store; all three panes read one `world` computed (`model.ts:142-150`) and take `{ model }` only. |
| R9 derived order without a parent round trip | 2 | `world` is a `computed`. No `visibleKeys`-style round trip anywhere. |
| R10 verb as one bracket | 1 | In-flight identity, elapsed seconds and receipt are present (`model.ts:304-326`). Failure kind is untyped. The links it touches are hand-coded. |
| R11 refusal computable before the verb runs | 2 | `model.ts:152-160`. Probe F. |
| R12 manifest as data, evaluated once | 1 | The model is built once by `useModel`, so no per-render rebuild — a real win over `/takeoffs`. But there is **no manifest**: verbs and links are inline JSX (`route.tsx:130-160`). |
| R13 derivations are pure functions, testable without React | 1 | Testable without React — I proved it five times. But they are closures inside the factory, not exported pure functions. Only `toFeed`/`fromOptions` are module-level (`model.ts:527-555`). |
| R14 mountable with an injected data source | 2 | The host is constructor argument 1. Proved in the test and in every probe. |
| R15 loading, empty, error, fixture are four distinct states | 1 | Four exist. `fixture`/`stale` short-circuit before `error` (`model.ts:543-546`). Empty is not distinct from `fresh`. |
| R16 identity change, one reset protocol | 1 | `pickBinding` is one protocol, and `sessionGone` reuses it (`model.ts:231`). But a host swap uses a second (`setFixture` → `refreshAll`, `:353-362`) and router sync a third (`syncSearch`, `:247-257`). |
| R17 server data not shadowed without a merge rule | 2 | The merge rule is one declared line: `stagedRenames.value[zone.id] ?? zone.label` (`model.ts:145`). |
| R18 cross-surface writes visible | 0 | Absent. `localStorage` writes are never read back. |
| R19 no hand-maintained dependency list per derivation | 2 | `computed` is automatic. `get(...)` is a read, not a dep array, and probes G and H prove the tracking is dynamic. Zero eslint suppressions in the proto. |
| R20 freshness captions update or state that they do not | 0 | `at` is stored in every `Feed` and **no view renders it**. The panes show only `feed.state` (`panes.tsx:14,55,84`). Nothing ticks. |

**Census total: 22 / 40.**

---

## C. qr-repo rubric R1–R16

| # | Score | Evidence |
|---|---:|---|
| R1 async derived declared as a peer of sync derived, same file | **2** | `asyncCompute` nodes at `model.ts:89-118` sit directly above the `computed` nodes at `:126-191`. One module. This is the pattern, restored exactly. |
| R2 one route = one statically readable state module | **2** | `model.ts` is one 576-line module. Every node is visible together. `BenchModel` is one constructor. |
| R3 automatic tracking, no dep arrays, **including across `await`** | **2** | Probe G: a signal read only after an `await` re-ran the node (`["a0/b0","a0/b1"]`). Probe H: a conditionally-read signal caused no spurious run. **W1 is fixed and empirically proven.** No other candidate in this bake-off has this proof. |
| R4 dependent async as straight-line `await`, not `enabled:` | **2** | `model.ts:94-108`. `awaitAsync(views, get, abort)` reads as a normal `await`. |
| R5 exhaustive loading/error/data match at the read site | 1 | `AsyncState<T>` is a real discriminated union (`async.ts:3-24`) — better than the qr-repo `AsyncState#map`. But nothing enforces exhaustive matching, no pane matches on it, and `fromOptions` reads `.pending` before `.status` in an `if` chain. |
| R6 consumers take the state object; adding a node costs zero call-site edits | **2** | Every pane signature is `{ model }: { model: BenchModelInstance }` (`panes.tsx:7,42,78,108`). |
| R7 URL inputs, per-field schema + fallback, one declaration, readable `k=v` | 1 | One `validateSearch` with per-field fallbacks (`route.tsx:25-34`), but hand-written coercers, not a schema. `zones` is an array, so the encoding is not plain `k=v`. |
| R8 escape hatch for input-writes-from-derived-reads | 1 | Four `effect()`s in the model (`:438-453`). No cycle detection. Three of them exist only to clear a stale flag, which is the escape hatch doing derivation work. |
| R9 value objects capture reactive display config | 0 | Not attempted. Nothing in the proto exercises it. |
| R10 **zero React lifecycle coupling** | 1 | The constructor is React-free and I ran it five times in node. But `armReactLifecycle` (`model.ts:512-525`) is React-StrictMode code **exported from the state module**, and the route must call `model.reconnect()` from a `useEffect` (`route.tsx:58-59`). The module now knows about React. |
| R11 keep-previous-data on invalidation | **2** | `async.ts:101-108` keeps the previous value in the pending state, and `:128` keeps it in the error state. W2 fixed. |
| R12 real `AbortSignal` threaded to the fetch | **2** | `async.ts:110` → `host.ts:113-122,189-204`. Probe A measured `aborted = 1`. W3 fixed. |
| R13 explicit disposal tied to route lifetime | 1 | `createModel` captures the effects and disposes them (`async.ts:145-148`). **But probe C: a disposed model still issues host requests.** `run()` has no `disposed` guard (`async.ts:95-136`); only the `.then`/`.catch` check it. Disposal stops state writes, not I/O. |
| R14 errors surface distinctly from empty | 1 | `error` is a distinct `FeedState` with a `note` (`model.ts:545-551`) and reaches the UI (`route.tsx:220`). Probe I proves a node recovers after a throw when a dependency changes — the exact failure judge-legend found fatal. Empty is still not distinct from `fresh`. |
| R15 cache/dedup by key | 0 | Absent. The report admits it. `refreshAll()` fires six unkeyed reads on every host swap (`model.ts:217-224`). |
| R16 Suspense / error-boundary interop | 1 | `read()` throws the in-flight promise (`async.ts:154-159`) and one pane uses it. There is **no error boundary in the route**, so `read()`'s `throw snapshot.error` (`:157`) escapes to the app shell. |

**qr-repo total: 21 / 32. Non-negotiables R1–R5: 9 / 10.**

That R1–R5 score is the highest in the bake-off. It is also the whole point of the control arm:
the author's own pattern scores best against the author's own pattern.

---

## D. Store-versus-view split

### Lines of state logic inside components

| Measure | Count |
|---|---:|
| `useState` in proto components | **0** |
| State declarations in components | **0** |
| State mutations written in a component body | **0** — every write is `model.<action>(…)` |
| Reads through the model object | 39 in `panes.tsx`, 39 in `route.tsx` |
| Lines of state logic in components | **~14** — the `publish` callback (`route.tsx:42-45`, 4), the sync effect (`:58-61`, 4), and three `countRender` calls plus one probe effect (`panes.tsx:9,44,80,49-52`, 6) |

This is the cleanest split in the field. `useModel` returns one object, and the views are a
projection of it.

### Every `useState` / `useEffect` in a component

| Site | Hook | Belongs in the store? |
|---|---|---|
| `route.tsx:42` | `useCallback(publish)` | **No.** It wraps a router hook. Correct place. |
| `route.tsx:56` | `useTransition` | **No.** React primitive. Correct place. |
| `route.tsx:58-61` | `useEffect` → `model.syncSearch(search)` | **Half.** The router-to-store bridge must be a hook. But it exists only because the URL is a mirror, not the canon; a URL-owned binding node would delete it. |
| `route.tsx:59` | `useEffect` → `model.reconnect()` | **Neither.** It is a workaround for a `useModel` bug. It should not exist. |
| `panes.tsx:49-52` | `useEffect` → `model.setPlanSubscribed` | **No.** Benchmark instrumentation for F3. |
| — | `useState` | **None.** |

### Instrumentation leaked into the store

`openPanel` (declared, never read by any view), `planProbe`, `perfResult`, `transitionResult`,
`renderCounts`, `planSubscribed`, plus `measureHover`, `probeTransition`, `countRender`,
`bumpPlanProbe`, `setPlanSubscribed` — about **52 lines of `model.ts` are benchmark harness**,
not route state. The honest store number is ~933, not the reported 985.

---

## E. Refutation

### E1 — The verdict itself: too harsh on two of its four stated grounds

The report rejects the candidate on four grounds: local async infrastructure, transition de-opt,
poor 500-zone hover, and the `useModel` lifecycle failure.

| Ground | Survives? |
|---|---|
| 204 lines of local async infrastructure | **Survives.** True and confirmed by `wc -l`. |
| Transition de-opt | **Survives as documentary fact** (React source, 09-wildcards F2). The proto's own verification is a tautology — see E2. |
| Poor 500-zone hover | **Refuted as library evidence** — see E3. |
| `useModel` lifecycle failure | **Survives, and I confirmed it in the installed package** — see E4. |

The reject stands, but two of the four legs are weaker than the report presents them.

### E2 — "F2: transition de-opt. Verified." — **REFUTED as empirical verification**

`probeTransition` (`model.ts:426-436`) calls `start(() => pickBinding("view", id))` and then
reads `view.peek()`. `startTransition(fn)` calls `fn` synchronously. A signal write is
synchronous. So the observation "it changed synchronously" is guaranteed by the two APIs, and
is true whatever lane React uses. It measures nothing about scheduling.

`pendingAtDispatch` is `isPending` taken from the render **before** the click
(`route.tsx:98`). It is `false` by construction.

F2 is about the **React render lane**. Proving it needs the commit to be observed — a paint
timestamp, a deferred DOM read, or `isPending` sampled on the next render. The proto does none
of those. The fact is still true; it rests on `ReactFiberHooks.js:1893-1917`, cited in
09-wildcards, not on this proto.

### E3 — "This fails 60 fps by a large margin" — **REFUTED as a statement about Signals**

Probe K, in node, with the real 500-zone model:

| Layer | Cost per hover |
|---|---:|
| `world` computed, 500 zones | **0.06 ms** |
| `inspector` computed, 114 541-char JSON | 0.20 ms |
| Report's measured commit | 167.20 ms |

The state layer costs 0.06 ms. **All 167 ms is React rendering 1 500 unmemoized elements**
(500 `<button>` + 500 `<rect>` + 500 `<label><input>`), in development, forced through
`flushSync`, with Strict Mode doubling every render.

Worse: the library's own answer to exactly this problem was never used. The installed runtime
defines `Signal.prototype.$$typeof` so a signal can be a JSX child and update one text node
with no component render (`@preact/signals-react/runtime/dist/runtime.js:1`). The report says
"direct signal-to-text bindings may reduce the cost, but this prototype did not add them".
That sentence concedes that the number scores the proto's rendering choices, not Signals.

The number is honestly measured and honestly reported. It is not evidence about the candidate.

### E4 — "`useModel` disposal needed a development effect-replay adapter" — **CONFIRMED**

I read the installed package, not the clone. `@preact/signals-react@3.12.0`,
`runtime/dist/runtime.js:1`:

```js
exports.useModel = function (n) {
  var t = e.useState(function () { return n() })[0];
  e.useEffect(function () { return t[Symbol.dispose] }, [t]);
  return t;
};
```

Under Strict Mode React runs the cleanup, then remounts with the **same** `useState` value. The
model is disposed and then reused. This is a real library defect, not proto error. The report's
account of the 800-retries-per-second Suspense loop is consistent with it.

The fix costs 13 lines of React-aware code inside the state module (`model.ts:512-525`) plus a
call from a route effect. It works — the deferred `setTimeout` cannot fire before the
synchronous effect pass calls `reconnect()` — but it is fragile, and it is exactly the
"zero React lifecycle coupling" that qr-repo R10 forbids.

### E5 — "asyncCompute fixes W1, W2, W3" — **UPHELD, with the strongest proof in the field**

Probes G, H and I are mine and they are decisive:

| Claim | Proof |
|---|---|
| W1 — tracking across `await` | A signal read only after an `await` re-ran the node: `["a0/b0","a0/b1"]`. |
| Dynamic, not over-eager | A signal read on only one branch caused no spurious run: `["skipped","h1","h2"]`. |
| W2 — keep previous data | `async.ts:101-108` and `:128`. |
| W3 — real cancellation | `host.metrics.aborted = 1` after a mid-flight re-pick. |
| Recovers after an error | `error` → dependency change → `success`. No hang. |

Compare judge-legend: "its async authority is 30 hand-written lines that do not re-read on a URL
write and hang after any error". The same shape of hand-written helper, 204 lines instead of 30,
does re-read and does not hang. Length bought correctness.

### E6 — "The centralized object worked" — **UPHELD**

I built `BenchModel` in node five times with three different hosts. Every state kind, every
feed, every derived value and every action was reachable with no React and no test harness.
Three panes take `{ model }` and nothing else. This is the cleanest realisation of want #1 in
the bake-off.

### E7 — Scenario claims the report does not make, and that fail

| Claim implied by the report | Verdict |
|---|---|
| The proto implements stages of verbs | **REFUTED.** `stage` is a URL field and a `<select>`. No verb is gated on it (`route.tsx:130-160`). |
| The mock host rejects 1 in 4 zone reads | **REFUTED as a default.** Probe D: 9 calls, 0 failures. The knob defaults off (`host.ts:91`), and the test uses 1-in-1 (`bench.test.ts:57`). 1-in-4 is never exercised. |
| Adopt commits the staged edits | **REFUTED.** After a successful adopt the rename is still staged and the row is still dirty. Adopt never touches `stagedRenames`. Not mentioned in the report. |
| "Every pane has a Suspense boundary" (§1) | **Literally true, materially false.** Two of the three boundaries can never fire, because only Plan calls `read()`. |
| Disposal ends the model's work | **REFUTED.** Probe C: a disposed model still calls the host. |
| Hidden `Activity` costs nothing | **Refuted for this candidate.** Probe J: the graph runs with zero React consumers. React stops rendering; `asyncCompute` keeps fetching. The report says this in §6 and is right; 09-wildcards F3's "the cost while hidden is zero" is false here. |

---

## F. Pattern grafts — what a different winner should steal

| # | Graft | Why |
|---|---|---|
| **F1** | `asyncCompute`'s explicit `get` plus `awaitAsync` (`async.ts:47-175`) | It is the only post-`await` dependency tracking in the bake-off with a direct empirical proof (probe G), and it recovers from errors (probe I) where the Legend proto hangs. Steal the **shape** — an explicit read-through tracker, a per-run `AbortSignal`, previous-data retention, and a `while (true)` await loop on a peer node. Do not steal it as a cache. |
| **F2** | `createModel` + constructor-injected host + `Symbol.dispose` (`model.ts:48-53`, `route.tsx:47-55`) | One route-sized owner, React-free, mockable by construction, and a one-line fixture swap that is identical in the app and in the test. The report names this too; my probes confirm it independently. Take the ownership contract even if another library owns server state. Do **not** take `useModel` — see E4. |
| **F3** | The one-line staged-edit merge rule (`model.ts:145-146`) | `stagedRenames.value[zone.id] ?? zone.label`, with `dirty` derived beside it. Census R17 in one line and R6's declared home in one signal. The census found three competing dirtiness models across three routes; this is the smallest correct one. Add the lifetime it is missing. |

---

## EXTRA — control-arm questions

### Helper line count

| File | Lines | Non-blank, non-comment |
|---|---:|---:|
| `async.ts` (the whole helper) | **204** | 185 |
| — types and utilities (`:1-37`) | 37 | |
| — `asyncCompute` (`:39-161`) | 123 | |
| — `awaitAsync` + `waitForChange` (`:163-204`) | 42 | |

The report's "204 lines" is exact. That is the price of fixing three holes: W1, W2 and W3.

### What it still lacks against TanStack Query

The report lists eleven gaps. All eleven are true. I add three the report omits.

| Missing | Consequence in this proto |
|---|---|
| Keyed cache and request dedup | `refreshAll()` (`model.ts:217-224`) fires six unkeyed reads on every fixture toggle. Two panes reading the same data would fetch twice. |
| Retries and backoff | A single 1-in-4 rejection is terminal until a dependency changes or a human clicks Refresh. |
| `staleTime`, `gcTime` | `stale` is three hand-set booleans (`model.ts:85-87`) cleared by three effects. |
| Focus and reconnect refetch | Absent. |
| Mutations, optimistic updates, rollback | Absent. Census R5 scores 0. |
| Infinite and paginated queries | Absent. |
| SSR dehydrate and hydrate, prefetch | Absent. Signals do not track during a server render at all. |
| Invalidation registry (key or predicate matching) | Every invalidation is a hand-written list of node names (`model.ts:235-243, 317-319`). Census R4 scores 0. |
| Error-boundary policy | No boundary exists; `read()` re-throws into the app shell (`async.ts:157`). |
| Integrated devtools | A `<pre>` and 20 action strings. |
| **Disposal that stops I/O** *(not in the report)* | Probe C: `run()` lacks a `disposed` guard (`async.ts:95`). |
| **A `disabled` / not-yet-bound state** *(not in the report)* | Unbound nodes return `[]` and the feed reports `fresh` — the same S8/S9 lie the census condemned. |
| **Structural sharing on results** *(not in the report)* | Every re-read replaces the whole 500-zone array, so `world` and all three panes recompute even when nothing changed. |

### Were F2 and F3 verified empirically?

| Finding | Verdict |
|---|---|
| **F2 — `useSyncExternalStore` renders at `SyncLane`, so `useTransition` cannot defer them** | **NOT verified empirically.** The probe is a tautology (E2). The report says "Verified"; it is not. The claim stays true on the React source cited in 09-wildcards, and I confirmed the binding itself: `use-sync-external-store/shim` is called in the installed `runtime.js`. Documentary, not experimental. |
| **F3 — `Activity hidden` unmounts effects, so external-store subscriptions stop** | **Half verified.** The React half is real instrumentation: a passive-effect probe in the pane (`panes.tsx:49-52`) plus per-pane render counters, reported as `active → unsubscribed` and 2 → 0 Plan renders. I cannot re-run a browser, so I take that on the report's word, but the code that produces it exists and is honest. The second half — "the Signals graph outside React remained alive" — is asserted with no counter. **I proved it instead** (probe J): the graph runs with zero React consumers, so a hidden pane keeps fetching. The trap 09-wildcards named is real for this candidate. |

### Control-arm summary

| Question | Answer |
|---|---|
| Does the author's own pattern beat the libraries on the author's own rubric? | **Yes.** qr-repo non-negotiables R1–R5 score **9/10**, the highest in the field, and R3 is the only one proven by experiment. |
| Does it beat them on the census rubric? | **No.** 22/40. It scores 0 on invalidation declaration, optimistic writes, cross-surface visibility and freshness captions. |
| What does the control arm prove? | That the *feel* — one module, async as a peer of sync, straight-line `await`, `{ model }` panes — is reachable in 204 lines. And that those 204 lines buy correctness, not a cache. |

---

## Summary scoreboard

| Axis | Score |
|---|---|
| Scenario compliance | 11 met / 8 partial / 1 faked |
| Census R1–R20 | **22 / 40** |
| qr-repo R1–R16 | **21 / 32** (non-negotiables **9 / 10**) |
| Store-vs-view split | Best in field. 0 `useState`, ~14 lines of state logic in components |
| Report honesty | High. It self-reports the reject, the 204 lines, the missing screenshot and the perf failure. It over-claims on F2, and is silent on stages, the failure default and staged-edit lifetime |
| Claims refuted | F2 "verified"; the 60 fps failure as library evidence; stages of verbs; the 1-in-4 default; adopt commits staged edits; disposal stops work |
| Claims upheld | W1/W2/W3 fixed (proven by me); the centralized object; the one-line swap; the `useModel` defect |

VERDICT: hybrid — reject the control arm as the production default, but promote three of its parts to requirements on whichever candidate wins: `asyncCompute`'s proven post-`await` tracking with a per-run `AbortSignal` and error recovery, the constructor-injected `createModel` ownership contract, and the one-line staged-edit merge rule; the proto's own reject rests on a 167 ms number that measures 1 500 unmemoized React elements rather than Signals, and on an F2 "verification" that is a tautology, so the honest reason to reject is the missing cache, the zero score on invalidation declaration, and a `useModel` defect that forces React lifecycle code back into the state module.
