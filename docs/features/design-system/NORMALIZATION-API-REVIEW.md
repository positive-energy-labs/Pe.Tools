# Normalization API review — challenging the closed pane grammar

Surface partner, 2026-09-17. Read-only against root `C:/Users/kaitp/source/repos/Pe.Tools` at `40b711c` ("Set the pane normalization contract", ledger line 17). Paths under `source/pe-tools/apps/web/src/`. Bound: 15 minutes; counts are `wc -l` and grep at that commit.

## What the contract says versus what the code is

| Contract word (ledger 2026-09-17) | Code at `40b711c` | Gap |
|---|---|---|
| `Surface` owns viewport and 8 px perimeter, optional scroll-away head | `surface.tsx` (30 lines): `padding: var(--gutter)`, `head` → `main overflow-y-auto` + `sticky` body | matches |
| `PaneLayout` owns recessed 8 px gutters and resizing | there is no `PaneLayout`. Three owners: `PaneSplit` (`pane-resize.tsx:245-342`, 6 sites), `PaneWorkspace` (`pane-workspace.tsx`, 182 lines, 2 sites), `anatomy/workspace.tsx` (56 lines, 4 sites). Gutters are **page ground**: no rule anywhere recesses `[data-slot=pane-split]`/`[data-slot=pane-workspace]` tracks (`base.css`, `lang.css`, `design-lang.css` grep: only `--gutter: 8px`) | one name, three components; "recessed" is unimplemented |
| `Pane` owns 24 px rail, focus/help outline, standard 8 px body inset, explicit `flush` | rail and outline yes (`pane.tsx:301-330`, `:276-282`). Inset: only `kind="inspector"` gets `p-2` (`:48`); every other kind is 0; `family/workspace-view.tsx:179` reaches in with `[&_[data-kind=inspector]_[data-slot=pane-body]]:p-0` to undo it. No `flush` prop exists (grep `flush` → only a comment and a store verb) | inset is per-kind accident, not a default; `flush` is a word, not code |
| artifacts | `ArtifactFrame` (65) with `head`/`headTrail`/`foot` on `Rail`; `Code` and `MasterTable` each render their own frame | matches; nesting rule unwritten (below) |

## Smallest public API (four components, one new prop, one removed layer)

```ts
Surface   { head?: ReactNode; children }                                   // unchanged (30 lines)
PaneSplit { axis; start; end; resize?: PaneSizeSpec & { target }; grow? } // unchanged; THE PaneLayout
Pane      { kind; id?; title?; meta?; help?; actions?; toolbar?; headerless?; headerSurface?;
            side?; collapsed?; onCollapsedChange?; boundary?; boundaryKey?; onRetry?; scroll?;
            flush?: boolean;   // NEW: no body inset; the child owns its edges (tables, plans, code)
            children }
ArtifactFrame { head?; headTrail?; foot?; label?; className?; children }   // unchanged
Rail      { ground?; lead; trail?; edge? }                                  // unchanged
```

- **Inset**: `pane-body` gets `p-2` (8 px) by default for every kind; `flush` removes it. Delete the `inspector: p-2` variant (`pane.tsx:48`) and the family override (`family/workspace-view.tsx:179`). Edge-owning bodies today that must pass `flush`: the `MasterTable` panes (`takeoff/atlas-table.tsx`, `family/workspace-table.tsx`, `families/workspace-view.tsx`, `schedule-grid/workspace.tsx`, `routes/data-tables.tsx`, `runs/browser/view.tsx` ledger dock), the plan/anatomy visuals (`takeoff/atlas-visual.tsx`, `family/workspace-anatomy.tsx`, `routes/grilles.tsx` drawing), the Chat transcript and composer (`chat/chat-shell.tsx:180,191`), the settings file editor. Roughly 12 call sites gain one word; the default serves the inspectors, thread list, forms and prose panes.
- **`PaneLayout` = `PaneSplit`.** Rename nothing; retire the name from the ledger line. `PaneWorkspace` and `anatomy/Workspace` are deleted (below).

## Deletions (exact)

