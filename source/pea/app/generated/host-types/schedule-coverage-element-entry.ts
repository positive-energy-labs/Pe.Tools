/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { RevitElementHandle } from "./revit-element-handle.js";
import type { ScheduleCoverageScheduleHit } from "./schedule-coverage-schedule-hit.js";

export interface ScheduleCoverageElementEntry {
  element: RevitElementHandle;
  matchingSchedules: ScheduleCoverageScheduleHit[];
}
