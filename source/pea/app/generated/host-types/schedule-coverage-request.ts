/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { ScheduleCatalogRequest } from "./schedule-catalog-request.js";
import type { RevitDataOutputBudget } from "./revit-data-output-budget.js";

export interface ScheduleCoverageRequest {
  categoryNames: string[];
  scheduleFilter?: ScheduleCatalogRequest;
  budget?: RevitDataOutputBudget;
  includeElementSamples: boolean;
}
