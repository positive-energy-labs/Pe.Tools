/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { RevitAgentContextHandle } from "./revit-agent-context-handle.js";
import type { ProjectBrowserPath } from "./project-browser-path.js";
import type { RevitAgentContextProvenance } from "./revit-agent-context-provenance.js";

export interface ProjectIndexViewEntry {
  handle: RevitAgentContextHandle;
  name: string;
  viewType: string;
  levelName?: string;
  isTemplate: boolean;
  canBePrinted: boolean;
  isPlacedOnSheet: boolean;
  sheetHandles: RevitAgentContextHandle[];
  browserPaths: ProjectBrowserPath[];
  provenance: RevitAgentContextProvenance[];
}
