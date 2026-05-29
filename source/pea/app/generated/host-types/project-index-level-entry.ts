/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { RevitAgentContextHandle } from "./revit-agent-context-handle.js";
import type { RevitAgentContextProvenance } from "./revit-agent-context-provenance.js";

export interface ProjectIndexLevelEntry {
  handle: RevitAgentContextHandle;
  name: string;
  elevation: number;
  viewCount: number;
  placedViewCount: number;
  scheduleCount: number;
  placedScheduleCount: number;
  familyInstanceCount: number;
  sheetHandles: RevitAgentContextHandle[];
  provenance: RevitAgentContextProvenance[];
}
