# /schedule-grid — design-language audit

What the schedule editor needed that `components/lang` + the `--r-*` canon could not say, recorded
during the per-route design-system pass of 2026-08-16. Schedule-grid matters to the language: it is
the first **dynamic** consumer of the cell-state clause (one `state:` column per Revit schedule
column, column set unknown until a snapshot lands), the first shipping consumer of the **editable
`StateCell`** (R8) outside the design-system exhibit, and the first surface to implement §3's
"typing beats proposing" as an actual sever.

Governance: `components/lang/*`, `components/master-table/*`, `ui/pick-list`, `ui/side-pane`,
`ui/value-diff`, `styles.css`, `design-lang.css` and the state model were **not** changed. Canon:
[`../../design/SURFACE-PHILOSOPHY.md`](../../design/SURFACE-PHILOSOPHY.md),
[`../design-lang/CLEANROOM.md`](../design-lang/CLEANROOM.md), `apps/web/src/design-lang.css`.

---

## A · State census

Against the four axes (**freshness** `fresh` · **agreement** `agree` · **staging** `stage` +
authorship qualifier `stagedBy` · **capability** `cap`) and the **outcome lane**. "—" = the axis
says nothing; **bold** = no axis at all.

| # | state | means | fresh | agree | stage (+by) | cap | outcome | rendered as |
|---|---|---|---|---|---|---|---|---|
| 1 | clean cell | snapshot value, nothing pending | — | — | `clean` | `editable` | — | `StateCell` row scale, editable input |
| 2 | pea proposal | pea proposed a cell value | — | — | `proposed` | — | — | proposed body (wash + fold + pea square); typing severs it |
| 3 | staged | approved or typed; unpushed | — | — | `staged` + `you` | — | — | bold + caution square; "was X" in the note |
| 4 | review `"attention"` | staged cell flagged; push refuses | — | — | — | — | — | **no axis** — note + caution chips (#1) |
| 5 | read-only binding | `isEditable false` | — | — | — | `readonly` + reason ✅ | — | locked body (greyed italic), reason in readout band |
| 6 | binding blocker | `blocker !== "None"` | — | — | — | `readonly` + reason ✅ | — | locked body, "blocked: X" |
| 7 | unbound cell | row has no binding here | — | — | — | `nohome` ✅ | — | the reserved dashed seam edge |
| 8 | type parameter | shared across rows of a type | — | — | — | — | — | note (was a kiln "T" — a taxonomy hue carrying a fact; dead) |
| 9 | mixed values | grouped row, targets disagree | — | — | — | — | — | note ("mixed values across targets") |
| 10 | calculated / combined column | column kind, never writable | — | — | — | column-scoped | — | header suffix `· ƒ` / `· comb` + column title (#5) |
| 11 | snapshot truncated | rows beyond the cap invisible | — | — | — | — | — | caution `FactChip` (snapshot-level fact) |
| 12 | snapshot age | "read 4m ago" | `fresh`-shaped, **no threshold** | — | — | — | — | meta `FactChip` (#4) |
| 13 | push partial failure | N cells failed; they stay staged | — | — | — | — | `partial` ✅ | `OutcomeLine partial` — but no per-cell mark (#2) |
| 14 | command in flight | catalog/refresh/push | — | — | — | — | `busy` ✅ | `OutcomeLine` + `Verb busy` |
| 15 | command failed | op-level or thrown | — | — | — | — | `error` ✅ | `OutcomeLine` (refusals indistinguishable — settings #3 shares this) |
| 16 | pushed | receipt | — | — | — | — | `receipt` ✅ | `OutcomeLine` |
| 17 | severed proposal | you typed over pea | — | — | — | — | — | **no trace by ruling** (R6) — but no ledger exists to hold the record (#7) |
| 18 | empty edit refused | blank is not a stageable value | — | — | — | — | — | `StateCell` refusal note (R8) ✅ — but "clear this parameter" is inexpressible (#8) |
| 19 | no schedule open / no catalog / no rows | three scopes of nothing | — | — | — | — | — | `EmptyState story="scope"` ×3 ✅ |
| 20 | filtered to nothing | table narrowing hid all rows | — | — | — | — | — | MasterTable's built-in `story="filter"` empty ✅ |
| 21 | pea working | agent active | — | — | — | — | `busy` ✅ | head-rail advisory |
| 22 | bridge disconnected | SSE lane down | — | — | — | — | — | caution `FactChip` |

Mappable: 1–3, 5–7, 13–16, 18–21 land on real axes/outcomes. Unmappable or borrowed: #4, #8–#12,
#17 — 6 of 22, all recorded below.

---

## B · Findings

### 1 · `review: "attention"` has no axis (second consumer)

Identical to settings audit #1: a staged cell can be flagged and the push verb refuses while any
remain, and no axis says "this staged value is contested". Rides the note + caution chips; the
push `reason` names the count. Two routes now want the same thing — this crosses the ≥2-route bar
that R7 held grounding-ambiguity under. Proposed: rule it at the next joint sitting — row-fact
gutter marker (R3's family) vs an `invalid` qualifier on staging.

### 2 · A partial push cannot point at the cells that failed

**Surface fact.** Push returns `failures: [{key, error}]`. The failed cells stay staged (the
`partial` outcome's caution is exactly right) but nothing marks *which* cells failed — the reader
sees "3 cells failed" and a grid of identical staged squares.

**What the language lacks.** Outcomes are orphans (no item links — CLEANROOM's standing model
gap). The one place the failure list exists is a transient command result.

**Left honest.** `OutcomeLine kind="partial"` with "failed cells stay staged — fix and push
again". No invented per-cell mark.

**Proposed resolution.** Either the outcome-link model work, or cheaper and server-side: the push
handler sets `review: "attention"` (with the error as note) on each failed cell — which would ride
#1's resolution and make the failure a countable, filterable fact.

### 3 · `useVerb` cannot carry `partial`

**Surface fact.** `VerbFailKind` is `error | refused | advisory`; a push that half-lands is
`partial` (caution, staged-remains semantics). The route carries a parallel `partial` state beside
`useVerb` to render it.

**Proposed resolution.** Widen `VerbFailKind` with `partial`, or let `run`'s work function return
a typed outcome instead of only a receipt string. One-line change in `lib/use-verb.ts`, for the
component-repair step.

### 4 · Snapshot freshness has no threshold — the age chip can never rank

"read 4m ago" is a fact chip; nothing ever turns it (or the cells under it) `stale`, because
freshness has no subject/threshold (the standing model gap). A schedule read yesterday and one
read 4 seconds ago render identically except for prose. Left honest — no invented threshold.
Turning freshness into work (§3) starts with the model growing one.

### 5 · Column-level facts still have no column reason slot

`isCalculated` / `isCombinedParameter` are facts about the **column**; every cell in one shares
them. Takeoffs #5(b) asked for `ColumnBase.reason` and was declined (readout band + column `title`
ruled the home). This route is the second consumer hitting it: the workaround is a header suffix
(`· ƒ`, `· comb`) plus the column title. Recorded as a second data point, not a re-litigation.

### 6 · The grammar has no in-grid review affordance — the pending strip is the reviewer

**Surface fact.** The old hand-rolled grid had per-cell approve/deny/undo icon buttons. The cell
grammar forbids icons in data cells (settled), `StateCell` row scale is one clipped line, and the
readout band reads but does not act.

**Left honest — and deliberately.** Reviewing moved wholly into the pending strip: every open diff
one line, approve/deny/unstage as plain `Verb`s, click-to-locate driving MasterTable's `activeKey`
(the select fill + scroll-into-view, no hue). Typing in the grid still stages directly.

**Proposed resolution.** If in-grid review is ever wanted back, the language's shape for it is
verbs in the readout band acting on the focused cell (constant height, no icons in cells, keyboard
reachable). Recorded as the candidate, not built.

### 7 · Sever is implemented, but the record R6 promised has no home

**Surface fact.** Typing over a proposed cell now severs the proposal and stages your value (§3
"typing beats proposing" — the old grid *masked*, blocking edits until review). R6 rules that
sever leaves no cell trace and the record lives in the proposal ledger.

**What the language lacks.** This route has no proposal ledger — the severed proposal is simply
deleted from the document. The "superseded by your edit" card R6 points at exists only in the
chat surface's story.

**Proposed resolution.** When the proposal ledger ships, the sever patch should retire the
proposal into it rather than deleting it. Until then the deletion is honest (nothing renders a
false history), just lossy.

### 8 · "Clear this parameter" is inexpressible

**Surface fact.** The empty-string commit is refused ("an empty value cannot be staged") — blank
is not zero, and the old code refused it too, silently. But Revit parameters *can* legitimately be
cleared, and there is now no way to stage an empty write: the refusal conflates "you probably
didn't mean nothing" with "nothing cannot be said".

**Proposed resolution.** A model-level distinction (staged `{value: null}` = clear vs refusing
`""`), plus a deliberate gesture for it. Needs the push op to support clearing first — a
contracts question, not a grammar one.

### 9 · A wide schedule grows a facet dropdown per column

The cell-state clause gives every `state:` column a 7-word facet for free — vocabulary-correct,
and on a 12-column schedule that is 12 dropdowns of mostly "clean" in the header. No way to keep
the state facets on a few columns without losing the clause's counting elsewhere. Left as the
language default; recorded as a density data point for the MasterTable owner.

### 10 · `PickList.emptyNote` is a string, not an `EmptyState`

The rail's "No schedules in the document." renders through `ui/pick-list`'s own plain-string
empty, outside this pass's boundary. When pick-list gets its pass, `emptyNote` should take the
lang `EmptyState` (story: scope, exit: where schedules come from — R9's constructor enforcement).

---

## C · What migrated

| | count | notes |
|---|---|---|
| `MasterTable` + `state:` columns | 1 + N | the grid — first **dynamic** consumer of the cell-state clause (a `state:` column per schedule column) + a locked mono `#` row column; readout band, per-column search, state facets, filter-empty story all free |
| editable `StateCell` (`onCommit`) | every editable cell | R8's first shipping consumer: caret-safe input, Enter/Tab/arrows, Escape restore, refusal note on empty commit; typing severs proposals (§3) |
| `AddressingBar` | 1 | name · schedule sentence · facts (bridge, dims, truncated, read-ago) · push (the one commit) · pea-busy advisory |
| `Verb` | 5 + 3/pending row | push (`commit`), re-read, re-list, list-schedules; approve/deny/unstage in the strip. Loader2 spinners → `Verb busy` |
| `FactChip` | 7 | bridge, dims, truncated (caution), read-ago, proposed (pea), staged (caution), need-review (caution) |
| `OutcomeLine` | 6 kinds | busy (+seconds), error, **partial** (push failures — new to this surface; was a plain error line), receipt, connecting, pea-busy |
| `EmptyState` | 4 | no schedule list, no schedule open, schedule has no rows, (+ MasterTable's built-in filter empty) |
| `HelpTip` | 1 | pending-strip head — "Pea can propose; only you can push" left inline chrome and moved to its typed home |
| `ValueDiff` recolored | strip | staged → bold `--r-caution` (unsaved law), proposal → `--r-pea-ink` (were cat-green/cat-clay) |
| locate | strip → grid | scrollIntoView hack → MasterTable `activeKey` (select fill, no hue) |
| deleted | ~260 LOC | hand-rolled `ScheduleTable`/`Cell`/`CellAction`, trichotomy tint classes (`bg-cat-green/12`, `bg-cat-clay/12`, `bg-destructive/10`), kiln `Badge`s, `Input`-in-cell, `HostConnectionPill` usage, `ui/button`/`ui/badge`/`ui/input` imports, all lucide icons |

**Old vocabulary shed by this route:** `--pea-line`, `--pea-tint`, `--pe-green` (this was among
the last var() consumers of all three), `text-cat-kiln`, `text-cat-green`, `text-cat-clay`,
`bg-cat-green`, `bg-cat-clay`, `--destructive`-as-state, `--primary`-as-state (cell hover/border),
`--line-soft`, `tele`/`tele-label`/`section-label`, `font-pe-display` header. `ui/button` imports
remaining in this route: **0**.
