# Design-system fit reviews — 2026-08-16 (post-sweep)

Two independent, opinionated reviews commissioned at the end of the one-system sweep, plus
the §1 census rerun. Lens A judges **system→routes** (does the language serve the surfaces);
lens B judges **routes→system** (where surfaces bent to satisfy the system). Nothing here is
applied — this file is the agenda for the joint sitting. Synthesis first; both verdicts
follow in full.

## Census rerun (§1 exit-gate numbers, before → after)

| gate | sweep start | now |
|---|---|---|
| forked `Verb` components | 5 | **0** |
| `--st-*`/`--act-*` consumers | 6 files | **0** |
| hex colour literals outside canon | (uncounted) | **0** |
| `ui/verb`/`ui/chip`/`ui/switcher` | alive | **deleted** |
| `ui/button` importers | 22 | 12 (ui internals, composer send, exhibits) |
| raw `<button>` outside ui+lang | 137 / 37 files | ~78 / 27 files (largely non-verb machinery + exhibits) |
| raw palette refs outside ui | ~640 / 50 files | ~40, confined to `sentence.tsx`, `host/target-ui.tsx`, ui internals |
| `text-[Npx]` | 381 | 133 / 16 files (flagships + exhibit chrome — see A·5) |
| `tele`/`tele-label`/`section-label` | app-wide | 152 uses / 15 files |
| ALIAS SHIM meter | ~40 lines | **12 lines** |
| `useVerb` adoption | 2 sites / 11 hand-rolls | 6 sites |
| production confirmation dialogs | 0 | 2 (takeoffs adopt/sync) |

Remaining nonzero gates all live in **shared chrome no route pass owns**: `components/sentence.tsx`,
`host/target-ui.tsx`, `ui/{button,badge,pane,side-pane,pick-list,command}`, and the design-system
exhibit pages. Review A's closing point: the per-route governance that made the sweep safe is now
the thing preventing the last mile.

## RULED 2026-08-16 (kaitpw delegated the sitting: "choose the occam approach — what matters
## is everything fits the system and tokens propagate, not perfect discipline")

Agreed items 1–4 + 7–8 below: **implement as written**, with two Occam trims — the owed
marker ships as the MasterTable gutter only (no workbench mapdial twin yet), and of the
state-model batch only the one-line `partial` kind lands now; outcome links / staged-author /
freshness thresholds stay queued model work in `docs/features/design-system/LEDGER.md` Owed (they are contract
work, not token propagation).

Collision rulings:
- **Refusal-to-title** → B wins, narrowly: a DISABLED `commit` verb renders its reason
  visibly (small line by the verb — no new slot); everything else stays title-only. Fix the
  stale atlas docblock.
- **Grayscale for the meaning band** → law extended: a meaning-band spend on a fill smaller
  than a word needs a non-hue channel. Takeoffs' `call` gets one (implementer picks the
  minimal channel).
- **Vocabulary stacking on /takeoffs** → no code change. The zone-stage column is a
  disclaimed container label used as a filter, which §1 explicitly permits. The census
  TEMPLATE is rewritten instead (grade against all five carriers: axes · verdict · outcome ·
  row-fact · viz).
- **AddressingBar on form routes** → released: the five-slot rule binds table/workspace
  routes; form routes may use a Section-style head. `name` normalized (lowercase at call
  sites; the CSS already uppercases). Settings collapses its two rows.
- **Mandates** → `ReadCell.reason` becomes optional. `EmptyState` keeps its required
  story+exit, but hover-readouts-at-rest and combobox no-match slots are RULED not-empty-
  states — plain muted text; the three absurd call sites revert.
- **Readout band** → renders only while a cell is focused; the idle tutorial placeholder
  dies. The focused-cell verb path is deferred (design work, not fit work).
