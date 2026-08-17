# /data-tables — design-language audit

Recorded during the per-route design-system pass of 2026-08-16 (compressed — small route).
Governance: nothing under `components/`, `styles.css`, or `design-lang.css` was changed; gaps
are numbered findings for joint review. Canon:
[`../../design/SURFACE-PHILOSOPHY.md`](../../design/SURFACE-PHILOSOPHY.md),
[`../design-lang/CLEANROOM.md`](../design-lang/CLEANROOM.md), `apps/web/src/design-lang.css`.
Format follows [`../takeoffs/DESIGN-AUDIT.md`](../takeoffs/DESIGN-AUDIT.md).

---

## A · State census

| # | state | means | axis | outcome | rendered as, after the sweep |
|---|---|---|---|---|---|
| 1 | draft open, never applied (`isNew`) | exists on this page only | `stage: "staged"` *in principle* | — | **nothing marks it** — only the apply verb's reason (#1) |
| 2 | draft edited since open | unsaved vs the Revit table | `stage`+`you` *in principle* | — | **not rendered** — no baseline kept (#1) |
| 3 | apply in flight | one serialized host op | — | `busy` ✅ | `OutcomeLine busy` + seconds (via `useVerb`) |
| 4 | apply landed | upserted by name + row key | — | `receipt` ✅ | `OutcomeLine receipt` |
| 5 | apply landed with warnings | partial trust in the write | — | `advisory` ✅ | `OutcomeLine advisory` (host warnings joined) |
| 6 | apply threw | busy bridge, not disagreement | — | `error` ✅ | `OutcomeLine error` (`useVerb` default) |
| 7 | rail reading tables | detail op in flight | — | `busy` ✅ | `OutcomeLine busy` in the rail's empty slot |
| 8 | no tables in document | not started, not zero | `fresh: "never"`-ish | — | `EmptyState` scope + exit |
| 9 | no table open | route's own empty | — | — | `EmptyState` scope + exit |
| 10 | row will be deleted in Revit on apply | pending destructive prune | **none** | — | title on the row's remove control only (#2) |
| 11 | table placed on sheets | placement fact | — | — | `PickList` hint line (unchanged) |

## B · Findings

### 1 · A whole-object draft has no unsaved grammar — same wall as parameter-links #1

The entire draft (name, columns, rows) is unsaved until apply, and edits against the opened
Revit table are undiffed — the route keeps no baseline, so `bold = unsaved` cannot be computed
per cell, and "this draft has never been applied" (`isNew`) renders nowhere except the apply
verb's reason. The grammar's staging axis wants a *cell* and a *baseline*; this route has a
document and none. Honest today: the commit verb is always the loudest thing on the page.
Discharge path: keep the opened `TableHandle` as baseline and mark diverging cells
`data-unsaved` — cheap, but only worth it if review wants per-cell honesty on a synthetic
table nobody else edits.

### 2 · A pending destructive prune is invisible until it happens

Deleting a row here deletes it in Revit on apply — the route's sharpest edge. The fact lives
in two titles (the remove control, the apply verb's reason). No axis says "this apply will
*remove* N rows": the language has receipts for what landed but nothing for a queued deletion.
(The takeoffs "verdict owed" ruling R3 made queued *human* work a row fact; a queued
*destructive write* has no equivalent.) Cheap local fix if wanted: derive `pruned = opened
rows − draft rows` and say "apply to revit · prunes N" on the verb label.

### 3 · Icon-only verbs cannot be `Verb`s — per-row/column removers stay raw buttons

`Verb.label` is required (rightly). A per-row trash control in a dense grid cannot pay a
24px labelled verb per row, so the removers remain raw `<button title=…>` with neutral
hover. They previously hovered `--destructive` (alarm spent on affordance) — now the veil-law
would want them, but a raw button cannot buy `.dl-verb`'s veil without the class. Either an
icon-verb variant (with required `reason` riding the title) or a blessing that gutter-scale
destructive affordances stay route-rolled.

### 4 · The column-kind select is a mode switch the `Switcher` cannot serve

txt/num per column is exactly `Switcher` semantics (exclusive mode, fill = selected), but at
table-header scale a native `<select>` costs 24px where the switcher costs ~70px × N columns.
Kept native, tiered mono. Evidence for a compact/select-rendered switcher variant, not a
request for one.

## C · What migrated

| | count | notes |
|---|---|---|
| `AddressingBar` | 1 | name · table-name sentence + `HelpTip` (orientation prose moved out of the empty state) · dims `FactChip` · apply (commit) |
| `Verb` | 5 | apply to revit (commit) · re-read, new (rail) · add col, add row (grid, act) |
| `OutcomeLine` | 4 | busy+seconds, advisory (warnings), error, receipt — all via `useVerb` (replacing the untyped `note` string) |
| `EmptyState` | 3 | rail empty, rail busy slot's sibling, no-table-open center |
| `ArtifactFrame` | 1 | the draft grid — the machine-operated object apply writes |
| `useVerb` | 1 | replaces hand-rolled `busy`/`note` (the pattern the hook exists to kill) |
| copy purge | 2 | "renaming creates a new table…" → name input title; "data tables are freely editable key schedules…" → `HelpTip` |
| type tiers | all | `tele` ×4, `tele-label`, `section-label`, `text-[11px]` → `t-caption/t-label/t-value` × `face-mono`; heads sans `t-upper` |

**Raw-palette spends removed:** `--line-soft` (×4 → `--r-line` via `border-border`),
`focus:bg-primary/5` (focus buying commit hue → `--r-select` fill),
`hover:text-destructive` ×2 (alarm as delete affordance → neutral ink + title reason),
`bg-muted` heads → `--r-recess` inside the frame.

**Shim lines deleted from `styles.css`: none** — `--line-soft` keeps ~18 consumers
(`ops/`, `chat`, `family`), the rest likewise. Remaining `ui/*` imports here: `Input`,
`PickList`, `SidePane` (none are verbs); `ui/button` import count in this route: 0 (was 6).

**Files touched:** `routes/data-tables.tsx` only.
