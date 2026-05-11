/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { ElectricalPanelScheduleSectionProjection } from "./electrical-panel-schedule-section-projection.js";

export interface ElectricalPanelScheduleProjection {
  scheduleId: number;
  scheduleUniqueId: string;
  scheduleName: string;
  panelId?: number;
  panelUniqueId?: string;
  panelName?: string;
  templateId?: number;
  templateUniqueId?: string;
  templateName?: string;
  panelScheduleType?: string;
  sections: ElectricalPanelScheduleSectionProjection[];
}
