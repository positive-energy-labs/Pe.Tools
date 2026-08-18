# settings ledger

## Decided
- 2026-08-16 — /settings stays a list of `StateCell`s at CARD scale, not a table: it is a small trichotomy reviewer over a JSON file, and at list scale per-row approve/deny/unstage verbs are the honest form even at ~3 verb widths per row.
- 2026-08-16 — Prior value under a proposal/stage rides "was X" leading the note: card scale has an inline ghost only for `drift`, and a schema-flagged or pea-proposed value is not drift. Prose where the chat card renders a real diff — accepted until the model carries the proposal's prior value.
- 2026-08-16 — A busy/down SSE bridge is a caution `FactChip`, not an agreement signal: a broken lane is not the model disagreeing.
- 2026-08-16 — Validation issues stay document-scoped chips rather than being joined onto the fields they name: an issue on a staged field IS the `attention` fact, so joining is entangled with the unruled axis below and would have pre-decided it.
- 2026-08-16 — Every command failure lands as `OutcomeKind: "error"` (caution), never dressed as a refusal: `route.command` returns `{ok:false, error?, hint?}` with no refusal discriminator, and guessing would spend the one alarm dishonestly.

## Tried & rejected
- 2026-08-16 — `RouteWorkspaceShell` as this route's chrome: replaced by `AddressingBar`; the shell spends legacy tokens (`--paper`, `--clay-ink`, `--lichen`, `--cat-clay`, `--line-2`) and could not carry the fact lane or the one-commit verb.
- 2026-08-16 — `HostConnectionPill` for bridge state: replaced by a connection `FactChip`; the pill was route chrome carrying a document-scoped fact.
- 2026-08-16 — Hand-rolled busy/error state per command: replaced by `useVerb`, which serializes open/re-read/validate/save.

## Owed
- `review: "attention"` has no axis — not `agree: "drift"` (the model holds no other value; the schema objects to this one), not freshness, not capability. /schedule-grid is the second consumer, so rule it: row-fact gutter marker (the R3 ruling, also owed by takeoffs and /families) or an `invalid` qualifier on `stage: "staged"`.
- Card-scale `StateCell` should render the struck-current → proposed treatment the chat card owns, once the model grows the proposal's prior value.
- The route-state command result needs a `refused` marker in its payload before any route can spend the alarm honestly — the R12 `fail(kind, …)` machinery exists, the payload doesn't carry the kind. (Shared with /families, whose refused-arming state wants structured refusals too.)
- Join validation issues to the rows their field paths name, once the attention axis is ruled.
- `workbench/route-workspace-shell.tsx` now has ZERO importers — delete it, and check whether `HostConnectionPill` in `host/issues.tsx` also went to zero. (The audit expected /parameter-links to be the last consumer; it no longer imports the shell.) (verify)
- Four /settings variants were built on a worktree behind `?variant=` (2026-08-17) awaiting kaitpw verdicts — harvest the winner or drop the worktree. No design-doc corroboration in this dir; the record is the session memory only. (verify)
- If settings ever grows past a few dozen fields, migrate it to `MasterTable` with `state:` columns and the /schedule-grid pending-strip reviewer pattern.
