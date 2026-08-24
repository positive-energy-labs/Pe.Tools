# Takeoffs route-store cutover

Date: 2026-08-24

Branch: `takeoff-cutover`

Verdict: **partial — stopped after Step 2 at the Atlas/verb transaction seam**

## What reached which step

### Step 1 — reached and committed

Commit `335906d` adds one Effect v4 `AtomRegistry` behind
`createTakeoffStore({ host, sessions, search })`, the live/fixture ports, the fixture adapters, and a
no-React Vitest suite. The suite covers trunk re-pick descendant clearing, the fixture root swap,
adopt → stale → re-read, snapshot error feeds, and pushed document invalidation
(`source/pe-tools/apps/web/src/takeoff/store.test.ts:106`, `:125`, `:141`, `:164`, `:184`).

### Step 2 — reached and committed

Commit `dfa09c2` composes the store at the route boundary, chooses the fixture adapters only for
`?source=fixture`, synchronizes validated search into the store, disposes it on route unmount, and
projects all six sentence feeds from the registry (`source/pe-tools/apps/web/src/routes/takeoffs.tsx:178-216`,
`:276-284`). The fixture path no longer mounts the legacy session-list query or an RHVAC-list query.

This step also recovered the intended frontier route, Atlas, and targeting kit from the dirty
`Pe.Tools-takeoff-frontier` checkout because the `takeoff-frontier` Git ref and this branch both
pointed at `a4d818b`; those intended files were not committed in the source ref. That checkout was
read only throughout.

### Steps 3–5 — not reached

Step 3 is the first rude seam. `Atlas` is 2,000 lines and currently owns nine state cells, two
effects, ten memoized derivations, optimistic decisions, keyboard focus, table visibility, and pane
chrome (`source/pe-tools/apps/web/src/takeoff/atlas.tsx:367-441`). Changing it to `{ store }` would
also require Step 4's write-through decision/edit semantics in the same diff. No honest isolated
Step 3 commit was available, so the pass stopped before modifying that seam.

Consequently the adopt/sync panels and remaining verbs were not migrated, and replaced code was
not deleted.

## Proof

- Deterministic: `vp test src/takeoff src/targeting` from `apps/web` — 3 files, 29 tests passed.
- Compile/static: `vp check` on the six Step 2 files — formatting clean; zero warnings, lint errors,
  or type errors.
- Browser fixture: `vp run @pe/web#dev` served port 3003; HTTP GET
  `/takeoffs?source=fixture` returned 200. Browser DOM showed the targeting sentence, fixture seam,
  45-zone Atlas, room table, and disabled `adopt zones` control. The fixture manifest reports adopt
  as unwired, so the adopt panel did **not** work and is not claimed as proven.
- Browser defect: the first browser mount exposed a disposed-registry Strict Mode cleanup bug. The
  route now defers disposal one tick and cancels that disposal on Strict Mode remount
  (`source/pe-tools/apps/web/src/routes/takeoffs.tsx:206-211`). After HMR the full fixture DOM rendered,
  but a clean new-tab log capture timed out on the very large DOM. Historical disposed-registry
  errors remained in the dev-server console, so browser proof is partial rather than green.
- Live lane: deliberately not run. No Revit session was started and no live Host was contacted.

## Hook diff

“Before” is the recovered frontier working-tree version read from
`C:\Users\kaitp\source\repos\Pe.Tools-takeoff-frontier`, not commit `a4d818b`.

| File | `useState` | `useEffect` | `useMemo` | ESLint suppressions |
| --- | ---: | ---: | ---: | ---: |
| `routes/takeoffs.tsx` | 4 → 4 | 0 → 2 | 2 → 1 | 1 → 0 |
| `takeoff/atlas.tsx` | 9 → 9 | 2 → 2 | 10 → 10 | 2 → 2 |

The two new route effects are lifecycle-only: cancelable disposal and router-search → store input
(`source/pe-tools/apps/web/src/routes/takeoffs.tsx:206-212`). Domain state remains in the route and
Atlas, so S7 is not met.

## S1–S10 audit

