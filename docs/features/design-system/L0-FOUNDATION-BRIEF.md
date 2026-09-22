# L0 · shared surface foundation — implementation brief

Authority: `docs/features/design-system/UNIFICATION-SURFACE.md` rounds 3b–3f (surface partner) and the user rulings of 2026-09-16 recorded there. Root authorized implementation of this settled shape; there is no further approval gate for what is written here. Anything not written here is not in L0.

## Lane identity

- Worktree: `C:/Users/kaitp/source/repos/Pe.Tools-l0-surface`, branch `l0/surface-foundation`, cut from `527048f` (main). One writer. Do not touch any other checkout.
- Package: `source/pe-tools/apps/web`. Run guards from `source/pe-tools`: `vp run @pe/repo-guards#test`; web tests: `vp run @pe/web#test` (or `pnpm exec vitest` in `apps/web`).
- Read first: `apps/web/AGENTS.md`, `docs/features/design-system/LEDGER.md` (Decided 2026-08-31 pane/scrollbar/density rulings), `.claude/skills/lens.house/SKILL.md`, `.claude/skills/slot.docs/SKILL.md`. House law 10: import the instrument, never redraw it; every new mark ships with its swatch specimen in the same commit.
- Ponytail applies: shortest working diff; delete more than you add where this brief says delete; no abstractions beyond the five named below.

## Files you may write (allowlist; nothing else)

`apps/web/src/base.css` · `components/lang/rail.tsx` (new) · `components/lang/surface.tsx` (new) · `components/lang/pane.tsx` · `components/lang/pane-resize.tsx` · `components/lang/pane-workspace.tsx` · `components/lang/artifact-frame.tsx` · `components/lang/code.tsx` · `components/lang/section.tsx` · `components/master-table/master-table.tsx` · `components/master-table/master-table-header.tsx` (only if the facet trigger must fit the rail) · `route/help.tsx` · `design-system/specimens/ui-layout.tsx` · `design-system/specimens/ui-surfaces.tsx` (Rail specimen may live here) · `components/lang/pane.test.tsx` · `components/master-table/master-table.test.tsx` · `components/lang/code.test.tsx` · `tests/repo-guards/src/design-guard.test.ts` (register new CSS roles only) · `docs/features/design-system/LEDGER.md` (Decided lines for what lands).

Not yours: `chat/**`, `workbench/**`, `takeoff/**`, `family/**`, `families/**`, `routes/**` (except nothing), `route/use-route.ts`, `side-pane.tsx` (leave untouched), `anatomy/workspace.tsx` (leave untouched). Consumers are moved by later lanes. **No compatibility adapters**: do not write a shim for `SidePane` or `PaneSplit`; if a signature you change breaks a consumer you may not edit, stop and report the exact break instead of adapting.

## Tokens (`base.css`, beside `--item-h`/`--control-h`)

```css
--gutter: 8px;      /* perimeter and inter-pane track */
--halo: 6px;        /* focus outline width, drawn in the gutter */
--rail-h: 24px;     /* every head band; equal to --control-h today, kept separate */
--halo-ink: var(--pe-line-2);   /* provisional; colour tuning is open and changes this line only */
```

## 1 · `Rail` (`components/lang/rail.tsx`, new, ≈40 lines)

```ts
export function Rail({ ground = "page", lead, trail }: {
  ground?: "page" | "recess";
  lead: ReactNode;      // truncates; title/meta/help or a sentence
  trail?: ReactNode;    // shrink-0; controls, wrapped in ActionChrome (a verb's refusal is a title here)
}): JSX.Element
```

One row, `h-(--rail-h)`, `flex items-center gap-2 px-2`, `hairline-b`, `data-slot="rail"`, `data-surface={ground}` (page or recess via the existing `on-recess` plumbing in `lang.css`). No other props, no variants. Specimen: both grounds, lead-only and lead+trail.

Consumers converted in L0 (each keeps its own typed props; `Rail` is geometry only):

| Consumer | `lead` | `trail` | ground |
|---|---|---|---|
| `Pane` head (`pane.tsx:193-221`) | `title` (`h2 t-small t-upper`), `meta` (mono, truncating, native title), `help` (`HelpTip`) | `actions` | page, or `headerSurface` |
| `ArtifactFrame.head` (`artifact-frame.tsx:29`) | caller's node | — | recess |
| `ArtifactFrame.foot` (`artifact-frame.tsx:30`) | caller's node | — (callers place their commit verb inside the node today; leave it) | recess |
| `Code` head (`code.tsx` head band) | language / `title` | copy · line count · show all · render/source toggle | recess |
| `Section` head (`section.tsx:22-24`) | `label`, `help` | `aside` | page |
| `MasterTable` (see §4) | `scopeLabel` · `summary` | search `Input` · `modes` · `actions` | recess |

