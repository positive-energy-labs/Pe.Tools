/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { ElementContextSystemRef } from "./element-context-system-ref.js";
import type { ElementContextElementRef } from "./element-context-element-ref.js";

export interface ElementContextWireData {
  wireId: number;
  wireUniqueId: string;
  wireTypeName?: string;
  wiringType: string;
  hotConductorNum: number;
  neutralConductorNum: number;
  groundConductorNum: number;
  systems: ElementContextSystemRef[];
  connectedOwners: ElementContextElementRef[];
}
