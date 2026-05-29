/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { ParameterIdentity } from "./parameter-identity.js";
import type { RevitElementHandle } from "./revit-element-handle.js";

export interface ParameterCoverageParameterEntry {
  identity: ParameterIdentity;
  categoryName?: string;
  elementCount: number;
  presentCount: number;
  missingCount: number;
  blankCount: number;
  defaultCount: number;
  samples: RevitElementHandle[];
}
