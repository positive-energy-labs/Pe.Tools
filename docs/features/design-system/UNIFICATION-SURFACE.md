# Unification review, surface partner — 2026-09-16

Checkout `Pe.Tools-unify-surface` at `527048f`, clean. Herdr session `unify-surface`. Paths are under `source/pe-tools/apps/web/src/` unless rooted. Read-only; no production change. Proof lane for every line below: **source read at `527048f`** unless marked `browser`. No Chrome measurement was taken in this round; the runtime partner owns the benchmark tab.

## Restatement

The user wants one root-level anatomy: a viewport root that owns perimeter and inter-pane gutters, panes whose halo and resize handle live in those gutters, one default rail height for heads (and foot rails where state needs one), one identity rule for artifact versus pane versus table and how they nest, one idiom for modes/tabs/search/filter/presets/actions and key legends, and a tutorial that measures every region including Chat's. Chat keeps its head on the composer at one height by default; the sidebar projects the route's thread selection. Everything else is open.

## Census — who owns a region today

### Container owners

| Owner | File (LOC) | Consumers (non-test, non-swatch) | What it owns |
|---|---|---|---|
| `Pane` | `components/lang/pane.tsx` (306) | 11 sites: `family/workspace-{anatomy:21,doc-pane:280,table:205}.tsx`, `routes/grilles.tsx:84,113,145`, `runs/browser/view.tsx:328`, `takeoff/atlas-{navigation:28,table:48,visual:38}.tsx`, `takeoff/room-panel.tsx:52` | header `h-8` (32px, `pane.tsx:197`); halo `absolute -inset-1 border-[3px]` drawn **outside** the box (`pane.tsx:189`); `z-raised` when active (`pane.tsx:183`); body inset only for `inspector` (`p-2`, `pane.tsx:41`); pane-tier hotkeys + portal shortcut card (`pane.tsx:235-298`); `data-surface` = artifact only for `visual` (`pane.tsx:172`) |
| `PaneWorkspace` | `components/lang/pane-workspace.tsx` (168) | `anatomy/workspace.tsx:48`, `routes/grilles.tsx:188` | grid `nav | 8 | 1fr | 8 | inspector` over `visual | 8 | content` (`pane-workspace.tsx:63-64`); 1px `border-r`/`border-l` between cells (`:77,109`); **no perimeter**; each cell flips `overflow-hidden → overflow-visible` while a child pane is active so the outside halo is not clipped (`:77,101,109,161`) |
| `PaneSplit` + `PaneResizeHandle` | `components/lang/pane-resize.tsx` (333) | `runs/browser/view.tsx` ×2, `takeoff/atlas-table.tsx:48` | 8px track (`w-2`), hairline bar, keyboard + reset, `usePaneSize` with localStorage persist (`pane-resize.tsx:64-110,168-176`) |
| `SidePane` | `components/lang/side-pane.tsx` (172) | `chat/chat-shell.tsx:211`, `workbench/lens/view.tsx:145`, `routes/data-tables.tsx:191`, `routes/parameter-links.tsx:368`, `schedule-grid/workspace.tsx:187` | header `h-10` (40px, `side-pane.tsx:153`); 5px pointer-only handle overhanging its border (`:45-46,163-169`); 40px collapsed rail (`:57`); own localStorage width (`:84-87`); `data-surface="page"`; **no** `data-slot="pane"`, no halo, no shortcuts, no help |
| `Workspace` (anatomy) | `components/anatomy/workspace.tsx` (60) | `families/workspace-view.tsx:119`, `family/workspace-view.tsx:178`, `ops/workspace.tsx:118`, `takeoff/atlas-workspace.tsx:16` | `main h-screen overflow-y-auto no-scrollbar` with the head rail in scroll flow and a `sticky top-0 h-screen` work block (`workspace.tsx:35-37`, ruled 2026-08-31); readout band `px-2 py-1.5` (`:41`); ops adds `p-4` on top (`ops/workspace.tsx:119`) |
| hand-rolled `<main>` | 11 routes | `routes/settings.tsx:130` (`px-3 py-1.5`), `routes/data-tables.tsx:158` (`p-3`), `routes/parameter-links.tsx:228` (`px-5 py-4`, sidebar `px-4 py-3`), `schedule-grid/workspace.tsx:117` (`px-3`), `routes/doc-lab.tsx:44` (`px-4`), `routes/family-editor-proto.tsx:33` (`px-3`), `param-tables/…/view.tsx:240`, `routes/index.tsx:175` (`min-h-screen px-6`), `takeoff/saved-review.tsx:59` (`min-h-screen px-6 py-4`), `instances/workspace.tsx:53-61` (`min-h-screen`, `px-6`), `routes/lab.tsx:41` (`p-4`) | each its own viewport law and gutter |
| Chat | `chat/chat-shell.tsx:154-165` | — | `main fixed inset-0` → `div h-full px-5` → `RouteShell` (empty `situation`) → Lens CSS grid `auto | 1fr | 64px` (`workbench/lens.css:56-58`) whose col 1 is a `SidePane` (`lens/view.tsx:144-197`); composer `absolute inset-x-0 bottom-0` over the transcript with `.pe-composer-lane { margin-left: var(--side,300px); margin-right: var(--map,64px); padding: 0 20px }` (`lens.css:74-79`); transcript padded by `--composer-h` (`chat-shell.tsx:110-119`, `lens.css:265-266`); plugin workspace is a second right `SidePane` with `minWidth 480` (`chat-shell.tsx:210-235`) |

Perimeter gutter values in the wild: 0 (PaneWorkspace), 8 (readout band), 12 (`px-3`), 16 (`p-4`), 20 (`px-5`, lens lane), 24 (`px-6`). Inter-pane: 1px border (PaneWorkspace, SidePane), 8px track (handles), 20+20 (lens lane vs chat column).

### Head bands (rails)

| Rail | Height | Title tier | Where |
|---|---|---|---|
| `Pane` header | 32 (`h-8`) | `h2 t-small t-upper` + mono meta + `HelpTip` + `ActionChrome` | `pane.tsx:193-221` |
| `SidePane` header | 40 (`h-10`) | free slot after a chevron `Press` | `side-pane.tsx:153-158` |
| `ArtifactFrame` head | ~22 (`py-[5px]` + `t-small`) | free, on recess ground | `artifact-frame.tsx:29` |
| `Situation` name line | ArtifactFrame head holding `h1 t-head` (24px type) → ~34 | `situation.tsx:640-658` |
| `Section` head | type + `pb-[3px]` hairline | `h2 t-small t-upper` | `section.tsx:22-24` |
| `Code` head band | ArtifactFrame-shaped | language + copy/count | ledger 2026-09-15 |
| Composer head | free (`pt-2 pb-1`), grows with the proposals band | `p t-prose` "Pea on …" | `composer-head.tsx:130-163,192-252` |
| Chat sidebar head | `SidePane` header holding `ModeDial` | `Switcher` at `--item-h` | `chat-shell.tsx:176` |

There is no rail-height token; `--item-h` (20) and `--control-h` (24) are ruled for rows and controls only (`base.css:49-50`, ledger 2026-08-31 "TWO HEIGHTS").

### Foot rails / state bands

`ArtifactFrame.foot` (`actions/receipt.tsx:71`, `param-tables/…/view.tsx:346`), `Workspace.readoutBand` (4 routes, above the work block, not below), `ThreadList` foot with New/Search (`thread-palette.tsx:135-158`), composer control row (`composer.tsx:271-297`), Situation Work band and unresolved band (`situation.tsx:685-748`), takeoff `zone-state-bar.tsx`, runs `ledger-dock.tsx`. No shared foot contract; `Pane` has no foot slot.

### Modes, tabs, search, filter, presets, actions

- Modes: `Switcher` is the one exclusive switch, 7 sites (`chat/mode-dial.tsx:9`, `family/doc-pane.tsx:120`, `family/workspace-doc-pane.tsx:300`, `family/workspace-meta-control.tsx:18`, `family/workspace-table.tsx:257`, `param-tables/…/view.tsx:320`, `workbench/world/lane.tsx:90`). Chat's mode also lives in `?mode` (`routes/chat.tsx:33-36`, `use-mode.ts`) and Mod+1..3 (`chat-shell.tsx:135-145`).
- Tabs: none as a primitive; `role="tablist"` appears nowhere; the state-gauge popover is owed "tabs or a drawer" (ledger Owed, round 3).
- Search: `Picker` search past six options (`picker.tsx:145`), `CommandDialog` palette for threads (`thread-palette.tsx:185`), `MasterTable` header facet. Three inputs, three looks.
- Filter/presets: `MasterTableState` is component-local, "invisible to the route, the URL, and any chat plugin" (ledger, Component repairs).
- Actions in a rail: `Pane.actions` under `ActionChrome` (reason as `title`), `Section.aside`, `Situation` verb row (`SituationAction`), `SidePane` header free slot, composer control row.

### Key legends

Five renderings of a key: pane shortcut card `kbd` (`pane.tsx:265-270`), help page `Key` (`help.tsx:58-69`), `ActionBoard` `kbd` (`situation.tsx:517`), `ThreadList`/`ThreadPalette` `kbd` (`thread-palette.tsx:155,204`), and `components/anatomy/key.tsx` which is a colour swatch legend, not a keyboard key (name collision). A route verb's hover shows `action.refusal ?? action.says` and **not** its chord (`situation.tsx:344`); the chord shows only in the vertical projection.

### Tutorial and Chat participation

`route/help.tsx:34-56` measures `[data-slot="pane"]` only and takes the frame from the nearest `main`/`[role=region]`. `SidePane` and the Lens lanes carry no `data-slot="pane"` (`side-pane.tsx`: 0 hits), so on `/chat` the help body renders "this route draws no panes to explain" (`help.tsx:229-232`) while the route's chords and Mod+K/Mod+1..3 still list in the band. Chat's regions (threads, transcript, dial, plugin workspace, composer) are invisible to the tutorial. The `RouteChatPluginDock` (`route-chat-plugins/tool-names.tsx:197`) renders live route reviews inside the transcript, also unmeasured.

### Composer Situation and thread selection

- `?thread` is validated at `routes/chat.tsx:31`, retained across navigations (`:48`), and re-keys `WorkbenchProvider` (`:64`).
- `Surface` reads `threads`, `currentThreadId`, `openThread`, `newThread`, `renameThread`, `deleteThread` from `useWorkbench()` and passes the same seven-prop bundle to `ThreadList` (`chat-shell.tsx:177-187`) and `ThreadPalette` (`:240-249`). The composer head prints the label by searching `threads` for `currentThreadId` (`composer-head.tsx:128`). The manifest is rebuilt per render with `thread: currentThreadId` (`chat-shell.tsx:56-76`).
- So selection is route-owned in the URL and provider today; the sidebar projects it by prop threading, not by reading the handle. `new`/`fork` are manifest verbs drawn in the composer control row (`composer.tsx:288-289`); `ThreadList` draws its own New button through a different path (`thread-palette.tsx:136-145`) — one verb, two buttons, two refusals.
- `ThreadEmpty` (`thread-palette.tsx:69-79`) has zero importers: dead.

## Findings

Reproduced = the source proves it; suspected = needs a browser or a run.

