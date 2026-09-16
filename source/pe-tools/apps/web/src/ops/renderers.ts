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
import {
  FamilyEditorSnapshotView,
  ParameterCoverageView,
  ScheduleCoverageView,
} from "#/ops/views/detail/parameter-coverage";
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
  "family.editor.snapshot": FamilyEditorSnapshotView,
};
