/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { RevitElementScope } from "./revit-element-scope.js";
import type { ScheduleCatalogRequest } from "./schedule-catalog-request.js";
import type { ScheduleRoleScope } from "./schedule-role-scope.js";
import type { RevitDataOutputBudget } from "./revit-data-output-budget.js";

export interface ScheduleCoverageRequest {
  categoryNames: string[];
  scope: RevitElementScope;
  elementIds: number[];
  elementUniqueIds: string[];
  scheduleFilter?: ScheduleCatalogRequest;
  scheduleRoleScope: ScheduleRoleScope;
  budget?: RevitDataOutputBudget;
  includeElementSamples: boolean;
}
