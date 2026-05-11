/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { ScheduleCustomParameterFilter } from "./schedule-custom-parameter-filter.js";

export interface ScheduleCatalogRequest {
  categoryNames: string[];
  scheduleNames: string[];
  customParameterFilters: ScheduleCustomParameterFilter[];
  includeTemplates: boolean;
}
