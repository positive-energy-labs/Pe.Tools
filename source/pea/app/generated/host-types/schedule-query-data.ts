/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { ScheduleQueryKind } from "./schedule-query-kind.js";
import type { ScheduleRenderedScheduleEntry } from "./schedule-rendered-schedule-entry.js";
import type { RevitDataIssue } from "./revit-data-issue.js";

export interface ScheduleQueryData {
  documentTitle: string;
  queryKind: ScheduleQueryKind;
  requestedScheduleCount: number;
  resolvedScheduleCount: number;
  entries: ScheduleRenderedScheduleEntry[];
  issues: RevitDataIssue[];
}