1. **Reproduced.** The composer lane's left margin is a constant. `.pe-composer-lane` reads `var(--side, 300px)` (`lens.css:75`) but nothing sets `--side` (repo-wide grep: only the comment at `side-pane.tsx:9` and `lens.css:54`), and `chat-shell.tsx:169-187` never passes `onSideResize`, so a resized or collapsed sidebar (40px rail) and the plugin mode leave the composer offset by 300px. `browser` measurement owed to confirm the visible offset.
2. **Reproduced.** The pane halo is drawn outside the pane box, so `PaneWorkspace` toggles `overflow-hidden ↔ overflow-visible` on the active cell (`pane-workspace.tsx:77,101,109,161`) and `Pane` raises `z-index` (`pane.tsx:183`). Halo ownership is a gutter problem solved with an overflow hack; a 3px halo also exceeds the 1px border it must sit over.
3. **Reproduced.** Chat's regions are invisible to the tutorial (`help.tsx:34-56` vs `side-pane.tsx` no `data-slot`), and every pane chord meta uses `region: id ?? kind` while the help chart labels by rendered `h2` text (`help.tsx:48-51`); a `SidePane` has neither.
4. **Reproduced.** Route verb hover never shows the chord (`situation.tsx:344`).
5. **Reproduced.** Two resize implementations with different hit sizes (8px keyboard track vs 5px pointer-only overhang) and two persistence paths (`usePaneSize.persist` vs `SidePane.storageKey`); already an Owed line since 2026-08-31 ("Resolve whether `SidePane` and `PaneSplit` remain two primitives"). Unresolved for 16 days across 47 commits: this is the systemic gap, not a local one.
6. **Reproduced.** Three viewport laws: scroll-away head + sticky `h-screen` block (`anatomy/workspace.tsx`), `h-screen overflow-hidden` mains (7 routes), `fixed inset-0` (Chat), plus `min-h-screen` document-flow pages (3). Only the first is ruled (2026-08-31); the others were never censused.
7. **Reproduced.** Three head-band lineages with three title tiers and three heights (32/40/~22) and no token. "One header height by default" cannot be authored today because no primitive owns the number.
8. **Suspected.** `Lens` fisheye math subtracts `HEAD_H` (40px, the `SidePane` header) (`lens/model.ts:216-219`, `lens/scale.ts`); any rail-height change moves the trace focal alignment. Needs a run.
9. **Reproduced.** Two New-thread buttons for one verb (`composer.tsx:288`, `thread-palette.tsx:136`); the sidebar one bypasses the handle's refusal.
10. **Reproduced.** `window.prompt` for rename (`thread-palette.tsx:45`): a native modal that blocks the tab and the browser automation lane.
11. **Reproduced.** `routes/chat.tsx:28` still validates `?variant=A|B|C` (protoui leftover) and `settingsFile`/`familyFile` search params; `ThreadEmpty` dead.
12. **Reproduced.** `components/anatomy/key.tsx` is a colour legend named `Key`; `help.tsx` defines a private `Key` for keyboard keys. One name, two marks (house law 1).
13. **Reproduced.** `annotation.tsx` carries the Lens' own 28-variant layout grammar (ledger Owed since 2026-08-29, uncensused). The Lens grid is a fourth container owner in CSS, not in the kit.

## Systemic causes

- **No root.** Nothing owns the viewport, the perimeter, or "child fills me". Every route re-derives `h-screen + min-h-0 + flex-1 + overflow` and picks a gutter. `RouteShell` is a region with `gap-2` and a flex column (`shell.tsx:210-229`); it is not a root.
- **Two pane lineages never reconciled.** `Pane`/`PaneWorkspace`/`PaneSplit` came from the takeoffs spike (created 2026-08-29); `SidePane` came from Chat the same day. The 2026-08-31 Owed line named it; 47 commits since touched Chat's containers 20+ times without touching the primitives.
- **Halo outside the box** forces overflow and z-index hacks because there is no gutter to draw it in. The user's "halo fits in the gutter" is the direct fix.
- **"Head" has no primitive.** `Pane`, `SidePane`, `ArtifactFrame`, `Section`, `Situation`, `Code`, and the composer each invent a band; the only shared piece is the `t-small t-upper` word.
- **Chat is layered, not composed**: fixed main → padded div → shell → Lens grid → absolute composer, coupled by CSS vars (`--side`, `--map`, `--vp`, `--composer-h`) that drifted (finding 1). The Lens cannot be a consumer of a shared root until the composer is in flow or the root exposes the gutter geometry it floats in.

## Candidate shapes

Same light: each is stated as what the root owns, what a pane owns, where Chat's five regions land, and the condition under which it fails. None is chosen.

### S1 — Gutter grid: one root, one pane, gutters own halo and handle

