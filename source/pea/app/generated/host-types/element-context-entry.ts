/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { ElementIdentitySource } from "./element-identity-source.js";
import type { RequestedElementParameterValue } from "./requested-element-parameter-value.js";
import type { ElementContextElectricalData } from "./element-context-electrical-data.js";
import type { ElementContextConnectorSummary } from "./element-context-connector-summary.js";
import type { ElementContextCircuitData } from "./element-context-circuit-data.js";
import type { ElementContextPanelData } from "./element-context-panel-data.js";
import type { ElementContextWireData } from "./element-context-wire-data.js";
import type { ElementContextPanelScheduleData } from "./element-context-panel-schedule-data.js";
import type { ElementContextLoadClassificationData } from "./element-context-load-classification-data.js";

export interface ElementContextEntry {
  elementId: number;
  elementUniqueId: string;
  className: string;
  categoryName?: string;
  name: string;
  familyName?: string;
  typeName?: string;
  mark?: string;
  effectiveIdentity?: string;
  effectiveIdentitySource: ElementIdentitySource;
  requestedParameters?: RequestedElementParameterValue[];
  levelName?: string;
  electrical?: ElementContextElectricalData;
  connectors?: ElementContextConnectorSummary;
  circuit?: ElementContextCircuitData;
  panelContext?: ElementContextPanelData;
  wire?: ElementContextWireData;
  panelSchedule?: ElementContextPanelScheduleData;
  loadClassification?: ElementContextLoadClassificationData;
}