| Item | Status | Evidence |
| --- | --- | --- |
| S1 bindings | **met** | Store reuses `pickInto` and its declared descendant clearing (`source/pe-tools/apps/web/src/targeting/model.ts:134-166`; `src/takeoff/store.ts:514-533`). |
| S2 URL boundary | **partial** | Router alone declares search (`src/routes/takeoffs.tsx:149-160`); store has one writable search atom and emits through `SearchPort` (`src/takeoff/store.ts:42-44`, `:198-205`, `:503-533`). Remaining route callbacks still navigate directly. No `Atom.searchParam` exists. |
| S3 one projector | **met** | One `resultFeed` maps AsyncResult/basis/waiting for every store feed (`src/takeoff/store.ts:165-188`, `:351-400`). |
| S4 feed truth | **met** | Loading/error/stale/fresh/fixture come from AsyncResult and waiting; snapshot/list use SWR (`src/takeoff/store.ts:165-188`, `:305-349`). Route sentence uses only projected feeds (`src/routes/takeoffs.tsx:276-284`). |
| S5 fixture swap | **met** | Fixture host/session factories (`src/takeoff/proto/fixture-world.ts:89-126`) are selected at the route root (`src/routes/takeoffs.tsx:188-203`). |
| S6 entity families | **partial** | Hovered/selected/decided/staged families and combined entity atom exist (`src/takeoff/store.ts:255-268`, `:408-433`), but Atlas does not subscribe by id. |
| S7 `{ store }` UI | **missing** | Route page still takes store plus owns domain hooks; Atlas still takes world/actions and owns domain hooks (`src/routes/takeoffs.tsx:219-267`, `:591-599`; `src/takeoff/atlas.tsx:67-82`, `:367-441`). No per-pane Suspense was added. |
| S8 keyed reactivity | **partial** | Session/document/snapshot/folder/RHVAC sources use `withReactivity`; snapshot/list use SWR; writes and SSE set invalidation keys (`src/takeoff/store.ts:274-349`, `:536-543`). Live SSE event classification is too coarse and was not live-proven. |
| S9 staged overlay | **partial** | Store staging is `{base,next}` with derived dirty/conflict (`src/takeoff/store.ts:107-110`, `:416-429`), but the route still renders and mutates legacy `SessionOverlay` (`src/routes/takeoffs.tsx:265`, `:325-518`). |
| S10 inspection/lifecycle | **met for store** | Every store node is labeled; `inspect()` returns URL, persisted, page, feeds, actions; `dispose()` unsubscribes, clears timer, and disposes registry (`src/takeoff/store.ts:198-452`, `:615-636`). Route owns disposal (`src/routes/takeoffs.tsx:206-211`). |

The store verb bracket is also **partial**: it provides serial busy id/seconds, receipt, typed failure,
and adopt invalidation (`source/pe-tools/apps/web/src/takeoff/store.ts:243-253`, `:438-498`), but the
route still uses `useVerb` and manual React Query cache surgery for the remaining verbs
(`source/pe-tools/apps/web/src/routes/takeoffs.tsx:266`, `:320-518`).

## Left undone and why

- Atlas per-entity subscriptions and `{ store }` API: stopped at the rude Step 3/4 coupling rather
  than split optimistic write-through state across two authorities.
- Adopt/sync panels and all verbs: still route-owned; fixture adopt remains disabled/unwired.
- Deletions: `lib/use-verb.ts`, `patchSnapshot`, `replaceRegionBlob`, hard-coded route world/cache
  paths, legacy `SessionOverlay`, and Atlas domain hooks remain (`src/routes/takeoffs.tsx:320-518`,
  `:660-670`).
- Suspense per pane was not introduced.
- Live event semantics and Host contracts were not proven because the live lane was explicitly out
  of scope.

## Known defects introduced or retained

1. `createHostSessionSource` maps every well-formed non-disconnect SSE event to `docChanged`; a
   connected session is ignored unless it already matches the active document. Session discovery
   therefore depends on the initial read until this mapping is made event-specific
   (`source/pe-tools/apps/web/src/takeoff/host.ts:61-70`).
2. The route store and legacy TanStack snapshot/world path both exist in live mode, so one page can
   perform duplicate snapshot reads and hold two freshness currencies.
3. Store staging and legacy `SessionOverlay` are separate authorities until Steps 3–4 land.
4. Browser proof is not clean: the fixed Strict Mode error remains in historical dev-console output,
   and the clean-tab capture timed out. HTTP and rendered-DOM proof succeeded; adopt-panel behavior
   did not.
5. The recovered frontier UI was a large prerequisite diff absent from the named branch ref. This
   makes Step 2 much larger than the store-composition change alone.

## Time that felt wrong

The goal clock recorded about 27 minutes through the implementation stop. The disproportionate
time went to reconstructing the uncommitted frontier baseline, adapting it without touching that
checkout, and diagnosing a browser-only Strict Mode disposal failure. The store tests and compile
lane were fast; the 2,000-line Atlas DOM made browser capture and the next migration boundary
expensive.
