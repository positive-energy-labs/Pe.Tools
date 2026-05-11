/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { ElectricalPanelScheduleSectionType } from "./electrical-panel-schedule-section-type.js";
import type { ElectricalPanelScheduleRowProjection } from "./electrical-panel-schedule-row-projection.js";

export interface ElectricalPanelScheduleSectionProjection {
  sectionType: ElectricalPanelScheduleSectionType;
  isValid: boolean;
  firstRowNumber: number;
  lastRowNumber: number;
  firstColumnNumber: number;
  lastColumnNumber: number;
  numberOfRows: number;
  numberOfColumns: number;
  rows: ElectricalPanelScheduleRowProjection[];
}
