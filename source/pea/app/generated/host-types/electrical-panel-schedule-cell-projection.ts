/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { ElectricalPanelScheduleCellSourceKind } from "./electrical-panel-schedule-cell-source-kind.js";
import type { ElectricalPanelScheduleMergedRegion } from "./electrical-panel-schedule-merged-region.js";

export interface ElectricalPanelScheduleCellProjection {
  columnNumber: number;
  displayText: string;
  columnHeaderText?: string;
  isBlank: boolean;
  circuitId?: number;
  circuitUniqueId?: string;
  sourceKind: ElectricalPanelScheduleCellSourceKind;
  parameterText?: string;
  combinedText?: string;
  calculatedValueName?: string;
  calculatedValueText?: string;
  mergedRegion?: ElectricalPanelScheduleMergedRegion;
}
