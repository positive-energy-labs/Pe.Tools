# /instances — design-language audit

What the fleet dashboard needed that `components/lang` + the `--r-*` canon could not say, recorded
during the per-route design-system pass of 2026-08-16. Instances is small but interesting: its
state is a **row-level pipeline verdict** (world phase), not a value's pseudo-dimension — so it is
an early real consumer of the `verdict:` column clause (R5) — and every one of its verbs writes
beyond the page (process lifecycle), which stress-tests the blue-scarcity law.

Governance: `components/lang/*`, `components/master-table/*`, `host/fleet.ts`, `styles.css`,
`design-lang.css` were **not** changed. Canon:
[`../../design/SURFACE-PHILOSOPHY.md`](../../design/SURFACE-PHILOSOPHY.md),
[`../design-lang/CLEANROOM.md`](../design-lang/CLEANROOM.md), `apps/web/src/design-lang.css`.

---

## A · State census

Against the four axes (freshness · agreement · staging+`stagedBy` · capability) and the outcome
lane. Instances is a fleet of *worlds*, not a grid of *values* — almost everything here is a row
fact or a verdict, which is itself the census's main result.

| # | state | means | axes | outcome | rendered as |
|---|---|---|---|---|---|
| 1 | `live` | bridge holds an open connection | **none** — row verdict | — | `verdict:` word `live`, tone `done` (#2) |
| 2 | `booting` / `ready` | registry boot window, no bridge yet | **none** — row verdict | — | `verdict:` registry word, tone `ink` |
| 3 | `unresponsive` / `pid-reused` | process exists, stopped answering | **none** — row verdict | — | `verdict:` `unresponsive`, tone `caution` (a busy world is not the model disagreeing) |
| 4 | `dead` / `stopped` / `materialized` | gone (or never started) | **none** | — | demoted to the killed list — italic + `--r-ink-mute` throughout (#5) |
| 5 | your Revit: display-only | this surface may not manage it | `cap`-shaped, but a **row** fact | — | italic muted "yours — not managed here" + title (#5) |
| 6 | live world, no open document | connected and empty | — | — | honest labelled value "no open document", italic muted (not "—") |
| 7 | registry-only world, nothing observed | no bridge testimony exists | — | — | "nothing observed", italic muted (not "—") |
| 8 | seen N ago / started N ago | age of the last observation | `fresh`-shaped, no threshold | — | mono `--r-ink-2` age column (#6) |
| 9 | lifecycle POST in flight | start/stop/restart running | — | `busy`-shaped | `Verb busy` ("label…"); no separate line |
| 10 | POST failed | HTTP or thrown | — | `error` ✅ | `OutcomeLine` |
| 11 | POST diagnostics on success | e.g. eviction notes | — | `advisory` ✅ | `OutcomeLine` (was folded into the error slot before) |
| 12 | no worlds running | fleet empty | — | — | `EmptyState story="scope"`, exit = the declare lane ✅ |
| 13 | ledger empty | nothing observed from this tab yet | — | — | `EmptyState story="scope"` ✅ |
| 14 | ledger entry (bridge / you) | the honest record | **none** — outcomes are orphans | — | hand-rolled actor + label + age lines (#4) |

Value-axis mappable: essentially none — and that is correct. The `verdict:` clause carries rows
1–3; the rest are row facts, outcomes, and empties.

---

## B · Findings

### 1 · `PHASE_COLOR` is now consumer-less — and it was the violation

**Surface fact.** `host/fleet.ts` exports `PHASE_COLOR`, spending `--pe-blue` (live),
`--cat-kiln` (booting), `--cat-clay` (unresponsive), `--muted-foreground` (dead) — taxonomy and
commit hues carrying *state*, exactly the class these passes exist to delete. This route was its
only importer.

**Left honest.** The route now derives a `Verdict` (`live`/`booting`/`unresponsive` on
`done`/`ink`/`caution`) and `PHASE_COLOR` has zero consumers — but it lives in `host/` (shared
fleet module), outside this pass's boundary, so it was not deleted.

**Proposed resolution.** Delete `PHASE_COLOR` from `host/fleet.ts` (nothing imports it), and with
it fleet's last colour opinion — phase→tone mapping belongs to the rendering route, which now owns
it as `phaseVerdict`.

### 2 · "running" has no meaning role — `live` wears `done`

**Surface fact.** A live world is healthy and connected — the row's best state.

**What the language lacks.** The meaning band has no "running/connected" role. `done` means "it
landed" (a completed write); a long-running process never landed anything. `ink` under-states it
against `booting`.

**Left honest.** `live` wears `done`. Defensible — "the bridge connection landed" — but it is a
stretch, recorded so the next fleet-ish surface (ops?) doesn't invent a different answer.

**Proposed resolution.** Bless `done` as also meaning "healthy/connected" in the verdict-tone
vocabulary (one sentence in `master-table/model.ts` or design-lang.css), or rule that connectivity
is what `ink` + the word carry. Do not mint a hue.

### 3 · Every verb here writes beyond the page — blue stops being scarce

**Surface fact.** Declare ×3, restart/stop per fleet row, start-again per killed row: every verb
boots or kills an OS process. Under "the only filled blue is the verb that writes beyond the page",
all of them wear `commit`, and a three-row fleet shows eight filled-blue buttons.

**What the language lacks.** A quieter form for "writes beyond the page, but is not THE page
verb". Blast radius is ruled a label, not a tone — correct — but the law's scarcity *signal*
assumed most verbs are safe, and on a pure lifecycle surface none are.

**Left honest.** All commit, per the letter. The declare lane's `VerbGroup` radius line ("boots a
Revit process on this machine") carries the blast statement once.

**Proposed resolution.** For joint review: either accept that a lifecycle cockpit is legitimately
blue-dense (the honest reading — everything here really does write), or extend the verb grammar
with a bordered-commit rank for row-scale writes. Skepticism of growth suggests the former.

### 4 · The ledger is an outcomes lane the language cannot build yet

**Surface fact.** The rail merges bridge-observed world events with this tab's own actions —
actor, label, age, oldest first. It is the route's honesty device.

**What the language lacks.** `OutcomeLine` carries no actor, no time, no target — the documented
"outcomes are orphans" gap — so a timestamped, attributed event line cannot be an `OutcomeLine`
without inventing slots.

**Left honest.** Hand-rolled lines on tier × face × case (mono caption actor, sans label, mono
age), `--r-ink` ladder only; `--pe-blue` for the bridge actor died (an actor is not nav). A
`HelpTip` orients the region; the collapsed rail keeps its count.

**Proposed resolution.** When the state model grows outcome links (verb/time/target — CLEANROOM
frontier), the ledger becomes a lane of real outcomes; until then this stays route-owned.

### 5 · Row-scale "dropped/locked" has no ruled idiom

**Surface fact.** Two treatments were borrowed: killed worlds render **italic + `--r-ink-mute`**
throughout (the `dropped` outcome's treatment, applied to whole rows), and "yours — not managed
here" renders italic muted (the locked treatment, applied to a row fact without a cell).

**What the language lacks.** Italic = locked/disabled/dropped is a *cell and outcome* law; nothing
rules how a whole row says "this is history" or "this is not yours to operate". The old code said
it with `opacity-[0.55]`, which the language forbids nothing about but rules nothing for.

**Proposed resolution.** Bless italic + `ink-mute` as the row-scale reading of the same law (this
pass's de-facto answer), or give `verdict:` a `dim` treatment that owns it — `Verdict.dim` exists
and is spent on the dot already.

### 6 · "seen 32s ago" is freshness without a threshold

**Surface fact.** The seen column ages every world against the bridge's last observation.

**What the language lacks.** The known model gap: freshness has no subject/threshold, so the age
can never rank (fresh vs stale) and never becomes queue work — it is a number the reader must
judge. Same gap CLEANROOM records for the cell grammar.

**Left honest.** Mono secondary ink, no colour, no squiggle — an age, not a verdict.

---

## C · What migrated

| | count | notes |
|---|---|---|
| `MasterTable` + `verdict:` | 1 | the fleet — consumer of the R5 verdict clause; facet/sort by phase word for free |
| `Verb` | 3 + 2/row + 1/killed row | all `commit` (see #3); busy via `Verb busy`; reasons in titles incl. the force-stop explanation |
| `VerbGroup` | 1 | "declare a new world", radius line carries the blast statement; the dashed borders died (they meant "button", not seam) |
| `OutcomeLine` | 3 kinds | error, advisory (diagnostics were mis-slotted as errors before), busy (fleet loading) |
| `EmptyState` | 2 | no worlds (exit: declare lane) · ledger quiet (exit: act or observe) |
| `HelpTip` | 2 | killed-list head, ledger head — the old inline label prose ("LEDGER — observed from this tab") moved into its typed home |
| honest empties | 2 | "no open document" / "nothing observed" replace "—" |
| type/type-bundle purge | all | `Mono` atom (raw `--font-pe-mono` + px sizes 8/9/10), `tele`, `text-[9px]`/`[10px]`/`[11px]`/`[13px]` → tier × face × case |
| deleted | `Btn` atom, `PHASE_COLOR` import, `opacity-[0.55]` row, danger-clay button styling |

**Old vocabulary shed by this route:** `PHASE_COLOR` (→ zero consumers, #1), `--pe-blue`,
`--cat-clay`, `--line-2`, `--line-soft`, `--muted-foreground`-as-state, `tele`, raw
`font-[var(--font-pe-mono)]`. `ui/button` imports in this route: **0** (it had none — it had a
worse hand-rolled `Btn`, now dead).
