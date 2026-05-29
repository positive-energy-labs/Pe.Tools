/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { RevitDataResultView } from "./revit-data-result-view.js";
import type { ScheduleRequiredFieldAudit } from "./schedule-required-field-audit.js";

export interface ScheduleQueryProjection {
  view: RevitDataResultView;
  includeColumns: boolean;
  includeSubjects: boolean;
  includeCellValues: boolean;
  includeRows: boolean;
  includeOnlyRowsWithIssues: boolean;
  requiredFieldAudit?: ScheduleRequiredFieldAudit;
}
