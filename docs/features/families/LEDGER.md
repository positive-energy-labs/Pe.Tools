# families ledger

`/families` is the fleet lane — the `MasterTable` audit of every loaded family × every parameter. The single-family workspace is a separate feature (`docs/features/family/`).

## Decided

- 2026-08-16 — the plan verdict (`unplanned` / `outside profile` / `no actions` / `excluded` / `included` / `applied` / `failed`) is a ROW-level pipeline verdict, not a value's pseudo-dimension: only 1 of 7 words maps to a cell axis, so rendering them on the cell grammar would show six distinct states as "clean". it is a second legitimate column form, not a shim awaiting `StateColumn.word`. R5 then landed this as the typed `verdict:` clause on `MasterTable` and deleted the string-typed `stateColumn` renderer.
- 2026-08-16 — verdict tones ride the meaning band only: `--r-done` applied, `--r-alarm` failed, `--r-caution` included (queued actions are unsaved work), `--r-ink-mute` for the four quiet words. Commit blue deliberately NOT spent on `included` — the one filled blue belongs to the verb that writes.
- 2026-08-16 — derived/formula-driven cells dropped OFF the meaning band to `--r-ink-2` rather than land on a wrong role; `--r-done` is wrong (a formula does not *land*, it *computes*) and `cap: "readonly"` is a claim about the user, not the number. R4 then ruled derived is not a state — no `--r-derived`, ever.
- 2026-08-16 — outcome kind is DERIVED from the payload (`applyData?.refused ? "refused" : "error"`), never a maintained flag; `useVerb.fail(kind, text)` (R12) is the `lib/` half of the "outcomes are orphans" fix.
- 2026-08-16 — the head collapses to ONE rail in fixed order: route name as chrome · addressing sentence (clickable nouns, receipt replaces it briefly) · machine-measured `FactChip`s in rank order freshness→dirtiness→seam · the ONE verb whose blast radius is the whole page · fixture/seam chip right-aligned. A verb acting on one pane belongs in that pane's strip; anything that does not fit the five slots has a better home. `/families` recomposed onto `AddressingBar` — `apply` on the rail, `plan` and `project → profile` into the table strip.
- 2026-08-16 — `EmptyState` requires `story: "scope" | "filter"` and `exit` as constructor arguments, the same enforcement that makes `Verb.reason` work; 12 `/families` empties migrated, both `EMPTY_CLASS` constants deleted at zero consumers.
- 2026-08-16 — `dashed` is reserved for SEAM: the two typed-but-unproven bridge ops wear `FactChip dashed`; unbound/ghost state is NEVER dashed (a frozen literal is the opposite of a stand-in).
- 2026-08-16 — `ui/verb` and `ui/chip` survive with zero product consumers because `/design-system/swatch` imports them as superseded-specimen exhibits; retiring the files is the exhibit's call, not a route pass's. Shim lines `--st-derived` and `--st-ground` deleted (zero consumers repo-wide).
- 2026-08-16 — sweep governance for this pass: `components/lang/*`, `components/master-table/*`, `design-lang.css` tokens and the state-model axes were not changed; where the language could not say something the code was left honest and the gap written down. Gaps become numbered findings, never unilateral language changes.

## Tried & rejected

- 2026-08-16 — adopting `state:` + `word` for the seven-word plan verdict: would render six of seven as an unmarked cell wearing a route label — marks saying nothing while the word says everything, a worse failure than the route's own dot.
- 2026-08-16 — a shared `EMPTY_CLASS` constant instead of a component: consistent-looking but nothing enforces the `title` and nothing separates "nothing in scope" from "filtered to nothing". Superseded by lang `EmptyState`.
- 2026-08-16 — migrating type-override cells onto the editable `StateCell`: an override-less cell would render EMPTY, claiming "no value" where the cell resolves to the authored one — a confident wrong statement. Left on `ProposedCell` + `TextCell`.
- 2026-08-16 — route title `FAMILIES` in `--clay-ink` (= `--r-alarm`) and the `included` dot in `--pe-blue` (= `--r-commit`): straight hue-law violations, not language gaps; both moved to neutral ink / caution rank. Reserved colours exist to make these findable.
- 2026-08-16 — forked `Verb` copy in `routes/families.tsx` deleted: it made `reason` optional and so shipped refusals with no explanation.

## Owed

- No axis for "not started": `fresh: "unverified"` means "never checked", which is not the same claim as "no question was asked". R2 ruled a `fresh: "never"` rung in and `/families` was ruled-discharged by riding the `verdict:` column instead — confirm nothing still borrows the wrong rung. (verify)
- No axis for "a human decision is queued here" (`excluded` in the decision queue) — R3 ruled it a row fact wanting the SURFACE-PHILOSOPHY §4 gutter marker; the marker is not built. Takeoffs owes the same finding (its flags column stays hand-rolled until the marker exists).
- `outside profile`, `only-live` and "a parameter the family does not carry" remain unmappable/half-mapped: `cap` is about editing, not about claiming. 11 of 30 censused states had no axis.
- Narrow `StateMeta.tone` to a meaning-role union (takeoffs owes the same edit, diff preserved in `b52d891`) if `stateColumn` survives as the sanctioned row-verdict form.
- Rule whether `ProposedCell` is the permanent sanctioned wrapper for inherited-resolution, or `StateCellProps.placeholder?: string` ships — its docblock should say so either way.
- `onLocate?: () => void` on `StateCellProps` so the proposal fold stays a real hit target; without it, migrating a proposed editable cell silently deletes the cell-level locator and leaves only the rail dot.
- SVG `stroke-dasharray` vs CSS `border-style: dashed` are different mechanisms in the same reserved slot and were treated as one; `design-guard.test.ts` matches only the kebab form, so JSX `strokeDasharray` dashes are invisible to the ratchet — add the camelCase form plus a baseline entry.
- Two bridge ops are typed but never live-proven (the dashed seam chips are the standing admission).
- The family-foundry `/families` v1 has no pea proposal engine and per-family plan flags are limited to "no actions" — deliberate gaps, revisit only when the pain proves recurring.
- (/family-scoped, recorded here because the 2026-08-16 sweep audit was joint — fold into the family ledger if ever revisited) Phase-D 2026-08-17: `ArmingState.refused` wants `refusals: {code, says}[]` not one string; ArmingStrip owes a `building` in-flight phase and an unknown-outcome phase (an `ok` with no rfaPath is neither success nor refusal); refused-phase exit is hardcoded to `re-plan` and wants `exit: {label, onExit}`; "capture live" (a read) collides with "capture all" (a crossing); arming survives drill-in but cannot be initiated there — wants a ruling.
- (/family-scoped, same caveat) Phase-C 2026-08-17: the dash law needs an explicit annotation scope (parts may dash only for void; datums and leaders are a different register); reference planes have no taxonomy rung (a hairline is a SEAM spend, not an identity); frames and the room point have no focus vocabulary (`Focus` is `param | part` only).
