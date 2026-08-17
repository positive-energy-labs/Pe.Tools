# Type + copy census

Ground for an upcoming standards ruling. Counted 2026-08-16 over
`source/pe-tools/apps/web/src` (163 source files, ~32.3k LOC of TSX).

**Nothing here is ruled.** This file is evidence plus one clearly-marked proposal. The authorities
it must not contradict are `docs/design/SURFACE-PHILOSOPHY.md` §5, `docs/features/design-lang/CLEANROOM.md`,
and the type utilities in `apps/web/src/styles.css`.

Method: `grep` over `*.tsx`/`*.ts`/`*.css`; a "spend" is one occurrence of a font-size class,
size utility, or CSS `font-size` declaration. Where a utility's size is overridden at the call site
(`tele text-[10px]`), the spend is counted once, at the **rendered** size.

> **Working-tree note.** `family/proto/variant-e.tsx` was split mid-census (by concurrent work, not
> by this census — no code was touched here) into `family/{workspace,doc-pane,anatomy,marks}.tsx`.
> Line references to `variant-e.tsx` below point at the pre-split file; the successors carry
> 81 type spends and 54 `title=` attributes against variant-e's 96 and 50, and `workspace.tsx`
> inherits the bulk (60 type / 41 titles). App-wide totals moved by under 1 % (806 vs 807 type
> spends; 355 vs 360 titles), so every aggregate here stands.

---

## Headline

| | |
|---|---|
| Type-size spends, net of overrides | **666** in TSX + 31 in CSS |
| Distinct rendered sizes | **17** (8, 9, 9.5, 10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 15, 16, 18, 20, 30, 48px) |
| Share of spends in the 9–12.5px band | **90.2 %** (601 / 666) |
| `tele` call sites that override `tele`'s own 12px | **118 of 240 (49 %)** |
| Static `title=` attributes | **176**, totalling **13,389 characters** (~2,100 words) |
| Dynamic `title={…}` attributes | **184** |
| Static titles that are two or more sentences | **63 of 176 (36 %)** |
| Static titles ≥120 characters | **51 of 176 (29 %)** |
| Flowery inline prose instances outside `title=` | **~220 across 37 files** (~130 outside `/design-system*`) |
| `font-bold` spends outside the reserved axis | **1** |
| `italic` spends | **22**, of which ~5 are outside locked/disabled/dropped |

---

## PART 1 — type application

### 1.1 · Every distinct font-size spend

Raw counts, before resolving utility overrides.

**Arbitrary `text-[Npx]` — 303 spends, 12 distinct values**

| value | count | | value | count |
|---|---:|---|---|---:|
| `text-[10px]` | 126 | | `text-[12.5px]` | 6 |
| `text-[11px]` | 75 | | `text-[8px]` | 1 |
| `text-[9px]` | 47 | | `text-[13.5px]` | 1 |
| `text-[13px]` | 16 | | `text-[15px]` | 1 |
| `text-[12px]` | 12 | | `text-[30px]` | 1 |
| `text-[10.5px]` | 10 | | `text-[0.625rem]` | 2 |
| `text-[11.5px]` | 7 | | `text-[0.7rem]` | 2 |

**Tailwind steps — 164 spends, 7 distinct**

| step | px | count |
|---|---:|---:|
| `text-xs` | 12 | 118 |
| `text-sm` | 14 | 31 |
| `text-lg` | 18 | 6 |
| `text-base` | 16 | 6 |
| `text-xl` | 20 | 1 |
| `text-3xl` | 30 | 1 |
| `text-5xl` | 48 | 1 |

**Utilities — 336 spends**

| utility | declared | count | of which size-overridden at the call site |
|---|---|---:|---:|
| `tele` (mono 12px, `0.05em`, tabular) | 12px | 240 | **118** — 63→10px, 33→9px, 21→11px, 1→10.5px |
| `tele-label` (mono 11px, `0.08em`, upper) | 11px | 73 | **23** — 19→10px, 4→9px |
| `section-label` (sans 11px, 600, upper) | 11px | 23 | 0 |

**CSS `font-size:` declarations — 31 spends.** `components/lang/lang.css`, which is the *canon*
component stylesheet, alone declares **8 distinct sizes in 20 declarations**: 12px ×4, 10px ×4,
11px ×3, 10.5px ×3, 9.5px ×2, 11.5px ×2, 9px ×1, 12.5px ×1. `workbench/lens.css` adds 11/12/13.

### 1.2 · Where the sizes cluster

Net histogram (utility overrides resolved to rendered size), TSX only:

| rendered | spends | share | cumulative |
|---|---:|---:|---:|
| 8–9px | 48 | 7.2 % | 7.2 % |
| 10–10.5px | 138 | 20.7 % | 27.9 % |
| 11–11.5px | 157 | 23.6 % | 51.5 % |
| 12–12.5px | 258 | 38.7 % | **90.2 %** |
| 13–13.5px | 17 | 2.6 % | 92.8 % |
| 14–16px | 38 | 5.7 % | 98.5 % |
| 18px+ | 10 | 1.5 % | 100 % |

Three clusters carry 90 % of the surface: **~10px, ~11px, ~12px**. Everything above 13px is 7 %
of spends and is almost entirely titles. The half-pixel values (9.5, 10.5, 11.5, 12.5, 13.5) total
**24 spends across 5 values** — 3.6 % of the surface spent on a vocabulary nobody can hold in their head.

### 1.3 · The four findings behind the numbers

**a · `tele` no longer has a size.** Its declared 12px survives at only 122 of 240 call sites. The
overrides all go *smaller* (10px ×63, 9px ×33), which means the utility is being used as
"mono + tracking + tabular-nums" — a **face**, not a tier — and the size is re-decided per call site.
Same story at `tele-label`: 23 of 73 overridden.

**b · The section head is forked five ways**, and canon does not use the utility built for it.
`/design-system` — the newest and most authoritative route — spends `section-label` **zero** times
and hand-rolls `text-[11px] font-semibold tracking-[0.09em] uppercase` instead (4 sites, plus the
two satellites). The full set of coexisting section-head treatments:

| form | face | size | where |
|---|---|---|---|
| `section-label` | sans 600 | 11px | `takeoff/atlas`, `routes/ops`, `workbench/world`, 8 more (23) |
| `tele-label` | **mono** | 11px (or 10/9 overridden) | 26 files (73) |
| `text-[11px] font-semibold tracking-[0.09em] uppercase` | sans 600 | 11px | `design-system` + both satellites (4) |
| `text-[10px] font-semibold uppercase tracking-wider` | sans 600 | 10px | `grounded-doc/GroundedDocView` (3) |
| `text-[10px] tracking-[0.12em] uppercase` | sans | 10px | `workbench/Lens`, `components/thread-palette` (2) |
| `text-xs font-semibold uppercase` | sans 600 | 12px | `routes/ops`, `routes/index` (2) |
| `.dl-verb-group-title` | **mono** | 10px | `components/lang/lang.css:357` |

`styles.css:170` states the law — *"Section headers are small-caps tracked SANS (not mono)"* — and
`tele-label` (mono, 73 spends) plus `.dl-verb-group-title` (mono) break it more often than
`section-label` (23 spends) keeps it.

**c · 13px is an unlabelled page base.** The three `/design-system*` routes each set
`text-[13px]` on their root container (`design-system.tsx:145`, `_.arming.tsx:66`,
`_.proposal-flow.tsx:98`, `_.popovers.tsx:302`), and `workbench/aui.tsx:351` /
`workbench/world.tsx:167` / `components/thread-palette` use 13px for chat prose. This is a real,
consistently-used role — **human sentences** — that has no utility and no name.

**d · Canon primitives are already off-ladder.** `components/ui/badge.tsx:9` renders at
`text-[0.7rem]` (11.2px), a size that appears nowhere else in the app.

### 1.4 · `font-pe-display` (Spectral) — 11 spends

| file:line | size | what it titles |
|---|---|---|
| `routes/index.tsx:252` | `text-5xl` (48px) | the front-door hero |
| `routes/design-system.tsx:175` | `text-3xl` (30px) | route title |
| `workbench/Lens.tsx:580` | `text-[30px]` | route title (via `font-[var(--font-display)]`) |
| `workbench/route-workspace-shell.tsx:55` | `text-xl` (20px) | route title (via `font-[family-name:var(--font-display)]`) |
| `routes/data-tables.tsx:102`, `routes/schedule-grid.tsx:112`, `routes/takeoffs.tsx:413`, `takeoff/atlas.tsx:675` | `text-lg` (18px) | `<h1>` page title |
| `takeoff/atlas.tsx:1599` | `text-base` (16px) | pane `<h2>` |
| `design-system.tsx:144`, `_.arming.tsx:268`, `_.proposal-flow.tsx:385`, `_.popovers.tsx:329`, `routes/takeoffs.tsx:897` | `text-sm`/`text-[13px]` (13–14px) | sticky header wordmark, dialog title |

**Verdict: consistent with "display garnish only."** Every single spend is an `h1`/`h2`/dialog
title or a header wordmark; none is body, label, value, or chip. The only inconsistency is
*mechanical*: three different ways of naming the same face —
`font-pe-display` (8), `font-[family-name:var(--font-display)]` (1), `font-[var(--font-display)]` (1) —
and two token names for it (`--font-pe-display` vs `--font-display`).