- Also in: blue-boundary sentence in the law ("beyond the page" = leaves the current
  page's state — disk, host, external); boilerplate honesty stamps deduped per surface;
  instances' crash payload un-muted; NarrowChip adopted by MasterTable (FilterChip dies) or
  deleted if adoption fights back — implementer's call, adoption default.

## Synthesis — where the two reviews agree (high confidence)

1. **The owed/attention marker is the single highest-leverage build.** Ruled (R3), never built;
   5+ routes hand-roll "a person must act here, with a count and one verb" (takeoffs flags,
   family ghosts, settings+schedule-grid `review:"attention"`, workbench approvals). A ranks it
   #1; B's cell→verb gap is the same hole at cell scale.
2. **The editable cell fractured into parallel editors, and the canon violates its own laws.**
   `BaseCell`/`CellSelect` vs `StateCell` duplicate the commit/keyboard contract; `BaseCell`
   silently swallows refused numeric commits (§3's named defect, in canon); `cells.tsx` ships
   `focus:bg-primary/5` (focus buying the commit hue) and `destructive` spends. Needed:
   numeric/placeholder/onLocate on `StateCell`, wrappers die.
3. **parameter-links' preview→apply gate is ArmingStrip's first consumer** — both reviews
   arrived at it independently (A: adopt or demote the strip; B: the gate's entire safety
   model is invisible in a tooltip). One adoption fixes both.
4. **Orphans: `NarrowChip` (0 consumers, MasterTable ships its own `FilterChip`) and
   `ArmingStrip` (0 shipping consumers).** Adopt into MasterTable / parameter-links, or delete.
5. **The flagship type pass never actually ran.** `atlas.tsx` 32 tele, `family/*` 23 tele +
   20 sub-floor px, `families.tsx` 22, and `sentence.tsx` (18 tele + `--paper` + `--pe-blue`)
   contaminates every AddressingBar. The audits' "tiers: done" claims were the small routes.
6. **The state model is now the bottleneck, not the grammar.** Outcome links (verb·time·
   target·items), `staged` author beyond you/pea, freshness thresholds, `partial` on
   `VerbFailKind` — every remaining "language can't say X" is a missing fact, not a missing
   mark. Stop extending the grammar until the model moves.
7. **Loosen two constructor mandates.** `ReadCell.reason` required → tooltip-farming on
   identity columns; `EmptyState` required story+exit → absurdities in hover readouts and
   combobox no-match slots. Right for tables, wrong below a size floor.
8. **Mechanical canon fixes, uncontested:** `VerdictCell` word onto `--r-ink-2`;
   "universal seven" is actually eight (fix the count or the vocabulary); stale
   `atlas.tsx:276` docblock claiming reasons render on-surface.

## Where the reviews collide (the real joint-review questions)

- **The refusal-to-title ruling.** B's strongest finding: it violates §0's own acceptance bar
  ("without tooltips … why is that one disabled"), silences exactly the highest-stakes verbs
  (settings save, families apply, parameter-links' gate, schedule-grid push), doesn't exist on
  touch, and is invisible in the screenshots this project uses as proof. A treated the ruling
  as settled and the lane-spam problem as real. **Proposed compromise: a disabled `commit`
  verb renders its reason visibly (AddressingBar advisory slot or one line under the lane);
  everything else keeps title-only.** The lane-dedup problem never applied to the lone
  page-blast verb.
- **The meaning band has no grayscale law.** B: takeoffs' room states now ride the priced
  alarm/caution CVD collision as hue-only fills at 2-13px (rail bars, plan fills) — the exact
  place a wrong read costs a site visit. A found one-alarm held everywhere. Both true:
  **extend the grayscale law to meaning-band spends smaller than a word** (pattern/weight/
  position channel for `call`).
- **Vocabulary stacking on /takeoffs.** B counts ~20 words/marks a newcomer must hold (four
  room states + seven zone stages side by side + grammar + outcomes + tones). A's counter:
  the axes were mis-measured, not overbuilt — the census template should grade against all
  five carriers (axes · verdict · outcome · row-fact · viz). Both fixes are compatible:
  rewrite the census template AND rule whether the zone-stage column survives beside the
  verdict column.
- **AddressingBar on form routes.** B: `/settings` pays two header rows to satisfy the
  five-slot rule; `/data-tables` got less than an `<h1>`; the `name` slot isn't even
  case-normalized. A: the rail earned its keep on table routes. **Proposed: normalize `name`
  in the component; rule a form-route variant (or exemption) rather than forcing the sentence
  slot to hold non-nouns.**
- **The readout band.** B: idles as permanent tutorial chrome; testimony is two-step
  retrieval; blockers invisible at rest. **Proposed: render only while a cell is focused;
  give the focused proposed cell a verb path.**

## B-only findings worth their own ruling

- Boilerplate honesty stamps ("nothing is written…" ×20 across 9 files) train users to stop
  reading — dedup to one home per surface.
- The hover shadow-doc: 36-56 `title=` props per flagship route, some 80-100 words — the copy
  purge moved prose out of sight rather than deleting it; a newcomer can't discover that
  tooltips are where answers live.
- Killed-sandbox crash messages wear dropped/muted styling — the payload styled as dead
  information (`instances.tsx:388`).
- Ghost rows (a featured, verb-bearing state) render in `--r-ink-mute`, whose 2.83:1 is
  defensible only via the disabled-controls exemption ghost rows don't qualify for.

---

# Verdict A — system→routes (full text)

**Overall verdict: the color/type/mark half of the language is genuinely earning its keep —
11 routes migrated with remarkably few law exceptions — but the system has a load-bearing
hole it has ruled on twice and never built, and its state *model* is now two full steps
behind its state *grammar*. The CSS is ahead of the facts it renders. The next unit of
progress is not another token or law; it is one primitive (the owed/gutter marker) and one
model change (outcome links), which together discharge more than half of all open route
complaints.**

## 1 · The one missing concept: "a person must act here" — ruled, never built (HIGHEST PRIORITY)

The unmappable states across the audits cluster in exactly one place. Routes independently
reinventing "a human decision is owed, with a count, a locator, and one verb": takeoffs #2
(detector flags — "the route's single most important state"), families #8 (ghost/unbound rows
with their one `bind…` verb), settings #1 + schedule-grid #1 (`review: "attention"` — crosses
the ≥2-route bar), workbench #3 (approval owed, uncountable in a long thread), schedule-grid
#2 (failed cells after a partial push). Five-plus routes; R3 already ruled the answer and
**the gutter marker does not exist** — R3 is a ruling wearing the costume of a discharge.
The sixth-axis refusal was correct; the row-fact primitive it promised is the single
highest-leverage build in the system. It needs a turn-scale twin for the workbench (mapdial
tick + count).

## 2 · Outcomes are orphans — the model gap is now the bottleneck

Survived the entire sweep untouched. Casualties: takeoffs #4 (a failed verdict write cannot
un-stage the row it names), instances #4 (the ledger cannot be an OutcomeLine lane — no
actor/time/target), schedule-grid #2 (partial cannot point at failed cells), workbench #3,
families #4 (half-fixed by R12). Siblings: `staged` has no author beyond you/pea (ops #3);
freshness has no threshold (instances #6, schedule-grid #4 — §3's "turn freshness into work"
is unenforceable). And `lib/use-verb.ts` still lacks `partial` — a one-line fix written down
since the schedule-grid audit. **Stop extending the grammar until the model moves.**

