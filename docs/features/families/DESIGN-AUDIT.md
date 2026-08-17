# /families + /family — design-language audit

What the two family surfaces needed that `components/lang` + the `--r-*` canon could not say, recorded
during the design-language sweep of 2026-08-16. `/families` is the fleet lane (the `MasterTable`
audit of every loaded family × every parameter); `/family` is the single-family workspace, which in
this pass was **promoted out of the clean-room prototype** — variant e stopped being `?variant=e`
and became the route.

Governance for this pass: `components/lang/*`, `components/master-table/*`, `design-lang.css`
tokens, and the state-model axes were **not** changed. Where the language could not express
something, the code was left honest and the gap written down below. These are for joint review;
nothing here is a decision.

Companion audit, same sweep, same format: [`../takeoffs/DESIGN-AUDIT.md`](../takeoffs/DESIGN-AUDIT.md).
Language canon: [`../../design/SURFACE-PHILOSOPHY.md`](../../design/SURFACE-PHILOSOPHY.md),
[`../design-lang/CLEANROOM.md`](../design-lang/CLEANROOM.md), `apps/web/src/design-lang.css` (the
header is the law).

---

## A · State census

Every distinct value/outcome state the two routes render, against the cell grammar's five axes
(**origin** `stagedBy` · **freshness** `fresh` · **agreement** `agree` · **staging** `stage` ·
**capability** `cap`) and the **outcome lane** (`OutcomeKind`). "—" means the axis says nothing
about this state; **bold** marks a state with no axis at all.

### `/families` — the plan verdict vocabulary (`familyState`, seven words, one derivation)

