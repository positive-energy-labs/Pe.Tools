# /takeoffs — design-language audit

What the takeoffs surface needed that `components/lang` + the `--r-*` canon could not say, recorded
during the design-language sweep of 2026-08-16. Takeoffs is **consumer #2 of the cell-state clause**
and the first real consumer of `Verb`/`FactChip`/`OutcomeLine` outside the design-system exhibit, so
the friction here is evidence about the language's interface, not a complaint about this route.

Governance for this pass: `components/lang/*`, `components/master-table/*`, `design-lang.css`
tokens, and the state-model axes were **not** changed. Where the language could not express
something, the code was left honest and the gap written down below. These are for joint review;
nothing here is a decision.

> **Boundary note.** A concurrent cell-scale ruling (single-line clipped cells + a table readout
> band) owns `components/master-table/` and `components/lang/`. Findings #1, #5 and #11 all propose
> edits inside that boundary and none were made — #11 records a four-line change that was made,
> committed, and then reverted when the boundary was drawn. Every proposal below is input to that
> ruling, not a claim on it.

Companion ledger of open stand-ins: [`SHIMS.md`](SHIMS.md). Language canon:
[`../../design/SURFACE-PHILOSOPHY.md`](../../design/SURFACE-PHILOSOPHY.md),
[`../design-lang/CLEANROOM.md`](../design-lang/CLEANROOM.md),
`apps/web/src/design-lang.css` (the header is the law).

---

## A · State census

Every distinct value/outcome state `/takeoffs` renders, against the cell grammar's five axes
(**origin** `stagedBy` · **freshness** `fresh` · **agreement** `agree` · **staging** `stage` ·
**capability** `cap`) and the **outcome lane** (`OutcomeKind`). "—" means the axis says nothing
about this state; **bold** marks a state with no axis at all.

### The room-state vocabulary (`atlas.tsx` `RoomState` — four words, one derivation)

