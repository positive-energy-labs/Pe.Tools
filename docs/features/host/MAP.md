# Revit world cluster, protoui frontier

Live effort map. Delete this file when the cluster lands in canon; promote what survives into `LEDGER.md`.

## Fixed constraints (kaitpw, 2026-10-12)

- One world: the `Machine` reading is what the cluster renders and what `pe_find` returns.
- No staged launch. Consequences are choices on the verb.
- A proposal is a review artifact. The only write gate is the thread head on a user document.
- Pea's background sessions appear in the same world with minimum visibility: what Pea works on, its latest activity, its result.
- One component, three homes: machine drawer, composer-head popover, `/open` route.

## Round 1 (2026-10-12)

Page: `.artifacts/runs/protoui-20261012-revit-world/index.html` (`?variant=A..D&home=route|drawer|popover`).

| Variant | Shape |
|---|---|
| A Ledger | One table, rows grouped by Revit, verbs on hover |
| B Sentence | The composer sentence grows; "Yours" and "Pea's desk" lanes |
| C Desk | Each Revit is a window with document tabs; drag a recent onto a window |
| D Feed | Pinned state chips over an event timeline (overreach: needs an SDK event stream) |

Shared across variants: the open sentence that fills itself, the `r`/`rw` io mark as the grant display, the "Pea sees" JSON pane.

## Open

- Q13: grant boundary. Proposal under test: the grant ends when the document closes, or 60 minutes after the user's last message in that thread.
- Q14: whether a workshared document needs plan-then-apply under a grant.
- Q15: whether the proposal/gate split becomes an ADR.
