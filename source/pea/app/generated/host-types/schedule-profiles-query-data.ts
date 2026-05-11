/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { ScheduleProfilesQueryKind } from "./schedule-profiles-query-kind.js";
import type { ScheduleProfileQueryEntry } from "./schedule-profile-query-entry.js";
import type { RevitDataIssue } from "./revit-data-issue.js";

export interface ScheduleProfilesQueryData {
  documentTitle: string;
  queryKind: ScheduleProfilesQueryKind;
  requestedScheduleCount: number;
  resolvedScheduleCount: number;
  entries: ScheduleProfileQueryEntry[];
  issues: RevitDataIssue[];
}