## 3 · The editable cell shipped as one shape and immediately fractured into three editors

R8 covers free text; consumers need four shapes: numeric (takeoffs' Manual J judgment),
inherited placeholder (families #13 — the majority state of the flagship matrix), locate
(families #14 — the fold is CSS with no hit target), select-shaped (parameter-links #1,
data-tables #4). Structural cost already in canon: `cell.tsx` and `BaseCell` are two parallel
implementations of the same keyboard/commit contract — §4's "one editor" violated inside the
canon — and `BaseCell` silently swallows refused numeric commits (`cells.tsx:106-108`), which
is verbatim §3's named open defect, with R8's refusal machinery twenty lines away. Grow
`StateCellProps` (`numeric`, `placeholder`, `onLocate`); `BaseCell`/`CellSelect` wrap or die.

## 4 · The canon violates its own laws

`cells.tsx:8` `focus:bg-primary/5` — focus buying the commit hue, in the primitive, on every
table (repeated at :140). `cells.tsx:141` `CellSelect` invalid → `destructive` spends.
`cells.tsx:197` `VerdictCell` word on `text-muted-foreground` not `--r-ink-2`. One-line
fixes; the enforcement story ("the canon consumes --r-* exclusively") depends on them.

## 5 · Type tiers: holding on small routes, wide open on the flagships

By grep: `atlas.tsx` 32 tele; `family/workspace.tsx` 23 tele + 20 `text-[8-9px]`;
`families.tsx` 22 tele; `sentence.tsx` 18 tele + `--paper` + `--pe-blue`, contaminating every
head rail. The 9px spends sit below the 10px floor ops enforced on itself. `/family` is the
flagship and the largest concentration of off-ladder type — its promotion migrated 78 colour
spends and zero type spends. Not drift back; a pass that never happened, misread as done.

## 6 · Overbuilt, vestigial, or wrongly accused

- **NarrowChip: zero product consumers** while MasterTable ships its own FilterChip (no
  count, no required title) — two narrowing-chip contracts, the canon one an orphan. Adopt
  into MasterTable or delete.
- **ArmingStrip: zero shipping consumers.** parameter-links #2 volunteered the perfect first
  consumer (preview→stale→apply IS the arming lifecycle, today a greyed verb with its safety
  rule in a hover). Adopt there or demote.
- **StateColumn.word: not vestigial** — one legitimate consumer post-R5; keep. `verdict:` has
  four consumers; the split was right.
- **The 4-axis grammar is not overbuilt — it is mis-measured by its own audit template.** The
  unmappable counts use the wrong denominator: non-mapping states are pipeline verdicts
  (verdict:), acts (outcome lane — 9-11 states per route, flawless), row facts (the missing
  owed primitive), and taxonomy (viz). Rewrite the census template to grade against all five
  carriers or every audit keeps manufacturing the impression of a failing taxonomy. The weak
  anchor held; no route asked for more body washes.
- **One alarm survived eleven routes** (two priced stretches: workbench #5, instances #2).
  Do not mint a second warning rank.
- **Blue scarcity has one genuine crack:** instances #3 (a lifecycle cockpit where every verb
  writes — accept it as honestly blue-dense) and parameter-links #5 (define "beyond the page"
  at the shared-document boundary — one sentence in the law).
- **Icon-only verbs: real but small** (composer send/stop/attach, per-row removers). A Verb
  icon-only form closes the last ui/button product imports.

## The five moves (A)

1. Build the owed marker (MasterTable gutter + mapdial tick).
2. Move the state model (outcome links, staged.by, freshness threshold, `partial` today).
3. Unify the editors into StateCell; fix the canon law violations in the same commit.
4. Run the flagship type pass (atlas, family/*, families, **sentence.tsx** first).
5. Adopt or kill the orphans (NarrowChip → MasterTable; ArmingStrip → parameter-links).

Closing: the shim meter now measures shared chrome no pass owns (`sentence.tsx`,
`host/target-ui.tsx`, ui internals). One explicitly-owned shared-chrome pass, or the meter
never reaches zero.

---

# Verdict B — routes→system (full text)

## 1 · The refusal-to-title ruling breaks the system's own acceptance bar (highest harm)

§0: "answers, in seconds and without tooltips … why is that one disabled." `verb.tsx`:
`reason` required, rendered ONLY as title. Collateral is exactly the highest-stakes controls:
settings save (three-branch reason), families apply ("N diagnostics — must compile clean"),
parameter-links' freshness gate (the route's entire safety model), schedule-grid push. Worst:
`atlas.tsx:276-284` still documents the OPPOSITE contract ("renders ON THE SURFACE … rather
than a tooltip") — the route was written against a contract the system revoked, and nobody
checked. Hover doesn't exist on touch and is invisible in the screenshots this team reviews
by. The four-sentences-under-one-lane problem argued from the worst case to a global gag
order that also silences the lone page-blast verb. **The system was wrong.** Disabled commit
verbs should carry the reason visibly; lane-level dedup solves the spam.

## 2 · Vocabulary tax — /takeoffs stacks four vocabularies (~20 words/marks)

Four room-state words ×3 surfaces + seven zone-stage words in the adjacent column + the cell
grammar for one `.r10` column + seven outcome kinds + five chip tones + the dash. Near-
synonyms across vocabularies (`data`/"data entered"/`staged`; `synced` twice with different
subjects). And the canon can't count itself: "the grammar's universal seven" — CELL_STATE_ORDER
has EIGHT entries. The verdict-clause split was right; the tax is the STACKING (zone-stage
beside verdict) and full grammar ceremony for one column. `/instances` is the sane dose and
passes §0 easily.

## 3 · Information moved out of sight — the readout band and the clamps

Blockers ("push refuses while it stands") invisible until a cell is focused; the band idles
as a permanent 24px tutorial placeholder on every state-bearing table; in-cell approve/deny
died and cell→strip has no path back (strip→cell exists); settings' footline clamp guarantees
"was X" — the fact a reviewer needs — loses to boilerplate; the 34ch chip clamp cuts the
filename off the `.r10` path (the only distinguishing part). Half right: uniform rows are
correct; the band should render only on focus and a focused proposed cell should carry verbs.

## 4 · The honest costs are now load-bearing

alarm/caution separate only by hue (1.04|1.03) — and takeoffs' room states (`call`=alarm,
`data`=caution) now ride that pair as hue-only fills at 2-13px on all three progress surfaces
(ZoneStateBar, plan fills, LevelStats). The grayscale law was legislated only for the viz
ladder. Secondary: pea's 8px rail dot on the display rung (the palette's weakest light-mode
point) marks the page's most important fact; ghost rows carry a featured verb in `--r-ink-mute`
(2.83:1, defensible only via the disabled exemption they don't qualify for). The palette was
honest; the routes weren't made to answer for it.

## 5 · The hover shadow-doc

56/36/36 `title=`/`reason=` props on the flagship routes, many 60-100 words; `ReadCell`'s
required reason farms ceremony on identity columns ("a tooltip that tells you what a table
is"). Reason-washing proper is LOW (~5 cases — the discipline held); the disease is
boilerplate honesty stamps ("one transaction at a time" ×10; "nothing is written" ×20 across
9 files) — disclaimers train users to stop reading.

## 6 · Forced EmptyState ceremony

doc-lab's hover readout at rest; families' combobox no-match slot (story+exit for "you typed
a string that matched nothing"); a third EmptyState beside two visibly-empty pickers. The
MasterTable empties are the best empty-state work in the codebase — the primitive is good;
its mandatoriness produced the absurdities.

## 7 · The AddressingBar straitjacket

Settings pays two header rows (inert mono path in the sentence slot; real addressing exiled
to a second strip); data-tables got less than an `<h1>`; the `name` slot isn't case-
normalized (four-way split across routes). On families/takeoffs the five-slot rule genuinely
earned its keep (verb-locality moves were correct). Right for table routes; forced on forms.

## 8 · Smaller

Killed sandboxes' crash message styled as dead information (instances.tsx:388); /ops glance
pinning is search-hostile (glances vanish under any query); ▪/□ typography checkboxes went
quieter than function wanted. **Density held up** — no case found where tiers/sans heads/
select fills made a surface harder to scan; the system was right there.

## The five rollbacks (B)

1. Un-gag the disabled commit verb (advisory slot / one line under the lane) + fix the stale
   atlas docblock.
2. Extend the grayscale law to meaning-band fills smaller than a word; give `call` a non-hue
   channel.
3. Readout band only on focus; focused proposed cell gets its verbs or a one-key jump.
4. Release /settings and /data-tables from the AddressingBar (or add a legal controls slot);
   normalize `name` case in the component.
5. `ReadCell.reason` optional; `EmptyState` grows a sanctioned blank escape; fix "universal
   seven" to eight or make it seven for real.

**Overall:** the table core made every table route strictly better; harm concentrates where
the system legislated against its own philosophy (reasons into hover), stacked vocabularies
instead of replacing them, and required ceremony from surfaces too small to owe it.
