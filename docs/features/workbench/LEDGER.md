# workbench ledger

## Decided
- 2026-08-16 — The user gets NO identity hue; `--user`/`--user-tint`/`--user-line` deleted. Authorship is already carried by four redundant channels (right-aligned filled block vs left prose, "you"/"pea" head labels, speaker-handoff hairline, alternating mapdial bands) — in grayscale nothing is lost, which is the viz ladder's own test. The asymmetry is the design: **the agent is the marked case, the human is the ground.**
- 2026-08-16 — Do NOT grow the cell-grammar axes toward conversations. Only 2 of 28 workbench states map onto fresh/agree/stage/cap; the outcome lane plus the meaning roles carried 26 of them with no new token, no new axis, no sixth colour. The outcome lane IS the conversational grammar.
- 2026-08-16 — Streaming (the blinking `mg-caret` in `--r-pea`) is an agent-identity mark, not an outcome kind: nothing machine-shaped is in flight and there is no receipt. Recorded so nobody "fixes" it into an `OutcomeLine`.
- 2026-08-16 — An owed approval renders at the tool marker where the evidence is, not in a gutter — the chat has no gutter, and putting the decision beside its evidence is R3's spirit.
- 2026-08-16 — A dangling target pin wears the ALARM: the pin is a claim ("this chat acts against session X") and the world no longer contains X, so the claim disagrees with reality — the drift family's top rank. Counter-reading (nothing the *model* said is contradicted) would fall back to caution; one line in `TARGET_RAIL_COLOR` (Lens.tsx).
- 2026-08-16 — Inferred values (cache state, cache horizon, token estimates) are marked by a literal "≈" prefix + title provenance on SOLID marks — the squiggle uncertainty family lives on `StateCell`, which this surface cannot use, and inventing an off-cell inferred mark would be a language extension.
- 2026-08-16 — The mapdial's `↓` jump-to-tail is NAV (blue text `--r-nav`, no fill): within-page movement. A reading, not a written law — neutral ink act costs nothing if review disagrees.
- 2026-08-16 — Send in the composer IS a legal filled blue: it writes beyond the page.

## Tried & rejected
- 2026-08-16 — Dashed as a general "provisional/partial" mark: all six spends on this surface were wrong slots (dashed = seam). Tool rail → solid pea (a tool call is real); "on demand" pill → neutral mono, the label carries it; empty picker → `EmptyState` with exit (scope-empty, not a seam); reflect floor → solid caution hairline; cache horizon → solid `--r-ink` locate tick (was dashed BLUE). Zero dashed spends remain; the surface has no true seam state since the fixture lane died.
- 2026-08-16 — Blue as a provenance/busy hue: the empty-thread "Pea" hero was `--pe-blue` (the agent's own name in blue — pea is never blue), the focal-turn rule and mapdial reticle were blue/provenance-hued (now neutral ink, R13a), plan status spent blue-for-busy and viz-for-pending.
- 2026-08-16 — Four hover idioms (`bg-paper-2`, `bg-muted`, `primary/10`, opacity) and four selection idioms (blue border-left, paper+inset-shadow, `--primary` tints, `data-selected:bg-paper-2`): collapsed to the one veil and the one `--r-select` fill.
- 2026-08-16 — `--fail` for evaluation issues and `Metric issue`: blocking machine refusals wear the alarm (refused → alarm is legal), attention COUNTS wear caution.
- 2026-08-16 — `components/document-chips.tsx` (391 LOC): dead, zero importers, deleted.

## Owed
- Nothing counts owed approvals — with three pending in a long thread, nothing outside the transcript says "3". Needs an `owed` outcome kind or a mapdial approval-tick count, both gated on outcomes gaining their verb/target link (design-lang ledger, Owed).
- `host/target-ui.tsx` NEEDS AN OWNER (~40-line shared-file ruling): `toneColor`/`LiveDot`/`LaneBadge`/`laneVar` still spend `--pe-blue`, `--cat-*`, `--line-2` — including BLUE for "pinned" (a selection state wearing the commit hue) and viz hues carrying state (kiln = ambiguous, clay = dangling). Consumers: `workbench/Lens.tsx` (worked around locally), `components/chat-target.tsx` (NOT worked around — old hues render inside migrated chrome), `ops/`. No route pass owns `host/`, so the last `--pe-blue`/`--cat-*` consumers cannot be freed.
- `Verb` has no icon-only or render-prop form; three `ui/button` imports survive on it — composer send/stop/attach, plugin-pane close ×, control-chips Combobox trigger.
- Two type stretches to review: role heads ("you"/"pea") use `t-label t-upper`, which carries section-head semibold — a weightless `t-upper` does not exist; and `doc-picker`'s 8px mono went to `t-caption` (10px floor), making picker rows two px taller.
- Composer keeps a hand-built artifact treatment (ground shift + hairline) because `ArtifactFrame`'s layout didn't fit a form. (verify)
- `workbench/route-workspace-shell.tsx` now has zero importers — delete it. (Also tracked in the settings ledger.)
- Still-consumed legacy tokens this pass could not free: `--paper` (sentence.tsx), `--pe-blue`, `--pe-green`, `--lichen`, `--line`, `--line-2`, `--line-soft` (ui primitives, ops, host). (verify)