Do not add a rail to `SidePane` (it is being deleted by a later lane).

## 2 · `Pane` (`pane.tsx`, changed in place)

- Head becomes `<Rail ground={headerSurface ?? "page"} lead={…} trail={actions}>`; the `hasHeader` rule and `data-slot="pane-header"` stay (help.tsx reads the `h2`). Keep `headerSurface` as the prop name.
- Halo: delete the `pane-halo` span and `z-raised`. On the `section`: `outline: var(--halo) solid var(--halo-ink); outline-offset: 0;` when `data-active=true`, `outline-color: transparent` otherwise, with the existing `transition` on `outline-color` (`motion-reduce` respected). `pane-workspace.tsx`: delete the four `has-[[data-slot=pane][data-active=true]]:overflow-visible` toggles (`:77,101,109,161`) and change the 1 px cell borders to gutter tracks: the template's 8 px handle tracks become `var(--gutter)` whether or not a handle is present (the halo needs the track).
- `kind` gains `"flank"`: props `collapsed?: boolean; onCollapsedChange?: (c: boolean) => void`. Collapsed renders `w-10` (40 px) with: an expand `Press size="icon"` (`ChevronRight`/`ChevronLeft` by a `side?: "left" | "right"` prop, default left), the `title` in `[writing-mode:vertical-rl]` `t-small t-upper`, and **no body**. Shortcuts stay registered while collapsed (same `region`). The rail-side border is not drawn; the gutter separates.
- Boundary: wrap `children` in `<Suspense fallback={<PaneLoading what={title} />}>` inside a small error boundary class (`PaneErrorBoundary`, ≈25 lines, `getDerivedStateFromError`, reset on `retry`). `PaneLoading`: `role="status" aria-live="polite"`, centred `t-small t-upper text-ink-mute`, text `loading {what}…` (falls back to `loading…`). `PaneError`: `role="alert"`, first line `t-small t-upper` with `data-tone="alarm"`: `{what} failed to load`; second line the error message in `text-ink-2`; a `Press frame="line" size="value"` `retry` that resets the boundary and calls `onRetry?.()`. Props added: `boundary?: boolean` (default true), `onRetry?: () => void`. Empty is not a pane state; consumers render `EmptyState` themselves.
- Everything else (`shortcuts`, card, `toolbar`, `scroll`, `data-slot="pane"`, `tabIndex`, focus capture) unchanged.

Tests to add in `pane.test.tsx`: head height is `var(--rail-h)` (assert the `Rail` element exists under `[data-slot=pane-header]`); no `[data-slot=pane-halo]` in the DOM; `kind="flank" collapsed` renders the title text and still registers its hotkeys (reuse the existing registration assertion pattern) and renders no body; a child that suspends shows `loading <title>…`; a child that throws shows `<title> failed to load` and `retry` calls `onRetry`; `boundary={false}` renders neither.

## 3 · `Surface` and `SurfaceHandle` (`components/lang/surface.tsx`, new, ≈80 lines)

```ts
export function Surface({ head, columns, rows = "minmax(0,1fr)", children }: {
  head?: ReactNode;          // the Situation; present ⇒ scroll-away shell (2026-08-31 ruling)
  columns: string;           // grid-template-columns; gutter tracks are `var(--gutter)`
  rows?: string;             // grid-template-rows
  children: ReactNode;       // grid cells; the caller sets gridColumn/gridRow via style or class
}): JSX.Element
```

- Without `head`: `<div data-slot="surface" data-surface="page" className="fixed inset-0 grid" style={{padding:"var(--gutter)", columnGap:0, rowGap:0, gridTemplateColumns, gridTemplateRows}}>`; gutter tracks are explicit in `columns` (callers write `288px var(--gutter) minmax(0,1fr)`), not `gap`, so a handle can occupy one.
- With `head`: `<main className="no-scrollbar h-dvh overflow-y-auto">{head}<div className="sticky top-0 h-dvh grid …same…">{children}</div></main>` — this is `anatomy/workspace.tsx:35-37` moved here; the readout band is not part of `Surface` (callers put it in `head` or in a cell).
- Every direct child is wrapped by `Surface` in `<div className="min-h-0 min-w-0 flex flex-col">` **only if** the child is not already a `SurfaceHandle`; simpler and acceptable: export `SurfaceCell` (`div min-h-0 min-w-0 flex flex-col`, forwards `style`) and require callers to use it. Choose the second; document it in the doc comment. Rule: a `pre` inside a flex column with `min-width:auto` widens the grid (proven in the lineup), so cells must be `min-w-0`.
- `SurfaceHandle`: `PaneResizeHandle` from `pane-resize.tsx` with its root sized `w-(--gutter)`/`h-(--gutter)` instead of `w-2`/`h-2`; export it from `surface.tsx` as `SurfaceHandle`; keep `PaneResizeHandle`'s name and keyboard/reset behaviour. `usePaneSize`/`usePaneFit` unchanged.
- Specimen in `ui-layout.tsx`: `Surface` with 2, 3 and 4 cells (one with a `SurfaceHandle` in a gutter track) and one with `head`.

