# ADR 0003 — Read envelope, glance tier, and the demotion rule

Date: 2026-07-24. Status: accepted, first instance implemented (`revit.glance.model`).

## Context

The /ops UI build ([docs/op-contract-feedback.md](../op-contract-feedback.md)) proved that pea's
recurring needs are *questions* ("what is this model?", "what's on screen?") while the catalog is
organized as *capabilities*. Answering one question cost 2–4 calls, three truncation dialects
(`page{totalCount,returnedCount,isTruncated}`, bare `summary.truncated`, `issues[]` warning
codes), client-side joins, and no response said *when* it was observed. The right metric is not
op count but **tokens-to-trustworthy-answer per workflow**.

## Decision

### 1. One read envelope

Every read response converges on:

- **`observedAtUtc`** (ISO 8601, stamped Revit-side at collect time) — freshness-aware provenance
  is a product law and was previously unimplementable. New ops MUST carry it; existing ops adopt
  it when next touched.
- **One truncation shape**: `RevitDataResultPage { totalCount, returnedCount, isTruncated }` is
  the only page/truncation dialect for row lists. Summary counts are always complete
  (pre-truncation) totals — a summary field never reflects a budget-truncated page. `issues[]`
  remains for *warnings*, not as a truncation channel.
- **Handles-as-links**: responses carry handles that are valid inputs to deeper ops. Progressive
  discovery rides on data pea already holds, not on catalog scanning.

### 2. The glance tier

`revit.glance.*` is a first-class op layer (added to the public key taxonomy): one bounded,
pre-digested packet per recurring question, composed server-side from complete summaries — never
from budget-truncated row lists, so glance packets need no page envelope at all. Glances are
`DefaultVisible`; a bare `host_operation_search` browse shows only the DefaultVisible orient tier
plus a count of what's hidden, and everything else stays reachable by query or explicit
visibility filter.

`revit.glance.model` is the proving instance (promoted from the client-side prototype in
`apps/web/src/ops/glance/model.tsx`): document identity + true project totals + levels +
sheet-number series + family composition + binding health, in one response.

### 3. The demotion rule

Every composed glance op that embeds a constituent's information demotes that constituent from
`DefaultVisible`. First execution: `revit.catalog.project-index` dropped to `EscalationVisible`
because `glance.model` carries its totals. This is what keeps "more glance ops" from becoming
catalog bloat.

### 4. The scripting line

Perception needs contracts; action tolerates scripts. A recurring *question* about model state
gets a typed op even if scriptable (output models, provenance, and rendering all need the
contract). An uncommon *transform* stays a script even if common-ish — the human approval flow is
its type system. Gray middle (uncommon reads): script first, promote when the same script shape
appears three times.

## Consequences

- Client-side synthetic glances in `apps/web/src/ops/glance/` remain as prototypes and UI
  surfaces; each is a candidate for promotion using `glance.model` as the template
  (`attention`, `drawing-set`, `session-topology`).
- Omitted request limits must never clamp to a minimum: limit fields are nullable in contracts,
  collectors substitute generous defaults, and only explicit out-of-range values warn
  (fixed in `RevitAgentVisibleContextRequest` / `RevitAgentViewRenderingStateRequest`).
- `ProjectIndexSummary` now carries `projectTotals` (unfiltered non-template counts) alongside
  its matched counts, killing the project-index-vs-browser count contradiction.
- Pending, adopt-when-touched: `appliedBudget` echo on budgeted responses; `observedAtUtc` on
  existing read ops; converging loaded-families/parameter-bindings on the single page shape.
