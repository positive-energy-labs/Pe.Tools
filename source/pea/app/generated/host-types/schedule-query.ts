/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { ScheduleQueryKind } from "./schedule-query-kind.js";
import type { ScheduleQueryProjection } from "./schedule-query-projection.js";
import type { RevitDataOutputBudget } from "./revit-data-output-budget.js";

export interface ScheduleQuery {
  kind: ScheduleQueryKind;
  scheduleIds?: number[];
  scheduleUniqueIds?: string[];
  scheduleNames?: string[];
  projection?: ScheduleQueryProjection;
  budget?: RevitDataOutputBudget;
}
