/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { RevitAgentContextHandle } from "./revit-agent-context-handle.js";
import type { ProjectBrowserPath } from "./project-browser-path.js";
import type { RevitAgentContextProvenance } from "./revit-agent-context-provenance.js";

export interface ProjectIndexScheduleEntry {
  handle: RevitAgentContextHandle;
  name: string;
  categoryName?: string;
  isTemplate: boolean;
  isPlacedOnSheet: boolean;
  filterBySheet: boolean;
  visibleBodyRowCount: number;
  visibleFamilyCount: number;
  visibleInstanceCount: number;
  sheetHandles: RevitAgentContextHandle[];
  fieldNames: string[];
  browserPaths: ProjectBrowserPath[];
  provenance: RevitAgentContextProvenance[];
}
