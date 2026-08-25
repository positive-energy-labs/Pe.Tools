# Judge — /takeoffs route-store cutover

Adversarial review of branch `takeoff-cutover` (8 commits, `335906d`..`cbc89f4`) in worktree
`Pe.Tools-takeoff-cutover`. Report under review: `14-takeoffs-cutover.md`.

Baseline for every "before" number in this document is the commit `335906d~1` (identical to
`main` and to `takeoff-frontier` for all files in scope). See §F1 — the report used a different,
uncommitted baseline.

## 0. Lane facts the judge ran

| Command | Cwd | Result |
| --- | --- | --- |
| `vp test src/takeoff src/targeting` | `source/pe-tools/apps/web` | **PASS. 3 files, 33 tests, 801 ms.** |
| `vp check apps/web/src/takeoff apps/web/src/routes/takeoffs.tsx apps/web/src/targeting` | `source/pe-tools` | **PASS. 18 files formatted; 0 warnings, lint errors, or type errors.** |
| Judge probe (3 cases, written then deleted) | `apps/web` | 3 run; P1–P3 below. Worktree left clean. |

The report's two claimed lane results are exact. The 33 tests are 9 new store cases, 19
pre-existing `takeoff.test.ts` cases, and 5 `targeting/model.test.ts` cases.

Probe results, verbatim:

```
P1 withData: dirty=true conflict=true  data={"people":1,"lightingW":118,...}
P1 noData:   dirty=true conflict=false data=null
P2 after stage pick delta:      {"snapshot":0,"candidates":0,"list":0}
P2 after zones pick delta:      {"snapshot":0,"candidates":0,"list":0}
P2 after identical re-set delta:{"snapshot":0,"candidates":0,"list":0}
P3 candidates reads: before=1 after=1 (delta 0)
```

## A. S1–S10 and the four substrate rules

### A.1 The shape

| # | Part | Judge | Evidence |
| --- | --- | --- | --- |
| S1 | `BINDINGS` graph + pure `pickInto`/`descendants`, one declaration per route | **met** | `TAKEOFF_LINKS` is one exported literal (`store.ts:174`); `pick` calls the shared pure `pickInto` (`store.ts:785` → `targeting/model.ts:145`, `descendants` at `:134`). Test `store.test.ts:139` proves descendant clearing. |
| S2 | Router `validateSearch` is the only URL declaration; store emits a patch | **met** | One `validateSearch` (`routes/takeoffs.tsx:67`). Only the route calls `navigate` (`:108`). The store holds one writable `searchAtom` (`store.ts:305`) and emits through `SearchPort.patch` (`store.ts:61`, `:783`). `Atom.searchParam` appears nowhere in `apps/web/src`. |
| S3 | One `Feed` projector `(AsyncResult, basis, waiting) → FeedState` | **met** | One exported `resultFeed` (`store.ts:266`) drives all six feeds (`store.ts:508`). `stale` is produced from `result.waiting`, never asserted (`store.ts:285`). |
| S4 | `Feed.basis` — the key tuple a read came from | **partial** | `TimedRead.basis` is carried and set on every source (`store.ts:118`, `:236`), and `resultFeed` returns it (`store.ts:281`, `:289`). **No surface renders it.** `grep basis` in `atlas.tsx`, `routes/takeoffs.tsx`, `targeting/*` = 0 hits. The badge S4 exists for does not exist. |
| S5 | Fixture replaces the capability root; one-line swap in app and test | **met** | Route root picks host and session source together (`routes/takeoffs.tsx:104-106`); the test does the identical swap (`store.test.ts:158`, `:323`). |
| S6 | Per-entity view node `{hovered, selected, staged}`; panes subscribe by id | **partial** | `entityAtom` family is correct and complete (`store.ts:641-658`). Exactly **one** consumer subscribes by id (`RoomPanelFromStore`, `atlas.tsx:1594`), and it reads only `.decided`. `ZoneCard` still takes 9 props including `cursorRoom`, `busy`, `actions`, `stateOf` (`atlas.tsx:1467-1477`) — census §9.3's 9-prop signature, unchanged. The report admits the zone card; it does not admit that `hovered`/`selected`/`dirty`/`conflict` have **zero** consumers. |
| S7 | `{ store }` is the only pane prop; zero `useState` in panes | **partial** | True for the two roots: `TakeoffsPage({store})` (`routes/takeoffs.tsx:135`) and `Atlas({store})` (`atlas.tsx:362`). Not true below them: `Atlas` still holds 2 `useState` (`:390-391`), and `targeting/kit.tsx` — in mission scope — holds 4 `useState`, 3 `useEffect`, 1 suppression (`kit.tsx:74,296,297,126,299,303`). |
| S8 | A write declares the key it invalidates; the read graph cascades | **partial** | Seven sources carry declared keys; the cascade is real and directional — test `store.test.ts:278` proves one `docChanged` reaches doc + snapshot and leaves list/open untouched. **But `adopt` never invalidates `["candidates"]`** (`store.ts:673`), and probe P3 measures the consequence: 0 candidate re-reads after adopt. `["candidates"]` is declared (`store.ts:445`) and invalidated by nothing. |
| S9 | Staged edit carries its base `{base,next}`; `dirty`/`conflict` one-line derivations | **partial, and the derivation is wrong** | `StagedRoomEdit {base,next}` is correct (`store.ts:139`, `:747`). `conflict` (`store.ts:651-656`) compares flat `RoomEdit` keys against `WorldRoom` via `authority[key as keyof WorldRoom]`. Five of eight `RoomEdit` keys (`people`, `lightingW`, `equipSensible`, `equipLatent`, `ventilationCfm`) live in `WorldRoom.data`, not at top level (`world.ts` `RoomData`). Probe **P1**: a room with `data` reports `conflict=true` on its first edit with **no host change**. The `as keyof` cast is why `vp check` is green. |
| S10 | React-free owner with `dispose()`, `retain()`, `settle()`; `inspect()` returns `{url, persisted, page, feeds, actions}` | **partial** | `inspect()` returns exactly the five keys (`store.ts:1022-1037`). `dispose()` unsubscribes, clears the timer, disposes the registry (`store.ts:1039-1043`). `settle` is in `actions` (`store.ts:681`). **`retain()` does not exist.** Label coverage is 50 `Atom.withLabel` against 59 node constructions (`store.ts`) — the devtools floor is ~85 %, not total. |

**Score: 4 met / 6 partial / 0 missing.** The report scores 8 met / 1 partial / 0 missing.

### A.2 The four substrate rules

| # | Rule | Obeyed? | Evidence |
| --- | --- | --- | --- |
| 1 | Router owns the URL; **never `Atom.searchParam`** | **YES** | Zero hits repo-wide in `apps/web/src`. Round 3's biggest loss is not repeated. |
| 2 | **One `AtomRegistry` per app, module-level**, disposed by the route owner. **No nested `RegistryProvider`.** | **NO — violated in both halves** | The registry is created **per store instance** inside the factory (`store.ts:296`), and the route mounts a **nested `RegistryContext.Provider`** (`routes/takeoffs.tsx:129`) over three live Suspense boundaries (`atlas.tsx:735,874,976`). This is precisely the configuration the rule forbade pending an upstream fix. See §C/N2′ — the violation is currently *safe by accident*, and it introduces a different leak. |
| 3 | Read **individual** param atoms inside async sources; the aggregate is for the sentence only (anti-N1) | **YES, and proven** | No async source reads `searchAtom`. Each reads one derived scalar: `targetAtom` (`:396`), `viewAtom` (`:431`), `dirAtom` (`:474`), `r10PathAtom` (`:487`). The aggregate is read only by the seven derivations, `setSearch`, `pick`, and `inspect().url`. Probe **P2**: an unrelated `stage` pick, a `zones` pick, and an identical re-set each cost **0** host reads. This is the single strongest result of the cutover. |
| 4 | `inspect()` + `Atom.withLabel` on every node; pin the beta | **partial** | `inspect()` is complete. Labels cover 50 of 59 nodes. The beta is pinned at `effect@4.0.0-beta.92`. No upstream defect was filed. |

## B. Census smells S1–S24

### B.1 Status

