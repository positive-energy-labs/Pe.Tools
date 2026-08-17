# Op-contract feedback from the glance prototypes

Preserved 2026-08-16 from the synthetic `glance.*` ops in `src/ops/glance/` ahead of the ops
migration: each note is the argument that a first-class host op should return the composed shape
the prototype had to assemble client-side. Notes are quoted verbatim from each op's `contractNote`.

## `glance.model`

Fans out to: `revit.glance.model` (one dep; first-class since ADR 0003 — previously a 4-call
client fan-out).

> First-class since ADR 0003: one revit.glance.model packet replaced the 4-call client fan-out (3 truncation dialects).

## `glance.attention`

Fans out to: `revit.glance.attention` (one dep; first-class since ADR 0003 — previously a 3-call
client fan-out).

> First-class since ADR 0003: one revit.glance.attention packet replaced the 3-call fan-out; limits are host-owned and never clamp to the minimum.

## `glance.drawing-set`

Fans out to: `revit.catalog.project-index` (`sections: ["Sheets"]`, Handles projection) as the
declared dep, plus a staged `revit.detail.sheets` batch for anchor geometry on up to 10 sheets
(one per series, then the richest remainder).

> wants revit.catalog.sheets: flat sheet list with series grouping + per-sheet anchor thumbnails in one bounded call; today it takes project-index (Sheets) + a staged N-sheet detail.sheets batch

## `glance.session-topology`

Fans out to: `host.topology` as the declared dep, plus a staged per-session
`revit.context.document-session` call for each connected session (bounded at 12).

> host.topology landed (ADR 0003): host identity + sessions in one snapshot. Still client-staged: per-session documents (1 + N calls) — the contract doesn't carry them yet, nor the host's own port/baseUrl.
