# State architecture for web routes — research index

**Question.** What state layer should every future route (takeoffs, runs, family, climate,
targeting-as-substrate) be built on, given: one centralized importable state object per route;
the object owns its async waterfalls; fixtures swap in one line; devtools; perf; a clean mental
model; URL / persisted / page state kept separate; React 19 Suspense + Activity.

**Method.** Census the baseline → extract the pattern the author already likes (qr-repo) →
one shared scenario ([SCENARIO.md](SCENARIO.md)) built for real by six candidates in sibling
worktrees → adversarial reports → synthesis. Status: 2026-08-24, complete — see [08-synthesis.md](08-synthesis.md).

| # | File | Owner | Status |
|---|---|---|---|
| 00 | 00-baseline-census.md | opus | done — 24 smells, R1–R20 |
| 01 | 01-qr-repo-pattern.md | opus | done — R1–R16, W1 (tracking stops at first await) |
| 02 | 02-effect-atom.md + proto (3 rounds) | codex, `Pe.Tools-sb-effect-atom` | judged: hybrid, strongest (35/40, 26/32) |
| 03 | 03-tanstack.md + proto (store + query) | codex, `Pe.Tools-sb-tanstack` | judged: hybrid (23/40, 16/32) |
| 04 | 04-legend.md + proto | codex, `Pe.Tools-sb-legend` | judged: reject (24/40, 19/32) |
| 05 | 05-jotai.md + proto | codex, `Pe.Tools-sb-jotai` | judged: hybrid (22/40, 19/32) |
| 06 | 06-zustand.md + proto | codex, `Pe.Tools-sb-zustand` | judged: reject (24/40, 14/32) |
| 07 | 07-xstate.md + proto (valtio in report only) | codex, `Pe.Tools-sb-xstate` | judged: reject (24/40, 14/32) |
| 09 | 09-wildcards.md | opus | done — valtio, signals-react, mobx, nanostores, xstate atoms, @solidjs/signals, plain React 19, effect v4 `unstable/reactivity`. Research only, no proto |
| 08 | 08-synthesis.md | fable | done — shape S1–S10; substrate: effect v4 atoms, staged via /takeoffs |
| 09 | 09-wildcards.md (valtio, preact-signals, mobx, nanostores, xstate atoms, solid-signals, plain React, effect v4 core) | opus | done — F1 effect v4 has Atom in core; F2 uSES defeats transitions; F3 Activity unsubscribes |
| 10 | (solid-signals proto) | — | cancelled by kaitpw 2026-08-24: React only; 09 §7 keeps its primitive list as a rubric |
| 12 | 12-devtools.md — landscape (opus, done: build a TanStack plugin, ~300 lines) + build on branch `atom-devtools`, worktree `Pe.Tools-atom-devtools` (codex, done: 368 lines, browser-proven on /settings, 5 tests) |
| 13 | 13-diagram-gen.md + `state-bench/effect-atom/diagram/` | codex | done — architecture graph derivable; visual bindings irreducible; mark-table follow-up running |
| 14 | 14-takeoffs-cutover.md, worktree `Pe.Tools-takeoff-cutover` (from takeoff-frontier + its uncommitted targeting/UI) | codex | steps 1–5 reached, 33 tests, fixture lane browser-proven; judge: iterate → pass 2 done (G1–G6, G9 + devtools wired; 34 tests); G7+G8 decided & done (pass 3, ADR 0009); pass 4 done (G9–G14, 51 tests); pass 5 done (G15–G19, 52 tests, cursor 3096→42 ms); final judge: PASS — merge conditions: grep onVisibleChange callers, split devtools/docs/loop from the branch; live lane (G10) still never run; pass 6 closed the merge gate (family caller fixed, 156 tests, only the pre-existing 6-file runs/* formatting baseline is red); cargo inventory in 14 §Pass 6 — kaitpw rules on carry vs split, and on the live lane |
| 15 | 15-ui-diagram-idea.md (the Mark noun; state-combination table) | fable | done |
| — | TEACH.html — the learnings as one page (qr pattern → 4 waterfalls → feeds/writes/entities → G7/G8 → chat plugins) | fable | done |
| — | READING-GUIDE.md — fewest files + snippets per proto | opus | done |
| 11 | 11-preact.md + proto (control arm: qr-repo pattern on @preact/signals-react) | codex, `Pe.Tools-sb-preact` | judged: hybrid (22/40, 21/32, 9/10 non-negotiables) |

**Running-swarm notice (from [09](09-wildcards.md)).** Three findings change other reports:
F1 — effect v4 ships `Atom` in core at `effect/unstable/reactivity` (2 523 lines) with
`searchParam`, `kvs`, `swr`, `optimistic`, `family` and push invalidation; 02 must target
`@effect/atom-react@4`, not `@effect-atom/atom-react@3`. F2 — `useSyncExternalStore` always
re-renders at `SyncLane`, so `useTransition` cannot defer any store-backed binding pick;
jotai's `useReducer` is the exception. F3 — a hidden `<Activity>` unmounts effects, so external
store subscriptions stop, but a library graph outside React keeps running and keeps fetching.

## Nouns (align on these before anything compounds)

| Noun | Meaning here |
|---|---|
| Binding | a user pick that lives in the URL (targeting `Bound`/`Multi`) |
| Feed | legal options for a binding + their freshness (`FeedState`) |
| Waterfall | async chain where step N's input is step N-1's output (session → doc → view → zones) |
| Overlay / staging | local edits not yet written to the host; `dirty` = differs from host truth |
| Receipt | the host's answer to a write; makes upstream feeds `stale` |
| Page memory | state that dies with the route (hover, panels, busy) |
| Persisted | survives reload, not shareable via link (recents, widths) |
| Route store | the one importable object that owns all of the above for a route |

## Taxonomy — the axes a state layer is chosen on

| Axis | Poles | Why it matters here |
|---|---|---|
| Reactivity model | pull (selectors, re-render on change) ↔ push (signals/fine-grained) ↔ atoms (dependency graph) | 3 panes × 500 zones hover; derived feeds |
| Async ownership | React-owned (hooks) ↔ store-owned (observers outside React) | "state handles its own waterfalls"; no-React tests |
| Cache semantics | ad-hoc promise ↔ query cache (key, stale, invalidate, dedup, retry) | host ops are slow, flaky, and pushed |
| Composition unit | one big object ↔ many atoms ↔ machine | "entirely centralized, importable" vs granular updates |
| Dependency tracking | explicit deps (keys/args) ↔ auto-tracked (proxies/signals) | waterfall clears; stale propagation |
| Fixture seam | DI at store creation ↔ module mock ↔ provider scope | one-line swap; vitest without React |
| URL state | library-native ↔ router-native (TanStack search) + sync | bindings must be shareable links |
| Persistence | middleware/plugin ↔ hand-rolled | recents, widths |
| Suspense/Activity | first-class (`useSuspense*`, promises as atoms) ↔ status objects only | React 19 posture |
| Transition-friendly | `useReducer`/React state (yes) ↔ `useSyncExternalStore` (no — always `SyncLane`) | the scenario's `useTransition` on the binding pick; see [09 F2](09-wildcards.md) |
| Devtools | dedicated panel ↔ redux-devtools bridge ↔ none | visibility |
| Effect v4 affinity | native (effect-atom) ↔ neutral ↔ hostile | server is effect-smol; sharing schemas/services |
| Transition-friendly | `useReducer`-based binding (jotai, router search) ↔ `useSyncExternalStore` (SyncLane; de-opts `startTransition`) | binding picks must stay responsive (09 F2) |
| Maintenance risk | core-team ↔ single maintainer ↔ beta | long-term substrate |

## Candidate map (hypotheses to be falsified by the protos)

| Candidate | Reactivity | Async ownership | Cache | Composition | Suspense | Devtools | Effect v4 |
|---|---|---|---|---|---|---|---|
| effect-atom | atoms (graph) | store-owned (Effect fibers) | Result + refresh; no query cache | atoms + Registry | `useAtomSuspense` | own devtools (basic) | native — but v3 today? |
| tanstack store + query | pull + Derived | split: query cache owns async; store owns page | full | one Store + query keys | `useSuspenseQuery` | TanStack devtools (best) | neutral |
| legend-state v3 | push (signals, proxies) | store-owned (`synced`) | `synced` (partial) | one observable tree | yes (`use$` + Suspense) | weak | neutral |
| jotai | atoms (graph) | store-owned (async atoms) | none native; jotai-tanstack-query | many atoms | native (promises) | jotai-devtools | neutral |
| zustand | pull (selectors) | React-owned unless glued | none native; + query | one object | via query only | redux devtools | neutral |
| xstate/store | events → transitions | store-owned (effects) | none | machine-ish store | via atoms? | stately inspect | neutral |

Falsify: the "centralized object" want pulls toward zustand/tanstack-store/legend; the "owns its
waterfalls + Suspense" want pulls toward atoms (jotai/effect-atom). The likely answer is a hybrid
seam: a query cache for host truth + one route object for everything else. The protos decide.

Judge files: `judge-<candidate>.md` beside each report. Protos live on branches `research/state-bench-<c>` in sibling worktrees `Pe.Tools-sb-<c>`; Herdr sessions `state-arch`, `sb-<c>` were left running for inspection.
