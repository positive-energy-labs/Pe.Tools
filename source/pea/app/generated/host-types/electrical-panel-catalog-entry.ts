/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { ElectricalInsightRole } from "./electrical-insight-role.js";
import type { ElectricalPanelCapacitySource } from "./electrical-panel-capacity-source.js";

export interface ElectricalPanelCatalogEntry {
  panelId: number;
  panelUniqueId: string;
  panelName: string;
  mark?: string;
  categoryName?: string;
  familyName?: string;
  typeName?: string;
  role: ElectricalInsightRole;
  isOperationalPanel: boolean;
  distributionSystemName?: string;
  maxCircuitCount: number;
  configuredSlotCount?: number;
  occupiedSlotCount: number;
  availableSlotCount?: number;
  capacitySource: ElectricalPanelCapacitySource;
  assignedCircuitCount: number;
  panelScheduleCount: number;
  connectedLoadCount: number;
}
