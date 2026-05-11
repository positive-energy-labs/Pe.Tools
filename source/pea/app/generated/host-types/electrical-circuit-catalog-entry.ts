/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { ElectricalInsightRole } from "./electrical-insight-role.js";
import type { ElectricalCircuitConnectedElementEntry } from "./electrical-circuit-connected-element-entry.js";
import type { ElectricalCircuitWireEntry } from "./electrical-circuit-wire-entry.js";
import type { ElectricalNearbyProxyCandidateEntry } from "./electrical-nearby-proxy-candidate-entry.js";

export interface ElectricalCircuitCatalogEntry {
  circuitId: number;
  circuitUniqueId: string;
  circuitNumber: string;
  loadName?: string;
  panelId?: number;
  panelUniqueId?: string;
  panelName?: string;
  slotIndex?: string;
  ways?: string;
  polesNumber: number;
  voltage?: string;
  apparentLoad?: string;
  apparentCurrent?: string;
  trueLoad?: string;
  trueCurrent?: string;
  rating?: string;
  frame?: string;
  ratingOverride: boolean;
  ratingOverrideValueDisplay?: string;
  wireSize?: string;
  wireTypeName?: string;
  isEmpty: boolean;
  isMultipleNetwork: boolean;
  hasCustomCircuitPath: boolean;
  hasPathOffset: boolean;
  hasProxyLikeConnectedElements: boolean;
  proxyLikeConnectedElementCount: number;
  proxyInferenceRecommended: boolean;
  primaryConnectedRole?: ElectricalInsightRole;
  connectedRoles: ElectricalInsightRole[];
  connectedElements: ElectricalCircuitConnectedElementEntry[];
  wires: ElectricalCircuitWireEntry[];
  nearbyProxyCandidates?: ElectricalNearbyProxyCandidateEntry[];
}