| # | Smell | Status | Evidence |
| --- | --- | --- | --- |
| S1 | Effect with no dependency array | **SURVIVES, verbatim** | `atlas.tsx:445-470` — the keydown effect still closes `});`. Census cited `atlas.tsx:441-466`. Line moved 4; defect identical. The listener is still removed and re-added on every render of a 1 952-line component. The report names this effect and calls it acceptable "lifecycle plumbing"; it never says S1 is unfixed. |
| S2 | Memo that can never hit | **SURVIVES, relocated** | `columns` deps are `[actions, flagVocabulary, fieldsMode]` (`atlas.tsx:677`), and `actions` is a fresh object literal built every render at `atlas.tsx:368-374`. The 193-line column array still rebuilds each render. The cutover **moved** the offending literal from `routes/takeoffs.tsx` into `Atlas`; it did not remove it. |
| S3 | Hand-maintained dep array + lint suppression | **partly dead** | Frontier scope had 0 in the route, 2 in `atlas.tsx`, 1 in `kit.tsx`. After: 0 / 2 / 1. Net change **zero**. (The census's claimed 5 suppressions were measured against a version that no longer existed — see §F1.) |
| S4 | Derived state stored, then reported back up | **SURVIVES, made global** | `master-table.tsx:243-248` still pushes `visibleKeys` up; `atlas.tsx:1071-1073` still guards on identity and writes it — now into the **registry** (`store.ts:156`, `:362`); `atlas.tsx:433` still re-derives `visibleRows` from it. One render of lag remains. Census R9 unmet, and the round trip now passes through store state rather than local state. |
| S5 | Same fact in two places (`decided` vs `room.decisions`) | **survives** | `decidedAtom` family (`store.ts:369`) and `room.decisions` (`world.ts`) both still mean "this flag has a verdict"; `decideRoom` writes both (`store.ts:896`, `:912`). |
| S6 | `level` has four writers | **dead** | One owner: `atlasPageAtom.level` via `setAtlasPage` (`store.ts:352`, `:362`). |
| S7 | Freshness word reads the wall clock during render | **SURVIVES** | `ago()` at `targeting/kit.tsx:249`, called at `:237`. Census R20 unmet. Not mentioned in the report. |
| S8 | Declared state value that nothing produces (`stale`) | **dead** | `stale` now has one real producer: `result.waiting` (`store.ts:285`). |
| S9 | Feed state hard-coded, not derived | **dead** | All six feeds project through `resultFeed` (`store.ts:508+`). |
| S10 | Cache-key fragmentation | **n/a — died before the cutover** | No TanStack Query in the route at `335906d~1`. |
| S11 | Hand-written cache surgery | **partly n/a, partly dead** | `patchSnapshot` and the `regionsByZone` splice did not exist at `335906d~1`. `replaceRegionBlob` did (route `:166`, `:306`) and **is** gone. |
| S12 | Invalidate-by-predicate on `queryKey[2]` | **n/a — did not exist at baseline** | |
| S13 | Two `useVerb`-shaped busy models | **dead** | One serial bracket: `runVerb` (`store.ts:685`). `useVerb` removed from the route. |
| S14 | A second busy state mirrors the first | **dead** | `useRunner` now derives `busyVerb`/`active` from the single `busyLabel` — no `useState`, no mirror effect (`kit.tsx`, `useRunner`). Real kill. |
| S15–S18, S20–S22 | `/families`, `/family` smells | **out of scope** | Untouched, correctly. |
| S19 | Escape unwinding per-route and hand-ordered | **survives** | `atlas.tsx:449-452` still clears two things by hand inside the un-arrayed effect. |
| S23 | Panel data shadowed by local edits | **improved, not closed** | `adoptRowsAtom` now re-derives from the fresh result and overlays patches (`store.ts:452-468`) — a refetch is no longer discarded. But adopt drafts have no `{base,next}`, so a shadowed refetch is undetectable; and the room-side conflict signal that would surface it is both **dead** (0 consumers) and **wrong** (P1). |
| S24 | Derived-on-every-render heavy work in a panel | **dead** | `inScope`/`blockedZones`/`inserts`/`untagged`/`tags` are one memoised `syncPlanAtom` (`store.ts:614`). |

**Tally: 8 dead, 7 survive (S1, S2, S4, S5, S7, S19, S23-partial), 1 net-zero (S3), 4 n/a at
baseline, 8 out of scope.** S2 and S4 did not die — they moved.

### B.2 Hook counts, counted by the judge

Method: `grep -oE '\b<hook>[<(]'` on the file at `335906d~1` and at `HEAD`. Generic call forms
(`useState<Foo>(`) are included; import lines are excluded.

| File | | useState | useEffect | useMemo | useRef | useCallback | eslint-disable | lines |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `routes/takeoffs.tsx` | judge | **8 → 0** | **1 → 2** | **0 → 1** | 1 → 2 | 2 → 0 | **0 → 0** | 925 → 620 |
| | report | 4 → 0 | 0 → 2 | 2 → 1 | — | — | 1 → 0 | — |
| `takeoff/atlas.tsx` | judge | 9 → 2 | 2 → 1 | 10 → 10 | 0 → 0 | 0 → 0 | 2 → 2 | 2 015 → 1 952 |
| | report | 9 → 2 | 2 → 1 | 10 → 10 | — | — | 2 → 2 | — |
| `targeting/kit.tsx` | judge | — → 4 | — → 3 | — → 3 | — → 2 | — → 10 | — → 1 | new file |

The `atlas.tsx` row is **exact**. The `routes/takeoffs.tsx` row matches **no commit in the
repository**. Two of its three errors flatter the cutover (a `useMemo` was added, not removed; no
suppression ever existed to delete); one understates a genuine win (8 `useState` removed, not 4).
Also unreported: `targeting/kit.tsx` is a new in-scope file carrying 4 `useState`, 3 `useEffect`
and 1 suppression.

## C. N1–N7 from the effect-atom proto

| # | Proto defect | Repeated here? | Evidence |
| --- | --- | --- | --- |
| **N1** | Whole-graph over-invalidation from an aggregate `searchAtom` | **NO — fixed, and proven fixed** | Probe P2: 0 host reads for three separate param mutations. Sources read individual atoms; `AtomRegistry.ts:806` gates propagation on `Object.is`, so unchanged scalars stop the cascade. The anti-graft was applied correctly. |
| **N2** | `Atom.searchParam` module-global singleton + second `pushState` | **NO — avoided** | Zero uses. Router is sole URL owner. |
| **N2′** | *(new instance of the same class)* Suspense promise map is still a module-global `Map` | **present, dodged by accident, and now leaks** | `@effect/atom-react/src/Hooks.ts:335-337` is unchanged in `beta.92`. Substrate rule 2 was violated (per-store registry + nested provider, `store.ts:296`, `routes/takeoffs.tsx:129`), and that violation is what makes it safe: atoms are per-store-instance objects, so map keys never collide. The cost is a leak — `map.delete(atom)` runs only on resolve (`Hooks.ts:357`); a store disposed while a pane is suspended (e.g. `?source` swap mid-read, `routes/takeoffs.tsx:94`) leaks that entry permanently, because it is a `Map`, not a `WeakMap`. |
| **N3** | URL layer untested by the no-React suite | **N/A, replaced by a smaller gap** | The URL layer is now the router's, so this class is gone. Residual: `SearchPort` is a spy in every test (`store.test.ts:28-33`); no test asserts a `patch` payload reaches `navigate` with correct `zones` array handling (`routes/takeoffs.tsx:108-114`). |
| **N4** | Perf claim not re-measured, citations stale | **not repeated in kind** | The report makes no perf claim. Every S1–S10 citation I checked resolves to the code it names. |
| **N5** | Optimism guaranteed to revert | **NO** | No `Atom.optimistic` in the store. `patchRoom` stages, writes through, then commits the field and invalidates (`store.ts:886-895`). |
| **N6** | `Atom.kvs` sync mode swallows failures | **NO** | No `Atom.kvs`. Persistence is the route's own `localStorage` read plus `rememberDir` (`routes/takeoffs.tsx:83-90`, `store.ts:851`), with an explicit try/catch. |
| **N7** | Route effect deps tear down the host listener on every pick | **NO** | `subscribe` is called once in the factory (`store.ts:795`); the route's effects depend on `[store]` and `[search, store]` and never re-create the store (`routes/takeoffs.tsx:117,123`). |

**Six of seven proto defects are not repeated. The one that persists (N2′) is a library bug the
cutover neither triggers nor fixes.** This is the report's strongest real achievement and it
under-sells it.

## D. Behaviour parity

Every user-visible behaviour of `routes/takeoffs.tsx` at `335906d~1`, against `HEAD`.

| # | Old behaviour | Present? | Evidence / note |
| --- | --- | --- | --- |
| 1 | Pick world / rvt / view / zones / folder / r10 from URL search | yes | `validateSearch` (`:67`); `pick` (`store.ts:770`) |
| 2 | `?source=fixture` mounts the project-a fixture | yes | `:104-106`; store test `:322` |
| 3 | "open the project-a fixture instead" | yes | `:351` |
| 4 | "leave fixture → live" | yes | `:376` |
| 5 | Verb: read model / refresh | yes | `refresh` (`:252`, `store.ts:937`) |
| 6 | Verb: write room type | yes | `patchRoom` (`store.ts:886`) |
| 7 | Verb: write decision | yes | `decideRoom` (`store.ts:896`) |
| 8 | Verb: capture lane | yes | `store.ts:918` |
| 9 | Verb: partition zone | yes | `store.ts:928`; refusal preserved (`:236-240`) |
| 10 | Verb: adopt / "stamp N as zoning regions" | yes | panel `:416`; `store.ts:966` |
| 11 | Verb: sync N rooms to .r10 | yes | "sync .r10" (`:266`), panel + `store.ts:947` |
| 12 | Verb: open in RHVAC | yes | `:271`, `store.ts:943` |
| 13 | Busy label + elapsed seconds | yes | `runVerb` (`store.ts:697-702`); rendered `atlas.tsx:366` |
| 14 | Error line + "dismiss" | yes | `:362-368` via `clearFailure` |
| 15 | Untagged / blocked-zone warnings in the sync panel | yes | `syncPlanAtom` (`store.ts:614`) |
| 16 | Serial verb refusal ("one transaction at a time") | yes | `runVerb` `inFlight` (`store.ts:686`); string at `:290`-region |
| 17 | Recent-folder list + add-folder form | yes | `:280-300`, `store.ts:851` |
| 18 | **Manual "load .r10" button** | **NO — removed, no replacement** | `.r10` open is now an automatic source (`store.ts:485-495`) with `Atom.swr({revalidateOnMount:false})` (`store.ts:497`). On a transient open failure the route shows "the .r10 did not open" (`:265`) and offers **no retry**: nothing in the UI invalidates `["rhvac-open"]` or `["rhvac-list"]`. `refresh` invalidates `["snapshot"]` only (`store.ts:938`). Recovery needs a pick-away-and-back or a page reload. |
| 19 | `<h1>Takeoffs</h1>` page title | not found | `grep "Takeoffs"` in `routes/`, `takeoff/`, `targeting/` returns only identifiers. Cosmetic. |
| 20 | Atlas: j/k cursor, a/d accept-dismiss, Escape unwind | yes | `atlas.tsx:445-470` (still un-arrayed — S1) |

**19 of 20 preserved. One real regression (#18): the retry affordance for a failed `.r10` open was
deleted with the manual verb and never replaced.**

### D.1 Fixture-lane proof

| Claim | Judge |
| --- | --- |
| "3 files, 33 tests passed" | **CONFIRMED** — reproduced exactly |
| Store suite has "all five requested cases plus fixture-panel adoption and live `.r10` projection" | **CONFIRMED** — 9 cases, `store.test.ts:139,157,173,212,235,258,278,303,322` |
| Fixture adoption renders `fixture adopted 11 zoning regions` | **CONFIRMED deterministically** (`store.test.ts:333-339`) |
| Browser fixture run: port 3002, HTTP 200, 45-zone Atlas, 11 candidates, zero console errors | **NOT VERIFIABLE.** No artefact, screenshot, or log is committed. I did not re-run the browser lane. Accept as the builder's word, not as proof. |
| Live lane deliberately skipped | **CONFIRMED and correctly scoped** |

### D.2 Claimed as working, but not found

| Report claim | Judge |
| --- | --- |
| S4 "feed truth ... stale/error/loading/fresh/fixture come from AsyncResult" — the synthesis's S4 is *`Feed.basis` rendered in the badge* | `basis` is computed everywhere and **rendered nowhere**. The report answers S3 twice and never answers S4. |
| S6 "Registry families provide hovered, selected, decided, staged, and a combined entity view" | True as code. `hovered`, `selected`, `dirty` and `conflict` have **zero** consumers anywhere in `apps/web/src`. Only `.decided` is read (`atlas.tsx:1595`). |
| S9 "dirty and conflict are derived from authority versus base" | Derived, never rendered, and **wrong for 5 of 8 fields** (probe P1). |
| S10 "React-free owner with `dispose()`, `retain()`, `settle()`" (synthesis wording) | `retain()` absent. |

## E. Refutation of the report's three strongest claims

| # | Claim | Verdict | Basis |
| --- | --- | --- | --- |
| **E1** | §"S1–S10 audit": **S8 keyed reactivity — "met, live-unproven"**; "Every async source has declared reactivity keys; writes invalidate those keys" | **REFUTED to partial.** The second clause is false. | Seven keys are declared. `["candidates"]` (`store.ts:445`) is invalidated by **no writer**. `adopt` stamps designer regions as zoning regions — exactly the fact `readCandidates` returns and `adoptRowsAtom` reads via `region.role === "zoning-region"` (`store.ts:459`) — yet `adoptMutation` invalidates only `["snapshot"]` (`store.ts:673`). Probe **P3: 0 candidate re-reads after adopt.** With `staleTime: "30 seconds"` **and** `revalidateOnMount: false` (`store.ts:446`), reopening the adopt panel inside the window shows pre-adopt roles. The report files this under known defect #3 as a *fixture dataset* limitation ("the current fixture candidates are already stamped, so a re-read is visually unchanged"). The cause is a missing invalidation key, not the dataset; the fixture masks a live-lane defect. This is the one requirement S8 exists to enforce. |
| **E2** | §"S1–S10 audit": **S9 staged overlay — "met"**; "dirty and conflict are derived from authority versus base" | **REFUTED. Present, dead, and incorrect.** | `conflict` (`store.ts:651-656`) evaluates `authority[key as keyof WorldRoom] !== value` over `Object.entries(staged.base)`. `roomEdit()` builds `base` with `people: room.data?.people` and four siblings (`store.ts:243-252`), but `WorldRoom` has no such top-level fields — they are under `data: RoomData \| null`. So for any room with populated `data`, `authority["people"]` is `undefined` and the comparison is unconditionally true. Probe **P1**: `conflict=true` on a room's first edit with no host change; `conflict=false` only when `data === null`. The `as keyof WorldRoom` cast is why `vp check` passes. Nothing renders `conflict`, so the false positive is currently invisible — which means it is untested, unmonitored, and will surface the moment S9 is wired to a surface. This is the same unchecked-cast class as the report's admitted defect #2 (`store.ts:575`), unadmitted. |
| **E3** | §"Verdict": **"Steps 1–5 reached"**, with step 5 = "removed the takeoffs route's `useVerb`, **TanStack snapshot authority, hand cache surgery**, legacy `SessionOverlay`, and hard-coded feed states" | **REFUTED in three of five items.** | (a) **TanStack snapshot authority did not exist at `335906d~1`.** The baseline route imports no `useQuery`, `useMutation`, or `queryClient` — it used `useTarget`, `useVerb`, `useFixtureWorld`, and direct `callHostRpc`. Nothing TanStack was removed. (b) **"Hand cache surgery"** overstates: `patchSnapshot` and the `regionsByZone` splice were already absent; only `replaceRegionBlob` (React-state surgery, not cache surgery) was really deleted. (c) **`SessionOverlay` was not removed** — it survives at `world.ts:188,197,293,450`, is exercised by `takeoff.test.ts:202`, and the new store imports and calls `emptyOverlay()` (`store.ts:22`, `:573`). It moved into the store. `useVerb` removal and hard-coded feed states are the two accurate items. The step-5 claim credits the cutover with deleting three things that were already gone or are still present. |

## F. Honesty check — does "Left undone" match what I found?

| # | Finding | In "Left undone" / "Known defects"? |
| --- | --- | --- |
| F1 | The route's "before" hook row matches no commit. The report's stated baseline is "the recovered frontier working-tree UI" — an uncommitted artefact. `main`, `takeoff-frontier`, `takeoff-frontier~1` and `335906d~1` are all byte-identical for this file, and all disagree with the report. The `atlas.tsx` row matches the commit exactly, so one row is measured and one is not. | **NO.** The baseline is named but its divergence from every commit is not. |
| F2 | Census S1 (un-arrayed effect) survives verbatim at `atlas.tsx:445`. | **NO.** The report cites this exact effect and frames it as acceptable plumbing. |
| F3 | Census S2 (memo that can never hit) survives; `actions` is still a per-render literal, now at `atlas.tsx:368`. | **NO.** |
| F4 | Census S4 (`visibleKeys` round trip) survives and now routes through registry state. Census R9 unmet. | **NO.** |
| F5 | Census S7 (`ago()` reads the wall clock in render, `kit.tsx:249`). Census R20 unmet. | **NO.** |
| F6 | `adopt` does not invalidate `["candidates"]` (probe P3). | **Misattributed** to the fixture dataset (known defect #3). |
| F7 | `conflict` is wrong for 5 of 8 `RoomEdit` fields (probe P1). | **NO.** |
| F8 | `hovered`, `selected`, `dirty`, `conflict` and `basis` have zero consumers. | **NO.** S4/S6/S9 are scored on existence, not on use. |
| F9 | Substrate rule 2 violated: per-store registry + nested `RegistryProvider` over three Suspense boundaries. | **NO.** The report's S10 row cites `dispose()` and does not mention the rule. |
| F10 | No retry path for a failed `.r10` open; the manual verb was deleted (parity item 18). | **NO.** |
| F11 | `targeting/kit.tsx` — in scope — carries 4 `useState`, 3 `useEffect`, 1 suppression. | **NO.** Excluded from the hook table without a note. |
| F12 | `retain()` missing from the S10 contract. | **NO.** |
| F13 | Step 5 credits removing TanStack authority and `SessionOverlay`; neither is true. | **NO.** |
| G1 | S6 zone card still takes a projected `WorldZone` | **YES — stated accurately.** |
| G2 | `openRhvac` typed `unknown`, narrowed by a local cast (`store.ts:575`) | **YES — stated accurately, and it is the same defect class as F7.** |
| G3 | Fixture adoption does not mutate the immutable dataset | **YES, but used to explain away F6.** |
| G4 | SSE and live writes structurally covered, not live-proven | **YES — stated accurately.** |
| G5 | `lib/use-verb.ts` kept for other routes | **YES — verified, other routes still import it.** |
| G6 | Live lane deliberately not run | **YES — the cleanest disclosure in the report.** |

**Verdict on honesty: mixed.** Six disclosures are accurate and one (the live lane) is
exemplary. But thirteen findings are absent, and three of them — the unverifiable baseline, the
missing `["candidates"]` key sold as a fixture artefact, and the step-5 deletions that were
already gone or are still present — are places where the report reads better than the code. The
pattern is consistent: the report scores S1–S10 on *whether the structure exists*, never on
*whether anything consumes it*. Five of ten items are structure with no reader.

## G. What the next pass must do, in order

| # | Work | Why now | Size |
| --- | --- | --- | --- |
| 1 | Fix `conflict`: compare `base` against `roomEdit(authority)`, not against `authority`. Delete the `as keyof WorldRoom` cast. Add the probe-P1 case as a test. | Silent data-integrity defect; the cast is actively defeating the compile lane. | ~3 lines + 1 test |
| 2 | Add `["candidates"]` to `adoptMutation`'s invalidation (`store.ts:673`). Assert a candidate re-read in the adopt test. | S8's single purpose; live-lane correctness the fixture masks. | 1 line + 1 assert |
| 3 | Restore a retry for a failed `.r10` open — a verb that calls `store.actions.invalidate(["rhvac-open","rhvac-list"])`, gated on `AsyncResult.isFailure(r10Result)`. | The only behaviour parity regression. | ~6 lines |
| 4 | Consume what the store already computes, or delete it: render `Feed.basis` in the badge (S4), and wire `hovered`/`selected`/`dirty`/`conflict` to `ZoneCard` and the room table (S6, S9). | Five of ten S-items are unread structure. Until a surface reads them they are untested by construction. | medium |
| 5 | Kill S1 and S2 in `atlas.tsx`: give the keydown effect a dep array (or move the handler behind a stable store action), and hoist `actions` out of the render body so `columns` can memoise. | Two census smells survived a cutover whose stated purpose was to kill them; both are one-line-shaped. | ~10 lines |
| 6 | Correct the report's hook table against `335906d~1`, add `targeting/kit.tsx`, and withdraw the three false step-5 deletions. | The document is the durable artefact; its numbers currently cite nothing reproducible. | doc only |
| 7 | Close S4/R9: let the table own visible order and have panes subscribe, instead of pushing `visibleKeys` up into `atlasPageAtom`. | The round trip got promoted into global state rather than removed. | medium |
| 8 | Decide substrate rule 2 explicitly: either make the registry module-level as the rule says, or amend the rule to "per-route-store registry" and record *why* — with the `Hooks.ts:335` `Map`-not-`WeakMap` leak named as the residual cost. | The rule is violated silently and the violation is currently load-bearing. | doc + ADR |
| 9 | Move `ago()` off render (S7/R20), and file the `atomPromiseMap` leak upstream at `Effect-TS/effect`. | Lowest severity; both are one-liners once 1–8 land. | small |
| 10 | Run the live lane before any promote. | Every write path and the whole SSE bridge remain compile-and-fixture proof only. | session |

## VERDICT

The substrate choice is vindicated. N1 — the defect that sank round 3 — is fixed and I measured it
fixed: three separate param mutations cost zero host reads. `Atom.searchParam` is gone, the router
owns the URL, the verb bracket is genuinely single and serial, the async cascade is directional and
has a real test, and eight census smells are dead. Both lanes are green and both were reproduced.

Against that: the report scores S1–S10 on structure rather than on use, and five of ten items are
structure nothing reads. Two defects are live — a `conflict` derivation that fires falsely on any
room with data, hidden behind a cast that defeats the type checker, and an adopt path that never
invalidates the read it changes, sold in the report as a fixture-dataset quirk. Two census smells
the cutover was meant to kill survived by relocating into Atlas. One behaviour regressed with no
replacement. The route's hook table cites a baseline that no commit in the repository matches, and
step 5 claims credit for deleting three things that were already gone or are still present.

None of that is structural. Items 1–3 are roughly ten lines and two tests, and the shape underneath
is the right one.

VERDICT: iterate — the substrate and the shape are proven and worth keeping, but a false `conflict`, a missing `["candidates"]` invalidation, a lost `.r10` retry, and an unreproducible hook table must land before this promotes.

---

# Pass 3 judge

Adversarial review of `2a19873`, `171716b`, `889283d` against `git diff eba308d..HEAD -- source/`
(8 files, +289/−97). Six claims put to refutation. Source not edited; two probe files were written,
run, and deleted — worktree left clean.

## Lane facts the judge ran

| Command | Cwd | Result |
| --- | --- | --- |
| `vp test src/takeoff src/targeting src/state` | `apps/web` | **PASS. 4 files, 39 tests, 3.07 s.** |
| `vp test src/components/master-table` | `apps/web` | **PASS. 1 file, 9 tests.** |
| `vp check` on the 7 touched paths | `source/pe-tools` | **PASS. 29 files formatted; 0 warnings, lint, or type errors.** |
| Judge probes Q1–Q4 (written, run, deleted) | `apps/web` | 4 cases; output inline below. |

## Verdicts on the six claims

| # | Claim | Verdict |
| --- | --- | --- |
| 1 | No component writes derived row order into the store | **UPHELD** |
| 2 | `visibleRowsAtom` is the single source for keyboard next/prev and select-visible | **UPHELD, with one nuance** |
| 3 | Exactly one `AtomRegistry` exists in the browser app | **REFUTED in letter, upheld in effect** |
| 4 | `store.dispose()` cannot damage other routes on the shared registry | **SPLIT — correctness upheld, resource safety refuted** |
| 5 | The 39-test count is real | **CONFIRMED** |
| 6 | ADR 0009 claims match the code | **UPHELD** — every citation resolves |

### Claim 1 — no component writes derived row order. UPHELD.

| Probe | Finding |
| --- | --- |
| `onVisibleChange` prop | **Deleted** from the interface (`master-table.tsx:68`) and from the implementation. The `useMemo`+`useRef`+`useEffect` push-up triad at old `master-table.tsx:243-248` is gone. |
| Atlas call site | **Deleted** (`atlas.tsx`, old `:1100-1104`). Replaced by `visibleKeys={visibleKeys}` (`atlas.tsx:1095`), a read. |
| Remaining `useEffect` in `master-table.tsx` | Two: `scrollIntoView` on `activeKey` (`:250-252`) and sticky-offset measurement (`:262+`). **Neither writes any store.** |
| Remaining `useEffect` in `atlas.tsx` | One: the keydown listener (`:491-495`). Writes no order. |
| `onTableStateChange` (new store write, `atlas.tsx:1094`) | Fires only from `updateState` (`master-table.tsx:165-170`), which is called from event handlers, never from an effect. This is **user intent** (a click on a sort header or filter), not derived order. The distinction is the whole point and it is respected. |

Census S4 is dead — the first time across three passes. Two Pass-2 findings also closed as
side effects, unclaimed by the report: **census S1** (`atlas.tsx:491-495` now has `[]` deps behind a
`keydown` ref) and **census S2** (`actions` is now `useMemo(…, [store])` at `atlas.tsx:406`, so the
`columns` memo at `:700` can finally hit).

### Claim 2 — `visibleRowsAtom` is the single ordering source. UPHELD.

`visibleRows` in Atlas (`atlas.tsx:454-457`) is derived only from `store.atoms.visibleRows` +
`store.atoms.atlasRows`. Consumers: keyboard j/k (`:479-482`), scope counts (`:720-721`), the row
count readout (`:1042`), and the table itself (`:1095`). The table takes `getCoreRowModel()` when
`visibleKeys` is supplied (`master-table.tsx:238`), so TanStack's own filter/sort pipeline is
bypassed. Probe **Q3** confirms the atom is the real thing:

```
Q3 rows=179 visible=179
Q3 asc  first3 = Bath, Bath, Bath
Q3 desc first3 = Study, Study, Study
Q3 unknown-key sort length=179 sameOrderAsRows=true
Q3 filter state="in .r10" -> 69 rows
```

The asc/desc flip reproduces the report's browser observation (`Bath, Bath, Bath` →
`Study, Study, Study`) **deterministically**. Unknown sort keys degrade to stable order, no crash.

**Nuance:** "select-visible" is not sourced from `visibleRowsAtom`, and correctly so. A column
filter's option vocabulary comes from `facetOptions(rows, col)` over **all** rows
(`master-table/model.ts:126-146`), a documented deliberate choice so options never vanish under the
cursor. The store owns which rows *pass* the filter; the table owns which options *exist*. Both are
right; the claim as worded would be wrong if read to cover the option list.

### Claim 3 — exactly one registry. REFUTED in letter.

| Site | Registry |
| --- | --- |
| `state/registry.ts:3` | `appAtomRegistry` — the app's one |
| `@effect/atom-react/src/RegistryContext.ts:44` | **A second registry, constructed eagerly at module import** as the `createContext` default value |
| `state/atom-inspect.test.ts:19`, `takeoff/store.test.ts:45` | Test-owned, sanctioned by the ADR |

App source constructs exactly one. The **process** holds two. The default is unreachable today —
`__root.tsx:59-74` provides `appAtomRegistry` around `{children}` and the devtools, and
`shellComponent: RootDocument` (`:42`) means every routed subtree is inside it. There is no second
React root (`createRoot`/`hydrateRoot` appear nowhere in `src`).

So the claim's intent holds. Its letter does not, and the gap is a live footgun: any component
rendered outside that provider — a portal mounted to `document.body` outside `RootDocument`, or any
future component test rendering a pane bare — silently binds to a different graph with no error.
`useAtomValue` cannot tell you it read the wrong registry.

### Claim 4 — dispose cannot damage other routes. SPLIT.

**Correctness: upheld.** `store.dispose()` (`store.ts:1250-1256`) now releases only
`unsubscribe()`, `clearInterval(busyTimer)`, and `inspector.dispose()`. The `registry.dispose()`
line is deleted. Probe **Q2** — two stores on one shared registry, dispose `a`, exercise `b`:

```
Q2 b.atlasPage.level after a.dispose = "Main"
Q2 b world zones = 45
Q2 a.atlasPage still readable after dispose = {"stageFilter":null,"level":"", ...}
```

`b` is untouched. The ADR's central safety property is real.

**Resource safety: refuted.** `dispose()` releases **zero registry nodes**, and 29
`Atom.keepAlive` declarations in `store.ts` defeat `defaultIdleTTL: 400`. Probe **Q1** — four
create/settle/dispose cycles on one shared registry, each followed by a 600 ms wait past the TTL:

```
Q1 baseline nodes=0
Q1 cycle 1: live=12 afterDispose+TTL=12
Q1 cycle 2: live=24 afterDispose+TTL=24
Q1 cycle 3: live=36 afterDispose+TTL=36
Q1 cycle 4: live=48 afterDispose+TTL=48
```

Linear, unbounded, never reclaimed. Before Pass 3, `registry.dispose()` collected these; the
per-store registry was itself the release mechanism. Moving to a shared registry removed the
mechanism without replacing it. This fires on every `?source=fixture` toggle
(`routes/takeoffs.tsx:94`, `key={source}` remounts the owner) and every navigation away and back.

This does reach other routes. `inspectAtomRegistry.scan` walks **all** of `registry.getNodes()`,
renders every node, and `JSON.stringify`s the whole snapshot for change detection
(`state/atom-inspect.ts:130-190`), on a 100 ms timer while the Atoms panel is visible
(`:196-203`). Leaked nodes make that scan monotonically slower for every route in the app — which
is the exact cost `171716b` was written to remove.

### Claim 5 — 39 tests. CONFIRMED.

Reproduced exactly: 4 files, 39 tests, exit 0. The fourth file is genuine new coverage
(`state/atom-inspect.test.ts`), not padding. The store suite's new cases assert derived order under
changed filters and sort direction, as the report says.

### Claim 6 — ADR 0009 matches the code. UPHELD.

| ADR statement | Judge |
| --- | --- |
| Suspense promise map is module-level, keyed by atom, `dist/Hooks.js:221` | **Exact.** `const atomPromiseMap = {` is line 221 of that file. |
| Route workspace dedupes per coordinate, `route-state.tsx:134` | **Exact.** Line 134 is the coordinate comment; `routeWireAtom = Atom.family` at `:135`. |
| One registry, `defaultIdleTTL: 400`, in `src/state/registry.ts`, provided at `__root.tsx` | **Matches** (`registry.ts:3`, `__root.tsx:59`). |
| Route composition roots pass the registry in | **Matches** (`takeoffs.tsx:119`; `store.ts` takes `deps.registry`). |
| "Disposing a route store releases only those owned resources. It does not dispose the app registry." | **Matches the code — and this is precisely the leak in Claim 4.** The ADR is accurate; the consequence it does not draw is that nothing else releases those atoms either. |
| "Tests pass a fresh registry to each store" | **Matches** (`store.test.ts:45`). |

The ADR's "Consequences" list is the one place it overreaches: "A route store cannot tear down
another route by disposing shared registry state" is true, but the list omits the reciprocal —
a route store cannot **clean up after itself** either.

## New findings, not in the report

| # | Severity | Finding | Evidence |
| --- | --- | --- | --- |
| **P1** | **High** | **The N1 anti-graft is violated at `atlasPageAtom`.** `atlasRowsAtom` reads the whole page aggregate (`store.ts:705`) but needs only `zoneKey`/`stageFilter`; `visibleRowsAtom` reads it (`store.ts:722`) for `fieldsMode` alone. So a pure cursor write rebuilds all 179 row objects **and** re-filters and re-sorts them. Probe **Q4**: `cursor move -> atlasRows identity stable? false`, `visibleRows identity stable? false`. Every j/k keypress and every row click pays a full table rebuild. Contrast `hover`, which writes an entity-family atom and is correctly isolated: `hover -> atlasRows identity stable? true`. This is the same defect the synthesis's substrate rule 3 exists to prevent, reintroduced one layer down — and Pass 2 proved the URL layer got it right, so the pattern is already in the file. |
| **P2** | **Medium** | **The report measured the one interaction that was already cheap.** The browser proof cites "ten row-hover transitions … 76.582 ms". Q4 shows hover is the isolated path. Cursor/click — the path P1 makes expensive — was not measured. |
| **P3** | **Medium** | **Column `sort`/`facet` and the store's `atlasSortValue`/`atlasFacet` are now two definitions of one fact.** Atlas still declares 11 `sort:`/`facet:` functions (`atlas.tsx:517-651`) plus a `match:` predicate for `flags` (`:653-659`) duplicated almost verbatim in `store.ts:731-737`. Since the table now uses `getCoreRowModel()`, those column functions are **dead for ordering but live for affordances**: `column.facet` or `column.options` gates whether a filter menu renders (`master-table.tsx:427`), `facetOptions` builds its values (`model.ts:140-146`), and `column.sort` gates the sort control (`:661`). I checked all four faceted keys and they currently agree — `stage`, `type`, `state` (both sides use `ATLAS_ROOM_STATE_LABEL`), and `r10` (`cellStateLabel` yields exactly `clean`/`drift`, plus the `word` override `"not exported"`; `cell.tsx:183-208`). **No live bug.** But an edit to either side silently offers a control that no-ops or misorders, with no test and no type to catch it. Census S5's shape, newly introduced by the S4 fix. |
| **P4** | **Low** | Report says the fixture rendered "180 room rows". The fixture has **179** (`Q3 rows=179`, and Pass 2's probe read the same). Off by one. |
| **P5** | **Low** | `devtools.tsx:34` builds a fallback `inspectAtomRegistry(registry)` per panel mount. Harmless today — it starts no timer until subscribed — but it is a second inspector over the same graph, and `scan(false)` runs eagerly at construction. |

## Standing items from Pass 2, rechecked

| Pass-2 G item | Status at HEAD |
| --- | --- |
| G1 `conflict` wrong for 5 of 8 `RoomEdit` fields | **Not addressed in this diff.** |
| G2 missing `["candidates"]` invalidation on adopt | **Not addressed in this diff.** |
| G3 no retry for a failed `.r10` open | **Not addressed in this diff.** |
| G5 census S1 (un-arrayed effect), S2 (memo that can't hit) | **BOTH FIXED** (`atlas.tsx:491-495`, `:406`). Unclaimed by the report. |
| G7/G8 (registry + row order) | **Done** — the stated purpose of this pass. |

## G-list — concrete fixes, ordered

| # | Fix | Where | Size |
| --- | --- | --- | --- |
| **G9** | Split `atlasPageAtom` into scalar derived atoms — `zoneKeyAtom`, `stageFilterAtom`, `fieldsModeAtom`, `cursorAtom` — and read those in `atlasRowsAtom` and `visibleRowsAtom` instead of the aggregate. `Object.is` then stops the cascade on a cursor move, exactly as it already does for the URL params. Add Q4 as a regression test asserting `atlasRows` identity is stable across a cursor write. | `store.ts:705`, `:722` | ~8 lines + 1 test |
| **G10** | Give `store.dispose()` a release path for its own nodes: collect every `keepAlive` atom the factory creates and drop keep-alive on dispose, or remove `keepAlive` from page-scoped nodes and let `defaultIdleTTL` reclaim them. Add Q1 as a regression test asserting node count returns to baseline after dispose + TTL. | `store.ts:1250` | ~10 lines + 1 test |
| **G11** | Collapse P3's duplication: derive the store's `atlasFacet`/`atlasSortValue` from one exported column-semantics table that `atlas.tsx` also consumes, so the affordance and the behaviour cannot diverge. Failing that, add a test asserting every column with a `facet`/`options` has a matching `atlasFacet` branch with an equal vocabulary. | `store.ts:325-357`, `atlas.tsx:517-651` | medium |
| **G12** | Amend ADR 0009's Consequences with the reciprocal: a route store does not release its own atoms from the shared registry, and name the owning mechanism (G10). Record that `RegistryContext` ships a default registry, so rendering outside the root provider binds a different graph silently. | `docs/adr/0009` | doc only |
| **G13** | Re-measure the browser lane on the **cursor/click** path, not hover, after G9 lands. Correct "180 room rows" to 179. | report | small |
| **G14** | Carry forward Pass-2 G1–G3 (false `conflict`, missing `["candidates"]` key, absent `.r10` retry). None were touched by Pass 3 and all remain open. | `store.ts` | ~10 lines + 2 tests |

## VERDICT

**iterate.**

Pass 3 did what it set out to do, and the two headline claims survive adversarial probing: the
derived-row-order round trip is genuinely gone — the first clean kill of census S4 across three
passes — and one app registry with handle-style route stores is real, correctly provided, and
correctly not disposed by route teardown. Q2 confirms a disposed store cannot corrupt a sibling.
The 39 tests are real, `vp check` is green on every touched path, ADR 0009's citations all resolve
to the lines they name, and two Pass-2 findings (census S1 and S2) were fixed in passing without
being claimed. The Q3 sort flip reproduces the report's browser observation deterministically,
which is the strongest form the fixture lane has taken so far.

Two things block promotion. First, the aggregate-read defect the synthesis wrote substrate rule 3
to prevent is now live at `atlasPageAtom`: every cursor move rebuilds and re-sorts all 179 rows
(Q4), and the report's browser measurement happens to have sampled hover, the one path that is
already isolated. Second, moving to a shared registry deleted the only mechanism that released the
store's atoms without adding a replacement, so each mount leaks a fixed block of pinned nodes (Q1:
12 → 24 → 36 → 48, never reclaimed) into a graph that the app-wide inspector scans and stringifies
on a timer. Neither is structural — G9 and G10 are roughly twenty lines and two regression tests
between them — but both are exactly the class of defect this bake-off exists to catch, and one of
them is a rule the project already wrote down.

---

# Pass 4 judge

Adversarial review of `ee8c1b4`, `fc2f127` against `git diff 889283d..HEAD -- source/ docs/adr`
(5 files, +229/−115). Q1 and Q4 re-run against HEAD; three fixes reverted locally to test their
guards, then restored. Source not edited — `git status` clean at exit.

## Lane facts

| Command | Result |
| --- | --- |
| `vp test src/takeoff src/targeting src/state src/components/master-table` | **PASS. 5 files, 51 tests.** |
| `vp test src/takeoff src/targeting src/state` (Pass-3 scope) | PASS. 4 files, **42** tests. |
| `vp check` on the touched paths | **PASS. 27 files; 0 warnings, lint, or type errors.** |
| Probes Q1, Q1b–d, Q4, Q5b, Q6 (written, run, deleted) | Output inline. |

## Verdicts

| # | Claim | Verdict |
| --- | --- | --- |
| 1 | G9 — cursor write leaves row identities stable; no aggregate read remains | **UPHELD in the store; REFUTED at the component boundary** |
| 2 | G10 — node count returns to baseline; no `keepAlive` escapes `owned` | **REFUTED — holds only on the read-only path** |
| 3 | G11 — `ATLAS_COLUMN_SEMANTICS` is the only definition | **UPHELD for sort/facet; one predicate still duplicated** |
| 4 | G14 — the three cited tests fail if the fix is reverted | **UPHELD — all three verified by reversion** |
| 5 | The 51-test count | **CONFIRMED** |

### Claim 1 — G9. Store side upheld; component side is where the cost stayed.

`atlasPageAtom` is now derived from five independent scalars (`store.ts:455-464`), and the store's
consumers read only what they need. Probe **Q4** against HEAD:

```
Q4 cursor -> atlasRows stable? true
Q4 cursor -> visibleRows stable? true
Q4 hover  -> atlasRows stable? true
Q4 level  -> atlasRows stable? true
Q4 fields -> visibleRows stable? false   (correct — fields mode changes sort semantics)
```

My Pass-3 P1 is closed. Every `atlasPageAtom` reference in the store is now benign — `grep`
returns exactly three: its own definition (`store.ts:455`), the `atoms` export (`:1235`), and
`inspect()` (`:1266`). No async source, no row derivation, no filter reads the aggregate.

**But the aggregate is still read where it costs most.** `atlas.tsx:406` is
`useAtomValue(store.atoms.atlasPage)`, destructured at `:411` into `stageFilter, zoneKey, cursor,
fieldsMode`. Probe Q5 confirms the aggregate mints a fresh object on every cursor write
(`changed-on-new-cursor=true`, `changed-on-same-cursor=false`). `store.atoms.cursor` is exported
(`store.ts:1239`) and unused by any component. So G9 moved the derivation off the cursor path and
left the *subscription* on it. That is the direct antecedent of G13 — see the diagnosis below.

### Claim 2 — G10. REFUTED: the release mechanism works, but not for the paths a user takes.

`Atom.keepAlive` is gone from `store.ts` entirely (`grep -c` = **0**), replaced by an `owned`
helper that pipes each atom through `Atom.autoDispose` and records `registry.mount` releases
(`store.ts:398-405`); `dispose()` runs them (`:1285`). The `Atom.context` layer pin is explicitly
unset (`:413`). All of that is real.

My first Q1 run appeared to show a large leak; that was my own impatience — a 700 ms wait against
a 400 ms TTL. Probe **Q1b** isolates every variable, three cycles each:

```
Q1b builder-config (TTL20/res5,  wait200, plain) c1: live=407 after=0 | c2: after=0 | c3: after=0
Q1b app-config     (TTL400,      wait700, plain) c1: live=407 after=12 | c2: after=20 | c3: after=23
Q1b app-config     (TTL400,      wait3000,plain) c1: live=407 after=0 | c2: after=0 | c3: after=0
Q1b builder-config (TTL20/res5,  wait200, EXTRA) c1: live=411 after=380 | c2: after=760 | c3: after=1140
Q1b app-config     (TTL400,      wait3000,EXTRA) c1: live=411 after=380 | c2: after=760 | c3: after=1140
```

The read-only path returns to baseline under both configs. **The `EXTRA` path leaks ~380 nodes per
store, linearly, under both configs** — so it is not a TTL artifact. Probe **Q1c** pins the
operation, two cycles each at the builder's own TTL:

```
Q1c none (control)      c1: live=407 after=0   | c2: after=0
Q1c read entity(guid)   c1: live=411 after=0   | c2: after=0
Q1c hover(guid)         c1: live=408 after=0   | c2: after=0
Q1c selectRoom(guid)    c1: live=408 after=0   | c2: after=0
Q1c patchRoom(guid)     c1: live=407 after=377 | c2: live=784 after=754
Q1c decide(guid)        c1: live=407 after=377 | c2: live=784 after=754
```

Probe **Q1d** names the survivors after a single `decide()`:

```
Q1d survivors=377
Q1d    179  takeoffs/entity/<id>/staged
Q1d    178  takeoffs/entity/<id>/decided
Q1d      3  unlabelled
Q1d      1  takeoffs/runtime … + 19 more owned store nodes, one each
Q1d states={"valid":377}   nodes-with-listeners=4
```

**One staged edit or one decision permanently pins both entity families — every member, for every
room — and drags 20 already-released store nodes back into residency.** The mechanism: `decidedAtom`
and `stagedAtom` are `Atom.family` members created outside `owned`, and `decisionsAtom` / `worldAtom`
iterate *all* rooms and `get` every member, so a single write leaves 179 valid parents that dispose
never releases and the TTL sweep never queues. `hoveredAtom` and `selectedAtom` are also outside
`owned` but stay clean, because nothing derives across the whole family from them.

The builder's regression test (`store.test.ts:302`) settles the snapshot and reads `visibleRows` —
it never writes an entity family, so it is green and the leak is real at the same time. Staging a
room name or accepting a flag is the route's core interaction, so this fires in ordinary use.

### Claim 3 — G11. UPHELD for sort/facet.

`ATLAS_COLUMN_SEMANTICS` (`store.ts:328-357`) is one exported table; Atlas holds **zero** inline
`sort:`/`facet:` definitions (`grep -cE '^\s+(sort|facet): \('` = 0) and 15 references to the shared
table. The `r10` column gained the `sort`/`facet` it previously inherited implicitly
(`atlas.tsx:697-698`), which removes the subtlest divergence risk I flagged in P3.

**Residual:** the multi-valued `flags` predicate is still written twice — `match:` at
`atlas.tsx:656-660` and the same three-branch logic at `store.ts:750-756`. `AtlasColumnSemantics`
has no `match` field, so this one is outside the new single definition.

### Claim 4 — G14. UPHELD. All three guards verified by reversion.

Each fix was reverted in the working tree, the single test run, and `store.ts` restored via
`git checkout` (verified: `git diff --stat` = 0 lines after each).

| Fix | Reversion | Result |
| --- | --- | --- |
| G1 conflict | `store.ts:812` → compare `staged.base` against `authority` | **FAILS.** `AssertionError: expected { hovered: false, …(6) } to match object { dirty: true, conflict: false }` |
| G2 candidates key | `store.ts:829` → `invalidate(["snapshot"])` | **FAILS.** `AssertionError: expected 1 to be 2` |
| G3 `.r10` retry | `store.ts:1018` → `retryRhvac()` returns early | **FAILS.** `retries a failed .r10 list and open` |

### Claim 5 — 51 tests. CONFIRMED.

51 = 42 (`src/takeoff src/targeting src/state`) + 9 (`src/components/master-table`), 5 files. The
report's command includes master-table, so the number is honest; it is a wider scope than Pass 3's
39, not 12 new tests.

## Corrections to my own earlier passes

| # | What I said | Correct position |
| --- | --- | --- |
| **C1** | Pass-3 G14: Pass-2 items G1–G3 "remain open at HEAD". | **Wrong on all three.** `a61e519` (G1), `1c2bea0` (G2), `d08f613` (G3) all landed *before* `eba308d`, my Pass-3 base. My table's narrower wording ("not addressed in this diff") was right; the G-list sentence was not. The report's correction is accurate. |
| **C2** | Pass-3 P4: the fixture is 179 rows, so "180" is off by one. | **Wrong.** `fixture-world.ts:90,105` is `loadMockWorldGeo().catch(() => mockWorld())`. The browser loads real geometry (180 rooms); Node cannot fetch the relative URL and falls back to `mockWorld()` (179). Both counts are correct for their lane. |
| **C3** | Pass-4 first Q1 run appeared to show a large leak on the plain path. | **My error** — 700 ms against a 400 ms TTL. Q1b/Q1c corrected it; the surviving finding is narrower and specific to entity-family writes. |

A note on method: my Q5/Q5b atom-notification census is **not** a valid proxy for React renders.
Probe **Q6** shows a subscribed derived atom is not re-notified while already stale — `unbatched
set -> leaf=1 derived=0`, and only after an explicit `get` does the next write notify. React's
`useAtomValue` reads through `useSyncExternalStore` on every render, a different path. I therefore
diagnose G13 below from render structure, not from that probe.

## G13 diagnosis — ~310 ms of script per cursor switch

**Cause, in order of contribution.**

| # | Step | Evidence |
| --- | --- | --- |
| 1 | A cursor write mints a new `atlasPage` object; `Atlas` subscribes to that aggregate and re-renders. | `atlas.tsx:406`, `:411`; Q5 `changed-on-new-cursor=true` |
| 2 | `Atlas` passes `activeKey={cursor}` — a changed prop — into `MasterTable`. | `atlas.tsx:1096` |
| 3 | **`master-table.tsx` contains no `React.memo` at all** (`grep -nE 'React\.memo\|\bmemo\('` = 0 hits). | — |
| 4 | So `visibleRows.map(...)` re-creates all 180 `<tr>`, and `activeKey` is read *inside* the map, at the `ref` and the row `className`. | `master-table.tsx:453`, `:459`, `:465` |
| 5 | Each row calls the non-memoised `cellsFor`, which invokes three TanStack cell getters, then renders 9 columns (15 with Manual J in `columns` mode) — roughly 1 600–2 700 cell elements re-created and reconciled per keypress. | `master-table.tsx:244-248`; `atlas.tsx` column count |
| 6 | A layout effect then runs `scrollIntoView` on the new active row. | `master-table.tsx:250-252` |

Atlas's own memos are **not** the problem — Pass 3's fix to `actions` means `columns`,
`visibleRows` and `chips` all hit. The cost is the row map, which no longer needs to run at all when
only the highlight moved.

**Cheapest fix: memoise the row.** Extract the `<tr>` body into a `MasterRow` wrapped in
`React.memo`, taking `(tableRow, isActive, cells, …)`. Only the two rows whose `isActive` flips
re-render; the other 178 bail out on shallow-equal props. This needs the callbacks reaching a row
to be referentially stable — `onRowClick` and `onRowHover` are inline arrows at `atlas.tsx:1098` and
`:1100` and would move to `useCallback`, and `cellsFor`/`rowClassName` likewise.

**Size:** ~40–60 lines in `master-table.tsx` (one extracted memo component plus prop threading) and
~4 `useCallback` wrappers in `atlas.tsx`. The regression test is cheap because the jsdom harness
already exists — `components/master-table/*.test.tsx` opens with `// @vitest-environment jsdom` and
`@testing-library/react` — so a render-counting cell that asserts a constant count across an
`activeKey` change is ~15 lines.

I did **not** run the 310 ms measurement myself; it is the builder's browser number, and I have no
independent timing for it. What I verified is the structure that explains it.

A cheaper-looking alternative — dropping `activeKey` out of the map and toggling a class from a
layout effect — would avoid re-rendering rows but leaves `MasterTable` itself re-rendering on every
Atlas render, so it saves the row bodies only if the memo above also lands. Do the memo.

## G-list

| # | Fix | Where | Size |
| --- | --- | --- | --- |
| **G15** | Release entity-family members on dispose. Either route `hoveredAtom`/`selectedAtom`/`decidedAtom`/`stagedAtom`/`entityAtom` members through `owned` as they are materialised, or collapse `decidedAtom`/`stagedAtom` into the single record atoms that `decisionsAtom` and `worldAtom` already project — the per-id family is the redundant layer for those two. Extend the G10 regression test to call `decide()` and `patchRoom()` before dispose; it fails today. | `store.ts:470-490`, `:1285`; `store.test.ts:302` | ~20 lines + test |
| **G16** | Memoise the table row (see the G13 diagnosis) and add the render-count assertion in the existing jsdom lane. | `master-table.tsx:453`, `atlas.tsx:1098` | ~60 lines + ~15-line test |
| **G17** | Stop `Atlas` subscribing to the `atlasPage` aggregate: read `store.atoms.cursor` and the other scalars directly (all are exported). Independent of G16, and it shrinks what re-renders even after the row memo lands. | `atlas.tsx:406`, `:411` | ~10 lines |
| **G18** | Fold the `flags` `match` predicate into `ATLAS_COLUMN_SEMANTICS` as an optional `match` field so G11's single definition covers filtering as well as sort/facet. | `store.ts:328`, `atlas.tsx:656` | ~10 lines |
| **G19** | Make the two fixture lanes agree, or have `loadMockWorldGeo()` failure be loud in tests rather than silently falling back — the 179/180 split cost this review a wrong finding (C2) and will cost the next one too. | `fixture-world.ts:90`, `:105` | small |

## VERDICT

**iterate.**

Pass 4 is the strongest pass of the four and the first where I had to correct myself more than the
builder. G9 is genuinely done — Q4 shows cursor, hover and level all leave both row arrays
identity-stable, and no aggregate read remains anywhere in the store. G11 is done for sort and
facet, with zero inline definitions left in Atlas. G12 is done, and ADR 0009 now records both the
mount-release-TTL mechanism and the `RegistryContext` default-registry footgun I raised. G14 is
done and, unusually, *provable*: I reverted all three fixes and all three tests failed with
specific assertions. The 51-test count is honest. My Pass-3 claim that G1–G3 remained open was
wrong, and so was my 179-row finding.

Two things still block promotion. G10's release mechanism is real but only covers the read-only
path: one `decide()` or one `patchRoom()` permanently pins 377 nodes — both entity families in
full, plus 20 store nodes that dispose had already released — and it recurs per store instance
(377 → 754 → …). The builder's regression test cannot see it because it never writes an entity
family, which is the sharpest reminder in this review that a green guard proves only the path it
walks. And G13's 310 ms is diagnosable without a profiler: `master-table.tsx` has no `React.memo`
anywhere, so a changed `activeKey` re-creates all 180 rows and their ~2 000 cells; G9 moved the
derivation off the cursor path but left `Atlas` subscribed to the aggregate that changes on it.

Both are bounded — G15 is ~20 lines and a test, G16 ~60 lines against a jsdom harness that already
exists. Neither is structural, and the shape underneath has now survived four passes of this.

---

# Pass 5 judge

Final adversarial review of `40768fe`, `a8e30c0` against `git diff fc2f127..HEAD -- source/`
(6 files, +269/−142). Q1 re-run with all four write paths; G16 verified by reversion; G19 verified
by fixture fingerprint diff. Source not edited — `git status -- source/` clean at exit.

## Lane facts

| Command | Result |
| --- | --- |
| `vp test src/takeoff src/targeting src/state src/components/master-table` | **PASS. 5 files, 52 tests.** |
| `vp check` on the seven touched paths | **PASS. 29 files; 0 warnings, lint, or type errors.** |
| Probes Q1, Q7, FP (written, run, deleted) | Output inline. |

## Verdicts

| # | Claim | Verdict |
| --- | --- | --- |
| 1 | G15 — baseline restored with decide+patch+hover+select; no writable per-id authority | **UPHELD** (three writable per-id *flags* remain; neither is an authority) |
| 2 | G16 — memo guarded by the render-count test; no inline props reach `MasterRow` | **UPHELD** (one unenforced invariant noted) |
| 3 | G17 — no `atlasPage` reads in `atlas.tsx` | **UPHELD** |
| 4 | G19 — the parity room changes no existing assertion's meaning | **UPHELD** (not purely additive; detail below) |
| 5 | 52 tests | **CONFIRMED** |

### Claim 1 — G15. UPHELD, and better than claimed.

`decisionsAtom` and `stagedEditsAtom` are now the single writable record authorities
(`store.ts:485`, `:488`); `decidedAtom(id)` and `stagedAtom(id)` are derived projections over them
(`:500-512`). Every family member now enters `owned` on materialisation (`:491-512`, `:806-822`).
`worldAtom` reads the record once instead of per-room (`:704`, `:723`), and `decisionsAtom` no
longer iterates `roomsByIdAtom` to rebuild itself.

Probe **Q1**, four cycles, each calling `decide()`, `patchRoom()`, `hover()`, `selectRoom()` and
two `entity()` reads before dispose, at the app's own `defaultIdleTTL: 400` with a 3 s wait:

```
Q1 baseline=0
Q1 cycle 1: live=77 afterDispose+TTL=0 (baseline 0)
Q1 cycle 2: live=77 afterDispose+TTL=0 (baseline 0)
Q1 cycle 3: live=77 afterDispose+TTL=0 (baseline 0)
Q1 cycle 4: live=77 afterDispose+TTL=0 (baseline 0)
```

Pass 4's finding is closed. The steady-state node count also fell **407 → 77**, because family
members are now materialised only for touched ids rather than for all 180 rooms on every
`decisionsAtom` recompute. That second effect is not claimed in the report and is the larger win.

**On "no writable per-id family authority remains":** true for the two that *were* authorities.
Three writable per-id families survive — `hoveredAtom`, `selectedAtom`, `boundAtom`
(`store.ts:491`, `:494`, `:497`), each `Atom.make(false)`. They are leaf booleans, read only
per-id inside `entityAtom` (`:811-813`), and written only for the touched id with the previous one
cleared (`:956`, `:1057-1082`). Nothing derives across the whole family from them, which is why
Pass-4's Q1c already showed `hover` and `selectRoom` retaining nothing. They are per-id UI flags,
not authorities; the claim holds on the meaning that matters.

### Claim 2 — G16. UPHELD by reversion.

`MasterRow` is `memo(MasterRowView, comparator)` (`master-table.tsx:133-143`). Reverting it to a
plain identity passthrough:

```
const MasterRow = MasterRowView;
× changing the active row re-renders at most the two changed rows
AssertionError: expected 3 to be less than or equal to 2
```

Restored; `git diff --stat` = 0. The guard is real.

**No inline arrow or object prop reaches `MasterRow`.** `atlasRowKey` and `atlasGutter` are
module-level constants (`atlas.tsx:68-69`); `setTableState`, `selectTableRow`, `hoverTableRow` are
`useCallback` (`:470`, `:474`, `:481`); `columns` and `activeRowRef` are memo/ref; `className` is a
fresh string, which the comparator compares by value. Correct.

**Two things to record.** First, the comparator omits `children`, which is necessarily a fresh
element tree each render — including it would defeat the memo. That makes "every cell is a pure
function of `(row, columns)`" a load-bearing invariant that nothing enforces. I checked it holds
today: the only external identifier captured inside the `columns` memo body (`atlas.tsx:546-735`)
is `store`, which is stable and reaches a self-subscribing `RoomNameCell`; `columns` deps are
`[actions, flagVocabulary, fieldsMode]` and every other cell input is reachable from `row`. So no
live defect — but a future cell that closes over route state will go stale silently. Second, the
regression fixture is **three rows** (`master-table.test.tsx:17-21`), so the guard's margin is 3
versus 2; a partial regression that memoised most rows would still pass.

### Claim 3 — G17. UPHELD.

`grep -n atlasPage` over `atlas.tsx` and `routes/takeoffs.tsx` returns **zero hits**. Atlas
subscribes to the five scalars directly. The only remaining readers of the aggregate are the
store's own `inspect()` and `store.test.ts:215`. Pass-4's component-boundary finding is closed.

### Claim 4 — G19. UPHELD, with one nuance the report understates.

`mockWorld()` adds exactly one room to the first zone with `0 < baseRoomCount < 8`, then latches
(`mock.ts:222`, `:260-263`). Probe **FP** fingerprints the generated world at HEAD and at
`fc2f127`:

| Metric | fc2f127 | HEAD |
| --- | --- | --- |
| totalRooms | 179 | **180** |
| zoneRoomCounts | …,8,**5**,3,8,… | …,8,**6**,3,8,… (only index 4 differs) |
| first5 rooms | `Gym\|768 ; Mech\|938 ; Kitchen\|337 ; Primary Bedroom\|169 ; Bath\|124` | **identical** |
| last5 rooms | `Primary Bedroom\|106 ; Bath\|28 ; …` | **identical** |
| flagTotal | 23 | **23** |
| withData / withR10 | 86 / 72 | 87 / 73 (the new room) |
| sqftSum | 42135 | 42102 |

The RNG stream is not perturbed for other zones — first5 and last5 are byte-identical, so the
change is local. `bedroomsInZone` is gated on `roomCount >= 3` and 5 and 6 both clear it, so the
bedroom set is unchanged, which is why the 13-guid `filtered` assertion (`store.test.ts:264-278`)
and the 3-guid `sorted` assertion (`:259-263`) were not touched by the commit and still pass. The
only assertion the commit edited is the count itself (`:293`, 179 → 180), which is the point of
the change.

**Nuance:** the change is *not* purely additive. `sqftSum` moves 42135 → 42102 because
`interiorPoints` splits zone 4 among six rooms instead of five, so that zone's existing room areas
shrink. No current assertion depends on zone-4 geometry, so no meaning changed — but "one stable
parity room" reads as append-only, and a future assertion on zone-4 sqft would be sitting on
resettled ground.

### Claim 5 — 52 tests. CONFIRMED.

Reproduced exactly: 5 files, 52 tests, exit 0. One net new test versus Pass 4's 51 — the
render-count regression (`master-table.test.tsx:144`).

## Promote gate

### What a merge into `takeoff-frontier` would carry

`git diff --stat takeoff-frontier..HEAD` — **29 files, +6288 / −1421.**

| Area | Files | Note |
| --- | --- | --- |
| **Route store (the cutover)** | `takeoff/store.ts` (+1328, new), `store.test.ts` (+514, new), `routes/takeoffs.tsx` (−~600 net), `takeoff/atlas.tsx` (rewritten), `takeoff/host.ts`, `takeoff/proto/{fixture-world,mock-geo,mock}.ts` | the intended payload |
| **Targeting manifest** | `targeting/{model,kit,head}.ts(x)` + `model.test.ts` (all new, +1213) | the sentence/bindings layer |
| **App registry** | `state/registry.ts` (+3), `routes/__root.tsx` (provider) | ADR 0009's mechanism |
| **Atom devtools subsystem** | `state/atom-inspect.ts` (+238), `state/atom-inspect.test.ts` (+71), `integrations/atoms/devtools.tsx` (+187), `docs/research/state-arch/12-devtools.md` (+419) | **rides along; not part of the takeoffs cutover** |
| **Shared table** | `components/master-table/master-table.tsx` (+178), `.test.tsx` (+14) | touches every route that uses `MasterTable` |
| **ADR** | `docs/adr/0009-one-atom-registry-per-app.md` only | one ADR, accurate |
| **Unrelated docs** | `docs/loop/{RIG.md,p-builder,p-eyes,p-idea,p-sdkfix}.md` (+515), `docs/features/design-system/LEDGER.md`, `docs/features/host/LEDGER.md` (**binary diff, 26 793 → 28 233 bytes**) | **merge noise — nothing to do with takeoffs** |

Three things deserve a decision before the merge, none of them defects in the cutover:

1. **`master-table.tsx` is shared.** The `MasterRow` memo and the `visibleKeys`-vs-`onVisibleChange`
   prop swap change behaviour for every route that renders a `MasterTable`, not just `/takeoffs`.
   `onVisibleChange` was **removed** from the public props, so any other caller passing it now
   silently loses the callback — worth a grep across routes before merging.
2. **The devtools subsystem and `docs/loop/*` are separable.** ~900 lines of devtools plus 515
   lines of loop docs and a binary LEDGER rewrite are riding a takeoffs branch. They may be wanted,
   but they should be a stated part of the merge, not a surprise in it.
3. **The live lane has never run.** Every write path, the SSE bridge, and `openRhvac`'s untyped
   response remain compile-and-fixture proof only. The report has been honest about this in all
   five passes; it is a scope boundary, not a hidden gap — but merging to `takeoff-frontier` should
   record it.

### Residual census smells still live in `store.ts` / `atlas.tsx` / `takeoffs.tsx`

| # | Smell | Status |
| --- | --- | --- |
| S1 effect with no dep array | **dead** — 0 un-arrayed effects in all three files |
| S2 memo that can never hit | **dead** — `actions` memoised, `columns` deps stable |
| S4 derived order round trip | **dead** — store owns `visibleRowsAtom`; `onVisibleChange` gone |
| S6 `level` has four writers | **dead** — one `levelAtom` owner |
| S8 / S9 feed state asserted | **dead** — one `resultFeed` projector |
| S13 / S14 two busy models | **dead** — one `runVerb` bracket |
| S24 heavy derivation per render | **dead** — `syncPlanAtom` |
| **S5 the same fact in two places** | **LIVE.** `decisionsAtom` (session record, `store.ts:485`) and `room.decisions` (the persisted blob, written via `upsertResolution` at `:1169`) both mean "this flag has a verdict". `atlasRowsAtom` subtracts the session record (`:738`); the world/blob path subtracts the other. Two subtraction sites for one rule — the census's original S5, narrowed but not closed. |
| **S3 hand-maintained deps + suppression** | **1 remaining** — `atlas.tsx:746`, the `chips` memo. Down from 2. |
| **S23 panel data shadowed by local edits** | **partial.** `adoptRowsAtom` overlays patches on a fresh read (`:574`) and clears on adopt (`:1246`), so a refetch is no longer discarded — but adopt drafts still carry no `{base,next}`, so a conflict there is undetectable. Rooms have the full `{base,next}`; adopt rows do not. |
| S7 `ago()` reads the wall clock in render | **live, outside the three files** — `targeting/kit.tsx:249`. In the branch, so it merges. |
| S19 Escape unwinding | **one protocol** in these files (`atlas.tsx:508`). Cross-route divergence is out of scope. |

### `effect/unstable` surface

The whole web app imports exactly four unstable modules, and nothing else:

```
5 effect/unstable/reactivity/AtomRegistry
4 effect/unstable/reactivity/Atom
4 effect/unstable/reactivity/AsyncResult
1 effect/unstable/reactivity/Reactivity
```

`@effect/atom-react` is only `RegistryContext` and `useAtomValue`. Symbols used are conservative:
`Atom.make/family/batch/swr/context/withLabel/autoDispose/isWritable`,
`AtomRegistry.make/getResult/Node`, and `registry.{get,set,update,mount,refresh,getNodes}`.
`workbench/route-state.tsx` already imported `effect/unstable` at `takeoff-frontier`, so this branch
deepens an existing dependency rather than introducing one.

**Two couplings go beyond the import list and are the real portability risk:**

1. **`store.ts:422` — `Reflect.set(runtime.layer, "keepAlive", false)`.** This mutates a private
   field on `Atom.context`'s internal layer atom. It is the single most brittle line in the branch:
   a beta bump that renames, freezes, or restructures `layer` breaks disposal silently and the
   G15 leak returns. Two mitigations are already in place — the line carries a `FOOTGUN` comment,
   and `store.test.ts:302` asserts the zero-node baseline, so a break fails a deterministic test
   rather than shipping. That is the right guard.
2. **`state/atom-inspect.ts` depends on `AtomRegistry.Node` internals** — `node.parents`,
   `node.children`, `node.listeners`, `node.currentState()`, `node.atom.label`,
   `registry.getNodes()` (`:86`, `:136-178`, `:211-229`). 238 lines of devtools coupled to
   unstable internals. Contained to devtools, but it is the largest surface that a beta bump can
   break, and it merges as part of the payload above.

## VERDICT

**pass.**

Every claim in Pass 5 survives adversarial probing, and each of the four defects I raised across
passes 2–4 is now closed with evidence I generated rather than accepted. G15 is the strongest
result: four cycles exercising `decide`, `patchRoom`, `hover` and `selectRoom` return the shared
registry to a zero-node baseline every time, and steady-state residency fell 407 → 77 as a
side-effect the report does not claim. G16's memo fails its guard when reverted, and no inline prop
reaches the memoised row. G17 is absolute — zero `atlasPage` reads in the component layer. G19's
parity room is well isolated: the fixture fingerprint is byte-identical outside the one zone it
touches, and no existing assertion changed meaning. The census is in the best state it has been:
S1, S2, S4, S6, S8, S9, S13, S14 and S24 are all dead in the three named files.

What remains is small and named. S5 is still live — session decisions and the persisted blob are
two homes for one verdict, with two subtraction sites — and it is the last original census smell
standing in `store.ts`. One lint suppression survives at `atlas.tsx:746`. S23 is closed for rooms
and open for adopt drafts. The `MasterRow` comparator makes cell purity a load-bearing invariant
that no test enforces, and its regression fixture is three rows wide. None of these blocks the
cutover; all belong on the next ledger.

Two conditions I would attach to the merge itself rather than to this verdict: `master-table.tsx`
is shared, and dropping `onVisibleChange` from its public props is a silent breaking change for any
other caller, so grep the routes first; and the branch carries ~900 lines of atom devtools plus 515
lines of `docs/loop/*` and a binary LEDGER rewrite that have nothing to do with takeoffs — carry
them deliberately or split them out. The live lane still has not run, which has been stated
honestly in all five passes and remains the one proof lane this work has never entered.