| # | state | means | origin | fresh | agree | stage | cap | outcome | verdict |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `unplanned` | no plan compiled yet — the table is scope, not judgment | — | — | — | — | — | — | **unmappable** — "not started" has no rung (#5) |
| 2 | `outside profile` | in scope, but the bound profile does not claim it | — | — | — | — | `excluded`-ish | — | **half-expressible** — `cap` is about editing, not claiming |
| 3 | `no actions` | the plan compiled and lowered nothing here | — | — | — | — | — | — | **unmappable** |
| 4 | `excluded` | held back by hand in the decision queue | — | — | — | — | — | — | **unmappable** — a human decision, not a value state (#4 of takeoffs' #2) |
| 5 | `included` | N lowered actions queued, nothing written | `you` | — | — | `staged` | — | — | expressible |
| 6 | `applied` | the op wrote it and receipted the counts | — | — | — | — | — | `receipt` | outcome-expressible only |
| 7 | `failed` | the op refused or errored on this family | — | — | — | — | — | `refused` | outcome-expressible only |

One of seven maps onto a cell axis. The column therefore **stays on `stateColumn`**, tones only. See #1.

### `/family` — the agreement vocabulary (`variant-e` `Agreement`, six words)

| # | state | means | origin | fresh | agree | stage | cap | outcome | verdict |
|---|---|---|---|---|---|---|---|---|---|
| 8 | `agree` | the profile and Revit carry the same value | — | `fresh` | `agree` | — | — | — | expressible |
| 9 | `drift` | the profile and Revit disagree at this type | — | — | `drift` ✅ | — | — | — | expressible |
| 10 | `derived` | a formula authors it; Revit's number is an output | — | — | — | — | `readonly` | — | **half-expressible** — `cap` says "cannot edit", not "computed" (#3) |
| 11 | `only-profile` | the profile has the parameter, the family does not | — | — | — | — | `nohome` ✅ | — | expressible as a SEAM |
| 12 | `only-live` | Revit has it, the profile does not claim it | — | — | — | — | — | — | **unmappable** |
| 13 | `unread` | the last read did not report it — unknown, not absent | — | `unverified` | — | — | — | — | borrowed (#5) |

### Cell / row facts across both routes

| # | fact | axis | rendered as, after the sweep |
|---|---|---|---|
| 14 | the family-foundry bridge ops are typed but never live-proven | seam ✅ | dashed `FactChip` ×2 (`/families`) |
| 15 | the `/family` route is running on a fixture world | seam ✅ | dashed `FactChip` in the header |
| 16 | a plan hash / a recompiled hash | — | `FactChip` (`alarm` when the two differ) |
| 17 | per-family apply receipt (applied / failed) | outcome `receipt`/`refused` | `FactChip` `done` / `alarm` in the receipts table |
| 18 | a host read in flight | outcome `busy` ✅ | `OutcomeLine` |
| 19 | the bridge is disconnected | outcome `error` ✅ | `OutcomeLine` (caution — a dead bridge is not the model disagreeing) |
| 20 | plan diagnostics (block the whole apply lane) | outcome `error` ✅ | `OutcomeLine` per diagnostic |
| 21 | projection diagnostics (block nothing) | outcome `advisory` ✅ | `OutcomeLine` |
| 22 | apply refused on a stale plan hash | outcome `refused` ✅ | `OutcomeLine`, kind derived from `applyData.refused` (#4) |
| 23 | a parameter driven by a formula (`/families` cell) | **none** | quiet `--r-ink-2` ink; was `--cat-lichen` (#3) |
| 24 | a parameter bound at the project, not the family | **none** | `--r-ink-mute` + italic |
| 25 | a parameter the family does not carry at all | **none** — `cap: "excluded"` is close | 50% `--r-ink-mute` |
| 26 | pea's open proposal on a cell | `stage: "proposed"` ✅ *in principle* | route-drawn fold + rail dot — the cells are inputs (#6) |
| 27 | your own value overtaking a proposal ("superseded") | **none** | muted settled card in the sidebar (#7) |
| 28 | a cell the draft would write to disk ("unsaved") | `stage: "staged"` ✅ *in principle* | route-drawn bottom-left square — the cells are inputs (#6) |
| 29 | a geometry literal no parameter drives ("unbound") | **none** | route dot + `bind…` verb on the state column (#8) |
| 30 | a refused commit, said where it was refused | outcome `refused` ✅ *in principle* | route-drawn `RefusalNote` chip — must not resize the row (#9) |

**Unmappable count: 11 of 30** (#1, #3, #4, #12, #23, #24, #25 partially, #27, #29; plus #10, #13
as borrowed rungs).

---

## B · Findings

> **RULED 2026-08-16 — the consolidation batch** (CLEANROOM "consolidation batch" section;
> autonomous sweep session, grilled against docs, re-openable). Mapping: #1 → R5 (`verdict:`
> column — the second form is blessed, lang-native, `stateColumn` dies) · #2 → R9 (`EmptyState`
> shipped: required `story` + `exit`) · #3 → R4 (derived is not a state; no `--r-derived`,
> ever) · #4 → R12 (`useVerb.fail`) · #5 → R2 (`fresh: "never"`) · #6 → R8 (editable
> `StateCell` with refusal folded in) · #7 → R6 (sever leaves NO cell trace — ledger only,
> owed specimen closed by ruling) · #8 → R3 (row fact, gutter marker) · #9 → R8 (refusal is
> the editable cell's job) · #10 → R13(b) · #11 → R11 (`AddressingBar` shipped).

> **ADOPTED 2026-08-16 — the adoption pass** (same sweep, after the consolidation batch
> landed in `components/lang`). What each ruling's shipped primitive now actually carries on
> these two routes: **#2 RULED-DISCHARGED** — all 20 labelled empties (plus one the census
> missed) migrated onto lang `EmptyState` with per-site `story` judgments and required exits;
> both `EMPTY_CLASS` constants deleted at zero consumers (`family/model.ts`,
> `routes/families.tsx`). **#5 RULED-DISCHARGED for `/families`** — `unplanned` rides the
> `verdict:` column, which never needed the rung; `/family`'s `unread` deliberately keeps its
> route word (the live column's `·` already marks it — two marks for one fact stays worse
> than one). **#6 PARTIALLY DISCHARGED** — the ghost literal cell, the inspector's unbound
> literal, and the family-level value now ride the editable `StateCell` (stage/stagedBy for
> pea's fold and your caution square, refusal returned from `onCommit`, `onNavigate` wired to
> the table's cell navigation); the TYPE-OVERRIDE cells stayed honest on
> `ProposedCell` + `TextCell` — see the two new findings #13 (inherited placeholder) and #14
> (the fold is a locator). **#9 RULED-DISCHARGED** — `RefusalNote` deleted from
> `family/marks.tsx`; both refusing editors return the reason from `onCommit` and the cell
> restores + says why itself. **#11 RULED-DISCHARGED** — `/families` recomposed onto
> `AddressingBar` (this pass) beside `/family` (the reference): `apply` is the one page-blast
> verb on the rail; `plan` and `project → profile` moved into the table's own strip per the
> standing rule.

### 1 · The plan-verdict vocabulary is not the cell grammar, and cannot be — again

**Surface fact.** `/families` derives one word per family from the plan lens: `unplanned`,
`outside profile`, `no actions`, `excluded`, `included`, `applied`, `failed`. It is a **pipeline
verdict about a row**, computed from the plan and the receipts, not a pseudo-dimension of a value.

**What the language lacks.** Exactly one of the seven has an axis (`included` ≡ `stage: "staged"`).
Adopting `state:` + `word` would render the other six as an unmarked cell wearing a route label:
the marks would say *nothing* while the word said everything, which is a worse failure than the
route's own dot, because a reader who has learned the marks would read six different states as
"clean". This is takeoffs finding #1 reproduced on a second route with a *seven*-word vocabulary,
which is evidence that the `word` override alone does not discharge `stateColumn`.

**Left honest.** The column stays on `master-table/cells.tsx` `stateColumn`. Only the tones moved
onto the meaning band: `--r-done` (applied), `--r-alarm` (failed), `--r-caution` (included, because
queued actions are *unsaved work*), `--r-ink-mute` (no actions / excluded / outside profile /
unplanned). The commit blue was deliberately **not** spent on `included`: a state dot is a fill, and
the one filled blue belongs to the verb that writes.

**Proposed resolution.** `StateColumn.word` was ruled in on the strength of takeoffs' four-word
vocabulary, where two words mapped. At seven words with one mapping, the honest read is that
`stateColumn` is not a shim awaiting `word` but a **second, legitimate form**: a row-level pipeline
verdict, as distinct from a value's pseudo-dimension. If that is accepted, it wants a `lang`-native
implementation (`StateMeta.tone` narrowed to the meaning-role union, per takeoffs #11(b)) rather
than a deletion path.

### 2 · There is still no `EmptyState`, and this route needed twelve

**Surface fact.** `/families` has twelve places where the honest answer is "nothing here yet, and
here is what would fill it": bridge disconnected, no loaded families, no categories drafted, no
family resolved, the two combobox pickers, no profiles readable, the profile-library truncation
notice, the decision queue claiming nothing, no receipts, nothing projected, and the table's own
three-branch empty. `/family` adds eight more: no spec attached (×2 — text mode and sheet mode), no
shape to draw, no proposals, no parameters, no rows to reconcile at a type, a parameter that drives
nothing, an ungrounded parameter, and a constituent with no declared geometry.

**What the language lacks.** `components/lang` renders no labelled empty — SURFACE-PHILOSOPHY §1
already names this (*"Specimen owed when an EmptyState primitive ships"*). The pass was told not to
invent one, and did not.

**Left honest, and consistently.** Every empty now wears one shared class constant (`EMPTY_CLASS` —
italic, `--r-ink-mute`, 11px; one per surface) and carries a `title` saying what would fill it, so
the twenty read as one vocabulary rather than twenty improvisations. The cost of a class constant
instead of a component is that nothing enforces the `title`, and nothing separates §4's two kinds —
*"nothing in scope"* (the route's story) from *"filtered to nothing"* (the surface's own).

**Proposed resolution.** `EmptyState` in `components/lang` with a REQUIRED `story: "scope" | "filter"`
discriminant and a REQUIRED `exit: string` — the same constructor-argument enforcement that makes
`Verb.reason` work. Twenty call sites across two routes are waiting for it, plus takeoffs' four.

### 3 · No role for DERIVED — and the shim already admits it

**Surface fact.** Both routes distinguish a value a formula computes from a value someone authored.
`/families` marks formula-driven parameter cells; `/family` marks a formula's family-level line, its
locked type cells ("driven"), and the `ƒ` mark in the drill-in spine.

**What the language lacks.** There is no `--r-derived`. `styles.css` says so in as many words —
`--st-derived: var(--r-done); /* SHIM: derived has no --r-* role; joint-review finding */` — so a
route migrating off `--st-derived` has nowhere correct to land. `--r-done` is wrong (a formula did
not *land*, it *computes*), and `cap: "readonly"` is close but says "you cannot write here", which
is a statement about the user rather than about the number.

**Left honest.** Every derived spend dropped OFF the meaning band rather than onto a wrong role:
`/families`' formula cells are now `--r-ink-2` (the comment beside them already claimed "quiet ink",
so this makes the code match its own docblock), and `/family`'s derived marks are `--r-ink-2` too,
separating from a project binding by italic rather than by hue. Nothing is lost but the hue; the
tooltips carry the meaning.

**Proposed resolution.** Either (a) a `derived` rung on `cap` (`"editable" | "readonly" | "derived" |
"excluded" | "nohome"`) whose body treatment is the locked one plus the `ƒ` glyph, or (b) an explicit
ruling that derived is not a state at all and rides the ink ladder forever — in which case the
`--st-derived` shim line can be deleted the day its last consumer goes, and COLOR-ROLES should say so.

### 4 · An outcome cannot say WHICH write produced it, so the route has to sniff

**Surface fact.** `/families` funnels three unrelated failures through one `error: string` on
`useVerb`: a thrown host call (a bridge fault), an op-level `refused` (a plan-hash mismatch — the
model disagreeing), and a success path with something to say ("the profile claims no loaded family").
These want three different `OutcomeKind`s: `error`, `refused`, `advisory`.

**What the language lacks.** Nothing, in the outcome *vocabulary* — all three kinds exist. What is
missing is the LINK: `OutcomeLine`'s own docblock names it ("outcomes are orphans"), and `useVerb`
has no place to carry the kind alongside the string.

**Left honest, and derived rather than remembered.** The kind is computed from the payload —
`applyData?.refused === true ? "refused" : "error"` — which satisfies §3's *"make the claim a
function of state, not a maintained flag"*. It is still only two-thirds right: the advisory case
("the profile claims no loaded family") renders as `error`, i.e. caution, when it blocks nothing.

**Proposed resolution.** `useVerb` grows `fail(kind, text)` beside `setError`, and its `catch`
defaults to `error`. That is a `lib/` change, not a `lang/` one, so it is available to the next pass
without touching the governed boundary — and it is the cheap half of the "outcomes are orphans" fix
(takeoffs #4 wants the *item* link too).

### 5 · "Not started" and "never read" are still one rung, and both routes borrow it

**Surface fact.** `/families` renders `unplanned` — nothing has been asked of this row yet. `/family`
renders `unread` — the last read did not report this parameter, so its live value is UNKNOWN.
These are different claims: one is "no question was asked", the other is "the question was asked and
came back silent".

**What the language lacks.** `fresh: "unverified"` is documented as "never checked" and is the only
rung either can reach. This is takeoffs finding #3, unchanged, now with two more consumers.

**Left honest.** `/family` keeps `unread` as its own word on `stateColumn` (dim `--r-ink-mute`) and
does NOT borrow `fresh: "unverified"`, because the row also has a live column saying `·`, and two
marks for one fact is worse than an unmarked one. `/families` leaves `unplanned` with no axis.

**Proposed resolution.** Unchanged from takeoffs #3: an explicit `never` rung with no squiggle,
distinct from `unverified`.

### 6 · The cell grammar still cannot render an editable cell — and `/family` is nothing but editable cells

**Surface fact.** `/family`'s whole thesis is a spreadsheet: parameter × type, every cell an
`input`. Two of its most important marks are exactly what `StateCell` was built to draw — pea's open
proposal (`stage: "proposed"`, `stagedBy: "pea"`) and a value the draft would write to disk
(`stage: "staged"`, `stagedBy: "you"`).

**What the language lacks.** `StateCell` renders text, never an input, so the route draws both marks
itself: a 7px pea corner fold and an inset pea underline for the proposal, a 4px caution square in
the diagonally-opposite corner for unsaved. Those are *the same two marks the grammar specifies*,
re-implemented — which is the fork SURFACE-PHILOSOPHY §6 exists to prevent, and it is unavoidable
until an editable variant ships.

This is takeoffs finding #5(a) and #7, restated by the surface that needs it most: `/family` is the
strongest argument for an editable `StateCell`, because it is 100% editable cells and it has
independently arrived at the grammar's own marks.

**Left honest.** The route's marks were re-tinted onto the real roles (`--r-pea` / `--r-pea-ink` for
pea's fold and ring, `--r-caution` for the unsaved square) so that when the primitive ships the
migration is a deletion, not a redesign.

**Proposed resolution.** `StateCell` grows `onCommit?: (text: string) => void`; when present it
renders its value slot as a caret-safe input and every mark stays outside the text box (the
"do not steal the caret" law is already written for exactly this). Blocked on nothing but the ruling.

### 7 · SEVER has no rendering, and `/family` is the surface that ships it

**Surface fact.** `/family` implements *"typing beats proposing"* literally: committing your own
value into a proposed cell severs every open proposal at that coordinate. The proposal card settles
to "superseded by your edit" — muted, deliberately not green, because nothing of pea's was adopted.

**What the language lacks.** SURFACE-PHILOSOPHY §3 already records it: *"`StateCell` has no `stage`
member for severed and cannot render the state at all"*, with a specimen owed. `/family` is the
shipping consumer that owed specimen was waiting for.

**Left honest.** The severed verdict lives only on the sidebar card, in `--r-ink-mute`. The CELL
shows nothing at all — it is simply an ordinary edited cell, which is arguably correct (the
proposal is gone; there is nothing left to mark) but means the table cannot answer "which cells did
I overtake pea on".

**Proposed resolution.** Either `stage: "severed"` with its own (probably very quiet) mark, or an
explicit ruling that sever leaves NO cell trace and lives only in the proposal ledger — which is
what this route does today, and which is defensible. Ruling either way closes the owed specimen.

### 8 · No axis for UNREACHABILITY — the ghost-row state

**Surface fact.** `/family`'s ghost rows are the round-3 law: a bindable geometry dimension that no
parameter drives. It is not drift (both sides carry the same number), not staleness, not a proposal.
It is that the number **cannot be said** — no type can differ on it, no schedule can read it, no
formula can reach it. Its one verb is `bind`.

**What the language lacks.** `cap: "nohome"` is the nearest and is about the wrong thing: it means
"this record has no home to be written into", which is a fact about the *storage*, and it renders as
the reserved dashed seam. Unbound is not a stand-in — the number is completely real; what is missing
is a handle on it.

**Left honest.** The ghost rows keep a route-drawn `unbound` dot + word, retinted from `--st-warn` to
`--r-caution`, plus the row tint. `dashed` was NOT spent on them, deliberately — the seam edge means
"stand-in", and a frozen literal is the opposite of a stand-in.

**Proposed resolution.** Probably not an axis. This looks like the same shape as takeoffs #2 ("a
human decision is queued here"): a ROW fact with one verb attached, which SURFACE-PHILOSOPHY §4
already describes as the gutter marker's job. Two routes have now independently invented a row-level
"this one needs a person, here is its one verb" affordance; that is the thing to design.

### 9 · A refusal must not resize the row, and `Verb.reason` cannot say it

**Surface fact.** `/family` refuses two empty commits out loud (a parameter with no family value; a
geometry literal emptied to nothing). SURFACE-PHILOSOPHY §3: *"A rejected commit must visibly restore
the previous value AND say why, near the cell, without resizing the row."*

**What the language lacks.** `Verb.reason` is the constructor-argument enforcement for a *control's*
refusal. A refused *commit* is a different thing — it belongs to a cell, it arrives after the fact,
and it must be dismissible. There is no `lang` component for it, and `OutcomeLine` is a block-level
lane, not a thing you can hang off a table row.

**Left honest.** The route keeps its own `RefusalNote`: absolutely positioned so the row cannot grow,
`--r-caution`, dismissible, with the full sentence in the title. The refusal ALSO says itself in the
header receipt, so it is not lost if the note is dismissed.

**Proposed resolution.** A `CellRefusal` in `components/lang` — absolutely positioned, caution,
dismiss-on-click, `reason` required — or a ruling that this is `StateCell`'s job once #6 ships (an
editable cell that refuses is where the refusal belongs).

### 10 · The dashed budget, and the anatomy's one legal dash

`dashed` is reserved for SEAM. Disposition across both routes:

| where | old meaning | disposition |
|---|---|---|
| `/families` `Seam` chip ×2 | typed-but-unproven bridge op | ✅ legal — now `FactChip dashed` |
| `/family` header "prototype · converged" | fixture lane | ✅ legal — `FactChip dashed`, reworded to name the fixture |
| `/family` anatomy core-bore stroke | a SUBTRACTION (a void, not material) | ✅ kept — declared volume with no material behind it reads as the seam |
| `/family` ghost rows | "unreachable" | ✅ never dashed, and stays that way (#8) |

Same open question as takeoffs #9: SVG `stroke-dasharray` and CSS `border-style: dashed` are
different mechanisms in the same slot. This pass treated them as one, which is why the core-bore
void had to be argued for rather than assumed.

### 11 · Three head rails in three idioms — dissolved by the promotion

**Surface fact (recorded from a live review of the superseded `/family`).** The head spanned three
stacked horizontal rails, each with its own vocabulary: (1) the `FAMILY` addressing sentence; (2) a
status strip carrying `document / version / validation / evidence` facts on the left and **seven
verbs in three idioms** on the right — hand-rolled `tele` buttons with a `--pe-blue` hover border, a
bordered "commit" pill, a collapsed `+ new` that expanded into an input, and two document chips; and
(3) a conditional trouble line for refusals, receipts and hints. Reviewed verbatim as *"a great
example of disjointness"*.

**What the language lacks.** The addressing sentence is an owed specimen in its own right —
SURFACE-PHILOSOPHY §4: *"Addressing is a sentence; narrowing is chips … (Specimen owed when the
addressing sentence ships)"* — so there is no canon component that says what a head rail IS, and
each surface has been inventing one. `VerbGroup` labels a lane but nothing composes a lane WITH the
sentence, and nothing rules where a receipt lives (§4 says it may replace the addressing line
briefly, which the superseded head did not do — it had a third rail instead).

**Resolved by the promotion, not worked around.** The promoted surface has ONE head rail:
addressing sentence → machine-measured facts as `FactChip`s → the single verb that leaves the page
(`save profile`, the only blue on the row) → the fixture seam chip, right-aligned. Every other verb
moved into the pane that owns the thing it acts on — the overlay switch and the two bulk crossings
into the table pane's own action strip, `parse` and the doc-mode switch into the doc pane's, `hide`
into the anatomy pane's. The receipt rides the sentence (§4) instead of a third rail, and the
refusal rides the CELL that refused it (#9) instead of a page-level trouble line. Seven verbs in
three idioms became one lang `Verb` vocabulary across three owners.

**What the head SHOULD collapse to, as a standing rule.** One rail, in this order, and nothing
else may live there:

1. the route's name, as chrome (neutral ink — never a meaning role, see #12);
2. the **addressing sentence**: clickable nouns only — document · entity · world — with the
   commit receipt replacing it briefly and relaxing back;
3. **machine-measured facts** as `FactChip`s, in rank order (freshness → dirtiness → seam);
4. **the one verb whose blast radius is the whole page**, and only that one;
5. the fixture/seam chip, right-aligned, saying what would replace the lane.

A verb that acts on ONE pane belongs in that pane's action strip. A fact about ONE row belongs
beside the row. Anything that does not fit those five slots is evidence the head is being asked to
carry something that has a better home.

**Proposed resolution.** An `AddressingBar` in `components/lang` composing `Sentence` +
a `FactChip` lane + one `Verb` slot, with the receipt behaviour built in — which would also
discharge SURFACE-PHILOSOPHY §4's owed specimen. `/takeoffs`, `/families` and `/family` have now
each hand-rolled this rail; three consumers is enough evidence for the shape.

### 12 · Fixed en route: two hue laws were being broken by chrome

**Surface fact.** `/families` drew its route title `FAMILIES` in `--clay-ink` (= `--r-alarm`) — the
one colour that may only ever mean "the model disagrees" — and drew the `included` state dot in
`--pe-blue` (= `--r-commit`), spending the one filled blue on a readout. Neither is a language gap;
both are straight violations, recorded because a reserved colour is supposed to make them findable.
Both now sit on neutral ink / the caution rank.

### 13 · The editable `StateCell` cannot render INHERITED-PLACEHOLDER — found during adoption

**Surface fact (adoption pass, 2026-08-16).** A type cell with no override shows the family value
as a grey placeholder — the inheritance showing through, not a value the type holds. Typing
creates the override; clearing hands the type back. This is the majority state of the whole
matrix.

**What the language lacks.** The editable `StateCell` (R8) renders `value` into a caret-safe
input with no placeholder slot. Migrating the type cells would render an override-less cell as
EMPTY, which claims "no value" where the cell resolves to the authored one — a confident wrong
statement, the §0 failure class. The ghost literal, the unbound-literal inspector line and the
family-level value all migrated cleanly (their value is always their own); the type cells did
not, and were left on `ProposedCell` + `TextCell`.

**Proposed resolution.** Either `StateCellProps.placeholder?: string` (rendered only when
editable, in `--r-ink-mute`, documented as "what this cell resolves to when empty"), or an
explicit ruling that inherited-resolution is a route concern the grammar never draws — in which
case `ProposedCell` is the sanctioned wrapper for it and its docblock should say so permanently.

### 14 · The grammar's proposal fold LOCATES nothing — found during adoption

**Surface fact (adoption pass, 2026-08-16).** This route's fold is a button: clicking the notch
brings the proposal's card into the sidebar ("the table points, the sidebar decides"). The
grammar's fold (`data-body="proposed"`) is a CSS pseudo-element with no hit target.

**What the language lacks.** An `onLocate` (or similar) hook on the editable `StateCell`, so the
fold can keep being the cell-level locator the rail's dot is at row level. Without it, migrating
a proposed EDITABLE cell onto the grammar silently deletes the affordance — the rail dot would
become the only way to locate, which weakens the two-level pointing the round-3 ruling praised.

**Proposed resolution.** `onLocate?: () => void` on `StateCellProps`; present ⇒ the fold renders
as a real (caret-safe, `onMouseDown`-suppressed) button. Falls out of the same "every mark stays
outside the text box" law R8 already wrote.

---

## C · What migrated

| | count | notes |
|---|---|---|
| lang `Verb` call sites | 22 | `/families` 6: plan (`act`), apply (`commit`), project (`act`), apply-scope (`act`), artifacts (`nav:out`), copy (`act`). `/family` 16: save profile (`commit`), anatomy hide/show, doc parse, inspector close (`nav:back`), drill-in back (`nav:back`) + capture (`act`) + apply (`commit`), bulk capture (`act`) + apply (`commit`), per-ghost `bind…` (`act`, one per unbound dim), per-proposal accept (`agent`) + deny (`act`) |
| `FactChip` | 12 | `/families` 8: 2 seams, plan hash, recompiled hash (alarm when the hashes differ), draft count, queue count, projection count, per-receipt applied/failed. `/family` 4: live read-age, dirty/saved + unsaved count, open-proposal count (`pea`), the fixture seam |
| `OutcomeLine` | 11 | `/families` 8: bridge disconnected, reading categories, resolving families, command failed / apply refused, plan diagnostics, projection diagnostics, projection failure. `/family` 3: sheet-mode stand-in, the `?family` advisory, (route receipts ride the sentence) |
| honest labelled empties | 20 | `/families` 12, `/family` 8 — all on one shared class per surface, none on a primitive (#2). **Adoption pass 2026-08-16: all 20 (plus the drill-in empty the census missed) now on lang `EmptyState` — story judged per site (filter for the two combobox lists and the tables' narrowed-to-nothing branches, scope everywhere else), exit required; both `EMPTY_CLASS` constants deleted.** |
| lang `EmptyState` call sites *(adoption pass)* | 21 | `/families` 12: 2 combobox pickers (filter), no-loaded-families, no-categories-picked, decision-queue empty, receipts empty, projection empty, 4-branch table empty (3 scope + 1 filter). `/family` 9: 2-branch cross-type + 2-branch drill-in table empties, drives-nothing, ungrounded, no-proposals, prose-only constituent, spec-text, spec-sheet, no-shape-to-draw |
| editable `StateCell` (R8) call sites *(adoption pass)* | 3 | `/family`: the ghost literal's ONE merged cell (staged square + bold + built-in refusal + cell navigation), the inspector's unbound-literal line, the inspector's family-level value (pea's proposal takes the body; your edit takes the staged square; empty commit refused via `onCommit` return). Type cells stayed honest — #13/#14 |
| `AddressingBar` (R11) heads *(adoption pass)* | 2 | `/family` (reference, promoted head) + `/families` (this pass): name · sentence · plan-hash fact · `apply` as the one page-blast verb · unproven-ops seam right-aligned. `plan` + `project → profile` moved into the table's own strip |
| route-drawn marks deleted *(adoption pass)* | 1 file shrunk | `family/marks.tsx`: `RefusalNote` deleted (zero consumers — refusal is the editable cell's, R8); `ProposedCell` survives on findings #13/#14; `NavStateCell` (the cell-navigation adapter) added |
| `stateColumn` tones re-based | 2 columns | `/families` plan verdict (7 words), `/family` agreement (7 words incl. `unbound`) |
| `--st-*` / `--act-*` spends migrated | 78 | 76 in `variant-e.tsx` — the largest single concentration of the old vocabulary in the repo — plus 2 `--act-hover` |
| forked `Verb` copies deleted | 2 | `routes/families.tsx` (which made `reason` optional and so shipped refusals with no explanation), `routes/family.tsx` |
| superseded modules deleted | 14 files, ~6,000 LOC | the two-lane `/family` body and its `src/family/{anatomy,doc-pane,editable,focus,formula,formula.test,geometry-rows,inspector,live,matrix,mock,model,store}` plus `family/proto/variants.tsx`. Nothing outside `src/family/` and `routes/family.tsx` imported any of them — checked before deleting, including `src/workbench/plugins/` (the family chat card reads `familyRouteState` off session state from `@pe/agent-contracts` and links to `/family` by path, so it is unaffected) |
| promoted modules created | 5 | `family/{world,model,marks,doc-pane,anatomy,workspace}` — `world.ts` moved from `family/proto/` |

**Files touched:** `routes/families.tsx`, `routes/family.tsx`, `family/*` (created + deleted),
`styles.css`. Nothing under `components/lang/` or `components/master-table/`.

### `ui/verb` and `ui/chip`: NOT deleted, and why

Both lost their last PRODUCT consumer in this pass — `ui/verb` served the two forked route copies,
`ui/chip` served only variant-e. Both survive because a concurrent session's
`/design-system/swatch` imports each one as a **superseded-specimen exhibit**, to show what the
lang components replaced. That is a legitimate consumer, so SHIMS entry 1 is only partially
discharged: the shims are no longer load-bearing anywhere a user can reach, and retiring the files
is now the exhibit's call rather than a route pass's.

**Shim lines deleted from `styles.css`: 2** — `--st-derived` and `--st-ground`, both at zero
consumers repo-wide after the promotion. `--st-{proposal,drift,warn,done,meta}` stay alive through
`ui/chip.tsx` + `ui/switcher.tsx`, and `--act-{commit,hover}` through `ui/verb.tsx`, i.e. entirely
through the exhibits above. `--cat-*`, `--line*`, `--pe-blue` and the Lens vocabulary all still have
real consumers (ops, workbench, grounded-doc, sentence, pane), so their lines stay until those
passes land.

## Phase-D findings (2026-08-17, build-lane wiring on /family)

Recorded per sweep governance: gaps become numbered findings; no unilateral language changes.

13. **ArmingStrip refusals want a LIST.** `ArmingState.refused` carries one string; several
    refusals are legitimately true at once (dirty draft AND schema failure). /family joins
    them with `·` inside build.tsx. The honest shape is `refusals: {code, says}[]`.
14. **ArmingStrip owes a `building` (in-flight) phase.** A write that leaves the page and runs
    seconds inside Revit must say so at strip scale; /family stands in with OutcomeLine
    kind="busy" in the strip's slot.
15. **ArmingStrip owes an unknown-outcome phase.** build_evidence mutates outside the page; an
    `ok` with no rfaPath is neither success nor refusal. OutcomeLine has partial/dropped; the
    strip has no equivalent, and this is the write that most needs it.
16. **Refused-phase exit is hardcoded to `re-plan`.** Honest for /family's refusals, but a strip
    whose refusals have different exits ("save first", "bind a world") cannot express them.
    Wants `exit: {label, onExit}` on the refused phase.
17. **"capture" collides.** `capture live` (Revit → evidence, a read) sits beside `capture all`
    (Revit wins → profile draft, a crossing). The surface already says "read" for the former
    everywhere else — the read verb likely wants that word.
18. **Arming survives drill-in but cannot be initiated there.** Probably right (build is
    whole-family); wants a ruling.

## Phase-C findings (2026-08-17, the anatomy adopts the evaluator)

Recorded per sweep governance: gaps become numbered findings; no unilateral language changes.

19. **The dash law needs an annotation scope.** The anatomy's stated law is "the void's dash is
    the one legal dash" — a claim about PARTS (declared volume, no material). But the drawing has
    always dashed its plan datum crosshair, and the room point's ported marker dashes its leader
    too. Either the law scopes itself explicitly (parts may dash only for void; annotation —
    datums, leaders — is a different register), or the RCP leader needs a non-dash idiom. The
    drawing currently assumes the scoped reading and says so in its header; wants a ruling.
20. **The `dashed` guard ratchet cannot see SVG dashes.** design-guard.test.ts matches
    `stroke-dasharray` (kebab), but JSX spells it `strokeDasharray`, so every dash in the anatomy
    triptych — legal or not — is invisible to the ratchet. The drawing's dash discipline is held
    by review only. If R13b is to hold by assertion, the regex wants the camelCase form too
    (and a baseline entry for the audited drawing spends).
21. **Reference planes have no taxonomy rung.** On the live lane the triptych draws RPs — the
    dims the FF processor will create — as `--r-line-2` hairlines at rest, ink when their
    parameter's row is lit. A hairline is a SEAM spend, not an identity, so a plane and a ghost
    outline separate only by label and extent. If plane-as-future-dim is a KIND (like
    connectors, which wear `--viz-4`), it may deserve a viz rung; this pass deliberately minted
    nothing. Wants a ruling.
22. **Frames (and the room point) have no focus vocabulary.** `Focus` is `param | part`; a frame
    origin cross is neither a constituent nor a parameter, so it can neither light nor be lit —
    it is a mark with a tooltip. The old evaluator triptych gave the room point the ad-hoc focus
    id `rcp`, which no current focus law recognises, so it too is title-only now. If the FF
    processor makes frames first-class, the one-focus law needs a third word.
