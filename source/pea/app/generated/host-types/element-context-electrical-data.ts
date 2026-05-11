/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { ElectricalInsightRole } from "./electrical-insight-role.js";
import type { ElementContextSystemRef } from "./element-context-system-ref.js";
import type { ElementContextElementRef } from "./element-context-element-ref.js";

export interface ElementContextElectricalData {
  role: ElectricalInsightRole;
  systems: ElementContextSystemRef[];
  primarySystem?: ElementContextSystemRef;
  baseEquipment?: ElementContextElementRef;
}