The **size** is where display drifts: 13, 14, 16, 18, 20, 30, 48px — seven sizes for one role.

### 1.5 · Mono discipline

The law (SURFACE-PHILOSOPHY §5, `styles.css:166–170`): *monospace means machine-authored literal
text; mono is never chrome.*

**The systemic problem is the opposite of a violation list.** In `components/lang/lang.css` —
the canon language stylesheet — **10 of 12 `font-family` declarations are mono** and only 2 are
sans (`.dl-help-pop`, `.dl-outcome-says`). Mono is the *unmarked default* of the canon, so the
face has stopped carrying the signal the law assigns it. Same at the utility level: `tele` +
`tele-label` = 313 mono spends vs `section-label` = 23 sans spends.

**Mono used for chrome (spot-check, not exhaustive):**

| site | what |
|---|---|
| `components/ui/verb.tsx:42` | **a verb** — a button label — is `tele`. Pressing a control is not a measurement. |
| `components/lang/lang.css:316` (`.dl-help-mark`) | the `?` help glyph, mono 9px — pure chrome |
| `components/lang/lang.css:357` (`.dl-verb-group-title`) | verb-group section head, mono 10px |
| `routes/ops.tsx:480` | `<summary>` disclosure control in `tele-label` |
| `routes/takeoffs.tsx:781` | a `<label>` in `tele` |
| `takeoff/atlas.tsx:830,1361`, `workbench/aui.tsx:185`, `routes/instances.tsx:351`, `components/sentence.tsx:269` | five buttons in `tele`/`tele-label` |
| `family/proto/variant-e.tsx:2579` | `<p className="tele">No spec attached to render.</p>` — an empty state, in mono |
| `routes/takeoffs.tsx:608`, `takeoff/atlas.tsx:1132` | empty-state prose in `tele-label` ("no zones on this level") |
| `_.arming.tsx:206`, `_.proposal-flow.tsx:272` | `tele-label` on the sentence "what this page found" |
| `routes/families.tsx:1420` | `<pre className="tele">` — correct face, but wrapping route prose |

**Sans used for machine-measured values:** rare. The clean spot-checks —
`components/master-table/cells.tsx` (all cells `tele`), `components/ui/chip.tsx:36` (`tele`),
`components/lang/lang.css` footlines/tags/ghosts (mono) — all obey. Three sites reach for
`[font-variant-numeric:tabular-nums]` *without* a mono face (`workbench/world.tsx:166,190,543`),
which is the honest tell that a number is being set in sans. `components/ui/badge.tsx` is sans at
11.2px and is used for counts in several places.

**Net:** the law is broken far more by mono-as-chrome (~15 sites, and structurally by lang.css's
10:2 mono default) than by sans-as-measurement (~4 sites).

### 1.6 · Weight and italic — the reserved axes

CLEANROOM: *"Bold stays reserved for unsaved"* · *"Locked/uneditable is greyed italic."*

**Weight — 124 spends, and the reserved axis is clean.**

| class | count |
|---|---:|
| `font-medium` | 58 |
| `font-semibold` | 52 |
| `font-normal` | 13 |
| **`font-bold`** | **1** (`workbench/world.tsx`) |

Only one `font-bold` in the whole app, and it is not on an unsaved marker — so the axis is
*unspent*, i.e. available, rather than violated. The live question is different: `font-semibold`
(600) at 52 spends is doing section-head and title duty, and `font-medium` (500) at 58 spends
is doing emphasis duty. Neither is "bold", but at 11px the 400→600 jump reads as bold to a user,
so **the reserved axis is arguably already occupied under a different class name.**

**Italic — 22 spends, ~17 legitimate.**

Legitimate (locked / read-only / disabled / dropped):
`lang.css:130` (`--dl-cell-italic` on `data-body="locked"`), `components/lang/verb.tsx:32`,
`components/lang/outcome.tsx` (dropped), `components/lang/cell-key.tsx:75`,
`variant-e.tsx:1390,1696` (`entry.readOnly`), `design-system.tsx:977,1036` (documenting the law).

Off-axis (5):
- `variant-e.tsx:1258,1371,1408,1684` — italic paired with `text-[var(--st-warn)]`, i.e. italic
  used for **warning**, not locked. Four sites.
