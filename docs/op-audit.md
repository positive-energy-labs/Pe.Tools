# Op audit — tier assignment for the live catalog

2026-07-24, against the ~66-op live surface (C# bridge ops + TS-only host ops). Tiers per
[ADR 0003](adr/0003-read-envelope-and-glance-tier.md): **DefaultVisible** = the orient tier a bare
`host_operation_search` browse returns; **EscalationVisible** = reachable by query/filter;
**ExpertOnly** = admin/plumbing, explicit tier filter only. Host-admin ops (`host.status`,
`logs.tail`, `bridge.sessions.*`) and `scripting.*` are already projected out of the catalog
entirely (dedicated tools own them).

Enforcement lives in `InferVisibilityFromKey`
([HostOperationContracts.cs](../source/Pe.Shared.HostContracts/Operations/HostOperationContracts.cs))
plus per-op metadata; the browse filter lives in pea's `host_operation_search`.

## DefaultVisible — the orient tier (6)

| op | why it's here |
|---|---|
| `revit.glance.model` | THE "what is this model" question |
| `revit.glance.attention` | THE "what's on screen / can I trust it" question |
| `revit.context.summary` | compact doc + selection + active-view orientation |
| `revit.resolve.references` | natural reference → handles; the door to everything deeper |
| `host.topology` | the operator's map: host + all sessions in one snapshot |
| `revit.catalog.recent-documents` | the no-active-document orientation ("what can I open") |

Demoted out: `revit.catalog.project-index` (glance.model carries its totals — first execution of
the demotion rule), plus the TS-only tier inflation: `settings.workspaces/tree/document.open/
validate/save` and `aps.auth.status/login/logout` dropped to EscalationVisible.

## EscalationVisible — searchable working set (the bulk)

All `revit.catalog.*` / `revit.detail.*` / `revit.matrix.*` (minus ExpertOnly below),
`revit.context.visible-summary`, `view-rendering-state`, `view-image`, `document-session`,
all `revit.apply.*` mutations (minus cache refresh), `family.editor.*`, `settings.*` documents
and module catalog, `aps.auth.*`, `revit.catalog.recent-documents`, `revit.ini`,
`settings.tree` / `workspaces`. No changes proposed; handles in glance/summary responses are the
intended path in.

## ExpertOnly — admin/plumbing (was 2 + scripting, now 7 + scripting)

| op | rationale |
|---|---|
| `revit.matrix.schedule-profiles` | heavy diagnostic (existing) |
| `revit.catalog.electrical-load-classifications` | niche + contract gaps open (existing) |
| `revit.catalog.field-options` | UI form-feed plumbing, not an agent question — **demoted** |
| `revit.catalog.loaded-families.filter-field-options` | same — **demoted** |
| `revit.catalog.loaded-families.filter-schema` | same — **demoted** |
| `revit.apply.parameters-service-cache.refresh` | cache admin — **demoted** |
| `settings.field-options` | UI form-feed plumbing — **demoted** |

## Flagged for review (no change made)

- `revit.apply.command.execute` (ribbon command escape hatch): ExpertOnly candidate — powerful,
  unbounded, and scripting already covers the "no op fits" case. Left EscalationVisible pending a
  usage read.
- `revit.catalog.concept-evidence` / `revit.catalog.parameter-evidence`: judgment-heavy reads with
  unclear recurrence — script-candidates under the ADR 0003 line if usage stays rare. Left in
  place; revisit after glance ops absorb the common questions.
- "Schedules is three different numbers" and the remaining envelope retrofits: tracked in
  [op-contract-feedback.md](op-contract-feedback.md), adopt-when-touched.

## Glance promotion roadmap

| glance | status |
|---|---|
| `glance.model` | **promoted** (`revit.glance.model`) |
| `glance.attention` | **promoted** (`revit.glance.attention`) |
| `glance.drawing-set` | next: needs a `Thumbnail`-weight projection on `revit.detail.sheets` (titleblock + viewport bounds) and a first-class sheet series/discipline field; client glance stays as the UI surface |
| `glance.session-topology` | **promoted** (`host.topology`, TS-only host op, DefaultVisible): host identity + all sessions in one snapshot |

Client-side glances in `apps/web/src/ops/glance/` are kept as UI surfaces regardless of promotion.
