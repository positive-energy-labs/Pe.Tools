/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { ElectricalPanelSchedulesQueryKind } from "./electrical-panel-schedules-query-kind.js";

export interface ElectricalPanelSchedulesQuery {
  kind: ElectricalPanelSchedulesQueryKind;
  scheduleIds?: number[];
  scheduleUniqueIds?: string[];
  panelIds?: number[];
  panelUniqueIds?: string[];
  panelNames?: string[];
}
