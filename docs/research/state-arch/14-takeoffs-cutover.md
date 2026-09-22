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
(`ts/apps/web/src/takeoff/store.ts:553`).

## Proof

- **Deterministic:** `vp test src/takeoff src/targeting` from `apps/web` — 3 files, 33 tests passed.
  The store suite includes all five requested cases plus fixture-panel adoption and live `.r10`
  projection (`ts/apps/web/src/takeoff/store.test.ts`).
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
search → store input (`ts/apps/web/src/routes/takeoffs.tsx:121`). Atlas's two state
cells are pane chrome (`planOpen`, `statsOpen`), and its one effect is the keyboard listener
(`ts/apps/web/src/takeoff/atlas.tsx:390`, `:445`). Its two suppressions are memo
dependency suppressions, not domain-state synchronization.

## S1–S10 audit

| Item | Status | Evidence |
| --- | --- | --- |
| S1 bindings | **met** | One exported `TAKEOFF_LINKS` manifest feeds both store clearing and route UI; the store reuses `pickInto` (`ts/apps/web/src/takeoff/store.ts:174`, `:785`). |
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
seconds, receipt, typed failure, and declared invalidations (`ts/apps/web/src/takeoff/store.ts:685`,
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
   (`ts/apps/web/src/takeoff/store.ts:575`). Compile and deterministic projection are
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

## Pass 2

Pass 2 completed G1, G2, G3, G4, G5, G6, G9, and the devtools cutover. G7, G8, and G10 were
deliberately not attempted because the user reserved those decisions and the live lane.

| Item | Status | Evidence |
| --- | --- | --- |
| G1 | **done** | Conflict now compares the staged base with `roomEdit(authority)` and uses no `keyof WorldRoom` cast (`ts/apps/web/src/takeoff/store.ts:666`). Judge probe P1 covers a room with nested Manual J data (`ts/apps/web/src/takeoff/store.test.ts:220`). Commit `a61e519`. |
| G2 | **done** | Adopt invalidates both snapshot and candidates (`ts/apps/web/src/takeoff/store.ts:682`); the SWR test asserts a second candidate read (`ts/apps/web/src/takeoff/store.test.ts:264`). Commit `1c2bea0`. |
| G3 | **done** | A failed `.r10` feed renders a retry verb that invalidates `rhvac-open` and `rhvac-list` (`ts/apps/web/src/routes/takeoffs.tsx:282`). Commit `d08f613`. |
| G4 | **done** | Feed badges render their basis (`ts/apps/web/src/targeting/head.tsx:41`). Zone cards and both room surfaces subscribe to the entity family (`ts/apps/web/src/takeoff/atlas.tsx:352`, `:1551`, `:1687`). URL-bound and plan-focus remain two named currencies (`ts/apps/web/src/takeoff/store.ts:659`). This supersedes the Pass 1 S6 limitation. Commit `d7d0bfa`. |
| G5 | **done** | Atlas actions are hoisted and memoized once per store (`ts/apps/web/src/takeoff/atlas.tsx:73`, `:417`); the keydown handler is ref-backed and the listener mounts once (`:494`, `:519`). Commit `02374ec`. |
| G6 | **done** | The hook table below is recomputed from `git show 335906d~1`; the Step 5 deletion claim above was narrowed to the three removals the diff proves. Commit `1a5430c`. |
| G9 | **done** | Fresh reads state a fixed wall-clock time instead of calculating a relative `ago()` during render (`ts/apps/web/src/targeting/kit.tsx:237`). Commit `9ac0abb`. |
| Devtools | **done, with Effect internals noted** | The store structurally implements `InspectableAtomStore`, exposes its registry and inspector, and brackets every store-owned `set`/`update` with `note({verb,key})` (`ts/apps/web/src/takeoff/store.ts:299`, `:1117`). Route registration is reactive, so an already-mounted panel switches to the route store (`ts/apps/web/src/state/atom-inspect.ts:64`; `ts/apps/web/src/integrations/atoms/devtools.tsx:27`). The no-React Adopt test asserts a recorded cause (`ts/apps/web/src/takeoff/store.test.ts:382`). |

### Pass 2 hook table

Counts are hook calls only, excluding imports and comments. The baseline is `335906d~1`.

| File | `useState` | `useEffect` | `useMemo` | `useRef` | `useCallback` | ESLint suppressions | Lines |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `routes/takeoffs.tsx` | 8 → 0 | 1 → 2 | 0 → 1 | 1 → 2 | 2 → 0 | 0 → 0 | 925 → 633 |
| `takeoff/atlas.tsx` | 9 → 2 | 2 → 1 | 10 → 11 | 0 → 1 | 0 → 0 | 2 → 2 | 2,015 → 2,045 |
| `targeting/kit.tsx` | absent → 3 | absent → 2 | absent → 2 | absent → 1 | absent → 8 | absent → 1 | absent → 617 |

The judge's `targeting/kit.tsx` hook totals included its hook import and a comment despite saying
those were excluded. The table above counts executable hook calls. Pass 2 also found two devtools
facts the judge could not have seen before the merge: the branch documentation declared
`InspectableAtomStore`, but the interface was absent from `atom-inspect.ts`; and Effect v4 creates
six to seven unlabeled runtime/SWR implementation nodes even when every store-authored node uses
`Atom.withLabel`. Those nodes remain visibly `unlabelled`; relabeling library internals through a
cast would violate the public-API inspection rule. At fixture scale the 100 ms inspector scan also
made browser automation noticeably slow (1,127 nodes after Atlas families materialized).

### Pass 2 proof

- **Deterministic:** `vp test src/takeoff src/targeting` — 3 files, 34 tests passed.
- **Compile/static:** `vp check` on the touched store, route, Atlas, targeting, inspector, and
  devtools paths — correctly formatted; zero warnings, lint errors, or type errors.
- **Browser fixture:** `/takeoffs?source=fixture` rendered the sentence, Atlas, room table, and
  Adopt panel. Binding Lower Level and committing 11 candidates closed the panel. The Atoms panel
  reported 1,127 nodes, 1,531 edges, and 208 subscribed; its last-20 list showed
  `adopt page/panel` on candidate and entity recomputations. Browser warnings/errors: zero.
- **Live lane:** not run by instruction. No Revit session was started and no live Host was
  contacted.

Pass 2 took about 55 minutes. The time that felt wrong was not the judge fixes; it was proving the
devtools on the full fixture graph. The initial global handoff let an already-mounted panel retain
the wrong inspector, and the route-sized 100 ms scan made semantic browser clicks slow. Replacing
that handoff with the small active-store subscription fixed correctness; scan cost remains a known
devtools limitation.

## Pass 3

Pass 3 completed G7 and G8 in commit `2a19873`. The app now owns one `AtomRegistry`, and both the
root provider and takeoffs route composition use it. Route stores are handles over that registry:
their `dispose()` releases only store-owned subscriptions and timers. Tests still create and dispose
fresh registries. ADR 0009 records the app-registry and `(route, scope)` family-key decision.

Atlas no longer writes rendered `visibleKeys` back into page state. The takeoff store owns the
table filter and sort inputs and derives `visibleRowsAtom`; the table, keyboard next/previous, and
select-visible behavior all consume that ordered key list. The deterministic store test changes
filters and sort direction and asserts the derived order.

The Pass 2 inspector-cost note was also closed in commit `171716b`: TanStack keeps inactive plugin
panels mounted, so the Atoms panel now subscribes to and polls the registry only while visible.

### Pass 3 proof

- **Deterministic:** `vp test src/takeoff src/targeting src/state` from `apps/web` - 4 files,
  39 tests passed. The additional MasterTable proof, `vp test src/components/master-table`, passed
  1 file and 9 tests.
- **Compile/static:** `vp check` on all seven G7/G8 touched paths passed formatting, lint, and type
  checks. The requested unscoped `vp check` remains red only on pre-existing formatting in
  `src/routes/api/runs-export.ts`, four files under `src/runs/feedback` (`export.ts`, `staging.ts`,
  `tray.tsx`, `verbs.tsx`), and `src/runs/visual-law.json`; Pass 3 did not rewrite unrelated files.
- **Browser fixture:** `/takeoffs?source=fixture` rendered 45 zones. The deterministic fixture
  fallback had 179 room rows; the browser's real-geometry fixture had 180. Clicking the controlled
  `name` sort changed the leading values from `Bath, Bath, Bath` to
  `Study, Study, Study`. Ten row-hover transitions consumed 76.582 ms of script total and zero
  layout time with the inactive inspector off the path. Browser warnings/errors: zero.
- **Live lane:** not run. No Revit session or live Host was needed for G7/G8.

### Pass 3 left undone

- The repo-wide `vp check` formatting baseline above remains for its owning work; every Pass 3
  path is green.
- Atom inspection while its devtools panel is actively visible still intentionally polls the whole
  registry. Pass 3 removes that diagnostic cost from ordinary table interaction rather than
  redesigning the inspector protocol.

## Pass 4

Commit `ee8c1b4` completed G9 through G12 and resolved G14 with executable proof.

| Item | Status | Evidence |
| --- | --- | --- |
| G9 | **done** | `zoneKeyAtom`, `stageFilterAtom`, `fieldsModeAtom`, and `cursorAtom` are independent writable scalars; `atlasPageAtom` is their aggregate view. `atlasRowsAtom` reads only zone and stage, and `visibleRowsAtom` reads only fields mode. Q4 writes the cursor and asserts both row-array identities remain stable (`ts/apps/web/src/takeoff/store.test.ts:283`). |
| G10 | **done** | The store's `owned` helper mounts auto-disposable atoms for the store lifetime, and `dispose()` releases those mounts. The private `Atom.context` layer atom is also made disposable (`ts/apps/web/src/takeoff/store.ts:398`, `:413`, `:1285`). Q1 creates and disposes four stores on one registry; after each idle TTL the node count equals the zero-node baseline (`store.test.ts:302`). |
| G11 | **done** | `ATLAS_COLUMN_SEMANTICS` is the one exported sort/facet table. Both the store projection and every Atlas column consume it (`ts/apps/web/src/takeoff/store.ts:328`; `ts/apps/web/src/takeoff/atlas.tsx:518`). The vocabulary-only fallback was not needed. |
| G12 | **done** | ADR 0009 now records the G10 mount-release-TTL mechanism and the eager `RegistryContext` default-registry footgun. |
| G13 | **measured** | Ten warmed cursor switches with TanStack devtools closed consumed 3,095.683 ms of script, 57.848 ms of layout, and 4,763.274 ms of task time. The active row changed between Bath and Study, and the console had zero warnings/errors. G9 removed store row derivation from this path, but the React table still renders expensively on cursor changes. |
| G14 | **resolved** | G1 is covered by the nested Manual J conflict regression (`store.test.ts:325`). G2 is covered by the adopt test that asserts a second candidates read (`:347`). G3 now has `retryRhvac()` and a failed-open recovery test (`:461`); the route's retry verb calls that action. The Pass 2 report was correct. The judge was correct that Pass 3 did not touch G1-G3, but wrong that they remained open at HEAD. |

### Pass 4 proof

- **Deterministic:** `vp test src/takeoff src/targeting src/state src/components/master-table`
  from `apps/web` passed 5 files and 51 tests.
- **Compile/static:** `vp check` on the four touched TypeScript/TSX paths passed formatting, lint,
  and type checks.
- **Browser fixture:** the HTTP-backed real-geometry fixture rendered 45 zones and 180 rows. This
  is not the judge's Q3 count: Node cannot fetch the relative `/rhvac-fixture` URL, so
  `createFixtureTakeoffHost` falls back to `mockWorld()` with 179 rows in deterministic tests. The
  Pass 3 browser count of 180 was therefore correct; the report now states both fixture variants
  instead of replacing current browser evidence with Q3's fallback count.
- **Live lane:** not run. No Revit session or live Host was needed.

### Pass 4 left undone

- Cursor writes no longer rebuild or re-sort row data, but the browser measurement shows that
  repainting the 180-row table on cursor changes remains expensive. Fixing that needs a separate
  row-render subscription or memoization pass.
- The browser real-geometry fixture and deterministic fallback have different room counts, 180 and
  179. A single fixture data lane would remove that proof ambiguity, but changing the fixture's
  real-geometry behavior was outside G9-G14.

## Pass 5

Commit `40768fe` completed G15 through G19.

| Item | Status | Evidence |
| --- | --- | --- |
| G15 | **done** | Decisions and staged edits are single record atoms; per-room decided/staged atoms are projections rather than writable family authorities. Hovered, selected, bound, decided, staged, and entity family members enter the store's `owned` release list when materialized. The four-cycle G10 test now calls both `decide()` and `patchRoom()` before disposal; it failed first with 375 surviving nodes and now returns to the zero-node baseline after every TTL (`ts/apps/web/src/takeoff/store.test.ts:302`). |
| G16 | **done** | `MasterRow` is memoized, row callbacks and `cellsFor` are stable, and Atlas supplies stable row key, gutter, table-state, click, and hover callbacks. The jsdom regression counts cell renders across an `activeKey` change and requires at most two rows (`ts/apps/web/src/components/master-table/master-table.test.tsx:144`). |
| G17 | **done** | Atlas subscribes directly to stage filter, zone key, level, cursor, and fields mode. It never reads `store.atoms.atlasPage`; the aggregate remains only the sentence/inspection view (`ts/apps/web/src/takeoff/atlas.tsx:417`). |
| G18 | **done** | `match` is optional column semantics, and the flags column's one predicate is consumed by both Atlas and `visibleRowsAtom` (`ts/apps/web/src/takeoff/store.ts:323`). |
| G19 | **done** | Both fixture lanes now contain 180 rooms. The real-geometry browser fixture is unchanged; the deterministic synthetic fallback receives one stable parity room. This retains an offline fixture fallback while removing the review-ambiguous 179/180 split (`ts/apps/web/src/takeoff/proto/mock.ts:219`). |

### Pass 5 proof

- **Deterministic:** `vp test src/takeoff src/targeting src/state src/components/master-table`
  from `apps/web` passed 5 files and 52 tests.
- **Compile/static:** `vp check` on the six touched TypeScript/TSX paths passed formatting, lint,
  and type checks.
- **Browser fixture:** `/takeoffs?source=fixture` rendered 45 zones and 180 rows. Around ten
  sequential `j` cursor switches, CDP Performance metrics reported 41.612 ms script, 306.729 ms
  task, and 44.759 ms layout; wall time was 748 ms including browser-input transport. Ten
  alternating row hovers reported 47.988 ms script, 323.981 ms task, and 0 ms layout. The cursor
  script cost is 98.7% below Pass 4's 3,095.683 ms measurement.
- **Live lane:** not run. No Revit session or live Host was needed.

### Pass 5 left undone

Nothing remains from G15-G19. Live Host/Revit behavior remains outside this cutover's deterministic
and fixture-browser proof lanes.

## Pass 6

The merge gate removed the stale family `onVisibleChange` prop. Family was not using visible order
for keyboard or select-visible behavior: it only stored the first visible ghost key to draw a
section hairline. A 33-line component-local derivation now reads the family-owned `tableState`,
rows, and columns directly. The requested Ponytail marker and owed G7 entry are in
`docs/features/design-system/LEDGER.md`; no `MasterTable` write-back was restored.

### Full check result

Unscoped `vp check` from `ts` remains red on exactly six pre-existing formatting
files:

```text
apps/web/src/routes/api/runs-export.ts
apps/web/src/runs/feedback/export.ts
apps/web/src/runs/feedback/staging.ts
apps/web/src/runs/feedback/tray.tsx
apps/web/src/runs/feedback/verbs.tsx
apps/web/src/runs/visual-law.json
Found formatting issues in 6 files (4363ms, 24 threads). Run `vp check --fix` to fix them.
vp check exit code: 1
```

None of those six paths differs from `takeoff-frontier`. Checking every branch-changed web source
path separately passed all 20 files with zero formatting, warning, lint, or type errors. The
requested focused `vp check apps/web/src/family/workspace.tsx` also passed.

### Non-cutover branch inventory

This is the complete `git diff --stat takeoff-frontier..HEAD` inventory outside
takeoffs/targeting/MasterTable/state/devtools. It is recorded only; nothing was split or reverted.

| Area | Diff | Inventory |
| --- | ---: | --- |
| `.agents/skills/**`, `.claude/skills/**` | 17 paths, +121/-616 | Namespace migration to `my.*`, cross-tree execute moves, new `my.concisify` and `my.delegate`, and deletion of superseded delegate/execute/Demiurge files. Git reports nine renames, six deletions, and two additions. |
| `docs/loop/*` | 5 new files, +515/-0 | `RIG.md`, `p-builder.md`, `p-eyes.md`, `p-idea.md`, and `p-sdkfix.md`. |
| `docs/features/host/LEDGER.md` | binary, 26,793 -> 28,233 bytes | Modified binary rewrite; Git cannot provide a text line diff. |

### Pass 6 proof

- **Deterministic:** `vp test src/takeoff src/targeting src/state src/components/master-table src/family`
  passed 13 files and 156 tests.
- **Static:** all 20 branch-changed web source paths passed `vp check`; the unscoped result is the
  six-file pre-existing formatting baseline listed above.
- **Left undone:** the family route's full G7 store cutover remains explicitly owed. The six
  unrelated formatting files remain for their owning Runs work.
