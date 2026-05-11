/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { ElectricalPanelSchedulesQueryKind } from "./electrical-panel-schedules-query-kind.js";
import type { ElectricalPanelScheduleProjection } from "./electrical-panel-schedule-projection.js";
import type { RevitDataIssue } from "./revit-data-issue.js";

export interface ElectricalPanelSchedulesQueryData {
  documentTitle: string;
  queryKind: ElectricalPanelSchedulesQueryKind;
  requestedScheduleCount: number;
  resolvedScheduleCount: number;
  entries: ElectricalPanelScheduleProjection[];
  issues: RevitDataIssue[];
}