- Root (`Surface`): viewport height, perimeter gutter `G` (8px provisional), CSS grid with `G` tracks between children. Children fill; no child sets height.
- Pane: the only region primitive. `SidePane` folds into `Pane` as `kind="flank"` with collapse-to-rail; `PaneSplit` dies, its handle becomes the gutter track itself (draggable, keyboard, `usePaneSize` persist). Halo = `outline` of width ≤ `G` on the pane box (6px provisional), so no overflow toggling and no z-index.
- Rail: one `--rail-h` for every head (candidate 24 = `--control-h`, or 32 as `Pane` has). `head` defaults to the title alone; `head={false}` opts out. Foot is a mirrored slot with the same height.
- Chat: `Surface` with panes `threads (flank) | transcript | dial | plugin (flank)`; the composer is the transcript pane's **foot** (in flow, variable height), so `--composer-h` padding and `.pe-composer-lane` margins die. The Lens keeps its focal math inside the transcript pane; `--vp` becomes the pane body height.
- Fails when: the composer must float over the scrim with content under it (today's look); the fisheye's `HEAD_H` coupling; a route needs a two-axis nest (`PaneWorkspace` visual-over-content) — the grid must nest one level, which is fine for CSS grid but is a second layout in the root.

### S2 — Lanes and rails: keep the Lens grid, promote it

- Root: `Lane` (a column) and `Rail` (a head or foot band) are the two primitives; `Pane` becomes `Lane` + optional `Rail`. Gutters are lane gaps; halo is the lane's outline; handles are lane edges.
- Chat: already lanes (`sidebar | chat | mapdial`); the composer stays a floating rail over the chat lane but the root, not `lens.css`, computes its inset from lane geometry (fixes finding 1 by ownership).
- Fails when: a route needs a row split inside a column (takeoffs visual-over-content, grilles): lanes are one-axis; nesting a lane group inside a lane reintroduces `PaneWorkspace` under another name. Also keeps the composer as an overlay, so tail padding coupling survives.

### S3 — Everything is an artifact (overreach, kept on purpose)

- No page-ground panes. Every region is an `ArtifactFrame` (head band, body, foot band) sitting on page ground; the gutter is the page ground showing between frames, which is the fill-separates-not-lines ruling taken to the root. Halo = the frame's ring lighting; the resize handle = the gutter between two frames, draggable.
- Chat: thread list, transcript, dial, plugin workspace, and composer are five artifacts; the composer's head band **is** the Situation and its foot band is the control row; the sidebar list's head band is the mode dial.
- Fails when: the border budget ("plain content is never enclosed", `artifact-frame.tsx:11-17`) — a navigation list and a transcript are plain content; every frame spent there makes the real ones read less special. Dark-mode ground contrast between page and artifact is thin. Cost: every route reclassifies its ground.

### Dominance

S3 is dominated on the border-budget law unless the user overturns it. S1 and S2 trade: S1 unifies the two-axis routes and puts the composer in flow; S2 preserves Chat's current look and floating composer at the cost of keeping a second layout system for two-axis routes.

## Retired-owner and LOC opportunities (under S1)

| Retire | LOC | Replaced by |
|---|---|---|
| `side-pane.tsx` | 172 | `Pane kind="flank"` |
| `PaneSplit` half of `pane-resize.tsx` | ~90 | gutter handle in root |
| `anatomy/workspace.tsx` | 60 | root |
| 11 hand-rolled `<main>` roots + inner scrollers | ~150 | root |
| `.pe-composer-lane`, `--side`/`--map`/`--composer-h` plumbing (`lens.css:71-79,262-266`, `chat-shell.tsx:106-119`) | ~40 | composer as pane foot |
| `ThreadEmpty`, `?variant`, second New button | ~30 | delete |
| `PaneWorkspace` overflow toggles | 4 lines, but the hack | halo inside gutter |

Roughly 500 LOC down before the route bodies are touched; `Pane` grows ~60 (flank, foot, rail token).

## Decision questions for the user

1. **Pane identity.** Is a pane page ground with a hairline (S1/S2) or an artifact frame (S3)? This decides whether a table inside a pane is a frame inside ground (today) or a frame inside a frame.
2. **Gutter and halo.** One `--gutter` (8) for perimeter and between panes, halo as an outline ≤ gutter (6) on the pane box, resize handle = the gutter track. Confirm, or keep the halo outside the box.
3. **Rail height.** One `--rail-h` for every head: 24 (matches `--control-h`) or 32 (today's `Pane`)? Does the composer head count as a rail at that height with the proposals band as a second rail below it?
4. **Fold direction.** `SidePane` dies into `Pane` (recommended: `Pane` has hotkeys, help, halo, tutorial identity) or `Pane` gains nothing and `SidePane` stays a second primitive.
5. **Composer placement.** In flow as the transcript pane's foot (S1), or floating over the transcript with root-computed insets (S2)? In flow deletes the `--composer-h` and lane plumbing; floating keeps the scrim look.
6. **Chat sidebar head.** Mode dial stays the sidebar's head rail, or mode moves beside the thread word in the composer sentence? Threads are route state; mode is a view depth.
7. **Thread selection projection.** Sidebar list and palette read `handle` (thread as a Situation slot with a `Picker` ladder) instead of a seven-prop bundle; the sidebar's New button becomes the same `new` verb. Confirm the head as the one writer.
8. **Modes and tabs.** `Switcher` in a rail is the one tab idiom; no `Tabs` primitive. Confirm, and rule the state-gauge popover's owed tabs the same way.
9. **Key legend.** One `Kbd` mark for all five sites; rename `anatomy/key.tsx` (colour legend) to `Swatch` or `LegendKey`. Verb hover shows the chord as a trailing `Kbd` in the title, or as a visible `Kbd` child on the button?
10. **Tutorial reach.** Every root child is a `[data-slot="pane"]` region with a title, including Chat's five; the help chart labels by title. Should the composer carry a help halo (`HelpTip` in its rail) too?
11. **Viewport law.** Keep the scroll-away head rail (2026-08-31 ruling) as the root's default with a `pinned` option for headless routes like Chat, or make every root pinned and delete the scroll-away?
12. **Foot rails.** `Pane.foot` at `--rail-h`, on recess ground like `ArtifactFrame.foot`, for state (counts, receipts, one commit verb)? Or keep state bands route-drawn?

## Findings outside the anchor (recorded, not ranked)

- `thread-palette.tsx:45` `window.prompt` rename; `thread-palette.tsx:69` `ThreadEmpty` dead; `routes/chat.tsx:28` `?variant` leftover.
- `pane.tsx:127-143` shortcut card has no scroll or `ResizeObserver` repositioning (already Owed 2026-09-01; still true).
- Three global Escape handlers plus one unguarded (ledger duplication list) remain.
- `help.tsx` and `anatomy/key.tsx` name collision.
- `lens.css:52-55` comment says `--side` is mirrored on `<main>` by ChatShell; it is not (finding 1). The comment is the only evidence the coupling ever existed.

## What this round did not do

No Chrome measurement, no prototype. If the user rules on questions 1, 2, 4 and 5, the next bounded step is one isolated HTML lineup (protoui, three variants a keypress apart) of a root with four panes and a Chat-shaped composer, comparing S1 in-flow foot versus S2 floating rail at `--rail-h` 24 and 32, with the halo at 6 in an 8 gutter. Root crosses this report with the runtime report at thread ownership and container lifecycle.

## Round 2 — lineup (2026-09-16, evening)

**URL (my Herdr dev server, this worktree, port 5181, no host attached):** `http://localhost:5181/prototype-root?variant=A` · `…?variant=B` · `…?variant=C`. ← → cycle variants; the magenta pill at top-centre tunes `gutter` (4/6/8/12), `halo` (2/3/6), `rail` (24/28/32), `side` (open/rail), `proposals` (0/1/3), `body` (ready/loading/error/empty), `width` (full/1100/760). Everything rides the URL, so any state is a link. Stress links: `?variant=A&proposals=3` · `?variant=B&proposals=1` · `?variant=C&rail=32` · `?variant=A&width=760` · `?variant=A&body=error`.

Route file: `source/pe-tools/apps/web/src/routes/prototype-root.tsx` (throwaway, this worktree only; `tsc --noEmit` clean). Real kit throughout: `Pane` (halo, shortcut card, `help`, `toolbar`, `actions`), `PaneResizeHandle` in the gutter tracks, `ArtifactFrame` + `MasterTable` nested in the transcript and as the plan pane, `Code`, `ThreadList` (the real sidebar list), `Picker`, `HelpTip`, `RouteHelpButton` (Alt+/), `Switcher`, `Input`, `Textarea`, `ActionButton` proposals.

| Variant | Root | Composer | Halo / handle |
|---|---|---|---|
| A | grid with `--g` perimeter + inter-pane tracks | in flow: the transcript pane's foot | `--halo` outline in the gutter; the handle is the gutter track |
| B | same root | overlay over the transcript with today's scrim; tail padded by measured height | same |
| C | same root, page ground | in flow on recess ground under a hairline; every pane wears `artifactFrameRecipe` base and a recess head band | same |

The Situation is the composer head at exactly `--rail` (one rail by default); proposals expand it as the stress case. The sidebar list and the composer both offer `new`: one route verb, two writers by intent.

### User verdict incorporated: draft retention and the loading boundary

The transcript body is a real `Suspense` boundary (`use()` on a per-thread promise, cached per thread, so a revisit is instant). Loading, error and empty are three distinct bodies with different exits (`Loading`, `BodyError` with `retry`, `EmptyState story="scope"`), all inside the pane under its own head; root, sidebar and composer stay identified. Drafts survive a thread switch through React 19.2 `Activity` (installed: react 19.2.7): one `Composer` per visited thread, `mode="hidden"` when not selected, no second persistence owner, retention within the mounted app only. Runtime partner evidence on effect cleanup, `createRouteOwner` disposal and attachment URL revocation under `Activity` is needed before this is more than a lineup claim.

### Browser testimony (own Chrome tab)

First full capture at 1477×812 showed the whole lineup; later captures came back cropped to 1181×650 (tool state, not layout), so the lines below are from the first frame plus source.
- Three panes at one rail height (24 default); the shortcut card appears on pane focus. **Alt+/ measures all three regions with leaders** (threads: J, K, Alt+N; transcript: Escape, Mod+1, Mod+2; plan: A refused, /). That is the tutorial participation Chat lacks today (round-1 finding 3).
- A with `proposals=3`: the head stays one rail; the band grows below it and pushes the textarea, not the transcript.
- B: overlay with scrim; transcript padded by the composer's live height.
- C: frames on ground; the nested plan table is a frame inside a frame; the sidebar list is an enclosed object.
- Halo 6 in gutter 8 draws with no overflow toggling and no z-index; both resize handles live in the gutter tracks.
- Narrow (`width=760`): container query drops the side lane to its rail and removes the plan pane from the grid; the transcript and composer keep their geometry.
- Not browser-proven this round: typing a draft, switching thread, switching back (do it by hand at the URL).

### Finding while building (systemic)

A `Code` block (`white-space: pre`) inside a flex column with default `min-width: auto` widened the whole grid past the viewport until the wrappers got `min-w-0`. The Lens grid and every route with a `pre` in a flex column is exposed to the same rule. A root that owns "child fills me" must set `min-w-0` on every cell and every flex column it hands out, or the pane primitive must.

### Tradeoffs recorded, not decided

- In flow (A/C) deletes the `--composer-h` and lane plumbing and makes the composer a measurable region; it loses the transcript showing through under the composer. Overlay (B) keeps that look and one more coupling.
- Rail 24 matches `--control-h` and fits the Situation sentence; 32 gives a toolbar room, but `Pane.toolbar` is already a second row, so 24 holds unless the user prefers the air.
- C encloses the sidebar list; the border-budget convention says plain lists are not enclosed. The user sees it before it is ruled either way.
- The sidebar `new` is `ThreadList`'s own button and does not carry the verb's refusal yet; making it the route verb is a cutover choice, not a lineup one.

### Questions for the user (three)

1. Composer in flow (A or C) or overlay with scrim (B)?
2. Pane ground: hairline on page ground (A/B) or every pane an artifact frame on ground (C)?
3. Rail 24 or 32 as the one head height, with the composer Situation at that height and proposals as a band below it?

Not built: the dial column and the plugin flank as a fourth pane; `trace`/`world` sidebar modes are placeholders.

## Round 3 — proofs, disposition, seam and contract (2026-09-16, ~18:40)

Lineup URL unchanged: `http://localhost:5181/prototype-root?variant=A`. **I stopped interacting with Chrome at 18:35** so the runtime partner's foreground benchmark on 5175 is not disturbed; the last proof below is labelled unverified for that reason.

### Browser proofs (own tab 1394038167, viewport 1920×1014, DOM evidence via page JavaScript; no visual claim from source)

| Claim | Evidence | Limit |
|---|---|---|
| Drafts retained per thread across a switch | Typed `DRAFT ONE` in t1, clicked t2: two `textarea[aria-label=Message]` in the DOM, the hidden one holds `DRAFT ONE`, the visible one is empty. Typed `DRAFT TWO`, clicked t1: visible holds `DRAFT ONE`, hidden holds `DRAFT TWO`. Clicked t2: visible `DRAFT TWO`. | Prototype only: the draft is component state under `Activity`. **It does not prove production retention**, whose page store is disposed by the `useRouteOwner` cleanup timer on hide (runtime report, checkpoint 3). |
| Explicit loading for the new thread, sidebar retained | 80 ms after clicking t2: sidebar selection on t2, sidebar still 5 rows, transcript rail already reads the new title, body reads `LOADING THREAD…`, composer present. Body settled by ~1.3 s (700 ms promise plus React's Suspense reveal throttle). | Fixture promise, not a host fetch. |
| Error and empty are distinct bodies under the pane's own head | `body=error`: `[role=alert]` "THREAD FAILED TO LOAD · the host did not answer /threads/t1 — 502 · retry". `body=empty`: `[data-story=scope]` "no messages in this thread yet — ask anything below, or pick a thread on the left". Both: sidebar 5 rows, composer visible, all three rails 24 px. | Fixture states. |
| Sentence and sidebar are one selection | The sentence thread word opens a `Picker` ("Choose thread", 6 options). Picking "Schedule grid" in the sentence: sidebar `[data-selected]` = Schedule grid, body loading. Clicking "Sheet index" in the sidebar: sentence word = Sheet index audit. | Both write `?thread`; the sidebar row is `ThreadList`'s own click, not a route verb. |
| Collapse, expand, keyboard resize | `side=rail`: columns `40 8 1428 8 420`, threads pane 40 wide, Expand button present. Expand: `288 8 … 8 420`. Five ArrowRight on the first `role=separator`: `304 8 …` (16 px). | Pointer drag not exercised. Lineup defect found and fixed: arrow keys also cycled the variant while a handle was focused. |
| Overlay (B) pads the tail by the composer height | `proposals=3`: composer 208 px, transcript scroller `padding-bottom` 224 px, Situation 24 px. | Moot: B is retired (below). |
| C grounds | root `rgb(21,18,13)`, pane cell `rgb(30,28,22)` (artifact), head band `rgb(39,37,31)` (recess); rail 32 = Situation 32 at `rail=32`. | Dark theme only. |
| Halo | `[data-slot=pane-halo]` inset −6 px, border 6 px at `halo=6`. `pane.focus()` from script did not set `data-active`, so **the halo's visible state is unproven this round**. | Needs a real focus event in a visible tab. |
| Narrow (`width=760`) | **Unverified.** Two attempts (container query on the root; `ResizeObserver` state) left five tracks: a container query cannot see its own element, and the observer state never applied after a hard reload (cause not isolated in budget). The third fix derives `narrow` synchronously from the tunable width or `window.innerWidth`; it compiles; I did not reload the tab to check it. | Open `?variant=A&width=760` after the runtime benchmark. |

### Disposition of B and C (user verdict, round 3)

- **A adopted**: in-flow composer as the transcript pane's last child; panes on page ground. Rail height stays at the reviewed 24 provisionally with `rail` tuning kept in the lineup; not a ruling.
- **B retired** (a Tried & rejected line for the ledger): the overlay composer has a z-level defect the user screenshotted; table cells paint above the composer. Cause in the lineup: the composer's `pointer-events-none` wrapper sits inside the pane body's stacking context while `MasterTable` sticky cells make their own. The same class of defect is live today in `chat-shell.tsx:189-207`, where the composer floats over the Lens grid.
- **C not adopted** for panes; the user's question is answered by seeing it. Uniform enclosure survives only where it already holds: tables, code, receipts, the Situation. The border-budget convention stands as convention, now with a seen alternative behind it.
- **Open: gutter and halo colour.** Today the halo is `border-line-2`; at 6 px in an 8 px page-ground gutter it reads as a second frame. Candidates for one bounded tuning round: the halo as a `--pe-select`-family fill of the gutter (selection is a fill, never a hue; house law 5), or a 2 px `line-2` outline with the gutter unchanged. This is a `base.css` token decision, kept out of the contract below.

### Minimal shared boundary seam (coordinated with runtime's scope contract; no new data owner)

Runtime's contract (its checkpoint 2) names the owners: a persistent shell per `/chat` mount and a **thread scope** per visited thread holding draft, attachments, body query, display frame and `thread-head`. The surface seam only projects that scope's state into the pane body. Three parts, no new store:

1. `Pane` gains one prop: `body?: { state: "ready" | "loading" | "error" | "empty"; what: string; error?: string; retry?: () => void; exit?: string }`. When present and not `ready`, `Pane` draws the state body under its own head (the three bodies proven above; `EmptyState story="scope"` for empty) and does not render `children`. Head, `meta`, `help`, `toolbar` and shortcuts stay mounted, so the tutorial, the halo and the rail never blink. This is "explicit loading for the newly selected thread, never the old transcript" as a pane law, and every route pane needs it, not just Chat.
2. The value comes from the owner, never from the pane. Chat's transcript pane derives `body` from the thread scope's body query (`useHostCall` state: loading; failed with message; ready with zero messages is `empty`). Takeoffs and Family panes derive it from their Readings the same way (`Reading.state` already has five states). No Suspense in production panes until fetching leaves effects; Suspense is the lineup's stand-in for "the owner says loading", and `Pane.body` is the seam either mechanism feeds.
3. Composer retention is the owner's job (runtime: tie `useRouteOwner` disposal to true unmount; Activity around scope plus composer), not the pane's. The pane seam makes no retention claim.

Cost: ~40 lines in `pane.tsx` plus two small state components. Deletes the ad-hoc "Loading thread state" status line in `composer-head.tsx:78-81,148-163` and the `showEmpty` branch in `lens/view.tsx:129-138`.

### Primitive contract (candidate A, extended to real consumers; the prototype is not promoted)

Root (`Surface`, new, ~80 lines; replaces `anatomy/workspace.tsx` and the 11 hand-rolled `<main>` roots):
- Owns viewport height (one of `fixed inset-0` or `h-dvh`), perimeter padding `var(--gutter)`, and a CSS grid whose inter-pane tracks are `var(--gutter)`; every cell is `min-h-0 min-w-0` (the `pre`-in-flex finding). Optional `head` (the Situation) in scroll-away flow per the 2026-08-31 ruling; `pinned` for headless routes such as Chat.
- Owns resize: a handle lives in a gutter track; sizes persist by `persist` key (`usePaneSize` as is); `PaneSplit` and `SidePane`'s handle die into it.
- Owns narrow: one breakpoint (960 provisional) that turns flank panes into rails and drops panes declared `secondary`; a container query on the root's parent, never on the root.
- Tokens in `base.css`: `--gutter` (8), `--halo` (width tunable, colour open), `--rail-h` (24 provisional).

Pane (`pane.tsx`, grows ~60 lines; `SidePane` dies into it):
- `kind` adds `flank` (collapsible to a 40 px rail with an expand press; collapsed state belongs to the owner, e.g. Chat's `expandedPane` atom).
- Head at `--rail-h`; title-only by default; `head={false}` opts out; `headerSurface` stays. Halo is an outline of `--halo` on the pane box, in the gutter: no overflow toggling, no `z-raised`.
- `foot?: ReactNode` at `--rail-h` on recess ground for state (counts, receipts, one commit verb), mirroring `ArtifactFrame.foot`. The composer is **not** a foot: it is the transcript pane's last child in flow, variable height, its own artifact box.
- `body` state seam as above.

Situation on the composer: the sentence gains the thread slot as a `Picker` level bound to `?thread` (proven above). `ThreadList`'s row click becomes the same write; its New button becomes the route `new` verb (`SituationAction`), so refusal is shared. One owner, two writers.

Keys: one `Kbd` mark in `lang/` for the shortcut card, help page, verb board and thread list; `anatomy/key.tsx` renamed `LegendKey`. Verb hover title gains the chord as a trailing `Kbd` (`situation.tsx:344`).

### Normalization cutover plan (disjoint Terra high lanes; not started)

Ordered by dependency. Each lane is one worktree, one writer, one acceptance journey; it stops at repo-guard green plus a browser proof of its journey.

| Lane | Owns (files) | Delivers | Acceptance |
|---|---|---|---|
| L0 tokens + root | `base.css`, new `components/lang/surface.tsx`, `pane.tsx`, `pane-resize.tsx`, `side-pane.tsx` (delete), swatch `ui-layout.tsx` | `Surface`; `Pane` flank, foot, body, halo in gutter; `--gutter`, `--halo`, `--rail-h`; `SidePane` and `PaneSplit` deleted | `/design-system/swatch` renders every variant; `pane.test.tsx` extended for flank, foot, body states |
| L1 Chat | `chat/chat-shell.tsx`, `workbench/lens/view.tsx`, `lens.css`, `chat/composer-head.tsx`, `chat/thread-palette.tsx` | Chat on `Surface`: threads (flank), transcript (composer in flow), dial, plugin (flank); `.pe-composer-lane`, `--side`, `--map`, `--composer-h` deleted; thread slot in the sentence; `Pane.body` from the thread scope | Alt+/ shows four Chat regions; a thread switch shows loading with the sidebar retained; draft retention is accepted jointly with runtime's owner change, not by this lane |
| L2 workspace routes | `anatomy/workspace.tsx` (delete), `takeoff/atlas-workspace.tsx`, `family/workspace-view.tsx`, `families/workspace-view.tsx`, `ops/workspace.tsx`, `routes/grilles.tsx` | `PaneWorkspace` consumers on `Surface` with gutters; halo overflow toggles gone | Takeoffs fixture lane renders; `/family` demo lane renders; 20 px row law holds |
| L3 flat routes | `routes/settings.tsx`, `routes/data-tables.tsx`, `routes/parameter-links.tsx`, `schedule-grid/workspace.tsx`, `routes/doc-lab.tsx`, protos | hand-rolled `h-screen` mains on `Surface`; `SidePane` uses become flank panes | each route opens; no guard regression |
| L4 keys + help | `route/help.tsx`, `route/situation.tsx`, `anatomy/key.tsx`, the card block of `pane.tsx` | one `Kbd`; chord on hover; help measures flank panes | Alt+/ on `/takeoffs` and `/chat` |

Disjointness: L0 lands before L1 to L3 start (they consume its API). L1, L2 and L3 touch disjoint files. L4 touches `pane.tsx` only in the card block and waits for L0. Runtime's owner and Activity lane touches `route/use-route.ts`, `workbench/provider/*` and `routes/chat.tsx`; L1 must not, so the composer retention journey is accepted jointly after both land.

Decisions still meaningful before a lane starts, offered as bounded tuning, not blockers: rail 24 vs 28 vs 32 (lineup `rail=`); halo colour or fill; whether `foot` ships in L0 or waits for its first real consumer (house authoring order says wait; the first real consumer is Takeoffs' zone state bar).

### Disposable state to clean before integration

Worktree `Pe.Tools-unify-surface`: `routes/prototype-root.tsx`, regenerated `routeTree.gen.ts`, this report. Dev server on 5181 (my Herdr session). Chrome tab 1394038167 is mine, left open for the user, untouched since 18:35. No production file changed.

## Round 3b — contract corrected after root review (2026-09-16, ~19:00)

Source: `.artifacts/handoffs/unification-20260916/surface-contract-review.md` plus runtime's "Minimal shared ownership proposal" and root's A/B mechanism comparison (`UNIFICATION-RUNTIME.md`). No Chrome touched. Census greps for this section are in this worktree at `527048f`; counts exclude tests, swatch specimens and the prototype route.

### 1 · Loading: stable chrome plus a body boundary, not an enum

Compared two shapes for "the newly selected thread shows explicit loading, never the old transcript":

| | `Pane.body` state enum (my round-3 seam) | Stable chrome + `Suspense`/error boundary in the body (runtime's seam) |
|---|---|---|
| Data owner | the consumer computes a state word from whatever it fetches with | the thread scope's `readThreadBody(threadId)` promise, read with `use()`; one owner |
| Loading contracts in the repo | two: this enum plus Suspense wherever it appears later | one |
| Fetch shape | leaves `useHostCall` effect fetches as they are | requires the body fetch to become a promise on the scope, which runtime already proposes and root says is in scope |
| Empty | pane draws it | consumer draws it: empty is successful domain data |
| Error retry | `retry` callback prop | boundary reset that replaces the scope's promise |

Ruling I propose: **the boundary shape.** The enum is withdrawn. Contract:

- `Pane` keeps head, `meta`, `help`, `toolbar`, `actions`, shortcuts and halo mounted at all times and wraps `children` in one `Suspense` and one error boundary. Defaults: fallback = `PaneLoading` ("loading {title}…", `role=status`), error = `PaneError` (the error's message, a `retry` press). `boundary={false}` opts a pane out (a pure-navigation pane with nothing to suspend). `onRetry` is the consumer's hook; for Chat it replaces the scope's body promise (runtime's rule); for a Readings-backed pane it calls the Reading's refresh.
- What suspends: only what the owner puts under the boundary. Chat: the transcript body. Composer, sidebar list, readings stream and pane geometry sit above it (runtime: "sidebar and composer never fall back"). Takeoffs and Family: their Readings can move to a promise-per-key on the route owner in the same shape once `useRoute` exposes one; until then those panes render their Reading state themselves inside the boundary and the boundary is inert. No second mechanism is added for them.
- Empty stays with the consumer: `EmptyState story="scope"` as today.
- Workspace level: `Surface` mounts no boundary. A route with one body (Settings, Data tables) uses one `Pane` and gets the boundary from it.

This deletes the composer-head status line (`composer-head.tsx:78-81,148-163`) and the `showEmpty` branch (`lens/view.tsx:129-138`) as before, and adds nothing the runtime contract does not already own.

### 2 · Rails: one `Rail`, a slot/ownership matrix, no toolbar framework

Head bands in production today and what each puts where:

| Consumer (count) | Left | Right | Second row | Height / ground |
|---|---|---|---|---|
| `Pane` header (11 sites) | `title` (`t-small t-upper`), `meta` (mono), `help` (`HelpTip`) | `actions` under `ActionChrome`; `Switcher` in grilles, runs | `toolbar` (atlas-visual, grilles) | 32 / page or `headerSurface` |
| `ArtifactFrame.head` (16 sites) | free: `Tag` + `FactChip`s (receipt, settings ×3, level-stats, zone-card, context-strip ×2, issues, form, array-field, definition-card, doc-pane, parameter-links-review) | free | — | ~22 / recess |
| `ArtifactFrame.foot` (2 real: `actions/receipt.tsx:71`, param-tables variant) | `Tag` counts | one commit `ActionButton` | — | ~26 / recess |
| `Code` head (1 primitive, 18 sites) | language | copy, line count, show all | — | ~22 / recess |
| `MasterTable` strip (9 sites) | `scopeLabel` | search input, `chips`, `summary` | — | own; stacks under the frame head ("two heads", documented gap) |
| `Section` head (5 sites, 15 `aside`s in ops) | `label`, `help` | `aside` counts/controls | — | type + hairline / page |
| `SidePane` header (5 sites) | chevron + free (`ModeDial`; plugin title + close) | — | — | 40 / page |
| Situation name line (5 routes) | `h1 t-head` | `Cluster`: chain lamp, gauge, help, theme | verb row, Work band, log | frame head / recess |
| Composer head (Chat) | "Pea on …" sentence | chain lamp, gauge, help, theme | proposals band | free / artifact |

Common `Rail` (new, `lang/rail.tsx`, ~40 lines): height `--rail-h`, `ground: page | recess`, two slots `lead` and `trail`, baseline-aligned, `trail` wrapped in `ActionChrome` so a verb's refusal is a title. That is the whole API. It replaces the band markup of `Pane` header, `ArtifactFrame` head and foot, `Code` head, `Section` head and `SidePane` header. Each keeps its typed props (`title`/`meta`/`help`, `head`/`foot`, language/copy) and renders them into `Rail` slots; the props are the ownership, `Rail` is the geometry.

Ownership of controls, by kind, no new props:
- Mode (exclusive view): `Switcher` in `trail`. Chat's mode dial, family doc-pane text/sheet, runs' switcher.
- Title and meta: `lead`; a machine fact is `meta`, orientation is `help` (2026-08-31 ruling stands).
- Actions: `trail` under `ActionChrome`.
- Search and filter: **domain**. `MasterTable` keeps its strip content; the open decision is whether the strip becomes the artifact's `Rail` (one head: scope label `lead`, search + chips + summary `trail`) or stays a second row. Decision 3 below.
- Presets: a `Switcher` in `trail` (plan pane in the lineup); a preset that is a saved filter belongs to `MasterTableState`, which is still component-local (ledger owed item stands).
- Second row: `Pane.toolbar` stays as the one second row; nothing else grows a toolbar.

Not built: a configurable toolbar, a slot registry, or per-consumer rail variants beyond `ground`.

### 3 · Layout: composable, no silent drop

- `Surface` is a grid with `--gutter` perimeter and tracks; it declares no breakpoint and hides nothing. Cells are `min-h-0 min-w-0`.
- Collapse is owner state on a `flank` pane (`collapsed`, `onCollapsedChange`), as `PaneCollapseSpec` already models. A collapsed flank is a 40 px rail that keeps: the expand press, the pane's title turned vertical, and its shortcuts (so Alt+/ still lists it). Nothing a pane holds becomes unreachable; it is one press away.
- Narrow is per pane, declared by the owner: `collapseBelow` (already in `PaneCollapseSpec`) measured against the `Surface` width (`usePaneFit` already does this for sizes). A route that wants its plan pane to yield first sets a larger `collapseBelow` on it. No global 960.
- Viewport and flow, the real cases: (a) pinned, headless: Chat, Settings, Data tables, Schedule grid, Parameter links, Doc lab, Grilles, the two protos (`Surface` default); (b) scroll-away head over a pinned work block: Takeoffs, Family, Families, Ops (`Surface head={<Situation/>}` keeps the 2026-08-31 behaviour); (c) document flow, no panes: `/` index, `/instances`, Takeoffs saved review (`min-h-screen px-6` prose pages; **not `Surface` consumers**, they keep their own root and are out of this cutover). Runs browser is (a) with `PaneSplit` inside; Instances stays (c) by the 2026-09-13 ruling.

### 4 · Honest staging and integration ownership

- L0 does **not** delete `SidePane` or `PaneSplit`. It adds `Surface`, `Rail`, `Pane` flank and boundary, and leaves the two old primitives compiling as `SHIM:` re-exports (`SidePane` = `Pane kind="flank"` adapter; `PaneSplit` = a two-cell `Surface`). Whole-repo guard and compile stay green at L0 by construction, not by claim.
- L1 to L3 each move their consumers off the shims; each lane's acceptance is its own routes plus repo guards green **for its files**; a lane may not claim whole-repo green.
- L-final (integration owner: root, one commit): delete the shims and the two files, `anatomy/workspace.tsx`, `.pe-composer-lane` and the Lens CSS vars, run the full guard suite, run the acceptance journeys of every lane once more. Only L-final claims whole-repo green.
- Consumer census, complete for the primitives being retired (grep at `527048f`): `PaneSplit` in `runs/browser/view.tsx` ×2 and `takeoff/atlas-table.tsx`; `SidePane` in `chat/chat-shell.tsx`, `workbench/lens/view.tsx`, `routes/data-tables.tsx`, `routes/parameter-links.tsx`, `schedule-grid/workspace.tsx`; `PaneWorkspace` in `anatomy/workspace.tsx`, `routes/grilles.tsx`; `Workspace` in `takeoff/atlas-workspace.tsx`, `family/workspace-view.tsx`, `families/workspace-view.tsx`, `ops/workspace.tsx`; `Pane` in the 11 sites of round 1. Lane assignment corrected: L2 also owns `runs/browser/view.tsx`, `takeoff/atlas-table.tsx`, `takeoff/atlas-visual.tsx`, `takeoff/atlas-navigation.tsx`, `takeoff/room-panel.tsx`, `family/workspace-{anatomy,doc-pane,table}.tsx` (pane-header markup moves to `Rail` there); `routes/grilles.tsx` moves from L2 to L3 (it is a pinned route with `PaneWorkspace` inline).

### 5 · Foot: none for panes; the Chat contract in full

Fixed foot rails in production: `ArtifactFrame.foot` at `actions/receipt.tsx:71` (counts + one commit verb) and the param-tables variant. Pane-level state bars: none fixed. `OutcomeStrip` and `PendingStrip` sit under the head in Schedule grid; `ArmingStrip` is a ceremony surface in flow; `LedgerDock`, `PlanDock` and `ContextRibbon` are variable docks; `ZoneStateBar` is a cell-scale bar. So: **no `Pane.foot`**. `ArtifactFrame.foot` renders on `Rail ground="recess"` and stays the one fixed state rail. Variable content docks (composer, ledger dock, plan dock) are last children in flow with no primitive.

Chat, the whole contract, not only the thread word:
- Panes: threads (`flank`, left), transcript (`content`), dial (its own 64 px column, `visual`, no head), plugin workspace (`flank`, right; only one flank expanded, owner atom as today).
- Threads pane rail: `lead` title "threads" + count; `trail` mode `Switcher` (threads · trace · world). Its body is `ThreadList`, whose row click and New button write the same route state and route verb as the sentence.
- Transcript pane rail: `lead` = the thread title (from the route's thread reading) + turn count; `trail` = jump-to-latest. Body = transcript under the pane boundary. Last child in flow = the composer.
- Composer (an artifact box): `Rail ground="recess"` = the Situation: `lead` sentence **Pea** on [session › document `Picker`] in [thread `Picker`]; `trail` = `ChainLamp`, state gauge (`Ledger` rows thread/target/revision + `PageLog` of `handle.log`), `HelpTip` (the composer's help: Enter, Shift+Enter, `/`, Mod+K), `RouteHelpButton`, `ThemeToggle`. Chat has no stage word, so no stage picker. Proposals band below the rail; textarea; control row (attach, `new`, `fork`, `cancel` while running, `send`) as today.
- Halo and tutorial: the composer is inside the transcript pane, so focusing the textarea activates that pane's halo and its shortcut card, which lists the composer keys (Enter send, Shift+Enter newline, `/` skills, Mod+K palette) as pane-tier registrations; Alt+/ then hangs them off the transcript region. No separate composer halo.

### Remaining true product decisions (three)

1. **Rail height**: 24 (matches `--control-h`; the Situation sentence and `Code` head fit) or 32 (today's `Pane`; room for a framed press without touching the edges). The lineup's `rail=` tunes it live.
2. **Halo treatment**: a `--pe-select`-family fill of the gutter around the active pane, or a 2 px `line-2` outline in the gutter. Both keep colour out of the meaning band.
3. **Table head**: `MasterTable` hands its scope label, search, chips and summary to the enclosing artifact's `Rail` (one head, the documented "two heads" gap closed), or keeps its own strip as a second row.

### Acceptance checks (explicit)

- L0: `/design-system/swatch` shows `Surface` (2, 3, 4 cells), `Rail` on page and recess, `Pane` flank open and collapsed, boundary fallback and error with retry; `pane.test.tsx` gains: flank collapse keeps title and shortcuts; boundary fallback renders while a child suspends; retry re-renders children; `SidePane` and `PaneSplit` shims compile and their existing tests pass unchanged.
- L1 Chat: Alt+/ lists four regions (threads, transcript, dial, plugin when open) with the composer keys under transcript; switching threads: sidebar rows unchanged, transcript body shows `loading <title>` under the new title, composer stays; sentence pick moves the sidebar selection and vice versa; New from the sidebar and from the composer show the same refusal when `Chat is not ready`; no element paints above the composer (the B defect) with a table in the transcript; draft retention is checked only after runtime's shell-owned scope lands, and the check is typed draft in A, switch to B, back to A.
- L2 workspace routes: Takeoffs fixture lane and `/family?demo=plan` render with gutters; row heights 20 px unchanged; the halo no longer toggles `overflow-visible` (grep `has-[[data-slot=pane][data-active=true]]` = 0); resize persists by key as before; Alt+/ on `/takeoffs` shows the same regions as today.
- L3 pinned routes: each opens; `h-screen`/`min-h-screen` mains gone from those files; `SidePane` imports = 0 in them.
- L4 keys: one `Kbd` primitive; `anatomy/key.tsx` renamed; verb hover shows its chord.
- L-final: `SidePane`, `PaneSplit`, `anatomy/workspace.tsx`, `.pe-composer-lane`, `--side`/`--map`/`--composer-h` absent from `src/`; full repo guards and web tests green; every lane journey re-run once.

## Round 3c — `useAtomSuspense` evaluated as the loading integration (2026-09-16, ~19:20)

Sources read, installed in this worktree: `@effect/atom-react@4.0.0-be_85e396f5a6c9ff7615c59690d0b5baae/src/Hooks.ts:340-410, 54-58, 290`; `effect@4.0.0-beta.92/src/unstable/reactivity/AsyncResult.ts:80-342`; `Atom.ts:437-520 (make), 212 (setIdleTTL), 666/984 (refresh → waitingFrom), 1264 (fn), 1511 (family), 1641/1657 (keepAlive/autoDispose)`; repo `readings.ts:247-310`, `agent-contracts/src/reading.ts:40-45`, `provider/thread-stream.ts:35-70`. No Chrome touched.

### What the hook actually does

- `useAtomSuspense(atom, {suspendOnWaiting=false, includeFailure=false})` reads the atom with `useSyncExternalStore` (`useStore`, Hooks.ts:54). If the value is `Initial`, or `waiting` with `suspendOnWaiting`, it **throws a promise** (Hooks.ts:363-372). That promise is cached per atom in a module map, resolves on the first non-`Initial` (non-waiting) value, then the subscription is dropped one second later (Hooks.ts:340-360). So the "promise cache" already exists inside the hook; nothing must be invented.
- A `Failure` is thrown as `Cause.squash(cause)` unless `includeFailure: true`, in which case the component receives the `Failure` and renders it itself (Hooks.ts:400-409). With `includeFailure` the consumer needs no error boundary for expected failures; a boundary stays as the safety net for thrown ones.
- `AsyncResult` (AsyncResult.ts) has three tags: `Initial`, `Success`, `Failure`, each with `waiting: boolean`; `Failure` carries `previousSuccess: Option<Success>`. An Effect-backed atom made with `Atom.make(effect)` (Atom.ts:437-470) starts `Initial`, and on `refresh` becomes `waitingFrom(previous)` (Atom.ts:666/984): a `Success` with `waiting = true`, not `Initial`. Therefore **a refresh does not re-suspend unless `suspendOnWaiting` is set**; by default the old content stays under a waiting flag.
- Retry is `useAtomRefresh(atom)` (Hooks.ts:290). Lifetime is `Atom.autoDispose` (dispose when the last subscriber leaves) or `Atom.setIdleTTL(duration)` (dispose after idle; infinite keeps alive) or `keepAlive` (Atom.ts:212, 1641, 1657). `Atom.family(key => …)` (Atom.ts:1511) memoises by key in a WeakRef map.

### `Reading<T>` and `AsyncResult` are not interchangeable

| `Reading` (`reading.ts:40`) | Nearest `AsyncResult` | What is lost |
|---|---|---|
| `absent` | `Initial` | nothing |
| `loading` (no previous) | `Initial(waiting)` | `requestId`, `deadline` |
| `loading` with `previous` | `Success(previous, waiting)` | that the observation is being replaced |
| `ready` | `Success` | nothing |
| `stale` with `reason: dirtied · gap · target-changed · disconnected` | `Success(previous, waiting)` | **the reason**, which house law 8 draws (surveyed vs reported, fresh vs stale) |
| `failed` with `previous` | `Failure(previousSuccess)` | nothing |

Readings are push-stream state advanced by frames (`readings.ts:247`), held in `Atom.make<Reading>` with `setSelf` (`readings.ts:267-280`); they are already atoms, but of type `Reading`, so `useAtomSuspense` cannot take them. A projection atom could map `Reading → AsyncResult`, but it discards the stale reason, and a Reading's whole point is that stale evidence is never erased and is drawn differently. So: **Readings keep their state model and draw `stale`/`failed` themselves; Suspense is not applied to them.** The only Reading state a boundary could honestly cover is `absent`/first `loading`, and a pane already handles that in its body.

### The thread body: a real fit

The thread body is not a Reading. It is a one-shot fetch in `useHostCall` (`thread-stream.ts:41-49`), which is exactly the shape `Atom.make(Effect)` models: request → `Initial` → `Success | Failure`, refresh → `waiting`. Proposal, the smallest one that uses the supported integration and creates no second owner:

```ts
// owned by the persistent /chat shell, in the app registry that already exists (routes/__root.tsx)
const threadBody = Atom.family((threadId: string) =>
  Atom.make(Effect.tryPromise(() => readThreadBody(origin, threadId)))  // → Atom<AsyncResult<ChatState, Error>>
    .pipe(Atom.setIdleTTL("30 minutes")),                                // retention knob, see below
);
```

- Transcript pane body: `const body = useAtomSuspense(threadBody(threadId), { includeFailure: true })`. First visit: `Initial` → suspends → the pane's `Suspense` fallback "loading {title}…" under the pane's own head; sidebar and composer are above the boundary and never fall back. `Failure` → the pane's `PaneError` with `retry = useAtomRefresh(atom)`; `previousSuccess` is available for "show last good" if the user wants it. `Success` with zero messages → the consumer's `EmptyState`. This is the round-3b boundary contract unchanged, with the promise owned by the registry instead of a hand-made cache.
- Reveal after a hidden run (runtime's gap): `useAtomRefresh` on reveal produces `Success(previous, waiting)`; with `suspendOnWaiting: false` the retained transcript stays visible while the body refreshes, and the display frame from the stream's attach snapshot reconciles it. With `suspendOnWaiting: true` the pane would show loading again on every reveal. **Default false**; the user's rule "never the old transcript under the new selection" is about a different thread, which is a different atom and therefore `Initial`, so it holds either way.
- Hidden `Activity` and lifetime: `useSyncExternalStore` subscriptions are effects, so hiding the transcript unsubscribes. With `autoDispose` alone the body atom would be disposed on hide and re-fetched on reveal (back to `Initial`, loading shown). `setIdleTTL` keeps the value across a hide for the TTL window; `keepAlive` keeps it for the session. This is the retention-policy decision the runtime report left to the user, now expressed as one duration rather than an eviction count.
- Cancellation: an Effect atom's fiber is interrupted on dispose and a refreshed run supersedes the old one inside the atom, so a stale response cannot land under another thread (the family key is the thread id). The `AbortSignal` hygiene runtime noted becomes `Effect.tryPromise({ try: (signal) => fetch(url, { signal }) })`, one line.
- Invalidation from the stream (`message_end`, `agent_end`) becomes `registry.refresh(threadBody(id))` where `thread-stream.ts` calls `refresh` today; `sent` reconciliation is untouched.

Cost: `useHostCall` for the thread body is replaced by one family atom (~15 lines) and the hook; `thread-stream.ts:35-70` shrinks; nothing new in `readings.ts`. The pane contract from 3b stays: `Pane` mounts `Suspense` and a safety error boundary; the owner decides what suspends.

### Gotchas recorded
- The hook's promise map is module-global and keyed by atom object; `Atom.family` returns the same object while its WeakRef lives, so a disposed-and-recreated atom gets a fresh promise. Fine, but a TTL shorter than a slow fetch would dispose mid-suspend; set the TTL well above fetch time.
- `includeFailure` changes the return type to include `Failure`; the consumer must branch on `_tag`.
- `suspendOnWaiting` is global to the read, not per refresh; there is no "suspend on this refresh only".
- Nothing here changes `useRoute`'s Readings or their five states; a future "Readings as AsyncResult" is not implied and would lose the stale reason.

### Decision for the user (one, replaces runtime's retention question)
Retained thread bodies expire after how long idle: a fixed TTL (30 minutes proposed), the session (`keepAlive`), or none (`autoDispose`: reload on every reveal)?

## Round 3d — foundation contract, final for root acceptance (2026-09-16, ~19:35)

Confirmed user choices folded in (`rail-and-profiling-verdict.md`): 24 px shared rails; one table artifact header for title, search, modes and actions with an optional filter row; the composer has its own halo and help/keyboard region. No compatibility adapters: old primitives stay untouched until their last caller moves, then are deleted at integration; interim compile breakage between cuts is accepted by the user. Colour tokens stay open and do not block shape. No Chrome touched.

### The contract (what L0 builds; nothing else)

**Tokens** (`base.css`): `--gutter: 8px`, `--halo: 6px`, `--rail-h: 24px` (= `--control-h`; do not alias, they may diverge later), `--halo-ink` (provisional `var(--pe-line-2)`; the open colour decision changes this one line).

**`Rail`** (`components/lang/rail.tsx`, new): `{ ground?: "page" | "recess"; lead: ReactNode; trail?: ReactNode }` → one row, `h-(--rail-h)`, `hairline-b`, `lead` truncates, `trail` `shrink-0` under `ActionChrome`. That is the whole API. Consumers and what they put in it:

| Consumer | `lead` | `trail` | ground |
|---|---|---|---|
| `Pane` head | `title` (`t-small t-upper`), `meta` (mono), `help` (`HelpTip`) | `actions`; a mode `Switcher` is an action | page, or `headerSurface` |
| `ArtifactFrame.head` | caller's `head` node | — | recess |
| `ArtifactFrame.foot` | caller's `foot` node (counts) | the one commit verb, by the caller | recess |
| `Code` head | language / `title` | copy, line count, show all, render toggle | recess |
| Table artifact head (`MasterTable`, see below) | `scopeLabel` + `summary` | search `Input`, mode `Switcher`, `actions` | recess |
| `Section` head | `label`, `help` | `aside` | page (keeps its hairline-only look via `ground="page"`) |
| Composer Situation | sentence: **Pea** on [session › document] in [thread] | `ChainLamp`, gauge, `HelpTip`, `RouteHelpButton`, `ThemeToggle` | recess |

Second row: `Pane.toolbar` stays as is (wraps, `hairline-b`). `MasterTable` gains `filters?: ReactNode` for the optional filter row (its chips and column facets), rendered directly under the rail. No third row anywhere.

**Table**: `MasterTable`'s own strip (`master-table.tsx:176-231`) is deleted. The enclosing `ArtifactFrame` is the table's one header: `MasterTable` gets `head?: { actions?: ReactNode; modes?: ReactNode }` and renders `ArtifactFrame` itself with `Rail lead = scopeLabel + summary`, `trail = search · modes · actions`, `filters` row = chips + "clear all" when any narrowing is active; `CellStateKey` stays a last child. The nine `MasterTable` call sites keep `scopeLabel`, `searchPlaceholder`, `chips`, `summary`; call sites that wrapped the table in their own `ArtifactFrame` (`integration-table.tsx` specimen, atlas-table, ledger-dock) drop that wrapper. Column facet triggers stay in the column header (2026-08-31 ruling).

**`Surface`** (`components/lang/surface.tsx`, new): `{ head?: ReactNode; columns: string; rows?: string; children }`. Renders `fixed inset-0` (pinned) or, when `head` is given, the 2026-08-31 scroll-away shell (`main h-dvh overflow-y-auto no-scrollbar` → `head` → `sticky top-0 h-dvh` block); the block is a grid with `padding: var(--gutter)`, `gap: var(--gutter)`, the caller's `columns`/`rows` templates, every child cell `min-h-0 min-w-0`. `SurfaceHandle` (`{ axis; size: PaneSizeSpec-state }`) is placed by the caller as a grid child in a gutter track: it is `PaneResizeHandle` re-homed with `w-(--gutter)`/`h-(--gutter)`, keyboard and reset kept. No breakpoint, no hidden children.

**`Pane`** (`pane.tsx`, changed in place):
- head → `Rail` at `--rail-h`; `hasHeader` rule unchanged; `headerSurface` → `ground`.
- halo → `outline: var(--halo) solid var(--halo-ink); outline-offset: 0` on the section, clip-path reveal kept; `z-raised` and the `-inset-1` span deleted. `PaneWorkspace`'s four `has-[[data-slot=pane][data-active=true]]:overflow-visible` toggles deleted (they exist only for the outside halo).
- `kind` adds `flank`: `collapsed?: boolean; onCollapsedChange?` (owner state); collapsed = `w-10` rail with the expand press, the title vertical, shortcuts still registered (`region` unchanged) so Alt+/ lists it.
- boundary: `children` under `Suspense` (fallback `PaneLoading`: "loading {title}…", `role=status`) and an error boundary (`PaneError`: message + `retry`, which calls `onRetry`); `boundary={false}` opts out. Owners decide what suspends (3b/3c).
- `shortcuts` unchanged; `data-slot="pane"` unchanged so `help.tsx` measures every pane, including nested and flank ones.
- **Composer region**: no new primitive. The composer is a nested `Pane` (`id="composer" kind="content" boundary={false}`) inside the transcript pane's body, last child in flow. `pane.test.tsx:48-82` already proves the nearest nested pane owns focus, halo and conflicting shortcuts. Its head is the Situation `Rail`; its `help` is the composer's `HelpTip`; its `shortcuts` are Enter send, Shift+Enter newline, `/` skills, Mod+K palette, Alt+N new; so it has its own halo, its own `? keys` card and its own region on the help chart. The transcript pane keeps Escape (jump to latest) and Mod+1..3.

**Mode ownership**: a mode is a `Switcher` in a `Rail.trail`, its value owned by whoever owns the view: URL (`?mode` for Chat depth), page atom (family doc text/sheet), or `MasterTableState` (table modes). `Rail` owns none of it.

**Tutorial registration**: unchanged mechanism (`keyMeta` tier `pane`, `region = id ?? kind`; `help.tsx` measures `[data-slot="pane"]`). L0 adds one rule to `help.tsx`: a collapsed flank still appears with its rail rect. Chat ends with five regions: threads, transcript, composer, dial, plugin.

**Explicitly not in the contract**: `Pane.foot` (no consumer), a global narrow breakpoint (per-pane `collapseBelow` in `PaneCollapseSpec` already exists), adapters for `SidePane`/`PaneSplit`, any `Reading → AsyncResult` projection, any change to `useRoute` or the page stores (runtime lane).

### L0 · foundation task (exact, one Terra high lane, worktree `Pe.Tools-l0-surface`)

Files it may write: `base.css`, `components/lang/rail.tsx` (new), `components/lang/surface.tsx` (new), `components/lang/pane.tsx`, `components/lang/pane-resize.tsx` (handle re-home only), `components/lang/pane-workspace.tsx` (remove the four overflow toggles; gap via `--gutter`), `components/lang/artifact-frame.tsx`, `components/lang/code.tsx` (head → `Rail`), `components/lang/section.tsx` (head → `Rail ground="page"`), `components/master-table/master-table.tsx` (+`master-table-header.tsx` only if the facet trigger height needs the rail), `route/help.tsx` (collapsed flank rect), `design-system/specimens/ui-layout.tsx`, `pane.test.tsx`, `master-table.test.tsx`, `code.test.tsx`. Nothing under `chat/`, `workbench/`, `takeoff/`, `family/`, `routes/` except the swatch.

Deliverables, in order, each its own commit: (1) tokens + `Rail` + `Code`/`Section`/`ArtifactFrame` on `Rail`; (2) `Pane` head on `Rail`, halo as outline, flank, boundary; (3) `Surface` + `SurfaceHandle`; (4) `MasterTable` one header + `filters` row; (5) swatch specimens and tests.

Acceptance (all deterministic; browser check is root's): `vp run @pe/repo-guards#test` green for L0's files; `pane.test.tsx` adds: head is 24 px (`--rail-h`), flank collapsed keeps title text and its hotkey registration, boundary fallback renders while a child suspends, `onRetry` fires from the error body, no `[data-slot=pane-halo]` element exists; `master-table.test.tsx` adds: one `Rail` per table, `filters` row present only when given, search still narrows; `code.test.tsx`: head still shows copy and line count; `/design-system/swatch` renders `Rail` ×2 grounds, `Surface` 2/3/4 cells, flank open/collapsed, boundary fallback and error. `SidePane`, `PaneSplit`, `anatomy/workspace.tsx` and every consumer are **untouched** in L0; whole-repo compile is expected green after L0 because nothing they import changes signature except `Pane` (`headerSurface` kept as an alias for one lane, `PaneSplit` still exported from `pane-resize.tsx`). If it is not green, L0 reports the exact break and stops; it does not adapt.

### Consumer lanes (bounded Terra high, after root accepts; each one worktree, one writer, disjoint files)

| Lane | Files | Delivers | Deterministic acceptance |
|---|---|---|---|
| L1 Chat | `chat/chat-shell.tsx`, `chat/composer.tsx`, `chat/composer-head.tsx`, `chat/thread-palette.tsx`, `workbench/lens/view.tsx`, `workbench/lens.css`, `workbench/lens/scale.ts` (`HEAD_H` → `--rail-h`) | `Surface` pinned; threads flank pane (rail: title+count, mode `Switcher`); transcript pane (rail: thread title + turns; Escape/Mod+1..3); composer as nested pane with the Situation rail and the thread `Picker`; dial column; plugin flank; `.pe-composer-lane`, `--side`, `--map`, `--composer-h` deleted; `ThreadList` New → `SituationAction new`; `window.prompt` rename → `Input` in the row | `composer.test.tsx` and `shell.test.tsx` pass; a test that renders `ChatShell` with a seed and asserts five `[data-slot=pane]` ids; `SidePane` imports in these files = 0. Body Suspense via `useAtomSuspense` lands only with runtime's shell-owned atom (their lane); until then the transcript keeps `useHostCall` and the boundary is inert |
| L2 workspaces | `anatomy/workspace.tsx` (delete), `takeoff/atlas-workspace.tsx`, `takeoff/atlas-{navigation,table,visual}.tsx`, `takeoff/room-panel.tsx`, `family/workspace-view.tsx`, `family/workspace-{anatomy,doc-pane,table}.tsx`, `families/workspace-view.tsx`, `ops/workspace.tsx`, `runs/browser/view.tsx`, `runs/browser/ledger-dock.tsx` | `Surface head={<RouteShell…situation/>}` scroll-away; `PaneWorkspace` cells separated by gutter tracks; `PaneSplit` uses → `Surface` rows + `SurfaceHandle`; table wrappers dropped for the one header | takeoffs `ownership.test.tsx`, `demo-lane.test.tsx`, `live-lane.test.tsx`, families/family tests pass; `PaneSplit`/`Workspace` imports = 0 in these files |
| L3 pinned routes | `routes/settings.tsx`, `routes/data-tables.tsx`, `routes/parameter-links.tsx`, `schedule-grid/workspace.tsx`, `routes/doc-lab.tsx`, `routes/grilles.tsx`, `routes/family-editor-proto.tsx`, `routes/family-review-proto.tsx`, `param-tables/variants/variant-e/view.tsx` | `Surface` pinned; `SidePane` uses → flank panes; hand-rolled `h-screen` mains gone | route tests pass; `SidePane`/`h-screen` = 0 in these files |
| L4 keys | `route/help.tsx` (rows), `route/situation.tsx:344,517`, `chat/thread-palette.tsx:155,204` (after L1), `components/anatomy/key.tsx` → `legend-key.tsx`, `pane.tsx` card block | one `Kbd` in `lang/`; verb hover carries its chord | `shell.test.tsx` asserts the chord in the verb title |
| L-final (root) | `side-pane.tsx`, `pane-resize.tsx` (`PaneSplit`), `anatomy/workspace.tsx`, `headerSurface` alias, `routes/prototype-root.tsx` | deletions; full guard suite; every lane journey re-run in Chrome | `vp run @pe/repo-guards#test` and web tests green repo-wide |

Sequencing: L0 → root acceptance → L1, L2, L3 in parallel (disjoint) → L4 → L-final. Runtime's owner/Activity/`useAtomSuspense` lane (`route/use-route.ts`, `workbench/provider/*`, `workbench/store.ts`, `routes/chat.tsx`, `provider/thread-stream.ts`) is disjoint from L1 by file; the two meet at L-final's Chat journey (switch thread: loading under the new title, sidebar kept; draft typed in A survives B and back).

### Still open (do not block L0)
- Halo colour: `--halo-ink` one token (3b decision 2). The lineup tunes width; a colour variant is a five-minute lineup add if wanted.
- Retained-body TTL (3c): one duration on the family atom; runtime's lane.
- Runtime's inspector note (`atom-inspect.ts` accepts atoms only): if their lane chooses native React state for drafts, the inspector adaptation is theirs to quantify; nothing in this contract depends on it.

## Round 3e — body retention corrected; L0 final (2026-09-16, ~19:45)

Root's correction accepted: the 30-minute idle TTL in 3c is **withdrawn** as a user decision. The user's retention requirement is the unsent draft and attachments per visited thread, not cached transcript bodies. Two things are now separated:

- **Draft and attachments**: retained by `Activity` around the composer region of each visited thread, independent of any body caching. Owner mechanism (shell-owned store versus native React state) is runtime's lane; the surface contract only requires that the composer pane's subtree is what `Activity` hides, which 3d's nested composer `Pane` already is.
- **Thread body** (`Atom.family(threadId => Atom.make(effect))`): default `Atom.autoDispose`. Hiding the transcript unsubscribes, the atom disposes, and reveal reads `Initial` again, so reveal refetches under the pane's own `loading {title}…`. That is the baseline runtime measures first (reveal cost = one body fetch plus one transcript render). Only if that measured cost is unacceptable does runtime bring a concrete tradeoff (bytes retained per visited thread versus reveal ms) for `setIdleTTL`/`keepAlive`; it is a data policy in runtime's lane and never a gate on L0. Nothing in `Pane`, `Rail` or `Surface` changes either way; the pane boundary shows loading on `Initial` in both.

L0 is final as written in 3d: file allowlist, five ordered commits, deterministic acceptance, no adapters, consumers untouched. Ready for Terra dispatch on root's word. The lineup on 5181 stays open for rail and halo tuning; no Chrome interaction from this lane while runtime profiles.

## Round 3f — final ruling folded in; L0 brief and ownership (2026-09-16, ~19:55)

User ruling (final): the composer head shows the **actual turn state** — `ready`, `running`, `waiting for user`, `failed` — as a readout in the Situation rail `trail` beside the chain lamp, derived from the thread's run status (`selectRunStatus`, `agent_end` reason) and never a selectable word. Threads, Trace and World stay **view modes** on the sidebar `Switcher`. Chat declares no stages; nothing in the sentence is a stage picker. This replaces the `status` prop of `composer-head.tsx:78-81` with a typed readout; it is L1's to build and is noted in the L0 brief's out-of-scope list only by omission.

**L0 brief (Terra high):** `C:/Users/kaitp/source/repos/Pe.Tools-unify-surface/docs/features/design-system/L0-FOUNDATION-BRIEF.md`, copied into the L0 worktree at the same relative path. Worktree `C:/Users/kaitp/source/repos/Pe.Tools-l0-surface`, branch `l0/surface-foundation`, cut from `527048f`, one writer (the Terra lane). It contains the file allowlist, the five ordered commits, deterministic acceptance, and the no-adapter rule. Its report lands at `docs/features/design-system/L0-REPORT.md` in that worktree.

**Ownership after L0:** consumer lanes L1 (Chat), L2 (workspaces), L3 (pinned routes), L4 (keys) per 3d, each a fresh sibling worktree from the L0 merge, disjoint files, briefs to be written by this lane once L0's report lists the consumers it broke or left. Runtime's lane stays disjoint by file; the L-final Chat journey is the joint acceptance. Root owns L-final deletions and the whole-repo green claim.

## Round 4 — consumer lane briefs (2026-09-16, ~20:20)

Briefs and exclusive file ownership for L1 Chat, L2 Workspaces, L3 Pinned routes, L4 Keys/tutorial, with the census (missing titles at `takeoff/atlas-table.tsx:48` and `atlas-visual.tsx:38`; eleven routes with no pane; no route manifest declares `docs`; no production table is wrapped in an `ArtifactFrame`, so every table gains L0's header; hand strips at `schedule-grid/workspace.tsx:249-263` and `instances/cluster.tsx:475,498`), source-backed deletion targets, the Chat turn-state mapping from `selectRunStatus` and `thread-stream.ts:91-97`, the sentence thread projection over `openThread` (`store.ts:168`), and eight unresolved cross-lane seams: `C:/Users/kaitp/source/repos/Pe.Tools-unify-surface/docs/features/design-system/CONSUMER-LANES-BRIEF.md`. Root-owned files (provider, store, chat-state, use-route, readings, `routes/chat.tsx`, `chat/manifest.ts`) have no lane writer. Not launched; each lane starts from the L0 merge.

### Round 4b — brief revised after root review (~20:45)

`CONSUMER-LANES-BRIEF.md` updated: chords disclose on hover/focus via `title` only, no visible `Kbd` in verb buttons; the colour-legend rename is dropped (the collision was with `help.tsx`'s private `Key`, which becomes `Kbd`); `PaneWorkspace` and `PaneSplit` stay as the two compositional helpers on `Surface`, only `SidePane` dies; the transcript boundary wraps the scroller only and the composer pane is a sibling outside it (L0 must export its `PaneBoundary`; seam 1 restated for runtime); the dial is a plain cell with accessibility and navigation kept; the turn-state readout derives only from `selectRunStatus` and `streamFault`, body-fetch errors stay in the pane error body, `operationError` stays on the verb, host status stays in the chain lamp, and no `agent_end` reason is fabricated. User's URL draft ruling carried: no ongoing URL text writes, `?prompt` seeds only the initial draft, runtime owns it, no gate in the consumer briefs. One root request: expose `streamFault` separately from the merged `error` at `provider/view.tsx:265`.

### Round 4c — Chat is one combined lane (~21:00)

Root's integration decision recorded in `CONSUMER-LANES-BRIEF.md`: Chat layout and the runtime draft/Suspense cutover share `chat-shell.tsx`, `lens/view.tsx` and the provider, so they are one writer lane after L0 with a combined brief from root; the L1 section is design input only. The inert-boundary stage, the `streamFault` exposure request and the L1/runtime ordering are gone; seams 1, 4 and 6 are restated. L2, L3 and L4 remain independent swarms on their disjoint files.

## Round 5 — gutter/halo colour lineup on the selected A layout (2026-09-16, ~21:40)

Scope: prototype-only edits in `routes/prototype-root.tsx` (this worktree). Layout A, 24 px rails, one table header, composer region untouched. No production CSS, no root edits, no new chrome. Root's integrated screenshots (`Pe.Tools-unify-workspaces/.artifacts/runs/root-browser-20260916/takeoffs-normal.png` et al.) show page-ground gutters with no halo state yet; the two treatments below sit on those token semantics.

### Three states, named once

| State | Meaning | Trigger in the kit today |
|---|---|---|
| resting gutter | nothing is focused here | default |
| focused region | this pane owns the keyboard | `[data-slot=pane][data-active=true]` (`pane.tsx` focus capture) |
| keyboard help | the focused pane's shortcut card is showing | prototype `[data-help]`, set while `[data-slot=pane-shortcuts][data-visible=true]` exists (production would set it from `Pane`'s `cardVisible`) |

Both treatments keep the resting gutter as bare page ground and spend no hue (house law 5: selection and focus are fills, never hues; the only hue on the page stays reserved for the world disagreeing).

### T1 `fill` — the gutter takes the selection fill

- focused region: `outline: var(--halo) solid var(--pe-select); outline-offset: 0` — the 6 px outline lives entirely in the 8 px gutter, so the gutter around the active pane reads as a `--pe-select` band (the same ground the selected row uses).
- keyboard help: plus `box-shadow: inset 0 0 0 1px var(--pe-line-2)` — one inner hairline names "keys are up" without a second colour.

### T2 `line` — the gutter stays ground; one hairline stands in it

- focused region: `outline: 1px solid var(--pe-line-2); outline-offset: 2px` — a single line-2 hairline 2 px into the gutter.
- keyboard help: `outline: 2px solid var(--pe-ink-mute); outline-offset: 2px` — the same line, thicker and one rung darker.

### URL controls (lineup on my dev server, port 5181)

- `http://localhost:5181/prototype-root?variant=A&tone=fill` and `…&tone=line` — click any pane to focus it; press a pane key or focus a pane with `shortcuts` to see the help state; `?help=1` forces the help state on the focused pane.
- Pill buttons: `tone fill|line`, `help 0|1`, `halo 2|3|6`, `gutter 4|6|8|12` (T2 ignores `halo`; its width is fixed at 1/2 px by design).
- Side by side: open two windows with `tone=fill` and `tone=line` and focus the transcript in each.

### Evidence (own Chrome tab, dark theme, 1342×738 capture frame)

Computed styles read from the DOM with the transcript pane's `data-active`/`data-help` set by script (the click-to-focus in the capture batch did not land on a focusable target; a hand click does, verified earlier by `section.focus()` → `data-active=true`):

| Treatment · state | `outline` (computed) | extra |
|---|---|---|
| fill · help | `rgb(51,48,42) solid 5.9px` (= `--pe-select` dark) | `inset 0 0 0 1px` line-2 at 0.26 |
| line · focused | `line-2 (α .13) solid 0.9px`, offset 2 px | — |
| line · help | `solid 1.8px`, offset 2 px | colour read as line-2 in the batch; the `--pe-ink-mute` rule is in the file (`!important`), read again after a fresh load to confirm |
| fill · focused | read as line-2 colour at 5.9 px in the batch | transition timing suspected (`outline-color .12s` from the base focus colour); the help read 300 ms later shows the select colour, so the rule applies |

Zooms of the threads/transcript gutter (region 230,0–530,160): fill focused `…\claude-chrome-screenshots-ydilOc\screenshot-1789605446010-16.png`, fill help `…-17.png`, line focused+help `…-18.png`; earlier full frames `…-11.jpg` (fill) and `…-14.jpg` (line); all under `C:\Users\kaitp\AppData\Local\Temp\claude-chrome-screenshots-ydilOc\`. At dark-theme contrast the select band is deliberately faint (`#33302a` on `#15120d`); the line treatment reads more clearly at a glance and the fill treatment reads more like the kit's selection. Light theme not captured.

### Limits

- Prototype `!important` is a lineup device; production would put these declarations in `pane.tsx`/`lang.css` at the right specificity (the base `[data-pe] :focus-visible` colour currently wins over a plain attribute rule).
- Help state is script-observed in the lineup; in production it is `Pane`'s own `cardVisible`.
- No claim about the integrated routes' look; only the two colour rules on the A layout.

### For the user (one choice, later, once the integrated Chat shape is ready)

T1 fill (gutter band, selection ground) or T2 line (one hairline, gutter stays ground), and whether the help state is the inner hairline (T1) or the thicker mute line (T2). Both keep 24 px rails and the A layout as approved; neither adds chrome. Narrow tutorial and fixed-versus-scroll-away head remain the user's open choices and are not touched here.

## Round 6 — architectural taste review of root's integrated shape (2026-09-16, ~22:10; read-only, root at `ac3821b`)

Delta since `527048f`, `apps/web/src` excluding tests: 72 files, +2682/−1857. Container files now: `pane.tsx` 414, `pane-resize.tsx` 342, `pane-workspace.tsx` 182, `surface.tsx` 58, `rail.tsx` 42, `side-pane.tsx` 172 (zero consumers, deletion already planned). Three findings, ranked; none touches drafts (`ComposerBank` + `Activity`), body identity (`bodyAtoms` family keyed by `[origin, threadId]`, `thread-stream.ts:43-60`), Suspense (`thread-body.tsx:20` `useAtomSuspense`), keyboard help (`Pane` shortcuts/help chart) or the A shape.

### 1 · `Surface` is a padding wrapper, not a root (critical, −≈85 LOC across 14 files)

Evidence: of 14 `Surface` call sites, 13 pass `columns="minmax(0,1fr)"` (`minmax(0, 1fr)` ×4, `minmax(0,1fr)` ×9) and exactly one `SurfaceCell`; the only multi-track use is one `minmax(0,1fr) var(--gutter) minmax(0,1fr)`. The real composition inside every one of them is `PaneSplit` (6 sites) or `PaneWorkspace` (2 sites); Chat itself is `Surface > SurfaceCell > PaneSplit > PaneSplit` (`chat-shell.tsx:232-330`). So `Surface`'s grid, `columns`, `rows` and `SurfaceCell` do nothing except carry `padding: var(--gutter)` and, at 3 sites, the scroll-away `head` (`surface.tsx:35-44`, which is `anatomy/workspace.tsx:35-37` moved). Smallest consolidation: delete `surface.tsx`; the perimeter padding becomes one declaration on the route root that already owns viewport height (`RootComponent`, per the frontier note) or on `[data-chat=surface]`/the route `main`; the scroll-away `head` returns to `anatomy/workspace.tsx` as the one place a head scrolls away; the single two-track site becomes a `PaneSplit`. `PaneSplit`/`PaneWorkspace` remain the two composition helpers, which was the intent of round 4b. Nothing behavioural changes; the grid the user approved is drawn by `PaneSplit`, not by `Surface`.

### 2 · Collapse has two owners per flank (critical, small, −≈35 LOC)

Evidence: `chat-shell.tsx:242` passes `collapse: { collapsed: !sideOpen, collapsedSize: 40 }` to `PaneSplit.resize` and `:251` passes `collapsed={!sideOpen}` to the same flank `Pane`; the plugin flank repeats it (`:299`, `:309`). `pane-resize.tsx:15-31` (`PaneCollapseSpec`: `collapsed`, `onCollapsedChange`, `collapsedSize`, `collapseBelow`), `:69-78` (internal collapsed state and its setter), `:87-93` (collapse-below threshold), `:122-123` (rendered size) and `pane.tsx:79-80,161,168,276,282-297` (`collapsed`, `onCollapsedChange`, `side`, `w-10` rail) both model "this flank is collapsed", and `40` is restated as `collapsedSize` and as `w-10`. Smallest consolidation: `PaneSplit` keeps one boolean `collapsed` (no callbacks, no `collapsedSize`, no `collapseBelow`, no internal state) and sizes the collapsed track `auto`; the flank `Pane` keeps its rail and its expand press. One owner (`store.atoms.expandedPane`, `store.ts:24-28`) writes one boolean that two components read. `collapseBelow` has no production caller to lose (verify with grep before deleting). The same duplication is expected at the three other `PaneSplit` + flank sites (`routes/data-tables.tsx`, `routes/parameter-links.tsx`, `schedule-grid/workspace.tsx`); unverified line-by-line in the 8 minutes.

### 3 · Chat carries a fourth thread-list owner and a folded readout (optional, −≈15 LOC plus a ruling)

Evidence: `chat-shell.tsx:105-108` keeps `deletedThreadIds` in `useState` and `composer-bank.tsx:19-27` keeps a `visited` set filtered by it, while the provider's `threads` (`useWorkbench()`) already drops a deleted thread. `ComposerBank` can derive `composerIds = visited ∩ threads.map(id) ∪ {currentThreadId}` from `threads` and drop the `deletedThreadIds` prop and state; retention semantics are unchanged (a visited, still-existing thread keeps its hidden `Activity` composer). The three owners that remain — `store.ts` (`chat`: palette, expanded pane), `thread-view.tsx` (`chat/thread`: lens keys, intent, world; 110 lines keyed by thread), `ComposerBank` (React-local drafts) — match runtime's contract and are not redundant with each other; leave them. Separately, `chat-shell.tsx:159-176` folds `operationError` and the loading/connecting words into the composer readout ahead of `turnFailure`; the final ruling was an explicit turn-state derivation with `operationError` staying on the verb and loading in the pane boundary. That is a ruling conformance point for root's Chat review, not a LOC item.

### Not proposed
`Rail` (42 lines, one owner of head geometry) and `pane.tsx` growth (boundary, flank, headerless) are the approved shape. `PaneWorkspace` (182 lines, 2 consumers) could in principle be two nested `PaneSplit`s, but its inspector-span rule and the takeoffs sizes make that a redesign, not a deletion; not filed. No comment on the pending viewport/head choice.

### Round 6 — corrections after root review (~22:25)

- **Finding 3 withdrawn; retention claim was wrong.** Deriving `ComposerBank`'s ids from the provider's `threads` would prune a draft for a new thread that does not yet exist on the server, which was a proven draft-loss bug. Explicit deletion authority (`deletedThreadIds`, set only after `deleteThread` succeeds, `chat-shell.tsx:106-108`) is required and stays. "Retention unchanged" in the original line does not hold; disregard finding 3.
- **Finding 1 (`Surface`)**: not authorized. Any deletion must keep the actual scroll-away head and container owners; root judges. User ruling recorded: scroll-away head is preserved; narrow layout is a spatial map with scrolling.
- **Finding 2 (collapse owners)**: root assesses the unused branches; no implementation from this lane.
- `side-pane.tsx` is now deleted by root; the round-6 LOC baseline line is stale by that amount.

### Round 6 — second correction (~22:35)

- **Finding 2 withdrawn as proposed.** `collapseBelow` has production consumers I did not grep: `takeoff/atlas-workspace.tsx:65`, `family/workspace-view.tsx:194`, `schedule-grid/workspace.tsx:200`, `routes/data-tables.tsx:208`, `runs/browser/view.tsx:277,323`, `routes/grilles.tsx:203`, `routes/parameter-links.tsx:313`. Callback-controlled collapse is real resize behaviour (drag past the threshold collapses; the callback writes the owner). Two components reading one controlled boolean from `store.atoms.expandedPane` is one state owner, not two; my "two owners" framing was wrong. No replacement redesign is proposed.
- **Finding 1 narrowed.** The generic `columns`/`rows`/`SurfaceCell` grid remains a candidate for deletion (13 of 14 sites use one cell), but the perimeter padding must stay with one shared owner; replacing `Surface` with padding written at 14 call sites is not the proposal. Root judges the owner and the timing; nothing is authorized from this lane.

### Round 5 — user verdict and the halo stacking cause (~22:45)

**User verdict:** T2 `line` for sure. Root's foundation implements the shared layering with a 1 px line focus and a 2 px strong help state at offset 2. Recorded; no further design from this lane.

**Stacking cause (source, root at `ac3821b`, same in the prototype):** the resize handle occupies the whole gutter track and is raised above the panes. `pane-resize.tsx:167` root class is `veil group z-raised …`, sized `w-(--gutter)`/`h-(--gutter)` (`:173-174`), while `Pane`'s root is `relative` with no z-index (`pane.tsx:37`) and draws its halo as an `outline` at offset 0 into that same gutter (`pane.tsx:278-279`). An outline paints in its element's stacking order; the handle, a later sibling with `z-index` raised, paints over it, so the halo edge that faces a handle (the right edge of the transcript, the left edge of the plan pane) never shows, and the `veil` hover ground covers it fully on hover. Edges facing the perimeter or a handle-less gutter paint correctly. The prototype's `[data-slot=pane-halo]` span had the same relation to `PaneResizeHandle`, which is why its right edge was reported missing. Fix is root's: either the handle stops being `z-raised` (it only needs to sit above page ground, not above panes) or the active pane is raised while active; no lineup change.
