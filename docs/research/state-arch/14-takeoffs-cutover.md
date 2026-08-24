# Takeoffs route-store cutover

Date: 2026-08-24

Branch: `takeoff-cutover`

Verdict: **Steps 1–5 reached. Deterministic, compile, and fixture-browser lanes are green. The live lane was deliberately not run.**

## What reached which step

1. **Store and fixture host — reached.** Commit `335906d` introduced one Effect v4
   `AtomRegistry` behind `createTakeoffStore({ host, sessions, search })` and no-React tests for
   descendant clearing, fixture swapping, adopt invalidation/SWR, error feeds, and SSE invalidation.
2. **Route composition and sentence feeds — reached.** Commit `dfa09c2` made the route the
   composition root, selected `?source=fixture` there, synchronized validated search into the
   store, and rendered the targeting sentence from store feeds.
3. **Atlas state and entity atoms — reached, with the S6 limitation below.** Commit `7846453`
   changed `Atlas` to `{ store }`, moved domain page state and room decisions into the registry,
   added pane Suspense boundaries, and made the room inspector subscribe by room id.
4. **Panels and verbs — reached.** Commit `ac4a70f` moved adopt/sync panels, room writes,
   capture/partition/refresh/launch/sync/adopt, receipts, failures, and serial busy state behind the
   store verb bracket.
5. **Delete replaced route state — reached, with narrower credit.** Commit `0f0601d` removed the
   takeoffs route's `useVerb`, `replaceRegionBlob` React-state surgery, and hard-coded feed states.
   There was no TanStack snapshot authority or `patchSnapshot` at `335906d~1`, so the cutover did
   not remove them. `SessionOverlay` remains in `world.ts` and moved behind the store. Shared
   `lib/use-verb.ts` remains because unrelated routes still import it.

Commit `e1c0fa3` completed the fixture adoption proof, made the targeting manifest single-source,
and fixed an audit-found regression so a live `.r10` open is joined back into the authority world
(`source/pe-tools/apps/web/src/takeoff/store.ts:553`).

## Proof

- **Deterministic:** `vp test src/takeoff src/targeting` from `apps/web` — 3 files, 33 tests passed.
  The store suite includes all five requested cases plus fixture-panel adoption and live `.r10`
  projection (`source/pe-tools/apps/web/src/takeoff/store.test.ts`).
- **Compile/static:** `vp check` on all touched TypeScript/TSX files — correctly formatted; zero
  warnings, lint errors, or type errors.
- **Browser fixture:** `vp run @pe/web#dev` served port 3002. HTTP GET
  `/takeoffs?source=fixture` returned 200. A fresh browser tab rendered the targeting sentence,
  `fixture · project-a replay`, the 45-zone Atlas, and room table. Binding Lower Level enabled adopt;
  the panel showed 11 view-scoped candidates; committing closed the panel and rendered
  `fixture adopted 11 zoning regions`. Fresh-tab console errors: zero.
- **Live lane:** deliberately not run. No Revit session was started and no live Host was contacted.
  Live host behavior therefore remains compile- and deterministic-contract proof only.

## Hook diff

"Before" is the reproducible `git show 335906d~1:<path>` baseline. Counts include hook calls only,
not imports or comments.

| File | `useState` | `useEffect` | `useMemo` | `useRef` | `useCallback` | ESLint suppressions | Lines |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `routes/takeoffs.tsx` | 8 → 0 | 1 → 2 | 0 → 1 | 1 → 2 | 2 → 0 | 0 → 0 | 925 → 630 |
| `takeoff/atlas.tsx` | 9 → 2 | 2 → 1 | 10 → 11 | 0 → 1 | 0 → 0 | 2 → 2 | 2,015 → 2,045 |
| `targeting/kit.tsx` | absent → 3 | absent → 2 | absent → 2 | absent → 1 | absent → 8 | absent → 1 | absent → 624 |

The route's two effects are lifecycle plumbing only: cancelable disposal and validated router
search → store input (`source/pe-tools/apps/web/src/routes/takeoffs.tsx:121`). Atlas's two state
cells are pane chrome (`planOpen`, `statsOpen`), and its one effect is the keyboard listener
(`source/pe-tools/apps/web/src/takeoff/atlas.tsx:390`, `:445`). Its two suppressions are memo
dependency suppressions, not domain-state synchronization.

## S1–S10 audit