## 4 · `MasterTable` one header (`master-table.tsx`)

- Delete the strip at `master-table.tsx:176-231` (scope label, search input, summary, chips, "clear all").
- `MasterTable` renders its own `ArtifactFrame` whose `head` is a `Rail ground="recess"`: `lead` = `scopeLabel` (`t-small t-upper`) then `summary` (mono `text-ink-2`); `trail` = the search `Input` (same behaviour and placeholder), then `modes?: ReactNode`, then `actions?: ReactNode` (new props, both optional). `foot` = the caller's existing `foot?: ReactNode` if you add one — **do not**; keep foot out of L0.
- New prop `filters?: ReactNode`. Rendered as one wrapping row `hairline-b px-2 py-1` directly under the rail, containing: the caller's `filters` node, then the existing `chips` (`NarrowChip`s) and the existing "clear all" press, only when any of them exist. Empty when none.
- `CellStateKey` and any other trailing child stay where the caller puts them (below the table, inside the frame).
- `master-table.test.tsx`: one `[data-slot=rail]` per table; `filters` row absent when nothing narrows and present with a chip; search still narrows rows; `modes`/`actions` render in the rail trail.
- Do not change column facet triggers (`master-table-header.tsx`) unless their height breaks the row law; if so, only the trigger's height.

## 5 · `Code`, `Section`, `ArtifactFrame`

- `Code`: head band → `Rail ground="recess"` with the same left/right content; keep every existing test in `code.test.tsx` green; the head is `--rail-h` now (was ~22 px).
- `Section`: head → `Rail ground="page"` with `label`+`help` lead and `aside` trail; keep `Provenance` unchanged; `sectionRecipe.head` deleted.
- `ArtifactFrame`: `head`/`foot` slots → `Rail ground="recess"` with the caller's node as `lead`; `artifactFrameRecipe.head/foot` classes deleted.

## 6 · `help.tsx`

`measureRegions` already reads every `[data-slot="pane"]`. Add nothing except: a collapsed flank has no `h2` under `pane-header`; use the vertical title's text (give it `data-slot="pane-title"` and read that first). No other change; tiers, leaders and cards stay.

## 7 · Ledger and guard

- Add to `LEDGER.md` Decided (one line each, dated 2026-09-16): the tokens; `Rail` as the one head band; halo as an outline in the gutter; flank kind; pane boundary; `Surface`; one table header with optional filter row. Add one Tried & rejected line: overlay composer (B) rejected for the z-level defect; enclosure-everywhere (C) rejected for panes.
- Register `rail` / `surface` in `design-guard.test.ts` loader/authoring lists if the guard requires it for new `lang/` files (it does for CSS roles; check `AUTHORING`). Baselines must not rise.

## Commits (five, in this order, each green on its own tests)

1. tokens + `Rail` + `Code`/`Section`/`ArtifactFrame` on `Rail` + specimen + ledger lines.
2. `Pane` head on `Rail`; halo outline; `pane-workspace` gutter tracks and toggle deletion; tests.
3. `Pane` flank + boundary (`PaneLoading`, `PaneError`, `PaneErrorBoundary`); tests; specimen.
4. `Surface`, `SurfaceCell`, `SurfaceHandle`; specimen.
5. `MasterTable` one header + `filters`; tests; specimen row in `integration-table.tsx` may drop its own `ArtifactFrame` wrapper (it is a specimen, allowed).

## Acceptance (deterministic; a browser pass is root's)

- `vp run @pe/repo-guards#test`: no new reds; baselines equal or lower.
- `apps/web` tests: all existing green; the new assertions above green.
- Whole-repo `tsc` is expected green because no exported signature consumed outside this allowlist changes (`Pane` props only grow; `PaneResizeHandle`, `PaneSplit`, `SidePane`, `PaneWorkspace` exports remain). If it is not, report the exact error list and stop; do not adapt.
- Report: `docs/features/design-system/L0-REPORT.md` in the L0 worktree: what landed per commit, LOC +/−, test names added, any deviation from this brief with its reason, and the exact list of consumers a later lane must touch (grep evidence for `headerSurface`, `PaneSplit`, `SidePane`, `Workspace`).

## Out of scope, do not do

Consumers (`chat/`, `takeoff/`, `family/`, `routes/`); `SidePane`/`PaneSplit` deletion; `Pane.foot`; a narrow breakpoint; any `Reading`/`AsyncResult` work; `useRoute`/stores; colour tuning beyond the one `--halo-ink` line; the prototype route (`routes/prototype-root.tsx` exists only in the `unify-surface` worktree and must not be copied).