| Delete | LOC | Replaced by | Consumers to rewrite |
|---|---|---|---|
| `components/lang/pane-workspace.tsx` | −182 | nested `PaneSplit`: `⟨nav ‖ ⟨⟨visual ‖ inspector⟩ / content⟩⟩` for `inspectorSpan="visual"`; `⟨nav ‖ ⟨⟨visual / content⟩ ‖ inspector⟩⟩` for `"full"`. Each is three `PaneSplit`s with the same `resize` specs and `persist` keys the workspace passes today (`NAV_DEFAULT` 288/200, `VISUAL_DEFAULT` 340/140, `INSPECTOR_DEFAULT` 320/240 move to the two call sites) | `anatomy/workspace.tsx` (dies too), `routes/grilles.tsx:189-200` (+≈12 lines) |
| `components/anatomy/workspace.tsx` | −56 | `<Surface head={headRail}>{readout}{layout}</Surface>` written at the route | `takeoff/atlas-workspace.tsx` (+≈22 lines of nested splits), `family/workspace-view.tsx` (+≈14), `families/workspace-view.tsx` (+≈4), `ops/workspace.tsx` (+≈4) |
| `pane.tsx:48` `inspector: { body: "overflow-y-auto p-2" }` → `"overflow-y-auto"`; body gets `p-2` unless `flush` | ±0 | `flush` prop (+≈4) | +1 word at ≈12 sites |
| `family/workspace-view.tsx:179` className override | −1 | `flush` on the doc pane | — |
| `data-slot="readout-band"` wrapper (`anatomy/workspace.tsx:36-40`, `px-2 py-1.5`) | −5 | the readout is `Rail ground="page" lead={…}` at 24 px, or stays a plain band at the route; either way not a fifth spacing idiom | takeoffs, families |
| `PaneWorkspaceProps`/`paneWorkspaceRecipe` exports in `pane.tsx:415-416` and the swatch `RecipeGrid` for it (`ui-layout.tsx`) | −≈40 | — | swatch |
| ledger word `PaneLayout` | — | `PaneSplit` | docs |

Estimated net: −284 primitive lines, +≈70 at six call sites, ≈ **−210** before the prop-count effect (`inspectorSpan`, `resize.{navigation,visual,inspector}`, `grow` on `PaneWorkspace`, `headRail/table/sidePanel/readoutBand/navigation/visual/pane/className` on `Workspace` all go; nothing new except `flush`).

**Prop-explosion check.** The worst consumer, takeoffs, goes from one `<Workspace>` with seven named slots to three nested `<PaneSplit>`s with `resize` objects; that is ≈22 lines of JSX in one file, all of it geometry the route already owns (`takeoff/atlas-workspace.tsx` already builds `headRail`, `readoutBand`, `sidePanel`). No prop is added to `PaneSplit`; `inspectorSpan` becomes nesting order, which is the honest form of that choice. Family and grilles are two splits each. Families and ops never used the grid (`visual == null` branch, `workspace.tsx:41`) and become `Surface` + `Pane`. So the fold is a net simplification, not a relocation of the same props.

## Rulings the review asks root to write (each one line)

1. **Nested artifacts**: an artifact never wraps another artifact's chrome. Today `Code` (`code.tsx:169`) and `MasterTable` (`master-table.tsx:213`) draw their own `ArtifactFrame`; `workbench/lens/context-strip.tsx:32-71` wraps a frame around content that includes framed `Code` blocks. Rule: a frame's body may contain framed objects only at page ground (the transcript), never a frame directly inside a frame's body; `context-strip` drops its outer frame (≈−6). The prototype's "table inside transcript" already reads correctly because the transcript pane is page ground.
2. **Recessed gutters**: either implement `[data-slot=pane-split] { background: var(--pe-recess) }` (one rule; `Surface` padding stays page ground so the perimeter reads as the frame's mat) or strike "recessed" from the contract. With a recess, the 1 px `line-2` outline at offset 2 still sits inside the 8 px gutter and above it because the active pane is `z-sticky` (`pane.tsx:276`) and the handle is `z-raised` (`pane-resize.tsx:167`); confirm `z-sticky > z-raised` in the z ladder before recessing, since a recess makes a covered edge visible.
3. **Scroll-away head stays in `Surface`** (`surface.tsx:17-28`); after `anatomy/Workspace` dies, the four workspace routes call it directly. No second scroll boundary; `ops/workspace.tsx:119` `className="p-4"` becomes a `Surface` child with its own inset, not a workspace prop.
4. **24 px rails are complete** except two bands that are not rails: `Pane.toolbar` (`pane.tsx:334-339`, `py-1`, wraps) and the readout band. Rule the toolbar as the one wrapping second row (it is the filter row's sibling) and the readout as a `Rail` or a route-drawn band; no third spacing.

## ADOPT / KILL

| Item | Verdict |
|---|---|
| `Surface { head, children }` as the one viewport/perimeter/scroll-away owner | ADOPT |
| `PaneSplit` as the only layout composer (`PaneLayout` is its name in prose) | ADOPT |
| `PaneWorkspace` | KILL (−182; three nested splits) |
| `components/anatomy/Workspace` | KILL (−56; `Surface` + splits at the route) |
| `Pane.flush` boolean with 8 px body inset as the default for every kind | ADOPT |
| `kind="inspector"` owning the only inset; family `p-0` override | KILL |
| `inspectorSpan` | KILL (nesting order) |
| `Pane.collapsed/onCollapsedChange` + `PaneSplit.resize.collapse` | ADOPT (one controlled boolean, two readers; `collapseBelow` has 7 consumers) |
| `ArtifactFrame` head/headTrail/foot on `Rail` | ADOPT |
| frame inside a frame body (`context-strip.tsx:32-71`) | KILL (rule 1) |
| "recessed gutters" | ADOPT only with the one background rule and the z-ladder check; else strike the word |
| `readout-band` as a fifth spacing idiom | KILL (rail or route band) |
| `Rail.edge` | ADOPT (foot only; one prop, one consumer) |
