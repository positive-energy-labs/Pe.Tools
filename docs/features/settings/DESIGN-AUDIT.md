# /settings — design-language audit

What the settings surface needed that `components/lang` + the `--r-*` canon could not say, recorded
during the per-route design-system pass of 2026-08-16. Settings is a small trichotomy reviewer over
a JSON file — a list of fields, not a cross-cutting table — so it exercises `StateCell` at **card
scale outside `MasterTable`** for the first time, plus `AddressingBar` as a second real consumer.

Governance: `components/lang/*`, `components/master-table/*`, `styles.css`, `design-lang.css` and
the state model were **not** changed. Where the language could not express something, the code was
left honest and the gap written down. Language canon:
[`../../design/SURFACE-PHILOSOPHY.md`](../../design/SURFACE-PHILOSOPHY.md),
[`../design-lang/CLEANROOM.md`](../design-lang/CLEANROOM.md), `apps/web/src/design-lang.css`.

---

## A · State census

Against the four axes (**freshness** `fresh` · **agreement** `agree` · **staging** `stage` +
authorship qualifier `stagedBy` · **capability** `cap`) and the **outcome lane** (`OutcomeKind`).
"—" = the axis says nothing; **bold** = no axis at all.

| # | state | means | fresh | agree | stage (+by) | cap | outcome | rendered as |
|---|---|---|---|---|---|---|---|---|
| 1 | clean field | saved value, nothing pending | — | — | `clean` | — | — | `StateCell`, plain |
| 2 | pea proposal open | pea proposed a value via SSE | — | — | `proposed` | — | — | `StateCell` proposed body (wash + fold + pea square) |
| 3 | staged | you approved; unsaved until save | — | — | `staged` + `you` | — | — | `StateCell` bold + caution square |
| 4 | review `"attention"` | a staged value is flagged; save refuses | — | — | — | — | — | **no axis** — rides the footline note + a caution `FactChip` (#1) |
| 5 | prior value under a proposal/stage | what the file holds now | — | — | — | — | — | **no home** — "was X" on the note (#2) |
| 6 | document validation valid / N issues | schema dry-run over the saved file | — | — | — | — | — | document-level fact → `FactChip` done/caution (#5) |
| 7 | command in flight | open/re-read/validate/save running | — | — | — | — | `busy` ✅ | `OutcomeLine` + `Verb busy` |
| 8 | command failed | op-level or thrown failure | — | — | — | — | `error` ✅ | `OutcomeLine` (refusals indistinguishable — #3) |
| 9 | save landed | receipt | — | — | — | — | `receipt` ✅ | `OutcomeLine` |
| 10 | bridge disconnected | SSE lane down | — | — | — | — | — | caution `FactChip` (a busy bridge is not the model disagreeing) |
| 11 | pea working | agent active on this document | — | — | — | — | `busy` ✅ | `OutcomeLine` on the head rail's advisory slot |
| 12 | no document open | route not pointed yet | — | — | — | — | — | `EmptyState story="scope"` ✅ |
| 13 | document has no fields | opened, genuinely empty | — | — | — | — | — | `EmptyState story="scope"` ✅ |

Unmappable: #4, #5 (and #6 as a document-scoped fact with no per-field join). 3 of 13.

---

## B · Findings

### 1 · `review: "attention"` has no axis

**Surface fact.** A staged field can carry `review: "attention"` — flagged, and save refuses while
any remain. It is the route's one hard gate.

**What the language lacks.** It is not `agree: "drift"` (the model does not hold a different value —
the schema objects to this one), not freshness, not capability. It is "this staged value is
invalid/contested", which no axis says.

**Left honest.** The flag rides the cell's note ("needs attention — … save refuses while it
stands"), a caution `FactChip` counts them on the head rail, and the save verb's `reason` names the
count. No mark on the cell body.

**Proposed resolution.** Same family as takeoffs #2 / R3: queued human work is a **row fact** —
the gutter marker — not a sixth axis. Alternatively an `invalid` qualifier on `stage: "staged"`
(it can only exist on a staged value). Either wants a second consumer first; /schedule-grid's
identical `review` flag (its audit #1) is that consumer.

### 2 · A proposed/staged cell has no prior-value slot

**Surface fact.** Reviewing pea's proposal means comparing it to what the file holds now.

**What the language lacks.** The known model gap ("a proposed table cell has no prior value" —
CLEANROOM builder convergence). Card scale has an inline ghost only for `drift`, and this is not
drift.

**Left honest.** "was X" leads the note/footline. Readable, but it is prose where the chat card
renders a real current → proposed diff.

**Proposed resolution.** When the model grows the proposal's prior value, card-scale `StateCell`
can render the same struck-current treatment the chat card owns. Until then the note stands.

### 3 · An op-level refusal is indistinguishable from a bridge error

**Surface fact.** `route.command` failures return `{ok:false, error?, hint?}` with no refusal
discriminator, so every failure lands as `OutcomeKind: "error"` (caution) — including any future
op that *refuses* (the one alarm's territory).

**Left honest.** `useVerb`'s catch-default `error` is used throughout; no failure is dressed as a
refusal on a guess.

**Proposed resolution.** The R12 machinery (`fail(kind, …)`) exists; the *payload* doesn't carry
the kind. Same as families #4 — the route-state command result needs a `refused` marker before any
route can spend the alarm honestly.

### 4 · Per-cell review verbs have no lang idiom

**Surface fact.** Each proposal row carries approve/deny; each staged row carries unstage.

**What the language lacks.** The chat card owns accept/deny in the grammar's story; a *list* of
`StateCell`s with adjacent verbs is a shape nothing rules on. Plain `Verb`s (act tone, reasons in
titles) sit beside each cell — legible, but every row pays ~3 verb widths.

**Proposed resolution.** None urged. If settings ever grows past a few dozen fields it should
become a `MasterTable` with `state:` columns and the pending-strip reviewer pattern (see
/schedule-grid); at list scale the per-row verbs are the honest form.

### 5 · Validation issues are document-scoped chips, not per-field facts

**Surface fact.** `validation.issues` carry field paths, but the route renders them only as one
head-rail chip ("N validation issues"), never joined onto the rows they name.

**Left honest.** Pre-existing behaviour, unchanged — the chip's title lists the first three issue
messages. Joining issues to rows is state-model work entangled with #1 (an issue on a staged field
is exactly the `attention` fact).

**Proposed resolution.** Join issues to rows as the note (or the #1 marker) when #1 is ruled.

### 6 · `RouteWorkspaceShell` is now half-abandoned

**Surface fact.** This pass moved /settings off `RouteWorkspaceShell` onto `AddressingBar`. The
shell still exists (`src/workbench/route-workspace-shell.tsx`), spends legacy tokens
(`--paper`, `--clay-ink`, `--lichen`, `--cat-clay`, `--line-2`), and has one consumer left:
/parameter-links.

**Proposed resolution.** When the parameter-links pass migrates, delete the shell (and
`HostConnectionPill` in `host/issues.tsx` loses another consumer — this route replaced it with a
connection `FactChip`). Outside this pass's boundary.

---

## C · What migrated

| | count | notes |
|---|---|---|
| `AddressingBar` | 1 | name · document identity sentence · 7-chip fact lane · save (the one commit) · pea-busy advisory |
| `Verb` | 3 + 3/row | save (`commit`), re-read, validate; approve / deny / unstage per field row. All reasons in titles |
| `StateCell` | 1/field row | card scale, first consumer outside MasterTable/chat: proposed body, staged bold + square, note footline |
| `FactChip` | 7 | bridge, binding, proposed (pea tone), staged (caution), attention, validation, saved-ago |
| `OutcomeLine` | 5 kinds | busy (+seconds), error, receipt, route-stream error, pea-busy |
| `ArtifactFrame` | 1 | the field grid — the machine-operated object; verb lane + outcomes stay unframed on the page ground |
| `EmptyState` | 2 | no document open · document has no fields — both `story="scope"` with exits |
| `useVerb` | 1 | replaces hand-rolled busy/error; serializes open/re-read/validate/save |
| deleted | `RouteWorkspaceShell` usage, `Metric`, `EmptyNote`, all lucide icon-buttons, `ui/button` import |

**Old vocabulary shed by this route:** `--lichen`, `--slate`, `--clay-ink`, `--pe-blue`, `--fail`,
`--cat-green`, `--cat-clay`, `--pea-tint`, `--paper` (via the shell), `--line`/`--line-2`,
`tele`/`tele-label`, `text-[10px]`. `ui/button` imports remaining in this route: **0**.
