# Design language — clean room

The living doc for the design-language round. Verdicts land here and only here. Migration
status: **hard cutover to `/design-system` in progress (2026-08-16)** — the language is
ruled; the `--r-*` tokens + p3 values are being promoted to canon (`src/design-lang.css`)
and the grammar into `components/lang/`. No shipping product route has migrated yet.

The greater arc: (1) settle the design language — DONE (rounds 1–2), (2) cut over
`/design-system` to real components — IN PROGRESS (ledger:
`../design-system/SHIMS.md`), (3) per-route normalization crusade — QUEUED, gated on
route-set alignment. The index law for step 2: **nothing exists on the design-system page
unless it is codified as a real component with a real (or soon-to-be) consumer.**

Standing directives for the whole cutover + crusade (ruled 2026-08-16):

- **Stretching the system and updating components/routes are one exercise, always paired.**
  Every migration is also a probe for the perfect shape; every gap found is recorded, never
  worked around. The no-shims law on `/design-system` exists precisely for signal clarity —
  a one-off workaround is noise that hides a gap.
- **The index demonstrates the language through the REAL components** — the design-lang
  scaffold's emphasis-and-demonstration framing was right, its fixture table was not: the
  design-system table section mounts the actual `MasterTable` with `StateCell` renderers.
  What MasterTable cannot express is a finding, recorded at the call site.
- **Every popover-bearing component is tested across viewport positions.** A position
  harness (corners / edges / center) exercises flip, clamp, and overflow per component.
  Motivation: combobox / targeting dropdown / search boxes are inconsistent in both style
  and popover behaviour everywhere; the harness makes the inconsistency one visible fact,
  and a single popover foundation becomes queued component work.

## Settled before base 2

Carried in from base 1 (rounds a–h over the token-scope specimen) and the COLOR-ROLES grill.
These are starting positions, not walls — beating one is a finding; record it here.

