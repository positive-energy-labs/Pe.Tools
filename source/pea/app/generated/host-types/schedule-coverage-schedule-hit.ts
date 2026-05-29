/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { ScheduleCatalogSheetPlacement } from "./schedule-catalog-sheet-placement.js";

export interface ScheduleCoverageScheduleHit {
  scheduleId: number;
  scheduleUniqueId: string;
  scheduleName: string;
  isPlacedOnSheet: boolean;
  sheetPlacements: ScheduleCatalogSheetPlacement[];
}