| # | state | means | origin | fresh | agree | stage | cap | outcome | verdict |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `call` | an open detector flag **or** the .r10 no longer matches the model | — | — | `drift` (only the .r10 half) | — | — | — | **half-expressible** — flag half has no axis (#2) |
| 2 | `unreviewed` | no Manual J data has ever been entered | — | — | — | — | — | — | **unmappable** (#3) |
| 3 | `data` | Manual J entered in the session overlay, not exported | `you` | — | — | `staged` | — | — | expressible |
| 4 | `synced` | exported and the .r10 still agrees | — | `fresh` | `agree` | `clean` | — | — | expressible |

Two of four map. The column therefore **stays on `stateColumn`** (a route-owned dot + label), not
the `state:` clause. See #1.

### Cell/row facts

| # | fact | axis | rendered as, after the sweep |
|---|---|---|---|
| 5 | `.r10` never exported | **none** — `fresh: "unverified"` borrowed (#3) | `state:` column, "not exported" + muted squiggle |
| 6 | `.r10` area drift | `agree: "drift"` ✅ | `state:` column, alarm squiggle + struck ghost of the last synced sf |
| 7 | `.r10` linked and agreeing | `agree: "agree"` + `fresh: "fresh"` ✅ | `state:` column, unmarked |
| 8 | N open detector flags (`unhomed-proposal`, `orphaned-region`, `r10-file-mismatch`, `r10-not-open`, detector calls) | **none** (#2) | hand-rolled `flags` column on `--r-alarm`, with a multi-valued `match` |
| 9 | verdict decided **this session**, write-through not confirmed | **none** (#4) | invisible — the flag simply leaves the open list |
| 10 | verdict written onto the Room Region blob | — | provenance `Line` in the room panel |
| 11 | Manual J field never entered (`room.data === null`) | `fresh`-ish, unused | `opacity-50` on the `NumberCell` (unchanged; #5) |
| 12 | room with a label point but no detected boundary | seam ✅ | dashed circle on both plans + a dashed `FactChip` |
| 13 | zone with no rooms ("not partitioned") | **none** (#3) | outlined empty `ZoneStateBar`, hairline (was dashed) |
| 14 | zone below 60 sf, excluded from the plan | **none** | rail row at 55% opacity, labelled "off-plan scribble" |
| 15 | held residue (area the partitioner abstained from claiming) | seam ✅ | dashed SVG path, `--r-ink-mute` |
| 16 | accounting closure — closed / N sf unaccounted | — | `FactChip` `done` / `alarm` |
| 17 | system over the 32,000 Btu/h sensible cap | **none** | prose line in the zone card (unchanged; #6) |
| 18 | level captured this session / never captured | **none** | verb label flips `capture` → `re-capture`; drives the partition refusal |
| 19 | adopt-panel region already stamped | — | `FactChip` `done` |
| 20 | fixture lane vs live lane | seam ✅ | dashed `FactChip` in the header and bottom-right |
| 21 | room geometry still loading | outcome `busy` ✅ | `OutcomeLine` |
| 22 | a host operation in flight | outcome `busy` ✅ | `OutcomeLine` |
| 23 | a host call failed | outcome `error` ✅ | `OutcomeLine` (was a dashed **seam** chip — a real bug, #12) |
| 24 | a sync/open receipt | outcome `receipt` ✅ | `OutcomeLine` |
| 25 | sync gates: untagged zones, blocked zones, nothing eligible | outcome `advisory` ✅ | `OutcomeLine` + the commit verb's own refusal |
| 26 | pre-sync Manual J edits in the session overlay | `stage: "staged"` ✅ *in principle* | **not rendered** — the overlay has no draft home (#7) |
| 27 | zone `Stage` (7-word pipeline label: declared…drifted) | **none** — this is a *container* label, not a row state | `ReadCell`, muted, with the disclaim in the column title |

**Unmappable count: 8 of 27** (#1, #2, #5, #8, #9, #11, #13, #14, #17, #18, #27 partially — the
strict "no axis whatsoever" set is 2, 3-as-borrowed, 9, 13, 14, 17, 18, 27).

---

## B · Findings

> **RULED 2026-08-16 — the consolidation batch** (CLEANROOM "consolidation batch" section;
> autonomous sweep session, grilled against docs, re-openable). Mapping: #2 → R3 (row fact,
> gutter marker — no sixth axis) · #3 → R2 (`fresh: "never"` shipped) · #4 → R12 (`useVerb.fail`
> carries the kind; the item link stays open) · #5(a) → R8 (editable `StateCell` shipped) ·
> #5(b) → declined — the readout band and column `title` are the column-reason's home; no new
> slot (§6: no designed-but-unused slots) · #7 → R8 · #8 → R13(a) (locate mark is `--r-ink`
> where a fill cannot separate — blessed) · #9 → R13(b) (SVG dasharray occupies the dashed
> slot — confirmed) · #11 → R5 (`verdict:` column replaces `stateColumn`; tone narrowed).

### 1 · The four-word room-state vocabulary is not the cell grammar, and cannot be

**Surface fact.** `/takeoffs` derives one four-state progress word per room (`call`, `unreviewed`,
`data`, `synced`) and renders it identically on three surfaces — the rail's segment bars, the plan's
room fills, and the table's state column. That "one vocabulary, three surfaces" property is a
SURFACE-PHILOSOPHY §1 requirement the route already satisfies.

**What the language lacks.** The `state:` column clause renders `StateCell`, whose facet word comes
from `cellStateLabel` — a fixed seven-word vocabulary (`drift · proposed · staged · stale ·
unverified · clean · locked`). Adopting the clause for this column would replace the route's
vocabulary with the grammar's, and two of the four words have no equivalent (#2, #3). The route
would then say "clean" where it means "no Manual J entered" — a confident wrong statement, which is
the exact failure class §0 says these surfaces cannot ship.

**Left honest.** The column stays on `master-table/cells.tsx` `stateColumn`. Only its tones moved
onto the meaning band (`--r-alarm` / `--r-ink-mute` / `--r-caution` / `--r-done`).

**Proposed resolution.** Either (a) `StateColumn` grows an optional `label: (row) => string` that
overrides the facet word while `StateCell` keeps drawing the marks — the marks are universal, the
*word* is domain — or (b) `stateColumn` is blessed as the canonical second form for surfaces whose
state is a domain pipeline rather than a value's pseudo-dimension, and gets a `lang`-native
implementation. (a) is cheaper and preserves "the word cannot disagree with the marks" as long as
the label is derived from the same function the tones are.

> **RULED 2026-08-16 (joint review, kaitpw + main session):** (a), landed as `StateColumn.word`.
> The marks stay universal; the word may be the route's; sort stays attention order. Accepted
> with standing skepticism of state growth — a consolidation pass over the whole state
> vocabulary is queued to squash responsibilities where axes can merge. `stateColumn`'s
> deletion is the discharge path: takeoffs' room-state column migrates onto `state:` + `word`
> in a follow-up, then `stateColumn` dies (also discharges #11).

### 2 · No axis for "a human decision is queued here"

**Surface fact.** A room carries a set of open detector flags. Each is a call a person must accept
or dismiss; until they do, the room blocks the sync. This is the route's single most important
state and its whole reason to exist.

**What the language lacks.** None of the five axes says "a verdict is owed". `agree: "drift"` is the
closest and is wrong: a detector flag such as `unhomed-proposal` is not the model disagreeing with a
value — it is the *machine* declining to decide. `stage: "proposed"` is also wrong: that means *pea*
proposed a value, and it takes the cell body, which a flags column has no value to fill.

**Left honest.** The `flags` column stays hand-rolled, on `--r-alarm`, with its multi-valued
`match` predicate (`any open` / `none open` / one named flag).

**Proposed resolution.** A sixth axis — call it `owed: "verdict" | null` — or an explicit ruling
that queued human work is a *row* fact rather than a *cell* fact, and belongs in the gutter marker
SURFACE-PHILOSOPHY §4 already describes ("a gutter marker … carries a count, and the mark *locates*
while the decision is made where the evidence is"). Takeoffs' room panel is already that "where the
evidence is"; only the gutter is missing.

### 3 · "Not started" has no rung — and §1 explicitly demands one

**Surface fact.** Three distinct takeoffs states are "nothing has ever been attempted here": a room
with no Manual J data, a room with no `.r10` line, and a zone with no materialized rooms.
SURFACE-PHILOSOPHY §1 says in terms: *"'Not started' is a state, not a zero"*.

**What the language lacks.** The five axes have no rung for it. `fresh: "unverified"` is documented
as "never checked", which is close but is a statement about the *age of a reading*, and its squiggle
rank sits below `stale` in a family about how trustworthy an existing value is.

**Forced, and marked.** The `.r10` state column borrows `fresh: "unverified"` for "never exported".
This is the one place in this pass where a rung was borrowed rather than left empty, because the
alternative — no axis — makes the facet word "clean", which is a lie. It renders correctly (muted,
"never checked") but the *reason* it renders that way is not the reason the language documents. The
other two cases (#11, #13) were left with no axis at all.

**Proposed resolution.** Add `fresh: "never"` (or `stage: "absent"`) as an explicit rung with its
own render — most likely no squiggle at all, just `--r-ink-mute` — so "never attempted" and "checked
long ago" stop sharing a mark.

### 4 · An optimistic verdict has no rendering between "pressed" and "written"

**Surface fact.** Pressing accept/dismiss marks the flag locally and *then* writes it onto the Room
Region blob. Between those two moments the row already looks decided. If the write fails, the route
surfaces an error elsewhere on the page and the row silently keeps its optimistic state.

**What the language lacks.** `stage: "staged"` is the right shape ("your unsaved event is sitting on
this") but it is a *cell body* treatment for a value, and a verdict is not a value in a cell. There
is no "in flight, not yet acknowledged" mark for a row.

**Left honest.** Unchanged behaviour; the route's error lane is the only signal, and it is now an
`OutcomeLine` rather than a seam chip.

**Proposed resolution.** This is the same hole as `OutcomeLine`'s documented "outcomes are orphans"
gap — an outcome carries no link to the verb or the item that produced it. Fixing the link fixes
both: a failed receipt could then un-stage the row it names.

### 5 · The cell grammar has no "faded until entered" and no dense mode

**Surface fact.** Five Manual J number columns render editable inputs faded to 50% until the room
has data. Typing any number creates the data and un-fades the row.

**What the language lacks.** `StateCell` renders text, never an input — "do not steal the caret" is
about decorations *inside* an editable cell, but no editable cell in the language exists yet. So the
Manual J columns cannot use the grammar at all, and their "empty" treatment (`opacity-50`) is a
route invention.

Separately: `StateCell`'s `capReason`, `note` and `grounding` all render on a **footline**, i.e. a
second line. In a table where *most* rows would carry the same reason (every never-exported room),
that doubles row height for a fact that belongs to the column, not the row. There is no
column-level reason slot, so the `.r10` column drops `capReason` and puts the explanation in the
column `title` instead — where a newcomer has to hover, which is the exact defect `Verb.reason`
exists to prevent.

**Proposed resolution.** (a) An editable `StateCell` variant, which is the real fix and which the
families sweep will need too. (b) `ColumnBase` grows `reason?: string` rendered once in the header,
with `capReason` reserved for row-specific refusals.

### 6 · `FactChip` cannot carry a sentence

**Surface fact.** The retired `takeoff/seam.tsx` `Seam` chip carried multi-clause explanations —
*"no Room Region home yet — partition must materialize this room before a decision can be
written"*. Those sentences were the honesty device: each said what would replace the stand-in.

**What the language lacks.** `FactChip` is an 18px inline pill with a mono 10px body. It is a
*fact*, deliberately, and prose does not fit. Every such sentence in this pass was split: the short
noun goes in the chip, the sentence goes in the chip's (required) `title` — i.e. into a tooltip.
SURFACE-PHILOSOPHY §0: *"Tooltips deepen; they never rescue."* This is a rescue.

**Left honest.** The chips carry the short form; nothing was deleted, but the sentences are now one
hover away rather than on the surface.

**Proposed resolution.** A `SeamNote` in `components/lang` — chip-marked, block-level, dashed edge,
one clamped sentence — or an explicit ruling that the stand-in *sentence* lives only in
`docs/features/<surface>/SHIMS.md` and the surface carries the numbered reference. The second is
cheaper and matches §3's ledger rule, but costs the reader the sentence at the point of confusion.

### 7 · Unsaved work with no home is invisible to the grammar

**Surface fact.** Manual J edits and room renames live in the route's `SessionOverlay` until a sync
moves them into the `.r10`. They die with the tab. `world.ts` already calls this out as a seam.

**What the language lacks.** Nothing, in principle — `stage: "staged"` + `stagedBy: "you"` is
exactly this, with bold reserved for it. But the grammar can only mark it on a `StateCell`, and the
Manual J columns are inputs (#5). So the one state the language is *best* equipped to render is the
one state this route cannot hand it.

**Proposed resolution.** Blocked on #5(a). Worth naming as the strongest argument for an editable
`StateCell`: "bold is reserved for unsaved, everywhere, always" is currently unenforceable in any
column a user can type into.

### 8 · Selection on a spatial view cannot obey the fill law

**Surface fact.** The level plan and the zone peek mark the cursor room with an SVG stroke and fill
over the designer's own zone colours.

**What the language lacks.** *"Selection and focus are a fill, never a hue — only ever
`--r-select`"*, and `--r-select` is the ground ladder's fourth rung: a near-page warm grey. As a
stroke over a coloured plan it is invisible; as a fill it is indistinguishable from the plan
background. The route previously used `--primary` (= `--r-commit`), spending the one filled blue on
"where am I" — a straightforward law violation.

**Resolved locally, needs blessing.** The cursor now draws in `--r-ink` — neutral, so no hue is
bought, and the highest-contrast mark available. This satisfies the *spirit* (no hue) but not the
*letter* (only ever `--r-select`).

**Proposed resolution.** Extend the law: "selection is `--r-select` as a fill, `--r-ink` as a mark
where a fill cannot separate" — and say so in `design-lang.css`, since the family and ops surfaces
will hit it the moment they draw anything.

### 9 · The dashed budget: what takeoffs was spending it on

`dashed` is reserved for SEAM. Takeoffs carried **seven** dashed spends across three meanings.
Disposition:

| where | old meaning | disposition |
|---|---|---|
| `seam.tsx` `Seam` chip | stand-in | ✅ legal — component retired, replaced by `FactChip dashed` |
| `ZoneStateBar` empty bar | "not partitioned" | ❌ → firm hairline `--r-line-2` |
| `LevelStats` unpartitioned segment | "not partitioned" | ❌ → firm hairline `--r-line-2` |
| `LevelPlan` room stroke when `call` | "needs attention" | ❌ → removed; separates on alarm hue + 1.75px stroke |
| `ZonePeek` room stroke when `call` | "needs attention" | ❌ → removed, same treatment |
| `LevelPlan` / `ZonePeek` residue path | held / abstained | ✅ kept — declared area with no element behind it *is* the seam reading |
| `ZonePeek` "no boundary" circle | position known, shape unknown | ✅ kept, and **added** to `LevelPlan`'s equivalent circle for consistency |
| `zone-plan.tsx` `PlanLegend` flagged chip | "needs a decision" | ❌ → file's dead half deleted (nothing imported it) |

**Open question for review.** The law is written about `border-style`. SVG `stroke-dasharray` is a
different CSS mechanism occupying the same *slot* — §2's "one meaning per shape, and a mark drawn by
a different CSS mechanism still occupies the same slot" says it counts. This pass treated it as
counting. If that is wrong, the residue and no-boundary marks are free and the law should say so.

### 10 · `Verb`'s refusal has no lane-level form

**Surface fact.** On the fixture lane all four header verbs refuse for one reason: there is no
document. `Verb` renders its `reason` under each disabled control, so the header rendered the same
sentence four times across one row — which reads as a rendering fault, not as honesty.

**What the language lacks.** `VerbGroup` labels a lane but has no refusal slot, and `Verb` has no
way to defer its refusal to its group.

**Worked around, not solved.** Each verb now carries a *short, verb-specific* fixture line
("fixture · no document to stamp into", "fixture · no .r10 to sync into", …). This is better copy
regardless, but it is a workaround: the underlying repetition returns whenever a whole lane refuses
for a genuinely shared reason — e.g. every verb during a `busy` transaction.

> **RULED 2026-08-16 (joint review):** the visible under-line refusal is deleted from `Verb`
> entirely — the reason stays a required constructor argument but its home is the title. That
> dissolves the repetition (and the wide/wrapping header this finding described) without a
> lane-level refusal slot; revisit only if hover-height reasons prove insufficient in practice.

**Proposed resolution.** `VerbGroup` gains `refusal?: string`; when set, it renders once at the
group head and its children suppress their own refusal lines (keeping them as `title`).

### 11 · `stateColumn`'s alarm branch still spends the viz ladder — a visible split, deliberately left

**Surface fact.** `master-table/cells.tsx` `StateMeta.tone` is an unconstrained `string`, so a
consumer can hand it any CSS colour. Takeoffs handed it `var(--cat-clay)`, `var(--cat-slate)`,
`var(--cat-green)` — three *taxonomy* colours carrying *state*, precisely the violation these route
passes exist to fix, and the type could not prevent it. Worse, the primitive **hard-codes** the
alarm word's colour: `stateColumn` renders `className={meta.alarm ? "text-cat-clay" : …}`, so even a
consumer that supplies a correct `tone` cannot get a correct *label*.

**Left as-is, and it shows.** The route half is fixed (`STATE_META` now spends meaning roles), but
the primitive half is **not touched** — `components/master-table/` is under a concurrent cell-scale
ruling and belongs to that session. The visible consequence, until the two halves meet: in the
takeoffs state column, a "needs a call" row draws its **dot** in `--r-alarm` (rust) and its **word**
in `--cat-clay` (= `--viz-5`, kiln). One state, two hues, side by side in one cell.

That split is the honest rendering of a boundary, not a regression to hide: it is the same defect
SURFACE-PHILOSOPHY §1 names — *"one three-way state is currently drawn in two hue vocabularies"* —
now reproduced inside a single cell where it cannot be missed.

**Proposed resolution.** Two edits, both in the primitive, both for the ruling session to make or
decline: (a) drop the hard-coded `text-cat-clay` for `text-[var(--r-alarm)]`, since the prop is
already named `alarm` and the one-alarm law has exactly one colour; (b) narrow `tone` to a union of
the meaning-role tokens so the next consumer cannot hand it a viz colour. If #1's resolution lands
instead — `StateColumn` growing a `label` override so domain vocabularies ride the real `StateCell` —
`stateColumn` disappears and both edits are moot.

**Provenance.** This pass did originally make edit (a) plus two comment corrections, and landed them
in `b52d891`. They were reverted in the follow-up commit when the boundary was drawn; the working
tree is byte-identical to pre-sweep `cells.tsx`. `git show b52d891 -- …/master-table/cells.tsx` has
the four-line diff if the ruling session wants it.

### 12 · Fixed en route: an error was wearing the seam chip

**Surface fact.** `routes/takeoffs.tsx` rendered every failed host call inside `<Seam>` — the dashed
stand-in chip. A bridge failure was therefore claiming "this part of the surface is a fixture".
Not a language gap; a straight misuse, recorded because it is the kind of drift a reserved shape is
supposed to make findable. Now an `OutcomeLine kind="error"` (caution, not alarm — *"a busy bridge
is NOT the model disagreeing"*).

---

## C · What migrated

| | count | notes |
|---|---|---|
| `Verb` | 15 | atlas 8: 4 header (1 `nav:out`), 2 zone `commit` in a `VerbGroup`, 2 verdict (tone derived from the lane). route 7: 2 adopt (1 `commit`, 1 `nav:back`), 2 sync (1 `commit`), fixture-entry, fixture-exit, error-dismiss |
| `FactChip` | 12 | atlas 9: doc identity, fixture lane, `.r10` path, zone calls, closure, verdict-lane ×3, no-boundary. route 3: fixture lane, stamped, adopted count |
| `OutcomeLine` | 7 | atlas 2 (busy, geometry-loading). route 5: reading, error, advisory ×2, receipt |
| `state:` columns | 1 | `.r10` — consumer #2 of the clause |
| honest labelled empties | 4 | no zones on level, no sessions, no filled regions, nothing eligible |
| illegal `dashed` re-expressed | 4 | plus 1 legal one added; see #9 |
| modals on `ui/dialog` | 2 | adopt + sync; the hand-rolled overlay had no focus trap, no `role`, no Esc, and a fake "esc ×" label |
| dead code deleted | ~460 LOC | `takeoff/seam.tsx` (whole file, `Step` never consumed), `atlas.tsx` `Peek` + `nextAction`, `zone-plan.tsx` `ZonePlan` + `PlanLegend` + `Chip` |

**Files touched:** `takeoff/atlas.tsx`, `takeoff/zone-plan.tsx`, `takeoff/seam.tsx` (deleted),
`routes/takeoffs.tsx`. Nothing under `components/`.

**Shim lines deleted from `styles.css`: none.** Every token takeoffs gave up (`--cat-clay`,
`--cat-green`, `--cat-slate`, `--cat-blue`, `--line`, `--line-2`, `--line-soft`, `--primary` as a
state) still has between 8 and 30 other consumers. The shim's line count does not move until the
ops, family, workbench and grounded-doc passes land.
