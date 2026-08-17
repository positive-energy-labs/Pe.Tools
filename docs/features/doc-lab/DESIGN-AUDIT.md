# /doc-lab — design-language audit

Recorded during the per-route design-system pass of 2026-08-16. Covers the route harness
(`routes/doc-lab.tsx`) and the view it exists to exercise (`grounded-doc/GroundedDocView.tsx` —
UI imported only by this route; `engine.ts`/`types.ts`/`parse-cache.ts` are shared with the
`api/pdf-audit` server routes and carry no styling). Governance: nothing under `components/`,
`styles.css`, or `design-lang.css` changed; gaps are numbered findings. Canon:
[`../../design/SURFACE-PHILOSOPHY.md`](../../design/SURFACE-PHILOSOPHY.md),
[`../design-lang/CLEANROOM.md`](../design-lang/CLEANROOM.md), `apps/web/src/design-lang.css`.
Format follows [`../takeoffs/DESIGN-AUDIT.md`](../takeoffs/DESIGN-AUDIT.md).

---

## A · State census

| # | state | means | axis | outcome | rendered as, after the sweep |
|---|---|---|---|---|---|
| 1 | no document loaded | route's own empty | — | — | `EmptyState` scope inside the drop target (hairline, not dashed) |
| 2 | parsing | LlamaCloud reading the PDF | — | `busy` ✅ | `OutcomeLine busy` |
| 3 | parse failed | bridge/service error | — | `error` ✅ | `OutcomeLine error` (was `--cat-clay` prose) |
| 4 | sample document loaded | FIXTURE lane, declared | seam ✅ | — | dashed `FactChip` "fixture · sample" in the head (new — the lane previously did not announce itself) |
| 5 | block/image/region **focused** | where the cursor is | selection | — | markdown lane: `--r-select` fill; over page imagery: `--r-ink` mark (R13a) — was `--cat-blue`/`--cat-lichen` rings |
| 6 | block/image **pinned** | sticky selection | selection | — | pin glyph in `--r-ink` (was `--cat-blue`/`--cat-lichen`) |
| 7 | block **approximate** (shared bbox) | the grounding cannot be trusted precisely | `agree`-ish, unmapped | — | `--r-caution` tag "≈ approx" + solid caution region border (was kiln + **dashed**) (#1) |
| 8 | block ungroundable (no bbox) | cannot be located at all | **none** | — | muted italic "no bbox" tag + 60% block opacity (#2) |
| 9 | extracted-image region | a KIND of overlay, not a state | taxonomy | — | `--viz-4` border, solid (was lichen + **dashed**) |
| 10 | nothing focused | focus-lane empty | — | — | `EmptyState` scope with the hover/pin exit |
| 11 | block kind (`heading`, `table`, …) | machine classification | taxonomy | — | mono caption tag, neutral (was 9px badge) |

Outcome lane complete (2–3). The census's real content is the mark taxonomy on the page pane:
selection (ink mark) · distrust (caution) · kind (viz) now occupy three separate slots where
they previously shared two hues and the dashed style.

## B · Findings

### 1 · "Estimated" spatial regions have no legal mark — dashed was carrying it, illegally

§4: *"a mark derived from real coordinates and a mark derived from a guess must not look the
same"*. The old view said "guess" with `border-dashed` — but R13b reserves every dashed
mechanism for SEAM, and an approximate bbox is not a seam: the block exists, its *address* is
doubted. That is squiggle-family semantics (`agree: drift` distrusts an existing value), but
the squiggle rides text decoration and cannot ride an SVG/absolute region border. This pass
used solid `--r-caution` + the "≈ approx" caution tag, which separates from trusted marks by
hue only — weaker than the measured/estimated law wants. The language needs a blessed
"distrusted region" treatment for spatial views (takeoffs' residue ruling covers held/absent
area, not doubted addresses). Until then: caution border + tag, recorded here.

### 2 · "Ungroundable" is a capability fact with no capability grammar off the cell

A block with no bbox can never be located — `cap: "readonly"`-shaped, but there is no cell,
so the treatment is a muted italic tag plus whole-block 60% opacity (the takeoffs off-plan
precedent). Italic = locked/disabled is the settled type law and fits; the opacity is a
route invention the language neither blesses nor forbids. Worth one ruling: is opacity a
legal de-emphasis mechanism, or does it shadow the ink ladder?

### 3 · The white page ground is outside the ground ladder

The rendered PDF page (and image thumbnails) sit on literal white — a scanned page *is* white,
and tinting it would misrepresent the document. But `--r-select` cannot separate on it and
every mark had to fall back to R13a ink. This is the same "fill cannot separate" territory the
takeoffs plan hit; the page image is a stronger case since its pixels are not ours. Proposed
blessing: "document imagery is an exempt ground; all marks over it follow R13a."

### 4 · Hover-driven focus makes hover and selection one state — the laws assume two

The engine treats hover as focus (hover a block ⇒ its twin lights across lanes), so the veil
(hover law) and the select fill (selection law) collapse into one state per lane. This pass
rendered the *twin-lighting* as selection (fill/ink mark) and kept the veil for the lane under
the pointer, which reads correctly but means a block shows the select fill without being
"selected" in the click sense. Pinning is the true selection and currently differs only by the
pin glyph. If review wants the distinction sharper, pinned needs its own weight — but no law
today distinguishes "transient twin highlight" from "selection".

## C · What migrated

| | count | notes |
|---|---|---|
| `Verb` | 4 | remove document, unpin, parse URL, load-sample (all act; sample verb declares the fixture in its reason) |
| `FactChip` | 3 | file name, page/block/image counts, dashed fixture chip (seam — new honesty) |
| `OutcomeLine` | 2 | parsing (busy), parse failed (error) |
| `EmptyState` | 2 | no document loaded (upload), nothing focused (focus lane) |
| `HelpTip` | 1 | route orientation ("hover either side to link them" prose moved off the chrome) |
| illegal `dashed` re-expressed | 3 | upload drop zone (empty ≠ seam → hairline), approx regions (→ solid caution), image regions (→ solid viz-4) |
| selection law applied | 5 sites | markdown focus fill → `--r-select`; page/image focus marks → `--r-ink` (R13a); pins → ink; drag-over → select fill (was `--primary`) |
| type tiers | all | `text-[8px]/[9px]/[10px]/[12px]`, ad-hoc uppercase heads → `t-caption/t-label/t-value` × `face-mono` × `t-upper` |

**Raw-palette spends removed:** `--cat-blue` (focus ring, pin, hover — selection wearing viz),
`--cat-kiln` (approx — state wearing viz), `--cat-lichen` (image focus — kind and state
conflated), `--cat-clay` (error prose), `--primary` (drag-over), `bg-muted/*` washes →
`--r-recess`. `--viz-4` is now spent **as taxonomy** (image-kind), which is what the ladder
is for and survives grayscale (image regions are the only always-visible overlay).

**Shim lines deleted from `styles.css`: none** (all removed tokens keep consumers elsewhere).
`ui/button` imports in these files: 0 (was 2); `ui/input` remains (not a verb).

**Files touched:** `routes/doc-lab.tsx`, `grounded-doc/GroundedDocView.tsx`.
