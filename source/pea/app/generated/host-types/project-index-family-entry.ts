/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { RevitAgentContextHandle } from "./revit-agent-context-handle.js";
import type { RevitAgentContextProvenance } from "./revit-agent-context-provenance.js";

export interface ProjectIndexFamilyEntry {
  handle: RevitAgentContextHandle;
  familyName: string;
  categoryName?: string;
  typeCount: number;
  placedInstanceCount: number;
  scheduleCount: number;
  scheduleHandles: RevitAgentContextHandle[];
  provenance: RevitAgentContextProvenance[];
}
