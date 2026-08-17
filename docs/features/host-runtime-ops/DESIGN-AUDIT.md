# /ops — design-language audit

What the ops surface needed that `components/lang` + the `--r-*` canon could not say, recorded
during the design-language sweep of 2026-08-16 (ops pass). `/ops` is the **second system's home
surface**: `ops/primitives.tsx` carried a parallel vocabulary (Chip · MonoNote · EmptyState ·
OpSection · KVGrid · Provenance · CoverageBar on `--cat-*`/`--line*`/`tele`) that this pass
dissolved onto the one language. The surviving ops-owned shapes are exactly the Revit-familiar
ones: **TreeView** (Project Browser), **DataTable** (schedule grid), **KVGrid** (properties
palette), plus a new **VizChip** for taxonomy spends — all retinted onto `--r-*` + the viz ladder.

Governance for this pass: `components/lang/*`, `styles.css`, `design-lang.css` were **not**
changed. Where the language could not express something, the code was left honest and the gap
written down below. These are for joint review; nothing here is a decision.

Language canon: [`../../design/SURFACE-PHILOSOPHY.md`](../../design/SURFACE-PHILOSOPHY.md),
[`../design-lang/CLEANROOM.md`](../design-lang/CLEANROOM.md) (the consolidation batch rulings
R1–R14 are implemented here, not re-litigated), `apps/web/src/design-lang.css` (the header is the
law). Contract-shape notes preserved verbatim in
[`../design-system/OP-CONTRACT-FEEDBACK.md`](../design-system/OP-CONTRACT-FEEDBACK.md) — every
`contractNote` string survived this pass byte-identical.

---

## A · State census

Every distinct state `/ops` renders, against the four axes (**freshness** `fresh` ·
**agreement** `agree` · **staging + author** `stage` · **capability** `cap`) and the **outcome
lane** (`OutcomeKind`). "—" means the axis says nothing; **bold** marks a state with no axis.
The surface is readonly testimony, so the census skews toward freshness, capability, and
outcomes — there is almost no staging and no user-authored anything.

