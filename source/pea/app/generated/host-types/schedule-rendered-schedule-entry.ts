/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { ScheduleCatalogSheetPlacement } from "./schedule-catalog-sheet-placement.js";
import type { ScheduleRenderedBindingStatus } from "./schedule-rendered-binding-status.js";
import type { ScheduleRenderedSubject } from "./schedule-rendered-subject.js";
import type { ScheduleRenderedColumn } from "./schedule-rendered-column.js";
import type { ScheduleRenderedRow } from "./schedule-rendered-row.js";

export interface ScheduleRenderedScheduleEntry {
  scheduleId: number;
  scheduleUniqueId: string;
  scheduleName: string;
  categoryName?: string;
  isTemplate: boolean;
  isPlacedOnSheet: boolean;
  sheetPlacements: ScheduleCatalogSheetPlacement[];
  isEmpty: boolean;
  bindingStatus: ScheduleRenderedBindingStatus;
  notApplicableRowCount: number;
  nonBindableRowCount: number;
  bindableRowCount: number;
  boundRowCount: number;
  unboundRowCount: number;
  visibleBodyRowCount: number;
  subjectCount: number;
  subjects: ScheduleRenderedSubject[];
  columns: ScheduleRenderedColumn[];
  rows: ScheduleRenderedRow[];
}
