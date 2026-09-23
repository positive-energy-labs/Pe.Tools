/**
 * Opt-in output renderers, op key to component. A renderer exists only when it draws what the
 * response schema cannot: a drawing, a pivot, a join across arrays. Everything else is the raw
 * receipt. Both the ops result pane and `ActionReceiptView` read this map, so a chat receipt
 * draws the same view as a run.
 */
import type { ComponentType } from "react";

import type { OpViewProps } from "#/ops/registry";
import { ProjectBrowserView } from "#/ops/views/catalog/project-browser";
import { ProjectIndexView } from "#/ops/views/catalog/viz-cycle";
import { ContextSummaryView } from "#/ops/views/context/kind-viz";
import { ResolveReferencesView } from "#/ops/views/context/resolve-references";
import { ParameterCoverageView, ScheduleCoverageView } from "#/ops/views/detail/parameter-coverage";
import { LoadedFamiliesView, ParameterLinksView } from "#/ops/views/detail/parameter-links";
import { SchedulesView } from "#/ops/views/detail/schedules";
import { SheetsView } from "#/ops/views/detail/sheets";
import { PanelSchedulesView } from "#/ops/views/electrical/breaker";

export const outputRenderers: Record<string, ComponentType<OpViewProps>> = {
  "revit.catalog.project-browser": ProjectBrowserView,
  "revit.catalog.project-index": ProjectIndexView,
  "revit.context.summary": ContextSummaryView,
  "revit.resolve.references": ResolveReferencesView,
  "revit.detail.schedules": SchedulesView,
  "revit.detail.sheets": SheetsView,
  "revit.detail.parameter-links": ParameterLinksView,
  "revit.detail.electrical-panel-schedules": PanelSchedulesView,
  "revit.matrix.parameter-coverage": ParameterCoverageView,
  "revit.matrix.schedule-coverage": ScheduleCoverageView,
  "revit.matrix.loaded-families": LoadedFamiliesView,
};

/** These catalog operations deliberately show their schema-shaped raw receipt. */
export const rawByDesign = [
  "aps.auth.login",
  "aps.auth.logout",
  "aps.auth.status",
  "aps.auth.token",
  "bridge.sessions.list",
  "bridge.sessions.summary",
  "data-table.apply",
  "document.temporary.release",
  "document.temporary.status",
  "families.apply",
  "families.capture",
  "families.plan",
  "family.apply",
  "family.build",
  "family.capture",
  "family.open",
  "family.plan",
  "family.temporary.acquire",
  "host.ops.catalog",
  "host.shell.open",
  "host.status",
  "host.topology",
  "logs.tail",
  "op.cancel",
  "pod.export",
  "pod.import",
  "pod.list",
  "pod.member.compose",
  "pod.member.read",
  "pod.member.save",
  "pod.member.write",
  "pod.runs",
  "revit.apply.command.execute",
  "revit.apply.parameter-links",
  "revit.apply.parameter-values",
  "revit.apply.parameters-service-cache.refresh",
  "revit.catalog.concept-evidence",
  "revit.catalog.electrical-circuits",
  "revit.catalog.electrical-load-classifications",
  "revit.catalog.electrical-panels",
  "revit.catalog.field-options",
  "revit.catalog.loaded-families",
  "revit.catalog.loaded-families.filter-field-options",
  "revit.catalog.loaded-families.filter-schema",
  "revit.catalog.parameter-bindings",
  "revit.catalog.parameter-evidence",
  "revit.catalog.schedules",
  "revit.context.document-session",
  "revit.context.view-image",
  "revit.context.view-rendering-state",
  "revit.context.visible-summary",
  "revit.detail.data-tables",
  "revit.detail.elements",
  "revit.glance.attention",
  "revit.glance.model",
  "revit.matrix.schedule-profiles",
  "revit.resolve.unit-value",
  "rhvac.assemblies",
  "rhvac.launch",
  "rhvac.list",
  "rhvac.open",
  "rhvac.sync",
  "rhvac.takeoff",
  "schedule.apply",
  "schedule.capture",
  "schedule.cells.apply",
  "scripting.execute",
  "scripting.workspace.bootstrap",
  "settings.field-options",
  "settings.parameter-catalog",
  "settings.schema",
  "settings.validate",
  "takeoffs.adopt",
  "takeoffs.candidates",
  "takeoffs.initialize-carrier",
  "takeoffs.partition",
  "takeoffs.rhvac-links",
  "takeoffs.saved",
  "takeoffs.snapshot",
] as const;
