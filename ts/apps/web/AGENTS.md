# @pe/web

Web's primary purposes are 1. chat UI for pea and 2. make a better web UI.

## Before you write UI

Read `docs/features/design-system/NORMALIZATION.md` — it names who owns which value, the authoring
decision flow (`Press` vs `Verb` vs link, `title` vs `HelpTip`, type tier × face × case, seam vs
reference vs void), and the enforcement commands. `docs/design/SURFACE-PHILOSOPHY.md` says what a
surface is for. `/design-system` is the executable law; a position that can render lives there.

`tests/repo-guards/src/design-guard.test.ts` and `design-adherence.test.ts` are the lint: some
categories are hard zeros, the rest are ratchet baselines that must fall and never rise. Run
`vp run @pe/repo-guards#test` from `source/pe-tools` before you claim a change is done. A guard
change lands as ruling plus code plus guard in one commit; rulings go to
`docs/features/design-system/LEDGER.md`.

A green guard proves one owner per value. It proves nothing about how a surface reads. Hover,
focus, placement and legibility are browser claims — name the lane.

## The design language laws (settled 2026-08-31)

Call sites declare state; the language CSS owns what state looks like. Concretely:

1. **Typography ground.** `[data-pe] body` sets the value tier. Unstyled text is in-system by
   default; a `t-*` tier is a deviation, never a restatement. Tiers are pinned at component
   recipes (so a component reads identically inside any tier region), defaulted at the body,
   and restated nowhere. Check: `vp run --no-cache @pe/web#type-sweep -- <url> <routes…>`
   (add `--probe-t-value` to hunt redundant tiers).
2. **Tone.** Meaning color rides `data-tone={alarm|caution|done|commit|nav|pea}` (ink) and
   `data-tone` + `data-wash` (the one canonical tinted fill). Raw meaning utilities
   (`text-alarm`, `bg-done/12`, …) outside `components/` are a guard red with a 0 baseline.
3. **Selection.** The select ground rides `aria-selected` / `aria-expanded` / `aria-pressed` /
   `data-selected`, never `token("select")` or `bg-select` at call sites.
4. **Lines and planes.** Separators are `hairline-{t,b,l,r,x,y}[-2]`, `hairline-rows`,
   `hairline-*-faint` (0.5px), `boundary-*` (2px strong); planes are
   `data-surface={page|artifact|recess|document}`. Raw `border-* border-line` pairs and raw
   `bg-page`/`bg-artifact` outside components live on a shrinking allowlist
   (`design-allowlist.baseline.json`); do not add to it.
5. **Theme.** Every dual-theme token is one `light-dark()` declaration in `base.css`. Dark mode
   is the `.dark` class plus inline `color-scheme` (set by the theme toggle); a class-only
   toggle resolves `light-dark()` wrong — test theme claims through the real toggle.
6. **Density (settled 2026-08-31, density round 1).** Two heights, both in `base.css`:
   `--item-h` (20px) for every list-shaped row — table row, menu/combobox/command item,
   pick-list item, `Verb` — and `--control-h` (24px) for every freestanding control. Author them
   as `h-(--item-h)` / `min-h-(--item-h)` / `h-(--control-h)`; a raw `h-7`/`h-6` on a row or
   control is a restatement. A third height is a ledger decision, not a call-site improvisation.

New vocabulary lands as: the CSS role in `components/lang/lang.css` or `design-lang.css`, its
registration in the guard's `AUTHORING`/loader lists, a guard that fails when it is misused,
and a ledger line — one commit.
