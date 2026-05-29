/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { ScheduleRenderedRowKind } from "./schedule-rendered-row-kind.js";
import type { ScheduleRenderedRowBindingKind } from "./schedule-rendered-row-binding-kind.js";
import type { ScheduleRenderedRowSubjectResolutionStatus } from "./schedule-rendered-row-subject-resolution-status.js";
import type { ScheduleRenderedRowSubjectResolutionReason } from "./schedule-rendered-row-subject-resolution-reason.js";
import type { ScheduleRenderedCellIssue } from "./schedule-rendered-cell-issue.js";

export interface ScheduleRenderedRow {
  rowNumber: number;
  kind: ScheduleRenderedRowKind;
  values: string[];
  bindingKind: ScheduleRenderedRowBindingKind;
  resolutionStatus: ScheduleRenderedRowSubjectResolutionStatus;
  resolutionReason: ScheduleRenderedRowSubjectResolutionReason;
  subjectIds: number[];
  issues?: ScheduleRenderedCellIssue[];
}