- `variant-e.tsx:1441` — italic on `--st-derived`; derived is not locked.
- `variant-e.tsx:1096` — italic on the ghost/placeholder row.
- `routes/families.tsx:292` (`EMPTY_CLASS`) and `:788` — italic marks **empty** and
  **ProjectBindingOnly**; `:785` even documents the choice ("separates from a project binding by
  italic rather than by hue"), which is a deliberate deviation worth ruling on rather than a slip.
- `design-system.tsx:660` — italic on "what it asks" caption prose.

### 1.7 · Line-height, for the record

13 distinct `leading-*` spends: `leading-relaxed` 25, `leading-snug` 13, `leading-7` 10,
`leading-[1.5]` 5, `leading-none` 4, `leading-tight` 3, `leading-normal` 3, `leading-[13px]` 3,
`leading-[1.45]` 2, and one each of `leading-[12px]`, `leading-[11px]`, `leading-[1.55]`,
`leading-6`. Mixing unitless ratios, px, and Tailwind keywords on the same surfaces. A size tier
should carry its leading, so the call site never names one.

### 1.8 · Distinct-size vocabulary per file (chaos meter)

| distinct rendered sizes | file |
|---:|---|
| 9 | `routes/design-system.tsx` |
| 7 | `workbench/world.tsx`, `routes/design-system_.proposal-flow.tsx`, `routes/design-system_.arming.tsx` |
| 6 | `workbench/Lens.tsx`, `routes/ops.tsx`, `components/thread-palette.tsx` |
| 5 | `workbench/aui.tsx`, `routes/schedule-grid.tsx`, `routes/instances.tsx`, `routes/index.tsx`, `routes/family.tsx`, `routes/design-system_.popovers.tsx`, `ops/views-context.tsx`, `grounded-doc/GroundedDocView.tsx` |

The route with the most size vocabulary is the one meant to *be* the executable law.

---

## PART 2 — copy

### 2.1 · `title=` attributes: the numbers

360 `title=` attributes: **176 static strings**, **184 expressions**.

Static-title prose volume, by file:

| chars | titles | avg | file |
|---:|---:|---:|---|
| 3,171 | 17 | 186 | `family/proto/variant-e.tsx` |
| 2,941 | 19 | 154 | `routes/families.tsx` |
| 1,695 | 11 | 154 | `routes/family.tsx` |
| 1,116 | 13 | 85 | `takeoff/atlas.tsx` |
| 832 | 23 | 36 | `routes/design-system.tsx` |
| 825 | 7 | 117 | `components/master-table/master-table.tsx` |
| 418 | 3 | 139 | `components/sentence.tsx` |
| 349 | 5 | 69 | `routes/takeoffs.tsx` |
| 343 | 8 | 42 | `routes/design-system_.proposal-flow.tsx` |
| 181 | 8 | 22 | `routes/schedule-grid.tsx` |
| — | — | — | 21 further files, all under 160 chars total |
| **13,389** | **176** | **76** | **total** |

Length distribution:

| bucket | count | share |
|---|---:|---:|
| ≤24 chars (a name or a verb) | 63 | 36 % |
| 25–60 chars (one clause) | 38 | 22 % |
| 61–120 chars (one or two sentences) | 24 | 14 % |
| 121–200 chars (a paragraph) | 40 | 23 % |
| >200 chars (an essay) | 11 | 6 % |

**63 of 176 (36 %) are multi-sentence.** The four longest run 366, 356, 337, and 309 characters —
each longer than this paragraph, each fired on hover, each unreadable at a glance, none of them
selectable, searchable, or reachable by keyboard.

The distribution is **bimodal**, and that bimodality is the ruling's whole shape: 58 titles are a
bare noun or verb under 20 characters with no period, and 51 titles are ≥120 characters. There is
almost nothing in between doing a third job. Two different primitives are wearing one attribute.

### 2.2 · Title taxonomy today

Approximate classification of the 176 static titles (heuristic + read; buckets overlap slightly):

| # | what the title is doing | count | representative |
|---|---|---:|---|
| 1 | **Control label** — names the control or what pressing it does. Imperative or bare noun. | ~58 (33 %) | `"Add column"` · `"Undo stage"` · `"Delete thread"` · `"Re-read this schedule from Revit"` |
| 2 | **Definition** — what this value/chip/count *means*. Declarative, one sentence. | ~35 (20 %) | `"Rows currently in scope."` · `"Pea's own count of what it is proposing."` · `"The plan this write was made against."` |
| 3 | **Region orientation** — what this pane/table/section *is* and how to think about it. Multi-sentence. | ~48 (27 %) | see §2.3 — every one of the worst 10 |
| 4 | **Refusal / failure reason** — why this is disabled, or what went wrong. | ~15 (9 %) | `"needs an active Revit document"` · `"This room was detected but never materialized, so there is no element to write a verdict onto. Partition the zone first."` |
| 5 | **Honesty disclaimer** — this lane is fixture/mock/prototype. | ~15 (9 %) | `"Fixture data — no host, no document, no element behind it."` (×5 identical) |
| 6 | **Overflow disclosure** — echo the full identifier a truncated cell is clipping. | dominant in the 184 **dynamic** titles | `title={path}` · `title={p.identity?.key}` · `title={row.open.join(", ")}` |

Bucket 6 is worth naming separately: nearly all 184 `title={…}` expressions are one of
(a) echo the clipped value, (b) `title={reason}` for a refusal, (c) `title={title}` passthrough on
a primitive. They are *machine* titles, carry no authored prose, and are not in scope for the
help-tip.

**Where the boundary already falls in the data.** Buckets 1, 2, 4, 6 are all short, control-scoped,
and machine-adjacent — 108 of 176 static titles plus essentially all 184 dynamic ones. Bucket 3
(~48 titles, ~9,000 of the 13,389 characters) is the whole problem: 27 % of the titles carry 67 %
of the prose, and every one of them is attached to a *region*, not a control.

Bucket 5 is the genuinely undecided case. A fixture disclaimer is neither a control fact nor
region orientation — SURFACE-PHILOSOPHY §3 already rules it should be *a chip*, not a tooltip
("the one acceptable shape of exception is a URL-gated mock lane that announces itself with a
chip"), so those 15 titles are arguably a third disposition: promote to visible chrome.

### 2.3 · Worst 10 — inline prose in `title=`

Quoted with line numbers; all paths under `source/pe-tools/apps/web/src/`.

1. **`family/proto/variant-e.tsx:1803`** (366 ch) — *"Read left to right: how much of this profile
   the spec backs, what pea still wants, how many geometry dimensions nothing can reach, how many
   cells save would write, and where Revit disagrees. Clay is spent on drift and nothing else…"*
   — a legend for the whole header strip, hidden in a tooltip.
2. **`family/proto/variant-e.tsx:2110`** (356 ch) — *"THE FAMILY-LEVEL VALUE — what every type
   inherits unless it overrides. The table shows it only as the grey placeholder in each type
   cell, and a placeholder is not an editor; this is where it is actually authored…"*
3. **`family/proto/variant-e.tsx:2957`** (337 ch) — *"The profile's own constituent list. Hovering
   one lights both the shape and the table rows it drives, because there is only ever ONE thing in
   focus…"* — teaches an interaction by hover text.
4. **`family/proto/variant-e.tsx:2024`** (309 ch) — *"The constituent's bindable numbers, shown
   here as a STATEMENT OF WHERE EACH ONE LIVES rather than as a second place to work…"*
5. **`routes/family.tsx:950`** (297 ch) — *"?mock — this page is running on a built-in fixture: a
   checked-in family.json, a few fake pea proposals, and a synthetic spec sheet standing in for a
   parse. No Revit host, no pea, no dispatcher, and every host verb refuses…"* — an honesty
   disclaimer that §3 says should be a visible chip.
6. **`family/proto/variant-e.tsx:2072`** (267 ch) — *"The half of the constituent no parameter can
   drive. It has no column in the table because it does not vary by type and it is not a number —
   and this is the ONLY place it appears, which is exactly the claim…"*
7. **`routes/family.tsx:1265`** (253 ch) — *"Start a new family.json. Clicking opens a name field
   here — the file is written from a minimal template (one prism, three length parameters, one
   type) and opened immediately, so you land in it rather than having to go find it."* — and
   `routes/family.tsx:1291` (215 ch) says the *same thing again* in different words.
8. **`routes/families.tsx:1222`** (235 ch) — *"Which layers of the profile decided this family's
   parameter facets, counted. It is a rollup of what the op reported, with no interpretation
   added — use it to see which part of the profile is doing the work."*
9. **`routes/families.tsx:1257`** (218 ch) — *"The plan compiled cleanly and matched nothing in
   the applied scope. Two exits: widen the scope above so the profile's families are loaded, or
   bind a profile that claims the ones already here."* — an **empty state** written into a tooltip,
   where the user in that exact state cannot find it.
10. **`components/master-table/master-table.tsx:579`** (201 ch) — *"Sort by this column. Clicking
    again flips the direction; shift-click appends it as a tie-breaker behind the sorts already
    applied, numbered in the header."* — in a shared primitive, so every consumer inherits it.

Honourable mention: `routes/families.tsx` carries **17** titles ≥120 chars, more than any other
file including the prototype.

### 2.4 · Flowery inline prose outside `title=`

Editorializing English baked into JSX as visible chrome — multi-sentence empty states, helper
paragraphs, section preambles, legend blocks, and prose held in config fields (`note:`, `spec=`,
`empty=`, `purpose:`, `contractNote:`) that renders into the page.

**~220 instances across 37 files.** Excluded by construction: `reason=` on `<Verb>` and
`MODE_HINT`, both of which map straight through to a native `title=` and are already counted in §2.1.

| ~count | file |
|---:|---|
| **~65** | `routes/design-system.tsx` |
| ~14 | `family/proto/variant-e.tsx` |
| ~14 | `routes/design-system_.arming.tsx` |
| ~11 | `routes/design-system_.proposal-flow.tsx` |
| ~9 | `workbench/world.tsx` |
| ~8 | `takeoff/atlas.tsx` |
| ~7 | `routes/takeoffs.tsx` |
| ~6 | `routes/families.tsx`, `routes/index.tsx` |
| ~5 | `routes/ops.tsx`, `components/lang/cell-key.tsx`, `family/doc-pane.tsx`, `ops/views-catalog.tsx` |
| ~4 | `routes/family.tsx`, `routes/data-tables.tsx`, `components/master-table/master-table.tsx`, `ops/glance/{model,drawing-set,topology}.tsx` |
| ~3 | `routes/schedule-grid.tsx`, `parameter-links/Evaluation.tsx`, `design-system/fixtures.ts`, `takeoff/model.ts` (`FLAG_MEANING`), `ops/views-detail.tsx` |
| ~1–2 | 12 further files |

**Epicenter, with a caveat.** `routes/design-system.tsx` holds ~30 % of all inline prose in the app
in one 1,408-line file: 16 `LAWS[].text` essays, 14 `<GapNote>` confessions, 7 multi-sentence
`spec={…}` blocks, 6 `Section note=` preambles, 5 `SATELLITES[].purpose`, 4 `CounterExample why=`.
Its two satellites replicate the same chrome for ~25 more. **This route is a documentation surface
whose prose arguably *is* the deliverable** — a ruling that abolishes inline copy should say
explicitly whether `/design-system` is exempt, because a blanket rule either guts the executable law
or grandfathers the single worst offender.

Net of `/design-system*` (~90 instances), the **product-surface** count is ~130 across 34 files,
and the epicenter shifts to `family/proto/variant-e.tsx`, `workbench/world.tsx`, `takeoff/atlas.tsx`,
and `routes/takeoffs.tsx`.

Noted for the record: `routes/design-system.tsx:383` renders — as an inline explanatory
paragraph — the law that inline explanatory prose dies.

**Worst 14** (paths relative to `source/pe-tools/apps/web/src/`):

| # | site | category | opening |
|---:|---|---|---|
| 1 | `routes/design-system.tsx:383` | config-prose | *"A title carries a CONTROL-level fact — what pressing does, why it refuses — terse and machine-adjacent, as everywhere today. A He…"* |
| 2 | `routes/design-system.tsx:353` | config-prose | *"List the option you cannot pick, greyed, with its own reason drawn from real validation — strictly more informative than hiding …"* |
| 3 | `routes/design-system.tsx:1250` | preamble | *"This table is also the exhibit for two of §01's laws, because neither can be shown on a static specimen…"* |
| 4 | `routes/design-system.tsx:1239` | preamble | *"The design-lang round hand-rolled its table, so the grammar was only ever proven against markup written to flatter it…"* |
| 5 | `routes/design-system.tsx:184` | preamble | *"Pea proposes; you decide; the model is allowed to disagree. Every surface in pe-tools has to say those three things at a glance…"* |
| 6 | `routes/design-system_.arming.tsx:206` | helper | *"the strip cannot say how old its own plan is — the one fact that decides whether to press it…"* |
| 7 | `routes/design-system_.proposal-flow.tsx:271` | helper | *"a denied proposal has no representation in the language or the model: no reason, no author, no denied member on the cell…"* |
| 8 | `family/proto/variant-e.tsx:2721` + twin `family/doc-pane.tsx:217` | config-prose | *"Superseded — you typed your own value into ${target}, so pea's ${proposal.proposed} has nothing left to argue for…"* (renders at `variant-e:2759` / `doc-pane:269`) |
| 9 | `routes/family.tsx:856` | empty-state | *"Pick one in the sentence above, or press \"+ new\" in the strip to create one from a minimal template. Pea shares whatever you bin…"* |
| 10 | `routes/takeoffs.tsx:776` | preamble | *"inserts reviewed rooms (with Manual J data) into the target file — always work on a COPY of the project template, never the orig…"* |
| 11 | `routes/takeoffs.tsx:433` | empty-state | *"this list is the live connected-host catalog. Start Revit with the Pe add-in loaded and a session appears here — or take the fix…"* |
| 12 | `takeoff/atlas.tsx:1133` | empty-state | *"all ${n} zones on this level are sub-${PLAN_MIN_SQFT} sf scribbles, drawn far from the cluster…"* / *"nothing has been adopted on this level yet…"* |
| 13 | `family/proto/variant-e.tsx:2823` | empty-state | *"The body's width or height is not a literal at this type, so there is no shape to draw. Nothing here guesses…"* |
| 14 | `workbench/world.tsx:33` (`PLAIN_CAP`) | config-prose | *"The actions the agent can take — reading and editing files, running commands, plus any connected outside tools…"* (renders at `world.tsx:318`) |

Runners-up: `routes/families.tsx:1065,1081` (`empty=` prose that explains the design rather than
the exit), `components/master-table/master-table.tsx:488,522` (*"nothing further — the marks on the
cell are the whole story"*), `components/lang/cell-key.tsx:40–89` (the five `asks:` questions —
the only true legend block in the app, and the most defensible instance in this census), and
`ops/glance/*.tsx` `contractNote:` fields, which render as banner blurbs under each op heading at
`routes/ops.tsx:330`.

**Category split of the ~220.** Roughly: preamble/section-intro ~70, config-prose (`note:`,
`spec=`, `purpose:`, `text:`) ~60, empty-state ~40, helper/gap-note ~35, legend ~10, banner ~5.
Empty states are the category the ruling can act on immediately and unambiguously — SURFACE-PHILOSOPHY
§4 already owes an `EmptyState` primitive, and ~40 instances plus the three empty-state *titles*
in `routes/families.tsx` are waiting for it.

---

## PROPOSED — not ruled

Everything below is a proposal for the ruling to accept, beat, or ignore.

### P1 · Type tiers

The proposal separates three axes that are currently tangled into one class soup:
**tier** (size + leading, a role), **face** (sans / mono / display), **case** (sentence / upper).
A call site picks a tier by role and a face by meaning; it never names a pixel.

| tier | role | proposed | face default | absorbs | spends | share |
|---|---|---|---|---|---:|---:|
| `t-caption` | subordinate fact riding a value — footlines, provenance, gutter counts, chip micro-text, timestamps | **10px / 1.4** | mono | 8, 9, 10, 10.5px | 186 | 27.9 % |
| `t-label` | names a value — column heads, field labels, chips, section heads (with `case=upper`) | **11px / 1.3** | **sans** | 11, 11.5px | 157 | 23.6 % |
| `t-value` | the datum, and every control that acts on it — table cells, stats, verbs, inputs | **12px / 1.4** | mono for data, sans for controls | 12, 12.5px | 258 | 38.7 % |
| `t-prose` | human sentences — help-tip bodies, chat turns, refusal explanations, doc text; also the page base | **13px / 1.55** | sans | 13, 13.5px | 17 | 2.6 % |
| `t-title` | route, pane and dialog titles | **16px / 1.25** | display | 14, 15, 16, 18, 20px | 45 | 6.8 % |
| `t-display` | the front-door hero, once | **40px / 1.1** | display | 30, 48px | 3 | 0.5 % |

**Coverage.** `t-caption` + `t-label` + `t-value` alone = **90.1 %** of all spends. Adding
`t-title` = **96.9 %**. All six = **99.8 %**. The ~95 % ask is met by **four** tiers; `t-prose`
and `t-display` are cheap and each names a role that genuinely exists (13px page base; one hero).

**What this deletes.** 17 rendered sizes → 6. The five half-pixel values (9.5, 10.5, 11.5, 12.5,
13.5 — 24 spends) go entirely. The 9px band (48 spends) rounds up into `t-caption`; nothing in the
app needs to be smaller than 10px, and at 9px the mono tracking is already illegible on a laptop.

**Section head is not a tier.** It is `t-label` + `case=upper` + `tracking` — a *case* axis, not a
size. That single decision retires `section-label`, `tele-label`-as-header, `.dl-verb-group-title`,
and four hand-rolled variants (§1.3b) into one thing.

**`tele` is retired as a size, kept as a face.** Since 49 % of its call sites already override its
size, the honest shape is `face=mono` (mono family + `0.05em` + tabular-nums, no size) composed with
whichever tier the call site is in. That alone removes 118 of the 303 arbitrary-px spends.

**Face law, restated so it can be enforced.** Mono is the *marked* face, sans the default —
currently inverted in `lang.css` (10 mono : 2 sans). Mono is permitted only on: identifiers, paths,
keys, counts, measured numbers, timestamps, durations, states, and outcome receipts. It is
forbidden on: verbs and buttons, labels, section heads, empty states, help prose, and refusal
explanations.

**Reserved axes, restated.** Bold (700) stays unspent and means unsaved. Italic means
locked/uneditable/dropped and nothing else — which requires ruling on `families.tsx`'s deliberate
italic-for-empty and `variant-e`'s italic-for-warning (§1.6). Weight 600 is section-head duty and
should be folded into `t-label case=upper` rather than spent freely.

### P2 · The `title` / help-tip boundary

The primitive already exists (`components/lang/help.tsx`, `HelpTip`) and its header already states
this boundary; the census only supplies the counts. Restated as a rule with the evidence attached:

| | native `title=` | `HelpTip` (`?`) | neither — becomes visible chrome |
|---|---|---|---|
| **scope** | one control | one region (pane / section / table / column set) | the surface |
| **answers** | what does pressing this do · why is it refused · what is this clipped value | what am I looking at · how should I think about it | what state is this lane in |
| **length** | ≤ 60 chars, one clause, no second sentence | a few sentences, ≤ ~400 chars | a chip |
| **face/tier** | n/a (native) | sans, `t-prose` | `t-label` chip |
| **count** | 1 per control, unlimited | **exactly one per region**, beside the region's title | one per lane |
| **census buckets** | 1, 2, 4, 6 — 108 static + ~184 dynamic | 3 — ~48 static titles, ~9,000 chars | 5 — ~15 fixture/mock titles |
| **today** | correct, keep | does not exist on any shipping route | ruled by SURFACE-PHILOSOPHY §3, unadopted |

**The mechanical test**, so the boundary survives a code review: *does the sentence still make
sense if you delete the thing it is attached to?* If yes, it is orientation → `HelpTip` on the
region. If no, it is a control fact → `title`.

**Where the ~220 inline-prose instances go.** The same three-way test applies, and it disposes of
them without a new bucket: region orientation → `HelpTip` (~105: the preambles, helper/gap notes,
banners, and the legend blocks); control facts → `title` (a small remainder); route-state stories →
`EmptyState` (~40); honesty lanes → chip. Everything left was decoration and dies. The one open
question is whether `/design-system*` (~90 of the 220) is exempt as a documentation surface — see §2.4.

**Two corollaries the counts force:**

- **A title never gets a second sentence.** 63 of 176 have one today. Where the second sentence is
  the real content, the whole title moves to the region's `HelpTip`; where it is decoration, it dies.
- **An empty state is never a title.** `routes/families.tsx:1051,1257,1384` write the empty state's
  own explanation into a tooltip on chrome the user in that state may not even hover. Those are
  `EmptyState` copy — a component SURFACE-PHILOSOPHY §1 already says is owed.

### P3 · Suggested order of work (if the ruling lands)

1. Ship the tier utilities and the `face`/`case` axes; keep `tele` as `face=mono` only.
2. Sweep `routes/design-system.tsx` first — it is both the executable law and the worst
   size-vocabulary offender (9 distinct sizes). It cannot be the ratchet while it is the outlier.
3. `HelpTip` onto `master-table` region heads — one primitive fix retires 7 titles across every
   consumer at once.
4. Ship `EmptyState` — it is the one copy category with an unambiguous disposition (~40 inline
   instances + 3 empty-state titles), and SURFACE-PHILOSOPHY §1 already owes it.
5. Then the three files carrying 58 % of all title prose: `variant-e.tsx`, `routes/families.tsx`,
   `routes/family.tsx`.

---

## RULED (2026-08-16, joint review — kaitpw + main session)

- **Tier model adopted as proposed** (Q21), with a standing minimize-options bias.
- **Weight law amended** (Q22): bold = unsaved on data surfaces OR emphasis inside real
  t-prose text; NEVER chrome emphasis. Semibold = t-title / t-upper heads only — and the
  utilities carry the 600 themselves, so call sites never write a weight.
- **Copy boundary test + corollaries adopted** (Q23): delete-the-target test routes prose to
  HelpTip vs title; a title never gets a second sentence; an empty state is never a title.
  /design-system holds an EXPLICIT documentation-surface exemption for inline prose — the
  exemption is this line, and it does not travel to product routes.
- **Pilot amendments** (from the /design-system conversion): t-title/t-display carry
  weight 600 + tracking; t-upper declared after face-mono so head tracking wins; heads are
  SANS (2026-07-13 law reaffirmed — face-mono never composes with t-upper); paragraph prose
  belongs to t-prose even on dense pages (t-value is for data + controls, not sentences).
- **Deferred**: "delete all copy and re-evaluate from scratch" — noted as tempting, ruled too
  broad for now; the per-route purge with typed destinations is the adopted path.
