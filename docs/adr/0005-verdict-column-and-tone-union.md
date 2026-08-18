# ADR 0005 — Pipeline verdicts are a typed column, not a cell state

Date: 2026-08-16. Status: accepted (design-lang ruling R5, landed on `MasterTable`).

## Context

Cell states in the design language describe *a value*: its freshness, its staging, its capability,
its agreement with ground. `/families` needed to render a row-level **pipeline verdict**
(`unplanned` / `outside profile` / `no actions` / `excluded` / `included` / `applied` / `failed`) and
the obvious move was to reuse the cell grammar with a word.

That fails on evidence: only 1 of the 7 words maps to a cell axis, so six distinct verdicts would
render as an unmarked ("clean") cell wearing a route label — the mark says nothing while the word
says everything. Meanwhile the interim `stateColumn` renderer was string-typed and let each route
hand-pick a tone, which is how `--pe-blue` and `--clay-ink` ended up spent on facts that own
neither.

Every route that runs a pipeline over rows (takeoffs, /families, host-runtime-ops, settings) hits
this, so the ruling is not feature-local.

## Decision

1. **A pipeline verdict is a second legitimate column form**, not a pseudo-dimension of a value
   column and not a shim awaiting a `StateColumn.word` migration. It ships as a typed `verdict:`
   clause on `MasterTable`; the string-typed `stateColumn` renderer is deleted.
2. **Verdict tones ride the meaning band only** — a closed union of meaning roles, never a free
   tone: `--r-done` = applied, `--r-alarm` = failed, `--r-caution` = included (queued actions are
   unsaved work), `--r-ink-mute` for the four quiet words. Commit blue is deliberately NOT spent on
   `included`: the one filled blue belongs to the verb that writes.
3. **Derived is not a state.** Formula-driven cells drop OFF the meaning band to `--r-ink-2` rather
   than land on a wrong role — `--r-done` is wrong (a formula does not *land*, it *computes*) and
   `cap: "readonly"` is a claim about the user, not about the number. There is no `--r-derived`.

## Consequences

- Routes may not invent a tone for a verdict; a needed tone is a token ruling with a guard update,
  in one commit.
- Any surviving `StateMeta.tone` free-string must be narrowed to the meaning-role union (owed in
  the takeoffs and /families ledgers).
- Row facts that are *not* verdicts — "a human decision is queued here", unreachability — are still
  homeless; they were ruled row facts wanting the SURFACE-PHILOSOPHY §4 gutter marker, which is not
  built.
- Token discipline is enforced by `apps/web/src/design-guard.test.ts`; deleted vocabulary
  (`--st-derived`, `--st-ground`) stays at hard zero.
