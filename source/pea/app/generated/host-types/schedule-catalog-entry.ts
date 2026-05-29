/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { ScheduleCatalogSheetPlacement } from "./schedule-catalog-sheet-placement.js";
import type { ScheduleFilterSpec } from "./schedule-filter-spec.js";
import type { ScheduleParameterUsageEntry } from "./schedule-parameter-usage-entry.js";
import type { ScheduleCatalogCustomParameterValue } from "./schedule-catalog-custom-parameter-value.js";
import type { ScheduleVisibleFamilyEntry } from "./schedule-visible-family-entry.js";
import type { ProjectBrowserPath } from "./project-browser-path.js";

export interface ScheduleCatalogEntry {
  scheduleId: number;
  scheduleUniqueId: string;
  name: string;
  categoryName?: string;
  isTemplate: boolean;
  viewTemplateName?: string;
  isItemized: boolean;
  filterBySheet: boolean;
  isPlacedOnSheet: boolean;
  sheetPlacements: ScheduleCatalogSheetPlacement[];
  filters: ScheduleFilterSpec[];
  parameterUsages: ScheduleParameterUsageEntry[];
  customParameters: ScheduleCatalogCustomParameterValue[];
  visibleBodyRowCount: number;
  visibleFamilyCount: number;
  visibleInstanceCount: number;
  visibleFamilies: ScheduleVisibleFamilyEntry[];
  browserPaths: ProjectBrowserPath[];
}
