/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { ProjectBrowserSection } from "./project-browser-section.js";
import type { RevitAgentContextHandle } from "./revit-agent-context-handle.js";

export interface ProjectBrowserFolderSummary {
  section: ProjectBrowserSection;
  organizationName?: string;
  pathLabel: string;
  elementCount: number;
  sampleHandles: RevitAgentContextHandle[];
}
