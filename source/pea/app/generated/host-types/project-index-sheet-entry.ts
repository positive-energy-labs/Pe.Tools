/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { RevitAgentContextHandle } from "./revit-agent-context-handle.js";
import type { ProjectBrowserPath } from "./project-browser-path.js";
import type { RevitAgentContextProvenance } from "./revit-agent-context-provenance.js";

export interface ProjectIndexSheetEntry {
  handle: RevitAgentContextHandle;
  sheetNumber: string;
  sheetName: string;
  placedViewCount: number;
  placedScheduleCount: number;
  placedViews: RevitAgentContextHandle[];
  placedSchedules: RevitAgentContextHandle[];
  levelNames: string[];
  browserPaths: ProjectBrowserPath[];
  provenance: RevitAgentContextProvenance[];
}
