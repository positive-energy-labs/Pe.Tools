# @pe/web

Web's primary purposes are 1. chat UI for pea and 2. make a better web UI.

## Before you write UI

Read `docs/features/design-system/NORMALIZATION.md` — it names who owns which value, the authoring
decision flow (`Press` vs `Verb` vs link, `title` vs `HelpTip`, type tier × face × case, seam vs
reference vs void), and the enforcement commands. `docs/design/SURFACE-PHILOSOPHY.md` says what a
surface is for. `/design-system` is the executable law; a position that can render lives there.

`tests/repo-guards/src/design-guard.test.ts` is the lint and every category is a hard zero. Run
`vp run @pe/repo-guards#test` from `source/pe-tools` before you claim a change is done. A guard
change lands as ruling plus code plus guard in one commit; rulings go to
`docs/features/design-system/LEDGER.md`.

A green guard proves one owner per value. It proves nothing about how a surface reads. Hover,
focus, placement and legibility are browser claims — name the lane.
