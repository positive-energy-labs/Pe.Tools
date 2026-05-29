/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { SchedulePlacementScope } from "./schedule-placement-scope.js";
import type { ScheduleCustomParameterFilter } from "./schedule-custom-parameter-filter.js";
import type { ProjectBrowserFilter } from "./project-browser-filter.js";
import type { ScheduleCatalogProjection } from "./schedule-catalog-projection.js";
import type { RevitDataOutputBudget } from "./revit-data-output-budget.js";

export interface ScheduleCatalogRequest {
  categoryNames: string[];
  scheduleNames: string[];
  scheduleNameContains?: string;
  scheduleNamePrefix?: string;
  placementScope: SchedulePlacementScope;
  sheetNumberContains?: string;
  sheetNameContains?: string;
  isEmpty?: boolean;
  customParameterFilters: ScheduleCustomParameterFilter[];
  browserFilter?: ProjectBrowserFilter;
  includeTemplates: boolean;
  projection?: ScheduleCatalogProjection;
  budget?: RevitDataOutputBudget;
}
