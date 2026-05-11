/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { ScheduleProfilesQueryKind } from "./schedule-profiles-query-kind.js";

export interface ScheduleProfilesQuery {
  kind: ScheduleProfilesQueryKind;
  scheduleIds?: number[];
  scheduleUniqueIds?: string[];
  scheduleNames?: string[];
  includeTemplates: boolean;
}
