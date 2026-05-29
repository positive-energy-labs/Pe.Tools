/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { RevitAgentContextHandle } from "./revit-agent-context-handle.js";
import type { ProjectBrowserPath } from "./project-browser-path.js";

export interface SheetSummary {
  handle: RevitAgentContextHandle;
  sheetNumber: string;
  sheetName: string;
  titleBlockCount: number;
  viewportCount: number;
  scheduleInstanceCount: number;
  textNoteCount: number;
  genericAnnotationCount: number;
  rasterImageCount: number;
  importInstanceCount: number;
  browserPaths: ProjectBrowserPath[];
}
