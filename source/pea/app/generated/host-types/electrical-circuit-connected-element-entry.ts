/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { ElementIdentitySource } from "./element-identity-source.js";
import type { ElectricalInsightRole } from "./electrical-insight-role.js";
import type { RequestedElementParameterValue } from "./requested-element-parameter-value.js";

export interface ElectricalCircuitConnectedElementEntry {
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
  hasElectricalConnector: boolean;
  electricalSystemCount: number;
  requestedParameters?: RequestedElementParameterValue[];
}
