# data-tables ledger

## Decided
- 2026-08-16 — Per-cell unsaved grammar deliberately not built: the whole draft (name/columns/rows) is unsaved until apply and the route keeps no baseline, so the commit verb is honestly the loudest thing on the page. Only worth building if review wants per-cell honesty on a synthetic table nobody else edits.
- 2026-08-16 — Gutter-scale destructive controls (per-row/column removers) stay raw `<button title=…>`: `Verb.label` is required and a dense grid cannot pay a 24px labelled verb per row. Neutral hover, not `--destructive` — alarm is not an affordance.
- 2026-08-16 — Column-kind txt/num stays a native `<select>`, not `Switcher`: same semantics, but 24px vs ~70px × N columns at table-header scale. Evidence for a compact switcher variant, not a request for one.

## Tried & rejected
- 2026-08-16 — `hover:text-destructive` on the row/column removers: spent the alarm hue on mere affordance; replaced by neutral ink plus a title reason.

## Owed
- No axis says "this apply will *remove* N rows" — a queued destructive write has no grammar (the takeoffs verdict-owed ruling made queued *human* work a row fact; destructive writes have no equivalent). Cheap local fix: derive `pruned = opened rows − draft rows` and label the verb "apply to revit · prunes N".
- Rule it: either an icon-verb variant (required `reason` riding the title) or a blessing that gutter-scale destructive affordances stay route-rolled. (verify — may be settled by a later lang pass.)
- `--line-soft` shim line in `styles.css` still has ~18 consumers (`ops/`, `chat`, `family`) blocking deletion. (verify)