- **Locked/uneditable is greyed italic.** The most-taught "look but don't touch" in software.
- **Squiggle means "not settled / something is wrong"; a plain underline is a citation.**
  Cross-software motif meaning beats internal consistency ("optimize for what they will see
  and understand immediately").
- **Proposal is a whole-cell event, not a corner mark.** Pea's proposal is the thing a person
  must not miss.
- **Nav splits three ways** — back, forward, out — because browsers already taught the
  difference. `open in RHVAC` is nav:out; `sync to .r10` is write:external.
- **Icons work in verbs and outcomes; icons inside data cells break table ergonomics** the
  moment a value runs long. Typographic glyphs in place of icons "look really bad".
- **Outcome receipts read as coloured mono text**, not left bars — vertical bars were not
  understood.
- **Mode-invariant accents (declared once, same in dark) read as muddy** — rejected.
- **The light palette is preferred; dark has better contrast.** Fix light contrast via
  background/ground tokens, never by changing accents.
- **One alarm; pea has one identity colour (green); proposals are never blue; selection and
  focus are a fill, never a hue** (COLOR-ROLES laws, unchallenged through eight scopes).
- Blast radius is an orthogonal descriptor of a verb, not a reason for more hues.
- A separate parallel palette (`--viz-*`) for charts/taxonomy is wanted; unbuilt.

## Why base 1 was retired (2026-08-16)

Byte-identical specimen markup isolated the token-scope variable so well the round stopped
judging a product: verdicts on 12 abstract rows and caption prose did not transfer, and
round 2 execution was ruled "a big regression… unpolished and rudimentary" while its concepts
were "closer". The verdicts that stuck (list above) all came from concrete moments, not from
the five-axis taxonomy. Base 1's specimen/scopes files are deleted; the raw findings survive
in `docs/design/DESIGN-LANG-HANDOFF.md`.

## Base 2 — round 1 (open)

**One question:** which whole language lets a newcomer read state, verbs, and pea's voice in
seconds — judged on real product moments.

**Method:** five rival complete languages (colour strategy, type, marks, density, markup all
free) over one shared fixture, `apps/web/src/design-lang/proto/world.ts`: pea's inline chat
proposal card, a table slice with real density, the verb lane with the first-ever arming
strip, and the addressing sentence. Route: `/design-lang?variant=a…e`.

| | thesis |
|---|---|
| a · control-plus | COLOR-ROLES + original palette were right; the regression was execution |
| b · ink | colour nearly abolished — only pea green and clay alarm keep hue |
| c · borrowed motifs | every mark imported from software people already know; nothing invented |
| d · new palette | the open rival — new palette, own meaning strategy, keeps only the laws |
| e · cell states | state is the whole cell (fills, folds, washes), not marks on its edges |

Colour scope ruled before building: original palette anchored (a is the control); rivals may
restructure meaning-assignment; d may bring a new palette. **Button colours are explicitly in
play in every variant.**

### Builder convergence (2026-08-16, before any ruling)

Five independent builders, blind to each other. What three or more hit independently:

**The state model cannot express** (the round's strongest signal):
- **Staging has no author.** All five inferred "who staged this" from `origin`, which is the
  author of the *value*, not of the staging. The pea-square vs user-square verdict is
  unrepresentable until `staged` carries `by`. (`trichotomy.ts` stores `by`; the reviewer and
  every fixture discard it.)
- **A proposed table cell has no prior value** — current → proposed renders in the chat card
  and physically cannot render in the table. `ProposalCardCell` and `CellFixture` are the same
  fact modelled twice, once incompletely.
- **Outcomes are orphans**: no verb, no time, no target, no item list — "4 staged for retry"
  has nowhere for the 4 to live; the busy verb and the busy outcome can't connect.
- **Arming has no lifecycle or identity**: no unarmed state, no armed-at/by, no link to the
  verb it arms or from refusal to a fresh hash.
- **Freshness has no subject/threshold** (`ageMin` optional even when "fresh"), so it can
  never become queue work and its claim is unfalsifiable.
- Denied proposals carry no reason/author; grounding cannot be ambiguous; nohome vs readonly
  conflate two different refusals.

**GAP census against canon primitives** (all five hand-rolled the same things):
- `ui/verb`: no icon slot (three navs illegible), no filled/solid tone, no agent/pea tone
  (Law 0 makes pea's own verb illegal — 4/5 builders hit this), `reason` is title-only, no
  blast-radius notion, mono type collides with "mono = machine-measured".
- `ui/chip`: no removable form, no count slot — a *narrowing* chip cannot be built from a
  *fact* chip; they are two primitives wearing one name.
- `ui/button`: only `outline`/`ghost` survive contact; `default` blue is contested by every
  variant that took a commit position.

**Token-layer findings**: `--user` == `--st-warn` (kiln) breaks in every variant that kept the
palette; the role layer has display hues but no mixable inks (`--st-proposal-ink` missing —
e's wash fix); no origin vocabulary; no role for "the bridge failed" (host error borrows the
drift alarm).

### Verdicts (ruled 2026-08-16)

**What won and why — e (cell states), on a specific property:** whole-page legibility. "When
I switch to any other variant my eye needs to find everything that's happening" — the crucial
signal. Mechanically pinned in the grill: **(1) one cell grammar everywhere** (the chat card's
staged values, the table cells, and the arming strip are the same treatment at three scales —
load-bearing), enabled by **(2) tasteful fills over outline borders** (only e's arming strip
read as ceremony rather than "just another component"; attributed to border scarcity). Whether
state belongs in the cell body or at edges/text is deliberately NOT settled — see weak anchor
below.

**What retired** (all four deleted from main; snapshot: `proto/design-lang-base2-round1`):

- **a · control-plus** — beaten as the control. Donated: verb grouping + outcome colour
  coordination (best with e's), and the green proposal card as originally intended.
- **b · ink** — looks good but noisier than c's axis discipline. Donated: outcome
  text-decoration direction (squiggly-under / italic; bold stays reserved for unsaved), and
  the dark-mode green card.
- **c · borrowed motifs** — palette rejected: too saturated, not PE. Donated the round's
  biggest idea: **the axis-splitting law** — one squiggle/decoration family carries "state of
  the value" ranked by colour, only two primary text colours, citation = plain underline. Its
  colour coordination felt "most wholistic and intuitive" — that *property* (not the palette)
  is a target for round 2.
- **d · new palette** — rejected: bad in light, no PE character. Donated: dark mode is where
  it looked good (evidence that dark's character is underdefined), its verb treatment, and
  its token discipline (ground-does-contrast, every-hue-is-a-meaning).

**New anchors from the ruling grill** (weak anchors — deviate with cause, record it):

- **Cell-body treatment is reserved for pea proposals and uneditable/disabled.** Everything
  else (drift, freshness, staging…) lives at edges/text/decoration. Not ready to lean fully
  into e's everything-is-a-wash.
- **Artifact frames enter the base**: large interactive chunks (tables, in-chat pea
  suggestions, sentence/targeting blocks) get a shared treatment separating them from page
  content.
- **Light-mode fix uses both levers** — spread the light ground ladder AND add mixable `-ink`
  companions to display hues — under a strict small-token-budget eye. Darkening the cream is
  allowed; changing any colour is allowed.
- **PE character** = `docs/context/PE_DESIGN_VIBE.md` (warm paper, earthy secondary family,
  mono voice, pea green — all four are identity). The palette goal: an **adjacent** palette
  that looks as good in light as in dark, with enough cross-mode commonality that
  colour-as-data transfers between modes.
- All dark modes beat light on accent-to-ground contrast — this is the round-2 engineering
  problem, not a taste note.

## Base 2 — round 2 (palette round, scoped 2026-08-16)

Grill rulings that scope it:

- **Round 2 isolates the palette.** One fixed base — e's grammar + the donations (a's verb
  lane and outcome coordination, b's decoration direction, c's axis law), constrained by the
  weak anchor and wrapped in artifact frames — rendered byte-identically under rival
  palette/ground token scopes, judged by flipping each in BOTH modes. Grammar deviations wait
  for round 3.
- **Cross-mode strategy: sibling renderings.** Each role token has a light value and a dark
  value; the meaning map is identical; lightness moves freely, hue angle stays within a named
  tolerance, and every pairing is written in a per-role table so drift is a decision.
- **Blue is scarce.** Tools-register scarcity wins: commit fill + nav as blue text only.
  The generous PE-blue register is out of scope entirely — pe-tools designs tools, not
  landing pages or portals.
- **Bold stays reserved for unsaved.** Outcomes get punch from colour + icon + the artifact
  frame, never from the type axis.
- **`docs/context/PE_DESIGN_VIBE.md` is stale** — a pre-tools first step, now superseded for
  tools by this doc + COLOR-ROLES; its durable identity content (warm paper, earthy secondary
  family, type-before-colour, restraint ratios) is absorbed here. Refresh or fold it; do not
  cite it as authority.

### Round-2 rivals (built 2026-08-16, live at `/design-lang?variant=…`)

The base consumes an 18-token `--r-*` contract (`proto/palettes/tokens.css`); each rival is
one self-contained token block with a per-role light|dark pairing table and computed ratios.
`e` stays mounted as the round-1 reference; `p0` is the unfixed incumbent — the floor.

| | strategy | headline honest cost (builder-declared) |
|---|---|---|
| p1 · incumbent tuned | exact PE hues; grounds spread, inks deepened, 6 measured defects fixed in place | light wash caps at 1.38:1; alarm/caution in dark rests on chroma (fails deuteranopia) |
| p2 · warm adjacency | every accent re-pitched ≤10° for parity; clay→terracotta, kiln→amber, done→moss | done leaves pea's family (a meaning change); brand hex #005695 becomes cerulean |
| p3 · wholistic bands | one L/C band for all meanings; alarm alone off-band (+chroma) = one-alarm made physical | alarm vs caution separate by hue only; dark ground loses basalt-green for warm charcoal |
| p4 · dark-first | dark authored, light derived by rule (α = 0.86 global loudness exponent, hue locked ≤0.5°) | brand blue not in palette; light pea is bottle-green not mint; globally rigid to hand-tweaks |

Cross-cutting findings already earned: the base builder proved canon `Button`/`Chip` are
*palette-invariant* (they reach app tokens no `[data-palette]` scope can retint) — the
strongest argument yet for token indirection in the component-repair step. Both p2 and p4
independently diagnosed kiln's near-zero chroma (not the token aliasing) as caution's root
failure, and both independently killed light ink-2's 55° blue-slate drift.

### Round-2 verdicts (ruled 2026-08-16)

**p3 (wholistic bands) won by a lot.** The scaffold and most minutiae also approved. The
winning property is the one c donated and p3 chased: coordination — every role on shared
OKLCH lightness/chroma bands so the palette reads as one system, with the alarm alone
off-band (the one-alarm law made physical).

Retired: p1 (user-deleted during judging), p2, p4, and the e reference — snapshot
`proto/design-lang-base2-round2`. p0 survives only as tokens.css's default block. Loser
donations were the diagnoses already recorded above (kiln's chroma, ink-2's blue-slate
drift, p4's written derivation rule available if dark ever needs re-deriving).

Ruling notes to absorb (fixes applied to base + p3 same day):

1. **Pea's proposal cell must keep the unsaved square** (bottom-left, pea's colour) — the
   base's weak-anchor arbitration dropped it; the fold + square travel together on an open
   proposal. The user's own staged square stays distinct.
2. **The table-axes key is promoted to a first-class entity.** It was instrumental to the
   table reading well. Open design work: how cell states sort/group inside it (by axis, in
   precedence order) — feeds the component-repair step as its own component.
3. **New convention (border budget): plain content is never enclosed.** Artifact frames are
   for machine-operated objects carrying state (table, chat card, arming strip, sentence).
   Groups of plain controls or receipts — "goes somewhere" nav, the outcomes lane — sit on
   the page unframed. Convention, not yet a component standard.
4. **Two real mistakes:** `sync to .r10`, `cancel`, and `re-plan` buttons blend into their
   grounds or hover badly, in both modes. Fixed as note-4 work; hover states generally are
   an untested axis (the fixture has no hover/focus/selected states — round-1 finding).

## The cell-scale ruling (2026-08-16, kaitpw — supersedes the footline at row scale)

Judged on the live `/design-system` §04 table after the cell-state clause landed. Ruled:

- **A table cell displays the value and nothing else.** Body colorations fill the ENTIRE
  cell body (the cell is the td's content box), not a pill around the input. Strikeouts,
  citations, comments, reasons — everything prose-shaped — has a different home.
- **Fat rows are never allowed.** Cells clip rather than expand or wrap; row height and
  column x/y alignment are uniform by construction. `StateCell scale="row"` is this,
  enforced in `lang.css` (`min-height` tied to the h-7 row law).
- **The different home is the READOUT BAND**: a constant-height strip on the table (the
  spreadsheet formula-bar motif — cross-software meaning over novelty) that reads out the
  focused cell's state word, refusal reason, note, citation, and the model's ghost value.
  The `title` stays as the hover shortcut. Card scale keeps the footline — pea's card is
  not a table row.
- This RESOLVES the "footline clamp" frontier knob below at row scale (the clamp now only
  governs the card) and re-scopes the ghost token: inline ghost is card-scale only.

## Frontier — grammar doubts that remain after round 2

**Grammar knobs still hard-coded in the base** (each is a constant no round has varied):
- **Wash strength (20% mix) and ring weight.** p1 and p2 both hit its light-mode ceiling;
  pea's ring-over-wash at 2.08:1 is p3's own weakest pair. Palette variable or grammar
  constant? The one numeric knob most likely to move in round 3.
- **Pea display vs pea-ink as two tokens.** p4 showed they collapse to a 1.19:1 nuance in
  light; p3 had to pull the display rung off-band to keep the ring alive. One token or two?
- **The footline clamp** (capReason ▸ note ▸ citation, one line, truncates real sentences —
  including the RFI citation). Acceptable loss, or does a clamped row need a disclosure?

**Untested compositions and states** (the fixture never forces them — round-1 finding):
- Only proposed+drift is proven. Staged+stale, grounded+drift (citation underline vs
  squiggle on one value), refused+proposed — all asserted by precedence, proven by nothing.
- **Interaction states are undesigned as a system**: no hover/focus/selected/editing state
  exists in the fixture; the note-4 button mistakes were the symptom, not the disease.

**State-model gaps that block grammar work** (the model must move before the language can):
- `staged` has no author — pea's square vs the user's square is currently inferred from
  `origin`, which is the wrong fact.
- "Typing beats proposing" (severed) has no `stage` member and cannot be rendered at all.
- Arming has no lifecycle (unarmed → armed → refused → re-plan is the whole point of the
  strip and only two frozen frames exist) and outcomes link to no verb/target/items.

**Conventions to finish codifying:**
- The border budget (ruling note 3): artifact frame = machine-operated object carrying
  state; plain content never enclosed. Edge cases unruled: is the write-verb group an
  artifact? A bare receipt line?
- The cell-state key as a first-class component (`CellStateKey`), including its sort/group
  semantics — seeded in the base, owned by the component-repair step.

**Deferred with owner:**
- `--viz-*` parallel palette — deferred until a chart consumer exists; p3's band system now
  gives it a recipe (one band, N hues).
- Enforcement lever (oxlint JS-plugin rule vs staged hook vs CI) — component-repair step.
- `ops/primitives` disposition — migration step.
- Canon `Button`/`Chip`/`Verb` token indirection (palette-invariance finding) — the first
  work item of the component-repair step.
