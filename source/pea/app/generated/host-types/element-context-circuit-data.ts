/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { ElementContextElementRef } from "./element-context-element-ref.js";

export interface ElementContextCircuitData {
  circuitId: number;
  circuitUniqueId: string;
  circuitNumber: string;
  loadName?: string;
  panelName?: string;
  voltage?: string;
  apparentLoad?: string;
  apparentCurrent?: string;
  rating?: string;
  frame?: string;
  connectedElements: ElementContextElementRef[];
}