| Item | Status | Evidence |
| --- | --- | --- |
| S1 bindings | **met** | One exported `TAKEOFF_LINKS` manifest feeds both store clearing and route UI; the store reuses `pickInto` (`source/pe-tools/apps/web/src/takeoff/store.ts:174`, `:785`). |
| S2 URL boundary | **met** | Router `validateSearch` is the only declaration; the route alone owns `navigate`; the store reads one writable search atom and emits through `SearchPort` (`src/routes/takeoffs.tsx:67`, `:104`; `src/takeoff/store.ts:61`, `:762`). No `Atom.searchParam` exists. |
| S3 one projector | **met** | One `resultFeed` projects all six feeds from AsyncResult, basis, and waiting (`src/takeoff/store.ts:266`, `:504`). |
| S4 feed truth | **met** | Snapshot, candidates, RHVAC list, and `.r10` open use SWR; stale/error/loading/fresh/fixture come from AsyncResult rather than route literals (`src/takeoff/store.ts:423`, `:440`, `:481`, `:498`). |
| S5 fixture swap | **met** | Route-root `?source=fixture` swaps both host and session source; the fixture host is backed by fixture-world projection (`src/routes/takeoffs.tsx:104`; `src/takeoff/proto/fixture-world.ts:87`). |
| S6 entity families | **partial** | Registry families provide hovered, selected, decided, staged, and a combined entity view (`src/takeoff/store.ts:373`, `:641`); the room inspector subscribes by room id (`src/takeoff/atlas.tsx:1587`). The selected zone card still receives a projected `WorldZone` instead of subscribing by zone id. |
| S7 `{ store }` UI | **met** | `TakeoffsPage` and `Atlas` each take only `{ store }`; route domain hooks are zero, Atlas domain hooks are zero, and three Atlas panes have Suspense boundaries (`src/routes/takeoffs.tsx:135`, `:357`; `src/takeoff/atlas.tsx:362`, `:735`, `:874`, `:976`). |
| S8 keyed reactivity | **met, live-unproven** | Every async source has declared reactivity keys; writes invalidate those keys; SSE classifies connect/disconnect as sessions and state/event as document (`src/takeoff/store.ts:392`, `:795`; `src/takeoff/host.ts:180`). |
| S9 staged overlay | **met** | Per-room staging is `{base,next}`; dirty and conflict are derived from authority versus base; sync clears staging only after success (`src/takeoff/store.ts:141`, `:641`, `:952`). |
| S10 inspection/lifecycle | **met** | All registry nodes are labeled; `inspect()` returns URL, persisted, page, feeds, actions; `dispose()` unsubscribes, clears the timer, and disposes the registry (`src/takeoff/store.ts:1022`, `:1039`; `src/routes/takeoffs.tsx:121`). |

The verb bracket is **met**: all takeoffs writes are serial through `runVerb`, which owns busy id and
seconds, receipt, typed failure, and declared invalidations (`source/pe-tools/apps/web/src/takeoff/store.ts:685`,
`:889`, `:967`).

## Left undone and why

- **S6 zone-local subscription:** the selected zone card still consumes the already-projected
  zone. Moving it onto the same family requires resolving whether plan focus and URL multi-zone
  selection are one `selected` currency or two. Guessing would merge distinct interaction state,
  so this stopped at the rude semantic seam.
- **Shared `lib/use-verb.ts`:** removed from `/takeoffs`, not deleted repo-wide, because other routes
  still use it and were outside this mission.
- **Live runtime proof:** explicitly out of scope; no Revit lifecycle or live Host operation was
  touched.

## Known defects introduced or retained

1. The zone card is the remaining S6 exception described above.
2. `TakeoffHost.openRhvac` is still typed as `unknown`; the world projector narrows it with a local
   cast because the host contract does not export the RPC result type at this seam
   (`source/pe-tools/apps/web/src/takeoff/store.ts:575`). Compile and deterministic projection are
   green, but a malformed live response is not runtime-validated here.
3. Fixture adoption proves the complete UI/store verb path and receipt but does not mutate the
   immutable fixture dataset. The current fixture candidates are already stamped, so a re-read is
   visually unchanged.
4. SSE invalidation and every live write path are structurally covered but not proven against a
   running Host, by instruction.

## Time that felt wrong

The goal clock reached about 69 minutes. The disproportionate time went to recovering the intended
frontier UI baseline, splitting a 2,000-line Atlas without creating two authorities, and diagnosing
browser-only dialog/Strict Mode behavior. The final audit also found the missing `.r10` world join;
that extra pass was necessary, but it exposed how easy it is for compile-green substrate cutovers to
drop a downstream join unless the joined world has its own deterministic assertion.
