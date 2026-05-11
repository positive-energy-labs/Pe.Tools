/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { ElementIdentitySource } from "./element-identity-source.js";
import type { ElectricalInsightRole } from "./electrical-insight-role.js";
import type { ElectricalNearbyProxyCandidateMatchReason } from "./electrical-nearby-proxy-candidate-match-reason.js";
import type { RequestedElementParameterValue } from "./requested-element-parameter-value.js";

export interface ElectricalNearbyProxyCandidateEntry {
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
  role: ElectricalInsightRole;
  distanceFeet: number;
  matchReason: ElectricalNearbyProxyCandidateMatchReason;
  requestedParameters?: RequestedElementParameterValue[];
}