| # | state | fresh | agree | stage | cap | outcome | rendered as, after the sweep |
|---|---|---|---|---|---|---|---|
| 1 | op ran, result on screen (status · ms · obs) | ✅ obs stamp | — | — | — | `receipt` ✅ | `OutcomeLine receipt` |
| 2 | synthetic fan-out in flight | — | — | — | — | `busy` ✅ | `OutcomeLine busy` |
| 3 | a required synthetic dep failed | — | — | — | — | `error` ✅ | `OutcomeLine error` per dep (was a bordered clay box — box deleted, border budget) |
| 4 | staged detail fetch failed (drawing-set) | — | — | — | — | `error` ✅ | `OutcomeLine error` |
| 5 | response shape the view cannot narrow | — | — | — | — | `error` ✅ | `UnrecognizedShape` (was **EmptyState** — a mislabelled error; #2 below) |
| 6 | host-reported issue, severity Info/Warning/Error | — | — | — | — | **no rank** | caution ink mono line, the severity word carries rank (#1) |
| 7 | payload truncated by budget / page incomplete | ✅ | — | — | — | — | `Provenance` line ("N of M returned — truncated by budget") |
| 8 | obs stamp: host clock vs client receive | ✅ | — | — | — | — | `Provenance` ("obs HH:MM (host clock)") |
| 9 | incomplete element set per category | ✅ | — | — | — | — | caution mono ids + " …" |
| 10 | mutating op | — | — | — | ✅ risk | — | `FactChip caution` + caution `M` marker in the list |
| 11 | cost tier cheap/bounded/expensive | — | — | — | ✅ risk | — | `FactChip` — expensive wears caution, the word carries the rest |
| 12 | requires active doc / family-only / project-only | — | — | — | ✅ precondition | — | `FactChip caution` |
| 13 | document read-only / not modifiable | — | — | — | ✅ | — | `FactChip caution` (a row fact — no cell to wear `cap:`) |
| 14 | the view may lie: temp hide/isolate, hidden filter/category/workset, unloaded link | — | — | — | **none** | — | caution (chip tone or `KVTone`); these are view-trust facts with no axis |
| 15 | reference resolution: resolved / ambiguous / none | — | ~ | — | — | — | done/caution word; rank via order + viz-1 score bar + ink locate edge (#7) |
| 16 | formula-derived value (matrix, family snapshot) | — | — | — | R4 ✅ | — | `--r-ink-2`, formula in the title — DERIVED is not a state |
| 17 | parameter-link proposed write, would change | — | — | ✅ *staged* | — | — | caution ink (**staged has no machine author**, #3) |
| 18 | writes applied this call | — | — | — | — | receipt-ish | `Provenance` tail (not a lane — count only) |
| 19 | bridge connected / down · agent runtime up / down | — | — | — | — | state fact | `FactChip done` / `caution` ("a busy bridge is NOT the model disagreeing") |
| 20 | dead session (last seen, not reachable) | ~stale | — | — | — | — | opacity 60 + `FactChip caution` "disconnected" + "not queried" mono line |
| 21 | doc fetch skipped over the 12-session bound | — | — | — | ✅ budget | — | caution mono line naming the bound |
| 22 | nothing here yet (no docs open, no pods, spare/space, ∅) | `never` ✅ | — | — | — | — | `EmptyState` with story+exit, or `--r-ink-mute` italic |
| 23 | selection: active list row, active doc tab, selected thumbnail | — | — | — | — | — | the `--r-select` fill + `--r-on` re-declared — never a hue (was blue inset bars/washes) |
| 24 | synthetic op = a contract that does not exist yet | — | — | — | — | — | seam ✅ — `FactChip dashed` "synthetic" |
| 25 | sheet outside the detail budget (no geometry fetched) | — | — | — | — | — | seam — dashed `EmptyFrame`, deliberately kept (#6) |
| 26 | this op has a curated view (list marker) | — | — | — | — | — | neutral `--r-ink-2` dot (was `--pe-green` — pea's identity spent on a non-pea fact) |

Axis coverage is honest: a readonly console has freshness, capability and outcomes, and this
census maps cleanly onto exactly those; the states with **no axis** (#6, #14) are both
"how much should you trust what the host said" facts, which is a vocabulary the cell grammar
never needed before.

---

## B · Findings

### 1 · One caution, three severities

Host ops report `Info | Warning | Error` per issue, and logs carry `warn | error | fatal`. The
meaning band has exactly one alarm (reserved: the model disagrees — never true here) and one
caution. So Warning and Error both wear `--r-caution` and only the word separates them —
grayscale-law legal, but a three-rank vocabulary is being flattened onto a two-rank palette
everywhere ops renders diagnostics (`IssuesNote`/`issueLine` in every view file, `logLineColor`
in `views-host.tsx`). Left honest. If a second warning rank is ever wanted it must be a token
ruling, not a route invention.

### 2 · Fixed en route: "unrecognized response shape" was wearing an empty state

Forty-odd call sites rendered a data-shape **failure** as `EmptyState` — claiming absence when
rows may well exist. That is the mirror image of takeoffs #12 (an error wearing the seam chip).
Now `UnrecognizedShape` in `ops/registry.tsx`: an `OutcomeLine kind="error"` whose `says` points
at the raw-response disclosure as the exit. Recorded because reserved shapes are supposed to make
exactly this drift findable.

### 3 · Staged-by-machine has no author rung

`revit.detail.parameter-links` renders proposed writes: values an updater *would* write —
staged, unsaved, and authored by neither "you" nor pea but by a rules engine. R1's authorship
qualifier (`stagedBy`, reads only when staged) has no rung for "the machine's own rules". The
value wears plain `--r-caution` (staged = unsaved) with no authorship mark. If pea ever proposes
through this pipeline, the pea-ink treatment and this one become indistinguishable — the state
model needs the author rung before the language can say it.

### 4 · Testimony cards vs the artifact-frame monopoly

The ops views draw many hairline-framed cards — the document hero, `ObservedViewCard`,
`ElementCard`, panel cards, host/session nodes, recent-document tiles. The border budget says
plain content is never enclosed and `components/lang/artifact-frame.tsx` is the only thing that
draws a frame. These cards are machine-measured testimony objects (table-like, Revit-palette
flavoured), but they are not `ArtifactFrame`s and they carry no writable state. This pass
retinted every frame onto `--r-line`/`--r-line-2` and deleted the tinted head bands
(`--pe-blue` 12% washes → `--r-recess` bands with `--r-on` re-declared) but did **not** un-box
them: whether a readonly testimony card is an "artifact" or must dissolve onto the page ground
is a border-budget ruling, not a route call. The frames are now at least all quiet and uniform.

### 5 · The panelboard's blue gutter died

Circuit numbers in the two-column panelboard were `--pe-blue` — Revit-flavoured decoration, but
the law leaves blue only two jobs (commit fill, nav text). The spine gutter now reads `--r-ink`.
Some Revit-familiarity is lost; if panel-schedule identity earns colour back it must be a viz
spend, argued at review.

### 6 · One deliberate dashed spend kept: the undetailed sheet frame

`glance/drawing-set.tsx`'s `EmptyFrame` — the empty titleblock for sheets outside the 10-sheet
anchor budget — keeps its dashed border. Judged a *legal* seam under R13(b): a declared sheet
with no geometry behind it, the stand-in announcing what the budget left out (the thumbnail's
title says so in words). If review reads it as "not-fetched ≠ seam", the replacement is a plain
`--r-line` frame — one line.

### 7 · Rank marks are the same hole as takeoffs #8

`revit.resolve.references` marks the top candidate and demotes the rest of an ambiguous set. It
was blue edge + blue wash (top) and kiln edge (demoted) — hue carrying rank. Now: order + the
`#n` gutter + a single-series `--viz-1` score bar carry rank (grayscale law); the edge mark is
`--r-ink` for the leader (R13a's neutral locate mark, blessed for spatial views, borrowed here)
and `--r-caution` for a demoted candidate. The law has no written clause for *rank* marks —
R13a covers "where a fill cannot separate", which is the spirit but not the letter.

### 8 · Three-rank confidence onto two roles

`concept-evidence` confidence High/Medium/Low → `done`/`meta`/`caution` FactChips. Works, but it
is finding #1 in another costume: any host-supplied trust ladder deeper than two rungs leans on
the word.

### 9 · The 9px floor rose to 10px

The sidebar's op-key lines and count badges were `text-[9px]` tele; the tier system's floor is
`t-caption` (10px) and off-ladder sizes are banned. They now render at 10px. No complaint
expected, recorded because it is a visible metric change nobody ruled on explicitly — the tier
law did.

### 10 · Schedule column heads went small-caps sans

`DataTable` headers were bold 12px body text (Revit schedules bold their column heads). The
weight law reserves semibold for `t-title`/`t-upper` heads only, so column heads and the
centered title band are now `t-label t-upper` — small-caps tracked sans. Uniform with every
other head in the language; flagged because it trades away a notch of Revit-verisimilitude and
uppercases user-authored column names.

---

## C · What migrated

| | count | notes |
|---|---|---|
| `Chip` → **split, per site** | **36 VizChip · 41 FactChip** | VizChip (new, ops-owned, `--viz-N` 12%/25%/ink): handle kinds, categories (hash + discipline maps), doc kinds rvt/rfa/rte, anchor kinds (chips + SVG marks share the rung), binding kinds, evidence sources, settings-file kinds, sheet-series disciplines, electrical object kinds. FactChip (meaning tones): workshared/cloud (meta), read-only · not-modifiable · filter-by-sheet · hidden/unloaded · non-operational · invalid · missing · disconnected · doc-gates · mutate · expensive (caution), bridge-connected · aps-valid · confidence-high (done), synthetic (dashed seam). Remainder of the old 82 became plain mono spans or died |
| `MonoNote` → **dies** | ~79 mono spans | `face-mono t-caption` + `--r-ink-2`, or a meaning ink where it carried state; 3 became `OutcomeLine`s (busy/error), 1 became an `EmptyState` |
| `OpSection` → lang `Section` | 48 | label/aside carried over 1:1 |
| ops `Provenance` → lang `Provenance` | 61 | |
| ops `EmptyState` → **split** | 43 lang `EmptyState` · 40 `UnrecognizedShape` | every lang empty carries a REQUIRED `story` + `exit`; the dashed border is gone; the ~40 shape-failure sites became error outcomes (#2) |
| ops `CoverageBar` → lang `CoverageBar` | 5 | segments on `viz:` indices (identity carryover blue→1 green→2 slate→3 lichen→4 clay→5 kiln→6); empty denominators now guarded at call sites with real-exit `EmptyState`s |
| `TreeView` / `DataTable` / `KVGrid` | retinted, ops-owned | `--line*` → `--r-line`/`--r-line-2`; `bg-muted` → `--r-recess` **with `--r-on` re-declared on the same rule**; hover → the one veil (`background-image: linear-gradient(var(--r-veil),var(--r-veil))`); tele → `face-mono t-value`/`t-caption`; heads → sans `t-label t-upper`; `KVGrid.hue` → `tone?: "caution"` (one-member union — no second consumer earned a rung) |
| `CatHue` / `catVar` | **deleted** | zero consumers; `VizIndex`/`vizVar` replace them for SVG spends |
| selection sites | 4 | list rows, doc tabs, sheet thumbnails: blue inset bars/washes → `--r-select` fill + `--r-on` |
| `Verb` | 1 | synthetic refresh (tone act, busy-aware, required reason) |
| copy purge | — | "Pick a host op… localhost:5180" → EmptyState + a Provenance fact line; list empties → story/filter empties with exits; no head rail existed to recompose onto `AddressingBar` (the route is a two-pane console; its per-op header is op identity, not route addressing) |

**Files touched:** `ops/primitives.tsx` (333 → 262 lines, four exports), `ops/registry.tsx`,
`ops/synthetic.tsx`, `ops/views-{context,catalog,detail,electrical,host}.tsx`,
`ops/glance/{model,topology,drawing-set}.tsx`, `routes/ops.tsx`. Nothing under `components/`,
`styles.css`, or `design-lang.css`.

**Shim consumers after this pass:** `src/ops/**` + `routes/ops.tsx` consume **zero** shim
tokens — only `--r-*`, `--viz-*`, `--radius`, `--font-*`. Repo-wide, with the concurrent
routes/workbench sweep commits (`782a958`…`7f6a54f`) also in the tree, these shim lines are now
at **zero consumers** outside `styles.css` itself: `--paper-2 · --paper-3 · --mist · --basalt
· --ink · --slate · --lens-ink-2 · --pe-blue-soft · --pe-green · --clay · --kiln · --fail ·
--clay-ink · --clay-tint · --user · --user-tint · --user-line · --pea-tint · --pea-line`
(`--pe-green`'s last consumer was this route's curated-view dot). Still live, held by other
surfaces: `--line`/`--line-2`/`--line-soft` (ui/side-pane, ui/pane, sentence, target-ui,
design-system popovers), `--paper` (side-pane), `--pe-blue` (sentence, ui/command, fleet,
target-ui), `--lichen` (host/field-options), `--cat-*` (sentence, fleet, issues, target-ui,
ui/badge utilities), and the `tele`/`tele-label`/`section-label` bundles (~14 files). Shim-line
deletion stays with the sweep owner per the no-unilateral rule.
