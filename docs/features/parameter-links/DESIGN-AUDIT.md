# /parameter-links — design-language audit

Recorded during the per-route design-system pass of 2026-08-16. Governance: `components/lang/*`,
`components/master-table/*`, `design-lang.css` and `styles.css` were **not** changed; where the
language could not express something, the code was left honest and the gap is numbered below.
Findings are input for joint review, not decisions.

Language canon: [`../../design/SURFACE-PHILOSOPHY.md`](../../design/SURFACE-PHILOSOPHY.md),
[`../design-lang/CLEANROOM.md`](../design-lang/CLEANROOM.md), `apps/web/src/design-lang.css`
(the header is the law). Audit format follows [`../takeoffs/DESIGN-AUDIT.md`](../takeoffs/DESIGN-AUDIT.md).

---

## A · State census

Axes: **freshness** `fresh` · **agreement** `agree` · **staging** `stage` (+ `stagedBy`) ·
**capability** `cap`, plus the **outcome lane** (`OutcomeKind`). "—" = the axis says nothing;
**bold** = no axis at all.

| # | state | means | fresh | agree | stage | cap | outcome | rendered as, after the sweep |
|---|---|---|---|---|---|---|---|---|
| 1 | local edits ≠ remote draft | your edits exist only in this tab | — | — | `staged`+`you` *in principle* | — | — | `FactChip` caution "unsaved edits" (#1) |
| 2 | shared draft ≠ stored profile | the co-edited draft diverges from Revit | — | `drift`-ish | `staged` | — | — | `FactChip` caution "draft ≠ stored" |
| 3 | preview fresh (profile = previewed) | the projection is trustworthy | `fresh` ✅ | — | — | — | — | Apply enabled; its `reason` says why |
| 4 | preview stale (edited after preview) | projection no longer matches the draft | `stale` ✅ *in principle* | — | — | — | — | Apply disabled, reason in title (#2) |
| 5 | pea's evaluation shown, not yours | agent preview must not arm the human verb | — | — | — | `cap`-ish | — | Apply disabled, reason in title (#2) |
| 6 | projected write, changed | a PENDING (unsaved) target write | — | — | `staged` ✅ | — | — | **bold** mono result cell — the reserved weight |
| 7 | projected write, unchanged | a no-op | — | — | — | — | — | muted ink row |
| 8 | evaluation issue, error severity | the host refuses the plan | — | — | — | — | `refused` ✅ | `OutcomeLine refused` per issue |
| 9 | evaluation issue, warning | advisory, apply not blocked | — | — | — | — | `advisory` ✅ | `OutcomeLine advisory` per issue |
| 10 | command failed / bridge error | busy bridge, not disagreement | — | — | — | — | `error` ✅ | `OutcomeLine error` |
| 11 | command refused by op guard | host rejected the plan | — | — | — | — | `refused` ✅ | `OutcomeLine refused` |
| 12 | command in flight | serialized busy | — | — | — | — | `busy` ✅ | `OutcomeLine busy` |
| 13 | preview/apply landed | receipt | — | — | — | — | `receipt` ✅ | `OutcomeLine receipt` |
| 14 | updater registered / idle | host runtime fact | — | — | — | — | — | `FactChip` done / meta |
| 15 | pea working on the document | agent presence | — | — | — | — | — | `FactChip` pea |
| 16 | host disconnected | commands will fail | **none** | — | — | — | — | `FactChip` caution (#3) |
| 17 | no profile yet | not started — a state, not a zero | `never`-ish | — | — | — | — | `EmptyState` scope + add-definition verb |
| 18 | route state hydrating | first read in flight | — | — | — | — | `busy` ✅ | `OutcomeLine busy` |

Expressible: 12 of 18 land on an axis or the outcome lane. The rest (#1, #3) are page-level facts
the grammar only speaks about cells; they ride `FactChip` tones, which is legal but weaker.

---

## B · Findings

### 1 · Page-level "unsaved" has no home but a chip — bold is unenforceable off the cell grammar

"Bold is reserved for unsaved, everywhere, always" — but the unsaved thing here is a *nested
document* (the whole draft profile), not a cell. There is no cell to bolden: the draft is edited
through selects and option pickers (`FieldOptionSelect`), none of which the editable `StateCell`
(R8) covers. The state renders as a caution `FactChip` "unsaved edits" plus the save verb's
enabled state. The takeoffs pass hit the same wall from the other side (#7 there); R8 solved it
for *text* cells only. Proposed: none yet — a select-shaped editable cell is a component-repair
question, and this route is its second consumer of evidence.

### 2 · The freshness gate on Apply is real state with no visible mark

`previewed`/`reviewed`/`applyReady` is a genuine freshness axis — the projection is `fresh`
(trustworthy), `stale` (edited since), or agent-authored (pea previewed; the human must re-run).
It renders **only** as Apply's disabled state + title reason. A newcomer sees a greyed verb and
must hover to learn the surface's central safety rule. The old subline narrated it visibly, but
that prose failed the boundary test both ways (it repeated the verb's reason on the surface).
What the language lacks: a *verb-adjacent* freshness mark — the squiggle family speaks only over
values. Candidate: the arming strip (`ceremony scales with blast radius`) is the real home for
this gate; `ArmingStrip` still has no shipping consumer (SHIMS design-lang entry 3) and this
route is a candidate first consumer.

### 3 · "Disconnected" has no axis and no kind

`route.connected ∧ bridgeIsConnected` is a page-level capability fact. Not an outcome (nothing
was attempted), not a cell state. Rendered as a caution `FactChip` — the same treatment the
takeoffs fixture chip got, minus the dashed edge (a dead bridge is not a seam; the surface is
real, the pipe is down). Fine in practice; recorded because three routes now hand-pick a chip
tone for it and a standing rule ("connection state is a caution fact chip named `host ·`")
would stop the drift.

### 4 · `RouteWorkspaceShell` was abandoned, not migrated — /settings still holds it

This route left `workbench/route-workspace-shell.tsx` (and `HostConnectionPill`) for the lang
`AddressingBar`. The shell itself — which spends `--paper`, `--clay-ink`, `--line-2`, `--cat-clay`
internally — was **not** edited (outside this pass's boundary) and still serves `/settings`. Its
shim consumers therefore survive this pass. When the settings pass lands on `AddressingBar`, the
shell is at zero importers and should die with its token spends.

### 5 · Save-draft wears commit blue — a boundary call worth blessing or reversing

"The only filled blue is the verb that writes beyond the page." Saving the draft writes the
*shared document* (pea and other tabs see it) — beyond the page, so it took `commit`. But it
does not touch Revit, and it now sits one lane away from Apply, also blue. If review finds two
blues in one viewport dilutes the scarcity signal, the alternative reading is "the page includes
its own shared document; only Revit is beyond" → save becomes `act`. Either is defensible; one
should be written down.

### 6 · The co-edit reconcile seam is still route-local

The local-draft/remote-draft/`syncedRef` reconcile (stable cursor vs live co-editor) predates
this pass and remains hand-rolled; no primitive owns "co-edited nested document". Recorded here
because it is the reason #1 exists: without a cell-shaped editing surface, none of the staging
grammar can reach the values being staged.

---

## C · What migrated

| | count | notes |
|---|---|---|
| `AddressingBar` | 1 | replaces `RouteWorkspaceShell` — name · binding-target sentence + `HelpTip` · fact lane · the one Apply (commit) |
| `Verb` | 8 | apply (commit, head rail) · refresh, preview (act) + save draft (commit) in a `VerbGroup "draft"` · add definition ×2, remove definition, add/remove assignment (act) |
| `FactChip` | 9 | host connection, defs·asns, unsaved edits, draft ≠ stored, pea working; runtime: updater, active defs, active asns, applied writes; evaluation: sources, targets, projected writes, issues |
| `OutcomeLine` | 6 lanes | busy, error, refused, receipt in the head lane; per-issue refused/advisory in the evaluation pane |
| `ArtifactFrame` | 2 | each definition card (the co-edited object); the projected-writes table |
| `EmptyState` | 4 | no evaluation yet, no target writes, no draft profile, no assignments |
| bold = unsaved | 1 | changed projected-write result cells (was a `--pe-blue` dot in a Δ column — column deleted) |
| type tiers | all | `tele-label` ×3, `text-xs/sm`, `text-[10px]/[11px]` → `t-caption/t-label/t-value` × `face-mono` × `t-upper`; heads sans |
| dashed spends removed | 1 | empty-profile box (dashed border meaning "not started" — not a seam) → `EmptyState` |

**Raw-palette spends removed:** `--fail`, `--lichen` (×9), `--slate`, `--clay-ink`, `--paper`,
`--pe-blue`, `--cat-green` (as apply-button fill *and* success text — state spends of a viz
colour), `--cat-clay`, `--pea-tint`, `--line`, `--line-2`.

**Shim lines deleted from `styles.css`: none** — every token given up still has consumers in
`ops/`, `workbench/`, `schedule-grid`, `chat` (counts 2–28 at audit time). See takeoffs' audit:
the meter moves when the sibling passes land.

**Files touched:** `routes/parameter-links.tsx`, `parameter-links/Evaluation.tsx`,
`parameter-links/ProfileEditor.tsx`. Nothing under `components/`; `parameter-links/model.ts`
unchanged (pure model).
